import { dayNames, hours, reserveChannel, reserveUrl, site } from "../content";
import { formatMinutes, localClock, openStatus, rangeLabel, useNow } from "../time";

// El eje va de 12:00 pm a 12:00 am: cada día es una barra del tamaño de su horario.
const AXIS_START = 12 * 60;
const AXIS_END = 24 * 60;
const AXIS_SPAN = AXIS_END - AXIS_START;
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // de lunes a domingo
const TICKS = [12, 14, 16, 18, 20, 22, 24];

export default function Hours() {
  const now = useNow(30_000);
  const { day, minutes } = localClock(now);
  const status = openStatus(now);
  const needle = minutes >= AXIS_START ? ((minutes - AXIS_START) / AXIS_SPAN) * 100 : null;

  return (
    <section className="hours" id="horario" aria-labelledby="horario-titulo">
      <div className="wrap hours__grid">
        <div>
          <header className="section-head">
            <h2 id="horario-titulo">Horario</h2>
            <p>
              <span className={`status status--inline${status.open ? " status--open" : ""}`}>
                <span className="status__dot" aria-hidden="true" />
                {status.headline}. {status.detail}.
              </span>
            </p>
          </header>

          <div className="week">
            <div className="week__axis" aria-hidden="true">
              {TICKS.map((h) => (
                <span key={h} style={{ left: `${((h * 60 - AXIS_START) / AXIS_SPAN) * 100}%` }}>
                  {formatMinutes(h * 60).replace(":00", "")}
                </span>
              ))}
            </div>
            <ul className="week__rows">
              {ORDER.map((d) => {
                const [open, close] = hours[d];
                const left = ((open - AXIS_START) / AXIS_SPAN) * 100;
                const width = ((close - open) / AXIS_SPAN) * 100;
                const today = d === day;
                return (
                  <li key={d} className={today ? "is-today" : undefined}>
                    <span className="week__day">
                      {dayNames[d]}
                      {today && <em> hoy</em>}
                    </span>
                    <span className="week__lane" aria-hidden="true">
                      <span className="week__bar" style={{ left: `${left}%`, width: `${width}%` }} />
                      {today && needle !== null && <span className="week__needle" style={{ left: `${needle}%` }} />}
                    </span>
                    <span className="week__range">{rangeLabel(d)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="week__note">Hora de Maracaibo.</p>
          </div>
        </div>

        <aside className="visit" aria-labelledby="visita-titulo">
          <h3 id="visita-titulo">Ven a jugar</h3>
          <p>
            Estamos en {site.city}.
            {site.address ? ` ${site.address}.` : " Escríbenos y te pasamos la ubicación exacta."}
          </p>
          <div className="visit__actions">
            <a
              className="btn"
              href={reserveUrl("Hola, quiero ir a Arena Panter. ¿Me pasan la ubicación?")}
              target="_blank"
              rel="noreferrer"
            >
              Escribir por {reserveChannel}
            </a>
            {site.mapsUrl && (
              <a className="btn btn--ghost" href={site.mapsUrl} target="_blank" rel="noreferrer">
                Abrir en Google Maps
              </a>
            )}
          </div>
          <a className="visit__ig" href={site.instagramUrl} target="_blank" rel="noreferrer">
            Instagram: @{site.instagram}
          </a>
        </aside>
      </div>
    </section>
  );
}
