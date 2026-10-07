// utils/dbfInventario.js - Productos desde FacInve.DBF (dBase III, cp850)
//
// El DBF es la única fuente de productos. Se carga en memoria y se vuelve a
// leer cuando el archivo cambia en disco; las ventas descuentan CANT en el
// mismo archivo.

const fs = require("fs");
const iconv = require("iconv-lite");

const CODIFICACION = "cp850";
const CAMPOS_REQUERIDOS = ["CODIGO", "DESCRIP", "CANT", "VALORUNI"];
const MAX_RESULTADOS = 50;

// Código de tarifa de IVA de Hacienda según el porcentaje
const CODIGO_TARIFA = { 0: "01", 1: "02", 2: "03", 4: "04", 13: "08" };

class InventarioDBF {
  constructor(ruta) {
    this.ruta = ruta;
    this.firma = null;
    this.productos = [];
    this.porId = new Map();
  }

  // Lee el archivo completo. El id de cada producto es su número de registro
  // (CODIGO se repite en el DBF, así que no sirve como identificador).
  cargar() {
    if (!fs.existsSync(this.ruta)) {
      throw new Error(`No se encontró el archivo de productos: ${this.ruta}`);
    }

    const buf = fs.readFileSync(this.ruta);
    this.tamEncabezado = buf.readUInt16LE(8);
    this.tamRegistro = buf.readUInt16LE(10);
    this.totalRegistros = Math.min(
      buf.readUInt32LE(4),
      Math.floor((buf.length - this.tamEncabezado) / this.tamRegistro)
    );

    this.campos = {};
    let desplazamiento = 1; // el byte 0 del registro es la marca de borrado
    for (let pos = 32; pos < this.tamEncabezado && buf[pos] !== 0x0d; pos += 32) {
      const nombre = buf.toString("latin1", pos, pos + 11).replace(/\0.*$/, "");
      const largo = buf[pos + 16];
      this.campos[nombre] = { desplazamiento, largo, decimales: buf[pos + 17] };
      desplazamiento += largo;
    }

    const faltantes = CAMPOS_REQUERIDOS.filter((c) => !this.campos[c]);
    if (faltantes.length > 0) {
      throw new Error(`${this.ruta} no tiene los campos: ${faltantes.join(", ")}`);
    }

    const texto = (inicio, campo) => {
      const c = this.campos[campo];
      if (!c) return "";
      const ini = inicio + c.desplazamiento;
      return iconv.decode(buf.subarray(ini, ini + c.largo), CODIFICACION).trim();
    };
    const numero = (inicio, campo) => Number(texto(inicio, campo)) || 0;

    this.productos = [];
    this.porId = new Map();

    for (let i = 0; i < this.totalRegistros; i++) {
      const inicio = this.tamEncabezado + i * this.tamRegistro;
      if (buf[inicio] === 0x2a) continue; // registro borrado
      if (this.campos.ACTIVO && texto(inicio, "ACTIVO") === "0") continue;

      const codigo = texto(inicio, "CODIGO");
      const producto = {
        id: i + 1,
        codigo,
        codigo_barras: texto(inicio, "COD_BARRAS") || codigo,
        nombre: texto(inicio, "DESCRIP"),
        descripcion: texto(inicio, "NOTAS") || null,
        codigo_cabys: texto(inicio, "ID_CDPRSE"),
        // VALORUNI es el precio sin IVA
        precio_venta: numero(inicio, "VALORUNI"),
        impuesto_venta: texto(inicio, "PAGA_IV") === "S" ? numero(inicio, "PORCIV") : 0,
        stock_actual: numero(inicio, "CANT"),
        stock_minimo: numero(inicio, "MINIMO"),
        unidad_medida: texto(inicio, "UNID_MED") || "Unid",
        activo: 1
      };
      this.productos.push(producto);
      this.porId.set(producto.id, producto);
    }

    this.firma = this._firmaArchivo();
    return this.productos.length;
  }

  _firmaArchivo() {
    const { mtimeMs, size } = fs.statSync(this.ruta);
    return `${mtimeMs}:${size}`;
  }

  // Recarga si el DBF fue reemplazado o modificado por otro programa
  _sincronizar() {
    if (!fs.existsSync(this.ruta)) {
      throw new Error(`No se encontró el archivo de productos: ${this.ruta}`);
    }
    if (this.firma !== this._firmaArchivo()) this.cargar();
  }

  listar() {
    this._sincronizar();
    return this.productos;
  }

  obtener(id) {
    this._sincronizar();
    return this.porId.get(Number(id)) || null;
  }

