import { useEffect, useState } from "react";
import { hours } from "./content";

// Maracaibo usa UTC-4 todo el año (sin horario de verano).
const OFFSET_MS = -4 * 60 * 60 * 1000;

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function localClock(now: number): { day: number; minutes: number } {
  const d = new Date(now + OFFSET_MS);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

export function formatMinutes(total: number): string {
  const m = total % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

export function rangeLabel(day: number): string {
  const [open, close] = hours[day];
  return `${formatMinutes(open)} a ${formatMinutes(close)}`;
}

export type OpenStatus = { open: boolean; headline: string; detail: string };

export function openStatus(now: number): OpenStatus {
  const { day, minutes } = localClock(now);
  const [open, close] = hours[day];
  if (minutes >= open && minutes < close) {
    return { open: true, headline: "Abierto ahora", detail: `Cierra a las ${formatMinutes(close)}` };
  }
  if (minutes < open) {
    return { open: false, headline: "Cerrado ahora", detail: `Abre hoy a las ${formatMinutes(open)}` };
  }
  const [nextOpen] = hours[(day + 1) % 7];
  return { open: false, headline: "Cerrado ahora", detail: `Abre mañana a las ${formatMinutes(nextOpen)}` };
}

export type Countdown = { days: number; hours: number; minutes: number; seconds: number };

export function countdownTo(target: number, now: number): Countdown {
  const s = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
