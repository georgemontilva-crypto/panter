// Oficina: cotizaciones de fiestas, facturas de compras, cierre del día y resumen en vivo.
// Todo lo de este archivo es para administradores y para el súper admin.
import { and, count, desc, eq, gte, inArray, isNotNull, like, lt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { orders, partyPackages, purchases, quoteItems, quotePayments, quotes, sessions, users, visits, walletTx, QUOTE_STATES } from "./db/schema";
import { MINUTE, caracasDate, caracasDayBounds, fail, now } from "./lib";
import { namesOf, stationsBoard, withLock, withTx, type PayMethod } from "./services";

// ---------- Cotizaciones ----------
export type QuoteState = (typeof QUOTE_STATES)[number];
export const quoteCode = (id: number) => `COT-${String(id).padStart(4, "0")}`;
export const receiptCode = (n: number) => `R-${String(n).padStart(4, "0")}`;

// De cada estado, a cuáles se puede pasar. Los pasos hacia atrás existen para corregir un toque equivocado.
const NEXT: Record<QuoteState, QuoteState[]> = {
  draft: ["sent", "approved", "cancelled"],
  sent: ["approved", "draft", "cancelled"],
  approved: ["scheduled", "sent", "cancelled"],
  scheduled: ["done", "approved", "cancelled"],
  done: ["scheduled"],
  cancelled: ["draft"],
};

export type QuoteInput = {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  occasion?: string;
  eventAt: number | null;
  durationMinutes: number;
  guests: number;
  notes?: string;
  items: { description: string; qty: number; unitCents: number }[];
};

const totalOf = (items: QuoteInput["items"]) => items.reduce((sum, item) => sum + item.qty * item.unitCents, 0);
const blank = (value?: string) => value?.trim() || null;
const quoteValues = (input: QuoteInput) => ({
  customerName: input.customerName,
  customerPhone: blank(input.customerPhone),
  customerEmail: blank(input.customerEmail),
  occasion: blank(input.occasion),
  eventAt: input.eventAt,
  durationMinutes: input.durationMinutes,
  guests: input.guests,
  notes: blank(input.notes),
});

async function loadQuote(quoteId: number) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!quote) fail("NOT_FOUND", "No encontramos esa cotización.");
  return quote;
}

export async function createQuote(input: QuoteInput, staffId: number) {
  const total = totalOf(input.items);
  if (total < 0) fail("BAD_REQUEST", "El total no puede quedar negativo. Revisa el descuento.");
  return withTx(async (tx) => {
    const [created] = await tx.insert(quotes).values({ ...quoteValues(input), totalCents: total, createdBy: staffId, createdAt: now(), updatedAt: now() });
    await tx.insert(quoteItems).values(input.items.map((item, sort) => ({ ...item, quoteId: created.insertId, sort })));
    return { id: created.insertId };
  });
}

export function updateQuote(quoteId: number, input: QuoteInput) {
  return withLock(`q:${quoteId}`, async () => {
    const quote = await loadQuote(quoteId);
    if (quote.status === "cancelled") fail("CONFLICT", "Esta cotización está cancelada. Reábrela para poder cambiarla.");
    if (quote.status === "done") fail("CONFLICT", "Esta fiesta ya se realizó: la cotización quedó cerrada.");
    const total = totalOf(input.items);
    if (total < 0) fail("BAD_REQUEST", "El total no puede quedar negativo. Revisa el descuento.");
    if (total < quote.paidCents) fail("CONFLICT", "El total no puede quedar por debajo de lo que el cliente ya pagó.");
    if (quote.status === "scheduled" && !input.eventAt) fail("BAD_REQUEST", "Una fiesta agendada necesita fecha y hora.");
    await withTx(async (tx) => {
      await tx.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
      await tx.insert(quoteItems).values(input.items.map((item, sort) => ({ ...item, quoteId, sort })));
      await tx.update(quotes).set({ ...quoteValues(input), totalCents: total, updatedAt: now() }).where(eq(quotes.id, quoteId));
      await settle(tx, quoteId);
    });
    return { id: quoteId };
  });
}

