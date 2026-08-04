// Pestaña "Resumen": los KPIs del negocio y el reporte financiero completo
// viven acá (antes estaban en Configuración, que es donde vive la marca/
// datos del negocio, no donde alguien busca sus números del día a día).

import { state, notify } from "../core/store.js";
import { esc, fmt, todayStr, num } from "../core/utils.js";
import {
  calcCotizacionTotales, listaDeudores, estadoLabelDe, calcSerieMovimientos,
  calcCaja, calcPorCobrar, calcPedidosActivos, calcResumenPorPagar,
  calcResumenMovimientos, calcGastoInsumosMensual
} from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { generarPDFReporteFinanciero } from "../core/pdf.js";
import { getSession } from "../core/auth.js";

export function render() {
  var proximas = state.pedidos
    .filter(function (p) { return p.estado !== "entregado" && p.fechaEntrega; })
    .sort(function (a, b) { return new Date(a.fechaEntrega) - new Date(b.fechaEntrega); })
    .slice(0, 5);
  var deudores = listaDeudores().slice(0, 6);
  var urgentes = state.pendientes.filter(function (p) { return !p.hecho && p.prioridad === "alta"; }).slice(0, 5);
  var cotizacionesAbiertas = state.cotizaciones.filter(function (c) { return c.estado !== "convertida"; }).slice(0, 5);

  var html = renderKpis();

  html += renderAvisoPropuestasPendientes();

  html += renderGraficaResumen();

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

  html += renderReportePeriodo();
  return html;
}

// Cifras grandes del negocio — antes vivían en Configuración (junto a marca/
// datos de facturación), que no es donde alguien busca sus números del día a
// día. Acá, arriba de todo, es lo primero que se ve al entrar.
function renderKpis() {
  var caja = calcCaja(), porCobrar = calcPorCobrar(), activos = calcPedidosActivos();
  var resumenPago = calcResumenPorPagar();
  return '<div class="kpis">' +
    '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="finanzas" title="Ver historial de movimientos"><div class="kpi-label">Caja actual</div><div class="kpi-value ' + (caja < 0 ? "danger" : "success") + '">' + fmt(caja) + '</div><div class="kpi-note">Ingresos y gastos ya pagados</div></div>' +
    '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pedidos" data-filtro-saldo="1" title="Ver pedidos con saldo pendiente"><div class="kpi-label">Por cobrar</div><div class="kpi-value warning">' + fmt(porCobrar) + '</div><div class="kpi-note">Clientes que aún deben</div></div>' +
    renderKpiPorPagar(resumenPago) +
    '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pedidos" title="Ver pedidos activos"><div class="kpi-label">Pedidos activos</div><div class="kpi-value info">' + activos + '</div><div class="kpi-note">Solo pedidos (no cuenta cotizaciones)</div></div>' +
    "</div>";
}
// Aviso para el admin de cambios propuestos por un vendedor que siguen sin
// revisar (precio de insumo/producto, movimiento manual de stock, categoría)
// — antes solo se veían si el admin entraba puntualmente a Catálogo o
// Productos; acá queda visible apenas entra al panel, con acceso directo a
// revisarlos. Un vendedor no ve este aviso (ya ve si LO SUYO sigue pendiente
// dentro de cada pestaña) — es información de gestión, no de su propio trabajo.
function renderAvisoPropuestasPendientes() {
  var session = getSession();
  if (session && session.rol === "vendedor") return "";
  var catalogo = (state.catalogoPropuestas || []).length;
  var productos = (state.productoPropuestas || []).length;
  var total = catalogo + productos;
  if (!total) return "";
  var detalle = [];
  if (catalogo) detalle.push(catalogo + " de insumos");
  if (productos) detalle.push(productos + " de producto/stock");
  return '<div class="card" style="border-color:var(--warning);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
    '<div><div class="section-title small" style="margin:0;">⏳ ' + total + (total === 1 ? " cambio propuesto" : " cambios propuestos") + " por revisar" +
    renderHelp("Un vendedor propuso cambios (precio, categoría, o un movimiento manual de stock) que no se aplican hasta que los apruebes. Las ventas y remisiones reales nunca pasan por acá — se aplican de inmediato.") +
    '</div><div class="section-sub" style="margin:4px 0 0;">' + detalle.join(" · ") + "</div></div>" +
    '<span style="display:flex;gap:8px;">' +
    (catalogo ? '<button class="btn ghost small" data-action="kpi-nav" data-tab="catalogo">Revisar insumos</button>' : "") +
    (productos ? '<button class="btn ghost small" data-action="kpi-nav" data-tab="productos">Revisar productos</button>' : "") +
    "</span></div>";
}

