import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, generarNumeroOp, codigoPublico } from "../core/utils.js";
import { ESTADOS, ESTADO_LABEL, ESTADOS_DEFAULT } from "../core/constants.js";
import { clienteById, calcComisionValor, estadosDefDe, estadoLabelDe } from "../core/calc.js";
import { fmt, norm } from "../core/utils.js";
import { renderClienteCombo, renderHelp } from "../core/components.js";
import { generarPDFPedido, generarPDFRecibo, generarPDFFactura } from "../core/pdf.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { sincronizarEvento, eliminarEvento, eventoUnDia } from "../core/calendar.js";
import { getSession } from "../core/auth.js";

// Todos los números de OP usados, activos Y en la papelera — para que un
// pedido restaurado o uno nuevo nunca choque con uno que ya existió.
export function todosNumerosOp() {
  return state.pedidos.map(function (p) { return p.numeroOp; })
    .concat(state.pedidosPapelera.map(function (p) { return p.numeroOp; }));
}

export function render() {
  if (state.filtroPedidosVista === "papelera") return renderPapelera();

  var f = state.formPedido;
  var costoNum = num(f.costo), totalNum = num(f.total);
  var gananciaHint = costoNum > 0 && totalNum > 0
    ? ('<div class="section-sub" style="margin:4px 0 0;">Ganancia estimada: <b style="color:' + (totalNum - costoNum >= 0 ? "var(--success-ink)" : "var(--danger-ink)") + ';">' + fmt(totalNum - costoNum) + " (" + ((totalNum - costoNum) / totalNum * 100).toFixed(1) + "%)</b></div>")
    : "";
  var html = '<div class="card"><div class="section-title small">Nuevo pedido rápido' +
    renderHelp("Para lo del día a día que no necesita pasar por una cotización completa: stock, cosas sencillas, sin personalización. Si el pedido escala y necesitas cotizar insumos y márgenes en detalle, créala aparte en Cotizaciones y conviértela en pedido — sus valores reemplazan a los de aquí.") +
    "</div>";
  html += '<div class="section-sub" style="margin:0 0 6px;">Datos básicos</div><div class="form-grid">' +
    renderClienteCombo("pedido", "pedido-cliente-nombre", f) +
    '<div class="field"><label>Origen</label><select data-form="pedido" data-field="tipoCliente">' + opt("propio", "Producción propia", f.tipoCliente) + opt("tercero", "Tercero", f.tipoCliente) + "</select></div>" +
    '<div class="field wide"><label>Descripción</label><input data-form="pedido" data-field="descripcion" value="' + esc(f.descripcion) + '" placeholder="Ej. 40 camisetas algodón" /></div>' +
    '<div class="field"><label>Cantidad</label><input type="number" data-form="pedido" data-field="cantidad" value="' + esc(f.cantidad) + '" /></div>' +
    '<div class="field"><label>Fecha de entrega</label><input type="date" data-form="pedido" data-field="fechaEntrega" value="' + esc(f.fechaEntrega) + '" /></div>' +
    "</div>";
  html += '<div class="section-sub" style="margin:12px 0 6px;">Dinero</div><div class="form-grid">' +
    '<div class="field"><label>Total cotizado</label><input type="number" data-form="pedido" data-field="total" value="' + esc(f.total) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Costo (opcional)' + renderHelp("Lo que te cuesta a ti producirlo/comprarlo. Con esto y el total, se calcula la ganancia estimada automáticamente.") + '</label><input type="number" data-form="pedido" data-field="costo" value="' + esc(f.costo) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Abono inicial recibido</label><input type="number" data-form="pedido" data-field="abono" value="' + esc(f.abono) + '" placeholder="0" /></div>' +
    "</div>" + gananciaHint;
  html += '<div class="section-sub" style="margin:12px 0 6px;">Vendedor (opcional)' + renderHelp("Si vendió alguien a comisión, defínelo aquí: nombre y comisión (por % del total, o un valor fijo). El valor y su estado de pago se ven en la tarjeta del pedido, en Finanzas y en el KPI Por pagar.") + '</div><div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input data-form="pedido" data-field="vendedorNombre" value="' + esc(f.vendedorNombre) + '" placeholder="Nombre del vendedor" /></div>' +
    '<div class="field"><label>Tipo de comisión</label><select data-form="pedido" data-field="vendedorTipo">' + opt("porcentaje", "% del total", f.vendedorTipo) + opt("fijo", "$ Valor fijo", f.vendedorTipo) + '</select></div>' +
    '<div class="field"><label>Valor comisión</label><input type="number" data-form="pedido" data-field="vendedorValor" value="' + esc(f.vendedorValor) + '" placeholder="0" /></div>' +
    "</div>";
  html += '<div style="margin-top:14px;"><button class="btn" data-action="add-pedido">Crear pedido</button></div>' +
    '<div class="section-sub" style="margin-top:8px;margin-bottom:0;">Se le asigna un número de OP único al crearlo.</div></div>';

  html += '<div class="field" style="max-width:340px;margin-bottom:10px;"><input id="inp-buscar-pedidos" class="mini-input" style="width:100%" placeholder="Buscar por N.º OP, cédula, cliente, descripción o fecha…" value="' + esc(state.buscarPedidos || "") + '" data-live-filter="buscarPedidos" /></div>';

  html += '<div class="filters"><button class="chip ' + (state.filtroPedidos === "todos" ? "active" : "") + '" data-action="filtro-pedidos" data-val="todos">Todos</button>';
  chipsEstadosDisponibles().forEach(function (e) {
    html += '<button class="chip ' + (state.filtroPedidos === e.id ? "active" : "") + '" data-action="filtro-pedidos" data-val="' + e.id + '">' + esc(e.label) + "</button>";
  });
  html += '<button class="chip ' + (state.filtroPedidosSoloSaldo ? "active" : "") + '" data-action="toggle-filtro-saldo">Con saldo pendiente</button>';
  html += '<button class="btn ghost small" style="margin-left:auto;" data-action="ver-papelera-pedidos">🗑 Papelera' + (state.pedidosPapelera.length ? " (" + state.pedidosPapelera.length + ")" : "") + "</button>";
  html += "</div>";

  var filtered = state.filtroPedidos === "todos" ? state.pedidos : state.pedidos.filter(function (p) { return p.estado === state.filtroPedidos; });
  if (state.filtroPedidosSoloSaldo) { filtered = filtered.filter(function (p) { return num(p.total) - num(p.abono) > 0; }); }
  var q = norm(state.buscarPedidos || "").trim();
  if (q) {
    filtered = filtered.filter(function (p) {
      var cliente = p.clienteId ? clienteById(p.clienteId) : null;
      var cedula = cliente ? cliente.cedula : "";
      return norm(p.numeroOp).indexOf(q) >= 0 || norm(cedula).indexOf(q) >= 0 ||
        norm(p.cliente).indexOf(q) >= 0 || norm(p.descripcion).indexOf(q) >= 0 || norm(p.fechaEntrega).indexOf(q) >= 0;
    });
  }
  if (filtered.length === 0) { html += '<div class="empty">No hay pedidos <b>' + (state.filtroPedidos !== "todos" || q ? "que coincidan" : "todavía") + "</b>.</div>"; }

  filtered.forEach(function (p) {
    var estadosDef = estadosDefDe(p);
    var estadoIds = estadosDef.map(function (e) { return e.id; });
    var idx = estadoIds.indexOf(p.estado);
    if (idx < 0) idx = 0; // por seguridad, si el estado guardado ya no existe en la lista
    var saldo = num(p.total) - num(p.abono);
    var cliente = p.clienteId ? clienteById(p.clienteId) : null;
    var abierto = !!state.pedidoPanelAbierto[p.id];
    var cotRelacionada = p.cotizacionId ? state.cotizaciones.filter(function (c) { return c.id === p.cotizacionId; })[0] : null;
    var ganancia = num(p.costo) > 0 ? num(p.total) - num(p.costo) : null;
    var gananciaPct = (ganancia != null && num(p.total) > 0) ? (ganancia / num(p.total) * 100) : null;

    html += '<div class="pedido-card" data-pedido-id="' + p.id + '">' +
      '<div class="pedido-top"><div>' +
      '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;">' + esc(p.numeroOp || "—") + "</span> " +
      '<span class="pedido-cliente">' + esc(p.cliente) + "</span>" +
      '<span class="pedido-tipo">' + (p.tipoCliente === "propio" ? "Propio" : "Tercero") + "</span>" +
      '<div class="pedido-meta">' + esc(p.descripcion) + " · cantidad " + esc(p.cantidad) + (p.fechaEntrega ? " · entrega " + esc(p.fechaEntrega) : "") + (cliente && cliente.cedula ? " · CC/NIT " + esc(cliente.cedula) : "") + "</div>" +
      (cliente ? '<div class="pedido-meta">📦 ' + esc(cliente.direccion || "—") + ", " + esc(cliente.ciudad || "—") + (cliente.cp ? " (CP " + esc(cliente.cp) + ")" : "") + "</div>" : "") +
      (ganancia != null ? '<div class="pedido-meta">Costo ' + fmt(p.costo) + ' · Ganancia <b style="color:' + (ganancia >= 0 ? "var(--success-ink)" : "var(--danger-ink)") + ';">' + fmt(ganancia) + " (" + gananciaPct.toFixed(1) + "%)</b></div>" : "") +
      "</div><div class=\"pedido-money\"><div class=\"total\">" + fmt(p.total) + "</div>" +
      '<div class="saldo ' + (saldo > 0 ? "" : (num(p.total) > 0 ? "ok" : "neutral")) + '">' + (saldo > 0 ? "saldo " + fmt(saldo) : (num(p.total) > 0 ? "cobrado completo" : "sin valor asignado")) + "</div>" +
      "</div></div>" +
      '<div class="tape-track"><div class="tape-fill" style="width:' + (idx / (estadosDef.length - 1) * 100) + '%;"></div></div>' +
      '<div class="tape-labels">' + estadosDef.map(function (e, i) { return '<span class="' + (i <= idx ? "current" : "") + '">' + esc(e.label) + "</span>"; }).join("") + "</div>" +
      '<div class="pedido-actions">' +
      '<span class="accion-grupo">' +
      (idx > 0 ? '<button class="btn ghost small" data-action="retreat" data-id="' + p.id + '">← Retroceder</button>' : "") +
      (idx < estadosDef.length - 1 ? '<button class="btn small" data-action="advance" data-id="' + p.id + '">Avanzar a ' + esc(estadosDef[idx + 1].label) + " →</button>" : "") +
      (saldo > 0 ? '<button class="btn ghost small" data-action="cobrar" data-id="' + p.id + '">Marcar saldo cobrado</button>' : "") +
      "</span>" +
      (cotRelacionada ? '<button class="btn ghost small" data-action="ver-cotizacion-relacionada" data-id="' + cotRelacionada.id + '">↗ Ver cotización relacionada</button>' :
        '<button class="btn ghost small" data-action="escalar-a-cotizacion" data-id="' + p.id + '" title="Si este pedido rápido escaló y necesitas cotizar insumos, tallas y márgenes en detalle.">📈 Cotizar este pedido</button>') +
      '<button class="btn ghost small" style="margin-left:auto;" data-action="toggle-pedido-panel" data-id="' + p.id + '">' + (abierto ? "▴ Ocultar dinero y documentos" : "▾ Dinero y documentos") + "</button>" +
      "</div>" +
      (abierto ? renderPanelPedido(p, saldo) : "") +
      "</div>";
  });
  return html;
}

