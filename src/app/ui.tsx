import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { PantherMark, Wordmark } from "../components/Logo";

// ---------- Formato ----------
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
export const ref = (cents: number) => `${money(cents)} REF`;

/** "12,5" o "12.50" → 1250. Devuelve null si no es un monto válido. */
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : h === 1 ? "1 hora" : `${h} horas`;
}

const dateFmt = new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Caracas" });
const timeFmt = new Intl.DateTimeFormat("es-VE", { hour: "numeric", minute: "2-digit", timeZone: "America/Caracas" });
const dayFmt = new Intl.DateTimeFormat("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Caracas" });
export const when = (ms: number) => dateFmt.format(ms);
export const clock = (ms: number) => timeFmt.format(ms);
/** "sábado, 5 de diciembre" */
export const dayName = (ms: number) => dayFmt.format(ms);

// Los campos de fecha del navegador no saben de zonas horarias: aquí todo se lee y se guarda en hora de Maracaibo (UTC-4).
const CARACAS_MS = 4 * 60 * 60 * 1000;
export const toLocalInput = (ms: number | null) => (ms ? new Date(ms - CARACAS_MS).toISOString().slice(0, 16) : "");
export const fromLocalInput = (value: string) => (value ? Date.parse(`${value}:00Z`) + CARACAS_MS : null);
export const todayInput = () => new Date(Date.now() - CARACAS_MS).toISOString().slice(0, 10);

// ---------- Reloj ----------
export function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function countdown(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------- QR ----------
export function Qr({ value, className }: { value: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    let d = "";
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (modules.data[y * modules.size + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  }, [value]);
  return (
    <svg className={className} viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label="Código QR de la tarjeta" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

// ---------- Tarjeta de afiliación ----------
export function MemberCard({
  name,
  code,
  qr,
  level,
  balanceCents,
}: {
  name: string;
  code: string;
  qr: string;
  level?: string;
  /** Saldo actual. Solo en la tarjeta digital: la tarjeta impresa no lo lleva porque cambia. */
  balanceCents?: number;
}) {
  return (
    <div className="mcard">
      <div className="mcard__brand">
        <PantherMark className="mcard__mark" />
        <Wordmark className="mcard__word" />
        {balanceCents !== undefined && (
          <p className="mcard__balance">
            <span className="mcard__balance-label">Saldo</span>
            <span className="mcard__balance-value">
              {money(balanceCents)} <small>REF</small>
            </span>
          </p>
        )}
      </div>
      <div className="mcard__who">
        {level && <span className="mcard__level">Nivel {level}</span>}
        <span className="mcard__name">{name}</span>
        <span className="mcard__code">{code}</span>
      </div>
      <Qr value={qr} className="mcard__qr" />
    </div>
  );
}

// ---------- Piezas de interfaz ----------
export function Shell({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="app">
      <header className="app__bar">
        <Link to="/" className="app__brand" aria-label="Arena Panter, volver al inicio">
          <PantherMark className="app__mark" />
          <Wordmark className="app__word" />
        </Link>
        <span className="app__title">{title}</span>
        <div className="app__right">{right}</div>
      </header>
      <main className="app__main">{children}</main>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={`notice notice--${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`}>
      {(title || action) && (
        <header className="panel__head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export const STATE_LABEL: Record<string, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  gracia: "Tiempo extra",
  sin_conexion: "Sin conexión",
  deshabilitada: "Deshabilitada",
  mantenimiento: "Mantenimiento",
};

// ---------- Documento para imprimir o guardar como PDF ----------
// Muestra la hoja en pantalla, tal como saldrá, y al imprimir solo sale la hoja.
export function DocSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("no-scroll");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      {/* La tarjeta de afiliación se imprime en su tamaño; un documento va en hoja normal. */}
      <style>{"@media print { @page { size: auto; margin: 14mm; } }"}</style>
      <div className="sheet__bar">
        <h2>{title}</h2>
        <button className="btn btn--small" type="button" onClick={() => window.print()}>
          Imprimir o guardar PDF
        </button>
        <button className="btn btn--ghost btn--small" type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div className="sheet__scroll">
        <div className="sheet__paper print-doc">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ tone = "plain", children }: { tone?: "plain" | "ok" | "warn" | "hot" | "off"; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
