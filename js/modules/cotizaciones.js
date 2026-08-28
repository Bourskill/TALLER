import { state, persist, notify, mostrarToast } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, fmt, norm, generarNumeroOp, parseDetalleCSV, parseDetalleFilas, codigoPublico, exigirCampos } from "../core/utils.js";
import { movimientosGeneradosPorCotizacion, calcCotizacionTotales, calcRefTotales, calcRefTotalesConGlobales, calcCostoGlobalPorPrenda, calcCostoPrenda, calcCotResultadoReal, calcListaCompras, calcCotGastoVariacion, calcCotGastoEstimadoBase, calcComisionValorCot, clienteById, estadoAgregadoDeCot, productoById, validarStockLineas, proveedoresDeContactos, calcCostosGlobales, calcResumenCompras, compraDeLinea, calcUnidadesCotizacion, calcCostoPrendaGlobal } from "../core/calc.js";
import { renderClienteCombo, renderTipoCostoOptions, renderHelp } from "../core/components.js";
import { generarPDFCotizacion, generarPDFInternoCotizacion } from "../core/pdf.js";
import { subirImagenReferencia } from "../core/drive.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { todosNumerosOp, sincronizarEventoPedido } from "./pedidos.js";
import { ESTADOS_DEFAULT, TIPOS_COSTO } from "../core/constants.js";
import { ajustarStockProducto } from "../core/stock.js";

// costoCompra/proveedorId solo se usan cuando origen === "proveedor" (ver
// renderRefCard): ahí reemplazan por completo a insumos + consumoAprox.
function nuevaReferencia() {
  return { id: uid(), nombre: "", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 0, insumos: [], detalle: [], origen: "taller", costoCompra: 0, proveedorId: "" };
}
function nuevoInsumo(fuente) {
  return {
    id: uid(),
    nombre: fuente ? fuente.nombre : "",
    unidad: fuente ? fuente.unidad : "UND",
    costo: fuente ? num(fuente.costo) : 0,
    tipo: fuente ? fuente.tipo : "por_prenda",
    // Si en el catálogo está marcado como servicio (diseño, confección), la
    // referencia lo hereda: es lo que hace que la lista de compras diga
    // "servicio" en vez de pedir N unidades de algo que no se mide.
    esServicio: !!(fuente && fuente.esServicio),
    proveedorId: (fuente && fuente.proveedorId) || "",
    cantidad: 1
  };
}


// Dos pestañas arriba (estilo hoja de cálculo, a la derecha): "Historial"
// es siempre un índice liviano — una tarjeta chica por cotización, sin el
// detalle de referencias/insumos — y "+ Nueva cotización"/"✎ Editando..."
// es el ÚNICO lugar donde se ve y edita el detalle completo de una
// cotización a la vez, ya sea una recién creada o una abierta desde el
// historial (`state.cotizacionEditando`). Antes el historial mostraba
// tarjetas completas apiladas (con un botón de contraer/expandir aparte);
// ahora esa distinción "resumen vs. detalle completo" es la que separan
// las dos pestañas, no un toggle por tarjeta.
export function render() {
  var vista = state.cotizacionesVista || "nueva";
  var html = renderTabsCotizaciones(vista);
  html += vista === "historial" ? renderHistorial() : renderEditor();
  html += renderInsumoPicker();
  return html;
}

// Explorador de insumos (modal): reemplaza al <select> plano de "+ Insumos
// predeterminados", que solo escalaba mientras el catálogo cupiera en un
// desplegable — con decenas de insumos obligaba a leer una lista larga sin
// poder filtrar ni ver el costo antes de elegir. Acá hay panel de categorías
// a la izquierda, búsqueda arriba y selección MÚLTIPLE (agregar cinco
// insumos era abrir el select cinco veces).
function renderInsumoPicker() {
  var cotId = state.insumoPickerAbierto;
  if (!cotId) return "";
  var refId = state.insumoPickerRef;
  var categorias = state.catalogoCategorias || [];
  var lista = state.catalogoInsumos || [];
  var catActiva = state.insumoPickerCategoria || "todos";
  var q = norm(state.insumoPickerBusqueda || "").trim();
  var seleccion = state.insumoPickerSeleccion || [];

  function enCategoria(i, catId) {
    if (catId === "todos") return true;
    if (catId === "sin") return !i.categoriaId || !categorias.some(function (c) { return c.id === i.categoriaId; });
    return i.categoriaId === catId;
  }
  // El contador de cada categoría respeta la búsqueda activa: si buscas
  // "hilo", cada categoría muestra cuántos hilos tiene, no su total.
  function cuenta(catId) {
    return lista.filter(function (i) { return enCategoria(i, catId) && (!q || norm(i.nombre).indexOf(q) >= 0); }).length;
  }
  var visibles = lista.filter(function (i) {
    return enCategoria(i, catActiva) && (!q || norm(i.nombre).indexOf(q) >= 0 || norm(i.unidad || "").indexOf(q) >= 0);
  });

  var itemsCat = [{ id: "todos", nombre: "Todos los insumos" }]
    .concat(categorias.map(function (c) { return { id: c.id, nombre: c.nombre }; }))
    .concat([{ id: "sin", nombre: "Sin categoría" }]);

  // Cuántas veces está ya cada insumo del catálogo en ESTA cotización (en
  // cualquiera de sus referencias). Sirve para avisar "ya lo tienes" sin
  // impedir agregarlo otra vez: repetir un insumo es legítimo (dos telas
  // distintas del mismo tipo, un servicio que se paga dos veces), lo que no
  // sirve es agregarlo por segunda vez sin darse cuenta. Se compara por
  // nombre porque el insumo copiado a la referencia es una copia
  // independiente del catálogo, sin su id.
  var cotActual = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  var yaEnCotizacion = {};
  ((cotActual && cotActual.referencias) || []).forEach(function (r) {
    (r.insumos || []).forEach(function (ins) {
      var k = norm(ins.nombre || "");
      if (!yaEnCotizacion[k]) yaEnCotizacion[k] = { total: 0, refs: [] };
      yaEnCotizacion[k].total++;
      var nombreRef = r.nombre || "Sin nombre";
      if (yaEnCotizacion[k].refs.indexOf(nombreRef) === -1) yaEnCotizacion[k].refs.push(nombreRef);
    });
  });

  var html = '<div class="picker-overlay" data-action="cerrar-insumo-picker">' +
    '<div class="picker-modal" data-action="picker-stop">' +
    '<div class="picker-head">' +
    '<div class="section-title small" style="margin:0;">Insumos predeterminados</div>' +
    '<button class="imgprev-close" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="cerrar-insumo-picker" aria-label="Cerrar">✕</button>' +
    "</div>" +
    '<div class="picker-search"><input id="inp-insumo-picker-buscar" class="mini-input" style="width:100%" placeholder="Buscar insumo por nombre o unidad…" value="' + esc(state.insumoPickerBusqueda || "") + '" data-live-filter="insumoPickerBusqueda" /></div>' +
    '<div class="picker-body">' +
    '<div class="picker-side">' +
    itemsCat.map(function (c) {
      var n = cuenta(c.id);
      return '<button class="picker-cat ' + (catActiva === c.id ? "active" : "") + '" data-action="set-insumo-picker-categoria" data-val="' + esc(c.id) + '">' +
        "<span>" + esc(c.nombre) + '</span><span class="picker-cat-n">' + n + "</span></button>";
    }).join("") +
    "</div>" +
    '<div class="picker-list">';

  if (!lista.length) {
    html += '<div class="empty">Tu catálogo de insumos está vacío. Agrégalos en la pestaña <b>Insumos</b> para poder reutilizarlos acá.</div>';
  } else if (!visibles.length) {
    html += '<div class="empty">Sin coincidencias' + (q ? ' para "' + esc(state.insumoPickerBusqueda) + '"' : "") + ".</div>";
  } else {
    visibles.forEach(function (i) {
      var marcado = seleccion.indexOf(i.id) !== -1;
      var yaEsta = yaEnCotizacion[norm(i.nombre || "")];
      var meta = [esc(i.unidad || "UND"), esc((TIPOS_COSTO[i.tipo] || {}).label || i.tipo || "")];
      if (i.esServicio) meta.push("servicio");
      html += '<label class="picker-item ' + (marcado ? "sel" : "") + (yaEsta ? " ya-agregado" : "") + '">' +
        '<input type="checkbox" data-action="toggle-insumo-picker-item" data-id="' + i.id + '" ' + (marcado ? "checked" : "") + " />" +
        '<span class="picker-item-info"><b>' + esc(i.nombre) +
        (yaEsta ? ' <span class="tag" title="Ya está en ' + esc(yaEsta.refs.join(", ")) + ' — puedes agregarlo otra vez si lo necesitas">✓ ya en la cotización' + (yaEsta.total > 1 ? " ×" + yaEsta.total : "") + "</span>" : "") +
        "</b><small>" + meta.join(" · ") +
        (yaEsta ? " · en " + esc(yaEsta.refs.join(", ")) : "") + "</small></span>" +
        '<span class="amount">' + fmt(i.costo) + "</span>" +
        "</label>";
    });
  }

  html += "</div></div>" +
    '<div class="picker-foot">' +
    '<span class="section-sub" style="margin:0;">' + (seleccion.length ? seleccion.length + (seleccion.length === 1 ? " insumo seleccionado" : " insumos seleccionados") : "Marca los insumos que quieras agregar") + "</span>" +
    '<span style="display:flex;gap:8px;">' +
    '<button class="btn ghost small" data-action="cerrar-insumo-picker">Cancelar</button>' +
    '<button class="btn" ' + (seleccion.length ? "" : "disabled") + ' data-action="confirmar-insumo-picker" data-cot="' + cotId + '" data-ref="' + refId + '">Agregar' + (seleccion.length ? " (" + seleccion.length + ")" : "") + "</button>" +
    "</span></div>" +
    "</div></div>";
  return html;
}

function renderTabsCotizaciones(vista) {
  var total = state.cotizaciones.length;
  var labelNueva = state.cotizacionEditando ? "✎ Editando cotización" : "+ Nueva cotización";
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nueva" ? "active" : "") + '" data-action="cot-vista" data-val="nueva">' + labelNueva + "</button>" +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="cot-vista" data-val="historial">Historial' + (total ? " (" + total + ")" : "") + "</button>" +
    "</div>";
}

function renderFormNueva() {
  var f = state.formCotizacion;
  return '<div class="card"><div class="section-title small">Nueva cotización' +
    renderHelp("Arma cada referencia con sus insumos (o aplica una plantilla), define el precio de venta y el margen se calcula solo. Los gastos reales de producción se registran aparte para comparar contra lo cotizado.") +
    '</div><div class="form-grid">' +
    renderClienteCombo("cotizacion", "cot-cliente-nombre", f) +
    '<div class="field wide"><label>Descripción</label><input data-form="cotizacion" data-field="descripcion" value="' + esc(f.descripcion) + '" placeholder="Ej. Uniformes equipo San Jorge" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" data-form="cotizacion" data-field="fecha" value="' + esc(f.fecha) + '" /></div>' +
    '<div class="field"><label>Fecha de entrega (opcional)' +
    renderHelp("Se traslada al pedido cuando conviertas esta cotización — es lo que hace que aparezca en \"Próximas entregas\" del Resumen. Si aún no la sabes, puedes definirla después.") +
    '</label><input type="date" data-form="cotizacion" data-field="fechaEntrega" value="' + esc(f.fechaEntrega || "") + '" /></div>' +
    '<button class="btn" data-action="add-cotizacion">Crear cotización</button>' +
    "</div></div>";
}

// Muestra el formulario en blanco, o (si se abrió una desde Historial, o se
// acaba de crear una) el detalle completo de esa cotización puntual — nunca
// las dos cosas ni una lista completa a la vez.
function renderEditor() {
  var id = state.cotizacionEditando;
  var cot = id ? state.cotizaciones.filter(function (c) { return c.id === id; })[0] : null;
  if (!cot) return renderFormNueva();
  var html = '<div class="pedido-actions" style="margin-bottom:10px;">' +
    '<button class="btn ghost small" data-action="cerrar-cotizacion-editor">← Nueva cotización en blanco</button>' +
    "</div>";
  html += renderAvisoPedidoDesfasado(cot);
  html += renderBarraGuardado(cot);
  html += renderCotCard(cot);
  return html;
}

// Barra de guardado: aparece SOLO cuando hay cambios sin guardar en esta
// cotización. Es sticky para que no se pierda de vista al bajar por una
// cotización larga y quede claro que lo que se ve en pantalla todavía no es
// lo que está guardado.
// Aviso de que el pedido ya creado quedó diciendo otra cosa. Pasa con los
// pedidos convertidos ANTES de que guardar propagara los cambios: se editó la
// cotización y el pedido —y con él los reportes, que leen de él— se quedó con
// los números viejos. Se ofrece el botón para ponerlos al día en un clic.
function renderAvisoPedidoDesfasado(cot) {
  var d = calcDesfaseCotizacionPedido(cot);
  if (!d) return "";
  var partes = [];
  if (d.difCantidad) partes.push("cantidad: el pedido dice " + d.cantidadPedido + " y la cotización " + d.cantidadCot);
  if (d.difTotal) partes.push("precio: el pedido dice " + fmt(d.totalPedido) + " y la cotización " + fmt(d.totalCot));
  if (d.difCosto) partes.push("costo: diferencia de " + fmt(Math.abs(d.difCosto)));
  return '<div class="save-bar" style="background:var(--danger-soft);border-color:var(--danger);">' +
    '<span class="save-bar-msg" style="color:var(--danger-ink);">⚠ El pedido ' + esc(d.pedido.numeroOp || "") + " quedó desactualizado" +
    renderHelp("Este pedido se creó con una versión anterior de la cotización y no se enteró de los cambios que hiciste después. Como los reportes leen del pedido, hasta que no lo actualices seguirán mostrando los números viejos. Actualizar NO toca los abonos ya cobrados, el N.º de OP ni la etapa de producción — solo qué se vende, cuánto y a qué precio.") +
    "</span>" +
    '<span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
    '<span class="section-sub" style="margin:0;">' + esc(partes.join(" · ")) + "</span>" +
    '<button class="btn" data-action="sincronizar-pedido-cotizacion" data-id="' + cot.id + '">Actualizar el pedido</button>' +
    "</span></div>";
}

function renderBarraGuardado(cot) {
  if (state.cotSucia !== cot.id) return "";
  return '<div class="save-bar">' +
    '<span class="save-bar-msg">● Cambios sin guardar' +
    renderHelp("Lo que editaste se ve en pantalla pero todavía no reemplazó a la cotización guardada. Guardá para confirmarlo, o descartá para volver a la última versión guardada. Registrar un costo real, pagar una comisión o convertir en pedido guardan solos (son movimientos reales, no una simulación).") +
    "</span>" +
    '<span style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<button class="btn ghost small" data-action="descartar-cambios-cotizacion">Descartar</button>' +
    '<button class="btn" data-action="guardar-cotizacion" data-id="' + cot.id + '">Guardar cambios</button>' +
    "</span></div>";
}

// El historial es SIEMPRE un índice de tarjetas chicas — clic en cualquiera
// abre su detalle completo en la otra pestaña (renderEditor).
function renderHistorial() {
  if (state.cotizaciones.length === 0) { return '<div class="empty">Aún no has creado cotizaciones — creá la primera en la pestaña "+ Nueva cotización".</div>'; }
  var html = "";
  state.cotizaciones.forEach(function (c) { html += renderCotResumen(c); });
  return html;
}

function renderCotResumen(c) {
  var totales = calcCotizacionTotales(c);
  return '<div class="cot-card colapsada" data-cot-id="' + c.id + '" data-action="abrir-cotizacion-editor" data-id="' + c.id + '" style="cursor:pointer;" title="Clic para abrir y editar">' +
    '<div class="cot-top"><div>' +
    '<span class="cot-cliente">' + esc(c.cliente) + "</span> " +
    '<span class="badge ' + c.estado + '">' + (c.estado === "convertida" ? "Convertida a pedido" : "Borrador") + "</span>" +
    '<div class="cot-meta">' + esc(c.descripcion) + " · " + esc(c.fecha) + " · " + fmt(totales.precioTotal) + " venta</div>" +
    "</div></div></div>";
}

