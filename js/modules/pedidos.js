import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, generarNumeroOp, codigoPublico, exigirCampos } from "../core/utils.js";
import { ESTADOS, ESTADO_LABEL, ESTADOS_DEFAULT } from "../core/constants.js";
import { clienteById, calcComisionValor, estadosDefDe, estadoLabelDe, calcConsignacionDisponible, calcConsignacionVendida, calcConsignacionRetirada, calcConsignacionComision, calcConsignacionDisponiblePorTalla, estadosDefDeRef, estadoIdxRef, estadoAgregadoDeCot, productoById, stockTalla, validarStockLineas, calcTotalesLineasPedido, calcCostoUnitarioProducto, calcAbonadoDeLista } from "../core/calc.js";
import { fmt, norm } from "../core/utils.js";
import { renderClienteCombo, renderHelp } from "../core/components.js";
import { generarPDFPedido, generarPDFRecibo, generarPDFFactura, generarPDFRemision } from "../core/pdf.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { sincronizarEvento, eliminarEvento, eventoUnDia } from "../core/calendar.js";
import { getSession } from "../core/auth.js";
import { ajustarStockProducto } from "../core/stock.js";
import { subirImagenReferencia } from "../core/drive.js";

// Nuevo total abonado de un pedido después de agregar, editar o eliminar una
// fila de su lista de abonos. Todo lo que toque esa lista pasa por acá, así
// `p.abono` (de donde sale el saldo por cobrar de toda la app) nunca puede
// separarse de las filas que lo sustentan.
//
// Dos sutilezas que ya costaron plata:
//  - Los reembolsos viven en la misma lista pero RESTAN (ver
//    calcAbonadoDeLista en core/calc.js). Sumarlos como abonos hacía
//    desaparecer un saldo por cobrar real al editar cualquier abono de un
//    pedido que ya tuviera un reembolso.
//  - Los pedidos anteriores a que existiera la lista guardan el total abonado
//    sin ninguna fila detrás. Recalcular solo desde la lista los dejaría en
//    cero; por eso lo que ya estaba abonado y no está representado en ninguna
//    fila se conserva como base. Con datos normales esa base es 0 y el
//    resultado es exactamente la suma de la lista.
function recalcularAbonoPedido(pedido, nuevaLista) {
  var baseSinRespaldo = num(pedido.abono) - calcAbonadoDeLista(pedido.abonos);
  return Math.max(0, baseSinRespaldo) + calcAbonadoDeLista(nuevaLista);
}

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

// Suma la cantidad y arma la descripción de un pedido a partir de sus líneas
// — se calcula siempre a partir de ellas, nunca se escribe a mano, para que
// sea imposible crear un pedido de "1 und" sin que quede claro 1 und DE QUÉ.
function resumenLineasPedido(lineas) {
  lineas = lineas || [];
  var cantidad = lineas.reduce(function (a, l) { return a + num(l.cantidad); }, 0);
  var descripcion = lineas.map(function (l) {
    var nombre = (l.productoNombre || l.textoDescripcion || "Sin describir").trim();
    return nombre + (l.talla ? " (" + l.talla + ")" : "") + " x" + num(l.cantidad);
  }).join(", ");
  return { cantidad: cantidad, descripcion: descripcion };
}

// Qué le falta al borrador para poder crearse. Devolver la lista (en vez de
// un booleano) permite decir exactamente qué falta al lado del botón, en vez
// de dejarlo deshabilitado sin explicación o de avisar recién al enviar.
function faltantesPedido(f) {
  var out = [];
  var lineas = f.lineas || [];
  if (!(f.cliente || "").trim()) out.push(f.esConsignacion ? "el punto de consignación" : "el cliente");
  if (!lineas.length) {
    out.push(f.esConsignacion ? "al menos un producto del catálogo" : "al menos una línea");
  } else {
    var sinNombre = lineas.filter(function (l) { return !(l.productoNombre || "").trim(); }).length;
    if (sinNombre) out.push("describir " + sinNombre + " línea(s)");
    var sinCantidad = lineas.filter(function (l) { return num(l.cantidad) <= 0; }).length;
    if (sinCantidad) out.push("la cantidad de " + sinCantidad + " línea(s)");
  }
  if (f.esConsignacion && num(f.consignacionPrecioUnitario) <= 0) out.push("el precio al público del punto");
  return out;
}

// Formulario de pedido rápido. No es un asistente por pasos: es un formulario
// normal cuyas secciones y campos CAMBIAN según lo que se elija. El tipo de
// pedido va primero porque es lo que más lo reestructura (venta directa pide
// precio y pago; consignación pide condiciones con el punto), y el resto se
// va llenando de información a medida que se agregan líneas. El camino por
// defecto —venta directa, un producto del catálogo— está a la vista sin
// tener que configurar nada.
function renderFormNuevoPedido() {
  var f = state.formPedido;
  var lineas = f.lineas || [];
  var totales = calcTotalesLineasPedido(lineas);
  var faltantes = faltantesPedido(f);

  var html = '<div class="card"><div class="section-title small">Nuevo pedido rápido' +
    renderHelp("Para lo del día a día que no necesita pasar por una cotización completa: stock, cosas sencillas, sin personalización. Si el pedido escala y necesitas cotizar insumos y márgenes en detalle, créalo en Cotizaciones y conviértelo en pedido.") +
    "</div>";

  html += '<div class="cot-col-title" style="margin-top:2px;">Tipo de pedido' +
    renderHelp("Venta directa: le vendes al cliente y cobras (de una o con abonos). Consignación: le dejas mercancía a un punto de venta externo sin cobrarla todavía — solo facturas lo que el punto reporte como vendido, y él se queda con una comisión por cada venta.") +
    "</div>" +
    '<div class="segmented">' +
    '<button class="segmented-opcion ' + (f.esConsignacion ? "" : "active") + '" data-action="set-tipo-pedido" data-val="venta">🧾 Venta directa</button>' +
    '<button class="segmented-opcion ' + (f.esConsignacion ? "active" : "") + '" data-action="set-tipo-pedido" data-val="consignacion">🏬 Consignación</button>' +
    "</div>";

  html += '<div class="form-grid" style="margin-top:14px;">' +
    renderClienteCombo("pedido", "pedido-cliente-nombre", f) +
    '<div class="field"><label>Origen</label><select data-form="pedido" data-field="tipoCliente">' + opt("propio", "Producción propia", f.tipoCliente) + opt("tercero", "Tercero", f.tipoCliente) + "</select></div>" +
    '<div class="field"><label>Fecha de entrega</label><input type="date" data-form="pedido" data-field="fechaEntrega" value="' + esc(f.fechaEntrega) + '" /></div>' +
    "</div>";

  html += '<hr class="stitch" />';
  html += '<div class="cot-col-title">Qué incluye este pedido' +
    renderHelp(f.esConsignacion
      ? "Elige del catálogo lo que le dejas al punto — queda como su primera remisión (con PDF) y el stock del taller baja al crear el pedido."
      : "Cada línea define qué es, cuánta cantidad y a qué precio. De ahí salen solos el total, el costo y la ganancia del pedido: nunca hay una cantidad suelta sin decir de qué, ni un total que diga algo distinto de lo que se está vendiendo.") +
    "</div>";
  html += renderLineasPedido(f);

  html += '<hr class="stitch" />';
  html += f.esConsignacion ? renderCondicionesConsignacion(f, totales) : renderPrecioYPago(f, totales);

  html += '<div style="margin-top:22px;">' +
    '<button class="btn" ' + (faltantes.length ? "disabled" : "") + ' data-action="add-pedido">' +
    (f.esConsignacion ? "Crear consignación y remisión" : "Crear pedido") + "</button>" +
    (faltantes.length ? '<div class="section-sub" style="margin-top:8px;">Para crearlo falta ' + esc(faltantes.join(", ")) + ".</div>" : "") +
    "</div>";
  html += "</div>"; // .card
  html += renderProductoPickerPedido();
  return html;
}

