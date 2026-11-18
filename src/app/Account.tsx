import { Suspense, lazy, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { KIND_NAMES, ORDER_PROGRESS, TX_LABEL, creditMinutes, priceOf, trpc, type MemberHome } from "./api";
import { isIos, isStandalone, useInstallPrompt } from "../pwa";
import PayCard from "./PayCard";
import { Field, MemberCard, Notice, Panel, STATE_LABEL, Shell, clock, countdown, duration, ref, useNowTick, when, priceLabel } from "./ui";

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
  const credit = creditMinutes(home.timeCredits, session.kind);
  // Lo que quedaría guardado si termina en este momento.
  const unused = Math.max(0, Math.round((session.endsAt - now) / 60_000));
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
            Agregar {duration(m)} ({priceLabel(priceOf(rate, m, credit))})
          </button>
        ))}
        {!inGrace &&
          (confirmEnd ? (
            <button className="btn btn--ghost" type="button" disabled={end.isPending} onClick={() => end.mutate({ sessionId: session.id })}>
              {unused > 0 ? `Sí, terminar y guardar ${duration(unused)} a favor` : "Sí, terminar"}
            </button>
          ) : (
            <button className="btn btn--ghost" type="button" onClick={() => setConfirmEnd(true)}>
              Terminar ahora
            </button>
          ))}
      </div>
      {confirmEnd && !inGrace && unused > 0 && <p className="live__hint">No se devuelve dinero: el tiempo que no uses queda guardado y se gasta primero la próxima vez que juegues.</p>}
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
  // El tiempo a favor en PC se gasta primero; solo se descuenta del saldo lo que falte.
  const price = priceOf(home.rates.pc, minutes, creditMinutes(home.timeCredits, "pc"));
  const cost = price.costCents;
  const enough = home.balanceCents >= cost;

  if (pcs.data && pcs.data.length === 0) {
    return (
      <Panel title="Activar una PC">
        <p className="empty">Todavía no hay PCs para activar desde el teléfono. Pide tu tiempo en caja.</p>
      </Panel>
    );
  }
  if (!pcs.data) {
    return (
      <Panel title="Activar una PC">
        <p className="empty">{pcs.error ? "No pudimos cargar las PCs. Revisa tu conexión." : "Cargando las PCs…"}</p>
      </Panel>
    );
  }
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
            {!home.rates.pc
              ? "La tarifa de las PC todavía no está configurada. Avisa en caja."
              : price.fromCredit === minutes
                ? `No pagas nada: usas ${duration(price.fromCredit)} de tu tiempo a favor.`
                : `${price.fromCredit ? `Usas ${duration(price.fromCredit)} de tu tiempo a favor. ` : ""}Se descuentan ${ref(cost)} de tu saldo. Te quedan ${ref(Math.max(0, home.balanceCents - cost))}.`}
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
function MenuAndOrders({ home, offline, onPay }: { home: MemberHome; offline: boolean; onPay: () => void }) {
  const menu = trpc.member.menu.useQuery(undefined, { staleTime: 60_000 });
  const items = menu.data ?? [];
  const categories = [...new Set(items.map((p) => p.category))];
  return (
    <>
      <Panel title="Menú">
        {items.length === 0 ? (
          <p className="empty">
            {menu.isLoading
              ? "Cargando el menú…"
              : offline || menu.error
                ? "Sin conexión no se puede cargar el menú. Pregunta en el mostrador: tu tarjeta sirve igual para pagar."
                : "Todavía no hay productos en el menú. Pregunta en el mostrador qué hay hoy."}
          </p>
        ) : (
          <>
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
          </>
        )}
        <button className="btn menu-list__pay" type="button" onClick={onPay}>
          Pagar con tarjeta Panter
        </button>
      </Panel>
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
                  {o.status === "paid" && ORDER_PROGRESS[o.kitchenStatus] && o.kitchenStatus !== "delivered" && (
                    <small className={`moves__state${o.kitchenStatus === "ready" ? " is-ready" : ""}`}>{ORDER_PROGRESS[o.kitchenStatus]}</small>
                  )}
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

// ---------- Instalar la app ----------
const INSTALL_DISMISSED = "panter:instalar-oculto";

function InstallApp() {
  const { available, install } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => {
    try {
      return isStandalone() || localStorage.getItem(INSTALL_DISMISSED) === "1";
    } catch {
      return isStandalone();
    }
  });
  const ios = isIos();
  if (hidden || (!available && !ios)) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED, "1");
    } catch {
      /* sin almacenamiento: se oculta solo por esta vez */
    }
  };
  return (
    <Panel className="install" title="Instala Arena Panter">
      {available ? (
        <p className="panel__lead">Queda con su icono en tu teléfono, abre a pantalla completa y muestra tu tarjeta aunque no tengas señal.</p>
      ) : (
        <ol className="install__steps">
          <li>
            Abre esta página en <strong>Safari</strong>.
          </li>
          <li>
            Toca <strong>Compartir</strong>, el cuadro con la flecha hacia arriba.
          </li>
          <li>
            Elige <strong>Agregar a inicio</strong>.
          </li>
        </ol>
      )}
      <div className="install__actions">
        {available && (
          <button className="btn" type="button" onClick={() => void install().then((accepted) => accepted && setHidden(true))}>
            Instalar la app
          </button>
        )}
        <button className="btn btn--ghost" type="button" onClick={dismiss}>
          Ahora no
        </button>
      </div>
    </Panel>
  );
}

