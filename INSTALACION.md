╔════════════════════════════════════════════════════════════════╗
║  POS COSTA RICA - GUÍA DE INSTALACIÓN Y EJECUCIÓN             ║
╚════════════════════════════════════════════════════════════════╝

## 📋 REQUISITOS PREVIOS

- Node.js v16+ (descargar desde https://nodejs.org/)
- npm o yarn
- Git (opcional)

## 🚀 INSTALACIÓN RÁPIDA

### OPCIÓN 1: Instalación desde cero (recomendado para entender)

#### PASO 1: Crear la estructura de carpetas

```bash
mkdir -p pos-costarica/backend pos-costarica/frontend
cd pos-costarica
```

#### PASO 2: Configurar el BACKEND

```bash
cd backend

# Crear package.json
npm init -y

# Instalar dependencias necesarias
npm install express cors sqlite3 jsonwebtoken dotenv

# Crear carpeta src
mkdir src
mkdir src/config
mkdir src/services
mkdir src/routes
mkdir src/middleware

# Copiar el archivo backend-app.js a src/app.js
# (ve las instrucciones abajo)
```

**package.json del backend:**

```json
{
  "name": "pos-backend",
  "version": "1.0.0",
  "description": "Backend del POS Costa Rica",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "sqlite3": "^5.1.6",
    "jsonwebtoken": "^9.0.0",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

#### PASO 3: Crear archivo .env del backend

```bash
# backend/.env
PORT=5000
JWT_SECRET=tu-clave-muy-segura-cambiar-en-produccion
NODE_ENV=development
DATA_DIR=
```

#### PASO 4: Iniciar el backend

```bash
npm install
npm start
```

Deberías ver:
```
╔════════════════════════════════════════╗
║   POS Costa Rica - Backend Iniciado   ║
║   Puerto: 5000                         ║
║   http://localhost:5000                ║
╚════════════════════════════════════════╝
```

---

#### PASO 5: Configurar el FRONTEND (en otra terminal)

```bash
cd frontend

# Opción A: Usar Create React App
npx create-react-app .
npm install axios

# O Opción B: Usar Vite (más rápido)
npm create vite@latest . -- --template react
npm install

# Reemplazar los archivos:
# - src/App.jsx (con frontend-App.jsx)
# - src/App.css (con frontend-App.css)
```

**package.json del frontend:**

```json
{
  "name": "pos-frontend",
  "version": "1.0.0",
  "description": "Frontend del POS Costa Rica",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "eslintConfig": {
    "extends": ["react-app"]
  },
  "browserslist": {
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
  }
}
```

#### PASO 6: Iniciar el frontend

```bash
npm start
```

Se abrirá automáticamente en http://localhost:3000

---

## 🧪 PRUEBA LA APLICACIÓN

### 1. Pantalla de Login
```
Usuario: cajero
Contraseña: 1234
```

### 2. Productos

Los productos se leen de `backend/database/FacInve.DBF`. Para actualizar el
catálogo basta con reemplazar ese archivo (no hace falta reiniciar).

Para agregar un producto suelto al DBF, abre otra terminal y ejecuta:

```bash
curl -X POST http://localhost:5000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InlvdXJfdXNlciIsImlhdCI6MTc4MjEwMzcwOCwiZXhwIjoxNzgyMTMyNTA4fQ.A5zYHD-DYXZocSFWZYIepoSwikDPgos6OiNu99bq-5c]" \
  -d '{
    "codigo_barras": "001",
    "nombre": "Arroz Premium",
    "codigo_cabys": "6201",
    "precio_con_iva": 5000,
    "utilidad": 30,
    "stock_actual": 100
  }'
