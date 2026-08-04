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
// externo (ej. un select mal armado) cree tallas nuevas por error de tipeo;
// si la talla no existe, no hace nada y devuelve false.
export function ajustarStockProducto(productoId, talla, delta, motivo, origen) {
  var producto = (state.productos || []).filter(function (p) { return p.id === productoId; })[0];
  if (!producto) return false;
  var variantes = producto.variantesTalla || [];
  var existe = variantes.some(function (v) { return v.talla === talla; });
  if (!existe || !delta) return false;

  var movimiento = {
    id: uid(), fecha: todayStr(), tipo: delta > 0 ? "entrada" : "salida",
    talla: talla, cantidad: Math.abs(delta), nota: motivo || "", origen: origen || ""
  };
  state.productos = state.productos.map(function (p) {
    if (p.id !== productoId) return p;
    var nuevasVariantes = (p.variantesTalla || []).map(function (v) {
      if (v.talla !== talla) return v;
      return Object.assign({}, v, { stock: Math.max(0, num(v.stock) + delta) });
    });
    var movimientos = [movimiento].concat(p.movimientosStock || []); // más reciente primero
    return Object.assign({}, p, { variantesTalla: nuevasVariantes, movimientosStock: movimientos });
  });
  persist("productos");
  return true;
}
