// Pestaña "Resumen": los KPIs del negocio y el reporte financiero completo
// viven acá (antes estaban en Configuración, que es donde vive la marca/
// datos del negocio, no donde alguien busca sus números del día a día).

import { state, notify } from "../core/store.js";
import { esc, fmt, todayStr, num } from "../core/utils.js";
import {
  calcCotizacionTotales, listaDeudores, estadoLabelDe, calcSerieMovimientos,
  calcCaja, calcPorCobrar, calcPedidosActivos, calcResumenPorPagar,
  calcResumenMovimientos, calcComprasInsumoRango, calcProductosVendidosRango, calcResumenProductosVendidos,
  calcPedidosRango, calcResumenPedidos, calcVentasPorVendedorRango, pedidoCancelado
} from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { generarPDFReporteFinanciero, generarPDFReporteProductos } from "../core/pdf.js";
import { getSession } from "../core/auth.js";

export function render() {
  // Un pedido cancelado no está pendiente de entregar: sacarlo de acá evita
  // que siga apareciendo en "Próximas entregas" como si hubiera que producirlo.
  var activos = state.pedidos.filter(function (p) { return p.estado !== "entregado" && !pedidoCancelado(p); });
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
  dibujarChartReportePeriodo();
}

var chartReportePeriodo = null;

