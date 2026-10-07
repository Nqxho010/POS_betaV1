// Genera build/icon.png y build/icon.ico a partir del símbolo de la marca.
// Uso: npm run icon   (solo hace falta si se cambia el diseño del ícono)

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const SALIDA = path.join(__dirname, "..", "build");
const TAMANOS_ICO = [16, 24, 32, 48, 64, 128, 256];

const DISENO = `<!doctype html>
<html>
<head>
<style>
  * { margin: 0; }
  html, body { width: 256px; height: 256px; background: transparent; overflow: hidden; }
  .fondo {
    position: relative;
    width: 256px;
    height: 256px;
    border-radius: 58px;
    background:
      radial-gradient(70% 70% at 20% 110%, rgba(58, 118, 222, 0.75) 0%, transparent 65%),
      radial-gradient(60% 60% at 85% -5%, rgba(226, 238, 255, 0.95) 0%, transparent 65%),
      linear-gradient(120deg, #a9cbf8 0%, #7fb0f2 100%);
  }
  .simbolo {
    position: absolute;
    top: 58px;
    left: 50px;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: #151515;
  }
  .simbolo::after {
    content: "";
    position: absolute;
    top: 50%;
    right: -18px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: #151515;
    border: 13px solid #94bdf5;
    transform: translateY(-50%);
  }
</style>
</head>
<body><div class="fondo"><div class="simbolo"></div></div></body>
</html>`;

// Entrada BMP de un .ico: cabecera DIB, píxeles BGRA de abajo hacia arriba y máscara vacía
function entradaBmp(imagen, tamano) {
  const pixeles = imagen.resize({ width: tamano, height: tamano, quality: "best" }).toBitmap();
  const cabecera = Buffer.alloc(40);
  cabecera.writeUInt32LE(40, 0);
  cabecera.writeInt32LE(tamano, 4);
  cabecera.writeInt32LE(tamano * 2, 8); // alto doble: imagen + máscara
  cabecera.writeUInt16LE(1, 12);
  cabecera.writeUInt16LE(32, 14);

  const filas = [];
  for (let y = tamano - 1; y >= 0; y--) {
    filas.push(pixeles.subarray(y * tamano * 4, (y + 1) * tamano * 4));
  }
  const mascara = Buffer.alloc(Math.ceil(tamano / 32) * 4 * tamano);
  return Buffer.concat([cabecera, ...filas, mascara]);
}

function crearIco(imagen) {
  const entradas = TAMANOS_ICO.map((tamano) => ({
    tamano,
    datos: tamano === 256 ? imagen.toPNG() : entradaBmp(imagen, tamano)
  }));

  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(1, 2); // tipo: ícono
  cabecera.writeUInt16LE(entradas.length, 4);

  let posicion = 6 + entradas.length * 16;
  const directorio = entradas.map(({ tamano, datos }) => {
    const entrada = Buffer.alloc(16);
    entrada.writeUInt8(tamano === 256 ? 0 : tamano, 0);
    entrada.writeUInt8(tamano === 256 ? 0 : tamano, 1);
    entrada.writeUInt16LE(1, 4);
    entrada.writeUInt16LE(32, 6);
    entrada.writeUInt32LE(datos.length, 8);
    entrada.writeUInt32LE(posicion, 12);
    posicion += datos.length;
    return entrada;
  });

  return Buffer.concat([cabecera, ...directorio, ...entradas.map((e) => e.datos)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const lienzo = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  });
  await lienzo.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(DISENO));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const captura = await lienzo.webContents.capturePage();
  const imagen = captura.resize({ width: 256, height: 256, quality: "best" });

  fs.mkdirSync(SALIDA, { recursive: true });
  fs.writeFileSync(path.join(SALIDA, "icon.png"), imagen.toPNG());
  fs.writeFileSync(path.join(SALIDA, "icon.ico"), crearIco(imagen));
  console.log("Ícono generado en", SALIDA);
  app.quit();
});