// Todo lo secundario de la tarjeta (antes amontonado en una sola fila de
// botones difícil de leer) vive aquí, oculto por defecto y dividido en dos
// zonas claras: lo que tiene que ver con dinero, y lo que tiene que ver con
// documentos/PDF.
function renderPanelPedido(p, saldo) {
  var html = '<div class="pedido-panel">';

  html += '<div class="pedido-panel-col"><div class="section-title small" style="font-size:12.5px;">💰 Dinero</div>';
  html += renderVendedor(p);
  html += (saldo > 0 ? renderAbonoForm(p) : "");
  html += renderAbonosPedido(p);
  html += "</div>";

  html += '<div class="pedido-panel-col"><div class="section-title small" style="font-size:12.5px;">📄 PDF y documentos</div>';
  html += '<div class="inline-form">' +
    '<button class="btn ghost small" data-action="generar-pdf-pedido" data-id="' + p.id + '">📋 Orden de producción</button>' +
    '<button class="btn ghost small" data-action="generar-pdf-factura" data-id="' + p.id + '">🧾 Factura</button>' +
    '<button class="btn ghost small" data-action="enviar-factura-correo" data-id="' + p.id + '" title="Envía la factura al correo del cliente (debe estar registrado en Clientes)">✉ Enviar factura</button>' +
    "</div>";
  html += '<div class="field" style="margin-top:10px;"><label>Observaciones generales del pedido' +
    renderHelp("Para una nota que aplica a todo el pedido, no a una talla en particular (esas se editan en la cotización de origen). Se incluye en el PDF de orden de producción.") +
    '</label><textarea rows="2" data-action-change="set-pedido-obs-generales" data-id="' + p.id + '" placeholder="Ej. Todo el pedido en tela impermeable, entregar en cajas separadas por talla...">' + esc(p.observacionesGenerales || "") + "</textarea></div>";
  html += '<div class="pedido-actions" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-soft);">' +
    '<span class="accion-peligro" style="margin-left:0;padding-left:0;border-left:none;"><button class="btn danger small" data-action="remove-pedido" data-id="' + p.id + '">Eliminar pedido</button></span>' +
    "</div>";
  html += "</div>";

  html += "</div>"; // .pedido-panel
  return html;
}

