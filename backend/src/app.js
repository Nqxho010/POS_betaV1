// ==========================================
// BACKEND POS - Servidor Express Principal
// ==========================================
// Archivo: backend/src/app.js

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");

// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "tu-clave-secreta-muy-segura";

// Middleware
app.use(express.json());
app.use(cors());

// Base de datos SQLite
const db = new sqlite3.Database(":memory:"); // En producción: "./database/pos.db"

// ==========================================
// 2. INICIALIZAR SCHEMA DE BD
// ==========================================

function initializeDatabase() {
  db.serialize(() => {
    // Tabla de productos
    db.run(`
      CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY,
        codigo_barras TEXT UNIQUE,
        nombre TEXT NOT NULL,
        codigo_cabys TEXT,
        precio_venta REAL,
        impuesto_venta REAL DEFAULT 13,
        stock_actual INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de ventas
    db.run(`
      CREATE TABLE IF NOT EXISTS ventas (
        id INTEGER PRIMARY KEY,
        numero_venta TEXT UNIQUE,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        cliente_id TEXT,
        total_venta REAL,
        total_iva REAL,
        metodo_pago TEXT,
        estado TEXT DEFAULT 'completada',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de detalle de ventas
    db.run(`
      CREATE TABLE IF NOT EXISTS detalle_ventas (
        id INTEGER PRIMARY KEY,
        venta_id INTEGER,
        producto_id INTEGER,
        cantidad INTEGER,
        precio_unitario REAL,
        subtotal REAL,
        FOREIGN KEY (venta_id) REFERENCES ventas(id),
        FOREIGN KEY (producto_id) REFERENCES productos(id)
      )
    `);

    // Tabla de comprobantes (facturación)
    db.run(`
      CREATE TABLE IF NOT EXISTS comprobantes (
        id INTEGER PRIMARY KEY,
        venta_id INTEGER,
        tipo_comprobante TEXT,
        xml_content TEXT,
        estado_hacienda TEXT DEFAULT 'pendiente',
        clave_hacienda TEXT,
        fecha_envio DATETIME,
        FOREIGN KEY (venta_id) REFERENCES ventas(id)
      )
    `);

    // Tabla de usuarios/cajeros
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        rol TEXT DEFAULT 'cajero',
        activo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✓ Base de datos inicializada");
  });
}

// ==========================================
// 3. SERVICIOS
// ==========================================

// SERVICE: Productos
const productService = {
  getAllProducts: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM productos`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getProductById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM productos WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  searchProducts: (search) => {
    return new Promise((resolve, reject) => {
      const query = `%${search}%`;
      db.all(
        `SELECT * FROM productos WHERE nombre LIKE ? OR codigo_barras LIKE ?`,
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
      const { codigo_barras, nombre, codigo_cabys, precio_venta, stock_actual } = data;
      db.run(
        `INSERT INTO productos (codigo_barras, nombre, codigo_cabys, precio_venta, stock_actual)
         VALUES (?, ?, ?, ?, ?)`,
        [codigo_barras, nombre, codigo_cabys, precio_venta, stock_actual],
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
  createSale: async (saleData) => {
    const { items, medioPago, montoRecibido, clientId } = saleData;

    return new Promise(async (resolve, reject) => {
      try {
        // Calcular totales
        let subtotal = 0, totalIva = 0;

        for (const item of items) {
          const producto = await productService.getProductById(item.productId);
          const itemSubtotal = producto.precio_venta * item.cantidad;
          const itemIva = itemSubtotal * (producto.impuesto_venta / 100);
          subtotal += itemSubtotal;
          totalIva += itemIva;
        }

        const totalVenta = subtotal + totalIva;
        const numeroVenta = `VENTA-${Date.now()}`;

        // Guardar venta
        db.run(
          `INSERT INTO ventas (numero_venta, cliente_id, total_venta, total_iva, metodo_pago)
           VALUES (?, ?, ?, ?, ?)`,
          [numeroVenta, clientId, totalVenta, totalIva, medioPago],
          async function (err) {
            if (err) return reject(err);

            const ventaId = this.lastID;

            // Guardar detalle de venta y actualizar stock
            try {
              for (const item of items) {
                const producto = await productService.getProductById(item.productId);
                const subtotalItem = producto.precio_venta * item.cantidad;

                // Insertar detalle
                db.run(
                  `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal)
                   VALUES (?, ?, ?, ?, ?)`,
                  [ventaId, item.productId, item.cantidad, producto.precio_venta, subtotalItem]
                );

                // Actualizar stock
                await productService.updateStock(item.productId, item.cantidad);
              }

              resolve({
                ventaId,
                numeroVenta,
                total: totalVenta,
                iva: totalIva,
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
        `SELECT * FROM ventas WHERE id = ?`,
        [ventaId],
        (err, venta) => {
          if (err) reject(err);
          else {
            // Obtener detalles
            db.all(
              `SELECT dv.*, p.nombre FROM detalle_ventas dv
               JOIN productos p ON dv.producto_id = p.id
               WHERE dv.venta_id = ?`,
              [ventaId],
              (err, detalles) => {
                if (err) reject(err);
                else resolve({ ...venta, detalles });
              }
            );
          }
        }
      );
    });
  },

  getDailySales: () => {
    return new Promise((resolve, reject) => {
      const hoy = new Date().toISOString().split("T")[0];
      db.all(
        `SELECT * FROM ventas WHERE DATE(fecha) = ?`,
        [hoy],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }
};

// SERVICE: Facturación (integración Hacienda)
const facturacionService = {
  buildXML: (saleData) => {
    // Este es un esqueleto simplificado
    // En producción, seguirías el XSD v4.4 exactamente
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FacturaElectronicaV4_4>
  <Encabezado>
    <NumeroCedulaEmisor>3101234567</NumeroCedulaEmisor>
    <NumeroCedulaReceptor>N/A</NumeroCedulaReceptor>
    <ProveedorSistema>3101234567</ProveedorSistemas>
    <FechaEmision>${new Date().toISOString()}</FechaEmision>
    <MonedaResumen>CRC</MonedaResumen>
  </Encabezado>
  <DetalleServicios>
    <LineaDetalle>
      <NumeroLineaDetalle>1</NumeroLineaDetalle>
      <CodigoActividad>6201</CodigoActividad>
      <CodigoProducto>001</CodigoProducto>
      <DescripcionProducto>Producto Genérico</DescripcionProducto>
      <Cantidad>${saleData.cantidad || 1}</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <PrecioUnitario>${saleData.total || 0}</PrecioUnitario>
      <Descuento>
        <MontoDescuento>0</MontoDescuento>
      </Descuento>
      <SubTotal>${saleData.total || 0}</SubTotal>
      <ImpuestoVentas>
        <Tarifa>13</Tarifa>
        <Monto>${(saleData.total * 0.13) || 0}</Monto>
      </ImpuestoVentas>
    </LineaDetalle>
  </DetalleServicios>
  <ResumenFactura>
    <CodigoTipoMoneda>
      <Codigo>CRC</Codigo>
    </CodigoTipoMoneda>
    <TotalServGravados>${saleData.total || 0}</TotalServGravados>
    <TotalImpuestoVentas>${(saleData.total * 0.13) || 0}</TotalImpuestoVentas>
    <TotalComprobante>${(saleData.total * 1.13) || 0}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronicaV4_4>`;

    return xml;
  },

  signXML: async (xmlContent) => {
    // TODO: Implementar firma digital XAdES-EPES
    // Por ahora, retornamos el XML "firmado" (en producción integrar xmlsec)
    return xmlContent + "\n<!-- Firmado digitalmente -->";
  },

  sendToHacienda: async (xmlFirmado) => {
    // TODO: Implementar POST a api.comprobanteselectronicos.go.cr/recepcion/v1
    // Por ahora, simulamos la respuesta
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          status: "aceptado",
          clave: "506010120080612025123456789012345678901234",
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
      fecha: new Date().toISOString().split("T")[0],
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
// 4. RUTAS API
// ==========================================

// Middleware de autenticación (simplificado)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No autorizado" });
  
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
};

// Auth: Login
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  // TODO: Validar contra BD de usuarios
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, mensaje: "Bienvenido" });
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
    const productos = await productService.searchProducts(q);
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/products", authMiddleware, async (req, res) => {
  try {
    const producto = await productService.createProduct(req.body);
    res.status(201).json(producto);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VENTAS
app.post("/api/sales", authMiddleware, async (req, res) => {
  try {
    const venta = await salesService.createSale(req.body);

    // Generar comprobante
    const xml = facturacionService.buildXML(venta);
    const xmlFirmado = await facturacionService.signXML(xml);

    // Enviar a Hacienda (o encolar)
    let respuestaHacienda = { status: "pendiente" };
    try {
      respuestaHacienda = await facturacionService.sendToHacienda(xmlFirmado);
    } catch {
      // Sin conexión: guardar en cola
      respuestaHacienda = { status: "offline", mensaje: "Se sincronizará después" };
    }

    // Guardar comprobante en BD
    db.run(
      `INSERT INTO comprobantes (venta_id, tipo_comprobante, xml_content, estado_hacienda, clave_hacienda)
       VALUES (?, ?, ?, ?, ?)`,
      [
        venta.ventaId,
        "tiquete",
        xmlFirmado,
        respuestaHacienda.status,
        respuestaHacienda.clave || ""
      ]
    );

    res.status(201).json({
      ...venta,
      comprobante: {
        xml: xmlFirmado,
        estado: respuestaHacienda.status,
        clave: respuestaHacienda.clave
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sales/:id", authMiddleware, async (req, res) => {
  try {
    const venta = await salesService.getSaleById(req.params.id);
    res.json(venta);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REPORTES
app.get("/api/reports/cash-closing", authMiddleware, async (req, res) => {
  try {
    const cierre = await reportService.getCashClosing();
    res.json(cierre);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

// ==========================================
// 5. INICIAR SERVIDOR
// ==========================================

initializeDatabase();

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   POS Costa Rica - Backend Iniciado   ║
║   Puerto: ${PORT}                          ║
║   http://localhost:${PORT}                 ║
╚════════════════════════════════════════╝
  `);
  console.log("Endpoints disponibles:");
  console.log("  POST   /api/auth/login");
  console.log("  GET    /api/products");
  console.log("  GET    /api/products/search?q=");
  console.log("  POST   /api/sales");
  console.log("  GET    /api/sales/:id");
  console.log("  GET    /api/reports/cash-closing");
});

module.exports = app;
