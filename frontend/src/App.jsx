// ==========================================
// FRONTEND POS - Aplicación React Principal
// ==========================================
// Archivo: frontend/src/App.jsx

import React, { useState, useEffect } from "react";
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

function ProductSearch({ onAddToCart, allProducts }) {
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

    // Limpiar
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
// COMPONENTE: Principal (POS)
// ==========================================

function POSScreen({ onLogout }) {
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
    } catch (error) {
      alert("Error procesando venta: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="pos-container">
      <header className="pos-header">
        <h1>🛍️ POS - Punto de Venta</h1>
        <button className="btn-logout" onClick={onLogout}>
          Cerrar Sesión
        </button>
      </header>

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
// COMPONENTE: Principal (App)
// ==========================================

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("token"));

  return (
    <div className="app">
      {isLoggedIn ? (
        <POSScreen onLogout={() => {
          localStorage.removeItem("token");
          setIsLoggedIn(false);
        }} />
      ) : (
        <LoginScreen onLogin={() => setIsLoggedIn(true)} />
      )}
    </div>
  );
}

export default App;
