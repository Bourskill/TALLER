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
  var activos = state.pedidos.filter(function (p) { return p.estado !== "entregado"; });
  var proximas = activos
    .filter(function (p) { return p.fechaEntrega; })
    .sort(function (a, b) { return new Date(a.fechaEntrega) - new Date(b.fechaEntrega); })
    .slice(0, 5);
  // Un pedido convertido desde una cotización nace SIN fecha de entrega (se
  // agrega después, desde la tarjeta del pedido) — sin este mensaje, un
  // taller donde TODOS los pedidos activos vienen de cotizaciones veía "No
  // hay entregas programadas" para siempre, indistinguible de "no tengo
  // pedidos activos".
  var activosSinFecha = activos.length - activos.filter(function (p) { return p.fechaEntrega; }).length;
  var deudores = listaDeudores().slice(0, 6);
  var urgentes = state.pendientes.filter(function (p) { return !p.hecho && p.prioridad === "alta"; }).slice(0, 5);
  var cotizacionesAbiertas = state.cotizaciones.filter(function (c) { return c.estado !== "convertida"; }).slice(0, 5);

  var html = renderKpis();

  html += renderAvisoPropuestasPendientes();

  html += renderGraficaResumen();

  html += renderRendimientoPlanta();

  html += renderProximasEntregas(proximas, activosSinFecha);

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

// Ranking de lo más próximo a entregar: puesto (1, 2, 3...), cuánto falta en
// días (que es la pregunta real —"¿esto se me está venciendo?"— y no se
// responde leyendo una fecha suelta), y acceso directo al pedido. La fecha
// exacta queda como dato secundario debajo del contador.
function renderProximasEntregas(proximas, activosSinFecha) {
  var html = '<div class="card"><div class="section-title">Próximas entregas' +
    renderHelp("Pedidos activos con fecha de entrega, del más próximo al más lejano. La fecha se define al cotizar (se hereda al convertir en pedido) o directamente en la tarjeta del pedido. Un pedido entregado sale de esta lista.") +
    "</div>";
  if (proximas.length === 0) {
    html += activosSinFecha > 0
      ? '<div class="empty">Tienes <b>' + activosSinFecha + (activosSinFecha === 1 ? " pedido activo</b> sin" : " pedidos activos</b> sin") + ' fecha de entrega — defínela en la cotización o en la tarjeta del pedido para que aparezcan acá.</div>'
      : '<div class="empty">No hay entregas programadas todavía.</div>';
    return html + "</div>";
  }
  proximas.forEach(function (p, i) {
    var saldo = num(p.total) - num(p.abono);
    var d = diasHasta(p.fechaEntrega);
    html += '<div class="entrega-row" data-action="ir-a-pedido" data-id="' + p.id + '" title="Ver este pedido">' +
      '<span class="entrega-puesto">' + (i + 1) + "</span>" +
      '<span class="entrega-plazo ' + d.clase + '">' + esc(d.texto) + '<small>' + esc(p.fechaEntrega) + "</small></span>" +
      '<span class="entrega-desc"><b>' + esc(p.cliente) + "</b><small>" + esc(p.descripcion) + "</small></span>" +
      '<span class="tag" style="background:var(--surface-3);color:var(--accent);">' + esc(estadoLabelDe(p)) + "</span>" +
      '<span class="amount' + (saldo > 0 ? " neg" : "") + '">' + (saldo > 0 ? fmt(saldo) + " por cobrar" : "pagado") + "</span>" +
      "</div>";
  });
  return html + "</div>";
}

