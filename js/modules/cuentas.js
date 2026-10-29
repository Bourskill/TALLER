// Cuentas (Hallazgo #63): dónde está la plata del taller — efectivo, banco,
// Nequi... — y cómo comprobar que lo que la app dice coincide con el extracto.
//
// Tres piezas, todas sobre las mismas funciones de core/calc.js (acá no se suma
// nada por cuenta propia):
//   1. Saldo por cuenta (pestaña "Cuentas" de Finanzas y mini-tarjetas en
//      Resumen). La suma de las cuentas es SIEMPRE la Caja — calcSaldosPorCuenta
//      lo comprueba y esta pantalla lo dice.
//   2. Transferencia entre cuentas: pasa plata de una a otra sin que la Caja se
//      mueva ni cuente como ingreso o gasto (no es un movimiento, ver el bloque
//      "cuentas" de core/calc.js).
//   3. Conciliación: el dueño escribe el saldo de su extracto a una fecha y la
//      app muestra la diferencia; los movimientos que sí ve en el extracto se
//      marcan como "conciliados" para encontrar los que faltan.
// La lista de cuentas se configura en Configuración (renderConfigCuentas).

import { state, persist, notify, mostrarToast } from "../core/store.js";
import { esc, fmt, num, uid, todayStr, norm } from "../core/utils.js";
import {
  CUENTA_SIN_ASIGNAR, calcCuentasConfig, existeCuenta, nombreCuenta, cuentaDeTx,
  calcSaldosPorCuenta, calcConciliacion, calcUsoCuenta
} from "../core/calc.js";
import { renderHelp, renderCuentaSelectOptions } from "../core/components.js";

var MAX_FILAS_CONCILIACION = 150;
var MAX_SIN_ASIGNAR_VISIBLES = 15;
var MAX_TRANSFERENCIAS_VISIBLES = 10;

function colorSaldo(saldo) { return saldo < 0 ? ' style="color:var(--danger);"' : ""; }

// Una mini-tarjeta por cuenta (mismo lenguaje que "Colchón" y los servicios de
// Resumen). `accion` es lo que pasa al tocarla: en Resumen lleva a la pestaña
// Cuentas, ahí elige la cuenta para conciliar.
export function renderSaldosCuentas(s, accion) {
  if (!s.cuentas.length) {
    return '<div class="empty">Aún no hay cuentas. Agrégalas en Configuración → Cuentas.</div>';
  }
  return '<div class="kpis-mini">' + s.cuentas.map(function (f) {
    return '<button type="button" class="kpi-mini" data-action="' + accion + '" data-cuenta="' + esc(f.id) + '" title="' +
      esc(f.nombre) + " — " + f.movimientos + (f.movimientos === 1 ? " movimiento" : " movimientos") + '">' +
      '<div class="kpi-mini-label">' + esc(f.nombre) + "</div>" +
      '<div class="kpi-mini-value"' + colorSaldo(f.saldo) + ">" + fmt(f.saldo) + "</div></button>";
  }).join("") + "</div>";
}

// La línea que le da al dueño la garantía: lo que suman las cuentas contra la
// Caja actual. Si alguna vez no coinciden se dice en rojo, no se esconde.
function renderCuadre(s) {
  if (s.cuadra) {
    return '<div class="section-sub" style="margin:10px 0 0;">Suman <b style="color:var(--ink);">' + fmt(s.total) + "</b> · Caja actual <b style=\"color:var(--ink);\">" + fmt(s.caja) + "</b> · ✓ coinciden</div>";
  }
  return '<div class="descuento-aviso" style="font-size:13px;">⚠ Las cuentas suman ' + fmt(s.total) + " pero la Caja actual es " + fmt(s.caja) +
    " (diferencia " + fmt(s.total - s.caja) + "). No debería pasar: no sigas registrando hasta revisarlo.</div>";
}

