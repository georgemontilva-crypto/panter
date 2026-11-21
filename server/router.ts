import { and, count, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { checkPassword, endLogin, hashPassword, startLogin } from "./auth";
import { db } from "./db";
import { PAY_METHODS, QUOTE_STATES, STATION_KINDS, launcherApps, partyPackages, products, purchases, stations, users } from "./db/schema";
import { QR_PREFIX, caracasDate, clearRateLimit, fail, newDeviceToken, normalizePhone, now, rateLimit, sha256 } from "./lib";
import {
  activeMenu,
  activeSessionsOf,
  adjustTime,
  closingInfo,
  createOrder,
  createUser,
  endSession,
  extendSession,
  getConfig,
  getLauncherSettings,
  isLauncherTarget,
  kitchenBoard,
  ledger,
  levelFor,
  recentOrders,
  recentTx,
  recordVisit,
  refundOrder,
  saveConfig,
  saveLauncherSettings,
  setKitchenStatus,
  startSession,
  stationsBoard,
  timeCreditsOf,
  unlockStation,
  UNLOCK_MAX_MINUTES,
  userTx,
} from "./services";
import { addQuotePayment, createQuote, dayReport, getQuote, listPackages, listPurchases, listQuotes, liveSummary, removeQuotePayment, savePurchase, setQuoteStatus, updateQuote, PURCHASE_CATEGORIES } from "./office";
import { adminProcedure, deskProcedure, kitchenProcedure, memberProcedure, publicProcedure, router } from "./trpc";

const name = z.string().trim().min(2, "Escribe el nombre completo.").max(120);
const phone = z
  .string()
  .transform(normalizePhone)
  .refine((v) => v.length >= 10 && v.length <= 15, "Escribe un teléfono válido, por ejemplo 0414 1234567.");
const password = z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").max(72);
const email = z.union([z.literal(""), z.email("Ese correo no parece válido.")]).optional();
const requiredEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Escribe un correo válido, por ejemplo nombre@correo.com.").max(190));
const id = z.number().int().positive();
const selfMinutes = z.number().int().min(30).max(600).multipleOf(30, "El tiempo va en bloques de 30 minutos.");
const staffMinutes = z.number().int().min(15).max(720).multipleOf(15, "El tiempo va en bloques de 15 minutos.");
const cents = z.number().int();

type UserRow = typeof users.$inferSelect;
const publicUser = (u: UserRow) => ({
  id: u.id,
  role: u.role,
  name: u.name,
  phone: u.phone,
  memberCode: u.memberCode,
});

async function memberDetail(u: UserRow) {
  const config = await getConfig();
  const [tx, live, purchases, timeCredits] = await Promise.all([recentTx(u.id), activeSessionsOf(u.id), recentOrders({ userId: u.id }, 8), timeCreditsOf(u.id)]);
  return {
    ...publicUser(u),
    email: u.email,
    hasCard: u.hasCard,
    hasPassword: Boolean(u.passwordHash),
    cardQr: `${QR_PREFIX}${u.cardToken}`,
    balanceCents: u.balanceCents,
    // Minutos a favor por tipo de máquina: tiempo pagado que no usó y puede jugar otro día.
    timeCredits,
    visitsCount: u.visitsCount,
    level: levelFor(config, u.visitsCount),
    loyalty: { every: config.loyaltyEvery, bonusCents: config.loyaltyBonusCents },
    rates: config.rates,
    graceMinutes: config.graceMinutes,
    closing: closingInfo(config),
    cardPriceCents: config.cardPriceCents,
    createdAt: u.createdAt,
    sessions: live,
    orders: purchases,
    tx: tx.map((t) => ({
      id: t.id,
      type: t.type,
      amountCents: t.amountCents,
      balanceAfterCents: t.balanceAfterCents,
      paidCents: t.paidCents,
      method: t.method,
      note: t.note,
      createdAt: t.createdAt,
    })),
  };
}

async function getMember(userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) fail("NOT_FOUND", "No encontramos a ese cliente.");
  return u;
}

