// utils/licencia.js - Licencia mensual de Lusteph
//
// El vendedor firma cada código con su clave privada (licencias/emitir.js);
// aquí solo está la clave pública, que sirve para verificar pero no para
// fabricar códigos. Cada código lleva el cliente, el ID de esta computadora y
// la fecha de vencimiento.
//
// Etapas: 7 días antes de vencer avisa; vencida da 5 días de gracia; después
// bloquea las ventas nuevas (reportes, cierre y respaldos siguen funcionando).
// Si la fecha de Windows retrocede respecto a la más reciente vista, también
// bloquea hasta que se corrija.

const crypto = require("crypto");
const os = require("os");
const { execFileSync } = require("child_process");

const CLAVE_PUBLICA = crypto.createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzbZ67DgshcQIWWc6IHzNNpif3owtpicpN2Csgo02dJw=
-----END PUBLIC KEY-----`);

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_AVISO = 7;
const DIAS_GRACIA = 5;
const DIAS_PRUEBA = 7;
// Ajustes normales del reloj (sincronización de Windows) no cuentan como atraso
const TOLERANCIA_RELOJ_MS = 2 * 60 * 60 * 1000;
const CONTACTO = "WhatsApp 6103-7050";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// "2026-12-15" -> "15 de diciembre de 2026"
function fechaLarga(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

const textoFecha = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Último milisegundo del día indicado, en hora local
function finDelDia(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(a, m - 1, d, 23, 59, 59, 999).getTime();
}

// Días de calendario entre la fecha de hoyMs y la fecha "AAAA-MM-DD"
function diasHasta(hoyMs, texto) {
  const [a, m, d] = texto.split("-").map(Number);
  const h = new Date(hoyMs);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(h.getFullYear(), h.getMonth(), h.getDate())) / DIA_MS);
}

// ID de esta computadora: se deriva del MachineGuid de Windows, que no cambia
// al reinstalar el POS. Se muestra como ABCD-EF12-3456.
let equipoCache = null;
function idEquipo() {
  if (equipoCache) return equipoCache;
  let base = "";
  if (process.platform === "win32") {
    try {
      const salida = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8", windowsHide: true }
      );
      base = (salida.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i) || [])[1] || "";
    } catch {
      base = "";
    }
  }
  if (!base) base = `${os.hostname()}|${os.userInfo().username}`;
  const hash = crypto.createHash("sha256").update(`lusteph:${base.toLowerCase()}`).digest("hex").toUpperCase();
  equipoCache = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
  return equipoCache;
}

// Verifica firma y equipo. Devuelve { cliente, equipo, vence, emitida } o lanza
// un Error con un mensaje para el usuario.
function leerCodigo(codigo, equipo = idEquipo()) {
  const partes = String(codigo || "").replace(/\s+/g, "").split(".");
  if (partes.length !== 3 || partes[0] !== "LUS1") {
    throw new Error("El código no tiene el formato de una licencia de Lusteph");
  }
  const cuerpo = Buffer.from(partes[1], "base64url");
  const firma = Buffer.from(partes[2], "base64url");
  let valida = false;
  try {
    valida = crypto.verify(null, cuerpo, CLAVE_PUBLICA, firma);
  } catch {
    valida = false;
  }
  if (!valida) throw new Error("El código de licencia no es válido o está incompleto");

  const datos = JSON.parse(cuerpo.toString("utf8"));
  if (datos.e !== equipo) {
    throw new Error(`Este código es para otra computadora (${datos.e}). El ID de esta es ${equipo}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.h || "")) throw new Error("El código de licencia no es válido");
  return { cliente: datos.c, equipo: datos.e, vence: datos.h, emitida: datos.i, reiniciaReloj: datos.r === 1 };
}

// Estado de la licencia en un momento dado. Función pura para poder probarla.
//   licencia: resultado de leerCodigo o null
//   primerUso: ms de la primera vez que arrancó el POS
//   maxVisto: ms de la fecha más reciente que ha visto el POS
function evaluar({ licencia, primerUso, maxVisto, ahora }) {
  const base = {
    equipo: idEquipo(),
    cliente: licencia?.cliente || null,
    vence: licencia?.vence || null,
    contacto: CONTACTO
  };

  if (maxVisto && ahora < maxVisto - TOLERANCIA_RELOJ_MS) {
    return {
      ...base,
      estado: "reloj",
      nivel: "alerta",
      permiteVender: false,
      mensaje:
        `La fecha de la computadora está atrasada (la última vista fue el ${fechaLarga(textoFecha(new Date(maxVisto)))}). ` +
        "Corrija la fecha y hora de Windows para seguir vendiendo."
    };
  }

  const hoy = Math.max(ahora, maxVisto || 0);

  if (licencia) {
    const vence = finDelDia(licencia.vence);
    const fecha = fechaLarga(licencia.vence);
    if (hoy <= vence) {
      const dias = diasHasta(hoy, licencia.vence);
      if (dias <= DIAS_AVISO) {
        return {
          ...base,
          estado: "por_vencer",
          nivel: "aviso",
          permiteVender: true,
          diasRestantes: dias,
          mensaje: `Tu licencia vence ${dias === 0 ? "hoy" : `el ${fecha}`}. Renueva por ${CONTACTO}.`
        };
      }
      return { ...base, estado: "activa", nivel: "ok", permiteVender: true, diasRestantes: dias, mensaje: `Licencia activa hasta el ${fecha}.` };
    }

    const finGracia = vence + DIAS_GRACIA * DIA_MS;
    if (hoy <= finGracia) {
      // Días que quedan antes del primer día bloqueado
      const dias = diasHasta(hoy, textoFecha(new Date(finGracia))) + 1;
      return {
        ...base,
        estado: "gracia",
        nivel: "alerta",
        permiteVender: true,
        diasRestantes: dias,
        mensaje:
          `Tu licencia venció el ${fecha}. Las ventas se bloquean en ${dias} día${dias === 1 ? "" : "s"} ` +
          `si no se renueva. ${CONTACTO}.`
      };
    }
    return {
      ...base,
      estado: "vencida",
      nivel: "alerta",
      permiteVender: false,
      mensaje:
        `La licencia venció el ${fecha}. Las ventas están bloqueadas hasta activar un código nuevo; ` +
        `reportes, cierre de caja y respaldos siguen disponibles. ${CONTACTO}.`
    };
  }

  // Sin licencia: período de prueba desde el primer arranque
  const ultimoDiaPrueba = textoFecha(new Date((primerUso || ahora) + (DIAS_PRUEBA - 1) * DIA_MS));
  if (hoy <= finDelDia(ultimoDiaPrueba)) {
    const dias = diasHasta(hoy, ultimoDiaPrueba) + 1;
    return {
      ...base,
      estado: "prueba",
      nivel: "aviso",
      permiteVender: true,
      diasRestantes: dias,
      mensaje: `Período de prueba: quedan ${dias} día${dias === 1 ? "" : "s"}. Activa tu licencia en Administración → Licencia.`
    };
  }
  return {
    ...base,
    estado: "sin_licencia",
    nivel: "alerta",
    permiteVender: false,
    mensaje: `Terminó el período de prueba. Activa tu licencia en Administración → Licencia (${CONTACTO}).`
  };
}

module.exports = { idEquipo, leerCodigo, evaluar, TOLERANCIA_RELOJ_MS };
