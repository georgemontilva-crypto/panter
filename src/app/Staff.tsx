import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KIND_NAMES, METHODS, TX_LABEL, methodLabel, trpc, type BoardStation, type MethodId, type StationKind } from "./api";
import { Field, MemberCard, Notice, Panel, STATE_LABEL, Shell, clock, countdown, duration, parseMoney, ref, useNowTick, when } from "./ui";

const Admin = lazy(() => import("./Admin"));
const KINDS: StationKind[] = ["pc", "ps5", "switch", "sim"];
const STAFF_DURATIONS = [30, 60, 90, 120, 180, 240];

function MethodSelect({ value, onChange }: { value: MethodId; onChange: (m: MethodId) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as MethodId)}>
      {METHODS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

// ---------- Ficha del cliente ----------
function MemberDetail({ id }: { id: number }) {
  const utils = trpc.useUtils();
  const member = trpc.staff.member.useQuery({ id }, { refetchInterval: 8000 });
  const board = trpc.staff.board.useQuery(undefined, { refetchInterval: 5000 });
  const refresh = { onSuccess: () => Promise.all([utils.staff.invalidate()]) };
  const topup = trpc.staff.topup.useMutation(refresh);
  const sellCard = trpc.staff.sellCard.useMutation(refresh);
  const checkin = trpc.staff.checkin.useMutation(refresh);
  const start = trpc.staff.start.useMutation(refresh);
  const end = trpc.staff.end.useMutation(refresh);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<MethodId>("efectivo_usd");
  const [reference, setReference] = useState("");
  const [stationId, setStationId] = useState(0);
  const [minutes, setMinutes] = useState(60);
  const now = useNowTick();

  const m = member.data;
  if (!m) return <Panel>{member.error ? <Notice>{member.error.message}</Notice> : <p className="empty">Cargando cliente…</p>}</Panel>;

  const amountCents = parseMoney(amount);
  const free = board.data?.filter((s) => s.enabled && !s.session) ?? [];
  const station = free.find((s) => s.id === stationId);
  const cost = station ? Math.round((m.rates[station.kind] * minutes) / 60) : 0;

  const submitTopup = (e: FormEvent) => {
    e.preventDefault();
    if (amountCents === null) return;
    topup.mutate(
      { userId: m.id, amountCents, method, reference: reference || undefined },
      {
        onSuccess: () => {
          setAmount("");
          setReference("");
        },
      },
    );
  };

  return (
    <div className="detail">
      <Panel className="detail__head">
        <div>
          <h2>{m.name}</h2>
          <p className="detail__meta">
            {m.memberCode} · {m.phone} · Nivel {m.level.current.name}
            {!m.hasPassword && " · Sin cuenta web todavía"}
          </p>
        </div>
        <dl className="stats">
          <div>
            <dt>Saldo</dt>
            <dd>{ref(m.balanceCents)}</dd>
          </div>
          <div>
            <dt>Visitas</dt>
            <dd>{m.visitsCount}</dd>
          </div>
        </dl>
      </Panel>

      {m.sessions.map((s) => (
        <Panel key={s.id} className="detail__live">
          <p>
            <strong>
              Jugando en {s.kind === "pc" ? "PC" : KIND_NAMES[s.kind]} {String(s.number).padStart(2, "0")}
            </strong>{" "}
            {now < s.endsAt ? `Quedan ${countdown(s.endsAt - now)}` : `Tiempo extra: ${countdown(s.graceEndsAt - now)}`}
          </p>
          <button className="btn btn--ghost btn--small" type="button" disabled={end.isPending} onClick={() => end.mutate({ sessionId: s.id })}>
            Terminar y devolver lo no usado
          </button>
        </Panel>
      ))}

      <div className="detail__grid">
        <Panel title="Recargar saldo">
          <form className="form" onSubmit={submitTopup}>
            <Field label="Monto en REF">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="5,00" required />
            </Field>
            <Field label="Forma de pago">
              <MethodSelect value={method} onChange={setMethod} />
            </Field>
            {method !== "efectivo_usd" && method !== "efectivo_bs" && (
              <Field label="Referencia (opcional)">
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
              </Field>
            )}
            <Notice>{topup.error?.message ?? (amount && amountCents === null ? "Escribe el monto así: 5 o 5,50." : null)}</Notice>
            {topup.isSuccess && <Notice kind="ok">Recarga registrada. Saldo nuevo: {ref(topup.data.balanceCents)}.</Notice>}
            <button className="btn" type="submit" disabled={topup.isPending || amountCents === null}>
              Recargar {amountCents ? ref(amountCents) : ""}
            </button>
          </form>
        </Panel>

        <Panel title="Poner a jugar">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (station) start.mutate({ userId: m.id, stationId: station.id, minutes }, { onSuccess: () => setStationId(0) });
            }}
          >
            <Field label="Estación libre">
              <select value={stationId} onChange={(e) => setStationId(Number(e.target.value))} required>
                <option value={0}>Elige una estación</option>
                {KINDS.map((kind) => {
                  const list = free.filter((s) => s.kind === kind);
                  if (!list.length) return null;
                  return (
                    <optgroup key={kind} label={KIND_NAMES[kind]}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                          {s.state === "sin_conexion" ? " (sin conexión)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </Field>
            <Field label="Tiempo">
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {STAFF_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {duration(d)}
                  </option>
                ))}
              </select>
            </Field>
            {station && <p className="form__lead">Se descuentan {ref(cost)}. Le quedan {ref(Math.max(0, m.balanceCents - cost))}.</p>}
            <Notice>{start.error?.message}</Notice>
            <button className="btn" type="submit" disabled={start.isPending || !station}>
              {station ? `Activar ${station.label} por ${duration(minutes)}` : "Activar estación"}
            </button>
          </form>
        </Panel>

        <Panel title="Tarjeta y visita">
          <div className="card-actions">
            <div className="print-area">
              <MemberCard name={m.name} code={m.memberCode} qr={m.cardQr} />
            </div>
            <div className="form">
              {m.hasCard ? (
                <p className="form__lead">Tarjeta comprada.</p>
              ) : (
                <>
                  <Field label={`Vender tarjeta (${ref(m.cardPriceCents)})`}>
                    <MethodSelect value={method} onChange={setMethod} />
                  </Field>
                  <button className="btn btn--small" type="button" disabled={sellCard.isPending} onClick={() => sellCard.mutate({ userId: m.id, method })}>
                    Registrar venta de tarjeta
                  </button>
                </>
              )}
              <button className="btn btn--ghost btn--small" type="button" onClick={() => window.print()}>
                Imprimir tarjeta
              </button>
              <button className="btn btn--ghost btn--small" type="button" disabled={checkin.isPending} onClick={() => checkin.mutate({ userId: m.id })}>
                Marcar visita de hoy
              </button>
              <Notice>{sellCard.error?.message ?? checkin.error?.message}</Notice>
              {checkin.isSuccess && <Notice kind="ok">{checkin.data.isNew ? "Visita registrada." : "La visita de hoy ya estaba registrada."}</Notice>}
            </div>
          </div>
        </Panel>

        <Panel title="Movimientos">
          {m.tx.length === 0 ? (
            <p className="empty">Sin movimientos todavía.</p>
          ) : (
            <ul className="moves">
              {m.tx.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <span className="moves__what">
                    {TX_LABEL[t.type]}
                    <small>
                      {when(t.createdAt)}
                      {t.type === "card_sale" ? ", pagada en caja" : t.note ? `, ${t.note}` : ""}
                    </small>
                  </span>
                  <span className={`moves__amount${t.amountCents > 0 ? " is-plus" : ""}`}>
                    {t.amountCents > 0 ? "+" : ""}
                    {t.type === "card_sale" ? ref(t.paidCents) : ref(t.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------- Clientes ----------
function Clients() {
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const results = trpc.staff.find.useQuery({ q }, { enabled: q.length >= 2 });
  const create = trpc.staff.createMember.useMutation({
    onSuccess: (data) => {
      setSelected(data.id);
      setCreating(false);
      setForm({ name: "", phone: "" });
      return utils.staff.invalidate();
    },
  });

  // Con una sola coincidencia (por ejemplo al escanear el QR) se abre la ficha directo.
  const only = results.data?.length === 1 ? results.data[0].id : null;
  const current = selected ?? only;

  return (
    <div className="clients">
      <div className="clients__side">
        <Panel>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              setSelected(null);
              setQ(text.trim());
            }}
          >
            <Field label="Buscar cliente" hint="Escanea el QR de la tarjeta, o escribe nombre, teléfono o código.">
              <input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Escanea o escribe y pulsa Enter" />
            </Field>
            <button className="btn btn--small" type="submit">
              Buscar
            </button>
          </form>
          {q.length >= 2 && results.data && results.data.length === 0 && <p className="empty">Nadie coincide con “{q}”. Revisa el dato o registra al cliente.</p>}
          {results.data && results.data.length > 1 && (
            <ul className="results">
              {results.data.map((r) => (
                <li key={r.id}>
                  <button type="button" className={r.id === current ? "is-active" : undefined} onClick={() => setSelected(r.id)}>
                    <strong>{r.name}</strong>
                    <span>
                      {r.memberCode} · {r.phone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Cliente nuevo" action={!creating && <button className="app__link" type="button" onClick={() => setCreating(true)}>Registrar</button>}>
          {creating ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(form);
              }}
            >
              <Field label="Nombre y apellido">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label="Teléfono" hint="Si es menor de edad, el de su representante.">
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} type="tel" placeholder="0414 1234567" required />
              </Field>
              <Notice>{create.error?.message}</Notice>
              <button className="btn btn--small" type="submit" disabled={create.isPending}>
                Registrar y generar su QR
              </button>
            </form>
          ) : (
            <p className="form__lead">Al registrarlo se genera su código y su QR únicos.</p>
          )}
        </Panel>
      </div>

      <div className="clients__main">{current ? <MemberDetail key={current} id={current} /> : <p className="empty empty--big">Escanea una tarjeta o busca un cliente para ver su saldo, recargar o ponerlo a jugar.</p>}</div>
    </div>
  );
}

// ---------- Estaciones ----------
function StationTile({ s, now }: { s: BoardStation; now: number }) {
  const utils = trpc.useUtils();
  const refresh = { onSuccess: () => utils.staff.invalidate() };
  const extend = trpc.staff.extend.useMutation(refresh);
  const end = trpc.staff.end.useMutation(refresh);
  const session = s.session;
  return (
    <li className={`tile tile--${s.state}`}>
      <div className="tile__top">
        <span className="tile__label">{s.label}</span>
        <span className="tile__state">{STATE_LABEL[s.state]}</span>
      </div>
      {session ? (
        <>
          <p className="tile__clock">{countdown((now < session.endsAt ? session.endsAt : session.graceEndsAt) - now)}</p>
          <p className="tile__who">
            {session.memberName} · termina {clock(session.endsAt)}
          </p>
          <div className="tile__actions">
            <button type="button" disabled={extend.isPending} onClick={() => extend.mutate({ sessionId: session.id, minutes: 30 })}>
              +30 min
            </button>
            <button type="button" disabled={end.isPending} onClick={() => end.mutate({ sessionId: session.id })}>
              Terminar
            </button>
          </div>
          <Notice>{extend.error?.message ?? end.error?.message}</Notice>
        </>
      ) : (
        <p className="tile__who">{s.note ?? (s.kind === "pc" && !s.hasAgent ? "Falta instalar el programa de bloqueo" : "")}</p>
      )}
    </li>
  );
}

function Stations() {
  const board = trpc.staff.board.useQuery(undefined, { refetchInterval: 4000 });
  const now = useNowTick();
  if (!board.data) return <p className="empty">Cargando estaciones…</p>;
  if (board.data.length === 0) return <p className="empty empty--big">Todavía no hay estaciones. Un administrador las crea en Ajustes.</p>;
  return (
    <div className="board">
      {KINDS.map((kind) => {
        const list = board.data.filter((s) => s.kind === kind);
        if (!list.length) return null;
        return (
          <Panel key={kind} title={KIND_NAMES[kind]}>
            <ul className="tiles">
              {list.map((s) => (
                <StationTile key={s.id} s={s} now={now} />
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

// ---------- Cierre del día ----------
function Day() {
  const [day, setDay] = useState("");
  const report = trpc.staff.day.useQuery({ day: day || undefined }, { refetchInterval: 15_000 });
  const d = report.data;
  return (
    <div className="day">
      <Panel
        title="Cierre del día"
        action={
          <Field label="Día">
            <input type="date" value={day || d?.day || ""} onChange={(e) => setDay(e.target.value)} />
          </Field>
        }
      >
        {!d ? (
          <p className="empty">Cargando…</p>
        ) : (
          <>
            <dl className="stats stats--wide">
              <div>
                <dt>Entró a caja</dt>
                <dd>{ref(d.cashInCents)}</dd>
              </div>
              <div>
                <dt>Jugado</dt>
                <dd>{ref(d.playedCents)}</dd>
              </div>
              <div>
                <dt>Sesiones</dt>
                <dd>{d.sessions}</dd>
              </div>
              <div>
                <dt>Visitas</dt>
                <dd>{d.visits}</dd>
              </div>
              <div>
                <dt>Clientes nuevos</dt>
                <dd>{d.newMembers}</dd>
              </div>
              <div>
                <dt>Tarjetas</dt>
                <dd>{d.cardsSold}</dd>
              </div>
            </dl>
            {d.byMethod.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Forma de pago</th>
                    <th>Operaciones</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byMethod.map((r) => (
                    <tr key={r.method ?? "x"}>
                      <td>{methodLabel(r.method) || "Sin método"}</td>
                      <td>{r.count}</td>
                      <td className="num">{ref(r.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Panel>
      {d && (
        <Panel title="Movimientos del día">
          {d.moves.length === 0 ? (
            <p className="empty">No hubo movimientos este día.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Cliente</th>
                    <th>Movimiento</th>
                    <th>Pago</th>
                    <th>Cajero</th>
                    <th className="num">Saldo</th>
                    <th className="num">Caja</th>
                  </tr>
                </thead>
                <tbody>
                  {d.moves.map((m) => (
                    <tr key={m.id}>
                      <td>{clock(m.createdAt)}</td>
                      <td>{m.member}</td>
                      <td>
                        {TX_LABEL[m.type]}
                        {m.note && <small> {m.note}</small>}
                      </td>
                      <td>{methodLabel(m.method)}</td>
                      <td>{m.staff}</td>
                      <td className="num">{m.amountCents ? ref(m.amountCents) : ""}</td>
                      <td className="num">{m.paidCents ? ref(m.paidCents) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

// ---------- Panel ----------
type Tab = "clientes" | "estaciones" | "cierre" | "ajustes";

export default function Staff() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.invalidate() });
  const [tab, setTab] = useState<Tab>("clientes");

  if (me.isLoading) return <Shell title="Caja">{<p className="empty">Cargando…</p>}</Shell>;
  if (!me.data || me.data.role === "member") {
    return (
      <Shell title="Caja">
        <p className="empty empty--big">
          Esta sección es solo para el personal de la arena.{" "}
          <Link to="/cuenta">{me.data ? "Volver a mi cuenta" : "Inicia sesión con tu usuario de caja"}</Link>.
        </p>
      </Shell>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "clientes", label: "Clientes" },
    { id: "estaciones", label: "Estaciones" },
    { id: "cierre", label: "Cierre" },
    ...(me.data.role === "admin" ? [{ id: "ajustes" as Tab, label: "Ajustes" }] : []),
  ];

  return (
    <Shell
      title="Caja"
      right={
        <>
          <span className="app__user">{me.data.name}</span>
          <button className="app__link" type="button" onClick={() => logout.mutate()}>
            Salir
          </button>
        </>
      }
    >
      <div className="tabs tabs--page" role="tablist" aria-label="Secciones del panel">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "clientes" && <Clients />}
      {tab === "estaciones" && <Stations />}
      {tab === "cierre" && <Day />}
      {tab === "ajustes" && (
        <Suspense fallback={<p className="empty">Cargando…</p>}>
          <Admin />
        </Suspense>
      )}
    </Shell>
  );
}
