import { useEffect, useRef, useState } from "react";
import { PantherMark, Wordmark } from "../components/Logo";
import { trpc, type MemberHome } from "./api";
import { Qr, ref } from "./ui";

// Tarjeta a pantalla completa para pagar en el mostrador.
// Va en vertical porque así el QR ocupa casi todo el ancho del teléfono y la caja lo lee de una.
export default function PayCard({ home, onClose }: { home: MemberHome; onClose: () => void }) {
  const utils = trpc.useUtils();
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // La última orden que existía al abrir: cualquier orden posterior es el cobro que se acaba de hacer.
  const [lastOrderAtOpen] = useState(() => home.orders[0]?.id ?? 0);
  const charged = home.orders.find((o) => o.id > lastOrderAtOpen && o.status === "paid");

  useEffect(() => {
    closeButton.current?.focus();
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);

    // Con la tarjeta abierta se consulta el saldo cada 3 s, para que el cobro aparezca apenas lo hace la caja.
    const poll = window.setInterval(() => void utils.member.home.invalidate(), 3000);

    // Mantiene la pantalla encendida mientras se muestra el código. Si el navegador no lo permite, no pasa nada.
    let lock: WakeLockSentinel | null = null;
    let closed = false;
    const keepAwake = async () => {
      try {
        const sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        if (closed) void sentinel?.release();
        else lock = sentinel;
      } catch {
        /* sin permiso o sin soporte */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void keepAwake();
    };
    void keepAwake();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      void lock?.release();
      window.clearInterval(poll);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      document.body.classList.remove("no-scroll");
    };
  }, [utils]);

  return (
    <div className="pay" role="dialog" aria-modal="true" aria-label="Tarjeta Panter para pagar">
      <div className="pay__top">
        <h2>Pagar con tarjeta Panter</h2>
        <button ref={closeButton} className="btn btn--ghost btn--small" type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <div className="pay__stage">
        <div className="dcard">
          <PantherMark className="dcard__art" />
          <div className="dcard__brand">
            <PantherMark className="dcard__mark" lit />
            <Wordmark className="dcard__word" />
            <svg className="dcard__chip" viewBox="0 0 48 36" aria-hidden="true">
              <rect x="0.75" y="0.75" width="46.5" height="34.5" rx="6" />
              <path d="M0.75 12.5H16M0.75 23.5H16M47.25 12.5H32M47.25 23.5H32M16 0.75V35.25M32 0.75V35.25M16 18H32" />
            </svg>
          </div>
          <div className="dcard__code">
            <Qr value={home.cardQr} className="dcard__qr" />
          </div>
          <div className="dcard__who">
            <span className="dcard__serial">{home.memberCode}</span>
            <span className="dcard__name">{home.name}</span>
            <span className="dcard__level">Nivel {home.level.current.name}</span>
          </div>
        </div>
      </div>

      <div className="pay__bottom">
        {charged ? (
          <p className="notice notice--ok pay__done" role="status">
            Pago aprobado. Orden #{charged.id} por {ref(charged.totalCents)}.
          </p>
        ) : (
          <p className="pay__hint">Muestra este código en el mostrador.</p>
        )}
        <p className="pay__balance">
          Saldo disponible <strong>{ref(home.balanceCents)}</strong>
        </p>
      </div>
    </div>
  );
}
