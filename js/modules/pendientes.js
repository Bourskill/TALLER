// Pestaña "Pendientes": todo lo financiero que se debe definir y vigilar pero
// que no es un movimiento puntual — nómina y equipo, gastos fijos (cada uno con
// su propio periodo), la meta del taller, y deudas. Todo esto vivía antes
// repartido en Configuración; se unificó aquí para que "Configuración" quede
// solo con datos de marca/PDF, y este apartado concentre las obligaciones que
// alimentan el KPI "Por pagar". Las notas (tareas/mejoras) se movieron a la
// pestaña "Notas" (ver modules/notas.js).

import { state, persist, notify } from "../core/store.js";
import { esc, num, uid, fmt, opt, val, todayStr, parseDias, diasPagoDe, exigirCampos } from "../core/utils.js";
import {
  calcGastoFijoPendiente, calcBalancePeriodo, calcPorPagar, calcPorPagarDesglose, calcFechaVencimientoPeriodo,
  calcDeudaValorCuota, calcDeudaSaldoPendiente, calcNominaPagadaEmpleado, calcDetalleComisionesVendedor,
  calcSalarioPorPeriodo, salarioBaseDe, rangoPeriodoActual, periodoDeEmpleado, diasPagoDeEmpleado
} from "../core/calc.js";
import { PERIODOS_PAGO, DIAS_SEMANA } from "../core/constants.js";
import { renderHelp } from "../core/components.js";
import { getSession } from "../core/auth.js";
import { sincronizarEvento, eliminarEvento, eventoUnDia } from "../core/calendar.js";

export function render() {
  var cfg = state.config;
  var totalPorPagar = calcPorPagar();
  var desglose = calcPorPagarDesglose();
  var html = '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
    '<div><div class="section-title small" style="margin:0;">Cuentas por pagar' + renderHelp("Suma de TODO lo pendiente: gastos fijos, nómina, comisiones y deudas, agrupado por categoría abajo. El dashboard principal ya no muestra este total — solo lo más urgente (próximo vencimiento u obligaciones vencidas); este es el detalle completo.") + '</div></div>' +
    '<div class="kpi-value danger" style="font-size:22px;">' + fmt(totalPorPagar) + "</div>" +
    "</div>";
  if (desglose.length === 0) {
    html += '<div class="empty" style="margin-top:10px;">No hay obligaciones pendientes. 🎉</div>';
  } else {
    html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:10px;">';
    desglose.forEach(function (cat) {
      html += '<div><div style="display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:12.5px;color:var(--ink-soft);"><span>' + esc(cat.categoria) + '</span><span class="amount">' + fmt(cat.monto) + "</span></div>";
      cat.items.forEach(function (it) {
        // Para deudas: "monto" ya es el valor de la cuota que vence (no el
        // saldo total), con un contador discreto tipo "2/6". El saldo total
        // de la deuda queda disponible al pasar el mouse.
        // it.nombreVendedor marca las filas de "Comisiones de vendedores":
        // son un total agregado (varios pedidos/cotizaciones), así que en
        // vez de un monto suelto se pueden desplegar para ver — y saltar a
        // verificar — cada pedido/cotización detrás de ese total.
        var expandible = !!it.nombreVendedor;
        var expandido = expandible && state.comisionVendedorExpandido === it.nombreVendedor;
        html += '<div class="tx-row" style="grid-template-columns:1fr 110px 90px;padding:4px 0;' + (expandible ? "cursor:pointer;" : "") + '"' +
          (expandible ? ' data-action="toggle-comision-vendedor" data-nombre="' + esc(it.nombreVendedor) + '"' : "") + '>' +
          '<span class="mobile-th">Concepto</span><span>' + (expandible ? (expandido ? "▾ " : "▸ ") : "") + esc(it.concepto) + (it.contador ? ' <span style="font-size:10px;font-weight:700;color:var(--ink-faint);background:var(--surface-3);padding:1px 6px;border-radius:8px;">' + esc(it.contador) + "</span>" : "") + "</span>" +
          '<span class="mobile-th">Vence</span>' + "<span style=\"font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--ink-faint);\">" + (it.fecha ? fechaCorta(it.fecha) : "Sin fecha") + "</span>" +
          '<span class="mobile-th">Monto</span><span class="amount"' + (it.montoTotal !== undefined && it.montoTotal !== it.monto ? ' title="Saldo total de la deuda: ' + fmt(it.montoTotal) + '"' : "") + '>' + fmt(it.monto) + "</span>" +
          "</div>";
        if (expandido) html += renderDetalleComisionVendedor(it.nombreVendedor);
      });
      html += "</div>";
    });
    html += "</div>";
  }
  html += "</div>";

  // ---------- Nómina y equipo ----------
  // Rediseño: cada persona ahora tiene un botón "Pagar" directo en su fila
  // (antes había que ir a Finanzas y armar el movimiento a mano) con un
  // mini-formulario para sumar bonos/horas extra o restar descuentos sobre
  // su salario base — el monto final se calcula solo. El pill de estado usa
  // calcNominaPagadaEmpleado (por persona) — a diferencia de "Por pagar" /
  // calcNominaPendiente, que sigue siendo el pool agregado de TODOS.
  var fe = state.formEmp;
  var periodoDefault = cfg.periodoPago || "mensual"; // solo preset para personas nuevas
  var periodoFormEmp = fe.periodo || periodoDefault;
  var diasFormEmp = (fe.diasPago && fe.diasPago.length) ? fe.diasPago : diasPorDefecto(periodoFormEmp);
  var etiquetaFormEmp = ETIQ_PERIODO[periodoFormEmp];

  html += '<div class="card"><div class="section-title small">Nómina y equipo' +
    renderHelp("Cada persona define su propio periodo de pago y día(s) de pago — así puedes tener a alguien semanal y a otro quincenal sin problema, y quincenal siempre pide los DOS días del mes (ej. 1 y 15), no uno solo. \"Editar\" deja ajustar todo junto, con Guardar/Cancelar. \"Pagar\" registra el pago en Finanzas.") +
    "</div>";

  html += '<div class="cot-col-title" style="margin-top:0;">Quién trabaja contigo</div>';
  if ((cfg.nomina || []).length) {
    html += '<div class="emp-row head" style="grid-template-columns:' + COLS_EMP + ';font-size:10.5px;text-transform:uppercase;color:var(--ink-faint);font-weight:700;border-bottom:1px solid var(--border);"><span>Nombre</span><span>Periodo y día</span><span>Salario</span><span>Próximo pago</span><span>Estado</span><span>Acciones</span></div>';
  }
  (cfg.nomina || []).forEach(function (e) {
    html += state.empEditando === e.id ? renderFilaEdicionEmp(e) : renderFilaEmp(e);
  });
  if ((cfg.nomina || []).length === 0) { html += '<div class="empty">Aún no registras personas en nómina.</div>'; }
  html += renderPendForm("emp", "+ Agregar persona a nómina",
    '<div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input data-form="emp" data-field="nombre" value="' + esc(fe.nombre) + '" /></div>' +
    '<div class="field"><label>Cargo</label><input data-form="emp" data-field="cargo" value="' + esc(fe.cargo) + '" placeholder="Ej. Costurera" /></div>' +
    '<div class="field"><label>Periodo de pago</label><select data-action-change="set-emp-form-periodo">' +
    Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], periodoFormEmp); }).join("") +
    "</select></div>" +
    '<div class="field' + (periodoFormEmp === "quincenal" ? " wide" : "") + '"><label>Día(s) de pago</label>' + renderSelectorDiaPago("set-emp-form-dia", "", periodoFormEmp, diasFormEmp) + "</div>" +
    '<div class="field"><label>Salario ' + esc(etiquetaFormEmp) +
    renderHelp("El valor de UN periodo de pago completo, según el periodo que elegiste arriba para esta persona. No lo conviertas a mano: si le pagas semanal, escribe lo de la semana.") +
    '</label><input type="number" data-form="emp" data-field="salario" value="' + esc(fe.salario) + '" placeholder="0" /></div>' +
    '<button class="btn" data-action="add-emp">Agregar a nómina</button>' +
    "</div>");
  html += "</div>";

  // ---------- Gastos fijos (periodizables) ----------
  var gf = state.formGastoFijo;
  var periodoFormGasto = gf.periodo || "mensual";
  var diasFormGasto = (gf.diasPago && gf.diasPago.length) ? gf.diasPago : diasPorDefecto(periodoFormGasto);
  html += '<div class="card"><div class="section-title small">Gastos fijos' +
    renderHelp("Arriendo, servicios, internet, software, etc. Cada uno define su propio periodo (mensual, quincenal o semanal) y su día de pago — así el KPI \"Por pagar\" puede avisarte cuándo vence de verdad. Márcalos como pagados cuando corresponda; si no, cuentan como pendientes.") +
    "</div>";
  html += '<div class="emp-row" style="grid-template-columns:1fr 100px 110px 190px 130px 40px;font-size:10.5px;text-transform:uppercase;color:var(--ink-faint);font-weight:700;border-bottom:1px solid var(--border);"><span>Concepto</span><span>Monto</span><span>Periodo</span><span>Día(s) de pago</span><span>Estado</span><span></span></div>';
  (cfg.gastosFijos || []).forEach(function (g) {
    var pendiente = calcGastoFijoPendiente(g) > 0;
    var periodo = g.periodo || "mensual";
    var dias = diasPagoDe(g);
    html += '<div class="emp-row" data-gasto-fijo-id="' + g.id + '" style="grid-template-columns:1fr 100px 110px 190px 130px 40px;">' +
      '<span class="mobile-th">Concepto</span><span>' + esc(g.nombre) + '</span><span class="mobile-th">Monto</span><span class="amount">' + fmt(g.monto) + "</span>" +
      '<span class="mobile-th">Periodo</span><span><select class="mini-input" style="width:100%" data-action-change="set-gasto-fijo-periodo" data-id="' + g.id + '">' +
      Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], periodo); }).join("") +
      "</select></span>" +
      '<span class="mobile-th">Día(s) de pago</span><span>' + renderSelectorDiaPago("set-gasto-fijo-dia", g.id, periodo, dias, "Próximo: " + fechaCorta(calcFechaVencimientoPeriodo(periodo, dias))) + "</span>" +
      '<span class="mobile-th">Estado</span><span><button class="status-pill ' + (pendiente ? "pendiente" : "pagado") + '" data-action="toggle-gasto-fijo-pagado" data-id="' + g.id + '">' + (pendiente ? "pendiente" : "pagado este periodo") + "</button></span>" +
      '<button class="btn danger small" data-action="remove-gasto-fijo" data-id="' + g.id + '">✕</button></div>';
  });
  if ((cfg.gastosFijos || []).length === 0) { html += '<div class="empty">Aún no registras gastos fijos.</div>'; }
  html += renderPendForm("gastoFijo", "+ Agregar gasto fijo",
    '<div class="form-grid">' +
    '<div class="field wide"><label>Concepto</label><input data-form="gastoFijo" data-field="nombre" value="' + esc(gf.nombre) + '" placeholder="Ej. Arriendo del taller" /></div>' +
    '<div class="field"><label>Monto</label><input type="number" data-form="gastoFijo" data-field="monto" value="' + esc(gf.monto) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Periodo</label><select data-action-change="set-gasto-fijo-form-periodo">' +
    Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], periodoFormGasto); }).join("") +
    "</select></div>" +
    '<div class="field' + (periodoFormGasto === "quincenal" ? " wide" : "") + '"><label>Día(s) de pago</label>' + renderSelectorDiaPago("set-gasto-fijo-form-dia", "", periodoFormGasto, diasFormGasto) + "</div>" +
    '<button class="btn" data-action="add-gasto-fijo">Agregar gasto fijo</button>' +
    "</div>");
  html += "</div>";

  // ---------- Meta (periodo graduable) ----------
  var meta = cfg.meta || { label: "", monto: 0, periodo: "mensual" };
  var balancePeriodo = calcBalancePeriodo(meta.periodo || "mensual");
  var progresoMeta = num(meta.monto) > 0 ? Math.max(0, Math.min(100, (balancePeriodo / num(meta.monto)) * 100)) : null;
  html += '<div class="card"><div class="section-title small">Meta' +
    renderHelp("Define una meta de balance neto para el periodo que elijas (semana, quincena o mes). El progreso se ve en detalle en Resumen → Reporte financiero; aquí solo la defines.") +
    "</div>";
  if (progresoMeta !== null) {
    html += '<div class="section-sub" style="margin-bottom:0;">Progreso de este periodo — <b style="color:var(--ink);">' + esc(meta.label || "Meta") + "</b>: <b style=\"color:var(--ink);\">" + progresoMeta.toFixed(0) + "%</b> (" + fmt(balancePeriodo) + " de " + fmt(meta.monto) + ")</div>";
  }
  html += renderPendForm("meta", progresoMeta !== null ? "Editar meta" : "+ Definir una meta",
    '<div class="form-grid">' +
    '<div class="field wide"><label>Etiqueta</label><input id="inp-meta-label" value="' + esc(meta.label) + '" placeholder="Ej. Meta de balance neto" /></div>' +
    '<div class="field"><label>Monto objetivo</label><input type="number" id="inp-meta-monto" value="' + esc(meta.monto) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Periodo</label><select id="inp-meta-periodo">' +
    Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], meta.periodo || "mensual"); }).join("") +
    "</select></div>" +
    '<button class="btn" data-action="save-meta">Guardar meta</button>' +
    "</div>");
  html += "</div>";

  // ---------- Deudas ----------
  // Dos pestañas (mismo patrón "gsheet-tabs" que Cotizaciones/Pedidos/
  // Clientes/Finanzas): "Activas" es la tabla operativa de deudas pendientes
  // con su formulario de alta; "Historial" es el registro de deudas ya
  // saldadas por completo — antes eran dos tarjetas siempre apiladas,
  // ocupando espacio aunque no hubiera nada pendiente que ver en una de ellas.
  html += renderTabsDeudas();
  html += (state.deudasVista === "historial") ? renderDeudasHistorial() : renderDeudasActivas();

  // La comisión de vendedores ya no tiene panel aparte: aparece agrupada por
  // vendedor dentro del desglose de "Cuentas por pagar" de arriba (categoría
  // "Comisiones de vendedores"). Para pagar o definir la fecha de pago de
  // cada comisión, se sigue haciendo desde la tarjeta del pedido o cotización
  // correspondiente.

  return html;
}

