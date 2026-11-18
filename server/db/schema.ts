import { bigint, boolean, index, int, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

// Todas las fechas se guardan como milisegundos UTC (bigint) para no depender
// de la zona horaria del servidor ni de la base de datos.
const ms = (name: string) => bigint(name, { mode: "number" });

export const STATION_KINDS = ["pc", "ps5", "switch", "sim"] as const;
export const PAY_METHODS = ["efectivo_usd", "efectivo_bs", "pago_movil", "punto", "zelle", "otro"] as const;
export const TX_TYPES = ["topup", "card_sale", "session", "refund", "bonus", "adjust", "purchase"] as const;
// Tipos de usuario. "member" es el cliente; los demás son personal:
// cashier = operadora (máquinas y caja), kitchen = cocina (solo comandas),
// admin = administrador (todo), owner = súper admin, el dueño (todo, y además maneja a los administradores).
export const ROLES = ["member", "cashier", "kitchen", "admin", "owner"] as const;
export const KITCHEN_STATES = ["none", "pending", "preparing", "ready", "delivered"] as const;
export const QUOTE_STATES = ["draft", "sent", "approved", "scheduled", "done", "cancelled"] as const;

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  role: mysqlEnum("role", ROLES).notNull().default("member"),
  name: varchar("name", { length: 120 }).notNull(),
  phone: varchar("phone", { length: 20 }).unique(),
  email: varchar("email", { length: 190 }).unique(),
  passwordHash: varchar("password_hash", { length: 100 }),
  // Código corto impreso en la tarjeta (PNT-XXXXXX) y token largo que va dentro del QR.
  memberCode: varchar("member_code", { length: 16 }).notNull().unique(),
  cardToken: varchar("card_token", { length: 40 }).notNull().unique(),
  hasCard: boolean("has_card").notNull().default(false),
  balanceCents: int("balance_cents").notNull().default(0),
  visitsCount: int("visits_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: ms("created_at").notNull(),
  createdBy: int("created_by"),
});

// Libro contable: el saldo de un cliente es la suma de sus movimientos.
// amountCents = efecto en el saldo; paidCents = dinero que entró a caja.
export const walletTx = mysqlTable(
  "wallet_tx",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    type: mysqlEnum("type", TX_TYPES).notNull(),
    amountCents: int("amount_cents").notNull(),
    balanceAfterCents: int("balance_after_cents").notNull(),
    paidCents: int("paid_cents").notNull().default(0),
    method: mysqlEnum("method", PAY_METHODS),
    reference: varchar("reference", { length: 80 }),
    note: varchar("note", { length: 200 }),
    sessionId: int("session_id"),
    orderId: int("order_id"),
    staffId: int("staff_id"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("wallet_tx_user").on(t.userId, t.createdAt), index("wallet_tx_created").on(t.createdAt)],
);

export const stations = mysqlTable(
  "stations",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", STATION_KINDS).notNull(),
    number: int("number").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    note: varchar("note", { length: 160 }),
    // Solo PCs: credencial del programa de bloqueo (se guarda el hash, nunca el token).
    deviceTokenHash: varchar("device_token_hash", { length: 64 }),
    pairCode: varchar("pair_code", { length: 6 }),
    pairCodeAt: ms("pair_code_at"),
    lastSeenAt: ms("last_seen_at"),
    agentVersion: varchar("agent_version", { length: 20 }),
    // Desbloqueo manual desde el panel (mantenimiento, instalar juegos).
    unlockUntil: ms("unlock_until"),
  },
  (t) => [uniqueIndex("stations_kind_number").on(t.kind, t.number), index("stations_token").on(t.deviceTokenHash)],
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    stationId: int("station_id").notNull(),
    status: mysqlEnum("status", ["active", "ended"]).notNull().default("active"),
    startedAt: ms("started_at").notNull(),
    endsAt: ms("ends_at").notNull(),
    // endsAt + minutos de gracia: en ese momento la PC se vuelve a bloquear.
    graceEndsAt: ms("grace_ends_at").notNull(),
    endedAt: ms("ended_at"),
    minutesPaid: int("minutes_paid").notNull(),
    costCents: int("cost_cents").notNull(),
    refundCents: int("refund_cents").notNull().default(0),
    startedBy: int("started_by"),
    endReason: varchar("end_reason", { length: 30 }),
  },
  (t) => [index("sessions_station").on(t.stationId, t.status), index("sessions_user").on(t.userId, t.status)],
);

export const visits = mysqlTable(
  "visits",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    // Día en hora de Maracaibo, formato AAAA-MM-DD. Una visita por cliente por día.
    visitDate: varchar("visit_date", { length: 10 }).notNull(),
    source: mysqlEnum("source", ["session", "checkin"]).notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("visits_user_day").on(t.userId, t.visitDate), index("visits_day").on(t.visitDate)],
);

