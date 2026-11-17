import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db, type Tx } from "./db";
import { PAY_METHODS, STATION_KINDS, TX_TYPES, orderItems, orders, products, sessions, settings, stations, users, visits, walletTx } from "./db/schema";
import { hours as defaultHours } from "../src/content";
import { closingAt, closingProblem, sellableMinutes, type WeekHours } from "./closing";
import { MINUTE, caracasDate, fail, newCardToken, newMemberCode, newPairCode, now } from "./lib";

export type StationKind = (typeof STATION_KINDS)[number];
export type PayMethod = (typeof PAY_METHODS)[number];
export type TxType = (typeof TX_TYPES)[number];

type DbError = { errno?: number; code?: string; cause?: DbError };
const errnoOf = (error: unknown): number | undefined => (error as DbError)?.errno ?? (error as DbError)?.cause?.errno;
const isDuplicate = (error: unknown) => errnoOf(error) === 1062 || /duplicate/i.test(String((error as DbError)?.cause ?? error));

/** Transacción con reintento cuando la base reporta un bloqueo cruzado (1213) o espera agotada (1205). */
export async function withTx<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(run);
    } catch (error) {
      const errno = errnoOf(error);
      if ((errno !== 1213 && errno !== 1205) || attempt >= 4) throw error;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
    }
  }
}

// Candado en memoria por clave (cliente o estación): las operaciones sobre el mismo saldo o la
// misma máquina se ejecutan una tras otra dentro de este proceso. Se suma a los bloqueos de fila
// de MySQL, que son los que protegen si algún día corren varias instancias del servidor.
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(run, run);
  const tail = result.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return result;
}
/** Transacción sobre el saldo o las visitas de un cliente. */
export const userTx = <T>(userId: number, run: (tx: Tx) => Promise<T>) => withLock(`u:${userId}`, () => withTx(run));

// ---------- Configuración ----------
export type Config = {
  /** Tarifa por hora de cada tipo de estación, en centavos de REF. 0 = sin configurar. */
  rates: Record<StationKind, number>;
  cardPriceCents: number;
  /** Minutos extra al llegar a cero, para guardar la partida. */
  graceMinutes: number;
  /** Devolver al saldo el tiempo no usado cuando una sesión se termina antes. */
  refundOnEarlyEnd: boolean;
  /** Cada N visitas se acredita un bono. Con bono en 0 queda apagado. */
  loyaltyEvery: number;
  loyaltyBonusCents: number;
  levels: { name: string; min: number }[];
  /** Horario por día de la semana (0 = domingo), en minutos desde la medianoche. */
  hours: WeekHours;
  /** Cierre extendido para una noche especial (ms UTC), o null. */
  extendedUntil: number | null;
};

export const DEFAULT_CONFIG: Config = {
  rates: { pc: 0, ps5: 0, switch: 0, sim: 0 },
  cardPriceCents: 0,
  graceMinutes: 5,
  refundOnEarlyEnd: true,
  loyaltyEvery: 10,
  loyaltyBonusCents: 0,
  levels: [
    { name: "Cachorro", min: 0 },
    { name: "Cazador", min: 5 },
    { name: "Pantera", min: 15 },
    { name: "Alfa", min: 30 },
  ],
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => [...defaultHours[day]] as [number, number]),
  extendedUntil: null,
};

/** Lo que la interfaz necesita para ofrecer solo los tiempos que caben antes del cierre. */
export function closingInfo(config: Config) {
  const t = now();
  return { closesAt: closingAt(config, t), maxMinutes: sellableMinutes(config, t) };
}

export async function getConfig(): Promise<Config> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "config"));
  if (!row) return DEFAULT_CONFIG;
  const saved = JSON.parse(row.value) as Partial<Config>;
  return { ...DEFAULT_CONFIG, ...saved, rates: { ...DEFAULT_CONFIG.rates, ...saved.rates } };
}

export async function saveConfig(config: Config) {
  const value = JSON.stringify(config);
  await db.insert(settings).values({ key: "config", value }).onDuplicateKeyUpdate({ set: { value } });
}

export function levelFor(config: Config, visitsCount: number) {
  const sorted = [...config.levels].sort((a, b) => a.min - b.min);
  let index = 0;
  sorted.forEach((level, i) => {
    if (visitsCount >= level.min) index = i;
  });
  return { current: sorted[index], next: sorted[index + 1] ?? null };
}