// Editor del flujo de etapas de producción de ESTA referencia — cada
// referencia puede necesitar etapas distintas (ej. una lleva sublimación y
// otra no), así que ya no es un flujo único por cotización. Si la plantilla
// de prenda aplicada trae un flujo asignado, nace precargado con ese (ver
// acción "aplicar-plantilla"); si no, parte del flujo estándar de la app.
function renderEstadosRef(cotId, ref) {
  var estados = (ref.estadosDef && ref.estadosDef.length) ? ref.estadosDef : ESTADOS_DEFAULT;
  var esPersonalizado = !!(ref.estadosDef && ref.estadosDef.length);
  var COLS_E = "30px 1fr 36px 36px 30px";
  var html = '<div class="det-row head" style="grid-template-columns:' + COLS_E + ';"><span>#</span><span>Etapa</span><span></span><span></span><span></span></div>';
  estados.forEach(function (e, i) {
    html += '<div class="det-row" style="grid-template-columns:' + COLS_E + ';">' +
      '<span class="mobile-th">#</span><span>' + (i + 1) + "</span>" +
      '<span class="mobile-th">Etapa</span><input class="mini-input" value="' + esc(e.label) + '" data-action-change="set-estado-ref-label" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-idx="' + i + '" />' +
      '<button class="btn ghost small" ' + (i === 0 ? "disabled" : "") + ' data-action="mover-estado-ref" data-dir="-1" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-idx="' + i + '" title="Subir">↑</button>' +
      '<button class="btn ghost small" ' + (i === estados.length - 1 ? "disabled" : "") + ' data-action="mover-estado-ref" data-dir="1" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-idx="' + i + '" title="Bajar">↓</button>' +
      '<button class="btn danger small" data-action="remove-estado-ref" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-idx="' + i + '">✕</button>' +
      "</div>";
  });
  html += '<div class="inline-form" style="margin-top:8px;">' +
    '<input class="mini-input" data-role="nueva-etapa-' + ref.id + '" placeholder="Nombre de la nueva etapa" style="width:180px" />' +
    '<button class="btn ghost small" data-action="add-estado-ref" data-cot="' + cotId + '" data-ref="' + ref.id + '">+ Agregar etapa</button>' +
    (esPersonalizado ? '<button class="btn ghost small" data-action="resetear-estados-ref" data-cot="' + cotId + '" data-ref="' + ref.id + '">Restablecer estándar</button>' : "") +
    "</div>";
  if ((state.plantillasEstados || []).length) {
    html += '<div class="inline-form" style="margin-top:8px;">' +
      '<select class="mini-input" data-role="plantilla-estados-sel-' + ref.id + '" style="width:190px">' +
      (state.plantillasEstados || []).map(function (pl) { return '<option value="' + pl.id + '">' + esc(pl.nombre) + " (" + pl.estados.length + " etapas)</option>"; }).join("") +
      "</select>" +
      '<button class="btn ghost small" data-action="cargar-plantilla-estados" data-cot="' + cotId + '" data-ref="' + ref.id + '">Cargar plantilla</button>' +
      "</div>";
  }
  return html;
}

// Tarjeta completa de una cotización (la única vista de "detalle completo"):
// cabecera + cifras grandes tipo dashboard + una sola acción primaria +
// resumen de vendedor + pestañas (Referencias / Producción / Documentos).
// Antes todo esto vivía apilado y siempre visible en una sola pantalla —
// ahora solo lo esencial (cifras, CTA) está siempre a la vista; el resto se
// organiza por pestaña o queda en el menú "⋮".
function renderCotCard(c) {
  var totales = calcCotizacionTotales(c);
  var real = calcCotResultadoReal(c);
  var iva = c.iva || { activo: false, porcentaje: 19 };
  var tab = state.cotTabActiva[c.id] || "referencias";

  var html = '<div class="cot-card" data-cot-id="' + c.id + '">';
  html += renderCotHead(c, iva);
  html += renderCotStatsRow(totales);
  html += renderCotVendedorCompact(c);
  html += renderCotTabsStrip(c, tab);
  html += '<div class="cot-tab-body">';
  if (tab === "produccion") html += renderTabProduccion(c, totales, real);
  else html += renderTabReferencias(c);
  html += "</div>";
  html += "</div>"; // .cot-card
  return html;
}

// Cabecera: cliente (lo más prominente) → descripción en su propia línea →
// fecha con etiqueta, en vez de mezclar todo en un solo renglón de texto
// corrido. Las acciones (IVA, convertir, eliminar) quedan arriba a la
// derecha, ordenadas de menos a más destructiva.
function renderCotHead(c, iva) {
  // Una vez convertida, el pedido resultante tiene su propio N.º de OP — se
  // muestra acá arriba, junto al estado, para no tener que ir a Pedidos solo
  // para confirmar con qué OP quedó esta cotización.
  var pedidoVinculado = c.pedidoId ? state.pedidos.filter(function (p) { return p.id === c.pedidoId; })[0] : null;
  var html = '<div class="cot-head">' +
    '<div class="cot-head-info">' +
    '<div class="cot-head-top">' +
    '<input class="cot-cliente-input" value="' + esc(c.cliente) + '" placeholder="Nombre del cliente" data-action-change="set-cot-cliente" data-id="' + c.id + '" title="Editar el nombre del cliente" />' +
    '<span class="badge ' + c.estado + '">' + (c.estado === "convertida" ? "Convertida a pedido" : "Borrador") + "</span>" +
    (pedidoVinculado ? '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;" title="Pedido vinculado — clic para verlo" data-action="ver-cotizacion-relacionada-pedido" data-id="' + pedidoVinculado.id + '">' + esc(pedidoVinculado.numeroOp || "OP-????") + "</span>" : "") +
    "</div>" +
    (c.descripcion ? '<div class="cot-descripcion">' + esc(c.descripcion) + "</div>" : "") +
    '<div class="cot-meta">' +
    '<span class="cot-meta-item"><span class="cot-meta-label">Fecha</span><input type="date" class="mini-input" style="width:135px;" value="' + esc(c.fecha) + '" data-action-change="set-cot-fecha" data-id="' + c.id + '" /></span>' +
    '<span class="cot-meta-item"><span class="cot-meta-label">Entrega' +
    renderHelp("Fecha comprometida de entrega. Al convertir esta cotización en pedido se traslada al pedido, que es lo que alimenta \"Próximas entregas\" en el Resumen y el recordatorio en Google Calendar.") +
    '</span><input type="date" class="mini-input" style="width:135px;" value="' + esc(c.fechaEntrega || "") + '" data-action-change="set-cot-fecha-entrega" data-id="' + c.id + '" /></span>' +
    (c.pedidoOrigenId && c.estado !== "convertida" ? '<span class="cot-meta-item" style="color:var(--accent-ink);">Escalada desde pedido rápido</span>' : "") +
    "</div>" +
    "</div>" +
    '<div class="cot-head-actions">' +
    '<label class="cot-iva-inline"><input type="checkbox" data-action-change="set-cot-iva" data-campo="activo" data-id="' + c.id + '" ' + (iva.activo ? "checked" : "") + " /> IVA" +
    (iva.activo ? ('<input type="number" class="mini-input" style="width:52px" value="' + esc(iva.porcentaje) + '" data-action-change="set-cot-iva" data-campo="porcentaje" data-id="' + c.id + '" title="Porcentaje de IVA" />%') : "") +
    "</label>" + renderHelp("El IVA es opcional: actívalo aquí (o desde el pedido convertido) y define el %. Si está apagado, el PDF no lo cobra.") +
    (c.estado !== "convertida"
      ? (c.pedidoOrigenId
          ? '<button class="btn small" data-action="aplicar-cotizacion-a-pedido" data-id="' + c.id + '" title="Reemplaza el total, descripción, cantidad y vendedor del pedido original con estos valores. Los abonos ya cobrados se conservan.">Aplicar a pedido →</button>'
          : '<button class="btn small" data-action="convertir-cotizacion" data-id="' + c.id + '">Convertir en pedido →</button>')
      : "") +
    '<button class="cot-delete-btn" data-action="remove-cotizacion" data-id="' + c.id + '" aria-label="Eliminar cotización" title="Eliminar cotización">🗑</button>' +
    "</div>" +
    "</div>";
  return html;
}