// ---------- Líneas del pedido ----------
// Una línea es "qué se está vendiendo": puede venir del catálogo (con su
// foto, precio y stock por talla) o escribirse a mano para lo que no está
// catalogado (un bordado, un arreglo). Las dos viven en la MISMA lista y se
// editan igual — antes el producto elegido aparecía en dos lugares a la vez
// (el resultado de la búsqueda y la tabla), y lo escrito a mano no se podía
// ni corregir ni describir. El stock real se descuenta recién al confirmar
// "Crear pedido" (ver la acción "add-pedido"), nunca antes.
function renderLineasPedido(f) {
  var lineas = f.lineas || [];
  var html = '<div class="row-actions" style="margin-bottom:12px;flex-wrap:wrap;">' +
    '<button class="btn ghost small" data-action="abrir-producto-picker-pedido">🔍 Elegir del catálogo</button>' +
    (f.esConsignacion ? "" : '<button class="btn ghost small" data-action="add-pedido-linea-libre">✎ Algo que no está en el catálogo</button>') +
    "</div>";

  if (!lineas.length) {
    html += '<div class="empty">Sin líneas todavía — ' +
      (f.esConsignacion
        ? "elige del catálogo lo que le vas a dejar al punto."
        : "elige un producto del catálogo, o describe a mano lo que no esté ahí.") +
      "</div>";
    return html;
  }

  lineas.forEach(function (l) { html += renderLineaPedido(f, l); });

  var totales = calcTotalesLineasPedido(lineas);
  html += '<div class="section-sub" style="margin:10px 0 0;">' + totales.unidades + " unidad(es) en total · " +
    (f.esConsignacion ? "salen del stock del taller al crear el pedido." : "las de catálogo se descuentan del stock al crear el pedido.") + "</div>";
  return html;
}

function renderLineaPedido(f, l) {
  var esCatalogo = l.tipo === "catalogo";
  var producto = esCatalogo && l.productoId ? productoById(l.productoId) : null;
  var attrs = ' data-action-change="set-pedido-linea-campo" data-linea="' + l.id + '"';
  var subtotal = num(l.precioUnitario) * num(l.cantidad);

  var html = '<div class="pedido-linea">';

  // --- Cabecera: foto, qué es, y accesos directos ---
  html += '<div class="pedido-linea-top">' + renderLineaThumb(l, producto) + '<div class="pedido-linea-id">';
  if (esCatalogo) {
    var meta = producto ? [producto.referencia, producto.categoria].filter(Boolean).join(" · ") : "";
    html += "<b>" + esc(l.productoNombre || "—") + "</b>" +
      '<div class="section-sub" style="margin:2px 0 0;">' + (meta ? esc(meta) + " · " : "") +
      (producto && producto.origen === "proveedor" ? "📦 de proveedor" : "🧵 del taller") + "</div>";
  } else {
    html += '<input class="mini-input" style="width:100%;font-weight:700;" placeholder="¿Qué es? (ej. bordado personalizado)" value="' + esc(l.productoNombre || "") + '"' + attrs + ' data-campo="productoNombre" />' +
      '<div class="section-sub" style="margin:2px 0 0;">✎ Escrito a mano — no está en el catálogo, no mueve stock</div>';
  }
  html += "</div>" +
    '<div class="pedido-linea-acciones">' +
    (esCatalogo && producto ? '<button class="btn ghost small" data-action="ver-producto-en-catalogo" data-id="' + producto.id + '" title="Abrir este producto en el Catálogo">Ver en Catálogo ↗</button>' : "") +
    '<button class="btn danger small" data-action="quitar-pedido-linea" data-linea="' + l.id + '" title="Quitar esta línea">✕</button>' +
    "</div></div>";

  // --- Datos básicos: talla, cantidad, precio, costo ---
  html += '<div class="pedido-linea-campos">';
  html += '<span class="field"><label>Talla</label>' + renderLineaTalla(f, l, producto, attrs) + "</span>";
  html += '<span class="field"><label>Cantidad</label><input type="number" min="1" class="mini-input" value="' + esc(l.cantidad) + '"' + attrs + ' data-campo="cantidad" /></span>';
  html += '<span class="field"><label>Precio x1</label><input type="number" class="mini-input" value="' + esc(l.precioUnitario) + '" placeholder="0"' + attrs + ' data-campo="precioUnitario" /></span>';
  html += '<span class="field"><label>Costo x1' + renderHelp("Lo que te cuesta a ti esta unidad. Si viene del catálogo llega calculado (insumos, o costo de compra si es de proveedor); puedes ajustarlo para este pedido puntual.") + '</label><input type="number" class="mini-input" value="' + esc(l.costoUnitario) + '" placeholder="0"' + attrs + ' data-campo="costoUnitario" /></span>';
  html += '<span class="field"><label>Subtotal</label><span class="amount" style="align-self:center;">' + fmt(subtotal) + "</span></span>";
  html += "</div>";

  // --- Observación y campos propios de esta línea ---
  html += '<input class="mini-input" style="width:100%;margin-top:8px;" placeholder="Observación de esta línea (ej. estampado al frente, entregar sin doblar)" value="' + esc(l.observacion || "") + '"' + attrs + ' data-campo="observacion" />';
  html += renderCamposLinea(l);
  html += "</div>"; // .pedido-linea
  return html;
}

// La talla de un producto del catálogo sale de sus variantes con stock (no se
// puede vender una talla que no existe); la de una línea escrita a mano es
// texto libre, porque puede no ser una talla siquiera ("infantil", "L/XL").
function renderLineaTalla(f, l, producto, attrs) {
  if (l.tipo !== "catalogo") {
    return '<input class="mini-input" placeholder="Opcional" value="' + esc(l.talla || "") + '"' + attrs + ' data-campo="talla" />';
  }
  var variantes = (producto && producto.variantesTalla) || [];
  var opciones = variantes.filter(function (t) { return num(t.stock) > 0 || t.talla === l.talla; });
  if (!opciones.length) {
    return '<span class="section-sub" style="margin:0;color:var(--danger-ink);">Sin stock</span>';
  }
  return '<select class="mini-input"' + attrs + ' data-campo="talla">' +
    opciones.map(function (t) {
      return '<option value="' + esc(t.talla) + '" ' + (t.talla === l.talla ? "selected" : "") + ">" + esc(t.talla) + " (" + num(t.stock) + " disp.)</option>";
    }).join("") +
    "</select>";
}