// ---------- Perfil ----------
type View = "tarjeta" | "jugar" | "menu" | "movimientos";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
const VIEWS: { id: View; label: string; icon: ReturnType<typeof icon> }[] = [
  { id: "tarjeta", label: "Tarjeta", icon: icon("M3 6.5h18v11H3zM3 10.5h18M6.5 14.5h4") },
  { id: "jugar", label: "Jugar", icon: icon("M3 5h18v11H3zM9 20h6M12 16v4") },
  { id: "menu", label: "Menú", icon: icon("M6 9h12l-1.2 11H7.2zM4.5 9h15M12 9V5l3.5-1.5") },
  { id: "movimientos", label: "Historial", icon: icon("M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.5M4 12h.5M4 17.5h.5") },
];
const isView = (value: string | null): value is View => VIEWS.some((v) => v.id === value);

function Wallet({ home, offlineSince }: { home: MemberHome; offlineSince?: number }) {
  const [params] = useSearchParams();
  const offline = offlineSince !== undefined;
  const { current, next } = home.level;
  const span = next ? next.min - current.min : 1;
  const progress = next ? Math.min(1, (home.visitsCount - current.min) / span) : 1;
  const toBonus = home.loyalty.bonusCents > 0 ? home.loyalty.every - (home.visitsCount % home.loyalty.every) : null;
  // El QR de una PC (/cuenta?pc=7&c=1234) y los atajos de la app instalada abren directo en su sección.
  const wantedView = params.get("ver");
  const [view, setView] = useState<View>(() => (params.has("pc") ? "jugar" : isView(wantedView) ? wantedView : "tarjeta"));
  const [paying, setPaying] = useState(() => params.get("pagar") === "1");
  const now = useNowTick(offline ? 1000 : 60_000);
  // Sin conexión no se sabe si una sesión siguió o terminó: se dejan de mostrar las que ya vencieron.
  const sessions = offline ? home.sessions.filter((s) => s.graceEndsAt > now) : home.sessions;
  const playing = sessions.length > 0;

  const go = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="wallet">
      <nav className="appnav" aria-label="Secciones de tu cuenta">
        {VIEWS.slice(0, 2).map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "is-active" : undefined} aria-current={view === v.id ? "page" : undefined} onClick={() => go(v.id)}>
            {v.icon}
            <span>{v.label}</span>
            {v.id === "jugar" && playing && <i className="appnav__dot" aria-label="Estás jugando" />}
          </button>
        ))}
        <button type="button" className="appnav__pay" onClick={() => setPaying(true)}>
          {icon("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5h1M19.5 14h.5")}
          <span>Pagar</span>
        </button>
        {VIEWS.slice(2).map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "is-active" : undefined} aria-current={view === v.id ? "page" : undefined} onClick={() => go(v.id)}>
            {v.icon}
            <span>{v.label}</span>
          </button>
        ))}
      </nav>

      {offline && (
        <Notice kind="info">
          Sin conexión. Así estaba tu tarjeta el {when(offlineSince)}; tu código sirve igual para pagar.
        </Notice>
      )}

      {/* Con una sesión en curso, el contador va primero: es lo que el cliente viene a mirar. */}
      {(view === "tarjeta" || view === "jugar") && sessions.map((s) => <ActiveSession key={s.id} home={home} session={s} />)}

      {view === "tarjeta" && (
        <>
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
              {home.timeCredits.length > 0 && (
                <Panel title="Tiempo a favor" className="credits">
                  <ul className="rows">
                    {home.timeCredits.map((c) => (
                      <li key={c.kind}>
                        <span className="rows__main">
                          <strong>{KIND_NAMES[c.kind]}</strong>
                        </span>
                        <span className="rows__side">{duration(c.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="form__lead">Es tiempo que pagaste y no usaste. Se gasta primero la próxima vez que juegues, antes de tocar tu saldo.</p>
                </Panel>
              )}
              <InstallApp />
            </div>
          </div>
        </>
      )}

      {view === "jugar" &&
        !playing &&
        (offline ? (
          <Panel title="Activar una PC">
            <p className="empty">Necesitas conexión para activar una PC. Revisa tu señal o conéctate al wifi de la arena.</p>
          </Panel>
        ) : (
          <ActivatePc home={home} />
        ))}

      {view === "menu" && <MenuAndOrders home={home} offline={offline} onPay={() => setPaying(true)} />}

      {view === "movimientos" && (
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
                    {t.type === "card_sale" ? ref(t.paidCents) : t.type === "time" ? "" : t.type === "session" && !t.amountCents ? "Sin costo" : ref(t.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {paying && <PayCard home={home} onClose={() => setPaying(false)} />}
    </div>
  );
}

// ---------- Copia de la tarjeta para cuando no hay conexión ----------
// Se guarda en el propio teléfono lo último que se vio, y se borra al salir de la cuenta.
const HOME_CACHE = "panter:tarjeta";
const HOME_CACHE_VERSION = 1;

function readHomeCache(): { at: number; home: MemberHome } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(HOME_CACHE) ?? "null");
    return saved?.v === HOME_CACHE_VERSION && saved.home?.cardQr ? { at: saved.at, home: saved.home } : null;
  } catch {
    return null;
  }
}
function writeHomeCache(home: MemberHome | null) {
  try {
    if (home) localStorage.setItem(HOME_CACHE, JSON.stringify({ v: HOME_CACHE_VERSION, at: Date.now(), home }));
    else localStorage.removeItem(HOME_CACHE);
  } catch {
    /* almacenamiento lleno o bloqueado: la app sigue funcionando con conexión */
  }
}
/** Fallo de red (sin respuesta del servidor), a diferencia de un error que el servidor sí contestó. */
const isNetworkError = (error: { data?: unknown } | null) => Boolean(error) && !error?.data;

export default function Account() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const isMember = me.data?.role === "member";
  const home = trpc.member.home.useQuery(undefined, { enabled: isMember, refetchInterval: 10_000 });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      writeHomeCache(null);
      return utils.invalidate();
    },
  });
  const [saved] = useState(readHomeCache);
  const netDown = isNetworkError(me.error) || isNetworkError(home.error);

  useEffect(() => {
    if (home.data && !home.error) writeHomeCache(home.data);
  }, [home.data, home.error]);
  // El servidor respondió que no hay sesión: la copia guardada ya no es de nadie.
  useEffect(() => {
    if (me.isSuccess && !me.isFetching && !me.data) writeHomeCache(null);
  }, [me.isSuccess, me.isFetching, me.data]);

  // El personal tiene su propia entrada: si llega aquí con la sesión abierta, va a su panel.
  if (me.data && !isMember) return <Navigate to="/caja" replace />;

  const offlineHome = netDown ? (home.data ? { at: home.dataUpdatedAt, home: home.data } : saved) : null;

  return (
    <Shell
      title="Mi cuenta"
      right={
        (me.data || offlineHome) && (
          <button className="app__link" type="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
            Salir
          </button>
        )
      }
    >
      {offlineHome ? (
        <Wallet home={offlineHome.home} offlineSince={offlineHome.at} />
      ) : me.isLoading ? (
        <p className="empty">Cargando…</p>
      ) : me.error ? (
        <Notice>{isNetworkError(me.error) ? "No hay conexión con Arena Panter. Revisa tu señal e intenta otra vez." : me.error.message}</Notice>
      ) : !me.data ? (
        <>
          <AuthForms />
          <InstallApp />
        </>
      ) : home.data ? (
        <Wallet home={home.data} />
      ) : (
        <p className="empty">Cargando tu tarjeta…</p>
      )}
    </Shell>
  );
}
