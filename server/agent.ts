import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { sessions, stations, users } from "./db/schema";
import { MINUTE, newPairCode, now, sha256 } from "./lib";
import { finalizeExpired, isUnlocked, launcherForAgent, stationLabel, unlockForever } from "./services";

// API del programa de bloqueo de cada PC.
// El programa llama a /api/agent/heartbeat cada pocos segundos con su credencial
// y el servidor le responde qué debe hacer: bloquear, dejar jugar o avisar que se acaba el tiempo.
export const agentRouter = Router();

const PAIR_CODE_ROTATE = 3 * MINUTE;

type Station = typeof stations.$inferSelect;
/** La PC que llama, según su credencial. Si no es válida, responde el error y devuelve null. */
async function stationOf(req: Request, res: Response): Promise<Station | null> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Falta la credencial de la PC." });
    return null;
  }
  const [station] = await db.select().from(stations).where(eq(stations.deviceTokenHash, sha256(token)));
  if (!station) {
    res.status(401).json({ error: "Credencial inválida. Genera una nueva en el panel de administración." });
    return null;
  }
  return station;
}

// Pantalla de juegos: lo que la PC debe mostrar. El programa lo vuelve a pedir cuando cambia "launcher.version" en el latido.
agentRouter.get("/launcher", async (req, res) => {
  if (!(await stationOf(req, res))) return;
  res.json(await launcherForAgent());
});

// La PC cuenta qué juegos de Steam y Epic encontró instalados, para poder ocultarlos desde el panel.
agentRouter.post("/catalog", async (req, res) => {
  const station = await stationOf(req, res);
  if (!station) return;
  const raw: unknown[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 400) : [];
  const items = raw
    .filter((item): item is { key?: unknown; name?: unknown } => typeof item === "object" && item !== null)
    .filter((item) => typeof item.key === "string" && typeof item.name === "string" && /^(steam|epic):[\w.-]{1,80}$/.test(item.key))
    .map((item) => ({ key: item.key as string, name: (item.name as string).slice(0, 120), source: (item.key as string).split(":")[0] }));
  await db.update(stations).set({ catalog: JSON.stringify(items), catalogAt: now() }).where(eq(stations.id, station.id));
  res.json({ ok: true, count: items.length });
});

agentRouter.post("/heartbeat", async (req, res) => {
  const station = await stationOf(req, res);
  if (!station) return;

  await finalizeExpired();
  const t = now();
  const rotate = !station.pairCode || !station.pairCodeAt || t - station.pairCodeAt > PAIR_CODE_ROTATE;
  const pairCode = rotate ? newPairCode() : station.pairCode!;
  const version = typeof req.body?.version === "string" ? req.body.version.slice(0, 20) : null;
  await db
    .update(stations)
    .set({ lastSeenAt: t, agentVersion: version, ...(rotate ? { pairCode, pairCodeAt: t } : {}) })
    .where(eq(stations.id, station.id));

  const [session] = await db
    .select({ id: sessions.id, endsAt: sessions.endsAt, graceEndsAt: sessions.graceEndsAt, memberName: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.stationId, station.id), eq(sessions.status, "active"), gt(sessions.graceEndsAt, t)));

  let state: "bloqueada" | "activa" | "gracia" | "mantenimiento" | "deshabilitada" = "bloqueada";
  // Mantenimiento manda sobre "deshabilitada": una PC fuera de servicio también se abre desde el panel para arreglarla.
  const unlocked = !session && isUnlocked(station, t);
  if (unlocked) state = "mantenimiento";
  else if (!station.enabled) state = "deshabilitada";
  else if (session) state = t < session.endsAt ? "activa" : "gracia";

  // Huella de la configuración de la pantalla de juegos: si cambia, el programa vuelve a pedir la lista.
  const launcher = await launcherForAgent();
  const launcherVersion = createHash("sha256").update(JSON.stringify(launcher)).digest("hex").slice(0, 12);

  res.json({
    serverTime: t,
    launcher: { enabled: launcher.enabled, version: launcherVersion },
    station: { number: station.number, label: stationLabel(station) },
    state,
    // Solo se muestra con la PC bloqueada: es lo que el cliente escribe en su perfil para activarla.
    pairCode: state === "bloqueada" ? pairCode : null,
    session: session ? { id: session.id, memberName: session.memberName.split(" ")[0], endsAt: session.endsAt, graceEndsAt: session.graceEndsAt } : null,
    // "Sin límite" viaja sin hora: el programa muestra el aviso de mantenimiento sin cuenta regresiva.
    unlockUntil: unlocked && !unlockForever(station) ? station.unlockUntil : null,
  });
});