// Cifras grandes (estilo dashboard financiero) en vez de una fila de texto
// chico: es lo primero que se debe leer de una cotización. IVA y "convertir
// en pedido" viven arriba a la derecha, junto al menú "⋮" (ver renderCotHead).
function renderCotStatsRow(totales) {
  return '<div class="cot-hero-stats">' +
    '<div class="cot-hero-stat"><div class="rl">Precio total cotizado</div><div class="rv">' + fmt(totales.precioTotal) + "</div></div>" +
    '<div class="cot-hero-stat"><div class="rl">Ganancia estimada</div><div class="rv" style="color:' + (totales.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(totales.gananciaTotal) + "</div></div>" +
    '<div class="cot-hero-stat"><div class="rl">Margen</div><div class="rv">' + totales.margenPct.toFixed(1) + "%</div></div>" +
    "</div>";
}

// Una sola línea por defecto (nombre, comisión, si ya se pagó) — clic para
// desplegar el formulario. Antes el formulario completo estaba siempre
// visible, incluso en cotizaciones sin vendedor asignado.
function renderCotVendedorCompact(c) {
  var v = c.vendedor || { nombre: "", tipo: "porcentaje", valor: 0, estado: "pendiente" };
  var expandido = state.cotVendedorEditando === c.id;
  var valor = calcComisionValorCot(c);
  var pagado = v.estado === "pagado";

  if (!expandido) {
    var resumen = v.nombre ? (esc(v.nombre) + " · " + fmt(valor) + (pagado ? " · pagada" : " · pendiente")) : "Sin vendedor asignado";
    return '<div class="cot-vendedor-compact" data-action="toggle-cot-vendedor" data-id="' + c.id + '">👤 Vendedor: ' + resumen + "</div>";
  }

  return '<div class="section-sub" style="margin:10px 0 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
    "<span>Vendedor" + renderHelp("Comisión del vendedor de esta cotización: por % del total cotizado, o por un valor fijo. Si la cotización se convierte en pedido, la comisión se traslada automáticamente.") + ":</span>" +
    '<input class="mini-input" style="width:140px" placeholder="Nombre" value="' + esc(v.nombre) + '" data-action-change="set-cot-vendedor" data-campo="nombre" data-id="' + c.id + '" />' +
    '<select class="mini-input" style="width:120px" data-action-change="set-cot-vendedor" data-campo="tipo" data-id="' + c.id + '">' +
    opt("porcentaje", "% del total", v.tipo) + opt("fijo", "$ Valor fijo", v.tipo) +
    "</select>" +
    '<input type="number" class="mini-input" style="width:100px" placeholder="Valor" value="' + esc(v.valor) + '" data-action-change="set-cot-vendedor" data-campo="valor" data-id="' + c.id + '" />' +
    (v.nombre ? ('<b style="color:var(--ink);">' + fmt(valor) + "</b>" +
      '<button class="status-pill ' + (pagado ? "pagado" : "pendiente") + '" data-action="toggle-comision-cot" data-id="' + c.id + '">' + (pagado ? "pagada" : "pendiente") + "</button>" +
      (!pagado ? ('<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-soft);">Fecha de pago<input type="date" class="mini-input" value="' + esc(v.fechaPago || "") + '" data-action-change="set-cot-vendedor-fecha" data-id="' + c.id + '" /></label>') : "")) : "") +
    '<button class="btn ghost small" data-action="toggle-cot-vendedor" data-id="' + c.id + '">Listo</button>' +
    "</div>";
}

function renderCotTabsStrip(c, tab) {
  var tabs = [["referencias", "Referencias"], ["produccion", "Producción"]];
  var html = '<div class="cot-tabs">';
  tabs.forEach(function (t) {
    html += '<button class="cot-tab-btn' + (tab === t[0] ? " active" : "") + '" data-action="set-cot-tab" data-id="' + c.id + '" data-val="' + t[0] + '">' + t[1] + "</button>";
  });
  html += "</div>";
  return html;
}

// Pestaña "Referencias": qué se está vendiendo y con qué insumos — lo que se
// arma primero al cotizar.
function renderTabReferencias(c) {
  var html = renderReferenciasTabs(c);
  html += '<div class="pedido-actions" style="margin-top:4px;"><button class="btn ghost small" data-action="add-referencia" data-id="' + c.id + '">+ Agregar referencia</button></div>';
  return html;
}


// Pestaña "Producción": todo lo que solo importa una vez se empieza a
// producir — comparación estimado vs. real lado a lado, qué falta comprar,
// costos reales, etapas del flujo y los documentos (que antes tenían su
// propia pestaña, mucho más flaca que esta). Nada queda recogido por
// defecto: son pocas secciones, así que no hace falta esconderlas.
function renderTabProduccion(c, totales, real) {
  var sobrecosto = real.sobrecosto;
  var vClass = sobrecosto === 0 ? "neutra" : (sobrecosto > 0 ? "mala" : "ok");

  var html = '<div class="cot-col-title">Estimado vs. real' + renderHelp("Estimado es lo que se planeó al cotizar. Real ajusta esos números con los costos reales que hayas registrado abajo, para comparar lo planeado contra lo que en verdad pasó.") + "</div>";
  html += '<div class="cot-compara-grid">' +
    '<div class="cot-compara-col">' +
    '<div class="cot-compara-titulo">Estimado</div>' +
    '<div class="cot-resumen-total">' +
    '<div><div class="rl">Costo total</div><div class="rv">' + fmt(totales.costoTotal) + "</div></div>" +
    '<div><div class="rl">Precio total</div><div class="rv">' + fmt(totales.precioTotal) + "</div></div>" +
    '<div><div class="rl">Ganancia</div><div class="rv" style="color:' + (totales.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(totales.gananciaTotal) + "</div></div>" +
    '<div><div class="rl">Margen</div><div class="rv">' + totales.margenPct.toFixed(1) + "%</div></div>" +
    "</div></div>" +
    '<div class="cot-compara-col">' +
    '<div class="cot-compara-titulo">Real</div>' +
    '<div class="cot-resumen-total">' +
    '<div><div class="rl">Costo total</div><div class="rv">' + fmt(real.costoTotal) + "</div></div>" +
    '<div><div class="rl">Precio total</div><div class="rv">' + fmt(real.precioTotal) + "</div></div>" +
    '<div><div class="rl">Ganancia</div><div class="rv" style="color:' + (real.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(real.gananciaTotal) + "</div></div>" +
    '<div><div class="rl">Margen</div><div class="rv">' + real.margenPct.toFixed(1) + "%</div></div>" +
    "</div></div>" +
    "</div>";

  if (sobrecosto !== 0) {
    // Antes esto era una sola línea de texto centrada, pegada a la comparación
    // de arriba: la cifra que más importa de toda la pestaña competía por
    // espacio con la tabla y se leía como un pie de foto. Ahora es un aviso
    // con su propio bloque — ícono, cifra grande y una segunda línea que
    // explica contra qué se está comparando.
    var variacionPct = totales.costoTotal > 0 ? (sobrecosto / totales.costoTotal * 100) : 0;
    var esSobrecosto = sobrecosto > 0;
    html += '<div class="variacion ' + vClass + '">' +
      '<span class="variacion-icono">' + (esSobrecosto ? "▲" : "▼") + "</span>" +
      '<span class="variacion-texto">' +
      "<b>" + (esSobrecosto ? "Sobrecosto de " : "Ahorro de ") + fmt(Math.abs(sobrecosto)) + "</b>" +
      "<small>" +
      (totales.costoTotal > 0
        ? ((esSobrecosto ? "+" : "−") + Math.abs(variacionPct).toFixed(1) + "% sobre el costo que se había cotizado (" + fmt(totales.costoTotal) + ")")
        : "Todavía no hay un costo cotizado con qué compararlo") +
      "</small></span></div>";
  }

  var compras = calcListaCompras(c);
  var hayProveedor = (c.referencias || []).some(function (r) { return r.origen === "proveedor"; });

  html += '<hr class="stitch cot-section-divider" />';
  html += renderTablaCompras(c, compras, hayProveedor);

  // Los costos reales del modelo anterior (un registro suelto que elegía su
  // destino en un desplegable) se siguen mostrando si la cotización ya los
  // tenía — solo de lectura, para no perder el dato ni obligar a rehacerlo.
  if ((c.gastosReales || []).length) {
    html += '<hr class="stitch cot-section-divider" />';
    html += '<div class="cot-col-title">Costos reales registrados antes' +
      renderHelp("Registrados con el formulario anterior, cuando los costos reales vivían separados de la lista de compras. Siguen contando en el resultado real; de acá en adelante usa la tabla de arriba.") +
      "</div>";
    (c.gastosReales || []).forEach(function (g) {
      var etiquetaDestino = g.destino === "insumo" ? ((g.destinoEsProducto ? " — referencia: " : " — insumo: ") + esc(g.destinoNombre || "")) : " — costo total";
      var variacion = calcCotGastoVariacion(c, g);
      var vTxt = variacion === 0 ? "igual a lo estimado" : (variacion > 0 ? "+" + fmt(variacion) + " sobre lo estimado" : "-" + fmt(Math.abs(variacion)) + " bajo lo estimado");
      html += '<div class="cot-line"><span class="concept">' + esc(g.concepto) + etiquetaDestino + (g.nota ? " — " + esc(g.nota) : "") + " · " + esc(g.fecha) +
        '<br><span style="color:var(--ink-faint);font-size:11.5px;">Estimado: ' + fmt(calcCotGastoEstimadoBase(c, g)) + " · " + vTxt + "</span></span>" +
        '<span class="amount">' + fmt(g.monto) + "</span> " +
        '<button class="btn danger small" data-action="remove-cot-gasto" data-cot="' + c.id + '" data-gasto="' + g.id + '">✕</button></div>';
    });
  }

  html += '<hr class="stitch cot-section-divider" />';
  html += renderProduccionDocumentos(c);

  return html;
}

// ---------- Compras: estimado y real en UNA sola tabla ----------
// Antes esto eran dos secciones separadas que decían lo mismo desde dos
// lados: "Qué falta comprar" (lo estimado, ya desglosado) y "Costos reales"
// (un formulario aparte donde había que volver a elegir en un desplegable
// cuál insumo se había comprado). Como la lista de compras YA es el desglose
// del estimado, registrar lo real es simplemente llenar dos columnas más en
// la misma fila — sin volver a decir de qué insumo se está hablando.
var COMPRA_COLS = "1.3fr 1fr 90px 105px 90px 105px 120px";

function renderTablaCompras(c, compras, hayProveedor) {
  var resumen = calcResumenCompras(c);
  var html = '<div class="cot-col-title">Compras del pedido' +
    renderHelp("Cada línea es algo que hay que comprar, con lo que se estimó al cotizar y lo que en verdad costó. Marca \"Comprado\" y llena el costo real: la diferencia contra lo estimado se calcula sola y alimenta el resultado real de arriba. El botón de abajo lleva esas compras a Finanzas como movimientos de gasto." +
      (hayProveedor ? " Las referencias que se compran hechas aparecen como una sola línea, en unidades, no desglosadas en insumos." : "")) +
    "</div>";

  if (!compras.length) {
    return html + '<div class="empty" style="padding:8px 0;">Agrega insumos a las referencias (o costos globales del pedido) para ver acá lo que hay que comprar.</div>';
  }

  html += '<div class="tx-row head" style="grid-template-columns:' + COMPRA_COLS + ';">' +
    "<span>Qué comprar</span><span>Para / a quién</span><span>Cant. est.</span><span>Costo est.</span><span>Cant. real</span><span>Costo real</span><span>Comprado</span></div>";

  compras.forEach(function (linea) {
    html += renderFilaCompra(c, linea);
  });

  var diferencia = resumen.real - resumen.estimado;
  html += '<div class="section-sub" style="margin:10px 0 0;">' +
    resumen.compradas + " de " + resumen.total + " comprado(s) · estimado <b>" + fmt(resumen.estimado) + "</b>" +
    (resumen.compradas
      ? " · pagado <b>" + fmt(resumen.real) + "</b> (solo lo ya comprado)"
      : "") +
    "</div>";
  if (resumen.compradas && diferencia !== 0 && resumen.compradas === resumen.total) {
    html += '<div class="section-sub" style="margin:2px 0 0;color:' + (diferencia > 0 ? "var(--danger-ink)" : "var(--success-ink)") + ';">' +
      (diferencia > 0 ? "Se gastó " + fmt(diferencia) + " más de lo estimado." : "Se ahorró " + fmt(Math.abs(diferencia)) + " frente a lo estimado.") + "</div>";
  }

  html += '<div class="row-actions" style="margin-top:12px;flex-wrap:wrap;">' +
    '<button class="btn" data-action="sincronizar-compras-finanzas" data-id="' + c.id + '" title="Crea (o actualiza) un movimiento de gasto en Finanzas por cada compra marcada, y borra el de las que se hayan desmarcado. Se puede volver a pulsar cuantas veces haga falta: nunca duplica.">Actualizar movimientos financieros</button>' +
    (c.estado === "convertida"
      ? '<button class="btn ghost small" data-action="add-cot-estimado-movimiento" data-id="' + c.id + '" title="Registra el costo total ESTIMADO del pedido como UN solo movimiento en Finanzas. Es una alternativa a llevar las compras reales una por una: registrar los dos contaría el mismo costo dos veces.">' +
        (c.estimadoTxId ? "Actualizar el estimado ya registrado" : "Registrar estimado completo como movimiento") + "</button>"
      : '<span class="tag" style="background:var(--surface-3);" title="Disponible una vez esta cotización ya sea un pedido — es una medida de seguridad para no registrar gastos sin que exista un pedido con abono real.">🔒 Estimado completo (disponible al convertir en pedido)</span>') +
    "</div>";
  return html;
}

function renderFilaCompra(c, linea) {
  var compra = compraDeLinea(c, linea.clave) || {};
  var comprado = !!compra.comprado;
  var abierta = (state.compraDetalleAbierto || {})[c.id + "|" + linea.clave];
  var attrs = ' data-action-change="set-cot-compra" data-cot="' + c.id + '" data-clave="' + esc(linea.clave) + '"';
  var proveedorId = compra.proveedorId || linea.proveedorId || "";
  var proveedor = proveedorId ? clienteById(proveedorId) : null;

  // Un servicio (diseño, confección, domicilio) no se compra por cantidad:
  // "11 UND de confección" no significa nada. Se dice "servicio" y no se pide
  // cantidad real, solo cuánto costó.
  var estimadoCant = linea.esServicio
    ? '<span style="color:var(--ink-faint);">servicio</span>'
    : (linea.esProducto ? linea.cantidadFisica + " UND" : num(linea.cantidadFisica).toFixed(2) + " " + esc(linea.unidad || ""));

  var paraQuien = linea.esGlobal
    ? '<span class="badge">Todo el pedido</span>'
    : (linea.esProducto
      ? (proveedor ? '<span class="badge">📦 ' + esc(proveedor.nombre) + "</span>" : '<span class="muted">Proveedor sin definir</span>')
      : (linea.refs.length ? linea.refs.map(function (r) { return '<span class="badge">' + esc(r) + "</span>"; }).join("") : '<span class="muted">—</span>'));

  var html = '<div class="tx-row" style="grid-template-columns:' + COMPRA_COLS + ';">' +
    '<span class="mobile-th">Qué comprar</span><span>' + (linea.esGlobal ? "🌐 " : (linea.esProducto ? "📦 " : "")) + esc(linea.nombre) +
    (linea.esServicio ? ' <span class="tag">servicio</span>' : "") + "</span>" +
    '<span class="mobile-th">Para / a quién</span><span>' + paraQuien + "</span>" +
    '<span class="mobile-th">Cant. est.</span><span class="amount">' + estimadoCant + "</span>" +
    '<span class="mobile-th">Costo est.</span><span class="amount">' + fmt(linea.costoTotal) + "</span>" +
    '<span class="mobile-th">Cant. real</span>' +
    (linea.esServicio
      ? '<span class="amount" style="color:var(--ink-faint);">—</span>'
      : '<input type="number" class="mini-input" style="width:100%" placeholder="' + (linea.esProducto ? linea.cantidadFisica : num(linea.cantidadFisica).toFixed(2)) + '" value="' + esc(compra.cantidadReal !== undefined ? compra.cantidadReal : "") + '"' + attrs + ' data-campo="cantidadReal" />') +
    '<span class="mobile-th">Costo real</span><input type="number" class="mini-input" style="width:100%" placeholder="' + Math.round(num(linea.costoTotal)) + '" value="' + esc(compra.costoReal !== undefined ? compra.costoReal : "") + '"' + attrs + ' data-campo="costoReal" />' +
    '<span class="mobile-th">Comprado</span><span style="display:flex;gap:6px;align-items:center;">' +
    '<label class="mini-label" style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" ' + (comprado ? "checked" : "") + attrs + ' data-campo="comprado" /> Sí</label>' +
    '<button class="btn ghost small" data-action="toggle-compra-detalle" data-cot="' + c.id + '" data-clave="' + esc(linea.clave) + '" title="Proveedor y observaciones de esta compra">' + (abierta ? "▾" : "▸") + "</button>" +
    "</span></div>";

  if (abierta) {
    html += '<div class="compra-detalle">' +
      '<div class="field"><label>Proveedor</label>' + renderSelectProveedorCompra(c, linea, proveedorId, attrs) + "</div>" +
      '<div class="field" style="flex:1;"><label>Observaciones</label><input class="mini-input" style="width:100%" placeholder="Ej. quedó pendiente medio rollo, precio subió" value="' + esc(compra.observaciones || "") + '"' + attrs + ' data-campo="observaciones" /></div>' +
      "</div>";
  }
  return html;
}

function renderSelectProveedorCompra(c, linea, proveedorId, attrs) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<span class="section-sub" style="margin:0;">Sin proveedores — agrégalos en Contactos.</span>';
  }
  return '<select class="mini-input" style="width:100%"' + attrs + ' data-campo="proveedorId">' +
    '<option value="">Sin especificar</option>' +
    proveedores.map(function (p) { return '<option value="' + p.id + '" ' + (proveedorId === p.id ? "selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") +
    "</select>";
}

// Documentos: antes tenía su propia pestaña, pero era demasiado flaca para
// justificarla sola — se dividió en dos columnas (para el cliente / para ti)
// dentro de Producción, con botones más grandes.
function renderProduccionDocumentos(c) {
  var html = '<div class="cot-col-title">Documentos</div>';
  html += '<div class="cot-docs-grid">';

  html += '<div class="cot-docs-col">' +
    '<div class="cot-docs-titulo">Para el cliente</div>' +
    '<button class="btn cot-doc-btn" data-action="generar-pdf" data-id="' + c.id + '">📄 Generar PDF para el cliente</button>' +
    '<button class="btn ghost cot-doc-btn" data-action="enviar-cotizacion-correo" data-id="' + c.id + '" title="Envía el PDF de la cotización al correo del cliente (debe estar registrado en Contactos)">✉ Enviar por correo</button>' +
    "</div>";

  html += '<div class="cot-docs-col">' +
    '<div class="cot-docs-titulo">Para ti (control interno)' + renderHelp("Este PDF no es para el cliente: es para tu propio control interno. Elige qué secciones incluir — de pronto solo quieres la lista de compras, o de pronto toda la información.") + "</div>" +
    '<div class="row-actions" style="flex-wrap:wrap;gap:10px;margin-bottom:10px;">' +
      checkboxPdfInterno("pdfint-general", "Datos generales", true) +
      checkboxPdfInterno("pdfint-referencias", "Referencias e insumos", true) +
      checkboxPdfInterno("pdfint-compras", "Compras (estimado y real)", true) +
      checkboxPdfInterno("pdfint-reales", "Costos reales antiguos", (c.gastosReales || []).length > 0) +
      checkboxPdfInterno("pdfint-vendedor", "Comisión vendedor", !!(c.vendedor && c.vendedor.nombre)) +
      "</div>" +
    '<button class="btn ghost cot-doc-btn" data-action="generar-pdf-interno" data-id="' + c.id + '">🗂 Generar PDF interno</button>' +
    "</div>";

  html += "</div>";
  return html;
}

function checkboxPdfInterno(role, label, checked) {
  return '<label class="mini-label" style="display:flex;align-items:center;gap:5px;">' +
    '<input type="checkbox" data-role="' + role + '" ' + (checked ? "checked" : "") + " /> " + esc(label) +
    "</label>";
}

// Antes las referencias se apilaban todas con scroll — con más de dos o
// tres, la vista se saturaba de golpe. Ahora solo se ve la referencia
// activa; el resto queda en pestañas cortas (nombre + precio total) arriba.
function renderReferenciasTabs(c) {
  var refs = c.referencias || [];
  if (!refs.length) return '<div class="empty" style="margin:10px 0;">Sin referencias todavía.</div>';
  var activaId = state.refActiva[c.id];
  if (!activaId || !refs.some(function (r) { return r.id === activaId; })) activaId = refs[0].id;
  var html = "";
  if (refs.length > 1) {
    html += '<div class="ref-tabs">' +
      refs.map(function (r, i) {
        var t = calcRefTotales(r);
        return '<button class="ref-tab ' + (r.id === activaId ? "active" : "") + '" data-action="set-ref-activa" data-cot="' + c.id + '" data-ref="' + r.id + '">' +
          esc(r.nombre || "Referencia " + (i + 1)) + '<span class="ref-tab-meta">' + fmt(t.precioTotal) + "</span></button>";
      }).join("") +
      "</div>";
  }
  var activa = refs.filter(function (r) { return r.id === activaId; })[0];
  html += renderRefCard(c.id, activa);
  return html;
}

// A qué Contacto (tipo Proveedor) se le compra esta referencia. Es el mismo
// directorio que usan los productos del catálogo, así que el historial de
// compras del proveedor y sus listas de precios sirven para las dos cosas.
function renderSelectorProveedorRef(cotId, ref) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<span><label>Proveedor</label><span class="section-sub" style="margin:0;flex:1;">Sin proveedores en Contactos.</span></span>';
  }
  return '<span><label>Proveedor</label><select class="mini-input" style="flex:1;" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="proveedorId">' +
    '<option value="">Elegir proveedor…</option>' +
    proveedores.map(function (pr) { return '<option value="' + pr.id + '" ' + (ref.proveedorId === pr.id ? "selected" : "") + ">" + esc(pr.nombre) + "</option>"; }).join("") +
    "</select></span>";
}

// Reemplaza a la tabla de insumos para una referencia comprada: los mismos
// indicadores de siempre (costo, ganancia, margen, totales), porque el
// costo por unidad ya lo resuelve calcCostoUnitarioRef a partir del costo de
// compra — no hay una segunda fórmula acá.
function renderRefProveedorResumen(ref, calc) {
  var proveedor = ref.proveedorId ? clienteById(ref.proveedorId) : null;
  var html = '<div class="section-sub" style="margin:10px 0 0;">📦 Se compra hecha' +
    (proveedor ? " a <b>" + esc(proveedor.nombre) + "</b>" : "") +
    (ref.fechaEntregaProveedor ? " · llega el " + esc(ref.fechaEntregaProveedor) : "") +
    " — sin insumos ni fases de producción. El progreso se sigue como pendiente/recibido.</div>";
  html += '<div class="ref-summary">' +
    '<div class="rs-item"><div class="rl">Costo x prenda' +
    (calc.costoGlobalUnit
      ? renderHelp("Incluye " + fmt(calc.costoDirectoUnit) + " de los insumos de esta referencia, más " + fmt(calc.costoGlobalUnit) + " que le toca de los costos globales del pedido (los de abajo de la línea intermitente). Es el mismo costo con el que cuentan el total de la cotización y el reporte de productos vendidos.")
      : "") +
    '</div><div class="rv">' + fmt(calc.costoUnit) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia x prenda</div><div class="rv">' + fmt(calc.gananciaUnit) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Margen</div><div class="rv"><span class="margen-badge ' + (calc.margenPct >= 0 ? "pos" : "neg") + '">' + calc.margenPct.toFixed(1) + "%</span></div></div>" +
    '<div class="rs-item"><div class="rl">Costo total (' + esc(ref.cantidadPedida) + ')</div><div class="rv">' + fmt(calc.costoTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Precio total</div><div class="rv">' + fmt(calc.precioTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia total</div><div class="rv" style="color:' + (calc.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(calc.gananciaTotal) + "</div></div>" +
    "</div>";
  return html;
}

var INS_COLS_REF = "1fr 90px 90px 165px 70px 90px 30px";

// Los costos globales del pedido (domicilio, diseño, un envío a sublimar) se
// ven al final de la tabla de insumos de TODAS las referencias, separados por
// una línea intermitente: no pertenecen a ninguna en particular, aplican a
// todo el pedido. Se convierte un insumo normal en global eligiéndole el tipo
// de costo "Costo global del pedido" — ahí deja la referencia donde estaba y
// pasa a esta lista, sin un panel aparte que sature la pantalla.
//
// Su costo por prenda es el promedio: el costo total dividido entre la suma
// de prendas de todas las referencias.
function renderFilasGlobales(cotId, ref) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  var globales = (cot && cot.costosGlobales) || [];
  if (!globales.length) return "";
  var unidades = calcUnidadesCotizacion(cot);
  // El detalle del reparto vive en el "?" y no como una línea de texto bajo la
  // tabla: es información de consulta, no algo que haga falta leer siempre.
  var html = '<div class="ins-row-separador">' +
    '<span class="ins-row-separador-nota">Costos de todo el pedido' +
    renderHelp("Se pagan una vez por el pedido completo, no por esta referencia: por eso aparecen igual en todas. Suman " + fmt(calcCostosGlobales(cot)) +
      (unidades > 0 ? ", que repartidos entre las " + unidades + " prenda(s) del pedido son " + fmt(calcCostosGlobales(cot) / unidades) + " por prenda." : ".") +
      " Ese valor por prenda ya está incluido en el \"Costo x prenda\" de cada referencia.") +
    "</span></div>";
  globales.forEach(function (g) {
    var attrs = ' data-action-change="set-costo-global" data-cot="' + cotId + '" data-global="' + g.id + '"';
    html += '<div class="ins-row global" style="grid-template-columns:' + INS_COLS_REF + ';">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" placeholder="Ej. domicilio, diseño" value="' + esc(g.nombre || "") + '"' + attrs + ' data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" list="dl-unidades" value="' + esc(g.unidad || "") + '"' + attrs + ' data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(g.costo) + '"' + attrs + ' data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%"' + attrs + ' data-campo="tipo">' + renderTipoCostoOptions("global") + "</select>" +
      // La cantidad no aplica: se paga una vez, no por prenda.
      '<span class="mobile-th">Cant.</span><input type="number" class="mini-input" style="width:100%" value="1" disabled />' +
      '<span class="mobile-th">Costo x prenda</span><span class="amount" title="' + fmt(g.costo) + " entre " + unidades + ' prenda(s) del pedido">' + fmt(calcCostoPrendaGlobal(cot, g)) + "</span>" +
      '<button class="btn danger small" data-action="remove-costo-global" data-cot="' + cotId + '" data-global="' + g.id + '">✕</button>' +
      "</div>";
  });
  return html;
}

// El ORIGEN de la referencia no es un campo más: es lo que decide qué
// formulario se muestra. Una referencia fabricada en el taller se costea con
// insumos y consumo de tela; una comprada a proveedor llega hecha, así que no
// tiene ni insumos ni consumo — su costo es el precio de compra, y lo que
// hace falta saber es a quién se le compra y cuándo llega. Por eso va como
// control segmentado arriba de todo, y no como un <select> perdido entre los
// demás campos: cambiarlo reescribe la referencia entera.
function renderRefCard(cotId, ref) {
  var cotRef = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  // Costo CARGADO: el directo de la referencia más la parte que le toca de
  // los costos globales del pedido. Es el mismo número que usan el total de
  // la cotización y el reporte de productos vendidos — antes la referencia
  // mostraba solo el directo y parecía que las cuentas no cuadraban.
  var calc = calcRefTotalesConGlobales(cotRef, ref);
  var esProveedor = ref.origen === "proveedor";
  var attrs = ' data-cot="' + cotId + '" data-ref="' + ref.id + '"';
  var html = '<div class="ref-card" data-ref-id="' + ref.id + '">' +
    '<div class="ref-top">' +
    renderThumb(cotId, ref) +
    '<div class="ref-top-info">' +
    '<span class="ref-nombre"><input class="mini-input" style="width:100%;font-weight:700;font-size:14px;" placeholder="Nombre de la referencia (ej. Camiseta jugador)" value="' + esc(ref.nombre) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="nombre" /></span>' +
    '<div class="segmented" style="margin:8px 0 4px;">' +
    '<button class="segmented-opcion ' + (esProveedor ? "" : "active") + '" data-action="set-ref-origen"' + attrs + ' data-val="taller">🧵 Se fabrica en el taller</button>' +
    '<button class="segmented-opcion ' + (esProveedor ? "active" : "") + '" data-action="set-ref-origen"' + attrs + ' data-val="proveedor">📦 Se compra a proveedor</button>' +
    "</div>" +
    '<div class="ref-fields">' +
    (esProveedor ? "" : '<span><label>Consumo tela (MT)</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.consumoAprox) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="consumoAprox" /></span>') +
    '<span><label>Cantidad pedido</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.cantidadPedida) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="cantidadPedida" /></span>' +
    '<span><label>Precio venta x1</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.precioVenta) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="precioVenta" /></span>' +
    (esProveedor
      ? ('<span><label>Costo de compra x1' + renderHelp("Lo que te cobra el proveedor por cada unidad. Reemplaza a los insumos: de acá sale el costo y la ganancia de la referencia.") + '</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.costoCompra || "") + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="costoCompra" /></span>' +
        renderSelectorProveedorRef(cotId, ref) +
        '<span><label>Entrega esperada</label><input type="date" class="mini-input" style="flex:1;" value="' + esc(ref.fechaEntregaProveedor || "") + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="fechaEntregaProveedor" /></span>')
      : "") +
    '<button class="btn danger small" style="align-self:flex-start;" data-action="remove-referencia"' + attrs + ">Eliminar referencia</button>" +
    "</div>" +
    "</div>" +
    "</div>";

  // Insumos, plantillas y "aplicar producto" solo tienen sentido si la prenda
  // se fabrica. Para una referencia de proveedor esa tabla entera sale del
  // contexto: no hay nada que cortar, coser ni comprar por separado.
  if (esProveedor) {
    html += renderRefProveedorResumen(ref, calc);
    html += renderDetalleReferencia(cotId, ref);
    html += "</div>"; // .ref-card
    return html;
  }

  html += '<div class="ins-table">' +
    '<div class="ins-row head" style="grid-template-columns:1fr 90px 90px 165px 70px 90px 30px;"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant.</span><span>Costo x prenda</span><span></span></div>';
  (ref.insumos || []).forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:1fr 90px 90px 165px 70px 90px 30px;">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" list="dl-unidades" value="' + esc(i.unidad) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<span class="mobile-th">Cant.</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<span class="mobile-th">Costo x prenda</span><span class="amount">' + fmt(calcCostoPrenda(i, ref)) + "</span>" +
      '<button class="btn danger small" data-action="remove-insumo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-insumo="' + i.id + '">✕</button>' +
      "</div>";
  });
  if ((ref.insumos || []).length === 0) { html += '<div class="empty" style="padding:8px 0;">Sin insumos aún.</div>'; }
  html += renderFilasGlobales(cotId, ref);
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;">' +
    '<button class="btn ghost small" data-action="abrir-insumo-picker" data-cot="' + cotId + '" data-ref="' + ref.id + '">📂 Insumos predeterminados…</button>' +
    '<button class="btn ghost small" data-action="add-insumo-personalizado" data-cot="' + cotId + '" data-ref="' + ref.id + '">+ Insumo personalizado</button>' +
    ((state.plantillasPrendas || []).length ? (
      '<select class="mini-input applyPlantilla" style="max-width:220px" data-action-change="aplicar-plantilla" data-cot="' + cotId + '" data-ref="' + ref.id + '">' +
      '<option value="">Aplicar plantilla…</option>' +
      state.plantillasPrendas.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") +
      "</select>"
    ) : "") +
    ((state.productos || []).length ? (
      '<select class="mini-input" style="max-width:220px" data-action-change="aplicar-producto" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Trae los insumos, el precio y el flujo de un producto del catálogo (prenda ya hecha con stock)">' +
      '<option value="">Aplicar producto del catálogo…</option>' +
      state.productos.map(function (p) { return '<option value="' + p.id + '" ' + (ref.productoId === p.id ? "selected" : "") + '>' + esc(p.nombre) + "</option>"; }).join("") +
      "</select>"
    ) : "") +
    "</div>";

  html += '<div class="ref-summary">' +
    '<div class="rs-item"><div class="rl">Costo x prenda' +
    (calc.costoGlobalUnit
      ? renderHelp("Incluye " + fmt(calc.costoDirectoUnit) + " de los insumos de esta referencia, más " + fmt(calc.costoGlobalUnit) + " que le toca de los costos globales del pedido (los de abajo de la línea intermitente). Es el mismo costo con el que cuentan el total de la cotización y el reporte de productos vendidos.")
      : "") +
    '</div><div class="rv">' + fmt(calc.costoUnit) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia x prenda</div><div class="rv">' + fmt(calc.gananciaUnit) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Margen</div><div class="rv"><span class="margen-badge ' + (calc.margenPct >= 0 ? "pos" : "neg") + '">' + calc.margenPct.toFixed(1) + "%</span></div></div>" +
    '<div class="rs-item"><div class="rl">Costo total (' + esc(ref.cantidadPedida) + ')</div><div class="rv">' + fmt(calc.costoTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Precio total</div><div class="rv">' + fmt(calc.precioTotal) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia total</div><div class="rv" style="color:' + (calc.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(calc.gananciaTotal) + "</div></div>" +
    "</div>";

  html += renderDetalleReferencia(cotId, ref);

  html += "</div>"; // .ref-card
  return html;
}

// "Opciones adicionales" agrupa lo que no toda referencia necesita: etapas
// de producción (cada una puede llevar un flujo distinto) y tallas/observaciones
// (típico de uniformes, no de todo lo que se cotiza). Etapas va primero.
// Las filas de tallas SÍ son editables in-place (antes en pedidos solo se
// podían borrar y volver a crear si había un error de digitación).
function renderDetalleReferencia(cotId, ref) {
  var detalle = ref.detalle || [];
  var tieneEstadosPersonalizados = !!(ref.estadosDef && ref.estadosDef.length);
  // Colapsada por defecto hasta que tenga datos — en cuanto se usa (o una
  // plantilla le asigna un flujo propio), queda abierta sola de ahí en
  // adelante; se puede colapsar/expandir a mano. Mientras se están repartiendo
  // integrantes entre referencias se fuerza abierta: si no, mover la última
  // fila fuera de esta referencia cerraba de golpe el panel donde se estaba
  // trabajando.
  var abierta = state.detalleModoRefs === cotId
    ? true
    : (ref.seccionOpcionalesAbierta !== undefined ? !!ref.seccionOpcionalesAbierta : (detalle.length > 0 || tieneEstadosPersonalizados));
  var titulo = "Opciones adicionales" + (detalle.length ? " · tallas (" + detalle.length + ")" : "");
  var html = '<div class="cot-col-title" style="margin-top:14px;cursor:pointer;" data-action="toggle-ref-seccion" data-cot="' + cotId + '" data-ref="' + ref.id + '">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierta ? "▾" : "▸") + "</button> " + titulo +
    "</div>";
  if (!abierta) return html;

  html += '<div class="cot-col-title" style="margin-top:0;text-transform:none;font-weight:600;font-size:12.5px;color:var(--ink-soft);">Etapas de producción' +
    renderHelp("Cada referencia puede tener su propio flujo (ej. Cortado, Confección, Acabados...) — no todas las prendas pasan por las mismas. Si le aplicaste una plantilla con un flujo asignado, nace precargado con ese.") +
    "</div>";
  html += renderEstadosRef(cotId, ref);

  html += '<div class="cot-col-title" style="margin-top:18px;text-transform:none;font-weight:600;font-size:12.5px;color:var(--ink-soft);">Tallas y observaciones' +
    renderHelp("Para uniformes o pedidos personalizados: cada fila puede ser una persona/unidad con su talla, número y observación propia. Se incluye en el PDF de orden de producción de los pedidos que salgan de esta cotización. Si este listado crece más que la cantidad cotizada de la referencia, la cantidad sube sola para que coincidan (nunca al revés).") +
    "</div>";
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  var clienteRoster = cot && cot.clienteId ? clienteById(cot.clienteId) : null;
  var repartiendo = state.detalleModoRefs === cotId;
  var variasRefs = ((cot && cot.referencias) || []).length > 1;
  html += '<div class="row-actions" style="margin:0 0 8px;flex-wrap:wrap;">' +
    (clienteRoster && (clienteRoster.roster || []).length
      ? '<button class="btn ghost small" data-action="cargar-roster-cliente" data-cot="' + cotId + '" data-ref="' + ref.id + '">🎽 Cargar roster de ' + esc(clienteRoster.nombre) + " (" + clienteRoster.roster.length + ")</button>"
      : "") +
    (variasRefs
      ? '<button class="btn ' + (repartiendo ? "" : "ghost ") + 'small" data-action="toggle-reparto-referencias" data-cot="' + cotId + '">' +
        (repartiendo ? "✓ Listo" : "✎ Repartir entre referencias") + "</button>" +
        renderHelp("Sube la lista de nombres UNA sola vez en cualquier referencia y desde acá reparte a cada integrante a la suya, sin tener que borrarla y volver a importarla. Mientras repartes, la columna de observaciones se cambia por la de referencia y se ven las filas de todas las referencias juntas.")
      : "") +
    "</div>";
  if (repartiendo) return html + renderRepartoReferencias(cotId);
  if (detalle.length > 0) {
    html += '<div class="detalle-table">' +
      '<div class="det-row head"><span>#</span><span>Nombre</span><span>Talla</span><span>Número</span><span>Tipo</span><span>Observaciones</span><span></span></div>';
    detalle.forEach(function (d, i) {
      html += '<div class="det-row">' +
        '<span class="mobile-th">#</span><span>' + (i + 1) + "</span>" +
        '<span class="mobile-th">Nombre</span><input class="mini-input" value="' + esc(d.nombre) + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="nombre" />' +
        '<span class="mobile-th">Talla</span><input class="mini-input" value="' + esc(d.talla || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="talla" />' +
        '<span class="mobile-th">Número</span><input class="mini-input" value="' + esc(d.numero || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="numero" />' +
        '<span class="mobile-th">Tipo</span><input class="mini-input" value="' + esc(d.tipo || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="tipo" />' +
        '<span class="mobile-th">Observaciones</span><input class="mini-input" value="' + esc(d.observaciones || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="observaciones" />' +
        '<button class="btn danger small" data-action="remove-ref-detalle" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '">✕</button>' +
        "</div>";
    });
    html += "</div>";
  } else {
    html += '<div class="empty" style="padding:8px 0;">Sin filas aún — útil para uniformes: nombre, talla, número...</div>';
  }
  html += '<div class="inline-form" style="margin-top:6px;">' +
    '<input class="mini-input" data-role="det-nombre-' + ref.id + '" placeholder="Nombre" style="width:120px" />' +
    '<input class="mini-input" data-role="det-talla-' + ref.id + '" placeholder="Talla" style="width:60px" />' +
    '<input class="mini-input" data-role="det-numero-' + ref.id + '" placeholder="Número" style="width:60px" />' +
    '<input class="mini-input" data-role="det-tipo-' + ref.id + '" placeholder="Tipo (jugador, arquero...)" style="width:150px" />' +
    '<input class="mini-input" data-role="det-obs-' + ref.id + '" placeholder="Observaciones" style="width:160px" />' +
    '<button class="btn ghost small" data-action="add-ref-detalle" data-cot="' + cotId + '" data-ref="' + ref.id + '">Agregar fila</button>' +
    "</div>";
  html += '<div class="inline-form" style="margin-top:6px;">' +
    '<label class="btn ghost small" style="cursor:pointer;">📥 Importar Excel<input type="file" accept=".xlsx,.xls,.csv" data-action-change="import-ref-detalle-csv" data-cot="' + cotId + '" data-ref="' + ref.id + '" style="display:none" /></label>' +
    '<button class="btn ghost small" data-action="descargar-plantilla-csv">Descargar plantilla Excel</button>' +
    renderHelp("El archivo debe tener columnas: nombre, talla, numero, tipo, observaciones (en cualquier orden). Descarga la plantilla para verlo con un ejemplo — es un .xlsx normal, se abre bien tanto en Excel como en Sheets. También aceptamos CSV si lo prefieres.") +
    "</div>";
  return html;
}

// Modo "repartir": en vez de las filas de UNA referencia, se ven las de
// TODAS juntas y la columna de observaciones se cambia por un selector de
// referencia. Así la lista de nombres se sube una sola vez (importando el
// Excel en cualquier referencia) y desde acá se manda a cada quien a la suya
// — antes tocaba borrar filas de una y volver a escribirlas en la otra.
function renderRepartoReferencias(cotId) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  if (!cot) return "";
  var refs = cot.referencias || [];
  var filas = [];
  refs.forEach(function (r) {
    (r.detalle || []).forEach(function (d) { filas.push({ ref: r, item: d }); });
  });
  if (!filas.length) {
    return '<div class="empty" style="padding:8px 0;">No hay filas que repartir todavía — importa la lista en cualquier referencia y vuelve acá.</div>';
  }

  var COLS = "34px 1.4fr 70px 70px 1fr 34px";
  var html = '<div class="detalle-table">' +
    '<div class="det-row head" style="grid-template-columns:' + COLS + ';"><span>#</span><span>Nombre</span><span>Talla</span><span>Número</span><span>Referencia</span><span></span></div>';
  filas.forEach(function (f, i) {
    var attrs = ' data-cot="' + cotId + '" data-ref="' + f.ref.id + '" data-item="' + f.item.id + '"';
    html += '<div class="det-row" style="grid-template-columns:' + COLS + ';">' +
      '<span class="mobile-th">#</span><span>' + (i + 1) + "</span>" +
      '<span class="mobile-th">Nombre</span><input class="mini-input" value="' + esc(f.item.nombre || "") + '" data-action-change="set-ref-detalle-campo"' + attrs + ' data-campo="nombre" />' +
      '<span class="mobile-th">Talla</span><input class="mini-input" value="' + esc(f.item.talla || "") + '" data-action-change="set-ref-detalle-campo"' + attrs + ' data-campo="talla" />' +
      '<span class="mobile-th">Número</span><input class="mini-input" value="' + esc(f.item.numero || "") + '" data-action-change="set-ref-detalle-campo"' + attrs + ' data-campo="numero" />' +
      '<span class="mobile-th">Referencia</span><select class="mini-input" data-action-change="mover-detalle-a-ref"' + attrs + ">" +
      refs.map(function (r) {
        return '<option value="' + r.id + '" ' + (r.id === f.ref.id ? "selected" : "") + ">" + esc(r.nombre || "Sin nombre") + "</option>";
      }).join("") +
      "</select>" +
      '<button class="btn danger small" data-action="remove-ref-detalle"' + attrs + ">✕</button>" +
      "</div>";
  });
  html += "</div>";

  // Cuántos quedaron en cada referencia vs. su cantidad cotizada: es lo que se
  // está revisando mientras se reparte.
  html += '<div class="section-sub" style="margin:8px 0 0;">' +
    refs.map(function (r) {
      var n = (r.detalle || []).length;
      var pedida = num(r.cantidadPedida) || 0;
      var cuadra = n === pedida;
      return '<span class="badge" style="margin-right:6px;' + (cuadra ? "" : "background:var(--warning-soft);color:var(--warning-ink);") + '">' +
        esc(r.nombre || "Sin nombre") + ": " + n + " de " + pedida + "</span>";
    }).join("") +
    "</div>";
  return html;
}

function renderThumb(cotId, ref) {
  if (state.refImagenSubiendo[ref.id]) {
    return '<span class="ref-thumb ref-thumb-cotizacion ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</span>';
  }
  if (ref.imagenUrl) {
    return '<span class="ref-thumb ref-thumb-cotizacion" data-action="set-ref-imagen" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Clic para subir otra imagen desde tu dispositivo">' +
      '<img src="' + esc(ref.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-zoom" data-action="abrir-imagen-preview" data-url="' + esc(ref.imagenUrl) + '" title="Ver en grande">🔍</button>' +
      '<button class="ref-thumb-remove" data-action="quitar-ref-imagen" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Quitar imagen">✕</button>' +
      "</span>";
  }
  return '<span class="ref-thumb ref-thumb-cotizacion ref-thumb-empty" data-action="set-ref-imagen" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Subir una imagen desde tu dispositivo (se guarda en tu Google Drive)">+ imagen</span>';
}

export var actions = {
  "cot-vista": function (el) {
    // Irse al Historial deja el detalle atrás: si hay cambios sin guardar,
    // se avisa antes (si no, se perderían sin que nadie los vea).
    if (el.getAttribute("data-val") === "historial" && !confirmarSalidaSiSucia()) return;
    state.cotizacionesVista = el.getAttribute("data-val");
    notify();
  },
  "set-cot-tab": function (el) {
    var id = el.getAttribute("data-id"), valTab = el.getAttribute("data-val");
    state.cotTabActiva = Object.assign({}, state.cotTabActiva, { [id]: valTab });
    notify();
  },
  "toggle-cot-vendedor": function (el) {
    var id = el.getAttribute("data-id");
    state.cotVendedorEditando = state.cotVendedorEditando === id ? "" : id;
    notify();
  },
  "set-ref-activa": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    state.refActiva = Object.assign({}, state.refActiva, { [cotId]: refId });
    notify();
  },
  "toggle-ref-seccion": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    mapRef(cotId, refId, function (r) {
      var abierta = r.seccionOpcionalesAbierta !== undefined ? !!r.seccionOpcionalesAbierta : (r.detalle || []).length > 0;
      return Object.assign({}, r, { seccionOpcionalesAbierta: !abierta });
    });
  },
  "add-cotizacion": function () {
    var fc = state.formCotizacion;
    if (!exigirCampos([["Cliente", fc.cliente], ["Descripción", fc.descripcion]])) return;
    var nueva = { id: uid(), clienteId: fc.clienteId || "", cliente: fc.cliente, descripcion: fc.descripcion, fecha: fc.fecha, fechaEntrega: fc.fechaEntrega || "", referencias: [nuevaReferencia()], gastosReales: [], estado: "borrador", pedidoId: "", iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: codigoPublico() };
    state.cotizaciones.unshift(nueva);
    state.formCotizacion = { clienteId: "", cliente: "", descripcion: "", fecha: todayStr(), fechaEntrega: "" };
    // Se queda en esta misma pestaña, ahora mostrando el detalle completo de
    // la recién creada — el detalle SIEMPRE vive acá, nunca en Historial.
    state.cotizacionEditando = nueva.id;
    guardarCotizaciones(); // nace guardada y con su punto de retorno tomado
    notify();
  },
  // Abrir desde Historial siempre manda a esta pestaña con el detalle
  // completo — Historial en sí nunca muestra más que la tarjeta chica.
  "abrir-cotizacion-editor": function (el) {
    // Abrir otra cotización descarta el borrador de la anterior: se avisa
    // antes (solo puede haber una abierta a la vez).
    if (!confirmarSalidaSiSucia()) return;
    state.cotizacionEditando = el.getAttribute("data-id");
    state.cotizacionesVista = "nueva";
    tomarSnapshotCotizacion();
    notify();
  },
  // ---------- guardar / descartar ----------
  "guardar-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    // La fecha de entrega baja al pedido vinculado recién acá (al guardar),
    // no en cada tecla: así el pedido —y con él "Próximas entregas" y el
    // recordatorio de Calendar— refleja siempre una fecha confirmada, no una
    // que se estaba tanteando.
    if (cot) propagarFechaEntrega(cot);
    guardarCotizaciones();
    notify();
  },
  "descartar-cambios-cotizacion": function () {
    var snap = state.cotSnapshot;
    if (!snap) { state.cotSucia = ""; notify(); return; }
    if (!window.confirm("¿Descartar los cambios sin guardar de esta cotización?\n\nVuelve a como estaba en el último guardado.")) return;
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === snap.id ? snap : c; });
    state.cotSucia = "";
    state.cotSnapshot = null;
    notify();
  },
  "cerrar-cotizacion-editor": function () {
    if (!confirmarSalidaSiSucia()) return;
    state.cotizacionEditando = "";
    notify();
  },
  // Salto inverso a "↗ Ver cotización relacionada" de pedidos.js: desde el
  // N.º de OP en la cabecera de la cotización ya convertida, ir directo a
  // esa tarjeta en Pedidos → Historial.
  "ver-cotizacion-relacionada-pedido": function (el) {
    var id = el.getAttribute("data-id");
    state.tab = "pedidos";
    state.sidebarMobileOpen = false;
    state.filtroPedidosVista = "activos";
    state.pedidosVista = "historial";
    notify();
    setTimeout(function () {
      var card = document.querySelector('[data-pedido-id="' + id + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("destello");
    }, 60);
  },
  "set-cot-fecha": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { fecha: el.value }) : c; });
    marcarSucia(id);
  },
  // La fecha de entrega vive en la cotización y se traslada al pedido al
  // convertir (ver "convertir-cotizacion"). Si el pedido YA existe (cotización
  // convertida, o escalada desde un pedido rápido), se propaga de inmediato:
  // si no, cambiar la fecha acá después de convertir no se reflejaría en
  // ningún lado y "Próximas entregas" seguiría mostrando la vieja.
  // Igual que el resto de la edición, queda pendiente de guardar. La bajada
  // al pedido vinculado (si ya existe) ocurre al guardar, no en cada tecla —
  // ver propagarFechaEntrega() dentro de "guardar-cotizacion".
  "set-cot-fecha-entrega": function (el) {
    var id = el.getAttribute("data-id");
    var valor = el.value;
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { fechaEntrega: valor }) : c; });
    marcarSucia(id);
  },
  // Solo cambia el nombre mostrado (c.cliente) — si la cotización estaba
  // vinculada a un cliente registrado (clienteId), el vínculo se conserva tal
  // cual (sigue sirviendo para correo, roster, etc.); esto es para corregir
  // un nombre mal escrito o dejar constancia de un apodo/razón social distinta.
  "set-cot-cliente": function (el) {
    var id = el.getAttribute("data-id");
    var nombre = el.value.trim();
    if (!nombre) { notify(); return; }
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { cliente: nombre }) : c; });
    marcarSucia(id);
  },
  // Eliminar SÍ guarda de una: no tendría sentido dejar "pendiente de
  // guardar" algo que ya no existe en pantalla.
  // Eliminar una cotización es definitivo (no hay papelera de cotizaciones),
  // así que ahora pregunta antes — no lo hacía, y era un botón de un solo clic
  // al lado del de convertir.
  //
  // Y se lleva consigo los movimientos que ella generó (la comisión de su
  // vendedor, las compras que llevó a Finanzas, el estimado completo). Sin
  // esto quedaban sueltos apuntando a una cotización inexistente: no salían
  // en ningún lado, no se podían deshacer desde su origen porque el origen ya
  // no estaba, y seguían sumando o restando en la caja. Van a la papelera de
  // movimientos, no se borran de una: si alguno correspondía a un gasto real
  // que sí ocurrió, se restaura desde ahí.
  "remove-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var movimientos = movimientosGeneradosPorCotizacion(cot);
    var neto = movimientos.reduce(function (a, t) { return t.tipo === "ingreso" ? a + num(t.monto) : a - num(t.monto); }, 0);
    var aviso = movimientos.length
      ? ("\n\nSe van con ella " + movimientos.length + " movimiento(s) de Finanzas que generó (comisión, compras, estimado)" +
         (neto ? ", con un efecto neto de " + fmt(Math.abs(neto)) + " en la caja" : "") +
         ". Quedan en la papelera de movimientos por si alguno correspondía a un gasto que sí ocurrió.")
      : "";
    if (!window.confirm('¿Eliminar la cotización "' + (cot.descripcion || cot.cliente) + '"?\n\nNo hay papelera de cotizaciones: esto no se puede deshacer.' + aviso)) return;
    state.cotizaciones = state.cotizaciones.filter(function (c) { return c.id !== id; });
    if (movimientos.length) {
      var ids = movimientos.map(function (t) { return t.id; });
      state.tx = state.tx.filter(function (t) { return ids.indexOf(t.id) === -1; });
      movimientos.forEach(function (t) {
        state.txPapelera.unshift(Object.assign({}, t, { eliminadoEl: todayStr(), eliminadoConCotizacion: id }));
      });
      persist("tx"); persist("txPapelera");
    }
    if (state.cotSucia === id) { state.cotSucia = ""; state.cotSnapshot = null; }
    if (state.cotizacionEditando === id) state.cotizacionEditando = "";
    persist("cotizaciones"); notify();
  },
  "add-referencia": function (el) {
    var id = el.getAttribute("data-id");
    var nueva = nuevaReferencia();
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, { referencias: (c.referencias || []).concat([nueva]) });
    });
    // La nueva referencia queda activa de una vez (si no, con varias
    // referencias tocaría buscarla entre las pestañas para empezar a cargarla).
    state.refActiva = Object.assign({}, state.refActiva, { [id]: nueva.id });
    marcarSucia(id);
  },
  "remove-referencia": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    conRef(cotId, function (c) {
      return Object.assign({}, c, { referencias: (c.referencias || []).filter(function (r) { return r.id !== refId; }) });
    });
  },
  // Cambiar el origen reescribe la referencia entera, no solo un campo: una
  // referencia que pasa a comprarse ya no se arma con insumos ni consumo de
  // tela (se limpian para que no queden sumando fantasmas en el costo), y una
  // que vuelve al taller deja de tener costo de compra y proveedor. También
  // se reinicia el flujo de etapas, porque los dos casos usan defaults
  // distintos (ver estadosDefDeRef en core/calc.js).
  // Pone al día un pedido que se había quedado con números viejos. Guardar la
  // cotización ya lo hace solo; este botón es para los pedidos convertidos
  // antes de que eso existiera, que arrastran la desincronización.
  "sincronizar-pedido-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var d = calcDesfaseCotizacionPedido(cot);
    if (!d) { mostrarToast("El pedido ya está al día."); return; }
    if (!window.confirm("El pedido " + (d.pedido.numeroOp || "") + " pasa a decir lo mismo que esta cotización:\n\n" +
      "• Cantidad: " + d.cantidadPedido + " → " + d.cantidadCot + "\n" +
      "• Total: " + fmt(d.totalPedido) + " → " + fmt(d.totalCot) + "\n\n" +
      "No se tocan los abonos ya cobrados, el N.º de OP ni la etapa de producción.\n\n¿Actualizar?")) return;
    sincronizarPedidoDeCotizacion(cot);
    notify();
    mostrarToast("✓ Pedido " + (d.pedido.numeroOp || "") + " actualizado: " + d.cantidadCot + " unidad(es) por " + fmt(d.totalCot) + ".");
  },
  "toggle-reparto-referencias": function (el) {
    var cotId = el.getAttribute("data-cot");
    state.detalleModoRefs = state.detalleModoRefs === cotId ? "" : cotId;
    notify();
  },
  // Mueve una fila de "Tallas y observaciones" de una referencia a otra,
  // conservándola tal cual (nombre, talla, número, tipo, observaciones). Es lo
  // que evita tener que borrarla de una lista y volver a escribirla en la otra.
  "mover-detalle-a-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), origenId = el.getAttribute("data-ref"), itemId = el.getAttribute("data-item");
    var destinoId = el.value;
    if (!destinoId || destinoId === origenId) return;
    conRef(cotId, function (c) {
      var origen = (c.referencias || []).filter(function (r) { return r.id === origenId; })[0];
      var item = origen && (origen.detalle || []).filter(function (d) { return d.id === itemId; })[0];
      if (!item) return c;
      return Object.assign({}, c, {
        referencias: (c.referencias || []).map(function (r) {
          if (r.id === origenId) {
            // Sacarla NO baja la cantidad cotizada: cuántas prendas se venden
            // es una decisión aparte de cuántas filas de detalle hay cargadas.
            return Object.assign({}, r, { detalle: (r.detalle || []).filter(function (d) { return d.id !== itemId; }) });
          }
          if (r.id === destinoId) {
            // Al recibirla sí puede subir la cantidad, con el mismo criterio
            // que al agregar una fila a mano (ver conDetalleAgregado): el
            // listado nunca puede ser más largo que lo cotizado.
            return conDetalleAgregado(r, [item]);
          }
          return r;
        })
      });
    });
  },
  "set-ref-origen": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var origen = el.getAttribute("data-val") === "proveedor" ? "proveedor" : "taller";
    var ref = (state.cotizaciones.filter(function (c) { return c.id === cotId; })[0] || {}).referencias || [];
    var actual = ref.filter(function (r) { return r.id === refId; })[0];
    if (actual && (actual.origen || "taller") === origen) return;
    if (origen === "proveedor" && actual && (actual.insumos || []).length) {
      if (!window.confirm("Esta referencia pasa a comprarse hecha a un proveedor: sus " + actual.insumos.length + " insumo(s) y el consumo de tela dejan de aplicar y se quitan.\n\n¿Seguir?")) return;
    }
    mapRef(cotId, refId, function (r) {
      if (origen === "proveedor") {
        return Object.assign({}, r, { origen: "proveedor", insumos: [], consumoAprox: 0, estadosDef: [], estado: "" });
      }
      return Object.assign({}, r, { origen: "taller", costoCompra: 0, proveedorId: "", fechaEntregaProveedor: "", estadosDef: [], estado: "" });
    });
  },
  "set-ref-campo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), campo = el.getAttribute("data-campo");
    var textual = campo === "nombre" || campo === "origen" || campo === "fechaEntregaProveedor" || campo === "proveedorId";
    var numerico = !textual;
    mapRef(cotId, refId, function (r) {
      var valor = numerico ? num(el.value) : el.value;
      // No puede haber menos cantidad que filas ya cargadas en "Tallas y
      // observaciones" — si se intenta bajar de ahí, se avisa y se deja en
      // el mínimo posible (la cantidad de filas). Al revés (agregar filas)
      // ya sube la cantidad sola, ver conDetalleAgregado().
      if (campo === "cantidadPedida") {
        var minimo = (r.detalle || []).length;
        if (valor < minimo) {
          window.alert("No puede haber menos cantidad que filas en \"Tallas y observaciones\" (" + minimo + "). Borra filas de esa lista primero si quieres bajar la cantidad.");
          valor = minimo;
        }
      }
      var patch = {}; patch[campo] = valor;
      return Object.assign({}, r, patch);
    });
  },
  "set-ref-imagen": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.refImagenSubiendo[refId] = true;
      notify();
      try {
        var url = await subirImagenReferencia(file);
        delete state.refImagenSubiendo[refId];
        mapRef(cotId, refId, function (r) { return Object.assign({}, r, { imagenUrl: url }); });
      } catch (e) {
        delete state.refImagenSubiendo[refId];
        window.alert("No se pudo subir la imagen a Drive: " + (e && e.message ? e.message : e));
        notify();
      }
    });
    input.click();
  },
  "quitar-ref-imagen": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { imagenUrl: "" }); });
  },
  "add-insumo-personalizado": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).concat([nuevoInsumo(null)]) }); });
  },
  // ---------- explorador de insumos (modal) ----------
  "abrir-insumo-picker": function (el) {
    state.insumoPickerAbierto = el.getAttribute("data-cot");
    state.insumoPickerRef = el.getAttribute("data-ref");
    state.insumoPickerCategoria = "todos";
    state.insumoPickerBusqueda = "";
    state.insumoPickerSeleccion = [];
    notify();
  },
  "cerrar-insumo-picker": function () {
    state.insumoPickerAbierto = "";
    state.insumoPickerRef = "";
    state.insumoPickerSeleccion = [];
    state.insumoPickerBusqueda = "";
    notify();
  },
  // El overlay cierra al hacer clic FUERA del modal; este no-op va sobre el
  // modal en sí para que un clic adentro no burbujee hasta el overlay y lo
  // cierre a mitad de la selección.
  "picker-stop": function () {},
  "set-insumo-picker-categoria": function (el) {
    state.insumoPickerCategoria = el.getAttribute("data-val");
    notify();
  },
  "toggle-insumo-picker-item": function (el) {
    var id = el.getAttribute("data-id");
    var sel = state.insumoPickerSeleccion || [];
    state.insumoPickerSeleccion = sel.indexOf(id) === -1 ? sel.concat([id]) : sel.filter(function (x) { return x !== id; });
    notify();
  },
  "confirmar-insumo-picker": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var ids = state.insumoPickerSeleccion || [];
    if (!ids.length) return;
    // Se agregan en el orden del catálogo (no en el orden en que se fueron
    // marcando), que es el mismo que se ve en la lista de la izquierda.
    var nuevos = (state.catalogoInsumos || [])
      .filter(function (i) { return ids.indexOf(i.id) !== -1; })
      .map(function (i) { return nuevoInsumo(i); });
    state.insumoPickerAbierto = "";
    state.insumoPickerRef = "";
    state.insumoPickerSeleccion = [];
    state.insumoPickerBusqueda = "";
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).concat(nuevos) }); });
  },
  "remove-insumo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-insumo");
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  "set-ins-campo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins"), campo = el.getAttribute("data-campo");
    var valor = (campo === "costo" || campo === "cantidad") ? num(el.value) : el.value;
    // Elegir "Costo global del pedido" saca el insumo de esta referencia y lo
    // manda a la lista global de la cotización: deja de ser de una prenda y
    // pasa a verse al final de TODAS las referencias (ver renderFilasGlobales).
    if (campo === "tipo" && valor === "global") {
      moverInsumoAGlobal(cotId, refId, insId);
      return;
    }
    mapRef(cotId, refId, function (r) {
      var insumos = (r.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var patch = {}; patch[campo] = valor;
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, r, { insumos: insumos });
    });
  },
  "aplicar-plantilla": function (el) {
    if (!el.value) return;
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var pla = (state.plantillasPrendas || []).filter(function (p) { return p.id === el.value; })[0];
    if (!pla) return;
    mapRef(cotId, refId, function (r) {
      var nuevosInsumos = (pla.insumos || []).map(function (ins) {
        return { id: uid(), nombre: ins.nombre, unidad: ins.unidad, costo: num(ins.costo), tipo: ins.tipo, cantidad: num(ins.cantidad) || 1 };
      });
      var patch = { insumos: (r.insumos || []).concat(nuevosInsumos) };
      if (!r.nombre) patch.nombre = pla.nombre;
      if (pla.consumoSugerido && (!r.consumoAprox || Number(r.consumoAprox) === 1)) patch.consumoAprox = num(pla.consumoSugerido);
      if (pla.imagenUrl && !r.imagenUrl) patch.imagenUrl = pla.imagenUrl;
      // Cada tipo de prenda puede necesitar etapas de producción distintas
      // (ej. sublimación). Si la plantilla trae un flujo asignado, se aplica
      // a ESTA referencia — cada una lleva su propio flujo.
      if (pla.flujoEstadosId) {
        var flujo = (state.plantillasEstados || []).filter(function (f) { return f.id === pla.flujoEstadosId; })[0];
        if (flujo) patch.estadosDef = flujo.estados.map(function (e) { return { id: e.id, label: e.label }; });
      }
      return Object.assign({}, r, patch);
    });
  },
  // Igual que "aplicar-plantilla" (copia insumos/consumo/imagen/flujo), pero
  // además marca la referencia como ligada a un producto del catálogo
  // (r.productoId + r.precioVenta sugerido). Eso es lo que permite, al
  // convertir la cotización en pedido, descontar el stock real de ese
  // producto agrupando las filas de "Tallas y observaciones" por talla (ver
  // función auxiliar descontarStockPorTallas más abajo).
  "aplicar-producto": function (el) {
    if (!el.value) return;
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var prod = (state.productos || []).filter(function (p) { return p.id === el.value; })[0];
    if (!prod) return;
    mapRef(cotId, refId, function (r) {
      var patch = { productoId: prod.id, origen: prod.origen || "taller" };
      if (!r.nombre) patch.nombre = prod.nombre;
      if (prod.imagenUrl && !r.imagenUrl) patch.imagenUrl = prod.imagenUrl;
      if (prod.precioVenta && (!r.precioVenta || Number(r.precioVenta) === 0)) patch.precioVenta = num(prod.precioVenta);
      if (prod.origen === "proveedor") {
        // Comprado a proveedor: la referencia hereda el costo de compra y el
        // proveedor tal cual, sin insumos de por medio — el costo por unidad
        // sale directo de ahí (ver calcCostoUnitarioRef). Sin flujo de fases
        // propio: se usa el default de 2 etapas (pendiente/recibido).
        patch.insumos = [];
        patch.consumoAprox = 0;
        patch.costoCompra = num(prod.costoCompra);
        patch.proveedorId = prod.proveedorId || "";
        patch.estadosDef = [];
      } else {
        patch.insumos = (r.insumos || []).concat((prod.insumos || []).map(function (ins) {
          return { id: uid(), nombre: ins.nombre, unidad: ins.unidad, costo: num(ins.costo), tipo: ins.tipo, cantidad: num(ins.cantidad) || 1 };
        }));
        if (prod.consumoSugerido && (!r.consumoAprox || Number(r.consumoAprox) === 1)) patch.consumoAprox = num(prod.consumoSugerido);
      }
      if (prod.origen !== "proveedor" && prod.flujoEstadosId) {
        var flujoP = (state.plantillasEstados || []).filter(function (f) { return f.id === prod.flujoEstadosId; })[0];
        if (flujoP) patch.estadosDef = flujoP.estados.map(function (e) { return { id: e.id, label: e.label }; });
      }
      return Object.assign({}, r, patch);
    });
    mostrarToast('✓ Vinculado a "' + prod.nombre + '" — el stock de las tallas se descuenta solo al convertir en pedido.');
  },
  // Edita la compra real de UNA línea de la lista. Se guarda indexada por la
  // clave de la línea (no por su posición), así reordenar la lista o agregar
  // insumos nuevos no le cambia el dueño a un dato ya registrado.
  "set-cot-compra": function (el) {
    var cotId = el.getAttribute("data-cot"), clave = el.getAttribute("data-clave"), campo = el.getAttribute("data-campo");
    var valor = campo === "comprado" ? !!el.checked
      : (campo === "cantidadReal" || campo === "costoReal") ? num(el.value)
        : el.value;
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      var compras = (c.compras || []).slice();
      var idx = -1;
      compras.forEach(function (x, i) { if (x.clave === clave) idx = i; });
      var linea = calcListaCompras(c).filter(function (l) { return l.clave === clave; })[0];
      var base = idx >= 0 ? compras[idx] : {
        clave: clave, cantidadReal: "", costoReal: "", proveedorId: (linea && linea.proveedorId) || "",
        observaciones: "", comprado: false, txId: "", fecha: ""
      };
      var patch = {}; patch[campo] = valor;
      // Marcar "comprado" sin haber escrito el costo real toma el estimado
      // como el valor pagado: es el caso corriente (se compró por lo que se
      // había presupuestado) y evita tener que teclear el mismo número.
      if (campo === "comprado" && valor) {
        if (!num(base.costoReal) && linea) patch.costoReal = num(linea.costoTotal);
        if (!base.fecha) patch.fecha = todayStr();
      }
      var actualizada = Object.assign({}, base, patch);
      if (idx >= 0) compras[idx] = actualizada; else compras.push(actualizada);
      return Object.assign({}, c, { compras: compras });
    });
    marcarSucia(cotId);
  },
  "toggle-compra-detalle": function (el) {
    var k = el.getAttribute("data-cot") + "|" + el.getAttribute("data-clave");
    var abiertos = Object.assign({}, state.compraDetalleAbierto || {});
    if (abiertos[k]) delete abiertos[k]; else abiertos[k] = true;
    state.compraDetalleAbierto = abiertos;
    notify();
  },
  // Lleva a Finanzas TODO lo marcado como comprado, de una sola vez. Es
  // idempotente a propósito: cada compra recuerda el movimiento que generó
  // (txId), así volver a pulsar el botón actualiza el que ya existe en vez de
  // duplicarlo, y desmarcar una compra borra el suyo. Antes cada costo real
  // creaba su movimiento al vuelo y no había forma de corregirlo sin borrar a
  // mano en Finanzas.
  "sincronizar-compras-finanzas": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    // El otro camino (registrar el costo estimado completo como un solo
    // movimiento) ya metió ese costo en la caja. Llevar además las compras
    // reales contaría el mismo pedido dos veces — se avisa antes, no después.
    if (cot.estimadoTxId && state.tx.some(function (t) { return t.id === cot.estimadoTxId; })) {
      if (!window.confirm("Este pedido ya tiene su costo ESTIMADO completo registrado como un movimiento en Finanzas.\n\n" +
        "Si además llevas las compras reales, el costo de este pedido va a contarse DOS veces.\n\n" +
        "Lo recomendable es borrar el movimiento del estimado en Finanzas y quedarte solo con las compras reales.\n\n¿Continuar de todos modos?")) return;
    }
    var lineas = calcListaCompras(cot);
    var creados = 0, actualizados = 0, borrados = 0;

    var compras = (cot.compras || []).map(function (compra) {
      var linea = lineas.filter(function (l) { return l.clave === compra.clave; })[0];
      var nombre = linea ? linea.nombre : compra.clave;
      var monto = num(compra.costoReal);

      // Desmarcada (o sin monto): si había dejado un movimiento, se retira.
      if (!compra.comprado || monto <= 0) {
        if (compra.txId) {
          state.tx = state.tx.filter(function (t) { return t.id !== compra.txId; });
          borrados++;
          return Object.assign({}, compra, { txId: "" });
        }
        return compra;
      }

      var proveedor = compra.proveedorId ? clienteById(compra.proveedorId) : null;
      var datos = {
        tipo: "gasto",
        concepto: "Compra — " + nombre + " — " + cot.descripcion,
        monto: monto,
        contraparte: proveedor ? proveedor.nombre : "",
        fecha: compra.fecha || todayStr(),
        pedidoId: cot.pedidoId || "",
        cotizacionId: cot.id,
        // Una compra de la lista es, por definición, insumo/material del
        // pedido — de acá sale el desglose "Gasto en insumos" del reporte.
        esInsumo: "1",
        proveedorId: compra.proveedorId || "",
        insumoNombre: nombre,
        cantidad: compra.cantidadReal !== "" && compra.cantidadReal !== undefined ? num(compra.cantidadReal) : (linea && !linea.esServicio ? num(linea.cantidadFisica) : ""),
        unidad: linea ? (linea.unidad || "") : "",
        // Marca de origen: es lo que permite reconocer "este movimiento lo
        // generó esta línea de compra" al volver a sincronizar.
        origenCompraClave: compra.clave
      };

      var existente = compra.txId ? state.tx.filter(function (t) { return t.id === compra.txId; })[0] : null;
      if (existente) {
        Object.assign(existente, datos);
        actualizados++;
        return compra;
      }
      var txId = uid();
      state.tx.unshift(Object.assign({ id: txId }, datos));
      creados++;
      return Object.assign({}, compra, { txId: txId });
    });

    state.cotizaciones = state.cotizaciones.map(function (c) {
      return c.id === id ? Object.assign({}, c, { compras: compras }) : c;
    });
    guardarCotizaciones(); persist("tx"); notify();
    var partes = [];
    if (creados) partes.push(creados + " movimiento(s) creado(s)");
    if (actualizados) partes.push(actualizados + " actualizado(s)");
    if (borrados) partes.push(borrados + " retirado(s)");
    mostrarToast(partes.length ? "✓ Finanzas al día: " + partes.join(", ") + "." : "Nada que sincronizar — marca alguna compra primero.");
  },
  // ---------- Costos globales del pedido ----------
  // Lo que se paga una vez por pedido (domicilio, diseño, un envío a
  // sublimar), sin importar cuántas referencias tenga. No son insumos de
  // ninguna referencia: repartirlos entre ellas obligaría a inventar un
  // criterio, así que suman al final, sobre el total de la cotización.
  "add-costo-global": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, {
        costosGlobales: (c.costosGlobales || []).concat([{ id: uid(), nombre: "", costo: 0, proveedorId: "", esServicio: true }])
      });
    });
    marcarSucia(id);
  },
  "set-costo-global": function (el) {
    var cotId = el.getAttribute("data-cot"), gId = el.getAttribute("data-global"), campo = el.getAttribute("data-campo");
    var valor = campo === "costo" ? num(el.value) : el.value;
    // Devolverle un tipo normal lo saca de la lista global y lo baja a la
    // referencia que se esté viendo: vuelve a ser un insumo de esa prenda.
    if (campo === "tipo" && valor !== "global") {
      moverGlobalAInsumo(cotId, gId, valor);
      return;
    }
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, {
        costosGlobales: (c.costosGlobales || []).map(function (g) {
          if (g.id !== gId) return g;
          var patch = {}; patch[campo] = valor;
          return Object.assign({}, g, patch);
        })
      });
    });
    marcarSucia(cotId);
  },
  "remove-costo-global": function (el) {
    var cotId = el.getAttribute("data-cot"), gId = el.getAttribute("data-global");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, { costosGlobales: (c.costosGlobales || []).filter(function (g) { return g.id !== gId; }) });
    });
    marcarSucia(cotId);
  },
  "set-cot-iva": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id) return c;
      var iva = Object.assign({ activo: false, porcentaje: 19 }, c.iva || {});
      if (campo === "activo") iva.activo = !!el.checked;
      else iva.porcentaje = num(el.value);
      return Object.assign({}, c, { iva: iva });
    });
    marcarSucia(id);
  },
  "remove-cot-gasto": function (el) {
    var cotId = el.getAttribute("data-cot"), gastoId = el.getAttribute("data-gasto");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, { gastosReales: (c.gastosReales || []).filter(function (g) { return g.id !== gastoId; }) });
    });
    // Elimina también el movimiento de Finanzas creado junto con este costo real.
    state.tx = state.tx.filter(function (t) { return t.origenGastoId !== gastoId; });
    guardarCotizaciones(); persist("tx"); notify();
  },
  "convertir-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (cot) {
      var heredado = datosPedidoDesdeCot(cot);
      // El pedido guarda un estado/flujo "agregado" (el de su referencia menos
      // avanzada) solo para que el filtro por etapa, el KPI y el PDF sigan
      // funcionando sin cambios — el progreso real, referencia por
      // referencia, se edita y se lee siempre desde la cotización (ver
      // pedidos.js: "advance-ref"/"retreat-ref").
      var agregado = estadoAgregadoDeCot(cot);
      var nuevoP = Object.assign({
        id: uid(), clienteId: cot.clienteId || "", cliente: cot.cliente, tipoCliente: "propio",
        // La fecha de entrega se hereda de la cotización (antes nacía siempre
        // vacía y no había forma de definirla al cotizar, así que TODO pedido
        // convertido quedaba fuera de "Próximas entregas" del Resumen).
        abono: 0, fechaEntrega: cot.fechaEntrega || "", estado: agregado ? agregado.estado : "nuevo", cotizacionId: cot.id,
        numeroOp: generarNumeroOp(todosNumerosOp()),
        fechaCreacion: todayStr(),
        abonos: [],
        estadosDef: agregado ? agregado.estadosDef : null,
        // La comisión de vendedor definida en la cotización se traslada al pedido
        // resultante (misma estructura), para que no haya que volver a definirla.
        vendedor: cot.vendedor ? Object.assign({}, cot.vendedor) : null,
        codigoPublico: codigoPublico(), calendarEventId: "",
        stockConsumido: [] // se completa abajo con lo que en verdad se descontó, para poder revertirlo si el pedido se elimina
      }, heredado);
      state.pedidos.unshift(nuevoP);
      state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: nuevoP.id }) : c; });
      nuevoP.stockConsumido = descontarStockPorTallas(cot, "pedido:" + nuevoP.id);
      // Convertir consolida TODO lo que estuviera pendiente de guardar: el
      // pedido se arma con esos valores, así que no puede quedar una versión
      // guardada distinta de la que originó el pedido.
      persist("pedidos"); guardarCotizaciones();
      // Con fecha de entrega heredada, el pedido nuevo entra al Calendar igual
      // que uno creado a mano en Pedidos (antes esto solo pasaba desde el
      // formulario de Pedidos, así que un pedido convertido nunca generaba
      // recordatorio).
      sincronizarEventoPedido(nuevoP);
      state.cotizacionEditando = ""; // se va a Pedidos; que no quede "abierta" acá al volver
      state.tab = "pedidos";
      state.pedidosVista = "historial"; // aterriza viendo el pedido recién creado, no el formulario en blanco
    }
    notify();
  },
  "generar-pdf": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (cot) generarPDFCotizacion(cot);
  },
  "enviar-cotizacion-correo": async function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var cliente = cot.clienteId ? clienteById(cot.clienteId) : null;
    var correo = cliente && cliente.correo;
    if (!correo) { window.alert('Este cliente no tiene correo registrado. Agrégaselo en la pestaña Contactos para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFCotizacion(cot, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Cotización — " + (cot.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (cot.cliente || "") + ",",
          mensaje: "Adjuntamos la cotización de \"" + (cot.descripcion || "tu pedido") + "\". Cualquier duda, quedamos atentos."
        }),
        filename: pdf.nombreArchivo,
        bytes: pdf.bytes
      });
      window.alert("Correo enviado a " + correo + ".");
    } catch (e) {
      window.alert("No se pudo enviar el correo: " + (e && e.message ? e.message : e));
    }
  },
  "set-cot-vendedor": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id) return c;
      var v = Object.assign({ nombre: "", tipo: "porcentaje", valor: 0, estado: "pendiente" }, c.vendedor || {});
      if (campo === "valor") v.valor = num(el.value); else v[campo] = el.value;
      return Object.assign({}, c, { vendedor: v });
    });
    marcarSucia(id);
  },
  "set-cot-vendedor-fecha": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id || !c.vendedor) return c;
      return Object.assign({}, c, { vendedor: Object.assign({}, c.vendedor, { fechaPago: el.value }) });
    });
    marcarSucia(id);
  },
  // Igual que toggle-comision en pedidos.js: desmarcar "pagada" revierte de
  // verdad el movimiento (no solo la etiqueta), para que volver a marcarla
  // pagada después no duplique el pago en Finanzas.
  "toggle-comision-cot": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot || !cot.vendedor || !cot.vendedor.nombre) return;
    var pagando = cot.vendedor.estado !== "pagado";
    if (pagando) {
      var valor = calcComisionValorCot(cot);
      state.tx.unshift({ id: uid(), tipo: "comision", concepto: "Comisión — " + cot.vendedor.nombre, monto: valor, contraparte: cot.vendedor.nombre, fecha: todayStr(), pedidoId: cot.pedidoId || "", cotizacionId: cot.id, origenComisionCotId: id });
    } else {
      state.tx = state.tx.filter(function (t) { return t.origenComisionCotId !== id; });
    }
    persist("tx");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, { vendedor: Object.assign({}, c.vendedor, { estado: pagando ? "pagado" : "pendiente" }) });
    });
    guardarCotizaciones(); notify();
  },
  // Registra el costo total ESTIMADO de todo el pedido como un único
  // movimiento en Finanzas (a diferencia de "Registrar costo real", que
  // registra costos reales puntuales). Sirve para llevar el registro de
  // movimientos agrupado y categorizado por pedido desde el principio.
  // Idempotente y con aviso de doble conteo. Antes cada clic creaba un gasto
  // NUEVO por el mismo costo estimado: tres clics eran tres veces el costo del
  // pedido restándose de la caja. Y como la tabla de compras lleva a Finanzas
  // los costos REALES, tener los dos a la vez cuenta el mismo pedido dos
  // veces. Ahora se guarda el id del movimiento que generó (estimadoTxId) para
  // actualizar ese mismo, y se avisa del solapamiento antes de crearlo.
  "add-cot-estimado-movimiento": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var totales = calcCotizacionTotales(cot);
    var existente = cot.estimadoTxId ? state.tx.filter(function (t) { return t.id === cot.estimadoTxId; })[0] : null;
    var yaHayCompras = (cot.compras || []).some(function (c) { return c.txId; });

    if (existente) {
      if (!window.confirm("Este pedido ya tiene su costo estimado registrado en Finanzas por " + fmt(existente.monto) + ".\n\n¿Actualizarlo a " + fmt(totales.costoTotal) + "?\n\nSe modifica ese mismo movimiento, no se crea uno nuevo.")) return;
      state.tx = state.tx.map(function (t) {
        return t.id === existente.id ? Object.assign({}, t, { monto: totales.costoTotal, concepto: "Estimado completo del pedido — " + cot.descripcion }) : t;
      });
      persist("tx"); notify();
      mostrarToast("✓ Estimado actualizado a " + fmt(totales.costoTotal) + ".");
      return;
    }

    if (!window.confirm("Se registra en Finanzas un gasto de " + fmt(totales.costoTotal) + " (el costo ESTIMADO de todo el pedido)." +
      (yaHayCompras ? "\n\n⚠ Ojo: este pedido ya tiene compras reales llevadas a Finanzas. Si registras también el estimado, el costo de este pedido va a contarse DOS veces en la caja y en el reporte." : "") +
      "\n\n¿Continuar?")) return;
    var txId = uid();
    state.tx.unshift({
      id: txId, tipo: "gasto", concepto: "Estimado completo del pedido — " + cot.descripcion,
      monto: totales.costoTotal, contraparte: cot.cliente, fecha: todayStr(),
      pedidoId: cot.pedidoId || "", cotizacionId: cot.id
    });
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estimadoTxId: txId }) : c; });
    guardarCotizaciones(); persist("tx"); notify();
  },
  "generar-pdf-interno": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var card = el.closest(".cot-card");
    if (!card) return;
    var opts = {
      general: !!card.querySelector('[data-role="pdfint-general"]').checked,
      referencias: !!card.querySelector('[data-role="pdfint-referencias"]').checked,
      compras: !!card.querySelector('[data-role="pdfint-compras"]').checked,
      reales: !!card.querySelector('[data-role="pdfint-reales"]').checked,
      vendedor: !!card.querySelector('[data-role="pdfint-vendedor"]').checked
    };
    generarPDFInternoCotizacion(cot, opts);
  },
  "add-ref-detalle": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var card = el.closest(".cot-card");
    var nombreD = val(card, "det-nombre-" + refId);
    if (!nombreD) return;
    var fila = { id: uid(), nombre: nombreD, talla: val(card, "det-talla-" + refId), numero: val(card, "det-numero-" + refId), tipo: val(card, "det-tipo-" + refId), observaciones: val(card, "det-obs-" + refId) };
    mapRef(cotId, refId, function (r) { return conDetalleAgregado(r, [fila]); });
  },
  // Trae de una vez el roster guardado en el cliente (nombre+número+talla,
  // ver modules/clientes.js) como filas de detalle — para clientes que
  // repiten pedido cada temporada (típico en uniformes de equipo) sin tener
  // que tipear la misma lista de nuevo.
  "cargar-roster-cliente": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
    var cliente = cot && cot.clienteId ? clienteById(cot.clienteId) : null;
    var roster = cliente ? (cliente.roster || []) : [];
    if (!roster.length) return;
    var filas = roster.map(function (j) { return { id: uid(), nombre: j.nombre, talla: j.talla, numero: j.numero, tipo: "", observaciones: "" }; });
    mapRef(cotId, refId, function (r) { return conDetalleAgregado(r, filas); });
  },
  "remove-ref-detalle": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), itemId = el.getAttribute("data-item");
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { detalle: (r.detalle || []).filter(function (d) { return d.id !== itemId; }) }); });
  },
  // Editar en el sitio (antes en pedidos solo se podía borrar y volver a
  // crear la fila si había un error de digitación).
  "set-ref-detalle-campo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), itemId = el.getAttribute("data-item"), campo = el.getAttribute("data-campo");
    mapRef(cotId, refId, function (r) {
      var detalle = (r.detalle || []).map(function (d) {
        if (d.id !== itemId) return d;
        var patch = {}; patch[campo] = el.value;
        return Object.assign({}, d, patch);
      });
      return Object.assign({}, r, { detalle: detalle });
    });
  },
  // Acepta .xlsx/.xls (vía SheetJS, cargado como window.XLSX en index.html)
  // y sigue aceptando .csv (por si alguien todavía exporta así) — se elige
  // el parser según la extensión del archivo.
  "import-ref-detalle-csv": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var file = el.files && el.files[0];
    if (!file) return;
    var esCsv = /\.csv$/i.test(file.name);
    function aplicar(filas) {
      if (!filas.length) {
        window.alert("No se encontraron filas válidas en el archivo. Revisa que tenga columnas: nombre, talla, numero, tipo, observaciones (y que 'nombre' no esté vacío).");
        return;
      }
      mapRef(cotId, refId, function (r) { return conDetalleAgregado(r, filas); });
    }
    var reader = new FileReader();
    if (esCsv) {
      reader.onload = function () { aplicar(parseDetalleCSV(String(reader.result))); };
      reader.readAsText(file, "UTF-8");
    } else {
      reader.onload = function () {
        var libro = window.XLSX.read(reader.result, { type: "array" });
        var hoja = libro.Sheets[libro.SheetNames[0]];
        var matriz = window.XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" });
        aplicar(parseDetalleFilas(matriz));
      };
      reader.readAsArrayBuffer(file);
    }
  },
  // ExcelJS (no SheetJS: la edición comunitaria de SheetJS no escribe
  // estilos, se perderían al generar el archivo) — encabezado con el mismo
  // fondo oscuro + texto blanco que usan las tablas de los PDF de la app
  // (ver headStyles fillColor [30,30,30] en core/pdf.js), para que la
  // plantilla se sienta parte del mismo sistema visual.
  "descargar-plantilla-csv": async function () {
    var libro = new window.ExcelJS.Workbook();
    var hoja = libro.addWorksheet("Tallas");
    hoja.columns = [
      { header: "nombre", key: "nombre", width: 22 },
      { header: "talla", key: "talla", width: 10 },
      { header: "numero", key: "numero", width: 10 },
      { header: "tipo", key: "tipo", width: 16 },
      { header: "observaciones", key: "observaciones", width: 26 }
    ];
    hoja.getRow(1).eachCell(function (cell) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E1E1E" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
    hoja.addRow({ nombre: "Juan Pérez", talla: "M", numero: "10", tipo: "Jugador", observaciones: "" });
    hoja.addRow({ nombre: "María López", talla: "S", numero: "7", tipo: "Arquero", observaciones: "Pedido especial" });
    var buffer = await libro.xlsx.writeBuffer();
    var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "plantilla-tallas-referencia.xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  },
  // Cuando la cotización nace de "escalar" un pedido rápido (ver pedidos.js:
  // escalar-a-cotizacion), no se crea un pedido nuevo al convertir — se
  // actualiza el pedido original con estos valores (que reemplazan a los
  // rápidos/simples), sin tocar los abonos que ya se hubieran cobrado.
  "aplicar-cotizacion-a-pedido": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot || !cot.pedidoOrigenId) return;
    if (!state.pedidos.some(function (p) { return p.id === cot.pedidoOrigenId; })) {
      window.alert("El pedido original ya no existe (puede haber sido eliminado)."); return;
    }
    var totales = calcCotizacionTotales(cot);
    var cantidadTotal = (cot.referencias || []).reduce(function (a, r) { return a + num(r.cantidadPedida); }, 0) || 1;
    var descripcionRefs = (cot.referencias || []).map(function (r) { return r.nombre + " x" + r.cantidadPedida; }).join(", ") || cot.descripcion;
    if (!window.confirm("¿Aplicar estos valores al pedido original?\n\nEl total, la descripción, la cantidad, el vendedor y las etapas del pedido se reemplazan por los de esta cotización. Los abonos que ya se hayan cobrado NO se pierden.")) return;
    var agregado = estadoAgregadoDeCot(cot);
    // Se descuenta ANTES de tocar el pedido (no depende de él) — lo REAL
    // aplicado se suma (no reemplaza) al stockConsumido que el pedido ya
    // tuviera, para no perder el rastro de un descuento anterior si esto se
    // aplica más de una vez sobre el mismo pedido escalado.
    var stockAplicado = descontarStockPorTallas(cot, "pedido:" + cot.pedidoOrigenId);
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== cot.pedidoOrigenId) return p;
      return Object.assign({}, p, {
        descripcion: cot.descripcion + (descripcionRefs ? " (" + descripcionRefs + ")" : ""),
        cantidad: String(cantidadTotal), total: totales.precioTotal,
        // Mismo motivo que al convertir: el costo y las líneas cotizadas
        // reemplazan a las del pedido rápido, que es justo lo que se pidió al
        // escalarlo — y con eso el reporte de productos lo ve bien costeado.
        costo: totales.costoTotal,
        lineas: lineasDeCotizacion(cot),
        fechaCreacion: p.fechaCreacion || todayStr(),
        iva: cot.iva || p.iva,
        estado: agregado ? agregado.estado : p.estado,
        estadosDef: agregado ? agregado.estadosDef : null,
        vendedor: cot.vendedor ? Object.assign({}, cot.vendedor) : p.vendedor,
        // Solo pisa la fecha del pedido si la cotización define una — si se
        // dejó vacía al cotizar, se conserva la que el pedido rápido ya tenía
        // en vez de borrársela.
        fechaEntrega: cot.fechaEntrega || p.fechaEntrega || "",
        stockConsumido: (p.stockConsumido || []).concat(stockAplicado)
      });
    });
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: cot.pedidoOrigenId }) : c; });
    // Terminado — vuelve al índice; ahí se ve, ya resumida, como "Convertida a pedido".
    state.cotizacionEditando = "";
    state.cotizacionesVista = "historial";
    persist("pedidos"); guardarCotizaciones(); notify();
  },
  "set-estado-ref-label": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), idx = Number(el.getAttribute("data-idx"));
    mapRef(cotId, refId, function (r) {
      var estados = ((r.estadosDef && r.estadosDef.length) ? r.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      if (!estados[idx]) return r;
      estados[idx].label = el.value;
      return Object.assign({}, r, { estadosDef: estados });
    });
  },
  "add-estado-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var card = el.closest(".cot-card");
    var nombre = val(card, "nueva-etapa-" + refId);
    if (!nombre) return;
    mapRef(cotId, refId, function (r) {
      var estados = ((r.estadosDef && r.estadosDef.length) ? r.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      estados.push({ id: uid(), label: nombre });
      return Object.assign({}, r, { estadosDef: estados });
    });
  },
  "remove-estado-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), idx = Number(el.getAttribute("data-idx"));
    mapRef(cotId, refId, function (r) {
      var estados = ((r.estadosDef && r.estadosDef.length) ? r.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      if (estados.length <= 1) { window.alert("Debe quedar al menos una etapa en el flujo."); return r; }
      estados.splice(idx, 1);
      return Object.assign({}, r, { estadosDef: estados });
    });
  },
  "mover-estado-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), idx = Number(el.getAttribute("data-idx")), dir = Number(el.getAttribute("data-dir"));
    mapRef(cotId, refId, function (r) {
      var estados = ((r.estadosDef && r.estadosDef.length) ? r.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      var nidx = idx + dir;
      if (nidx < 0 || nidx >= estados.length) return r;
      var tmp = estados[idx]; estados[idx] = estados[nidx]; estados[nidx] = tmp;
      return Object.assign({}, r, { estadosDef: estados });
    });
  },
  "resetear-estados-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    if (!window.confirm('¿Restablecer al flujo de etapas estándar? Se pierden los cambios personalizados de esta referencia (no afecta las plantillas guardadas).')) return;
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { estadosDef: null }); });
  },
  "cargar-plantilla-estados": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var card = el.closest(".cot-card");
    var sel = card ? card.querySelector('[data-role="plantilla-estados-sel-' + refId + '"]') : null;
    var plantilla = (state.plantillasEstados || []).filter(function (pl) { return pl.id === (sel ? sel.value : ""); })[0];
    if (!plantilla) return;
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { estadosDef: plantilla.estados.map(function (e) { return { id: e.id, label: e.label }; }) }); });
  }
};

