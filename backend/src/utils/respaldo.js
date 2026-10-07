// utils/respaldo.js - Respaldos de los datos del cliente
//
// Cada respaldo es una carpeta con fecha y hora dentro de la carpeta de
// respaldos: copias consistentes de las bases SQLite (VACUUM INTO, seguro con
// la app abierta) y de los archivos sueltos como FacInve.DBF.

const fs = require("fs");
const path = require("path");

// Nombre de carpeta de un respaldo: 2026-10-07_14-30-05
const PATRON = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

function nombreAhora() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, "0");
  return (
    [d.getFullYear(), dos(d.getMonth() + 1), dos(d.getDate())].join("-") +
    "_" +
    [dos(d.getHours()), dos(d.getMinutes()), dos(d.getSeconds())].join("-")
  );
}

function vacuumInto(conexion, destino) {
  return new Promise((resolve, reject) => {
    conexion.run(`VACUUM INTO ?`, [destino], (err) => (err ? reject(err) : resolve()));
  });
}

// Respaldos existentes, del más nuevo al más viejo
function listarRespaldos(carpeta) {
  if (!fs.existsSync(carpeta)) return [];
  return fs
    .readdirSync(carpeta, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && PATRON.test(entrada.name))
    .map((entrada) => {
      const ruta = path.join(carpeta, entrada.name);
      const tamano = fs
        .readdirSync(ruta)
        .reduce((total, archivo) => total + fs.statSync(path.join(ruta, archivo)).size, 0);
      return { nombre: entrada.name, fecha: entrada.name.slice(0, 10), tamano };
    })
    .sort((a, b) => b.nombre.localeCompare(a.nombre));
}

// bases: [{ conexion, archivo }]  archivos: rutas a copiar tal cual
async function crearRespaldo({ carpeta, bases, archivos = [], maximo = 30 }) {
  const nombre = nombreAhora();
  const destino = path.join(carpeta, nombre);
  fs.mkdirSync(destino, { recursive: true });

  try {
    for (const { conexion, archivo } of bases) {
      await vacuumInto(conexion, path.join(destino, archivo));
    }
    for (const origen of archivos) {
      if (fs.existsSync(origen)) fs.copyFileSync(origen, path.join(destino, path.basename(origen)));
    }
  } catch (error) {
    // Un respaldo a medias es peor que ninguno
    fs.rmSync(destino, { recursive: true, force: true });
    throw error;
  }

  // Conservar solo los más recientes
  for (const viejo of listarRespaldos(carpeta).slice(maximo)) {
    fs.rmSync(path.join(carpeta, viejo.nombre), { recursive: true, force: true });
  }

  return listarRespaldos(carpeta).find((r) => r.nombre === nombre);
}

module.exports = { crearRespaldo, listarRespaldos };
