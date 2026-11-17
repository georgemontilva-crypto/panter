import { createHash, randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";

export const now = () => Date.now();
export const MINUTE = 60_000;

// Maracaibo: UTC-4 todo el año.
const CARACAS_OFFSET = -4 * 60 * MINUTE;
export function caracasDate(at = now()): string {
  return new Date(at + CARACAS_OFFSET).toISOString().slice(0, 10);
}
/** Inicio y fin (ms UTC) de un día AAAA-MM-DD en hora de Maracaibo. */
export function caracasDayBounds(day: string): [number, number] {
  const start = Date.parse(`${day}T00:00:00Z`) - CARACAS_OFFSET;
  return [start, start + 24 * 60 * MINUTE];
}

// Sin 0/O ni 1/I/L: se leen bien impresos en la tarjeta.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
export const newMemberCode = () => `PNT-${randomCode(6)}`;
export const newCardToken = () => randomCode(24);
export const newDeviceToken = () => `pc_${randomCode(40)}`;
export const newPairCode = () => String(randomInt(10_000)).padStart(4, "0");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const QR_PREFIX = "PANTER:";

/** Deja solo dígitos y lleva los números venezolanos al formato 04XXXXXXXXX. */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("58") && digits.length === 12) digits = `0${digits.slice(2)}`;
  return digits;
}

export function fail(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}

// Límite simple de intentos en memoria (inicio de sesión, activación de cuenta).
const attempts = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, max = 8, windowMs = 10 * MINUTE) {
  const t = now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < t) {
    attempts.set(key, { count: 1, resetAt: t + windowMs });
    return;
  }
  if (++entry.count > max) fail("TOO_MANY_REQUESTS", "Demasiados intentos. Espera unos minutos y vuelve a probar.");
}
export const clearRateLimit = (key: string) => attempts.delete(key);