// ---------- Clientes ----------
export async function createUser(values: {
  name: string;
  phone: string | null;
  email?: string | null;
  passwordHash?: string | null;
  role?: "member" | "cashier" | "admin";
  createdBy?: number | null;
}) {
  if (values.phone) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.phone, values.phone));
    if (taken) fail("CONFLICT", "Ese teléfono ya está registrado.");
  }
  if (values.email) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, values.email));
    if (taken) fail("CONFLICT", "Ese correo ya está registrado.");
  }
  // El código y el token del QR son únicos por cliente y se generan aquí, al registrarlo.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [result] = await db.insert(users).values({
        ...values,
        email: values.email || null,
        memberCode: newMemberCode(),
        cardToken: newCardToken(),
        createdAt: now(),
      });
      return result.insertId;
    } catch (error) {
      // Choque de código o token (muy raro), o dos registros simultáneos del mismo teléfono.
      if (!isDuplicate(error)) throw error;
      if (values.phone) {
        const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.phone, values.phone));
        if (taken) fail("CONFLICT", "Ese teléfono ya está registrado.");
      }
    }
  }
  return fail("INTERNAL_SERVER_ERROR", "No se pudo generar el código de la tarjeta. Intenta otra vez.");
}

// ---------- Libro contable ----------
export async function ledger(
  tx: Tx,
  entry: {
    userId: number;
    type: TxType;
    amountCents: number;
    paidCents?: number;
    method?: PayMethod | null;
    reference?: string | null;
    note?: string | null;
    sessionId?: number | null;
    orderId?: number | null;
    staffId?: number | null;
  },
): Promise<number> {
  // Un solo UPDATE suma y valida a la vez: la fila queda bloqueada hasta el final de la
  // transacción, así dos movimientos simultáneos del mismo cliente nunca se pisan.
  const amount = entry.amountCents;
  const [updated] = await tx
    .update(users)
    .set({ balanceCents: sql`${users.balanceCents} + ${amount}` })
    .where(and(eq(users.id, entry.userId), sql`${users.balanceCents} + ${amount} >= 0`));
  const [user] = await tx.select({ balance: users.balanceCents }).from(users).where(eq(users.id, entry.userId));
  if (!user) fail("NOT_FOUND", "No encontramos a ese cliente.");
  if (updated.affectedRows === 0) fail("BAD_REQUEST", "Saldo insuficiente. Recarga en caja y vuelve a intentar.");
  const after = user.balance;
  await tx.insert(walletTx).values({
    userId: entry.userId,
    type: entry.type,
    amountCents: entry.amountCents,
    balanceAfterCents: after,
    paidCents: entry.paidCents ?? 0,
    method: entry.method ?? null,
    reference: entry.reference || null,
    note: entry.note || null,
    sessionId: entry.sessionId ?? null,
    orderId: entry.orderId ?? null,
    staffId: entry.staffId ?? null,
    createdAt: now(),
  });
  return after;
}

// ---------- Visitas y fidelidad ----------
/** Registra la visita de hoy si no existía. Devuelve true cuando es una visita nueva. */
export async function recordVisit(tx: Tx, userId: number, source: "session" | "checkin", config: Config): Promise<boolean> {
  const day = caracasDate();
  // El índice único (cliente, día) decide: si la fila ya existía, no es una visita nueva.
  const [inserted] = await tx.insert(visits).ignore().values({ userId, visitDate: day, source, createdAt: now() });
  if (inserted.affectedRows === 0) return false;
  await tx.update(users).set({ visitsCount: sql`${users.visitsCount} + 1` }).where(eq(users.id, userId));
  const [user] = await tx.select({ visits: users.visitsCount }).from(users).where(eq(users.id, userId));
  if (!user) fail("NOT_FOUND", "No encontramos a ese cliente.");
  const total = user.visits;
  if (config.loyaltyBonusCents > 0 && config.loyaltyEvery > 0 && total % config.loyaltyEvery === 0) {
    await ledger(tx, {
      userId,
      type: "bonus",
      amountCents: config.loyaltyBonusCents,
      note: `Bono de fidelidad: visita ${total}`,
    });
  }
  return true;
}

// ---------- Sesiones ----------
const AGENT_ONLINE_MS = 25_000;
const PAIR_CODE_TTL = 3 * MINUTE;

export const isOnline = (lastSeenAt: number | null) => lastSeenAt !== null && now() - lastSeenAt < AGENT_ONLINE_MS;

