// Pantalla de juegos: qué hay instalado en esta PC, cómo se abre cada cosa y qué se limpia al terminar.
//
// Este archivo no depende de Electron, así se puede probar solo.
//  - detect()   busca los juegos de Steam y Epic instalados, y los lanzadores (Steam, Epic, Discord).
//  - resolve()  arma la lista final: lo detectado, menos lo oculto desde el panel, más lo cargado a mano.
//  - cleanup()  al terminar el tiempo cierra lo que quedó abierto e intenta cerrar las sesiones.
//
// Con PANTER_FIXTURES (pruebas) todas las rutas de Windows se buscan dentro de esa carpeta.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, spawn, execFile } = require("node:child_process");
const run = (file, args, timeout) => new Promise((done) => execFile(file, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => done(stdout || "")));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const IS_WINDOWS = process.platform === "win32";
const FIXTURES = process.env.PANTER_FIXTURES || "";
const env = (name, fallback = "") => process.env[name] || fallback;
const exists = (file) => {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
};
const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// ---------- Dónde vive cada cosa ----------
function regValue(key, name) {
  if (!IS_WINDOWS || FIXTURES) return "";
  try {
    const out = spawnSync("reg.exe", ["query", key, "/v", name], { encoding: "utf8", windowsHide: true, timeout: 4000 }).stdout || "";
    const match = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function places() {
  if (FIXTURES) {
    return {
      steam: path.join(FIXTURES, "steam"),
      epicManifests: path.join(FIXTURES, "epic", "Manifests"),
      epicExe: path.join(FIXTURES, "epic", "EpicGamesLauncher.exe"),
      epicSettings: path.join(FIXTURES, "epic", "GameUserSettings.ini"),
      discordExe: path.join(FIXTURES, "discord", "Update.exe"),
      discordDir: path.join(FIXTURES, "discord"),
      discordStorage: path.join(FIXTURES, "discord-data", "Local Storage", "leveldb"),
    };
  }
  const local = env("LOCALAPPDATA");
  const programData = env("PROGRAMDATA", "C:\\ProgramData");
  const pf86 = env("ProgramFiles(x86)", "C:\\Program Files (x86)");
  const steam = (regValue("HKCU\\Software\\Valve\\Steam", "SteamPath") || regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath") || path.join(pf86, "Steam")).replace(/\//g, "\\");
  const epicDir = path.join(pf86, "Epic Games", "Launcher", "Portal", "Binaries");
  return {
    steam,
    epicManifests: path.join(programData, "Epic", "EpicGamesLauncher", "Data", "Manifests"),
    epicExe: [path.join(epicDir, "Win64", "EpicGamesLauncher.exe"), path.join(epicDir, "Win32", "EpicGamesLauncher.exe")].find(exists) || "",
    epicSettings: path.join(local, "EpicGamesLauncher", "Saved", "Config", "Windows", "GameUserSettings.ini"),
    discordExe: path.join(local, "Discord", "Update.exe"),
    discordDir: path.join(local, "Discord"),
    discordStorage: path.join(env("APPDATA"), "discord", "Local Storage", "leveldb"),
  };
}

/**
 * Una carpeta solo entra en la lista de "cerrar lo que corra aquí" si es una carpeta concreta de un programa.
 * Un disco entero, Windows, Archivos de programa o la carpeta de usuarios nunca: cerraría medio sistema.
 */
function safeDir(dir) {
  if (!dir) return false;
  const parts = path.normalize(dir).split(/[\\/]+/).filter(Boolean);
  // En Windows, "D:\\Juegos" ya es una carpeta concreta (disco + carpeta); un disco solo, no.
  if (parts.length < (IS_WINDOWS ? 2 : 3)) return false;
  const lower = path.normalize(dir).toLowerCase().replace(/[\\/]+$/, "");
  const forbidden = [env("WINDIR", "C:\\Windows"), env("ProgramFiles", "C:\\Program Files"), env("ProgramFiles(x86)", "C:\\Program Files (x86)"), env("PROGRAMDATA", "C:\\ProgramData"), env("USERPROFILE"), env("USERPROFILE") && path.dirname(env("USERPROFILE")), env("LOCALAPPDATA"), env("APPDATA")]
    .filter(Boolean)
    .map((d) => path.normalize(d).toLowerCase().replace(/[\\/]+$/, ""));
  return !forbidden.includes(lower) && !lower.startsWith(`${forbidden[0]}${path.sep}`);
}

// ---------- Detección ----------
// Entradas de Steam que no son juegos: redistribuibles y herramientas internas.
const STEAM_NOT_GAMES = new Set(["228980", "1070560", "1391110", "1628350", "1493710", "2180100", "250820"]);
const STEAM_TOOL_NAMES = /^(Steamworks|Proton|Steam Linux Runtime|SteamVR$)/i;

function steamLibraries(steamDir) {
  const text = read(path.join(steamDir, "steamapps", "libraryfolders.vdf"));
  const found = [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"));
  // En las pruebas las bibliotecas extra también viven dentro de la carpeta simulada.
  const libraries = FIXTURES ? found.map((dir) => (path.isAbsolute(dir) && exists(dir) ? dir : path.join(FIXTURES, dir))) : found;
  return [...new Set([steamDir, ...libraries])].filter((dir) => exists(path.join(dir, "steamapps")));
}

function detectSteam(steamDir) {
  const games = [];
  for (const library of steamLibraries(steamDir)) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(library, "steamapps")).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      files = [];
    }
    for (const file of files) {
      const text = read(path.join(library, "steamapps", file));
      const id = (text.match(/"appid"\s+"(\d+)"/) || [])[1];
      const name = (text.match(/"name"\s+"([^"]+)"/) || [])[1];
      const dir = (text.match(/"installdir"\s+"([^"]+)"/) || [])[1];
      if (!id || !name || STEAM_NOT_GAMES.has(id) || STEAM_TOOL_NAMES.test(name)) continue;
      games.push({
        key: `steam:${id}`,
        name,
        category: "juego",
        source: "steam",
        target: `steam://rungameid/${id}`,
        image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
        dirs: dir ? [path.join(library, "steamapps", "common", dir)] : [],
      });
    }
  }
  return games;
}

function detectEpic(manifestsDir) {
  let files = [];
  try {
    files = fs.readdirSync(manifestsDir).filter((f) => f.endsWith(".item"));
  } catch {
    return [];
  }
  const games = [];
  for (const file of files) {
    let item;
    try {
      item = JSON.parse(read(path.join(manifestsDir, file)));
    } catch {
      continue;
    }
    // Los contenidos adicionales cuelgan de su juego principal: no se listan aparte.
    if (!item.AppName || !item.DisplayName || !item.LaunchExecutable || (item.MainGameAppName && item.MainGameAppName !== item.AppName)) continue;
    if (!/^[\w.-]{1,80}$/.test(item.AppName)) continue;
    const id = [item.CatalogNamespace, item.CatalogItemId, item.AppName].map(encodeURIComponent).join("%3A");
    games.push({
      key: `epic:${item.AppName}`,
      name: item.DisplayName,
      category: "juego",
      source: "epic",
      target: `com.epicgames.launcher://apps/${id}?action=launch&silent=true`,
      image: null,
      dirs: item.InstallLocation ? [item.InstallLocation] : [],
    });
  }
  return games;
}

/** Todo lo que esta PC tiene instalado y la pantalla de juegos puede abrir. */
function detect() {
  const where = places();
  const games = [...detectSteam(where.steam), ...detectEpic(where.epicManifests)];
  const steamExe = path.join(where.steam, "steam.exe");
  const apps = [
    exists(steamExe) && { key: "base:steam", name: "Steam", category: "app", source: "base", target: steamExe, args: null, image: null },
    where.epicExe && exists(where.epicExe) && { key: "base:epic", name: "Epic Games", category: "app", source: "base", target: where.epicExe, args: null, image: null },
    exists(where.discordExe) && { key: "base:discord", name: "Discord", category: "app", source: "base", target: where.discordExe, args: "--processStart Discord.exe", image: null },
  ].filter(Boolean);
  // Carpetas cuyos procesos se cierran al terminar la sesión.
  const killDirs = [where.steam, ...steamLibraries(where.steam).map((l) => path.join(l, "steamapps", "common")), ...games.flatMap((g) => g.dirs), where.discordDir];
  // ...\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe -> ...\Epic Games\Launcher
  if (where.epicExe) killDirs.push(FIXTURES ? path.dirname(where.epicExe) : path.resolve(where.epicExe, "..", "..", "..", ".."));
  return { games, apps, killDirs: [...new Set(killDirs.filter(safeDir))], where };
}

// ---------- Lista final ----------
const expand = (target) => target.replace(/%([A-Za-z0-9_()]+)%/g, (whole, name) => process.env[name] || process.env[name.toUpperCase()] || whole);
const isLink = (target) => /^[a-z][a-z0-9+.-]*:\/\//i.test(target);

// Lo mismo que exige el panel al guardar, vuelto a comprobar aquí: esta PC no ejecuta nada que no sea
// una ruta a un programa o un enlace de un lanzador conocido, venga de donde venga la lista.
const SAFE_PATH = /^(?:[a-zA-Z]:\\|%[A-Za-z0-9_()]+%\\)[^<>"|?*&;^`%\r\n]+\.(?:exe|lnk|url)$/i;
const SAFE_LINK = /^(?:steam|com\.epicgames\.launcher|discord|minecraft|roblox|roblox-player|battlenet|uplay|origin2|https):\/\/[^\s"<>]+$/i;
const safeTarget = (target) => typeof target === "string" && ((SAFE_PATH.test(target) && !target.includes("..\\")) || SAFE_LINK.test(target));

/**
 * Lo que se muestra: los juegos detectados menos los ocultos, las apps base y lo cargado a mano en el panel.
 * De lo cargado a mano solo se muestra lo que existe en esta PC (un juego puede estar instalado en unas y en otras no).
 */
function resolve(detected, remote) {
  const hidden = new Set(remote?.hidden ?? []);
  const items = [...detected.games.filter((g) => !hidden.has(g.key)), ...detected.apps];
  const targets = new Set(items.map((i) => i.target.toLowerCase()));
  for (const app of remote?.apps ?? []) {
    if (!safeTarget(app.target) || typeof app.name !== "string" || typeof app.key !== "string") continue;
    const target = isLink(app.target) ? app.target : expand(app.target);
    if (!isLink(target) && !exists(target)) continue;
    if (targets.has(target.toLowerCase())) continue;
    targets.add(target.toLowerCase());
    items.push({ key: app.key, name: app.name, category: app.category === "app" ? "app" : "juego", source: "panel", target, args: app.args || null, image: app.image || null });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, "es");
  return [...items.filter((i) => i.category === "juego").sort(byName), ...items.filter((i) => i.category === "app")];
}

// ---------- Abrir ----------
function splitArgs(text) {
  return [...String(text || "").matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/**
 * Abre un juego o una app. Los enlaces (steam://…) los abre el propio lanzador; los programas se arrancan sueltos,
 * sin pasar por una consola, así que una ruta o unos argumentos raros no pueden ejecutar otra cosa.
 * Devuelve el pid cuando el programa lo arrancó este proceso.
 */
async function launch(item, openExternal, openPath) {
  if (isLink(item.target)) {
    await openExternal(item.target);
    return { ok: true, pid: null };
  }
  if (!exists(item.target)) return { ok: false, error: "Ese programa ya no está en esta PC. Avisa en caja." };
  if (/\.(lnk|url)$/i.test(item.target)) {
    const problem = await openPath(item.target);
    return problem ? { ok: false, error: "No se pudo abrir. Avisa en caja." } : { ok: true, pid: null };
  }
  return new Promise((done) => {
    try {
      const child = spawn(item.target, splitArgs(item.args), { cwd: path.dirname(item.target), detached: true, stdio: "ignore", windowsHide: false });
      child.on("error", () => done({ ok: false, error: "No se pudo abrir. Avisa en caja." }));
      child.on("spawn", () => {
        child.unref();
        done({ ok: true, pid: child.pid });
      });
    } catch {
      done({ ok: false, error: "No se pudo abrir. Avisa en caja." });
    }
  });
}

// ---------- Limpieza al terminar la sesión ----------
async function listProcesses() {
  if (IS_WINDOWS) {
    const script = "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }";
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 25000);
    return out
      .split(/\r?\n/)
      .map((line) => line.split("|"))
      .filter((parts) => parts.length === 2 && Number(parts[0]) > 0)
      .map(([pid, exe]) => ({ pid: Number(pid), exe: exe.trim() }));
  }
  // Fuera de Windows (pruebas): /proc dice qué programa es cada proceso.
  const list = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      list.push({ pid: Number(entry), exe: fs.readlinkSync(`/proc/${entry}/exe`) });
    } catch {
      /* proceso de otro usuario o ya terminado */
    }
  }
  return list;
}

async function kill(pid) {
  try {
    if (IS_WINDOWS) await run("taskkill.exe", ["/F", "/T", "/PID", String(pid)], 8000);
    else process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

const norm = (file) => path.normalize(file).toLowerCase();
const inside = (file, dir) => {
  const f = norm(file);
  const d = norm(dir).replace(/[\\/]+$/, "");
  return f.startsWith(d + path.sep) || f.startsWith(`${d}/`) || f.startsWith(`${d}\\`);
};

/** Cierra lo que el cliente dejó abierto: lo que vive en las carpetas de juegos, los programas cargados a mano y lo que se arrancó desde aquí. */
async function closeApps({ killDirs, exes, pids, protect }) {
  const windowsDir = norm(env("WINDIR", "C:\\Windows"));
  const exact = new Set(exes.map(norm));
  const started = new Set(pids);
  const closed = [];
  for (const proc of await listProcesses()) {
    if (proc.pid === process.pid || protect.includes(proc.pid)) continue;
    // Nunca se toca nada de Windows, aunque alguien cargue en el panel un programa del sistema.
    const system = IS_WINDOWS && inside(proc.exe, windowsDir);
    const match = started.has(proc.pid) || (!system && (exact.has(norm(proc.exe)) || killDirs.some((dir) => inside(proc.exe, dir))));
    if (match && (await kill(proc.pid))) closed.push(path.basename(proc.exe));
  }
  return closed;
}

/** Deja Steam, Epic y Discord pidiendo usuario y clave otra vez. Cada paso es independiente: si uno falla, los demás siguen. */
function signOut(where) {
  const done = [];
  const attempt = (name, run) => {
    try {
      if (run()) done.push(name);
    } catch {
      /* ese programa no está o cambió su formato: se sigue con el resto */
    }
  };
  attempt("steam", () => {
    const file = path.join(where.steam, "config", "loginusers.vdf");
    const text = read(file);
    if (!text) return false;
    fs.writeFileSync(file, text.replace(/("(?:AllowAutoLogin|RememberPassword)"\s+)"1"/g, '$1"0"'));
    if (IS_WINDOWS && !FIXTURES) {
      spawnSync("reg.exe", ["add", "HKCU\\Software\\Valve\\Steam", "/v", "AutoLoginUser", "/t", "REG_SZ", "/d", "", "/f"], { windowsHide: true, timeout: 4000 });
      spawnSync("reg.exe", ["add", "HKCU\\Software\\Valve\\Steam", "/v", "RememberPassword", "/t", "REG_DWORD", "/d", "0", "/f"], { windowsHide: true, timeout: 4000 });
    }
    return true;
  });
  attempt("epic", () => {
    const text = read(where.epicSettings);
    if (!text) return false;
    // Dentro de [RememberMe] se quita el dato guardado y se apaga la opción; el resto del archivo queda igual.
    const cleaned = text.replace(/(\[RememberMe\][^[]*)/, (section) => section.replace(/^Data=.*$/m, "Data=").replace(/^Enable=.*$/m, "Enable=False"));
    fs.writeFileSync(where.epicSettings, cleaned);
    return true;
  });
  attempt("discord", () => {
    if (!exists(where.discordStorage)) return false;
    fs.rmSync(where.discordStorage, { recursive: true, force: true });
    return true;
  });
  return done;
}

/**
 * Al terminar el tiempo: se le pide a Steam que cierre bien, se cierra todo lo demás y, si está activado,
 * se cierran las sesiones para que el siguiente cliente no encuentre la cuenta del anterior.
 */
async function cleanup({ detected, items, pids, protect = [], doSignOut }) {
  const where = detected.where;
  const steamExe = path.join(where.steam, "steam.exe");
  if (IS_WINDOWS && !FIXTURES && exists(steamExe)) {
    // Steam guarda la partida en la nube al cerrarse bien: se le dan unos segundos antes de cerrar el resto a la fuerza.
    try {
      spawn(steamExe, ["-shutdown"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      await sleep(4000);
    } catch {
      /* Steam no arrancó: se sigue con el cierre normal */
    }
  }
  const exes = items.filter((i) => !isLink(i.target) && /\.exe$/i.test(i.target)).map((i) => i.target);
  const closed = await closeApps({ killDirs: detected.killDirs, exes, pids, protect });
  const signedOut = doSignOut ? signOut(where) : [];
  return { closed, signedOut };
}

module.exports = { detect, resolve, launch, cleanup, listProcesses, isLink, places };
