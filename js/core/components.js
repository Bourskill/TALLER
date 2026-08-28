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
