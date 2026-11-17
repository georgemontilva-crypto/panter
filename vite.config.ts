import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Arma /sw.js al compilar, con la lista real de archivos de esta versión.
// Se guarda de entrada lo necesario para abrir la portada y la cuenta; el lector de QR y los ajustes
// del administrador se guardan la primera vez que se usan.
function serviceWorker(): Plugin {
  return {
    name: "panter-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).map((file) => `/${file}`);
      const core = assets.filter((file) => /\.(js|css)$/.test(file) && !/\/(Scanner|Admin)-/.test(file));
      const font = assets.filter((file) => /saira-latin-wdth[^/]*\.woff2$/.test(file));
      const precache = ["/index.html", "/manifest.webmanifest", "/icon-192.png", ...core, ...font];
      const version = createHash("sha256").update(assets.sort().join("|")).digest("hex").slice(0, 10);
      const source = readFileSync(new URL("./pwa/sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache))
        .replace("__ASSETS__", JSON.stringify(assets));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    host: true,
    // En desarrollo la API corre aparte (npm run dev:server) en el puerto 3001.
    proxy: { "/api": "http://localhost:3001" },
  },
});
