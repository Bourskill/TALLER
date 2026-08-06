import { state, persist, notify } from "../core/store.js";
import { esc, num, uid, val } from "../core/utils.js";
import { renderTipoCostoOptions, renderHelp } from "../core/components.js";
import { subirImagenReferencia } from "../core/drive.js";

var INS_COLS = "1fr 60px 90px 150px 70px 30px";

export function render() {
  var lista = state.plantillasPrendas || [];
  var html = renderFlujosEstados();
  html += '<div class="card"><div class="section-title small">Plantillas de prendas' +
    renderHelp("Define de una vez los insumos típicos de cada tipo de prenda (t-shirt básica, polo, manga ranglán...) y aplícalos a cualquier referencia de una cotización con un clic. Si le asignas un \"Flujo de producción\" (ej. una que incluya la etapa de sublimación), ese flujo de etapas se carga automáticamente junto con los insumos — los flujos se crean y editan arriba, en \"Flujos de producción\".") +
    '</div>' +
    '<div class="pedido-actions"><button class="btn ghost small" data-action="add-plantilla">+ Nueva plantilla</button></div></div>';

  if (lista.length === 0) { html += '<div class="empty">Todavía no tienes plantillas.</div>'; return html; }

  lista.forEach(function (p) { html += renderPlantillaCard(p); });
  return html;
}

// ---------- Flujos de producción (etapas reutilizables) ----------
// Antes un flujo (state.plantillasEstados) solo se podía crear/editar desde
// una cotización en curso ("Guardar este flujo como plantilla" en
// cotizaciones.js) y aquí en Plantillas solo se podía ELEGIR uno ya
// existente. Esta tarjeta permite crear, renombrar y editar las etapas de
// cualquier flujo directamente aquí, sin tener que pasar por Cotizaciones.
function renderFlujosEstados() {
  var flujos = state.plantillasEstados || [];
  var html = '<div class="card"><div class="section-title small">Flujos de producción' +
    renderHelp("Etapas reutilizables (ej. Cortado → Confección → Sublimado → Acabados) que luego se asignan a cualquier plantilla de prenda abajo — así una prenda con un proceso distinto (como la que lleva sublimación) no tiene que compartir las mismas etapas que las demás. También puedes seguir guardando un flujo nuevo desde una cotización en curso; ambos caminos terminan en esta misma lista.") +
    '</div><div class="pedido-actions"><button class="btn ghost small" data-action="add-flujo-estados">+ Nuevo flujo</button></div>';
  if (flujos.length === 0) {
    html += '<div class="empty">Aún no tienes flujos de producción guardados. Se usará el flujo estándar en las plantillas que no tengan uno asignado.</div>';
  } else {
    flujos.forEach(function (f) { html += renderFlujoEstadosCard(f); });
  }
  html += '</div>';
  return html;
}

