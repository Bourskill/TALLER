// Pestaña "Mis ventas": panel del propio vendedor logueado (rol "vendedor"),
// solo lectura salvo el botón de reporte en PDF. No tiene acceso a Finanzas
// ni a los datos de otros vendedores — solo lee sus propios pedidos y
// cotizaciones (filtrados por vendedor.nombre === su vendedorNombre).
//
// Las filas y los totales salen de core/calc.js (calcFilasVentasVendedor /
// calcVentasVendedor), no de una copia propia: la copia que vivía acá no
// miraba los pedidos cancelados y le mostraba al vendedor comisiones que
// Pendientes ya daba por anuladas (Hallazgo #56).

import { esc, fmt } from "../core/utils.js";
import { calcVentasVendedor, calcFilasVentasVendedor, etiquetaComisionVendedor } from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { getSession } from "../core/auth.js";
import { generarPDFReporteVendedor } from "../core/pdf.js";

export function render() {
  var session = getSession();
  var nombre = session && session.vendedorNombre;
  if (!nombre) {
    return '<div class="empty">Tu cuenta no tiene un <b>nombre de vendedor</b> asociado todavía — pídele al admin que lo agregue en la pestaña "roles" de la hoja de datos (columna vendedor_nombre) para que coincida con el nombre que usa en tus pedidos/cotizaciones.</div>';
  }

  var r = calcVentasVendedor(nombre);
  var html = '<div class="kpis">' +
    '<div class="kpi"><div class="kpi-label">Total vendido</div><div class="kpi-value info">' + fmt(r.totalVendido) + '</div><div class="kpi-note">Pedidos y cotizaciones activas a tu nombre' + (r.cancelados ? " · " + r.cancelados + (r.cancelados === 1 ? " cancelado, no suma" : " cancelados, no suman") : "") + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">Comisión pendiente</div><div class="kpi-value warning">' + fmt(r.comisionPendiente) + '</div><div class="kpi-note">Aún no pagada</div></div>' +
    '<div class="kpi"><div class="kpi-label">Comisión pagada</div><div class="kpi-value success">' + fmt(r.comisionPagada) + '</div><div class="kpi-note">Ya cobrada</div></div>' +
    "</div>";

  var filas = calcFilasVentasVendedor(nombre);
  html += '<div class="card"><div class="section-title small">Mis ventas' +
    renderHelp("Pedidos y cotizaciones (aún no convertidas en pedido, para no contarlas dos veces) donde apareces como vendedor, con el estado de tu comisión en cada una. Un pedido cancelado sigue en la lista, pero no suma como venta: si su comisión no se había pagado, quedó anulada; si ya se pagó, se queda como pagada.") +
    "</div>";
  if (filas.length === 0) {
    html += '<div class="empty">Todavía no tienes pedidos ni cotizaciones registrados a tu nombre.</div>';
  } else {
    filas.forEach(function (f) {
      var tagStyle = f.estadoComision === "pagada" ? "background:var(--success-soft);color:var(--success-ink);"
        : f.estadoComision === "anulada" ? "background:var(--surface-3);color:var(--ink-soft);"
        : "background:var(--warning-soft);color:var(--warning-ink);";
      html += '<div class="tx-row" style="grid-template-columns:1fr 110px 170px;">' +
        "<span>" + esc(f.cliente || "—") + " — " + esc(f.descripcion || "") + (f.cancelado ? ' <span class="badge danger">Cancelado</span>' : "") + "</span>" +
        '<span class="amount"' + (f.comisionAnulada ? ' title="Hubiera sido ' + fmt(f.comisionAnulada) + '; ya no se debe."' : "") + ">" + fmt(f.comision) + "</span>" +
        '<span class="tag" style="' + tagStyle + '">' + esc(etiquetaComisionVendedor(f)) + "</span>" +
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
    await generarPDFReporteVendedor(nombre, calcFilasVentasVendedor(nombre), calcVentasVendedor(nombre));
  }
};
