// Piezas de HTML reutilizadas por más de un módulo de pestaña.
// Si mañana un tercer módulo necesita buscar/crear un cliente, se reutiliza esto
// en vez de duplicar el combobox.

import { esc } from "./utils.js";
import { clienteById, buscarClientesCombo } from "./calc.js";
import { TIPOS_COSTO } from "./constants.js";

// <option> de los 3 tipos de costo (tela / fijo por pedido / fijo por prenda).
// Compartido entre Cotizaciones, Catálogo y Plantillas para que el texto de
// cada tipo salga idéntico en los tres lugares.
// Icono "?" con la explicación larga escondida hasta que el usuario pasa el
// mouse por encima o hace click/tap (accesible también con teclado vía :focus).
// Se usa para sacar párrafos explicativos del flujo visual principal (ver
// cotizaciones.js) sin perder la explicación para quien la necesite.
export function renderHelp(texto, alinear) {
  return '<span class="help-tip' + (alinear === "right" ? " align-right" : "") + '" tabindex="0">' +
    '<span class="help-icon" aria-hidden="true">?</span>' +
    '<span class="help-bubble">' + esc(texto) + "</span>" +
    "</span>";
}

// `enCotizacion` habilita los tipos que solo tienen sentido dentro de una
// cotización (ver `soloCotizacion` en TIPOS_COSTO): en Catálogo, Plantillas o
// Productos no hay a quién cobrarle, así que ahí se esconden. El valor actual
// siempre se incluye aunque esté filtrado — si no, un insumo guardado con ese
// tipo se vería en pantalla como si tuviera otro.
export function renderTipoCostoOptions(current, enCotizacion) {
  return Object.keys(TIPOS_COSTO).filter(function (k) {
    return enCotizacion || k === current || !TIPOS_COSTO[k].soloCotizacion;
  }).map(function (k) {
    return '<option value="' + k + '" ' + (k === current ? "selected" : "") + '>' + esc(TIPOS_COSTO[k].label) + "</option>";
  }).join("");
}

// ---------------------------------------------------------------------------
// Barra de búsqueda — ÚNICA para toda la app.
// ---------------------------------------------------------------------------
// Antes había tres implementaciones distintas de lo mismo, y ninguna en las
// pestañas donde más falta hacía:
//   1. `.search-bar` con CSS propio en clientes.css (solo Contactos),
//   2. un `.field > .mini-input` con estilos inline (Finanzas, Pedidos),
//   3. `.picker-search` dentro de los tres exploradores modales.
// Se veían distintas entre sí sin ninguna razón, y ninguna tenía botón de
// limpiar ni decía cuántos resultados quedaban. Esta función es la base
// compartida: un solo markup, un solo CSS (`.buscador` en forms.css) y un
// solo comportamiento. Si un caso necesita algo distinto, se parametriza
// acá — no se escribe una cuarta barra.
//
// Se apoya en el patrón `data-live-filter` que ya conoce core/dom.js: escribe
// directo en state[filtro] y re-renderiza con debounce. Y como el input lleva
// id, la tecla "/" y Ctrl+K lo encuentran (ver core/teclado.js).
//
// o = {
//   id:        id del <input> (obligatorio: sin él se pierde el foco en cada render)
//   filtro:    clave de `state` donde vive el texto (data-live-filter)
//   valor:     texto actual
//   placeholder
//   conteo:    { visibles, total, singular, plural } — opcional
//   ancho:     ancho máximo en px (por defecto 340)
//   compacto:  true dentro de un modal (sin margen inferior)
// }
export function renderBuscador(o) {
  var valor = o.valor == null ? "" : String(o.valor);
  var hayTexto = valor.trim().length > 0;
  var html = '<div class="buscador' + (o.compacto ? " compacto" : "") + '"' +
    (o.ancho === "full" ? "" : ' style="max-width:' + (o.ancho || 340) + 'px;"') + ">" +
    '<span class="buscador-icono" aria-hidden="true">' + iconoLupa() + "</span>" +
    '<input id="' + o.id + '" class="buscador-input" type="search" autocomplete="off"' +
    ' data-live-filter="' + o.filtro + '" value="' + esc(valor) + '"' +
    ' placeholder="' + esc(o.placeholder || "Buscar…") + '" />' +
    // El botón de limpiar solo existe cuando hay algo que limpiar: un ✕ que
    // no hace nada es ruido, y en una fila apretada resta espacio real.
    (hayTexto
      ? '<button class="buscador-limpiar" data-action="limpiar-buscador" data-filtro="' + o.filtro +
        '" data-input="' + o.id + '" title="Limpiar la búsqueda (Esc)" aria-label="Limpiar la búsqueda">✕</button>'
      : "") +
    "</div>";
  if (o.conteo) html += renderConteoResultados(o.conteo);
  return html;
}