// ---------- Cuenta ----------
const authRouter = router({
  me: publicProcedure.query(({ ctx }) => (ctx.user ? publicUser(ctx.user) : null)),

  // Registro de clientes: nombre, correo, teléfono celular y contraseña. Siempre nace como cliente.
  register: publicProcedure.input(z.object({ name, email: requiredEmail, phone, password })).mutation(async ({ ctx, input }) => {
    rateLimit(`register:${ctx.req.ip}`, 6);
    const userId = await createUser({
      name: input.name,
      phone: input.phone,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
    await startLogin(ctx.res, userId);
    return { ok: true };
  }),

  // Dos entradas separadas: "member" es la de los clientes (/cuenta) y "staff" la del personal (/caja).
  // Cada cuenta entra solo por la suya, así un cliente nunca abre sesión en el panel ni al revés.
  login: publicProcedure
    .input(z.object({ identifier: z.string().trim().min(3).max(190), password: z.string().min(1).max(72), area: z.enum(["member", "staff"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      const key = `login:${ctx.req.ip}:${input.identifier.toLowerCase()}`;
      rateLimit(key);
      const byEmail = input.identifier.includes("@");
      const [u] = await db
        .select()
        .from(users)
        .where(byEmail ? eq(users.email, input.identifier.toLowerCase()) : eq(users.phone, normalizePhone(input.identifier)));
      if (!u || !u.active || !u.passwordHash || !(await checkPassword(input.password, u.passwordHash))) {
        fail("UNAUTHORIZED", "Los datos no coinciden. Revisa el correo o teléfono y la contraseña.");
      }
      const isStaff = u.role !== "member";
      if (input.area === "staff" && !isStaff) fail("FORBIDDEN", "Esta entrada es solo para el personal. Si eres cliente, entra por Mi cuenta.");
      if (input.area === "member" && isStaff) fail("FORBIDDEN", "Esta cuenta es del personal. Entra por el acceso del personal.");
      clearRateLimit(key);
      await startLogin(ctx.res, u.id);
      return publicUser(u);
    }),

  // Clientes registrados en caja: crean su contraseña con el código de su tarjeta y su teléfono, y dejan su correo.
  claim: publicProcedure
    .input(z.object({ memberCode: z.string().trim().toUpperCase().min(6).max(16), phone, email: requiredEmail, password }))
    .mutation(async ({ ctx, input }) => {
      rateLimit(`claim:${ctx.req.ip}`, 6);
      const code = input.memberCode.startsWith("PNT-") ? input.memberCode : `PNT-${input.memberCode}`;
      const [u] = await db.select().from(users).where(and(eq(users.memberCode, code), eq(users.phone, input.phone)));
      if (!u || !u.active || u.role !== "member") fail("NOT_FOUND", "El código y el teléfono no coinciden con ninguna tarjeta.");
      if (u.passwordHash) fail("CONFLICT", "Esa tarjeta ya tiene cuenta. Entra con tu correo o teléfono y tu contraseña.");
      const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, input.email), ne(users.id, u.id)));
      if (taken) fail("CONFLICT", "Ese correo ya está registrado.");
      await db.update(users).set({ passwordHash: await hashPassword(input.password), email: input.email }).where(eq(users.id, u.id));
      await startLogin(ctx.res, u.id);
      return { ok: true };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    endLogin(ctx.res);
    return { ok: true };
  }),
});

// ---------- Perfil del cliente ----------
const memberRouter = router({
  home: memberProcedure.query(({ ctx }) => memberDetail(ctx.user)),

  // El menú que se vende en el mostrador, para que el cliente vea precios antes de pedir.
  menu: memberProcedure.query(async () => (await activeMenu()).map((p) => ({ id: p.id, name: p.name, category: p.category, priceCents: p.priceCents }))),

  pcs: memberProcedure.query(async () => {
    const board = await stationsBoard();
    return board
      .filter((s) => s.kind === "pc" && s.enabled)
      .map((s) => ({ id: s.id, number: s.number, label: s.label, state: s.state, freeAt: s.session?.graceEndsAt ?? null }));
  }),

  start: memberProcedure
    .input(z.object({ stationId: id, minutes: selfMinutes, code: z.string().trim().regex(/^\d{4}$/, "El código tiene 4 números.") }))
    .mutation(({ ctx, input }) => startSession({ userId: ctx.user.id, stationId: input.stationId, minutes: input.minutes, staffId: null, pairCode: input.code })),

  extend: memberProcedure
    .input(z.object({ sessionId: id, minutes: selfMinutes }))
    .mutation(({ ctx, input }) => extendSession({ sessionId: input.sessionId, minutes: input.minutes, staffId: null, userId: ctx.user.id })),

  end: memberProcedure
    .input(z.object({ sessionId: id }))
    .mutation(({ ctx, input }) => endSession({ sessionId: input.sessionId, staffId: null, userId: ctx.user.id, reason: "cliente" })),
});

// ---------- Caja ----------
const method = z.enum(PAY_METHODS);

const staffRouter = router({
  config: deskProcedure.query(async () => {
    const config = await getConfig();
    return { ...config, closing: closingInfo(config) };
  }),

  find: deskProcedure.input(z.object({ q: z.string().trim().max(120) })).query(async ({ input }) => {
    const q = input.q;
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    const upper = q.toUpperCase();
    const where = upper.startsWith(QR_PREFIX)
      ? eq(users.cardToken, upper.slice(QR_PREFIX.length))
      : or(
          eq(users.memberCode, upper.startsWith("PNT-") ? upper : `PNT-${upper}`),
          digits.length >= 4 ? like(users.phone, `%${digits}%`) : undefined,
          // lower() en ambos lados: la búsqueda por nombre no depende de la intercalación de la base.
          sql`lower(${users.name}) like ${`%${q.toLowerCase()}%`}`,
        );
    const rows = await db.select().from(users).where(where).orderBy(desc(users.id)).limit(8);
    return rows.map((u) => ({ ...publicUser(u), balanceCents: u.balanceCents, visitsCount: u.visitsCount, hasCard: u.hasCard, active: u.active }));
  }),

  member: deskProcedure.input(z.object({ id })).query(async ({ input }) => memberDetail(await getMember(input.id))),

  createMember: deskProcedure.input(z.object({ name, phone, email })).mutation(async ({ ctx, input }) => {
    const userId = await createUser({ name: input.name, phone: input.phone, email: input.email?.toLowerCase(), createdBy: ctx.user.id });
    return { id: userId };
  }),

  topup: deskProcedure
    .input(
      z.object({
        userId: id,
        amountCents: cents.min(50, "La recarga mínima es 0,50 REF.").max(50_000, "La recarga máxima por operación es 500 REF."),
        method,
        reference: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      userTx(input.userId, async (tx) => ({
        balanceCents: await ledger(tx, {
          userId: input.userId,
          type: "topup",
          amountCents: input.amountCents,
          paidCents: input.amountCents,
          method: input.method,
          reference: input.reference,
          staffId: ctx.user.id,
        }),
      })),
    ),

  sellCard: deskProcedure.input(z.object({ userId: id, method })).mutation(async ({ ctx, input }) => {
    const config = await getConfig();
    const member = await getMember(input.userId);
    if (member.hasCard) fail("CONFLICT", "Este cliente ya compró su tarjeta.");
    await userTx(member.id, async (tx) => {
      await ledger(tx, {
        userId: member.id,
        type: "card_sale",
        amountCents: 0,
        paidCents: config.cardPriceCents,
        method: input.method,
        staffId: ctx.user.id,
      });
      await tx.update(users).set({ hasCard: true }).where(eq(users.id, member.id));
    });
    return { ok: true };
  }),

  // Cobro en el mostrador: se escanea la tarjeta, se eligen los productos y se descuenta del saldo.
  sell: deskProcedure
    .input(
      z.object({
        userId: id,
        items: z
          .array(z.object({ productId: id, qty: z.number().int().min(1).max(50) }))
          .min(1, "Agrega al menos un producto al pedido.")
          .max(40),
        // Indicación para cocina: "sin cebolla", "para llevar"…
        note: z.string().trim().max(160).optional(),
      }),
    )
    .mutation(({ ctx, input }) => createOrder({ userId: input.userId, staffId: ctx.user.id, items: input.items, note: input.note })),

  refundOrder: deskProcedure.input(z.object({ orderId: id })).mutation(({ ctx, input }) => refundOrder({ orderId: input.orderId, staffId: ctx.user.id })),

  checkin: deskProcedure.input(z.object({ userId: id })).mutation(async ({ input }) => {
    const config = await getConfig();
    const isNew = await userTx(input.userId, (tx) => recordVisit(tx, input.userId, "checkin", config));
    return { isNew };
  }),

  board: deskProcedure.query(() => stationsBoard()),

  start: deskProcedure
    .input(z.object({ userId: id, stationId: id, minutes: staffMinutes }))
    .mutation(({ ctx, input }) => startSession({ ...input, staffId: ctx.user.id })),

  extend: deskProcedure
    .input(z.object({ sessionId: id, minutes: staffMinutes }))
    .mutation(({ ctx, input }) => extendSession({ ...input, staffId: ctx.user.id })),

  end: deskProcedure
    .input(z.object({ sessionId: id }))
    .mutation(({ ctx, input }) => endSession({ sessionId: input.sessionId, staffId: ctx.user.id, reason: "caja" })),

  // Cierre del día: lo que entró a caja por método y la actividad de la jornada.
  // Cierre del día: ventas y dinero que entró. Solo administradores y súper admin.
  day: adminProcedure.input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })).query(({ input }) => dayReport(input.day ?? caracasDate())),
});

// ---------- Cocina ----------
const kitchenRouter = router({
  board: kitchenProcedure.query(() => kitchenBoard()),
  setStatus: kitchenProcedure
    .input(z.object({ orderId: id, status: z.enum(["pending", "preparing", "ready", "delivered"]) }))
    .mutation(({ input }) => setKitchenStatus(input.orderId, input.status)),
});

// ---------- Oficina: resumen en vivo, fiestas y compras ----------
const quoteInput = z.object({
  customerName: name,
  customerPhone: z.string().trim().max(20).optional(),
  customerEmail: email,
  occasion: z.string().trim().max(120).optional(),
  eventAt: z.number().int().positive().nullable(),
  durationMinutes: z.number().int().min(30, "La fiesta dura al menos 30 minutos.").max(24 * 60),
  guests: z.number().int().min(1, "Indica cuántos invitados son.").max(500),
  notes: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Cada renglón necesita una descripción.").max(160),
        qty: z.number().int().min(1, "La cantidad mínima es 1.").max(999),
        // Negativo = descuento.
        unitCents: cents.min(-10_000_000).max(10_000_000),
      }),
    )
    .min(1, "Agrega un paquete o al menos un renglón a la cotización.")
    .max(40),
});
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la fecha de la factura.");

