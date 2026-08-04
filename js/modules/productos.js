// Catálogo de prendas YA HECHAS (no personalizadas — a lo mucho cambia la
// talla) que sí conviene tener en stock, a diferencia de una cotización a la
// medida. Un producto es "casi lo mismo que una plantilla de prenda" (mismos
// insumos/flujo de producción/consumo, para documentar el costeo real) pero
// con precio de venta y stock por talla — se puede vender directo en un
// pedido, entregar en consignación, o aplicar en una cotización igual que una
// plantilla. Ver js/core/stock.js (ajustarStockProducto) para cómo se
// descuenta/repone el stock desde cualquiera de esos flujos.
import { state, persist, notify } from "../core/store.js";
import { esc, num, uid, val } from "../core/utils.js";
import { renderTipoCostoOptions, renderHelp } from "../core/components.js";
import { subirImagenReferencia } from "../core/drive.js";
import { ajustarStockProducto } from "../core/stock.js";
import { calcRefTotales, stockTotalProducto } from "../core/calc.js";

var INS_COLS = "1fr 60px 90px 150px 70px 30px";
var TALLA_COLS = "1fr 90px 30px";
var MOV_COLS = "90px 90px 70px 70px 1fr";

export function render() {
  var lista = state.productos || [];
  var plantillas = state.plantillasPrendas || [];
  var html = '<div class="card"><div class="section-title small">Catálogo de productos' +
    renderHelp("Prendas ya hechas o repetibles (no personalizadas — a lo mucho cambia la talla) que sí conviene tener en stock, a diferencia de una cotización a la medida. Se pueden vender directo en un pedido, entregar en consignación, o aplicar en una cotización (como una plantilla, pero con precio y stock ya definidos). El stock solo baja cuando de verdad sale del taller (venta o remisión), nunca al cotizar.") +
    '</div><div class="pedido-actions" style="flex-wrap:wrap;">' +
    '<button class="btn ghost small" data-action="add-producto">+ Nuevo producto</button>' +
    (plantillas.length ? (
      '<select class="mini-input" style="max-width:260px" data-action-change="add-producto-desde-plantilla">' +
      '<option value="">+ Nuevo producto desde plantilla…</option>' +
      plantillas.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") +
      "</select>"
    ) : "") +
    "</div></div>";

  if (lista.length === 0) { html += '<div class="empty">Todavía no tienes productos en el catálogo.</div>'; return html; }

  lista.forEach(function (p) { html += renderProductoCard(p); });
  return html;
}

function renderProductoThumb(p) {
  if (state.productoImagenSubiendo[p.id]) {
    return '<span class="ref-thumb ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</span>';
  }
  if (p.imagenUrl) {
    return '<span class="ref-thumb" style="width:64px;height:64px;" data-action="set-pro-imagen" data-id="' + p.id + '" title="Clic para subir otra foto desde tu dispositivo">' +
      '<img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-zoom" data-action="abrir-imagen-preview" data-url="' + esc(p.imagenUrl) + '" title="Ver en grande">🔍</button>' +
      '<button class="ref-thumb-remove" data-action="quitar-pro-imagen" data-id="' + p.id + '" title="Quitar foto">✕</button>' +
      "</span>";
  }
  return '<span class="ref-thumb ref-thumb-empty" style="width:64px;height:64px;" data-action="set-pro-imagen" data-id="' + p.id + '" title="Subir una foto desde tu dispositivo (se guarda en tu Google Drive)">+ foto</span>';
}

