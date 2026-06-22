# POS (Punto de Venta) - Esqueleto Arquitectónico para Costa Rica

## 📋 ¿QUÉ HACE ESTE POS?

Este es un sistema de punto de venta modular diseñado para:

1. **Gestionar productos** — registrar catálogo con códigos CAByS
2. **Procesar ventas** — carrito de compras, descuentos, medios de pago
3. **Generar comprobantes fiscales** — integración con Hacienda (factura/tiquete v4.4)
4. **Gestionar inventario** — stock en tiempo real
5. **Emitir reportes** — cierre de caja, ventas del día, flujo de efectivo
6. **Modo offline** — funciona sin internet; sincroniza cuando se reconecta

---

## 🏗️ ARQUITECTURA (Capas)

```
┌─────────────────────────────────────────────────────────┐
│           FRONTEND (React/TypeScript)                    │
│  ┌─────────────┬──────────┬──────────┬──────────────┐   │
│  │   Pantalla  │ Carrito  │  Pago    │   Reportes   │   │
│  │  de Venta   │          │          │              │   │
│  └─────────────┴──────────┴──────────┴──────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓ (HTTP REST API)
┌─────────────────────────────────────────────────────────┐
│        BACKEND (Node.js/Express)                         │
│  ┌──────────┬──────────┬──────────┬──────────────────┐  │
│  │ Ventas   │ Productos│ Pagos    │ Integración      │  │
│  │ Service  │ Service  │ Service  │ Hacienda Service │  │
│  └──────────┴──────────┴──────────┴──────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Middleware: Auth, Validación, Logging            │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│        BASE DE DATOS (SQLite - local)                    │
│  ┌──────────┬──────────┬──────────┬──────────────────┐  │
│  │ Productos│  Ventas  │  Clientes│  Comprobantes    │  │
│  └──────────┴──────────┴──────────┴──────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         ↓ (solo con internet)
┌─────────────────────────────────────────────────────────┐
│   HACIENDA (DGT) - Validación de Comprobantes            │
│   API: api.comprobanteselectronicos.go.cr/recepcion/v1  │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 ESTRUCTURA DE CARPETAS

```
pos-costarica/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js          ← Conexión SQLite
│   │   ├── services/
│   │   │   ├── salesService.js      ← Lógica de ventas
│   │   │   ├── productService.js    ← Gestión productos
│   │   │   ├── paymentService.js    ← Procesamiento pagos
│   │   │   └── facturacionService.js← Integración Hacienda
│   │   ├── routes/
│   │   │   ├── sales.js             ← Endpoints de ventas
│   │   │   ├── products.js          ← Endpoints de productos
│   │   │   └── reports.js           ← Endpoints de reportes
│   │   ├── middleware/
│   │   │   └── auth.js              ← Validación token
│   │   └── app.js                   ← Aplicación principal
│   ├── package.json
│   └── .env                         ← Variables de entorno
│
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── POSScreen.jsx        ← Pantalla principal de venta
│   │   │   ├── Cart.jsx             ← Carrito de compras
│   │   │   ├── Payment.jsx          ← Formulario de pago
│   │   │   └── Reports.jsx          ← Reportes
│   │   ├── services/
│   │   │   └── api.js               ← Cliente HTTP
│   │   └── App.jsx
│   └── package.json
│
└── database/
    └── schema.sql                   ← Estructura BD
