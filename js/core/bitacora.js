// Bitácora de cambios del dinero (Hallazgo #65): quién cambió qué, cuándo, y
// cómo estaba antes. Solo se AGREGA; nada la edita ni la borra desde la app.
//
// POR QUÉ SE CALCULA AQUÍ Y NO EN CADA ACCIÓN
// Hay más de cuarenta sitios que escriben dinero (abonos, reembolsos,
// comisiones, nómina, recibos, transferencias...). Anotar cada uno a mano deja
// fuera, tarde o temprano, el que se escriba mañana. En cambio TODA acción
// termina en persist(clave) (core/store.js), y persist es el único punto donde
// se ve el estado nuevo: aquí se compara contra una FOTO del estado anterior
// (la del último persist, o la de la carga) y la diferencia es la bitácora.
// Cubre toda acción actual y futura sin tocar ninguna.
//
// QUÉ SE COMPARA
// Solo los campos de DINERO de cada registro (monto, tipo, fecha, cuenta,
// concepto; total, descuento, IVA, abonos...), no cada cosa que se edite: una
// bitácora que anota hasta el color de una etiqueta deja de leerse. Los
// extractores de abajo son la lista de qué es dinero; sumar un campo nuevo es
// sumarlo ahí.
//
// DÓNDE VIVE
// En su propia pestaña de la Sheet, una fila por cambio (esquema en
// core/sheetsEsquemas.js). NUNCA como un blob en "kv" (límite de 50.000
// caracteres por celda, Hallazgo #42) y NO se reescribe entera en cada guardado:
// se le agregan filas al final (sheetsTabular.agregar).
//
// SIN RED
// Igual que core/guardado.js: la acción SIGUE y la anotación queda en una cola
// en el disco del navegador que se reintenta sola (al volver la red, al volver
// a la pestaña, cada 15 s). Si la pestaña muere antes, la cola se retoma en la
// próxima sesión. Un append que se reintenta puede repetir filas; quien lee
// descarta los ids repetidos.
//
// LO QUE NO ES
// No impide nada (los permisos de la app son de pantalla: quien tiene acceso a
// la Google Sheet puede editar o borrar filas a mano). Ayuda a VER qué pasó.

import { uid, num, fmt } from "./utils.js";
import { getSession } from "./auth.js";
import { tablaBitacora } from "./sheetsEsquemas.js";
import { mesDeFecha, periodoCerrado, nombreCuenta, nombreMetodoPago, pedidoCancelado, calcCotizacionTotales } from "./calc.js";

// ---------------------------------------------------------------------------
// Qué es "dinero" en cada registro
// ---------------------------------------------------------------------------
function s(v) { return v == null ? "" : String(v); }
function n(v) { return Math.round(num(v) * 100) / 100; }
function textoDescuento(d) {
  if (!d || !(num(d.valor) > 0)) return "";
  return (d.tipo === "porcentaje" ? num(d.valor) + "%" : fmt(d.valor)) + (d.motivo ? " (" + d.motivo + ")" : "");
}
function textoIva(i) { return i && i.activo ? num(i.porcentaje) + "%" : ""; }
function textoVendedor(v) {
  if (!v) return "";
  return s(v.nombre) + " · " + (v.tipo === "fijo" ? fmt(v.valor) : num(v.valor) + "%") + " · " + s(v.estado || "pendiente");
}

// Cada extractor recibe UN registro de la lista y devuelve sus "asientos" de
// bitácora: el registro mismo y, si los tiene, sus partes con dinero propio (los
// abonos de un pedido). { k: clave única, registroId, subId, padre, aspecto,
// etiqueta, campos }.
function regsTx(t) {
  return [{
    k: String(t.id), registroId: String(t.id), subId: "", aspecto: "movimiento",
    etiqueta: s(t.concepto || "Movimiento") + " (" + fmt(t.monto) + (t.fecha ? ", " + t.fecha : "") + ")",
    campos: { fecha: s(t.fecha), tipo: s(t.tipo), concepto: s(t.concepto), monto: n(t.monto), cuenta: s(t.cuenta), contraparte: s(t.contraparte), pedidoId: s(t.pedidoId), cotizacionId: s(t.cotizacionId) }
  }];
}

