import { useSyncExternalStore } from "react";

// ---------- Service worker ----------
// Guarda la app en el teléfono: abre al instante y también sin conexión.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastCheck = Date.now();

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Una app instalada puede pasar días abierta: al volver a ella se busca si hay versión nueva.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible" || Date.now() - lastCheck < 30 * 60_000) return;
          lastCheck = Date.now();
          void registration.update().catch(() => {});
        });
      })
      .catch(() => {});
  });

  // Llegó una versión nueva mientras la app estaba abierta: se recarga cuando el cliente no la está mirando,
  // para no interrumpirlo a mitad de algo.
  let stale = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    if (document.visibilityState === "hidden") window.location.reload();
    else stale = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (stale && document.visibilityState === "hidden") window.location.reload();
  });
}

// ---------- Instalación ----------
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let promptEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Chrome avisa una sola vez, y puede hacerlo antes de que cargue la pantalla de la cuenta: se guarda aquí.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    notify();
  });
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone y iPad no tienen botón de instalar: se hace desde el menú Compartir de Safari. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function useInstallPrompt() {
  const available = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => promptEvent !== null,
  );
  const install = async () => {
    const event = promptEvent;
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    promptEvent = null;
    notify();
    return outcome === "accepted";
  };
  return { available, install };
}
