import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, fmt, norm, val, exigirCampos } from "../core/utils.js";
import { clienteById, periodoKey, origenDeTx, proveedoresDeContactos } from "../core/calc.js";
import { renderHelp } from "../core/components.js";

var PERIODOS_TX = { todos: "Todo el histórico", mensual: "Este mes", quincenal: "Esta quincena", semanal: "Esta semana" };
var TIPOS_TX = { ingreso: "Ingreso", gasto: "Gasto", nomina: "Nómina", comision: "Comisión" };

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

function renderFormMovimiento() {
  var f = state.formTx;
  var datalist = '<datalist id="dl-personas">' +
    (state.config.nomina || []).map(function (e) { return '<option value="' + esc(e.nombre) + '">'; }).join("") +
    "</datalist>";

  return datalist + '<div class="card"><div class="section-title small">Registrar movimiento</div><div class="form-grid">' +
    '<div class="field"><label>Tipo</label><select data-form="tx" data-field="tipo">' +
    opt("ingreso", "Ingreso", f.tipo) + opt("gasto", "Gasto", f.tipo) + opt("nomina", "Nómina", f.tipo) +
    "</select></div>" +
    '<div class="field"><label>Concepto</label><input data-form="tx" data-field="concepto" value="' + esc(f.concepto) + '" placeholder="Ej. Tela, corte, cliente X" /></div>' +
    '<div class="field"><label>Monto</label><input type="number" data-form="tx" data-field="monto" value="' + esc(f.monto) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Persona / contraparte' + renderHelp("Quién está del otro lado del movimiento — no siempre es un cliente: puede ser un vendedor (comisión), un proveedor, un empleado (nómina) o quien sea que recibió/entregó ese dinero.") + '</label><input list="dl-personas" data-form="tx" data-field="contraparte" value="' + esc(f.contraparte) + '" placeholder="Opcional" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" data-form="tx" data-field="fecha" value="' + esc(f.fecha) + '" /></div>' +
    '<div class="field wide"><label>Pedido relacionado (categoriza y agrupa el movimiento)' + renderHelp("Vincula este movimiento a un pedido para poder agruparlo y encontrarlo luego buscando por N.º de OP, cédula, nombre de la producción o fecha.") + '</label><select data-form="tx" data-field="pedidoId">' +
    '<option value="">Sin pedido (movimiento suelto)</option>' +
    state.pedidos.map(function (p) { return '<option value="' + p.id + '" ' + (f.pedidoId === p.id ? "selected" : "") + '>' + esc(p.numeroOp || "OP-????") + " · " + esc(p.cliente) + " — " + esc(p.descripcion) + "</option>"; }).join("") +
    "</select></div>" +
    '<div class="field wide"><label class="mini-label" style="display:flex;align-items:center;gap:6px;font-weight:600;"><input type="checkbox" data-role="tx-es-insumo" /> 📦 Es compra de insumo' +
    renderHelp("Márcalo si este gasto es una compra REAL de insumo (tela, hilo, etc.) — así cuenta en \"de los cuales, insumos\" del reporte financiero de Resumen, aparte de los demás gastos. Es el segundo camino (junto con \"Registrar costo real\" en una cotización) para que un gasto de insumos deje de ser solo una estimación.") +
    "</label></div>" +
    '<div class="field"><label>Insumo (opcional)</label><select data-role="tx-insumo">' +
    '<option value="">Sin especificar</option>' +
    (state.catalogoInsumos || []).map(function (i) { return '<option value="' + esc(i.nombre) + '">' + esc(i.nombre) + "</option>"; }).join("") +
    "</select></div>" +
    '<div class="field"><label>Proveedor (opcional)</label><select data-role="tx-proveedor">' +
    '<option value="">Sin especificar</option>' +
    proveedoresDeContactos().map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") +
    "</select></div>" +
    // Cuánto se compró, no solo cuánto costó: es la columna "Cantidad" del
    // desglose de insumos del reporte (ver calcComprasInsumoRango).
    '<div class="field"><label>Cantidad comprada (opcional)</label><input type="number" data-role="tx-cantidad" placeholder="Ej. 12" /></div>' +
    '<div class="field"><label>Unidad (opcional)</label><input data-role="tx-unidad" placeholder="Ej. MT, UND" /></div>' +
    '<div class="field wide"><label>Cotización relacionada (opcional)</label><select data-form="tx" data-field="cotizacionId">' +
    '<option value="">Sin cotización</option>' +
    state.cotizaciones.map(function (c) { return '<option value="' + c.id + '" ' + (f.cotizacionId === c.id ? "selected" : "") + '>' + esc(c.descripcion) + " — " + esc(c.cliente) + "</option>"; }).join("") +
    "</select></div>" +
    '<button class="btn" data-action="add-tx">Agregar</button>' +
    "</div></div>";
}