function renderPapelera() {
  var html = '<div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
    '<div class="section-title small" style="margin:0;">Papelera de pedidos' + renderHelp("Los pedidos eliminados quedan aquí (no se borran para siempre) para poder restaurarlos si fue un error o un clic accidental.") + "</div>" +
    '<button class="btn ghost small" data-action="ver-papelera-pedidos">← Volver a pedidos</button>' +
    "</div>";

  if (!state.pedidosPapelera.length) {
    html += '<div class="card"><div class="empty">La papelera de pedidos está vacía.</div></div>';
    return html;
  }

  state.pedidosPapelera.forEach(function (p) {
    var saldo = num(p.total) - num(p.abono);
    html += '<div class="pedido-card" style="opacity:.85;">' +
      '<div class="pedido-top"><div>' +
      '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;">' + esc(p.numeroOp || "—") + "</span> " +
      '<span class="pedido-cliente">' + esc(p.cliente) + "</span>" +
      '<div class="pedido-meta">' + esc(p.descripcion) + " · cantidad " + esc(p.cantidad) + "</div>" +
      "</div><div class=\"pedido-money\"><div class=\"total\">" + fmt(p.total) + "</div>" +
      '<div class="saldo ' + (saldo > 0 ? "" : "ok") + '">' + (saldo > 0 ? "saldo " + fmt(saldo) : "cobrado completo") + "</div>" +
      "</div></div>" +
      '<div class="pedido-actions">' +
      '<button class="btn small" data-action="restaurar-pedido" data-id="' + p.id + '">Restaurar</button>' +
      '<button class="btn danger small" data-action="eliminar-pedido-definitivo" data-id="' + p.id + '">Eliminar definitivo</button>' +
      "</div></div>";
  });
  return html;
}

