import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, generarNumeroOp, codigoPublico, exigirCampos } from "../core/utils.js";
import { ESTADOS, ESTADO_LABEL, ESTADOS_DEFAULT } from "../core/constants.js";
import { clienteById, calcComisionValor, estadosDefDe, estadoLabelDe, calcConsignacionDisponible, calcConsignacionVendida, calcConsignacionRetirada, calcConsignacionComision, calcConsignacionDisponiblePorTalla, estadosDefDeRef, estadoIdxRef, estadoAgregadoDeCot, productoById, stockTalla, validarStockLineas } from "../core/calc.js";
import { fmt, norm } from "../core/utils.js";
import { renderClienteCombo, renderHelp } from "../core/components.js";
import { generarPDFPedido, generarPDFRecibo, generarPDFFactura, generarPDFRemision } from "../core/pdf.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { sincronizarEvento, eliminarEvento, eventoUnDia } from "../core/calendar.js";
import { getSession } from "../core/auth.js";
import { ajustarStockProducto } from "../core/stock.js";

// Todos los números de OP usados, activos Y en la papelera — para que un
// pedido restaurado o uno nuevo nunca choque con uno que ya existió.
export function todosNumerosOp() {
  return state.pedidos.map(function (p) { return p.numeroOp; })
    .concat(state.pedidosPapelera.map(function (p) { return p.numeroOp; }));
}

// Dos pestañas arriba, mismo patrón que Cotizaciones: "+ Nuevo pedido" es un
// formulario enfocado y nada más (sin la lista ni los filtros compitiendo por
// atención), y "Historial" es donde vive todo lo demás — búsqueda, filtros,
// papelera y la lista completa de pedidos. Antes las dos cosas convivían
// siempre en una sola pantalla larga.
export function render() {
  if (state.filtroPedidosVista === "papelera") return renderPapelera();
  var vista = state.pedidosVista || "nueva";
  var html = renderTabsPedidos(vista);
  html += vista === "historial" ? renderHistorialPedidos() : renderFormNuevoPedido();
  return html;
}

function renderTabsPedidos(vista) {
  var total = state.pedidos.length;
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nueva" ? "active" : "") + '" data-action="pedido-vista" data-val="nueva">+ Nuevo pedido</button>' +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="pedido-vista" data-val="historial">Historial' + (total ? " (" + total + ")" : "") + "</button>" +
    "</div>";
}

// Suma la cantidad y arma la descripción de un pedido rápido a partir de sus
// líneas (producto de catálogo o texto libre) — se calcula siempre a partir
// de las líneas, nunca se escribe a mano, para que sea imposible crear un
// pedido de "1 und" sin que quede claro 1 und DE QUÉ.
function resumenLineasPedido(lineas) {
  lineas = lineas || [];
  var cantidad = lineas.reduce(function (a, l) { return a + num(l.cantidad); }, 0);
  var descripcion = lineas.map(function (l) {
    var nombre = l.productoNombre || l.textoDescripcion || "";
    return nombre + (l.talla ? " (" + l.talla + ")" : "") + " x" + l.cantidad;
  }).join(", ");
  return { cantidad: cantidad, descripcion: descripcion };
}

function renderFormNuevoPedido() {
  var f = state.formPedido;
  var lineas = f.stockConsumido || [];
  var clienteListo = !!(f.cliente && f.cliente.trim());
  var tieneLineas = lineas.length > 0;
  var costoNum = num(f.costo), totalNum = num(f.total);
  var gananciaHint = costoNum > 0 && totalNum > 0
    ? ('<div class="section-sub" style="margin:6px 0 0;">Ganancia estimada: <b style="color:' + (totalNum - costoNum >= 0 ? "var(--success-ink)" : "var(--danger-ink)") + ';">' + fmt(totalNum - costoNum) + " (" + ((totalNum - costoNum) / totalNum * 100).toFixed(1) + "%)</b></div>")
    : "";
  var html = '<div class="card"><div class="section-title small">Nuevo pedido rápido' +
    renderHelp("Para lo del día a día que no necesita pasar por una cotización completa: stock, cosas sencillas, sin personalización. El formulario va paso a paso: primero el cliente, luego qué se lleva, y recién con eso definido aparece el resto. Si el pedido escala y necesitas cotizar insumos y márgenes en detalle, créala aparte en Cotizaciones y conviértela en pedido.") +
    "</div>";

  // ---- 1 · Cliente y tipo de pedido (siempre visible) ----
  html += '<div class="cot-col-title" style="margin-top:6px;">1 · Cliente y tipo de pedido</div><div class="form-grid">' +
    renderClienteCombo("pedido", "pedido-cliente-nombre", f) +
    '<div class="field"><label>Origen</label><select data-form="pedido" data-field="tipoCliente">' + opt("propio", "Producción propia", f.tipoCliente) + opt("tercero", "Tercero", f.tipoCliente) + "</select></div>" +
    '<div class="field"><label>Fecha de entrega</label><input type="date" data-form="pedido" data-field="fechaEntrega" value="' + esc(f.fechaEntrega) + '" /></div>' +
    "</div>";
  // Control segmentado en vez de un checkbox con una frase larga al lado: las
  // dos opciones se nombran explícitamente y la explicación vive en el "?".
  html += '<div style="margin-top:14px;"><div class="cot-col-title">Tipo de pedido' +
    renderHelp("Venta directa: le vendes al cliente y cobras (de una o con abonos). Consignación: le dejas mercancía a un punto de venta externo sin cobrarla todavía — solo facturas lo que el punto reporte como vendido, y él se queda con una comisión por cada venta.") +
    "</div>" +
    '<div class="segmented">' +
    '<button class="segmented-opcion ' + (f.esConsignacion ? "" : "active") + '" data-action="set-tipo-pedido" data-val="venta">🧾 Venta directa</button>' +
    '<button class="segmented-opcion ' + (f.esConsignacion ? "active" : "") + '" data-action="set-tipo-pedido" data-val="consignacion">🏬 Consignación</button>' +
    "</div></div>";

  if (!clienteListo) {
    html += '<div class="empty" style="margin-top:16px;">Elige o escribe el cliente arriba para continuar armando el pedido.</div>' +
      "</div>"; // cierra .card
    return html;
  }

  html += '<hr class="stitch" />';
  // ---- 2 · Qué incluye (líneas) ----
  html += '<div class="cot-col-title">2 · Qué incluye este pedido' +
    renderHelp((f.esConsignacion
      ? "Elige del catálogo lo que le dejas al punto — queda como su primera remisión (con PDF) y el stock del taller baja al crear el pedido."
      : "Cada línea (producto del catálogo, o algo que describas a mano) define su propia cantidad — la cantidad y descripción del pedido se arman solas a partir de esto, para que nunca quede una cantidad suelta sin decir de qué es.")) +
    "</div>";
  html += renderLineasPedido(f);

  if (!tieneLineas) {
    html += '<div class="empty" style="margin-top:10px;">Agrega al menos un producto del catálogo' + (f.esConsignacion ? "" : " o descríbelo") + " para continuar." + "</div>" +
      "</div>"; // cierra .card
    return html;
  }

  html += '<hr class="stitch" />';
  if (f.esConsignacion) {
    html += '<div class="cot-col-title">3 · Condiciones con el punto' + renderHelp("El \"Cliente\" de arriba es el punto de consignación (regístralo antes en Contactos, con su comisión por defecto, y queda vinculado solo). El precio unitario es lo que el punto le cobra al público; la comisión se calcula sobre cada venta que reportes, no sobre el envío completo.") + '</div><div class="form-grid">' +
      '<div class="field"><label>Precio unitario de venta</label><input type="number" data-form="pedido" data-field="consignacionPrecioUnitario" value="' + esc(f.consignacionPrecioUnitario) + '" placeholder="0" /></div>' +
      '<div class="field"><label>Comisión del punto</label><select data-form="pedido" data-field="consignacionComisionTipo">' + opt("porcentaje", "% de cada venta", f.consignacionComisionTipo) + opt("fijo", "$ fijo por unidad", f.consignacionComisionTipo) + "</select></div>" +
      '<div class="field"><label>Valor comisión</label><input type="number" data-form="pedido" data-field="consignacionComisionValor" value="' + esc(f.consignacionComisionValor) + '" placeholder="Ej. 20" /></div>' +
      "</div>";
  } else {
    html += '<div class="cot-col-title">3 · Precio y pago</div><div class="form-grid">' +
      '<div class="field"><label>Total cotizado</label><input type="number" data-form="pedido" data-field="total" value="' + esc(f.total) + '" placeholder="0" /></div>' +
      '<div class="field"><label>Costo (opcional)' + renderHelp("Lo que te cuesta a ti producirlo/comprarlo. Con esto y el total, se calcula la ganancia estimada automáticamente.") + '</label><input type="number" data-form="pedido" data-field="costo" value="' + esc(f.costo) + '" placeholder="0" /></div>' +
      '<div class="field"><label>Abono inicial recibido</label><input type="number" data-form="pedido" data-field="abono" value="' + esc(f.abono) + '" placeholder="0" /></div>' +
      "</div>" + gananciaHint;
    html += '<hr class="stitch" />';
    html += '<div class="cot-col-title">4 · Vendedor (opcional)' + renderHelp("Si vendió alguien a comisión, defínelo aquí: nombre y comisión (por % del total, o un valor fijo). El valor y su estado de pago se ven en la tarjeta del pedido, en Finanzas y en el KPI Por pagar.") + '</div><div class="form-grid">' +
      '<div class="field"><label>Nombre</label><input data-form="pedido" data-field="vendedorNombre" value="' + esc(f.vendedorNombre) + '" placeholder="Nombre del vendedor" /></div>' +
      '<div class="field"><label>Tipo de comisión</label><select data-form="pedido" data-field="vendedorTipo">' + opt("porcentaje", "% del total", f.vendedorTipo) + opt("fijo", "$ Valor fijo", f.vendedorTipo) + '</select></div>' +
      '<div class="field"><label>Valor comisión</label><input type="number" data-form="pedido" data-field="vendedorValor" value="' + esc(f.vendedorValor) + '" placeholder="0" /></div>' +
      "</div>";
  }
  html += '<div style="margin-top:22px;"><button class="btn" data-action="add-pedido">' +
    (f.esConsignacion ? "Crear consignación y remisión" : "Crear pedido") + "</button></div></div>";
  return html;
}

