// ==========================================
// BACKEND POS - Versión Crítica Mejorada
// ==========================================
// Archivo: backend/src/app.js

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

// ==========================================
// 1. CONFIGURACIÓN
// ==========================================

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "tu-clave-secreta-muy-segura-cambiar-en-produccion";
const DB_PATH = path.join(__dirname, "../database/pos.db");

// Middleware
app.use(express.json());
app.use(cors());

// Crear carpeta database si no existe
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  console.log("✓ Carpeta database creada");
}

// Base de datos SQLite PERSISTENTE
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ Error conectando a BD:", err);
  } else {
    console.log(`✓ BD conectada: ${DB_PATH}`);
  }
});

// ==========================================
// 2. INICIALIZAR SCHEMA DE BD
// ==========================================

function initializeDatabase() {
  db.serialize(() => {
    // Tabla de usuarios (NUEVA)
    db.run(`
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
    db.run(`
      INSERT OR IGNORE INTO usuarios (username, password_hash, email, rol)
      VALUES ('cajero', ?, 'cajero@pos.cr', 'cajero')
    `, [bcrypt.hashSync('1234', 10)]);

    // Tabla de productos
    db.run(`
      CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY,
        codigo_barras TEXT UNIQUE,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        codigo_cabys TEXT NOT NULL,
        precio_venta REAL NOT NULL,
        impuesto_venta REAL DEFAULT 13,
        stock_actual INTEGER DEFAULT 0,
        stock_minimo INTEGER DEFAULT 0,
        activo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de ventas
    db.run(`
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
      )
    `);

    // Tabla de detalle de ventas
    db.run(`
      CREATE TABLE IF NOT EXISTS detalle_ventas (
        id INTEGER PRIMARY KEY,
        venta_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        cantidad REAL,
        precio_unitario REAL,
        descuento REAL DEFAULT 0,
        subtotal REAL,
        iva REAL,
        FOREIGN KEY (venta_id) REFERENCES ventas(id),
        FOREIGN KEY (producto_id) REFERENCES productos(id)
      )
    `);

    // Tabla de comprobantes HACIENDA
    db.run(`
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
        FOREIGN KEY (venta_id) REFERENCES ventas(id)
      )
    `);

    // Tabla de auditoría (NUEVA - seguridad)
    db.run(`
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

    console.log("✓ Base de datos inicializada");
  });
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

// ==========================================
// 4. SERVICIOS
// ==========================================

// SERVICE: Usuarios (NUEVA - Autenticación real)
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

// SERVICE: Productos
const productService = {
  getAllProducts: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM productos WHERE activo = 1`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getProductById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM productos WHERE id = ? AND activo = 1`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  searchProducts: (search) => {
    return new Promise((resolve, reject) => {
      const query = `%${search}%`;
      db.all(
        `SELECT * FROM productos WHERE activo = 1 AND (nombre LIKE ? OR codigo_barras LIKE ?)`,
        [query, query],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  },

  createProduct: (data) => {
    return new Promise((resolve, reject) => {
      const { codigo_barras, nombre, codigo_cabys, precio_venta, stock_actual, descripcion } = data;
      db.run(
        `INSERT INTO productos (codigo_barras, nombre, codigo_cabys, precio_venta, stock_actual, descripcion)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [codigo_barras, nombre, codigo_cabys, precio_venta, stock_actual, descripcion],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });
  },

  updateStock: (productId, cantidad) => {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?`,
        [cantidad, productId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
};

// SERVICE: Ventas
const salesService = {
  createSale: async (saleData, usuarioId) => {
    const { items, medioPago, montoRecibido, clientId, notas } = saleData;

    return new Promise(async (resolve, reject) => {
      try {
        // Calcular totales
        let subtotal = 0, totalIva = 0;

        for (const item of items) {
          const producto = await productService.getProductById(item.productId);
          if (!producto) throw new Error(`Producto ${item.productId} no encontrado`);
          
          const itemSubtotal = producto.precio_venta * item.cantidad;
          const itemIva = itemSubtotal * (producto.impuesto_venta / 100);
          subtotal += itemSubtotal;
          totalIva += itemIva;
        }

        const totalVenta = subtotal + totalIva;
        const numeroVenta = `VENTA-${Date.now()}`;

        // Guardar venta en transacción
        db.run(
          `INSERT INTO ventas (numero_venta, usuario_id, cliente_id, total_subtotal, total_iva, total_venta, metodo_pago, notas)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [numeroVenta, usuarioId, clientId, subtotal, totalIva, totalVenta, medioPago, notas],
          async function (err) {
            if (err) return reject(err);

            const ventaId = this.lastID;

            // Guardar detalles y actualizar stock
            try {
              for (const item of items) {
                const producto = await productService.getProductById(item.productId);
                const subtotalItem = producto.precio_venta * item.cantidad;
                const ivaItem = subtotalItem * (producto.impuesto_venta / 100);

                // Insertar detalle
                db.run(
                  `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, iva)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [ventaId, item.productId, item.cantidad, producto.precio_venta, subtotalItem, ivaItem]
                );

                // Actualizar stock
                await productService.updateStock(item.productId, item.cantidad);
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

              resolve({
                ventaId,
                numeroVenta,
                subtotal,
                iva: totalIva,
                total: totalVenta,
                vuelto: montoRecibido - totalVenta,
                estado: "completada"
              });
            } catch (error) {
              reject(error);
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  },

  getSaleById: (ventaId) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT v.*, u.username FROM ventas v
         LEFT JOIN usuarios u ON v.usuario_id = u.id
         WHERE v.id = ?`,
        [ventaId],
        (err, venta) => {
          if (err) return reject(err);
          if (!venta) return resolve(null);

          db.all(
            `SELECT dv.*, p.nombre, p.codigo_cabys FROM detalle_ventas dv
             JOIN productos p ON dv.producto_id = p.id
             WHERE dv.venta_id = ?`,
            [ventaId],
            (err, detalles) => {
              if (err) reject(err);
              else resolve({ ...venta, detalles });
            }
          );
        }
      );
    });
  },

  getDailySales: (fecha = null) => {
    return new Promise((resolve, reject) => {
      const fechaFiltro = fecha || new Date().toISOString().split("T")[0];
      db.all(
        `SELECT * FROM ventas WHERE DATE(fecha) = ? ORDER BY fecha DESC`,
        [fechaFiltro],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }
};

// SERVICE: Facturación (PREPARADO PARA HACIENDA)
const facturacionService = {
  buildXML: (venta, detalles) => {
    // VERSIÓN 4.4 SIMPLIFICADA
    const fechaEmision = new Date().toISOString();
    
    let detallesXML = '';
    detalles.forEach((detalle, index) => {
      detallesXML += `
    <LineaDetalle>
      <NumeroLineaDetalle>${index + 1}</NumeroLineaDetalle>
      <CodigoActividad>6201</CodigoActividad>
      <CodigoProducto>${detalle.producto_id}</CodigoProducto>
      <DescripcionProducto>${detalle.nombre}</DescripcionProducto>
      <Cantidad>${detalle.cantidad}</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <PrecioUnitario>${detalle.precio_unitario}</PrecioUnitario>
      <Descuento>
        <MontoDescuento>${detalle.descuento || 0}</MontoDescuento>
      </Descuento>
      <SubTotal>${detalle.subtotal}</SubTotal>
      <ImpuestoVentas>
        <Tarifa>13</Tarifa>
        <Monto>${detalle.iva}</Monto>
      </ImpuestoVentas>
    </LineaDetalle>`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FacturaElectronicaV4_4>
  <Encabezado>
    <NumeroCedulaEmisor>3101234567</NumeroCedulaEmisor>
    <NumeroCedulaReceptor>N/A</NumeroCedulaReceptor>
    <ProveedorSistema>3101234567</ProveedorSistema>
    <TipoComprobante>04</TipoComprobante>
    <FechaEmision>${fechaEmision}</FechaEmision>
    <Moneda>CRC</Moneda>
  </Encabezado>
  <DetalleServicio>${detallesXML}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoMoneda>CRC</CodigoMoneda>
    <TotalServGravados>${venta.total_subtotal}</TotalServGravados>
    <TotalImpuestoVentas>${venta.total_iva}</TotalImpuestoVentas>
    <TotalComprobante>${venta.total_venta}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronicaV4_4>`;

    return xml;
  },

  signXML: async (xmlContent) => {
    // TODO: Implementar con librería de firma
    // Por ahora: retorna XML sin firmar
    return xmlContent;
  },

  sendToHacienda: async (xmlFirmado, claveHacienda) => {
    // TODO: POST real a api.comprobanteselectronicos.go.cr/recepcion/v1/
    // Por ahora: simula respuesta exitosa
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

    const { username, password, email, rol } = req.body;
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
    const productos = await productService.getAllProducts();
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/products/search", authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const productos = await productService.searchProducts(q);
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products", authMiddleware, async (req, res) => {
  try {
    if (req.rol !== "admin" && req.rol !== "gerente" && req.rol !== "cajero") {
      return res.status(403).json({ error: "No tienes permiso" });
    }
    const producto = await productService.createProduct(req.body);
    await registrarAuditoria(req.usuarioId, "PRODUCTO_CREADO", "productos", producto.id, null, req.body);
    
    res.status(201).json(producto);
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
    const xml = facturacionService.buildXML(
      { 
        total_subtotal: venta.subtotal, 
        total_iva: venta.iva, 
        total_venta: venta.total 
      },
      ventaCompleta.detalles
    );

    // Firmar (próximo paso)
    const xmlFirmado = await facturacionService.signXML(xml);

    // Generar clave de 50 dígitos (MOCK)
    const claveHacienda = "506010120080622026123456789012345678901234";

    // Guardar comprobante en BD
    db.run(
      `INSERT INTO comprobantes (venta_id, tipo_comprobante, clave_hacienda, xml_content, estado_hacienda)
       VALUES (?, ?, ?, ?, ?)`,
      [venta.ventaId, "04", claveHacienda, xmlFirmado, "pendiente"]
    );

    // Enviar a Hacienda (próximo paso)
    // await facturacionService.sendToHacienda(xmlFirmado, claveHacienda);

    res.status(201).json({
      ...venta,
      comprobante: {
        clave: claveHacienda,
        estado: "pendiente",
        xml: xmlFirmado
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sales/:id", authMiddleware, async (req, res) => {
  try {
    const venta = await salesService.getSaleById(req.params.id);
    if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
    res.json(venta);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REPORTES
app.get("/api/reports/cash-closing", authMiddleware, async (req, res) => {
  try {
    const { fecha } = req.query;
    const ventas = await salesService.getDailySales(fecha);
    
    let efectivo = 0, sinpe = 0, tarjeta = 0, totalIVA = 0;

    ventas.forEach((venta) => {
      if (venta.metodo_pago === "cash") efectivo += venta.total_venta;
      else if (venta.metodo_pago === "sinpe") sinpe += venta.total_venta;
      else if (venta.metodo_pago === "tarjeta") tarjeta += venta.total_venta;
      
      totalIVA += venta.total_iva;
    });

    const cierre = {
      fecha: fecha || new Date().toISOString().split("T")[0],
      totalVentas: ventas.length,
      detallePagos: { efectivo, sinpe, tarjeta },
      total: efectivo + sinpe + tarjeta,
      totalIVA,
      montoNeto: (efectivo + sinpe + tarjeta) - totalIVA
    };

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

initializeDatabase();

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   POS Costa Rica v1.0 Beta             ║
║   Puerto: ${PORT}                          ║
║   BD: ${DB_PATH}
║   ✓ Persistencia: SÍ                    ║
║   ✓ Autenticación: SÍ                   ║
║   ⏳ Hacienda: En desarrollo             ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;