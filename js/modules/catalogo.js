import { state, persist, notify, aprobarPropuesta, descartarPropuesta } from "../core/store.js";
import { esc, num, uid, fmt, opt } from "../core/utils.js";
import { TIPOS_COSTO, ORIGEN_PRODUCCION } from "../core/constants.js";
import { renderTipoCostoOptions } from "../core/components.js";
import { renderHelp } from "../core/components.js";
import { getSession } from "../core/auth.js";
import { proveedoresDeContactos } from "../core/calc.js";

var COLS = "1fr 150px 90px 110px 170px 160px 40px";
var CAMPO_LABEL = { catalogoInsumos: "insumos", catalogoCategorias: "categorías" };

function renderPropuestasPendientes(session) {
  var propuestas = state.catalogoPropuestas || [];
  var esAdmin = !session || session.rol !== "vendedor";
  // El admin ve TODAS las propuestas de todos los vendedores; un vendedor
  // solo ve si la suya propia sigue pendiente (para saber que aún no aplicó).
  var visibles = esAdmin ? propuestas : propuestas.filter(function (p) { return p.autor === (session.vendedorNombre || session.email); });
  if (!visibles.length) return "";

  if (!esAdmin) {
    return '<div class="card" style="border-color:var(--warning);"><div class="section-title small">Cambios pendientes de aprobación</div>' +
      '<div class="section-sub">Ya podés seguir usando tu edición mientras tanto — el admin todavía no aprueba tu cambio de ' +
      visibles.map(function (p) { return CAMPO_LABEL[p.key] || p.key; }).join(" y ") + ".</div></div>";
  }

  var html = '<div class="card" style="border-color:var(--warning);"><div class="section-title small">Cambios pendientes de aprobación' +
    renderHelp("Un vendedor editó el catálogo. Su cambio ya lo puede usar él en el momento, pero no queda guardado para todos hasta que lo apruebes acá — es una medida de seguridad porque el catálogo define el costo de producción del taller.") +
    "</div>";
  visibles.forEach(function (p) {
    html += '<div class="tx-row" style="grid-template-columns:1fr 140px 160px;">' +
      "<span>" + esc(p.autor) + " propuso cambios en " + esc(CAMPO_LABEL[p.key] || p.key) + "</span>" +
      '<span class="tag" style="background:var(--surface-3);">' + esc(new Date(p.fecha).toLocaleString("es-CO")) + "</span>" +
      '<span style="display:flex;gap:6px;justify-content:flex-end;">' +
      '<button class="btn success small" data-action="aprobar-propuesta-catalogo" data-id="' + p.id + '">Aprobar</button>' +
      '<button class="btn danger small" data-action="descartar-propuesta-catalogo" data-id="' + p.id + '">Descartar</button>' +
      "</span></div>";
  });
  html += "</div>";
  return html;
}

