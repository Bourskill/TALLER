// Pestaña "Mis ventas": panel del propio vendedor logueado (rol "vendedor"),
// solo lectura salvo el botón de reporte en PDF. No tiene acceso a Finanzas
// ni a los datos de otros vendedores — solo lee sus propios pedidos y
// cotizaciones (filtrados por vendedor.nombre === su vendedorNombre).

import { state } from "../core/store.js";
import { esc, fmt } from "../core/utils.js";
import { calcVentasVendedor, calcComisionValor, calcComisionValorCot, calcCotizacionTotales } from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { getSession } from "../core/auth.js";
import { generarPDFReporteVendedor } from "../core/pdf.js";

function filasVendedor(nombre) {
  var filas = [];
  state.pedidos.forEach(function (p) {
    if (!p.vendedor || p.vendedor.nombre !== nombre) return;
    filas.push({ cliente: p.cliente, descripcion: p.descripcion, total: p.total, comision: calcComisionValor(p), pagado: p.vendedor.estado === "pagado" });
  });
  state.cotizaciones.forEach(function (c) {
    if (c.estado === "convertida" || c.esDemo || !c.vendedor || c.vendedor.nombre !== nombre) return;
    filas.push({ cliente: c.cliente, descripcion: c.descripcion, total: calcCotizacionTotales(c).precioTotal, comision: calcComisionValorCot(c), pagado: c.vendedor.estado === "pagado" });
  });
  return filas;
}

export function render() {
  var session = getSession();
  var nombre = session && session.vendedorNombre;
  if (!nombre) {
    return '<div class="empty">Tu cuenta no tiene un <b>nombre de vendedor</b> asociado todavía — pídele al admin que lo agregue en la pestaña "roles" de la hoja de datos (columna vendedor_nombre) para que coincida con el nombre que usa en tus pedidos/cotizaciones.</div>';
  }

  var r = calcVentasVendedor(nombre);
  var html = '<div class="kpis">' +
    '<div class="kpi"><div class="kpi-label">Total vendido</div><div class="kpi-value info">' + fmt(r.totalVendido) + '</div><div class="kpi-note">Pedidos y cotizaciones activas a tu nombre</div></div>' +
    '<div class="kpi"><div class="kpi-label">Comisión pendiente</div><div class="kpi-value warning">' + fmt(r.comisionPendiente) + '</div><div class="kpi-note">Aún no pagada</div></div>' +
    '<div class="kpi"><div class="kpi-label">Comisión pagada</div><div class="kpi-value success">' + fmt(r.comisionPagada) + '</div><div class="kpi-note">Ya cobrada</div></div>' +
    "</div>";

  var filas = filasVendedor(nombre);
  html += '<div class="card"><div class="section-title small">Mis ventas' +
    renderHelp("Pedidos y cotizaciones (aún no convertidas en pedido, para no contarlas dos veces) donde apareces como vendedor, con el estado de tu comisión en cada una.") +
    "</div>";
  if (filas.length === 0) {
    html += '<div class="empty">Todavía no tienes pedidos ni cotizaciones registrados a tu nombre.</div>';
  } else {
    filas.forEach(function (f) {
      var tagStyle = f.pagado ? "background:var(--success-soft);color:var(--success-ink);" : "background:var(--warning-soft);color:var(--warning-ink);";
      html += '<div class="tx-row" style="grid-template-columns:1fr 110px 100px;">' +
        "<span>" + esc(f.cliente || "—") + " — " + esc(f.descripcion || "") + "</span>" +
        '<span class="amount">' + fmt(f.comision) + "</span>" +
        '<span class="tag" style="' + tagStyle + '">' + (f.pagado ? "Pagada" : "Pendiente") + "</span>" +
        "</div>";
    });
  }
  html += '<div class="pedido-actions"><button class="btn small" data-action="generar-reporte-vendedor">Generar mi reporte en PDF</button></div>';
  html += "</div>";
  return html;
}

export var actions = {
  "generar-reporte-vendedor": async function () {
    var session = getSession();
    var nombre = session && session.vendedorNombre;
    if (!nombre) return;
    await generarPDFReporteVendedor(nombre, filasVendedor(nombre), calcVentasVendedor(nombre));
  }
};