// Resumen: el saldo de cada cuenta justo debajo de las cifras grandes. Se
// esconde mientras no haya ningún movimiento (nada que repartir).
export function renderCuentasResumen() {
  if (!(state.tx || []).length && !(state.transferencias || []).length) return "";
  var s = calcSaldosPorCuenta();
  if (!s.cuentas.length) return "";
  return '<div class="card" style="margin-bottom:var(--sp-4);"><div class="section-sub" style="margin:0 0 8px;">Caja por cuenta' +
    renderHelp("Cómo está repartida la Caja actual entre tus cuentas: efectivo, banco, Nequi... La suma de todas es siempre la Caja actual. Toca una cuenta para ver sus movimientos y conciliarla con tu extracto.") +
    "</div>" + renderSaldosCuentas(s, "ir-a-cuentas") + renderCuadre(s) + "</div>";
}

// ---------- pestaña "Cuentas" de Finanzas ----------
export function renderCuentas() {
  var s = calcSaldosPorCuenta();
  var html = '<div class="card">' +
    '<div class="section-title small" style="margin-top:0;">Saldo por cuenta' +
    renderHelp("Cada movimiento de Finanzas tiene una cuenta (efectivo, banco, Nequi...). Aquí ves cuánta plata hay en cada una. La suma de todas es siempre la «Caja actual»: las cuentas son una forma de repartir la caja, no otra contabilidad. Las cuentas se editan en Configuración.") +
    "</div>" + renderSaldosCuentas(s, "elegir-cuenta-conciliar") + renderCuadre(s);

  var sin = s.cuentas.filter(function (f) { return f.id === CUENTA_SIN_ASIGNAR; })[0];
  if (sin && sin.saldo !== 0) {
    html += '<div class="section-sub" style="margin:12px 0 0;color:var(--warning-ink);">Tienes <b>' + fmt(sin.saldo) + "</b> en «Sin asignar»: es todo lo registrado antes de que existieran las cuentas. " +
      "Repártelo entre tus cuentas con una transferencia desde «Sin asignar» (no cambia la Caja). " +
      '<button class="btn ghost small" data-action="preparar-reparto">Repartir ahora</button></div>';
  }
  html += "</div>";

  html += renderFormTransferencia(s);
  html += renderConciliacion(s);
  html += renderMovimientosSinAsignar();
  return html;
}

// ---------- transferencias ----------
function valoresTransferencia(s) {
  var f = state.formTransferencia;
  var config = calcCuentasConfig();
  var sin = s.cuentas.filter(function (x) { return x.id === CUENTA_SIN_ASIGNAR; })[0];
  var de = f.de && existeCuenta(f.de) ? f.de : (sin && sin.saldo > 0 ? CUENTA_SIN_ASIGNAR : (config[0] ? config[0].id : CUENTA_SIN_ASIGNAR));
  var a = f.a && f.a !== de && existeCuenta(f.a) ? f.a : ((config.filter(function (c) { return c.id !== de; })[0] || {}).id || "");
  return { de: de, a: a, monto: f.monto, fecha: f.fecha || todayStr(), nota: f.nota };
}