export function render() {
  var session = getSession();
  var lista = state.catalogoInsumos || [];
  var categorias = state.catalogoCategorias || [];
  var ayudaTipos = Object.keys(TIPOS_COSTO).map(function (k) { return TIPOS_COSTO[k].label + ": " + TIPOS_COSTO[k].ayuda; }).join(" · ");
  var html = renderPropuestasPendientes(session);
  html += '<div class="card"><div class="section-title small">Catálogo de insumos' +
    renderHelp("Guarda aquí tus telas e insumos con su costo y tipo de cálculo. Luego los agregas a cualquier referencia de una cotización con un clic, en vez de escribir el costo cada vez. Agrupa por categoría (ej. Telas, Hilos, Empaques) para encontrarlos más rápido. Tipos de costo — " + ayudaTipos) +
    "</div>";

  // ---------- Categorías ----------
  html += '<div class="section-sub" style="margin:0 0 8px;">Categorías</div>';
  html += '<div class="filters" style="margin-bottom:12px;">' +
    '<button class="chip ' + (state.filtroCatalogoCategoria === "todos" ? "active" : "") + '" data-action="filtro-cat-categoria" data-val="todos">Todas</button>';
  categorias.forEach(function (cat) {
    html += '<button class="chip ' + (state.filtroCatalogoCategoria === cat.id ? "active" : "") + '" data-action="filtro-cat-categoria" data-val="' + cat.id + '">' + esc(cat.nombre) + "</button>";
  });
  html += '<button class="chip ' + (state.filtroCatalogoCategoria === "sin" ? "active" : "") + '" data-action="filtro-cat-categoria" data-val="sin">Sin categoría</button>';
  html += "</div>";
  html += '<div class="inline-form" style="margin-bottom:14px;">' +
    '<input class="mini-input" id="inp-nueva-categoria" placeholder="Nueva categoría (ej. Telas)" style="width:200px" />' +
    '<button class="btn ghost small" data-action="add-cat-categoria">+ Agregar categoría</button>';
  categorias.forEach(function (cat) {
    html += '<span class="badge" style="display:inline-flex;align-items:center;gap:6px;">' + esc(cat.nombre) +
      '<button class="ref-thumb-remove" style="position:static;" data-action="remove-cat-categoria" data-id="' + cat.id + '" title="Eliminar categoría (los insumos quedan sin categoría, no se borran)">✕</button></span>';
  });
  html += "</div>";

  // ---------- Insumos, agrupados por categoría ----------
  var categoriaActiva = state.filtroCatalogoCategoria;
  var grupos = categorias.map(function (cat) { return { id: cat.id, nombre: cat.nombre, items: lista.filter(function (i) { return i.categoriaId === cat.id; }) }; });
  grupos.push({ id: "sin", nombre: "Sin categoría", items: lista.filter(function (i) { return !i.categoriaId || !categorias.some(function (c) { return c.id === i.categoriaId; }); }) });
  if (categoriaActiva !== "todos") grupos = grupos.filter(function (g) { return g.id === categoriaActiva; });

  var huboAlgo = false;
  grupos.forEach(function (g) {
    if (!g.items.length && categoriaActiva === "todos") return; // no mostrar grupos vacíos en la vista "Todas"
    huboAlgo = true;
    html += '<div class="section-sub" style="margin-top:16px;">' + esc(g.nombre) + " (" + g.items.length + ")</div>";
    html += '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Insumo</span><span>Categoría</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Origen</span><span></span></div>';
    if (!g.items.length) { html += '<div class="empty" style="padding:8px 0;">Sin insumos en esta categoría todavía.</div>'; }
    g.items.forEach(function (c) { html += renderFilaInsumo(c, categorias); });
  });
  if (!huboAlgo) { html += '<div class="empty">Aún no tienes insumos en el catálogo.</div>'; }

  html += '<div class="pedido-actions" style="margin-top:12px;"><button class="btn ghost small" data-action="add-cat-item">+ Agregar insumo</button></div></div>';

  return html;
}