function rotuloPedido(p) { return s(p.numeroOp || "Pedido") + " · " + s(p.cliente || "sin cliente"); }
function regsPedido(p) {
  var rotulo = rotuloPedido(p);
  var out = [{
    k: String(p.id), registroId: String(p.id), subId: "", aspecto: "pedido", etiqueta: "Pedido " + rotulo,
    campos: { total: n(p.total), costo: n(p.costo), descuento: textoDescuento(p.descuento), iva: textoIva(p.iva), cancelado: pedidoCancelado(p) ? "sí" : "", vendedor: textoVendedor(p.vendedor) }
  }];
  (p.abonos || []).forEach(function (a) {
    if (!a || a.id == null) return;
    var reembolso = a.tipo === "reembolso";
    out.push({
      k: p.id + "#" + a.id, registroId: String(p.id), subId: s(a.id), padre: String(p.id), aspecto: reembolso ? "reembolso" : "abono",
      etiqueta: (reembolso ? "Reembolso" : "Abono") + " de " + fmt(a.monto) + " · " + rotulo,
      campos: { fecha: s(a.fecha), monto: n(a.monto), tipo: reembolso ? "reembolso" : "abono", cuenta: s(a.metodoPago) }
    });
  });
  ((p.consignacion && p.consignacion.ventas) || []).forEach(function (v) {
    if (!v || v.id == null) return;
    out.push({
      k: p.id + "#" + v.id, registroId: String(p.id), subId: s(v.id), padre: String(p.id), aspecto: "venta en consignación",
      etiqueta: "Venta en consignación de " + fmt(v.montoTotal) + " · " + rotulo,
      campos: { fecha: s(v.fecha), monto: n(v.montoTotal), comision: n(v.comisionMonto), comisionPagada: v.comisionPagada ? "sí" : "" }
    });
  });
  return out;
}

function regsCotizacion(c) {
  var total = "";
  try { total = n(calcCotizacionTotales(c).precioTotal); } catch (e) { total = ""; }
  return [{
    k: String(c.id), registroId: String(c.id), subId: "", aspecto: "cotización",
    etiqueta: "Cotización · " + s(c.descripcion || c.cliente || "sin nombre"),
    campos: { total: total, descuento: textoDescuento(c.descuento), iva: textoIva(c.iva), vendedor: textoVendedor(c.vendedor) }
  }];
}

function regsTransferencia(tr) {
  return [{
    k: String(tr.id), registroId: String(tr.id), subId: "", aspecto: "transferencia",
    etiqueta: "Transferencia de " + fmt(tr.monto) + " de " + nombreCuenta(tr.de) + " a " + nombreCuenta(tr.a) + (tr.fecha ? " (" + tr.fecha + ")" : ""),
    campos: { fecha: s(tr.fecha), de: s(tr.de), a: s(tr.a), monto: n(tr.monto), anulada: s(tr.anulada) }
  }];
}

function regsDeuda(d) {
  return [{
    k: String(d.id), registroId: String(d.id), subId: "", aspecto: "deuda", etiqueta: "Deuda «" + s(d.concepto) + "»",
    campos: { concepto: s(d.concepto), contraparte: s(d.contraparte), monto: n(d.monto), cuotas: n(d.cuotas), cuotasPagadas: n(d.cuotasPagadas), periodo: s(d.periodo) }
  }];
}

// La configuración es un solo registro con muchas partes de dinero.
function regsConfig(cfg) {
  var out = [];
  (cfg.cuentas || []).forEach(function (c) {
    if (!c || !c.id) return;
    out.push({ k: "cuenta:" + c.id, registroId: c.id, subId: "", aspecto: "cuenta", etiqueta: "Cuenta «" + s(c.nombre) + "»", campos: { nombre: s(c.nombre) } });
  });
  out.push({ k: "cuentaPredeterminada", registroId: "cuentaPredeterminada", subId: "", aspecto: "cuenta predeterminada", etiqueta: "Cuenta predeterminada", campos: { cuenta: s(cfg.cuentaPredeterminada) } });
  (cfg.gastosFijos || []).forEach(function (g) {
    if (!g || !g.id) return;
    out.push({ k: "gasto-fijo:" + g.id, registroId: g.id, subId: "", aspecto: "gasto fijo", etiqueta: "Gasto fijo «" + s(g.nombre) + "»", campos: { nombre: s(g.nombre), monto: n(g.monto), periodo: s(g.periodo) } });
  });
  (cfg.nomina || []).forEach(function (e) {
    if (!e || !e.id) return;
    out.push({ k: "nomina:" + e.id, registroId: e.id, subId: "", aspecto: "nómina", etiqueta: "Nómina · " + s(e.nombre), campos: { nombre: s(e.nombre), salario: n(e.salario), periodo: s(e.periodo) } });
  });
  (cfg.colchonMovimientos || []).forEach(function (m) {
    if (!m || !m.id) return;
    out.push({ k: "colchon:" + m.id, registroId: m.id, subId: "", aspecto: "colchón", etiqueta: "Colchón de " + fmt(m.monto), campos: { fecha: s(m.fecha), monto: n(m.monto), origen: s(m.origen) } });
  });
  return out;
}