function renderVendedor(p) {
  if (!p.vendedor || !p.vendedor.nombre) return "";
  var v = p.vendedor;
  var valor = calcComisionValor(p);
  var pagado = v.estado === "pagado";
  var tipo = v.tipo || "porcentaje";
  // Compatibilidad: pedidos antiguos guardaban solo "porcentaje" (sin tipo/valor).
  var etiquetaValor = tipo === "fijo" ? fmt(valor) : (esc(v.porcentaje != null ? v.porcentaje : v.valor) + "% = " + fmt(valor));
  return '<div class="section-sub" style="margin:8px 0 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
    "Vendedor: <b style=\"color:var(--ink);\">" + esc(v.nombre) + "</b> · " + etiquetaValor +
    '<button class="status-pill ' + (pagado ? "pagado" : "pendiente") + '" data-action="toggle-comision" data-id="' + p.id + '">' + (pagado ? "pagada" : "pendiente") + "</button>" +
    (!pagado ? ('<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-soft);">Fecha de pago<input type="date" class="mini-input" value="' + esc(v.fechaPago || "") + '" data-action-change="set-vendedor-fecha-pago" data-id="' + p.id + '" /></label>') : "") +
    "</div>";
}

function renderAbonoForm(p) {
  return '<div class="inline-form" style="flex-wrap:wrap;">' +
    '<input type="number" class="mini-input" data-role="abono-input" placeholder="Monto abono" style="width:110px" />' +
    '<input type="date" class="mini-input" data-role="abono-fecha" style="width:135px" value="' + todayStr() + '" />' +
    '<select class="mini-input" data-role="abono-metodo" style="width:130px">' +
    '<option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option>' +
    "</select>" +
    '<label class="btn ghost small" style="cursor:pointer;">📎 Comprobante<input type="file" accept="image/*" data-role="abono-comprobante" style="display:none" /></label>' +
    '<button class="btn ghost small" data-action="add-abono" data-id="' + p.id + '">Registrar abono</button>' +
    "</div>";
}

function renderAbonosPedido(p) {
  var abonos = p.abonos || [];
  if (!abonos.length) return "";
  var html = '<div class="section-sub" style="margin-top:8px;">Abonos registrados</div>' +
    '<div class="tx-row head" style="grid-template-columns:100px 90px 110px 1fr 100px;"><span>Fecha</span><span>Monto</span><span>Método</span><span>Comprobante</span><span></span></div>';
  abonos.forEach(function (a) {
    if (state.abonoEditando === a.id) {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 100px;" data-abono-edit-row="' + a.id + '">' +
        '<span><input type="date" class="mini-input" style="width:100%" data-role="edit-abono-fecha" value="' + esc(a.fecha || "") + '" /></span>' +
        '<span><input type="number" class="mini-input" style="width:100%" data-role="edit-abono-monto" value="' + esc(a.monto) + '" /></span>' +
        '<span><select class="mini-input" style="width:100%" data-role="edit-abono-metodo">' +
        ["efectivo", "transferencia", "tarjeta", "otro"].map(function (m) { return opt(m, m.charAt(0).toUpperCase() + m.slice(1), a.metodoPago || "efectivo"); }).join("") +
        "</select></span>" +
        "<span>" + (a.comprobanteUrl ? '<a href="' + esc(a.comprobanteUrl) + '" target="_blank" rel="noopener">Ver comprobante</a>' : '<span class="muted">—</span>') + "</span>" +
        '<span style="display:flex;gap:6px;">' +
        '<button class="btn small" data-action="guardar-abono-edit" data-id="' + p.id + '" data-abono="' + a.id + '">Guardar</button>' +
        '<button class="btn ghost small" data-action="cancelar-edicion-abono">✕</button>' +
        "</span></div>";
    } else {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 100px;">' +
        "<span>" + esc(a.fecha || "—") + "</span>" +
        '<span class="amount">' + fmt(a.monto) + "</span>" +
        "<span>" + esc(a.metodoPago || "—") + "</span>" +
        "<span>" + (a.comprobanteUrl ? '<a href="' + esc(a.comprobanteUrl) + '" target="_blank" rel="noopener">Ver comprobante</a>' : '<span class="muted">—</span>') + "</span>" +
        '<span style="display:flex;gap:6px;">' +
        '<button class="btn ghost small" data-action="editar-abono" data-id="' + a.id + '">Editar</button>' +
        '<button class="btn ghost small" data-action="generar-pdf-recibo" data-id="' + p.id + '" data-abono="' + a.id + '">Recibo</button>' +
        '<button class="btn ghost small" data-action="enviar-recibo-correo" data-id="' + p.id + '" data-abono="' + a.id + '" title="Envía el recibo al correo del cliente">✉</button>' +
        "</span></div>";
    }
  });
  return html;
}

