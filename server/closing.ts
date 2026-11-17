import { event } from "../src/content";

// Hasta qué hora se puede vender tiempo de juego.
// Funciones puras (sin base de datos) para poder probarlas con cualquier fecha.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CARACAS_OFFSET = -4 * HOUR; // Maracaibo: UTC-4 todo el año

/** Minutos que se toleran por encima del cierre: quien pide 1 hora a las 9:03 pm la recibe. */
export const CLOSE_TOLERANCE_MINUTES = 5;

/** Antes de esta hora local (10:00 am), si la arena aún no abre, se entiende que sigue la noche anterior. */
const EARLY_HOURS_END = 10 * 60;

export type WeekHours = [open: number, close: number][]; // índice 0 = domingo; minutos desde medianoche

export type ClosingRules = {
  hours: WeekHours;
  /** "Hoy cerramos más tarde": mientras no pase esta hora (ms UTC), el cierre se extiende hasta ella. */
  extendedUntil: number | null;
};

/** Momento (ms UTC) en que cierra la arena para quien quiere jugar ahora. Si ya cerró, devuelve `t`. */
export function closingAt(rules: ClosingRules, t: number): number {
  const local = new Date(t + CARACAS_OFFSET);
  const weekday = local.getUTCDay();
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - CARACAS_OFFSET;
  const [open, close] = rules.hours[weekday];

  // De madrugada y temprano en la mañana: la jornada de ayer ya terminó. Más tarde (por ejemplo a la 1 pm
  // con apertura a las 2:30) se permite empezar y manda el cierre de hoy.
  const afterLastNight = minutes < open && minutes < EARLY_HOURS_END;
  let closeAt = afterLastNight ? t : Math.max(t, dayStart + close * MINUTE);

  // Cierre extendido desde Ajustes.
  if (rules.extendedUntil && rules.extendedUntil > t) closeAt = Math.max(closeAt, rules.extendedUntil);
  // Evento de la portada (amanecer gamer): desde 12 horas antes y hasta que termina, el cierre es el fin del evento.
  if (t >= event.startsAt - 12 * HOUR && t < event.endsAt) closeAt = Math.max(closeAt, event.endsAt);

  return closeAt;
}

/** Minutos de juego que todavía se pueden vender a partir de `from` (por defecto, ahora). */
export function sellableMinutes(rules: ClosingRules, t: number, from = t): number {
  const closeAt = closingAt(rules, t);
  if (closeAt <= t) return 0;
  return Math.max(0, Math.floor((closeAt - from) / MINUTE) + CLOSE_TOLERANCE_MINUTES);
}

export function formatLocalTime(ms: number): string {
  const d = new Date(ms + CARACAS_OFFSET);
  const h24 = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

function spell(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} minutos`;
  const hours = h === 1 ? "1 hora" : `${h} horas`;
  return m ? `${hours} y ${m} minutos` : hours;
}

/**
 * Mensaje de error si `minutes` no caben antes del cierre; null si caben.
 * `step` es el bloque mínimo que se vende (30 min al cliente, 15 en caja).
 */
export function closingProblem(rules: ClosingRules, t: number, minutes: number, step: number, from = t): string | null {
  const available = sellableMinutes(rules, t, from);
  if (minutes <= available) return null;
  const closeAt = closingAt(rules, t);
  const blocks = Math.floor(available / step) * step;
  if (closeAt <= t) return "La arena ya cerró por hoy. Vuelve mañana para seguir jugando.";
  if (blocks < step) return `Cerramos a las ${formatLocalTime(closeAt)} y ya no alcanza el tiempo para un bloque más.`;
  return `Cerramos a las ${formatLocalTime(closeAt)}: ahora puedes pedir hasta ${spell(blocks)}.`;
}