// clave de `state` -> cómo sacar sus asientos. Las papeleras comparten el
// extractor de su lista principal.
var EXTRACTORES = {
  tx: regsTx, txPapelera: regsTx,
  pedidos: regsPedido, pedidosPapelera: regsPedido,
  cotizaciones: regsCotizacion,
  transferencias: regsTransferencia,
  deudas: regsDeuda, deudasHistorial: regsDeuda,
  config: regsConfig
};
export var CLAVES_BITACORA = Object.keys(EXTRACTORES);

// Una lista "de salida" de otra (papelera de movimientos, de pedidos, historial
// de deudas pagadas): lo que sale de la principal y entra aquí es un
// «eliminar», y lo que sale de aquí y vuelve a la principal es un «restaurar».
var SALIDA_DE = { txPapelera: "tx", pedidosPapelera: "pedidos", deudasHistorial: "deudas" };
var SALIDA_QUE_TIENE = { tx: "txPapelera", pedidos: "pedidosPapelera", deudas: "deudasHistorial" };
var DESTINO_TEXTO = { tx: "a la papelera", pedidos: "a la papelera", deudas: "al historial de deudas pagadas" };
var ORIGEN_RESTAURAR_TEXTO = { tx: "la papelera", pedidos: "la papelera", deudas: "el historial de deudas pagadas" };

var ETIQUETA_CAMPO = {
  fecha: "fecha", tipo: "tipo", concepto: "concepto", monto: "monto", cuenta: "cuenta", contraparte: "contraparte", pedidoId: "pedido", cotizacionId: "cotización",
  total: "total", costo: "costo", descuento: "descuento", iva: "IVA", cancelado: "cancelado", vendedor: "comisión del vendedor",
  comision: "comisión", comisionPagada: "comisión pagada", de: "sale de", a: "entra a", anulada: "anulada",
  nombre: "nombre", cuotas: "cuotas", cuotasPagadas: "cuotas pagadas", periodo: "periodo", salario: "salario", origen: "origen"
};
var CAMPOS_PLATA = { monto: 1, total: 1, costo: 1, comision: 1, salario: 1 };

function textoValor(campo, v) {
  if (v === "" || v == null) return "(vacío)";
  if (CAMPOS_PLATA[campo]) return fmt(v);
  if (campo === "cuenta") return nombreMetodoPago(v);
  if (campo === "de" || campo === "a") return nombreCuenta(v);
  return String(v);
}

function textoCambios(antes, despues) {
  var partes = [];
  Object.keys(despues).forEach(function (campo) {
    if (JSON.stringify(antes[campo]) === JSON.stringify(despues[campo])) return;
    partes.push((ETIQUETA_CAMPO[campo] || campo) + ": " + textoValor(campo, antes[campo]) + " → " + textoValor(campo, despues[campo]));
  });
  return partes.join("; ");
}

// ---------------------------------------------------------------------------
// La foto del estado anterior
// ---------------------------------------------------------------------------
var fotos = {};                 // clave -> { [idDelRegistro]: { firma, regs } }
var restauradosPendientes = {}; // clave principal -> { [id]: true } ya sacado de su papelera, a la espera de su persist

function listaDe(clave, datos) {
  var v = datos ? datos[clave] : null;
  if (clave === "config") return v ? [v] : [];
  return Array.isArray(v) ? v : [];
}
function idDe(clave, rec) { return clave === "config" ? "config" : (rec && rec.id != null ? String(rec.id) : ""); }
// Lo que decide si un registro cambió: su JSON entero. Para la configuración,
// solo las partes con dinero (el resto cambia seguido y no importa aquí).
function firmaDe(clave, rec) {
  if (clave === "config") {
    return JSON.stringify([rec.cuentas, rec.cuentaPredeterminada, rec.gastosFijos, rec.nomina, rec.colchonMovimientos]);
  }
  return JSON.stringify(rec);
}