function renderFilaInsumo(c, categorias) {
  return '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
    '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(c.nombre) + '" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="nombre" />' +
    '<span class="mobile-th">Categoría</span><select class="mini-input" style="width:100%" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="categoriaId">' +
    '<option value="">Sin categoría</option>' +
    categorias.map(function (cat) { return '<option value="' + cat.id + '" ' + (c.categoriaId === cat.id ? "selected" : "") + ">" + esc(cat.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" value="' + esc(c.unidad) + '" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="unidad" />' +
    '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(c.costo) + '" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="costo" />' +
    '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="tipo">' + renderTipoCostoOptions(c.tipo) + "</select>" +
    '<span class="mobile-th">Origen</span><select class="mini-input" style="width:100%" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="origen">' +
    Object.keys(ORIGEN_PRODUCCION).map(function (k) { return opt(k, ORIGEN_PRODUCCION[k], c.origen || "taller"); }).join("") +
    "</select>" +
    '<button class="btn danger small" data-action="remove-cat-item" data-id="' + c.id + '">✕</button>' +
    (c.origen === "proveedor" ? renderSelectorProveedorInsumo(c) : "") +
    "</div>";
}

// Solo cuando el insumo es "comprado a proveedor": a cuál de los Contactos
// marcados como proveedor se le compra — spanea todo el ancho de la fila
// (grid-column:1/-1) porque no todas las filas lo necesitan, así que no
// forma parte de las columnas fijas de la tabla.
function renderSelectorProveedorInsumo(c) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<div class="section-sub" style="grid-column:1/-1;margin:4px 0 0;">Sin proveedores registrados aún — agrégalos en Contactos (tipo Proveedor).</div>';
  }
  return '<div style="grid-column:1/-1;margin-top:4px;"><label class="mini-label" style="display:block;margin-bottom:2px;">Proveedor</label>' +
    '<select class="mini-input" style="max-width:280px" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="proveedorId">' +
    '<option value="">Elegir proveedor…</option>' +
    proveedores.map(function (p) { return '<option value="' + p.id + '" ' + (c.proveedorId === p.id ? "selected" : "") + '>' + esc(p.nombre) + "</option>"; }).join("") +
    "</select></div>";
}

export var actions = {
  "add-cat-item": function () {
    var catActiva = state.filtroCatalogoCategoria !== "todos" && state.filtroCatalogoCategoria !== "sin" ? state.filtroCatalogoCategoria : "";
    state.catalogoInsumos = (state.catalogoInsumos || []).concat([{ id: uid(), nombre: "Nuevo insumo", unidad: "UND", costo: 0, tipo: "por_prenda", categoriaId: catActiva, origen: "taller", proveedorId: "" }]);
    persist("catalogoInsumos"); notify();
  },
  "remove-cat-item": function (el) {
    var id = el.getAttribute("data-id");
    var item = (state.catalogoInsumos || []).filter(function (c) { return c.id === id; })[0];
    if (!item) return;
    if (!window.confirm('¿Eliminar "' + item.nombre + '" del catálogo?\n\nLas cotizaciones y plantillas que ya lo usan no se ven afectadas (guardan su propia copia del costo); solo deja de estar disponible para agregarlo a nuevas.')) return;
    state.catalogoInsumos = (state.catalogoInsumos || []).filter(function (c) { return c.id !== id; });
    persist("catalogoInsumos"); notify();
  },
  "set-cat-campo": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    var numerico = campo === "costo";
    state.catalogoInsumos = (state.catalogoInsumos || []).map(function (c) {
      if (c.id !== id) return c;
      var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
      return Object.assign({}, c, patch);
    });
    persist("catalogoInsumos"); notify();
  },
  "filtro-cat-categoria": function (el) {
    state.filtroCatalogoCategoria = el.getAttribute("data-val");
    notify();
  },
  "add-cat-categoria": function () {
    var input = document.getElementById("inp-nueva-categoria");
    var nombre = input ? input.value.trim() : "";
    if (!nombre) return;
    state.catalogoCategorias = (state.catalogoCategorias || []).concat([{ id: uid(), nombre: nombre }]);
    persist("catalogoCategorias"); notify();
  },
  // No borra los insumos que tenía esa categoría — solo los deja "sin
  // categoría" (evitar que borrar por error una categoría se lleve insumos
  // de verdad, ya que aquí vive el costo de producción de todo el taller).
  "remove-cat-categoria": function (el) {
    var id = el.getAttribute("data-id");
    if (!window.confirm("¿Eliminar esta categoría? Los insumos que tenía quedan sin categoría (no se eliminan).")) return;
    state.catalogoCategorias = (state.catalogoCategorias || []).filter(function (c) { return c.id !== id; });
    if (state.filtroCatalogoCategoria === id) state.filtroCatalogoCategoria = "todos";
    persist("catalogoCategorias"); persist("catalogoInsumos"); notify();
  },
  "aprobar-propuesta-catalogo": async function (el) {
    await aprobarPropuesta(el.getAttribute("data-id"));
    notify();
  },
  "descartar-propuesta-catalogo": async function (el) {
    if (!window.confirm("¿Descartar esta propuesta? El catálogo real no cambia.")) return;
    await descartarPropuesta(el.getAttribute("data-id"));
    notify();
  }
};
