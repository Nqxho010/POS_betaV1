// ==========================================
// FRONTEND POS - Aplicación React Principal
// ==========================================
// Archivo: frontend/src/App.jsx

import React, { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";

// ==========================================
// SERVICIO API (Cliente HTTP)
// ==========================================

// En desarrollo (npm start, puerto 3000) el backend corre aparte en el 5000;
// compilado, el mismo backend sirve esta página y la API
const API_BASE =
  process.env.NODE_ENV === "development" ? "http://localhost:5000/api" : "/api";


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

  post: (path, body) =>
    apiService.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),

  getMe: () => apiService.request("/auth/me"),

  createUser: (data) => apiService.post("/auth/register", data),

  createProduct: (data) => apiService.post("/products", data),

  // data: { cantidad, precio_con_iva, utilidad }
  updateProduct: (productId, data) =>
    apiService.post(`/products/${productId}/stock`, data),

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

  // usuarioId solo lo puede usar el admin
  getCashClosing: (fecha, usuarioId) =>
    apiService.request(
      `/reports/cash-closing?fecha=${encodeURIComponent(fecha)}` +
        (usuarioId ? `&usuario_id=${encodeURIComponent(usuarioId)}` : "")
    ),

  getUsers: () => apiService.request("/users"),

  getBackups: () => apiService.request("/admin/backups"),

  createBackup: () => apiService.post("/admin/backups", {}),

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
// INTERFAZ: íconos, avisos y lector de código de barras
// ==========================================

// Funciones que expone la app de escritorio (no existe en el navegador)
const escritorio = window.posDesktop || null;

const ICONOS = {
  buscar: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  carrito: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 11.5h11L21 7H6.5" /></>,
  pago: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 10h18M7 15h4" /></>,
  grafico: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  recibo: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  caja: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  usuario: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></>,
  mas: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cerrar: <path d="M6 6l12 12M18 6 6 18" />,
  alerta: <><path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.5" /></>,
  respaldo: <><path d="M12 3v11m0 0-4-4m4 4 4-4" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  carpeta: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  pantalla: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
};

function Icon({ nombre, size = 20 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONOS[nombre]}
    </svg>
  );
}

// Avisos dentro de la app (reemplazan a alert): notify("ok" | "error", texto)
const escuchasAvisos = new Set();
let ultimoAviso = 0;
const notify = (tipo, texto) =>
  escuchasAvisos.forEach((escucha) => escucha({ id: ++ultimoAviso, tipo, texto }));

function Toasts() {
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    const agregar = (aviso) => {
      setAvisos((lista) => [...lista, aviso]);
      setTimeout(
        () => setAvisos((lista) => lista.filter((a) => a.id !== aviso.id)),
        aviso.tipo === "error" ? 6000 : 4000
      );
    };
    escuchasAvisos.add(agregar);
    return () => escuchasAvisos.delete(agregar);
  }, []);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {avisos.map((aviso) => (
        <div key={aviso.id} className={`toast ${aviso.tipo}`}>
          <Icon nombre={aviso.tipo === "ok" ? "check" : "alerta"} size={18} />
          <span>{aviso.texto}</span>
        </div>
      ))}
    </div>
  );
}

// Tono grave y corto: el cajero lo oye sin mirar la pantalla
function sonarError() {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const oscilador = audio.createOscillator();
    const volumen = audio.createGain();
    oscilador.type = "square";
    oscilador.frequency.value = 220;
    volumen.gain.value = 0.15;
    oscilador.connect(volumen);
    volumen.connect(audio.destination);
    oscilador.start();
    oscilador.stop(audio.currentTime + 0.3);
    oscilador.onended = () => audio.close();
  } catch (error) {
    // Sin audio disponible: queda el aviso en pantalla
  }
}

