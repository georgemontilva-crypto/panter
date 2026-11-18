import { useEffect, useRef, useState } from "react";
import NightScene from "./NightScene";
import { event, reserveChannel, reserveUrl, site } from "../content";
import { countdownTo, pad2, prefersReducedMotion, useNow } from "../time";

const NIGHT_HOURS = 8;

function Countdown({ now }: { now: number }) {
  const left = countdownTo(event.startsAt, now);
  const units = [
    { value: String(left.days), label: left.days === 1 ? "día" : "días" },
    { value: pad2(left.hours), label: "horas" },
    { value: pad2(left.minutes), label: "min" },
    { value: pad2(left.seconds), label: "seg" },
  ];
  return (
    <div
      className="countdown"
      role="timer"
      aria-label={`Faltan ${left.days} días, ${left.hours} horas y ${left.minutes} minutos`}
    >
      <p className="countdown__lead">Abrimos puertas en</p>
      <div className="countdown__units" aria-hidden="true">
        {units.map((u) => (
          <div className="countdown__unit" key={u.label}>
            <span className="countdown__value">{u.value}</span>
            <span className="countdown__label">{u.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NightTimeline({ now }: { now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const live = now >= event.startsAt && now < event.endsAt;
  const liveProgress = (now - event.startsAt) / (event.endsAt - event.startsAt);

  useEffect(() => {
    if (live) return;
    if (prefersReducedMotion()) {
      setProgress(1);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const travel = Math.max(vh * 0.55, rect.height * 0.9);
      const p = Math.min(1, Math.max(0, (vh * 0.82 - rect.top) / travel));
      setProgress((prev) => (Math.abs(prev - p) > 0.002 ? p : prev));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [live]);

  const p = live ? liveProgress : progress;

  return (
    <div className="night" ref={ref} style={{ "--p": p.toFixed(4) } as React.CSSProperties}>
      <div className="night__head">
        <h3>La noche, hora por hora</h3>
        <p>{live ? "En vivo: así va la noche." : "De la apertura a la despedida con el sol saliendo sobre el lago."}</p>
      </div>

      <div className="night__track">
        <span className="night__line" aria-hidden="true" />
        <span className="night__playhead" aria-hidden="true" />
        <ol className="night__stops">
          {event.schedule.map((stop) => {
            const at = stop.offset / NIGHT_HOURS;
            return (
              <li
                key={stop.time}
                className={p + 0.004 >= at ? "is-past" : undefined}
                style={{ "--at": at } as React.CSSProperties}
              >
                <span className="night__dot" aria-hidden="true" />
                <span className="night__time">{stop.time}</span>
                <span className="night__label">{stop.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <NightScene />
    </div>
  );
}

// Los pases van en un carrusel horizontal: se desliza con el dedo, con las flechas o con los puntos.
// Si en la pantalla caben todos, se ven todos y los controles desaparecen.
function PassCarousel({ over }: { over: boolean }) {
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const last = event.passes.length - 1;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const cards = [...el.children] as HTMLElement[];
      setScrollable(el.scrollWidth > el.clientWidth + 4);
      // El pase activo es el que quedó más cerca del borde izquierdo del carrusel.
      const left = el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
      let nearest = 0;
      cards.forEach((card, i) => {
        if (Math.abs(card.getBoundingClientRect().left - left) < Math.abs(cards[nearest].getBoundingClientRect().left - left)) nearest = i;
      });
      // Al llegar al final, el último pase puede no alcanzar el borde: igual es el activo.
      setActive(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 && el.scrollLeft > 0 ? cards.length - 1 : nearest);
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  const go = (index: number) => {
    const el = track.current;
    const card = el?.children[Math.max(0, Math.min(last, index))] as HTMLElement | undefined;
    if (!el || !card) return;
    const left = el.scrollLeft + card.getBoundingClientRect().left - el.getBoundingClientRect().left - parseFloat(getComputedStyle(el).paddingLeft);
    el.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  return (
    <div className="carousel" role="group" aria-roledescription="carrusel" aria-label="Pases del evento">
      <ul className="passes__list" ref={track} tabIndex={scrollable ? 0 : undefined}>
        {event.passes.map((pass, i) => (
          <li className={`pass pass--${pass.tone}`} key={pass.id} aria-label={`${pass.name}, ${i + 1} de ${event.passes.length}`}>
            <div className="pass__stub">
              <h4>{pass.name}</h4>
              <p className="pass__price">
                <span>{pass.price}</span>
                <abbr title="Dólares de referencia">REF</abbr>
              </p>
            </div>
            <div className="pass__body">
              <ul>
                {pass.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
              {!over && (
                <a className="btn btn--pass" href={reserveUrl(`Hola, quiero el ${pass.name} para ${event.name}.`)} target="_blank" rel="noreferrer">
                  Reservar {pass.name}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      {scrollable && (
        <div className="carousel__nav">
          <button type="button" className="carousel__arrow" onClick={() => go(active - 1)} disabled={active === 0} aria-label="Pase anterior">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="carousel__dots">
            {event.passes.map((pass, i) => (
              <button
                key={pass.id}
                type="button"
                className={`carousel__dot carousel__dot--${pass.tone}${i === active ? " is-active" : ""}`}
                onClick={() => go(i)}
                aria-label={`Ver ${pass.name}`}
                aria-current={i === active ? "true" : undefined}
              />
            ))}
          </div>
          <button type="button" className="carousel__arrow" onClick={() => go(active + 1)} disabled={active === last} aria-label="Pase siguiente">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function EventSection() {
  const now = useNow(1000);
  const live = now >= event.startsAt && now < event.endsAt;
  const over = now >= event.endsAt;

  return (
    <section className="event" id="evento" aria-labelledby="evento-titulo">
      <div className="event__glow" aria-hidden="true" />
      <div className="wrap">
        <div className="event__top">
          <div className="event__intro">
            <p className="event__kind">
              {event.kind} {event.reason}
            </p>
            <h2 className="event__title" id="evento-titulo">
              <span>Grand Theft</span>
              <span>
                Panter <em>2</em>
              </span>
            </h2>
            <p className="event__tagline">{event.tagline}</p>
          </div>

          <div className="event__when">
            <p className="event__date">{event.dateLabel}</p>
            <p className="event__time">
              {event.timeLabel}, en {site.name}
            </p>
            {live ? (
              <p className="event__state">Está pasando ahora. Si estás cerca, todavía llegas.</p>
            ) : over ? (
              <p className="event__state">
                Ya pasó. Las fotos de la noche y el próximo evento están en{" "}
                <a href={site.instagramUrl} target="_blank" rel="noreferrer">
                  @{site.instagram}
                </a>
                .
              </p>
            ) : (
              <Countdown now={now} />
            )}
          </div>
        </div>

        <NightTimeline now={now} />

        <div className="passes">
          <div className="passes__head">
            <h3>Elige tu pase</h3>
            <p>
              Precios en REF. {over ? "La venta de pases ya cerró." : `Escríbenos por ${reserveChannel} y te confirmamos el tuyo.`}
            </p>
          </div>
          <PassCarousel over={over} />
        </div>
      </div>
    </section>
  );
}
