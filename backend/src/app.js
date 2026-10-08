// ==========================================
// BACKEND POS - Punto de venta con tiquete
// ==========================================
// Archivo: backend/src/app.js

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
const crypto = require("crypto");
const InventarioDBF = require("./utils/dbfInventario");
const { crearRespaldo, listarRespaldos } = require("./utils/respaldo");
// El .env vive junto a este archivo, no en el directorio desde donde se ejecuta
require('dotenv').config({ path: path.join(__dirname, ".env") });

// ==========================================
// 1. CONFIGURACIÓN
// ==========================================

const app = express();
const PORT = process.env.PORT || 5000;
// Sin HOST escucha en toda la red; la app de escritorio usa 127.0.0.1
const HOST = process.env.HOST || undefined;
// Las claves de ejemplo son públicas: no sirven para firmar sesiones. Sin una
// clave propia en el .env se usa una al azar (las sesiones se cierran al reiniciar)
const CLAVES_DE_EJEMPLO = [
  "tu-clave-secreta-muy-segura-cambiar-en-produccion",
  "tu-clave-muy-segura-cambiar-en-produccion",
  "cambiar-por-una-clave-larga-y-unica-por-cliente"
];
const JWT_PROPIA = process.env.JWT_SECRET && !CLAVES_DE_EJEMPLO.includes(process.env.JWT_SECRET);
const JWT_SECRET = JWT_PROPIA ? process.env.JWT_SECRET : crypto.randomBytes(32).toString("hex");
if (!JWT_PROPIA) {
  console.warn("⚠️ JWT_SECRET sin configurar en el .env: se usa una clave temporal");
}
// Carpeta de datos del cliente (bases, DBF y respaldos). Con DATA_DIR en el
// .env vive fuera del código; sin él se usa la carpeta backend/
const DATA_DIR = path.resolve(__dirname, "..", process.env.DATA_DIR || "");
const DATABASE_DIR = path.join(DATA_DIR, "database");
// BD principal: solo usuarios (y su auditoría)
const DB_PATH = path.join(DATABASE_DIR, "pos.db");
// BD de ventas y tiquetes (conserva el nombre hacienda.db de versiones anteriores)
const DB_HACIENDA_PATH = path.join(DATABASE_DIR, "hacienda.db");
// Productos: archivo DBF del inventario
const INVENTARIO_PATH = path.join(DATABASE_DIR, "FacInve.DBF");
const ROLES = ["cajero", "admin"];
const METODOS_PAGO = ["cash", "sinpe", "tarjeta"];
const LARGO_MINIMO_PASSWORD = 6;

// Datos del negocio que salen impresos en el tiquete
const NEGOCIO = {
  nombre: process.env.NOMBRE_COMERCIAL || "Mi Negocio",
  cedula: process.env.CEDULA_EMISOR || "",
  direccion: process.env.DIRECCION_EXACTA || "",
  telefono: process.env.TELEFONO || ""
};
// Respaldos: por defecto junto a los datos; BACKUP_DIR permite otro disco
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(DATA_DIR, "respaldos");
const MAX_RESPALDOS = 30;

// Middleware
app.use(express.json());
app.use(cors());

// App de escritorio: el backend también sirve el frontend compilado
if (process.env.FRONTEND_DIR) {
  app.use(express.static(process.env.FRONTEND_DIR));
}

// Crear carpetas de datos si no existen
mkdirp.sync(DATABASE_DIR);

// Bases de datos SQLite PERSISTENTES
function abrirBD(ruta) {
  const conexion = new sqlite3.Database(ruta, (err) => {
    if (err) {
      console.error("❌ Error conectando a BD:", err);
    } else {
      console.log(`✓ BD conectada: ${ruta}`);
    }
  });

  // Sin este listener, un error en un db.run() sin callback tumba el proceso
  conexion.on("error", (err) => {
    console.error("❌ Error de BD:", err.message);
  });

  return conexion;
}

const db = abrirBD(DB_PATH);
const dbHacienda = abrirBD(DB_HACIENDA_PATH);
const inventario = new InventarioDBF(INVENTARIO_PATH);

