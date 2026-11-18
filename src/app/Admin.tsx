import { useEffect, useState } from "react";
import { KIND_NAMES, ROLE_ABOUT, ROLE_LABEL, trpc, type Config, type Role, type StationKind } from "./api";
import { Badge, Field, Notice, Panel, STATE_LABEL, money, parseMoney, ref, when } from "./ui";

const KINDS: StationKind[] = ["pc", "ps5", "switch", "sim"];
const DAYS = [
  { day: 1, name: "Lunes" },
  { day: 2, name: "Martes" },
  { day: 3, name: "Miércoles" },
  { day: 4, name: "Jueves" },
  { day: 5, name: "Viernes" },
  { day: 6, name: "Sábado" },
  { day: 0, name: "Domingo" },
];

// Horario: minutos desde la medianoche ↔ "HH:MM". El cierre a medianoche se guarda como 1440.
const toTime = (minutes: number) => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fromTime = (value: string, isClose: boolean) => {
  const [h, m] = value.split(":").map(Number);
  const total = h * 60 + m;
  return isClose && total === 0 ? 1440 : total;
};
// Fecha y hora de Maracaibo (UTC-4) ↔ milisegundos UTC, para el campo datetime-local.
const CARACAS_MS = 4 * 60 * 60 * 1000;
const toLocalInput = (ms: number | null) => (ms ? new Date(ms - CARACAS_MS).toISOString().slice(0, 16) : "");
const fromLocalInput = (value: string) => (value ? Date.parse(`${value}:00Z`) + CARACAS_MS : null);

