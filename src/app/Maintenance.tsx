import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpc, type BoardStation } from "./api";
import { Notice, clock } from "./ui";

// Quitarle el bloqueo a una PC desde el panel, para que el personal entre a ajustarla.
// El programa de esa PC deja Windows normal (sin pantalla de bloqueo ni de juegos) hasta la hora elegida
// o hasta que alguien pulse "Volver a bloquear".

const CHOICES: { minutes: number | null; label: string }[] = [
  { minutes: 30, label: "30 minutos" },
  { minutes: 60, label: "1 hora" },
  { minutes: 120, label: "2 horas" },
  { minutes: null, label: "Hasta que yo la bloquee" },
];

/** "Sin bloqueo hasta las 5:30 p. m." o "Sin bloqueo hasta que la bloqueen". Vacío si la PC no está en mantenimiento. */
export function maintenanceText(s: Pick<BoardStation, "state" | "unlockUntil" | "unlockForever">) {
  if (s.state !== "mantenimiento") return "";
  return s.unlockForever || !s.unlockUntil ? "Sin bloqueo hasta que la bloqueen" : `Sin bloqueo hasta las ${clock(s.unlockUntil)}`;
}

export function Maintenance({ s }: { s: BoardStation }) {
  const utils = trpc.useUtils();
  const unlock = trpc.admin.stationUnlock.useMutation({ onSuccess: () => utils.staff.invalidate() });
  const [asking, setAsking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (asking && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [asking]);

  // Solo las PCs con el programa instalado se pueden abrir, y nunca con un cliente jugando.
  if (s.kind !== "pc" || !s.hasAgent || s.session) return null;

  if (s.state === "mantenimiento") {
    return (
      <button type="button" disabled={unlock.isPending} onClick={() => unlock.mutate({ id: s.id, minutes: 0 })}>
        Volver a bloquear
      </button>
    );
  }

  const close = () => {
    setAsking(false);
    unlock.reset();
  };

  return (
    <>
      <button type="button" onClick={() => setAsking(true)}>
        Quitar el bloqueo
      </button>
      {asking &&
        createPortal(
          <dialog
            ref={dialog}
            className="ask"
            aria-labelledby={`ask-${s.id}`}
            onClose={close}
            // Un toque fuera del cuadro lo cierra.
            onClick={(e) => e.target === e.currentTarget && close()}
          >
            <div className="ask__box">
              <h2 id={`ask-${s.id}`}>Quitar el bloqueo de {s.label}</h2>
              <p>La PC queda con Windows normal, sin pantalla de bloqueo ni de juegos, para que puedas ajustarla. Mientras esté así no se puede poner a jugar.</p>
              {!s.online && <p className="ask__warn">Ahora mismo está apagada o sin conexión. Se abrirá en cuanto encienda y se conecte.</p>}
              <p className="ask__q">¿Por cuánto tiempo?</p>
              <div className="ask__choices">
                {CHOICES.map((c) => (
                  <button key={c.label} type="button" disabled={unlock.isPending} onClick={() => unlock.mutate({ id: s.id, minutes: c.minutes }, { onSuccess: close })}>
                    {c.label}
                  </button>
                ))}
              </div>
              <Notice>{unlock.error?.message}</Notice>
              <button type="button" className="ask__cancel" onClick={close}>
                Cancelar
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