// Agrega al carrito el producto cuyo código coincide exacto. Si el código no
// existe avisa con sonido; si solo hay coincidencias parciales no hace nada
// (es una búsqueda por nombre). Devuelve true si lo agregó.
async function agregarPorCodigo(codigo, onAddToCart) {
  try {
    const productos = await apiService.searchProducts(codigo);
    const lista = Array.isArray(productos) ? productos : [];
    const exacto = lista.find((p) => p.codigo_barras === codigo || p.codigo === codigo);
    if (exacto) {
      onAddToCart(exacto);
      return true;
    }
    if (lista.length === 0) {
      sonarError();
      notify("error", `El código ${codigo} no existe`);
    }
  } catch (error) {
    sonarError();
    notify("error", "No se pudo buscar el producto: " + error.message);
  }
  return false;
}

// Devuelve un campo a su valor anterior avisándole a React
function restaurarValor(campo, valor) {
  const prototipo =
    campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototipo, "value").set.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

// El lector "teclea" mucho más rápido que una persona: varios caracteres
// seguidos con menos de esta pausa y un Enter al final son una lectura
const PAUSA_LECTOR_MS = 50;
const LARGO_MINIMO_LECTURA = 6;

// Captura lecturas del lector hechas con el cursor fuera del buscador (por
// ejemplo en "Monto recibido"): deshace lo tecleado en ese campo y entrega el
// código a alLeer
function useLectorGlobal(activo, alLeer) {
  const alLeerRef = useRef(alLeer);
  alLeerRef.current = alLeer;

  useEffect(() => {
    if (!activo) return undefined;
    let codigo = "";
    let ultimaTecla = 0;
    let origen = null;

    const alTeclear = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const ahora = performance.now();
      if (ahora - ultimaTecla > PAUSA_LECTOR_MS) {
        codigo = "";
        origen = null;
      }

      if (e.key === "Enter") {
        const leido = codigo;
        codigo = "";
        // En el buscador la lectura la atiende el propio buscador
        if (leido.length < LARGO_MINIMO_LECTURA || e.target.classList?.contains("search-input")) return;
        e.preventDefault();
        e.stopPropagation();
        if (origen) restaurarValor(origen.campo, origen.valor);
        alLeerRef.current(leido);
        return;
      }

      if (e.key.length === 1) {
        if (!codigo) {
          const esCampo = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
          origen = esCampo ? { campo: e.target, valor: e.target.value } : null;
        }
        codigo += e.key;
        ultimaTecla = ahora;
      }
    };

    window.addEventListener("keydown", alTeclear, true);
    return () => window.removeEventListener("keydown", alTeclear, true);
  }, [activo]);
}

