// Pestaña "Notas": tareas del día a día y mejoras del negocio. Antes se
// llamaba "Pendientes" — ese nombre ahora lo usa el apartado de obligaciones
// financieras (nómina, gastos fijos, meta y deudas), ver modules/pendientes.js.

import { state, persist, notify } from "../core/store.js";
import { esc, opt, uid, val, exigirCampos } from "../core/utils.js";
import { sincronizarEvento, eliminarEvento, eventoUnDia } from "../core/calendar.js";
import { getSession } from "../core/auth.js";

export function render() {
  var f = state.formPend;
  var html = '<div class="card"><div class="section-title small">Agregar nota</div><div class="form-grid">' +
    '<div class="field wide"><label>Descripción</label><textarea rows="2" data-form="pend" data-field="texto" placeholder="Ej. Comprar hilo negro, mejorar orden de bodega... (también sirve para un texto largo, un bloc de notas normal)">' + esc(f.texto) + "</textarea></div>" +
    '<div class="field"><label>Categoría</label><select data-form="pend" data-field="categoria">' + opt("tarea", "Tarea del día a día", f.categoria) + opt("mejora", "Mejora del negocio", f.categoria) + "</select></div>" +
    '<div class="field"><label>Prioridad</label><select data-form="pend" data-field="prioridad">' + opt("alta", "Alta", f.prioridad) + opt("media", "Media", f.prioridad) + opt("baja", "Baja", f.prioridad) + "</select></div>" +
    '<div class="field"><label>Fecha (opcional)</label><input type="date" data-form="pend" data-field="fecha" value="' + esc(f.fecha || "") + '" /></div>' +
    '<div class="field"><label>Hora (opcional)</label><input type="time" data-form="pend" data-field="hora" value="' + esc(f.hora || "") + '" /></div>' +
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
    if (state.pendEditando === p.id) { html += renderPendEdit(p); return; }
    html += '<div class="pend-item ' + (p.hecho ? "done" : "") + '">' +
      '<input type="checkbox" data-action="toggle-pend" data-id="' + p.id + '" ' + (p.hecho ? "checked" : "") + " />" +
      '<span class="pend-text">' + esc(p.texto) + (p.fecha ? (' <span class="muted" style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;">· ' + esc(p.fecha) + (p.hora ? " " + esc(p.hora) : "") + "</span>") : "") + "</span>" +
      '<span class="prio ' + p.prioridad + '">' + p.prioridad + "</span>" +
      '<button class="btn ghost small" data-action="editar-pend" data-id="' + p.id + '">✎</button>' +
      '<button class="btn danger small" data-action="remove-pend" data-id="' + p.id + '">✕</button>' +
      "</div>";
  });
  return html + "</div>";
}

// Modo edición de una nota — a diferencia de agregar/tachar/borrar, esto sí
// necesita ser un modo explícito con Guardar/Cancelar: el texto ahora puede
// ser un párrafo largo (ver renderPendEdit más abajo), y perder eso a mitad
// de un clic accidental sería justo lo que este módulo existe para evitar.
function renderPendEdit(p) {
  return '<div class="pend-item" data-pend-edit-row="' + p.id + '">' +
    '<div class="pend-item-edit">' +
    '<textarea class="mini-input" rows="3" data-role="edit-texto" style="width:100%;">' + esc(p.texto) + "</textarea>" +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn small" data-action="guardar-pend-edit" data-id="' + p.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-pend">Cancelar</button>' +
    "</div></div></div>";
}

// ---------- Sincronización de la fecha de la nota con Google Calendar ----------
// Igual que Pedidos (y a diferencia de Pendientes, que es solo admin): el
// evento se crea en el Calendar de quien esté logueado en ese momento. Una
// nota SIN fecha, o ya marcada como hecha, no tiene evento (se borra si lo
// tenía) — al desmarcarla como hecha, si sigue teniendo fecha, se recrea.
function sincronizarEventoNota(nota) {
  if (!getSession()) return;
  if (!nota.fecha || nota.hecho) {
    if (nota.calendarEventId) {
      eliminarEvento(nota.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar de la nota", e); });
      state.pendientes = state.pendientes.map(function (x) { return x.id === nota.id ? Object.assign({}, x, { calendarEventId: "" }) : x; });
      persist("pendientes");
    }
    return;
  }
  var fecha = new Date(nota.fecha + "T00:00:00");
  var titulo = (nota.categoria === "mejora" ? "💡 " : "📝 ") + nota.texto + (nota.hora ? " (" + nota.hora + ")" : "");
  var descripcion = "Prioridad: " + nota.prioridad + (nota.hora ? " · Hora: " + nota.hora : "");
  sincronizarEvento(nota.calendarEventId, eventoUnDia(titulo, descripcion, fecha)).then(function (eventId) {
    var idx = state.pendientes.findIndex(function (x) { return x.id === nota.id; });
    if (idx === -1 || state.pendientes[idx].calendarEventId === eventId) return;
    state.pendientes = state.pendientes.map(function (x) { return x.id === nota.id ? Object.assign({}, x, { calendarEventId: eventId }) : x; });
    persist("pendientes");
  }).catch(function (e) { console.error("No se pudo sincronizar la nota con Calendar", e); });
}

export var actions = {
  "add-pend": function () {
    var fpe = state.formPend;
    if (!exigirCampos([["Descripción", fpe.texto]])) return;
    state.pendientes.unshift({ id: uid(), texto: fpe.texto, categoria: fpe.categoria, prioridad: fpe.prioridad, fecha: fpe.fecha || "", hora: fpe.hora || "", hecho: false, calendarEventId: "" });
    state.formPend = { texto: "", categoria: "tarea", prioridad: "media", fecha: "", hora: "" };
    persist("pendientes"); notify();
    sincronizarEventoNota(state.pendientes[0]);
  },
  "toggle-pend": function (el) {
    var id = el.getAttribute("data-id");
    state.pendientes = state.pendientes.map(function (p) { return p.id === id ? Object.assign({}, p, { hecho: !p.hecho }) : p; });
    persist("pendientes"); notify();
    var actualizada = state.pendientes.filter(function (p) { return p.id === id; })[0];
    if (actualizada) sincronizarEventoNota(actualizada);
  },
  "editar-pend": function (el) {
    state.pendEditando = el.getAttribute("data-id");
    notify();
  },
  "cancelar-edicion-pend": function () {
    state.pendEditando = "";
    notify();
  },
  "guardar-pend-edit": function (el) {
    var id = el.getAttribute("data-id");
    var fila = el.closest("[data-pend-edit-row]");
    var texto = val(fila, "edit-texto");
    if (!texto) return;
    state.pendientes = state.pendientes.map(function (p) { return p.id === id ? Object.assign({}, p, { texto: texto }) : p; });
    state.pendEditando = "";
    persist("pendientes"); notify();
  },
  "remove-pend": function (el) {
    var id = el.getAttribute("data-id");
    var nota = state.pendientes.filter(function (p) { return p.id === id; })[0];
    state.pendientes = state.pendientes.filter(function (p) { return p.id !== id; });
    persist("pendientes"); notify();
    if (nota && nota.calendarEventId) eliminarEvento(nota.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar de la nota", e); });
  }
};