// "8 de 24 insumos" cuando algo quedó fuera, "24 insumos" cuando se ve todo.
// Decir siempre el total es lo que evita la duda de "¿no hay más, o es que
// estoy filtrando?".
//
// POR QUÉ NO MIRA SI HAY TEXTO ESCRITO: antes solo decía "X de Y" cuando el
// buscador tenía texto, pero quien llama pasa un `visibles` que YA viene
// filtrado también por los chips. Con un chip activo y el buscador vacío el
// conteo prometía "2 insumos" mientras en pantalla había 1. Ahora la
// comparación es la única fuente: si se ve menos de lo que hay, se dice.
// `total` debe ser el universo del que salen los visibles (ver los llamadores).
function renderConteoResultados(c) {
  var plural = c.plural || (c.singular + "s");
  var nombre = c.total === 1 ? c.singular : plural;
  var texto = c.visibles !== c.total
    ? c.visibles + " de " + c.total + " " + nombre
    : c.total + " " + nombre;
  return '<div class="buscador-conteo">' + esc(texto) + "</div>";
}

// ---------------------------------------------------------------------------
// Tarjeta de índice visual — ÚNICA para toda la app.
// ---------------------------------------------------------------------------
// Nació en el catálogo de Productos (`.producto-card-mini`) y era la única
// pantalla de la app que dejaba reconocer sus cosas por la foto en vez de
// leer una lista. Plantillas necesitaba exactamente lo mismo, así que la
// pieza subió acá en vez de copiarse: una tarjeta con foto, nombre, una
// línea de contexto y un pie de dos datos.
//
// o = {
//   id, accion:    data-id y data-action del clic (abrir el detalle)
//   imagenUrl:     foto de vista previa (opcional)
//   sinImagen:     qué decir cuando no hay foto ("Sin foto")
//   nombre, meta:  título y línea de contexto
//   pie:           [izquierda, derecha] en HTML ya formado (opcional)
//   activa:        true si su detalle es el que está abierto
//   titulo:        tooltip
// }
export function renderTarjetaMini(o) {
  var img = o.imagenUrl
    ? '<img src="' + esc(o.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />'
    : '<span class="tarjeta-mini-noimg">' + esc(o.sinImagen || "Sin foto") + "</span>";
  var pie = o.pie && o.pie.length
    ? '<div class="tarjeta-mini-pie">' + o.pie.join("") + "</div>"
    : "";
  return '<div class="tarjeta-mini' + (o.activa ? " activa" : "") + '"' +
    (o.accion ? ' data-action="' + o.accion + '" data-id="' + o.id + '"' : "") +
    ' title="' + esc(o.titulo || "Clic para abrir") + '">' +
    '<div class="tarjeta-mini-img">' + img + "</div>" +
    '<div class="tarjeta-mini-body">' +
    '<div class="tarjeta-mini-nombre">' + esc(o.nombre || "Sin nombre") + "</div>" +
    (o.meta ? '<div class="tarjeta-mini-meta">' + esc(o.meta) + "</div>" : "") +
    pie +
    "</div></div>";
}

// ---------------------------------------------------------------------------
// Progreso de producción — ÚNICO para los dos caminos de un pedido.
// ---------------------------------------------------------------------------
// ESTE ES EL COMPONENTE QUE ORIGINÓ LA REGLA DE REUTILIZAR. El progreso de
// producción estaba pintado dos veces en modules/pedidos.js:
//   - renderProgresoTape        para un "pedido rápido" (barra + etapas + botones con texto)
//   - renderProgresoPorReferencia para un pedido venido de cotización (fila compacta + flechas)
// Eran la misma información con markup, CSS y afordancias distintas, así que
// cuando se arregló una la otra se quedó vieja — literalmente lo que reportó
// el usuario: "en una parte se actualizó y en la otra se quedó viejo".
//
// Ahora hay una sola pieza. Lo único que cambia entre los dos casos es si
// lleva la barra con todas las etapas (`conBarra`), porque un pedido rápido
// es UNA cosa que avanza y vale la pena verla completa, mientras que una
// cotización con seis referencias necesita seis filas compactas.
//
// o = {
//   etapas:  [{id,label}]  el flujo, resuelto SIEMPRE con etapasDe() de core/calc.js
//   estado:  id de la etapa actual
//   nombre:  qué avanza ("Producción", o el nombre de la referencia)
//   accionAvanzar / accionRetroceder: nombres de acción
//   datos:   { atributo: valor } que se emiten como data-* en los dos botones
//   conBarra: barra de progreso + todas las etiquetas encima de la fila
// }
export function renderProgresoEtapas(o) {
  var etapas = (o.etapas && o.etapas.length) ? o.etapas : [];
  if (!etapas.length) return "";
  var idx = etapas.map(function (e) { return e.id; }).indexOf(o.estado);
  if (idx < 0) idx = 0; // el estado guardado ya no existe en la lista
  var datos = "";
  Object.keys(o.datos || {}).forEach(function (k) { datos += ' data-' + k + '="' + esc(o.datos[k]) + '"'; });

  var html = "";
  if (o.conBarra) {
    // Un flujo de UNA sola etapa (posible con un flujo personalizado de
    // Plantillas) dividía por cero y dejaba la barra con un ancho inválido:
    // estando en la única etapa, el avance es del 100%.
    var pct = etapas.length > 1 ? (idx / (etapas.length - 1) * 100) : 100;
    html += '<div class="tape-track"><div class="tape-fill" style="width:' + pct + '%;"></div></div>' +
      '<div class="tape-labels">' + etapas.map(function (e, i) {
        return '<span class="' + (i <= idx ? "current" : "") + '">' + esc(e.label) + "</span>";
      }).join("") + "</div>";
  }

  html += '<div class="pedido-ref-progreso">' +
    '<span class="pedido-ref-nombre">' + esc(o.nombre || "Producción") + "</span>" +
    '<span class="pedido-ref-etapa">' + esc(etapas[idx].label) + "</span>" +
    '<span class="pedido-ref-frac" title="Etapa ' + (idx + 1) + " de " + etapas.length + '">' + (idx + 1) + "/" + etapas.length + "</span>" +
    '<span class="pedido-ref-btns">' +
    '<button class="btn ghost small"' + (idx === 0 ? " disabled" : "") + ' data-action="' + o.accionRetroceder + '"' + datos +
    ' title="Retroceder' + (idx > 0 ? " a " + esc(etapas[idx - 1].label) : "") + '" aria-label="Retroceder una etapa">←</button>' +
    '<button class="btn ghost small"' + (idx === etapas.length - 1 ? " disabled" : "") + ' data-action="' + o.accionAvanzar + '"' + datos +
    ' title="Avanzar' + (idx < etapas.length - 1 ? " a " + esc(etapas[idx + 1].label) : "") + '" aria-label="Avanzar una etapa">→</button>' +
    "</span></div>";
  return html;
}

function iconoLupa() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
}

