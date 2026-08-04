// Único punto de mutación del stock de productos terminados (prendas ya
// hechas, ver modules/productos.js) — se usa tanto desde el propio catálogo
// (registrar entrada manual) como desde Pedidos (venta directa) y
// Cotizaciones/Consignación (salida al vender o al entregar en remisión).
// Centralizarlo acá (en vez de mutar state.productos directo en cada módulo)
// garantiza que CADA ajuste, sin importar de dónde venga, quede también en
// `movimientosStock` — es la bitácora que documenta de dónde salió/entró
// cada unidad, para poder armar reportes de ganancia reales más adelante.
//
// No vive en core/calc.js a propósito: ese archivo es de funciones puras de
// lectura (no persisten nada); esto sí muta `state` y llama a persist().

import { state, persist } from "./store.js";
import { uid, todayStr, num } from "./utils.js";

// delta positivo = entrada (repone stock), delta negativo = salida (venta,
// remisión de consignación...). La talla debe existir YA como variante del
// producto (se crea a mano en Productos) — así se evita que un origen
// externo (ej. un select mal armado) cree tallas nuevas por error de tipeo.
//
// Devuelve el delta REALMENTE aplicado (no el pedido) — nunca deja bajar de
// 0, así que si se pide una salida mayor a lo disponible, el valor devuelto
// es menor en magnitud que `delta`. Esto es a propósito: quien llama a esta
// función SIEMPRE debe guardar el valor de retorno (no el que pidió) en
// cualquier registro que luego se use para revertir el movimiento (ej.
// pedido.stockConsumido) — si se guardara lo pedido en vez de lo aplicado,
// eliminar después ese pedido/remisión restituiría de más y el stock
// terminaría descuadrado (el bug reportado: pedir 2 con 1 de stock, cancelar,
// terminar con 3). 0 = no se movió nada (talla inexistente o delta 0).
export function ajustarStockProducto(productoId, talla, delta, motivo, origen) {
  var producto = (state.productos || []).filter(function (p) { return p.id === productoId; })[0];
  if (!producto) return 0;
  var variante = (producto.variantesTalla || []).filter(function (v) { return v.talla === talla; })[0];
  if (!variante || !delta) return 0;

  var stockActual = num(variante.stock);
  var stockNuevo = Math.max(0, stockActual + delta);
  var real = stockNuevo - stockActual;
  if (!real) return 0;

  var movimiento = {
    id: uid(), fecha: todayStr(), tipo: real > 0 ? "entrada" : "salida",
    talla: talla, cantidad: Math.abs(real), nota: motivo || "", origen: origen || ""
  };
  state.productos = state.productos.map(function (p) {
    if (p.id !== productoId) return p;
    var nuevasVariantes = (p.variantesTalla || []).map(function (v) {
      return v.talla === talla ? Object.assign({}, v, { stock: stockNuevo }) : v;
    });
    var movimientos = [movimiento].concat(p.movimientosStock || []); // más reciente primero
    return Object.assign({}, p, { variantesTalla: nuevasVariantes, movimientosStock: movimientos });
  });
  persist("productos");
  return real;
}

// ---------- Propuestas de vendedor (precio de venta / movimiento manual de stock) ----------
// A diferencia de catalogoInsumos/catalogoCategorias (donde TODA escritura a
// esa clave pasa por el mismo gate en persist(), ver store.js), acá NO se
// puede gatear la clave completa: la enorme mayoría de los cambios a
// state.productos son bajas de stock automáticas por una venta o remisión
// REAL (ver ajustarStockProducto arriba), que deben aplicarse ya mismo —
// bloquearlas tras aprobación dejaría el stock desactualizado y sería
// exactamente el tipo de desincronización que se busca evitar. Por eso solo
// dos acciones puntuales del vendedor —precio de venta, y un "Registrar
// movimiento" manual de stock— quedan pendientes. Se guardan como un parche
// quirúrgico por producto (no una copia de la lista completa) para que
// aprobarlas más tarde se aplique sobre el producto TAL COMO ESTÉ en ese
// momento, nunca sobre una foto vieja que ya no refleje ventas más recientes
// (evita que aprobar una propuesta atrasada pise cambios que pasaron después).
export function proponerCambioProducto(producto, tipo, payload, session) {
  var autor = (session && (session.vendedorNombre || session.email)) || "Vendedor";
  var propuesta = { id: uid(), tipo: tipo, productoId: producto.id, productoNombre: producto.nombre, autor: autor, fecha: new Date().toISOString(), payload: payload };
  state.productoPropuestas = (state.productoPropuestas || []).concat([propuesta]);
  persist("productoPropuestas");
  return propuesta;
}

export function aprobarPropuestaProducto(id) {
  var propuesta = (state.productoPropuestas || []).filter(function (p) { return p.id === id; })[0];
  if (!propuesta) return;
  if (propuesta.tipo === "movimiento") {
    var pl = propuesta.payload;
    var delta = pl.tipoMov === "salida" ? -num(pl.cantidad) : num(pl.cantidad);
    ajustarStockProducto(propuesta.productoId, pl.talla, delta, (pl.nota || "") + " (aprobado — propuesto por " + propuesta.autor + ")", "propuesta:" + propuesta.id);
  } else if (propuesta.tipo === "campo") {
    state.productos = (state.productos || []).map(function (p) {
      if (p.id !== propuesta.productoId) return p;
      var patch = {}; patch[propuesta.payload.campo] = propuesta.payload.valorNuevo;
      return Object.assign({}, p, patch);
    });
    persist("productos");
  }
  state.productoPropuestas = (state.productoPropuestas || []).filter(function (p) { return p.id !== id; });
  persist("productoPropuestas");
}

export function descartarPropuestaProducto(id) {
  state.productoPropuestas = (state.productoPropuestas || []).filter(function (p) { return p.id !== id; });
  persist("productoPropuestas");
}