function renderProductoCard(p) {
  var flujos = state.plantillasEstados || [];
  var tallas = p.variantesTalla || [];
  var stockTotal = stockTotalProducto(p);
  // Reusa el mismo cálculo de costo/ganancia que una referencia de cotización
  // (calcRefTotales) tratando el producto como si fuera "una referencia de
  // cantidad 1" — mismos insumos, mismo consumo sugerido — para que el
  // margen se documente con la misma fórmula en toda la app.
  var calc = calcRefTotales({ consumoAprox: p.consumoSugerido, cantidadPedida: 1, precioVenta: p.precioVenta, insumos: p.insumos });

  var html = '<div class="card nested" data-producto-id="' + p.id + '">' +
    '<div class="pedido-top" style="align-items:flex-start;">' + renderProductoThumb(p) +
    '<div class="form-grid" style="flex:1;grid-template-columns:2fr 1fr 1fr 1fr;">' +
    '<div class="field"><label>Nombre del producto</label><input class="mini-input" style="width:100%" value="' + esc(p.nombre) + '" placeholder="Ej. Camiseta básica algodón" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="nombre" /></div>' +
    '<div class="field"><label>Precio de venta</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.precioVenta) + '" placeholder="0" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="precioVenta" /></div>' +
    '<div class="field"><label>Consumo de tela sugerido (MT)</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.consumoSugerido || "") + '" placeholder="Ej. 1.2" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="consumoSugerido" /></div>' +
    '<div class="field"><label>Flujo de producción</label><select class="mini-input" style="width:100%" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="flujoEstadosId">' +
    '<option value="">Estándar</option>' +
    flujos.map(function (f) { return '<option value="' + f.id + '" ' + (p.flujoEstadosId === f.id ? "selected" : "") + '>' + esc(f.nombre) + " (" + f.estados.length + " etapas)</option>"; }).join("") +
    "</select></div>" +
    '</div><button class="btn danger small" data-action="remove-producto" data-id="' + p.id + '">Eliminar producto</button></div>';

  html += '<div class="ref-summary" style="margin-top:14px;">' +
    '<div class="rs-item"><div class="rl">Stock total</div><div class="rv">' + stockTotal + "</div></div>" +
    '<div class="rs-item"><div class="rl">Costo x unidad</div><div class="rv">' + esc(fmtMoney(calc.costoUnit)) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia x unidad</div><div class="rv" style="color:' + (calc.gananciaUnit >= 0 ? "var(--success)" : "var(--danger)") + ';">' + esc(fmtMoney(calc.gananciaUnit)) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Margen</div><div class="rv"><span class="margen-badge ' + (calc.margenPct >= 0 ? "pos" : "neg") + '">' + calc.margenPct.toFixed(1) + "%</span></div></div>" +
    "</div>";

  html += '<div class="cot-col-title" style="margin-top:18px;">Tallas y stock' +
    renderHelp("El stock de cada talla solo se ajusta desde acá (\"Registrar movimiento\") o automáticamente cuando el producto sale del taller de verdad — al venderlo en un pedido o al entregarlo en una remisión de consignación. Nunca baja solo por cotizarlo.") +
    "</div>";
  if (tallas.length) {
    html += '<div class="detalle-table"><div class="det-row head" style="grid-template-columns:' + TALLA_COLS + ';"><span>Talla</span><span>Stock</span><span></span></div>';
    tallas.forEach(function (t) {
      html += '<div class="det-row" style="grid-template-columns:' + TALLA_COLS + ';">' +
        '<span class="mobile-th">Talla</span><input class="mini-input" value="' + esc(t.talla) + '" data-action-change="set-pro-talla-campo" data-pro="' + p.id + '" data-talla="' + t.id + '" />' +
        '<span class="mobile-th">Stock</span><span class="amount">' + num(t.stock) + "</span>" +
        '<button class="btn danger small" data-action="remove-pro-talla" data-pro="' + p.id + '" data-talla="' + t.id + '">✕</button>' +
        "</div>";
    });
    html += "</div>";
  } else {
    html += '<div class="empty" style="padding:8px 0;">Sin tallas aún — agrega la primera abajo.</div>';
  }
  html += '<div class="inline-form">' +
    '<input class="mini-input" data-role="nueva-talla-' + p.id + '" placeholder="Talla (ej. S, M, Única)" style="width:140px" />' +
    '<button class="btn ghost small" data-action="add-pro-talla" data-id="' + p.id + '">+ Agregar talla</button>' +
    "</div>";

  if (tallas.length) {
    html += '<div class="inline-form" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);flex-wrap:wrap;">' +
      '<select class="mini-input" data-role="stock-talla-' + p.id + '" style="width:110px">' +
      tallas.map(function (t) { return '<option value="' + esc(t.talla) + '">' + esc(t.talla) + "</option>"; }).join("") +
      "</select>" +
      '<select class="mini-input" data-role="stock-tipo-' + p.id + '" style="width:130px">' +
      '<option value="entrada">Entrada (+)</option><option value="salida">Salida / merma (-)</option>' +
      "</select>" +
      '<input type="number" class="mini-input" data-role="stock-cantidad-' + p.id + '" placeholder="Cantidad" style="width:100px" />' +
      '<input class="mini-input" data-role="stock-nota-' + p.id + '" placeholder="Nota (ej. nuevo lote, dañada...)" style="width:220px" />' +
      '<button class="btn ghost small" data-action="add-pro-stock" data-id="' + p.id + '">Registrar movimiento</button>' +
      "</div>";
  }

  html += renderMovimientosStock(p);

  html += '<hr class="stitch" />';
  html += '<div class="cot-col-title">Insumos' + renderHelp("Igual que en Plantillas: la receta de insumos de este producto, para que el costo/ganancia de arriba se calcule solo.") + "</div>";
  html += '<div class="ins-table"><div class="ins-row head" style="grid-template-columns:' + INS_COLS + ';"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant./mult.</span><span></span></div>';
  (p.insumos || []).forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:' + INS_COLS + ';">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" value="' + esc(i.unidad) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<span class="mobile-th">Cant./mult.</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<button class="btn danger small" data-action="remove-pro-insumo" data-pro="' + p.id + '" data-ins="' + i.id + '">✕</button>' +
      "</div>";
  });
  if ((p.insumos || []).length === 0) { html += '<div class="empty" style="padding:12px 0;">Sin insumos en este producto.</div>'; }
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
    '<select class="mini-input" style="max-width:240px" data-action-change="add-pro-insumo-catalogo" data-pro="' + p.id + '">' +
    '<option value="">+ Agregar desde catálogo…</option>' +
    (state.catalogoInsumos || []).map(function (item) { return '<option value="' + item.id + '">' + esc(item.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<button class="btn ghost small" data-action="add-pro-insumo-custom" data-pro="' + p.id + '">+ Insumo personalizado</button>' +
    "</div>";

  html += "</div>"; // .card.nested
  return html;
}

// Bitácora de entradas/salidas de stock — colapsada por defecto (puede
// crecer bastante con el tiempo), un clic la despliega completa.
function renderMovimientosStock(p) {
  var movimientos = p.movimientosStock || [];
  var abierto = state.productoMovimientosAbierto === p.id;
  var html = '<div class="section-sub" style="margin:10px 0 0;cursor:pointer;" data-action="toggle-pro-movimientos" data-id="' + p.id + '">' +
    (abierto ? "▾" : "▸") + " Movimientos de stock (" + movimientos.length + ")" +
    "</div>";
  if (!abierto || !movimientos.length) return html;
  html += '<div class="tx-row head" style="grid-template-columns:' + MOV_COLS + ';"><span>Fecha</span><span>Tipo</span><span>Talla</span><span>Cantidad</span><span>Nota</span></div>';
  movimientos.forEach(function (m) {
    html += '<div class="tx-row" style="grid-template-columns:' + MOV_COLS + ';">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(m.fecha) + "</span>" +
      '<span class="mobile-th">Tipo</span><span class="amount ' + (m.tipo === "entrada" ? "pos" : "neg") + '">' + (m.tipo === "entrada" ? "+" : "-") + "</span>" +
      '<span class="mobile-th">Talla</span><span>' + esc(m.talla) + "</span>" +
      '<span class="mobile-th">Cantidad</span><span>' + esc(m.cantidad) + "</span>" +
      '<span class="mobile-th">Nota</span><span style="color:var(--ink-soft);">' + esc(m.nota || (m.origen ? "Automático — " + m.origen : "—")) + "</span>" +
      "</div>";
  });
  return html;
}

function fmtMoney(n) { return "$" + Math.round(num(n)).toLocaleString("es-CO"); }

export var actions = {
  "add-producto": function () {
    state.productos = (state.productos || []).concat([nuevoProducto()]);
    persist("productos"); notify();
  },
  "add-producto-desde-plantilla": function (el) {
    if (!el.value) return;
    var pla = (state.plantillasPrendas || []).filter(function (pl) { return pl.id === el.value; })[0];
    if (!pla) return;
    var nuevo = Object.assign(nuevoProducto(), {
      nombre: pla.nombre, imagenUrl: pla.imagenUrl || "", consumoSugerido: pla.consumoSugerido || "",
      flujoEstadosId: pla.flujoEstadosId || "",
      insumos: (pla.insumos || []).map(function (i) { return Object.assign({}, i, { id: uid() }); })
    });
    state.productos = (state.productos || []).concat([nuevo]);
    persist("productos"); notify();
  },
  "remove-producto": function (el) {
    var id = el.getAttribute("data-id");
    var p = (state.productos || []).filter(function (p) { return p.id === id; })[0];
    if (!p) return;
    var stockTotal = stockTotalProducto(p);
    if (!window.confirm('¿Eliminar "' + p.nombre + '"?' + (stockTotal > 0 ? "\n\nTodavía tiene " + stockTotal + " unidades en stock — se pierde ese registro." : "") + "\n\nNo afecta pedidos o cotizaciones donde ya se haya aplicado.")) return;
    state.productos = (state.productos || []).filter(function (p) { return p.id !== id; });
    persist("productos"); notify();
  },
  "set-pro-campo": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    var numerico = campo === "consumoSugerido" || campo === "precioVenta";
    mapPro(id, function (p) {
      var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
      return Object.assign({}, p, patch);
    });
  },
  "set-pro-imagen": function (el) {
    var id = el.getAttribute("data-id");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.productoImagenSubiendo = Object.assign({}, state.productoImagenSubiendo, { [id]: true });
      notify();
      try {
        var url = await subirImagenReferencia(file);
        state.productoImagenSubiendo = Object.assign({}, state.productoImagenSubiendo); delete state.productoImagenSubiendo[id];
        mapPro(id, function (p) { return Object.assign({}, p, { imagenUrl: url }); });
      } catch (e) {
        state.productoImagenSubiendo = Object.assign({}, state.productoImagenSubiendo); delete state.productoImagenSubiendo[id];
        window.alert("No se pudo subir la imagen a Drive: " + (e && e.message ? e.message : e));
        notify();
      }
    });
    input.click();
  },
  "quitar-pro-imagen": function (el) {
    var id = el.getAttribute("data-id");
    mapPro(id, function (p) { return Object.assign({}, p, { imagenUrl: "" }); });
  },
  "add-pro-insumo-custom": function (el) {
    var id = el.getAttribute("data-pro");
    mapPro(id, function (p) {
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: "Nuevo insumo", unidad: "UND", costo: 0, tipo: "por_prenda", cantidad: 1 }]) });
    });
  },
  "add-pro-insumo-catalogo": function (el) {
    if (!el.value) return;
    var id = el.getAttribute("data-pro");
    var item = (state.catalogoInsumos || []).filter(function (c) { return c.id === el.value; })[0];
    if (!item) return;
    mapPro(id, function (p) {
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: item.nombre, unidad: item.unidad, costo: num(item.costo), tipo: item.tipo, cantidad: 1 }]) });
    });
  },
  "remove-pro-insumo": function (el) {
    var id = el.getAttribute("data-pro"), insId = el.getAttribute("data-ins");
    mapPro(id, function (p) { return Object.assign({}, p, { insumos: (p.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  "set-pro-ins-campo": function (el) {
    var id = el.getAttribute("data-pro"), insId = el.getAttribute("data-ins"), campo = el.getAttribute("data-campo");
    var numerico = campo === "costo" || campo === "cantidad";
    mapPro(id, function (p) {
      var insumos = (p.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, p, { insumos: insumos });
    });
  },
  "add-pro-talla": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest("[data-producto-id]");
    var nombre = val(card, "nueva-talla-" + id);
    if (!nombre) return;
    mapPro(id, function (p) {
      if ((p.variantesTalla || []).some(function (t) { return t.talla.toLowerCase() === nombre.toLowerCase(); })) {
        window.alert('Ya existe la talla "' + nombre + '".'); return p;
      }
      return Object.assign({}, p, { variantesTalla: (p.variantesTalla || []).concat([{ id: uid(), talla: nombre, stock: 0 }]) });
    });
  },
  "remove-pro-talla": function (el) {
    var id = el.getAttribute("data-pro"), tallaId = el.getAttribute("data-talla");
    var producto = (state.productos || []).filter(function (p) { return p.id === id; })[0];
    var t = producto ? (producto.variantesTalla || []).filter(function (t) { return t.id === tallaId; })[0] : null;
    if (t && num(t.stock) > 0 && !window.confirm('La talla "' + t.talla + '" todavía tiene ' + t.stock + ' en stock. ¿Eliminarla igual?')) return;
    mapPro(id, function (p) { return Object.assign({}, p, { variantesTalla: (p.variantesTalla || []).filter(function (t) { return t.id !== tallaId; }) }); });
  },
  "set-pro-talla-campo": function (el) {
    var id = el.getAttribute("data-pro"), tallaId = el.getAttribute("data-talla");
    mapPro(id, function (p) {
      var variantes = (p.variantesTalla || []).map(function (t) { return t.id === tallaId ? Object.assign({}, t, { talla: el.value }) : t; });
      return Object.assign({}, p, { variantesTalla: variantes });
    });
  },
  "add-pro-stock": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest("[data-producto-id]");
    var talla = val(card, "stock-talla-" + id);
    var tipo = val(card, "stock-tipo-" + id) || "entrada";
    var cantidad = num(val(card, "stock-cantidad-" + id));
    var nota = val(card, "stock-nota-" + id);
    if (!talla || cantidad <= 0) return;
    var delta = tipo === "salida" ? -cantidad : cantidad;
    ajustarStockProducto(id, talla, delta, nota, "");
    notify();
  },
  "toggle-pro-movimientos": function (el) {
    var id = el.getAttribute("data-id");
    state.productoMovimientosAbierto = state.productoMovimientosAbierto === id ? "" : id;
    notify();
  }
};

function nuevoProducto() {
  return { id: uid(), nombre: "Nuevo producto", imagenUrl: "", consumoSugerido: "", flujoEstadosId: "", insumos: [], precioVenta: 0, variantesTalla: [], movimientosStock: [] };
}

function mapPro(id, transform) {
  state.productos = (state.productos || []).map(function (p) { return p.id === id ? transform(p) : p; });
  persist("productos"); notify();
}