```

---

## 🔄 FLUJO TÍPICO DE UNA VENTA

### 1. Cajero abre el POS
```
POS inicia → BD local cargada → Sincronización con Hacienda (si hay conexión)
```

### 2. Cajero busca y agrega productos al carrito
```
Buscar producto → Backend consulta BD → Carrito se actualiza en memoria
```

### 3. Se aplican descuentos (opcional)
```
Usuario ingresa código de descuento → Servicio valida → Recalcula total
```

### 4. Cliente paga
```
Cajero selecciona medio de pago (Efectivo, SINPE Móvil, Tarjeta) 
→ Se genera número de transacción 
→ Venta se registra en BD
```

### 5. Se genera comprobante fiscal
```
Sistema construye XML conforme v4.4 
→ Si hay internet: firma y envía a Hacienda (espera respuesta)
→ Si no hay internet: guarda en cola local de sincronización
→ Genera PDF del tiquete para imprimir
→ Emisor recibe comprobante firmado de Hacienda
```

### 6. Cierre de caja
```
Cajero ejecuta cierre → Sistema genera reporte 
→ Suma ventas del día, flujo efectivo 
→ Almacena en BD
```

---

## 🔧 COMPONENTES CLAVE EXPLICADOS

### **1. Frontend (React)**

**POSScreen.jsx** — La interfaz que ve el cajero:
- Búsqueda de productos (código de barras o nombre)
- Tabla con artículos agregados (cantidad, precio, subtotal)
- Campo de descuentos
- Selector de medio de pago
- Botón "Cobrar" que envía la venta al backend

**Cart.jsx** — Lógica del carrito:
- Suma/resta cantidad de items
- Calcula subtotal, IVA (13% por defecto), total
- Permite aplicar descuentos globales o por línea

**Payment.jsx** — Formulario de pago:
- Efectivo: permite ingresar monto recibido, calcula vuelto
- SINPE Móvil: campo para número de teléfono/referencia
- Tarjeta: captura últimos 4 dígitos

---

### **2. Backend (Node.js/Express)**

**salesService.js** — Orquesta la venta completa:
```javascript
// Flujo pseudocódigo
async function createSale(cartData, paymentData) {
  // 1. Validar datos
  validateSale(cartData);
  
  // 2. Actualizar inventario
  updateInventory(cartData);
  
  // 3. Guardar venta en BD
  const saleId = saveSaleToDatabase(cartData, paymentData);
  
  // 4. Generar comprobante fiscal
  const comprobante = await generateFiscalVoucher(saleId, cartData);
  
  // 5. Enviar a Hacienda (o encolar si no hay internet)
  const response = await sendToHacienda(comprobante);
  
  return response;
}
```

**facturacionService.js** — Integración Hacienda:
```javascript
// Genera XML v4.4 conforme a DGT
function buildXML(saleData) {
  return {
    Encabezado: {
      NumeroCedulaEmisor: "3101234567",        // Cédula del negocio
      NumeroCedulaReceptor: cartData.clientId,  // Cédula cliente
      ProveedorSistema: "3101234567",          // Cédula del desarrollador (TÚ)
      FechaEmision: new Date().toISOString(),
      Monto: cartData.total,
      MonedalResumen: "CRC"
    },
    DetalleServicios: [
      {
        LineaDetalle: 1,
        CodigoActividad: "6201",                 // Código CAByS del producto
        DescripcionProducto: "Producto X",
        Cantidad: 2,
        PrecioUnitario: 1000,
        Descuento: 0,
        SubTotal: 2000,
        ImpuestoVentas: { Tarifa: 13, Monto: 260 }
      }
    ]
  };
}
```

**paymentService.js** — Registra el pago:
```javascript
async function processPayment(paymentData) {
  // Efectivo
  if (paymentData.method === "cash") {
    return {
      transactionId: generateId(),
      method: "cash",
      amountReceived: paymentData.amountReceived,
      change: paymentData.amountReceived - total
    };
  }
  
  // SINPE Móvil
  if (paymentData.method === "sinpe") {
    // Validar con banco (o solo registrar)
    return {
      transactionId: generateId(),
      method: "sinpe",
      reference: paymentData.reference,
      status: "pending" // Se confirma después
    };
  }
}
```

---

### **3. Base de Datos (SQLite)**

**Tablas principales:**

```sql
-- Productos del negocio
CREATE TABLE productos (
  id INTEGER PRIMARY KEY,
  codigo_barras TEXT UNIQUE,
  nombre TEXT NOT NULL,
  codigo_cabys TEXT,        -- Para Hacienda
  precio_venta REAL,
  impuesto_venta INTEGER,   -- Porcentaje (13%)
  stock_actual INTEGER,
  created_at TIMESTAMP
);

