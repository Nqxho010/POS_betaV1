// ==========================================
// FRONTEND POS - Aplicación React Principal
// ==========================================
// Archivo: frontend/src/App.jsx

import React, { useState, useRef, useEffect } from "react";
import "./App.css";

// ==========================================
// SERVICIO API (Cliente HTTP)
// ==========================================

const API_BASE = "http://localhost:5000/api";


const apiService = {
  setToken: (token) => {
    localStorage.setItem("token", token);
  },

  getToken: () => localStorage.getItem("token"),

  // Se llama cuando el backend responde 401 (token vencido o inválido)
  onUnauthorized: null,

  // Petición autenticada: lanza un Error si el backend responde con error
  request: async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${apiService.getToken()}`
      }
    });
    const data = await response.json().catch(() => null);

    if (response.status === 401 && apiService.onUnauthorized) {
      apiService.onUnauthorized();
    }
    if (!response.ok) {
      throw new Error(data?.error || `Error ${response.status}`);
    }
    return data;
  },

  searchProducts: (query) =>
    apiService.request(`/products/search?q=${encodeURIComponent(query)}`),

  getAllProducts: () => apiService.request("/products"),

  createSale: (saleData) =>
    apiService.request("/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saleData)
    }),

  getSales: (fecha) =>
    apiService.request(`/sales?fecha=${encodeURIComponent(fecha)}`),

  getCashClosing: (fecha) =>
    apiService.request(`/reports/cash-closing?fecha=${encodeURIComponent(fecha)}`),

  login: async (username, password) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (data.token) {
      apiService.setToken(data.token);
    }
    return data;
  }
};

// ==========================================
// COMPONENTE: Pantalla de Login
// ==========================================

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("cajero");
  const [password, setPassword] = useState("1234");

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const result = await apiService.login(username, password);
      if (result.token) {
        onLogin();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      alert("Error de conexión: " + error.message);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>🛍️ POS Costa Rica</h1>
        <p>Sistema de Punto de Venta con Facturación Electrónica</p>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Iniciar Sesión</button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTE: Carrito de Compras
// ==========================================

function Cart({ items, onRemoveItem, onQuantityChange }) {
  // Calcular totales
  const subtotal = items.reduce((sum, item) => sum + (item.precio_venta * item.cantidad), 0);
  const iva = subtotal * 0.13;
  const total = subtotal + iva;

  return (
    <div className="cart">
      <h2>🛒 Carrito</h2>
      
      {items.length === 0 ? (
        <p className="empty-cart">Sin productos añadidos</p>
      ) : (
        <>
          <div className="cart-items">
            {items.map((item) => (
              <div key={item.id} className="cart-item">
                <div className="item-info">
                  <p className="item-name">{item.nombre}</p>
                  <p className="item-code">Código: {item.codigo_barras}</p>
                </div>
                
                <div className="item-quantity">
                  <button onClick={() => onQuantityChange(item.id, item.cantidad - 1)}>
                    −
                  </button>
                  <input
                    type="number"
                    value={item.cantidad}
                    onChange={(e) =>
                      onQuantityChange(item.id, parseInt(e.target.value, 10) || 1)
                    }
                    min="1"
                  />
                  <button onClick={() => onQuantityChange(item.id, item.cantidad + 1)}>
                    +
                  </button>
                </div>

                <div className="item-price">
                  <p>₡{(item.precio_venta * item.cantidad).toLocaleString()}</p>
                </div>

                <button
                  className="btn-remove"
                  onClick={() => onRemoveItem(item.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="cart-summary">
            <div className="summary-row">
              <span>Subtotal:</span>
              <span>₡{subtotal.toLocaleString()}</span>
            </div>
            <div className="summary-row">
              <span>IVA (13%):</span>
              <span>₡{iva.toLocaleString()}</span>
            </div>
            <div className="summary-row total">
              <span>TOTAL:</span>
              <span>₡{total.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==========================================
// COMPONENTE: Búsqueda de Productos
// ==========================================

function ProductSearch({ onAddToCart }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const latestQuery = useRef("");

  const handleSearch = async (query) => {
    setSearch(query);
    latestQuery.current = query;
    setSearchError("");
    if (query.length > 0) {
      try {
        const productos = await apiService.searchProducts(query);
        // Ignorar respuestas de búsquedas anteriores que llegan tarde
        if (latestQuery.current !== query) return;
        setResults(Array.isArray(productos) ? productos : []);
      } catch (error) {
        if (latestQuery.current !== query) return;
        console.error("Error buscando:", error);
        setResults([]);
        setSearchError("No se pudo buscar productos: " + error.message);
      }
    } else {
      setResults([]);
    }
  };

  return (
    <div className="product-search">
      <h2>🔍 Buscar Productos</h2>
      
      <input
        type="text"
        placeholder="Código de barras o nombre..."
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        autoFocus
        className="search-input"
      />

      {results.length > 0 && (
        <div className="search-results">
          {results.map((product) => (
            <div key={product.id} className="product-result">
              <div>
                <p className="product-name">{product.nombre}</p>
                <p className="product-code">{product.codigo_barras}</p>
              </div>
              <div className="product-price">
                <p>₡{product.precio_venta.toLocaleString()}</p>
                <p className="stock">Stock: {product.stock_actual}</p>
              </div>
              <button
                className="btn-add"
                onClick={() => {
                  onAddToCart(product);
                  setSearch("");
                  setResults([]);
                }}
              >
                AÑADIR
              </button>
            </div>
          ))}
        </div>
      )}

      {searchError && <p className="no-results">{searchError}</p>}

      {search && !searchError && results.length === 0 && (
        <p className="no-results">No se encontraron productos</p>
      )}
    </div>
  );
}

// ==========================================
// COMPONENTE: Formulario de Pago
// ==========================================

function PaymentForm({ cartTotal, onPaymentComplete, isProcessing }) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [sinpeRef, setSinpeRef] = useState("");
  const [cardLast4, setCardLast4] = useState("");

  const change = paymentMethod === "cash" ? (amountReceived || 0) - cartTotal : 0;

  const handlePay = async () => {
    if (paymentMethod === "cash" && (!amountReceived || amountReceived < cartTotal)) {
      alert("Monto recibido insuficiente");
      return;
    }

    const ok = await onPaymentComplete({
      method: paymentMethod,
      amountReceived: paymentMethod === "cash" ? amountReceived : cartTotal,
      reference: paymentMethod === "sinpe" ? sinpeRef : paymentMethod === "tarjeta" ? cardLast4 : ""
    });

    // Limpiar solo si la venta se registró (si falló, el cajero puede reintentar)
    if (ok) {
      setAmountReceived("");
      setSinpeRef("");
      setCardLast4("");
    }
  };

  return (
    <div className="payment-form">
      <h2>💰 Métodos de Pago</h2>

      <div className="payment-methods">
        <label>
          <input
            type="radio"
            value="cash"
            checked={paymentMethod === "cash"}
            onChange={(e) => setPaymentMethod(e.target.value)}
          />
          Efectivo
        </label>
        <label>
          <input
            type="radio"
            value="sinpe"
            checked={paymentMethod === "sinpe"}
            onChange={(e) => setPaymentMethod(e.target.value)}
          />
          SINPE Móvil
        </label>
        <label>
          <input
            type="radio"
            value="tarjeta"
            checked={paymentMethod === "tarjeta"}
            onChange={(e) => setPaymentMethod(e.target.value)}
          />
          Tarjeta
        </label>
      </div>

      {paymentMethod === "cash" && (
        <div className="payment-input">
          <label>Monto recibido (₡)</label>
          <input
            type="number"
            value={amountReceived}
            onChange={(e) => setAmountReceived(parseFloat(e.target.value) || 0)}
            placeholder="0"
          />
          <div className="change-display">
            Vuelto: <strong>₡{change.toLocaleString()}</strong>
          </div>
        </div>
      )}

      {paymentMethod === "sinpe" && (
        <div className="payment-input">
          <label>Referencia SINPE</label>
          <input
            type="text"
            value={sinpeRef}
            onChange={(e) => setSinpeRef(e.target.value)}
            placeholder="Ej: 12345678"
          />
        </div>
      )}

      {paymentMethod === "tarjeta" && (
        <div className="payment-input">
          <label>Últimos 4 dígitos</label>
          <input
            type="text"
            value={cardLast4}
            onChange={(e) => setCardLast4(e.target.value.slice(0, 4))}
            placeholder="0000"
            maxLength="4"
          />
        </div>
      )}

      <button
        className="btn-pay"
        onClick={handlePay}
        disabled={isProcessing}
      >
        {isProcessing ? "⏳ Procesando..." : "COBRAR"}
      </button>
    </div>
  );
}

// ==========================================
// UTILIDADES: Reportes
// ==========================================

const METODOS_PAGO = { cash: "Efectivo", sinpe: "SINPE Móvil", tarjeta: "Tarjeta" };

const formatoColones = (monto) =>
  "₡" + (Number(monto) || 0).toLocaleString("es-CR", { maximumFractionDigits: 2 });

// Fecha de hoy (YYYY-MM-DD) en hora local
const fechaHoy = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
};

// Carga datos que dependen de una fecha; recargar() vuelve a pedirlos
function useDatosPorFecha(cargar, fecha) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    cargar(fecha)
      .then((resultado) => vigente && setDatos(resultado))
      .catch((err) => {
        if (!vigente) return;
        setDatos(null);
        setError(err.message);
      })
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [cargar, fecha, version]);

  return { datos, error, cargando, recargar: () => setVersion((v) => v + 1) };
}

function FiltroFecha({ fecha, onChange, onRecargar, cargando }) {
  return (
    <div className="report-toolbar">
      <label>
        Fecha
        <input
          type="date"
          value={fecha}
          max={fechaHoy()}
          onChange={(e) => onChange(e.target.value || fechaHoy())}
        />
      </label>
      <button className="btn-refresh" onClick={onRecargar} disabled={cargando}>
        {cargando ? "Cargando..." : "Actualizar"}
      </button>
    </div>
  );
}

// ==========================================
// COMPONENTE: Reportes (ventas del día)
// ==========================================

function ReportsScreen() {
  const [fecha, setFecha] = useState(fechaHoy);
  const { datos, error, cargando, recargar } = useDatosPorFecha(apiService.getSales, fecha);
  const ventas = Array.isArray(datos) ? datos : [];

  const totales = ventas.reduce(
    (acc, venta) => ({
      subtotal: acc.subtotal + venta.total_subtotal,
      iva: acc.iva + venta.total_iva,
      total: acc.total + venta.total_venta
    }),
    { subtotal: 0, iva: 0, total: 0 }
  );

  return (
    <div className="report-page">
      <div className="report-card">
        <div className="report-header">
          <h2>📊 Reporte de ventas</h2>
          <FiltroFecha fecha={fecha} onChange={setFecha} onRecargar={recargar} cargando={cargando} />
        </div>

        {error && <p className="report-error">No se pudo cargar el reporte: {error}</p>}

        {!error && (
          <div className="stat-grid">
            <div className="stat">
              <span>Ventas</span>
              <strong>{ventas.length}</strong>
            </div>
            <div className="stat">
              <span>Subtotal</span>
              <strong>{formatoColones(totales.subtotal)}</strong>
            </div>
            <div className="stat">
              <span>IVA</span>
              <strong>{formatoColones(totales.iva)}</strong>
            </div>
            <div className="stat highlight">
              <span>Total vendido</span>
              <strong>{formatoColones(totales.total)}</strong>
            </div>
          </div>
        )}

        {!error && !cargando && ventas.length === 0 && (
          <p className="report-empty">No hay ventas registradas en esta fecha</p>
        )}

        {ventas.length > 0 && (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Venta #</th>
                  <th>Cajero</th>
                  <th>Método</th>
                  <th className="num">Artículos</th>
                  <th className="num">Subtotal</th>
                  <th className="num">IVA</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((venta) => (
                  <tr key={venta.id}>
                    <td>{(venta.fecha_local || "").slice(11, 16)}</td>
                    <td>{venta.numero_venta}</td>
                    <td>{venta.username || "—"}</td>
                    <td>{METODOS_PAGO[venta.metodo_pago] || venta.metodo_pago}</td>
                    <td className="num">{venta.total_articulos}</td>
                    <td className="num">{formatoColones(venta.total_subtotal)}</td>
                    <td className="num">{formatoColones(venta.total_iva)}</td>
                    <td className="num">{formatoColones(venta.total_venta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTE: Cierre de caja
// ==========================================

function CashClosingScreen() {
  const [fecha, setFecha] = useState(fechaHoy);
  const { datos: cierre, error, cargando, recargar } = useDatosPorFecha(apiService.getCashClosing, fecha);

  return (
    <div className="report-page">
      <div className="report-card narrow">
        <div className="report-header">
          <h2>🧾 Cierre de caja</h2>
          <FiltroFecha fecha={fecha} onChange={setFecha} onRecargar={recargar} cargando={cargando} />
        </div>

        {error && <p className="report-error">No se pudo cargar el cierre: {error}</p>}

        {cierre && !error && (
          <>
            <div className="summary-row">
              <span>Fecha:</span>
              <span>{cierre.fecha}</span>
            </div>
            <div className="summary-row">
              <span>Cantidad de ventas:</span>
              <span>{cierre.totalVentas}</span>
            </div>

            <h3 className="closing-section">Por método de pago</h3>
            <div className="summary-row">
              <span>Efectivo:</span>
              <span>{formatoColones(cierre.detallePagos.efectivo)}</span>
            </div>
            <div className="summary-row">
              <span>SINPE Móvil:</span>
              <span>{formatoColones(cierre.detallePagos.sinpe)}</span>
            </div>
            <div className="summary-row">
              <span>Tarjeta:</span>
              <span>{formatoColones(cierre.detallePagos.tarjeta)}</span>
            </div>

            <h3 className="closing-section">Totales</h3>
            <div className="summary-row">
              <span>Monto neto (sin IVA):</span>
              <span>{formatoColones(cierre.montoNeto)}</span>
            </div>
            <div className="summary-row">
              <span>IVA:</span>
              <span>{formatoColones(cierre.totalIVA)}</span>
            </div>
            <div className="summary-row total closing-total">
              <span>TOTAL DEL DÍA:</span>
              <span>{formatoColones(cierre.total)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTE: Productos e inventario
// ==========================================

function ProductsScreen() {
  const [filtro, setFiltro] = useState("");
  const { datos, error, cargando, recargar } = useDatosPorFecha(apiService.getAllProducts, null);

  // precio_venta se guarda sin IVA; el IVA se suma al vender
  const productos = (Array.isArray(datos) ? datos : []).map((producto) => {
    const precioConIva = producto.precio_venta * (1 + producto.impuesto_venta / 100);
    return {
      ...producto,
      precioConIva,
      valorSinIva: producto.precio_venta * producto.stock_actual,
      valorConIva: precioConIva * producto.stock_actual
    };
  });

  const texto = filtro.trim().toLowerCase();
  const visibles = productos.filter(
    (producto) =>
      !texto ||
      producto.nombre.toLowerCase().includes(texto) ||
      (producto.codigo_barras || "").toLowerCase().includes(texto)
  );

  const totales = visibles.reduce(
    (acc, producto) => ({
      unidades: acc.unidades + producto.stock_actual,
      sinIva: acc.sinIva + producto.valorSinIva,
      conIva: acc.conIva + producto.valorConIva
    }),
    { unidades: 0, sinIva: 0, conIva: 0 }
  );

  return (
    <div className="report-page">
      <div className="report-card">
        <div className="report-header">
          <h2>📦 Productos e inventario</h2>
          <div className="report-toolbar">
            <input
              type="text"
              placeholder="Filtrar por nombre o código..."
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <button className="btn-refresh" onClick={recargar} disabled={cargando}>
              {cargando ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </div>

        {error && <p className="report-error">No se pudieron cargar los productos: {error}</p>}

        {!error && (
          <div className="stat-grid">
            <div className="stat">
              <span>Productos</span>
              <strong>{visibles.length}</strong>
            </div>
            <div className="stat">
              <span>Unidades en inventario</span>
              <strong>{totales.unidades.toLocaleString("es-CR")}</strong>
            </div>
            <div className="stat">
              <span>Valor total sin IVA</span>
              <strong>{formatoColones(totales.sinIva)}</strong>
            </div>
            <div className="stat highlight">
              <span>Valor total con IVA</span>
              <strong>{formatoColones(totales.conIva)}</strong>
            </div>
          </div>
        )}

        {!error && !cargando && visibles.length === 0 && (
          <p className="report-empty">
            {productos.length === 0 ? "No hay productos registrados" : "Ningún producto coincide con el filtro"}
          </p>
        )}

        {visibles.length > 0 && (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th className="num">Stock</th>
                  <th className="num">Precio sin IVA</th>
                  <th className="num">IVA</th>
                  <th className="num">Precio con IVA</th>
                  <th className="num">Total sin IVA</th>
                  <th className="num">Total con IVA</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((producto) => (
                  <tr key={producto.id}>
                    <td>{producto.codigo_barras || "—"}</td>
                    <td>{producto.nombre}</td>
                    <td className={producto.stock_actual <= producto.stock_minimo ? "num stock-low" : "num"}>
                      {producto.stock_actual}
                    </td>
                    <td className="num">{formatoColones(producto.precio_venta)}</td>
                    <td className="num">{producto.impuesto_venta}%</td>
                    <td className="num">{formatoColones(producto.precioConIva)}</td>
                    <td className="num">{formatoColones(producto.valorSinIva)}</td>
                    <td className="num">{formatoColones(producto.valorConIva)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="2">TOTAL</td>
                  <td className="num">{totales.unidades.toLocaleString("es-CR")}</td>
                  <td colSpan="3"></td>
                  <td className="num">{formatoColones(totales.sinIva)}</td>
                  <td className="num">{formatoColones(totales.conIva)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTE: Principal (POS)
// ==========================================

const VISTAS = [
  { id: "inicio", label: "Inicio" },
  { id: "productos", label: "Productos" },
  { id: "reportes", label: "Reportes" },
  { id: "cierre", label: "Cierre de caja" }
];

function POSScreen({ onLogout }) {
  const [view, setView] = useState("inicio");
  const [cartItems, setCartItems] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  const cartTotal = cartItems.reduce(
    (sum, item) => sum + item.precio_venta * item.cantidad,
    0
  ) * 1.13; // Con IVA

  const handleAddToCart = (product) => {
    const existing = cartItems.find((item) => item.id === product.id);

    if (existing) {
      setCartItems(
        cartItems.map((item) =>
          item.id === product.id
            ? { ...item, cantidad: item.cantidad + 1 }
            : item
        )
      );
    } else {
      setCartItems([...cartItems, { ...product, cantidad: 1 }]);
    }
  };

  const handleRemoveFromCart = (productId) => {
    setCartItems(cartItems.filter((item) => item.id !== productId));
  };

  const handleQuantityChange = (productId, newQuantity) => {
    if (newQuantity <= 0) {
      handleRemoveFromCart(productId);
    } else {
      setCartItems(
        cartItems.map((item) =>
          item.id === productId ? { ...item, cantidad: newQuantity } : item
        )
      );
    }
  };

  const handlePaymentComplete = async (paymentData) => {
    if (cartItems.length === 0) {
      alert("Carrito vacío");
      return;
    }

    setIsProcessing(true);

    try {
      const saleData = {
        items: cartItems.map((item) => ({
          productId: item.id,
          cantidad: item.cantidad
        })),
        medioPago: paymentData.method,
        montoRecibido: paymentData.amountReceived,
        clientId: null
      };

      const response = await apiService.createSale(saleData);

      setLastSale(response);
      setCartItems([]); // Limpiar carrito

      // Mostrar resumen
      setTimeout(() => {
        alert(
          `✓ Venta completada\nVenta #: ${response.numeroVenta}\nTotal: ₡${response.total.toLocaleString()}\nEstado: ${response.estado}`
        );
      }, 500);
      return true;
    } catch (error) {
      alert("Error procesando venta: " + error.message);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="pos-container">
      <header className="pos-header">
        <h1>🛍️ POS - Punto de Venta</h1>
        <nav className="pos-nav">
          {VISTAS.map((vista) => (
            <button
              key={vista.id}
              className={view === vista.id ? "nav-link active" : "nav-link"}
              onClick={() => setView(vista.id)}
            >
              {vista.label}
            </button>
          ))}
        </nav>
        <button className="btn-logout" onClick={onLogout}>
          Cerrar Sesión
        </button>
      </header>

      {view === "productos" && <ProductsScreen />}
      {view === "reportes" && <ReportsScreen />}
      {view === "cierre" && <CashClosingScreen />}

      {/* Inicio queda montado (oculto) para no perder el carrito al cambiar de vista */}
      <div className="pos-content" style={view === "inicio" ? undefined : { display: "none" }}>
        <div className="pos-left">
          <ProductSearch onAddToCart={handleAddToCart} />
        </div>

        <div className="pos-right">
          <Cart
            items={cartItems}
            onRemoveItem={handleRemoveFromCart}
            onQuantityChange={handleQuantityChange}
          />

          {cartItems.length > 0 && (
            <PaymentForm
              cartTotal={cartTotal}
              onPaymentComplete={handlePaymentComplete}
              isProcessing={isProcessing}
            />
          )}

          {lastSale && (
            <div className="last-sale-info">
              <h3>✓ Última venta</h3>
              <p>Venta #{lastSale.numeroVenta}</p>
              <p>Total: ₡{lastSale.total.toLocaleString()}</p>
              <p>Comprobante: {lastSale.comprobante?.estado}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTE: Principal (App)
// ==========================================

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("token"));

  const logout = () => {
    localStorage.removeItem("token");
    setIsLoggedIn(false);
  };

  // Token vencido o inválido: volver al login en vez de quedarse sin productos
  apiService.onUnauthorized = logout;

  return (
    <div className="app">
      {isLoggedIn ? (
        <POSScreen onLogout={logout} />
      ) : (
        <LoginScreen onLogin={() => setIsLoggedIn(true)} />
      )}
    </div>
  );
}

export default App;