// Detalle desplegado bajo la fila agregada de un vendedor en "Comisiones de
// vendedores": cada pedido/cotización detrás de ese total, con un botón para
// saltar directo a verificarlo — mismo patrón de navegación que "↗ Origen"
// en Finanzas (ver-origen-tx), pero yendo directo al pedido/cotización en
// vez de partir de un movimiento ya creado (acá la comisión sigue pendiente,
// todavía no hay tx de la que partir).
function renderDetalleComisionVendedor(nombre) {
  var items = calcDetalleComisionesVendedor(nombre);
  if (!items.length) return "";
  var html = '<div style="margin:2px 0 8px;padding-left:10px;border-left:2px solid var(--border-soft);display:flex;flex-direction:column;gap:4px;">';
  items.forEach(function (it) {
    html += '<div class="tx-row" style="grid-template-columns:1fr 90px 90px;padding:2px 0;">' +
      '<span style="font-size:12px;color:var(--ink-soft);">' + esc(it.label) + "</span>" +
      '<span class="amount" style="font-size:12px;">' + fmt(it.monto) + "</span>" +
      '<button class="btn ghost small" data-action="ir-a-comision-origen" data-tipo="' + it.tipo + '" data-id="' + it.id + '">↗ Ver</button>' +
      "</div>";
  });
  return html + "</div>";
}

function renderTabsDeudas() {
  var vista = state.deudasVista || "activas";
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "activas" ? "active" : "") + '" data-action="deudas-vista" data-val="activas">Deudas' + (state.deudas.length ? " (" + state.deudas.length + ")" : "") + "</button>" +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="deudas-vista" data-val="historial">Historial' + (state.deudasHistorial.length ? " (" + state.deudasHistorial.length + ")" : "") + "</button>" +
    "</div>";
}

