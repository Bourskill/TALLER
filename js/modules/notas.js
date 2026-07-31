// Pestaña "Notas": tareas del día a día y mejoras del negocio. Antes se
// llamaba "Pendientes" — ese nombre ahora lo usa el apartado de obligaciones
// financieras (nómina, gastos fijos, meta y deudas), ver modules/pendientes.js.

import { state, persist, notify } from "../core/store.js";
import { esc, opt, uid } from "../core/utils.js";

export function render() {
  var f = state.formPend;
  var html = '<div class="card"><div class="section-title small">Agregar nota</div><div class="form-grid">' +
    '<div class="field wide"><label>Descripción</label><input data-form="pend" data-field="texto" value="' + esc(f.texto) + '" placeholder="Ej. Comprar hilo negro, mejorar orden de bodega..." /></div>' +
    '<div class="field"><label>Categoría</label><select data-form="pend" data-field="categoria">' + opt("tarea", "Tarea del día a día", f.categoria) + opt("mejora", "Mejora del negocio", f.categoria) + "</select></div>" +
    '<div class="field"><label>Prioridad</label><select data-form="pend" data-field="prioridad">' + opt("alta", "Alta", f.prioridad) + opt("media", "Media", f.prioridad) + opt("baja", "Baja", f.prioridad) + "</select></div>" +
    '<div class="field"><label>Fecha (opcional)</label><input type="date" data-form="pend" data-field="fecha" value="' + esc(f.fecha || "") + '" /></div>' +
    '<button class="btn" data-action="add-pend">Agregar</button>' +
    "</div></div>";

  var orden = { alta: 0, media: 1, baja: 2 };
  var tareas = state.pendientes.filter(function (p) { return p.categoria === "tarea"; }).sort(function (a, b) { return orden[a.prioridad] - orden[b.prioridad]; });
  var mejoras = state.pendientes.filter(function (p) { return p.categoria === "mejora"; }).sort(function (a, b) { return orden[a.prioridad] - orden[b.prioridad]; });

  html += '<div class="card">';
  html += grupoPend("Tareas pendientes", tareas);
  html += '<hr class="stitch" />';
  html += grupoPend("Mejoras del negocio", mejoras);
  html += "</div>";
  return html;
}

function grupoPend(titulo, items) {
  var html = '<div class="pend-group"><div class="section-title small">' + titulo + "</div>";
  if (items.length === 0) { html += '<div class="empty">Nada por aquí.</div>'; }
  items.forEach(function (p) {
    html += '<div class="pend-item ' + (p.hecho ? "done" : "") + '">' +
      '<input type="checkbox" data-action="toggle-pend" data-id="' + p.id + '" ' + (p.hecho ? "checked" : "") + " />" +
      '<span class="pend-text">' + esc(p.texto) + (p.fecha ? (' <span class="muted" style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;">· ' + esc(p.fecha) + "</span>") : "") + "</span>" +
      '<span class="prio ' + p.prioridad + '">' + p.prioridad + "</span>" +
      '<button class="btn danger small" data-action="remove-pend" data-id="' + p.id + '">✕</button>' +
      "</div>";
  });
  return html + "</div>";
}

export var actions = {
  "add-pend": function () {
    var fpe = state.formPend;
    if (!fpe.texto) return;
    state.pendientes.unshift({ id: uid(), texto: fpe.texto, categoria: fpe.categoria, prioridad: fpe.prioridad, fecha: fpe.fecha || "", hecho: false });
    state.formPend = { texto: "", categoria: "tarea", prioridad: "media", fecha: "" };
    persist("pendientes"); notify();
  },
  "toggle-pend": function (el) {
    var id = el.getAttribute("data-id");
    state.pendientes = state.pendientes.map(function (p) { return p.id === id ? Object.assign({}, p, { hecho: !p.hecho }) : p; });
    persist("pendientes"); notify();
  },
  "remove-pend": function (el) {
    var id = el.getAttribute("data-id");
    state.pendientes = state.pendientes.filter(function (p) { return p.id !== id; });
    persist("pendientes"); notify();
  }
};