// Cada referencia ligada a un producto del catálogo (ref.productoId, ver
// acción "aplicar-producto") agrupa sus filas de "Tallas y observaciones" por
// talla — es la única forma confiable de saber CUÁNTAS unidades de CADA
// talla salieron. Sin filas de detalle no hay talla que agrupar, así que esa
// referencia no cuenta (queda como límite conocido, ajustable a mano en
// Productos). Función pura: no toca stock, solo arma la lista de líneas.
// Convierte las referencias de una cotización en LÍNEAS DE PEDIDO (el mismo
// formato que usa un pedido rápido, ver modules/pedidos.js). Es lo que hace
// que un pedido nacido de una cotización cuente en el reporte de productos
// vendidos con su costo y su ganancia reales: antes solo se le copiaba el
// total, así que una referencia hecha a la medida (sin producto de catálogo
// detrás) desaparecía del reporte, y una de catálogo salía costeada con el
// precio de HOY en vez del que tuvo cuando se vendió.
//
// Si la referencia tiene filas de "Tallas y observaciones", se agrupan por
// talla para que el reporte pueda decir cuántas de cada una se vendieron; lo
// que quede sin talla se junta en una línea aparte.
function lineasDeCotizacion(cot) {
  var lineas = [];
  (cot.referencias || []).forEach(function (ref) {
    var t = calcRefTotales(ref);
    function nuevaLinea(talla, cantidad) {
      return {
        id: uid(), tipo: ref.productoId ? "catalogo" : "libre",
        productoId: ref.productoId || "", productoNombre: ref.nombre || cot.descripcion || "—",
        imagenUrl: ref.imagenUrl || "", talla: talla, cantidad: cantidad,
        precioUnitario: t.precioUnit, costoUnitario: t.costoUnit,
        costoIndirectoUnitario: 0, // se reparte abajo, una vez se sabe el total de unidades
        observacion: "", campos: []
      };
    }
    var porTalla = {};
    (ref.detalle || []).forEach(function (d) {
      var talla = (d.talla || "").trim();
      if (!talla) return;
      porTalla[talla] = (porTalla[talla] || 0) + 1;
    });
    var tallas = Object.keys(porTalla);
    var conTalla = tallas.reduce(function (a, k) { return a + porTalla[k]; }, 0);
    tallas.forEach(function (talla) { lineas.push(nuevaLinea(talla, porTalla[talla])); });
    var resto = num(ref.cantidadPedida) - conTalla;
    if (resto > 0 || !tallas.length) lineas.push(nuevaLinea("", Math.max(0, resto)));
  });
  lineas = lineas.filter(function (l) { return num(l.cantidad) > 0; });
  repartirCostosGlobales(cot, lineas);
  return lineas;
}