function renderFormTransferencia(s) {
  var v = valoresTransferencia(s);
  var html = '<div class="card"><div class="section-title small" style="margin-top:0;">Pasar plata de una cuenta a otra' +
    renderHelp("Cuando pasas plata de una cuenta a otra (consignar el efectivo al banco, retirar del banco para la caja...) no ganaste ni gastaste nada: solo cambió de lugar. Por eso una transferencia no cuenta como ingreso ni gasto en ningún reporte y la Caja actual no cambia. Se anula con un clic si te equivocas.") +
    "</div>";
  if (calcCuentasConfig().length < 1) {
    return html + '<div class="empty">Necesitas al menos una cuenta: agrégala en Configuración → Cuentas.</div></div>';
  }
  html += '<div class="form-grid">' +
    '<div class="field"><label>Sale de</label><select class="mini-input" id="tr-de" data-action-change="set-transferencia-campo" data-campo="de">' + renderCuentaSelectOptions(v.de) + "</select></div>" +
    '<div class="field"><label>Entra a</label><select class="mini-input" id="tr-a" data-action-change="set-transferencia-campo" data-campo="a">' + renderCuentaSelectOptions(v.a) + "</select></div>" +
    '<div class="field"><label>Monto</label><input type="number" inputmode="numeric" class="mini-input" id="tr-monto" value="' + esc(v.monto) + '" placeholder="0" data-action-change="set-transferencia-campo" data-campo="monto" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" class="mini-input" id="tr-fecha" value="' + esc(v.fecha) + '" data-action-change="set-transferencia-campo" data-campo="fecha" /></div>' +
    '<div class="field wide"><label>Nota (opcional)</label><input class="mini-input" id="tr-nota" value="' + esc(v.nota) + '" placeholder="Ej. Consignación del sábado" data-action-change="set-transferencia-campo" data-campo="nota" /></div>' +
    "</div>" +
    '<div class="row-actions" style="margin-top:8px;"><button class="btn" data-action="registrar-transferencia">Registrar transferencia</button></div>';

  var lista = (state.transferencias || []).slice().sort(function (a, b) {
    return String(b.fecha || "").localeCompare(String(a.fecha || ""));
  }).slice(0, MAX_TRANSFERENCIAS_VISIBLES);
  if (lista.length) {
    html += '<div class="cot-col-title" style="margin-top:16px;">Últimas transferencias</div>';
    lista.forEach(function (tr) {
      var anulada = !!tr.anulada;
      html += '<div class="tx-row cuenta-fila cuenta-fila-transferencia"' + (anulada ? ' style="opacity:.55;"' : "") + ">" +
        '<span class="mobile-th">Fecha</span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;">' + esc(tr.fecha) + "</span>" +
        '<span class="mobile-th">Concepto</span><span>' + esc(nombreCuenta(tr.de)) + " → " + esc(nombreCuenta(tr.a)) +
        (tr.nota ? ' <span style="color:var(--ink-faint);">· ' + esc(tr.nota) + "</span>" : "") +
        (anulada ? ' <span class="tag">anulada</span>' : "") + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount">' + fmt(tr.monto) + "</span>" +
        '<span class="mobile-th">Acciones</span><span><button class="btn ghost small" data-action="toggle-anular-transferencia" data-id="' + esc(tr.id) + '">' + (anulada ? "Restaurar" : "Anular") + "</button></span>" +
        "</div>";
    });
  }
  return html + "</div>";
}

// ---------- conciliación ----------
// Lo que el dueño ve (y escribe) en el formulario, con los mismos valores por
// defecto que usa la acción al guardar: así nunca se calcula con una cuenta o
// una fecha distinta de la que se está mostrando.
function datosConciliacion(s) {
  var f = state.formConciliacion;
  var cuentaDefecto = (s.cuentas[0] || {}).id || "";
  var cuenta = f.cuenta && s.cuentas.some(function (x) { return x.id === f.cuenta; }) ? f.cuenta : cuentaDefecto;
  return { cuenta: cuenta, fecha: f.fecha || todayStr(), saldo: f.saldo, ver: f.ver === "todos" ? "todos" : "pendientes" };
}