function renderDeudasActivas() {
  var fd = state.formDeuda;
  var html = '<div class="card"><div class="section-title small">Deudas' +
    renderHelp("Préstamos, proveedores u otras deudas del taller. Define cuotas, periodo y día(s) de pago desde ya (si aplica); \"Pagar\" registra la cuota siguiente (o el saldo completo si es pago único) como gasto en Finanzas. En cuanto queda pagada por completo, la deuda sale de esta lista y se mueve entera a la pestaña Historial.") +
    "</div>";
  html += '<div class="emp-row" style="grid-template-columns:1fr 1fr 100px 90px 120px 150px;font-size:10.5px;text-transform:uppercase;color:var(--ink-faint);font-weight:700;border-bottom:1px solid var(--border);"><span>Concepto</span><span>Con quién</span><span>Saldo</span><span>Cuotas</span><span>Periodo</span><span></span></div>';
  state.deudas.forEach(function (d) {
    if (state.deudaEditando === d.id) { html += renderFilaEdicionDeuda(d); return; }
    var cuotas = num(d.cuotas) || 1;
    var pagadas = Math.min(num(d.cuotasPagadas) || 0, cuotas);
    var valorCuota = calcDeudaValorCuota(d);
    var saldo = calcDeudaSaldoPendiente(d);
    var periodo = d.periodo || "mensual";
    var dias = diasPagoDe(d);
    // Aquí solo hay deudas pendientes: en cuanto se paga la última cuota, la
    // deuda se mueve entera al historial de abajo (ver acción "pagar-deuda").
    html += '<div class="emp-row" data-deuda-id="' + d.id + '" style="grid-template-columns:1fr 1fr 100px 90px 120px 150px;">' +
      '<span class="mobile-th">Concepto</span><span>' + esc(d.concepto) + '</span><span class="mobile-th">Con quién</span><span>' + esc(d.contraparte || "—") + '</span>' +
      '<span class="mobile-th">Saldo</span><span class="amount" title="Monto total: ' + fmt(d.monto) + '">' + fmt(saldo) + "</span>" +
      '<span class="mobile-th">Cuotas</span><span>' + (cuotas > 1 ? (pagadas + "/" + cuotas) : "Único") + "</span>" +
      '<span class="mobile-th">Periodo</span><span>' + (dias.length ? (PERIODOS_PAGO[periodo] + " · " + dias.join(",")) : PERIODOS_PAGO[periodo]) + "</span>" +
      '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      '<button class="btn small" data-action="pagar-deuda" data-id="' + d.id + '">Pagar</button>' +
      '<button class="btn ghost small" data-action="editar-deuda" data-id="' + d.id + '">Editar</button>' +
      '<button class="btn danger small" data-action="remove-deuda" data-id="' + d.id + '">✕</button>' +
      "</span></div>";
    html += '<div class="section-sub" style="margin:2px 0 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      (cuotas > 1 ? ("Valor por cuota: " + fmt(valorCuota)) : "") +
      (d.fechaVencimiento ? " · Vence: " + esc(d.fechaVencimiento) : "") +
      "</div>";
  });
  if (state.deudas.length === 0) { html += '<div class="empty">Sin deudas pendientes.</div>'; }
  html += renderPendForm("deuda", "+ Agregar deuda",
    '<div class="form-grid">' +
    '<div class="field wide"><label>Concepto</label><input data-form="deuda" data-field="concepto" value="' + esc(fd.concepto) + '" placeholder="Ej. Préstamo máquina plana" /></div>' +
    '<div class="field"><label>Con quién</label><input data-form="deuda" data-field="contraparte" value="' + esc(fd.contraparte) + '" placeholder="Opcional" /></div>' +
    '<div class="field"><label>Monto total</label><input type="number" data-form="deuda" data-field="monto" value="' + esc(fd.monto) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Cuotas (opcional)</label><input type="number" min="1" data-form="deuda" data-field="cuotas" value="' + esc(fd.cuotas) + '" placeholder="Ej. 6" /></div>' +
    '<div class="field"><label>Periodo</label><select data-action-change="set-deuda-form-periodo">' +
    Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], fd.periodo || "mensual"); }).join("") +
    "</select></div>" +
    '<div class="field' + (fd.periodo === "quincenal" ? " wide" : "") + '"><label>Día(s) de pago (opcional)</label>' + renderSelectorDiaPago("set-deuda-form-dia", "", fd.periodo || "mensual", fd.diasPago || []) + "</div>" +
    '<div class="field"><label>Vence (opcional, si no usas periodo)</label><input type="date" data-form="deuda" data-field="fechaVencimiento" value="' + esc(fd.fechaVencimiento) + '" /></div>' +
    '<button class="btn" data-action="add-deuda">Agregar deuda</button>' +
    "</div>");
  html += "</div>";
  return html;
}

// ---------- Historial de deudas (pagadas por completo) ----------
// A diferencia del historial de PAGOS de una deuda activa (que ya no se
// muestra suelto), esto es un registro de DEUDAS completas: cuando una
// deuda termina de pagarse, se saca por completo de la tabla de Activas y
// aparece aquí — no es una bitácora de movimientos, es "a dónde se van" las
// deudas ya saldadas.
function renderDeudasHistorial() {
  var html = '<div class="card"><div class="section-title small">Historial de deudas' +
    renderHelp("Deudas ya pagadas por completo. En cuanto \"Pagar\" salda la última cuota (o el pago único), la deuda se mueve aquí entera y deja de contar como pendiente.") +
    "</div>";
  if (state.deudasHistorial.length === 0) {
    html += '<div class="empty">Aún no hay deudas pagadas por completo.</div>';
    html += "</div>";
    return html;
  }
  html += '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">';
  state.deudasHistorial.slice().reverse().forEach(function (d) {
    var cuotas = num(d.cuotas) || 1;
    html += '<div data-deuda-id="' + d.id + '" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:var(--surface-2);border-radius:10px;">' +
      '<div style="min-width:0;">' +
      '<div style="font-weight:700;font-size:13px;">' + esc(d.concepto) + "</div>" +
      '<div style="font-size:11.5px;color:var(--ink-faint);margin-top:2px;">' +
      (d.contraparte ? esc(d.contraparte) + " · " : "") +
      (cuotas > 1 ? cuotas + (cuotas === 1 ? " cuota" : " cuotas") + " · " : "Pago único · ") +
      "Saldada el " + (d.fechaCompletada ? fechaCorta(new Date(d.fechaCompletada + "T00:00:00")) : "—") +
      "</div></div>" +
      '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
      '<span class="amount">' + fmt(d.monto) + "</span>" +
      '<button class="btn ghost small" data-action="remove-deuda-historial" data-id="' + d.id + '" title="Quitar del historial (no borra los movimientos ya creados en Finanzas)">✕</button>' +
      "</div></div>";
  });
  html += "</div></div>";
  return html;
}

function fechaCorta(fecha) {
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }).replace(".", "");
}

// Cada "agregar nuevo/a X" de esta pestaña (empleado, gasto fijo, meta,
// deuda) vive detrás de este mismo botón — colapsado por defecto, para que
// la pestaña muestre las tablas (lo que se consulta seguido) sin ~19 campos
// de formulario siempre abiertos al lado. Mismo patrón que ya usan las
// secciones colapsables de Cotizaciones.
function renderPendForm(key, labelBoton, contenidoHtml) {
  var abierto = !!state.pendFormsAbiertos[key];
  // data-key (no data-form): data-form ya lo usa el patrón genérico de
  // core/dom.js para saber en qué borrador de state.form* escribir cada
  // input — este botón no es un input de ningún formulario, solo el
  // interruptor que lo muestra/oculta.
  if (!abierto) {
    return '<button class="btn ghost small" style="margin-top:12px;" data-action="toggle-pend-form" data-key="' + key + '">' + esc(labelBoton) + "</button>";
  }
  return '<div style="margin-top:12px;">' + contenidoHtml +
    '<button class="btn ghost small" style="margin-top:8px;" data-action="toggle-pend-form" data-key="' + key + '">Cancelar</button></div>';
}