// Reparte los costos globales del pedido (domicilio, diseño: lo que se paga
// una vez, ver renderCostosGlobales) entre todas las unidades vendidas, para
// que el costo del pedido y la suma de sus líneas den EXACTAMENTE lo mismo.
// Sin esto, la cotización contaba el domicilio y el reporte de productos
// vendidos no, así que el mismo pedido mostraba dos ganancias distintas.
//
// Se reparte por unidad (no por valor): es como lo diría cualquiera en el
// taller — "el domicilio son $30.000 entre las 15 prendas". El residuo de la
// división se le carga a la última línea, así la suma cierra al peso exacto y
// no queda un centavo perdido por redondeo.
function repartirCostosGlobales(cot, lineas) {
  var globales = calcCostosGlobales(cot);
  if (!globales || !lineas.length) return;
  var unidades = lineas.reduce(function (a, l) { return a + num(l.cantidad); }, 0);
  if (unidades <= 0) return;

  var porUnidad = globales / unidades;
  var acumulado = 0;
  lineas.forEach(function (l, i) {
    if (i === lineas.length - 1) {
      // Última línea: se lleva lo que falte para llegar al total exacto.
      l.costoIndirectoUnitario = num(l.cantidad) > 0 ? (globales - acumulado) / num(l.cantidad) : 0;
      return;
    }
    var deLaLinea = porUnidad * num(l.cantidad);
    l.costoIndirectoUnitario = porUnidad;
    acumulado += deLaLinea;
  });
}

