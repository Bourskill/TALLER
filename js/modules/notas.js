// Pestaña "Notas": tareas del día a día y mejoras del negocio. Antes se
// llamaba "Pendientes" — ese nombre ahora lo usa el apartado de obligaciones
// financieras (nómina, gastos fijos, meta y deudas), ver modules/pendientes.js.

import { state, persist, notify } from "../core/store.js";
import { esc, opt, uid, val, exigirCampos } from "../core/utils.js";
import { sincronizarEvento, eliminarEvento, eventoUnDia } from "../core/calendar.js";
import { getSession } from "../core/auth.js";

// El formulario le da protagonismo al párrafo (es un bloc de notas, no un
// formulario de tarea con un campo de texto de relleno): arriba, en una sola
// fila compacta, todo lo que es "metadato" (categoría, prioridad, fecha,
// hora); debajo, el título y un textarea grande dedicado — lo primero que se
// ve al abrir la pestaña es espacio para escribir, no una fila de selects.
export function render() {
  var f = state.formPend;
  var html = '<div class="card nota-form-card">' +
    '<div class="section-title small">Nueva nota</div>' +
    '<div class="nota-form-opciones">' +
    '<div class="field"><label>Categoría</label><select data-form="pend" data-field="categoria">' + opt("tarea", "Tarea del día a día", f.categoria) + opt("mejora", "Mejora del negocio", f.categoria) + "</select></div>" +
    '<div class="field"><label>Prioridad</label><select data-form="pend" data-field="prioridad">' + opt("alta", "Alta", f.prioridad) + opt("media", "Media", f.prioridad) + opt("baja", "Baja", f.prioridad) + "</select></div>" +
    '<div class="field"><label>Fecha (opcional)</label><input type="date" data-form="pend" data-field="fecha" value="' + esc(f.fecha || "") + '" /></div>' +
    '<div class="field"><label>Hora (opcional)</label><input type="time" data-form="pend" data-field="hora" value="' + esc(f.hora || "") + '" /></div>' +
    "</div>" +
    '<input class="nota-form-titulo" data-form="pend" data-field="titulo" placeholder="Título (opcional)" value="' + esc(f.titulo || "") + '" />' +
    '<textarea class="nota-form-parrafo" rows="6" data-form="pend" data-field="texto" placeholder="Escribe acá — desde un recordatorio de una línea hasta un párrafo largo.">' + esc(f.texto) + "</textarea>" +
    '<button class="btn" data-action="add-pend">Agregar nota</button>' +
    "</div>";

  var orden = { alta: 0, media: 1, baja: 2 };
  var tareas = state.pendientes.filter(function (p) { return p.categoria === "tarea"; }).sort(function (a, b) { return orden[a.prioridad] - orden[b.prioridad]; });
  var mejoras = state.pendientes.filter(function (p) { return p.categoria === "mejora"; }).sort(function (a, b) { return orden[a.prioridad] - orden[b.prioridad]; });

  html += grupoPend("Tareas pendientes", tareas);
  html += grupoPend("Mejoras del negocio", mejoras);
  return html;
}

function grupoPend(titulo, items) {
  var html = '<div class="card"><div class="section-title small">' + titulo + "</div>";
  if (items.length === 0) {
    html += '<div class="empty">Nada por aquí.</div>';
  } else {
    html += '<div class="notas-grid">';
    items.forEach(function (p) { html += state.pendEditando === p.id ? renderPendEdit(p) : renderNotaCard(p); });
    html += "</div>";
  }
  return html + "</div>";
}