// Líneas del pedido: cada una es un producto de catálogo (con talla, elegido
// por el picker) o, solo para venta directa, algo descrito a mano — nunca
// una cantidad suelta sin decir de qué. El descuento real de stock ocurre
// recién al confirmar "Crear pedido" (ver acción "add-pedido"), nunca antes.
function renderLineasPedido(f) {
  var lineas = f.stockConsumido || [];
  var producto = f.productoSel ? productoById(f.productoSel) : null;
  var html = '<div class="row-actions" style="margin-bottom:10px;">' +
    '<button class="btn ghost small" data-action="abrir-producto-picker-pedido">🔍 Elegir producto del catálogo</button>' +
    "</div>";

  if (!(state.productos || []).length && !f.esConsignacion) {
    html += '<div class="section-sub" style="margin:0 0 10px;">Tu catálogo de productos está vacío — puedes seguir con líneas descritas a mano.</div>';
  }

  if (producto) {
    html += renderProductoElegido(producto);
    var tallas = (producto.variantesTalla || []).filter(function (t) { return num(t.stock) > 0; });
    if (!tallas.length) {
      html += '<div class="section-sub" style="margin-top:6px;color:var(--danger-ink);">Sin stock disponible en ninguna talla.</div>';
    } else {
      html += '<div class="inline-form" style="margin-top:8px;">' +
        '<select class="mini-input" data-role="pedido-producto-talla" style="width:150px">' +
        tallas.map(function (t) { return '<option value="' + esc(t.talla) + '">' + esc(t.talla) + " (" + num(t.stock) + " disp.)</option>"; }).join("") +
        "</select>" +
        '<input type="number" class="mini-input" data-role="pedido-producto-cantidad" placeholder="Cantidad" style="width:100px" min="1" />' +
        '<button class="btn ghost small" data-action="add-pedido-producto-linea" data-id="' + producto.id + '">+ Agregar</button>' +
        "</div>";
    }
  }

  if (!f.esConsignacion) {
    html += '<div class="inline-form" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);flex-wrap:wrap;">' +
      '<input class="mini-input" data-role="pedido-texto-descripcion" placeholder="Algo que no está en el catálogo (ej. bordado personalizado)" style="width:260px" />' +
      '<input type="number" class="mini-input" data-role="pedido-texto-cantidad" placeholder="Cantidad" style="width:100px" min="1" />' +
      '<button class="btn ghost small" data-action="add-pedido-texto-linea">+ Agregar</button>' +
      "</div>";
  }

  // Lo ya agregado se muestra como lista con opción de quitar.
  if (lineas.length) {
    var totalUnid = lineas.reduce(function (a, l) { return a + num(l.cantidad); }, 0);
    html += '<div class="tx-row head" style="margin-top:14px;grid-template-columns:1fr 90px 70px 40px;"><span>Qué es</span><span>Talla</span><span>Cant.</span><span></span></div>';
    lineas.forEach(function (l, i) {
      html += '<div class="tx-row" style="grid-template-columns:1fr 90px 70px 40px;">' +
        '<span class="mobile-th">Qué es</span><span>' + esc(l.productoNombre || l.textoDescripcion || "—") + "</span>" +
        '<span class="mobile-th">Talla</span><span>' + esc(l.talla || "—") + "</span>" +
        '<span class="mobile-th">Cant.</span><span>' + l.cantidad + "</span>" +
        '<button class="btn danger small" data-action="quitar-pedido-producto-linea" data-idx="' + i + '" title="Quitar esta línea">✕</button>' +
        "</div>";
    });
    html += '<div class="section-sub" style="margin:6px 0 0;">' + totalUnid + " unidad(es) en total · " +
      (f.esConsignacion ? "se entregarán al punto y saldrán del stock del taller al crear." : "se descontarán del stock (las de catálogo) al crear el pedido.") + "</div>";
  } else {
    html += '<div class="empty" style="margin-top:10px;">Sin líneas todavía.</div>';
  }
  html += renderProductoPickerPedido();
  return html;
}

// Modal tipo explorador para elegir el producto (mismo patrón
// .picker-overlay/.picker-modal que Cotizaciones/Productos) — reemplaza el
// buscador inline con sugerencias que había antes.
function renderProductoPickerPedido() {
  if (!state.pedidoProductoPickerAbierto) return "";
  var productos = state.productos || [];
  var q = norm(state.pedidoProductoBusqueda || "").trim();
  var visibles = q ? productos.filter(function (p) {
    return norm(p.nombre).indexOf(q) >= 0 || norm(p.referencia || "").indexOf(q) >= 0 || norm(p.categoria || "").indexOf(q) >= 0;
  }) : productos;

  var html = '<div class="picker-overlay" data-action="cerrar-producto-picker-pedido">' +
    '<div class="picker-modal" data-action="picker-stop">' +
    '<div class="picker-head"><div class="section-title small" style="margin:0;">Elegir producto del catálogo</div>' +
    '<button class="imgprev-close" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="cerrar-producto-picker-pedido" aria-label="Cerrar">✕</button></div>' +
    '<div class="picker-search"><input id="inp-producto-picker-pedido-buscar" class="mini-input" style="width:100%" placeholder="Buscar por nombre, referencia o categoría…" value="' + esc(state.pedidoProductoBusqueda || "") + '" data-live-filter="pedidoProductoBusqueda" /></div>' +
    '<div class="picker-list">';

  if (!productos.length) {
    html += '<div class="empty">Tu catálogo está vacío — regístralo en <b>Catálogo</b> primero (con su stock por talla).</div>';
  } else if (!visibles.length) {
    html += '<div class="empty">Sin coincidencias' + (q ? ' para "' + esc(state.pedidoProductoBusqueda) + '"' : "") + ".</div>";
  } else {
    visibles.forEach(function (p) {
      var stockTotal = (p.variantesTalla || []).reduce(function (a, t) { return a + num(t.stock); }, 0);
      var meta = [p.referencia, p.categoria].filter(Boolean).join(" · ");
      html += '<div class="picker-item" data-action="select-producto-pedido-picker" data-id="' + p.id + '">' +
        "<span></span>" +
        '<span class="picker-item-info"><b>' + esc(p.nombre) + "</b><small>" + (meta ? esc(meta) + " · " : "") + stockTotal + " en stock</small></span>" +
        '<span class="amount">' + fmt(p.precioVenta) + "</span>" +
        "</div>";
    });
  }

  html += "</div></div>" +
    '<div class="picker-foot"><span class="section-sub" style="margin:0;">' + (visibles.length ? visibles.length + " resultado(s)" : "") + "</span>" +
    '<button class="btn ghost small" data-action="cerrar-producto-picker-pedido">Cerrar</button></div>' +
    "</div></div>";
  return html;
}

function productoThumbHtml(p, claseThumb) {
  if (p.imagenUrl) return '<span class="' + claseThumb + '"><img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" /></span>';
  return '<span class="' + claseThumb + '">🧺</span>';
}

// Una vez elegido, queda visible con su foto (para no perder de vista cuál
// se está agregando) y un enlace directo a su detalle en el Catálogo, por si
// hace falta comprobar del todo que es el producto correcto.
function renderProductoElegido(p) {
  var meta = [p.referencia, p.categoria].filter(Boolean).join(" · ");
  return '<div class="producto-elegido">' +
    productoThumbHtml(p, "producto-elegido-thumb") +
    '<div style="flex:1;min-width:0;"><b>' + esc(p.nombre) + "</b>" + (meta ? '<div class="section-sub" style="margin:2px 0 0;">' + esc(meta) + "</div>" : "") + "</div>" +
    '<button class="btn ghost small" data-action="ver-producto-en-catalogo" data-id="' + p.id + '" title="Abrir este producto en el Catálogo, en otra pestaña, para confirmar que es el correcto">Ver en Catálogo ↗</button>' +
    '<button class="btn ghost small" data-action="quitar-pedido-producto-sel" title="Elegir otro producto">✕</button>' +
    "</div>";
}

// Compartido entre el listado principal y el picker de búsqueda (mismos
// criterios: N.º OP, cédula, cliente, descripción o fecha de entrega).
function filtrarPedidosPorTexto(pedidos, q) {
  q = norm(q || "").trim();
  if (!q) return pedidos;
  return pedidos.filter(function (p) {
    var cliente = p.clienteId ? clienteById(p.clienteId) : null;
    var cedula = cliente ? cliente.cedula : "";
    return norm(p.numeroOp).indexOf(q) >= 0 || norm(cedula).indexOf(q) >= 0 ||
      norm(p.cliente).indexOf(q) >= 0 || norm(p.descripcion).indexOf(q) >= 0 || norm(p.fechaEntrega).indexOf(q) >= 0;
  });
}