// sqlite3 como promesas; el primer parámetro es la conexión a usar
function dbRun(conexion, sql, params = []) {
  return new Promise((resolve, reject) => {
    conexion.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(conexion, sql, params = []) {
  return new Promise((resolve, reject) => {
    conexion.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbAll(conexion, sql, params = []) {
  return new Promise((resolve, reject) => {
    conexion.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

// ==========================================
// 2. INICIALIZAR SCHEMA DE BD
// ==========================================

async function initializeDatabase() {
  // ---- BD principal (pos.db): usuarios ----
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      rol TEXT DEFAULT 'cajero',
      activo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Administrador inicial: su contraseña sale de ADMIN_PASSWORD en el .env
  if (process.env.ADMIN_PASSWORD) {
    await dbRun(db, `
      INSERT OR IGNORE INTO usuarios (username, password_hash, email, rol)
      VALUES ('admin', ?, 'admin@pos.cr', 'admin')
    `, [bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)]);
  } else {
    console.warn("⚠️ ADMIN_PASSWORD no está en el .env: no se crea el usuario admin");
  }

  // Tabla de auditoría (acciones de los usuarios)
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY,
      usuario_id INTEGER,
      accion TEXT NOT NULL,
      tabla TEXT,
      registro_id INTEGER,
      datos_antiguos TEXT,
      datos_nuevos TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  // ---- BD de ventas (hacienda.db): ventas y líneas de cada tiquete ----
  // usuario_id apunta a usuarios de pos.db (sin FK: es otra BD)
  await dbRun(dbHacienda, `
    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY,
      numero_venta TEXT UNIQUE NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      usuario_id INTEGER,
      cliente_id TEXT,
      total_subtotal REAL,
      total_iva REAL,
      total_venta REAL,
      metodo_pago TEXT,
      estado TEXT DEFAULT 'completada',
      notas TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Los productos viven en el DBF: cada línea guarda su propia copia del
  // código, nombre y tarifa con que se vendió
  await dbRun(dbHacienda, `
    CREATE TABLE IF NOT EXISTS detalle_ventas (
      id INTEGER PRIMARY KEY,
      venta_id INTEGER NOT NULL,
      producto_codigo TEXT,
      nombre TEXT,
      codigo_cabys TEXT,
      cantidad REAL,
      precio_unitario REAL,
      descuento REAL DEFAULT 0,
      subtotal REAL,
      iva REAL,
      tarifa_iva REAL DEFAULT 13,
      FOREIGN KEY (venta_id) REFERENCES ventas(id)
    )
  `);

  // Comprobantes XML de versiones anteriores: ya no se generan, solo se conservan
  await dbRun(dbHacienda, `
    CREATE TABLE IF NOT EXISTS comprobantes (
      id INTEGER PRIMARY KEY,
      venta_id INTEGER UNIQUE,
      tipo_comprobante TEXT,
      clave_hacienda TEXT UNIQUE,
      xml_content TEXT,
      xml_respuesta TEXT,
      estado_hacienda TEXT DEFAULT 'pendiente',
      mensaje_hacienda TEXT,
      fecha_emision DATETIME,
      fecha_envio DATETIME,
      fecha_aceptacion DATETIME,
      intentos_envio INTEGER DEFAULT 0,
      proximo_intento DATETIME,
      ruta_archivo TEXT,
      FOREIGN KEY (venta_id) REFERENCES ventas(id)
    )
  `);

  await migrarVentasDesdeBDPrincipal();

  // Columnas agregadas después: pago recibido, vuelto y la clave que evita
  // registrar dos veces la misma venta
  const columnas = (await dbAll(dbHacienda, `PRAGMA table_info(ventas)`)).map((c) => c.name);
  // y los datos opcionales del cliente para el tiquete
  const COLUMNAS_NUEVAS = [
    ["monto_recibido", "REAL"],
    ["vuelto", "REAL"],
    ["clave_idempotencia", "TEXT"],
    ["cliente_nombre", "TEXT"],
    ["cliente_cedula", "TEXT"],
    ["cliente_telefono", "TEXT"],
    ["cliente_correo", "TEXT"]
  ];
  for (const [nombre, tipo] of COLUMNAS_NUEVAS) {
    if (!columnas.includes(nombre)) {
      await dbRun(dbHacienda, `ALTER TABLE ventas ADD COLUMN ${nombre} ${tipo}`);
    }
  }
  await dbRun(dbHacienda, `CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_clave ON ventas(clave_idempotencia)`);

  // Montos guardados antes de que se redondeara a céntimos
  await dbRun(dbHacienda, `
    UPDATE ventas SET total_subtotal = ROUND(total_subtotal, 2), total_iva = ROUND(total_iva, 2), total_venta = ROUND(total_venta, 2)
    WHERE total_subtotal <> ROUND(total_subtotal, 2) OR total_iva <> ROUND(total_iva, 2) OR total_venta <> ROUND(total_venta, 2)
  `);
  await dbRun(dbHacienda, `
    UPDATE detalle_ventas SET subtotal = ROUND(subtotal, 2), iva = ROUND(iva, 2)
    WHERE subtotal <> ROUND(subtotal, 2) OR iva <> ROUND(iva, 2)
  `);
  console.log("✓ Bases de datos inicializadas");

  try {
    console.log(`✓ Inventario cargado: ${inventario.cargar()} productos (${INVENTARIO_PATH})`);
  } catch (error) {
    console.error("❌ Error cargando inventario:", error.message);
  }
}

// Migración: antes todo vivía en pos.db. Pasa ventas, detalles y comprobantes
// a hacienda.db y deja pos.db solo con usuarios y auditoría.
async function migrarVentasDesdeBDPrincipal() {
  await dbRun(dbHacienda, `ATTACH DATABASE ? AS principal`, [DB_PATH]);
  try {
    const tablas = (await dbAll(dbHacienda, `SELECT name FROM principal.sqlite_master WHERE type = 'table'`))
      .map((t) => t.name);
    if (!tablas.includes("ventas")) return;

    await dbRun(dbHacienda, "BEGIN");
    try {
      await dbRun(dbHacienda, `
        INSERT OR IGNORE INTO ventas (id, numero_venta, fecha, usuario_id, cliente_id, total_subtotal, total_iva, total_venta, metodo_pago, estado, notas, created_at)
        SELECT id, numero_venta, fecha, usuario_id, cliente_id, total_subtotal, total_iva, total_venta, metodo_pago, estado, notas, created_at
        FROM principal.ventas
      `);
      await dbRun(dbHacienda, `
        INSERT OR IGNORE INTO detalle_ventas (id, venta_id, producto_codigo, nombre, codigo_cabys, cantidad, precio_unitario, descuento, subtotal, iva, tarifa_iva)
        SELECT dv.id, dv.venta_id, p.codigo_barras, p.nombre, p.codigo_cabys, dv.cantidad, dv.precio_unitario, dv.descuento, dv.subtotal, dv.iva, COALESCE(p.impuesto_venta, 13)
        FROM principal.detalle_ventas dv
        LEFT JOIN principal.productos p ON p.id = dv.producto_id
      `);
      await dbRun(dbHacienda, `
        INSERT OR IGNORE INTO comprobantes (id, venta_id, tipo_comprobante, clave_hacienda, xml_content, xml_respuesta, estado_hacienda, mensaje_hacienda, fecha_emision, fecha_envio, fecha_aceptacion, intentos_envio, proximo_intento, ruta_archivo)
        SELECT id, venta_id, tipo_comprobante, clave_hacienda, xml_content, xml_respuesta, estado_hacienda, mensaje_hacienda, fecha_emision, fecha_envio, fecha_aceptacion, intentos_envio, proximo_intento, ruta_archivo
        FROM principal.comprobantes
      `);
      for (const tabla of ["detalle_ventas", "comprobantes", "ventas", "productos"]) {
        await dbRun(dbHacienda, `DROP TABLE IF EXISTS principal.${tabla}`);
      }
      await dbRun(dbHacienda, "COMMIT");
      console.log("✓ Migración: ventas y comprobantes movidos a hacienda.db");
    } catch (error) {
      await dbRun(dbHacienda, "ROLLBACK");
      throw error;
    }
  } finally {
    await dbRun(dbHacienda, `DETACH DATABASE principal`);
  }
}

// ==========================================
// 3. FUNCIONES AUXILIARES
// ==========================================

// Registrar en auditoría
function registrarAuditoria(usuarioId, accion, tabla, registroId, datosAntiguos, datosNuevos) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, datos_antiguos, datos_nuevos)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [usuarioId, accion, tabla, registroId, JSON.stringify(datosAntiguos), JSON.stringify(datosNuevos)],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Fecha de hoy (YYYY-MM-DD) en hora local del servidor
function fechaLocalHoy() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
}

// Todos los montos se calculan y guardan redondeados a céntimos
const redondear = (monto) => Math.round((Number(monto) + Number.EPSILON) * 100) / 100;

// Error causado por datos inválidos del cliente (responde 400, no 500)
function errorDeDatos(mensaje) {
  const error = new Error(mensaje);
  error.status = 400;
  return error;
}

// Datos opcionales del cliente para el tiquete: texto limpio o null
function limpiarCliente(cliente) {
  const texto = (valor, largo) => String(valor ?? "").trim().slice(0, largo) || null;
  const datos = {
    nombre: texto(cliente?.nombre, 100),
    cedula: texto(cliente?.cedula, 20),
    telefono: texto(cliente?.telefono, 20),
    correo: texto(cliente?.correo, 100)
  };
  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) {
    throw errorDeDatos("El correo del cliente no es válido");
  }
  return datos;
}

// Las ventas se procesan de una en una: comparten la conexión y su transacción
let colaVentas = Promise.resolve();
function enColaDeVentas(tarea) {
  const resultado = colaVentas.then(tarea);
  colaVentas = resultado.catch(() => {});
  return resultado;
}

// ==========================================
// 4. SERVICIOS
// ==========================================

// SERVICE: Usuarios
const userService = {
  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM usuarios WHERE username = ?`, [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  createUser: (username, password, email, rol = "cajero") => {
    return new Promise((resolve, reject) => {
      const passwordHash = bcrypt.hashSync(password, 10);
      db.run(
        `INSERT INTO usuarios (username, password_hash, email, rol)
         VALUES (?, ?, ?, ?)`,
        [username, passwordHash, email, rol],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, username, email, rol });
        }
      );
    });
  },

  updatePassword: (id, password) =>
    dbRun(
      db,
      `UPDATE usuarios SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [bcrypt.hashSync(password, 10), id]
    ),

  verifyPassword: (password, hash) => {
    return bcrypt.compareSync(password, hash);
  },

  getUserById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT id, username, email, rol FROM usuarios WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
};

// SERVICE: Productos (FacInve.DBF)
const productService = {
  getAllProducts: () => inventario.listar(),

  getProductById: (id) => inventario.obtener(id),

  searchProducts: (search) => inventario.buscar(search),

  createProduct: (data) => inventario.agregar(data),

  updateStock: (productId, cantidad) => inventario.descontarStock(productId, cantidad),

  addStock: (productId, cantidad) => inventario.ajustarStock(productId, cantidad),

  updatePrice: (productId, precioConIva, utilidad) =>
    inventario.actualizarPrecio(productId, precioConIva, utilidad)
};

// SERVICE: Ventas
const salesService = {
  // Registra la venta completa o nada: encabezado, líneas y existencias van en
  // una transacción. Devuelve { ventaId, repetida }.
  createSale: (saleData, usuarioId) => enColaDeVentas(async () => {
    const { items, medioPago, montoRecibido, clientId, notas, claveVenta } = saleData || {};
    const cliente = limpiarCliente(saleData?.cliente);

    if (!Array.isArray(items) || items.length === 0) {
      throw errorDeDatos("La venta no tiene productos");
    }
    if (!METODOS_PAGO.includes(medioPago)) {
      throw errorDeDatos("Método de pago inválido");
    }

    // Reintento de una venta que ya se registró (se perdió la respuesta): no duplicarla
    if (claveVenta) {
      const existente = await dbGet(dbHacienda, `SELECT id FROM ventas WHERE clave_idempotencia = ?`, [claveVenta]);
      if (existente) return { ventaId: existente.id, repetida: true };
    }

    // 1. Validar y calcular todo antes de escribir nada
    let subtotal = 0, totalIva = 0;
    const lineas = [];

    for (const item of items) {
      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw errorDeDatos(`Cantidad inválida para el producto ${item.productId}`);
      }

      const producto = productService.getProductById(item.productId);
      if (!producto) throw errorDeDatos(`Producto ${item.productId} no encontrado`);

      // El cliente paga precio final x cantidad; el desglose de impuesto se
      // saca de ese total para que siempre sumen exacto
      const itemTotal = redondear(producto.total * cantidad);
      const itemSubtotal = redondear(itemTotal / (1 + producto.impuesto_venta / 100));
      const itemIva = redondear(itemTotal - itemSubtotal);
      subtotal += itemSubtotal;
      totalIva += itemIva;
      lineas.push({
        productId: producto.id,
        codigo: producto.codigo,
        nombre: producto.nombre,
        cabys: producto.codigo_cabys,
        tarifa: producto.impuesto_venta,
        cantidad,
        precio: producto.precio_venta,
        subtotal: itemSubtotal,
        iva: itemIva
      });
    }

    subtotal = redondear(subtotal);
    totalIva = redondear(totalIva);
    const totalVenta = redondear(subtotal + totalIva);

    const recibido = medioPago === "cash" ? redondear(montoRecibido) : totalVenta;
    if (!(recibido >= totalVenta)) {
      throw errorDeDatos("Monto recibido insuficiente");
    }
    const vuelto = redondear(recibido - totalVenta);
    const numeroVenta = `VENTA-${Date.now()}`;
    const existencias = lineas.map((linea) => ({ id: linea.productId, cantidad: linea.cantidad }));

    // 2. Escribir todo o nada
    let ventaId;
    let stockDescontado = false;
    await dbRun(dbHacienda, "BEGIN IMMEDIATE");
    try {
      ({ lastID: ventaId } = await dbRun(
        dbHacienda,
        `INSERT INTO ventas (numero_venta, usuario_id, cliente_id, total_subtotal, total_iva, total_venta, metodo_pago, notas, monto_recibido, vuelto, clave_idempotencia,
                             cliente_nombre, cliente_cedula, cliente_telefono, cliente_correo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [numeroVenta, usuarioId, clientId, subtotal, totalIva, totalVenta, medioPago, notas, recibido, vuelto, claveVenta || null,
          cliente.nombre, cliente.cedula, cliente.telefono, cliente.correo]
      ));

      for (const linea of lineas) {
        await dbRun(
          dbHacienda,
          `INSERT INTO detalle_ventas (venta_id, producto_codigo, nombre, codigo_cabys, cantidad, precio_unitario, subtotal, iva, tarifa_iva)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ventaId, linea.codigo, linea.nombre, linea.cabys, linea.cantidad, linea.precio, linea.subtotal, linea.iva, linea.tarifa]
        );
      }

      // Las existencias van al DBF en una sola escritura, justo antes de confirmar
      inventario.descontarVarios(existencias);
      stockDescontado = true;
      await dbRun(dbHacienda, "COMMIT");
    } catch (error) {
      await dbRun(dbHacienda, "ROLLBACK").catch(() => {});
      if (stockDescontado) {
        // La venta no quedó: devolver las existencias al DBF
        try {
          inventario.descontarVarios(existencias.map((e) => ({ id: e.id, cantidad: -e.cantidad })));
        } catch (errorStock) {
          console.error("❌ No se pudieron devolver existencias:", errorStock.message);
        }
      }
      throw error;
    }

    // La venta ya quedó registrada: un fallo en la auditoría no la anula
    try {
      await registrarAuditoria(usuarioId, "VENTA_CREADA", "ventas", ventaId, null, {
        numeroVenta,
        totalVenta,
        medioPago
      });
    } catch (error) {
      console.error("❌ Error registrando auditoría de la venta:", error.message);
    }

    return { ventaId, repetida: false };
  }),

  getSaleById: async (ventaId) => {
    const venta = await dbGet(dbHacienda, `SELECT *, DATETIME(fecha, 'localtime') AS fecha_local FROM ventas WHERE id = ?`, [ventaId]);
    if (!venta) return null;

    const usuario = await userService.getUserById(venta.usuario_id);
    const detalles = await dbAll(dbHacienda, `SELECT * FROM detalle_ventas WHERE venta_id = ?`, [ventaId]);
    return { ...venta, username: usuario ? usuario.username : null, detalles };
  },

  getDailySales: async (fecha = null) => {
    // fecha se guarda en UTC: comparar por día local para que las ventas
    // de la noche no caigan en el día siguiente
    const fechaFiltro = fecha || fechaLocalHoy();
    const ventas = await dbAll(
      dbHacienda,
      `SELECT v.*, DATETIME(v.fecha, 'localtime') AS fecha_local,
              (SELECT COALESCE(SUM(dv.cantidad), 0) FROM detalle_ventas dv WHERE dv.venta_id = v.id) AS total_articulos
       FROM ventas v
       WHERE DATE(v.fecha, 'localtime') = ? ORDER BY v.fecha DESC`,
      [fechaFiltro]
    );

    // Los usuarios están en la BD principal
    const usuarios = await dbAll(db, `SELECT id, username FROM usuarios`);
    const nombres = new Map(usuarios.map((u) => [u.id, u.username]));
    return ventas.map((v) => ({ ...v, username: nombres.get(v.usuario_id) || null }));
  }
};

// Tiquete que se entrega al cliente: precios finales, sin desglose de impuestos
function armarTiquete(venta) {
  return {
    ventaId: venta.id,
    numero: String(venta.id).padStart(6, "0"),
    fecha: venta.fecha_local,
    cajero: venta.username,
    negocio: NEGOCIO,
    // Solo si el cliente pidió el tiquete a su nombre
    cliente:
      venta.cliente_nombre || venta.cliente_cedula || venta.cliente_telefono || venta.cliente_correo
        ? {
            nombre: venta.cliente_nombre,
            cedula: venta.cliente_cedula,
            telefono: venta.cliente_telefono,
            correo: venta.cliente_correo
          }
        : null,
    lineas: venta.detalles.map((detalle) => {
      const total = redondear(detalle.subtotal + detalle.iva);
      return {
        codigo: detalle.producto_codigo,
        nombre: detalle.nombre,
        cantidad: detalle.cantidad,
        precio: redondear(total / detalle.cantidad),
        total
      };
    }),
    total: redondear(venta.total_venta),
    metodoPago: venta.metodo_pago,
    montoRecibido: venta.monto_recibido,
    vuelto: venta.vuelto
  };
}

// SERVICE: Reportes
const reportService = {
  getCashClosing: async () => {
    const ventas = await salesService.getDailySales();

    let efectivo = 0, sinpe = 0, tarjeta = 0, totalIVA = 0;

    ventas.forEach((venta) => {
      if (venta.metodo_pago === "cash") efectivo += venta.total_venta;
      else if (venta.metodo_pago === "sinpe") sinpe += venta.total_venta;
      else if (venta.metodo_pago === "tarjeta") tarjeta += venta.total_venta;

      totalIVA += venta.total_iva;
    });

    return {
      fecha: fechaLocalHoy(),
      totalVentas: ventas.length,
      efectivo,
      sinpe,
      tarjeta,
      total: efectivo + sinpe + tarjeta,
      totalIVA,
      montoNeto: (efectivo + sinpe + tarjeta) - totalIVA
    };
  }
};

// ==========================================
// 5. MIDDLEWARE
// ==========================================

// Autenticación JWT
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No autorizado" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuarioId = decoded.usuarioId;
    req.username = decoded.username;
    req.rol = decoded.rol;
    next();
  } catch (error) {
    res.status(401).json({ error: "Token inválido" });
  }
};

// ==========================================
// 6. RUTAS API
// ==========================================

// Bloqueo por intentos fallidos: varios seguidos bloquean ese usuario un rato
const MAX_INTENTOS_LOGIN = 5;
const BLOQUEO_LOGIN_MS = 5 * 60 * 1000;
const intentosLogin = new Map(); // usuario -> { fallos, bloqueadoHasta }

function validarPassword(password) {
  if (typeof password !== "string" || password.length < LARGO_MINIMO_PASSWORD) {
    throw errorDeDatos(`La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
  }
}

// AUTH: Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { password } = req.body || {};
    const username = String(req.body?.username ?? "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    }

    const clave = username.toLowerCase();
    const intentos = intentosLogin.get(clave) || { fallos: 0, bloqueadoHasta: 0 };
    if (intentos.bloqueadoHasta > Date.now()) {
      const minutos = Math.ceil((intentos.bloqueadoHasta - Date.now()) / 60000);
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Intente de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}`
      });
    }

    const usuario = await userService.getUserByUsername(username);
    const valido = usuario && usuario.activo && userService.verifyPassword(password, usuario.password_hash);

    if (!valido) {
      intentos.fallos += 1;
      if (intentos.fallos >= MAX_INTENTOS_LOGIN) {
        intentos.fallos = 0;
        intentos.bloqueadoHasta = Date.now() + BLOQUEO_LOGIN_MS;
        await registrarAuditoria(usuario ? usuario.id : null, "LOGIN_BLOQUEADO", null, null, null, { username });
      }
      if (intentosLogin.size > 1000) intentosLogin.clear();
      intentosLogin.set(clave, intentos);
      // El mismo mensaje exista o no el usuario, para no revelar cuáles existen
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    intentosLogin.delete(clave);

    const token = jwt.sign(
      { usuarioId: usuario.id, username: usuario.username, rol: usuario.rol },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    await registrarAuditoria(usuario.id, "LOGIN", null, null, null, { username });

    res.json({
      token,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        email: usuario.email,
        rol: usuario.rol
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AUTH: Cambiar mi contraseña
app.post("/api/auth/password", authMiddleware, async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    const usuario = await userService.getUserByUsername(req.username);
    if (!usuario || !actual || !userService.verifyPassword(actual, usuario.password_hash)) {
      return res.status(400).json({ error: "La contraseña actual no es correcta" });
    }
    validarPassword(nueva);

    await userService.updatePassword(usuario.id, nueva);
    await registrarAuditoria(usuario.id, "PASSWORD_CAMBIADA", "usuarios", usuario.id, null, null);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Restablecer la contraseña de otro usuario (solo admin)
app.post("/api/users/:id/password", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }
    const usuario = await userService.getUserById(req.params.id);
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    validarPassword(req.body?.nueva);

    await userService.updatePassword(usuario.id, req.body.nueva);
    intentosLogin.delete(usuario.username.toLowerCase());
    await registrarAuditoria(req.usuarioId, "PASSWORD_RESTABLECIDA", "usuarios", usuario.id, null, {
      username: usuario.username
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// AUTH: Registro (solo admin)
app.post("/api/auth/register", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }

    const { password, email } = req.body || {};
    const username = String(req.body?.username ?? "").trim();
    const rol = req.body?.rol || "cajero";

    if (!username || !password) {
      return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    }
    if (!ROLES.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido" });
    }
    validarPassword(password);
    if (await userService.getUserByUsername(username)) {
      return res.status(409).json({ error: `El usuario ${username} ya existe` });
    }

    const usuario = await userService.createUser(username, password, email, rol);

    await registrarAuditoria(req.usuarioId, "USUARIO_CREADO", "usuarios", usuario.id, null, usuario);

    res.status(201).json(usuario);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// AUTH: Mi perfil
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const usuario = await userService.getUserById(req.usuarioId);
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PRODUCTOS
app.get("/api/products", authMiddleware, async (req, res) => {
  try {
    const productos = productService.getAllProducts();
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products/search", authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const productos = productService.searchProducts(q);
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }

    const producto = productService.createProduct(req.body);
    await registrarAuditoria(req.usuarioId, "PRODUCTO_CREADO", "productos", producto.id, null, req.body);

    res.status(201).json(producto);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sumar existencias y/o cambiar precio y utilidad de un producto (solo admin)
app.post("/api/products/:id/stock", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }

    const { precio_con_iva, utilidad } = req.body || {};
    const cantidad = Number(req.body?.cantidad ?? 0);
    const cambiaPrecio = precio_con_iva !== undefined || utilidad !== undefined;

    if (!Number.isFinite(cantidad) || cantidad < 0) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }
    if (cantidad === 0 && !cambiaPrecio) {
      return res.status(400).json({ error: "No hay cambios que guardar" });
    }

    let producto = productService.getProductById(req.params.id);
    if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
    const anterior = {
      stock_actual: producto.stock_actual,
      precio_con_iva: producto.precio_con_iva,
      utilidad: producto.utilidad,
      total: producto.total
    };

    // El precio va primero: si es inválido no se toca la existencia
    if (cambiaPrecio) {
      producto = productService.updatePrice(
        producto.id,
        Number(precio_con_iva ?? producto.precio_con_iva),
        Number(utilidad ?? producto.utilidad)
      );
    }
    if (cantidad > 0) {
      producto = productService.addStock(producto.id, cantidad);
    }

    await registrarAuditoria(
      req.usuarioId,
      cambiaPrecio ? "PRODUCTO_ACTUALIZADO" : "STOCK_AGREGADO",
      "productos",
      producto.id,
      anterior,
      {
        codigo: producto.codigo,
        cantidad,
        stock_actual: producto.stock_actual,
        precio_con_iva: producto.precio_con_iva,
        utilidad: producto.utilidad,
        total: producto.total
      }
    );

    res.json(producto);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VENTAS
app.post("/api/sales", authMiddleware, async (req, res) => {
  try {
    const { ventaId, repetida } = await salesService.createSale(req.body, req.usuarioId);
    const venta = await salesService.getSaleById(ventaId);

    res.status(repetida ? 200 : 201).json({
      ventaId,
      numeroVenta: venta.numero_venta,
      subtotal: venta.total_subtotal,
      iva: venta.total_iva,
      total: venta.total_venta,
      vuelto: venta.vuelto || 0,
      estado: venta.estado,
      tiquete: armarTiquete(venta)
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Venta que el usuario puede ver: el admin cualquiera, los demás solo las suyas
async function ventaVisible(req) {
  const venta = await salesService.getSaleById(req.params.id);
  const esPropia = venta && venta.usuario_id === req.usuarioId;
  return venta && (req.rol === "admin" || esPropia) ? venta : null;
}

// Ventas de un día (por defecto hoy): /api/sales?fecha=YYYY-MM-DD
// Ventas de un día que el usuario puede ver: el admin todas (o las de
// ?usuario_id=); los demás solo las que hicieron ellos
async function ventasVisibles(req) {
  const ventas = await salesService.getDailySales(req.query.fecha);
  const usuarioId = req.rol === "admin" ? req.query.usuario_id : req.usuarioId;
  return usuarioId ? ventas.filter((venta) => venta.usuario_id === Number(usuarioId)) : ventas;
}

app.get("/api/sales", authMiddleware, async (req, res) => {
  try {
    res.json(await ventasVisibles(req));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sales/:id", authMiddleware, async (req, res) => {
  try {
    const venta = await ventaVisible(req);
    if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
    res.json(venta);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tiquete de una venta, para reimprimirlo
app.get("/api/sales/:id/ticket", authMiddleware, async (req, res) => {
  try {
    const venta = await ventaVisible(req);
    if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
    res.json(armarTiquete(venta));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RESPALDOS
function respaldar() {
  return crearRespaldo({
    carpeta: BACKUP_DIR,
    bases: [
      { conexion: db, archivo: "pos.db" },
      { conexion: dbHacienda, archivo: "hacienda.db" }
    ],
    archivos: [INVENTARIO_PATH],
    maximo: MAX_RESPALDOS
  });
}

// Un respaldo automático por día: al arrancar y, si la app queda abierta,
// al cambiar de fecha
function programarRespaldoDiario() {
  const revisar = async () => {
    try {
      const ultimo = listarRespaldos(BACKUP_DIR)[0];
      if (ultimo && ultimo.fecha === fechaLocalHoy()) return;
      const respaldo = await respaldar();
      console.log(`✓ Respaldo automático: ${path.join(BACKUP_DIR, respaldo.nombre)}`);
    } catch (error) {
      console.error("❌ Error en el respaldo automático:", error.message);
    }
  };
  revisar();
  setInterval(revisar, 60 * 60 * 1000).unref();
}

app.get("/api/admin/backups", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }
    res.json({ carpeta: BACKUP_DIR, maximo: MAX_RESPALDOS, respaldos: listarRespaldos(BACKUP_DIR) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/backups", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }
    const respaldo = await respaldar();
    await registrarAuditoria(req.usuarioId, "RESPALDO_CREADO", null, null, null, respaldo);
    res.status(201).json(respaldo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// USUARIOS (solo admin): lista para los filtros de administración
app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin") {
      return res.status(403).json({ error: "No tienes permiso" });
    }
    res.json(await dbAll(db, `SELECT id, username, rol FROM usuarios WHERE activo = 1 ORDER BY username`));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REPORTES
// Totales de un grupo de ventas, por método de pago
function resumirVentas(ventas) {
  let efectivo = 0, sinpe = 0, tarjeta = 0, totalIVA = 0;

  ventas.forEach((venta) => {
    if (venta.metodo_pago === "cash") efectivo += venta.total_venta;
    else if (venta.metodo_pago === "sinpe") sinpe += venta.total_venta;
    else if (venta.metodo_pago === "tarjeta") tarjeta += venta.total_venta;

    totalIVA += venta.total_iva;
  });

  const total = redondear(efectivo + sinpe + tarjeta);
  return {
    totalVentas: ventas.length,
    detallePagos: {
      efectivo: redondear(efectivo),
      sinpe: redondear(sinpe),
      tarjeta: redondear(tarjeta)
    },
    total,
    totalIVA: redondear(totalIVA),
    montoNeto: redondear(total - totalIVA)
  };
}

// Cierre de un día. El cajero recibe solo el de sus ventas; el admin el
// general con desglose por usuario, o el de un usuario con ?usuario_id=
app.get("/api/reports/cash-closing", authMiddleware, async (req, res) => {
  try {
    const { fecha, usuario_id } = req.query;
    const esAdmin = req.rol === "admin";
    const ventas = await ventasVisibles(req);

    const cierre = { fecha: fecha || fechaLocalHoy(), ...resumirVentas(ventas) };

    if (esAdmin && !usuario_id) {
      const grupos = new Map();
      for (const venta of ventas) {
        if (!grupos.has(venta.usuario_id)) grupos.set(venta.usuario_id, []);
        grupos.get(venta.usuario_id).push(venta);
      }
      cierre.porUsuario = [...grupos].map(([usuarioId, grupo]) => ({
        usuario_id: usuarioId,
        username: grupo[0].username || "(sin usuario)",
        ...resumirVentas(grupo)
      }));
    }

    res.json(cierre);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    bd: "conectada",
    timestamp: new Date(),
    version: "1.0.0-beta"
  });
});

// ==========================================
// 7. INICIAR SERVIDOR
// ==========================================

// Inicializa las bases y levanta el servidor; resuelve con el servidor HTTP
function iniciar() {
  return initializeDatabase().then(
    () =>
      new Promise((resolve, reject) => {
        const server = app.listen(PORT, HOST, () => {
          console.log(`
╔════════════════════════════════════════╗
║   POS Costa Rica v1.0 Beta             ║
║   Puerto: ${server.address().port}                          ║
║   BD usuarios: ${DB_PATH}
║   BD ventas: ${DB_HACIENDA_PATH}
║   Productos: ${INVENTARIO_PATH}
║   Respaldos: ${BACKUP_DIR}
╚════════════════════════════════════════╝
          `);
          programarRespaldoDiario();
          resolve(server);
        });
        server.on("error", reject);
      })
  );
}

// Ejecutado directo (npm start) arranca solo; la app de escritorio llama a iniciar()
if (require.main === module) {
  iniciar().catch((error) => {
    console.error("❌ No se pudo iniciar el servidor:", error);
    process.exit(1);
  });
}

module.exports = { app, iniciar };
