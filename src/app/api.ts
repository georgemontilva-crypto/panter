import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/router";

export const trpc = createTRPCReact<AppRouter>();
export const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc" })] });

type Out = inferRouterOutputs<AppRouter>;
export type Me = NonNullable<Out["auth"]["me"]>;
export type MemberHome = Out["member"]["home"];
export type Board = Out["staff"]["board"];
export type BoardStation = Board[number];
export type Config = Out["staff"]["config"];
export type StationKind = BoardStation["kind"];

export const KIND_NAMES: Record<StationKind, string> = {
  pc: "PC gamer",
  ps5: "PlayStation 5",
  switch: "Nintendo Switch",
  sim: "Simuladores",
};

export const METHODS = [
  { id: "efectivo_usd", label: "Efectivo $" },
  { id: "efectivo_bs", label: "Efectivo Bs" },
  { id: "pago_movil", label: "Pago móvil" },
  { id: "punto", label: "Punto de venta" },
  { id: "zelle", label: "Zelle" },
  { id: "otro", label: "Otro" },
] as const;
export type MethodId = (typeof METHODS)[number]["id"];
export const methodLabel = (id: string | null) => METHODS.find((m) => m.id === id)?.label ?? "";

export const TX_LABEL: Record<string, string> = {
  topup: "Recarga",
  card_sale: "Tarjeta de afiliación",
  session: "Tiempo de juego",
  refund: "Devolución",
  bonus: "Bono de fidelidad",
  adjust: "Ajuste",
  purchase: "Compra en el menú",
};
export type MenuItem = Out["member"]["menu"][number];
export type OrderRow = MemberHome["orders"][number];

// ---------- Tipos de usuario ----------
export type Role = Me["role"];
export const ROLE_LABEL: Record<Role, string> = {
  member: "Cliente",
  cashier: "Operadora",
  kitchen: "Cocina",
  admin: "Administrador",
  owner: "Súper admin",
};
export const ROLE_ABOUT: Record<Exclude<Role, "member">, string> = {
  cashier: "Máquinas, clientes, recargas y cobro del menú.",
  kitchen: "Solo las comandas de cocina.",
  admin: "Todo: ventas, fiestas, compras y ajustes.",
  owner: "Todo, y además maneja a los administradores.",
};
export const isSenior = (role: Role) => role === "admin" || role === "owner";
export const canUseDesk = (role: Role) => role === "cashier" || isSenior(role);

// ---------- Cocina ----------
export type KitchenTicket = Out["kitchen"]["board"][number];
export type KitchenStatus = KitchenTicket["kitchenStatus"];
/** Cómo ve el cliente su pedido. */
export const ORDER_PROGRESS: Record<string, string> = {
  pending: "En cola en cocina",
  preparing: "Preparándose",
  ready: "Listo, pásalo buscando",
  delivered: "Entregado",
};

// ---------- Oficina ----------
export type Live = Out["office"]["live"];
export type QuoteSummary = Out["office"]["quotes"][number];
export type QuoteDetail = Out["office"]["quote"];
export type QuoteStatus = QuoteSummary["status"];
export type PartyPackage = Out["office"]["packages"][number];
export type PurchaseRow = Out["office"]["purchases"]["rows"][number];
export const QUOTE_LABEL: Record<QuoteStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  approved: "Aprobada",
  scheduled: "Agendada",
  done: "Realizada",
  cancelled: "Cancelada",
};
export const PURCHASE_CATEGORIES = ["Comida y bebidas", "Equipos y repuestos", "Servicios", "Alquiler", "Nómina", "Mantenimiento", "Publicidad", "Otros"] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];
