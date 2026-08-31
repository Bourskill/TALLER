import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, fmt, norm, exigirCampos } from "../core/utils.js";
import { clienteById, periodoKey, origenDeTx, origenSistemaDeTx, origenSistemaHuerfano, proveedoresDeContactos } from "../core/calc.js";
import { renderHelp, renderBuscador, renderComboUnidad } from "../core/components.js";

var PERIODOS_TX = { todos: "Todo el histórico", mensual: "Este mes", quincenal: "Esta quincena", semanal: "Esta semana" };
var TIPOS_TX = { ingreso: "Ingreso", gasto: "Gasto", nomina: "Nómina", comision: "Comisión" };
// Los tres tipos que se pueden CREAR a mano. "comision" no está: esas las
// genera la app al marcar pagada la comisión de un vendedor, y crearlas
// sueltas duplicaría el pago (ver origenSistemaDeTx en core/calc.js).
var TIPOS_NUEVO_TX = [["ingreso", "↓ Ingreso"], ["gasto", "↑ Gasto"], ["nomina", "👤 Nómina"]];
var TIPO_SUSTANTIVO = { ingreso: "ingreso", gasto: "gasto", nomina: "pago de nómina" };

// Dos pestañas (mismo patrón "gsheet-tabs" que Cotizaciones/Pedidos/
// Clientes/Deudas): "Registrar movimiento" es solo el formulario de alta, y
// "Historial" es la lista agrupada con filtros/búsqueda — antes vivían
// siempre juntos, apilados, así que el formulario ocupaba espacio arriba de
// todo aunque lo único que quisieras hacer fuera revisar movimientos viejos.
export function render() {
  var vista = state.finanzasVista || "nuevo";
  var html = renderTabsFinanzas(vista);
  if (vista === "historial") {
    html += state.filtroTxVista === "papelera" ? renderPapelera() : renderHistorial();
  } else {
    html += renderFormMovimiento();
  }
  return html;
}

function renderTabsFinanzas(vista) {
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nuevo" ? "active" : "") + '" data-action="finanzas-vista" data-val="nuevo">+ Registrar movimiento</button>' +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="finanzas-vista" data-val="historial">Historial' + (state.tx.length ? " (" + state.tx.length + ")" : "") + "</button>" +
    "</div>";
}