// Foto de la línea: la del producto si viene del catálogo, o una que se suba
// a mano para lo que no está catalogado (mismo Drive que las imágenes de
// referencia de Cotizaciones).
function renderLineaThumb(l, producto) {
  if (l.tipo === "catalogo") return productoThumbHtml(producto || { imagenUrl: l.imagenUrl }, "producto-elegido-thumb");
  if (state.refImagenSubiendo[l.id]) return '<span class="producto-elegido-thumb" title="Subiendo a Drive…">…</span>';
  if (l.imagenUrl) {
    return '<span class="producto-elegido-thumb"><img src="' + esc(l.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-remove" data-action="quitar-pedido-linea-imagen" data-linea="' + l.id + '" title="Quitar imagen">✕</button></span>';
  }
  return '<label class="producto-elegido-thumb" style="cursor:pointer;font-size:10px;text-align:center;" title="Subir una foto de lo que se está vendiendo">+ foto' +
    '<input type="file" accept="image/*" data-action-change="set-pedido-linea-imagen" data-linea="' + l.id + '" style="display:none" /></label>';
}

// Campos propios de una línea (talla ya tiene el suyo; esto es para todo lo
// demás que cambia de negocio a negocio: color, número, nombre bordado,
// material...). Se guardan con la línea y viajan al pedido, así el taller no
// depende de que la app haya adivinado de antemano qué campos necesita.
function renderCamposLinea(l) {
  var campos = l.campos || [];
  var html = "";
  if (campos.length) {
    html += '<div class="pedido-linea-extras">';
    campos.forEach(function (c) {
      html += '<span class="pedido-linea-extra">' +
        '<input class="mini-input" style="width:110px" placeholder="Campo" value="' + esc(c.nombre || "") + '" data-action-change="set-pedido-linea-extra" data-linea="' + l.id + '" data-extra="' + c.id + '" data-campo="nombre" />' +
        '<input class="mini-input" style="width:130px" placeholder="Valor" value="' + esc(c.valor || "") + '" data-action-change="set-pedido-linea-extra" data-linea="' + l.id + '" data-extra="' + c.id + '" data-campo="valor" />' +
        '<button class="btn danger small" data-action="quitar-pedido-linea-extra" data-linea="' + l.id + '" data-extra="' + c.id + '">✕</button>' +
        "</span>";
    });
    html += "</div>";
  }
  html += '<button class="btn ghost small" style="margin-top:6px;" data-action="add-pedido-linea-extra" data-linea="' + l.id + '">+ Campo propio (color, número…)</button>';
  return html;
}

// ---------- Precio y pago (venta directa) ----------
// Ni el total ni el costo se escriben: son el resultado de las líneas. Antes
// eran dos campos libres que podían decir cualquier cosa sin relación con lo
// que se estaba vendiendo. Acá se muestran como indicadores, con la misma
// forma que el resumen de una referencia de cotización.
function renderPrecioYPago(f, totales) {
  var abono = num(f.abono);
  var saldo = totales.precioTotal - abono;
  var html = '<div class="cot-col-title">Precio y pago' +
    renderHelp("El total, el costo y la ganancia salen de las líneas de arriba. Si necesitas otro precio, cámbialo en la línea correspondiente — así el total del pedido nunca puede decir algo distinto de lo que se vendió.") +
    "</div>";
  html += '<div class="ref-summary" style="margin-top:10px;">' +
    '<div class="rs-item"><div class="rl">Costo x unidad</div><div class="rv">' + fmt(totales.costoUnit) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia x unidad</div><div class="rv">' + fmt(totales.gananciaUnit) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Margen</div><div class="rv"><span class="margen-badge ' + (totales.margenPct >= 0 ? "pos" : "neg") + '">' + totales.margenPct.toFixed(1) + "%</span></div></div>" +
    '<div class="rs-item"><div class="rl">Costo total</div><div class="rv">' + fmt(totales.costoTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Total del pedido</div><div class="rv">' + fmt(totales.precioTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia total</div><div class="rv" style="color:' + (totales.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(totales.gananciaTotal) + "</div></div>" +
    "</div>";
  html += '<div class="form-grid" style="margin-top:12px;">' +
    '<div class="field"><label>Abono inicial recibido</label><input type="number" class="mini-input" value="' + esc(f.abono) + '" placeholder="0" data-action-change="set-form-pedido-campo" data-campo="abono" /></div>' +
    "</div>";
  if (totales.precioTotal > 0) {
    html += '<div class="section-sub" style="margin:6px 0 0;">Saldo por cobrar: <b>' + fmt(Math.max(0, saldo)) + "</b>" +
      (abono > totales.precioTotal ? " · el abono supera el total del pedido" : "") + "</div>";
  }

  html += '<hr class="stitch" />';
  html += renderVendedorPedido(f, totales);
  return html;
}

// Comisión de vendedor: recogida por defecto porque no todo pedido la tiene.
function renderVendedorPedido(f, totales) {
  var abierta = !!state.pedidoVendedorAbierto;
  var resumenV = f.vendedorNombre
    ? " · " + esc(f.vendedorNombre) + " (" + (f.vendedorTipo === "fijo" ? fmt(f.vendedorValor) : num(f.vendedorValor) + "%") + ")"
    : "";
  var html = '<div class="cot-col-title" style="cursor:pointer;" data-action="toggle-pedido-vendedor">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierta ? "▾" : "▸") + "</button> Vendedor a comisión (opcional)" + resumenV +
    renderHelp("Si vendió alguien a comisión, defínelo aquí: nombre y comisión (por % del total, o un valor fijo). El valor y su estado de pago se ven en la tarjeta del pedido, en Finanzas y en el KPI Por pagar.") +
    "</div>";
  if (!abierta) return html;
  var comision = f.vendedorTipo === "fijo" ? num(f.vendedorValor) : totales.precioTotal * (num(f.vendedorValor) / 100);
  html += '<div class="form-grid" style="margin-top:8px;">' +
    '<div class="field"><label>Nombre</label><input data-form="pedido" data-field="vendedorNombre" value="' + esc(f.vendedorNombre) + '" placeholder="Nombre del vendedor" /></div>' +
    '<div class="field"><label>Tipo de comisión</label><select class="mini-input" data-action-change="set-form-pedido-campo" data-campo="vendedorTipo">' + opt("porcentaje", "% del total", f.vendedorTipo) + opt("fijo", "$ Valor fijo", f.vendedorTipo) + "</select></div>" +
    '<div class="field"><label>Valor comisión</label><input type="number" class="mini-input" value="' + esc(f.vendedorValor) + '" placeholder="0" data-action-change="set-form-pedido-campo" data-campo="vendedorValor" /></div>' +
    "</div>";
  if (f.vendedorNombre && comision > 0) {
    html += '<div class="section-sub" style="margin:6px 0 0;">Comisión: <b>' + fmt(comision) + "</b> · te quedarían " + fmt(totales.gananciaTotal - comision) + " de ganancia.</div>";
  }
  return html;
}

// ---------- Condiciones con el punto (consignación) ----------
// Acá el precio SÍ es un campo: es lo que el punto le cobra al público, un
// número acordado con él, no algo que salga del catálogo. Lo que sí se
// calcula es qué significa ese acuerdo (comisión y ganancia estimadas).
function renderCondicionesConsignacion(f, totales) {
  var precioUnit = num(f.consignacionPrecioUnitario);
  var precioPublico = precioUnit * totales.unidades;
  var comision = f.consignacionComisionTipo === "fijo"
    ? num(f.consignacionComisionValor) * totales.unidades
    : precioPublico * (num(f.consignacionComisionValor) / 100);
  var gananciaEstimada = precioPublico - comision - totales.costoTotal;

  var html = '<div class="cot-col-title">Condiciones con el punto' +
    renderHelp("El \"cliente\" de arriba es el punto de consignación (regístralo antes en Contactos, con su comisión por defecto, y queda vinculado solo). El precio al público es lo que el punto le cobra al comprador; la comisión se calcula sobre cada venta que reportes, no sobre el envío completo.") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>Precio al público x1</label><input type="number" class="mini-input" value="' + esc(f.consignacionPrecioUnitario) + '" placeholder="0" data-action-change="set-form-pedido-campo" data-campo="consignacionPrecioUnitario" /></div>' +
    '<div class="field"><label>Comisión del punto</label><select class="mini-input" data-action-change="set-form-pedido-campo" data-campo="consignacionComisionTipo">' + opt("porcentaje", "% de cada venta", f.consignacionComisionTipo) + opt("fijo", "$ fijo por unidad", f.consignacionComisionTipo) + "</select></div>" +
    '<div class="field"><label>Valor comisión</label><input type="number" class="mini-input" value="' + esc(f.consignacionComisionValor) + '" placeholder="Ej. 20" data-action-change="set-form-pedido-campo" data-campo="consignacionComisionValor" /></div>' +
    "</div>";

  html += '<div class="ref-summary" style="margin-top:12px;">' +
    '<div class="rs-item"><div class="rl">Unidades a enviar</div><div class="rv">' + totales.unidades + "</div></div>" +
    '<div class="rs-item"><div class="rl">Te cuesta producirlas</div><div class="rv">' + fmt(totales.costoTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Si se vende todo</div><div class="rv">' + fmt(precioPublico) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Comisión del punto</div><div class="rv">' + fmt(comision) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia estimada</div><div class="rv" style="color:' + (gananciaEstimada >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(gananciaEstimada) + "</div></div>" +
    "</div>";
  html += '<div class="section-sub" style="margin:8px 0 0;">Estos números son del envío completo: la plata entra recién cuando el punto reporte cada venta.</div>';
  return html;
}

// ---------- Explorador de productos ----------
// Misma estructura que el explorador de insumos de Cotizaciones (panel de
// categorías a la izquierda con su contador, búsqueda arriba, lista a la
// derecha) — es el patrón que ya conoce quien usa la app, y escala con un
// catálogo grande donde un desplegable plano no. Elegir un producto lo
// agrega directo como línea: no queda "seleccionado" en un segundo lugar.
function renderProductoPickerPedido() {
  if (!state.pedidoProductoPickerAbierto) return "";
  var productos = state.productos || [];
  var catActiva = state.pedidoProductoCategoria || "todos";
  var q = norm(state.pedidoProductoBusqueda || "").trim();

  var categorias = [];
  var vistas = {};
  productos.forEach(function (p) {
    var c = (p.categoria || "").trim();
    if (c && !vistas[c]) { vistas[c] = true; categorias.push(c); }
  });
  categorias.sort(function (a, b) { return a.localeCompare(b); });

  function enCategoria(p, catId) {
    if (catId === "todos") return true;
    if (catId === "sin") return !(p.categoria || "").trim();
    return (p.categoria || "").trim() === catId;
  }
  function coincide(p) {
    return !q || norm(p.nombre).indexOf(q) >= 0 || norm(p.referencia || "").indexOf(q) >= 0 || norm(p.categoria || "").indexOf(q) >= 0;
  }
  function cuenta(catId) {
    return productos.filter(function (p) { return enCategoria(p, catId) && coincide(p); }).length;
  }
  var visibles = productos.filter(function (p) { return enCategoria(p, catActiva) && coincide(p); });

  var itemsCat = [{ id: "todos", nombre: "Todos los productos" }]
    .concat(categorias.map(function (c) { return { id: c, nombre: c }; }))
    .concat([{ id: "sin", nombre: "Sin categoría" }]);

  var html = '<div class="picker-overlay" data-action="cerrar-producto-picker-pedido">' +
    '<div class="picker-modal" data-action="picker-stop">' +
    '<div class="picker-head">' +
    '<div class="section-title small" style="margin:0;">Productos del catálogo</div>' +
    '<button class="imgprev-close" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="cerrar-producto-picker-pedido" aria-label="Cerrar">✕</button>' +
    "</div>" +
    '<div class="picker-search"><input id="inp-producto-picker-pedido-buscar" class="mini-input" style="width:100%" placeholder="Buscar por nombre, referencia o categoría…" value="' + esc(state.pedidoProductoBusqueda || "") + '" data-live-filter="pedidoProductoBusqueda" /></div>' +
    '<div class="picker-body">' +
    '<div class="picker-side">' +
    itemsCat.map(function (c) {
      return '<button class="picker-cat ' + (catActiva === c.id ? "active" : "") + '" data-action="set-pedido-picker-categoria" data-val="' + esc(c.id) + '">' +
        "<span>" + esc(c.nombre) + '</span><span class="picker-cat-n">' + cuenta(c.id) + "</span></button>";
    }).join("") +
    "</div>" +
    '<div class="picker-list">';

  if (!productos.length) {
    html += '<div class="empty">Tu catálogo está vacío — regístralo en <b>Catálogo</b> primero (con su stock por talla).</div>';
  } else if (!visibles.length) {
    html += '<div class="empty">Sin coincidencias' + (q ? ' para "' + esc(state.pedidoProductoBusqueda) + '"' : "") + ".</div>";
  } else {
    visibles.forEach(function (p) {
      var stockTotal = (p.variantesTalla || []).reduce(function (a, t) { return a + num(t.stock); }, 0);
      var meta = [p.referencia, p.origen === "proveedor" ? "📦 de proveedor" : "🧵 del taller"].filter(Boolean).join(" · ");
      html += '<div class="picker-item con-thumb ' + (stockTotal > 0 ? "" : "sin-stock") + '" data-action="select-producto-pedido-picker" data-id="' + p.id + '">' +
        productoThumbHtml(p, "picker-item-thumb") +
        '<span class="picker-item-info"><b>' + esc(p.nombre) + "</b><small>" + esc(meta) + " · " +
        (stockTotal > 0 ? stockTotal + " en stock" : "sin stock") + "</small></span>" +
        '<span class="amount">' + fmt(p.precioVenta) + "</span>" +
        "</div>";
    });
  }

  html += "</div></div>" +
    '<div class="picker-foot"><span class="section-sub" style="margin:0;">' + (visibles.length ? visibles.length + " producto(s)" : "") + "</span>" +
    '<button class="btn ghost small" data-action="cerrar-producto-picker-pedido">Cerrar</button></div>' +
    "</div></div>";
  return html;
}

function productoThumbHtml(p, claseThumb) {
  if (p && p.imagenUrl) return '<span class="' + claseThumb + '"><img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" /></span>';
  return '<span class="' + claseThumb + '">🧺</span>';
}

// Lo que se vendió, tal como quedó registrado: la observación y los campos
// propios de cada línea (color, número, lo que el taller haya necesitado) no
// sirven de nada si solo se pueden escribir y nunca se pueden volver a leer —
// es la lista que se consulta al producir y al entregar. Los pedidos
// anteriores a las líneas no tienen este detalle y siguen mostrando solo su
// descripción de siempre arriba.
function renderDetalleLineasPedido(p) {
  var lineas = p.lineas || [];
  if (!lineas.length) return "";
  var conDetalle = lineas.some(function (l) { return (l.observacion || "").trim() || (l.campos || []).length; });
  if (!conDetalle) return "";
  var html = '<div class="pedido-lineas-detalle">';
  lineas.forEach(function (l) {
    var extras = (l.campos || []).filter(function (c) { return (c.nombre || "").trim() || (c.valor || "").trim(); });
    if (!(l.observacion || "").trim() && !extras.length) return;
    html += '<div class="pedido-meta"><b>' + esc(l.productoNombre || "—") + "</b>" +
      (l.talla ? " (" + esc(l.talla) + ")" : "") + " ×" + num(l.cantidad) +
      (l.observacion ? " — " + esc(l.observacion) : "") +
      extras.map(function (c) { return ' <span class="badge">' + esc(c.nombre || "—") + ": " + esc(c.valor || "—") + "</span>"; }).join("") +
      "</div>";
  });
  html += "</div>";
  return html;
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
    // Ojo con el pedido de costo > 0 y total 0 (pasa apenas se cotiza el costo
    // de una prenda antes de ponerle precio de venta): la ganancia existe —es
    // toda pérdida— pero el porcentaje no, porque no hay sobre qué calcularlo.
    // Cuando el porcentaje se dejaba en null y la ganancia no, el .toFixed() de
    // más abajo reventaba y TUMBABA el render de toda la pestaña Pedidos.
    var ganancia = num(p.costo) > 0 ? num(p.total) - num(p.costo) : null;
    var gananciaPct = (ganancia != null && num(p.total) > 0) ? (ganancia / num(p.total) * 100) : null;
    var gananciaTxt = ganancia == null ? "" : (fmt(ganancia) + (gananciaPct != null ? " (" + gananciaPct.toFixed(1) + "%)" : " · sin precio de venta asignado"));

    html += '<div class="pedido-card" data-pedido-id="' + p.id + '">' +
      '<div class="pedido-top"><div>' +
      '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;">' + esc(p.numeroOp || "—") + "</span> " +
      '<span class="pedido-cliente">' + esc(p.cliente) + "</span>" +
      '<span class="pedido-tipo">' + (p.tipoCliente === "propio" ? "Propio" : "Tercero") + "</span>" +
      '<div class="pedido-meta">' + esc(p.descripcion) + " · cantidad " + esc(p.cantidad) + (p.fechaEntrega ? " · entrega " + esc(p.fechaEntrega) : "") + (cliente && cliente.cedula ? " · CC/NIT " + esc(cliente.cedula) : "") + "</div>" +
      (cliente ? '<div class="pedido-meta">📦 ' + esc(cliente.direccion || "—") + ", " + esc(cliente.ciudad || "—") + (cliente.cp ? " (CP " + esc(cliente.cp) + ")" : "") + "</div>" : "") +
      (ganancia != null ? '<div class="pedido-meta">Costo ' + fmt(p.costo) + ' · Ganancia <b style="color:' + (ganancia >= 0 ? "var(--success-ink)" : "var(--danger-ink)") + ';">' + gananciaTxt + "</b></div>" : "") +
      "</div><div class=\"pedido-money\"><div class=\"total\">" + fmt(p.total) + "</div>" +
      '<div class="saldo ' + (saldo > 0 ? "" : (num(p.total) > 0 ? "ok" : "neutral")) + '">' + (saldo > 0 ? "saldo " + fmt(saldo) : (num(p.total) > 0 ? "cobrado completo" : "sin valor asignado")) + "</div>" +
      "</div></div>" +
      renderDetalleLineasPedido(p) +
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
  // Un flujo de UNA sola etapa (posible con un flujo personalizado de
  // Plantillas) dividía por cero y dejaba la barra con un ancho inválido:
  // estando en la única etapa, el avance es del 100%.
  var pct = estadosDef.length > 1 ? (idx / (estadosDef.length - 1) * 100) : 100;
  return '<div class="tape-track"><div class="tape-fill" style="width:' + pct + '%;"></div></div>' +
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
    var VENTA_COLS = "90px 70px 100px 100px 200px";
    html += '<div class="tx-row head" style="grid-template-columns:' + VENTA_COLS + ';"><span>Fecha</span><span>Cant.</span><span>Monto</span><span>Comisión</span><span></span></div>';
    ventas.forEach(function (v) {
      html += '<div class="tx-row" style="grid-template-columns:' + VENTA_COLS + ';">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(v.fecha || "—") + "</span>" +
        '<span class="mobile-th">Cant.</span><span>' + esc(v.cantidad) + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount">' + fmt(v.montoTotal) + "</span>" +
        '<span class="mobile-th">Comisión</span><span class="amount">' + fmt(v.comisionMonto) + "</span>" +
        '<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' + (v.comisionPagada
          ? '<span class="status-pill pagado">pagada</span>'
          : '<button class="btn ghost small" data-action="pagar-comision-consignacion" data-id="' + p.id + '" data-venta="' + v.id + '">Pagar comisión</button>') +
        '<button class="btn danger small" data-action="eliminar-venta-consignacion" data-id="' + p.id + '" data-venta="' + v.id + '" title="Anular esta venta (retira su ingreso de Finanzas y devuelve las unidades al punto)">✕</button>' +
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
    '<div class="tx-row head" style="grid-template-columns:100px 90px 110px 1fr 190px;"><span>Fecha</span><span>Monto</span><span>Método</span><span>Comprobante</span><span></span></div>';
  abonos.forEach(function (a) {
    if (a.tipo === "reembolso") {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 190px;">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(a.fecha || "—") + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount neg">-' + fmt(a.monto) + "</span>" +
        '<span class="mobile-th">Método</span><span style="color:var(--danger);font-weight:700;">↩ Reembolso</span>' +
        '<span class="mobile-th">Comprobante</span><span class="muted">' + esc(a.motivo || "—") + "</span>" +
        '<span><button class="btn danger small" data-action="eliminar-abono" data-id="' + p.id + '" data-abono="' + a.id + '" title="Anular este reembolso (también retira su movimiento de Finanzas)">Eliminar</button></span>' +
        "</div>";
      return;
    }
    if (state.abonoEditando === a.id) {
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 190px;" data-abono-edit-row="' + a.id + '">' +
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
      html += '<div class="tx-row" style="grid-template-columns:100px 90px 110px 1fr 190px;">' +
        '<span class="mobile-th">Fecha</span><span>' + esc(a.fecha || "—") + "</span>" +
        '<span class="mobile-th">Monto</span><span class="amount">' + fmt(a.monto) + "</span>" +
        '<span class="mobile-th">Método</span><span>' + esc(a.metodoPago || "—") + "</span>" +
        '<span class="mobile-th">Comprobante</span><span>' + (a.comprobanteUrl ? '<a href="' + esc(a.comprobanteUrl) + '" target="_blank" rel="noopener">Ver comprobante</a>' : '<span class="muted">—</span>') + "</span>" +
        '<span style="display:flex;gap:6px;">' +
        '<button class="btn ghost small" data-action="editar-abono" data-id="' + a.id + '">Editar</button>' +
        '<button class="btn ghost small" data-action="generar-pdf-recibo" data-id="' + p.id + '" data-abono="' + a.id + '">Recibo</button>' +
        '<button class="btn ghost small" data-action="enviar-recibo-correo" data-id="' + p.id + '" data-abono="' + a.id + '" title="Envía el recibo al correo del cliente">✉</button>' +
        // Anular un abono mal cargado es el ÚNICO camino correcto para
        // deshacerlo: revierte los dos lados a la vez (el abonado del pedido y
        // el movimiento de Finanzas). Antes solo se podía editar el monto, y
        // borrar el movimiento en Finanzas dejaba al pedido cobrado igual.
        '<button class="btn danger small" data-action="eliminar-abono" data-id="' + p.id + '" data-abono="' + a.id + '" title="Anular este abono (también retira su movimiento de Finanzas)">Eliminar</button>' +
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
  // Campos del borrador que, al cambiar, tienen que redibujar el formulario
  // porque de ellos dependen indicadores en pantalla (saldo por cobrar,
  // comisión estimada, ganancia del envío). Los campos que no alimentan
  // ningún cálculo siguen con data-form, que no re-renderiza.
  "set-form-pedido-campo": function (el) {
    state.formPedido[el.getAttribute("data-campo")] = el.value;
    notify();
  },
  "toggle-pedido-vendedor": function () {
    state.pedidoVendedorAbierto = !state.pedidoVendedorAbierto;
    notify();
  },
  "quitar-pedido-linea": function (el) {
    var lineaId = el.getAttribute("data-linea");
    var fp = state.formPedido;
    fp.lineas = (fp.lineas || []).filter(function (l) { return l.id !== lineaId; });
    notify();
  },
  "abrir-producto-picker-pedido": function () {
    state.pedidoProductoPickerAbierto = true;
    state.pedidoProductoBusqueda = "";
    state.pedidoProductoCategoria = "todos";
    notify();
  },
  "cerrar-producto-picker-pedido": function () {
    state.pedidoProductoPickerAbierto = false;
    notify();
  },
  "set-pedido-picker-categoria": function (el) {
    state.pedidoProductoCategoria = el.getAttribute("data-val");
    notify();
  },
  // Desde una línea, ir al detalle completo del producto en Catálogo — para
  // comprobar foto, tallas o stock sin perder el pedido que se está armando.
  "ver-producto-en-catalogo": function (el) {
    state.tab = "productos";
    state.productoEditando = el.getAttribute("data-id");
    state.productosVista = "nueva";
    notify();
  },
  // Elegir un producto lo AGREGA como línea de una vez, con su foto, precio y
  // costo ya resueltos. Antes quedaba "seleccionado" en una tarjeta aparte y
  // había que confirmarlo con talla y cantidad en un segundo mini-formulario:
  // el mismo producto se veía en dos lugares y no estaba claro cuál mandaba.
  "select-producto-pedido-picker": function (el) {
    var producto = productoById(el.getAttribute("data-id"));
    if (!producto) return;
    var fp = state.formPedido;
    // La talla que se elige sola tiene que ser una que TODAVÍA quede
    // disponible descontando lo que las otras líneas de este mismo borrador ya
    // apartaron. Sin esto, el explorador dejaba agregar una segunda línea de
    // una talla con 1 sola unidad: el borrador quedaba pidiendo 2, y recién al
    // pulsar "Crear pedido" se caía con un error — sin pista de por qué.
    function apartadoEnBorrador(talla) {
      return (fp.lineas || [])
        .filter(function (o) { return o.productoId === producto.id && o.talla === talla; })
        .reduce(function (a, o) { return a + num(o.cantidad); }, 0);
    }
    var conStock = (producto.variantesTalla || []).filter(function (t) { return num(t.stock) > 0; });
    if (!conStock.length) {
      window.alert('"' + producto.nombre + '" no tiene stock en ninguna talla.\n\nRegistra una entrada en Catálogo → ' + producto.nombre + " antes de venderlo.");
      return;
    }
    var disponibles = conStock.filter(function (t) { return num(t.stock) - apartadoEnBorrador(t.talla) > 0; });
    if (!disponibles.length) {
      window.alert('Ya apartaste todo el stock disponible de "' + producto.nombre + '" en este mismo pedido.\n\n' +
        "Si necesitas más, sube la cantidad en la línea que ya tienes (hasta donde alcance) o repón el stock en Catálogo.");
      return;
    }
    fp.lineas = (fp.lineas || []).concat([{
      id: uid(), tipo: "catalogo",
      productoId: producto.id, productoNombre: producto.nombre, imagenUrl: producto.imagenUrl || "",
      talla: disponibles[0].talla, cantidad: 1,
      precioUnitario: num(producto.precioVenta),
      // El costo llega calculado con la misma fórmula del catálogo (insumos,
      // o costo de compra si el producto es de proveedor) — ver
      // calcCostoUnitarioProducto. Queda editable por si este pedido puntual
      // costó distinto.
      costoUnitario: calcCostoUnitarioProducto(producto),
      observacion: "", campos: []
    }]);
    // En consignación el precio al público lo pone cada punto (el mismo
    // producto puede valer distinto en dos locales), así que sigue siendo un
    // campo editable — pero se precarga con el precio del catálogo la primera
    // vez, para no escribirlo desde cero cuando coincide.
    if (fp.esConsignacion && !num(fp.consignacionPrecioUnitario)) {
      fp.consignacionPrecioUnitario = String(num(producto.precioVenta));
    }
    state.pedidoProductoPickerAbierto = false;
    state.pedidoProductoBusqueda = "";
    notify();
  },
  // Línea de algo que no está en el catálogo (un bordado, un arreglo, un
  // domicilio). Nace vacía y se llena en la misma tarjeta que las demás: no
  // hay un mini-formulario aparte con reglas distintas.
  "add-pedido-linea-libre": function () {
    var fp = state.formPedido;
    fp.lineas = (fp.lineas || []).concat([{
      id: uid(), tipo: "libre",
      productoId: "", productoNombre: "", imagenUrl: "",
      talla: "", cantidad: 1, precioUnitario: 0, costoUnitario: 0,
      observacion: "", campos: []
    }]);
    notify();
  },
  "set-pedido-linea-campo": function (el) {
    var lineaId = el.getAttribute("data-linea"), campo = el.getAttribute("data-campo");
    var numerico = campo === "cantidad" || campo === "precioUnitario" || campo === "costoUnitario";
    var valor = numerico ? num(el.value) : el.value;
    var fp = state.formPedido;
    var aviso = "";
    fp.lineas = (fp.lineas || []).map(function (l) {
      if (l.id !== lineaId) return l;
      var patch = {}; patch[campo] = valor;
      var nueva = Object.assign({}, l, patch);
      // Una línea de catálogo nunca puede pedir más de lo que hay de esa
      // talla, descontando lo que YA apartaron las otras líneas del mismo
      // producto+talla en este mismo borrador (si no, dos líneas de "M" se
      // validan cada una contra el stock completo y se termina pidiendo de
      // más). Se revisa igual al cambiar la talla, no solo la cantidad.
      if (nueva.tipo === "catalogo" && (campo === "cantidad" || campo === "talla")) {
        var producto = productoById(nueva.productoId);
        var otras = (fp.lineas || [])
          .filter(function (o) { return o.id !== l.id && o.productoId === nueva.productoId && o.talla === nueva.talla; })
          .reduce(function (a, o) { return a + num(o.cantidad); }, 0);
        var disponible = (producto ? stockTalla(producto, nueva.talla) : 0) - otras;
        if (num(nueva.cantidad) > disponible) {
          aviso = "Solo hay " + Math.max(0, disponible) + " disponible(s) de " + nueva.productoNombre + " talla " + nueva.talla + ".";
          nueva.cantidad = Math.max(0, disponible);
        }
      }
      return nueva;
    });
    if (aviso) window.alert(aviso);
    notify();
  },
  "add-pedido-linea-extra": function (el) {
    var lineaId = el.getAttribute("data-linea");
    var fp = state.formPedido;
    fp.lineas = (fp.lineas || []).map(function (l) {
      if (l.id !== lineaId) return l;
      return Object.assign({}, l, { campos: (l.campos || []).concat([{ id: uid(), nombre: "", valor: "" }]) });
    });
    notify();
  },
  "set-pedido-linea-extra": function (el) {
    var lineaId = el.getAttribute("data-linea"), extraId = el.getAttribute("data-extra"), campo = el.getAttribute("data-campo");
    var fp = state.formPedido;
    fp.lineas = (fp.lineas || []).map(function (l) {
      if (l.id !== lineaId) return l;
      return Object.assign({}, l, {
        campos: (l.campos || []).map(function (c) {
          if (c.id !== extraId) return c;
          var patch = {}; patch[campo] = el.value;
          return Object.assign({}, c, patch);
        })
      });
    });
    notify();
  },
  "quitar-pedido-linea-extra": function (el) {
    var lineaId = el.getAttribute("data-linea"), extraId = el.getAttribute("data-extra");
    var fp = state.formPedido;
    fp.lineas = (fp.lineas || []).map(function (l) {
      if (l.id !== lineaId) return l;
      return Object.assign({}, l, { campos: (l.campos || []).filter(function (c) { return c.id !== extraId; }) });
    });
    notify();
  },
  // Foto de una línea escrita a mano — misma carpeta de Drive que las
  // imágenes de referencia de Cotizaciones (ver core/drive.js).
  "set-pedido-linea-imagen": async function (el) {
    var lineaId = el.getAttribute("data-linea");
    var file = el.files && el.files[0];
    if (!file) return;
    state.refImagenSubiendo = Object.assign({}, state.refImagenSubiendo, { [lineaId]: true });
    notify();
    try {
      var url = await subirImagenReferencia(file);
      state.formPedido.lineas = (state.formPedido.lineas || []).map(function (l) {
        return l.id === lineaId ? Object.assign({}, l, { imagenUrl: url }) : l;
      });
    } catch (e) {
      window.alert("No se pudo subir la imagen: " + (e && e.message ? e.message : e));
    }
    var pendientes = Object.assign({}, state.refImagenSubiendo);
    delete pendientes[lineaId];
    state.refImagenSubiendo = pendientes;
    notify();
  },
  "quitar-pedido-linea-imagen": function (el) {
    var lineaId = el.getAttribute("data-linea");
    state.formPedido.lineas = (state.formPedido.lineas || []).map(function (l) {
      return l.id === lineaId ? Object.assign({}, l, { imagenUrl: "" }) : l;
    });
    notify();
  },
  "add-pedido": function () {
    var fp = state.formPedido;
    var lineas = fp.lineas || [];
    var faltantes = faltantesPedido(fp);
    if (faltantes.length) { window.alert("Para crear el pedido falta " + faltantes.join(", ") + "."); return; }
    var esConsignacion = fp.esConsignacion;
    var totales = calcTotalesLineasPedido(lineas);
    var resumen = resumenLineasPedido(lineas);
    var abonoInicial = esConsignacion ? 0 : num(fp.abono);
    // Solo las líneas de CATÁLOGO mueven stock real — una línea escrita a
    // mano no tiene de dónde descontar. En consignación las de catálogo
    // TAMBIÉN salen del stock (se las lleva el punto), solo que no se
    // registran como venta sino como la primera remisión.
    var lineasProducto = lineas.filter(function (l) { return l.productoId; });
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
      id: uid(), clienteId: fp.clienteId || "", cliente: fp.cliente, tipoCliente: fp.tipoCliente,
      descripcion: resumen.descripcion, cantidad: String(resumen.cantidad),
      // Total y costo son el RESULTADO de las líneas, no dos campos que
      // alguien escribió: por construcción no pueden contradecir lo vendido.
      total: esConsignacion ? 0 : totales.precioTotal,
      costo: esConsignacion ? 0 : totales.costoTotal,
      abono: abonoInicial, abonos: [],
      fechaEntrega: fp.fechaEntrega,
      // Fecha de la venta: es lo que permite que un pedido aparezca en el
      // reporte de productos vendidos de un rango (ver fechaPedido en
      // core/calc.js, que la deduce para los pedidos anteriores a este campo).
      fechaCreacion: todayStr(),
      // Detalle completo de lo vendido, con el precio y el costo tal como
      // fueron en ESTE pedido — el catálogo puede cambiar de precio después
      // y el reporte tiene que seguir contando lo que en verdad pasó.
      lineas: lineas.map(function (l) { return JSON.parse(JSON.stringify(l)); }),
      stockConsumido: [], // se completa abajo con lo que en verdad se descontó (ver ajustarStockProducto)
      // Un pedido en consignación ya está producido/listo — no pasa por el
      // tape de etapas, así que nace directo como "entregado" (ver
      // renderPedidoConsignacion, que reemplaza esa parte de la tarjeta).
      estado: esConsignacion ? "entregado" : "nuevo",
      numeroOp: generarNumeroOp(todosNumerosOp()),
      vendedor: (!esConsignacion && fp.vendedorNombre) ? { nombre: fp.vendedorNombre, tipo: fp.vendedorTipo || "porcentaje", valor: num(fp.vendedorValor), estado: "pendiente" } : null,
      consignacion: esConsignacion ? {
        puntoId: fp.clienteId || "", comisionTipo: fp.consignacionComisionTipo || "porcentaje", comisionValor: num(fp.consignacionComisionValor),
        // Todo envío en consignación viene de líneas de catálogo (con
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
          id: uid(), fecha: todayStr(), codigoPublico: codigoPublico(),
          // precioUnitario viaja en cada ítem porque es de ahí que sale el
          // monto al registrar una venta por talla (ver
          // calcConsignacionDisponiblePorTalla) — sin él, la primera venta
          // reportada se registraba en $0.
          items: stockConsumidoReal.map(function (it) { return Object.assign({}, it, { precioUnitario: num(fp.consignacionPrecioUnitario) }); }),
          nota: ""
        });
      }
    } else {
      nuevoPedido.stockConsumido = stockConsumidoReal;
    }
    state.pedidos.unshift(nuevoPedido);
    state.formPedido = {
      clienteId: "", cliente: "", tipoCliente: "propio", abono: "", fechaEntrega: "",
      vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "",
      esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "",
      lineas: []
    };
    state.pedidoProductoBusqueda = "";
    state.pedidoVendedorAbierto = false;
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
    // origenVentaConsignacionId: marca de origen del sistema — es lo que
    // permite encontrar (y bloquear el borrado suelto de) este movimiento si
    // la venta se elimina o se corrige. Ver origenSistemaDeTx en core/calc.js.
    state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Venta consignación — " + ped.descripcion, monto: montoTotal, contraparte: ped.cliente, fecha: fecha, pedidoId: ped.id, origenVentaConsignacionId: ventaId });
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
    state.tx.unshift({ id: uid(), tipo: "gasto", concepto: "Comisión consignación — " + ped.cliente, monto: venta.comisionMonto, contraparte: ped.cliente, fecha: todayStr(), pedidoId: ped.id, origenComisionConsignacionId: ventaId });
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
      // Una referencia por LÍNEA del pedido, no una sola con todo adentro: si
      // el pedido llevaba una camiseta y un bordado, cotizarlos juntos como
      // una sola referencia obligaba a rearmar a mano lo que ya estaba
      // separado. Cada una nace con su cantidad y su precio, lista para
      // detallarle insumos (o marcarla como comprada a proveedor).
      referencias: (p.lineas && p.lineas.length)
        ? p.lineas.map(function (l) {
          return {
            id: uid(), nombre: l.productoNombre || p.descripcion, imagenUrl: l.imagenUrl || "",
            consumoAprox: 1, cantidadPedida: num(l.cantidad) || 1, precioVenta: num(l.precioUnitario) || 0,
            insumos: [], detalle: [], origen: "taller", costoCompra: 0, proveedorId: "",
            productoId: l.productoId || ""
          };
        })
        : [{ id: uid(), nombre: p.descripcion, imagenUrl: "", consumoAprox: 1, cantidadPedida: num(p.cantidad) || 1, precioVenta: num(p.total) || 0, insumos: [], detalle: [], origen: "taller", costoCompra: 0, proveedorId: "" }],
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
          // Da exactamente p.total (el saldo es total - abonado), pero pasa
          // por la misma puerta que el resto para que la lista y el total
          // abonado no puedan separarse nunca.
          return Object.assign({}, p, { abono: recalcularAbonoPedido(p, abonos), abonos: abonos });
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
    state.tx.unshift({ id: uid(), tipo: "gasto", concepto: "Reembolso — " + ped.descripcion + (fr.motivo ? " (" + fr.motivo + ")" : ""), monto: monto, contraparte: ped.cliente, fecha: fecha, pedidoId: ped.id, origenReembolsoId: reembolsoId });
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== id) return p;
      var abonos = (p.abonos || []).concat([{ id: reembolsoId, monto: monto, fecha: fecha, tipo: "reembolso", motivo: fr.motivo || "", comprobanteUrl: "" }]);
      return Object.assign({}, p, { abonos: abonos, abono: recalcularAbonoPedido(p, abonos) });
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
      // Antes, un abono mayor al saldo se RECORTABA en silencio hasta el
      // saldo: quien escribía 150.000 sobre un saldo de 100.000 veía
      // registrados 100.000 y no se enteraba de que le faltaban 50.000 por
      // registrar en algún lado. Ahora se pregunta y se registra lo que el
      // usuario decida — el monto que se guarda es siempre el que él vio.
      if (monto > saldoDisponible) {
        var aviso = saldoDisponible > 0
          ? "Este abono (" + fmt(monto) + ") es mayor que el saldo pendiente del pedido (" + fmt(saldoDisponible) + ")."
          : "Este pedido ya no tiene saldo pendiente (" + (saldoDisponible < 0 ? "hay " + fmt(-saldoDisponible) + " cobrados de más" : "está cobrado completo") + ").";
        if (!window.confirm(aviso + "\n\n¿Registrar igual el abono completo de " + fmt(monto) + "?\n\n" +
          "Se registra tal cual (queda como saldo a favor del cliente). Si fue un error de digitación, cancela y corrige el monto.")) return;
      }
      var abonoId = uid();
      state.tx.unshift({ id: uid(), tipo: "ingreso", concepto: "Abono — " + ped.descripcion, monto: monto, contraparte: ped.cliente, fecha: fecha, pedidoId: ped.id, origenAbonoId: abonoId });
      state.pedidos = state.pedidos.map(function (p) {
        if (p.id !== id) return p;
        var abonos = (p.abonos || []).concat([{ id: abonoId, monto: monto, fecha: fecha, metodoPago: metodo, comprobanteUrl: comprobanteUrl || "" }]);
        return Object.assign({}, p, { abono: recalcularAbonoPedido(p, abonos), abonos: abonos });
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
      return Object.assign({}, p, { abonos: abonos, abono: recalcularAbonoPedido(p, abonos) });
    });
    state.tx = state.tx.map(function (t) {
      return t.origenAbonoId === abonoId ? Object.assign({}, t, { monto: nuevoMonto, fecha: nuevaFecha }) : t;
    });
    state.abonoEditando = "";
    persist("pedidos"); persist("tx"); notify();
  },
  // Anular un abono (o un reembolso) mal cargado. Es la contraparte del
  // bloqueo de borrado en Finanzas: acá se revierten LOS DOS lados en el
  // mismo acto — se saca de la lista del pedido, se recalcula el abonado con
  // la única fórmula que existe para eso (calcAbonadoDeLista, que resta los
  // reembolsos) y se retira el movimiento que había generado en Finanzas.
  // Nunca puede quedar plata en la caja sin su abono, ni al revés.
  "eliminar-abono": function (el) {
    var pedidoId = el.getAttribute("data-id"), abonoId = el.getAttribute("data-abono");
    var ped = state.pedidos.filter(function (p) { return p.id === pedidoId; })[0];
    if (!ped) return;
    var abono = (ped.abonos || []).filter(function (a) { return a.id === abonoId; })[0];
    if (!abono) return;
    var esReembolso = abono.tipo === "reembolso";
    if (!window.confirm("¿Anular " + (esReembolso ? "el reembolso" : "el abono") + " de " + fmt(abono.monto) + (abono.fecha ? " del " + abono.fecha : "") + "?\n\n" +
      "Se borra de este pedido y también se retira su movimiento de Finanzas, así la caja y el saldo del pedido siguen cuadrando.\n\nNo se puede deshacer.")) return;
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== pedidoId) return p;
      var abonos = (p.abonos || []).filter(function (a) { return a.id !== abonoId; });
      return Object.assign({}, p, { abonos: abonos, abono: recalcularAbonoPedido(p, abonos) });
    });
    state.tx = state.tx.filter(function (t) { return t.origenAbonoId !== abonoId && t.origenReembolsoId !== abonoId; });
    state.abonoEditando = "";
    persist("pedidos"); persist("tx"); notify();
  },
  // Misma idea para una venta de consignación mal reportada: hasta ahora no
  // había forma de corregirla (ni la venta ni su ingreso), así que un error de
  // digitación quedaba para siempre en la caja y en el seguimiento por talla.
  "eliminar-venta-consignacion": function (el) {
    var pedidoId = el.getAttribute("data-id"), ventaId = el.getAttribute("data-venta");
    var ped = state.pedidos.filter(function (p) { return p.id === pedidoId; })[0];
    if (!ped || !ped.consignacion) return;
    var venta = (ped.consignacion.ventas || []).filter(function (v) { return v.id === ventaId; })[0];
    if (!venta) return;
    if (!window.confirm("¿Anular esta venta reportada (" + num(venta.cantidad) + " unidad(es) por " + fmt(venta.montoTotal) + ")?\n\n" +
      "Se retira su ingreso de Finanzas" + (venta.comisionPagada ? " y también el gasto de la comisión que ya se le pagó al punto" : "") + ", y las unidades vuelven a contar como disponibles en el punto.\n\nNo se puede deshacer.")) return;
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== pedidoId) return p;
      var ventas = (p.consignacion.ventas || []).filter(function (v) { return v.id !== ventaId; });
      return Object.assign({}, p, { consignacion: Object.assign({}, p.consignacion, { ventas: ventas }) });
    });
    state.tx = state.tx.filter(function (t) { return t.origenVentaConsignacionId !== ventaId && t.origenComisionConsignacionId !== ventaId; });
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
    // En consignación el stock salió del taller vía remisiones, no vía
    // `stockConsumido` del pedido: eliminarlo NO lo devuelve al Catálogo (la
    // mercancía sigue físicamente en el punto). Decirlo antes de confirmar,
    // porque el caso normal —venta directa— sí restituye y da a entender lo
    // contrario.
    var enElPunto = pedido.consignacion ? calcConsignacionDisponible(pedido) : 0;
    var avisoStock = enElPunto > 0
      ? ("\n\nOjo: quedan " + enElPunto + " unidad(es) entregadas a este punto. Eliminar el pedido NO las devuelve al stock del Catálogo (siguen físicamente allá) — si te las regresaron, registra primero un retiro.")
      : "";
    if (!window.confirm('¿Eliminar el pedido "' + pedido.numeroOp + " — " + pedido.descripcion + '"?\n\nSe mueve a la papelera de pedidos y puedes restaurarlo si fue un error.' + avisoDinero + avisoStock)) return;
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