// ---------- El pedido como espejo de su cotización ----------
// Todo lo que un pedido HEREDA de su cotización sale de acá y de ningún otro
// lado: lo usa "convertir-cotizacion" al crearlo y la resincronización cada
// vez que la cotización se guarda. Tenerlo en una sola función es lo que
// impide que las dos formas de escribir esos números se separen con el
// tiempo.
function datosPedidoDesdeCot(cot) {
  var totales = calcCotizacionTotales(cot);
  var cantidadTotal = (cot.referencias || []).reduce(function (a, r) { return a + num(r.cantidadPedida); }, 0) || 1;
  var descripcionRefs = (cot.referencias || []).map(function (r) { return r.nombre + " x" + r.cantidadPedida; }).join(", ") || cot.descripcion;
  return {
    descripcion: cot.descripcion + (descripcionRefs ? " (" + descripcionRefs + ")" : ""),
    cantidad: String(cantidadTotal),
    total: totales.precioTotal,
    costo: totales.costoTotal,
    // Detalle línea por línea, con el precio y el costo (ya con su parte de
    // los costos globales) de cada una — es lo que leen los reportes.
    lineas: lineasDeCotizacion(cot),
    iva: cot.iva || { activo: false, porcentaje: 19 }
  };
}

// ¿El pedido quedó diciendo algo distinto de lo que hoy dice su cotización?
// Pasa apenas se edita una cantidad, un precio o se agrega una referencia
// después de haber convertido: el pedido era una foto del momento de
// convertir y nadie la volvía a tomar. Devuelve null si están sincronizados.
//
// Solo mira `pedidoId` (la cotización YA es ese pedido), nunca
// `pedidoOrigenId`. La diferencia importa: una cotización "escalada" desde un
// pedido rápido arranca apuntando al pedido original con `pedidoOrigenId`,
// pero todavía es un BORRADOR — sus números no mandan hasta que se pulse
// "Aplicar a pedido". Cuando se los tomaba también de ahí, guardar el borrador
// (o simplemente abrirlo) reescribía en silencio el total, el costo y las
// líneas de un pedido real, y el botón de aplicar —con su confirmación— dejaba
// de significar nada.
export function calcDesfaseCotizacionPedido(cot) {
  var pedidoId = (cot && cot.pedidoId) || "";
  if (!pedidoId) return null;
  var ped = state.pedidos.filter(function (p) { return p.id === pedidoId; })[0];
  if (!ped) return null;
  var datos = datosPedidoDesdeCot(cot);
  var difTotal = num(datos.total) - num(ped.total);
  var difCosto = num(datos.costo) - num(ped.costo);
  var difCantidad = num(datos.cantidad) - num(ped.cantidad);
  if (!difTotal && !difCosto && !difCantidad) return null;
  return {
    pedido: ped, datos: datos,
    difTotal: difTotal, difCosto: difCosto, difCantidad: difCantidad,
    totalPedido: num(ped.total), totalCot: num(datos.total),
    cantidadPedido: num(ped.cantidad), cantidadCot: num(datos.cantidad)
  };
}

