// Finanzas → 🔒 Cierre de mes (Hallazgo #65, solo admin). Un mes que ya terminó
// se CIERRA: la app guarda quién, cuándo y lo que valía (ingresos, gastos, Caja
// al final del mes y el saldo de cada cuenta), y desde ahí nadie puede crear,
// editar, borrar ni restaurar dinero con fecha en él. Reabrirlo exige un motivo y
// queda en la bitácora. La lógica vive en core/cierre.js; acá solo se pinta.

import { state, notify, mostrarToast } from "../core/store.js";
import { esc, fmt, norm } from "../core/utils.js";
import { renderHelp, renderBuscador } from "../core/components.js";
import { esAdmin, listaMesesCierre, cerrarMes, reabrirMes, nombreMes } from "../core/cierre.js";

var MESES_VISIBLES = 12;

function fechaHora(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "");
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderSaldosDelCierre(resumen) {
  var cuentas = (resumen && resumen.cuentas) || [];
  if (!cuentas.length) return "";
  return '<div class="section-sub" style="margin:4px 0 0;">Por cuenta: ' + cuentas.map(function (c) {
    return esc(c.nombre) + " <b style=\"color:var(--ink);\">" + fmt(c.saldo) + "</b>";
  }).join(" · ") + "</div>";
}

function renderHistorial(cierre) {
  var reaperturas = ((cierre && cierre.historial) || []).filter(function (h) { return h.accion === "reabierto"; });
  if (!reaperturas.length) return "";
  return '<ul class="cierre-historial">' + reaperturas.map(function (h) {
    return "<li>Reabierto por <b>" + esc(h.nombre || h.por) + "</b> el " + esc(fechaHora(h.en)) + ": " + esc(h.motivo) + "</li>";
  }).join("") + "</ul>";
}

function renderMes(m) {
  var c = m.cierre;
  var estado = m.estado;
  var badge = estado === "cerrado" ? '<span class="badge success">Cerrado</span>'
    : estado === "reabierto" ? '<span class="badge warning">Reabierto</span>'
    : '<span class="badge">Abierto</span>';
  var h = m.hoy;
  var html = '<div class="salud-item cierre-mes ' + estado + (m.diferencias.length ? " error" : "") + '" data-mes="' + esc(m.mes) + '">' +
    '<div class="salud-item-head">' + badge + "<b>" + esc(m.nombre) + "</b></div>";
  html += '<div class="salud-detalle">Hoy: ingresos <b>' + fmt(h.ingresos) + "</b> · gastos <b>" + fmt(h.gastos) + "</b> · balance <b>" + fmt(h.balance) +
    "</b> · Caja al final del mes <b>" + fmt(h.caja) + "</b> · " + h.movimientos + (h.movimientos === 1 ? " movimiento" : " movimientos") + "</div>";
  html += renderSaldosDelCierre(h);
  if (estado === "cerrado" && c) {
    html += '<div class="salud-detalle">Lo cerró <b>' + esc(c.cerradoPorNombre || c.cerradoPor) + "</b> el " + esc(fechaHora(c.cerradoEn)) + "</div>";
    if (m.diferencias.length) {
      html += '<div class="descuento-aviso" style="font-size:13px;margin-top:6px;">⚠ Este mes ya no suma lo que sumaba al cerrarlo: ' + m.diferencias.map(function (d) {
        var f = d.campo === "movimientos" ? function (x) { return x; } : fmt;
        return esc(d.etiqueta) + " (cerró en " + f(d.guardado) + ", hoy " + f(d.hoy) + ")";
      }).join("; ") + ". Mira «Salud de los datos» y la 📒 Bitácora para saber qué cambió.</div>";
    }
  }
  html += renderHistorial(c);
  html += '<div class="pedido-actions">';
  if (estado === "cerrado") {
    if (state.cierreReabriendo === m.mes) {
      html += '<div class="field" style="flex:1 1 280px;margin:0;"><label for="inp-reabrir-motivo">Motivo para reabrir ' + esc(m.nombre) + '</label>' +
        '<input id="inp-reabrir-motivo" placeholder="Ej. Faltó registrar un abono de ese mes" value="' + esc(state.cierreMotivo || "") + '" data-action-change="cierre-motivo" /></div>' +
        '<button class="btn small" data-action="cierre-reabrir" data-mes="' + esc(m.mes) + '">Reabrir mes</button>' +
        '<button class="btn ghost small" data-action="cierre-cancelar-reabrir">Cancelar</button>';
    } else {
      html += '<button class="btn ghost small" data-action="cierre-reabrir-abrir" data-mes="' + esc(m.mes) + '">Reabrir…</button>';
    }
  } else {
    html += '<button class="btn small" data-action="cierre-cerrar" data-mes="' + esc(m.mes) + '">Cerrar ' + esc(m.nombre) + "</button>";
  }
  return html + "</div></div>";
}

