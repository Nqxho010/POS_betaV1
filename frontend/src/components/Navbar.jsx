import React, { useState, useEffect } from 'react';
import './Navbar.css';

const Navbar = ({ usuario, onLogout, currentPage, onPageChange }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Cargar dark mode del localStorage
  useEffect(() => {
    const darkModeGuardado = localStorage.getItem('darkMode') === 'true';
    setDarkMode(darkModeGuardado);
    if (darkModeGuardado) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  // Toggle dark mode
  const toggleDarkMode = () => {
    const nuevoEstado = !darkMode;
    setDarkMode(nuevoEstado);
    localStorage.setItem('darkMode', nuevoEstado);
    
    if (nuevoEstado) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  };

  // Opciones del menú principal
  const menuItems = [
    { id: 'venta', label: 'Punto de Venta', icon: '💰', badge: null },
    { id: 'productos', label: 'Productos', icon: '📦', badge: null },
    { id: 'reportes', label: 'Reportes', icon: '📊', badge: null },
    { id: 'cierre', label: 'Cierre de Caja', icon: '🔐', badge: null },
    { id: 'devoluciones', label: 'Notas de Crédito', icon: '↩️', badge: null },
  ];

  const handleLogout = () => {
    if (window.confirm('¿Estás seguro que deseas cerrar sesión?')) {
      localStorage.removeItem('token');
      localStorage.removeItem('usuario');
      onLogout();
    }
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-container">
          {/* Logo y nombre */}
          <div className="navbar-brand">
            <button 
              className="navbar-logo"
              onClick={() => onPageChange('venta')}
              title="Ir al inicio"
            >
              <span className="logo-icon">🏪</span>
              <span className="logo-text">Sistema Marindia</span>
            </button>
          </div>

          {/* Menú desktop */}
          <ul className="navbar-menu">
            {menuItems.map(item => (
              <li key={item.id}>
                <button
                  className={`navbar-link ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => {
                    onPageChange(item.id);
                    setMenuOpen(false);
                  }}
                  title={item.label}
                >
                  <span className="menu-icon">{item.icon}</span>
                  <span className="menu-text">{item.label}</span>
                  {item.badge && <span className="badge">{item.badge}</span>}
                </button>
              </li>
            ))}
          </ul>

          {/* Botones de acciones */}
          <div className="navbar-actions">
            {/* Dark Mode Toggle */}
            <button
              className="action-btn dark-mode-btn"
              onClick={toggleDarkMode}
              title={darkMode ? 'Modo claro' : 'Modo oscuro'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>

            {/* User info y logout */}
            <div className="navbar-user">
              <div className="user-info">
                <div className="user-avatar">
                  {usuario?.username?.charAt(0).toUpperCase()}
                </div>
                <div className="user-details">
                  <span className="user-name">{usuario?.username}</span>
                  <span className="user-role">
                    {usuario?.rol === 'cajero' 
                      ? '💼 Cajero' 
                      : usuario?.rol === 'gerente'
                      ? '👨‍💼 Gerente'
                      : '🔐 Administrador'}
                  </span>
                </div>
              </div>

              {/* Dropdown usuario */}
              <div className="user-menu">
                <button
                  className="user-menu-btn"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  title="Menú de usuario"
                >
                  ⋮
                </button>
                {userMenuOpen && (
                  <div className="user-dropdown">
                    <div className="dropdown-header">
                      <span>{usuario?.username}</span>
                      <span className="role-badge">{usuario?.rol.toUpperCase()}</span>
                    </div>
                    <div className="dropdown-divider"></div>
                    <button className="dropdown-item">
                      👤 Mi Perfil
                    </button>
                    <button className="dropdown-item">
                      ⚙️ Configuración
                    </button>
                    <div className="dropdown-divider"></div>
                    <button
                      className="dropdown-item logout-btn"
                      onClick={handleLogout}
                    >
                      🚪 Cerrar Sesión
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile hamburger */}
          <div className="navbar-hamburger">
            <button
              className="hamburger-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              title="Menú"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="navbar-mobile-menu">
            {menuItems.map(item => (
              <button
                key={item.id}
                className={`mobile-menu-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => {
                  onPageChange(item.id);
                  setMenuOpen(false);
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && <span className="badge">{item.badge}</span>}
              </button>
            ))}
            <div className="mobile-menu-divider"></div>
            <button 
              className="mobile-menu-item dark-mode-item"
              onClick={toggleDarkMode}
            >
              <span>{darkMode ? '☀️' : '🌙'}</span>
              <span>{darkMode ? 'Modo Claro' : 'Modo Oscuro'}</span>
            </button>
            <button 
              className="mobile-menu-item perfil-item"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
            >
              <span>👤</span>
              <span>Mi Perfil</span>
            </button>
            <button 
              className="mobile-menu-item config-item"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
            >
              <span>⚙️</span>
              <span>Configuración</span>
            </button>
            <div className="mobile-menu-divider"></div>
            <button className="mobile-menu-item logout-btn" onClick={handleLogout}>
              <span>🚪</span>
              <span>Cerrar Sesión</span>
            </button>
          </div>
        )}
      </nav>
    </>
  );
};

export default Navbar;