-- Registro de ventas
CREATE TABLE ventas (
  id INTEGER PRIMARY KEY,
  numero_venta TEXT UNIQUE,
  fecha TIMESTAMP,
  cliente_id TEXT,
  total_venta REAL,
  total_iva REAL,
  metodo_pago TEXT,         -- 'cash', 'sinpe', 'tarjeta'
  estado TEXT,              -- 'pendiente', 'completada', 'sync'
  created_at TIMESTAMP
);

-- Líneas de detalle por venta
CREATE TABLE detalle_ventas (
  id INTEGER PRIMARY KEY,
  venta_id INTEGER,
  producto_id INTEGER,
  cantidad INTEGER,
  precio_unitario REAL,
  subtotal REAL,
  FOREIGN KEY (venta_id) REFERENCES ventas(id)
);

-- Comprobantes enviados a Hacienda
CREATE TABLE comprobantes (
  id INTEGER PRIMARY KEY,
  venta_id INTEGER,
  tipo_comprobante TEXT,     -- 'tiquete', 'factura', 'rep'
  xml_content TEXT,
  estado_hacienda TEXT,      -- 'aceptado', 'rechazado', 'pendiente'
  clave_hacienda TEXT,       -- Clave de 50 dígitos asignada por DGT
  mensaje_hacienda TEXT,
  fecha_envio TIMESTAMP,
  FOREIGN KEY (venta_id) REFERENCES ventas(id)
);

-- Cola de sincronización (ventas sin conexión)
CREATE TABLE cola_sincronizacion (
  id INTEGER PRIMARY KEY,
  comprobante_id INTEGER,
  xml_firmado TEXT,
  intento_num INTEGER DEFAULT 0,
  proxima_sincronizacion TIMESTAMP,
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id)
);
```

---

## 🌐 ENDPOINTS API (Backend)

### Ventas
```
POST /api/sales
  → Crear venta (recibe carrito + pago, retorna ID venta + comprobante)

GET /api/sales/:id
  → Obtener detalle de venta

GET /api/sales/day
  → Ventas del día (para cierre de caja)
```

### Productos
```
GET /api/products
  → Listar todos productos (con stock actual)

GET /api/products/search?q=arroz
  → Buscar producto por nombre/código

POST /api/products
  → Agregar nuevo producto
```

### Reportes
```
GET /api/reports/cash-closing
  → Cierre de caja (suma de efectivo, IVA, ventas)

GET /api/reports/daily-sales
  → Resumen del día

GET /api/reports/inventory
  → Estado de inventario
```

---

## 🔐 Seguridad

- **Base datos local (SQLite)**: ningún dato sube a la nube automaticamente
- **Autenticación**: token JWT simple para cajeros (usuario/contraseña)
- **Firma de comprobantes**: llave criptográfica guardada de forma segura (hashada, nunca en texto plano)
- **Validación de entrada**: todos los campos validados antes de guardar
- **Modo offline seguro**: comprobantes almacenados localmente, enviados cuando hay conexión

---

## 📱 Ejemplo: Una venta paso a paso

**Escenario**: Cajero vende 2 unidades de "Arroz Premium" a ₡5,000 c/u

### Cliente (Frontend)
```javascript
// 1. Usuario busca "arroz"
const products = await api.searchProducts("arroz");
// → [{ id: 1, nombre: "Arroz Premium", precio: 5000, stock: 50 }]

// 2. Agrega 2 unidades al carrito (en memoria, no en BD todavía)
addToCart({ productId: 1, cantidad: 2 });
// carrito = [{ ...producto, cantidad: 2, subtotal: 10000 }]

// 3. Usuario presiona "Cobrar", selecciona "Efectivo"
const response = await api.createSale({
  items: [{ productId: 1, cantidad: 2 }],
  descuentos: 0,
  medioPago: "cash",
  montoRecibido: 15000
});
// → {
//     saleId: "VENTA-2025-001",
//     comprobante: { xml, pdf_url },
//     vuelto: 5000,
//     status: "completada"
//   }