// La foto de una lista. Un registro cuyo JSON no cambió reutiliza los asientos
// de la foto anterior (calcular el total de una cotización no es barato y se
// guarda muy seguido).
function fotografiar(clave, datos, previa) {
  var out = {};
  var extractor = EXTRACTORES[clave];
  var esSalida = !!SALIDA_DE[clave];
  listaDe(clave, datos).forEach(function (rec) {
    var id = idDe(clave, rec);
    if (!id || !rec) return;
    var firma = firmaDe(clave, rec);
    var p = previa && previa[id];
    if (p && p.firma === firma) { out[id] = p; return; }
    var regs;
    try { regs = extractor(rec); } catch (e) { regs = []; }
    // En una papelera solo importa el registro; sus partes (abonos...) viajan con él.
    if (esSalida) regs = regs.filter(function (r) { return !r.padre; });
    out[id] = { firma: firma, regs: regs };
  });
  return out;
}
function aplanar(foto) {
  var m = {};
  Object.keys(foto || {}).forEach(function (id) { foto[id].regs.forEach(function (r) { m[r.k] = r; }); });
  return m;
}

// Fija el punto de partida de una clave: lo que hay AHORA es el "antes" del
// próximo cambio. Se llama al cargar (loadAll) y al recargar una clave por la
// sincronización entre pestañas: lo que otra pestaña ya guardó no es un cambio
// de esta.
export function tomarFoto(clave, datos) {
  if (!EXTRACTORES[clave]) return;
  // Reutiliza los asientos de lo que no cambió desde la foto anterior (recargar
  // no tiene por qué recalcular el total de cada cotización otra vez).
  fotos[clave] = fotografiar(clave, datos, fotos[clave]);
  delete restauradosPendientes[clave];
}
export function tomarFotos(datos) { CLAVES_BITACORA.forEach(function (c) { tomarFoto(c, datos); }); }

// ---------------------------------------------------------------------------
// Quién y cuándo
// ---------------------------------------------------------------------------
var automatico = false;
// Mientras es true, lo que se guarda lo hace la app sola (las reparaciones que
// corre loadAll al cargar), no una persona: se anota como «automático».
export function modoAutomatico(valor) { automatico = !!valor; }

function actor() {
  if (automatico) return { usuario: "automatico", nombre: "Corrección automática al cargar", rol: "sistema", origen: "automatico" };
  var ses = getSession();
  return {
    usuario: (ses && ses.email) || "",
    nombre: (ses && (ses.vendedorNombre || ses.email)) || "Sin sesión",
    rol: (ses && ses.rol) || "",
    origen: "persona"
  };
}

function mesesDe(antes, despues) {
  var res = [];
  [antes, despues].forEach(function (c) {
    var m = c ? mesDeFecha(c.fecha) : "";
    if (m && res.indexOf(m) === -1) res.push(m);
  });
  return res;
}

function armarEntrada(base) {
  var a = actor();
  var meses = mesesDe(base.antes, base.despues);
  return {
    id: uid(), fecha: new Date().toISOString(),
    usuario: a.usuario, nombre: a.nombre, rol: a.rol, origen: base.origen || a.origen,
    clave: base.clave, registroId: s(base.registroId), subId: s(base.subId), aspecto: base.aspecto, accion: base.accion,
    etiqueta: base.etiqueta, cambios: base.cambios || "",
    antes: base.antes || null, despues: base.despues || null,
    meses: meses.join(","),
    enMesCerrado: meses.some(function (m) { return periodoCerrado(m + "-01"); }) ? "1" : ""
  };
}

// ---------------------------------------------------------------------------
// La diferencia
// ---------------------------------------------------------------------------
var MAX_ENTRADAS_POR_GUARDADO = 300;

