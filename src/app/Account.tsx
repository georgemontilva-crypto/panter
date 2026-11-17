import { Suspense, lazy, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { TX_LABEL, trpc, type MemberHome } from "./api";
import PayCard from "./PayCard";
import { Field, MemberCard, Notice, Panel, STATE_LABEL, Shell, clock, countdown, duration, ref, useNowTick, when } from "./ui";

const Scanner = lazy(() => import("./Scanner"));

// ---------- Entrar / crear cuenta / activar tarjeta ----------
type AuthMode = "login" | "register" | "claim";

function AuthForms() {
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState({ name: "", user: "", email: "", phone: "", password: "", code: "" });
  const done = { onSuccess: () => utils.invalidate() };
  const login = trpc.auth.login.useMutation(done);
  const register = trpc.auth.register.useMutation(done);
  const claim = trpc.auth.claim.useMutation(done);
  const active = mode === "login" ? login : mode === "register" ? register : claim;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "login") login.mutate({ identifier: form.user, password: form.password, area: "member" });
    else if (mode === "register") register.mutate({ name: form.name, email: form.email, phone: form.phone, password: form.password });
    else claim.mutate({ memberCode: form.code, phone: form.phone, email: form.email, password: form.password });
  };

  const tabs: { id: AuthMode; label: string }[] = [
    { id: "login", label: "Entrar" },
    { id: "register", label: "Crear cuenta" },
    { id: "claim", label: "Ya tengo tarjeta" },
  ];

  return (
    <div className="auth">
      <div className="auth__intro">
        <h1>Tu tarjeta Panter</h1>
        <p>Recarga saldo en caja, activa tu PC desde el teléfono y suma una visita cada día que vienes a jugar.</p>
      </div>
      <Panel className="auth__panel">
        <div className="tabs" role="tablist" aria-label="Cómo quieres entrar">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              className={mode === t.id ? "is-active" : undefined}
              onClick={() => {
                setMode(t.id);
                login.reset();
                register.reset();
                claim.reset();
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form className="form" onSubmit={submit}>
          {mode === "claim" && (
            <p className="form__lead">Si te registraron en caja, crea aquí tu contraseña con el código impreso en tu tarjeta.</p>
          )}
          {mode === "register" && (
            <Field label="Nombre y apellido">
              <input value={form.name} onChange={set("name")} autoComplete="name" required />
            </Field>
          )}
          {mode === "claim" && (
            <Field label="Código de la tarjeta" hint="Está debajo de tu nombre: PNT-XXXXXX.">
              <input value={form.code} onChange={set("code")} placeholder="PNT-" autoCapitalize="characters" required />
            </Field>
          )}
          {mode === "login" ? (
            <Field label="Correo o teléfono">
              <input value={form.user} onChange={set("user")} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
            </Field>
          ) : (
            <>
              <Field label="Correo">
                <input value={form.email} onChange={set("email")} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="nombre@correo.com" required />
              </Field>
              <Field label="Teléfono celular" hint={mode === "claim" ? "El mismo que diste en caja." : undefined}>
                <input value={form.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="0414 1234567" required />
              </Field>
            </>
          )}
          <Field label={mode === "login" ? "Contraseña" : "Crea una contraseña"} hint={mode === "login" ? undefined : "Mínimo 6 caracteres."}>
            <input
              value={form.password}
              onChange={set("password")}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </Field>
          <Notice>{active.error?.message}</Notice>
          <button className="btn" type="submit" disabled={active.isPending}>
            {mode === "login" ? "Entrar" : mode === "register" ? "Crear mi cuenta" : "Activar mi cuenta"}
          </button>
        </form>
        <p className="auth__other">
          ¿Trabajas en la arena? <Link to="/caja">Entra por el acceso del personal</Link>.
        </p>
      </Panel>
    </div>
  );
}

// ---------- Sesión activa ----------
function ActiveSession({ home, session }: { home: MemberHome; session: MemberHome["sessions"][number] }) {
  const utils = trpc.useUtils();
  const now = useNowTick();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const refresh = { onSuccess: () => utils.member.invalidate() };
  const extend = trpc.member.extend.useMutation(refresh);
  const end = trpc.member.end.useMutation(refresh);
  const inGrace = now >= session.endsAt;
  const rate = home.rates[session.kind];
  // Se puede agregar tiempo solo si la sesión sigue terminando antes del cierre (con 5 min de tolerancia).
  const fits = (m: number) => Math.max(now, session.endsAt) + m * 60_000 <= home.closing.closesAt + 5 * 60_000;
  const canExtend = fits(30);
  const label = `${session.kind === "pc" ? "PC" : "Estación"} ${String(session.number).padStart(2, "0")}`;

  return (
    <Panel className={`live${inGrace ? " live--grace" : ""}`}>
      <p className="live__where">{inGrace ? `${label}: se acabó tu tiempo` : `Jugando en ${label}`}</p>
      <p className="live__clock" role="timer">
        {countdown((inGrace ? session.graceEndsAt : session.endsAt) - now)}
      </p>
      <p className="live__hint">
        {inGrace
          ? "Guarda tu partida: la PC se bloquea cuando este contador llegue a cero. Si agregas tiempo, sigues jugando."
          : `Al llegar a cero tienes ${home.graceMinutes} minutos extra para guardar.`}
      </p>
      <div className="live__actions">
        {[30, 60].filter(fits).map((m) => (
          <button key={m} className="btn" type="button" disabled={extend.isPending} onClick={() => extend.mutate({ sessionId: session.id, minutes: m })}>
            Agregar {duration(m)} ({ref(Math.round((rate * m) / 60))})
          </button>
        ))}
        {!inGrace &&
          (confirmEnd ? (
            <button className="btn btn--ghost" type="button" disabled={end.isPending} onClick={() => end.mutate({ sessionId: session.id })}>
              Sí, terminar y devolver lo no usado
            </button>
          ) : (
            <button className="btn btn--ghost" type="button" onClick={() => setConfirmEnd(true)}>
              Terminar ahora
            </button>
          ))}
      </div>
      {!canExtend && <Notice kind="info">Cerramos a las {clock(home.closing.closesAt)}: ya no se puede agregar más tiempo hoy.</Notice>}
      <Notice>{extend.error?.message ?? end.error?.message}</Notice>
    </Panel>
  );
}

// ---------- Activar una PC ----------
const DURATIONS = [30, 60, 90, 120, 180, 240];

function ActivatePc({ home }: { home: MemberHome }) {
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const pcs = trpc.member.pcs.useQuery(undefined, { refetchInterval: 5000 });
  const [selected, setSelected] = useState<number | null>(null);
  const [code, setCode] = useState(params.get("c") ?? "");
  const [minutes, setMinutes] = useState(60);
  const [scanning, setScanning] = useState(false);
  const [scanProblem, setScanProblem] = useState("");
  const start = trpc.member.start.useMutation({
    onSuccess: () => {
      setSelected(null);
      setCode("");
      setParams({}, { replace: true });
      return utils.member.invalidate();
    },
  });

  // Enlace del QR de la pantalla de bloqueo: /cuenta?pc=7&c=1234 deja todo listo.
  const wanted = Number(params.get("pc"));
  useEffect(() => {
    if (!wanted || selected !== null || !pcs.data) return;
    const match = pcs.data.find((p) => p.number === wanted);
    if (match) setSelected(match.id);
  }, [wanted, pcs.data, selected]);

  // El QR de la pantalla de bloqueo es un enlace con el número de la PC y su código.
  const onScan = (value: string) => {
    setScanning(false);
    let number = 0;
    let scannedCode = "";
    try {
      const url = new URL(value);
      number = Number(url.searchParams.get("pc"));
      scannedCode = url.searchParams.get("c") ?? "";
    } catch {
      /* no es un enlace */
    }
    const match = pcs.data?.find((p) => p.number === number);
    if (!match || !/^\d{4}$/.test(scannedCode)) {
      setScanProblem("Ese QR no es el de una PC de la arena. Apunta al que aparece en la pantalla bloqueada.");
      return;
    }
    if (match.state !== "libre") {
      setScanProblem(`${match.label} no está libre en este momento. Elige otra.`);
      return;
    }
    setScanProblem("");
    start.reset();
    setSelected(match.id);
    setCode(scannedCode);
  };

  // Solo se ofrecen los bloques que terminan antes del cierre.
  const options = DURATIONS.filter((m) => m <= home.closing.maxMinutes);
  const limited = options.length < DURATIONS.length;
  useEffect(() => {
    if (options.length && !options.includes(minutes)) setMinutes(options[options.length - 1]);
  }, [options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pc = pcs.data?.find((p) => p.id === selected) ?? null;
  const cost = Math.round((home.rates.pc * minutes) / 60);
  const enough = home.balanceCents >= cost;

  if (pcs.data && pcs.data.length === 0) return null;
  if (options.length === 0) {
    return (
      <Panel title="Activar una PC">
        <Notice kind="info">
          {home.closing.maxMinutes > 0
            ? `Cerramos a las ${clock(home.closing.closesAt)} y ya no alcanza el tiempo para una sesión. Te esperamos mañana.`
            : "La arena está cerrada en este momento. Podrás activar una PC cuando abramos."}
        </Notice>
      </Panel>
    );
  }

  return (
    <Panel title="Activar una PC">
      <p className="panel__lead">Siéntate en una PC libre y escanea el QR de su pantalla. También puedes elegirla aquí y escribir su código.</p>
      <button className="btn activate__scan" type="button" onClick={() => setScanning(true)}>
        Escanear el QR de la PC
      </button>
      <Notice>{scanProblem}</Notice>
      {scanning && (
        <Suspense fallback={null}>
          <Scanner title="Escanear la PC" hint="Apunta al QR que muestra la pantalla bloqueada." onClose={() => setScanning(false)} onResult={onScan} />
        </Suspense>
      )}
      <ul className="pcgrid">
        {pcs.data?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={`pctile pctile--${p.state}${p.id === selected ? " is-selected" : ""}`}
              disabled={p.state !== "libre"}
              aria-pressed={p.id === selected}
              onClick={() => {
                setSelected(p.id);
                start.reset();
              }}
            >
              <span className="pctile__num">{String(p.number).padStart(2, "0")}</span>
              <span className="pctile__state">{STATE_LABEL[p.state]}</span>
            </button>
          </li>
        ))}
      </ul>

      {pc && (
        <form
          className="form activate"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate({ stationId: pc.id, minutes, code });
          }}
        >
          <h3>{pc.label}</h3>
          <Field label="Código en la pantalla de la PC" hint="Son 4 números y cambian cada pocos minutos.">
            <input
              className="input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0000"
              required
            />
          </Field>
          <fieldset className="chips">
            <legend>¿Cuánto tiempo?</legend>
            {options.map((m) => (
              <label key={m} className={m === minutes ? "is-active" : undefined}>
                <input type="radio" name="minutes" checked={m === minutes} onChange={() => setMinutes(m)} />
                {duration(m)}
              </label>
            ))}
          </fieldset>
          {limited && <p className="form__lead">Hoy cerramos a las {clock(home.closing.closesAt)}: solo aparecen los tiempos que terminan antes.</p>}
          <p className="activate__sum">
            {home.rates.pc
              ? `Se descuentan ${ref(cost)} de tu saldo. Te quedan ${ref(Math.max(0, home.balanceCents - cost))}.`
              : "La tarifa de las PC todavía no está configurada. Avisa en caja."}
          </p>
          {!enough && home.rates.pc > 0 && <Notice kind="info">Te faltan {ref(cost - home.balanceCents)}. Recarga en caja o elige menos tiempo.</Notice>}
          <Notice>{start.error?.message}</Notice>
          <button className="btn" type="submit" disabled={start.isPending || !enough || code.length !== 4 || !home.rates.pc}>
            Activar {pc.label} por {duration(minutes)}
          </button>
        </form>
      )}
    </Panel>
  );
}

