import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { ZodError } from "zod";
import { userFromRequest } from "./auth";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  return { req, res, user: await userFromRequest(req) };
}
type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  // Los errores de validación llegan al cliente con el mensaje del primer campo que falló.
  errorFormatter({ shape, error }) {
    if (error.cause instanceof ZodError) {
      return { ...shape, message: error.cause.issues[0]?.message ?? "Revisa los datos e intenta otra vez." };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const memberProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Inicia sesión para continuar." });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

type Role = NonNullable<Context["user"]>["role"];
const only = (roles: Role[], message: string) =>
  memberProcedure.use(({ ctx, next }) => {
    if (!roles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message });
    return next();
  });

// Quién puede qué. Cada ruta del servidor usa uno de estos permisos, así que ocultar un botón en pantalla
// nunca es lo único que protege: el servidor rechaza a quien no tenga el tipo de usuario correcto.
/** Caja y máquinas: operadoras, administradores y súper admin. */
export const deskProcedure = only(["cashier", "admin", "owner"], "Esta sección es para operadoras y administradores.");
/** Comandas: cocina, y también quien las entrega o supervisa. */
export const kitchenProcedure = only(["kitchen", "cashier", "admin", "owner"], "Esta sección es para cocina y caja.");
/** Ventas, cotizaciones, compras y ajustes: administradores y súper admin. */
export const adminProcedure = only(["admin", "owner"], "Solo un administrador puede hacer esto.");
/** Solo el dueño. */
export const ownerProcedure = only(["owner"], "Solo el súper admin puede hacer esto.");