// El formulario de un movimiento, en TRES bloques con jerarquía propia en vez
// de una grilla plana de diez campos iguales. Antes todos pesaban lo mismo —el
// monto y "unidad (opcional)" se veían idénticos— y los cuatro campos de
// compra de insumo estaban siempre ahí aunque casi nunca aplicaran, que era la
// mitad del ruido.
//
//  1. QUÉ PASÓ: el tipo como control segmentado (se ven las tres opciones de
//     una, como el tipo de pedido) + concepto, monto y fecha. El monto es el
//     campo grande: es el dato del que se trata todo esto.
//  2. CON QUIÉN Y POR QUÉ: contraparte y a qué pedido/cotización se asocia.
//  3. COMPRA DE INSUMO: recogido detrás de una casilla. Solo al marcarla
//     aparecen insumo, proveedor, cantidad y unidad.
function renderFormMovimiento() {
  var f = state.formTx;
  var datalist = '<datalist id="dl-personas">' +
    (state.config.nomina || []).map(function (e) { return '<option value="' + esc(e.nombre) + '">'; }).join("") +
    "</datalist>";

  var html = datalist + '<div class="card tx-form">';

  // ---- 1. Qué pasó ----
  html += '<div class="section-title small" style="margin-top:0;">Registrar movimiento' +
    renderHelp("Un movimiento registrado acá es dinero que YA se movió. Lo que todavía no se ha pagado vive en Pendientes; lo que falta por cobrar, en el saldo del pedido.") +
    "</div>";

  html += '<div class="tx-form-tipo">' +
    TIPOS_NUEVO_TX.map(function (t) {
      return '<button class="segmented-opcion ' + (f.tipo === t[0] ? "active" : "") + '" data-action="set-tx-tipo" data-val="' + t[0] + '">' + t[1] + "</button>";
    }).join("") +
    "</div>";

  html += '<div class="tx-form-principal">' +
    '<div class="field tx-form-monto"><label>Monto</label>' +
    '<input type="number" inputmode="numeric" data-form="tx" data-field="monto" value="' + esc(f.monto) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Concepto</label>' +
    '<input data-form="tx" data-field="concepto" value="' + esc(f.concepto) + '" placeholder="Ej. Tela para el pedido de San Jorge" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" data-form="tx" data-field="fecha" value="' + esc(f.fecha) + '" /></div>' +
    "</div>";

  // ---- 2. Con quién y a qué se asocia ----
  html += '<hr class="stitch" />';
  html += '<div class="cot-col-title" style="margin-top:0;">Con quién y a qué se asocia</div>';
  html += '<div class="form-grid">' +
    '<div class="field"><label>Persona / contraparte' +
    renderHelp("Quién está del otro lado del movimiento — no siempre es un cliente: puede ser un vendedor (comisión), un proveedor, un empleado (nómina) o quien sea que recibió/entregó ese dinero.") +
    '</label><input list="dl-personas" data-form="tx" data-field="contraparte" value="' + esc(f.contraparte) + '" placeholder="Opcional" /></div>' +
    '<div class="field"><label>Pedido relacionado' +
    renderHelp("Vincula este movimiento a un pedido para agruparlo y encontrarlo luego buscando por N.º de OP, cédula, cliente o fecha.") +
    '</label><select data-form="tx" data-field="pedidoId">' +
    '<option value="">Sin pedido (movimiento suelto)</option>' +
    state.pedidos.map(function (p) { return '<option value="' + p.id + '" ' + (f.pedidoId === p.id ? "selected" : "") + ">" + esc(p.numeroOp || "OP-????") + " · " + esc(p.cliente) + "</option>"; }).join("") +
    "</select></div>" +
    '<div class="field"><label>Cotización relacionada</label><select data-form="tx" data-field="cotizacionId">' +
    '<option value="">Sin cotización</option>' +
    state.cotizaciones.map(function (c) { return '<option value="' + c.id + '" ' + (f.cotizacionId === c.id ? "selected" : "") + ">" + esc(c.descripcion) + " — " + esc(c.cliente) + "</option>"; }).join("") +
    "</select></div>" +
    "</div>";

  // ---- 3. Compra de insumo (recogido) ----
  html += '<hr class="stitch" />';
  html += '<label class="toggle-card">' +
    '<input type="checkbox" ' + (f.esInsumo ? "checked" : "") + ' data-action-change="toggle-tx-insumo" /> ' +
    "<span><b>📦 Es una compra de insumo</b>" +
    '<small>Márcalo si este gasto es material real (tela, hilo, botones). Así cuenta aparte en "Gasto en insumos" del reporte.</small></span>' +
    "</label>";
  if (f.esInsumo) {
    html += '<div class="form-grid" style="margin-top:var(--sp-3);">' +
      '<div class="field"><label>Insumo</label><select data-form="tx" data-field="insumoNombre">' +
      '<option value="">Sin especificar</option>' +
      (state.catalogoInsumos || []).map(function (i) { return '<option value="' + esc(i.nombre) + '" ' + (f.insumoNombre === i.nombre ? "selected" : "") + ">" + esc(i.nombre) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field"><label>Proveedor</label><select data-form="tx" data-field="proveedorId">' +
      '<option value="">Sin especificar</option>' +
      proveedoresDeContactos().map(function (p) { return '<option value="' + p.id + '" ' + (f.proveedorId === p.id ? "selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field"><label>Cantidad comprada</label><input type="number" data-form="tx" data-field="cantidad" value="' + esc(f.cantidad) + '" placeholder="Ej. 12" /></div>' +
      '<div class="field"><label>Unidad</label><span class="insumo-unidad-cell"><input class="insumo-unidad" id="tx-unidad" data-form="tx" data-field="unidad" value="' + esc(f.unidad) + '" placeholder="MT, UND…" />' +
      renderComboUnidad({ id: "tx-unidad", clave: "tx-unidad", abierto: state.comboUnidadAbierto === "tx-unidad" }) + "</span></div>" +
      "</div>";
  }

  html += '<div class="pedido-actions" style="margin-top:var(--sp-4);">' +
    '<button class="btn" data-action="add-tx">Registrar ' + (TIPO_SUSTANTIVO[f.tipo] || "movimiento") + "</button></div>";
  html += "</div>";
  return html;
}

function renderHistorial() {
  var html = '<div style="margin-bottom:10px;">' + renderBuscador({
    id: "inp-buscar-tx",
    filtro: "buscarTx",
    valor: state.buscarTx,
    ancho: 360,
    placeholder: "Buscar por N.º OP, cédula, cliente, producción o fecha…"
  }) + "</div>";

  html += '<div class="filters">';
  [["todos", "Todos"], ["ingreso", "Ingresos"], ["gasto", "Gastos"], ["nomina", "Nómina"], ["comision", "Comisiones"]].forEach(function (c) {
    html += '<button class="chip ' + (state.filtroTx === c[0] ? "active" : "") + '" data-action="filtro-tx" data-val="' + c[0] + '">' + c[1] + "</button>";
  });
  // Atajo para encontrar los movimientos que quedaron sueltos porque se borró
  // el pedido o la cotización que los generó. Solo aparece si hay alguno: no
  // tiene sentido ofrecer un filtro que siempre daría vacío.
  var sueltos = state.tx.filter(function (t) { return !!origenSistemaHuerfano(t); }).length;
  if (sueltos) {
    html += '<button class="chip ' + (state.filtroTx === "huerfanos" ? "active" : "") + '" data-action="filtro-tx" data-val="huerfanos" ' +
      'title="Movimientos que generó un pedido o una cotización que ya se eliminó. Quedaron sueltos: revísalos y borra los que no correspondan.">' +
      "⚠ Sueltos (" + sueltos + ")</button>";
  }
  html += '<select class="mini-input" style="width:auto;" data-action-change="set-tx-periodo">' +
    Object.keys(PERIODOS_TX).map(function (k) { return '<option value="' + k + '" ' + (state.filtroTxPeriodo === k ? "selected" : "") + '>' + PERIODOS_TX[k] + "</option>"; }).join("") +
    "</select>" +
    renderHelp("Filtra los movimientos que caen dentro del periodo actual (según el periodo de pago configurado), igual que el cálculo de nómina pendiente.") +
    '<button class="btn ghost small" style="margin-left:auto;" data-action="ver-papelera">🗑 Papelera' + (state.txPapelera.length ? " (" + state.txPapelera.length + ")" : "") + "</button>" +
    "</div>";

  var filtered = filtrarTx();

  var conPedido = {}, sinPedido = [];
  filtered.forEach(function (t) {
    if (t.pedidoId) { (conPedido[t.pedidoId] = conPedido[t.pedidoId] || []).push(t); }
    else sinPedido.push(t);
  });

  if (filtered.length === 0) {
    html += '<div class="card"><div class="empty">Aún no hay movimientos <b>que coincidan con estos filtros</b>.</div></div>';
    return html;
  }

  // Los grupos se ordenan por su movimiento MÁS RECIENTE (no por el primero
  // de la lista): un pedido viejo al que hoy se le registró un abono sube al
  // tope, que es donde uno lo busca. Antes se miraba txs[0], que solo era el
  // más reciente por casualidad —porque state.tx guarda lo último agregado
  // primero— y dejaba de serlo apenas alguien registraba un movimiento con
  // fecha atrasada.
  var gruposOrdenados = Object.keys(conPedido).map(function (pid) {
    var pedido = state.pedidos.filter(function (p) { return p.id === pid; })[0];
    var txs = conPedido[pid].slice().sort(compararTxRecienteFirst);
    return { pedido: pedido, pid: pid, txs: txs, fechaTope: txs[0] ? txs[0].fecha : "" };
  }).sort(function (a, b) {
    return String(b.fechaTope).localeCompare(String(a.fechaTope));
  });
  sinPedido.sort(compararTxRecienteFirst);

  // Cada grupo agrupa TODOS los movimientos de un mismo pedido (abonos,
  // sobrecostos, comisiones, estimados...) en un solo panel, con el total
  // neto de ese pedido a la vista.
  gruposOrdenados.forEach(function (g) {
    var cliente = g.pedido && g.pedido.clienteId ? clienteById(g.pedido.clienteId) : null;
    var neto = g.txs.reduce(function (a, t) { return t.tipo === "ingreso" ? a + num(t.monto) : a - num(t.monto); }, 0);
    html += '<div class="card" style="margin-bottom:14px;">';
    html += '<div class="cot-col-title" style="margin-top:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;">' + esc(g.pedido ? g.pedido.numeroOp : "OP-????") + '</span>' +
      '<span>' + esc(g.pedido ? g.pedido.cliente : "Pedido eliminado") + (g.pedido ? " — " + esc(g.pedido.descripcion) : "") + "</span>" +
      (cliente && cliente.cedula ? '<span class="tag" style="background:var(--surface-3);">CC/NIT ' + esc(cliente.cedula) + "</span>" : "") +
      '<span class="amount ' + (neto >= 0 ? "pos" : "neg") + '" style="margin-left:auto;">Neto: ' + (neto >= 0 ? "+" : "-") + fmt(Math.abs(neto)) + "</span>" +
      "</div>";
    html += renderTablaTx(g.txs);
    html += "</div>";
  });

  if (sinPedido.length > 0) {
    html += '<div class="card"><div class="cot-col-title" style="margin-top:0;">Movimientos sueltos (sin pedido)</div>' + renderTablaTx(sinPedido) + "</div>";
  }

  return html;
}

// Orden por defecto de CUALQUIER lista de movimientos: del más reciente al
// más viejo por fecha. El desempate usa la posición en state.tx (que guarda
// lo último registrado primero), así dos movimientos del mismo día quedan con
// el recién cargado arriba en vez de en un orden arbitrario que cambia entre
// renders.
function compararTxRecienteFirst(a, b) {
  var porFecha = String(b.fecha || "").localeCompare(String(a.fecha || ""));
  if (porFecha !== 0) return porFecha;
  return state.tx.indexOf(a) - state.tx.indexOf(b);
}

function filtrarTx() {
  var list = state.filtroTx === "todos" ? state.tx
    : state.filtroTx === "huerfanos" ? state.tx.filter(function (t) { return !!origenSistemaHuerfano(t); })
      : state.tx.filter(function (t) { return t.tipo === state.filtroTx; });

  var periodo = state.filtroTxPeriodo || "todos";
  if (periodo !== "todos") {
    var miPeriodo = periodoKey(todayStr(), periodo);
    list = list.filter(function (t) { return periodoKey(t.fecha, periodo) === miPeriodo; });
  }

  var q = norm(state.buscarTx || "").trim();
  if (q) {
    list = list.filter(function (t) {
      var pedido = t.pedidoId ? state.pedidos.filter(function (p) { return p.id === t.pedidoId; })[0] : null;
      var cliente = pedido && pedido.clienteId ? clienteById(pedido.clienteId) : null;
      var cedula = cliente ? cliente.cedula : "";
      var haystack = [t.concepto, t.contraparte, t.fecha, pedido ? pedido.numeroOp : "", pedido ? pedido.cliente : "", pedido ? pedido.descripcion : "", cedula]
        .map(norm).join(" | ");
      return haystack.indexOf(q) >= 0;
    });
  }
  return list;
}

function renderTablaTx(lista) {
  var html = '<div class="tx-row head"><span>Fecha</span><span>Concepto</span><span>Persona</span><span>Tipo</span><span>Monto</span><span></span></div>';
  lista.forEach(function (t) {
    html += t.id === state.txEditando ? renderFilaEdicion(t) : renderFila(t);
  });
  return html;
}

function renderFila(t) {
  var origen = origenDeTx(t);
  // Movimiento generado por la app: el botón de borrar queda igual de visible
  // (nada se esconde) pero se anuncia desde el título que hay que deshacerlo
  // en su origen — al pulsarlo se explica dónde (ver "remove-tx").
  var sistema = origenSistemaDeTx(t);
  // Generado por la app pero su origen ya no existe (se borró el pedido o la
  // cotización). Se puede borrar —no hay nada con qué descuadrar— y se avisa
  // por qué quedó suelto, para que no parezca basura inexplicable.
  var huerfano = sistema ? null : origenSistemaHuerfano(t);
  var tituloBorrar = sistema
    ? "Este movimiento lo generó la app (" + sistema.que + ") — se deshace en su origen, no acá"
    : (huerfano
      ? "El registro que lo generó (" + huerfano.que + ") ya no existe: este movimiento quedó suelto y sí se puede borrar"
      : "Se mueve a la papelera, no se borra para siempre");
  return '<div class="tx-row">' +
    "<span class=\"mobile-th\">Fecha</span><span style=\"font-family:'IBM Plex Mono',monospace;font-size:12px;\">" + esc(t.fecha) + "</span>" +
    '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) +
    (huerfano ? ' <span class="tag" style="background:var(--warning-soft);color:var(--warning-ink);" title="Se generó desde ' + esc(huerfano.que) + ', pero ese registro ya se eliminó. Este movimiento quedó suelto: revísalo y bórralo si no corresponde.">origen eliminado</span>' : "") +
    "</span>" +
    '<span class="mobile-th">Persona</span><span style="color:var(--ink-soft);">' + esc(t.contraparte || "—") + "</span>" +
    '<span class="mobile-th">Tipo</span><span><span class="tag ' + t.tipo + '">' + t.tipo + "</span></span>" +
    '<span class="mobile-th">Monto</span><span class="amount ' + (t.tipo === "ingreso" ? "pos" : "neg") + '">' + (t.tipo === "ingreso" ? "+" : "-") + fmt(t.monto) + "</span>" +
    '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    (origen ? '<button class="btn ghost small" data-action="ver-origen-tx" data-id="' + t.id + '" title="Ir a ' + esc(origen.label) + '">↗ Origen</button>' : "") +
    '<button class="btn ghost small" data-action="editar-tx" data-id="' + t.id + '">Editar</button>' +
    '<button class="btn ' + (sistema ? "ghost" : "danger") + ' small" data-action="remove-tx" data-id="' + t.id + '" title="' + esc(tituloBorrar) + '">' + (sistema ? "🔒" : "🗑") + "</button>" +
    "</span>" +
    "</div>";
}

// Fila en modo edición: reemplaza cada celda por un input/select editable.
// Se guarda con "guardar-tx-edit" (lee estos mismos campos por data-role) o
// se cancela con "cancelar-edicion-tx", sin perder los demás movimientos.
//
// Si el movimiento tiene un origen real (abono, comisión, pago de gasto
// fijo/deuda...), el tipo y el monto quedan de solo lectura: cambiarlos a
// mano desincroniza la plata del taller de lo que ese registro dice que
// pasó de verdad (ej. "cambiar una comisión a ingreso" invertiría su signo
// en la caja sin que el pedido se entere). Solo fecha/concepto/persona
// siguen editables ahí — para un movimiento cargado a mano (sin origen)
// todo sigue editable como siempre.
function renderFilaEdicion(t) {
  var origen = origenDeTx(t);
  var tipoCell = '<span class="mobile-th">Tipo</span>' + (origen
    ? '<span><span class="tag ' + t.tipo + '" title="No editable: vinculado a ' + esc(origen.label) + '">' + TIPOS_TX[t.tipo] + "</span></span>"
    : '<span><select class="mini-input" style="width:100%" data-role="edit-tipo">' +
      Object.keys(TIPOS_TX).map(function (k) { return opt(k, TIPOS_TX[k], t.tipo); }).join("") +
      "</select></span>");
  var montoCell = '<span class="mobile-th">Monto</span>' + (origen
    ? '<span class="amount" title="No editable: vinculado a ' + esc(origen.label) + '">' + fmt(t.monto) + "</span>"
    : '<span><input type="number" class="mini-input" style="width:100%" data-role="edit-monto" value="' + esc(t.monto) + '" /></span>');
  return '<div class="tx-row" style="background:var(--surface-2);" data-tx-edit-row="' + t.id + '">' +
    '<span class="mobile-th">Fecha</span><span><input type="date" class="mini-input" style="width:100%" data-role="edit-fecha" value="' + esc(t.fecha) + '" /></span>' +
    '<span class="mobile-th">Concepto</span><span><input class="mini-input" style="width:100%" data-role="edit-concepto" value="' + esc(t.concepto) + '" /></span>' +
    '<span class="mobile-th">Persona</span><span><input class="mini-input" style="width:100%" data-role="edit-contraparte" value="' + esc(t.contraparte || "") + '" /></span>' +
    tipoCell + montoCell +
    '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    '<button class="btn small" data-action="guardar-tx-edit" data-id="' + t.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-tx">Cancelar</button>' +
    "</span>" +
    "</div>";
}

function renderPapelera() {
  var html = '<div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
    '<div class="section-title small" style="margin:0;">Papelera de movimientos' + renderHelp("Los movimientos eliminados quedan aquí (no se borran para siempre) para poder restaurarlos si fue un error.") + "</div>" +
    '<button class="btn ghost small" data-action="ver-papelera">← Volver a movimientos</button>' +
    "</div>";

  if (!state.txPapelera.length) {
    html += '<div class="card"><div class="empty">La papelera está vacía.</div></div>';
    return html;
  }

  html += '<div class="card">';
  html += '<div class="tx-row head"><span>Fecha</span><span>Concepto</span><span>Persona</span><span>Tipo</span><span>Monto</span><span></span></div>';
  // Mismo orden que el historial (más reciente arriba); acá el desempate es
  // por fecha de eliminación, que es lo último que pasó con ese movimiento.
  state.txPapelera.slice().sort(function (a, b) {
    var porFecha = String(b.fecha || "").localeCompare(String(a.fecha || ""));
    return porFecha !== 0 ? porFecha : String(b.eliminadoEl || "").localeCompare(String(a.eliminadoEl || ""));
  }).forEach(function (t) {
    html += '<div class="tx-row">' +
      "<span class=\"mobile-th\">Fecha</span><span style=\"font-family:'IBM Plex Mono',monospace;font-size:12px;\">" + esc(t.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) + "</span>" +
      '<span class="mobile-th">Persona</span><span style="color:var(--ink-soft);">' + esc(t.contraparte || "—") + "</span>" +
      '<span class="mobile-th">Tipo</span><span><span class="tag ' + t.tipo + '">' + t.tipo + "</span></span>" +
      '<span class="mobile-th">Monto</span><span class="amount ' + (t.tipo === "ingreso" ? "pos" : "neg") + '">' + (t.tipo === "ingreso" ? "+" : "-") + fmt(t.monto) + "</span>" +
      '<span style="display:flex;align-items:center;gap:6px;">' +
      '<button class="btn ghost small" data-action="restaurar-tx" data-id="' + t.id + '">Restaurar</button>' +
      '<button class="btn danger small" data-action="eliminar-tx-definitivo" data-id="' + t.id + '">Eliminar definitivo</button>' +
      "</span>" +
      "</div>";
  });
  html += "</div>";
  return html;
}

export var actions = {
  "filtro-tx": function (el) {
    state.filtroTx = el.getAttribute("data-val");
    notify();
  },
  "set-tx-periodo": function (el) {
    state.filtroTxPeriodo = el.value;
    notify();
  },
  "ver-papelera": function () {
    state.filtroTxVista = state.filtroTxVista === "papelera" ? "activos" : "papelera";
    notify();
  },
  "finanzas-vista": function (el) {
    state.finanzasVista = el.getAttribute("data-val");
    notify();
  },
  // El tipo redibuja el formulario (cambia el texto del botón y el sentido de
  // lo que se está registrando), por eso es una acción y no un data-form.
  "set-tx-tipo": function (el) {
    state.formTx.tipo = el.getAttribute("data-val");
    notify();
  },
  "toggle-tx-insumo": function (el) {
    state.formTx.esInsumo = !!el.checked;
    notify();
  },
  "add-tx": function () {
    var f = state.formTx;
    if (!exigirCampos([["Concepto", f.concepto], ["Monto", f.monto]])) return;
    // Todo sale del borrador (state.formTx), no de leer el DOM: es lo que
    // permite que los campos de insumo existan solo cuando la casilla está
    // marcada sin que el guardado dependa de que estén en pantalla.
    state.tx.unshift({
      id: uid(), tipo: f.tipo, concepto: f.concepto, monto: num(f.monto), contraparte: f.contraparte, fecha: f.fecha,
      pedidoId: f.pedidoId || "", cotizacionId: f.cotizacionId || "",
      esInsumo: f.esInsumo ? "1" : "",
      insumoNombre: f.esInsumo ? (f.insumoNombre || "") : "",
      proveedorId: f.esInsumo ? (f.proveedorId || "") : "",
      cantidad: f.esInsumo ? (f.cantidad || "") : "",
      unidad: f.esInsumo ? (f.unidad || "") : ""
    });
    state.formTx = { tipo: f.tipo, concepto: "", monto: "", contraparte: "", fecha: todayStr(), pedidoId: "", cotizacionId: "", esInsumo: false, insumoNombre: "", proveedorId: "", cantidad: "", unidad: "" };
    state.finanzasVista = "historial"; // aterriza viendo el movimiento recién creado, no el formulario en blanco
    persist("tx"); notify();
  },
  "editar-tx": function (el) {
    state.txEditando = el.getAttribute("data-id");
    notify();
  },
  "cancelar-edicion-tx": function () {
    state.txEditando = "";
    notify();
  },
  "guardar-tx-edit": function (el) {
    var id = el.getAttribute("data-id");
    var fila = el.closest('[data-tx-edit-row]');
    if (!fila) return;
    var original = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!original) return;
    // null (no "") cuando el campo no existe en el DOM — pasa con tipo/monto
    // en movimientos con origen, que quedan de solo lectura (ver
    // renderFilaEdicion). Sin este null, num("") = 0 tumbaba el guardado
    // completo (incluida la fecha/concepto, que sí eran editables) apenas
    // se ocultaba el input de monto.
    var g = function (role) { var i = fila.querySelector('[data-role="' + role + '"]'); return i ? i.value : null; };
    var concepto = g("edit-concepto");
    if (concepto === null) concepto = original.concepto;
    if (!concepto) return;
    var montoRaw = g("edit-monto");
    var monto = montoRaw === null ? num(original.monto) : num(montoRaw);
    if (monto <= 0) return;
    var contraparteRaw = g("edit-contraparte");
    state.tx = state.tx.map(function (t) {
      if (t.id !== id) return t;
      return Object.assign({}, t, {
        fecha: g("edit-fecha") || t.fecha,
        concepto: concepto,
        contraparte: contraparteRaw === null ? t.contraparte : contraparteRaw,
        tipo: g("edit-tipo") || t.tipo,
        monto: monto
      });
    });
    state.txEditando = "";
    persist("tx"); notify();
  },
  // Lleva a la pestaña del registro real detrás de un movimiento (pedido,
  // cotización, gasto fijo o deuda) y, si tiene un anchor identificable en
  // el DOM, hace scroll hasta ahí — mismo patrón que
  // "ver-cotizacion-relacionada" en pedidos.js.
  "ver-origen-tx": function (el) {
    var id = el.getAttribute("data-id");
    var t = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!t) return;
    var origen = origenDeTx(t);
    if (!origen) return;
    var TAB_POR_ORIGEN = { pedido: "pedidos", cotizacion: "cotizaciones", gastoFijo: "pendientes", deuda: "pendientes" };
    var ATTR_POR_ORIGEN = { pedido: "data-pedido-id", gastoFijo: "data-gasto-fijo-id", deuda: "data-deuda-id" };
    state.tab = TAB_POR_ORIGEN[origen.tipo] || state.tab;
    state.sidebarMobileOpen = false;
    // Si el pedido de origen está en la vista normal pero la papelera de
    // Pedidos había quedado activa, sin esto quedaría "escondido" detrás de
    // esa vista al llegar — mismo reset que ya hace la acción "tab" genérica.
    state.filtroPedidosVista = "activos";
    // BUG: sin esto, un pedido de origen aterrizaba en la pestaña "+ Nuevo
    // pedido" (formulario en blanco) en vez de "Historial", que es donde
    // vive la tarjeta real — el botón "parecía" no llevar a ningún lado.
    // pedidosVista por defecto es "nueva" (ver DEFAULT en store.js), así que
    // hay que forzarlo a "historial" para que la tarjeta exista en el DOM.
    if (origen.tipo === "pedido") state.pedidosVista = "historial";
    // Cotizaciones no tiene un anchor para hacer scroll (Historial ya no
    // muestra más que tarjetas chicas) — en su lugar, abre el detalle
    // completo directo, igual que "Ver cotización relacionada" en Pedidos.
    if (origen.tipo === "cotizacion") {
      state.cotizacionEditando = origen.id;
      state.cotizacionesVista = "nueva";
    }
    notify();
    var attr = ATTR_POR_ORIGEN[origen.tipo];
    if (attr) {
      setTimeout(function () {
        var card = document.querySelector('[' + attr + '="' + origen.id + '"]');
        if (!card) return;
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        // Destello (2 titileos) para identificar la tarjeta entre varias —
        // ver @keyframes destello-pedido en css/pedidos.css.
        card.classList.add("destello");
      }, 60);
    }
  },
  // "Eliminar" ya no borra para siempre: mueve el movimiento a la papelera,
  // de donde se puede restaurar si fue un error.
  //
  // Los movimientos que GENERÓ la app (un abono, una comisión, una cuota de
  // deuda, un gasto fijo, una venta de consignación, una compra) no se pueden
  // borrar desde acá: son el reflejo de un hecho que vive en otra pantalla, y
  // borrar solo este lado dejaba al pedido diciendo que ya cobró mientras la
  // plata desaparecía de la caja. Por el mismo motivo su tipo y monto ya eran
  // de solo lectura al editar (ver renderFilaEdicion) — esto cierra el mismo
  // hueco por el lado del borrado, y dice exactamente dónde revertirlo bien.
  "remove-tx": function (el) {
    var id = el.getAttribute("data-id");
    var item = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!item) return;
    var sistema = origenSistemaDeTx(item);
    if (sistema) {
      window.alert("Este movimiento no se borra desde Finanzas: es " + sistema.que + ", y ese registro todavía existe.\n\n" +
        "Si lo borraras solo acá, la plata saldría de la caja pero el registro de origen seguiría diciendo que se pagó (o se cobró) — y las dos pantallas quedarían diciendo cosas distintas.\n\n" +
        "Para deshacerlo de verdad:\n" + sistema.donde + "\n\n" +
        "Al hacerlo, este movimiento se retira solo.");
      return;
    }
    state.tx = state.tx.filter(function (t) { return t.id !== id; });
    state.txPapelera.unshift(Object.assign({}, item, { eliminadoEl: todayStr() }));
    persist("tx"); persist("txPapelera"); notify();
  },
  "restaurar-tx": function (el) {
    var id = el.getAttribute("data-id");
    var item = state.txPapelera.filter(function (t) { return t.id === id; })[0];
    if (!item) return;
    state.txPapelera = state.txPapelera.filter(function (t) { return t.id !== id; });
    var restaurado = Object.assign({}, item);
    delete restaurado.eliminadoEl;
    // Estas marcas solo sirven para devolverlo junto al pedido/cotización que
    // se lo llevó; restaurado a mano, ya no aplican.
    delete restaurado.eliminadoConPedido;
    delete restaurado.eliminadoConCotizacion;
    state.tx.unshift(restaurado);
    persist("tx"); persist("txPapelera"); notify();
  },
  "eliminar-tx-definitivo": function (el) {
    var id = el.getAttribute("data-id");
    if (!window.confirm("Esto elimina el movimiento para siempre y no se puede deshacer. ¿Continuar?")) return;
    state.txPapelera = state.txPapelera.filter(function (t) { return t.id !== id; });
    persist("txPapelera"); notify();
  }
};
