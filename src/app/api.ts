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
};
