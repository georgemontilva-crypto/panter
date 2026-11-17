import { Router } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { sessions, stations, users } from "./db/schema";
import { MINUTE, newPairCode, now, sha256 } from "./lib";
import { finalizeExpired, stationLabel } from "./services";

// API del programa de bloqueo de cada PC.
// El programa llama a /api/agent/heartbeat cada pocos segundos con su credencial
// y el servidor le responde qué debe hacer: bloquear, dejar jugar o avisar que se acaba el tiempo.
export const agentRouter = Router();

const PAIR_CODE_ROTATE = 3 * MINUTE;

agentRouter.post("/heartbeat", async (req, res) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Falta la credencial de la PC." });
    return;
  }
  const [station] = await db.select().from(stations).where(eq(stations.deviceTokenHash, sha256(token)));
  if (!station) {
    res.status(401).json({ error: "Credencial inválida. Genera una nueva en el panel de administración." });
    return;
  }

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
  if (!station.enabled) state = "deshabilitada";
  else if (session) state = t < session.endsAt ? "activa" : "gracia";
  else if (station.unlockUntil && station.unlockUntil > t) state = "mantenimiento";

  res.json({
    serverTime: t,
    station: { number: station.number, label: stationLabel(station) },
    state,
    // Solo se muestra con la PC bloqueada: es lo que el cliente escribe en su perfil para activarla.
    pairCode: state === "bloqueada" ? pairCode : null,
    session: session ? { id: session.id, memberName: session.memberName.split(" ")[0], endsAt: session.endsAt, graceEndsAt: session.graceEndsAt } : null,
    unlockUntil: state === "mantenimiento" ? station.unlockUntil : null,
  });
});