// ---------- Tarifas y reglas ----------
function ConfigForm({ config }: { config: Config }) {
  const utils = trpc.useUtils();
  const save = trpc.admin.saveConfig.useMutation({ onSuccess: () => utils.staff.config.invalidate() });
  const [rates, setRates] = useState(() => Object.fromEntries(KINDS.map((k) => [k, money(config.rates[k])])) as Record<StationKind, string>);
  const [card, setCard] = useState(money(config.cardPriceCents));
  const [bonus, setBonus] = useState(money(config.loyaltyBonusCents));
  const [grace, setGrace] = useState(config.graceMinutes);
  const [every, setEvery] = useState(config.loyaltyEvery);
  const [refund, setRefund] = useState(config.refundOnEarlyEnd);
  const [levels, setLevels] = useState(config.levels);
  const [hours, setHours] = useState(config.hours);
  const [extended, setExtended] = useState(toLocalInput(config.extendedUntil && config.extendedUntil > Date.now() ? config.extendedUntil : null));
  const [problem, setProblem] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedRates = Object.fromEntries(KINDS.map((k) => [k, parseMoney(rates[k])])) as Record<StationKind, number | null>;
    const cardCents = parseMoney(card);
    const bonusCents = parseMoney(bonus);
    if (KINDS.some((k) => parsedRates[k] === null) || cardCents === null || bonusCents === null) {
      setProblem("Revisa los montos: usa números como 2 o 2,50.");
      return;
    }
    if (hours.some(([open, close]) => open >= close)) {
      setProblem("Revisa el horario: en cada día el cierre debe ser después de la apertura. Para cerrar a medianoche pon 00:00.");
      return;
    }
    setProblem("");
    save.mutate({
      hours,
      extendedUntil: fromLocalInput(extended),
      rates: parsedRates as Record<StationKind, number>,
      cardPriceCents: cardCents,
      loyaltyBonusCents: bonusCents,
      graceMinutes: grace,
      loyaltyEvery: every,
      refundOnEarlyEnd: refund,
      levels,
    });
  };

  return (
    <Panel title="Tarifas y reglas">
      <form className="form" onSubmit={submit}>
        <div className="form__row">
          {KINDS.map((k) => (
            <Field key={k} label={`${KIND_NAMES[k]}: REF por hora`}>
              <input value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} inputMode="decimal" />
            </Field>
          ))}
        </div>
        <div className="form__row">
          <Field label="Precio de la tarjeta (REF)">
            <input value={card} onChange={(e) => setCard(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Minutos extra al llegar a cero" hint="Para que guarden la partida.">
            <input type="number" min={0} max={30} value={grace} onChange={(e) => setGrace(Number(e.target.value))} />
          </Field>
          <Field label="Bono de fidelidad (REF)" hint="0 lo deja apagado.">
            <input value={bonus} onChange={(e) => setBonus(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Se gana cada tantas visitas">
            <input type="number" min={1} max={100} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          Devolver al saldo el tiempo no usado cuando una sesión se termina antes
        </label>
        <fieldset className="schedule">
          <legend>Horario de la arena (hora de Maracaibo)</legend>
          <p className="form__lead">No se vende tiempo de juego que pase de la hora de cierre. Para cerrar a medianoche, pon 00:00.</p>
          {DAYS.map(({ day, name }) => (
            <div className="schedule__row" key={day}>
              <span>{name}</span>
              <input
                type="time"
                aria-label={`${name}: hora de apertura`}
                value={toTime(hours[day][0])}
                onChange={(e) => e.target.value && setHours(hours.map((h, i) => (i === day ? [fromTime(e.target.value, false), h[1]] : h)))}
              />
              <input
                type="time"
                aria-label={`${name}: hora de cierre`}
                value={toTime(hours[day][1])}
                onChange={(e) => e.target.value && setHours(hours.map((h, i) => (i === day ? [h[0], fromTime(e.target.value, true)] : h)))}
              />
            </div>
          ))}
          <Field label="Noche especial: extender el cierre hasta" hint="Para amaneceres o eventos. Déjalo vacío para usar el horario normal; se apaga solo al pasar esa hora.">
            <input type="datetime-local" value={extended} onChange={(e) => setExtended(e.target.value)} />
          </Field>
        </fieldset>
        <fieldset className="levels">
          <legend>Niveles de fidelidad (nombre y visitas necesarias)</legend>
          {levels.map((level, i) => (
            <div className="levels__row" key={i}>
              <input value={level.name} aria-label={`Nombre del nivel ${i + 1}`} onChange={(e) => setLevels(levels.map((l, j) => (j === i ? { ...l, name: e.target.value } : l)))} />
              <input
                type="number"
                min={0}
                value={level.min}
                aria-label={`Visitas para el nivel ${i + 1}`}
                onChange={(e) => setLevels(levels.map((l, j) => (j === i ? { ...l, min: Number(e.target.value) } : l)))}
              />
            </div>
          ))}
        </fieldset>
        <Notice>{problem || save.error?.message}</Notice>
        {save.isSuccess && !problem && <Notice kind="ok">Cambios guardados.</Notice>}
        <button className="btn" type="submit" disabled={save.isPending}>
          Guardar cambios
        </button>
      </form>
    </Panel>
  );
}

// ---------- Estaciones ----------
function StationsAdmin() {
  const utils = trpc.useUtils();
  const board = trpc.staff.board.useQuery(undefined, { refetchInterval: 5000 });
  const refresh = { onSuccess: () => utils.staff.board.invalidate() };
  const create = trpc.admin.stationCreate.useMutation(refresh);
  const update = trpc.admin.stationUpdate.useMutation(refresh);
  const unlock = trpc.admin.stationUnlock.useMutation(refresh);
  const token = trpc.admin.stationToken.useMutation(refresh);
  const [kind, setKind] = useState<StationKind>("pc");
  const [number, setNumber] = useState(1);
  const [shown, setShown] = useState<{ label: string; token: string } | null>(null);

  // Propone el siguiente número libre del tipo elegido.
  useEffect(() => {
    const used = board.data?.filter((s) => s.kind === kind).map((s) => s.number) ?? [];
    setNumber(used.length ? Math.max(...used) + 1 : 1);
  }, [kind, board.data?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Panel title="Estaciones">
      <form
        className="form form--inline"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ kind, number });
        }}
      >
        <Field label="Tipo">
          <select value={kind} onChange={(e) => setKind(e.target.value as StationKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_NAMES[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Número">
          <input type="number" min={1} max={999} value={number} onChange={(e) => setNumber(Number(e.target.value))} />
        </Field>
        <button className="btn btn--small" type="submit" disabled={create.isPending}>
          Agregar estación
        </button>
      </form>
      <Notice>{create.error?.message ?? token.error?.message ?? update.error?.message}</Notice>

      {shown && (
        <div className="token">
          <p>
            <strong>Credencial de {shown.label}.</strong> Cópiala ahora y pégala en el programa de bloqueo de esa PC: no se vuelve a mostrar.
          </p>
          <code>{shown.token}</code>
          <div className="token__actions">
            <button className="btn btn--small" type="button" onClick={() => navigator.clipboard?.writeText(shown.token)}>
              Copiar credencial
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setShown(null)}>
              Ya la guardé
            </button>
          </div>
        </div>
      )}

      {board.data && board.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Estación</th>
                <th>Estado</th>
                <th>Programa de bloqueo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {board.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td>{STATE_LABEL[s.state]}</td>
                  <td>
                    {s.kind !== "pc"
                      ? "No aplica"
                      : !s.hasAgent
                        ? "Sin credencial"
                        : !s.online
                          ? "Sin conexión"
                          : `Conectado${s.agentVersion ? ` (v${s.agentVersion.replace(" sin-teclado", "")})` : ""}`}
                    {s.online && s.agentVersion?.includes("sin-teclado") && <strong className="warn"> Teclado sin proteger</strong>}
                  </td>
                  <td className="actions">
                    {s.kind === "pc" && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (s.hasAgent && !window.confirm(`${s.label} ya tiene credencial. Si generas otra, la actual deja de funcionar. ¿Continuar?`)) return;
                            token.mutate({ id: s.id }, { onSuccess: (data) => setShown({ label: s.label, token: data.token }) });
                          }}
                        >
                          {s.hasAgent ? "Nueva credencial" : "Generar credencial"}
                        </button>
                        <button type="button" onClick={() => unlock.mutate({ id: s.id, minutes: s.state === "mantenimiento" ? 0 : 30 })}>
                          {s.state === "mantenimiento" ? "Volver a bloquear" : "Desbloquear 30 min"}
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => update.mutate({ id: s.id, enabled: !s.enabled, note: s.note ?? undefined })}>
                      {s.enabled ? "Deshabilitar" : "Habilitar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------- Menú ----------
function ProductRow({ product }: { product: { id: number; name: string; category: string; priceCents: number; active: boolean; kitchen: boolean } }) {
  const utils = trpc.useUtils();
  const save = trpc.admin.productSave.useMutation({ onSuccess: () => Promise.all([utils.admin.products.invalidate(), utils.member.menu.invalidate()]) });
  const [price, setPrice] = useState(money(product.priceCents));
  const cents = parseMoney(price);
  const changed = cents !== null && cents !== product.priceCents;
  return (
    <tr className={product.active ? undefined : "is-off"}>
      <td>{product.name}</td>
      <td>{product.category}</td>
      <td>
        <input className="input--price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label={`Precio de ${product.name} en REF`} />
      </td>
      <td className="actions">
        {changed && (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({ ...product, priceCents: cents })}>
            Guardar precio
          </button>
        )}
        <button type="button" disabled={save.isPending} onClick={() => save.mutate({ ...product, kitchen: !product.kitchen })}>
          {product.kitchen ? "Pasa por cocina: sí" : "Pasa por cocina: no"}
        </button>
        <button type="button" disabled={save.isPending} onClick={() => save.mutate({ ...product, active: !product.active })}>
          {product.active ? "Quitar del menú" : "Volver a ofrecer"}
        </button>
        {save.error && <span className="warn">{save.error.message}</span>}
      </td>
    </tr>
  );
}

function ProductsAdmin() {
  const utils = trpc.useUtils();
  const list = trpc.admin.products.useQuery();
  const [form, setForm] = useState({ name: "", category: "", price: "", kitchen: true });
  const create = trpc.admin.productSave.useMutation({
    onSuccess: () => {
      setForm({ name: "", category: form.category, price: "", kitchen: form.kitchen });
      return Promise.all([utils.admin.products.invalidate(), utils.member.menu.invalidate()]);
    },
  });
  const cents = parseMoney(form.price);
  return (
    <Panel title="Menú del mostrador">
      <p className="panel__lead">
        Lo que se puede cobrar con el saldo de la tarjeta. Lo que pasa por cocina genera una comanda al cobrarlo; lo que se entrega de una vez (un refresco de la nevera) no.
      </p>
      <form
        className="form form--inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (cents !== null) create.mutate({ name: form.name, category: form.category, priceCents: cents, active: true, kitchen: form.kitchen });
        }}
      >
        <Field label="Producto">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ramen picante" required />
        </Field>
        <Field label="Categoría">
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Comida" required />
        </Field>
        <Field label="Precio en REF">
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="3,50" required />
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.kitchen} onChange={(e) => setForm({ ...form, kitchen: e.target.checked })} />
          Se prepara en cocina
        </label>
        <button className="btn btn--small" type="submit" disabled={create.isPending || cents === null}>
          Agregar al menú
        </button>
      </form>
      <Notice>{create.error?.message ?? (form.price && cents === null ? "Escribe el precio así: 3 o 3,50." : null)}</Notice>
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Precio (REF)</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <ProductRow key={`${p.id}-${p.priceCents}-${p.active}-${p.kitchen}`} product={{ id: p.id, name: p.name, category: p.category, priceCents: p.priceCents, active: p.active, kitchen: p.kitchen }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------- Personal ----------
type StaffRole = Exclude<Role, "member">;
const STAFF_ROLES: StaffRole[] = ["cashier", "kitchen", "admin", "owner"];

function StaffRow({ user, me }: { user: { id: number; name: string; phone: string | null; role: Role; active: boolean }; me: { id: number; role: Role } }) {
  const utils = trpc.useUtils();
  const refresh = { onSuccess: () => utils.admin.staffList.invalidate() };
  const update = trpc.admin.staffUpdate.useMutation({
    onSuccess: () => {
      setPassword(null);
      return utils.admin.staffList.invalidate();
    },
  });
  const setActive = trpc.admin.userSetActive.useMutation(refresh);
  const [password, setPassword] = useState<string | null>(null);
  const senior = user.role === "admin" || user.role === "owner";
  const isMe = user.id === me.id;
  // Un administrador maneja operadoras y cocina; las cuentas de administradores y del dueño las maneja el súper admin.
  const canManage = me.role === "owner" || !senior;
  const roles = STAFF_ROLES.filter((r) => me.role === "owner" || (r !== "admin" && r !== "owner"));
  return (
    <li className={user.active ? undefined : "is-off"}>
      <div className="team__who">
        <strong>
          {user.name}
          {isMe ? " (tú)" : ""}
        </strong>
        <small>{user.phone}</small>
      </div>
      <div className="team__role">
        <Badge tone={user.role === "owner" ? "hot" : senior ? "ok" : "plain"}>{ROLE_LABEL[user.role]}</Badge>
        {!user.active && <Badge tone="off">Desactivado</Badge>}
        <small>{ROLE_ABOUT[user.role as StaffRole]}</small>
      </div>
      {canManage && (
        <div className="team__actions">
          {!isMe && (
            <label className="team__pick">
              <span>Tipo de usuario</span>
              <select value={user.role} disabled={update.isPending} onChange={(e) => update.mutate({ id: user.id, role: e.target.value as StaffRole })}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {password === null ? (
            <button className="app__link" type="button" onClick={() => setPassword("")}>
              Cambiar contraseña
            </button>
          ) : (
            <form
              className="team__password"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate({ id: user.id, password });
              }}
            >
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Contraseña nueva" aria-label={`Contraseña nueva de ${user.name}`} minLength={6} required />
              <button className="btn btn--small" type="submit" disabled={update.isPending}>
                Guardar
              </button>
              <button className="app__link" type="button" onClick={() => setPassword(null)}>
                Cancelar
              </button>
            </form>
          )}
          {!isMe && (
            <button className="app__link" type="button" disabled={setActive.isPending} onClick={() => setActive.mutate({ id: user.id, active: !user.active })}>
              {user.active ? "Desactivar" : "Reactivar"}
            </button>
          )}
        </div>
      )}
      {(update.error || setActive.error) && <Notice>{update.error?.message ?? setActive.error?.message}</Notice>}
      {update.isSuccess && password === null && <Notice kind="ok">Cambio guardado.</Notice>}
    </li>
  );
}

function StaffAdmin() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const list = trpc.admin.staffList.useQuery();
  const empty = { name: "", phone: "", password: "", role: "cashier" as StaffRole };
  const [form, setForm] = useState(empty);
  const create = trpc.admin.staffCreate.useMutation({
    onSuccess: () => {
      setForm(empty);
      return utils.admin.staffList.invalidate();
    },
  });
  if (!me.data) return null;
  const roles = STAFF_ROLES.filter((r) => me.data!.role === "owner" || (r !== "admin" && r !== "owner"));

  return (
    <Panel title="Usuarios del personal">
      <p className="panel__lead">
        Cada persona entra por /caja con su teléfono y su contraseña, y solo ve lo que le toca según su tipo de usuario.
        {me.data.role !== "owner" && " Las cuentas de administradores las maneja el súper admin."}
      </p>
      <form
        className="form form--inline"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form);
        }}
      >
        <Field label="Nombre">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Teléfono">
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} type="tel" inputMode="tel" required />
        </Field>
        <Field label="Contraseña">
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" autoComplete="new-password" required />
        </Field>
        <Field label="Tipo de usuario" hint={ROLE_ABOUT[form.role]}>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn btn--small" type="submit" disabled={create.isPending}>
          Crear usuario
        </button>
      </form>
      <Notice>{create.error?.message}</Notice>
      <ul className="team">
        {list.data?.map((u) => (
          <StaffRow key={u.id} user={u} me={me.data!} />
        ))}
      </ul>
    </Panel>
  );
}

