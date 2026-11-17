// Service worker de Arena Panter. Lo arma vite.config.ts al compilar: rellena la versión y las listas.
// Qué hace: guarda la app en el teléfono para que abra al instante y también sin conexión.
// Qué no toca: nada de /api. El saldo y los cobros siempre van directo al servidor.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const ASSETS = new Set(__ASSETS__);
const SHELL = `panter-shell-${VERSION}`;
const RUNTIME = "panter-runtime";
const PAGE = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("panter-shell-") && key !== SHELL) await caches.delete(key);
      }
      // Archivos de versiones viejas que ya no existen en el servidor.
      const runtime = await caches.open(RUNTIME);
      for (const request of await runtime.keys()) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith("/assets/") && !ASSETS.has(pathname)) await runtime.delete(request);
      }
      await self.clients.claim();
    })(),
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

// Páginas: primero la red, para recibir siempre la última versión. Sin conexión, la copia guardada.
async function page(request) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await Promise.race([fetch(request), timeout(4000)]);
    if (fresh.ok) await cache.put(PAGE, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(PAGE)) ?? Response.error();
  }
}

// Archivos con huella en el nombre: nunca cambian, así que la copia guardada sirve siempre.
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) (await caches.open(RUNTIME)).put(request, fresh.clone());
  return fresh;
}

// Iconos e imágenes sueltas: responde con la copia y la renueva por detrás.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => hit ?? Response.error());
  return hit ?? refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  if (request.mode === "navigate") event.respondWith(page(request));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(request));
});