function renderFlujoEstadosCard(f) {
  var abierto = state.flujoEstadosAbierto === f.id;
  var estados = f.estados || [];
  var html = '<div class="card nested" data-flujo-id="' + f.id + '" style="margin-top:10px;">' +
    '<div class="pedido-top"><div class="field wide" style="flex:1;max-width:320px;">' +
    '<input class="mini-input" style="width:100%;font-weight:700;" value="' + esc(f.nombre) + '" placeholder="Nombre del flujo (ej. Con sublimación)" data-action-change="set-flujo-estados-nombre" data-id="' + f.id + '" />' +
    '</div>' +
    '<button class="btn ghost small" data-action="toggle-flujo-estados" data-id="' + f.id + '">' + (abierto ? "Ocultar etapas" : "Editar etapas (" + estados.length + ")") + "</button>" +
    '<button class="btn danger small" data-action="remove-flujo-estados" data-id="' + f.id + '">Eliminar</button>' +
    "</div>";
  if (abierto) {
    var COLS_E = "30px 1fr 36px 36px 30px";
    html += '<div class="det-row head" style="grid-template-columns:' + COLS_E + ';"><span>#</span><span>Etapa</span><span></span><span></span><span></span></div>';
    estados.forEach(function (e, i) {
      html += '<div class="det-row" style="grid-template-columns:' + COLS_E + ';">' +
        '<span class="mobile-th">#</span><span>' + (i + 1) + "</span>" +
        '<span class="mobile-th">Etapa</span><input class="mini-input" value="' + esc(e.label) + '" data-action-change="set-etapa-flujo-label" data-id="' + f.id + '" data-idx="' + i + '" />' +
        '<button class="btn ghost small" ' + (i === 0 ? "disabled" : "") + ' data-action="mover-etapa-flujo" data-dir="-1" data-id="' + f.id + '" data-idx="' + i + '" title="Subir">↑</button>' +
        '<button class="btn ghost small" ' + (i === estados.length - 1 ? "disabled" : "") + ' data-action="mover-etapa-flujo" data-dir="1" data-id="' + f.id + '" data-idx="' + i + '" title="Bajar">↓</button>' +
        '<button class="btn danger small" data-action="remove-etapa-flujo" data-id="' + f.id + '" data-idx="' + i + '">✕</button>' +
        "</div>";
    });
    if (estados.length === 0) { html += '<div class="empty" style="padding:10px 0;">Sin etapas todavía — agrega la primera abajo.</div>'; }
    html += '<div class="inline-form" style="margin-top:8px;">' +
      '<input class="mini-input" data-role="nueva-etapa-flujo-' + f.id + '" placeholder="Nombre de la nueva etapa" style="width:180px" />' +
      '<button class="btn ghost small" data-action="add-etapa-flujo" data-id="' + f.id + '">+ Agregar etapa</button>' +
      "</div>";
  }
  html += "</div>";
  return html;
}

function renderPlantillaThumb(p) {
  if (state.plantillaImagenSubiendo[p.id]) {
    return '<span class="ref-thumb ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</span>';
  }
  if (p.imagenUrl) {
    return '<span class="ref-thumb" style="width:64px;height:64px;" data-action="set-pla-imagen" data-id="' + p.id + '" title="Clic para subir otra foto desde tu dispositivo">' +
      '<img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-zoom" data-action="abrir-imagen-preview" data-url="' + esc(p.imagenUrl) + '" title="Ver en grande">🔍</button>' +
      '<button class="ref-thumb-remove" data-action="quitar-pla-imagen" data-id="' + p.id + '" title="Quitar foto">✕</button>' +
      "</span>";
  }
  return '<span class="ref-thumb ref-thumb-empty" style="width:64px;height:64px;" data-action="set-pla-imagen" data-id="' + p.id + '" title="Subir una foto desde tu dispositivo (se guarda en tu Google Drive)">+ foto</span>';
}

