// config/hacienda.js - Configuración de Hacienda

require('dotenv').config();

const haciendaConfig = {
  // Información del emisor (tu negocio)
  cedulaEmisor: process.env.CEDULA_EMISOR || '3101234567',
  nombreComercial: process.env.NOMBRE_COMERCIAL || 'Mi Negocio',
  codigoActividad: process.env.CODIGO_ACTIVIDAD || '6201',
  
  // Ubicación
  provincia: process.env.PROVINCIA || '1',
  canton: process.env.CANTON || '1',
  distrito: process.env.DISTRITO || '1',
  barrio: process.env.BARRIO || '1',
  direccionExacta: process.env.DIRECCION_EXACTA || 'San José',
  
  // Certificado
  certPath: process.env.CERT_PATH || './certs/test.p12',
  certPassword: process.env.CERT_PASSWORD || '',
  
  // API
  ambiente: process.env.AMBIENTE || 'pruebas',
  urlAPI: process.env.AMBIENTE === 'pruebas' 
    ? 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/'
    : 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
  
  // Formato de fecha Hacienda
  formatoFecha: () => new Date().toISOString(),
};

module.exports = haciendaConfig;