// KPI "Por pagar" inteligente: en vez del total acumulado, muestra lo más
// urgente — obligaciones vencidas (si las hay) o el próximo vencimiento. El
// total general de todo lo pendiente sigue viviendo en Pendientes.
function renderKpiPorPagar(r) {
  if (r.estado === "aldia") {
    return '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pendientes" title="Ver cuentas por pagar"><div class="kpi-label">Por pagar</div><div class="kpi-value success">Al día</div><div class="kpi-note">Sin obligaciones pendientes</div></div>';
  }
  if (r.estado === "vencidas") {
    return '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pendientes" title="Ver cuentas por pagar"><div class="kpi-label">Obligaciones vencidas</div><div class="kpi-value danger">' + fmt(r.monto) + '</div><div class="kpi-note">' + r.cantidad + (r.cantidad === 1 ? " obligación vencida" : " obligaciones vencidas") + "</div></div>";
  }
  var fechaCorta = r.fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }).replace(".", "");
  return '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pendientes" title="Ver cuentas por pagar"><div class="kpi-label">Próximo vencimiento</div><div class="kpi-value warning">' + esc(fechaCorta) + " · " + fmt(r.monto) + '</div><div class="kpi-note">' + r.cantidad + (r.cantidad === 1 ? " obligación" : " obligaciones") + "</div></div>";
}

// Gráfica de ingresos/gastos de los últimos 30 días — a diferencia del
// reporte de abajo (que tiene su propio selector de fechas para generar un
// PDF de un periodo específico), esta es solo para un vistazo rápido al
// entrar: sin controles, un rango fijo. Mismo cálculo (calcSerieMovimientos)
// que usaría cualquier otro reporte de la app, así que nunca puede "llevar
// la cuenta distinto".
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