function renderHistorial() {
  var html = '<div class="field" style="max-width:360px;margin-bottom:10px;"><input id="inp-buscar-tx" class="mini-input" style="width:100%" placeholder="Buscar por N.º OP, cédula, cliente, producción o fecha…" value="' + esc(state.buscarTx || "") + '" data-live-filter="buscarTx" /></div>';

  html += '<div class="filters">';
  [["todos", "Todos"], ["ingreso", "Ingresos"], ["gasto", "Gastos"], ["nomina", "Nómina"], ["comision", "Comisiones"]].forEach(function (c) {
    html += '<button class="chip ' + (state.filtroTx === c[0] ? "active" : "") + '" data-action="filtro-tx" data-val="' + c[0] + '">' + c[1] + "</button>";
  });
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
  var list = state.filtroTx === "todos" ? state.tx : state.tx.filter(function (t) { return t.tipo === state.filtroTx; });

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
  return '<div class="tx-row">' +
    "<span class=\"mobile-th\">Fecha</span><span style=\"font-family:'IBM Plex Mono',monospace;font-size:12px;\">" + esc(t.fecha) + "</span>" +
    '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) + "</span>" +
    '<span class="mobile-th">Persona</span><span style="color:var(--ink-soft);">' + esc(t.contraparte || "—") + "</span>" +
    '<span class="mobile-th">Tipo</span><span><span class="tag ' + t.tipo + '">' + t.tipo + "</span></span>" +
    '<span class="mobile-th">Monto</span><span class="amount ' + (t.tipo === "ingreso" ? "pos" : "neg") + '">' + (t.tipo === "ingreso" ? "+" : "-") + fmt(t.monto) + "</span>" +
    '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    (origen ? '<button class="btn ghost small" data-action="ver-origen-tx" data-id="' + t.id + '" title="Ir a ' + esc(origen.label) + '">↗ Origen</button>' : "") +
    '<button class="btn ghost small" data-action="editar-tx" data-id="' + t.id + '">Editar</button>' +
    '<button class="btn danger small" data-action="remove-tx" data-id="' + t.id + '" title="Se mueve a la papelera, no se borra para siempre">🗑</button>' +
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
  "add-tx": function (el) {
    var f = state.formTx;
    if (!exigirCampos([["Concepto", f.concepto], ["Monto", f.monto]])) return;
    var card = el.closest(".card");
    var chkInsumo = card ? card.querySelector('[data-role="tx-es-insumo"]') : null;
    var esInsumo = !!(chkInsumo && chkInsumo.checked);
    state.tx.unshift({
      id: uid(), tipo: f.tipo, concepto: f.concepto, monto: num(f.monto), contraparte: f.contraparte, fecha: f.fecha,
      pedidoId: f.pedidoId || "", cotizacionId: f.cotizacionId || "", esInsumo: esInsumo ? "1" : "",
      insumoNombre: card ? val(card, "tx-insumo") : "", proveedorId: card ? val(card, "tx-proveedor") : "",
      cantidad: card ? val(card, "tx-cantidad") : "", unidad: card ? val(card, "tx-unidad") : ""
    });
    state.formTx = { tipo: "ingreso", concepto: "", monto: "", contraparte: "", fecha: todayStr(), pedidoId: "", cotizacionId: "" };
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
  "remove-tx": function (el) {
    var id = el.getAttribute("data-id");
    var item = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!item) return;
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