// Gráfica del rango elegido en el reporte (distinta de la de arriba, que son
// siempre los últimos 30 días). Se dibuja solo si su apartado está abierto —
// si el canvas no está en el DOM, no hay nada que hacer.
function dibujarChartReportePeriodo() {
  if (chartReportePeriodo) { chartReportePeriodo.destroy(); chartReportePeriodo = null; }
  var canvas = document.getElementById("chart-reporte-periodo");
  if (!canvas) return;
  var fr = state.formReporte;
  var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
  if (!movimientos.length) return;
  var serie = calcSerieMovimientos(movimientos, fr.desde, fr.hasta);
  if (!serie.puntos.length) return;
  var ink = cssVar("--ink-faint"), grid = cssVar("--border-soft");
  chartReportePeriodo = new window.Chart(canvas, {
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
      // Sin animación: el PDF toma la imagen del canvas apenas se pide, y con
      // animación podría capturarlo a medio dibujar.
      animation: false,
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

// Imagen de la gráfica para incrustarla en el PDF. Devuelve null si el
// apartado está cerrado (no hay canvas) o si Chart.js no cargó — el PDF se
// genera igual, solo sin la gráfica.
function imagenGraficaPeriodo() {
  var canvas = document.getElementById("chart-reporte-periodo");
  if (!canvas || !chartReportePeriodo) return null;
  try {
    return { dataUrl: canvas.toDataURL("image/png", 1), ancho: canvas.width, alto: canvas.height };
  } catch (e) {
    return null;
  }
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

// Panel de reporte. Lo PRINCIPAL es el resumen financiero: es el número que
// se viene a buscar, así que va siempre desplegado y sin un clic de por
// medio. Todo lo demás (insumos, productos, pedidos, vendedores) es detalle
// que explica ese resumen, y vive recogido hasta que se pida.
//
// El mismo rango alimenta lo de pantalla, el PDF y el CSV, y todos entran por
// las mismas funciones de core/calc.js — nunca puede pasar que digan cosas
// distintas entre sí. Solo se reportan movimientos y ventas REALES: lo
// cotizado no es gasto hasta que se registra como compra.
var SECCIONES_REPORTE = [
  { id: "movimientos", label: "Movimientos", ayuda: "Todos los ingresos y gastos del rango, uno por línea." },
  { id: "insumos", label: "Gasto en insumos", ayuda: "Compras de insumo ya pagadas, con cuánto se compró de cada cosa." },
  { id: "productos", label: "Productos vendidos", ayuda: "Qué se vendió, a qué costo y cuánta ganancia dejó cada línea." },
  { id: "pedidos", label: "Pedidos", ayuda: "Los pedidos del rango con su total, lo abonado y lo que falta cobrar." },
  { id: "vendedores", label: "Ventas por vendedor", ayuda: "Cuánto vendió cada quien y qué comisión generó." },
  { id: "grafica", label: "Gráfica de ingresos y gastos", ayuda: "La evolución del rango, en barras." }
];

function seccionAbierta(id) {
  return !!(state.reporteSecciones || {})[id];
}

function renderReportePeriodo() {
  var fr = state.formReporte;
  var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
  var resumen = calcResumenMovimientos(movimientos);

  var html = '<div class="card"><div class="section-title small">Reporte' +
    renderHelp("Elige un rango de fechas (o usa los atajos): los números de pantalla, el PDF y el CSV son siempre del mismo rango. Arriba va el resumen financiero, que es lo principal; abajo, cada apartado que lo explica se abre cuando lo necesites. Lo que entra al PDF se elige aparte, con las casillas del final.") +
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

  // Un rango al revés (o incompleto) no filtra nada y devuelve cero en todo.
  // Sin este aviso se leía como "este periodo no tuvo movimientos", que es una
  // conclusión muy distinta de "el rango está mal escrito".
  if (!fr.desde || !fr.hasta) {
    html += '<div class="empty" style="margin:10px 0;">Completa las dos fechas para ver el reporte.</div></div>';
    return html;
  }
  if (fr.desde > fr.hasta) {
    html += '<div class="empty" style="margin:10px 0;color:var(--danger-ink);"><b>El rango está al revés:</b> la fecha "Desde" (' + esc(fr.desde) +
      ') es posterior a la de "Hasta" (' + esc(fr.hasta) + '), así que no puede haber nada dentro. Corrígelas o usa uno de los atajos de arriba.</div></div>';
    return html;
  }

  // ---- Resumen financiero: siempre visible, es el titular del reporte ----
  html += '<div class="report-grid report-grid-financiero">' +
    '<div class="report-item"><div class="rl">Ingresos</div><div class="rv" style="color:var(--success-ink);">' + fmt(resumen.ingresos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Gastos</div><div class="rv" style="color:var(--danger-ink);">' + fmt(resumen.gastos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Insumos' + renderHelp("Compras de insumo YA REALES, parte de \"Gastos\" — registradas en la tabla de compras de una cotización, o marcadas \"Es compra de insumo\" al registrar un movimiento en Finanzas.") + '</div><div class="rv" style="color:var(--danger-ink);">' + fmt(resumen.insumosReales) + "</div></div>" +
    '<div class="report-item"><div class="rl">Nómina</div><div class="rv" style="color:var(--warning-ink);">' + fmt(resumen.nomina) + "</div></div>" +
    '<div class="report-item"><div class="rl">Comisiones</div><div class="rv" style="color:var(--info-ink);">' + fmt(resumen.comisiones) + "</div></div>" +
    '<div class="report-item"><div class="rl">Balance neto</div><div class="rv">' + fmt(resumen.balance) + "</div></div>" +
    "</div>";
  html += '<div class="section-sub" style="margin-top:10px;">' + movimientos.length + " movimiento(s) en este rango.</div>";

  // ---- El detalle, recogido ----
  html += '<hr class="stitch" style="margin:16px 0;" />';
  html += renderSeccionReporte("grafica", function () { return renderGraficaPeriodo(fr); });
  html += renderSeccionReporte("movimientos", function () { return renderDetalleMovimientos(movimientos); });
  html += renderSeccionReporte("insumos", function () { return renderDesgloseInsumos(calcComprasInsumoRango(movimientos)); });
  html += renderSeccionReporte("productos", function () { return renderDesgloseProductos(fr); });
  html += renderSeccionReporte("pedidos", function () { return renderDesglosePedidos(fr); });
  html += renderSeccionReporte("vendedores", function () { return renderDesgloseVendedores(fr); });

  // ---- Qué llevar al PDF ----
  html += '<hr class="stitch" style="margin:18px 0 14px;" />';
  html += '<div class="cot-col-title">Qué incluir en el PDF' +
    renderHelp("Marca los apartados que quieres en el documento. El resumen financiero de arriba va siempre — es el encabezado del reporte.") +
    "</div>";
  html += '<div class="row-actions" style="flex-wrap:wrap;gap:10px;margin-bottom:12px;">' +
    SECCIONES_REPORTE.map(function (s) {
      // Por defecto van marcadas las que tengan datos: generar el PDF sin
      // pensarlo trae lo que hay, no hojas vacías.
      return checkboxReporte("rep-" + s.id, s.label, seccionTieneDatos(s.id, fr, movimientos));
    }).join("") +
    "</div>";
  html += '<div class="pedido-actions" style="flex-wrap:wrap;">' +
    '<button class="btn" data-action="generar-reporte-pdf">Generar PDF del periodo</button>' +
    '<button class="btn ghost small" data-action="generar-reporte-productos-pdf" title="Reporte aparte, solo de productos: talla, N.º de OP, cliente, vendedor y ganancia de cada venta.">PDF detallado de productos</button>' +
    '<button class="btn ghost small" data-action="export-csv">Descargar CSV de todos los movimientos</button>' +
    "</div>";

  html += "</div>";
  return html;
}

function checkboxReporte(role, label, checked) {
  return '<label class="mini-label" style="display:flex;align-items:center;gap:5px;cursor:pointer;">' +
    '<input type="checkbox" data-role="' + role + '" ' + (checked ? "checked" : "") + " /> " + esc(label) +
    "</label>";
}

// Si un apartado no tiene nada que mostrar, su casilla del PDF nace
// desmarcada: así "generar" nunca produce una sección vacía por descuido.
function seccionTieneDatos(id, fr, movimientos) {
  if (id === "movimientos" || id === "grafica") return movimientos.length > 0;
  if (id === "insumos") return calcComprasInsumoRango(movimientos).length > 0;
  if (id === "productos") return calcProductosVendidosRango(fr.desde, fr.hasta).length > 0;
  if (id === "pedidos") return calcPedidosRango(fr.desde, fr.hasta).length > 0;
  if (id === "vendedores") return calcVentasPorVendedorRango(fr.desde, fr.hasta).length > 0;
  return false;
}

// Cada apartado es un título plegable: cerrado no cuesta nada de pantalla, y
// abierto renderiza su contenido recién ahí (no se calcula lo que no se ve).
function renderSeccionReporte(id, contenido) {
  var def = SECCIONES_REPORTE.filter(function (s) { return s.id === id; })[0] || { label: id, ayuda: "" };
  var abierta = seccionAbierta(id);
  var html = '<div class="cot-col-title" style="cursor:pointer;margin-top:10px;" data-action="toggle-reporte-seccion" data-val="' + id + '">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierta ? "▾" : "▸") + "</button> " + esc(def.label) +
    (def.ayuda ? renderHelp(def.ayuda) : "") +
    "</div>";
  if (abierta) html += contenido();
  return html;
}

function renderGraficaPeriodo(fr) {
  var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
  if (!movimientos.length) return '<div class="empty" style="padding:8px 0;">Sin movimientos en este rango.</div>';
  return '<div style="position:relative;height:230px;margin-top:8px;"><canvas id="chart-reporte-periodo"></canvas></div>';
}

function renderDetalleMovimientos(movimientos) {
  if (!movimientos.length) return '<div class="empty" style="padding:8px 0;">Sin movimientos en este rango.</div>';
  var COLS = "85px 95px 1fr 130px 110px";
  var ordenados = movimientos.slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
  var html = '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Fecha</span><span>Tipo</span><span>Concepto</span><span>Persona</span><span>Monto</span></div>';
  ordenados.forEach(function (t) {
    var esIngreso = t.tipo === "ingreso";
    html += '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(t.fecha) + "</span>" +
      '<span class="mobile-th">Tipo</span><span class="tag ' + (esIngreso ? "" : "gasto") + '">' + esc(t.esInsumo ? "insumos" : t.tipo) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto || "—") + "</span>" +
      '<span class="mobile-th">Persona</span><span>' + esc(t.contraparte || "—") + "</span>" +
      '<span class="mobile-th">Monto</span><span class="amount ' + (esIngreso ? "" : "neg") + '">' + (esIngreso ? "+" : "-") + fmt(t.monto) + "</span>" +
      "</div>";
  });
  return html;
}

function renderDesglosePedidos(fr) {
  var filas = calcPedidosRango(fr.desde, fr.hasta);
  if (!filas.length) return '<div class="empty" style="padding:8px 0;">Sin pedidos en este rango.</div>';
  var r = calcResumenPedidos(filas);
  var COLS = "85px 90px 1fr 70px 105px 105px 105px";
  var html = '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Fecha</span><span>N.º OP</span><span>Cliente</span><span>Cant.</span><span>Total</span><span>Abonado</span><span>Saldo</span></div>';
  filas.forEach(function (f) {
    html += '<div class="tx-row' + (f.cancelado ? " fila-cancelada" : "") + '" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(f.fecha) + "</span>" +
      '<span class="mobile-th">N.º OP</span><span style="font-family:\'IBM Plex Mono\',monospace;">' + esc(f.numeroOp) + "</span>" +
      '<span class="mobile-th">Cliente</span><span>' + esc(f.cliente) +
      (f.cancelado ? ' <span class="badge danger">Cancelado</span>' : "") +
      '<div class="section-sub" style="margin:0;">' + esc(f.descripcion) + "</div></span>" +
      '<span class="mobile-th">Cant.</span><span class="amount">' + f.cantidad + "</span>" +
      '<span class="mobile-th">Total</span><span class="amount">' + fmt(f.total) + "</span>" +
      '<span class="mobile-th">Abonado</span><span class="amount">' + fmt(f.abonado) + "</span>" +
      '<span class="mobile-th">Saldo</span><span class="amount" style="color:' + (f.saldo > 0 ? "var(--danger-ink)" : "var(--success-ink)") + ';">' + fmt(f.saldo) + "</span>" +
      "</div>";
  });
  // Se dice cuántos cancelados hay para que la suma de la columna no parezca
  // que no cuadra: están en la lista (es el registro) pero no en los totales.
  html += '<div class="section-sub" style="margin:6px 0 0;">' + r.pedidos + " pedido(s) · " + fmt(r.total) + " vendido · " +
    fmt(r.abonado) + " cobrado · <b>" + fmt(r.saldo) + "</b> por cobrar." +
    (r.cancelados ? " <span style=\"color:var(--danger-ink);\">" + r.cancelados + " cancelado(s), no incluido(s) en estos totales.</span>" : "") +
    "</div>";
  return html;
}

function renderDesgloseVendedores(fr) {
  var filas = calcVentasPorVendedorRango(fr.desde, fr.hasta);
  if (!filas.length) return '<div class="empty" style="padding:8px 0;">Sin ventas en este rango.</div>';
  var COLS = "1fr 80px 80px 120px 120px 120px";
  var html = '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Vendedor</span><span>Pedidos</span><span>Unid.</span><span>Vendido</span><span>Ganancia</span><span>Comisión</span></div>';
  filas.forEach(function (f) {
    html += '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">Vendedor</span><span>' + esc(f.vendedor) + "</span>" +
      '<span class="mobile-th">Pedidos</span><span class="amount">' + f.pedidos + "</span>" +
      '<span class="mobile-th">Unid.</span><span class="amount">' + f.unidades + "</span>" +
      '<span class="mobile-th">Vendido</span><span class="amount">' + fmt(f.total) + "</span>" +
      '<span class="mobile-th">Ganancia</span><span class="amount">' + fmt(f.ganancia) + "</span>" +
      '<span class="mobile-th">Comisión</span><span class="amount">' + fmt(f.comision) + "</span>" +
      "</div>";
  });
  return html;
}

// Apartado propio del gasto en insumos, con las columnas que le sirven a esto
// y no a otra cosa: qué se compró, cuánto se compró y cuánto costó. Son
// compras REALES (movimientos marcados como insumo) — nunca lo cotizado.
function renderDesgloseInsumos(compras) {
  var COLS = "85px 1fr 110px 130px 110px";
  var total = compras.reduce(function (a, c) { return a + c.monto; }, 0);
  // El título y la ayuda los pone renderSeccionReporte (es un apartado
  // plegable), así que acá solo va la tabla.
  var html = "";
  if (!compras.length) {
    return '<div class="empty" style="padding:8px 0;">Sin compras de insumo en este rango.</div>';
  }
  html += '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Fecha</span><span>Concepto</span><span>Cantidad</span><span>Proveedor</span><span>Monto</span></div>';
  compras.forEach(function (c) {
    html += '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(c.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(c.concepto) + "</span>" +
      '<span class="mobile-th">Cantidad</span><span class="amount">' + (c.cantidad ? esc(c.cantidad + (c.unidad ? " " + c.unidad : "")) : "—") + "</span>" +
      '<span class="mobile-th">Proveedor</span><span>' + esc(c.proveedor || "—") + "</span>" +
      '<span class="mobile-th">Monto</span><span class="amount neg">-' + fmt(c.monto) + "</span>" +
      "</div>";
  });
  html += '<div class="section-sub" style="margin:6px 0 0;">' + compras.length + " compra(s) · <b>" + fmt(total) + "</b> en total.</div>";
  return html;
}

// Apartado propio de productos vendidos, con las columnas que explican el
// porqué de la plata: cuántos se vendieron, a qué costo, a qué precio y
// cuánta ganancia dejaron. Para el detalle completo (talla, N.º OP, cliente,
// vendedor) está el PDF de "Reporte de productos".
function renderDesgloseProductos(fr) {
  var filas = calcProductosVendidosRango(fr.desde, fr.hasta);
  var resumen = calcResumenProductosVendidos(filas);
  var COLS = "85px 1fr 80px 110px 110px 110px";
  // El título y la ayuda los pone renderSeccionReporte.
  var html = "";
  if (!filas.length) {
    return '<div class="empty" style="padding:8px 0;">Sin ventas de producto en este rango — prueba con un rango más amplio (atajo "Este año").</div>';
  }
  html += '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Fecha</span><span>Concepto</span><span>Cant.</span><span>Costo total</span><span>Precio total</span><span>Ganancia</span></div>';
  filas.forEach(function (f) {
    html += '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(f.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(f.concepto) + (f.talla && f.talla !== "—" ? ' <span class="badge">' + esc(f.talla) + "</span>" : "") +
      (f.tipo === "consignacion" ? ' <span class="tag">consignación</span>' : "") + "</span>" +
      '<span class="mobile-th">Cant.</span><span class="amount">' + f.cantidad + "</span>" +
      '<span class="mobile-th">Costo</span><span class="amount">' + fmt(f.costoTotal) + "</span>" +
      '<span class="mobile-th">Precio</span><span class="amount">' + fmt(f.precioTotal) + "</span>" +
      '<span class="mobile-th">Ganancia</span><span class="amount" style="color:' + (f.ganancia >= 0 ? "var(--success-ink)" : "var(--danger-ink)") + ';">' + fmt(f.ganancia) + "</span>" +
      "</div>";
  });
  html += '<div class="section-sub" style="margin:6px 0 0;">' + resumen.unidades + " unidad(es) · " + fmt(resumen.precioTotal) +
    " vendidos · <b>" + fmt(resumen.ganancia) + "</b> de ganancia (" + resumen.margenPct.toFixed(1) + "% de margen).</div>";
  return html;
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
  "toggle-reporte-seccion": function (el) {
    var id = el.getAttribute("data-val");
    var abiertas = Object.assign({}, state.reporteSecciones || {});
    if (abiertas[id]) delete abiertas[id]; else abiertas[id] = true;
    state.reporteSecciones = abiertas;
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
  // El PDF lleva exactamente lo que esté marcado en las casillas de "Qué
  // incluir en el PDF" — mismo patrón que el PDF interno de una cotización.
  // Los datos salen de las MISMAS funciones que alimentan la pantalla, así
  // que el documento nunca puede decir algo distinto de lo que se vio.
  "generar-reporte-pdf": async function (el) {
    var fr = state.formReporte;
    if (!fr.desde || !fr.hasta) { window.alert("Elige una fecha de inicio y una de corte."); return; }
    var card = el.closest(".card");
    function marcado(id) {
      var chk = card ? card.querySelector('[data-role="rep-' + id + '"]') : null;
      return !!(chk && chk.checked);
    }
    var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
    var etiqueta = fr.desde === fr.hasta ? fr.desde : (fr.desde + " a " + fr.hasta);
    await generarPDFReporteFinanciero(movimientos, etiqueta, {
      movimientos: marcado("movimientos"),
      insumos: marcado("insumos") ? calcComprasInsumoRango(movimientos) : null,
      productos: marcado("productos") ? calcProductosVendidosRango(fr.desde, fr.hasta) : null,
      pedidos: marcado("pedidos") ? calcPedidosRango(fr.desde, fr.hasta) : null,
      vendedores: marcado("vendedores") ? calcVentasPorVendedorRango(fr.desde, fr.hasta) : null,
      // La gráfica solo puede ir si su apartado está abierto: la imagen se
      // toma del canvas que está en pantalla.
      grafica: marcado("grafica") ? imagenGraficaPeriodo() : null
    });
  },
  // Reporte aparte, solo de productos: el financiero da el panorama general
  // con un desglose corto; este entra en el detalle (talla, N.º OP, cliente,
  // vendedor) que en el otro sobrecargaría la hoja.
  "generar-reporte-productos-pdf": async function () {
    var fr = state.formReporte;
    if (!fr.desde || !fr.hasta) { window.alert("Elige una fecha de inicio y una de corte."); return; }
    var filas = calcProductosVendidosRango(fr.desde, fr.hasta);
    if (!filas.length) { window.alert("No hay ventas de producto en este rango."); return; }
    var etiqueta = fr.desde === fr.hasta ? fr.desde : (fr.desde + " a " + fr.hasta);
    await generarPDFReporteProductos(filas, etiqueta);
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