const officeRouter = router({
  live: adminProcedure.query(() => liveSummary()),

  // Paquetes de fiesta
  packages: adminProcedure.query(() => listPackages(false)),
  packageSave: adminProcedure
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(2, "Escribe el nombre del paquete.").max(80),
        description: z.string().trim().max(400).optional(),
        priceCents: cents.min(0).max(10_000_000),
        durationMinutes: z.number().int().min(30).max(24 * 60),
        guests: z.number().int().min(1).max(500),
        active: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id: packageId, ...values } = input;
      const row = { ...values, description: values.description || null };
      if (packageId) {
        await db.update(partyPackages).set(row).where(eq(partyPackages.id, packageId));
        return { id: packageId };
      }
      const [created] = await db.insert(partyPackages).values({ ...row, createdAt: now() });
      return { id: created.insertId };
    }),

  // Cotizaciones
  quotes: adminProcedure.query(() => listQuotes()),
  quote: adminProcedure.input(z.object({ id })).query(({ input }) => getQuote(input.id)),
  quoteCreate: adminProcedure.input(quoteInput).mutation(({ ctx, input }) => createQuote(input, ctx.user.id)),
  quoteUpdate: adminProcedure.input(quoteInput.extend({ id })).mutation(({ input }) => updateQuote(input.id, input)),
  quoteStatus: adminProcedure.input(z.object({ id, status: z.enum(QUOTE_STATES) })).mutation(({ input }) => setQuoteStatus(input.id, input.status)),
  quotePay: adminProcedure
    .input(z.object({ id, amountCents: cents.min(1, "El pago debe ser mayor que cero."), method, reference: z.string().trim().max(80).optional() }))
    .mutation(({ ctx, input }) => addQuotePayment({ quoteId: input.id, amountCents: input.amountCents, method: input.method, reference: input.reference, staffId: ctx.user.id })),
  quotePaymentRemove: adminProcedure.input(z.object({ paymentId: id })).mutation(({ input }) => removeQuotePayment(input.paymentId)),

  // Facturas de compras
  purchases: adminProcedure.input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })).query(({ input }) => listPurchases(input.month)),
  purchaseSave: adminProcedure
    .input(
      z.object({
        id: id.optional(),
        supplier: z.string().trim().min(2, "Escribe el nombre del proveedor.").max(120),
        invoiceNumber: z.string().trim().max(40).optional(),
        invoiceDate: dayString,
        category: z.enum(PURCHASE_CATEGORIES),
        description: z.string().trim().max(300).optional(),
        totalCents: cents.min(1, "El monto debe ser mayor que cero.").max(100_000_000),
        paid: z.boolean(),
        method: method.optional(),
        reference: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(({ ctx, input }) => savePurchase(input, ctx.user.id)),
  purchaseRemove: adminProcedure.input(z.object({ id })).mutation(async ({ input }) => {
    await db.delete(purchases).where(eq(purchases.id, input.id));
    return { ok: true };
  }),
});

// ---------- Administración ----------
const staffRole = z.enum(["cashier", "kitchen", "admin", "owner"]);
const SENIOR = ["admin", "owner"];

/** La cuenta del personal que se quiere tocar, si quien lo pide tiene permiso sobre ella. */
async function staffTarget(actor: UserRow, targetId: number) {
  const [target] = await db.select().from(users).where(eq(users.id, targetId));
  if (!target || target.role === "member") fail("NOT_FOUND", "No encontramos a esa persona del equipo.");
  if (SENIOR.includes(target.role) && actor.role !== "owner" && target.id !== actor.id) fail("FORBIDDEN", "Solo el súper admin puede cambiar la cuenta de un administrador.");
  return target;
}
/** El negocio nunca se queda sin dueño: tiene que quedar al menos otro súper admin activo. */
async function keepOneOwner(exceptId: number) {
  const [others] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true), ne(users.id, exceptId)));
  if (others.n === 0) fail("CONFLICT", "Debe quedar al menos un súper admin activo.");
}

