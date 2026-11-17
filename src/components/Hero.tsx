import { useEffect, useRef, useState } from "react";
import GlitchCanvas from "./GlitchCanvas";
import { PantherMark } from "./Logo";
import { event } from "../content";
import { countdownTo, localClock, openStatus, pad2, prefersReducedMotion, rangeLabel, useNow } from "../time";

// Pistas que conectan cada lectura con el logo. Coordenadas en el tablero de 1600 x 640:
// salen del borde de la tarjeta y entran por el costado de la pantera.
const TRACES = [
  "M340 200 H382 L482 300 H552",
  "M340 470 H363 L482 351 H552",
  "M1260 200 H1218 L1118 300 H1048",
  "M1260 470 H1237 L1118 351 H1048",
];
const NODES = [
  [340, 200],
  [340, 470],
  [1260, 200],
  [1260, 470],
];

export default function Hero() {
  const [on, setOn] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const now = useNow(1000);
  const status = openStatus(now);
  const today = localClock(now).day;
  const left = countdownTo(event.startsAt, now);
  const live = now >= event.startsAt && now < event.endsAt;
  const over = now >= event.endsAt;

  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Inclinación leve del tablero siguiendo el puntero.
  useEffect(() => {
    const el = board.current;
    if (!el || prefersReducedMotion() || !window.matchMedia("(hover: hover)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-y * 5).toFixed(2)}deg`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className={`hero${on ? " is-on" : ""}`} id="inicio">
      <GlitchCanvas />

      <div className="hero__stage">
        <div className="board" ref={board}>
          <svg className="board__traces" viewBox="0 0 1600 640" aria-hidden="true">
            {TRACES.map((d) => (
              <g key={d}>
                <path className="trace" d={d} pathLength={1} />
                <path className="trace trace--pulse" d={d} pathLength={1} />
              </g>
            ))}
            {NODES.map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} className="trace-node" cx={cx} cy={cy} r={7} />
            ))}
          </svg>

          <div className="board__mark">
            <PantherMark className="mark mark--base" title="Logo de Arena Panter" lit />
            <PantherMark className="mark mark--ghost mark--ghost-a" />
            <PantherMark className="mark mark--ghost mark--ghost-b" />
          </div>

          <a className="readout readout--lt" href="#estaciones">
            <span className="readout__label">Para jugar</span>
            <span className="readout__value">PC, PS5, Switch y simuladores</span>
          </a>

          <a className="readout readout--lb" href="#horario">
            <span className={`readout__label readout__label--status${status.open ? " is-open" : ""}`}>
              <span className="status__dot" aria-hidden="true" />
              {status.headline}
            </span>
            <span className="readout__value">Hoy, {rangeLabel(today)}</span>
          </a>

          <a className="readout readout--rt" href="#evento">
            <span className="readout__label">{event.name}</span>
            <span className="readout__value">{event.dateShort}</span>
          </a>

          <a className="readout readout--rb" href="#evento">
            {live ? (
              <>
                <span className="readout__label">Amanecer gamer</span>
                <span className="readout__value">Está pasando ahora</span>
              </>
            ) : over ? (
              <>
                <span className="readout__label">Amanecer gamer</span>
                <span className="readout__value">Así fue la noche</span>
              </>
            ) : (
              <>
                <span className="readout__label">Faltan</span>
                <span className="readout__value readout__value--clock" aria-live="off">
                  {left.days}d {pad2(left.hours)}h {pad2(left.minutes)}m {pad2(left.seconds)}s
                </span>
              </>
            )}
          </a>
        </div>

        <div className="hero__copy">
          <h1 className="hero__title">
            La arena gamer <span>de Maracaibo</span>
          </h1>
          <p className="hero__lead">
            PC, PlayStation 5, Nintendo Switch y simuladores de carreras bajo un techo de nubes LED.
          </p>
          <div className="hero__actions">
            <a className="btn" href="#evento">
              Ver el Amanecer gamer del 21
            </a>
            <a className="btn btn--ghost" href="#horario">
              Ver horario
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
