import { and, count, desc, eq, gte, like, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { checkPassword, endLogin, hashPassword, startLogin } from "./auth";
import { db } from "./db";
import { PAY_METHODS, STATION_KINDS, sessions, stations, users, visits, walletTx } from "./db/schema";
import { QR_PREFIX, caracasDate, caracasDayBounds, clearRateLimit, fail, newDeviceToken, normalizePhone, now, rateLimit, sha256, MINUTE } from "./lib";
import {
  activeSessionsOf,
  createUser,
  endSession,
  extendSession,
  getConfig,
  ledger,
  levelFor,
  namesOf,
  recentTx,
  recordVisit,
  saveConfig,
  startSession,
  stationsBoard,
  userTx,
} from "./services";
import { adminProcedure, memberProcedure, publicProcedure, router, staffProcedure } from "./trpc";

const name = z.string().trim().min(2, "Escribe el nombre completo.").max(120);
const phone = z
  .string()
  .transform(normalizePhone)
  .refine((v) => v.length >= 10 && v.length <= 15, "Escribe un teléfono válido, por ejemplo 0414 1234567.");
const password = z.string().min(6, "La contraseña debe tener al menos 6 caracteres.").max(72);
const email = z.union([z.literal(""), z.email("Ese correo no parece válido.")]).optional();
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
  const [tx, live] = await Promise.all([recentTx(u.id), activeSessionsOf(u.id)]);
  return {
    ...publicUser(u),
    email: u.email,
    hasCard: u.hasCard,
    hasPassword: Boolean(u.passwordHash),
    cardQr: `${QR_PREFIX}${u.cardToken}`,
    balanceCents: u.balanceCents,
    visitsCount: u.visitsCount,
    level: levelFor(config, u.visitsCount),
    loyalty: { every: config.loyaltyEvery, bonusCents: config.loyaltyBonusCents },
    rates: config.rates,
    graceMinutes: config.graceMinutes,
    cardPriceCents: config.cardPriceCents,
    createdAt: u.createdAt,
    sessions: live,
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

  register: publicProcedure.input(z.object({ name, phone, password, email })).mutation(async ({ ctx, input }) => {
    rateLimit(`register:${ctx.req.ip}`, 6);
    const userId = await createUser({
      name: input.name,
      phone: input.phone,
      email: input.email?.toLowerCase(),
      passwordHash: await hashPassword(input.password),
    });
    await startLogin(ctx.res, userId);
    return { ok: true };
  }),

  login: publicProcedure.input(z.object({ identifier: z.string().trim().min(3).max(190), password: z.string().min(1).max(72) })).mutation(async ({ ctx, input }) => {
    const key = `login:${ctx.req.ip}:${input.identifier.toLowerCase()}`;
    rateLimit(key);
    const byEmail = input.identifier.includes("@");
    const [u] = await db
      .select()
      .from(users)
      .where(byEmail ? eq(users.email, input.identifier.toLowerCase()) : eq(users.phone, normalizePhone(input.identifier)));
    if (!u || !u.active || !u.passwordHash || !(await checkPassword(input.password, u.passwordHash))) {
      fail("UNAUTHORIZED", "Teléfono o contraseña incorrectos.");
    }
    clearRateLimit(key);
    await startLogin(ctx.res, u.id);
    return publicUser(u);
  }),

  // Clientes registrados en caja: crean su contraseña con el código de su tarjeta y su teléfono.
  claim: publicProcedure.input(z.object({ memberCode: z.string().trim().toUpperCase().min(6).max(16), phone, password })).mutation(async ({ ctx, input }) => {
    rateLimit(`claim:${ctx.req.ip}`, 6);
    const code = input.memberCode.startsWith("PNT-") ? input.memberCode : `PNT-${input.memberCode}`;
    const [u] = await db.select().from(users).where(and(eq(users.memberCode, code), eq(users.phone, input.phone)));
    if (!u || !u.active) fail("NOT_FOUND", "El código y el teléfono no coinciden con ninguna tarjeta.");
    if (u.passwordHash) fail("CONFLICT", "Esa tarjeta ya tiene cuenta. Inicia sesión con tu teléfono y contraseña.");
    await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, u.id));
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
  config: staffProcedure.query(() => getConfig()),

  find: staffProcedure.input(z.object({ q: z.string().trim().max(120) })).query(async ({ input }) => {
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

  member: staffProcedure.input(z.object({ id })).query(async ({ input }) => memberDetail(await getMember(input.id))),

  createMember: staffProcedure.input(z.object({ name, phone, email })).mutation(async ({ ctx, input }) => {
    const userId = await createUser({ name: input.name, phone: input.phone, email: input.email?.toLowerCase(), createdBy: ctx.user.id });
    return { id: userId };
  }),

  topup: staffProcedure
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

  sellCard: staffProcedure.input(z.object({ userId: id, method })).mutation(async ({ ctx, input }) => {
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

  checkin: staffProcedure.input(z.object({ userId: id })).mutation(async ({ input }) => {
    const config = await getConfig();
    const isNew = await userTx(input.userId, (tx) => recordVisit(tx, input.userId, "checkin", config));
    return { isNew };
  }),

  board: staffProcedure.query(() => stationsBoard()),

  start: staffProcedure
    .input(z.object({ userId: id, stationId: id, minutes: staffMinutes }))
    .mutation(({ ctx, input }) => startSession({ ...input, staffId: ctx.user.id })),

  extend: staffProcedure
    .input(z.object({ sessionId: id, minutes: staffMinutes }))
    .mutation(({ ctx, input }) => extendSession({ ...input, staffId: ctx.user.id })),

  end: staffProcedure
    .input(z.object({ sessionId: id }))
    .mutation(({ ctx, input }) => endSession({ sessionId: input.sessionId, staffId: ctx.user.id, reason: "caja" })),

  // Cierre del día: lo que entró a caja por método y la actividad de la jornada.
  day: staffProcedure.input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })).query(async ({ input }) => {
    const day = input.day ?? caracasDate();
    const [from, to] = caracasDayBounds(day);
    const inDay = and(gte(walletTx.createdAt, from), lt(walletTx.createdAt, to));
    const [byMethod, moves, [sessionCount], [visitCount], [newMembers]] = await Promise.all([
      db
        .select({ method: walletTx.method, total: sql<string>`sum(${walletTx.paidCents})`, n: count() })
        .from(walletTx)
        .where(and(inDay, ne(walletTx.paidCents, 0)))
        .groupBy(walletTx.method),
      db.select().from(walletTx).where(inDay).orderBy(desc(walletTx.id)).limit(200),
      db.select({ n: count() }).from(sessions).where(and(gte(sessions.startedAt, from), lt(sessions.startedAt, to))),
      db.select({ n: count() }).from(visits).where(eq(visits.visitDate, day)),
      db.select({ n: count() }).from(users).where(and(eq(users.role, "member"), gte(users.createdAt, from), lt(users.createdAt, to))),
    ]);
    const people = await namesOf([...new Set(moves.flatMap((m) => [m.userId, m.staffId ?? 0]))].filter(Boolean));
    const sum = (type: string) => moves.filter((m) => m.type === type).reduce((a, m) => a + m.amountCents, 0);
    return {
      day,
      byMethod: byMethod.map((r) => ({ method: r.method, totalCents: Number(r.total), count: r.n })),
      cashInCents: byMethod.reduce((a, r) => a + Number(r.total), 0),
      playedCents: -(sum("session") + sum("refund")),
      cardsSold: moves.filter((m) => m.type === "card_sale").length,
      sessions: sessionCount.n,
      visits: visitCount.n,
      newMembers: newMembers.n,
      moves: moves.map((m) => ({
        id: m.id,
        type: m.type,
        amountCents: m.amountCents,
        paidCents: m.paidCents,
        method: m.method,
        note: m.note,
        createdAt: m.createdAt,
        member: people.get(m.userId) ?? "",
        staff: m.staffId ? (people.get(m.staffId) ?? "") : "",
      })),
    };
  }),
});

// ---------- Administración ----------
const configInput = z.object({
  rates: z.object({ pc: cents.min(0), ps5: cents.min(0), switch: cents.min(0), sim: cents.min(0) }),
  cardPriceCents: cents.min(0),
  graceMinutes: z.number().int().min(0).max(30),
  refundOnEarlyEnd: z.boolean(),
  loyaltyEvery: z.number().int().min(1).max(100),
  loyaltyBonusCents: cents.min(0),
  levels: z.array(z.object({ name: z.string().trim().min(1).max(30), min: z.number().int().min(0) })).min(1).max(8),
});

const adminRouter = router({
  saveConfig: adminProcedure.input(configInput).mutation(async ({ input }) => {
    await saveConfig(input);
    return { ok: true };
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

  stationUnlock: adminProcedure.input(z.object({ id, minutes: z.number().int().min(0).max(240) })).mutation(async ({ input }) => {
    await db.update(stations).set({ unlockUntil: input.minutes ? now() + input.minutes * MINUTE : null }).where(eq(stations.id, input.id));
    return { ok: true };
  }),

  staffList: adminProcedure.query(async () => {
    const rows = await db.select().from(users).where(ne(users.role, "member")).orderBy(users.name);
    return rows.map((u) => ({ ...publicUser(u), active: u.active }));
  }),

  staffCreate: adminProcedure.input(z.object({ name, phone, password, role: z.enum(["cashier", "admin"]) })).mutation(async ({ ctx, input }) => {
    const userId = await createUser({
      name: input.name,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      createdBy: ctx.user.id,
    });
    return { id: userId };
  }),

  userSetActive: adminProcedure.input(z.object({ id, active: z.boolean() })).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) fail("BAD_REQUEST", "No puedes desactivar tu propia cuenta.");
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
});

export const appRouter = router({
  auth: authRouter,
  member: memberRouter,
  staff: staffRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