// Días calendario entre hoy y una fecha "YYYY-MM-DD", en texto humano. Ambas
// se normalizan a medianoche local para que "mañana" no dependa de la hora a
// la que se abra la app.
function diasHasta(fechaStr) {
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var objetivo = new Date(fechaStr + "T00:00:00");
  var dias = Math.round((objetivo - hoy) / 86400000);
  if (dias < 0) return { texto: "Vencido hace " + Math.abs(dias) + (Math.abs(dias) === 1 ? " día" : " días"), clase: "vencido" };
  if (dias === 0) return { texto: "Hoy", clase: "vencido" };
  if (dias === 1) return { texto: "Mañana", clase: "urgente" };
  if (dias <= 7) return { texto: "En " + dias + " días", clase: "urgente" };
  return { texto: "En " + dias + " días", clase: "" };
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
//
// Dibujada con Chart.js (window.Chart, cargado en index.html) en vez del SVG
// a mano de antes — se ve mejor y trae tooltips/leyenda gratis. Como esta
// app re-renderiza TODO el HTML como string en cada notify() (sin virtual
// DOM), el <canvas> se recrea de cero en cada render — Chart.js necesita
// engancharse DESPUÉS de que ese HTML ya esté en el DOM real, así que la
// instancia se crea en afterRender() (ver core/dom.js), no acá.
function renderGraficaResumen() {
  var serie = serieResumen30Dias();
  var html = '<div class="card"><div class="section-title">Ingresos y gastos' +
    '<span style="font-weight:400;font-size:12px;color:var(--ink-faint);margin-left:8px;">últimos 30 días</span></div>';
  if (!serie.puntos.length) {
    return html + '<div class="empty" style="padding:10px 0;">Sin movimientos en este rango para graficar.</div></div>';
  }
  return html + '<div style="position:relative;height:220px;"><canvas id="chart-ingresos-gastos"></canvas></div></div>';
}

function serieResumen30Dias() {
  var hasta = todayStr();
  var d = new Date(); d.setDate(d.getDate() - 29);
  var desde = isoDate(d);
  var movimientos = state.tx.filter(function (t) { return t.fecha >= desde && t.fecha <= hasta; });
  return calcSerieMovimientos(movimientos, desde, hasta);
}

// "Rendimiento de planta": no cuánto stock hay (eso vive en Catálogo), sino
// cuántas prendas SALIERON (ventas + remisiones de consignación) cada día —
// un proxy directo de cuánto está produciendo/despachando el taller día a
// día. Reutiliza movimientosStock (ver core/stock.js), que ya documenta cada
// salida real de stock — no es un dato nuevo que haya que empezar a llevar.
function renderRendimientoPlanta() {
  var datos = datosPrendasPorDia();
  var html = '<div class="card"><div class="section-title">Rendimiento de planta' +
    '<span style="font-weight:400;font-size:12px;color:var(--ink-faint);margin-left:8px;">prendas producidas — últimos 30 días</span>' +
    renderHelp("Cuenta las salidas de stock del Catálogo (ventas directas y remisiones de consignación) por día — cuántas prendas terminadas salieron de la planta cada día, no cuánto queda en stock.") +
    "</div>";
  if (!datos.total) {
    return html + '<div class="empty" style="padding:10px 0;">Sin salidas de stock registradas en este rango.</div></div>';
  }
  return html + '<div style="position:relative;height:200px;"><canvas id="chart-prendas-dia"></canvas></div>' +
    '<div class="section-sub" style="margin-top:8px;">' + datos.total + " prendas en los últimos 30 días · promedio " + (datos.total / 30).toFixed(1) + "/día</div>" +
    "</div>";
}

function datosPrendasPorDia() {
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var dias = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(hoy); d.setDate(d.getDate() - i);
    dias.push(isoDate(d));
  }
  var porDia = {};
  dias.forEach(function (k) { porDia[k] = 0; });
  (state.productos || []).forEach(function (p) {
    (p.movimientosStock || []).forEach(function (m) {
      if (m.tipo === "salida" && porDia.hasOwnProperty(m.fecha)) porDia[m.fecha] += num(m.cantidad);
    });
  });
  var total = dias.reduce(function (a, k) { return a + porDia[k]; }, 0);
  return { labels: dias, valores: dias.map(function (k) { return porDia[k]; }), total: total };
}

function etiquetaFechaCorta(iso) {
  var partes = iso.split("-");
  return partes[2] + "/" + partes[1];
}

function cssVar(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

var chartIngresosGastos = null, chartPrendasDia = null;

// Único punto imperativo de este módulo (todo lo demás es render() puro que
// devuelve un string) — llamado por core/dom.js justo después de insertar el
// HTML en el DOM real. Si el CDN de Chart.js no cargó (ej. sin internet), se
// sale en silencio: el resto del panel (KPIs, reporte financiero, etc.)
// sigue funcionando igual, solo faltan estas dos gráficas.
export function afterRender() {
  if (typeof window.Chart === "undefined") return;
  dibujarChartIngresosGastos();
  dibujarChartPrendasDia();
}

function dibujarChartIngresosGastos() {
  if (chartIngresosGastos) { chartIngresosGastos.destroy(); chartIngresosGastos = null; }
  var canvas = document.getElementById("chart-ingresos-gastos");
  if (!canvas) return;
  var serie = serieResumen30Dias();
  if (!serie.puntos.length) return;
  var ink = cssVar("--ink-faint"), grid = cssVar("--border-soft");
  chartIngresosGastos = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: serie.puntos.map(function (p) { return etiquetaPuntoGrafica(p.clave, serie.granularidad); }),
      datasets: [
        { label: "Ingresos", data: serie.puntos.map(function (p) { return p.ingresos; }), backgroundColor: cssVar("--success"), borderRadius: 4, maxBarThickness: 22 },
        { label: "Gastos", data: serie.puntos.map(function (p) { return p.gastos; }), backgroundColor: cssVar("--danger"), borderRadius: 4, maxBarThickness: 22 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: ink, boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + fmt(ctx.parsed.y); } } }
      },
      scales: {
        x: { ticks: { color: ink }, grid: { display: false } },
        y: { ticks: { color: ink, callback: function (v) { return fmtCorto(v); } }, grid: { color: grid }, beginAtZero: true }
      }
    }
  });
}