// form: "pedido" | "cotizacion" — debe existir state.form<Form> con {cliente, clienteId}.
export function renderClienteCombo(form, inputId, f) {
  var html = '<div class="field combo-wrap"><label>Cliente</label>' +
    '<input id="' + inputId + '" autocomplete="off" data-form="' + form + '" data-field="cliente" value="' + esc(f.cliente) + '" placeholder="Escribe para buscar o crear uno nuevo" />';

  if (f.clienteId) {
    var c = clienteById(f.clienteId);
    if (c) {
      html += '<div class="combo-linked">✓ Vinculado a cliente registrado' + (c.ciudad ? " · " + esc(c.ciudad) : "") + '</div>';
    }
  } else if ((f.cliente || "").trim().length >= 1) {
    var matches = buscarClientesCombo(f.cliente);
    if (matches.length > 0) {
      html += '<div class="combo-suggestions">' + matches.map(function (c) {
        return '<div class="combo-item" data-action="select-cliente" data-form="' + form + '" data-id="' + c.id + '"><b>' + esc(c.nombre) + '</b><span>' + esc(c.cedula || "sin documento") + (c.ciudad ? " · " + esc(c.ciudad) : "") + '</span></div>';
      }).join("") + '</div>';
    } else {
      html += '<div class="combo-suggestions"><div class="combo-empty">Sin coincidencias — se guardará como cliente libre (o regístralo en la pestaña Contactos).</div></div>';
    }
  }
  html += "</div>";
  return html;
}
