// Servidor simulado para la autoprueba del programa de bloqueo (ver runSelfTest en main.js).
// Hace de web: primero la PC está libre y bloqueada, a los 10 segundos un cliente empieza a jugar
// y a los 26 se le acaba el tiempo. Con PANTER_FIXTURES arma además una PC de mentira dentro de esa
// carpeta (Steam, Epic y Discord simulados) para probar la pantalla de juegos y la limpieza al terminar.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIX = process.env.PANTER_FIXTURES || "";
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const vdfPath = (dir) => dir.replace(/\\/g, "\\\\");
const manifest = (id, name, dir) => `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"${dir}"\n}\n`;
// Un "juego" de prueba: una copia de node con otro nombre, para poder reconocerla y cerrarla sin tocar nada más.
const fakeExe = (file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(process.execPath, file);
  fs.chmodSync(file, 0o755);
  return file;
};

let testGame = "";
if (FIX) {
  const steam = path.join(FIX, "steam");
  write(path.join(steam, "steam.exe"), "");
  write(path.join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${vdfPath(steam)}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"biblioteca2"\n\t}\n}\n`);
  write(path.join(steam, "steamapps", "appmanifest_730.acf"), manifest(730, "Counter-Strike 2", "Counter-Strike Global Offensive"));
  write(path.join(steam, "steamapps", "appmanifest_228980.acf"), manifest(228980, "Steamworks Common Redistributables", "Steamworks Shared"));
  write(path.join(FIX, "biblioteca2", "steamapps", "appmanifest_570.acf"), manifest(570, "Dota 2", "dota 2 beta"));
  write(path.join(steam, "config", "loginusers.vdf"), `"users"\n{\n\t"76561190000000000"\n\t{\n\t\t"AccountName"\t\t"cliente"\n\t\t"RememberPassword"\t\t"1"\n\t\t"AllowAutoLogin"\t\t"1"\n\t\t"MostRecent"\t\t"1"\n\t}\n}\n`);
  fakeExe(path.join(steam, "steamapps", "common", "Counter-Strike Global Offensive", "cs2.exe"));
  const item = (extra) => JSON.stringify({ CatalogNamespace: "fn", CatalogItemId: "4fe75bbc5a674f4f9b356b5c90567da5", LaunchExecutable: "Juego.exe", InstallLocation: path.join(FIX, "epic-juegos", "Fortnite"), ...extra });
  write(path.join(FIX, "epic", "Manifests", "juego.item"), item({ AppName: "Fortnite", DisplayName: "Fortnite", MainGameAppName: "Fortnite" }));
  write(path.join(FIX, "epic", "Manifests", "extra.item"), item({ AppName: "FortniteExtra", DisplayName: "Contenido adicional", MainGameAppName: "Fortnite" }));
  write(path.join(FIX, "epic", "GameUserSettings.ini"), "[RememberMe]\nEnable=True\nData=ZGF0b3MgZGUgcHJ1ZWJh\n\n[Otra]\nIdioma=es\n");
  write(path.join(FIX, "discord-data", "Local Storage", "leveldb", "000003.log"), "sesion de prueba");
  testGame = fakeExe(path.join(FIX, "juegos", "juego-de-prueba.exe"));
}

let firstAt = 0;
let catalog = null;
const body = (req) =>
  new Promise((done) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      try {
        done(JSON.parse(text || "{}"));
      } catch {
        done({});
      }
    });
  });

http
  .createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const url = req.url.split("?")[0];
    if (url === "/api/agent/launcher") {
      req.resume();
      return res.end(
        JSON.stringify({
          enabled: true,
          signOut: true,
          hidden: ["steam:570"],
          apps: [
            { key: "app:1", name: "Juego de prueba", category: "juego", target: testGame || "C:\\no\\existe.exe", args: '-e "setTimeout(() => {}, 600000)"', image: null },
            { key: "app:2", name: "No instalado en esta PC", category: "juego", target: path.join(FIX || "C:\\", "no-existe.exe"), args: null, image: null },
          ],
        }),
      );
    }
    if (url === "/api/agent/catalog") {
      catalog = (await body(req)).items ?? null;
      return res.end(JSON.stringify({ ok: true }));
    }
    if (url === "/selftest/state") {
      req.resume();
      return res.end(JSON.stringify({ catalog }));
    }
    req.resume();
    const t = Date.now();
    if (!firstAt) firstAt = t;
    const elapsed = t - firstAt;
    const playing = elapsed >= 10_000 && elapsed < 26_000;
    const endsAt = firstAt + 10_000 + 5 * 60_000;
    res.end(
      JSON.stringify({
        serverTime: t,
        station: { number: 7, label: "PC 07" },
        state: playing ? "activa" : "bloqueada",
        pairCode: playing ? null : "1234",
        session: playing ? { id: 1, memberName: "Ana", endsAt, graceEndsAt: endsAt + 5 * 60_000 } : null,
        unlockUntil: null,
        launcher: { enabled: true, version: "prueba-1" },
      }),
    );
  })
  .listen(47811, "127.0.0.1", () => console.log("servidor de autoprueba en http://127.0.0.1:47811"));
