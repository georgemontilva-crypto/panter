import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Lector de QR con la cámara del teléfono o de la computadora.
// Se lee el video cuadro por cuadro con jsQR, que funciona igual en iPhone (Safari) y Android.
export default function Scanner({
  title,
  hint,
  onResult,
  onClose,
}: {
  title: string;
  hint: string;
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const handlers = useRef({ onResult, onClose });
  handlers.current = { onResult, onClose };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let lastScan = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = (time: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(scan);
      const v = video.current;
      // Unas 8 lecturas por segundo: suficiente para leer al instante sin calentar el teléfono.
      if (!v || !ctx || v.readyState < 2 || !v.videoWidth || time - lastScan < 120) return;
      lastScan = time;
      const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (code?.data) {
        stopped = true;
        handlers.current.onResult(code.data);
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara. Escribe el código a mano.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        setReady(true);
        frame = requestAnimationFrame(scan);
      } catch (cause) {
        const name = (cause as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("No hay permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio y vuelve a intentar.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("No encontramos una cámara en este dispositivo. Escribe el código a mano.");
        } else {
          setError("No se pudo abrir la cámara. Cierra otras apps que la estén usando y vuelve a intentar.");
        }
      }
    };

    void start();
    closeButton.current?.focus();
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && handlers.current.onClose();
    window.addEventListener("keydown", onKey);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      document.body.classList.remove("no-scroll");
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={title}>
      {/* playsInline: sin esto el iPhone abre el video a pantalla completa y tapa la interfaz. */}
      <video ref={video} className="scanner__video" playsInline muted autoPlay />
      {!error && <div className="scanner__frame" aria-hidden="true" />}
      <div className="scanner__top">
        <h2>{title}</h2>
      </div>
      <div className="scanner__bottom">
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : (
          <p className="scanner__hint">{ready ? hint : "Abriendo la cámara…"}</p>
        )}
        <button ref={closeButton} className="btn btn--ghost" type="button" onClick={onClose}>
          {error ? "Cerrar" : "Cancelar"}
        </button>
      </div>
    </div>
  );
}
