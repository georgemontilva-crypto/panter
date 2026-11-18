import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KIND_NAMES, METHODS, ORDER_PROGRESS, ROLE_LABEL, TX_LABEL, canUseDesk, creditMinutes, isSenior, methodLabel, priceOf, trpc, type BoardStation, type MethodId, type OrderRow, type Role, type StationKind } from "./api";
import { Field, MemberCard, Notice, Panel, STATE_LABEL, Shell, clock, countdown, duration, parseMoney, ref, useNowTick, when } from "./ui";

const Admin = lazy(() => import("./Admin"));
const Kitchen = lazy(() => import("./Kitchen"));
const Live = lazy(() => import("./Live"));
const Parties = lazy(() => import("./Parties"));
const Purchases = lazy(() => import("./Purchases"));
// El lector de QR se descarga solo cuando se abre la cámara.
const Scanner = lazy(() => import("./Scanner"));
const KINDS: StationKind[] = ["pc", "ps5", "switch", "sim"];
const STAFF_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

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

// ---------- Cobrar del menú con el saldo ----------
function MenuSale({ userId, balanceCents, orders }: { userId: number; balanceCents: number; orders: OrderRow[] }) {
  const utils = trpc.useUtils();
  const menu = trpc.member.menu.useQuery(undefined, { staleTime: 30_000 });
  const [cart, setCart] = useState<Record<number, number>>({});
  const [note, setNote] = useState("");
  const refresh = { onSuccess: () => utils.staff.invalidate() };
  const sell = trpc.staff.sell.useMutation({
    onSuccess: () => {
      setCart({});
      setNote("");
      return utils.staff.invalidate();
    },
  });
  const refund = trpc.staff.refundOrder.useMutation(refresh);

  const items = menu.data ?? [];
  const categories = [...new Set(items.map((p) => p.category))];
  const lines = items.filter((p) => cart[p.id] > 0);
  const total = lines.reduce((sum, p) => sum + p.priceCents * cart[p.id], 0);
  const missing = total - balanceCents;
  const change = (id: number, delta: number) => {
    sell.reset();
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(50, (c[id] ?? 0) + delta)) }));
  };

  return (
    <Panel title="Cobrar del menú" className="sale">
      {menu.data && items.length === 0 ? (
        <p className="empty">El menú está vacío. Un administrador agrega los productos en Ajustes.</p>
      ) : (
        <>
          {categories.map((category) => (
            <div className="sale__group" key={category}>
              <h3>{category}</h3>
              <ul className="sale__items">
                {items
                  .filter((p) => p.category === category)
                  .map((p) => {
                    const qty = cart[p.id] ?? 0;
                    return (
                      <li key={p.id} className={qty ? "is-picked" : undefined}>
                        <button type="button" className="sale__add" onClick={() => change(p.id, 1)} aria-label={`Agregar ${p.name}`}>
                          <span className="sale__name">{p.name}</span>
                          <span className="sale__price">{ref(p.priceCents)}</span>
                        </button>
                        {qty > 0 && (
                          <span className="sale__qty">
                            <button type="button" onClick={() => change(p.id, -1)} aria-label={`Quitar un ${p.name}`}>
                              −
                            </button>
                            <strong aria-label={`${qty} en el pedido`}>{qty}</strong>
                            <button type="button" onClick={() => change(p.id, 1)} aria-label={`Agregar otro ${p.name}`}>
                              +
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}

          {lines.length > 0 && (
            <div className="sale__summary">
              <ul>
                {lines.map((p) => (
                  <li key={p.id}>
                    <span>
                      {cart[p.id]} x {p.name}
                    </span>
                    <span>{ref(p.priceCents * cart[p.id])}</span>
                  </li>
                ))}
              </ul>
              <p className="sale__total">
                <span>Total</span>
                <strong>{ref(total)}</strong>
              </p>
              <Field label="Nota para cocina (opcional)">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={160} placeholder="Sin cebolla, para llevar…" />
              </Field>
              {missing > 0 ? (
                <Notice>Saldo insuficiente: le faltan {ref(missing)}. Recarga primero o quita algo del pedido.</Notice>
              ) : (
                <p className="form__lead">Después de cobrar le quedan {ref(balanceCents - total)}.</p>
              )}
            </div>
          )}
          <Notice>{sell.error?.message ?? refund.error?.message}</Notice>
          {sell.isSuccess && lines.length === 0 && (
            <Notice kind="ok">
              Orden #{sell.data.orderId} cobrada: {ref(sell.data.totalCents)}. Saldo nuevo: {ref(sell.data.balanceCents)}.
              {sell.data.toKitchen && " La comanda ya está en cocina."}
            </Notice>
          )}
          <button
            className="btn"
            type="button"
            disabled={sell.isPending || lines.length === 0 || missing > 0}
            onClick={() => sell.mutate({ userId, note, items: lines.map((p) => ({ productId: p.id, qty: cart[p.id] })) })}
          >
            {lines.length ? `Cobrar ${ref(total)} del saldo` : "Elige los productos del pedido"}
          </button>
        </>
      )}

      {orders.length > 0 && (
        <div className="sale__orders">
          <h3>Últimas órdenes</h3>
          <ul>
            {orders.slice(0, 4).map((o) => (
              <li key={o.id}>
                <span>
                  <strong>#{o.id}</strong> {o.items.map((i) => (i.qty > 1 ? `${i.qty} x ${i.name}` : i.name)).join(", ")}
                  <small>
                    {when(o.createdAt)}, {ref(o.totalCents)}
                    {o.status === "refunded" ? ", anulada" : ORDER_PROGRESS[o.kitchenStatus] ? `, ${ORDER_PROGRESS[o.kitchenStatus].toLowerCase()}` : ""}
                  </small>
                </span>
                {o.status === "paid" && (
                  <button
                    type="button"
                    className="app__link"
                    disabled={refund.isPending}
                    onClick={() => {
                      if (window.confirm(`¿Anular la orden #${o.id} y devolver ${ref(o.totalCents)} al saldo?`)) refund.mutate({ orderId: o.id });
                    }}
                  >
                    Anular
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
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
  const me = trpc.auth.me.useQuery(undefined, { retry: false });

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<MethodId>("efectivo_usd");
  const [reference, setReference] = useState("");
  const [stationId, setStationId] = useState(0);
  const [minutes, setMinutes] = useState(60);
  const now = useNowTick();

  const m = member.data;
  if (!m) return <Panel>{member.error ? <Notice>{member.error.message}</Notice> : <p className="empty">Cargando cliente…</p>}</Panel>;

  const amountCents = parseMoney(amount);
  // Solo se ofrecen los tiempos que terminan antes del cierre.
  const durations = STAFF_DURATIONS.filter((d) => d <= m.closing.maxMinutes);
  const playMinutes = durations.includes(minutes) ? minutes : (durations[durations.length - 1] ?? 0);
  const free = board.data?.filter((s) => s.enabled && !s.session) ?? [];
  const station = free.find((s) => s.id === stationId);
  // El tiempo a favor del cliente en ese tipo de máquina se gasta primero; solo se cobra lo que falte.
  const price = station ? priceOf(m.rates[station.kind], playMinutes, creditMinutes(m.timeCredits, station.kind)) : { fromCredit: 0, costCents: 0 };
  const cost = price.costCents;

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
          {m.timeCredits.map((c) => (
            <div key={c.kind}>
              <dt>A favor en {KIND_NAMES[c.kind]}</dt>
              <dd>{duration(c.minutes)}</dd>
            </div>
          ))}
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
            {Math.round((s.endsAt - now) / 60_000) > 0 ? `Terminar y guardarle ${duration(Math.round((s.endsAt - now) / 60_000))} a favor` : "Terminar"}
          </button>
        </Panel>
      ))}
      {end.isSuccess && end.data.savedMinutes > 0 && <Notice kind="ok">Sesión terminada. Se le guardaron {duration(end.data.savedMinutes)} a favor para otro día; no se devolvió dinero.</Notice>}
      {end.error && <Notice>{end.error.message}</Notice>}

      <div className="detail__grid">
        <MenuSale userId={m.id} balanceCents={m.balanceCents} orders={m.orders} />

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
              if (station && playMinutes) start.mutate({ userId: m.id, stationId: station.id, minutes: playMinutes }, { onSuccess: () => setStationId(0) });
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
              <select value={playMinutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={durations.length === 0}>
                {durations.map((d) => (
                  <option key={d} value={d}>
                    {duration(d)}
                  </option>
                ))}
              </select>
            </Field>
            {durations.length === 0 ? (
              <Notice kind="info">
                {m.closing.maxMinutes > 0 ? `Cerramos a las ${clock(m.closing.closesAt)}: ya no alcanza el tiempo para una sesión.` : "La arena está cerrada a esta hora. Para una noche especial, extiende el cierre en Ajustes."}
              </Notice>
            ) : (
              durations.length < STAFF_DURATIONS.length && <p className="form__lead">Hoy cerramos a las {clock(m.closing.closesAt)}: solo aparecen los tiempos que terminan antes.</p>
            )}
            {station && playMinutes > 0 && (
              <p className="form__lead">
                {price.fromCredit === playMinutes
                  ? `No se cobra nada: usa ${duration(price.fromCredit)} de su tiempo a favor.`
                  : `${price.fromCredit ? `Usa ${duration(price.fromCredit)} de su tiempo a favor. ` : ""}Se descuentan ${ref(cost)}. Le quedan ${ref(Math.max(0, m.balanceCents - cost))}.`}
              </p>
            )}
            <Notice>{start.error?.message}</Notice>
            <button className="btn" type="submit" disabled={start.isPending || !station || !playMinutes}>
              {station && playMinutes ? `Activar ${station.label} por ${duration(playMinutes)}` : "Activar estación"}
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
                    {t.type === "card_sale" ? ref(t.paidCents) : t.type === "time" ? "" : t.type === "session" && !t.amountCents ? "Sin costo" : ref(t.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {me.data && isSenior(me.data.role) && <TimeAdjust userId={m.id} />}
      </div>
    </div>
  );
}

// Corrección del tiempo a favor: solo administradores. Sirve para arreglar una sesión que se abrió o cerró por error.
function TimeAdjust({ userId }: { userId: number }) {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<StationKind>("pc");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const adjust = trpc.admin.adjustTime.useMutation({
    onSuccess: () => {
      setMinutes("");
      setNote("");
      return utils.staff.invalidate();
    },
  });
  const value = Math.trunc(Number(minutes.replace(",", ".")));
  return (
    <Panel title="Corregir tiempo a favor">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) adjust.mutate({ userId, kind, minutes: value, note });
        }}
      >
        <div className="form__pair">
          <Field label="Tipo de máquina">
            <select value={kind} onChange={(e) => setKind(e.target.value as StationKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_NAMES[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Minutos" hint="Para quitar, en negativo: -30.">
            <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="text" placeholder="30" required />
          </Field>
        </div>
        <Field label="Motivo">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Se le cerró la sesión por error" required />
        </Field>
        <Notice>{adjust.error?.message ?? (minutes && !value ? "Escribe los minutos en números, por ejemplo 30 o -30." : null)}</Notice>
        {adjust.isSuccess && <Notice kind="ok">Listo. Le quedan {duration(adjust.data.minutes)} a favor en ese tipo de máquina.</Notice>}
        <button className="btn btn--ghost btn--small" type="submit" disabled={adjust.isPending || !value}>
          Aplicar corrección
        </button>
      </form>
    </Panel>
  );
}

// ---------- Clientes ----------
function Clients() {
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
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
            <Field label="Buscar cliente" hint="Escribe nombre, teléfono o código. Con un lector USB, escanea la tarjeta aquí.">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nombre, teléfono o código" enterKeyHint="search" />
            </Field>
            <div className="form__pair">
              <button className="btn" type="submit">
                Buscar
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => setScanning(true)}>
                Escanear con la cámara
              </button>
            </div>
          </form>
          {scanning && (
            <Suspense fallback={null}>
              <Scanner
                title="Escanear tarjeta"
                hint="Apunta al QR de la tarjeta del cliente."
                onClose={() => setScanning(false)}
                onResult={(value) => {
                  setScanning(false);
                  setText(value.trim());
                  setSelected(null);
                  setQ(value.trim());
                }}
              />
            </Suspense>
          )}
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
                <dt>Entró en total</dt>
                <dd>{ref(d.cashInCents)}</dd>
              </div>
              <div>
                <dt>Recargas y tarjetas</dt>
                <dd>{ref(d.deskCents)}</dd>
              </div>
              <div>
                <dt>Pagos de fiestas</dt>
                <dd>{ref(d.partiesCents)}</dd>
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
                <dt>Vendido del menú</dt>
                <dd>{ref(d.menuCents)}</dd>
              </div>
              <div>
                <dt>Tarjetas</dt>
                <dd>{d.cardsSold}</dd>
              </div>
            </dl>
            {d.byMethod.length > 0 && (
              <div className="table-wrap">
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
              </div>
            )}
          </>
        )}
      </Panel>
      {d && (
        <>
          {d.partyPayments.length > 0 && (
            <Panel title="Pagos de fiestas del día">
              <ul className="rows">
                {d.partyPayments.map((p) => (
                  <li key={p.id}>
                    <span className="rows__main">
                      <strong>
                        {p.code}, {p.customer}
                      </strong>
                      <small>
                        {clock(p.createdAt)}, {methodLabel(p.method)}, lo recibió {p.staff}
                      </small>
                    </span>
                    <span className="rows__side">{ref(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
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
        </>
      )}
    </div>
  );
}

// ---------- Entrada del personal ----------
function StaffLogin() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ user: "", password: "" });
  const login = trpc.auth.login.useMutation({ onSuccess: () => utils.invalidate() });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ identifier: form.user, password: form.password, area: "staff" });
  };
  return (
    <div className="staff-auth">
      <Panel title="Acceso del personal">
        <p className="panel__lead">Para cajeros y administradores de Arena Panter.</p>
        <form className="form" onSubmit={submit}>
          <Field label="Teléfono o correo">
            <input
              value={form.user}
              onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </Field>
          <Field label="Contraseña">
            <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} type="password" autoComplete="current-password" required />
          </Field>
          <Notice>{login.error?.message}</Notice>
          <button className="btn" type="submit" disabled={login.isPending}>
            Entrar al panel
          </button>
        </form>
        <p className="auth__other">
          ¿Eres cliente? <Link to="/cuenta">Entra a tu cuenta</Link>.
        </p>
      </Panel>
    </div>
  );
}

// ---------- Panel ----------
type Tab = "resumen" | "clientes" | "estaciones" | "cocina" | "fiestas" | "compras" | "cierre" | "ajustes";

// Qué secciones ve cada tipo de usuario. El servidor aplica los mismos permisos: esto solo decide qué se muestra.
const TABS: { id: Tab; label: string; for: Role[] }[] = [
  { id: "resumen", label: "Resumen", for: ["owner", "admin"] },
  { id: "clientes", label: "Clientes", for: ["owner", "admin", "cashier"] },
  { id: "estaciones", label: "Máquinas", for: ["owner", "admin", "cashier"] },
  { id: "cocina", label: "Cocina", for: ["owner", "admin", "cashier", "kitchen"] },
  { id: "fiestas", label: "Fiestas", for: ["owner", "admin"] },
  { id: "compras", label: "Compras", for: ["owner", "admin"] },
  { id: "cierre", label: "Cierre", for: ["owner", "admin"] },
  { id: "ajustes", label: "Ajustes", for: ["owner", "admin"] },
];

export default function Staff() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.invalidate() });
  const [picked, setPicked] = useState<Tab | null>(null);

  if (me.isLoading) return <Shell title="Personal">{<p className="empty">Cargando…</p>}</Shell>;
  if (!me.data) {
    return (
      <Shell title="Personal">
        <StaffLogin />
      </Shell>
    );
  }
  if (me.data.role === "member") {
    return (
      <Shell title="Personal">
        <div className="staff-auth">
          <Panel title="Entraste como cliente">
            <p className="panel__lead">
              Esta sección es solo para el personal de la arena y la sesión abierta es la de {me.data.name}, una cuenta de cliente.
            </p>
            <div className="staff-auth__actions">
              <Link className="btn" to="/cuenta">
                Ir a mi cuenta
              </Link>
              <button className="btn btn--ghost" type="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
                Salir y entrar como personal
              </button>
            </div>
          </Panel>
        </div>
      </Shell>
    );
  }

  const role = me.data.role;
  const tabs = TABS.filter((t) => t.for.includes(role));
  // Cada quien abre en lo suyo: el dueño en el resumen, la operadora en clientes, cocina en sus comandas.
  const tab = picked && tabs.some((t) => t.id === picked) ? picked : tabs[0].id;
  const go = (next: Tab) => {
    setPicked(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <Shell
      title={role === "kitchen" ? "Cocina" : canUseDesk(role) && !isSenior(role) ? "Caja" : "Panel"}
      right={
        <>
          <span className="app__user">
            {me.data.name}
            <small>{ROLE_LABEL[role]}</small>
          </span>
          <button className="app__link" type="button" onClick={() => logout.mutate()}>
            Salir
          </button>
        </>
      }
    >
      {tabs.length > 1 && (
        <div className="tabs tabs--page" role="tablist" aria-label="Secciones del panel">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : undefined} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <Suspense fallback={<p className="empty">Cargando…</p>}>
        {tab === "resumen" && <Live go={go} />}
        {tab === "clientes" && <Clients />}
        {tab === "estaciones" && <Stations />}
        {tab === "cocina" && <Kitchen />}
        {tab === "fiestas" && <Parties />}
        {tab === "compras" && <Purchases />}
        {tab === "cierre" && <Day />}
        {tab === "ajustes" && <Admin />}
      </Suspense>
    </Shell>
  );
}
