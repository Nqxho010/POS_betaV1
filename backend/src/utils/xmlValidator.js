// utils/xmlValidator.js - Validador de XML v4.4

const xmldom = require('xmldom');
const fs = require('fs');
const path = require('path');

class XMLValidator {
  /**
   * Validar estructura básica de XML v4.4
   * @param {string} xmlString - XML a validar
   * @returns {object} { válido: boolean, errores: array }
   */
  static validarEstructura(xmlString) {
    const errores = [];
    
    try {
      const parser = new xmldom.DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');
      
      // Validar que no haya errores de parsing
      if (doc.documentElement.nodeName === 'parsererror') {
        errores.push('XML malformado: ' + xmlString);
        return { válido: false, errores };
      }

      // Validar elementos obligatorios
      const elementosObligatorios = [
        'Encabezado',
        'DetalleServicio',
        'ResumenFactura',
      ];

      elementosObligatorios.forEach(elemento => {
        if (!doc.getElementsByTagName(elemento).length) {
          errores.push(`Elemento obligatorio faltante: ${elemento}`);
        }
      });

      // Validar Encabezado
      const encabezado = doc.getElementsByTagName('Encabezado')[0];
      if (encabezado) {
        const camposEncabezado = [
          'NumeroCedulaEmisor',
          'TipoComprobante',
          'FechaEmision',
          'Moneda'
        ];
        
        camposEncabezado.forEach(campo => {
          if (!encabezado.getElementsByTagName(campo).length) {
            errores.push(`Campo obligatorio en Encabezado: ${campo}`);
          }
        });
      }

      // Validar DetalleServicios
      const detalles = doc.getElementsByTagName('LineaDetalle');
      if (detalles.length === 0) {
        errores.push('DetalleServicios: Debe haber al menos una LineaDetalle');
      }

      // El NodeList de xmldom no tiene forEach
      Array.from({ length: detalles.length }, (_, i) => detalles.item(i)).forEach((detalle, index) => {
        const camposObligatorios = [
          'NumeroLineaDetalle',
          'CodigoActividad',
          'DescripcionProducto',
          'Cantidad',
          'PrecioUnitario',
          'SubTotal'
        ];
        
        camposObligatorios.forEach(campo => {
          if (!detalle.getElementsByTagName(campo).length) {
            errores.push(`LineaDetalle ${index + 1}: Falta campo ${campo}`);
          }
        });
      });

      // Validar ResumenFactura
      const resumen = doc.getElementsByTagName('ResumenFactura')[0];
      if (resumen) {
        const camposResumen = [
          'TotalComprobante'
        ];
        
        camposResumen.forEach(campo => {
          if (!resumen.getElementsByTagName(campo).length) {
            errores.push(`ResumenFactura: Falta campo ${campo}`);
          }
        });
      }

      return {
        válido: errores.length === 0,
        errores: errores.length > 0 ? errores : [],
        estructura: 'v4.4'
      };

    } catch (error) {
      return {
        válido: false,
        errores: ['Error al parsear XML: ' + error.message]
      };
    }
  }

  /**
   * Validar valores numéricos
   */
  static validarValoresNumericos(xmlString) {
    const errores = [];
    
    try {
      // Regex para encontrar valores entre tags
      const cantidad = xmlString.match(/<Cantidad>([^<]+)<\/Cantidad>/);
      const precio = xmlString.match(/<PrecioUnitario>([^<]+)<\/PrecioUnitario>/);
      const subtotal = xmlString.match(/<SubTotal>([^<]+)<\/SubTotal>/);

      if (cantidad && isNaN(parseFloat(cantidad[1]))) {
        errores.push('Cantidad debe ser numérica');
      }
      if (precio && isNaN(parseFloat(precio[1]))) {
        errores.push('PrecioUnitario debe ser numérico');
      }
      if (subtotal && isNaN(parseFloat(subtotal[1]))) {
        errores.push('SubTotal debe ser numérico');
      }

      return {
        válido: errores.length === 0,
        errores
      };

    } catch (error) {
      return {
        válido: false,
        errores: ['Error validando valores numéricos: ' + error.message]
      };
    }
  }

  /**
   * Validación completa
   */
  static validar(xmlString) {
    const validacionEstructura = this.validarEstructura(xmlString);
    const validacionNumerica = this.validarValoresNumericos(xmlString);

    const todosLosErrores = [
      ...validacionEstructura.errores,
      ...validacionNumerica.errores
    ];

    return {
      válido: validacionEstructura.válido && validacionNumerica.válido,
      errores: todosLosErrores,
      estructura: 'v4.4'
    };
  }
}

module.exports = XMLValidator;