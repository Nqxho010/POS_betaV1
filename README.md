# POS Costa Rica

Punto de venta para negocios pequeños de Costa Rica (régimen simplificado). Funciona en la computadora del negocio, sin depender de internet, como aplicación de escritorio para Windows o desde el navegador.

Los productos se leen del archivo `FacInve.DBF` del negocio, las ventas se guardan en SQLite y al cobrar se genera un tiquete imprimible para el cliente. No emite factura electrónica.

> Versión actual: **1.0.0-beta.3**

## Qué hace

**Venta**
- Búsqueda de productos por nombre o código, y lector de código de barras (funciona con el cursor en cualquier campo).
- Carrito con precios finales, cobro en efectivo (con vuelto), SINPE Móvil o tarjeta.
- Tiquete de 80 mm con los datos del negocio y, si el cliente lo pide, su nombre, cédula, teléfono y correo.
- Cada venta se registra completa o no se registra, y no se duplica si se reintenta.

**Inventario**
- Productos manejados como *precio con IVA + utilidad = total*.
- Las ventas descuentan existencias en el mismo `FacInve.DBF`.
- El administrador puede agregar productos, sumar existencias y cambiar precio y utilidad.

**Reportes**
- Reporte de ventas por día, con reimpresión de tiquetes.
- Cierre de caja por método de pago.
- El cajero ve solo sus ventas; el administrador ve todas, con desglose por usuario.

**Administración y seguridad**
- Roles de administrador y cajero.
- Creación de usuarios, cambio y restablecimiento de contraseñas.
- Bloqueo temporal tras varios intentos fallidos de inicio de sesión.
- Registro de auditoría de las acciones importantes.
- Respaldo automático diario y respaldo manual.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| F2 | Ir al buscador de productos |
| F4 | Cobrar |
| F8 | Imprimir el tiquete de la última venta |
| Esc | Limpiar el buscador |
| F11 | Pantalla completa (app de escritorio) |

## Estructura del proyecto

```
POS_betaV1/
├── backend/          API (Node.js + Express)
│   └── src/
│       ├── app.js                Servidor, rutas y lógica de ventas
│       ├── .env.example          Plantilla de configuración
│       └── utils/
│           ├── dbfInventario.js  Lectura y escritura de FacInve.DBF
│           └── respaldo.js       Respaldos de las bases y el DBF
├── frontend/         Interfaz (React)
│   └── src/App.jsx
├── desktop/          Aplicación de escritorio (Electron) e instalador
└── INSTALACION.md    Guía de instalación detallada
```

## Dónde se guardan los datos

Los datos de cada negocio viven fuera del código y no se suben al repositorio.

| Archivo | Contenido |
|---|---|
| `database/pos.db` | Usuarios y auditoría |
| `database/hacienda.db` | Ventas y líneas de cada tiquete |
| `database/FacInve.DBF` | Productos e inventario (lo aporta el negocio) |
| `respaldos/` | Respaldos automáticos y manuales |
| `.env` | Configuración y claves de esa instalación |

- **En desarrollo** quedan dentro de `backend/`, o en la carpeta que indique `DATA_DIR`.
- **En la app de escritorio** quedan en `%APPDATA%\POS Costa Rica\datos`.

## Requisitos

- Windows 10 u 11
- Node.js 20
- El archivo `FacInve.DBF` del negocio

## Ejecutar en desarrollo

1. Instalar dependencias:

   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. Crear la configuración copiando `backend/src/.env.example` como `backend/src/.env` y completar al menos:
   - `JWT_SECRET`: una clave larga y propia.
   - `ADMIN_PASSWORD`: la contraseña inicial del usuario `admin`.
   - Los datos del negocio que salen en el tiquete.

3. Copiar `FacInve.DBF` en `backend/database/`.

4. Iniciar el backend (puerto 5000):

   ```bash
   cd backend
   npm start
   ```

5. Iniciar el frontend (puerto 3000) en otra terminal:

   ```bash
   cd frontend
   npm start
   ```

6. Abrir `http://localhost:3000` e ingresar con el usuario `admin` y la contraseña definida en `ADMIN_PASSWORD`. Desde Administración se crean los cajeros.

## Generar la aplicación de escritorio

```bash
cd desktop
npm install
npm run dist
```

El instalador queda en `desktop/dist/POS Costa Rica Setup <versión>.exe`.

En el primer arranque la app crea su propio `.env` con claves únicas para esa instalación. La contraseña inicial del administrador está en ese archivo (`ADMIN_PASSWORD`); conviene cambiarla desde la app al ingresar.

Si `npm run dist` falla por permisos al crear enlaces simbólicos, hay que activar el "Modo de desarrollador" de Windows o ejecutar la terminal como administrador.

## Configuración (`.env`)

| Variable | Para qué sirve |
|---|---|
| `PORT` | Puerto del backend (5000 por defecto) |
| `JWT_SECRET` | Clave para firmar las sesiones; debe ser única por instalación |
| `ADMIN_PASSWORD` | Contraseña del `admin` que se crea en el primer arranque |
| `DATA_DIR` | Carpeta de datos del negocio; vacío usa `backend/` |
| `BACKUP_DIR` | Carpeta de respaldos; lo ideal es otro disco o una USB |
| `NOMBRE_COMERCIAL`, `CEDULA_EMISOR`, `DIRECCION_EXACTA`, `TELEFONO` | Datos del negocio impresos en el tiquete |

## Instalar para varios clientes

Todos los clientes usan el mismo código. Lo que cambia por cliente es su carpeta de datos y su `.env`, así que actualizar a un cliente es instalar la versión nueva sin tocar sus datos.

Antes de actualizar una instalación conviene hacer un respaldo desde Administración → Respaldos.

## Pendiente

- Imprimir el tiquete directo a la impresora térmica, sin el diálogo de impresión.
- Anulación de ventas y devoluciones.
- Fondo inicial de caja en el cierre.
- Aviso al vender más de lo que hay en existencia.
- Pruebas automáticas.
- Firma del instalador y actualización automática.
