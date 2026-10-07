// ==========================================
// BACKEND POS - Versión Crítica Mejorada
// Con guardado de XML en archivos
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
const JWT_SECRET = process.env.JWT_SECRET || "tu-clave-secreta-muy-segura-cambiar-en-produccion";
// Carpeta de datos del cliente (bases, DBF y comprobantes). Con DATA_DIR en el
// .env vive fuera del código; sin él se usa la carpeta backend/
const DATA_DIR = path.resolve(__dirname, "..", process.env.DATA_DIR || "");
const DATABASE_DIR = path.join(DATA_DIR, "database");
// BD principal: solo usuarios (y su auditoría)
const DB_PATH = path.join(DATABASE_DIR, "pos.db");
// BD de Hacienda: ventas, tiquetes y comprobantes electrónicos
const DB_HACIENDA_PATH = path.join(DATABASE_DIR, "hacienda.db");
// Productos: archivo DBF del inventario
const INVENTARIO_PATH = path.join(DATABASE_DIR, "FacInve.DBF");
const COMPROBANTES_PATH = path.join(DATA_DIR, "comprobantes");
const ROLES = ["cajero", "admin"];
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
mkdirp.sync(COMPROBANTES_PATH);

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

  // Insertar usuario por defecto si no existe
  await dbRun(db, `
    INSERT OR IGNORE INTO usuarios (username, password_hash, email, rol)
    VALUES ('cajero', ?, 'cajero@pos.cr', 'cajero')
  `, [bcrypt.hashSync('1234', 10)]);

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

  // ---- BD de Hacienda (hacienda.db): ventas, tiquetes y comprobantes ----
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

  // Tabla de comprobantes HACIENDA
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