// Atajo de teclado global mientras el componente está montado y activo
function useAtajo(tecla, accion, activo = true) {
  const accionRef = useRef(accion);
  accionRef.current = accion;

  useEffect(() => {
    if (!activo) return undefined;
    const alTeclear = (e) => {
      if (e.key !== tecla) return;
      e.preventDefault();
      accionRef.current();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [tecla, activo]);
}

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
        notify("error", result.error);
      }
    } catch (error) {
      notify("error", "Error de conexión: " + error.message);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>
          <span className="brand-mark" aria-hidden="true" />
          POS Costa Rica
        </h1>
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
  const iva = items.reduce(
    (sum, item) => sum + item.precio_venta * item.cantidad * (item.impuesto_venta / 100),
    0
  );
  const total = subtotal + iva;

  return (
    <div className="cart">
      <h2><Icon nombre="carrito" />Carrito</h2>

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
                  <Icon nombre="cerrar" size={13} />
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
              <span>IVA:</span>
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

function ProductSearch({ onAddToCart, activo }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const latestQuery = useRef("");
  const inputRef = useRef(null);

  const limpiar = () => {
    latestQuery.current = "";
    setSearch("");
    setResults([]);
    inputRef.current?.focus();
  };

  // El lector de código de barras escribe el código y manda Enter: si el
  // código coincide exacto con un producto, va directo al carrito
  const handleEnter = async (e) => {
    if (e.key !== "Enter") return;
    const codigo = e.target.value.trim();
    if (!codigo) return;
    e.preventDefault();
    if (await agregarPorCodigo(codigo, onAddToCart)) limpiar();
  };

  // F2 lleva el cursor al buscador (se espera a que la vista Inicio se muestre)
  useAtajo("F2", () =>
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0)
  );
  useAtajo("Escape", limpiar, activo);

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
      <h2><Icon nombre="buscar" />Buscar productos</h2>

      <input
        type="text"
        placeholder="Código de barras o nombre...  (F2)"
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        onKeyDown={handleEnter}
        ref={inputRef}
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
                <p>₡{product.total.toLocaleString()}</p>
                <p className="stock">Stock: {product.stock_actual}</p>
              </div>
              <button
                className="btn-add"
                onClick={() => {
                  onAddToCart(product);
                  limpiar();
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

function PaymentForm({ cartTotal, onPaymentComplete, isProcessing, activo }) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [sinpeRef, setSinpeRef] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const montoRef = useRef(null);

  const change = paymentMethod === "cash" ? (amountReceived || 0) - cartTotal : 0;

  const handlePay = async () => {
    if (isProcessing) return;
    if (paymentMethod === "cash" && (!amountReceived || amountReceived < cartTotal)) {
      notify("error", "Monto recibido insuficiente");
      montoRef.current?.focus();
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

  useAtajo("F4", handlePay, activo);

  return (
    <div className="payment-form">
      <h2><Icon nombre="pago" />Método de pago</h2>

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
            ref={montoRef}
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
        {isProcessing ? "Procesando..." : "COBRAR  (F4)"}
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

// El backend devuelve al cajero solo sus ventas y al admin las de todos
function ReportsScreen({ esAdmin }) {
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
          <h2><Icon nombre="grafico" />Reporte de ventas</h2>
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
                  {esAdmin && <th>Cajero</th>}
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
                    {esAdmin && <td>{venta.username || "—"}</td>}
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

// El admin puede ver el cierre general (con desglose por usuario) o el de un usuario
function CashClosingScreen({ esAdmin }) {
  const [fecha, setFecha] = useState(fechaHoy);
  const [usuarioId, setUsuarioId] = useState("");
  const [usuarios, setUsuarios] = useState([]);
  const cargarCierre = useCallback((f) => apiService.getCashClosing(f, usuarioId), [usuarioId]);
  const { datos: cierre, error, cargando, recargar } = useDatosPorFecha(cargarCierre, fecha);

  useEffect(() => {
    if (!esAdmin) return;
    apiService.getUsers().then(setUsuarios).catch(() => setUsuarios([]));
  }, [esAdmin]);

  return (
    <div className="report-page">
      <div className={esAdmin ? "report-card medium" : "report-card narrow"}>
        <div className="report-header">
          <h2><Icon nombre="recibo" />Cierre de caja</h2>
          <div className="report-toolbar">
            {esAdmin && (
              <label>
                Usuario
                <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
                  <option value="">Todos</option>
                  {usuarios.map((usuario) => (
                    <option key={usuario.id} value={usuario.id}>
                      {usuario.username}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <FiltroFecha fecha={fecha} onChange={setFecha} onRecargar={recargar} cargando={cargando} />
          </div>
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

            {cierre.porUsuario && (
              <>
                <h3 className="closing-section">Por usuario</h3>
                {cierre.porUsuario.length === 0 ? (
                  <p className="report-empty">No hay ventas en esta fecha</p>
                ) : (
                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Usuario</th>
                          <th className="num">Ventas</th>
                          <th className="num">Efectivo</th>
                          <th className="num">SINPE</th>
                          <th className="num">Tarjeta</th>
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cierre.porUsuario.map((fila) => (
                          <tr key={fila.usuario_id}>
                            <td>{fila.username}</td>
                            <td className="num">{fila.totalVentas}</td>
                            <td className="num">{formatoColones(fila.detallePagos.efectivo)}</td>
                            <td className="num">{formatoColones(fila.detallePagos.sinpe)}</td>
                            <td className="num">{formatoColones(fila.detallePagos.tarjeta)}</td>
                            <td className="num">{formatoColones(fila.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTE: Productos e inventario
// ==========================================

// El inventario tiene miles de productos: la tabla muestra solo los primeros
const MAX_FILAS_PRODUCTOS = 200;

function ProductsScreen() {
  const [filtro, setFiltro] = useState("");
  const { datos, error, cargando, recargar } = useDatosPorFecha(apiService.getAllProducts, null);

  // total = precio con IVA + utilidad: es lo que paga el cliente
  const productos = Array.isArray(datos) ? datos : [];

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
      valor: acc.valor + producto.total * producto.stock_actual
    }),
    { unidades: 0, valor: 0 }
  );

  return (
    <div className="report-page">
      <div className="report-card">
        <div className="report-header">
          <h2><Icon nombre="caja" />Productos e inventario</h2>
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
            <div className="stat highlight">
              <span>Valor del inventario</span>
              <strong>{formatoColones(totales.valor)}</strong>
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
                  <th className="num">Precio con IVA</th>
                  <th className="num">Utilidad</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, MAX_FILAS_PRODUCTOS).map((producto) => (
                  <tr key={producto.id}>
                    <td>{producto.codigo_barras || "—"}</td>
                    <td>{producto.nombre}</td>
                    <td className={producto.stock_actual <= producto.stock_minimo ? "num stock-low" : "num"}>
                      {producto.stock_actual}
                    </td>
                    <td className="num">{formatoColones(producto.precio_con_iva)}</td>
                    <td className="num">{producto.utilidad}%</td>
                    <td className="num">{formatoColones(producto.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="2">TOTAL</td>
                  <td className="num">{totales.unidades.toLocaleString("es-CR")}</td>
                  <td colSpan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {visibles.length > MAX_FILAS_PRODUCTOS && (
          <p className="report-empty">
            Mostrando {MAX_FILAS_PRODUCTOS} de {visibles.length.toLocaleString("es-CR")} productos; usa el filtro para ver otros.
            Los totales incluyen todos.
          </p>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENTES: Administración (solo rol admin)
// ==========================================

const VISTAS_ADMIN = [
  { id: "admin-usuarios", label: "Crear usuarios" },
  { id: "admin-inventario", label: "Agregar producto o cantidad" },
  { id: "admin-respaldos", label: "Respaldos" }
];

function AdminMenu({ view, onSelect }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  // Cerrar al hacer clic fuera del menú
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierto]);

  const activo = VISTAS_ADMIN.some((vista) => vista.id === view);

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        className={activo ? "nav-link active" : "nav-link"}
        onClick={() => setAbierto(!abierto)}
      >
        Administración ▾
      </button>
      {abierto && (
        <div className="nav-dropdown-menu">
          {VISTAS_ADMIN.map((vista) => (
            <button
              key={vista.id}
              className={view === vista.id ? "active" : ""}
              onClick={() => {
                onSelect(vista.id);
                setAbierto(false);
              }}
            >
              {vista.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormMessage({ mensaje }) {
  if (!mensaje) return null;
  return <p className={mensaje.ok ? "form-msg ok" : "form-msg error"}>{mensaje.texto}</p>;
}

// Los usuarios se guardan en la BD principal (pos.db)
function AdminUsersScreen() {
  const vacio = { username: "", password: "", email: "", rol: "cajero" };
  const [form, setForm] = useState(vacio);
  const [mensaje, setMensaje] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    try {
      const usuario = await apiService.createUser(form);
      setMensaje({ ok: true, texto: `Usuario "${usuario.username}" creado con rol ${usuario.rol}` });
      setForm(vacio);
    } catch (error) {
      setMensaje({ ok: false, texto: "No se pudo crear el usuario: " + error.message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="report-page">
      <div className="report-card narrow">
        <div className="report-header">
          <h2><Icon nombre="usuario" />Crear usuario</h2>
        </div>
        <form className="admin-form" onSubmit={guardar}>
          <label>
            Usuario
            <input type="text" value={form.username} onChange={cambiar("username")} required />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={form.password}
              onChange={cambiar("password")}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Correo (opcional)
            <input type="email" value={form.email} onChange={cambiar("email")} />
          </label>
          <label>
            Rol
            <select value={form.rol} onChange={cambiar("rol")}>
              <option value="cajero">Cajero</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button className="btn-refresh" type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : "Crear usuario"}
          </button>
          <FormMessage mensaje={mensaje} />
        </form>
      </div>
    </div>
  );
}

// Los productos y sus existencias se guardan en FacInve.DBF
function AdminInventoryScreen() {
  return (
    <div className="report-page">
      <div className="admin-grid">
        <AddStockForm />
        <NewProductForm />
      </div>
    </div>
  );
}

function AddStockForm() {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(null);
  const [cantidad, setCantidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [utilidad, setUtilidad] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const ultimaBusqueda = useRef("");

  const total = (Number(precio) || 0) * (1 + (Number(utilidad) || 0) / 100);

  const seleccionar = (resultado) => {
    setProducto(resultado);
    setPrecio(String(resultado.precio_con_iva));
    setUtilidad(String(resultado.utilidad));
    setCantidad("");
    setBusqueda("");
    setResultados([]);
    setMensaje(null);
  };

  const buscar = async (texto) => {
    setBusqueda(texto);
    ultimaBusqueda.current = texto;
    if (!texto) return setResultados([]);
    try {
      const productos = await apiService.searchProducts(texto);
      // Ignorar respuestas de búsquedas anteriores que llegan tarde
      if (ultimaBusqueda.current !== texto) return;
      setResultados(Array.isArray(productos) ? productos.slice(0, 8) : []);
    } catch (error) {
      if (ultimaBusqueda.current !== texto) return;
      setResultados([]);
      setMensaje({ ok: false, texto: "No se pudo buscar: " + error.message });
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    try {
      // Precio y utilidad solo se envían si el admin los cambió
      const cambioPrecio =
        Number(precio) !== producto.precio_con_iva || Number(utilidad) !== producto.utilidad;
      const actualizado = await apiService.updateProduct(producto.id, {
        cantidad: Number(cantidad) || 0,
        ...(cambioPrecio && { precio_con_iva: Number(precio), utilidad: Number(utilidad) })
      });
      setMensaje({
        ok: true,
        texto:
          `${actualizado.nombre}: existencia ${actualizado.stock_actual}, ` +
          `precio con IVA ${formatoColones(actualizado.precio_con_iva)}, ` +
          `utilidad ${actualizado.utilidad}%, total ${formatoColones(actualizado.total)}`
      });
      setProducto(null);
      setCantidad("");
    } catch (error) {
      setMensaje({ ok: false, texto: "No se pudo guardar: " + error.message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="report-card">
      <div className="report-header">
        <h2><Icon nombre="mas" />Agregar cantidad o cambiar precio</h2>
      </div>

      {!producto && (
        <div className="admin-form">
          <label>
            Buscar producto
            <input
              type="text"
              placeholder="Código de barras o nombre..."
              value={busqueda}
              onChange={(e) => buscar(e.target.value)}
            />
          </label>
          {resultados.map((resultado) => (
            <button
              key={resultado.id}
              type="button"
              className="admin-result"
              onClick={() => seleccionar(resultado)}
            >
              <span>{resultado.nombre}</span>
              <small>
                {resultado.codigo_barras} · Existencia: {resultado.stock_actual}
              </small>
            </button>
          ))}
          {busqueda && resultados.length === 0 && (
            <p className="report-empty">No se encontraron productos</p>
          )}
        </div>
      )}

      {producto && (
        <form className="admin-form" onSubmit={guardar}>
          <div className="admin-selected">
            <strong>{producto.nombre}</strong>
            <small>
              {producto.codigo_barras} · Existencia actual: {producto.stock_actual}
            </small>
          </div>
          <label>
            Cantidad a agregar
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Precio con IVA
            <input
              type="number"
              min="0"
              step="0.01"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              required
            />
          </label>
          <label>
            Utilidad (%)
            <input
              type="number"
              step="0.01"
              value={utilidad}
              onChange={(e) => setUtilidad(e.target.value)}
              required
            />
          </label>
          <div className="admin-selected">
            <small>Total (precio con IVA + utilidad)</small>
            <strong>{formatoColones(total)}</strong>
          </div>
          <div className="admin-actions">
            <button className="btn-refresh" type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
            <button className="btn-secondary" type="button" onClick={() => setProducto(null)}>
              Cambiar producto
            </button>
          </div>
        </form>
      )}

      <FormMessage mensaje={mensaje} />
    </div>
  );
}

function NewProductForm() {
  const vacio = {
    codigo_barras: "",
    nombre: "",
    precio_con_iva: "",
    utilidad: "",
    stock_actual: "",
    codigo_cabys: ""
  };
  const [form, setForm] = useState(vacio);
  const [mensaje, setMensaje] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });

  const total = (Number(form.precio_con_iva) || 0) * (1 + (Number(form.utilidad) || 0) / 100);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    try {
      const producto = await apiService.createProduct({
        ...form,
        precio_con_iva: Number(form.precio_con_iva),
        utilidad: Number(form.utilidad) || 0,
        stock_actual: Number(form.stock_actual) || 0
      });
      setMensaje({ ok: true, texto: `Producto "${producto.nombre}" creado` });
      setForm(vacio);
    } catch (error) {
      setMensaje({ ok: false, texto: "No se pudo crear el producto: " + error.message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="report-card">
      <div className="report-header">
        <h2><Icon nombre="caja" />Nuevo producto</h2>
      </div>
      <form className="admin-form" onSubmit={guardar}>
        <label>
          Código de barras
          <input type="text" maxLength="20" value={form.codigo_barras} onChange={cambiar("codigo_barras")} required />
        </label>
        <label>
          Nombre
          <input type="text" maxLength="80" value={form.nombre} onChange={cambiar("nombre")} required />
        </label>
        <label>
          Precio con IVA
          <input type="number" min="0" step="0.01" value={form.precio_con_iva} onChange={cambiar("precio_con_iva")} required />
        </label>
        <label>
          Utilidad (%)
          <input type="number" min="0" step="0.01" value={form.utilidad} onChange={cambiar("utilidad")} required />
        </label>
        <div className="admin-selected">
          <small>Total (precio con IVA + utilidad)</small>
          <strong>{formatoColones(total)}</strong>
        </div>
        <label>
          Cantidad inicial
          <input type="number" min="0" step="0.01" value={form.stock_actual} onChange={cambiar("stock_actual")} />
        </label>
        <label>
          Código CABYS (opcional)
          <input type="text" maxLength="13" value={form.codigo_cabys} onChange={cambiar("codigo_cabys")} />
        </label>
        <button className="btn-refresh" type="submit" disabled={guardando}>
          {guardando ? "Guardando..." : "Crear producto"}
        </button>
        <FormMessage mensaje={mensaje} />
      </form>
    </div>
  );
}

const formatoTamano = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MB";

// "2026-10-07_14-30-05" -> "2026-10-07 14:30"
const formatoRespaldo = (nombre) => nombre.slice(0, 10) + " " + nombre.slice(11, 16).replace("-", ":");

function AdminBackupsScreen() {
  const { datos, error, cargando, recargar } = useDatosPorFecha(apiService.getBackups, null);
  const [guardando, setGuardando] = useState(false);
  const respaldos = datos?.respaldos || [];

  const respaldar = async () => {
    setGuardando(true);
    try {
      const respaldo = await apiService.createBackup();
      notify("ok", `Respaldo creado: ${formatoRespaldo(respaldo.nombre)}`);
      recargar();
    } catch (err) {
      notify("error", "No se pudo crear el respaldo: " + err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="report-page">
      <div className="report-card medium">
        <div className="report-header">
          <h2><Icon nombre="respaldo" />Respaldos</h2>
          <div className="report-toolbar">
            {escritorio && (
              <button className="btn-secondary" onClick={() => escritorio.abrirCarpetaDatos()}>
                Abrir carpeta de datos
              </button>
            )}
            <button className="btn-refresh" onClick={respaldar} disabled={guardando}>
              {guardando ? "Respaldando..." : "Respaldar ahora"}
            </button>
          </div>
        </div>

        {error && <p className="report-error">No se pudieron cargar los respaldos: {error}</p>}

        {datos && (
          <p className="backup-info">
            Se hace un respaldo automático cada día con los usuarios, las ventas y el archivo de
            productos. Se conservan los últimos {datos.maximo} en:
            <br />
            <strong>{datos.carpeta}</strong>
          </p>
        )}

        {datos && !cargando && respaldos.length === 0 && (
          <p className="report-empty">Todavía no hay respaldos</p>
        )}

        {respaldos.length > 0 && (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th className="num">Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {respaldos.map((respaldo) => (
                  <tr key={respaldo.nombre}>
                    <td>{formatoRespaldo(respaldo.nombre)}</td>
                    <td className="num">{formatoTamano(respaldo.tamano)}</td>
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
  const [usuario, setUsuario] = useState(null);

  // El rol decide si se muestra el menú de administración
  useEffect(() => {
    apiService.getMe().then(setUsuario).catch(() => setUsuario(null));
  }, []);

  const esAdmin = usuario?.rol === "admin";
  const enInicio = view === "inicio";

  // F2 vuelve a Inicio (el buscador toma el cursor)
  useAtajo("F2", () => setView("inicio"));

  // Con IVA, según la tarifa de cada producto
  const cartTotal = cartItems.reduce(
    (sum, item) => sum + item.precio_venta * item.cantidad * (1 + item.impuesto_venta / 100),
    0
  );

  // Actualización funcional: dos lecturas seguidas del lector no se pisan
  const handleAddToCart = useCallback((product) => {
    setCartItems((items) =>
      items.some((item) => item.id === product.id)
        ? items.map((item) =>
            item.id === product.id ? { ...item, cantidad: item.cantidad + 1 } : item
          )
        : [...items, { ...product, cantidad: 1 }]
    );
  }, []);

  // Lecturas del lector con el cursor fuera del buscador
  useLectorGlobal(enInicio, (codigo) => agregarPorCodigo(codigo, handleAddToCart));

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
      notify("error", "Carrito vacío");
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

      notify(
        "ok",
        `Venta completada · Total ${formatoColones(response.total)}` +
          (response.vuelto > 0 ? ` · Vuelto ${formatoColones(response.vuelto)}` : "")
      );
      return true;
    } catch (error) {
      notify("error", "Error procesando venta: " + error.message);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="pos-container">
      <header className="pos-header">
        <div className="pos-brand">
          <span className="brand-place">Costa Rica</span>
          <h1>
            <span className="brand-mark" aria-hidden="true" />
            Punto de Venta
          </h1>
        </div>
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
          {esAdmin && <AdminMenu view={view} onSelect={setView} />}
        </nav>
        <div className="header-actions">
          {escritorio && (
            <button
              className="btn-icon"
              title="Pantalla completa (F11)"
              aria-label="Pantalla completa"
              onClick={() => escritorio.pantallaCompleta()}
            >
              <Icon nombre="pantalla" size={18} />
            </button>
          )}
          <button className="btn-logout" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      {view === "productos" && <ProductsScreen />}
      {view === "reportes" && <ReportsScreen esAdmin={esAdmin} />}
      {view === "cierre" && <CashClosingScreen esAdmin={esAdmin} />}
      {esAdmin && view === "admin-usuarios" && <AdminUsersScreen />}
      {esAdmin && view === "admin-inventario" && <AdminInventoryScreen />}
      {esAdmin && view === "admin-respaldos" && <AdminBackupsScreen />}

      {/* Inicio queda montado (oculto) para no perder el carrito al cambiar de vista */}
      <div className="pos-content" style={view === "inicio" ? undefined : { display: "none" }}>
        <div className="pos-left">
          <ProductSearch onAddToCart={handleAddToCart} activo={enInicio} />
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
              activo={enInicio}
            />
          )}

          {lastSale && (
            <div className="last-sale-info">
              <h3><Icon nombre="check" size={16} />Última venta</h3>
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
      <Toasts />
      {isLoggedIn ? (
        <POSScreen onLogout={logout} />
      ) : (
        <LoginScreen onLogin={() => setIsLoggedIn(true)} />
      )}
    </div>
  );
}

export default App;
