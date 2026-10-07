// ==========================================
// POS Costa Rica - Aplicación de escritorio (Electron)
// ==========================================
// Arranca el backend dentro de la app y abre el frontend compilado en una
// ventana. Los datos del cliente viven en su carpeta de usuario, fuera del
// programa instalado.

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Instalada, backend y frontend vienen en resources/; en desarrollo, del repo
const RAIZ = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const BACKEND_DIR = path.join(RAIZ, "backend");
const FRONTEND_DIR = app.isPackaged
  ? path.join(RAIZ, "frontend")
  : path.join(RAIZ, "frontend", "build");

// Carpeta de datos del cliente: bases, FacInve.DBF, comprobantes, respaldos y .env
const DATA_DIR = path.join(app.getPath("userData"), "datos");
const ENV_PATH = path.join(DATA_DIR, ".env");
const INVENTARIO_PATH = path.join(DATA_DIR, "database", "FacInve.DBF");
const ICONO = path.join(__dirname, "build", "icon.png");

let ventana = null;

// Pantalla de carga con la marca mientras arranca el backend
const PANTALLA_CARGA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    font-family: "DM Sans", "Poppins", "Segoe UI Variable Display", "Segoe UI", sans-serif;
    color: #151515;
    background:
      radial-gradient(60% 80% at 15% 110%, rgba(58, 118, 222, 0.7) 0%, transparent 65%),
      radial-gradient(50% 70% at 85% -10%, rgba(226, 238, 255, 0.95) 0%, transparent 65%),
      linear-gradient(120deg, #a9cbf8 0%, #7fb0f2 100%);
    user-select: none;
    -webkit-app-region: drag;
  }
  .marca { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 700; letter-spacing: -0.5px; }
  .simbolo { position: relative; width: 44px; height: 44px; border-radius: 50%; background: #151515; }
  .simbolo::after {
    content: ""; position: absolute; top: 50%; right: -4px; width: 16px; height: 16px;
    border-radius: 50%; background: #151515; border: 4px solid #a3c6f6; transform: translateY(-50%);
  }
  .barra { width: 180px; height: 5px; border-radius: 999px; background: rgba(21, 21, 21, 0.15); overflow: hidden; }
  .barra::after {
    content: ""; display: block; width: 40%; height: 100%; border-radius: 999px;
    background: #151515; animation: avanza 1.1s ease-in-out infinite;
  }
  @keyframes avanza { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
  small { font-size: 13px; opacity: 0.7; }
</style>
</head>
<body>
  <div class="marca"><span class="simbolo"></span>Punto de Venta</div>
  <div class="barra"></div>
  <small>Iniciando…</small>
</body>
</html>`;

function mostrarPantallaCarga() {
  const carga = new BrowserWindow({
    width: 460,
    height: 280,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: "#a9cbf8",
    icon: fs.existsSync(ICONO) ? ICONO : undefined
  });
  carga.once("ready-to-show", () => carga.show());
  carga.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PANTALLA_CARGA));
  return carga;
}

// Primera ejecución: crea el .env del cliente a partir de la plantilla, con
// una clave JWT y una contraseña de admin propias de esta instalación
function prepararDatos() {
  fs.mkdirSync(path.join(DATA_DIR, "database"), { recursive: true });
  if (fs.existsSync(ENV_PATH)) return;

  const plantilla = fs.readFileSync(path.join(BACKEND_DIR, "src", ".env.example"), "utf8");
  const env = plantilla
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`)
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=Admin-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(ENV_PATH, env);
}

async function iniciarBackend() {
  // Estas variables mandan sobre lo que diga el .env del cliente
  process.env.DATA_DIR = DATA_DIR;
  process.env.FRONTEND_DIR = FRONTEND_DIR;
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "0"; // puerto libre elegido por el sistema

  require(path.join(BACKEND_DIR, "node_modules", "dotenv")).config({ path: ENV_PATH, quiet: true });

  const { iniciar } = require(path.join(BACKEND_DIR, "src", "app.js"));
  const servidor = await iniciar();
  return servidor.address().port;
}

function alternarPantallaCompleta() {
  if (ventana) ventana.setFullScreen(!ventana.isFullScreen());
}

function crearVentana(puerto) {
  ventana = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "POS Costa Rica",
    backgroundColor: "#f7f3ea",
    icon: fs.existsSync(ICONO) ? ICONO : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // El aviso sonoro del lector no debe esperar un clic previo
      autoplayPolicy: "no-user-gesture-required"
    }
  });

  // Sin barra de menú, estas teclas se atienden aquí
  ventana.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      event.preventDefault();
      alternarPantallaCompleta();
    } else if (input.key === "F5") {
      event.preventDefault();
      ventana.webContents.reload();
    } else if (!app.isPackaged && input.key === "F12") {
      ventana.webContents.toggleDevTools();
    }
  });

  // Los enlaces externos se abren en el navegador, no dentro del POS
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  ventana.on("closed", () => {
    ventana = null;
  });
  ventana.loadURL(`http://127.0.0.1:${puerto}/`);

  return new Promise((resolve) => ventana.once("ready-to-show", resolve));
}

async function avisarSiFaltaInventario() {
  if (fs.existsSync(INVENTARIO_PATH)) return;
  const { response } = await dialog.showMessageBox(ventana, {
    type: "warning",
    title: "Falta el archivo de productos",
    message: "No se encontró FacInve.DBF",
    detail:
      `Copie el archivo FacInve.DBF del negocio en:\n${path.dirname(INVENTARIO_PATH)}\n\n` +
      "No hace falta reiniciar: los productos aparecen al copiarlo.",
    buttons: ["Abrir carpeta", "Cerrar"],
    defaultId: 0
  });
  if (response === 0) shell.openPath(path.dirname(INVENTARIO_PATH));
}

// Acciones que la página pide a través de preload.js
ipcMain.handle("pos:abrir-carpeta-datos", () => shell.openPath(DATA_DIR));
ipcMain.handle("pos:pantalla-completa", () => alternarPantallaCompleta());

// Dos copias abiertas escribirían a la vez en las mismas bases y en el DBF
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!ventana) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });

  app.whenReady().then(async () => {
    // Sin la barra de menú del navegador: todo se maneja desde la propia app
    Menu.setApplicationMenu(null);
    const carga = mostrarPantallaCarga();
    try {
      prepararDatos();
      const puerto = await iniciarBackend();
      await crearVentana(puerto);
      ventana.maximize();
      ventana.show();
      carga.destroy();
      await avisarSiFaltaInventario();
    } catch (error) {
      if (!carga.isDestroyed()) carga.destroy();
      dialog.showErrorBox("POS Costa Rica no pudo iniciar", String(error?.stack || error));
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
}
