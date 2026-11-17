import { bigint, boolean, index, int, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

// Todas las fechas se guardan como milisegundos UTC (bigint) para no depender
// de la zona horaria del servidor ni de la base de datos.
const ms = (name: string) => bigint(name, { mode: "number" });

export const STATION_KINDS = ["pc", "ps5", "switch", "sim"] as const;
export const PAY_METHODS = ["efectivo_usd", "efectivo_bs", "pago_movil", "punto", "zelle", "otro"] as const;
export const TX_TYPES = ["topup", "card_sale", "session", "refund", "bonus", "adjust"] as const;

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  role: mysqlEnum("role", ["member", "cashier", "admin"]).notNull().default("member"),
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

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 40 }).primaryKey(),
  value: text("value").notNull(),
});
