// Panter Bloqueo: programa que corre en cada PC de la arena.
// Cada 3 segundos pregunta al servidor qué debe hacer con esta máquina:
//   bloqueada      -> pantalla de bloqueo con el número de la PC y el código para activarla
//   activa         -> pantalla de juegos (solo los juegos y apps de la arena) + contador en una esquina
//   gracia         -> aviso grande: "se acabó tu tiempo, guarda tu partida" (minutos extra)
//   mantenimiento  -> escritorio normal de Windows para el personal
// Si se cae el internet con una sesión en curso, sigue contando con la última hora de fin conocida.

const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile, spawnSync } = require("node:child_process");
const QRCode = require("qrcode");
const games = require("./launcher");

const POLL_MS = 3000;
const OFFLINE_AFTER_MS = 15000;
// PANTER_CONFIG_DIR permite usar otra carpeta de configuración (pruebas).
if (process.env.PANTER_CONFIG_DIR) app.setPath("userData", process.env.PANTER_CONFIG_DIR);
const configFile = () => path.join(app.getPath("userData"), "config.json");
const ICON = path.join(__dirname, "build", "icon.ico");
const sha = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

let config = null; // { serverUrl, token, pinHash }
let lockWin = null;
let launcherWin = null;
let overlayWin = null;
let setupWin = null;
let quitting = false;
let shuttingDown = false;

// Lo último que dijo el servidor, con las horas ya convertidas al reloj de esta PC.
let remote = null; // { state, station, pairCode, session: { memberName, endsAt, graceEndsAt }, unlockUntil }
let lastOkAt = 0;
const bootAt = Date.now();
let lastError = "";
let lastSent = "";
let lastPhase = "";

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    if (parsed.serverUrl && parsed.token) config = parsed;
  } catch {
    config = null;
  }
}

function saveConfig(next) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
  config = next;
}

// ---------- Blindaje de Windows ----------
// Dos piezas que hacen que la pantalla de bloqueo no tenga salida:
//  1. keyblock.exe descarta la tecla Windows, Alt+Tab, Alt+F4 y Ctrl+Esc mientras la PC está bloqueada.
//     Con un cliente jugando descarta solo la tecla Windows y Ctrl+Esc, y esconde la barra de tareas.
//  2. Unas políticas de Windows para este usuario quitan el Administrador de tareas y dejan la
//     pantalla de Ctrl+Alt+Supr sin "Bloquear", "Cerrar sesión" ni "Cambiar contraseña".
// Todo es reversible: se quita al entrar en mantenimiento, al cerrar el programa con la clave
// y al desinstalar. Fuera de Windows (pruebas) estas funciones no hacen nada.
const IS_WINDOWS = process.platform === "win32";
let guard = null;
// "lock" (PC bloqueada), "session" (cliente en la pantalla de juegos) o "unlock" (todo libre).
let guardMode = "unlock";
let taskbarHidden = false;
let taskbarInfo = "sin datos";
let taskbarSentAt = 0;
let policiesOn = null;
// "activo", o el motivo por el que las teclas del sistema no están protegidas.
let guardStatus = IS_WINDOWS ? "sin iniciar" : "no aplica (no es Windows)";

function guardPath() {
  return app.isPackaged ? path.join(process.resourcesPath, "keyblock.exe") : path.join(__dirname, "keyblock.exe");
}

function startGuard() {
  if (!IS_WINDOWS || guard || quitting) return;
  if (!fs.existsSync(guardPath())) {
    guardStatus = "falta keyblock.exe (puede haberlo borrado el antivirus)";
    return;
  }
  try {
    const child = spawn(guardPath(), [String(process.pid)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    guardStatus = "iniciando";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      if (text.includes("ready")) guardStatus = "activo";
      const taskbar = text.match(/taskbar (hidden|shown) (\d+)/);
      if (taskbar) taskbarInfo = `${taskbar[1] === "hidden" ? "oculta" : "visible"} (${taskbar[2]} encontradas)`;
    });
    child.stderr.on("data", (chunk) => {
      guardStatus = `error: ${String(chunk).trim().slice(0, 60)}`;
    });
    child.on("error", (error) => {
      if (guard === child) guard = null;
      guardStatus = `no arrancó: ${String(error.code || error.message).slice(0, 60)}`;
    });
    // Si alguien lo cierra, se vuelve a lanzar en el siguiente ciclo (render corre cada segundo).
    child.on("exit", (code) => {
      if (guard === child) guard = null;
      if (!quitting && guardStatus === "activo") guardStatus = `se detuvo (código ${code})`;
    });
    child.stdin.on("error", () => {});
    guard = child;
    child.stdin.write(`${guardMode}\n${taskbarHidden ? "taskbar-hide\n" : ""}`);
  } catch (error) {
    guard = null;
    guardStatus = `no arrancó: ${String(error.message).slice(0, 60)}`;
  }
}