function renderPlantillaCard(p) {
  var flujos = state.plantillasEstados || [];
  var html = '<div class="card nested" data-plantilla-id="' + p.id + '">' +
    '<div class="pedido-top" style="align-items:flex-start;">' + renderPlantillaThumb(p) +
    '<div class="form-grid" style="flex:1;grid-template-columns:2fr 1fr 1fr;">' +
    '<div class="field"><label>Nombre de la plantilla</label><input class="mini-input" style="width:100%" value="' + esc(p.nombre) + '" placeholder="Ej. T-shirt básica" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="nombre" /></div>' +
    '<div class="field"><label>Consumo de tela sugerido (MT)</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.consumoSugerido || "") + '" placeholder="Ej. 1.2" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="consumoSugerido" /></div>' +
    '<div class="field"><label>Flujo de producción</label><select class="mini-input" style="width:100%" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="flujoEstadosId">' +
    '<option value="">Estándar</option>' +
    flujos.map(function (f) { return '<option value="' + f.id + '" ' + (p.flujoEstadosId === f.id ? "selected" : "") + '>' + esc(f.nombre) + " (" + f.estados.length + " etapas)</option>"; }).join("") +
    "</select></div>" +
    '</div><button class="btn danger small" data-action="remove-plantilla" data-id="' + p.id + '">Eliminar plantilla</button></div>';

  html += '<div class="ins-table"><div class="ins-row head" style="grid-template-columns:' + INS_COLS + ';"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant./mult.</span><span></span></div>';
  (p.insumos || []).forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:' + INS_COLS + ';">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" value="' + esc(i.unidad) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<span class="mobile-th">Cant./mult.</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<button class="btn danger small" data-action="remove-pla-insumo" data-pla="' + p.id + '" data-ins="' + i.id + '">✕</button>' +
      "</div>";
  });
  if ((p.insumos || []).length === 0) { html += '<div class="empty" style="padding:12px 0;">Sin insumos en esta plantilla.</div>'; }
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
    '<select class="mini-input" style="max-width:240px" data-action-change="add-pla-insumo-catalogo" data-pla="' + p.id + '">' +
    '<option value="">+ Insumos predeterminados…</option>' +
    (state.catalogoInsumos || []).map(function (item) { return '<option value="' + item.id + '">' + esc(item.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<button class="btn ghost small" data-action="add-pla-insumo-custom" data-pla="' + p.id + '">+ Insumo personalizado</button>' +
    "</div>";

  html += "</div>"; // .card.nested
  return html;
}

export var actions = {
  "add-plantilla": function () {
    state.plantillasPrendas = (state.plantillasPrendas || []).concat([{ id: uid(), nombre: "Nueva plantilla", consumoSugerido: "", flujoEstadosId: "", imagenUrl: "", insumos: [] }]);
    persist("plantillasPrendas"); notify();
  },
  "set-pla-imagen": function (el) {
    var id = el.getAttribute("data-id");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.plantillaImagenSubiendo = Object.assign({}, state.plantillaImagenSubiendo, { [id]: true });
      notify();
      try {
        var url = await subirImagenReferencia(file);
        state.plantillaImagenSubiendo = Object.assign({}, state.plantillaImagenSubiendo); delete state.plantillaImagenSubiendo[id];
        mapPla(id, function (p) { return Object.assign({}, p, { imagenUrl: url }); });
      } catch (e) {
        state.plantillaImagenSubiendo = Object.assign({}, state.plantillaImagenSubiendo); delete state.plantillaImagenSubiendo[id];
        window.alert("No se pudo subir la imagen a Drive: " + (e && e.message ? e.message : e));
        notify();
      }
    });
    input.click();
  },
  "quitar-pla-imagen": function (el) {
    var id = el.getAttribute("data-id");
    mapPla(id, function (p) { return Object.assign({}, p, { imagenUrl: "" }); });
  },
  "remove-plantilla": function (el) {
    var id = el.getAttribute("data-id");
    var p = (state.plantillasPrendas || []).filter(function (p) { return p.id === id; })[0];
    if (!p) return;
    var nIns = (p.insumos || []).length;
    if (!window.confirm('¿Eliminar la plantilla "' + p.nombre + '"?\n\nSe pierde' + (nIns ? " su lista de " + nIns + (nIns === 1 ? " insumo" : " insumos") + " y" : "") + ' su flujo de producción asociado. No afecta cotizaciones donde ya se aplicó.')) return;
    state.plantillasPrendas = (state.plantillasPrendas || []).filter(function (p) { return p.id !== id; });
    persist("plantillasPrendas"); notify();
  },
  "set-pla-campo": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    var numerico = campo === "consumoSugerido";
    mapPla(id, function (p) {
      var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
      return Object.assign({}, p, patch);
    });
  },
  "add-pla-insumo-custom": function (el) {
    var id = el.getAttribute("data-pla");
    mapPla(id, function (p) {
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: "Nuevo insumo", unidad: "UND", costo: 0, tipo: "por_prenda", cantidad: 1 }]) });
    });
  },
  "add-pla-insumo-catalogo": function (el) {
    if (!el.value) return;
    var id = el.getAttribute("data-pla");
    var item = (state.catalogoInsumos || []).filter(function (c) { return c.id === el.value; })[0];
    if (!item) return;
    mapPla(id, function (p) {
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: item.nombre, unidad: item.unidad, costo: num(item.costo), tipo: item.tipo, cantidad: 1 }]) });
    });
  },
  "remove-pla-insumo": function (el) {
    var id = el.getAttribute("data-pla"), insId = el.getAttribute("data-ins");
    mapPla(id, function (p) { return Object.assign({}, p, { insumos: (p.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  "set-pla-ins-campo": function (el) {
    var id = el.getAttribute("data-pla"), insId = el.getAttribute("data-ins"), campo = el.getAttribute("data-campo");
    var numerico = campo === "costo" || campo === "cantidad";
    mapPla(id, function (p) {
      var insumos = (p.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, p, { insumos: insumos });
    });
  },

  // ---------- Flujos de producción ----------
  "add-flujo-estados": function () {
    state.plantillasEstados = (state.plantillasEstados || []).concat([{ id: uid(), nombre: "Nuevo flujo", estados: [{ id: uid(), label: "Nuevo" }] }]);
    state.flujoEstadosAbierto = state.plantillasEstados[state.plantillasEstados.length - 1].id; // se abre listo para editar
    persist("plantillasEstados"); notify();
  },
  "remove-flujo-estados": function (el) {
    var id = el.getAttribute("data-id");
    var f = (state.plantillasEstados || []).filter(function (f) { return f.id === id; })[0];
    if (!f) return;
    var enUso = (state.plantillasPrendas || []).filter(function (p) { return p.flujoEstadosId === id; }).length;
    var msg = '¿Eliminar el flujo "' + f.nombre + '"?\n\n' +
      (enUso ? enUso + (enUso === 1 ? " plantilla de prenda lo tiene asignado y volverá" : " plantillas de prenda lo tienen asignado y volverán") + " al flujo estándar. " : "") +
      "No afecta cotizaciones donde ya se haya aplicado.";
    if (!window.confirm(msg)) return;
    state.plantillasPrendas = (state.plantillasPrendas || []).map(function (p) { return p.flujoEstadosId === id ? Object.assign({}, p, { flujoEstadosId: "" }) : p; });
    state.plantillasEstados = (state.plantillasEstados || []).filter(function (f) { return f.id !== id; });
    if (state.flujoEstadosAbierto === id) state.flujoEstadosAbierto = "";
    persist("plantillasEstados"); persist("plantillasPrendas"); notify();
  },
  "toggle-flujo-estados": function (el) {
    var id = el.getAttribute("data-id");
    state.flujoEstadosAbierto = state.flujoEstadosAbierto === id ? "" : id;
    notify();
  },
  "set-flujo-estados-nombre": function (el) {
    var id = el.getAttribute("data-id");
    mapFlujo(id, function (f) { return Object.assign({}, f, { nombre: el.value }); });
  },
  "add-etapa-flujo": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest("[data-flujo-id]");
    var nombre = val(card, "nueva-etapa-flujo-" + id);
    if (!nombre) return;
    mapFlujo(id, function (f) { return Object.assign({}, f, { estados: (f.estados || []).concat([{ id: uid(), label: nombre }]) }); });
  },
  "remove-etapa-flujo": function (el) {
    var id = el.getAttribute("data-id"), idx = num(el.getAttribute("data-idx"));
    mapFlujo(id, function (f) {
      var estados = (f.estados || []).slice();
      if (estados.length <= 1) { window.alert("Debe quedar al menos una etapa en el flujo."); return f; }
      estados.splice(idx, 1);
      return Object.assign({}, f, { estados: estados });
    });
  },
  "mover-etapa-flujo": function (el) {
    var id = el.getAttribute("data-id"), idx = num(el.getAttribute("data-idx")), dir = num(el.getAttribute("data-dir"));
    mapFlujo(id, function (f) {
      var estados = (f.estados || []).slice();
      var j = idx + dir;
      if (j < 0 || j >= estados.length) return f;
      var tmp = estados[idx]; estados[idx] = estados[j]; estados[j] = tmp;
      return Object.assign({}, f, { estados: estados });
    });
  },
  "set-etapa-flujo-label": function (el) {
    var id = el.getAttribute("data-id"), idx = num(el.getAttribute("data-idx"));
    mapFlujo(id, function (f) {
      var estados = (f.estados || []).map(function (e, i) { return i === idx ? Object.assign({}, e, { label: el.value }) : e; });
      return Object.assign({}, f, { estados: estados });
    });
  }
};

function mapPla(id, transform) {
  state.plantillasPrendas = (state.plantillasPrendas || []).map(function (p) { return p.id === id ? transform(p) : p; });
  persist("plantillasPrendas"); notify();
}

function mapFlujo(id, transform) {
  state.plantillasEstados = (state.plantillasEstados || []).map(function (f) { return f.id === id ? transform(f) : f; });
  persist("plantillasEstados"); notify();
}
