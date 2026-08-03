// Pestaña "Resumen". Solo lectura: no define `actions` propias porque no
// tiene formularios ni botones de mutación (los "Ver todos" usan la acción
// genérica "tab" que ya vive en core/dom.js).

import { state } from "../core/store.js";
import { esc, fmt, todayStr } from "../core/utils.js";
import { num } from "../core/utils.js";
import { ESTADO_LABEL } from "../core/constants.js";
import { calcCotizacionTotales, listaDeudores, estadoLabelDe, calcSerieMovimientos } from "../core/calc.js";

export function render() {
  var proximas = state.pedidos
    .filter(function (p) { return p.estado !== "entregado" && p.fechaEntrega; })
    .sort(function (a, b) { return new Date(a.fechaEntrega) - new Date(b.fechaEntrega); })
    .slice(0, 5);
  var deudores = listaDeudores().slice(0, 6);
  var urgentes = state.pendientes.filter(function (p) { return !p.hecho && p.prioridad === "alta"; }).slice(0, 5);
  var cotizacionesAbiertas = state.cotizaciones.filter(function (c) { return c.estado !== "convertida" && !c.esDemo; }).slice(0, 5);

  var html = renderGraficaResumen();

  html += '<div class="card"><div class="section-title">Próximas entregas</div><div class="section-sub">Pedidos ordenados por fecha comprometida</div>';
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
    html += '<button class="btn ghost small" style="margin-top:10px;" data-action="kpi-nav" data-tab="cotizaciones">Ver cotizaciones</button></div>';
  }
  return html;
}

// Gráfica de ingresos/gastos de los últimos 30 días — a diferencia del
// reporte de Configuración (que tiene su propio selector de fechas para
// generar un PDF de un periodo específico), esta es solo para un vistazo
// rápido al entrar: sin controles, un rango fijo. Mismo cálculo
// (calcSerieMovimientos) que usaría cualquier otro reporte de la app, así
// que nunca puede "llevar la cuenta distinto".
function renderGraficaResumen() {
  var hasta = todayStr();
  var d = new Date(); d.setDate(d.getDate() - 29);
  var desde = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  var movimientos = state.tx.filter(function (t) { return t.fecha >= desde && t.fecha <= hasta; });
  var serie = calcSerieMovimientos(movimientos, desde, hasta);
  return '<div class="card"><div class="section-title">Ingresos y gastos' +
    '<span style="font-weight:400;font-size:12px;color:var(--ink-faint);margin-left:8px;">últimos 30 días</span></div>' +
    renderGraficaBarras(serie) +
    "</div>";
}

// SVG plano, sin librería externa — reutiliza los colores semánticos ya
// definidos en variables.css, así queda bien en modo claro y oscuro sin
// código aparte. Barras pareadas ingresos/gastos por punto.
function renderGraficaBarras(serie) {
  if (!serie.puntos.length) return '<div class="empty" style="padding:10px 0;">Sin movimientos en este rango para graficar.</div>';
  var W = 640, H = 200, padL = 50, padB = 20, padT = 10, padR = 10;
  var innerW = W - padL - padR, innerH = H - padT - padB;
  var maxVal = serie.puntos.reduce(function (m, p) { return Math.max(m, p.ingresos, p.gastos); }, 0) || 1;
  var n = serie.puntos.length;
  var groupW = innerW / n;
  var barW = Math.max(2, Math.min(18, groupW / 3));
  var mostrarEtiquetas = n <= 14;

  var gridLines = [0, 0.5, 1].map(function (f) {
    var yy = padT + innerH - f * innerH;
    return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="var(--border-soft)" stroke-width="1" />' +
      '<text x="' + (padL - 6) + '" y="' + (yy + 3) + '" font-size="9" text-anchor="end" fill="var(--ink-faint)">' + esc(fmtCorto(f * maxVal)) + "</text>";
  }).join("");

  var bars = serie.puntos.map(function (p, i) {
    var xGroup = padL + i * groupW + groupW / 2;
    var hIng = (p.ingresos / maxVal) * innerH, hGas = (p.gastos / maxVal) * innerH;
    var xIng = xGroup - barW - 2, xGas = xGroup + 2;
    var etiqueta = etiquetaPuntoGrafica(p.clave, serie.granularidad);
    return '<rect x="' + xIng + '" y="' + (padT + innerH - hIng) + '" width="' + barW + '" height="' + hIng + '" fill="var(--success)" rx="2"><title>Ingresos ' + esc(etiqueta) + ": " + esc(fmt(p.ingresos)) + '</title></rect>' +
      '<rect x="' + xGas + '" y="' + (padT + innerH - hGas) + '" width="' + barW + '" height="' + hGas + '" fill="var(--danger)" rx="2"><title>Gastos ' + esc(etiqueta) + ": " + esc(fmt(p.gastos)) + '</title></rect>' +
      (mostrarEtiquetas ? '<text x="' + xGroup + '" y="' + (H - 4) + '" font-size="9" text-anchor="middle" fill="var(--ink-faint)">' + esc(etiqueta) + "</text>" : "");
  }).join("");

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;max-height:220px;display:block;" role="img" aria-label="Ingresos y gastos por periodo">' + gridLines + bars + "</svg>" +
    '<div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--ink-faint);">' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:var(--success);border-radius:2px;margin-right:4px;"></span>Ingresos</span>' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:var(--danger);border-radius:2px;margin-right:4px;"></span>Gastos</span>' +
    "</div>";
}
function etiquetaPuntoGrafica(clave, granularidad) {
  if (granularidad === "mes") {
    var partes = clave.split("-");
    var meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return meses[Number(partes[1]) - 1] + " " + partes[0].slice(2);
  }
  var d2 = new Date(clave + "T00:00:00");
  return String(d2.getDate()).padStart(2, "0") + "/" + String(d2.getMonth() + 1).padStart(2, "0");
}
function fmtCorto(n) {
  if (Math.abs(n) >= 1000000) return "$" + (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1000) return "$" + Math.round(n / 1000) + "k";
  return fmt(n);
}