/** Cierra en la base las sesiones cuyo tiempo de gracia ya pasó. */
export async function finalizeExpired() {
  const t = now();
  await db
    .update(sessions)
    .set({ status: "ended", endedAt: sql`${sessions.graceEndsAt}`, endReason: "tiempo" })
    .where(and(eq(sessions.status, "active"), lte(sessions.graceEndsAt, t)));
}

const liveSession = (t: number) => and(eq(sessions.status, "active"), gt(sessions.graceEndsAt, t));

export function costFor(ratePerHourCents: number, minutes: number) {
  return Math.round((ratePerHourCents * minutes) / 60);
}

export async function startSession(input: {
  userId: number;
  stationId: number;
  minutes: number;
  staffId: number | null;
  /** Código que muestra la pantalla de bloqueo. Obligatorio cuando el cliente activa desde su perfil. */
  pairCode?: string;
}) {
  await finalizeExpired();
  const config = await getConfig();
  return withLock(`s:${input.stationId}`, () => userTx(input.userId, async (tx) => {
    const t = now();
    const [station] = await tx.select().from(stations).where(eq(stations.id, input.stationId)).for("update");
    if (!station || !station.enabled) fail("BAD_REQUEST", "Esa estación no está disponible.");

    if (input.staffId === null) {
      if (station.kind !== "pc") fail("BAD_REQUEST", "Esta estación se activa en caja.");
      if (!isOnline(station.lastSeenAt)) fail("BAD_REQUEST", "Esa PC está apagada o sin conexión. Elige otra o avisa en caja.");
      const fresh = station.pairCodeAt !== null && t - station.pairCodeAt < PAIR_CODE_TTL + 30_000;
      if (!input.pairCode || !fresh || input.pairCode !== station.pairCode) {
        fail("BAD_REQUEST", "El código no coincide con el que muestra la pantalla de esa PC. Revísalo y vuelve a intentar.");
      }
      const [mine] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, input.userId), liveSession(t)));
      if (mine) fail("CONFLICT", "Ya tienes una sesión activa. Agrega tiempo a esa o termínala primero.");
    }

    const [busy] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.stationId, station.id), liveSession(t)));
    if (busy) fail("CONFLICT", "Esa estación ya está ocupada.");

    const rate = config.rates[station.kind];
    if (!rate) fail("BAD_REQUEST", "Esa estación todavía no tiene tarifa. Configúrala en el panel de administración.");
    // No se vende tiempo que pase de la hora de cierre.
    const tooLong = closingProblem(config, t, input.minutes, input.staffId === null ? 30 : 15);
    if (tooLong) fail("BAD_REQUEST", tooLong);
    const cost = costFor(rate, input.minutes);
    const endsAt = t + input.minutes * MINUTE;

    const [created] = await tx.insert(sessions).values({
      userId: input.userId,
      stationId: station.id,
      startedAt: t,
      endsAt,
      graceEndsAt: endsAt + config.graceMinutes * MINUTE,
      minutesPaid: input.minutes,
      costCents: cost,
      startedBy: input.staffId,
    });
    await ledger(tx, {
      userId: input.userId,
      type: "session",
      amountCents: -cost,
      sessionId: created.insertId,
      staffId: input.staffId,
      note: `${stationLabel(station)}: ${input.minutes} min`,
    });
    await recordVisit(tx, input.userId, "session", config);
    // El código usado ya no sirve: la próxima activación necesita uno nuevo.
    await tx.update(stations).set({ pairCode: newPairCode(), pairCodeAt: t }).where(eq(stations.id, station.id));
    return { sessionId: created.insertId, endsAt, costCents: cost };
  }));
}

async function sessionOwner(sessionId: number): Promise<number> {
  const [row] = await db.select({ userId: sessions.userId }).from(sessions).where(eq(sessions.id, sessionId));
  if (!row) fail("NOT_FOUND", "No encontramos esa sesión.");
  return row.userId;
}

