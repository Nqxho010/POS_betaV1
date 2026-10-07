// ==========================================
// POS Costa Rica - Aplicación de escritorio (Electron)
// ==========================================
// Arranca el backend dentro de la app y abre el frontend compilado en una
// ventana. Los datos del cliente viven en su carpeta de usuario, fuera del
// programa instalado.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Instalada, backend y frontend vienen en resources/; en desarrollo, del repo
const RAIZ = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const BACKEND_DIR = path.join(RAIZ, "backend");
const FRONTEND_DIR = app.isPackaged
  ? path.join(RAIZ, "frontend")
  : path.join(RAIZ, "frontend", "build");

// Carpeta de datos del cliente: bases, FacInve.DBF, comprobantes y .env
const DATA_DIR = path.join(app.getPath("userData"), "datos");
const ENV_PATH = path.join(DATA_DIR, ".env");
const INVENTARIO_PATH = path.join(DATA_DIR, "database", "FacInve.DBF");

let ventana = null;

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

function crearMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Archivo",
        submenu: [
          { label: "Abrir carpeta de datos", click: () => shell.openPath(DATA_DIR) },
          { type: "separator" },
          { label: "Salir", role: "quit" }
        ]
      },
      {
        label: "Ver",
        submenu: [
          { label: "Recargar", role: "reload" },
          { label: "Pantalla completa", role: "togglefullscreen" },
          { type: "separator" },
          { label: "Acercar", role: "zoomIn" },
          { label: "Alejar", role: "zoomOut" },
          { label: "Tamaño normal", role: "resetZoom" }
        ]
      }
    ])
  );
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
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  // Los enlaces externos se abren en el navegador, no dentro del POS
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  ventana.once("ready-to-show", () => {
    ventana.maximize();
    ventana.show();
  });
  ventana.on("closed", () => {
    ventana = null;
  });
  ventana.loadURL(`http://127.0.0.1:${puerto}/`);
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
    try {
      prepararDatos();
      const puerto = await iniciarBackend();
      crearMenu();
      crearVentana(puerto);
      await avisarSiFaltaInventario();
    } catch (error) {
      dialog.showErrorBox("POS Costa Rica no pudo iniciar", String(error?.stack || error));
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
}