// Vuelca sobre el pedido los números actuales de su cotización. Toca SOLO lo
// que la cotización manda (qué se vende, cuánto y a qué precio) — nunca los
// abonos ya cobrados, el N.º de OP, la etapa de producción ni el stock ya
// descontado, que son hechos del pedido y no de la cotización.
function sincronizarPedidoDeCotizacion(cot) {
  var desfase = calcDesfaseCotizacionPedido(cot);
  if (!desfase) return null;
  state.pedidos = state.pedidos.map(function (p) {
    return p.id === desfase.pedido.id ? Object.assign({}, p, desfase.datos) : p;
  });
  persist("pedidos");
  return desfase;
}

function lineasStockDeCot(cot) {
  var lineas = [];
  (cot.referencias || []).forEach(function (ref) {
    if (!ref.productoId) return;
    var porTalla = {};
    (ref.detalle || []).forEach(function (d) {
      var talla = (d.talla || "").trim();
      if (!talla) return;
      porTalla[talla] = (porTalla[talla] || 0) + 1;
    });
    Object.keys(porTalla).forEach(function (talla) {
      lineas.push({ productoId: ref.productoId, talla: talla, cantidad: porTalla[talla] });
    });
  });
  return lineas;
}

// Al convertir una cotización en pedido (o aplicarla a uno existente) se
// descuenta el stock real. Si no alcanza para todo lo cotizado, NO se
// bloquea la conversión (la venta ya pasó en la vida real; bloquear acá
// trabaría al usuario) pero tampoco se aplica en silencio: se avisa
// exactamente qué faltó, y se devuelve lo REALMENTE descontado (no lo
// cotizado) para que el pedido resultante pueda revertirse sin descuadrarse
// si más adelante se elimina.
function descontarStockPorTallas(cot, origen) {
  var lineas = lineasStockDeCot(cot);
  if (!lineas.length) return [];
  var deficits = validarStockLineas(lineas);
  if (deficits.length) {
    window.alert("Ojo: no había stock suficiente para todo lo cotizado — se descontó lo que había disponible:\n\n" +
      deficits.map(function (d) { return "- " + d.productoNombre + " (" + d.talla + "): se necesitaban " + d.solicitado + ", solo había " + d.disponible; }).join("\n") +
      "\n\nRevisa y repón el stock en Catálogo si hace falta.");
  }
  var aplicado = [];
  lineas.forEach(function (l) {
    var producto = productoById(l.productoId);
    var real = ajustarStockProducto(l.productoId, l.talla, -l.cantidad, "Convertido desde cotización — " + cot.descripcion, origen);
    if (real) aplicado.push({ productoId: l.productoId, productoNombre: producto ? producto.nombre : "", talla: l.talla, cantidad: Math.abs(real) });
  });
  return aplicado;
}