// Compara `datos[clave]` con la foto anterior, anota la diferencia y deja la
// foto al día. Devuelve las entradas nuevas (ya encoladas). No lanza: una
// bitácora que falla no puede impedir que se guarde el dinero.
export function registrarCambios(clave, datos) {
  var entradas = [];
  try {
    if (!EXTRACTORES[clave]) return entradas;
    var previa = fotos[clave];
    var nueva = fotografiar(clave, datos, previa);
    fotos[clave] = nueva;
    if (!previa) return entradas; // nunca se cargó: no se inventa un «antes»
    var antes = aplanar(previa), ahora = aplanar(nueva);
    var principal = SALIDA_DE[clave]; // si esta clave es la papelera de otra, cuál

    Object.keys(ahora).forEach(function (k) {
      var r = ahora[k];
      var b = antes[k];
      if (principal) return; // lo que ENTRA a una papelera lo anotó la lista principal como «eliminar»
      if (!b) {
        if (r.padre) { if (antes[r.padre]) entradas.push(armarEntrada({ clave: clave, registroId: r.registroId, subId: r.subId, aspecto: r.aspecto, accion: "crear", etiqueta: r.etiqueta, despues: r.campos })); return; }
        var restaurado = esRestauracion(clave, String(r.registroId));
        entradas.push(armarEntrada({
          clave: clave, registroId: r.registroId, subId: r.subId, aspecto: r.aspecto, accion: restaurado ? "restaurar" : "crear",
          etiqueta: r.etiqueta, despues: r.campos, cambios: restaurado ? "Restaurado desde " + ORIGEN_RESTAURAR_TEXTO[clave] : ""
        }));
        return;
      }
      if (JSON.stringify(b.campos) !== JSON.stringify(r.campos)) {
        entradas.push(armarEntrada({ clave: clave, registroId: r.registroId, subId: r.subId, aspecto: r.aspecto, accion: "editar", etiqueta: r.etiqueta, antes: b.campos, despues: r.campos, cambios: textoCambios(b.campos, r.campos) }));
      }
    });

    Object.keys(antes).forEach(function (k) {
      if (ahora[k]) return;
      var b = antes[k];
      if (b.padre) { if (ahora[b.padre]) entradas.push(armarEntrada({ clave: clave, registroId: b.registroId, subId: b.subId, aspecto: b.aspecto, accion: "eliminar", etiqueta: b.etiqueta, antes: b.campos })); return; }
      if (principal) {
        // Salió de la papelera: o volvió a su lista (restaurar, lo anota ella) o se borró para siempre.
        var enPrincipal = listaDe(principal, datos).some(function (x) { return String(x.id) === b.registroId; });
        if (enPrincipal) {
          if (!fotos[principal] || !fotos[principal][b.registroId]) {
            (restauradosPendientes[principal] = restauradosPendientes[principal] || {})[b.registroId] = true;
          }
        } else {
          entradas.push(armarEntrada({ clave: principal, registroId: b.registroId, subId: "", aspecto: b.aspecto, accion: "eliminar", etiqueta: b.etiqueta, antes: b.campos, cambios: "Borrado para siempre (ya no se puede restaurar)" }));
        }
        return;
      }
      var par = SALIDA_QUE_TIENE[clave];
      var movido = par && listaDe(par, datos).some(function (x) { return String(x.id) === b.registroId; });
      entradas.push(armarEntrada({ clave: clave, registroId: b.registroId, subId: "", aspecto: b.aspecto, accion: "eliminar", etiqueta: b.etiqueta, antes: b.campos, cambios: movido ? "Movido " + DESTINO_TEXTO[clave] : "" }));
    });

    if (entradas.length > MAX_ENTRADAS_POR_GUARDADO) {
      var resto = entradas.length - MAX_ENTRADAS_POR_GUARDADO;
      entradas = entradas.slice(0, MAX_ENTRADAS_POR_GUARDADO);
      entradas.push(armarEntrada({ clave: clave, registroId: "", aspecto: "varios", accion: "editar", etiqueta: "…y " + resto + " cambios más en el mismo guardado", cambios: "La bitácora anota hasta " + MAX_ENTRADAS_POR_GUARDADO + " cambios por guardado." }));
    }
    if (entradas.length) encolar(entradas);
  } catch (e) {
    console.error("No se pudo anotar en la bitácora", clave, e);
  }
  return entradas;
}

function esRestauracion(clave, registroId) {
  var pend = restauradosPendientes[clave];
  if (pend && pend[registroId]) { delete pend[registroId]; return true; }
  var par = SALIDA_QUE_TIENE[clave];
  return !!(par && fotos[par] && fotos[par][registroId]);
}