const configInput = z.object({
  rates: z.object({ pc: cents.min(0), ps5: cents.min(0), switch: cents.min(0), sim: cents.min(0) }),
  cardPriceCents: cents.min(0),
  graceMinutes: z.number().int().min(0).max(30),
  saveUnusedTime: z.boolean(),
  loyaltyEvery: z.number().int().min(1).max(100),
  loyaltyBonusCents: cents.min(0),
  levels: z.array(z.object({ name: z.string().trim().min(1).max(30), min: z.number().int().min(0) })).min(1).max(8),
  hours: z
    .array(z.tuple([z.number().int().min(0).max(1439), z.number().int().min(1).max(1440)]))
    .length(7)
    .refine((week) => week.every(([open, close]) => open < close), "En cada día, la hora de cierre debe ser después de la de apertura."),
  extendedUntil: z.number().int().positive().nullable(),
});

const adminRouter = router({
  saveConfig: adminProcedure.input(configInput).mutation(async ({ input }) => {
    await saveConfig(input);
    return { ok: true };
  }),

  products: adminProcedure.query(() => db.select().from(products).orderBy(products.category, products.name)),

  productSave: adminProcedure
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(2, "Escribe el nombre del producto.").max(80),
        category: z.string().trim().min(1, "Escribe la categoría (por ejemplo, Bebidas).").max(40),
        priceCents: cents.min(1, "El precio debe ser mayor que cero.").max(100_000),
        active: z.boolean(),
        kitchen: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const { id: productId, ...values } = input;
      if (productId) {
        await db.update(products).set(values).where(eq(products.id, productId));
        return { id: productId };
      }
      const [created] = await db.insert(products).values({ ...values, createdAt: now() });
      return { id: created.insertId };
    }),

  stationCreate: adminProcedure
    .input(z.object({ kind: z.enum(STATION_KINDS), number: z.number().int().min(1).max(999), note: z.string().trim().max(160).optional() }))
    .mutation(async ({ input }) => {
      const [dup] = await db.select({ id: stations.id }).from(stations).where(and(eq(stations.kind, input.kind), eq(stations.number, input.number)));
      if (dup) fail("CONFLICT", "Ya existe una estación de ese tipo con ese número.");
      const [created] = await db.insert(stations).values({ kind: input.kind, number: input.number, note: input.note || null });
      return { id: created.insertId };
    }),

  stationUpdate: adminProcedure.input(z.object({ id, enabled: z.boolean(), note: z.string().trim().max(160).optional() })).mutation(async ({ input }) => {
    await db.update(stations).set({ enabled: input.enabled, note: input.note || null }).where(eq(stations.id, input.id));
    return { ok: true };
  }),

  // Genera la credencial del programa de bloqueo. Se muestra una sola vez; la anterior deja de servir.
  stationToken: adminProcedure.input(z.object({ id })).mutation(async ({ input }) => {
    const [station] = await db.select().from(stations).where(eq(stations.id, input.id));
    if (!station || station.kind !== "pc") fail("BAD_REQUEST", "Solo las PCs usan el programa de bloqueo.");
    const token = newDeviceToken();
    await db.update(stations).set({ deviceTokenHash: sha256(token), lastSeenAt: null }).where(eq(stations.id, input.id));
    return { token };
  }),

  // Mantenimiento: 0 vuelve a bloquear, un número abre ese tiempo, null abre hasta que alguien la bloquee.
  stationUnlock: adminProcedure
    .input(z.object({ id, minutes: z.number().int().min(0).max(UNLOCK_MAX_MINUTES).nullable() }))
    .mutation(({ input }) => unlockStation(input.id, input.minutes)),

  staffList: adminProcedure.query(async () => {
    const rows = await db.select().from(users).where(ne(users.role, "member")).orderBy(users.name);
    return rows.map((u) => ({ ...publicUser(u), active: u.active }));
  }),

  // Un administrador crea operadoras y cocina. Solo el súper admin crea administradores y otros súper admin.
  staffCreate: adminProcedure.input(z.object({ name, phone, password, role: staffRole })).mutation(async ({ ctx, input }) => {
    if (SENIOR.includes(input.role) && ctx.user.role !== "owner") fail("FORBIDDEN", "Solo el súper admin puede crear administradores.");
    const userId = await createUser({
      name: input.name,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      createdBy: ctx.user.id,
    });
    return { id: userId };
  }),

  // Cambiar el tipo de usuario o ponerle una contraseña nueva a alguien del personal.
  staffUpdate: adminProcedure.input(z.object({ id, role: staffRole.optional(), password: password.optional() })).mutation(async ({ ctx, input }) => {
    const target = await staffTarget(ctx.user, input.id);
    if (input.role && input.role !== target.role) {
      if (target.id === ctx.user.id) fail("BAD_REQUEST", "No puedes cambiar tu propio tipo de usuario.");
      if (SENIOR.includes(input.role) && ctx.user.role !== "owner") fail("FORBIDDEN", "Solo el súper admin puede nombrar administradores.");
      if (target.role === "owner") await keepOneOwner(target.id);
    }
    await db
      .update(users)
      .set({ role: input.role ?? target.role, ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}) })
      .where(eq(users.id, target.id));
    return { ok: true };
  }),

  userSetActive: adminProcedure.input(z.object({ id, active: z.boolean() })).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) fail("BAD_REQUEST", "No puedes desactivar tu propia cuenta.");
    const [target] = await db.select().from(users).where(eq(users.id, input.id));
    if (!target) fail("NOT_FOUND", "No encontramos esa cuenta.");
    if (target.role !== "member") await staffTarget(ctx.user, input.id);
    if (target.role === "owner" && !input.active) await keepOneOwner(target.id);
    await db.update(users).set({ active: input.active }).where(eq(users.id, input.id));
    return { ok: true };
  }),

  members: adminProcedure.input(z.object({ page: z.number().int().min(0).max(10_000) })).query(async ({ input }) => {
    const size = 50;
    const where = eq(users.role, "member");
    const [rows, [total]] = await Promise.all([
      db.select().from(users).where(where).orderBy(desc(users.id)).limit(size).offset(input.page * size),
      db.select({ n: count() }).from(users).where(where),
    ]);
    return {
      total: total.n,
      pageSize: size,
      rows: rows.map((u) => ({
        ...publicUser(u),
        email: u.email,
        balanceCents: u.balanceCents,
        visitsCount: u.visitsCount,
        hasCard: u.hasCard,
        createdAt: u.createdAt,
      })),
    };
  }),

  // Corrección manual del saldo. Queda registrada con quién la hizo y por qué.
  adjust: adminProcedure
    .input(z.object({ userId: id, amountCents: cents.min(-50_000).max(50_000), note: z.string().trim().min(4, "Explica el motivo del ajuste.").max(200) }))
    .mutation(({ ctx, input }) =>
      userTx(input.userId, async (tx) => ({
        balanceCents: await ledger(tx, { userId: input.userId, type: "adjust", amountCents: input.amountCents, note: input.note, staffId: ctx.user.id }),
      })),
    ),

  // ---------- Pantalla de juegos de las PC ----------
  launcher: adminProcedure.query(async () => {
    const [config, apps, pcs] = await Promise.all([
      getLauncherSettings(),
      db.select().from(launcherApps).orderBy(launcherApps.category, launcherApps.name),
      db.select({ id: stations.id, catalog: stations.catalog }).from(stations).where(eq(stations.kind, "pc")),
    ]);
    // Lo que las PC encontraron instalado, sin repetir, con en cuántas PC está cada juego.
    const found = new Map<string, { key: string; name: string; source: string; pcs: number }>();
    for (const pc of pcs) {
      let items: { key: string; name: string; source: string }[] = [];
      try {
        items = pc.catalog ? JSON.parse(pc.catalog) : [];
      } catch {
        items = [];
      }
      for (const item of items) found.set(item.key, { ...item, pcs: (found.get(item.key)?.pcs ?? 0) + 1 });
    }
    return {
      enabled: config.enabled,
      signOut: config.signOut,
      apps: apps.map((a) => ({ id: a.id, name: a.name, category: a.category, target: a.target, args: a.args, imageUrl: a.imageUrl, active: a.active })),
      detected: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ ...d, hidden: config.hidden.includes(d.key) })),
      reportingPcs: pcs.filter((pc) => pc.catalog !== null).length,
      totalPcs: pcs.length,
    };
  }),

  launcherSave: adminProcedure.input(z.object({ enabled: z.boolean(), signOut: z.boolean() })).mutation(async ({ input }) => {
    await saveLauncherSettings({ ...(await getLauncherSettings()), ...input });
    return { ok: true };
  }),

  launcherHide: adminProcedure.input(z.object({ key: z.string().regex(/^(steam|epic):[\w.-]{1,80}$/), hidden: z.boolean() })).mutation(async ({ input }) => {
    const config = await getLauncherSettings();
    const hidden = new Set(config.hidden);
    if (input.hidden) hidden.add(input.key);
    else hidden.delete(input.key);
    await saveLauncherSettings({ ...config, hidden: [...hidden] });
    return { ok: true };
  }),

  launcherAppSave: adminProcedure
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(2, "Escribe el nombre del juego o la app.").max(80),
        category: z.enum(["juego", "app"]),
        target: z
          .string()
          .trim()
          .max(400)
          .refine(isLauncherTarget, "Pon la ruta completa del programa (C:\\Juegos\\juego.exe) o un enlace de lanzador (steam://rungameid/730)."),
        args: z.string().trim().max(200).optional(),
        imageUrl: z.union([z.literal(""), z.url("La imagen debe ser un enlace que empiece por https://").startsWith("https://", "La imagen debe ser un enlace que empiece por https://").max(400)]).optional(),
        active: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id: appId, ...values } = input;
      const row = { ...values, args: values.args || null, imageUrl: values.imageUrl || null };
      if (appId) {
        await db.update(launcherApps).set(row).where(eq(launcherApps.id, appId));
        return { id: appId };
      }
      const [created] = await db.insert(launcherApps).values({ ...row, createdAt: now() });
      return { id: created.insertId };
    }),

  launcherAppRemove: adminProcedure.input(z.object({ id })).mutation(async ({ input }) => {
    await db.delete(launcherApps).where(eq(launcherApps.id, input.id));
    return { ok: true };
  }),

  // Corrección manual del tiempo a favor: sumar o quitar minutos de un tipo de máquina.
  adjustTime: adminProcedure
    .input(
      z.object({
        userId: id,
        kind: z.enum(STATION_KINDS),
        minutes: z.number().int().min(-1440).max(1440).refine((n) => n !== 0, "Indica cuántos minutos sumar o quitar."),
        note: z.string().trim().min(4, "Explica el motivo del ajuste.").max(120),
      }),
    )
    .mutation(({ ctx, input }) => adjustTime({ ...input, staffId: ctx.user.id })),
});

export const appRouter = router({
  auth: authRouter,
  member: memberRouter,
  staff: staffRouter,
  kitchen: kitchenRouter,
  office: officeRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