var COLS_EMP = "1.2fr 1.3fr 110px 105px 100px 195px";

// Fila de solo-lectura de una persona en nómina — periodo/día/salario ya NO
// se editan aquí en vivo (antes eran <select>/<input> siempre activos en la
// fila, lo que hacía parecer que había que "agregar primero y arreglar
// después"). Ahora se editan todos juntos detrás de "Editar", con
// Guardar/Cancelar — mismo patrón que ya usa Clientes (renderClienteEdit) y
// Deudas (renderFilaEdicionDeuda).
function renderFilaEmp(e) {
  var periodoE = periodoDeEmpleado(e);
  var diasE = diasPagoDeEmpleado(e);
  var rangoE = rangoPeriodoActual(periodoE);
  var pagado = calcNominaPagadaEmpleado(e.nombre, periodoE);
  var aPagar = calcSalarioPorPeriodo(e, periodoE);
  var estaPagado = aPagar > 0 && pagado >= aPagar - 0.5;
  var html = '<div class="emp-row" style="grid-template-columns:' + COLS_EMP + ';">' +
    '<span class="mobile-th">Nombre</span><span><b>' + esc(e.nombre) + "</b>" + (e.cargo ? ' <span style="color:var(--ink-faint);">· ' + esc(e.cargo) + "</span>" : "") + "</span>" +
    '<span class="mobile-th">Periodo y día</span><span>' + esc(PERIODOS_PAGO[periodoE]) + (diasE.length ? " — " + esc(textoDias(periodoE, diasE)) : " — sin día definido") + "</span>" +
    '<span class="mobile-th">Salario ' + esc(ETIQ_PERIODO[periodoE]) + "</span><span class=\"amount\">" + fmt(aPagar) + "</span>" +
    '<span class="mobile-th">Próximo pago</span><span style="font-size:11.5px;color:var(--ink-faint);font-family:\'IBM Plex Mono\',monospace;" title="Periodo en curso: ' + esc(rangoTexto(rangoE)) + '">' + fechaCorta(calcFechaVencimientoPeriodo(periodoE, diasE)) + "</span>" +
    '<span class="mobile-th">Estado</span><span><span class="status-pill ' + (estaPagado ? "pagado" : "pendiente") + '">' + (pagado > 0 ? (estaPagado ? "pagado" : fmt(pagado) + " abonado") : "pendiente") + "</span></span>" +
    '<span class="mobile-th">Acciones</span><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    '<button class="btn small" data-action="toggle-nomina-pago" data-id="' + e.id + '">Pagar</button>' +
    '<button class="btn ghost small" data-action="editar-emp" data-id="' + e.id + '">Editar</button>' +
    '<button class="btn danger small" data-action="remove-emp" data-id="' + e.id + '">✕</button>' +
    "</span></div>";
  if (state.nominaPagoId === e.id) html += renderFormNominaPago(e, periodoE, rangoE);
  return html;
}

// Modo edición explícito (Guardar/Cancelar) de una persona en nómina. El
// periodo/día usan un pequeño borrador reactivo aparte (state.empEditDraft)
// porque, a diferencia de nombre/cargo/salario (que solo se leen al Guardar),
// el TIPO de selector de día depende de qué periodo esté elegido AHORA MISMO
// en el formulario — sin esto, cambiar de "mensual" a "quincenal" en la
// edición no alcanzaría a mostrar el segundo día hasta guardar y reabrir.
function renderFilaEdicionEmp(e) {
  var draft = state.empEditDraft || { periodo: periodoDeEmpleado(e), diasPago: diasPagoDeEmpleado(e).slice() };
  var periodoEdit = draft.periodo || "mensual";
  var diasEdit = draft.diasPago || [];
  return '<div data-emp-edit-row="' + e.id + '" style="background:var(--surface-2);border-radius:10px;padding:12px 14px;margin-bottom:8px;">' +
    '<div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input class="mini-input" data-role="edit-nombre" value="' + esc(e.nombre) + '" /></div>' +
    '<div class="field"><label>Cargo</label><input class="mini-input" data-role="edit-cargo" value="' + esc(e.cargo || "") + '" /></div>' +
    '<div class="field"><label>Periodo de pago</label><select class="mini-input" data-action-change="set-emp-edit-periodo" data-id="' + e.id + '">' +
    Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], periodoEdit); }).join("") +
    "</select></div>" +
    '<div class="field' + (periodoEdit === "quincenal" ? " wide" : "") + '"><label>Día(s) de pago</label>' + renderSelectorDiaPago("set-emp-edit-dia", e.id, periodoEdit, diasEdit) + "</div>" +
    '<div class="field"><label>Salario ' + esc(ETIQ_PERIODO[periodoEdit]) +
    renderHelp("Si cambiaste el periodo, este valor ya viene convertido — ajústalo si hace falta. Al guardar, este número queda como el salario base en la nueva periodicidad.") +
    '</label><input type="number" class="mini-input" data-role="edit-salario" value="' + Math.round(calcSalarioPorPeriodo(e, periodoEdit)) + '" /></div>' +
    "</div>" +
    '<div class="pedido-actions" style="margin-top:10px;">' +
    '<button class="btn small" data-action="guardar-emp-edit" data-id="' + e.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-emp">Cancelar</button>' +
    "</div></div>";
}

// Mini-formulario de pago que se abre bajo la fila de UNA persona en Nómina
// al hacer clic en "Pagar". El monto final (salario + bono - descuento) se
// recalcula en cada render a partir de state.formNominaPago, así que se ve
// en vivo mientras se escribe — sin JS aparte, mismo patrón que el resto de
// la app (re-renderiza todo el árbol en cada notify()).
function renderFormNominaPago(e, periodoPago, rango) {
  var fp = state.formNominaPago;
  var bono = num(fp.bono), descuento = num(fp.descuento);
  var base = calcSalarioPorPeriodo(e, periodoPago);
  var total = Math.max(0, base + bono - descuento);
  return '<div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;margin:2px 0 10px;">' +
    '<div class="section-sub" style="margin:0 0 10px;">Pago de <b style="color:var(--ink);">' + esc(e.nombre) + "</b> por el periodo <b style=\"color:var(--ink);\">" + esc(rangoTexto(rango)) + "</b></div>" +
    '<div class="form-grid">' +
    '<div class="field"><label>Bono / horas extra (opcional)</label><input type="number" data-form="nominaPago" data-field="bono" value="' + esc(fp.bono) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Descuento (opcional)' + renderHelp("Ej. un préstamo, una ausencia. Se resta del salario del periodo.") + '</label><input type="number" data-form="nominaPago" data-field="descuento" value="' + esc(fp.descuento) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Fecha del pago</label><input type="date" data-form="nominaPago" data-field="fecha" value="' + esc(fp.fecha || todayStr()) + '" /></div>' +
    "</div>" +
    '<div class="section-sub" style="margin:10px 0;">Total a pagar: <b style="color:var(--ink);font-size:14px;">' + fmt(total) + "</b> <span style=\"color:var(--ink-faint);\">= " + fmt(base) + " salario" + (bono ? " + " + fmt(bono) + " bono" : "") + (descuento ? " − " + fmt(descuento) + " descuento" : "") + "</span></div>" +
    '<div class="pedido-actions">' +
    '<button class="btn small" data-action="pagar-nomina" data-id="' + e.id + '">Confirmar pago</button>' +
    '<button class="btn ghost small" data-action="toggle-nomina-pago" data-id="' + e.id + '">Cancelar</button>' +
    "</div></div>";
}

// Etiqueta corta del periodo, reutilizada en varios puntos (antes era un
// object literal repetido 3 veces).
var ETIQ_PERIODO = { mensual: "mensual", quincenal: "quincenal", semanal: "semanal" };