// Un evento que no sale de comparar listas: cerrar o reabrir un mes. Queda con
// quién lo hizo y, al reabrir, el motivo.
export function anotarEvento(e) {
  var entrada = armarEntrada({
    clave: e.clave || "cierres", registroId: e.registroId, subId: "", aspecto: e.aspecto || "cierre de mes", accion: e.accion,
    etiqueta: e.etiqueta, cambios: e.cambios, antes: e.antes, despues: e.despues, origen: "persona"
  });
  entrada.meses = e.mes || "";
  entrada.enMesCerrado = "";
  encolar([entrada]);
  return entrada;
}

// ---------------------------------------------------------------------------
// La cola y el volcado a la Sheet
// ---------------------------------------------------------------------------
var COLA_KEY = "taller_bitacora_cola_v1";
var ESPERA_VOLCADO_MS = 1500;
var REINTENTO_MS = 15000;
var LOTE = 100;

var cola = null; // entradas todavía no escritas en la Sheet
var volcando = null;
var temporizador = null, temporizadorReintento = null;
var errorVolcado = "";
var ultimoVolcadoOk = 0;

// La Sheet de verdad; las pruebas la cambian por una en memoria.
var impl = {
  agregar: function (items, extra) { return tablaBitacora.agregar(items, extra); },
  leer: function () { return tablaBitacora.leer(); }
};
export function _configurarParaPruebas(o) {
  Object.keys(o || {}).forEach(function (k) { impl[k] = o[k]; });
  cola = null; cache = { cargada: false, cargando: false, error: "", filas: [] };
}
export function _reiniciarParaPruebas() {
  fotos = {}; restauradosPendientes = {}; automatico = false;
  cola = []; guardarCola(); errorVolcado = "";
  cache = { cargada: false, cargando: false, error: "", filas: [] };
  clearTimeout(temporizador); temporizador = null;
  clearTimeout(temporizadorReintento); temporizadorReintento = null;
}

function almacen() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch (e) { return null; }
}
function leerCola() {
  if (cola) return cola;
  cola = [];
  var ls = almacen();
  if (ls) {
    try { var raw = ls.getItem(COLA_KEY); var v = raw ? JSON.parse(raw) : []; if (Array.isArray(v)) cola = v; } catch (e) { cola = []; }
  }
  return cola;
}
function guardarCola() {
  var ls = almacen();
  if (!ls) return;
  try { if (leerCola().length) ls.setItem(COLA_KEY, JSON.stringify(cola)); else ls.removeItem(COLA_KEY); } catch (e) { /* cuota llena: se sigue con la copia en memoria */ }
}
function avisar() {
  if (typeof document !== "undefined" && document.dispatchEvent && typeof CustomEvent !== "undefined") {
    try { document.dispatchEvent(new CustomEvent("app:render")); } catch (e) { /* sin DOM */ }
  }
}

function encolar(entradas) {
  leerCola().push.apply(cola, entradas);
  guardarCola();
  // Lo anotado ya cuenta para la pantalla y para la verificación de salud sin
  // esperar a que llegue a la Sheet.
  programarVolcado();
}

export function programarVolcado() {
  if (temporizador || !leerCola().length) return;
  temporizador = setTimeout(function () { temporizador = null; volcar(); }, ESPERA_VOLCADO_MS);
}

function entradaInicial(primera) {
  var a = actor();
  var t = primera && primera.fecha ? new Date(Date.parse(primera.fecha) - 1).toISOString() : new Date().toISOString();
  return [{
    id: uid(), fecha: t, usuario: a.usuario, nombre: a.nombre, rol: a.rol, origen: "sistema",
    clave: "bitacora", registroId: "", subId: "", aspecto: "bitácora", accion: "inicio", etiqueta: "La bitácora empieza aquí",
    cambios: "Todo lo que pasó antes de esta fecha no tiene historial: la app no guardaba quién cambió qué. Desde aquí cada cambio de dinero queda anotado con quién, cuándo y cómo estaba antes.",
    antes: null, despues: null, meses: "", enMesCerrado: ""
  }];
}