/** Qué teclas del sistema se descartan y si la barra de tareas queda escondida. */
function setGuard(mode, hideTaskbar) {
  if (!IS_WINDOWS) return;
  const wanted = mode !== "unlock" || hideTaskbar;
  const modeChanged = mode !== guardMode;
  const taskbarChanged = hideTaskbar !== taskbarHidden;
  guardMode = mode;
  taskbarHidden = hideTaskbar;
  if (!guard) {
    if (wanted) startGuard();
    return;
  }
  try {
    if (modeChanged) guard.stdin.write(`${mode}\n`);
    // Windows vuelve a mostrar la barra por su cuenta de vez en cuando: se insiste cada pocos segundos.
    if (taskbarChanged || (hideTaskbar && Date.now() - taskbarSentAt > 4000)) {
      taskbarSentAt = Date.now();
      guard.stdin.write(hideTaskbar ? "taskbar-hide\n" : "taskbar-show\n");
    }
  } catch {
    /* el ayudante murió: se relanza en el siguiente ciclo */
  }
}

function stopGuard() {
  const child = guard;
  guard = null;
  guardMode = "unlock";
  taskbarHidden = false;
  if (!child) return;
  try {
    child.stdin.end("taskbar-show\nquit\n");
  } catch {
    /* ya estaba cerrado */
  }
  setTimeout(() => child.kill(), 300).unref();
}

const POLICIES = [
  ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", "DisableTaskMgr"],
  ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", "DisableLockWorkstation"],
  ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", "DisableChangePassword"],
  ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer", "NoLogoff"],
];

function setPolicies(on, wait = false) {
  if (!IS_WINDOWS || policiesOn === on) return;
  policiesOn = on;
  for (const [key, name] of POLICIES) {
    const args = on ? ["add", key, "/v", name, "/t", "REG_DWORD", "/d", "1", "/f"] : ["delete", key, "/v", name, "/f"];
    // Si la cuenta no tiene permiso para escribir la política, se sigue sin ella (ver README).
    try {
      if (wait) spawnSync("reg.exe", args, { windowsHide: true, timeout: 4000 });
      else execFile("reg.exe", args, { windowsHide: true }, () => {});
    } catch {
      /* sin reg.exe no hay nada que hacer */
    }
  }
}

// ---------- Cierre ----------
// Único camino para cerrar el programa. Antes se usaba app.quit(), que en Windows se cancelaba
// (la ventana de bloqueo no se dejaba cerrar) y dejaba la pantalla congelada con un error detrás.
// Aquí se paran los relojes, se sueltan el teclado y las políticas, se destruyen las ventanas
// y se termina el proceso sin pedirle permiso a ninguna ventana.
const timers = [];
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  quitting = true;
  for (const id of timers) clearInterval(id);
  try {
    if (guard) {
      // No se mata: al recibir "quit" (o al ver que este programa terminó) devuelve la barra de tareas y sale solo.
      const child = guard;
      guard = null;
      child.stdin.end("taskbar-show\nquit\n");
    }
  } catch {
    /* el ayudante ya no estaba */
  }
  setPolicies(false, true);
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.destroy();
    } catch {
      /* ya destruida */
    }
  }
  app.exit(code);
}

// Un error inesperado nunca debe abrir un cuadro de diálogo: quedaría escondido detrás de la
// pantalla de bloqueo y congelaría la PC. Se anota en error.log y el programa sigue.
function logError(kind, error) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(path.join(app.getPath("userData"), "error.log"), `${new Date().toISOString()} ${kind}: ${error?.stack || error}\n`);
  } catch {
    /* sin disco no se anota */
  }
}
process.on("uncaughtException", (error) => logError("uncaughtException", error));
process.on("unhandledRejection", (error) => logError("unhandledRejection", error));