// Día(s) por defecto al ELEGIR un periodo (no al guardar) — quincenal siempre
// arranca con AMBOS días del mes ya sugeridos (1 y 15, los más comunes), en
// vez de dejarlo vacío y obligar a buscar "¿cómo hago para poner dos días?".
// El usuario los puede ajustar, pero nunca parte de cero.
function diasPorDefecto(periodo) {
  if (periodo === "quincenal") return [1, 15];
  if (periodo === "mensual") return [1];
  return []; // semanal: no hay un día "obvio" por defecto, se elige a mano
}

// Selector de día(s) de pago — reemplaza el input de texto libre de antes
// (que se prestaba a error, ej. "quincenal" solo aceptaba un día). Según el
// periodo:
//  - semanal: UN <select> con el nombre del día (Lunes..Domingo).
//  - quincenal: DOS <select> de día-del-mes (1-31) lado a lado — quincenal
//    siempre son dos fechas, nunca una sola.
//  - mensual: UN <select> de día-del-mes (1-31).
// `action` recibe data-idx (0 o 1) para saber qué posición de diasPago[] está
// cambiando. `id` es opcional: vacío para los formularios "+ Agregar ___"
// (que escriben sobre su propio borrador, no sobre un registro ya guardado).
function renderSelectorDiaPago(action, id, periodo, dias, tooltip) {
  var t = tooltip ? ' title="' + esc(tooltip) + '"' : "";
  var idAttr = id ? ' data-id="' + id + '"' : "";
  var inner;
  if (periodo === "semanal") {
    var actual = dias.length ? String(dias[0]) : "";
    inner = '<select class="mini-input" style="width:100%" data-action-change="' + action + '"' + idAttr + ' data-idx="0">' +
      '<option value="">Elegir día…</option>' +
      Object.keys(DIAS_SEMANA).map(function (k) { return opt(k, DIAS_SEMANA[k], actual); }).join("") +
      "</select>";
  } else if (periodo === "quincenal") {
    inner = '<div style="display:flex;gap:6px;">' +
      '<select class="mini-input" data-action-change="' + action + '"' + idAttr + ' data-idx="0" title="Primer pago del mes">' + opcionesDiaMes(dias[0]) + "</select>" +
      '<select class="mini-input" data-action-change="' + action + '"' + idAttr + ' data-idx="1" title="Segundo pago del mes">' + opcionesDiaMes(dias[1]) + "</select>" +
      "</div>";
  } else {
    inner = '<select class="mini-input" style="width:100%" data-action-change="' + action + '"' + idAttr + ' data-idx="0">' + opcionesDiaMes(dias[0]) + "</select>";
  }
  return t ? ('<span' + t + '>' + inner + "</span>") : inner;
}
function opcionesDiaMes(valorActual) {
  var actual = (valorActual !== undefined && valorActual !== null && valorActual !== "") ? String(valorActual) : "";
  var out = ['<option value="">Día…</option>'];
  for (var d = 1; d <= 31; d++) out.push(opt(String(d), String(d), actual));
  return out.join("");
}
// "días 1 y 15" / "sábado" / "día 1" — texto legible del día(s) de pago para
// la fila de solo-lectura (antes de entrar a "Editar").
function textoDias(periodo, dias) {
  if (!dias.length) return "";
  if (periodo === "semanal") return DIAS_SEMANA[dias[0]] || "";
  if (dias.length > 1) return "días " + dias.join(" y ");
  return "día " + dias[0];
}

// "4–10 ago" / "1–31 ago" — el rango del periodo en una sola línea corta,
// omitiendo el mes repetido cuando desde y hasta caen en el mismo.
function rangoTexto(rango) {
  var mesDesde = rango.desde.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
  var mesHasta = rango.hasta.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
  if (mesDesde === mesHasta) return rango.desde.getDate() + "–" + rango.hasta.getDate() + " " + mesHasta;
  return rango.desde.getDate() + " " + mesDesde + " – " + rango.hasta.getDate() + " " + mesHasta;
}

// Fila de deuda en modo edición: todos los campos (incluido periodo/días,
// que antes solo se podían tocar después de crear la deuda) quedan editables
// aquí mismo, con Guardar/Cancelar — así "editar" es un modo explícito y no
// inputs sueltos siempre activos en la tabla.
function renderFilaEdicionDeuda(d) {
  var dias = diasPagoDe(d);
  return '<div data-deuda-edit-row="' + d.id + '">' +
    '<div class="emp-row" style="grid-template-columns:1fr 1fr 100px 90px 120px 90px 150px;background:var(--surface-2);">' +
    '<span class="mobile-th">Concepto</span><span><input class="mini-input" style="width:100%" data-role="edit-concepto" value="' + esc(d.concepto) + '" /></span>' +
    '<span class="mobile-th">Con quién</span><span><input class="mini-input" style="width:100%" data-role="edit-contraparte" value="' + esc(d.contraparte || "") + '" /></span>' +
    '<span class="mobile-th">Monto</span><span><input type="number" class="mini-input" style="width:100%" data-role="edit-monto" value="' + esc(d.monto) + '" /></span>' +
    '<span class="mobile-th">Cuotas</span><span><input type="number" min="1" class="mini-input" style="width:100%" data-role="edit-cuotas" value="' + esc(d.cuotas || "") + '" /></span>' +
    '<span class="mobile-th">Periodo</span><span><select class="mini-input" style="width:100%" data-role="edit-periodo">' +
    Object.keys(PERIODOS_PAGO).map(function (k) { return opt(k, PERIODOS_PAGO[k], d.periodo || "mensual"); }).join("") +
    "</select></span>" +
    '<span class="mobile-th">Día(s) de pago</span><span><input class="mini-input" style="width:100%" data-role="edit-dias" value="' + esc(dias.join(",")) + '" placeholder="Días de pago" /></span>' +
    '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    '<button class="btn small" data-action="guardar-deuda-edit" data-id="' + d.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-deuda">Cancelar</button>' +
    "</span></div>" +
    '<div class="section-sub" style="margin:2px 0 8px;">Vence (opcional, si no usas periodo) <input type="date" class="mini-input" data-role="edit-fecha" value="' + esc(d.fechaVencimiento || "") + '" /></div>' +
    "</div>";
}

