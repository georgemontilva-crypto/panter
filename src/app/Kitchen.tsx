import { useEffect, useRef, useState } from "react";
import { trpc, type KitchenStatus, type KitchenTicket } from "./api";
import { Notice, clock, useNowTick } from "./ui";

// Pantalla de cocina: las comandas avanzan de izquierda a derecha con un solo botón grande cada una.
type Step = Exclude<KitchenStatus, "none">;
const COLUMNS: { status: Step; title: string; empty: string; action: string; next: Step; back?: Step }[] = [
  { status: "pending", title: "Por preparar", empty: "Nada en cola.", action: "Empezar a preparar", next: "preparing" },
  { status: "preparing", title: "En preparación", empty: "Nada en el fuego.", action: "Marcar lista", next: "ready", back: "pending" },
  { status: "ready", title: "Listas para entregar", empty: "Nada esperando.", action: "Entregada", next: "delivered", back: "preparing" },
];
const SOUND_KEY = "panter:cocina-sonido";

/** Dos tonos cortos cuando entra una comanda nueva. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audio = new Ctx();
    [880, 1175].forEach((frequency, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + i * 0.18);
      osc.stop(audio.currentTime + i * 0.18 + 0.18);
    });
    window.setTimeout(() => void audio.close(), 900);
  } catch {
    /* el navegador no deja sonar sin un toque previo: no pasa nada */
  }
}

function Ticket({ ticket, column, now }: { ticket: KitchenTicket; column: (typeof COLUMNS)[number]; now: number }) {
  const utils = trpc.useUtils();
  const move = trpc.kitchen.setStatus.useMutation({ onSuccess: () => utils.kitchen.invalidate() });
  const minutes = Math.max(0, Math.floor((now - ticket.createdAt) / 60_000));
  const cook = ticket.items.filter((i) => i.kitchen);
  const others = ticket.items.filter((i) => !i.kitchen);
  return (
    <li className={`ticket${ticket.kitchenStatus !== "ready" && minutes >= 15 ? " is-late" : ""}`}>
      <div className="ticket__head">
        <strong>#{ticket.id}</strong>
        <span className="ticket__who">{ticket.customer}</span>
        <span className="ticket__time" title={`Pedido a las ${clock(ticket.createdAt)}`}>
          {minutes < 1 ? "ahora" : `hace ${minutes} min`}
        </span>
      </div>
      <ul className="ticket__items">
        {cook.map((i, n) => (
          <li key={n}>
            <b>{i.qty}</b> {i.name}
          </li>
        ))}
      </ul>
      {others.length > 0 && <p className="ticket__extra">Se entrega junto con: {others.map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name)).join(", ")}</p>}
      {ticket.note && <p className="ticket__note">{ticket.note}</p>}
      <Notice>{move.error?.message}</Notice>
      <div className="ticket__actions">
        <button className="btn" type="button" disabled={move.isPending} onClick={() => move.mutate({ orderId: ticket.id, status: column.next })}>
          {column.action}
        </button>
        {column.back && (
          <button className="app__link" type="button" disabled={move.isPending} onClick={() => move.mutate({ orderId: ticket.id, status: column.back! })}>
            Devolver un paso
          </button>
        )}
      </div>
    </li>
  );
}

export default function Kitchen() {
  const utils = trpc.useUtils();
  const board = trpc.kitchen.board.useQuery(undefined, { refetchInterval: 4000 });
  const undo = trpc.kitchen.setStatus.useMutation({ onSuccess: () => utils.kitchen.invalidate() });
  const now = useNowTick(20_000);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "no";
    } catch {
      return true;
    }
  });
  const tickets = board.data ?? [];
  const delivered = tickets.filter((t) => t.kitchenStatus === "delivered");

  // Aviso cuando entra una comanda que no estaba.
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!board.data) return;
    const pending = board.data.filter((t) => t.kitchenStatus === "pending").map((t) => t.id);
    if (seen.current && sound && pending.some((id) => !seen.current!.has(id))) chime();
    seen.current = new Set(board.data.map((t) => t.id));
  }, [board.data, sound]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    if (next) chime();
    try {
      localStorage.setItem(SOUND_KEY, next ? "si" : "no");
    } catch {
      /* sin almacenamiento */
    }
  };

  return (
    <div className="kitchen">
      <div className="kitchen__bar">
        <h2>Comandas</h2>
        <button className="btn btn--ghost btn--small" type="button" aria-pressed={sound} onClick={toggleSound}>
          Aviso sonoro: {sound ? "encendido" : "apagado"}
        </button>
      </div>
      {board.error && <Notice>{board.error.message}</Notice>}
      {!board.data && !board.error ? (
        <p className="empty">Cargando comandas…</p>
      ) : (
        <div className="kitchen__cols">
          {COLUMNS.map((column) => {
            const list = tickets.filter((t) => t.kitchenStatus === column.status);
            return (
              <section key={column.status} className={`kitchen__col kitchen__col--${column.status}`} aria-label={column.title}>
                <h3>
                  {column.title} <span>{list.length}</span>
                </h3>
                {list.length === 0 ? (
                  <p className="empty">{column.empty}</p>
                ) : (
                  <ul>
                    {list.map((t) => (
                      <Ticket key={t.id} ticket={t} column={column} now={now} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {delivered.length > 0 && (
        <details className="kitchen__done">
          <summary>Entregadas hace poco ({delivered.length})</summary>
          <ul>
            {delivered.map((t) => (
              <li key={t.id}>
                <span>
                  <strong>#{t.id}</strong> {t.customer}: {t.items.map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name)).join(", ")}
                </span>
                <button className="app__link" type="button" disabled={undo.isPending} onClick={() => undo.mutate({ orderId: t.id, status: "ready" })}>
                  No se entregó
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
