import { KIND_NAMES, TX_LABEL, methodLabel, trpc } from "./api";
import { Notice, Panel, STATE_LABEL, clock, countdown, ref, useNowTick, when } from "./ui";

const SALE_LABEL: Record<string, string> = { ...TX_LABEL, session: "Tiempo de juego", party: "Pago de fiesta" };

// Resumen en vivo: lo que el dueño quiere saber de un vistazo, sin tocar nada. Se actualiza solo cada 5 segundos.
export default function Live({ go }: { go: (tab: "estaciones" | "cocina" | "fiestas" | "cierre") => void }) {
  const live = trpc.office.live.useQuery(undefined, { refetchInterval: 5000 });
  const now = useNowTick(1000);
  const d = live.data;
  if (!d) return live.error ? <Notice>{live.error.message}</Notice> : <p className="empty">Cargando el resumen…</p>;
  const { stations, today, kitchen, parties } = d;
  const share = stations.total ? Math.round((stations.inUse / stations.total) * 100) : 0;
  const kitchenOpen = kitchen.pending + kitchen.preparing + kitchen.ready;

  return (
    <div className="livepage">
      <p className="livepage__stamp" aria-live="off">
        <i className={live.isError ? "is-off" : undefined} /> {live.isError ? "Sin conexión, reintentando" : `En vivo, actualizado a las ${clock(d.at)}`}
      </p>

      <div className="kpis">
        <button type="button" className="kpi kpi--main" onClick={() => go("estaciones")}>
          <span className="kpi__label">Máquinas en uso</span>
          <span className="kpi__value">
            {stations.inUse} <small>de {stations.total}</small>
          </span>
          <span className="kpi__bar" role="img" aria-label={`${share}% en uso`}>
            <span style={{ width: `${share}%` }} />
          </span>
          <span className="kpi__sub">
            {stations.byKind.map((k) => `${KIND_NAMES[k.kind]} ${k.inUse} de ${k.total}`).join(", ")}
            {stations.offline > 0 && `. ${stations.offline} sin conexión`}
          </span>
        </button>
        <button type="button" className="kpi" onClick={() => go("cierre")}>
          <span className="kpi__label">Entró hoy</span>
          <span className="kpi__value">{ref(today.cashInCents)}</span>
          <span className="kpi__sub">
            Caja {ref(today.deskCents)}
            {today.partiesCents > 0 && `, fiestas ${ref(today.partiesCents)}`}
          </span>
        </button>
        <button type="button" className="kpi" onClick={() => go("cierre")}>
          <span className="kpi__label">Vendido del menú</span>
          <span className="kpi__value">{ref(today.menuCents)}</span>
          <span className="kpi__sub">
            {today.orders} {today.orders === 1 ? "orden" : "órdenes"}
          </span>
        </button>
        <button type="button" className="kpi" onClick={() => go("cierre")}>
          <span className="kpi__label">Jugado hoy</span>
          <span className="kpi__value">{ref(today.playedCents)}</span>
          <span className="kpi__sub">
            {today.sessions} {today.sessions === 1 ? "sesión" : "sesiones"}, {today.visits} {today.visits === 1 ? "visita" : "visitas"}
          </span>
        </button>
      </div>

      <div className="livepage__grid">
        <Panel title="Jugando ahora">
          {stations.active.length === 0 ? (
            <p className="empty">Ninguna máquina en uso en este momento.</p>
          ) : (
            <ul className="rows">
              {stations.active.map((s) => (
                <li key={s.id}>
                  <span className="rows__main">
                    <strong>{s.label}</strong>
                    <small>{s.member}</small>
                  </span>
                  <span className={`rows__side${s.state === "gracia" ? " is-warn" : ""}`}>{s.state === "gracia" ? STATE_LABEL.gracia : countdown(s.endsAt - now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Últimas ventas">
          {d.sales.length === 0 ? (
            <p className="empty">Todavía no hay ventas hoy.</p>
          ) : (
            <ul className="rows">
              {d.sales.map((s) => (
                <li key={s.key}>
                  <span className="rows__main">
                    <strong>{SALE_LABEL[s.type] ?? s.type}</strong>
                    <small>
                      {clock(s.at)}, {s.who}
                    </small>
                  </span>
                  <span className="rows__side">{ref(s.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Cocina"
          action={
            <button className="app__link" type="button" onClick={() => go("cocina")}>
              Ver comandas
            </button>
          }
        >
          {kitchenOpen === 0 ? (
            <p className="empty">Sin comandas pendientes.</p>
          ) : (
            <dl className="stats">
              <div>
                <dt>Por preparar</dt>
                <dd>{kitchen.pending}</dd>
              </div>
              <div>
                <dt>En preparación</dt>
                <dd>{kitchen.preparing}</dd>
              </div>
              <div>
                <dt>Listas</dt>
                <dd>{kitchen.ready}</dd>
              </div>
            </dl>
          )}
        </Panel>

        <Panel
          title="Fiestas"
          action={
            <button className="app__link" type="button" onClick={() => go("fiestas")}>
              Ver cotizaciones
            </button>
          }
        >
          <dl className="stats">
            <div>
              <dt>Enviadas, sin respuesta</dt>
              <dd>{parties.waiting}</dd>
            </div>
            <div>
              <dt>Aprobadas por agendar</dt>
              <dd>{parties.toSchedule}</dd>
            </div>
            <div>
              <dt>Agendadas</dt>
              <dd>{parties.scheduled}</dd>
            </div>
          </dl>
          {parties.next.length > 0 && (
            <ul className="rows">
              {parties.next.map((q) => (
                <li key={q.id}>
                  <span className="rows__main">
                    <strong>{q.customerName}</strong>
                    <small>
                      {q.eventAt ? when(q.eventAt) : ""}, {q.guests} invitados
                    </small>
                  </span>
                  <span className="rows__side">{q.paidCents >= q.totalCents ? "Pagada" : `Falta ${ref(q.totalCents - q.paidCents)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {today.byMethod.length > 0 && (
          <Panel title="Cómo pagaron hoy">
            <ul className="rows">
              {today.byMethod.map((m) => (
                <li key={m.method}>
                  <span className="rows__main">
                    <strong>{methodLabel(m.method) || "Sin método"}</strong>
                    <small>
                      {m.count} {m.count === 1 ? "pago" : "pagos"}
                    </small>
                  </span>
                  <span className="rows__side">{ref(m.totalCents)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
