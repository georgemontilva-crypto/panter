import { useEffect, useState } from "react";
import { KIND_NAMES, trpc, type Config, type StationKind } from "./api";
import { Field, Notice, Panel, STATE_LABEL, money, parseMoney, ref, when } from "./ui";

const KINDS: StationKind[] = ["pc", "ps5", "switch", "sim"];

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
    setProblem("");
    save.mutate({
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
                  <td>{s.kind !== "pc" ? "No aplica" : !s.hasAgent ? "Sin credencial" : s.online ? `Conectado${s.agentVersion ? ` (v${s.agentVersion})` : ""}` : "Sin conexión"}</td>
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

// ---------- Personal ----------
function StaffAdmin() {
  const utils = trpc.useUtils();
  const list = trpc.admin.staffList.useQuery();
  const refresh = { onSuccess: () => utils.admin.staffList.invalidate() };
  const create = trpc.admin.staffCreate.useMutation({
    onSuccess: () => {
      setForm({ name: "", phone: "", password: "", role: "cashier" });
      return utils.admin.staffList.invalidate();
    },
  });
  const setActive = trpc.admin.userSetActive.useMutation(refresh);
  const [form, setForm] = useState({ name: "", phone: "", password: "", role: "cashier" as "cashier" | "admin" });

  return (
    <Panel title="Personal">
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
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} type="tel" required />
        </Field>
        <Field label="Contraseña">
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" autoComplete="new-password" required />
        </Field>
        <Field label="Rol">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "cashier" | "admin" })}>
            <option value="cashier">Cajero</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
        <button className="btn btn--small" type="submit" disabled={create.isPending}>
          Crear usuario
        </button>
      </form>
      <Notice>{create.error?.message ?? setActive.error?.message}</Notice>
      <table className="table">
        <tbody>
          {list.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.phone}</td>
              <td>{u.role === "admin" ? "Administrador" : "Cajero"}</td>
              <td className="actions">
                <button type="button" onClick={() => setActive.mutate({ id: u.id, active: !u.active })}>
                  {u.active ? "Desactivar" : "Reactivar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <StationsAdmin />
      <StaffAdmin />
      <MembersAdmin />
    </div>
  );
}