```

(Reemplaza [TU_TOKEN] con el token que recibas al login)

### 3. Simula una venta

- Busca "arroz" en el POS
- Agrega 2 unidades
- Selecciona "Efectivo"
- Ingresa monto recibido: 15000
- Click en "COBRAR"

Verás un resumen de la venta completada ✓

---

## 📁 ESTRUCTURA FINAL

```
pos-costarica/
├── backend/
│   ├── src/
│   │   └── app.js          (servidor principal)
│   ├── package.json
│   ├── .env
│   └── database/
│       ├── pos.db          (usuarios y auditoría; se crea automáticamente)
│       ├── hacienda.db     (ventas, tiquetes y comprobantes; se crea automáticamente)
│       └── FacInve.DBF     (productos e inventario; lo debes copiar aquí)
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.jsx         (componente principal)
│   │   ├── App.css         (estilos)
│   │   ├── index.js
│   │   └── index.css
│   ├── package.json
│   └── .gitignore
```

---

## 🔧 INSTALACIÓN DESDE ARCHIVOS PROPORCIONADOS

Si ya tienes los archivos:

### Backend

1. Copia `backend-app.js` → `backend/src/app.js`
2. Crea `backend/package.json` (ver arriba)
3. Crea `backend/.env` (ver arriba)
4. Corre `npm install` y `npm start`

### Frontend

1. Copia `frontend-App.jsx` → `frontend/src/App.jsx`
2. Copia `frontend-App.css` → `frontend/src/App.css`
3. Copia `POS_ESQUELETO.md` → documentación de referencia
4. Corre `npm install` y `npm start`

---

## 🐛 TROUBLESHOOTING

### "Cannot find module 'express'"
```bash
npm install express cors sqlite3 jsonwebtoken
```

### "Port 5000 already in use"
```bash
# Cambiar puerto en backend/.env
PORT=5001

# O matar el proceso:
# En Windows: netstat -ano | findstr :5000
# En Mac/Linux: lsof -i :5000 | grep -v PID | awk '{print $2}' | xargs kill
```

### "Cannot GET /api/products"
- ¿Iniciaste el backend? (npm start en carpeta backend)
- ¿Está en puerto 5000?
- ¿Pasaste el token en el header Authorization?

### CORS Error
Asegúrate que el backend tiene CORS habilitado:
```javascript
app.use(cors());
```

---

## 🚀 PRÓXIMOS PASOS - INTEGRACIÓN REAL CON HACIENDA

Una vez el POS funcione localmente:

1. **Firma Digital**
   - Obtener certificado del BCR (Banco Central Costa Rica)
   - Instalar librería xmlsec1 o equivalente
   - Implementar firma XAdES-EPES en facturacionService

2. **Integración API Hacienda**
   - Obtener credenciales de prueba (ATV)
   - Cambiar facturacionService.sendToHacienda() para envío real
   - Probar en sandbox (stag) antes de producción (prod)

3. **Base de datos real**
   - Cambiar de SQLite en memoria a archivo persistente
   - O migrar a PostgreSQL/MySQL para múltiples usuarios

4. **Autenticación**
   - Implementar registro y login real
   - Multi-usuario con permisos por rol (Cajero, Gerente, Admin)

5. **Modo Offline**
   - Guardar ventas localmente cuando no hay internet
   - Sincronizar con Hacienda automáticamente
   - Manejar rechazos y reintentos

---

## 📚 REFERENCIAS

- **Documentación Hacienda**: https://hacienda.go.cr/
- **ATV Portal**: https://atv.hacienda.go.cr/ATV/
- **API Hacienda**: https://api.hacienda.go.cr/docs
- **Especificación v4.4**: https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx
- **Github Comunidad**: https://github.com/CRLibre/API_Hacienda

---

## 💡 TIPS

- Para desarrollo: usa `nodemon` en backend (`npm install -D nodemon`)
- Para testing: usa Postman o Thunder Client para probar endpoints
- Guarda los tokens en localStorage (el frontend ya lo hace)
- En producción: usa variables de entorno para secretos
- Implementa logging para auditoría de transacciones

---

¡Listo! Tenés un POS funcional. Ahora es solo agregar las capas de Hacienda, autenticación real y casos de uso más complejos.

¿Preguntas? Revisa POS_ESQUELETO.md para entender la arquitectura en detalle.

---

## 🖥️ Aplicación de escritorio (beta)

La carpeta `desktop/` empaqueta el backend y el frontend en una app de Windows (Electron).

```bash
cd desktop
npm install
npm run dist
```

El instalador queda en `desktop/dist/POS Costa Rica Setup <versión>.exe`.
Para probar sin instalar: `npm run build:frontend` y luego `npm start`.

Los datos de cada cliente quedan en `%APPDATA%\POS Costa Rica\datos`
(menú **Archivo → Abrir carpeta de datos**):

- `.env` — se crea en el primer arranque con su propia `JWT_SECRET` y `ADMIN_PASSWORD`;
  ahí se completan la cédula y el nombre comercial del negocio.
- `database/FacInve.DBF` — hay que copiarlo; `pos.db` y `hacienda.db` se crean solos.
- `comprobantes/` — XML generados.