// ---------- Sincronización de fecha de entrega con Google Calendar ----------
// A diferencia de Pendientes (solo admin), Pedidos lo gestiona tanto el
// admin como un vendedor — el evento se crea en el Calendar de quien esté
// logueado en ese momento (cada quien ve en su propia agenda lo que él mismo
// está gestionando), igual que ya hace Gmail con el envío de PDFs.
function sincronizarEventoPedido(p) {
  if (!getSession()) return;
  if (!p.fechaEntrega) {
    if (p.calendarEventId) {
      eliminarEvento(p.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar del pedido", e); });
      state.pedidos = state.pedidos.map(function (x) { return x.id === p.id ? Object.assign({}, x, { calendarEventId: "" }) : x; });
      persist("pedidos");
    }
    return;
  }
  var fecha = new Date(p.fechaEntrega + "T00:00:00");
  var titulo = "📦 Entrega: " + (p.numeroOp || p.descripcion);
  var descripcion = (p.descripcion || "") + (p.cliente ? " · Cliente: " + p.cliente : "");
  sincronizarEvento(p.calendarEventId, eventoUnDia(titulo, descripcion, fecha)).then(function (eventId) {
    var idx = state.pedidos.findIndex(function (x) { return x.id === p.id; });
    if (idx === -1 || state.pedidos[idx].calendarEventId === eventId) return;
    state.pedidos = state.pedidos.map(function (x) { return x.id === p.id ? Object.assign({}, x, { calendarEventId: eventId }) : x; });
    persist("pedidos");
  }).catch(function (e) { console.error("No se pudo sincronizar el pedido con Calendar", e); });
}

export var actions = {
  "filtro-pedidos": function (el) {
    state.filtroPedidos = el.getAttribute("data-val");
    notify();
  },
  "toggle-filtro-saldo": function () {
    state.filtroPedidosSoloSaldo = !state.filtroPedidosSoloSaldo;
    notify();
  },
  "add-pedido": function () {
    var fp = state.formPedido;
    if (!fp.cliente || !fp.descripcion) return;
    var abonoInicial = num(fp.abono);
    var nuevoPedido = {
      id: uid(), clienteId: fp.clienteId || "", cliente: fp.cliente, tipoCliente: fp.tipoCliente, descripcion: fp.descripcion,
      cantidad: fp.cantidad, total: num(fp.total), costo: num(fp.costo), abono: abonoInicial, abonos: [],
      fechaEntrega: fp.fechaEntrega, estado: "cotizacion",
      numeroOp: generarNumeroOp(todosNumerosOp()),
      vendedor: fp.vendedorNombre ? { nombre: fp.vendedorNombre, tipo: fp.vendedorTipo || "porcentaje", valor: num(fp.vendedorValor), estado: "pendiente" } : null,
      codigoPublico: codigoPublico(), calendarEventId: ""
    };
    if (abonoInicial > 0) {
      var abonoInicialId = uid();
      nuevoPedido.abonos.push({ id: abonoInicialId, monto: abonoInicial, fecha: todayStr(), metodoPago: "efectivo", comprobanteUrl: "" });
      state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Abono inicial — " + fp.descripcion, monto: abonoInicial, contraparte: fp.cliente, fecha: todayStr(), pedidoId: nuevoPedido.id, origenAbonoId: abonoInicialId });
      persist("tx");
    }
    state.pedidos.unshift(nuevoPedido);
    state.formPedido = { clienteId: "", cliente: "", tipoCliente: "propio", descripcion: "", cantidad: "1", total: "", costo: "", abono: "", fechaEntrega: "", vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "" };
    persist("pedidos"); notify();
    sincronizarEventoPedido(nuevoPedido);
  },
  // "Escalar" un pedido rápido: crea una cotización de arranque (una
  // referencia con lo que ya se sabe) para poder detallar insumos, tallas y
  // márgenes. El pedido queda enlazado desde ya; cuando se aplique la
  // cotización (botón en Cotizaciones), sus valores reemplazan a los de
  // este pedido — sin perder los abonos que ya se hayan cobrado.
  "escalar-a-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var p = state.pedidos.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!window.confirm('¿Crear una cotización a partir de "' + p.descripcion + '"?\n\nPodrás detallar insumos, tallas y márgenes ahí. Cuando la apliques, sus valores reemplazan a los de este pedido (los abonos ya cobrados se conservan).')) return;
    var cotId = uid();
    var nuevaCot = {
      id: cotId, clienteId: p.clienteId || "", cliente: p.cliente, descripcion: p.descripcion, fecha: todayStr(),
      estado: "borrador", pedidoOrigenId: p.id,
      referencias: [{ id: uid(), nombre: p.descripcion, imagenUrl: "", consumoAprox: 1, cantidadPedida: num(p.cantidad) || 1, precioVenta: num(p.total) || 0, insumos: [], detalle: [] }],
      gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: p.vendedor ? Object.assign({}, p.vendedor) : null,
      codigoPublico: codigoPublico()
    };
    state.cotizaciones.unshift(nuevaCot);
    state.pedidos = state.pedidos.map(function (x) { return x.id === id ? Object.assign({}, x, { cotizacionId: cotId }) : x; });
    persist("cotizaciones"); persist("pedidos");
    state.tab = "cotizaciones";
    notify();
  },
  "toggle-pedido-panel": function (el) {
    var id = el.getAttribute("data-id");
    state.pedidoPanelAbierto = Object.assign({}, state.pedidoPanelAbierto, { [id]: !state.pedidoPanelAbierto[id] });
    notify();
  },
  // Lleva a la pestaña de Cotizaciones y expande (si estaba contraída) la
  // cotización de origen de este pedido, para poder revisarla o editarla sin
  // tener que buscarla manualmente en la lista.
  "ver-cotizacion-relacionada": function (el) {
    var cotId = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === cotId ? Object.assign({}, c, { colapsada: false }) : c; });
    state.tab = "cotizaciones";
    persist("cotizaciones"); notify();
    setTimeout(function () {
      var card = document.querySelector('[data-cot-id="' + cotId + '"]');
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  },
  "toggle-comision": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped || !ped.vendedor) return;
    var pagando = ped.vendedor.estado !== "pagado";
    if (pagando) {
      var valor = calcComisionValor(ped);
      state.tx.unshift({ id: uid(), tipo: "comision", concepto: "Comisión — " + ped.vendedor.nombre, monto: valor, contraparte: ped.vendedor.nombre, fecha: todayStr(), pedidoId: ped.id });
      persist("tx");
    }
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      return Object.assign({}, p, { vendedor: Object.assign({}, p.vendedor, { estado: pagando ? "pagado" : "pendiente" }) });
    });
    persist("pedidos"); notify();
  },
  advance: function (el) { moveEstado(el, 1); },
  retreat: function (el) { moveEstado(el, -1); },
  cobrar: function (el) {
    var id = el.getAttribute("data-id");
    var pedido = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (pedido) {
      var saldo = num(pedido.total) - num(pedido.abono);
      if (saldo > 0) {
        if (!window.confirm('¿Registrar el saldo completo de ' + fmt(saldo) + ' como cobrado para "' + pedido.numeroOp + " — " + pedido.descripcion + '"?\n\nEsto crea un movimiento de ingreso en Finanzas. Puedes anular el abono luego desde Finanzas si te equivocas.')) return;
        var abonoId = uid();
        state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Saldo pedido — " + pedido.descripcion, monto: saldo, contraparte: pedido.cliente, fecha: todayStr(), pedidoId: pedido.id, origenAbonoId: abonoId });
        state.pedidos = state.pedidos.map(function (p) {
          if (p.id !== id) return p;
          var abonos = (p.abonos || []).concat([{ id: abonoId, monto: saldo, fecha: todayStr(), metodoPago: "otro", comprobanteUrl: "" }]);
          return Object.assign({}, p, { abono: p.total, abonos: abonos });
        });
        // Si el filtro "Con saldo pendiente" está activo, el pedido recién
        // saldado desaparecería de la vista (aunque sigue existiendo) — se
        // desactiva para que quede claro que no se borró, solo se cobró.
        if (state.filtroPedidosSoloSaldo) state.filtroPedidosSoloSaldo = false;
        persist("tx"); persist("pedidos");
      }
    }
    notify();
  },
  "add-abono": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest(".pedido-card");
    var input = card ? card.querySelector('[data-role="abono-input"]') : null;
    var monto = input ? num(input.value) : 0;
    if (monto <= 0) return;
    var fechaEl = card ? card.querySelector('[data-role="abono-fecha"]') : null;
    var metodoEl = card ? card.querySelector('[data-role="abono-metodo"]') : null;
    var fileEl = card ? card.querySelector('[data-role="abono-comprobante"]') : null;
    var fecha = (fechaEl && fechaEl.value) || todayStr();
    var metodo = metodoEl ? metodoEl.value : "efectivo";
    var file = fileEl && fileEl.files && fileEl.files[0];

    function registrarAbono(comprobanteUrl) {
      var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
      if (!ped) return;
      var saldoDisponible = num(ped.total) - num(ped.abono);
      var abonoAplicado = Math.min(monto, Math.max(saldoDisponible, 0)) || monto;
      var abonoId = uid();
      state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Abono — " + ped.descripcion, monto: abonoAplicado, contraparte: ped.cliente, fecha: fecha, pedidoId: ped.id, origenAbonoId: abonoId });
      state.pedidos = state.pedidos.map(function (p) {
        if (p.id !== id) return p;
        var abonos = (p.abonos || []).concat([{ id: abonoId, monto: abonoAplicado, fecha: fecha, metodoPago: metodo, comprobanteUrl: comprobanteUrl || "" }]);
        return Object.assign({}, p, { abono: num(p.abono) + abonoAplicado, abonos: abonos });
      });
      persist("tx"); persist("pedidos"); notify();
    }

    if (file) {
      var reader = new FileReader();
      reader.onload = function () { registrarAbono(reader.result); };
      reader.onerror = function () { registrarAbono(""); };
      reader.readAsDataURL(file);
    } else {
      registrarAbono("");
    }
  },
  // Editar un abono ya registrado desde el propio pedido (antes solo se podía
  // desde Movimientos): recalcula el total abonado del pedido a partir de la
  // suma de sus abonos y mantiene sincronizado el movimiento de Finanzas
  // vinculado (por origenAbonoId), para que ambas vistas nunca se desalineen.
  "editar-abono": function (el) {
    state.abonoEditando = el.getAttribute("data-id");
    notify();
  },
  "cancelar-edicion-abono": function () {
    state.abonoEditando = "";
    notify();
  },
  "guardar-abono-edit": function (el) {
    var pedidoId = el.getAttribute("data-id"), abonoId = el.getAttribute("data-abono");
    var fila = el.closest("[data-abono-edit-row]");
    if (!fila) return;
    var g = function (role) { var i = fila.querySelector('[data-role="' + role + '"]'); return i ? i.value : ""; };
    var nuevoMonto = num(g("edit-abono-monto"));
    var nuevaFecha = g("edit-abono-fecha");
    var nuevoMetodo = g("edit-abono-metodo");
    if (nuevoMonto <= 0 || !nuevaFecha) return;
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== pedidoId) return p;
      var abonos = (p.abonos || []).map(function (a) {
        return a.id === abonoId ? Object.assign({}, a, { monto: nuevoMonto, fecha: nuevaFecha, metodoPago: nuevoMetodo }) : a;
      });
      var totalAbonado = abonos.reduce(function (a, x) { return a + num(x.monto); }, 0);
      return Object.assign({}, p, { abonos: abonos, abono: totalAbonado });
    });
    state.tx = state.tx.map(function (t) {
      return t.origenAbonoId === abonoId ? Object.assign({}, t, { monto: nuevoMonto, fecha: nuevaFecha }) : t;
    });
    state.abonoEditando = "";
    persist("pedidos"); persist("tx"); notify();
  },
  "ver-papelera-pedidos": function () {
    state.filtroPedidosVista = state.filtroPedidosVista === "papelera" ? "activos" : "papelera";
    notify();
  },
  // "Eliminar" pide confirmación (antes borraba al instante, sin aviso) y
  // manda el pedido a la papelera en vez de borrarlo para siempre — así un
  // clic accidental (o uno mal ubicado entre tantos botones) es reversible.
  "remove-pedido": function (el) {
    var id = el.getAttribute("data-id");
    var pedido = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!pedido) return;
    if (!window.confirm('¿Eliminar el pedido "' + pedido.numeroOp + " — " + pedido.descripcion + '"?\n\nSe mueve a la papelera de pedidos y puedes restaurarlo si fue un error.')) return;
    state.pedidos = state.pedidos.filter(function (p) { return p.id !== id; });
    state.pedidosPapelera.unshift(Object.assign({}, pedido, { eliminadoEl: todayStr() }));
    persist("pedidos"); persist("pedidosPapelera"); notify();
    if (pedido.calendarEventId) eliminarEvento(pedido.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar del pedido", e); });
  },
  "restaurar-pedido": function (el) {
    var id = el.getAttribute("data-id");
    var pedido = state.pedidosPapelera.filter(function (p) { return p.id === id; })[0];
    if (!pedido) return;
    state.pedidosPapelera = state.pedidosPapelera.filter(function (p) { return p.id !== id; });
    var restaurado = Object.assign({}, pedido);
    delete restaurado.eliminadoEl;
    restaurado.calendarEventId = ""; // el evento anterior ya se borró al eliminar el pedido
    // Si en el tiempo que estuvo en la papelera se creó otro pedido con el
    // mismo N.º de OP, se le asigna uno nuevo para evitar duplicados.
    var otrosNumeros = state.pedidos.map(function (p) { return p.numeroOp; });
    if (otrosNumeros.indexOf(restaurado.numeroOp) >= 0) {
      restaurado.numeroOp = generarNumeroOp(todosNumerosOp());
    }
    state.pedidos.unshift(restaurado);
    persist("pedidos"); persist("pedidosPapelera"); notify();
    sincronizarEventoPedido(restaurado);
  },
  "eliminar-pedido-definitivo": function (el) {
    var id = el.getAttribute("data-id");
    if (!window.confirm("Esto elimina el pedido para siempre (incluyendo sus abonos y detalle) y no se puede deshacer. ¿Continuar?")) return;
    state.pedidosPapelera = state.pedidosPapelera.filter(function (p) { return p.id !== id; });
    persist("pedidosPapelera"); notify();
  },
  "set-pedido-obs-generales": function (el) {
    var id = el.getAttribute("data-id");
    state.pedidos = state.pedidos.map(function (p) { return p.id === id ? Object.assign({}, p, { observacionesGenerales: el.value }) : p; });
    persist("pedidos"); notify();
  },
  "generar-pdf-pedido": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (ped) generarPDFPedido(ped);
  },
  "generar-pdf-factura": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (ped) generarPDFFactura(ped);
  },
  "generar-pdf-recibo": function (el) {
    var id = el.getAttribute("data-id"), abonoId = el.getAttribute("data-abono");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped) return;
    var abono = (ped.abonos || []).filter(function (a) { return a.id === abonoId; })[0];
    if (abono) generarPDFRecibo(ped, abono);
  },
  "enviar-factura-correo": async function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped) return;
    var cliente = ped.clienteId ? clienteById(ped.clienteId) : null;
    var correo = cliente && cliente.correo;
    if (!correo) { window.alert('Este cliente no tiene correo registrado. Agrégaselo en la pestaña Clientes para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFFactura(ped, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Factura — " + (ped.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (ped.cliente || "") + ",",
          mensaje: "Adjuntamos la factura de \"" + (ped.descripcion || "tu pedido") + "\". Gracias por tu confianza.",
          docTitulo: "Factura"
        }),
        filename: pdf.nombreArchivo,
        bytes: pdf.bytes
      });
      window.alert("Correo enviado a " + correo + ".");
    } catch (e) {
      window.alert("No se pudo enviar el correo: " + (e && e.message ? e.message : e));
    }
  },
  "enviar-recibo-correo": async function (el) {
    var id = el.getAttribute("data-id"), abonoId = el.getAttribute("data-abono");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped) return;
    var abono = (ped.abonos || []).filter(function (a) { return a.id === abonoId; })[0];
    if (!abono) return;
    var cliente = ped.clienteId ? clienteById(ped.clienteId) : null;
    var correo = cliente && cliente.correo;
    if (!correo) { window.alert('Este cliente no tiene correo registrado. Agrégaselo en la pestaña Clientes para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFRecibo(ped, abono, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Recibo de abono — " + (ped.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (ped.cliente || "") + ",",
          mensaje: "Adjuntamos el recibo correspondiente a tu abono. Gracias por tu pago.",
          docTitulo: "Recibo de abono"
        }),
        filename: pdf.nombreArchivo,
        bytes: pdf.bytes
      });
      window.alert("Correo enviado a " + correo + ".");
    } catch (e) {
      window.alert("No se pudo enviar el correo: " + (e && e.message ? e.message : e));
    }
  },
  "set-vendedor-fecha-pago": function (el) {
    var id = el.getAttribute("data-id");
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id || !p.vendedor) return p;
      return Object.assign({}, p, { vendedor: Object.assign({}, p.vendedor, { fechaPago: el.value }) });
    });
    persist("pedidos"); notify();
  }
};

function moveEstado(el, dir) {
  var id = el.getAttribute("data-id");
  state.pedidos = state.pedidos.map(function (p) {
    if (p.id !== id) return p;
    var estadoIds = estadosDefDe(p).map(function (e) { return e.id; });
    var idx = estadoIds.indexOf(p.estado);
    if (idx < 0) idx = 0;
    var nidx = dir > 0 ? Math.min(idx + 1, estadoIds.length - 1) : Math.max(idx - 1, 0);
    return Object.assign({}, p, { estado: estadoIds[nidx] });
  });
  persist("pedidos"); notify();
}

// Chips de filtro: siempre se ven las etapas por defecto, más cualquier
// etapa personalizada que algún pedido esté usando ahora mismo (para poder
// filtrar por ella aunque no sea parte del flujo estándar).
function chipsEstadosDisponibles() {
  var vistos = {}; var lista = [];
  ESTADOS_DEFAULT.forEach(function (e) { vistos[e.id] = true; lista.push(e); });
  state.pedidos.forEach(function (p) {
    estadosDefDe(p).forEach(function (e) {
      if (!vistos[e.id]) { vistos[e.id] = true; lista.push(e); }
    });
  });
  return lista;
}