// ---------- guardado explícito ----------
// Editar una cotización (precios, insumos, cantidades, tallas...) ya NO
// escribe a la hoja de datos en cada tecla: el cambio queda en pantalla y la
// cotización se marca como "sin guardar" hasta que se confirme con el botón.
// El motivo es que una cotización es un documento que se le enseña al
// cliente: tocarla para simular un precio no debería reemplazar en silencio
// el que ya se había acordado.
//
// Excepción a propósito: las acciones que mueven PLATA o crean registros
// reales (registrar un costo real, pagar la comisión del vendedor, convertir
// en pedido, crear/eliminar la cotización) siguen guardando de inmediato —
// esas no son "simular", son hechos consumados, y además tocan Finanzas, que
// no puede quedar a medias esperando un botón.
function marcarSucia(cotId) {
  state.cotSucia = cotId;
  notify();
}
// Foto de la cotización abierta TAL COMO ESTÁ GUARDADA, para poder volver a
// ella con "Descartar". Se toma al abrir el editor y después de cada guardado
// — nunca desde marcarSucia(), porque para cuando una acción marca el cambio
// ya lo aplicó sobre state, y la foto saldría con esa primera edición adentro
// (descartar dejaría el primer cambio pegado).
function tomarSnapshotCotizacion() {
  var id = state.cotizacionEditando;
  var cot = id ? state.cotizaciones.filter(function (c) { return c.id === id; })[0] : null;
  state.cotSnapshot = cot ? JSON.parse(JSON.stringify(cot)) : null;
}
// Guarda de verdad y vuelve a dejar la cotización "limpia". Cualquier acción
// transaccional la llama, así que después de registrar un costo real o pagar
// una comisión no queda un aviso de "sin guardar" colgado por cambios que ya
// se guardaron.
function guardarCotizaciones() {
  persist("cotizaciones");
  state.cotSucia = "";
  tomarSnapshotCotizacion(); // el nuevo punto de retorno es lo recién guardado
  // Si esta cotización ya es un pedido, sus números bajan al pedido en el
  // mismo acto de guardar. Antes el pedido era una foto del momento de
  // convertir: cambiar una cantidad o agregar una referencia después dejaba al
  // pedido —y a todos los reportes, que leen de él— contando lo viejo, sin
  // ningún aviso. Guardar es el momento deliberado para propagarlo (editar no
  // escribe nada hasta que se confirma, ver marcarSucia).
  var id = state.cotizacionEditando;
  var cot = id ? state.cotizaciones.filter(function (c) { return c.id === id; })[0] : null;
  if (!cot) return;
  var aplicado = sincronizarPedidoDeCotizacion(cot);
  if (aplicado) {
    mostrarToast("✓ El pedido " + (aplicado.pedido.numeroOp || "") + " se actualizó con estos cambios: " +
      aplicado.cantidadCot + " unidad(es) por " + fmt(aplicado.totalCot) + ".");
  }
}
// Baja la fecha de entrega de una cotización a su pedido vinculado (si ya
// existe). Vive fuera de la acción de guardado porque también corre al
// convertir/aplicar, donde el pedido nace o se actualiza en el mismo paso.
function propagarFechaEntrega(cot) {
  // Mismo criterio que calcDesfaseCotizacionPedido: solo baja al pedido si
  // esta cotización YA es ese pedido. Un borrador escalado (pedidoOrigenId)
  // todavía no manda sobre él.
  var pedidoId = cot.pedidoId;
  if (!pedidoId || !cot.fechaEntrega) return;
  var yaIgual = state.pedidos.some(function (p) { return p.id === pedidoId && p.fechaEntrega === cot.fechaEntrega; });
  if (yaIgual) return;
  state.pedidos = state.pedidos.map(function (p) { return p.id === pedidoId ? Object.assign({}, p, { fechaEntrega: cot.fechaEntrega }) : p; });
  persist("pedidos");
  var actualizado = state.pedidos.filter(function (p) { return p.id === pedidoId; })[0];
  if (actualizado) sincronizarEventoPedido(actualizado);
}
// Guardia común de "vas a salir con cambios sin guardar". Devuelve false si
// el usuario cancela, para que quien la llame no siga con la navegación.
function confirmarSalidaSiSucia() {
  if (!state.cotSucia) return true;
  if (window.confirm("Esta cotización tiene cambios sin guardar.\n\n¿Salir de todos modos? Los cambios se pierden.")) {
    // Al salir sin guardar se revierte a lo último guardado — si no, los
    // cambios quedarían vivos en memoria y el próximo guardado de CUALQUIER
    // otra cosa los arrastraría a la hoja sin que nadie los confirmara.
    if (state.cotSnapshot) {
      var snap = state.cotSnapshot;
      state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === snap.id ? snap : c; });
    }
    state.cotSucia = "";
    state.cotSnapshot = null;
    return true;
  }
  return false;
}

// Aplica una función de transformación a una cotización completa y la marca
// como pendiente de guardar (no persiste — ver marcarSucia arriba).
// Mueve un insumo de una referencia a la lista global de la cotización. Se
// conserva el mismo objeto (nombre, unidad, costo) para no perder lo que ya
// estaba escrito; solo cambia de dueño. `cantidad` se descarta: un costo
// global se paga una vez, no por prenda.
function moverInsumoAGlobal(cotId, refId, insId) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  if (!cot) return;
  var ref = (cot.referencias || []).filter(function (r) { return r.id === refId; })[0];
  var insumo = ref && (ref.insumos || []).filter(function (i) { return i.id === insId; })[0];
  if (!insumo) return;
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    return Object.assign({}, c, {
      referencias: (c.referencias || []).map(function (r) {
        if (r.id !== refId) return r;
        return Object.assign({}, r, { insumos: (r.insumos || []).filter(function (i) { return i.id !== insId; }) });
      }),
      costosGlobales: (c.costosGlobales || []).concat([{
        id: insumo.id, nombre: insumo.nombre, unidad: insumo.unidad || "",
        costo: num(insumo.costo), proveedorId: insumo.proveedorId || ""
      }])
    });
  });
  mostrarToast('"' + (insumo.nombre || "El costo") + '" pasó a ser global: ahora aparece al final de todas las referencias y se reparte entre todas las prendas del pedido.');
  marcarSucia(cotId);
}

// El camino de vuelta: un costo global recupera un tipo normal y baja a la
// referencia que se esté viendo en ese momento.
function moverGlobalAInsumo(cotId, gId, tipo) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  if (!cot) return;
  var global = (cot.costosGlobales || []).filter(function (g) { return g.id === gId; })[0];
  if (!global) return;
  var refs = cot.referencias || [];
  if (!refs.length) { window.alert("No hay ninguna referencia a la que devolverlo. Crea una primero."); return; }
  var activaId = state.refActiva[cotId];
  var destino = refs.filter(function (r) { return r.id === activaId; })[0] || refs[0];
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    return Object.assign({}, c, {
      costosGlobales: (c.costosGlobales || []).filter(function (g) { return g.id !== gId; }),
      referencias: (c.referencias || []).map(function (r) {
        if (r.id !== destino.id) return r;
        return Object.assign({}, r, {
          insumos: (r.insumos || []).concat([{
            id: global.id, nombre: global.nombre, unidad: global.unidad || "UND",
            costo: num(global.costo), tipo: tipo, cantidad: 1, proveedorId: global.proveedorId || ""
          }])
        });
      })
    });
  });
  mostrarToast('"' + (global.nombre || "El costo") + '" volvió a ser un insumo de "' + (destino.nombre || "la referencia") + '".');
  marcarSucia(cotId);
}

function conRef(cotId, transform) {
  state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === cotId ? transform(c) : c; });
  marcarSucia(cotId);
}
// Agrega filas al detalle (tallas/observaciones) de una referencia y, si el
// listado resultante queda más grande que la cantidad cotizada, la sube
// para que coincidan — el listado nunca puede representar más unidades de
// las que la cotización dice vender (afecta el precio total calculado). No
// funciona al revés: borrar filas de detalle no baja la cantidad sola.
function conDetalleAgregado(r, nuevasFilas) {
  var detalle = (r.detalle || []).concat(nuevasFilas);
  var cantidadPedida = Math.max(num(r.cantidadPedida) || 0, detalle.length);
  return Object.assign({}, r, { detalle: detalle, cantidadPedida: cantidadPedida });
}
// Aplica una función de transformación a una referencia puntual dentro de su cotización.
function mapRef(cotId, refId, transform) {
  conRef(cotId, function (c) {
    var refs = (c.referencias || []).map(function (r) { return r.id === refId ? transform(r) : r; });
    return Object.assign({}, c, { referencias: refs });
  });
}