// Una nota como su propia tarjeta (no una fila de lista): el párrafo entero
// se lee de un vistazo, con su título si tiene uno, en vez de una línea
// truncada entre una casilla y dos botones.
function renderNotaCard(p) {
  return '<div class="nota-card' + (p.hecho ? " done" : "") + '">' +
    '<div class="nota-card-top">' +
    '<label class="nota-card-check" title="Marcar como hecho"><input type="checkbox" data-action="toggle-pend" data-id="' + p.id + '" ' + (p.hecho ? "checked" : "") + " /></label>" +
    (p.titulo ? '<div class="nota-card-titulo">' + esc(p.titulo) + "</div>" : "") +
    '<span class="prio ' + p.prioridad + '">' + p.prioridad + "</span>" +
    "</div>" +
    (p.texto ? '<div class="nota-card-texto">' + esc(p.texto) + "</div>" : "") +
    (p.fecha ? '<div class="nota-card-fecha">🗓 ' + esc(p.fecha) + (p.hora ? " · " + esc(p.hora) : "") + "</div>" : "") +
    '<div class="nota-card-acciones">' +
    '<button class="btn ghost small" data-action="editar-pend" data-id="' + p.id + '">✎ Editar</button>' +
    '<button class="btn danger small" data-action="remove-pend" data-id="' + p.id + '">✕ Eliminar</button>' +
    "</div></div>";
}

// Modo edición de una nota — a diferencia de agregar/tachar/borrar, esto sí
// necesita ser un modo explícito con Guardar/Cancelar: el texto ahora puede
// ser un párrafo largo, y perder eso a mitad de un clic accidental sería
// justo lo que este módulo existe para evitar.
function renderPendEdit(p) {
  return '<div class="nota-card nota-card-editando" data-pend-edit-row="' + p.id + '">' +
    '<input class="mini-input nota-form-titulo" data-role="edit-titulo" placeholder="Título (opcional)" value="' + esc(p.titulo || "") + '" />' +
    '<textarea class="mini-input" rows="5" style="width:100%;" data-role="edit-texto">' + esc(p.texto) + "</textarea>" +
    '<div class="nota-card-acciones">' +
    '<button class="btn small" data-action="guardar-pend-edit" data-id="' + p.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-pend">Cancelar</button>' +
    "</div></div>";
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
  // El título del evento prefiere el título propio de la nota; si no tiene
  // (sigue siendo opcional), cae al texto, como siempre.
  var tituloEvento = (nota.categoria === "mejora" ? "💡 " : "📝 ") + (nota.titulo || nota.texto) + (nota.hora ? " (" + nota.hora + ")" : "");
  var descripcion = (nota.titulo ? nota.texto + "\n\n" : "") + "Prioridad: " + nota.prioridad + (nota.hora ? " · Hora: " + nota.hora : "");
  sincronizarEvento(nota.calendarEventId, eventoUnDia(tituloEvento, descripcion, fecha)).then(function (eventId) {
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
    state.pendientes.unshift({ id: uid(), titulo: (fpe.titulo || "").trim(), texto: fpe.texto, categoria: fpe.categoria, prioridad: fpe.prioridad, fecha: fpe.fecha || "", hora: fpe.hora || "", hecho: false, calendarEventId: "" });
    state.formPend = { titulo: "", texto: "", categoria: "tarea", prioridad: "media", fecha: "", hora: "" };
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
    var titulo = val(fila, "edit-titulo");
    state.pendientes = state.pendientes.map(function (p) { return p.id === id ? Object.assign({}, p, { texto: texto, titulo: titulo }) : p; });
    state.pendEditando = "";
    persist("pendientes"); notify();
    // El título pudo cambiar, y el evento de Calendar (si la nota tiene
    // fecha) lo usa como su nombre — se refresca para que no quede desfasado.
    var actualizada = state.pendientes.filter(function (p) { return p.id === id; })[0];
    if (actualizada) sincronizarEventoNota(actualizada);
  },
  "remove-pend": function (el) {
    var id = el.getAttribute("data-id");
    var nota = state.pendientes.filter(function (p) { return p.id === id; })[0];
    state.pendientes = state.pendientes.filter(function (p) { return p.id !== id; });
    persist("pendientes"); notify();
    if (nota && nota.calendarEventId) eliminarEvento(nota.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar de la nota", e); });
  }
};
