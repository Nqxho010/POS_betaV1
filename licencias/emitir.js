#!/usr/bin/env node
// ==========================================
// Lusteph - Emisor de códigos de licencia
// ==========================================
// Solo lo usa el vendedor. La clave privada vive fuera del repositorio, en
// %USERPROFILE%\.lusteph-licencias\privada.pem (o en LUSTEPH_CLAVE_PRIVADA).
// Quien tenga ese archivo puede fabricar licencias: respáldelo y no lo comparta.
//
// Uso:
//   node licencias/emitir.js claves
//       Crea el par de claves (una sola vez) y muestra la clave pública que
//       va en backend/src/utils/licencia.js.
//
//   node licencias/emitir.js --cliente "Super Marindia" --equipo ABCD-EF12-3456 --meses 1
//   node licencias/emitir.js --cliente "Super Marindia" --equipo ABCD-EF12-3456 --hasta 2026-12-15
//       Muestra el código para enviar por WhatsApp. --meses cuenta desde hoy
//       o desde --desde AAAA-MM-DD (útil para renovar desde el vencimiento anterior).
//       Agregue --reiniciar-reloj si el POS quedó bloqueado porque alguien
//       adelantó la fecha de Windows por error.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CARPETA = path.join(os.homedir(), ".lusteph-licencias");
const PRIVADA = process.env.LUSTEPH_CLAVE_PRIVADA || path.join(CARPETA, "privada.pem");
const PUBLICA = path.join(path.dirname(PRIVADA), "publica.pem");
const REGISTRO = path.join(path.dirname(PRIVADA), "emitidas.csv");

const salir = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};

function crearClaves() {
  if (fs.existsSync(PRIVADA)) {
    salir(`Ya existe una clave privada en ${PRIVADA}. No se sobrescribe: las licencias emitidas dejarían de servir.`);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(PRIVADA), { recursive: true });
  fs.writeFileSync(PRIVADA, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const publica = publicKey.export({ type: "spki", format: "pem" });
  fs.writeFileSync(PUBLICA, publica);
  console.log(`Clave privada: ${PRIVADA}  (respáldela en un lugar seguro)`);
  console.log("\nClave pública para backend/src/utils/licencia.js:\n");
  console.log(publica);
}

function leerArgumentos(lista) {
  const args = {};
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].startsWith("--")) args[lista[i].slice(2)] = lista[i + 1];
  }
  return args;
}

const esFecha = (texto) => /^\d{4}-\d{2}-\d{2}$/.test(texto || "") && !isNaN(new Date(`${texto}T00:00:00`));
const textoFecha = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function emitir(args) {
  const cliente = String(args.cliente || "").trim();
  const equipo = String(args.equipo || "").trim().toUpperCase();
  if (!cliente) salir('Falta --cliente "Nombre del negocio"');
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(equipo)) {
    salir("Falta --equipo con el ID que muestra el POS en Administración → Licencia (ej. ABCD-EF12-3456)");
  }

  let hasta = args.hasta;
  if (!hasta) {
    const meses = Number(args.meses || 0);
    if (!Number.isInteger(meses) || meses < 1) salir("Indique --hasta AAAA-MM-DD o --meses N");
    if (args.desde && !esFecha(args.desde)) salir("--desde debe ser AAAA-MM-DD");
    const base = args.desde ? new Date(`${args.desde}T00:00:00`) : new Date();
    const dia = base.getDate();
    base.setMonth(base.getMonth() + meses);
    // 31 de enero + 1 mes = último día de febrero, no 3 de marzo
    if (base.getDate() !== dia) base.setDate(0);
    hasta = textoFecha(base);
  }
  if (!esFecha(hasta)) salir("--hasta debe ser AAAA-MM-DD");

  if (!fs.existsSync(PRIVADA)) salir(`No se encontró la clave privada en ${PRIVADA}. Ejecute primero: node licencias/emitir.js claves`);
  const clave = crypto.createPrivateKey(fs.readFileSync(PRIVADA));

  const datos = { v: 1, c: cliente, e: equipo, h: hasta, i: textoFecha(new Date()) };
  // Quita el bloqueo por reloj atrasado (si el cliente adelantó la fecha por error)
  if ("reiniciar-reloj" in args) datos.r = 1;
  const cuerpo = Buffer.from(JSON.stringify(datos), "utf8");
  const firma = crypto.sign(null, cuerpo, clave);
  const codigo = `LUS1.${cuerpo.toString("base64url")}.${firma.toString("base64url")}`;

  if (!fs.existsSync(REGISTRO)) fs.writeFileSync(REGISTRO, "emitida,cliente,equipo,vence\n");
  fs.appendFileSync(REGISTRO, `${datos.i},"${cliente.replace(/"/g, '""')}",${equipo},${hasta}\n`);

  console.log(`Cliente: ${cliente}\nEquipo:  ${equipo}\nVence:   ${hasta}\n\nCódigo de licencia:\n\n${codigo}\n`);
}

const [comando, ...resto] = process.argv.slice(2);
if (comando === "claves") crearClaves();
else if (comando && comando.startsWith("--")) emitir(leerArgumentos([comando, ...resto]));
else {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}