  // Busca por nombre o código; las coincidencias exactas de código van primero
  buscar(busqueda) {
    this._sincronizar();
    const q = String(busqueda).trim().toLowerCase();
    if (!q) return [];

    const exactos = [];
    const parciales = [];
    for (const p of this.productos) {
      const codigo = p.codigo.toLowerCase();
      const barras = p.codigo_barras.toLowerCase();
      if (codigo === q || barras === q) {
        exactos.push(p);
      } else if (
        parciales.length < MAX_RESULTADOS &&
        (p.nombre.toLowerCase().includes(q) || codigo.includes(q) || barras.includes(q))
      ) {
        parciales.push(p);
      }
    }
    return exactos.concat(parciales).slice(0, MAX_RESULTADOS);
  }

  descontarStock(id, cantidad) {
    return this.ajustarStock(id, -cantidad);
  }

  // Suma (o resta, si es negativa) una cantidad a CANT en el DBF
  ajustarStock(id, cantidad) {
    this._sincronizar();
    const producto = this.porId.get(Number(id));
    if (!producto) throw new Error(`Producto ${id} no encontrado`);

    const nuevoStock = Math.round((producto.stock_actual + cantidad) * 100) / 100;
    const campo = this.campos.CANT;
    const posicion = this.tamEncabezado + (producto.id - 1) * this.tamRegistro + campo.desplazamiento;
    this._escribir([[posicion, this._codificarNumero("CANT", nuevoStock)]]);
    producto.stock_actual = nuevoStock;
    return producto;
  }

  // Agrega un registro nuevo al final del DBF
  agregar(data) {
    this._sincronizar();
    const codigo = String(data.codigo_barras ?? "").trim();
    const nombre = String(data.nombre ?? "").trim();
    const precio = Number(data.precio_venta);
    if (!codigo || !nombre) throw new Error("Código y nombre son requeridos");
    if (!Number.isFinite(precio) || precio < 0) throw new Error("Precio inválido");
    if (this.productos.some((p) => p.codigo === codigo || p.codigo_barras === codigo)) {
      throw new Error(`Ya existe un producto con el código ${codigo}`);
    }

    const impuesto = data.impuesto_venta === undefined ? 13 : Number(data.impuesto_venta) || 0;
    const valores = {
      CODIGO: codigo,
      COD_BARRAS: codigo,
      DESCRIP: nombre,
      NOTAS: data.descripcion || "",
      ID_CDPRSE: data.codigo_cabys || "",
      CANT: Number(data.stock_actual) || 0,
      VALORUNI: precio,
      PAGA_IV: impuesto > 0 ? "S" : "N",
      PORCIV: impuesto,
      MINIMO: Number(data.stock_minimo) || 0,
      ACTIVO: 1,
      UNID_MED: "Unid",
      CD_IMPUEST: "01",
      CDTARI_IVA: CODIGO_TARIFA[impuesto] || "08"
    };

    const registro = Buffer.alloc(this.tamRegistro + 1, 0x20);
    registro[this.tamRegistro] = 0x1a; // fin de archivo
    for (const [campo, valor] of Object.entries(valores)) {
      const c = this.campos[campo];
      if (!c) continue;
      const bytes =
        typeof valor === "number"
          ? this._codificarNumero(campo, valor)
          : iconv.encode(valor, CODIFICACION).subarray(0, c.largo);
      bytes.copy(registro, c.desplazamiento);
    }

    const total = Buffer.alloc(4);
    total.writeUInt32LE(this.totalRegistros + 1);
    this._escribir([
      [this.tamEncabezado + this.totalRegistros * this.tamRegistro, registro],
      [4, total]
    ]);

    this.cargar();
    return this.porId.get(this.totalRegistros);
  }

  _codificarNumero(campo, valor) {
    const c = this.campos[campo];
    const txt = valor.toFixed(c.decimales).padStart(c.largo, " ");
    if (txt.length > c.largo) throw new Error(`Valor ${valor} no cabe en el campo ${campo}`);
    return Buffer.from(txt, "latin1");
  }

  // Escribe [posición, bytes] en el archivo y actualiza la fecha del encabezado
  _escribir(escrituras) {
    const hoy = new Date();
    const fecha = Buffer.from([hoy.getFullYear() % 100, hoy.getMonth() + 1, hoy.getDate()]);
    const fd = fs.openSync(this.ruta, "r+");
    try {
      for (const [posicion, bytes] of escrituras) {
        fs.writeSync(fd, bytes, 0, bytes.length, posicion);
      }
      fs.writeSync(fd, fecha, 0, 3, 1);
    } finally {
      fs.closeSync(fd);
    }
    this.firma = this._firmaArchivo();
  }
}

module.exports = InventarioDBF;