// Escribe en la Sheet lo que esté en cola. Devuelve cuántas entradas quedan sin
// escribir. Nunca lanza: si falla, la cola se queda y se reintenta.
export function volcar() {
  if (volcando) return volcando;
  var lote = leerCola().slice(0, LOTE);
  if (!lote.length) return Promise.resolve(0);
  volcando = (async function () {
    try {
      await impl.agregar(lote, { alCrear: function () { return entradaInicial(lote[0]); } });
      var ids = {};
      lote.forEach(function (e) { ids[e.id] = true; });
      cola = leerCola().filter(function (e) { return !ids[e.id]; });
      guardarCola();
      if (cache.cargada) cache.filas = cache.filas.concat(lote);
      errorVolcado = "";
      ultimoVolcadoOk = Date.now();
    } catch (e) {
      errorVolcado = (typeof navigator !== "undefined" && navigator.onLine === false)
        ? "Sin conexión — se reintenta solo en cuanto vuelva."
        : (e && e.message ? e.message : String(e));
      console.error("No se pudo escribir la bitácora", e);
      programarReintento();
    }
  })().then(function () {
    volcando = null;
    avisar();
    if (!errorVolcado && leerCola().length) return volcar();
    return leerCola().length;
  });
  return volcando;
}

function programarReintento() {
  if (temporizadorReintento) return;
  temporizadorReintento = setTimeout(function () { temporizadorReintento = null; volcar(); }, REINTENTO_MS);
}
export function reintentarBitacora() { return volcar(); }

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", function () { volcar(); });
}
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", function () { if (!document.hidden) volcar(); });
}

export function estadoBitacora() {
  return { pendientes: leerCola().length, error: errorVolcado, ultimoOkEl: ultimoVolcadoOk };
}

// ---------------------------------------------------------------------------
// Leerla
// ---------------------------------------------------------------------------
var cache = { cargada: false, cargando: false, error: "", filas: [] };
var promesaCarga = null;

// Lee toda la bitácora de la Sheet (una vez por sesión, o de nuevo con
// `forzar`). Es solo para el admin: la pantalla y la verificación de salud.
export function cargarBitacora(forzar) {
  if (promesaCarga) return promesaCarga;
  if (cache.cargada && !forzar) return Promise.resolve(cache);
  cache.cargando = true; cache.error = "";
  promesaCarga = (async function () {
    try {
      cache.filas = await impl.leer();
      cache.cargada = true;
    } catch (e) {
      cache.error = e && e.message ? e.message : String(e);
    }
  })().then(function () {
    cache.cargando = false; promesaCarga = null;
    avisar();
    return cache;
  });
  return promesaCarga;
}
export function estadoLecturaBitacora() { return { cargada: cache.cargada, cargando: cache.cargando, error: cache.error }; }

// Todo lo que se sabe: lo leído de la Sheet y lo que aún espera en la cola,
// sin ids repetidos (un append reintentado puede haber duplicado filas).
export function entradasBitacora() {
  var vistos = {}, out = [];
  cache.filas.concat(leerCola()).forEach(function (e) {
    if (!e || !e.id || vistos[e.id]) return;
    vistos[e.id] = true;
    out.push(e);
  });
  return out;
}

// De las entradas, las que tocaron la plata de un mes cerrado DESPUÉS de que se
// cerró (con el cierre vigente). Las del propio cierre y la reapertura no
// cuentan, ni las de antes del cierre ni las hechas mientras estuvo reabierto.
export function tocadasDespuesDelCierre(cierre, entradas) {
  if (!cierre || cierre.estado !== "cerrado" || !cierre.cerradoEn) return [];
  return (entradas || []).filter(function (e) {
    if (!e || e.origen === "sistema" || e.accion === "cerrar-mes" || e.accion === "reabrir-mes" || e.accion === "inicio") return false;
    if (String(e.fecha) <= String(cierre.cerradoEn)) return false;
    if (String(e.meses || "").split(",").indexOf(cierre.mes) === -1) return false;
    // Cambiar solo a qué pedido o cotización apunta un movimiento (pasa al
    // convertir una cotización en pedido) no mueve plata de ningún mes.
    if (e.accion === "editar" && e.antes && e.despues) {
      var cambiados = Object.keys(e.despues).filter(function (k) { return JSON.stringify(e.antes[k]) !== JSON.stringify(e.despues[k]); });
      if (cambiados.length && cambiados.every(function (k) { return k === "pedidoId" || k === "cotizacionId"; })) return false;
    }
    return true;
  });
}