export async function extendSession(input: { sessionId: number; minutes: number; staffId: number | null; userId?: number }) {
  await finalizeExpired();
  const config = await getConfig();
  return userTx(await sessionOwner(input.sessionId), async (tx) => {
    const t = now();
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, input.sessionId), liveSession(t))).for("update");
    if (!session || (input.userId !== undefined && session.userId !== input.userId)) {
      fail("NOT_FOUND", "Esa sesión ya terminó. Activa una nueva.");
    }
    const [station] = await tx.select().from(stations).where(eq(stations.id, session.stationId));
    const cost = costFor(config.rates[station.kind], input.minutes);
    if (!cost) fail("BAD_REQUEST", "Esa estación no tiene tarifa configurada.");
    // El tiempo extra se cuenta desde el final de la sesión: tampoco puede pasar del cierre.
    const tooLong = closingProblem(config, t, input.minutes, input.staffId === null ? 30 : 15, Math.max(t, session.endsAt));
    if (tooLong) fail("BAD_REQUEST", tooLong);
    // El tiempo se suma al final de la sesión: lo jugado durante la gracia cuenta como usado.
    const endsAt = session.endsAt + input.minutes * MINUTE;
    await tx
      .update(sessions)
      .set({
        endsAt,
        graceEndsAt: endsAt + config.graceMinutes * MINUTE,
        minutesPaid: session.minutesPaid + input.minutes,
        costCents: session.costCents + cost,
      })
      .where(eq(sessions.id, session.id));
    await ledger(tx, {
      userId: session.userId,
      type: "session",
      amountCents: -cost,
      sessionId: session.id,
      staffId: input.staffId,
      note: `${stationLabel(station)}: +${input.minutes} min`,
    });
    return { endsAt, costCents: cost };
  });
}

export async function endSession(input: { sessionId: number; staffId: number | null; userId?: number; reason: string }) {
  await finalizeExpired();
  const config = await getConfig();
  return userTx(await sessionOwner(input.sessionId), async (tx) => {
    const t = now();
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, input.sessionId), eq(sessions.status, "active"))).for("update");
    if (!session || (input.userId !== undefined && session.userId !== input.userId)) {
      fail("NOT_FOUND", "Esa sesión ya había terminado.");
    }
    const unusedMinutes = Math.max(0, Math.floor((session.endsAt - t) / MINUTE));
    const refund = config.refundOnEarlyEnd ? Math.floor((session.costCents * unusedMinutes) / session.minutesPaid) : 0;
    await tx
      .update(sessions)
      .set({ status: "ended", endedAt: t, endReason: input.reason, refundCents: refund })
      .where(eq(sessions.id, session.id));
    if (refund > 0) {
      await ledger(tx, {
        userId: session.userId,
        type: "refund",
        amountCents: refund,
        sessionId: session.id,
        staffId: input.staffId,
        note: `Devolución de ${unusedMinutes} min sin usar`,
      });
    }
    return { refundCents: refund, unusedMinutes };
  });
}

// ---------- Compras del menú con el saldo ----------
export async function createOrder(input: { userId: number; staffId: number; items: { productId: number; qty: number }[] }) {
  const config = await getConfig();
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const found = await db.select().from(products).where(inArray(products.id, ids));
  const byId = new Map(found.map((p) => [p.id, p]));
  // Mismo producto repetido en el pedido: se suma en un solo renglón.
  const quantities = new Map<number, number>();
  for (const item of input.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty);
  const lines = [...quantities].map(([productId, qty]) => {
    const product = byId.get(productId);
    if (!product || !product.active) fail("BAD_REQUEST", "Uno de los productos ya no está en el menú. Actualiza la página y arma el pedido de nuevo.");
    return { productId, name: product.name, unitCents: product.priceCents, qty };
  });
  const total = lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  if (total <= 0) fail("BAD_REQUEST", "El pedido está vacío.");
  const summary = lines.map((l) => (l.qty > 1 ? `${l.qty} x ${l.name}` : l.name)).join(", ");

  return userTx(input.userId, async (tx) => {
    const [created] = await tx.insert(orders).values({ userId: input.userId, staffId: input.staffId, totalCents: total, createdAt: now() });
    const orderId = created.insertId;
    await tx.insert(orderItems).values(lines.map((line) => ({ ...line, orderId })));
    // Si el saldo no alcanza, ledger() falla y la transacción entera se deshace: no queda orden ni cobro.
    const balanceCents = await ledger(tx, {
      userId: input.userId,
      type: "purchase",
      amountCents: -total,
      orderId,
      staffId: input.staffId,
      note: `Orden #${orderId}: ${summary}`.slice(0, 200),
    });
    // Comprar en el mostrador también cuenta como la visita del día.
    const firstVisitToday = await recordVisit(tx, input.userId, "checkin", config);
    if (!firstVisitToday) return { orderId, totalCents: total, balanceCents };
    // La visita pudo acreditar un bono de fidelidad: se devuelve el saldo ya con el bono.
    const [user] = await tx.select({ balance: users.balanceCents }).from(users).where(eq(users.id, input.userId));
    return { orderId, totalCents: total, balanceCents: user.balance };
  });
}