// 4. Se imprime el tiquete (PDF)
window.open(response.comprobante.pdf_url);
```

### Servidor (Backend)
```javascript
// 1. POST /api/sales llega con los datos
app.post("/api/sales", async (req, res) => {
  const { items, descuentos, medioPago, montoRecibido } = req.body;

  // 2. Validar
  if (!items || items.length === 0) return res.status(400).json({ error: "Carrito vacío" });

  // 3. Calcular totales
  let subtotal = 0, iva = 0;
  for (const item of items) {
    const producto = await productService.getProductById(item.productId);
    subtotal += producto.precio * item.cantidad;
  }
  iva = subtotal * 0.13;
  const total = subtotal + iva;

  // 4. Registrar venta en BD
  const venta = await salesService.createSale({
    items, medioPago, total, iva, subtotal
  });

  // 5. Generar comprobante fiscal v4.4
  const xmlComprobante = await facturacionService.buildXML(venta);

  // 6. Firmar comprobante (con llave criptográfica)
  const xmlFirmado = await facturacionService.signXML(xmlComprobante);

  // 7. Enviar a Hacienda (si hay conexión)
  try {
    const respuestaHacienda = await facturacionService.sendToHacienda(xmlFirmado);
    venta.estado = "aceptado";
    venta.claveHacienda = respuestaHacienda.clave;
  } catch (error) {
    // Sin conexión: guardar en cola de sincronización
    venta.estado = "pendiente_sync";
    await syncQueueService.enqueue(xmlFirmado);
  }

  // 8. Generar PDF para imprimir
  const pdf = await reportService.generateTicketPDF(venta);

  // 9. Retornar al cliente
  res.json({
    saleId: venta.id,
    comprobante: { xml: xmlFirmado, pdf_url: pdf },
    vuelto: montoRecibido - total,
    status: venta.estado
  });
});
```

### Base de datos (SQLite)
```
-- Se inserta en tabla 'ventas'
INSERT INTO ventas VALUES (
  1,
  'VENTA-2025-001',
  '2025-06-21 10:30:00',
  NULL,          -- sin cliente específico
  11300,         -- total (10000 + 1300 IVA)
  1300,
  'cash',
  'aceptado',
  '2025-06-21 10:30:00'
);

-- Se inserta en tabla 'detalle_ventas'
INSERT INTO detalle_ventas VALUES (
  1,
  1,             -- venta_id
  1,             -- producto_id (Arroz)
  2,
  5000,
  10000
);

-- Se inserta en tabla 'comprobantes'
INSERT INTO comprobantes VALUES (
  1,
  1,             -- venta_id
  'tiquete',
  '<xml>...</xml>',
  'aceptado',
  '506010120080612025123456789012345678901234',  -- Clave v4.4
  'Comprobante aceptado',
  '2025-06-21 10:30:05'
);
```

---

## 🚀 Siguiente paso

Una vez tengas este esqueleto funcionando:

1. **Integración real con Hacienda** — firma digital con certificado, envío real a `api.comprobanteselectronicos.go.cr`
2. **Multi-usuario** — autenticación de cajeros, permisos, auditoría de quién hizo cada venta
3. **Integraciones externas** — balanza electrónica, lector de código de barras, impresora térmica
4. **Sincronización en la nube** — backup de ventas, acceso remoto (opcionalmente)
5. **Sistema de reportes avanzados** — gráficos, análisis de tendencias, integración contable

---

## 📞 Notas importantes

- **Cédula del desarrollador (TÚ)**: debe incluirse en CADA comprobante generado (nodo ProveedorSistema)
- **CAByS**: cada producto debe tener su código de clasificación oficial (6 dígitos)
- **CIIU 4**: desde octubre 2025 es obligatorio incluir el código de actividad económica del cliente
- **Modo offline**: crítico para locales sin conexión estable a internet
- **Auditoría**: mantén registro de TODAS las operaciones (quién, cuándo, qué)

