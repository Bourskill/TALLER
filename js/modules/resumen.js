// Pestaña "Resumen". Solo lectura: no define `actions` propias porque no
// tiene formularios ni botones de mutación (los "Ver todos" usan la acción
// genérica "tab" que ya vive en core/dom.js).

import { state } from "../core/store.js";
import { esc, fmt } from "../core/utils.js";
import { num } from "../core/utils.js";
import { ESTADO_LABEL } from "../core/constants.js";
import { calcCotizacionTotales, listaDeudores, estadoLabelDe } from "../core/calc.js";

export function render() {
  var proximas = state.pedidos
    .filter(function (p) { return p.estado !== "entregado" && p.fechaEntrega; })
    .sort(function (a, b) { return new Date(a.fechaEntrega) - new Date(b.fechaEntrega); })
    .slice(0, 5);
  var deudores = listaDeudores().slice(0, 6);
  var urgentes = state.pendientes.filter(function (p) { return !p.hecho && p.prioridad === "alta"; }).slice(0, 5);
  var cotizacionesAbiertas = state.cotizaciones.filter(function (c) { return c.estado !== "convertida"; }).slice(0, 5);

  var html = '<div class="card"><div class="section-title">Próximas entregas</div><div class="section-sub">Pedidos ordenados por fecha comprometida</div>';
  if (proximas.length === 0) { html += '<div class="empty">No hay entregas programadas todavía.</div>'; }
  proximas.forEach(function (p) {
    var saldo = num(p.total) - num(p.abono);
    html += '<div class="tx-row" style="grid-template-columns:110px 1fr 130px 100px;">' +
      "<span style=\"font-family:'IBM Plex Mono',monospace;\">" + esc(p.fechaEntrega) + "</span>" +
      "<span>" + esc(p.cliente) + " — " + esc(p.descripcion) + "</span>" +
      '<span class="tag" style="background:var(--surface-3);color:var(--accent);">' + esc(estadoLabelDe(p)) + "</span>" +
      '<span class="amount">' + fmt(saldo) + " saldo</span>" +
      "</div>";
  });
  html += "</div>";

  html += '<div class="two-col">';
  html += '<div class="card"><div class="section-title small">Quién debe</div>';
  if (deudores.length === 0) { html += '<div class="empty">Nadie tiene saldo pendiente. 🎉</div>'; }
  deudores.forEach(function (d) {
    html += '<div class="tx-row" style="grid-template-columns:1fr 90px;">' +
      "<span>" + esc(d.nombre) + "</span>" +
      '<span class="amount neg">' + fmt(d.monto) + "</span>" +
      "</div>";
  });
  html += '<button class="btn ghost small" style="margin-top:10px;" data-action="kpi-nav" data-tab="pedidos" data-filtro-saldo="1">Ver pedidos con saldo</button></div>';

  html += '<div class="card"><div class="section-title small">Notas urgentes</div>';
  if (urgentes.length === 0) { html += '<div class="empty">Sin notas de prioridad alta.</div>'; }
  urgentes.forEach(function (p) {
    html += '<div class="tx-row" style="grid-template-columns:1fr;"><span>' + esc(p.texto) + "</span></div>";
  });
  html += '<button class="btn ghost small" style="margin-top:10px;" data-action="tab" data-tab="notas">Ver todas</button></div>';
  html += "</div>";

  if (cotizacionesAbiertas.length > 0) {
    html += '<div class="card"><div class="section-title small">Cotizaciones sin convertir</div>';
    cotizacionesAbiertas.forEach(function (c) {
      var t = calcCotizacionTotales(c);
      html += '<div class="tx-row" style="grid-template-columns:1fr 130px 100px;">' +
        "<span>" + esc(c.cliente) + " — " + esc(c.descripcion) + "</span>" +
        '<span class="amount">' + fmt(t.precioTotal) + " venta</span>" +
        "<span></span>" +
        "</div>";
    });
    html += '<button class="btn ghost small" style="margin-top:10px;" data-action="tab" data-tab="cotizaciones">Ver cotizaciones</button></div>';
  }
  return html;
}