type TxLike = Parameters<Parameters<typeof withTx>[0]>[0];
/** Recalcula lo pagado. Si quedó pagada completa, le asigna su número de recibo (una sola vez). */
async function settle(tx: TxLike, quoteId: number) {
  const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
  const [sum] = await tx.select({ total: sql<string>`coalesce(sum(${quotePayments.amountCents}), 0)` }).from(quotePayments).where(eq(quotePayments.quoteId, quoteId));
  const paid = Number(sum.total);
  const full = quote.totalCents > 0 && paid >= quote.totalCents;
  let receiptNumber = quote.receiptNumber;
  if (full && receiptNumber === null) {
    const [last] = await tx.select({ n: sql<string>`coalesce(max(${quotes.receiptNumber}), 0)` }).from(quotes);
    receiptNumber = Number(last.n) + 1;
  }
  await tx
    .update(quotes)
    .set({ paidCents: paid, receiptNumber, paidAt: full ? (quote.paidAt ?? now()) : null, updatedAt: now() })
    .where(eq(quotes.id, quoteId));
}

export function setQuoteStatus(quoteId: number, to: QuoteState) {
  return withLock(`q:${quoteId}`, async () => {
    const quote = await loadQuote(quoteId);
    if (quote.status === to) return { ok: true };
    if (!NEXT[quote.status].includes(to)) fail("CONFLICT", "Ese cambio de estado no es posible desde donde está la cotización. Actualiza la página.");
    if (to === "scheduled" && !quote.eventAt) fail("BAD_REQUEST", "Para agendar la fiesta, primero ponle fecha y hora a la cotización.");
    await db.update(quotes).set({ status: to, updatedAt: now() }).where(eq(quotes.id, quoteId));
    return { ok: true };
  });
}

export function addQuotePayment(input: { quoteId: number; amountCents: number; method: PayMethod; reference?: string; staffId: number }) {
  return withLock(`q:${input.quoteId}`, async () => {
    const quote = await loadQuote(input.quoteId);
    if (!["approved", "scheduled", "done"].includes(quote.status)) fail("CONFLICT", "Primero marca la cotización como aprobada: así no se cobra algo que el cliente no ha confirmado.");
    const pending = quote.totalCents - quote.paidCents;
    if (pending <= 0) fail("CONFLICT", "Esta cotización ya está pagada completa.");
    if (input.amountCents > pending) fail("BAD_REQUEST", "El pago es mayor que lo que falta por pagar.");
    await withTx(async (tx) => {
      await tx.insert(quotePayments).values({ quoteId: input.quoteId, amountCents: input.amountCents, method: input.method, reference: blank(input.reference), staffId: input.staffId, createdAt: now() });
      await settle(tx, input.quoteId);
    });
    return { ok: true };
  });
}

export async function removeQuotePayment(paymentId: number) {
  const [payment] = await db.select().from(quotePayments).where(eq(quotePayments.id, paymentId));
  if (!payment) fail("NOT_FOUND", "Ese pago ya no existe.");
  return withLock(`q:${payment.quoteId}`, async () => {
    await withTx(async (tx) => {
      await tx.delete(quotePayments).where(eq(quotePayments.id, paymentId));
      await settle(tx, payment.quoteId);
    });
    return { ok: true };
  });
}

type QuoteRow = typeof quotes.$inferSelect;
const summary = (quote: QuoteRow) => ({
  id: quote.id,
  code: quoteCode(quote.id),
  customerName: quote.customerName,
  customerPhone: quote.customerPhone,
  occasion: quote.occasion,
  eventAt: quote.eventAt,
  durationMinutes: quote.durationMinutes,
  guests: quote.guests,
  status: quote.status,
  totalCents: quote.totalCents,
  paidCents: quote.paidCents,
  receipt: quote.paidAt && quote.receiptNumber ? receiptCode(quote.receiptNumber) : null,
  paidAt: quote.paidAt,
  createdAt: quote.createdAt,
});

