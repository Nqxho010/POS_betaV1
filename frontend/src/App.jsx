// ==========================================
// FRONTEND POS - Aplicación React Principal
// CON NAVBAR INTEGRADO
// ==========================================
// Archivo: frontend/src/App.jsx

import React, { useState, useEffect } from "react";
import "./App.css";
import Navbar from "./components/Navbar";

// ==========================================
// SERVICIO API (Cliente HTTP)
// ==========================================

const API_BASE = "http://localhost:5000/api";

const apiService = {
  setToken: (token) => {
    localStorage.setItem("token", token);
  },

  getToken: () => localStorage.getItem("token"),

  getUsuario: () => {
    const u = localStorage.getItem("usuario");
    return u ? JSON.parse(u) : null;
  },

  setUsuario: (usuario) => {
    localStorage.setItem("usuario", JSON.stringify(usuario));
  },

  searchProducts: async (query) => {
    const response = await fetch(
      `${API_BASE}/products/search?q=${query}`,
      {
        headers: { Authorization: `Bearer ${apiService.getToken()}` }
      }
    );
    return response.json();
  },

  getAllProducts: async () => {
    const response = await fetch(`${API_BASE}/products`, {
      headers: { Authorization: `Bearer ${apiService.getToken()}` }
    });
    return response.json();
  },

  createSale: async (saleData) => {
    const response = await fetch(`${API_BASE}/sales`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiService.getToken()}`
      },
      body: JSON.stringify(saleData)
    });
    return response.json();
  },

  getCashClosing: async () => {
    const response = await fetch(`${API_BASE}/reports/cash-closing`, {
      headers: { Authorization: `Bearer ${apiService.getToken()}` }
    });
    return response.json();
  },

  login: async (username, password) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (data.token) {
      apiService.setToken(data.token);
      apiService.setUsuario(data.usuario);
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
        onLogin(result.usuario);
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
                      onQuantityChange(item.id, parseInt(e.target.value))
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

  const handleSearch = async (query) => {
    setSearch(query);
    if (query.length > 0) {
      try {
        const productos = await apiService.searchProducts(query);
        setResults(productos);
      } catch (error) {
        console.error("Error buscando:", error);
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

      {search && results.length === 0 && (
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

  const handlePay = () => {
    if (paymentMethod === "cash" && (!amountReceived || amountReceived < cartTotal)) {
      alert("Monto recibido insuficiente");
      return;
    }

    onPaymentComplete({
      method: paymentMethod,
      amountReceived: paymentMethod === "cash" ? amountReceived : cartTotal,
      reference: sinpeRef || cardLast4
    });

    setAmountReceived("");
    setSinpeRef("");
    setCardLast4("");
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
// PÁGINA: Punto de Venta (tu POSScreen original, sin header propio)
// ==========================================

function VentaPage() {
  const [cartItems, setCartItems] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  const cartTotal = cartItems.reduce(
    (sum, item) => sum + item.precio_venta * item.cantidad,
    0
  ) * 1.13;

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
      setCartItems([]);

      setTimeout(() => {
        alert(
          `✓ Venta completada\nVenta #: ${response.numeroVenta}\nTotal: ₡${response.total.toLocaleString()}\nEstado: ${response.estado}`
        );
      }, 500);
    } catch (error) {
      alert("Error procesando venta: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="pos-container">
      <div className="pos-content">
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
              <p>Comprobante: {lastSale.comprobante.estado}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// PÁGINA: Productos (placeholder - próximo desarrollo)
// ==========================================

function ProductosPage() {
  const [productos, setProductos] = useState([]);

  useEffect(() => {
    apiService.getAllProducts().then(setProductos).catch(console.error);
  }, []);

  return (
    <div className="page-container">
      <h2>📦 Gestión de Productos</h2>
      <table className="tabla-productos">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Precio</th>
            <th>Stock</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id}>
              <td>{p.codigo_barras}</td>
              <td>{p.nombre}</td>
              <td>₡{p.precio_venta.toLocaleString()}</td>
              <td>{p.stock_actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================
// PÁGINA: Reportes / Cierre de Caja (usa endpoint que ya tienes)
// ==========================================

function CierrePage() {
  const [cierre, setCierre] = useState(null);

  const cargarCierre = async () => {
    const data = await apiService.getCashClosing();
    setCierre(data);
  };

  useEffect(() => {
    cargarCierre();
  }, []);

  if (!cierre) return <div className="page-container">Cargando...</div>;

  return (
    <div className="page-container">
      <h2>🔐 Cierre de Caja - {cierre.fecha}</h2>
      <p>Total de ventas: {cierre.totalVentas}</p>
      <ul>
        <li>Efectivo: ₡{cierre.detallePagos.efectivo.toLocaleString()}</li>
        <li>SINPE: ₡{cierre.detallePagos.sinpe.toLocaleString()}</li>
        <li>Tarjeta: ₡{cierre.detallePagos.tarjeta.toLocaleString()}</li>
      </ul>
      <p><strong>Total: ₡{cierre.total.toLocaleString()}</strong></p>
      <p>Total IVA: ₡{cierre.totalIVA.toLocaleString()}</p>
      <button onClick={cargarCierre}>🔄 Actualizar</button>
    </div>
  );
}

function ReportesPage() {
  return (
    <div className="page-container">
      <h2>📊 Reportes</h2>
      <p>Próximamente: ventas por período, productos más vendidos, gráficos.</p>
    </div>
  );
}

function DevolucionesPage() {
  return (
    <div className="page-container">
      <h2>↩️ Notas de Crédito / Devoluciones</h2>
      <p>Próximamente: crear notas de crédito y gestionar devoluciones.</p>
    </div>
  );
}

// ==========================================
// COMPONENTE: Principal (App)
// ==========================================

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("token"));
  const [usuario, setUsuarioState] = useState(apiService.getUsuario());
  const [currentPage, setCurrentPage] = useState("venta");

  const handleLogin = (usuarioData) => {
    setUsuarioState(usuarioData);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    setIsLoggedIn(false);
    setUsuarioState(null);
    setCurrentPage("venta");
  };

  const renderPage = () => {
    switch (currentPage) {
      case "venta":
        return <VentaPage />;
      case "productos":
        return <ProductosPage />;
      case "reportes":
        return <ReportesPage />;
      case "cierre":
        return <CierrePage />;
      case "devoluciones":
        return <DevolucionesPage />;
      default:
        return <VentaPage />;
    }
  };

  return (
    <div className="app">
      {isLoggedIn ? (
        <>
          <Navbar
            usuario={usuario}
            onLogout={handleLogout}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
          <main className="main-content">
            {renderPage()}
          </main>
        </>
      ) : (
        <LoginScreen onLogin={handleLogin} />
      )}
    </div>
  );
}

export default App;