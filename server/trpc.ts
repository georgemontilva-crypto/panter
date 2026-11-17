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

export const staffProcedure = memberProcedure.use(({ ctx, next }) => {
  if (ctx.user.role === "member") throw new TRPCError({ code: "FORBIDDEN", message: "Esta sección es solo para el personal." });
  return next();
});

export const adminProcedure = memberProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Solo un administrador puede hacer esto." });
  return next();
});
