// Puente entre la página del POS y la app de escritorio. La página solo ve
// estas funciones (window.posDesktop), nunca Node ni Electron directamente.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  abrirCarpetaDatos: () => ipcRenderer.invoke("pos:abrir-carpeta-datos"),
  pantallaCompleta: () => ipcRenderer.invoke("pos:pantalla-completa")
});