export function renderCierre() {
  var ayuda = "Cerrar un mes lo deja fijo: la app guarda quién lo cerró, cuándo y lo que valía (ingresos, gastos, Caja al final del mes y el saldo de cada cuenta). " +
    "Mientras esté cerrado no se puede crear, editar, borrar ni restaurar ningún movimiento, abono, reembolso, transferencia ni pago con fecha en ese mes. " +
    "Para corregir algo, reabres el mes escribiendo el motivo (queda en la bitácora), lo arreglas y lo vuelves a cerrar. " +
    "«Salud de los datos» avisa si un mes cerrado deja de sumar lo que sumaba. Solo se pueden cerrar meses que ya terminaron.";
  var html = '<div class="card"><div class="section-title small">Cierre de mes' + renderHelp(ayuda) + "</div>";
  if (!esAdmin()) return html + '<div class="empty">Solo el administrador puede cerrar y reabrir meses.</div></div>';
  var meses = listaMesesCierre();
  if (!meses.length) return html + '<div class="empty">Aún no hay meses terminados con movimientos para cerrar.</div></div>';
  var q = norm(state.cierreBuscar || "").trim();
  var coinciden = meses.filter(function (m) { return !q || norm(m.nombre + " " + m.mes + " " + m.estado).indexOf(q) >= 0; });
  var visibles = q || state.cierreVerTodos ? coinciden : coinciden.slice(0, MESES_VISIBLES);
  html += '<div style="margin:6px 0 10px;">' + renderBuscador({
    id: "inp-buscar-cierre", filtro: "cierreBuscar", valor: state.cierreBuscar, ancho: 300,
    placeholder: "Buscar un mes (ej. septiembre, 2026)",
    conteo: { visibles: visibles.length, total: meses.length, singular: "mes", plural: "meses" }
  }) + "</div>";
  html += visibles.length ? visibles.map(renderMes).join("") : '<div class="empty">Ningún mes coincide con esa búsqueda.</div>';
  if (!q && !state.cierreVerTodos && coinciden.length > MESES_VISIBLES) {
    html += '<div class="pedido-actions"><button class="btn ghost small" data-action="cierre-ver-todos">Ver los ' + (coinciden.length - MESES_VISIBLES) + " meses anteriores</button></div>";
  }
  return html + "</div>";
}

export var actions = {
  "cierre-ver-todos": function () {
    state.cierreVerTodos = true;
    notify();
  },
  "cierre-cerrar": function (el) {
    var mes = el.getAttribute("data-mes");
    var m = listaMesesCierre().filter(function (x) { return x.mes === mes; })[0];
    if (!m) return;
    var h = m.hoy;
    if (!window.confirm("¿Cerrar " + nombreMes(mes) + "?\n\nIngresos " + fmt(h.ingresos) + " · Gastos " + fmt(h.gastos) + " · Caja al final del mes " + fmt(h.caja) + " · " + h.movimientos + " movimientos.\n\n" +
      "Desde ahora nadie podrá crear, editar, borrar ni restaurar movimientos, abonos, reembolsos, transferencias ni pagos con fecha en ese mes, hasta que lo reabras con un motivo.")) return;
    var r = cerrarMes(mes);
    if (!r.ok) { window.alert(r.error); return; }
    mostrarToast("🔒 " + nombreMes(mes) + " quedó cerrado.");
  },
  "cierre-reabrir-abrir": function (el) {
    state.cierreReabriendo = el.getAttribute("data-mes");
    state.cierreMotivo = "";
    notify();
  },
  "cierre-cancelar-reabrir": function () {
    state.cierreReabriendo = "";
    state.cierreMotivo = "";
    notify();
  },
  // El motivo se guarda al salir del campo (change), sin redibujar al teclear.
  "cierre-motivo": function (el) {
    state.cierreMotivo = el.value;
  },
  "cierre-reabrir": function (el) {
    var mes = el.getAttribute("data-mes");
    var campo = document.getElementById("inp-reabrir-motivo");
    var motivo = campo ? campo.value : state.cierreMotivo;
    var r = reabrirMes(mes, motivo);
    if (!r.ok) { window.alert(r.error); return; }
    state.cierreReabriendo = "";
    state.cierreMotivo = "";
    mostrarToast("🔓 " + nombreMes(mes) + " quedó reabierto. Cuando termines de corregir, vuelve a cerrarlo.");
  }
};