function renderHistorialPedidos() {
  // Barra de búsqueda fija de toda la vida: input siempre visible con
  // filtro en vivo (estilo AJAX, debounce de 150ms — ver data-live-filter en
  // core/dom.js), no una ventana emergente. Se probó un picker modal acá y
  // resultó más invasivo que útil para este caso — el picker sí tiene
  // sentido para elegir UN producto del catálogo (ver renderProductoPickerPedido),
  // no para filtrar una lista que ya está en pantalla.
  var html = '<div class="field" style="max-width:340px;margin-bottom:10px;"><input id="inp-buscar-pedidos" class="mini-input" style="width:100%" placeholder="Buscar por N.º OP, cédula, cliente, descripción o fecha…" value="' + esc(state.buscarPedidos || "") + '" data-live-filter="buscarPedidos" /></div>';

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
  filtered = filtrarPedidosPorTexto(filtered, q);
  if (filtered.length === 0) { html += '<div class="empty">No hay pedidos <b>' + (state.filtroPedidos !== "todos" || q ? "que coincidan" : "todavía") + "</b>.</div>"; }

  filtered.forEach(function (p) {
    if (p.consignacion) { html += renderPedidoConsignacion(p); return; }
    var saldo = num(p.total) - num(p.abono);
    var cliente = p.clienteId ? clienteById(p.clienteId) : null;
    var abierto = !!state.pedidoPanelAbierto[p.id];
    var cotRelacionada = p.cotizacionId ? state.cotizaciones.filter(function (c) { return c.id === p.cotizacionId; })[0] : null;
    // Si el pedido viene de una cotización con referencias, el progreso se
    // ve y se controla por referencia (cada una puede llevar su propio
    // ritmo) — si no, se usa el "tape" único de siempre (pedidos rápidos,
    // sin cotización de origen).
    var refsProduccion = (cotRelacionada && cotRelacionada.referencias && cotRelacionada.referencias.length) ? cotRelacionada.referencias : null;
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
      (refsProduccion ? renderProgresoPorReferencia(p, cotRelacionada, refsProduccion) : renderProgresoTape(p)) +
      '<div class="pedido-actions">' +
      '<span class="accion-grupo">' +
      (saldo > 0 ? '<button class="btn small" data-action="cobrar" data-id="' + p.id + '">Marcar saldo cobrado</button>' : "") +
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

// "Tape" único de toda la vida — solo para pedidos sin referencias propias
// (pedidos rápidos creados directo en esta pestaña, sin pasar por una
// cotización). El avance/retroceso es del pedido completo.
function renderProgresoTape(p) {
  var estadosDef = estadosDefDe(p);
  var estadoIds = estadosDef.map(function (e) { return e.id; });
  var idx = estadoIds.indexOf(p.estado);
  if (idx < 0) idx = 0; // por seguridad, si el estado guardado ya no existe en la lista
  return '<div class="tape-track"><div class="tape-fill" style="width:' + (idx / (estadosDef.length - 1) * 100) + '%;"></div></div>' +
    '<div class="tape-labels">' + estadosDef.map(function (e, i) { return '<span class="' + (i <= idx ? "current" : "") + '">' + esc(e.label) + "</span>"; }).join("") + "</div>" +
    '<div class="pedido-actions" style="margin-top:6px;">' +
    '<span class="accion-grupo">' +
    (idx > 0 ? '<button class="btn ghost small" data-action="retreat" data-id="' + p.id + '">← Retroceder</button>' : "") +
    (idx < estadosDef.length - 1 ? '<button class="btn small" data-action="advance" data-id="' + p.id + '">Avanzar a ' + esc(estadosDef[idx + 1].label) + " →</button>" : "") +
    "</span></div>";
}

// Un pedido salido de una cotización con varias (o incluso una sola)
// referencias muestra el progreso de CADA UNA por separado — antes se veía
// un solo "tape" para todo el pedido, que no dejaba ver que una pieza podía
// ir más atrasada que otra.
function renderProgresoPorReferencia(p, cot, refs) {
  var html = '<div class="pedido-refs-progreso">';
  refs.forEach(function (r) {
    var def = estadosDefDeRef(r);
    var idx = estadoIdxRef(r);
    html += '<div class="pedido-ref-progreso">' +
      '<span class="pedido-ref-nombre">' + esc(r.nombre || "Referencia") + "</span>" +
      '<span class="pedido-ref-etapa">' + esc(def[idx].label) + "</span>" +
      '<span class="pedido-ref-frac">' + (idx + 1) + "/" + def.length + "</span>" +
      '<span class="pedido-ref-btns">' +
      '<button class="btn ghost small" ' + (idx === 0 ? "disabled" : "") + ' data-action="retreat-ref" data-pedido="' + p.id + '" data-cot="' + cot.id + '" data-ref="' + r.id + '" title="Retroceder">←</button>' +
      '<button class="btn ghost small" ' + (idx === def.length - 1 ? "disabled" : "") + ' data-action="advance-ref" data-pedido="' + p.id + '" data-cot="' + cot.id + '" data-ref="' + r.id + '" title="Avanzar">→</button>' +
      "</span>" +
      "</div>";
  });
  html += "</div>";
  return html;
}

// Tarjeta de un pedido en consignación: no usa el "tape" de etapas de
// producción (ya está producido, lo que se sigue acá es cuánto queda en el
// punto) ni el panel de dinero/saldo normal (el dinero entra recién cuando
// el punto reporta una venta real, no de una vez al crear el pedido).
function renderPedidoConsignacion(p) {
  var c = p.consignacion;
  var disponible = calcConsignacionDisponible(p);
  var vendida = calcConsignacionVendida(p);
  var retirada = calcConsignacionRetirada(p);
  var ventas = (c.ventas || []).slice().reverse();
  var porTalla = calcConsignacionDisponiblePorTalla(p);

  var html = '<div class="pedido-card" data-pedido-id="' + p.id + '">' +
    '<div class="pedido-top"><div>' +
    '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;">' + esc(p.numeroOp || "—") + "</span> " +
    '<span class="pedido-cliente">' + esc(p.cliente) + "</span>" +
    '<span class="pedido-tipo">🏬 Consignación</span>' +
    '<div class="pedido-meta">' + esc(p.descripcion) + (p.fechaEntrega ? " · entrega " + esc(p.fechaEntrega) : "") + "</div>" +
    "</div><div class=\"pedido-money\">" +
    '<div class="total">' + disponible + " disp.</div>" +
    '<div class="saldo ' + (disponible > 0 ? "" : "ok") + '">' + vendida + " vendidas · " + retirada + " retiradas</div>" +
    "</div></div>" +
    '<div class="pedido-actions" style="flex-wrap:wrap;">' +
    renderVentaFormConsignacion(p, porTalla) +
    renderRetiroFormConsignacion(p, porTalla) +
    '<button class="btn danger small" style="margin-left:auto;" data-action="remove-pedido" data-id="' + p.id + '">Eliminar</button>' +
    "</div>";

  if (num(c.cantidadEnviada) > 0) {
    html += '<div class="section-sub" style="margin:10px 0 4px;">Envío inicial (sin desglose): ' + num(c.cantidadEnviada) + " unidades a " + fmt(c.precioUnitario) + " c/u</div>";
  }
  html += '<div class="section-sub" style="margin:4px 0 4px;">Comisión del punto: ' + (c.comisionTipo === "fijo" ? fmt(c.comisionValor) + " por unidad" : c.comisionValor + "% por venta") + "</div>";

  html += '<hr class="stitch" />';
  html += renderRemisionSection(p);

  if (porTalla.length) {
    html += '<hr class="stitch" />';
    html += renderSeguimientoTalla(p, porTalla);
  }

  if (ventas.length) {
    html += '<hr class="stitch" />';
    html += '<div class="cot-col-title">Ventas reportadas</div>';
    html += '<div class="tx-row head" style="grid-template-columns:90px 70px 100px 100px 110px;"><span>Fecha</span><span>Cant.</span><span>Monto</span><span>Comisión</span><span></span></div>';
    ventas.forEach(function (v) {
      html += '<div class="tx-row" style="grid-template-columns:90px 70px 100px 100px 110px;">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(v.fecha || "—") + "</span>" +
        '<span class="mobile-th">Cant.</span><span>' + esc(v.cantidad) + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount">' + fmt(v.montoTotal) + "</span>" +
        '<span class="mobile-th">Comisión</span><span class="amount">' + fmt(v.comisionMonto) + "</span>" +
        "<span>" + (v.comisionPagada
          ? '<span class="status-pill pagado">pagada</span>'
          : '<button class="btn ghost small" data-action="pagar-comision-consignacion" data-id="' + p.id + '" data-venta="' + v.id + '">Pagar comisión</button>') +
        "</span></div>";
    });
  }

  html += "</div>";
  return html;
}

// Igual que antes si el pedido no tiene remisiones (un solo precio para todo
// el envío) — si ya tiene remisiones, agrega el selector de a qué línea
// producto+talla corresponde, para que el seguimiento por talla cuadre.
function renderVentaFormConsignacion(p, porTalla) {
  var opciones = porTalla.filter(function (t) { return t.disponible > 0; });
  var html = '<span class="inline-form" style="flex-wrap:wrap;">';
  if (porTalla.length) {
    html += '<select class="mini-input" data-role="consig-venta-item" style="width:210px">' +
      '<option value="">Producto y talla…</option>' +
      opciones.map(function (t) { return '<option value="' + t.productoId + "|" + esc(t.talla) + '">' + esc(t.productoNombre) + " (" + esc(t.talla) + ") — " + t.disponible + " disp.</option>"; }).join("") +
      "</select>";
  }
  html += '<input type="number" class="mini-input" data-role="consig-venta-cantidad" placeholder="Cantidad vendida" style="width:130px" min="1" />' +
    '<input type="date" class="mini-input" data-role="consig-venta-fecha" style="width:135px" value="' + todayStr() + '" />' +
    '<button class="btn small" data-action="registrar-venta-consignacion" data-id="' + p.id + '">Registrar venta</button>' +
    "</span>";
  return html;
}
function renderRetiroFormConsignacion(p, porTalla) {
  var opciones = porTalla.filter(function (t) { return t.disponible > 0; });
  var html = '<span class="inline-form" style="flex-wrap:wrap;">';
  if (porTalla.length) {
    html += '<select class="mini-input" data-role="consig-retiro-item" style="width:210px">' +
      '<option value="">Producto y talla…</option>' +
      opciones.map(function (t) { return '<option value="' + t.productoId + "|" + esc(t.talla) + '">' + esc(t.productoNombre) + " (" + esc(t.talla) + ") — " + t.disponible + " disp.</option>"; }).join("") +
      "</select>";
  }
  html += '<input type="number" class="mini-input" data-role="consig-retiro-cantidad" placeholder="Cantidad retirada" style="width:130px" min="1" />' +
    '<button class="btn ghost small" data-action="registrar-retiro-consignacion" data-id="' + p.id + '">Registrar retiro</button>' +
    "</span>";
  return html;
}

// Desglose de disponible/vendida/retirada POR producto+talla — solo existe
// para lo que se envió vía remisión (lo viejo, sin desglose, sigue sumando
// al total agregado de arriba, pero no puede aparecer aquí por talla).
function renderSeguimientoTalla(p, porTalla) {
  var COLS = "1fr 80px 90px 90px 90px 90px";
  var html = '<div class="cot-col-title">Seguimiento por talla' + renderHelp("Cuánto se ha entregado, vendido y retirado de CADA producto/talla enviado por remisión. \"Disponible\" es lo que en teoría sigue en el punto.") + "</div>";
  html += '<div class="tx-row head" style="grid-template-columns:' + COLS + ';"><span>Producto</span><span>Talla</span><span>Enviado</span><span>Vendida</span><span>Retirada</span><span>Disponible</span></div>';
  porTalla.forEach(function (t) {
    html += '<div class="tx-row" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">Producto</span><span>' + esc(t.productoNombre) + "</span>" +
      '<span class="mobile-th">Talla</span><span>' + esc(t.talla) + "</span>" +
      '<span class="mobile-th">Enviado</span><span>' + t.enviado + "</span>" +
      '<span class="mobile-th">Vendida</span><span>' + t.vendida + "</span>" +
      '<span class="mobile-th">Retirada</span><span>' + t.retirada + "</span>" +
      '<span class="mobile-th">Disponible</span><span class="amount ' + (t.disponible > 0 ? "" : "pos") + '">' + t.disponible + "</span>" +
      "</div>";
  });
  return html;
}

// Historial de remisiones (envíos con soporte en PDF) + el constructor de
// una nueva: se van agregando líneas de producto+talla+cantidad ANTES de
// confirmar, para que una entrega con varios productos/tallas quede en UN
// solo documento en vez de uno por línea (ver state.remisionBuilder).
function renderRemisionSection(p) {
  var remisiones = (p.consignacion.remisiones || []).slice().reverse();
  var builder = state.remisionBuilder;
  var construyendo = builder.pedidoId === p.id;
  var html = '<div class="cot-col-title">Remisiones (entregas al punto)' +
    renderHelp("Cada vez que le llevas más mercancía a este punto, registra una remisión: eliges producto, talla y cantidad del catálogo, el stock del taller baja solo, y queda un PDF firmable como sustento de lo entregado.") +
    "</div>";

  if (!construyendo) {
    html += '<div class="pedido-actions" style="margin-top:0;"><button class="btn ghost small" data-action="iniciar-remision" data-id="' + p.id + '">+ Agregar remisión</button></div>';
  } else {
    var productos = state.productos || [];
    var prodSel = builder.productoSel ? productoById(builder.productoSel) : null;
    html += '<div class="inline-form" style="flex-wrap:wrap;margin-top:0;">' +
      '<select class="mini-input" data-action-change="set-remision-producto-sel" style="width:200px">' +
      '<option value="">Elegir producto…</option>' +
      productos.map(function (pr) { return '<option value="' + pr.id + '" ' + (pr.id === builder.productoSel ? "selected" : "") + ">" + esc(pr.nombre) + "</option>"; }).join("") +
      "</select>";
    if (prodSel) {
      var tallasDisp = (prodSel.variantesTalla || []).filter(function (t) { return num(t.stock) > 0; });
      if (!tallasDisp.length) {
        html += '<span class="tag" style="background:var(--danger-soft);color:var(--danger-ink);">Sin stock disponible</span>';
      } else {
        html += '<select class="mini-input" data-role="remision-talla" style="width:150px">' +
          tallasDisp.map(function (t) { return '<option value="' + esc(t.talla) + '">' + esc(t.talla) + " (" + num(t.stock) + " disp.)</option>"; }).join("") +
          "</select>" +
          '<input type="number" class="mini-input" data-role="remision-cantidad" placeholder="Cantidad" style="width:100px" min="1" />' +
          '<button class="btn ghost small" data-action="add-remision-linea" data-id="' + p.id + '">+ Agregar línea</button>';
      }
    }
    html += "</div>";
    if (builder.items.length) {
      html += '<div class="tx-row head" style="grid-template-columns:1fr 80px 80px 30px;"><span>Producto</span><span>Talla</span><span>Cantidad</span><span></span></div>';
      builder.items.forEach(function (it, i) {
        html += '<div class="tx-row" style="grid-template-columns:1fr 80px 80px 30px;">' +
          '<span class="mobile-th">Producto</span><span>' + esc(it.productoNombre) + "</span>" +
          '<span class="mobile-th">Talla</span><span>' + esc(it.talla) + "</span>" +
          '<span class="mobile-th">Cantidad</span><span>' + it.cantidad + "</span>" +
          '<button class="btn danger small" data-action="quitar-remision-linea" data-idx="' + i + '">✕</button>' +
          "</div>";
      });
    } else {
      html += '<div class="empty" style="padding:8px 0;">Agrega al menos una línea antes de confirmar.</div>';
    }
    html += '<div class="pedido-actions" style="margin-top:8px;">' +
      '<button class="btn small" ' + (builder.items.length ? "" : "disabled") + ' data-action="confirmar-remision" data-id="' + p.id + '">Confirmar remisión y descontar stock</button>' +
      '<button class="btn ghost small" data-action="cancelar-remision">Cancelar</button>' +
      "</div>";
  }

  if (remisiones.length) {
    html += '<div class="tx-row head" style="margin-top:10px;grid-template-columns:90px 1fr 110px;"><span>Fecha</span><span>Contenido</span><span></span></div>';
    remisiones.forEach(function (r) {
      var resumen = (r.items || []).map(function (it) { return esc(it.productoNombre) + " (" + esc(it.talla) + ") x" + it.cantidad; }).join(", ");
      html += '<div class="tx-row" style="grid-template-columns:90px 1fr 110px;">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(r.fecha) + "</span>" +
        '<span class="mobile-th">Contenido</span><span>' + resumen + "</span>" +
        '<span style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<button class="btn ghost small" data-action="generar-pdf-remision" data-id="' + p.id + '" data-remision="' + r.id + '">📄 PDF</button>' +
        '<button class="btn ghost small" data-action="enviar-remision-correo" data-id="' + p.id + '" data-remision="' + r.id + '" title="Envía la remisión al correo del punto">✉</button>' +
        "</span></div>";
    });
  } else if (!construyendo) {
    html += '<div class="empty" style="padding:8px 0;">Sin remisiones registradas todavía.</div>';
  }
  return html;
}

// Todo lo secundario de la tarjeta (antes amontonado en una sola fila de
// botones difícil de leer) vive aquí, oculto por defecto y dividido en dos
// zonas claras: lo que tiene que ver con dinero, y lo que tiene que ver con
// documentos/PDF.
// Mismo tratamiento que la pestaña Producción de una cotización: título de
// sección chico en mayúsculas (.cot-col-title) en vez de section-title, y los
// botones de PDF pasan de una fila apretada de botones chicos a bloques
// grandes apilados (.cot-doc-btn) — son la acción principal de esta columna,
// no un detalle secundario.
function renderPanelPedido(p, saldo) {
  var html = '<div class="pedido-panel">';

  html += '<div class="pedido-panel-col"><div class="cot-col-title">💰 Dinero</div>';
  html += renderVendedor(p);
  html += (saldo > 0 ? renderAbonoForm(p) : "");
  if (state.reembolsoAbierto === p.id) html += renderReembolsoForm(p);
  html += renderAbonosPedido(p);
  if (num(p.abono) > 0 && state.reembolsoAbierto !== p.id) {
    html += '<button class="btn ghost small" style="margin-top:8px;" data-action="toggle-reembolso-form" data-id="' + p.id + '" title="Registrar que se le devolvió dinero al cliente">↩ Registrar reembolso al cliente</button>';
  }
  html += "</div>";

  html += '<div class="pedido-panel-col"><div class="cot-col-title">📄 PDF y documentos</div>' +
    '<button class="btn ghost cot-doc-btn" data-action="generar-pdf-pedido" data-id="' + p.id + '">📋 Orden de producción</button>' +
    '<button class="btn ghost cot-doc-btn" data-action="generar-pdf-factura" data-id="' + p.id + '">🧾 Factura</button>' +
    '<button class="btn ghost cot-doc-btn" data-action="enviar-factura-correo" data-id="' + p.id + '" title="Envía la factura al correo del cliente (debe estar registrado en Contactos)">✉ Enviar factura</button>';
  // Un pedido convertido desde una cotización nace SIN fecha de entrega (la
  // cotización no la captura) y, hasta ahora, no había forma de agregarla
  // después de creado — quedaba fuera de "Próximas entregas" para siempre.
  // Editable acá para cualquier pedido, en cualquier momento.
  html += '<div class="field" style="margin-top:8px;"><label>Fecha de entrega' +
    renderHelp("Determina si el pedido aparece en \"Próximas entregas\" del Resumen. Si el pedido viene de una cotización convertida, nace sin fecha — agrégala acá.") +
    '</label><input type="date" data-action-change="set-pedido-fecha-entrega" data-id="' + p.id + '" value="' + esc(p.fechaEntrega || "") + '" /></div>';
  html += '<div class="field" style="margin-top:8px;"><label>Observaciones generales del pedido' +
    renderHelp("Para una nota que aplica a todo el pedido, no a una talla en particular (esas se editan en la cotización de origen). Se incluye en el PDF de orden de producción.") +
    '</label><textarea rows="2" data-action-change="set-pedido-obs-generales" data-id="' + p.id + '" placeholder="Ej. Todo el pedido en tela impermeable, entregar en cajas separadas por talla...">' + esc(p.observacionesGenerales || "") + "</textarea></div>";
  html += '<hr class="stitch" style="margin:18px 0 12px;" />';
  html += '<div class="pedido-actions" style="margin-top:0;">' +
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

// Reembolso a un cliente: se registra como una entrada más en p.abonos (con
// tipo:"reembolso") para que quede en el mismo listado cronológico, pero
// RESTA de p.abono en vez de sumar — así el saldo del pedido vuelve a subir
// automáticamente, sin tocar la fórmula calcSaldoPedido (total - abono) que
// ya usa el resto de la app. El movimiento en Finanzas es un "gasto" (plata
// que sale del taller), vinculado al pedido igual que cualquier abono.
function renderReembolsoForm(p) {
  var fr = state.formReembolso;
  var disponible = num(p.abono);
  return '<div class="inline-form" style="flex-wrap:wrap;background:var(--surface-2);border-radius:10px;padding:8px 10px;margin-top:8px;">' +
    '<input type="number" class="mini-input" data-form="reembolso" data-field="monto" value="' + esc(fr.monto) + '" placeholder="Monto (máx. ' + fmt(disponible) + ')" style="width:150px" />' +
    '<input type="date" class="mini-input" data-form="reembolso" data-field="fecha" value="' + esc(fr.fecha || todayStr()) + '" style="width:135px" />' +
    '<input class="mini-input" data-form="reembolso" data-field="motivo" value="' + esc(fr.motivo) + '" placeholder="Motivo (opcional)" style="width:170px" />' +
    '<button class="btn danger small" data-action="add-reembolso" data-id="' + p.id + '">Confirmar reembolso</button>' +
    '<button class="btn ghost small" data-action="toggle-reembolso-form" data-id="' + p.id + '">Cancelar</button>' +
    "</div>";
}

function renderAbonosPedido(p) {
  var abonos = p.abonos || [];
  if (!abonos.length) return "";
  var html = '<div class="section-sub" style="margin-top:8px;">Abonos registrados</div>' +
    '<div class="tx-row head" style="grid-template-columns:100px 90px 110px 1fr 100px;"><span>Fecha</span><span>Monto</span><span>Método</span><span>Comprobante</span><span></span></div>';
  abonos.forEach(function (a) {
    if (a.tipo === "reembolso") {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 100px;">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(a.fecha || "—") + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount neg">-' + fmt(a.monto) + "</span>" +
        '<span class="mobile-th">Método</span><span style="color:var(--danger);font-weight:700;">↩ Reembolso</span>' +
        '<span class="mobile-th">Comprobante</span><span class="muted">' + esc(a.motivo || "—") + "</span>" +
        "<span></span></div>";
      return;
    }
    if (state.abonoEditando === a.id) {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 100px;" data-abono-edit-row="' + a.id + '">' +
        '<span class="mobile-th">Fecha</span><span><input type="date" class="mini-input" style="width:100%" data-role="edit-abono-fecha" value="' + esc(a.fecha || "") + '" /></span>' +
        '<span class="mobile-th">Monto</span><span><input type="number" class="mini-input" style="width:100%" data-role="edit-abono-monto" value="' + esc(a.monto) + '" /></span>' +
        '<span class="mobile-th">Método</span><span><select class="mini-input" style="width:100%" data-role="edit-abono-metodo">' +
        ["efectivo", "transferencia", "tarjeta", "otro"].map(function (m) { return opt(m, m.charAt(0).toUpperCase() + m.slice(1), a.metodoPago || "efectivo"); }).join("") +
        "</select></span>" +
        '<span class="mobile-th">Comprobante</span><span>' + (a.comprobanteUrl ? '<a href="' + esc(a.comprobanteUrl) + '" target="_blank" rel="noopener">Ver comprobante</a>' : '<span class="muted">—</span>') + "</span>" +
        '<span style="display:flex;gap:6px;">' +
        '<button class="btn small" data-action="guardar-abono-edit" data-id="' + p.id + '" data-abono="' + a.id + '">Guardar</button>' +
        '<button class="btn ghost small" data-action="cancelar-edicion-abono">✕</button>' +
        "</span></div>";
    } else {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 100px;">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(a.fecha || "—") + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount">' + fmt(a.monto) + "</span>" +
        '<span class="mobile-th">Método</span><span>' + esc(a.metodoPago || "—") + "</span>" +
        '<span class="mobile-th">Comprobante</span><span>' + (a.comprobanteUrl ? '<a href="' + esc(a.comprobanteUrl) + '" target="_blank" rel="noopener">Ver comprobante</a>' : '<span class="muted">—</span>') + "</span>" +
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
export function sincronizarEventoPedido(p) {
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
  "pedido-vista": function (el) {
    state.pedidosVista = el.getAttribute("data-val");
    notify();
  },
  "filtro-pedidos": function (el) {
    state.filtroPedidos = el.getAttribute("data-val");
    notify();
  },
  "toggle-filtro-saldo": function () {
    state.filtroPedidosSoloSaldo = !state.filtroPedidosSoloSaldo;
    notify();
  },
  // Control segmentado "Venta directa | Consignación" (antes un checkbox que
  // solo se podía alternar, sin poder ver cuál era la otra opción).
  "set-tipo-pedido": function (el) {
    var fp = state.formPedido;
    fp.esConsignacion = el.getAttribute("data-val") === "consignacion";
    // Si el cliente elegido ya tiene una comisión por defecto (punto de
    // consignación registrado en Contactos), se precarga para no repetirla.
    if (fp.esConsignacion && fp.clienteId) {
      var cli = clienteById(fp.clienteId);
      if (cli && cli.comisionDefault) {
        fp.consignacionComisionTipo = cli.comisionDefault.tipo || "porcentaje";
        fp.consignacionComisionValor = cli.comisionDefault.valor || "";
      }
    }
    notify();
  },
  // Deshace exactamente lo que aportó esa línea: la saca de la lista y le
  // resta su subtotal al total (la descripción/cantidad del pedido se
  // recalculan solas a partir de las líneas que queden, ver
  // resumenLineasPedido — no hay texto que "desarmar" a mano).
  "quitar-pedido-producto-linea": function (el) {
    var idx = num(el.getAttribute("data-idx"));
    var fp = state.formPedido;
    var linea = (fp.stockConsumido || [])[idx];
    if (!linea) return;
    fp.stockConsumido = fp.stockConsumido.filter(function (_, i) { return i !== idx; });
    fp.total = Math.max(0, num(fp.total) - num(linea.subtotal));
    notify();
  },
  "abrir-producto-picker-pedido": function () {
    state.pedidoProductoPickerAbierto = true;
    state.pedidoProductoBusqueda = "";
    notify();
  },
  "cerrar-producto-picker-pedido": function () {
    state.pedidoProductoPickerAbierto = false;
    notify();
  },
  "select-producto-pedido-picker": function (el) {
    state.formPedido.productoSel = el.getAttribute("data-id");
    state.pedidoProductoPickerAbierto = false;
    state.pedidoProductoBusqueda = "";
    notify();
  },
  "quitar-pedido-producto-sel": function () {
    state.formPedido.productoSel = "";
    notify();
  },
  // Manda a Catálogo a ver el detalle completo del producto elegido en el
  // picker — sirve para comprobar del todo que es el correcto (foto grande,
  // tallas, etc.) antes de seguir armando el pedido.
  "ver-producto-en-catalogo": function (el) {
    state.tab = "productos";
    state.productoEditando = el.getAttribute("data-id");
    state.productosVista = "nueva";
    notify();
  },
  // Agrega una línea de producto+talla al pedido rápido — el descuento real
  // de stock ocurre recién al confirmar "Crear pedido" (ver "add-pedido"),
  // nunca antes, para no descontar stock de un pedido que al final no se crea.
  "add-pedido-producto-linea": function (el) {
    var productoId = el.getAttribute("data-id");
    var producto = productoById(productoId);
    if (!producto) return;
    var card = el.closest(".card");
    var talla = card ? val(card, "pedido-producto-talla") : "";
    var cantidad = num(card ? val(card, "pedido-producto-cantidad") : 0);
    if (!talla || cantidad <= 0) return;
    var fp = state.formPedido;
    // Resta lo que ESTE mismo borrador ya venía apartando de la misma talla
    // (ej. dos líneas de "M" antes de crear el pedido) — si no se resta acá,
    // cada línea se valida contra el stock TOTAL sin enterarse de la otra, y
    // se puede terminar pidiendo de más (con 1 en stock, agregar la línea dos
    // veces "pasaba" porque cada clic veía el mismo 1 disponible).
    var yaApartado = (fp.stockConsumido || [])
      .filter(function (l) { return l.productoId === productoId && l.talla === talla; })
      .reduce(function (a, l) { return a + num(l.cantidad); }, 0);
    var disponible = stockTalla(producto, talla) - yaApartado;
    if (cantidad > disponible) { window.alert("Cantidad inválida (disponibles: " + disponible + ")."); return; }
    // En consignación no hay "total cobrado" (se factura solo lo que el punto
    // reporte vendido), así que la línea no suma dinero — solo describe lo que
    // se entrega. `subtotal` queda guardado para poder revertirlo si se quita
    // la línea (ver "quitar-pedido-producto-linea").
    var subtotal = fp.esConsignacion ? 0 : num(producto.precioVenta) * cantidad;
    fp.stockConsumido = (fp.stockConsumido || []).concat([{
      productoId: producto.id, productoNombre: producto.nombre, talla: talla, cantidad: cantidad, subtotal: subtotal
    }]);
    fp.total = num(fp.total) + subtotal;
    notify();
  },
  // Línea sin producto de catálogo (ej. "bordado personalizado x3") — solo
  // para venta directa: en consignación toda línea tiene que salir de stock
  // real para poder rastrear qué le queda al punto.
  "add-pedido-texto-linea": function (el) {
    var card = el.closest(".card");
    var descripcion = card ? val(card, "pedido-texto-descripcion") : "";
    var cantidad = num(card ? val(card, "pedido-texto-cantidad") : 0);
    if (!descripcion || cantidad <= 0) return;
    var fp = state.formPedido;
    fp.stockConsumido = (fp.stockConsumido || []).concat([{
      productoId: "", productoNombre: "", talla: "", cantidad: cantidad, subtotal: 0, textoDescripcion: descripcion
    }]);
    notify();
  },
  "add-pedido": function () {
    var fp = state.formPedido;
    var stockConsumido = fp.stockConsumido || [];
    var resumen = resumenLineasPedido(stockConsumido);
    if (!exigirCampos([
      ["Cliente", fp.cliente],
      ["Al menos una línea (producto del catálogo" + (fp.esConsignacion ? "" : " o descrita a mano") + ")", stockConsumido.length ? "x" : ""]
    ])) return;
    var esConsignacion = fp.esConsignacion;
    var abonoInicial = esConsignacion ? 0 : num(fp.abono);
    // Solo las líneas de CATÁLOGO (con productoId) mueven stock real — una
    // línea de texto libre no tiene de dónde descontar. En consignación las
    // líneas de catálogo TAMBIÉN salen del stock (se las lleva el punto),
    // solo que no se registran como venta sino como la primera remisión.
    var lineasProducto = stockConsumido.filter(function (l) { return l.productoId; });
    // Chequeo atómico justo antes de crear nada: si el stock cambió desde que
    // se armaron las líneas (ej. el borrador quedó abierto un rato y otra
    // venta se llevó ese stock mientras tanto), no se crea el pedido a medias
    // — se avisa y se corta acá, sin tocar plata ni stock.
    if (lineasProducto.length) {
      var deficits = validarStockLineas(lineasProducto);
      if (deficits.length) {
        window.alert("No hay stock suficiente para crear este pedido — el stock cambió mientras lo armabas:\n\n" +
          deficits.map(function (d) { return "- " + d.productoNombre + " (" + d.talla + "): pediste " + d.solicitado + ", disponibles " + d.disponible; }).join("\n") +
          "\n\nQuita o ajusta esas líneas e intenta de nuevo.");
        return;
      }
    }
    var nuevoPedido = {
      id: uid(), clienteId: fp.clienteId || "", cliente: fp.cliente, tipoCliente: fp.tipoCliente, descripcion: resumen.descripcion,
      cantidad: String(resumen.cantidad), total: esConsignacion ? 0 : num(fp.total), costo: esConsignacion ? 0 : num(fp.costo), abono: abonoInicial, abonos: [],
      fechaEntrega: fp.fechaEntrega,
      stockConsumido: [], // se completa abajo con lo que en verdad se descontó (ver ajustarStockProducto)
      // Un pedido en consignación ya está producido/listo — no pasa por el
      // tape de etapas, así que nace directo como "entregado" (ver
      // renderPedidoConsignacion, que reemplaza esa parte de la tarjeta).
      // "nuevo" (primer estado de ESTADOS_DEFAULT) — no "cotizacion", que no
      // existe en la lista de estados y dejaba el badge y "Próximas
      // entregas" mostrando el texto crudo en vez de una etapa real.
      estado: esConsignacion ? "entregado" : "nuevo",
      numeroOp: generarNumeroOp(todosNumerosOp()),
      vendedor: (!esConsignacion && fp.vendedorNombre) ? { nombre: fp.vendedorNombre, tipo: fp.vendedorTipo || "porcentaje", valor: num(fp.vendedorValor), estado: "pendiente" } : null,
      consignacion: esConsignacion ? {
        puntoId: fp.clienteId || "", comisionTipo: fp.consignacionComisionTipo || "porcentaje", comisionValor: num(fp.consignacionComisionValor),
        // Todo envío en consignación ahora viene de líneas de catálogo (con
        // desglose por talla en la remisión) — ya no hay un "envío a granel"
        // sin producto ni talla asociados.
        precioUnitario: num(fp.consignacionPrecioUnitario),
        cantidadEnviada: 0,
        ventas: [], retiros: [], remisiones: []
      } : null,
      codigoPublico: codigoPublico(), calendarEventId: ""
    };
    if (abonoInicial > 0) {
      var abonoInicialId = uid();
      nuevoPedido.abonos.push({ id: abonoInicialId, monto: abonoInicial, fecha: todayStr(), metodoPago: "efectivo", comprobanteUrl: "" });
      state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Abono inicial — " + resumen.descripcion, monto: abonoInicial, contraparte: fp.cliente, fecha: todayStr(), pedidoId: nuevoPedido.id, origenAbonoId: abonoInicialId });
      persist("tx");
    }
    // El stock del catálogo baja recién ahora, que el pedido ya es real. Se
    // guarda en el pedido lo REALMENTE descontado (valor de retorno), no lo
    // solicitado — así, si el pedido se elimina más adelante, se restituye
    // exactamente lo mismo que se movió, nunca de más.
    var stockConsumidoReal = [];
    var motivo = esConsignacion ? ("Remisión a " + fp.cliente) : ("Venta directa — " + resumen.descripcion);
    var origen = esConsignacion ? ("consignacion:" + nuevoPedido.id) : ("pedido:" + nuevoPedido.id);
    lineasProducto.forEach(function (l) {
      var aplicado = ajustarStockProducto(l.productoId, l.talla, -l.cantidad, motivo, origen);
      if (aplicado) stockConsumidoReal.push({ productoId: l.productoId, productoNombre: l.productoNombre, talla: l.talla, cantidad: Math.abs(aplicado) });
    });
    if (esConsignacion) {
      // Lo entregado queda como la PRIMERA remisión (con su código público y
      // su PDF firmable), igual que cualquier remisión posterior hecha desde
      // la tarjeta — así el seguimiento por talla funciona desde el día uno.
      // stockConsumido del pedido queda vacío a propósito: en consignación lo
      // entregado se revierte por remisión, no por el pedido completo.
      if (stockConsumidoReal.length) {
        nuevoPedido.consignacion.remisiones.push({
          id: uid(), fecha: todayStr(), codigoPublico: codigoPublico(), items: stockConsumidoReal, nota: ""
        });
      }
    } else {
      nuevoPedido.stockConsumido = stockConsumidoReal;
    }
    state.pedidos.unshift(nuevoPedido);
    state.formPedido = {
      clienteId: "", cliente: "", tipoCliente: "propio", total: "", costo: "", abono: "", fechaEntrega: "",
      vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "",
      esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "",
      productoSel: "", stockConsumido: []
    };
    state.pedidoProductoBusqueda = "";
    // Salta directo al Historial para confirmar de una vez que el pedido
    // quedó creado (con su N.º de OP) — el formulario en blanco queda a un
    // clic de distancia en la otra pestaña.
    state.pedidosVista = "historial";
    persist("pedidos"); notify();
    if (!esConsignacion) sincronizarEventoPedido(nuevoPedido);
  },
  // Si el pedido ya tiene remisiones (ver "Agregar remisión"), el select
  // "consig-venta-item" indica a qué línea producto+talla corresponde la
  // venta (usa el precio de ESA línea) — así el seguimiento por talla
  // (calcConsignacionDisponiblePorTalla) sabe de dónde restar. Si no hay
  // remisiones (consignación creada a la antigua, un solo número), se
  // comporta exactamente igual que siempre: contra el precio único del pedido.
  "registrar-venta-consignacion": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped || !ped.consignacion) return;
    var card = el.closest(".pedido-card");
    var itemEl = card ? card.querySelector('[data-role="consig-venta-item"]') : null;
    var cantidadEl = card ? card.querySelector('[data-role="consig-venta-cantidad"]') : null;
    var fechaEl = card ? card.querySelector('[data-role="consig-venta-fecha"]') : null;
    var cantidad = cantidadEl ? num(cantidadEl.value) : 0;
    var fecha = (fechaEl && fechaEl.value) || todayStr();

    var productoId = "", talla = "", precioUnitario = num(ped.consignacion.precioUnitario), disponible = calcConsignacionDisponible(ped);
    if (itemEl && itemEl.value) {
      var partes = itemEl.value.split("|");
      productoId = partes[0]; talla = partes[1];
      var linea = calcConsignacionDisponiblePorTalla(ped).filter(function (t) { return t.productoId === productoId && t.talla === talla; })[0];
      if (!linea) return;
      precioUnitario = linea.precioUnitario; disponible = linea.disponible;
    } else if (itemEl) {
      // Hay remisiones pero no se eligió ninguna línea: no se puede vender "en general".
      window.alert("Elige a qué producto y talla corresponde la venta.");
      return;
    }
    if (cantidad <= 0 || cantidad > disponible) { window.alert("Cantidad inválida (disponibles: " + disponible + ")."); return; }
    var montoTotal = cantidad * precioUnitario;
    var comisionMonto = calcConsignacionComision(ped.consignacion, cantidad, montoTotal);
    var ventaId = uid();
    state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Venta consignación — " + ped.descripcion, monto: montoTotal, contraparte: ped.cliente, fecha: fecha, pedidoId: ped.id });
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      var ventas = (p.consignacion.ventas || []).concat([{ id: ventaId, cantidad: cantidad, fecha: fecha, montoTotal: montoTotal, comisionMonto: comisionMonto, comisionPagada: false, productoId: productoId, talla: talla }]);
      return Object.assign({}, p, { consignacion: Object.assign({}, p.consignacion, { ventas: ventas }) });
    });
    persist("tx"); persist("pedidos"); notify();
  },
  "registrar-retiro-consignacion": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped || !ped.consignacion) return;
    var card = el.closest(".pedido-card");
    var itemEl = card ? card.querySelector('[data-role="consig-retiro-item"]') : null;
    var cantidadEl = card ? card.querySelector('[data-role="consig-retiro-cantidad"]') : null;
    var cantidad = cantidadEl ? num(cantidadEl.value) : 0;

    var productoId = "", talla = "", disponible = calcConsignacionDisponible(ped);
    if (itemEl && itemEl.value) {
      var partes = itemEl.value.split("|");
      productoId = partes[0]; talla = partes[1];
      var linea = calcConsignacionDisponiblePorTalla(ped).filter(function (t) { return t.productoId === productoId && t.talla === talla; })[0];
      if (!linea) return;
      disponible = linea.disponible;
    } else if (itemEl) {
      window.alert("Elige a qué producto y talla corresponde el retiro.");
      return;
    }
    if (cantidad <= 0 || cantidad > disponible) { window.alert("Cantidad inválida (disponibles: " + disponible + ")."); return; }
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      var retiros = (p.consignacion.retiros || []).concat([{ id: uid(), cantidad: cantidad, fecha: todayStr(), productoId: productoId, talla: talla }]);
      return Object.assign({}, p, { consignacion: Object.assign({}, p.consignacion, { retiros: retiros }) });
    });
    persist("pedidos"); notify();
  },
  // ---------- Remisiones de consignación (entregas con soporte en PDF) ----------
  "iniciar-remision": function (el) {
    state.remisionBuilder = { pedidoId: el.getAttribute("data-id"), productoSel: "", items: [] };
    notify();
  },
  "cancelar-remision": function () {
    state.remisionBuilder = { pedidoId: "", productoSel: "", items: [] };
    notify();
  },
  "set-remision-producto-sel": function (el) {
    state.remisionBuilder = Object.assign({}, state.remisionBuilder, { productoSel: el.value });
    notify();
  },
  "add-remision-linea": function (el) {
    var pedidoId = el.getAttribute("data-id");
    var card = el.closest(".pedido-card");
    var producto = productoById(state.remisionBuilder.productoSel);
    var talla = card ? val(card, "remision-talla") : "";
    var cantidad = num(card ? val(card, "remision-cantidad") : 0);
    if (!producto || !talla || cantidad <= 0) return;
    // Ya descontando lo que se haya agregado antes de confirmar, para no
    // dejar armar una remisión con más de lo que en verdad hay en el taller.
    var yaEnBuilder = state.remisionBuilder.items
      .filter(function (it) { return it.productoId === producto.id && it.talla === talla; })
      .reduce(function (a, it) { return a + it.cantidad; }, 0);
    var disponible = stockTalla(producto, talla) - yaEnBuilder;
    if (cantidad > disponible) { window.alert("Cantidad inválida (disponibles en el taller: " + disponible + ")."); return; }
    state.remisionBuilder = Object.assign({}, state.remisionBuilder, {
      pedidoId: pedidoId,
      items: state.remisionBuilder.items.concat([{ productoId: producto.id, productoNombre: producto.nombre, talla: talla, cantidad: cantidad, precioUnitario: num(producto.precioVenta) }])
    });
    notify();
  },
  "quitar-remision-linea": function (el) {
    var idx = Number(el.getAttribute("data-idx"));
    var items = state.remisionBuilder.items.slice();
    items.splice(idx, 1);
    state.remisionBuilder = Object.assign({}, state.remisionBuilder, { items: items });
    notify();
  },
  "confirmar-remision": function (el) {
    var id = el.getAttribute("data-id");
    var items = state.remisionBuilder.items;
    if (!items.length || state.remisionBuilder.pedidoId !== id) return;
    // Una remisión es un documento formal (va firmado) — a diferencia de la
    // venta directa, acá se BLOQUEA en vez de aplicar parcial si el stock ya
    // no alcanza (ej. cambió mientras se armaba la remisión, con el
    // constructor abierto un rato). Nunca se genera un documento que diga
    // "se entregaron 5" si en realidad solo había 3.
    var deficits = validarStockLineas(items.map(function (it) { return { productoId: it.productoId, talla: it.talla, cantidad: it.cantidad }; }));
    if (deficits.length) {
      window.alert("El stock ya no alcanza para esta remisión (cambió mientras la armabas):\n\n" +
        deficits.map(function (d) { return "- " + d.productoNombre + " (" + d.talla + "): pediste " + d.solicitado + ", disponibles " + d.disponible; }).join("\n") +
        "\n\nAjusta las cantidades y confirma de nuevo.");
      return;
    }
    var remision = { id: uid(), fecha: todayStr(), codigoPublico: codigoPublico(), items: items, nota: "" };
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      return Object.assign({}, p, { consignacion: Object.assign({}, p.consignacion, { remisiones: (p.consignacion.remisiones || []).concat([remision]) }) });
    });
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    items.forEach(function (it) {
      ajustarStockProducto(it.productoId, it.talla, -it.cantidad, "Remisión a " + (ped ? ped.cliente : ""), "consignacion:" + id);
    });
    state.remisionBuilder = { pedidoId: "", productoSel: "", items: [] };
    persist("pedidos"); notify();
  },
  "generar-pdf-remision": function (el) {
    var id = el.getAttribute("data-id"), remisionId = el.getAttribute("data-remision");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped) return;
    var remision = (ped.consignacion.remisiones || []).filter(function (r) { return r.id === remisionId; })[0];
    if (remision) generarPDFRemision(ped, remision);
  },
  "enviar-remision-correo": async function (el) {
    var id = el.getAttribute("data-id"), remisionId = el.getAttribute("data-remision");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped) return;
    var remision = (ped.consignacion.remisiones || []).filter(function (r) { return r.id === remisionId; })[0];
    if (!remision) return;
    var cliente = ped.clienteId ? clienteById(ped.clienteId) : null;
    var correo = cliente && cliente.correo;
    if (!correo) { window.alert('Este punto de consignación no tiene correo registrado. Agrégaselo en la pestaña Contactos para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFRemision(ped, remision, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Remisión — " + (ped.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (ped.cliente || "") + ",",
          mensaje: "Adjuntamos la remisión de lo entregado. Cualquier duda, quedamos atentos."
        }),
        filename: pdf.nombreArchivo,
        bytes: pdf.bytes
      });
      window.alert("Correo enviado a " + correo + ".");
    } catch (e) {
      window.alert("No se pudo enviar el correo: " + (e && e.message ? e.message : e));
    }
  },
  "pagar-comision-consignacion": function (el) {
    var id = el.getAttribute("data-id"), ventaId = el.getAttribute("data-venta");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped || !ped.consignacion) return;
    var venta = (ped.consignacion.ventas || []).filter(function (v) { return v.id === ventaId; })[0];
    if (!venta || venta.comisionPagada) return;
    state.tx.unshift({ id: uid(), tipo: "gasto", concepto: "Comisión consignación — " + ped.cliente, monto: venta.comisionMonto, contraparte: ped.cliente, fecha: todayStr(), pedidoId: ped.id });
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      var ventas = p.consignacion.ventas.map(function (v) { return v.id === ventaId ? Object.assign({}, v, { comisionPagada: true }) : v; });
      return Object.assign({}, p, { consignacion: Object.assign({}, p.consignacion, { ventas: ventas }) });
    });
    persist("tx"); persist("pedidos"); notify();
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
    state.cotizacionEditando = cotId; // abre de una vez el detalle completo de la recién creada
    state.cotizacionesVista = "nueva";
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
    state.tab = "cotizaciones";
    // Abre el detalle completo directo — Historial en Cotizaciones ya no
    // muestra más que tarjetas chicas, así que no hay nada que "expandir" ahí.
    state.cotizacionEditando = cotId;
    state.cotizacionesVista = "nueva";
    notify();
  },
  // Toggle bidireccional: marcar pagada crea el movimiento en Finanzas;
  // desmarcarla (deshacer un clic accidental) lo REVIERTE por completo en vez
  // de solo cambiar la etiqueta — si no, volver a marcarla pagada más tarde
  // crearía un segundo movimiento para la misma comisión (plata duplicada).
  // origenComisionPedidoId es lo que permite encontrar y borrar ESE
  // movimiento puntual sin tocar otros (mismo patrón que remove-cot-gasto).
  "toggle-comision": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped || !ped.vendedor) return;
    var pagando = ped.vendedor.estado !== "pagado";
    if (pagando) {
      var valor = calcComisionValor(ped);
      state.tx.unshift({ id: uid(), tipo: "comision", concepto: "Comisión — " + ped.vendedor.nombre, monto: valor, contraparte: ped.vendedor.nombre, fecha: todayStr(), pedidoId: ped.id, origenComisionPedidoId: id });
    } else {
      state.tx = state.tx.filter(function (t) { return t.origenComisionPedidoId !== id; });
    }
    persist("tx");
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      return Object.assign({}, p, { vendedor: Object.assign({}, p.vendedor, { estado: pagando ? "pagado" : "pendiente" }) });
    });
    persist("pedidos"); notify();
  },
  advance: function (el) { moveEstado(el, 1); },
  retreat: function (el) { moveEstado(el, -1); },
  "advance-ref": function (el) { moveEstadoRef(el, 1); },
  "retreat-ref": function (el) { moveEstadoRef(el, -1); },
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
  "toggle-reembolso-form": function (el) {
    var id = el.getAttribute("data-id");
    state.reembolsoAbierto = state.reembolsoAbierto === id ? "" : id;
    state.formReembolso = { monto: "", fecha: todayStr(), motivo: "" };
    notify();
  },
  "add-reembolso": function (el) {
    var id = el.getAttribute("data-id");
    var ped = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (!ped) return;
    var fr = state.formReembolso;
    var monto = num(fr.monto);
    var disponible = num(ped.abono);
    if (!monto || monto <= 0) return;
    if (monto > disponible) { window.alert("No puedes reembolsar más de lo que el cliente ha abonado (" + fmt(disponible) + ")."); return; }
    if (!window.confirm('¿Registrar un reembolso de ' + fmt(monto) + ' a "' + ped.cliente + '"?\n\nEsto crea un movimiento de gasto en Finanzas y reduce el abono registrado de este pedido.')) return;
    var reembolsoId = uid();
    var fecha = fr.fecha || todayStr();
    state.tx.unshift({ id: uid(), tipo: "gasto", concepto: "Reembolso — " + ped.descripcion + (fr.motivo ? " (" + fr.motivo + ")" : ""), monto: monto, contraparte: ped.cliente, fecha: fecha, pedidoId: ped.id });
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      var abonos = (p.abonos || []).concat([{ id: reembolsoId, monto: monto, fecha: fecha, tipo: "reembolso", motivo: fr.motivo || "", comprobanteUrl: "" }]);
      return Object.assign({}, p, { abonos: abonos, abono: Math.max(0, num(p.abono) - monto) });
    });
    state.reembolsoAbierto = "";
    state.formReembolso = { monto: "", fecha: todayStr(), motivo: "" };
    persist("tx"); persist("pedidos"); notify();
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
    // El stock sí se restituye solo (más abajo), pero la plata que este
    // pedido ya generó en Finanzas (abonos, comisión pagada, ventas de
    // consignación) NO se toca ni se borra al eliminarlo — eliminar el
    // pedido no debe hacer parecer que ese dinero nunca entró/salió. Se
    // avisa acá para que quede claro antes de confirmar, no después.
    var dineroVinculado = num(pedido.abono);
    if (pedido.vendedor && pedido.vendedor.estado === "pagado") dineroVinculado += calcComisionValor(pedido);
    if (pedido.consignacion) dineroVinculado += (pedido.consignacion.ventas || []).reduce(function (a, v) { return a + num(v.montoTotal); }, 0);
    var avisoDinero = dineroVinculado > 0 ? ("\n\nOjo: este pedido ya tiene " + fmt(dineroVinculado) + " en movimientos de Finanzas (abonos/comisión/ventas) — esos movimientos NO se eliminan ni se revierten solos.") : "";
    if (!window.confirm('¿Eliminar el pedido "' + pedido.numeroOp + " — " + pedido.descripcion + '"?\n\nSe mueve a la papelera de pedidos y puedes restaurarlo si fue un error.' + avisoDinero)) return;
    state.pedidos = state.pedidos.filter(function (p) { return p.id !== id; });
    state.pedidosPapelera.unshift(Object.assign({}, pedido, { eliminadoEl: todayStr() }));
    persist("pedidos"); persist("pedidosPapelera"); notify();
    if (pedido.calendarEventId) eliminarEvento(pedido.calendarEventId).catch(function (e) { console.error("No se pudo borrar el evento de Calendar del pedido", e); });
    // Se restituye el stock que este pedido había consumido — si se restaura
    // luego desde la papelera, se vuelve a descontar (ver "restaurar-pedido").
    (pedido.stockConsumido || []).forEach(function (l) {
      ajustarStockProducto(l.productoId, l.talla, l.cantidad, "Pedido eliminado — restitución", "pedido:" + pedido.id);
    });
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
    // Vuelve a descontar el stock que se le había restituido al eliminarlo.
    // Si mientras estuvo en la papelera ese stock ya se vendió por otro lado,
    // se guarda en el pedido restaurado lo que en verdad se pudo volver a
    // apartar (no lo que tenía antes) y se avisa — nunca debe quedar
    // reclamando stock que ya no existe.
    var stockConsumidoReal = [];
    var faltantes = [];
    (restaurado.stockConsumido || []).forEach(function (l) {
      var aplicado = Math.abs(ajustarStockProducto(l.productoId, l.talla, -l.cantidad, "Pedido restaurado desde la papelera", "pedido:" + restaurado.id));
      if (aplicado) stockConsumidoReal.push({ productoId: l.productoId, productoNombre: l.productoNombre, talla: l.talla, cantidad: aplicado });
      if (aplicado < l.cantidad) faltantes.push({ productoNombre: l.productoNombre, talla: l.talla, faltan: l.cantidad - aplicado });
    });
    restaurado.stockConsumido = stockConsumidoReal;
    state.pedidos.unshift(restaurado);
    persist("pedidos"); persist("pedidosPapelera"); notify();
    sincronizarEventoPedido(restaurado);
    if (faltantes.length) {
      window.alert('Se restauró el pedido "' + restaurado.numeroOp + '", pero parte del stock que tenía reservado ya se vendió mientras estuvo en la papelera:\n\n' +
        faltantes.map(function (f) { return "- " + f.productoNombre + " (" + f.talla + "): faltaron " + f.faltan; }).join("\n"));
    }
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
  "set-pedido-fecha-entrega": function (el) {
    var id = el.getAttribute("data-id");
    state.pedidos = state.pedidos.map(function (p) { return p.id === id ? Object.assign({}, p, { fechaEntrega: el.value }) : p; });
    persist("pedidos"); notify();
    var actualizado = state.pedidos.filter(function (p) { return p.id === id; })[0];
    if (actualizado) sincronizarEventoPedido(actualizado);
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
    if (!correo) { window.alert('Este cliente no tiene correo registrado. Agrégaselo en la pestaña Contactos para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFFactura(ped, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Factura — " + (ped.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (ped.cliente || "") + ",",
          mensaje: "Adjuntamos la factura de \"" + (ped.descripcion || "tu pedido") + "\". Gracias por tu confianza."
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
    if (!correo) { window.alert('Este cliente no tiene correo registrado. Agrégaselo en la pestaña Contactos para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFRecibo(ped, abono, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Recibo de abono — " + (ped.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (ped.cliente || "") + ",",
          mensaje: "Adjuntamos el recibo correspondiente a tu abono. Gracias por tu pago."
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

// Avanza/retrocede la etapa de UNA referencia dentro de la cotización de
// origen del pedido (ahí vive el progreso real — ver calc.js:
// estadoAgregadoDeCot). Después de mover la referencia, el pedido recalcula
// su propio `estado`/`estadosDef` a partir de la referencia menos avanzada,
// para que el filtro por etapa, el KPI "Pedidos activos" y el PDF de
// producción (que solo conocen un estado por pedido) sigan reflejando la
// realidad sin tener que tocarlos.
function moveEstadoRef(el, dir) {
  var pedidoId = el.getAttribute("data-pedido"), cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
  var cotActualizada = null;
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    var refs = (c.referencias || []).map(function (r) {
      if (r.id !== refId) return r;
      var estadoIds = estadosDefDeRef(r).map(function (e) { return e.id; });
      var idx = estadoIdxRef(r);
      var nidx = dir > 0 ? Math.min(idx + 1, estadoIds.length - 1) : Math.max(idx - 1, 0);
      return Object.assign({}, r, { estado: estadoIds[nidx] });
    });
    cotActualizada = Object.assign({}, c, { referencias: refs });
    return cotActualizada;
  });
  if (!cotActualizada) return;
  var agregado = estadoAgregadoDeCot(cotActualizada);
  state.pedidos = state.pedidos.map(function (p) {
    if (p.id !== pedidoId) return p;
    return Object.assign({}, p, { estado: agregado ? agregado.estado : p.estado, estadosDef: agregado ? agregado.estadosDef : null });
  });
  persist("cotizaciones"); persist("pedidos"); notify();
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