function renderConciliacion(s) {
  var html = '<div class="card"><div class="section-title small" style="margin-top:0;">Conciliar con el extracto' +
    renderHelp("Compara una cuenta con tu extracto del banco (o con lo que cuentas en la caja). Escribe el saldo que ves ahí a una fecha: la app te dice cuánto se diferencia de lo que tiene registrado. Luego marca los movimientos que SÍ ves en el extracto: lo que quede sin marcar es lo que la app tiene y el banco no. Si aun así hay diferencia, falta registrar algo (o sobra algo).") +
    "</div>";
  if (!s.cuentas.length) return html + '<div class="empty">Primero agrega tus cuentas en Configuración → Cuentas.</div></div>';

  var d = datosConciliacion(s);
  var r = calcConciliacion(d.cuenta, d.fecha, d.saldo);
  html += '<div class="form-grid">' +
    '<div class="field"><label>Cuenta</label><select class="mini-input" data-action-change="set-conciliacion-campo" data-campo="cuenta">' +
    renderCuentaSelectOptions(d.cuenta, { conSinAsignar: s.cuentas.some(function (x) { return x.id === CUENTA_SIN_ASIGNAR; }) }) +
    "</select></div>" +
    '<div class="field"><label>Fecha del extracto</label><input type="date" class="mini-input" value="' + esc(d.fecha) + '" data-action-change="set-conciliacion-campo" data-campo="fecha" /></div>' +
    '<div class="field"><label>Saldo que dice el extracto</label><input type="number" inputmode="numeric" class="mini-input" value="' + esc(d.saldo) + '" placeholder="Ej. 1500000" data-action-change="set-conciliacion-campo" data-campo="saldo" /></div>' +
    "</div>";

  var guardada = (state.config.conciliaciones || {})[d.cuenta];
  if (guardada) {
    html += '<div class="section-sub" style="margin:6px 0 0;">Última conciliación guardada de esta cuenta: <b style="color:var(--ink);">' + esc(guardada.fecha) + "</b> · " +
      (num(guardada.diferencia) === 0 ? "cuadró al peso" : "diferencia de " + fmt(guardada.diferencia)) + "</div>";
  }

  html += '<div class="report-grid">' +
    '<div class="report-item"><div class="rl">Saldo en la app (hasta ' + esc(d.fecha) + ')</div><div class="rv">' + fmt(r.saldoCalculado) + "</div></div>" +
    '<div class="report-item"><div class="rl">Saldo del extracto</div><div class="rv">' + (r.tieneExtracto ? fmt(r.saldoExtracto) : "—") + "</div></div>" +
    '<div class="report-item"><div class="rl">Diferencia</div><div class="rv" style="color:' + (!r.tieneExtracto ? "var(--ink-faint)" : r.diferencia === 0 ? "var(--success)" : "var(--danger)") + ';">' +
    (r.tieneExtracto ? (r.diferencia > 0 ? "+" : "") + fmt(r.diferencia) : "—") + "</div></div>" +
    "</div>";

  if (r.tieneExtracto) {
    html += '<div class="section-sub" style="margin:8px 0 0;">' +
      (r.diferencia === 0
        ? "✓ Cuadra al peso."
        : r.diferencia > 0
          ? "El extracto tiene <b>" + fmt(r.diferencia) + "</b> más de lo que la app tiene registrado: probablemente falta registrar un ingreso (o sobra un gasto)."
          : "La app tiene registrado <b>" + fmt(-r.diferencia) + "</b> más de lo que dice el extracto: probablemente falta registrar un gasto, o un ingreso aún no llega a la cuenta.") +
      "</div>";
  }
  html += '<div class="section-sub" style="margin:6px 0 0;">Marcados (los ves en el extracto): <b style="color:var(--ink);">' + fmt(r.conciliado) + "</b> · Sin marcar: <b style=\"color:var(--ink);\">" + r.sinMarcar +
    (r.sinMarcar === 1 ? " movimiento" : " movimientos") + "</b> (suman " + fmt(r.sinConciliar) + ")</div>";

  html += '<div class="row-actions" style="margin-top:10px;"><button class="btn small" data-action="guardar-conciliacion"' + (r.tieneExtracto ? "" : " disabled") + '>Guardar esta conciliación</button>' +
    '<span class="segmented" style="margin-left:8px;display:inline-flex;gap:6px;">' +
    '<button class="chip ' + (d.ver === "pendientes" ? "active" : "") + '" data-action="set-conciliacion-ver" data-val="pendientes">Solo sin marcar</button>' +
    '<button class="chip ' + (d.ver === "todos" ? "active" : "") + '" data-action="set-conciliacion-ver" data-val="todos">Todos</button></span></div>';

  var filas = r.asientos.filter(function (a) { return d.ver === "todos" || !a.conciliadoEn; });
  if (!filas.length) {
    html += '<div class="empty">' + (r.asientos.length ? "No quedan movimientos sin marcar hasta esta fecha." : "Esta cuenta no tiene movimientos hasta esta fecha.") + "</div>";
    return html + "</div>";
  }
  html += '<div class="tx-row head cuenta-fila"><span>Fecha</span><span>Concepto</span><span>Monto</span><span>En el extracto</span></div>';
  filas.slice(0, MAX_FILAS_CONCILIACION).forEach(function (a) {
    html += '<div class="tx-row cuenta-fila">' +
      '<span class="mobile-th">Fecha</span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;">' + esc(a.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(a.concepto) +
      (a.origen === "transferencia" ? ' <span class="tag">transferencia</span>' : "") +
      (a.contraparte ? ' <span style="color:var(--ink-faint);">· ' + esc(a.contraparte) + "</span>" : "") + "</span>" +
      '<span class="mobile-th">Monto</span><span class="amount ' + (a.monto >= 0 ? "pos" : "neg") + '">' + (a.monto >= 0 ? "+" : "-") + fmt(Math.abs(a.monto)) + "</span>" +
      '<span class="mobile-th">En el extracto</span><span><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">' +
      '<input type="checkbox" ' + (a.conciliadoEn ? "checked" : "") + ' data-action-change="toggle-conciliado" data-clave="' + esc(a.clave) + '" /> ' +
      (a.conciliadoEn ? "visto" : "sin marcar") + "</label></span>" +
      "</div>";
  });
  if (filas.length > MAX_FILAS_CONCILIACION) {
    html += '<div class="section-sub" style="margin:8px 0 0;">Mostrando los ' + MAX_FILAS_CONCILIACION + " más recientes de " + filas.length + ". Marca estos y los demás aparecen.</div>";
  }
  return html + "</div>";
}

// Los movimientos que siguen en «Sin asignar»: los de antes de las cuentas y los
// que la app registra sola mientras no haya una cuenta predeterminada. Se
// asignan de a uno, acá mismo.
function renderMovimientosSinAsignar() {
  var lista = (state.tx || []).filter(function (t) { return cuentaDeTx(t) === CUENTA_SIN_ASIGNAR; });
  if (!lista.length || !calcCuentasConfig().length) return "";
  lista = lista.slice().sort(function (a, b) { return String(b.fecha || "").localeCompare(String(a.fecha || "")); });
  var html = '<div class="card"><div class="section-title small" style="margin-top:0;">Movimientos sin cuenta (' + lista.length + ")" +
    renderHelp("Los movimientos que no dicen en qué cuenta entró o salió la plata. Para los viejos lo más rápido es una sola transferencia desde «Sin asignar» (arriba); para los nuevos elige su cuenta aquí. Asignar una cuenta no cambia el monto ni la Caja, solo dónde está la plata.") +
    "</div>";
  html += '<div class="tx-row head cuenta-fila"><span>Fecha</span><span>Concepto</span><span>Monto</span><span>Cuenta</span></div>';
  lista.slice(0, MAX_SIN_ASIGNAR_VISIBLES).forEach(function (t) {
    var ingreso = t.tipo === "ingreso";
    html += '<div class="tx-row cuenta-fila">' +
      '<span class="mobile-th">Fecha</span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;">' + esc(t.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) + "</span>" +
      '<span class="mobile-th">Monto</span><span class="amount ' + (ingreso ? "pos" : "neg") + '">' + (ingreso ? "+" : "-") + fmt(t.monto) + "</span>" +
      '<span class="mobile-th">Cuenta</span><span><select class="mini-input" data-action-change="asignar-cuenta-tx" data-id="' + esc(t.id) + '">' +
      '<option value="">Asignar a…</option>' + renderCuentaSelectOptions("", { conSinAsignar: false }) + "</select></span>" +
      "</div>";
  });
  if (lista.length > MAX_SIN_ASIGNAR_VISIBLES) {
    html += '<div class="section-sub" style="margin:8px 0 0;">Mostrando los ' + MAX_SIN_ASIGNAR_VISIBLES + " más recientes de " + lista.length + ".</div>";
  }
  return html + "</div>";
}

// ---------- Configuración → Cuentas ----------
export function renderConfigCuentas() {
  var cuentas = calcCuentasConfig();
  var html = '<div class="card"><div class="section-title small">Cuentas' +
    renderHelp("Las cuentas donde está la plata del taller: efectivo, banco, Nequi... Cada abono, gasto y pago se registra en una de ellas, y Finanzas → Cuentas muestra cuánto hay en cada una y la compara con tu extracto. Una cuenta que ya tiene movimientos no se puede borrar (se puede cambiar su nombre).") +
    "</div>";
  if (!cuentas.length) html += '<div class="empty">Aún no tienes cuentas. Agrega la primera abajo.</div>';
  cuentas.forEach(function (c) {
    var usos = calcUsoCuenta(c.id);
    html += '<div class="inline-form" style="margin-bottom:6px;">' +
      '<input class="mini-input" style="max-width:260px;" value="' + esc(c.nombre) + '" aria-label="Nombre de la cuenta" data-action-change="renombrar-cuenta" data-id="' + esc(c.id) + '" />' +
      '<button class="btn ghost small" data-action="quitar-cuenta" data-id="' + esc(c.id) + '" title="' +
      (usos ? "Tiene movimientos o se usa en la configuración: no se puede borrar" : "Quitar esta cuenta") + '">' + (usos ? "🔒" : "🗑") + "</button>" +
      "</div>";
  });
  html += '<div class="inline-form" style="margin-top:8px;">' +
    '<input class="mini-input" style="max-width:260px;" id="inp-cuenta-nueva" placeholder="Ej. Bancolombia, Daviplata…" />' +
    '<button class="btn small" data-action="agregar-cuenta">Agregar cuenta</button></div>';
  html += '<div class="field" style="margin-top:14px;max-width:360px;"><label>Los pagos que la app registra sola caen en' +
    renderHelp("Nómina, gastos fijos, cuotas de deuda, comisiones y compras se registran con un clic, sin preguntar la cuenta. Elige aquí dónde caen. Si lo dejas en «Sin asignar», la app no adivina: los verás en Finanzas → Cuentas para asignarlos.") +
    '</label><select data-action-change="set-cuenta-predeterminada">' +
    '<option value=""' + (state.config.cuentaPredeterminada ? "" : " selected") + ">Sin asignar (decido después)</option>" +
    renderCuentaSelectOptions(state.config.cuentaPredeterminada || "", { conSinAsignar: false }) + "</select></div>";
  return html + "</div>";
}

// Un nombre de cuenta sirve si no está vacío, no se parece a la cuenta
// reservada y no repite el de otra. Devuelve el texto del problema, o "".
function problemaDeNombre(nombre, idExcluido) {
  if (!nombre) return "Escribe un nombre para la cuenta.";
  if (norm(nombre) === norm("Sin asignar")) return "«Sin asignar» es una cuenta de la app y no se puede usar como nombre.";
  var repetida = calcCuentasConfig().some(function (c) { return c.id !== idExcluido && norm(c.nombre) === norm(nombre); });
  return repetida ? "Ya tienes una cuenta con ese nombre." : "";
}

// ---------- acciones ----------
function leerCampo(id, respaldo) {
  var el = document.getElementById(id);
  return el ? el.value : respaldo;
}

function quitarConciliado(t, cambios) {
  return Object.assign({}, t, cambios, { conciliadoEn: "" });
}

export var actions = {
  // Resumen → la pestaña Cuentas de Finanzas, con la cuenta tocada ya elegida.
  "ir-a-cuentas": function (el) {
    state.tab = "finanzas";
    state.sidebarMobileOpen = false;
    state.txEditando = "";
    state.finanzasVista = "cuentas";
    var cuenta = el.getAttribute("data-cuenta");
    if (cuenta) state.formConciliacion.cuenta = cuenta;
    notify();
  },
  "elegir-cuenta-conciliar": function (el) {
    state.formConciliacion.cuenta = el.getAttribute("data-cuenta");
    notify();
  },
  "preparar-reparto": function () {
    var sin = calcSaldosPorCuenta().cuentas.filter(function (x) { return x.id === CUENTA_SIN_ASIGNAR; })[0];
    state.formTransferencia = { de: CUENTA_SIN_ASIGNAR, a: "", monto: sin && sin.saldo > 0 ? String(sin.saldo) : "", fecha: "", nota: "Saldo inicial de la cuenta" };
    notify();
  },

  // El borrador de la transferencia se guarda sin redibujar: redibujar al salir
  // de un campo se llevaría el clic del botón (ver "set-colchon-campo").
  "set-transferencia-campo": function (el) {
    state.formTransferencia[el.getAttribute("data-campo")] = el.value;
  },
  "registrar-transferencia": function () {
    var f = state.formTransferencia;
    var de = leerCampo("tr-de", f.de), a = leerCampo("tr-a", f.a);
    var monto = num(leerCampo("tr-monto", f.monto));
    var fecha = leerCampo("tr-fecha", f.fecha) || todayStr();
    var nota = String(leerCampo("tr-nota", f.nota) || "").trim();
    if (!existeCuenta(de) || !existeCuenta(a)) { window.alert("Elige la cuenta de la que sale la plata y la cuenta a la que entra."); return; }
    if (de === a) { window.alert("La cuenta de origen y la de destino son la misma: no hay nada que pasar."); return; }
    if (monto <= 0) { window.alert("Escribe un monto mayor a cero."); return; }
    var origen = calcSaldosPorCuenta().cuentas.filter(function (x) { return x.id === de; })[0];
    var saldoOrigen = origen ? origen.saldo : 0;
    if (saldoOrigen - monto < 0 &&
      !window.confirm("«" + nombreCuenta(de) + "» tiene " + fmt(saldoOrigen) + " y quedaría en " + fmt(saldoOrigen - monto) + " después de esta transferencia.\n\n¿Registrarla igual?")) return;
    state.transferencias = [{ id: uid(), fecha: fecha, de: de, a: a, monto: monto, nota: nota, anulada: "", conciliadoDe: "", conciliadoA: "" }]
      .concat(state.transferencias || []);
    state.formTransferencia = { de: de, a: "", monto: "", fecha: "", nota: "" };
    persist("transferencias");
    mostrarToast("✓ Transferencia registrada: " + fmt(monto) + " de " + nombreCuenta(de) + " a " + nombreCuenta(a) + ". La Caja no cambió.");
  },
  "toggle-anular-transferencia": function (el) {
    var id = el.getAttribute("data-id");
    var tr = (state.transferencias || []).filter(function (x) { return x.id === id; })[0];
    if (!tr) return;
    if (!tr.anulada && !window.confirm("¿Anular esta transferencia de " + fmt(tr.monto) + " (" + nombreCuenta(tr.de) + " → " + nombreCuenta(tr.a) + ")?\n\nLas dos cuentas vuelven al saldo que tenían antes. La Caja no cambia. Puedes restaurarla después.")) return;
    state.transferencias = state.transferencias.map(function (x) {
      return x.id === id ? Object.assign({}, x, { anulada: x.anulada ? "" : todayStr() }) : x;
    });
    persist("transferencias"); notify();
  },

  // Conciliación: cambiar la cuenta, la fecha o el saldo vuelve a calcular la
  // diferencia al instante.
  "set-conciliacion-campo": function (el) {
    state.formConciliacion[el.getAttribute("data-campo")] = el.value;
    notify();
  },
  "set-conciliacion-ver": function (el) {
    state.formConciliacion.ver = el.getAttribute("data-val");
    notify();
  },
  // Marca o desmarca un asiento (un movimiento, o UNA punta de una
  // transferencia) como visto en el extracto. No toca monto, cuenta ni fecha.
  "toggle-conciliado": function (el) {
    var partes = String(el.getAttribute("data-clave") || "").split(":");
    var fecha = el.checked ? todayStr() : "";
    if (partes[0] === "tx") {
      state.tx = state.tx.map(function (t) { return t.id === partes[1] ? Object.assign({}, t, { conciliadoEn: fecha }) : t; });
      persist("tx");
    } else if (partes[0] === "tr") {
      var campo = partes[2] === "de" ? "conciliadoDe" : "conciliadoA";
      state.transferencias = (state.transferencias || []).map(function (x) {
        if (x.id !== partes[1]) return x;
        var cambio = {}; cambio[campo] = fecha;
        return Object.assign({}, x, cambio);
      });
      persist("transferencias");
    }
    notify();
  },
  "guardar-conciliacion": function () {
    var s = calcSaldosPorCuenta();
    var d = datosConciliacion(s);
    var r = calcConciliacion(d.cuenta, d.fecha, d.saldo);
    if (!r.tieneExtracto) { window.alert("Escribe primero el saldo que dice tu extracto."); return; }
    var nuevas = Object.assign({}, state.config.conciliaciones || {});
    nuevas[d.cuenta] = { fecha: d.fecha, saldoExtracto: r.saldoExtracto, saldoCalculado: r.saldoCalculado, diferencia: r.diferencia, guardadaEl: todayStr() };
    state.config.conciliaciones = nuevas;
    persist("config");
    mostrarToast(r.diferencia === 0
      ? "✓ " + nombreCuenta(d.cuenta) + " cuadra al peso con el extracto del " + d.fecha + "."
      : "Conciliación de " + nombreCuenta(d.cuenta) + " guardada: queda una diferencia de " + fmt(r.diferencia) + ".");
  },

  // Cambiar la cuenta de un movimiento solo mueve plata ENTRE cuentas: el
  // monto, el tipo y la Caja no cambian (por eso también se puede en un
  // movimiento con marca de origen). Si estaba marcado como conciliado, la
  // marca se quita: ya no es el mismo movimiento del extracto de aquella cuenta.
  "asignar-cuenta-tx": function (el) {
    var id = el.getAttribute("data-id"), cuenta = el.value;
    if (!cuenta || !existeCuenta(cuenta)) return;
    state.tx = state.tx.map(function (t) { return t.id === id ? quitarConciliado(t, { cuenta: cuenta }) : t; });
    persist("tx"); notify();
  },

  // ---- Configuración → Cuentas ----
  "agregar-cuenta": function () {
    var input = document.getElementById("inp-cuenta-nueva");
    var nombre = input ? input.value.trim() : "";
    var problema = problemaDeNombre(nombre, "");
    if (problema) { window.alert(problema); return; }
    state.config.cuentas = calcCuentasConfig().concat([{ id: uid(), nombre: nombre }]);
    persist("config"); notify();
  },
  "renombrar-cuenta": function (el) {
    var id = el.getAttribute("data-id");
    var nombre = el.value.trim();
    var problema = problemaDeNombre(nombre, id);
    if (problema) { window.alert(problema); notify(); return; }
    state.config.cuentas = calcCuentasConfig().map(function (c) { return c.id === id ? { id: c.id, nombre: nombre } : c; });
    persist("config"); notify();
  },
  "quitar-cuenta": function (el) {
    var id = el.getAttribute("data-id");
    var usos = calcUsoCuenta(id);
    if (usos) {
      window.alert("«" + nombreCuenta(id) + "» no se puede borrar: tiene movimientos, transferencias o es la cuenta predeterminada.\n\n" +
        "Si ya no la usas, cámbale el nombre. Si quieres vaciarla, pasa su plata a otra cuenta con una transferencia.");
      return;
    }
    if (!window.confirm("¿Quitar la cuenta «" + nombreCuenta(id) + "»?")) return;
    state.config.cuentas = calcCuentasConfig().filter(function (c) { return c.id !== id; });
    persist("config"); notify();
  },
  "set-cuenta-predeterminada": function (el) {
    state.config.cuentaPredeterminada = el.value;
    persist("config"); notify();
  }
};