// ---------- Sincronización de vencimientos con Google Calendar (admin) ----------
// Cada deuda o gasto fijo con una fecha de vencimiento vigente (fija, o la
// PRÓXIMA calculada por su periodo) tiene como mucho UN evento en el
// Calendar de quien esté logueado — no una serie recurrente: el evento se
// crea, se mueve hacia adelante o se borra automáticamente cada vez que se
// agrega, edita, paga o elimina la obligación (ver los actions de abajo).
// Como solo el rol admin ve esta pestaña, esto siempre corre contra SU
// propio Calendar, nunca el de un vendedor. Los fallos (sin conexión, scope
// todavía no otorgado porque el admin no volvió a iniciar sesión desde que
// se agregó esta integración, etc.) solo quedan en consola: nunca deben
// bloquear la operación real (guardar la deuda/el gasto fijo).
function sincronizarEventoDeuda(deuda) {
  var session = getSession();
  if (!session || session.rol !== "admin") return;
  var dias = diasPagoDe(deuda);
  var fecha = dias.length ? calcFechaVencimientoPeriodo(deuda.periodo || "mensual", dias)
    : (deuda.fechaVencimiento ? new Date(deuda.fechaVencimiento + "T00:00:00") : null);
  if (!fecha) {
    if (deuda.calendarEventId) {
      eliminarEvento(deuda.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar de la deuda", e); });
      state.deudas = state.deudas.map(function (d) { return d.id === deuda.id ? Object.assign({}, d, { calendarEventId: "" }) : d; });
      persist("deudas");
    }
    return;
  }
  var cuotas = num(deuda.cuotas) || 1;
  var pagadas = Math.min(num(deuda.cuotasPagadas) || 0, cuotas);
  var titulo = "💳 " + deuda.concepto + (cuotas > 1 ? " (cuota " + (pagadas + 1) + "/" + cuotas + ")" : "");
  var descripcion = "Vence: " + fmt(calcDeudaValorCuota(deuda)) + (deuda.contraparte ? " · Con: " + deuda.contraparte : "");
  sincronizarEvento(deuda.calendarEventId, eventoUnDia(titulo, descripcion, fecha)).then(function (eventId) {
    var idx = state.deudas.findIndex(function (d) { return d.id === deuda.id; });
    if (idx === -1 || state.deudas[idx].calendarEventId === eventId) return;
    state.deudas = state.deudas.map(function (d) { return d.id === deuda.id ? Object.assign({}, d, { calendarEventId: eventId }) : d; });
    persist("deudas");
  }).catch(function (e) { console.error("No se pudo sincronizar la deuda con Calendar", e); });
}

// A diferencia de la deuda (que se borra del todo cuando ya no aplica), el
// gasto fijo sigue existiendo aunque ya esté pagado este periodo — solo se
// borra su evento (no tiene sentido seguir recordando algo que ya se pagó);
// la próxima vez que vuelva a estar pendiente, este mismo helper lo vuelve a
// crear con la fecha del siguiente vencimiento.
function sincronizarEventoGastoFijo(g) {
  var session = getSession();
  if (!session || session.rol !== "admin") return;
  if (calcGastoFijoPendiente(g) <= 0) {
    if (g.calendarEventId) {
      eliminarEvento(g.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar del gasto fijo", e); });
      state.config.gastosFijos = (state.config.gastosFijos || []).map(function (x) { return x.id === g.id ? Object.assign({}, x, { calendarEventId: "" }) : x; });
      persist("config");
    }
    return;
  }
  var fecha = calcFechaVencimientoPeriodo(g.periodo || "mensual", diasPagoDe(g));
  var titulo = "🏠 " + g.nombre;
  var descripcion = "Gasto fijo · " + fmt(g.monto);
  sincronizarEvento(g.calendarEventId, eventoUnDia(titulo, descripcion, fecha)).then(function (eventId) {
    var idx = (state.config.gastosFijos || []).findIndex(function (x) { return x.id === g.id; });
    if (idx === -1 || state.config.gastosFijos[idx].calendarEventId === eventId) return;
    state.config.gastosFijos = state.config.gastosFijos.map(function (x) { return x.id === g.id ? Object.assign({}, x, { calendarEventId: eventId }) : x; });
    persist("config");
  }).catch(function (e) { console.error("No se pudo sincronizar el gasto fijo con Calendar", e); });
}

export var actions = {
  "toggle-pend-form": function (el) {
    var key = el.getAttribute("data-key");
    state.pendFormsAbiertos = Object.assign({}, state.pendFormsAbiertos, { [key]: !state.pendFormsAbiertos[key] });
    notify();
  },
  "deudas-vista": function (el) {
    state.deudasVista = el.getAttribute("data-val");
    notify();
  },
  "toggle-comision-vendedor": function (el) {
    var nombre = el.getAttribute("data-nombre");
    state.comisionVendedorExpandido = state.comisionVendedorExpandido === nombre ? "" : nombre;
    notify();
  },
  "ir-a-comision-origen": function (el) {
    var tipo = el.getAttribute("data-tipo"), id = el.getAttribute("data-id");
    state.sidebarMobileOpen = false;
    if (tipo === "cotizacion") {
      state.tab = "cotizaciones";
      state.cotizacionEditando = id;
      state.cotizacionesVista = "nueva";
      notify();
      return;
    }
    state.tab = "pedidos";
    state.filtroPedidosVista = "activos";
    state.pedidosVista = "historial";
    notify();
    setTimeout(function () {
      var card = document.querySelector('[data-pedido-id="' + id + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      // Destello (2 titileos) para identificar la tarjeta — ver
      // @keyframes destello en css/base.css.
      card.classList.add("destello");
    }, 60);
  },
  "add-emp": function () {
    var fe = state.formEmp;
    var periodoElegido = fe.periodo || state.config.periodoPago || "mensual";
    if (!exigirCampos([["Nombre", fe.nombre], ["Salario " + PERIODOS_PAGO[periodoElegido].toLowerCase(), fe.salario]])) return;
    var diasElegidos = ((fe.diasPago && fe.diasPago.length) ? fe.diasPago : diasPorDefecto(periodoElegido))
      .filter(function (d) { return d !== undefined && d !== null && !isNaN(d); });
    // salarioPeriodo guarda EN QUÉ BASE se cargó el monto (la que estaba
    // elegida al momento de agregarlo). Sin esto, cambiar después el periodo
    // de pago de esta persona reinterpretaría en silencio el número cargado
    // (un semanal de 300.000 pasaría a leerse como mensual).
    state.config.nomina = (state.config.nomina || []).concat([{
      id: uid(), nombre: fe.nombre, cargo: fe.cargo, salario: num(fe.salario),
      salarioPeriodo: periodoElegido, periodo: periodoElegido, diasPago: diasElegidos
    }]);
    state.formEmp = { nombre: "", cargo: "", salario: "", periodo: "", diasPago: [] };
    persist("config"); notify();
  },
  "remove-emp": function (el) {
    var id = el.getAttribute("data-id");
    var e = (state.config.nomina || []).filter(function (e) { return e.id === id; })[0];
    if (!e) return;
    if (!window.confirm('¿Quitar a "' + e.nombre + '" de la nómina?\n\nDeja de contar en "Por pagar". No borra los pagos que ya se le hayan registrado en Finanzas.')) return;
    state.config.nomina = (state.config.nomina || []).filter(function (e) { return e.id !== id; });
    persist("config"); notify();
  },
  "toggle-nomina-pago": function (el) {
    var id = el.getAttribute("data-id");
    state.nominaPagoId = state.nominaPagoId === id ? "" : id;
    state.formNominaPago = { bono: "", descuento: "", fecha: todayStr() };
    notify();
  },
  "pagar-nomina": function (el) {
    var id = el.getAttribute("data-id");
    var e = (state.config.nomina || []).filter(function (e) { return e.id === id; })[0];
    if (!e) return;
    var periodoPago = periodoDeEmpleado(e);
    var fp = state.formNominaPago;
    var bono = num(fp.bono), descuento = num(fp.descuento);
    // El salario del PERIODO, no el mensual crudo: si el taller paga semanal,
    // esto cobra la semana. Antes tomaba e.salario tal cual (siempre mensual)
    // y exigía el mes completo aunque el pago fuera semanal.
    var monto = Math.max(0, calcSalarioPorPeriodo(e, periodoPago) + bono - descuento);
    if (monto <= 0) return;
    var rango = rangoPeriodoActual(periodoPago);
    var concepto = "Nómina " + rangoTexto(rango) + " — " + e.nombre + (bono ? " (+" + fmt(bono) + " bono)" : "") + (descuento ? " (−" + fmt(descuento) + " descuento)" : "");
    state.tx.unshift({ id: uid(), tipo: "nomina", concepto: concepto, monto: monto, contraparte: e.nombre, fecha: fp.fecha || todayStr(), pedidoId: "" });
    state.nominaPagoId = "";
    state.formNominaPago = { bono: "", descuento: "", fecha: todayStr() };
    persist("tx"); notify();
  },
  // ---------- Edición de una persona en nómina (Editar/Guardar/Cancelar) ----------
  "editar-emp": function (el) {
    var id = el.getAttribute("data-id");
    var e = (state.config.nomina || []).filter(function (e) { return e.id === id; })[0];
    if (!e) return;
    state.empEditando = id;
    state.empEditDraft = { periodo: periodoDeEmpleado(e), diasPago: diasPagoDeEmpleado(e).slice() };
    notify();
  },
  "cancelar-edicion-emp": function () {
    state.empEditando = "";
    state.empEditDraft = null;
    notify();
  },
  // El periodo dentro del formulario de edición SÍ necesita disparar
  // re-render (a diferencia de nombre/cargo/salario, que solo se leen al
  // Guardar): cambiar de "mensual" a "quincenal" tiene que mostrar de una vez
  // el segundo selector de día, no recién al guardar.
  "set-emp-edit-periodo": function (el) {
    state.empEditDraft = { periodo: el.value, diasPago: diasPorDefecto(el.value) };
    notify();
  },
  "set-emp-edit-dia": function (el) {
    var idx = Number(el.getAttribute("data-idx")) || 0;
    var dias = (state.empEditDraft.diasPago || []).slice();
    dias[idx] = el.value === "" ? undefined : Number(el.value);
    state.empEditDraft.diasPago = dias;
    notify();
  },
  "guardar-emp-edit": function (el) {
    var id = el.getAttribute("data-id");
    var fila = el.closest("[data-emp-edit-row]");
    if (!fila) return;
    var nombre = val(fila, "edit-nombre");
    if (!nombre) return;
    var draft = state.empEditDraft || {};
    var periodoNuevo = draft.periodo || "mensual";
    var diasNuevo = (draft.diasPago || []).filter(function (d) { return d !== undefined && d !== null && !isNaN(d); });
    var salarioNuevo = num(val(fila, "edit-salario"));
    state.config.nomina = (state.config.nomina || []).map(function (e) {
      if (e.id !== id) return e;
      return Object.assign({}, e, {
        nombre: nombre, cargo: val(fila, "edit-cargo"),
        periodo: periodoNuevo, diasPago: diasNuevo, diaPago: "",
        salario: salarioNuevo, salarioPeriodo: periodoNuevo
      });
    });
    state.empEditando = ""; state.empEditDraft = null;
    persist("config"); notify();
  },
  "set-emp-form-periodo": function (el) {
    state.formEmp.periodo = el.value;
    state.formEmp.diasPago = diasPorDefecto(el.value);
    notify();
  },
  "set-emp-form-dia": function (el) {
    var idx = Number(el.getAttribute("data-idx")) || 0;
    var dias = (state.formEmp.diasPago || []).slice();
    dias[idx] = el.value === "" ? undefined : Number(el.value);
    state.formEmp.diasPago = dias;
    notify();
  },
  "set-gasto-fijo-form-periodo": function (el) {
    state.formGastoFijo.periodo = el.value;
    state.formGastoFijo.diasPago = diasPorDefecto(el.value);
    notify();
  },
  "set-gasto-fijo-form-dia": function (el) {
    var idx = Number(el.getAttribute("data-idx")) || 0;
    var dias = (state.formGastoFijo.diasPago || []).slice();
    dias[idx] = el.value === "" ? undefined : Number(el.value);
    state.formGastoFijo.diasPago = dias;
    notify();
  },
  "add-gasto-fijo": function () {
    var gf = state.formGastoFijo;
    if (!exigirCampos([["Concepto", gf.nombre], ["Monto", gf.monto]])) return;
    var diasElegidos = ((gf.diasPago && gf.diasPago.length) ? gf.diasPago : diasPorDefecto(gf.periodo || "mensual"))
      .filter(function (d) { return d !== undefined && d !== null && !isNaN(d); });
    state.config.gastosFijos = (state.config.gastosFijos || []).concat([{ id: uid(), nombre: gf.nombre, monto: num(gf.monto), periodo: gf.periodo || "mensual", diasPago: diasElegidos, pagadoHasta: "", calendarEventId: "" }]);
    state.formGastoFijo = { nombre: "", monto: "", periodo: "mensual", diasPago: [] };
    persist("config"); notify();
    sincronizarEventoGastoFijo(state.config.gastosFijos[state.config.gastosFijos.length - 1]);
  },
  "remove-gasto-fijo": function (el) {
    var id = el.getAttribute("data-id");
    var g = (state.config.gastosFijos || []).filter(function (g) { return g.id === id; })[0];
    if (!g) return;
    if (!window.confirm('¿Eliminar el gasto fijo "' + g.nombre + '"?\n\nDeja de contar en "Por pagar". No borra los pagos que ya se le hayan registrado en Finanzas.')) return;
    state.config.gastosFijos = (state.config.gastosFijos || []).filter(function (g) { return g.id !== id; });
    persist("config"); notify();
    if (g.calendarEventId) eliminarEvento(g.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar del gasto fijo", e); });
  },
  "set-gasto-fijo-periodo": function (el) {
    var id = el.getAttribute("data-id");
    state.config.gastosFijos = (state.config.gastosFijos || []).map(function (g) {
      return g.id === id ? Object.assign({}, g, { periodo: el.value, diasPago: diasPorDefecto(el.value), diaPago: "", pagadoHasta: "" }) : g;
    });
    persist("config"); notify();
    var actualizado = (state.config.gastosFijos || []).filter(function (g) { return g.id === id; })[0];
    if (actualizado) sincronizarEventoGastoFijo(actualizado);
  },
  "set-gasto-fijo-dia": function (el) {
    var id = el.getAttribute("data-id");
    var idx = Number(el.getAttribute("data-idx")) || 0;
    state.config.gastosFijos = (state.config.gastosFijos || []).map(function (g) {
      if (g.id !== id) return g;
      var dias = (g.diasPago || []).slice();
      dias[idx] = el.value === "" ? undefined : Number(el.value);
      return Object.assign({}, g, { diasPago: dias.filter(function (d) { return d !== undefined && d !== null && !isNaN(d); }), diaPago: "" });
    });
    persist("config"); notify();
    var actualizado = (state.config.gastosFijos || []).filter(function (g) { return g.id === id; })[0];
    if (actualizado) sincronizarEventoGastoFijo(actualizado);
  },
  // Al marcar un gasto fijo como pagado, además de actualizar su periodo,
  // se registra el movimiento correspondiente en Finanzas con la fecha de
  // hoy — así queda constancia (antes solo se marcaba el estado, sin dejar
  // registro ni fecha).
  // Toggle bidireccional por PERIODO puntual: marcar pagado crea el
  // movimiento de ESE periodo; desmarcarlo (deshacer un clic accidental) lo
  // revierte — pero solo el de este periodo (origenGastoFijoPeriodo incluye
  // la clave del periodo), nunca los de periodos anteriores ya cerrados. Sin
  // esto, volver a marcar pagado el mismo periodo más tarde duplicaría el
  // gasto en Finanzas (mismo problema que ya se corrigió en comisiones).
  "toggle-gasto-fijo-pagado": function (el) {
    var id = el.getAttribute("data-id");
    var gastoFijo = (state.config.gastosFijos || []).filter(function (g) { return g.id === id; })[0];
    if (!gastoFijo) return;
    var pendiente = calcGastoFijoPendiente(gastoFijo) > 0;
    // Misma lógica de "clave de periodo" que periodoKey() en core/calc.js.
    var periodo = gastoFijo.periodo || "mensual";
    var hoy = new Date();
    var y = hoy.getFullYear(), m = String(hoy.getMonth() + 1).padStart(2, "0"), d = hoy.getDate();
    var clave = y + "-" + m;
    if (periodo === "quincenal") clave = y + "-" + m + "-" + (d <= 15 ? "Q1" : "Q2");
    if (periodo === "semanal") {
      var inicioAno = new Date(hoy.getFullYear(), 0, 1);
      var dias = Math.floor((hoy - inicioAno) / 86400000);
      var semana = Math.ceil((dias + inicioAno.getDay() + 1) / 7);
      clave = y + "-W" + semana;
    }
    var origenPeriodo = id + "|" + clave;
    state.config.gastosFijos = (state.config.gastosFijos || []).map(function (g) {
      if (g.id !== id) return g;
      return Object.assign({}, g, { pagadoHasta: pendiente ? clave : "" });
    });
    if (pendiente) {
      state.tx.unshift({ id: uid(), tipo: "gasto", concepto: "Gasto fijo — " + gastoFijo.nombre, monto: num(gastoFijo.monto), contraparte: gastoFijo.nombre, fecha: todayStr(), pedidoId: "", gastoFijoId: gastoFijo.id, origenGastoFijoPeriodo: origenPeriodo });
    } else {
      state.tx = state.tx.filter(function (t) { return t.origenGastoFijoPeriodo !== origenPeriodo; });
    }
    persist("tx");
    persist("config"); notify();
    var actualizado = (state.config.gastosFijos || []).filter(function (g) { return g.id === id; })[0];
    if (actualizado) sincronizarEventoGastoFijo(actualizado);
  },
  "save-meta": function () {
    var labelEl = document.getElementById("inp-meta-label");
    var montoEl = document.getElementById("inp-meta-monto");
    var periodoEl = document.getElementById("inp-meta-periodo");
    state.config.meta = {
      label: labelEl ? labelEl.value : state.config.meta.label,
      monto: num(montoEl ? montoEl.value : state.config.meta.monto),
      periodo: periodoEl ? periodoEl.value : state.config.meta.periodo
    };
    persist("config"); notify();
  },
  "add-deuda": function () {
    var fd = state.formDeuda;
    if (!exigirCampos([["Concepto", fd.concepto], ["Monto total", fd.monto]])) return;
    var diasElegidos = (fd.diasPago || []).filter(function (d) { return d !== undefined && d !== null && !isNaN(d); });
    state.deudas.unshift({
      id: uid(), concepto: fd.concepto, contraparte: fd.contraparte, monto: num(fd.monto),
      fechaVencimiento: fd.fechaVencimiento || "", cuotas: num(fd.cuotas) || 1, cuotasPagadas: 0,
      periodo: fd.periodo || "mensual", diasPago: diasElegidos, historial: [], calendarEventId: ""
    });
    state.formDeuda = { concepto: "", monto: "", contraparte: "", fechaVencimiento: "", cuotas: "", periodo: "mensual", diasPago: [] };
    persist("deudas"); notify();
    sincronizarEventoDeuda(state.deudas[0]);
  },
  "set-deuda-form-periodo": function (el) {
    state.formDeuda.periodo = el.value;
    state.formDeuda.diasPago = []; // opcional en deudas: no se sugiere un default, a diferencia de nómina/gastos fijos
    notify();
  },
  "set-deuda-form-dia": function (el) {
    var idx = Number(el.getAttribute("data-idx")) || 0;
    var dias = (state.formDeuda.diasPago || []).slice();
    dias[idx] = el.value === "" ? undefined : Number(el.value);
    state.formDeuda.diasPago = dias;
    notify();
  },
  "editar-deuda": function (el) {
    state.deudaEditando = el.getAttribute("data-id");
    notify();
  },
  "cancelar-edicion-deuda": function () {
    state.deudaEditando = "";
    notify();
  },
  "guardar-deuda-edit": function (el) {
    var id = el.getAttribute("data-id");
    var fila = el.closest("[data-deuda-edit-row]");
    if (!fila) return;
    var g = function (role) { var i = fila.querySelector('[data-role="' + role + '"]'); return i ? i.value : ""; };
    var concepto = g("edit-concepto");
    var monto = num(g("edit-monto"));
    if (!concepto || monto <= 0) return;
    var nuevasCuotas = num(g("edit-cuotas")) || 1;
    state.deudas = state.deudas.map(function (d) {
      if (d.id !== id) return d;
      return Object.assign({}, d, {
        concepto: concepto,
        contraparte: g("edit-contraparte"),
        monto: monto,
        cuotas: nuevasCuotas,
        cuotasPagadas: Math.min(num(d.cuotasPagadas) || 0, nuevasCuotas),
        periodo: g("edit-periodo") || d.periodo,
        diasPago: parseDias(g("edit-dias")),
        fechaVencimiento: g("edit-fecha") || ""
      });
    });
    state.deudaEditando = "";
    persist("deudas"); notify();
    var actualizada = state.deudas.filter(function (d) { return d.id === id; })[0];
    if (actualizada) sincronizarEventoDeuda(actualizada);
  },
  "remove-deuda": function (el) {
    var id = el.getAttribute("data-id");
    var d = state.deudas.filter(function (d) { return d.id === id; })[0];
    if (!d) return;
    var tieneHistorial = d.historial && d.historial.length;
    var msg = '¿Eliminar la deuda "' + d.concepto + '"?\n\nNo se puede deshacer.' +
      (tieneHistorial ? " Se pierde su historial de " + d.historial.length + (d.historial.length === 1 ? " pago registrado" : " pagos registrados") + " (los movimientos ya creados en Finanzas NO se eliminan)." : "");
    if (!window.confirm(msg)) return;
    state.deudas = state.deudas.filter(function (d) { return d.id !== id; });
    persist("deudas"); notify();
    if (d.calendarEventId) eliminarEvento(d.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar de la deuda", e); });
  },
  // "Pagar": un solo botón que registra el pago de la cuota programada
  // siguiente (o el saldo completo si es pago único). Crea el movimiento de
  // gasto en Finanzas y deja una línea en el historial de la deuda — ya no
  // hay un botón de "estado" que se pueda tocar por accidente sin dejar
  // rastro de cuándo ni cuánto se pagó.
  "pagar-deuda": function (el) {
    var id = el.getAttribute("data-id");
    var deuda = state.deudas.filter(function (d) { return d.id === id; })[0];
    if (!deuda) return;
    var cuotas = num(deuda.cuotas) || 1;
    var pagadas = Math.min(num(deuda.cuotasPagadas) || 0, cuotas);
    var esUltima = pagadas + 1 >= cuotas;
    var valor = esUltima ? calcDeudaSaldoPendiente(deuda) : calcDeudaValorCuota(deuda);
    if (valor <= 0) return;
    var etiqueta = cuotas > 1 ? ("cuota " + (pagadas + 1) + " de " + cuotas) : "el saldo completo";
    if (!window.confirm('¿Registrar el pago de ' + etiqueta + " (" + fmt(valor) + ') de "' + deuda.concepto + '"?\n\nEsto crea un movimiento de gasto en Finanzas.' + (esUltima ? " Al quedar saldada, la deuda se mueve al historial." : ""))) return;
    var nuevasPagadas = pagadas + 1;
    var fechaPago = todayStr();
    state.tx.unshift({ id: uid(), tipo: "gasto", concepto: (cuotas > 1 ? "Cuota " + nuevasPagadas + "/" + cuotas + " — " : "Pago — ") + deuda.concepto, monto: valor, contraparte: deuda.contraparte, fecha: fechaPago, pedidoId: "", deudaId: deuda.id });
    if (nuevasPagadas >= cuotas) {
      // Deuda saldada por completo: sale de "deudas" y se mueve entera (no
      // solo un renglón de bitácora) al historial de deudas pagadas. Ya no
      // tiene sentido un recordatorio de vencimiento, así que el evento de
      // Calendar (si existía) se borra en vez de moverse al historial.
      var historial = (deuda.historial || []).concat([{ fecha: fechaPago, monto: valor }]);
      state.deudasHistorial = state.deudasHistorial.concat([Object.assign({}, deuda, {
        cuotasPagadas: nuevasPagadas, historial: historial, fechaCompletada: fechaPago, calendarEventId: ""
      })]);
      state.deudas = state.deudas.filter(function (d) { return d.id !== id; });
      persist("deudasHistorial");
      if (deuda.calendarEventId) eliminarEvento(deuda.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar de la deuda", e); });
    } else {
      state.deudas = state.deudas.map(function (d) {
        if (d.id !== id) return d;
        var historial = (d.historial || []).concat([{ fecha: fechaPago, monto: valor }]);
        return Object.assign({}, d, { cuotasPagadas: nuevasPagadas, historial: historial });
      });
      var actualizada = state.deudas.filter(function (d) { return d.id === id; })[0];
      if (actualizada) sincronizarEventoDeuda(actualizada);
    }
    persist("tx"); persist("deudas"); notify();
  },
  // Quita una deuda del historial de deudas pagadas (solo el registro; los
  // movimientos de gasto que ya se crearon en Finanzas NO se tocan).
  "remove-deuda-historial": function (el) {
    var id = el.getAttribute("data-id");
    var d = state.deudasHistorial.filter(function (d) { return d.id === id; })[0];
    if (!d) return;
    if (!window.confirm('¿Quitar "' + d.concepto + '" del historial de deudas?\n\nNo borra los movimientos de gasto ya creados en Finanzas.')) return;
    state.deudasHistorial = state.deudasHistorial.filter(function (d) { return d.id !== id; });
    persist("deudasHistorial"); notify();
  }
};