// ---------- Menú y compras con el saldo ----------
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  category: varchar("category", { length: 40 }).notNull().default("General"),
  priceCents: int("price_cents").notNull(),
  active: boolean("active").notNull().default(true),
  // Si se prepara en cocina, la orden genera comanda. Un refresco de la nevera no hace falta que pase por cocina.
  kitchen: boolean("kitchen").notNull().default(true),
  createdAt: ms("created_at").notNull(),
});

export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    staffId: int("staff_id").notNull(),
    totalCents: int("total_cents").notNull(),
    status: mysqlEnum("status", ["paid", "refunded"]).notNull().default("paid"),
    createdAt: ms("created_at").notNull(),
    refundedAt: ms("refunded_at"),
    refundedBy: int("refunded_by"),
    // Comanda de cocina. "none" = la orden no lleva nada que preparar.
    kitchenStatus: mysqlEnum("kitchen_status", KITCHEN_STATES).notNull().default("none"),
    note: varchar("note", { length: 160 }),
    readyAt: ms("ready_at"),
    deliveredAt: ms("delivered_at"),
  },
  (t) => [index("orders_user").on(t.userId, t.createdAt), index("orders_created").on(t.createdAt), index("orders_kitchen").on(t.kitchenStatus)],
);

// Cada renglón guarda el nombre y el precio del momento: si el menú cambia, la orden no.
export const orderItems = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id").notNull(),
    productId: int("product_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    unitCents: int("unit_cents").notNull(),
    qty: int("qty").notNull(),
    kitchen: boolean("kitchen").notNull().default(true),
  },
  (t) => [index("order_items_order").on(t.orderId)],
);

// ---------- Fiestas: paquetes, cotizaciones y sus pagos ----------
export const partyPackages = mysqlTable("party_packages", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: varchar("description", { length: 400 }),
  priceCents: int("price_cents").notNull(),
  durationMinutes: int("duration_minutes").notNull().default(120),
  guests: int("guests").notNull().default(10),
  active: boolean("active").notNull().default(true),
  createdAt: ms("created_at").notNull(),
});

export const quotes = mysqlTable(
  "quotes",
  {
    id: int("id").autoincrement().primaryKey(),
    customerName: varchar("customer_name", { length: 120 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 20 }),
    customerEmail: varchar("customer_email", { length: 190 }),
    occasion: varchar("occasion", { length: 120 }),
    // Fecha y hora de la fiesta. Puede faltar mientras es borrador; es obligatoria para agendar.
    eventAt: ms("event_at"),
    durationMinutes: int("duration_minutes").notNull().default(120),
    guests: int("guests").notNull().default(10),
    notes: text("notes"),
    status: mysqlEnum("status", QUOTE_STATES).notNull().default("draft"),
    totalCents: int("total_cents").notNull().default(0),
    paidCents: int("paid_cents").notNull().default(0),
    // Número de recibo, correlativo: se asigna cuando la cotización queda pagada completa.
    receiptNumber: int("receipt_number"),
    paidAt: ms("paid_at"),
    createdBy: int("created_by").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("quotes_status").on(t.status), index("quotes_event").on(t.eventAt)],
);

// Renglones con el nombre y el precio del momento. Un descuento es un renglón con precio negativo.
export const quoteItems = mysqlTable(
  "quote_items",
  {
    id: int("id").autoincrement().primaryKey(),
    quoteId: int("quote_id").notNull(),
    description: varchar("description", { length: 160 }).notNull(),
    qty: int("qty").notNull().default(1),
    unitCents: int("unit_cents").notNull(),
    sort: int("sort").notNull().default(0),
  },
  (t) => [index("quote_items_quote").on(t.quoteId)],
);

export const quotePayments = mysqlTable(
  "quote_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    quoteId: int("quote_id").notNull(),
    amountCents: int("amount_cents").notNull(),
    method: mysqlEnum("method", PAY_METHODS).notNull(),
    reference: varchar("reference", { length: 80 }),
    staffId: int("staff_id").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("quote_payments_quote").on(t.quoteId), index("quote_payments_created").on(t.createdAt)],
);

// ---------- Facturas de compras: lo que Panter le paga a sus proveedores ----------
export const purchases = mysqlTable(
  "purchases",
  {
    id: int("id").autoincrement().primaryKey(),
    supplier: varchar("supplier", { length: 120 }).notNull(),
    invoiceNumber: varchar("invoice_number", { length: 40 }),
    // Fecha de la factura, AAAA-MM-DD.
    invoiceDate: varchar("invoice_date", { length: 10 }).notNull(),
    category: varchar("category", { length: 40 }).notNull().default("Otros"),
    description: varchar("description", { length: 300 }),
    totalCents: int("total_cents").notNull(),
    paidAt: ms("paid_at"),
    method: mysqlEnum("method", PAY_METHODS),
    reference: varchar("reference", { length: 80 }),
    createdBy: int("created_by").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("purchases_date").on(t.invoiceDate)],
);

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 40 }).primaryKey(),
  value: text("value").notNull(),
});
