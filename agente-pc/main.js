// Panter Bloqueo: programa que corre en cada PC de la arena.
// Cada 3 segundos pregunta al servidor qué debe hacer con esta máquina:
//   bloqueada      -> pantalla de bloqueo con el número de la PC y el código para activarla
//   activa         -> escritorio libre + contador pequeño en una esquina
//   gracia         -> aviso grande: "se acabó tu tiempo, guarda tu partida" (minutos extra)
//   mantenimiento  -> escritorio libre para el personal
// Si se cae el internet con una sesión en curso, sigue contando con la última hora de fin conocida.

const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const QRCode = require("qrcode");

const POLL_MS = 3000;
const OFFLINE_AFTER_MS = 15000;
// PANTER_CONFIG_DIR permite usar otra carpeta de configuración (pruebas).
if (process.env.PANTER_CONFIG_DIR) app.setPath("userData", process.env.PANTER_CONFIG_DIR);
const configFile = () => path.join(app.getPath("userData"), "config.json");
const sha = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

let config = null; // { serverUrl, token, pinHash }
let lockWin = null;
let overlayWin = null;
let setupWin = null;
let quitting = false;

// Lo último que dijo el servidor, con las horas ya convertidas al reloj de esta PC.
let remote = null; // { state, station, pairCode, session: { memberName, endsAt, graceEndsAt }, unlockUntil }
let lastOkAt = 0;
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
//  2. Unas políticas de Windows para este usuario quitan el Administrador de tareas y dejan la
//     pantalla de Ctrl+Alt+Supr sin "Bloquear", "Cerrar sesión" ni "Cambiar contraseña".
// Todo es reversible: se quita al entrar en mantenimiento, al cerrar el programa con la clave
// y al desinstalar. Fuera de Windows (pruebas) estas funciones no hacen nada.
const IS_WINDOWS = process.platform === "win32";
let guard = null;
let guardLocked = false;
let policiesOn = null;

function guardPath() {
  return app.isPackaged ? path.join(process.resourcesPath, "keyblock.exe") : path.join(__dirname, "keyblock.exe");
}

function startGuard() {
  if (!IS_WINDOWS || guard || quitting || !fs.existsSync(guardPath())) return;
  try {
    const child = spawn(guardPath(), [String(process.pid)], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => {
      if (guard === child) guard = null;
    });
    // Si alguien lo cierra, se vuelve a lanzar en el siguiente ciclo (render corre cada segundo).
    child.on("exit", () => {
      if (guard === child) guard = null;
    });
    child.stdin.on("error", () => {});
    guard = child;
    child.stdin.write(guardLocked ? "lock\n" : "unlock\n");
  } catch {
    guard = null;
  }
}

/** true = descartar las teclas del sistema; false = dejar pasar todo. */
function setKeyGuard(locked) {
  if (!IS_WINDOWS) return;
  if (!guard) {
    guardLocked = locked;
    if (locked) startGuard();
    return;
  }
  if (locked === guardLocked) return;
  guardLocked = locked;
  try {
    guard.stdin.write(locked ? "lock\n" : "unlock\n");
  } catch {
    /* el ayudante murió: se relanza en el siguiente ciclo */
  }
}

function stopGuard() {
  const child = guard;
  guard = null;
  guardLocked = false;
  if (!child) return;
  try {
    child.stdin.end("quit\n");
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

function setPolicies(on) {
  if (!IS_WINDOWS || policiesOn === on) return;
  policiesOn = on;
  for (const [key, name] of POLICIES) {
    const args = on ? ["add", key, "/v", name, "/t", "REG_DWORD", "/d", "1", "/f"] : ["delete", key, "/v", name, "/f"];
    // Si la cuenta no tiene permiso para escribir la política, se sigue sin ella (ver README).
    execFile("reg.exe", args, { windowsHide: true }, () => {});
  }
}

// ---------- Ventanas ----------
function createLockWindow() {
  lockWin = new BrowserWindow({
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    closable: false,
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
    if (!config) {
      quitting = true;
      app.quit();
    }
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
      closable: false,
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
  placeOverlay(big);
  if (!overlayWin.isVisible()) overlayWin.showInactive();
}

// ---------- Estado ----------
/** Decide qué mostrar ahora mismo con lo último que se sabe, haya o no conexión. */
function currentView() {
  const now = Date.now();
  if (!config) return { phase: "configurar" };
  const online = now - lastOkAt < OFFLINE_AFTER_MS;
  const base = { station: remote?.station ?? null, online, error: lastError, serverUrl: config.serverUrl };
  const session = remote?.session;
  if (session && now < session.graceEndsAt) {
    return { ...base, phase: now < session.endsAt ? "activa" : "gracia", session };
  }
  if (online && remote?.state === "mantenimiento") return { ...base, phase: "mantenimiento", unlockUntil: remote.unlockUntil };
  if (online && remote?.state === "deshabilitada") return { ...base, phase: "deshabilitada" };
  if (!online) return { ...base, phase: "sin_conexion" };
  return { ...base, phase: "bloqueada", pairCode: remote?.pairCode ?? null, qr: remote?.qr ?? null };
}

function render() {
  const view = currentView();
  const unlocked = view.phase === "activa" || view.phase === "gracia" || view.phase === "mantenimiento";
  if (view.phase === "configurar") {
    hideLock();
    if (overlayWin.isVisible()) overlayWin.hide();
    if (!setupWin) createSetupWindow();
  } else {
    if (setupWin) setupWin.destroy();
    if (unlocked) showDesktop(view.phase === "gracia");
    else showLock();
  }
  if (!quitting) {
    // Teclas del sistema: solo se descartan con la pantalla de bloqueo puesta.
    setKeyGuard(view.phase !== "configurar" && !unlocked);
    if (!guard && guardLocked) startGuard();
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
    for (const win of [lockWin, overlayWin, setupWin]) {
      if (win && !win.isDestroyed()) win.webContents.send("view", view);
    }
  }
}

async function poll() {
  if (!config) return;
  try {
    const response = await fetch(`${config.serverUrl}/api/agent/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ version: app.getVersion() }),
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
  quitting = true;
  stopGuard();
  setPolicies(false);
  // Un instante para que Windows termine de quitar las políticas antes de cerrar.
  setTimeout(() => app.quit(), 400);
  return { ok: true };
});

ipcMain.handle("view", () => currentView());

// ---------- Arranque ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadConfig();
    createLockWindow();
    createOverlayWindow();
    lockWin.once("ready-to-show", () => render());
    poll();
    setInterval(poll, POLL_MS);
    // Entre consulta y consulta, el reloj local decide: la PC se bloquea a tiempo aunque no haya internet.
    setInterval(render, 1000);
    // Si otra ventana le quita el foco a la pantalla de bloqueo, lo recupera.
    setInterval(() => {
      if (lockWin.isVisible() && !lockWin.isFocused()) {
        lockWin.setAlwaysOnTop(true, "screen-saver");
        lockWin.focus();
      }
    }, 700);
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (!quitting) event.preventDefault();
  });
}