export async function listQuotes() {
  const rows = await db.select().from(quotes).orderBy(desc(quotes.id)).limit(300);
  return rows.map(summary);
}

export async function getQuote(quoteId: number) {
  const quote = await loadQuote(quoteId);
  const [items, payments] = await Promise.all([
    db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId)).orderBy(quoteItems.sort),
    db.select().from(quotePayments).where(eq(quotePayments.quoteId, quoteId)).orderBy(quotePayments.id),
  ]);
  const people = await namesOf([...new Set([quote.createdBy, ...payments.map((p) => p.staffId)])]);
  // Otra fiesta agendada que se cruza con esta en el horario: se avisa, no se bloquea.
  let clash: { code: string; customerName: string; eventAt: number }[] = [];
  if (quote.eventAt && quote.status !== "cancelled") {
    const end = quote.eventAt + quote.durationMinutes * MINUTE;
    const others = await db.select().from(quotes).where(and(eq(quotes.status, "scheduled"), ne(quotes.id, quoteId), isNotNull(quotes.eventAt)));
    clash = others
      .filter((o) => o.eventAt! < end && o.eventAt! + o.durationMinutes * MINUTE > quote.eventAt!)
      .map((o) => ({ code: quoteCode(o.id), customerName: o.customerName, eventAt: o.eventAt! }));
  }
  return {
    ...summary(quote),
    customerEmail: quote.customerEmail,
    notes: quote.notes,
    next: NEXT[quote.status],
    createdByName: people.get(quote.createdBy) ?? "",
    items: items.map((i) => ({ description: i.description, qty: i.qty, unitCents: i.unitCents })),
    payments: payments.map((p) => ({ id: p.id, amountCents: p.amountCents, method: p.method, reference: p.reference, createdAt: p.createdAt, staff: people.get(p.staffId) ?? "" })),
    clash,
  };
}

// ---------- Facturas de compras ----------
export const PURCHASE_CATEGORIES = ["Comida y bebidas", "Equipos y repuestos", "Servicios", "Alquiler", "Nómina", "Mantenimiento", "Publicidad", "Otros"] as const;

export type PurchaseInput = {
  id?: number;
  supplier: string;
  invoiceNumber?: string;
  invoiceDate: string;
  category: string;
  description?: string;
  totalCents: number;
  paid: boolean;
  method?: PayMethod;
  reference?: string;
};

export async function savePurchase(input: PurchaseInput, staffId: number) {
  if (input.paid && !input.method) fail("BAD_REQUEST", "Indica con qué se pagó la factura.");
  const values = {
    supplier: input.supplier,
    invoiceNumber: blank(input.invoiceNumber),
    invoiceDate: input.invoiceDate,
    category: input.category,
    description: blank(input.description),
    totalCents: input.totalCents,
    method: input.paid ? input.method! : null,
    reference: input.paid ? blank(input.reference) : null,
  };
  if (input.id) {
    const [existing] = await db.select().from(purchases).where(eq(purchases.id, input.id));
    if (!existing) fail("NOT_FOUND", "Esa factura ya no existe.");
    await db.update(purchases).set({ ...values, paidAt: input.paid ? (existing.paidAt ?? now()) : null }).where(eq(purchases.id, input.id));
    return { id: input.id };
  }
  const [created] = await db.insert(purchases).values({ ...values, paidAt: input.paid ? now() : null, createdBy: staffId, createdAt: now() });
  return { id: created.insertId };
}

export async function listPurchases(month: string) {
  const rows = await db.select().from(purchases).where(like(purchases.invoiceDate, `${month}-%`)).orderBy(desc(purchases.invoiceDate), desc(purchases.id));
  const [owed] = await db.select({ total: sql<string>`coalesce(sum(${purchases.totalCents}), 0)`, n: count() }).from(purchases).where(sql`${purchases.paidAt} is null`);
  const total = rows.reduce((sum, r) => sum + r.totalCents, 0);
  const paid = rows.filter((r) => r.paidAt).reduce((sum, r) => sum + r.totalCents, 0);
  return {
    month,
    totalCents: total,
    paidCents: paid,
    pendingCents: total - paid,
    // Lo que se debe en total, de cualquier mes: es lo que hay que tener presente para pagar.
    owedAllCents: Number(owed.total),
    owedAllCount: owed.n,
    rows: rows.map((r) => ({
      id: r.id,
      supplier: r.supplier,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      category: r.category,
      description: r.description,
      totalCents: r.totalCents,
      paid: Boolean(r.paidAt),
      paidAt: r.paidAt,
      method: r.method,
      reference: r.reference,
    })),
  };
}