// ---------- Ventanas ----------
function createLockWindow() {
  lockWin = new BrowserWindow({
    show: false,
    frame: false,
    icon: ICON,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  lockWin.setAlwaysOnTop(true, "screen-saver");
  lockWin.setMenu(null);
  lockWin.loadFile(path.join(__dirname, "lock.html"));
  // Alt+F4 y similares: mientras el programa no se esté cerrando a propósito, la ventana no se cierra.
  lockWin.on("close", (event) => {
    if (!quitting) event.preventDefault();
  });
  lockWin.webContents.on("before-input-event", (event, input) => {
    const combo = (input.control || input.alt || input.meta) && input.type === "keyDown";
    if (combo && ["r", "w", "i", "f4", "tab"].includes(input.key.toLowerCase())) event.preventDefault();
  });
}

// Mientras la PC no esté conectada no hay nada que bloquear: la configuración se hace en una
// ventana normal, con barra de título, que se puede minimizar, mover y cerrar.
function createSetupWindow() {
  setupWin = new BrowserWindow({
    width: 620,
    height: 660,
    icon: ICON,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  setupWin.setMenu(null);
  setupWin.loadFile(path.join(__dirname, "lock.html"));
  setupWin.on("closed", () => {
    setupWin = null;
    // Cerrar la ventana sin haber conectado la PC cierra el programa.
    if (!config) shutdown();
  });
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    width: 300,
    height: 96,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(path.join(__dirname, "overlay.html"));
  overlayWin.on("close", (event) => {
    if (!quitting) event.preventDefault();
  });
}

// ---------- Pantalla de juegos ----------
// Con un cliente jugando, en vez del escritorio de Windows se muestra esta ventana a pantalla completa
// con los juegos y las apps. No va "siempre encima": los juegos que se abren quedan delante de ella.
function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    show: false,
    frame: false,
    icon: ICON,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  launcherWin.setMenu(null);
  launcherWin.loadFile(path.join(__dirname, "launcher.html"));
  launcherWin.on("close", (event) => {
    if (!quitting) event.preventDefault();
  });
  // Nada de enlaces ni ventanas nuevas desde aquí: lo único que se abre son los juegos de la lista.
  launcherWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  launcherWin.webContents.on("will-navigate", (event) => event.preventDefault());
  launcherWin.webContents.on("before-input-event", (event, input) => {
    const combo = (input.control || input.alt || input.meta) && input.type === "keyDown";
    if (combo && ["r", "w", "i", "f4"].includes(input.key.toLowerCase())) event.preventDefault();
  });
}

function showLauncher() {
  const target = screen.getPrimaryDisplay().bounds;
  const now = launcherWin.getBounds();
  if (now.x !== target.x || now.y !== target.y || now.width !== target.width || now.height !== target.height) launcherWin.setBounds(target);
  if (!launcherWin.isVisible()) {
    launcherWin.show();
    launcherWin.focus();
  }
}

function hideLauncher() {
  if (launcherWin && !launcherWin.isDestroyed() && launcherWin.isVisible()) launcherWin.hide();
}

// Lo que se sabe de la pantalla de juegos:
let detected = { games: [], apps: [], killDirs: [], where: games.places() }; // lo instalado en esta PC
let panel = null; // lo que manda el panel: { enabled, signOut, hidden, apps }
let panelVersion = "";
let items = []; // la lista final que se muestra
let startedPids = []; // programas que se arrancaron desde aquí en esta sesión
let desktopForStaff = false; // el personal pidió el escritorio normal durante esta sesión
let inSession = false;
let lastCatalog = "";
let lastCleanup = null;
const panelFile = () => path.join(app.getPath("userData"), "launcher.json");
const sessionMark = () => path.join(app.getPath("userData"), "sesion-abierta");
/** Sin respuesta del panel todavía (o un servidor antiguo), la PC muestra el escritorio como antes. */
const launcherOn = () => panel?.enabled === true;

function rebuildItems() {
  items = games.resolve(detected, panel);
  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send("items", publicItems());
}
const publicItems = () => items.map((i) => ({ key: i.key, name: i.name, category: i.category, image: i.image, source: i.source }));

function rescan() {
  try {
    detected = games.detect();
  } catch (error) {
    logError("detect", error);
  }
  rebuildItems();
  void reportCatalog();
}

/** Le cuenta al panel qué juegos hay instalados aquí, para poder ocultarlos desde allá. Solo cuando cambia. */
async function reportCatalog() {
  if (!config) return;
  const body = JSON.stringify({ items: detected.games.map((g) => ({ key: g.key, name: g.name })) });
  if (body === lastCatalog) return;
  try {
    const response = await fetch(`${config.serverUrl}/api/agent/catalog`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) lastCatalog = body;
  } catch {
    /* sin conexión: se reintenta en el siguiente escaneo */
  }
}

async function refreshPanel() {
  try {
    const response = await fetch(`${config.serverUrl}/api/agent/launcher`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    panel = await response.json();
    fs.writeFileSync(panelFile(), JSON.stringify(panel));
    rebuildItems();
    return true;
  } catch {
    return false;
  }
}

/** Al terminar el tiempo: cerrar lo que quedó abierto y, si el panel lo pide, cerrar las sesiones de las apps. */
function cleanSession() {
  const snapshot = { detected, items: [...items], pids: [...startedPids], protect: guard ? [guard.pid] : [], doSignOut: panel?.signOut !== false };
  startedPids = [];
  games
    .cleanup(snapshot)
    .then((result) => {
      lastCleanup = result;
    })
    .catch((error) => logError("cleanup", error))
    .finally(() => fs.rmSync(sessionMark(), { force: true }));
}

function placeOverlay(big) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = big ? Math.min(760, workArea.width - 40) : 300;
  const height = big ? 150 : 96;
  const x = big ? workArea.x + Math.round((workArea.width - width) / 2) : workArea.x + workArea.width - width - 16;
  overlayWin.setBounds({ x, y: workArea.y + 16, width, height });
}

function showLock() {
  if (!lockWin.isVisible()) lockWin.show();
  // Primero se ajusta al tamaño exacto de la pantalla y después se pasa a modo quiosco:
  // así cubre todo aunque el modo quiosco de Windows no llegue a aplicarse.
  const target = screen.getPrimaryDisplay().bounds;
  const now = lockWin.getBounds();
  if (now.x !== target.x || now.y !== target.y || now.width !== target.width || now.height !== target.height) {
    if (lockWin.isKiosk()) lockWin.setKiosk(false);
    lockWin.setBounds(target);
  }
  if (!lockWin.isKiosk()) lockWin.setKiosk(true);
  lockWin.setAlwaysOnTop(true, "screen-saver");
  if (!lockWin.isFocused()) lockWin.focus();
  if (overlayWin.isVisible()) overlayWin.hide();
  hideLauncher();
  showCovers();
}

function hideLock() {
  hideCovers();
  if (!lockWin.isVisible()) return;
  lockWin.setKiosk(false);
  lockWin.hide();
}

// Monitores adicionales: se tapan en negro para que no quede un escritorio usable al lado.
let covers = [];
function showCovers() {
  const others = screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id);
  if (covers.length === others.length) return;
  hideCovers();
  covers = others.map((display) => {
    const win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      minimizable: false,
      alwaysOnTop: true,
      backgroundColor: "#000000",
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.on("close", (event) => {
      if (!quitting && covers.includes(win)) event.preventDefault();
    });
    return win;
  });
}
function hideCovers() {
  const old = covers;
  covers = [];
  for (const win of old) if (!win.isDestroyed()) win.destroy();
}

function showDesktop(big) {
  hideLock();
  hideLauncher();
  placeOverlay(big);
  if (!overlayWin.isVisible()) overlayWin.showInactive();
}

function showGames(big) {
  hideLock();
  showLauncher();
  placeOverlay(big);
  if (!overlayWin.isVisible()) overlayWin.showInactive();
}

// ---------- Estado ----------
/** Decide qué mostrar ahora mismo con lo último que se sabe, haya o no conexión. */
function currentView() {
  const now = Date.now();
  if (!config) return { phase: "configurar" };
  const online = now - lastOkAt < OFFLINE_AFTER_MS;
  const base = { station: remote?.station ?? null, online, error: lastError, serverUrl: config.serverUrl, version: app.getVersion(), guard: guardStatus };
  const session = remote?.session;
  if (session && now < session.graceEndsAt) {
    return { ...base, phase: now < session.endsAt ? "activa" : "gracia", session, games: launcherOn() && !desktopForStaff };
  }
  if (online && remote?.state === "mantenimiento") return { ...base, phase: "mantenimiento", unlockUntil: remote.unlockUntil };
  if (online && remote?.state === "deshabilitada") return { ...base, phase: "deshabilitada" };
  if (!online) {
    // Recién encendida: se bloquea de inmediato y, mientras llega la primera respuesta del servidor,
    // la pantalla dice que está preparando el código en vez de "sin conexión".
    if (lastOkAt === 0 && now - bootAt < 20_000) return { ...base, phase: "bloqueada", pairCode: null, qr: null };
    return { ...base, phase: "sin_conexion" };
  }
  return { ...base, phase: "bloqueada", pairCode: remote?.pairCode ?? null, qr: remote?.qr ?? null };
}

function render() {
  if (quitting || lockWin.isDestroyed() || overlayWin.isDestroyed() || launcherWin.isDestroyed()) return;
  const view = currentView();
  const playing = view.phase === "activa" || view.phase === "gracia";
  const unlocked = playing || view.phase === "mantenimiento";

  // Empieza o termina una sesión: se revisa qué hay instalado, y al final se cierra lo que quedó abierto.
  if (playing && !inSession) {
    inSession = true;
    desktopForStaff = false;
    startedPids = [];
    rescan();
    if (launcherOn()) fs.writeFileSync(sessionMark(), String(Date.now()));
  } else if (!playing && inSession) {
    inSession = false;
    desktopForStaff = false;
    if (fs.existsSync(sessionMark())) cleanSession();
  }

  if (view.phase === "configurar") {
    hideLock();
    hideLauncher();
    if (overlayWin.isVisible()) overlayWin.hide();
    if (!setupWin) createSetupWindow();
  } else {
    if (setupWin) setupWin.destroy();
    if (playing && view.games) showGames(view.phase === "gracia");
    else if (unlocked) showDesktop(view.phase === "gracia");
    else showLock();
  }
  if (!quitting) {
    // Teclas del sistema y barra de tareas:
    //  - PC bloqueada: se descarta todo y la barra queda escondida.
    //  - Cliente en la pantalla de juegos: se descarta la tecla Windows (Alt+Tab sigue sirviendo) y la barra sigue escondida.
    //  - Mantenimiento, configuración o sin pantalla de juegos: Windows normal.
    const gamesMode = playing && view.games;
    const mode = view.phase === "configurar" || (unlocked && !gamesMode) ? "unlock" : gamesMode ? "session" : "lock";
    setGuard(mode, mode !== "unlock");
    if (!guard && mode !== "unlock") startGuard();
    // Políticas: activas siempre que la PC esté en servicio (bloqueada o con un cliente jugando),
    // para que nadie cierre este programa desde el Administrador de tareas. Se quitan en mantenimiento.
    setPolicies(view.phase !== "configurar" && view.phase !== "mantenimiento");
  }

  if (view.phase !== lastPhase) {
    // Aviso sonoro al entrar al tiempo extra y al bloquearse.
    if (view.phase === "gracia" || (lastPhase === "gracia" && view.phase === "bloqueada")) shell.beep();
    lastPhase = view.phase;
  }
  const payload = JSON.stringify(view);
  if (payload !== lastSent) {
    lastSent = payload;
    for (const win of [lockWin, overlayWin, setupWin, launcherWin]) {
      if (win && !win.isDestroyed()) win.webContents.send("view", view);
    }
  }
}

async function poll() {
  if (!config || quitting) return;
  try {
    const response = await fetch(`${config.serverUrl}/api/agent/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ version: IS_WINDOWS && guardMode !== "unlock" && guardStatus !== "activo" ? `${app.getVersion()} sin-teclado` : app.getVersion() }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `El servidor respondió ${response.status}`);
    // Diferencia entre el reloj del servidor y el de esta PC: las horas de fin se llevan al reloj local.
    const offset = data.serverTime - Date.now();
    const local = (ms) => (ms ? ms - offset : ms);
    const pairCode = data.pairCode;
    let qr = remote?.qr ?? null;
    if (pairCode && pairCode !== remote?.pairCode) {
      qr = await QRCode.toDataURL(`${config.serverUrl}/cuenta?pc=${data.station.number}&c=${pairCode}`, { margin: 1, width: 360 });
    }
    remote = {
      state: data.state,
      station: data.station,
      pairCode,
      qr: pairCode ? qr : null,
      unlockUntil: local(data.unlockUntil),
      session: data.session
        ? { memberName: data.session.memberName, endsAt: local(data.session.endsAt), graceEndsAt: local(data.session.graceEndsAt) }
        : null,
    };
    lastOkAt = Date.now();
    lastError = "";
    // Cambió algo de la pantalla de juegos en el panel: se vuelve a pedir la lista.
    // Un servidor que todavía no la conoce no manda nada, y la PC sigue mostrando el escritorio.
    if (!data.launcher) panel = null;
    else if (data.launcher.version !== panelVersion && (await refreshPanel())) panelVersion = data.launcher.version;
  } catch (error) {
    lastError = error.name === "TimeoutError" ? "El servidor no responde." : String(error.message || error);
  }
  render();
}

// ---------- Configuración y salida de mantenimiento ----------
ipcMain.handle("setup", async (_event, input) => {
  const serverUrl = String(input.serverUrl || "").trim().replace(/\/+$/, "");
  const token = String(input.token || "").trim();
  const pin = String(input.pin || "").trim();
  if (!/^https?:\/\//.test(serverUrl)) return { ok: false, error: "La dirección debe empezar por https://" };
  if (!token.startsWith("pc_")) return { ok: false, error: "La credencial empieza por pc_. Cópiala completa desde el panel." };
  if (pin.length < 4) return { ok: false, error: "La clave de mantenimiento debe tener al menos 4 caracteres." };
  try {
    const response = await fetch(`${serverUrl}/api/agent/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) return { ok: false, error: data.error || "El servidor rechazó la credencial." };
    saveConfig({ serverUrl, token, pinHash: sha(pin) });
    app.setLoginItemSettings({ openAtLogin: true });
    // La ventana de configuración se cierra al pasar al bloqueo: primero se responde y luego se cambia.
    setTimeout(poll, 150);
    return { ok: true, label: data.station.label };
  } catch {
    return { ok: false, error: "No se pudo conectar con esa dirección. Revisa el internet y que esté bien escrita." };
  }
});

// Desde la pantalla de bloqueo, Ctrl+Mayús+M pide la clave de mantenimiento.
ipcMain.handle("maintenance", (_event, input) => {
  if (!config || sha(input.pin) !== config.pinHash) return { ok: false, error: "Clave incorrecta." };
  // Durante una sesión, el personal puede pedir el escritorio normal de Windows hasta que esa sesión termine.
  if (input.action === "desktop") {
    desktopForStaff = true;
    lastSent = "";
    render();
    return { ok: true };
  }
  if (input.action === "reset") {
    stopGuard();
    setPolicies(false);
    fs.rmSync(configFile(), { force: true });
    config = null;
    remote = null;
    lastSent = "";
    render();
    return { ok: true };
  }
  // Primero se responde a la pantalla y enseguida se cierra todo.
  setTimeout(() => shutdown(), 100);
  return { ok: true };
});

ipcMain.handle("view", () => currentView());

// ---------- Pantalla de juegos: lista y abrir ----------
ipcMain.handle("items", () => publicItems());

let lastLaunch = { key: "", at: 0 };
ipcMain.handle("launch", async (_event, key) => {
  // La pantalla solo manda cuál quiere abrir; la ruta sale de la lista que arma este programa, nunca de la pantalla.
  const item = items.find((i) => i.key === key);
  if (!item || !inSession) return { ok: false, error: "Eso ya no está disponible." };
  // Un juego tarda en aparecer: tocar dos veces seguidas no debe abrirlo dos veces.
  if (lastLaunch.key === key && Date.now() - lastLaunch.at < 8000) return { ok: true };
  lastLaunch = { key, at: Date.now() };
  try {
    const result = await games.launch(item, (url) => shell.openExternal(url), (file) => shell.openPath(file));
    if (result.pid) startedPids.push(result.pid);
    return { ok: result.ok, error: result.error };
  } catch (error) {
    logError("launch", error);
    return { ok: false, error: "No se pudo abrir. Avisa en caja." };
  }
});

// ---------- Arranque ----------
// ---------- Autoprueba (solo en la compilación de GitHub) ----------
// Con PANTER_SELFTEST=1 el programa arranca contra un servidor simulado y recorre una sesión entera
// en un Windows real: bloqueada, cliente jugando con la pantalla de juegos, y bloqueada otra vez.
// Anota en selftest.json lo que vio en cada momento y al final se cierra por el mismo camino que el
// botón "Cerrar el programa" de mantenimiento. Si algo no cuadra, queda en "fallas" y la compilación falla.
function runSelfTest() {
  const report = { version: app.getVersion(), fallas: [] };
  const check = (ok, what) => {
    if (!ok) report.fallas.push(what);
  };
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  // Se admite 1 o 2 píxeles de diferencia: algunos escritorios redondean el tamaño de la ventana.
  const sameBounds = (win) => {
    const a = win.getBounds();
    const b = screen.getPrimaryDisplay().bounds;
    return ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= 2);
  };
  const fixtures = process.env.PANTER_FIXTURES || "";
  let fakeGame = null;

  // 1. Bloqueada
  setTimeout(() => {
    let taskManagerPolicy = null;
    if (IS_WINDOWS) {
      const query = spawnSync("reg.exe", ["query", POLICIES[0][0], "/v", POLICIES[0][1]], { encoding: "utf8", windowsHide: true });
      taskManagerPolicy = query.status === 0 && /0x1/.test(query.stdout || "");
    }
    report.bloqueada = {
      phase: currentView().phase,
      lockVisible: lockWin.isVisible(),
      kiosk: lockWin.isKiosk(),
      focused: lockWin.isFocused(),
      bounds: lockWin.getBounds(),
      display: screen.getPrimaryDisplay().bounds,
      launcherVisible: launcherWin.isVisible(),
      guard: guardStatus,
      guardMode,
      taskbar: taskbarInfo,
      taskManagerPolicy,
    };
    check(report.bloqueada.phase === "bloqueada" && report.bloqueada.lockVisible && !report.bloqueada.launcherVisible, "al arrancar debe verse la pantalla de bloqueo y no la de juegos");
  }, 7000);

  // 2. Cliente jugando: pantalla de juegos
  setTimeout(async () => {
    const shown = publicItems().map((i) => i.key);
    report.jugando = {
      phase: currentView().phase,
      games: currentView().games,
      launcherVisible: launcherWin.isVisible(),
      launcherCoversScreen: sameBounds(launcherWin),
      lockVisible: lockWin.isVisible(),
      overlayVisible: overlayWin.isVisible(),
      guardMode,
      taskbar: taskbarInfo,
      items: shown,
    };
    check(report.jugando.phase === "activa" && report.jugando.launcherVisible && !report.jugando.lockVisible, "con un cliente jugando debe verse la pantalla de juegos y no la de bloqueo");
    check(report.jugando.launcherCoversScreen, "la pantalla de juegos debe cubrir toda la pantalla");
    if (IS_WINDOWS) check(guardMode === "session", "con un cliente jugando el teclado debe estar en modo sesión");
    if (fixtures) {
      check(shown.includes("steam:730") && shown.includes("epic:Fortnite"), "debe detectar los juegos de Steam y Epic instalados");
      check(!shown.includes("steam:570"), "un juego oculto desde el panel no debe aparecer");
      check(!shown.includes("steam:228980") && !shown.includes("epic:FortniteExtra"), "no deben aparecer redistribuibles ni contenido adicional");
      check(shown.includes("base:steam") && shown.includes("app:1") && !shown.includes("app:2"), "debe mostrar Steam y la app del panel que sí está instalada, no la que falta");
      // Se abre un juego desde la propia pantalla, y se simula otro que habría abierto Steam.
      report.jugando.launch = await launcherWin.webContents.executeJavaScript('window.panter.launch("app:1")').catch((error) => ({ ok: false, error: String(error) }));
      check(report.jugando.launch.ok && startedPids.length === 1, "el juego de prueba debe abrirse desde la pantalla");
      const cs2 = path.join(fixtures, "steam", "steamapps", "common", "Counter-Strike Global Offensive", "cs2.exe");
      fakeGame = spawn(cs2, ["-e", "setTimeout(() => {}, 600000)"], { detached: true, stdio: "ignore" });
      fakeGame.unref();
      report.jugando.pids = [startedPids[0], fakeGame.pid];
    }
  }, 16000);

  setTimeout(() => {
    if (!fixtures) return;
    report.jugando.vivosAntes = (report.jugando.pids || []).map(alive);
    check(report.jugando.vivosAntes.length === 2 && report.jugando.vivosAntes.every(Boolean), "los dos juegos deben seguir abiertos mientras hay tiempo");
  }, 22000);

  // 3. Se acabó el tiempo: bloqueo y limpieza. Después, cerrar con la clave.
  setTimeout(async () => {
    const text = (file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    };
    report.alTerminar = {
      phase: currentView().phase,
      lockVisible: lockWin.isVisible(),
      launcherVisible: launcherWin.isVisible(),
      guardMode,
      limpieza: lastCleanup,
    };
    check(report.alTerminar.phase === "bloqueada" && report.alTerminar.lockVisible && !report.alTerminar.launcherVisible, "al terminar el tiempo debe volver la pantalla de bloqueo");
    if (fixtures) {
      report.alTerminar.vivosDespues = (report.jugando.pids || []).map(alive);
      check(report.alTerminar.vivosDespues.every((v) => !v), "al terminar el tiempo los juegos abiertos deben cerrarse");
      const steamLogin = text(path.join(fixtures, "steam", "config", "loginusers.vdf")) || "";
      const epic = text(path.join(fixtures, "epic", "GameUserSettings.ini")) || "";
      report.alTerminar.steamSinSesion = /"AllowAutoLogin"\s+"0"/.test(steamLogin) && /"RememberPassword"\s+"0"/.test(steamLogin) && steamLogin.includes('"AccountName"');
      report.alTerminar.epicSinSesion = /Enable=False/.test(epic) && /^Data=$/m.test(epic) && epic.includes("Idioma=es");
      report.alTerminar.discordSinSesion = !fs.existsSync(path.join(fixtures, "discord-data", "Local Storage", "leveldb"));
      check(report.alTerminar.steamSinSesion, "la sesión de Steam debe quedar cerrada");
      check(report.alTerminar.epicSinSesion, "la sesión de Epic debe quedar cerrada sin dañar el resto del archivo");
      check(report.alTerminar.discordSinSesion, "la sesión de Discord debe quedar cerrada");
      check(!fs.existsSync(sessionMark()), "no debe quedar la marca de sesión abierta");
      try {
        const state = await (await fetch(`${config.serverUrl}/selftest/state`)).json();
        report.alTerminar.catalogo = state.catalog;
        const keys = (state.catalog || []).map((c) => c.key).sort();
        check(JSON.stringify(keys) === JSON.stringify(["epic:Fortnite", "steam:570", "steam:730"]), "la PC debe avisar al panel qué juegos tiene instalados (incluido el oculto)");
      } catch (error) {
        check(false, `no se pudo consultar el servidor de prueba: ${error.message}`);
      }
    }
    if (fakeGame && alive(fakeGame.pid)) process.kill(fakeGame.pid);
    fs.writeFileSync(path.join(app.getPath("userData"), "selftest.json"), JSON.stringify(report, null, 2));
    // Se pulsa "Cerrar el programa" desde la propia pantalla de bloqueo, con la clave de prueba.
    lockWin.webContents.executeJavaScript('window.panter.maintenance({ pin: "1234", action: "quit" })').catch((error) => logError("selftest", error));
  }, 46000);
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.whenReady().then(() => {
    loadConfig();
    // Una PC ya conectada arranca este programa sola al iniciar sesión en Windows.
    // Se reafirma en cada arranque por si alguien lo quitó de los programas de inicio.
    if (config && app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
    createLockWindow();
    createLauncherWindow();
    createOverlayWindow();
    // Lo último que mandó el panel, por si la PC arranca sin internet.
    try {
      panel = JSON.parse(fs.readFileSync(panelFile(), "utf8"));
    } catch {
      panel = null;
    }
    rescan();
    // Si la PC se apagó a mitad de una sesión, al arrancar se limpia lo que haya quedado de ese cliente.
    if (fs.existsSync(sessionMark())) cleanSession();
    // Cada 10 minutos se vuelve a mirar qué hay instalado (alguien pudo instalar un juego en mantenimiento).
    timers.push(setInterval(() => !inSession && rescan(), 10 * 60 * 1000));
    lockWin.once("ready-to-show", () => render());
    poll();
    timers.push(setInterval(poll, POLL_MS));
    // Entre consulta y consulta, el reloj local decide: la PC se bloquea a tiempo aunque no haya internet.
    timers.push(setInterval(render, 1000));
    // Si otra ventana le quita el foco a la pantalla de bloqueo, lo recupera.
    const refocus = () => {
      if (!quitting && !lockWin.isDestroyed() && lockWin.isVisible() && !lockWin.isFocused()) {
        lockWin.setAlwaysOnTop(true, "screen-saver");
        lockWin.moveTop();
        lockWin.focus();
      }
    };
    timers.push(setInterval(refocus, 250));
    lockWin.on("blur", () => setTimeout(refocus, 30));
    if (process.env.PANTER_SELFTEST) runSelfTest();
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (!quitting) event.preventDefault();
  });
}