// Escapar texto para XML
function escapeXML(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Clave de 50 dígitos (MOCK): debe ser única por comprobante
function generarClaveHacienda(ventaId) {
  const d = new Date();
  const fecha = [d.getDate(), d.getMonth() + 1, d.getFullYear() % 100]
    .map((n) => String(n).padStart(2, "0"))
    .join("");
  const cedula = String(process.env.CEDULA_EMISOR || "3101234567")
    .replace(/\D/g, "")
    .padStart(12, "0")
    .slice(-12);
  const consecutivo = "00100001" + "04" + String(ventaId).padStart(10, "0").slice(-10);
  const seguridad = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  return "506" + fecha + cedula + consecutivo + "1" + seguridad;
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
  createSale: async (saleData, usuarioId) => {
    const { items, medioPago, montoRecibido, clientId, notas } = saleData || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("La venta no tiene productos");
    }

    // Calcular totales
    let subtotal = 0, totalIva = 0;
    const lineas = [];

    for (const item of items) {
      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new Error(`Cantidad inválida para el producto ${item.productId}`);
      }

      const producto = productService.getProductById(item.productId);
      if (!producto) throw new Error(`Producto ${item.productId} no encontrado`);

      const itemSubtotal = producto.precio_venta * cantidad;
      const itemIva = itemSubtotal * (producto.impuesto_venta / 100);
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

    const totalVenta = subtotal + totalIva;
    const numeroVenta = `VENTA-${Date.now()}`;

    const { lastID: ventaId } = await dbRun(
      dbHacienda,
      `INSERT INTO ventas (numero_venta, usuario_id, cliente_id, total_subtotal, total_iva, total_venta, metodo_pago, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [numeroVenta, usuarioId, clientId, subtotal, totalIva, totalVenta, medioPago, notas]
    );

    // Guardar detalles y actualizar stock
    for (const linea of lineas) {
      await dbRun(
        dbHacienda,
        `INSERT INTO detalle_ventas (venta_id, producto_codigo, nombre, codigo_cabys, cantidad, precio_unitario, subtotal, iva, tarifa_iva)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ventaId, linea.codigo, linea.nombre, linea.cabys, linea.cantidad, linea.precio, linea.subtotal, linea.iva, linea.tarifa]
      );
      // La venta ya quedó registrada: un fallo al escribir el DBF no la anula
      try {
        productService.updateStock(linea.productId, linea.cantidad);
      } catch (error) {
        console.error(`❌ No se pudo descontar stock de ${linea.codigo}:`, error.message);
      }
    }

    // Registrar en auditoría
    await registrarAuditoria(
      usuarioId,
      "VENTA_CREADA",
      "ventas",
      ventaId,
      null,
      { numeroVenta, totalVenta, medioPago }
    );

    const recibido = Number(montoRecibido);
    return {
      ventaId,
      numeroVenta,
      subtotal,
      iva: totalIva,
      total: totalVenta,
      vuelto: Number.isFinite(recibido) ? Math.max(recibido - totalVenta, 0) : 0,
      estado: "completada"
    };
  },

  getSaleById: async (ventaId) => {
    const venta = await dbGet(dbHacienda, `SELECT * FROM ventas WHERE id = ?`, [ventaId]);
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

// SERVICE: Facturación (MEJORADO - PASO 1)
const facturacionService = {
  buildXML: (venta, detalles) => {
    const haciendaConfig = require('./config/hacienda');
    const XMLValidator = require('./utils/xmlValidator');

    // Información de la venta
    const fechaEmision = new Date().toISOString();
    const tipoComprobante = '04'; // Tiquete electrónico

    // Construir detalles XML
    let detallesXML = '';
    detalles.forEach((detalle, index) => {
      const cantidad = parseFloat(detalle.cantidad) || 0;
      const precioUnitario = parseFloat(detalle.precio_unitario) || 0;
      const subtotal = parseFloat(detalle.subtotal) || 0;
      const iva = parseFloat(detalle.iva) || 0;
      const tarifa = detalle.tarifa_iva ?? 13;

      detallesXML += `
    <LineaDetalle>
      <NumeroLineaDetalle>${index + 1}</NumeroLineaDetalle>
      <CodigoActividad>${haciendaConfig.codigoActividad}</CodigoActividad>
      <CodigoProducto>${escapeXML(detalle.producto_codigo)}</CodigoProducto>
      <DescripcionProducto>${escapeXML(detalle.nombre || 'Producto')}</DescripcionProducto>
      <Cantidad>${cantidad}</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <PrecioUnitario>${precioUnitario.toFixed(2)}</PrecioUnitario>
      <Descuento>
        <MontoDescuento>${(parseFloat(detalle.descuento) || 0).toFixed(2)}</MontoDescuento>
      </Descuento>
      <SubTotal>${subtotal.toFixed(2)}</SubTotal>
      <ImpuestoVentas>
        <Tarifa>${tarifa}</Tarifa>
        <Monto>${iva.toFixed(2)}</Monto>
      </ImpuestoVentas>
      <MontoNeto>${subtotal.toFixed(2)}</MontoNeto>
    </LineaDetalle>`;
    });

    // Construir XML v4.4 COMPLETO
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FacturaElectronicaV4_4>
  <Encabezado>
    <NumeroCedulaEmisor>${haciendaConfig.cedulaEmisor}</NumeroCedulaEmisor>
    <NumeroCedulaReceptor>N/A</NumeroCedulaReceptor>
    <ProveedorSistema>${haciendaConfig.cedulaEmisor}</ProveedorSistema>
    <NombreComercial>${escapeXML(haciendaConfig.nombreComercial)}</NombreComercial>
    <TipoComprobante>${tipoComprobante}</TipoComprobante>
    <FechaEmision>${fechaEmision}</FechaEmision>
    <Moneda>CRC</Moneda>
    <NumeroConsecutivo>001-001-${Math.floor(Math.random() * 1000000)}</NumeroConsecutivo>
    <CodigoActividad>${haciendaConfig.codigoActividad}</CodigoActividad>
    <Provincia>${haciendaConfig.provincia}</Provincia>
    <Canton>${haciendaConfig.canton}</Canton>
    <Distrito>${haciendaConfig.distrito}</Distrito>
    <Barrio>${haciendaConfig.barrio}</Barrio>
    <DireccionExacta>${escapeXML(haciendaConfig.direccionExacta)}</DireccionExacta>
  </Encabezado>
  <DetalleServicio>${detallesXML}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoMoneda>CRC</CodigoMoneda>
    <TotalServGravados>${venta.total_subtotal.toFixed(2)}</TotalServGravados>
    <TotalServExentos>0.00</TotalServExentos>
    <TotalImpuestoVentas>${venta.total_iva.toFixed(2)}</TotalImpuestoVentas>
    <TotalImpuestoSelectivo>0.00</TotalImpuestoSelectivo>
    <TotalComprobante>${venta.total_venta.toFixed(2)}</TotalComprobante>
  </ResumenFactura>
  <CodigoSeguridad></CodigoSeguridad>
</FacturaElectronicaV4_4>`;

    // VALIDAR XML
    const validacion = XMLValidator.validar(xml);
    console.log(`\n📋 Validación XML v4.4: ${validacion.válido ? '✓ VÁLIDO' : '❌ INVÁLIDO'}`);

    if (!validacion.válido) {
      console.log('Errores encontrados:');
      validacion.errores.forEach(error => console.log(`  - ${error}`));
    }

    return {
      xml,
      válido: validacion.válido,
      errores: validacion.errores
    };
  },

  signXML: async (xmlContent) => {
    // Por ahora: retorna XML sin firmar (PASO 2 lo hace)
    return xmlContent;
  },

  sendToHacienda: async (xmlFirmado, claveHacienda) => {
    // Por ahora: simula respuesta (PASO 3 lo hace real)
    console.log("📤 [MOCK] Enviando a Hacienda:", claveHacienda);

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          status: "aceptado",
          clave: claveHacienda,
          mensaje: "Comprobante aceptado"
        });
      }, 1000);
    });
  }
};

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

// AUTH: Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    }

    const usuario = await userService.getUserByUsername(username);

    if (!usuario) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    if (!userService.verifyPassword(password, usuario.password_hash)) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

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
    if (await userService.getUserByUsername(username)) {
      return res.status(409).json({ error: `El usuario ${username} ya existe` });
    }

    const usuario = await userService.createUser(username, password, email, rol);

    await registrarAuditoria(req.usuarioId, "USUARIO_CREADO", "usuarios", usuario.id, null, usuario);

    res.status(201).json(usuario);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const venta = await salesService.createSale(req.body, req.usuarioId);

    // Obtener detalles completos
    const ventaCompleta = await salesService.getSaleById(venta.ventaId);

    // Generar comprobante XML
    const xmlResult = facturacionService.buildXML(
      {
        total_subtotal: venta.subtotal,
        total_iva: venta.iva,
        total_venta: venta.total
      },
      ventaCompleta.detalles
    );

    const xml = xmlResult.xml;

    // Si hay errores de validación, log pero continúa
    if (!xmlResult.válido) {
      console.warn('⚠️ XML con errores de validación:', xmlResult.errores);
    }

    // Firmar (próximo paso)
    const xmlFirmado = await facturacionService.signXML(xmlResult.xml);

    // Generar clave de 50 dígitos (MOCK), única por venta
    const claveHacienda = generarClaveHacienda(venta.ventaId);

    // Guardar XML como ARCHIVO en disco
    const hoy = new Date().toISOString().split('T')[0];
    const carpetaComprobantes = path.join(COMPROBANTES_PATH, hoy);

    // Crear carpeta si no existe
    mkdirp.sync(carpetaComprobantes);

    // Guardar archivo XML
    const nombreArchivo = `${venta.numeroVenta}-xml.xml`;
    const rutaXML = path.join(carpetaComprobantes, nombreArchivo);
    fs.writeFileSync(rutaXML, xmlFirmado);
    console.log(`✓ XML guardado en: ${rutaXML}`);

    // Guardar comprobante en BD de Hacienda
    await dbRun(
      dbHacienda,
      `INSERT INTO comprobantes (venta_id, tipo_comprobante, clave_hacienda, xml_content, estado_hacienda, fecha_emision, ruta_archivo)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [venta.ventaId, "04", claveHacienda, xmlFirmado, "pendiente", rutaXML]
    );

    // Enviar a Hacienda (próximo paso)
    // await facturacionService.sendToHacienda(xmlFirmado, claveHacienda);

    res.status(201).json({
      ...venta,
      comprobante: {
        clave: claveHacienda,
        estado: "pendiente",
        xml: xmlFirmado,
        ruta: rutaXML
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    const venta = await salesService.getSaleById(req.params.id);
    const esPropia = venta && venta.usuario_id === req.usuarioId;
    if (!venta || (req.rol !== "admin" && !esPropia)) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }
    res.json(venta);
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

  return {
    totalVentas: ventas.length,
    detallePagos: { efectivo, sinpe, tarjeta },
    total: efectivo + sinpe + tarjeta,
    totalIVA,
    montoNeto: (efectivo + sinpe + tarjeta) - totalIVA
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
║   BD Hacienda: ${DB_HACIENDA_PATH}
║   Productos: ${INVENTARIO_PATH}
║   Comprobantes: ${COMPROBANTES_PATH}
║   ✓ Persistencia: SÍ                    ║
║   ✓ Autenticación: SÍ                   ║
║   ✓ XML en archivos: SÍ                 ║
║   ⏳ Hacienda: En desarrollo             ║
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