// ---------- Cierre del día ----------
export async function dayReport(day: string) {
  const [from, to] = caracasDayBounds(day);
  const inDay = and(gte(walletTx.createdAt, from), lt(walletTx.createdAt, to));
  const [byMethod, moves, partyPays, [sessionCount], [visitCount], [newMembers], [orderCount]] = await Promise.all([
    db
      .select({ method: walletTx.method, total: sql<string>`sum(${walletTx.paidCents})`, n: count() })
      .from(walletTx)
      .where(and(inDay, ne(walletTx.paidCents, 0)))
      .groupBy(walletTx.method),
    db.select().from(walletTx).where(inDay).orderBy(desc(walletTx.id)).limit(200),
    db
      .select({ id: quotePayments.id, quoteId: quotePayments.quoteId, amountCents: quotePayments.amountCents, method: quotePayments.method, createdAt: quotePayments.createdAt, staffId: quotePayments.staffId, customer: quotes.customerName })
      .from(quotePayments)
      .innerJoin(quotes, eq(quotes.id, quotePayments.quoteId))
      .where(and(gte(quotePayments.createdAt, from), lt(quotePayments.createdAt, to)))
      .orderBy(desc(quotePayments.id)),
    db.select({ n: count() }).from(sessions).where(and(gte(sessions.startedAt, from), lt(sessions.startedAt, to))),
    db.select({ n: count() }).from(visits).where(eq(visits.visitDate, day)),
    db.select({ n: count() }).from(users).where(and(eq(users.role, "member"), gte(users.createdAt, from), lt(users.createdAt, to))),
    db.select({ n: count() }).from(orders).where(and(eq(orders.status, "paid"), gte(orders.createdAt, from), lt(orders.createdAt, to))),
  ]);
  const people = await namesOf([...new Set([...moves.flatMap((m) => [m.userId, m.staffId ?? 0]), ...partyPays.map((p) => p.staffId)])].filter(Boolean));
  const sum = (type: string) => moves.filter((m) => m.type === type).reduce((a, m) => a + m.amountCents, 0);

  // El dinero que entró ese día, por forma de pago: recargas y tarjetas en caja, más los pagos de fiestas.
  const methods = new Map<string, { totalCents: number; count: number }>();
  const addMethod = (method: string | null, cents: number, n: number) => {
    const key = method ?? "otro";
    const entry = methods.get(key) ?? { totalCents: 0, count: 0 };
    methods.set(key, { totalCents: entry.totalCents + cents, count: entry.count + n });
  };
  for (const r of byMethod) addMethod(r.method, Number(r.total), r.n);
  for (const p of partyPays) addMethod(p.method, p.amountCents, 1);
  const partiesCents = partyPays.reduce((a, p) => a + p.amountCents, 0);
  const deskCents = byMethod.reduce((a, r) => a + Number(r.total), 0);

  return {
    day,
    byMethod: [...methods].map(([method, v]) => ({ method, ...v })),
    cashInCents: deskCents + partiesCents,
    deskCents,
    partiesCents,
    // Jugado: tiempo cobrado menos las devoluciones de tiempo (las de órdenes van con el menú).
    playedCents: -sum("session") - moves.filter((m) => m.type === "refund" && !m.orderId).reduce((a, m) => a + m.amountCents, 0),
    // Vendido del menú: compras menos las órdenes anuladas ese día.
    menuCents: -sum("purchase") - moves.filter((m) => m.type === "refund" && m.orderId).reduce((a, m) => a + m.amountCents, 0),
    cardsSold: moves.filter((m) => m.type === "card_sale").length,
    orders: orderCount.n,
    sessions: sessionCount.n,
    visits: visitCount.n,
    newMembers: newMembers.n,
    partyPayments: partyPays.map((p) => ({ id: p.id, code: quoteCode(p.quoteId), customer: p.customer, amountCents: p.amountCents, method: p.method, createdAt: p.createdAt, staff: people.get(p.staffId) ?? "" })),
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
}

// ---------- Resumen en vivo ----------
/** Lo que el dueño mira de un vistazo: máquinas en uso, ventas de hoy, cocina y fiestas. */
export async function liveSummary() {
  const today = caracasDate();
  const [board, report, kitchen, parties] = await Promise.all([
    stationsBoard(),
    dayReport(today),
    db.select({ status: orders.kitchenStatus, n: count() }).from(orders).where(and(eq(orders.status, "paid"), inArray(orders.kitchenStatus, ["pending", "preparing", "ready"]))).groupBy(orders.kitchenStatus),
    db.select().from(quotes).where(inArray(quotes.status, ["sent", "approved", "scheduled"])),
  ]);
  const usable = board.filter((s) => s.enabled);
  const busy = (s: (typeof board)[number]) => s.state === "ocupada" || s.state === "gracia";
  const kinds = [...new Set(usable.map((s) => s.kind))];
  const kitchenCount = (status: string) => kitchen.find((k) => k.status === status)?.n ?? 0;
  const upcoming = parties.filter((q) => q.status === "scheduled" && q.eventAt && q.eventAt + q.durationMinutes * MINUTE > now()).sort((a, b) => a.eventAt! - b.eventAt!);

  // Últimas ventas, de lo más nuevo a lo más viejo: recargas, tarjetas, tiempo, menú y pagos de fiestas.
  const sales = [
    ...report.moves
      // Una sesión pagada entera con tiempo a favor no es una venta: no entra dinero.
      .filter((m) => ["topup", "card_sale", "session", "purchase"].includes(m.type) && (m.amountCents !== 0 || m.paidCents !== 0))
      .map((m) => ({ key: `m${m.id}`, at: m.createdAt, type: m.type as string, who: m.member, cents: m.type === "topup" || m.type === "card_sale" ? m.paidCents : -m.amountCents, note: m.note })),
    ...report.partyPayments.map((p) => ({ key: `p${p.id}`, at: p.createdAt, type: "party", who: p.customer, cents: p.amountCents, note: p.code })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 14);

  return {
    at: now(),
    stations: {
      total: usable.length,
      inUse: usable.filter(busy).length,
      offline: usable.filter((s) => s.state === "sin_conexion").length,
      byKind: kinds.map((kind) => ({ kind, total: usable.filter((s) => s.kind === kind).length, inUse: usable.filter((s) => s.kind === kind && busy(s)).length })),
      active: usable
        .filter((s) => s.session)
        .map((s) => ({ id: s.id, label: s.label, state: s.state, member: s.session!.memberName, endsAt: s.session!.endsAt }))
        .sort((a, b) => a.endsAt - b.endsAt),
    },
    today: {
      cashInCents: report.cashInCents,
      deskCents: report.deskCents,
      partiesCents: report.partiesCents,
      playedCents: report.playedCents,
      menuCents: report.menuCents,
      orders: report.orders,
      sessions: report.sessions,
      visits: report.visits,
      newMembers: report.newMembers,
      byMethod: report.byMethod,
    },
    kitchen: { pending: kitchenCount("pending"), preparing: kitchenCount("preparing"), ready: kitchenCount("ready") },
    parties: {
      waiting: parties.filter((q) => q.status === "sent").length,
      toSchedule: parties.filter((q) => q.status === "approved").length,
      scheduled: upcoming.length,
      next: upcoming.slice(0, 3).map(summary),
    },
    sales,
  };
}

export const listPackages = (onlyActive: boolean) =>
  db.select().from(partyPackages).where(onlyActive ? eq(partyPackages.active, true) : undefined).orderBy(partyPackages.priceCents);