// ---------- Base de clientes ----------
function MembersAdmin() {
  const [page, setPage] = useState(0);
  const members = trpc.admin.members.useQuery({ page });
  const data = members.data;

  const exportCsv = () => {
    if (!data) return;
    const head = ["Nombre", "Teléfono", "Correo", "Código", "Saldo REF", "Visitas", "Tarjeta", "Registro"];
    const rows = data.rows.map((m) => [m.name, m.phone ?? "", m.email ?? "", m.memberCode, money(m.balanceCents), m.visitsCount, m.hasCard ? "Sí" : "No", when(m.createdAt)]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes-panter-pagina-${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title={`Base de clientes${data ? ` (${data.total})` : ""}`}
      action={
        <button className="app__link" type="button" onClick={exportCsv} disabled={!data?.rows.length}>
          Descargar esta página en CSV
        </button>
      }
    >
      {!data ? (
        <p className="empty">Cargando…</p>
      ) : data.rows.length === 0 ? (
        <p className="empty">Todavía no hay clientes registrados.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Teléfono</th>
                  <th>Código</th>
                  <th className="num">Saldo</th>
                  <th className="num">Visitas</th>
                  <th>Registro</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.phone}</td>
                    <td>{m.memberCode}</td>
                    <td className="num">{ref(m.balanceCents)}</td>
                    <td className="num">{m.visitsCount}</td>
                    <td>{when(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.pageSize && (
            <div className="pager">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Anteriores
              </button>
              <span>
                Página {page + 1} de {Math.ceil(data.total / data.pageSize)}
              </span>
              <button type="button" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
                Siguientes
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export default function Admin() {
  const config = trpc.staff.config.useQuery();
  return (
    <div className="admin">
      {config.data ? <ConfigForm config={config.data} /> : <p className="empty">Cargando…</p>}
      <ProductsAdmin />
      <StationsAdmin />
      <StaffAdmin />
      <MembersAdmin />
    </div>
  );
}
