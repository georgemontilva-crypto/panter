// Servidor de producción sin dependencias: sirve la carpeta dist/ que genera `npm run build`.
// Railway define PORT automáticamente; no hace falta configurar variables de entorno.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT) || 3000;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
const compressible = new Set([".html", ".js", ".css", ".svg", ".json", ".txt"]);

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(root, clean);
  if (!candidate.startsWith(root)) return null;
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    /* no existe: cae al index.html */
  }
  return null;
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const file = (await resolveFile(pathname)) ?? join(root, "index.html");
    const ext = extname(file);
    let body = await readFile(file);
    const headers = {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      // Los archivos de /assets llevan hash en el nombre: se pueden cachear un año.
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
    };
    if (compressible.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
      body = gzipSync(body);
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
    }
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Error del servidor. ¿Corriste `npm run build`?");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Arena Panter en http://localhost:${port}`);
});
