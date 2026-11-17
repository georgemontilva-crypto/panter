import { existsSync } from "node:fs";
import { resolve } from "node:path";
import compression from "compression";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { count, eq } from "drizzle-orm";
import { agentRouter } from "./agent";
import { hashPassword } from "./auth";
import { db, initDb } from "./db";
import { users } from "./db/schema";
import { accountsEnabled, env } from "./env";
import { normalizePhone } from "./lib";
import { appRouter } from "./router";
import { createUser, finalizeExpired, getConfig } from "./services";
import { createContext } from "./trpc";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "100kb" }));

async function bootstrapAdmin() {
  const [admins] = await db.select({ n: count() }).from(users).where(eq(users.role, "admin"));
  if (admins.n > 0) return;
  if (!env.adminPhone || !env.adminPassword) {
    console.warn("[panter] No hay administrador. Define ADMIN_PHONE y ADMIN_PASSWORD para crear el primero.");
    return;
  }
  await createUser({
    name: env.adminName,
    phone: normalizePhone(env.adminPhone),
    passwordHash: await hashPassword(env.adminPassword),
    role: "admin",
  });
  console.log("[panter] Administrador inicial creado.");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, accounts: accountsEnabled() });
});

if (accountsEnabled()) {
  await initDb();
  await bootstrapAdmin();
  app.use("/api/agent", agentRouter);
  // Horario vigente para la portada (el que se edita en Caja → Ajustes).
  app.get("/api/public/schedule", async (_req, res) => {
    const config = await getConfig();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ hours: config.hours });
  });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  // Cierra las sesiones vencidas aunque nadie esté mirando el panel.
  setInterval(() => finalizeExpired().catch((error) => console.error("[panter] finalizeExpired", error)), 20_000).unref();
} else {
  // Sin base de datos o sin JWT_SECRET la landing sigue funcionando; solo se apagan las cuentas.
  console.warn("[panter] Cuentas desactivadas: faltan DATABASE_URL y/o JWT_SECRET.");
  app.use("/api", (_req, res) => {
    res.status(503).json({ error: { message: "El sistema de cuentas todavía no está configurado en el servidor." } });
  });
}

const dist = resolve(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use(
    "/assets",
    express.static(resolve(dist, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }),
  );
  app.use(express.static(dist, { maxAge: "5m", index: false }));
  // Rutas de la aplicación (/cuenta, /caja...): todas cargan el mismo index.html.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(resolve(dist, "index.html"));
  });
}

app.listen(env.port, "0.0.0.0", () => {
  console.log(`[panter] Arena Panter en http://localhost:${env.port}`);
});