function dibujarChartPrendasDia() {
  if (chartPrendasDia) { chartPrendasDia.destroy(); chartPrendasDia = null; }
  var canvas = document.getElementById("chart-prendas-dia");
  if (!canvas) return;
  var datos = datosPrendasPorDia();
  if (!datos.total) return;
  var ink = cssVar("--ink-faint"), grid = cssVar("--border-soft"), accent = cssVar("--info");
  chartPrendasDia = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: datos.labels.map(etiquetaFechaCorta),
      datasets: [{ label: "Prendas producidas", data: datos.valores, borderColor: accent, backgroundColor: accent, tension: 0.3, fill: false, pointRadius: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.y + " prendas"; } } } },
      scales: {
        x: { ticks: { color: ink, maxTicksLimit: 10 }, grid: { display: false } },
        y: { ticks: { color: ink, precision: 0 }, grid: { color: grid }, beginAtZero: true }
      }
    }
  });
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
    '<div class="report-item"><div class="rl">De los cuales, insumos' + renderHelp("Parte de \"Gastos\" que corresponde a compras de insumo YA REALES — registradas como costo real en una cotización, o marcadas \"Es compra de insumo\" al registrar un movimiento en Finanzas. No confundir con \"Insumos cotizados por mes\" de más abajo, que es solo una estimación.") + '</div><div class="rv" style="color:var(--danger-ink);">' + fmt(resumen.insumosReales) + "</div></div>" +
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
  var abierto = !!state.gastoInsumosAbierto;
  var totalGlobal = meses.reduce(function (a, m) { return a + m.total; }, 0);

  // Colapsado por defecto: es un reporte de consulta ocasional ("¿ya me
  // conviene comprar al por mayor?"), no algo que se mire todos los días, y
  // en un taller con meses de historia ocupaba media pantalla del Resumen.
  var html = '<div class="section-title small" style="cursor:pointer;display:flex;align-items:center;gap:8px;" data-action="toggle-gasto-insumos">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierto ? "▾" : "▸") + "</button>" +
    "<span>Insumos cotizados por mes — estimado, no es gasto real</span>" +
    renderHelp("⚠️ ESTO ES UNA ESTIMACIÓN, no dinero que ya salió: suma lo cotizado en todas las cotizaciones de ese mes (se hayan convertido en pedido o no). No es un inventario de lo que tenés guardado tampoco (no manejás stock de insumos) — sirve para decidir cuándo conviene empezar a comprar al por mayor. Para que un gasto de insumos cuente como REAL (y aparezca en \"Gastos\" y en \"de los cuales, insumos\" de arriba), regístralo como costo real en la cotización o marca \"Es compra de insumo\" al registrar un movimiento en Finanzas.") +
    (meses.length ? '<span class="amount" style="margin-left:auto;font-size:13px;">' + fmt(totalGlobal) + "</span>" : "") +
    "</div>";

  if (!meses.length) {
    return html + '<div class="empty">Todavía no hay cotizaciones con insumos para reportar.</div>';
  }
  if (!abierto) return html;

  var COLS = "1fr 110px";
  meses.slice(0, 6).forEach(function (m) {
    html += '<div class="section-sub" style="margin:16px 0 4px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;">' +
      '<b style="color:var(--ink);font-size:13px;">' + esc(etiquetaMes(m.mes)) + "</b>" +
      '<span class="amount">' + fmt(m.total) + "</span></div>";
    html += '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Insumo</span><span>Costo</span></div>';
    m.insumos.slice(0, 12).forEach(function (i) {
      html += '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
        '<span class="mobile-th">Insumo</span><span>' + esc(i.nombre) + (i.unidad ? ' <span style="color:var(--ink-faint);font-size:11px;">(' + esc(i.unidad) + ")</span>" : "") + "</span>" +
        '<span class="mobile-th">Costo</span><span class="amount">' + fmt(i.costoTotal) + "</span>" +
        "</div>";
    });
    if (m.insumos.length > 12) {
      html += '<div class="section-sub" style="margin:6px 0 0;">y ' + (m.insumos.length - 12) + " insumo(s) más en este mes.</div>";
    }
  });
  return html;
}
function etiquetaMes(mes) {
  var partes = mes.split("-");
  var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return meses[Number(partes[1]) - 1] + " " + partes[0];
}

export var actions = {
  // Mismo patrón de "ir al registro de origen" que ya usan Finanzas
  // ("↗ Origen") y Pendientes ("↗ Ver"): navega a Pedidos → Historial, hace
  // scroll a la tarjeta y la hace destellar para identificarla entre varias.
  "ir-a-pedido": function (el) {
    var id = el.getAttribute("data-id");
    state.tab = "pedidos";
    state.sidebarMobileOpen = false;
    state.filtroPedidosVista = "activos";
    state.pedidosVista = "historial";
    notify();
    setTimeout(function () {
      var card = document.querySelector('[data-pedido-id="' + id + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("destello");
    }, 60);
  },
  "toggle-gasto-insumos": function () {
    state.gastoInsumosAbierto = !state.gastoInsumosAbierto;
    notify();
  },
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