// Único panel de reporte financiero (antes había dos: uno con números de
// TODO el histórico, sin relación con el rango de fechas del otro, que solo
// servía para el PDF). El mismo rango alimenta los números en vivo y el PDF
// — nunca puede pasar que la pantalla y el PDF de un mismo periodo digan
// cosas distintas, porque los dos usan calcResumenMovimientos(). El gasto en
// insumos por mes vive acá también, como parte del mismo reporte, en vez de
// como una tarjeta aparte sin relación aparente.
function renderReportePeriodo() {
  var fr = state.formReporte;
  var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
  var resumen = calcResumenMovimientos(movimientos);
  var html = '<div class="card"><div class="section-title small">Reporte financiero' +
    renderHelp("Elige un rango de fechas (o usa los atajos) — los números y el PDF de abajo son siempre del mismo rango, para que nunca digan cosas distintas entre sí. La gráfica de ingresos/gastos de los últimos 30 días está arriba, sin selector de fechas.") +
    "</div>";
  html += '<div class="filters" style="margin-bottom:10px;">' +
    ["hoy", "semana", "mes", "año"].map(function (k) {
      var label = { hoy: "Hoy", semana: "Esta semana", mes: "Este mes", "año": "Este año" }[k];
      return '<button class="chip" data-action="set-reporte-atajo" data-val="' + k + '">' + label + "</button>";
    }).join("") +
    "</div>";
  html += '<div class="form-grid">' +
    '<div class="field"><label>Desde</label><input type="date" data-form="reporte" data-field="desde" value="' + esc(fr.desde) + '" /></div>' +
    '<div class="field"><label>Hasta</label><input type="date" data-form="reporte" data-field="hasta" value="' + esc(fr.hasta) + '" /></div>' +
    "</div>";

  html += '<div class="report-grid" style="margin-top:14px;">' +
    '<div class="report-item"><div class="rl">Ingresos</div><div class="rv" style="color:var(--success-ink);">' + fmt(resumen.ingresos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Gastos</div><div class="rv" style="color:var(--danger-ink);">' + fmt(resumen.gastos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Nómina</div><div class="rv" style="color:var(--warning-ink);">' + fmt(resumen.nomina) + "</div></div>" +
    '<div class="report-item"><div class="rl">Comisiones</div><div class="rv" style="color:var(--info-ink);">' + fmt(resumen.comisiones) + "</div></div>" +
    '<div class="report-item"><div class="rl">Balance neto</div><div class="rv">' + fmt(resumen.balance) + "</div></div>" +
    "</div>";

  html += '<div class="section-sub" style="margin-top:10px;">' + movimientos.length + " movimiento(s) en este rango.</div>";
  html += '<div class="pedido-actions" style="margin-top:6px;">' +
    '<button class="btn" data-action="generar-reporte-pdf">Generar PDF del periodo</button>' +
    '<button class="btn ghost small" data-action="export-csv">Descargar CSV de todos los movimientos</button>' +
    "</div>";

  html += '<hr class="stitch" />';
  html += renderGastoInsumos();

  html += "</div>";
  return html;
}

// "Inventario negativo" (ver calcGastoInsumosMensual en core/calc.js): no
// cuánto insumo hay en stock, sino cuánto se gastó en insumos cada mes —
// para saber cuándo conviene empezar a comprar al por mayor. Parte del
// reporte financiero (no un rango de fechas propio: siempre por mes).
function renderGastoInsumos() {
  var meses = calcGastoInsumosMensual();
  var html = '<div class="section-title small">Gasto en insumos por mes' +
    renderHelp("No es un inventario de lo que tenés guardado (no manejás stock) — es cuánto gastaste en insumos cada mes, sumado desde las cotizaciones de ese mes. Sirve para decidir cuándo conviene empezar a comprar al por mayor — ahí sí tendría sentido llevar inventario de verdad.") +
    "</div>";
  if (!meses.length) {
    return html + '<div class="empty">Todavía no hay cotizaciones con insumos para reportar.</div>';
  }
  meses.slice(0, 6).forEach(function (m) {
    html += '<div class="section-sub" style="margin:14px 0 6px;display:flex;justify-content:space-between;">' +
      "<b style=\"color:var(--ink);\">" + esc(etiquetaMes(m.mes)) + "</b><span class=\"amount\">" + fmt(m.total) + "</span></div>";
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
      m.insumos.slice(0, 8).map(function (i) { return '<span class="badge">' + esc(i.nombre) + " · " + fmt(i.costoTotal) + "</span>"; }).join("") +
      "</div>";
  });
  return html;
}
function etiquetaMes(mes) {
  var partes = mes.split("-");
  var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return meses[Number(partes[1]) - 1] + " " + partes[0];
}

export var actions = {
  "set-reporte-atajo": function (el) {
    var hoy = new Date();
    var desde, hasta = todayStr();
    var k = el.getAttribute("data-val");
    if (k === "hoy") {
      desde = todayStr();
    } else if (k === "semana") {
      var d = new Date(hoy);
      var diaSemana = (d.getDay() + 6) % 7; // lunes = 0
      d.setDate(d.getDate() - diaSemana);
      desde = isoDate(d);
    } else if (k === "mes") {
      desde = isoDate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    } else if (k === "año") {
      desde = isoDate(new Date(hoy.getFullYear(), 0, 1));
    }
    state.formReporte = { desde: desde, hasta: hasta };
    notify();
  },
  "generar-reporte-pdf": async function () {
    var fr = state.formReporte;
    if (!fr.desde || !fr.hasta) { window.alert("Elige una fecha de inicio y una de corte."); return; }
    var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
    var etiqueta = fr.desde === fr.hasta ? fr.desde : (fr.desde + " a " + fr.hasta);
    await generarPDFReporteFinanciero(movimientos, fr.desde, fr.hasta, etiqueta);
  },
  "export-csv": function () {
    exportCSV();
  }
};

function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function exportCSV() {
  try {
    var rows = [["Fecha", "Tipo", "Concepto", "Persona/Cliente", "Monto"]];
    state.tx.forEach(function (t) {
      rows.push([t.fecha, t.tipo, t.concepto, t.contraparte || "", t.monto]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "balance-" + todayStr() + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("No se pudo exportar CSV", e);
  }
}