export async function refundOrder(input: { orderId: number; staffId: number }) {
  const [order] = await db.select().from(orders).where(eq(orders.id, input.orderId));
  if (!order) fail("NOT_FOUND", "No encontramos esa orden.");
  return userTx(order.userId, async (tx) => {
    const [fresh] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if (!fresh || fresh.status !== "paid") fail("CONFLICT", "Esa orden ya estaba anulada.");
    await tx.update(orders).set({ status: "refunded", refundedAt: now(), refundedBy: input.staffId }).where(eq(orders.id, order.id));
    const balanceCents = await ledger(tx, {
      userId: order.userId,
      type: "refund",
      amountCents: order.totalCents,
      orderId: order.id,
      staffId: input.staffId,
      note: `Anulación de la orden #${order.id}`,
    });
    return { balanceCents };
  });
}

/** Últimas órdenes con sus renglones: de un cliente, o de todos si no se indica. */
export async function recentOrders(filter: { userId?: number; from?: number; to?: number }, limit = 10) {
  const conditions = [
    filter.userId ? eq(orders.userId, filter.userId) : undefined,
    filter.from ? gt(orders.createdAt, filter.from - 1) : undefined,
    filter.to ? lte(orders.createdAt, filter.to - 1) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(orders)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(orders.id))
    .limit(limit);
  if (!rows.length) return [];
  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id)));
  return rows.map((order) => ({
    id: order.id,
    userId: order.userId,
    totalCents: order.totalCents,
    status: order.status,
    createdAt: order.createdAt,
    items: items.filter((i) => i.orderId === order.id).map((i) => ({ name: i.name, qty: i.qty, unitCents: i.unitCents })),
  }));
}

export const activeMenu = () => db.select().from(products).where(eq(products.active, true)).orderBy(products.category, products.name);

// ---------- Estaciones ----------
const KIND_LABEL: Record<StationKind, string> = { pc: "PC", ps5: "PS5", switch: "Switch", sim: "Simulador" };
export const stationLabel = (s: { kind: StationKind; number: number }) => `${KIND_LABEL[s.kind]} ${String(s.number).padStart(2, "0")}`;

export type StationState = "libre" | "ocupada" | "gracia" | "sin_conexion" | "deshabilitada" | "mantenimiento";

export async function stationsBoard() {
  await finalizeExpired();
  const t = now();
  const rows = await db.select().from(stations).orderBy(stations.kind, stations.number);
  const live = await db
    .select({
      id: sessions.id,
      stationId: sessions.stationId,
      userId: sessions.userId,
      endsAt: sessions.endsAt,
      graceEndsAt: sessions.graceEndsAt,
      startedAt: sessions.startedAt,
      memberName: users.name,
      memberCode: users.memberCode,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(liveSession(t));
  const byStation = new Map(live.map((s) => [s.stationId, s]));
  return rows.map((s) => {
    const session = byStation.get(s.id) ?? null;
    const online = s.kind !== "pc" || isOnline(s.lastSeenAt);
    let state: StationState = "libre";
    if (!s.enabled) state = "deshabilitada";
    else if (session) state = t < session.endsAt ? "ocupada" : "gracia";
    else if (s.unlockUntil && s.unlockUntil > t) state = "mantenimiento";
    else if (!online) state = "sin_conexion";
    return {
      id: s.id,
      kind: s.kind,
      number: s.number,
      label: stationLabel(s),
      enabled: s.enabled,
      note: s.note,
      state,
      online,
      hasAgent: s.kind === "pc" && Boolean(s.deviceTokenHash),
      agentVersion: s.agentVersion,
      unlockUntil: s.unlockUntil,
      session,
    };
  });
}

export async function activeSessionsOf(userId: number) {
  await finalizeExpired();
  return db
    .select({
      id: sessions.id,
      stationId: sessions.stationId,
      kind: stations.kind,
      number: stations.number,
      startedAt: sessions.startedAt,
      endsAt: sessions.endsAt,
      graceEndsAt: sessions.graceEndsAt,
    })
    .from(sessions)
    .innerJoin(stations, eq(stations.id, sessions.stationId))
    .where(and(eq(sessions.userId, userId), liveSession(now())))
    .orderBy(desc(sessions.startedAt));
}

export async function recentTx(userId: number, limit = 30) {
  return db.select().from(walletTx).where(eq(walletTx.userId, userId)).orderBy(desc(walletTx.id)).limit(limit);
}

export async function namesOf(ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