// ---------- Menú del mostrador y compras ----------
function MenuAndOrders({ home, onPay }: { home: MemberHome; onPay: () => void }) {
  const menu = trpc.member.menu.useQuery(undefined, { staleTime: 60_000 });
  const items = menu.data ?? [];
  if (items.length === 0 && home.orders.length === 0) return null;
  const categories = [...new Set(items.map((p) => p.category))];
  return (
    <>
      {items.length > 0 && (
        <Panel title="Menú">
          <p className="panel__lead">Pide en el mostrador y paga con tu tarjeta: escanean tu código y se descuenta de tu saldo.</p>
          {categories.map((category) => (
            <div className="menu-list" key={category}>
              <h3>{category}</h3>
              <ul>
                {items
                  .filter((p) => p.category === category)
                  .map((p) => (
                    <li key={p.id} className={p.priceCents > home.balanceCents ? "is-out" : undefined}>
                      <span>{p.name}</span>
                      <span>{ref(p.priceCents)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <button className="btn menu-list__pay" type="button" onClick={onPay}>
            Pagar con tarjeta Panter
          </button>
        </Panel>
      )}
      {home.orders.length > 0 && (
        <Panel title="Mis compras">
          <ul className="moves">
            {home.orders.map((o) => (
              <li key={o.id}>
                <span className="moves__what">
                  Orden #{o.id}
                  <small>
                    {when(o.createdAt)}, {o.items.map((i) => (i.qty > 1 ? `${i.qty} x ${i.name}` : i.name)).join(", ")}
                    {o.status === "refunded" ? " (anulada y devuelta)" : ""}
                  </small>
                </span>
                <span className="moves__amount">{ref(o.totalCents)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

// ---------- Perfil ----------
function Wallet({ home }: { home: MemberHome }) {
  const { current, next } = home.level;
  const span = next ? next.min - current.min : 1;
  const progress = next ? Math.min(1, (home.visitsCount - current.min) / span) : 1;
  const toBonus = home.loyalty.bonusCents > 0 ? home.loyalty.every - (home.visitsCount % home.loyalty.every) : null;
  const [paying, setPaying] = useState(false);

  return (
    <div className="wallet">
      {/* Con una sesión en curso, el contador va primero: es lo que el cliente viene a mirar. */}
      {home.sessions.map((s) => (
        <ActiveSession key={s.id} home={home} session={s} />
      ))}
      <div className="wallet__top">
        <div className="wallet__card">
          <MemberCard name={home.name} code={home.memberCode} qr={home.cardQr} level={current.name} balanceCents={home.balanceCents} />
          <button className="btn wallet__pay" type="button" onClick={() => setPaying(true)}>
            Pagar con tarjeta Panter
          </button>
          <p className="wallet__hint">Abre tu tarjeta con el código en grande. También sirve para recargar en caja.</p>
        </div>
        <div className="wallet__side">
          <Panel className="loyalty">
            <p className="loyalty__count">
              <strong>{home.visitsCount}</strong> {home.visitsCount === 1 ? "visita" : "visitas"}
            </p>
            <div className="loyalty__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Avance al siguiente nivel">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="loyalty__next">
              {next
                ? `Nivel ${current.name}. Te faltan ${next.min - home.visitsCount} para ${next.name}.`
                : `Nivel ${current.name}: el más alto de la arena.`}
              {toBonus !== null && ` En ${toBonus} ${toBonus === 1 ? "visita" : "visitas"} más ganas ${ref(home.loyalty.bonusCents)} de bono.`}
            </p>
          </Panel>
        </div>
      </div>

      {home.sessions.length === 0 && <ActivatePc home={home} />}
      <MenuAndOrders home={home} onPay={() => setPaying(true)} />

      <Panel title="Movimientos">
        {home.tx.length === 0 ? (
          <p className="empty">Todavía no hay movimientos. Tu primera recarga aparecerá aquí.</p>
        ) : (
          <ul className="moves">
            {home.tx.map((t) => (
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
      {paying && <PayCard home={home} onClose={() => setPaying(false)} />}
    </div>
  );
}

export default function Account() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const isMember = me.data?.role === "member";
  const home = trpc.member.home.useQuery(undefined, { enabled: isMember, refetchInterval: 10_000 });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.invalidate() });

  // El personal tiene su propia entrada: si llega aquí con la sesión abierta, va a su panel.
  if (me.data && !isMember) return <Navigate to="/caja" replace />;

  return (
    <Shell
      title="Mi cuenta"
      right={
        me.data && (
          <button className="app__link" type="button" onClick={() => logout.mutate()}>
            Salir
          </button>
        )
      }
    >
      {me.isLoading ? (
        <p className="empty">Cargando…</p>
      ) : me.error ? (
        <Notice>{me.error.message || "No pudimos conectar con el servidor. Revisa tu conexión e intenta otra vez."}</Notice>
      ) : !me.data ? (
        <AuthForms />
      ) : home.data ? (
        <Wallet home={home.data} />
      ) : (
        <p className="empty">Cargando tu tarjeta…</p>
      )}
    </Shell>
  );
}
