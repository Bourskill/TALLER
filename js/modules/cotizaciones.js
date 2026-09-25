import { state, persist, notify, mostrarToast } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, fmt, norm, generarNumeroOp, parseDetalleCSV, parseDetalleFilas, codigoPublico, exigirCampos } from "../core/utils.js";
import { movimientosGeneradosPorCotizacion, calcCotizacionTotales, calcRefTotales, calcRefTotalesConGlobales, calcCostoGlobalPorPrenda, calcCostoPrenda, calcCotResultadoReal, calcListaCompras, calcCotGastoVariacion, calcCotGastoEstimadoBase, calcComisionValorCot, clienteById, estadoAgregadoDeCot, productoById, validarStockLineas, proveedoresDeContactos, calcCostosGlobales, calcResumenCompras, compraDeLinea, calcUnidadesCotizacion, calcCostoPrendaGlobal, calcServiciosCobrados, etapasDe, insumoCambioDeCatalogo, estadoCompra, esInsumoServicio, estadoLineaCompra, marcasConocidas, serviciosQueQuedanNegativosSiSeBorra, costoRealPedido, cantidadRealPedido, costoExcedenteCompra, cantidadExcedenteCompra, calcReservaCompraConjunta, cantidadEfectivaInsumo, categoriasUsadasPorInsumos , pedidoIdDeCotParaTx, esMiembroRecibo, reconciliarTxRecibo, verificarRecibo, calcCaja, reservasDeCompra, ajustarCantidadMiembro, calcRecibo, devolverPartesPorEliminar, retomarPartesPorRestaurar, migrarComprasARecibos, lineaSinCantidad, estimadoTxDeCot, comprasEnFinanzas, estadoComisionCot, cotSobrePedidoCancelado, cotizacionAceptada, cotConPedidoEliminado } from "../core/calc.js";
import { renderTipoCostoOptions, renderEnlacePanel, renderCeldaCantidadInsumo, renderHelp, renderToggleSeccion, renderComboUnidad, renderClienteSeleccionCampo, renderClientePicker, renderExploradorInsumos } from "../core/components.js";
import { generarPDFCotizacion, generarPDFInternoCotizacion } from "../core/pdf.js";
import { subirImagenReferencia } from "../core/drive.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { todosNumerosOp, sincronizarEventoPedido } from "./pedidos.js";
import { TIPOS_COSTO, TIPOS_ENLAZABLES } from "../core/constants.js";
import { ajustarStockProducto } from "../core/stock.js";

function nuevaReferencia() {
  return { id: uid(), nombre: "", imagenUrl: "", cantidadPedida: 10, precioVenta: 0, insumos: [], detalle: [] };
}
// Clona una cotización completa con ids nuevos (referencias e insumos
// incluidos) — la usa "Duplicar pedido" en Pedidos cuando el pedido a
// duplicar viene de una cotización convertida: duplicar solo las líneas del
// pedido perdería el detalle real (insumos, tallas, márgenes), que vive acá,
// no en el pedido. La copia nace en "borrador", sin vínculo a ningún pedido
// (ni origen ni destino — sería el de OTRO pedido, no de este) y con el
// cliente en blanco, lista para que el usuario la revise y la convierta en
// un pedido nuevo por el camino de siempre ("Convertir en pedido").
export function duplicarCotizacionCompleta(cot) {
  var copia = JSON.parse(JSON.stringify(cot));
  copia.id = uid();
  copia.clienteId = ""; copia.cliente = "";
  copia.estado = "borrador";
  copia.pedidoId = ""; copia.pedidoOrigenId = "";
  copia.codigoPublico = codigoPublico();
  copia.fecha = todayStr();
  (copia.referencias || []).forEach(function (r) {
    r.id = uid();
    (r.insumos || []).forEach(function (i) { i.id = uid(); });
  });
  // Mismo motivo que referencias/insumos arriba: un costo global o un
  // servicio cobrado con el MISMO id que el original hace que su clave en
  // calcListaCompras ("global|" + id / "servicio|" + id, ver core/calc.js)
  // sea IDÉNTICA en las dos cotizaciones — dos registros distintos que
  // deberían ser independientes comparten identidad por accidente. `compras`
  // ya nace vacío (arriba) así que no hay nada que reconectar mal HOY, pero
  // deja la puerta abierta a que una reparación futura (o el propio usuario
  // corrigiendo un nombre) confunda una compra de ESTA cotización con la de
  // su gemela. Auditoría financiera 2026-09-20, post-mortem.
  (copia.costosGlobales || []).forEach(function (g) { g.id = uid(); });
  (copia.serviciosCobrados || []).forEach(function (s) { s.id = uid(); });
  // `compras` (estado/costoReal/cantidadReal/txId por línea) y
  // `estimadoTxId` son el historial REAL de compras/movimientos de ESTE
  // pedido — no del duplicado, que todavía no ha comprado ni pagado nada.
  // Sin este reset, el duplicado nacía "ya pagado" con los números reales
  // del original, y el `txId` copiado seguía apuntando al movimiento del
  // original: la próxima vez que se sincronizara Finanzas desde el
  // duplicado, encontraba ese tx "ya existente" y lo REESCRIBÍA en vez de
  // crear uno nuevo — el pedido original perdía su propio movimiento en
  // Finanzas sin que nadie lo borrara a propósito. Reportado por el
  // usuario: "tiene que poderse registrar el movimiento... son de
  // diferente cliente". Ver también el chequeo de cotizacionId en
  // sincronizar-compras-finanzas/add-cot-estimado-movimiento, que protege
  // igual a cotizaciones YA duplicadas antes de este fix.
  copia.compras = [];
  copia.estimadoTxId = "";
  // Mismo motivo que compras/estimadoTxId, un nivel más abajo: si el
  // vendedor de la cotización original ya tenía su comisión "pagada", esa
  // bandera venía copiada tal cual (con JSON.parse/stringify) pero sin
  // ningún movimiento real detrás en Finanzas para ESTA copia — el tx real
  // sigue ligado al id de la cotización original. La copia terminaba
  // mostrando "ya se le pagó" a un vendedor sin que nadie le hubiera pagado
  // nada por esta venta nueva, e invisible para "Comisiones pendientes".
  // Auditoría financiera 2026-09-20, hallazgo confirmado 3 veces.
  if (copia.vendedor) copia.vendedor = Object.assign({}, copia.vendedor, { estado: "pendiente", fechaPago: "" });
  return copia;
}

function nuevoInsumo(fuente, ref) {
  var esTela = !!(fuente && fuente.tipo === "tela");
  return {
    id: uid(),
    nombre: fuente ? fuente.nombre : "",
    unidad: fuente ? fuente.unidad : "UND",
    costo: fuente ? num(fuente.costo) : 0,
    tipo: fuente ? fuente.tipo : "por_prenda",
    // Si en el catálogo está marcado como servicio —por su Unidad, por vivir
    // en una categoría marcada "de servicio" (ver esInsumoServicio en
    // core/calc.js), o por la casilla vieja— la referencia hereda ese
    // resultado ya resuelto: es lo que hace que la lista de compras diga
    // "servicio" en vez de pedir N unidades de algo que no se mide. Se
    // resuelve UNA vez, al copiar (igual que el costo), para no cambiarle
    // los números a una cotización ya armada sin que nadie lo pida.
    esServicio: !!(fuente && esInsumoServicio(fuente)),
    proveedorId: (fuente && fuente.proveedorId) || "",
    // La categoría del catálogo SÍ se copia (2026-09-21, antes no se
    // guardaba acá) — no para el costeo (eso sigue resuelto por tipo), sino
    // para que un ENLACE por categoría (ver más abajo) pueda reconocer,
    // dentro de esta misma referencia, cuáles insumos son "de la categoría
    // Telas" sin tener que ir a consultar el catálogo en vivo.
    categoriaId: (fuente && fuente.categoriaId) || "",
    // Para una tela, el consumo (metros) es PROPIO de este insumo, no de la
    // referencia (ver calcCostoPrenda en core/calc.js) — arranca en 1 (sin
    // valor de arranque a nivel de referencia desde 2026-09-21, el usuario
    // lo pidió quitar: "dejarlo en el insumo así como ya se está
    // haciendo"), editable por separado en cada fila. `consumoPropio`
    // marca que este insumo YA nació con su propio valor, para que la
    // reparación retroactiva (repararConsumoTelaPorInsumo en
    // core/store.js) nunca lo toque.
    cantidad: 1,
    consumoPropio: esTela,
    // Vínculo con el insumo del catálogo del que salió esta copia — no con su
    // costo, con el INSUMO. Es lo que permite, más adelante, avisar si el
    // catálogo cambió de precio y esta cotización se quedó con el viejo (ver
    // insumoCambioDeCatalogo en core/calc.js). Un insumo escrito a mano
    // directo en la cotización (sin pasar por el catálogo) no trae vínculo:
    // no hay con qué compararlo, y no debe avisar de nada.
    origenCatalogoId: fuente ? fuente.id : "",
    // El enlace (ver renderEnlacePanel en core/components.js) se hereda
    // igual que esServicio/origenCatalogoId si el catálogo ya lo tenía
    // predefinido (ej. "Sublimación" enlazada a la categoría "Telas") —
    // editable después en esta misma fila si hace falta ajustarlo.
    enlace: { categorias: ((fuente && fuente.enlace && fuente.enlace.categorias) || []).slice(), insumos: ((fuente && fuente.enlace && fuente.enlace.insumos) || []).slice(), mismoTipo: !!(fuente && fuente.enlace && fuente.enlace.mismoTipo) }
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
  // "Descartar" vuelve a una foto de la cotización tal como está guardada.
  // Algunos caminos la abren sin tomarla (Ver cotización desde Pedidos o
  // Finanzas): sin foto, Descartar solo borraba la marca y el cambio seguía
  // en memoria — y desde que Guardar lleva las compras a Finanzas (Hallazgo
  // #58), el siguiente Guardar convertía esa edición descartada en plata
  // real. Se toma acá, mientras no tenga cambios sin guardar.
  if (state.cotizacionEditando && state.cotSucia !== state.cotizacionEditando && (!state.cotSnapshot || state.cotSnapshot.id !== state.cotizacionEditando)) tomarSnapshotCotizacion();
  var vista = state.cotizacionesVista || "nueva";
  var html = renderTabsCotizaciones(vista);
  html += vista === "historial" ? renderHistorial() : renderEditor();
  html += renderInsumoPickerCotizacion();
  html += renderClientePicker({
    abierto: state.clientePickerAbierto, busqueda: state.clientePickerBusqueda, clientes: state.clientes,
    inputId: "inp-cliente-picker-buscar", filtroBusqueda: "clientePickerBusqueda",
    accionCerrar: "cerrar-cliente-picker",
    // Si se abrió desde la cabecera de una cotización YA EXISTENTE (ver
    // renderCotHead), elegir un contacto edita esa cotización directo; si
    // no, viene del formulario de "nueva" y edita el borrador de siempre.
    accionSeleccionar: state.clientePickerCotizacionId ? "seleccionar-cliente-picker-cotizacion-editar" : "seleccionar-cliente-picker-cotizacion",
    permitirNuevo: false
  });
  return html;
}

// Explorador de insumos (modal, ver renderExploradorInsumos en
// core/components.js — compartido con Productos y Plantillas). Acá solo se
// arma lo que le es propio a Cotizaciones: sobre qué referencia aplicar
// (data-cot/data-ref) y "ya está en la cotización", el aviso de duplicado.
function renderInsumoPickerCotizacion() {
  if (state.insumoPickerAbierto !== "cotizacion") return "";
  var cotId = state.insumoPickerCotId, refId = state.insumoPickerRefId;

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
      if (!yaEnCotizacion[k]) yaEnCotizacion[k] = { total: 0, ubicaciones: [] };
      yaEnCotizacion[k].total++;
      var nombreRef = r.nombre || "Sin nombre";
      if (yaEnCotizacion[k].ubicaciones.indexOf(nombreRef) === -1) yaEnCotizacion[k].ubicaciones.push(nombreRef);
    });
  });

  return renderExploradorInsumos({
    abierto: true,
    idBuscador: "inp-insumo-picker-buscar",
    categorias: state.catalogoCategorias,
    lista: state.catalogoInsumos,
    categoriaActiva: state.insumoPickerCategoria,
    busqueda: state.insumoPickerBusqueda,
    seleccion: state.insumoPickerSeleccion,
    yaPresentes: yaEnCotizacion,
    textoCatalogoVacio: 'Tu catálogo de insumos está vacío. Agrégalos en la pestaña <b>Insumos</b> para poder reutilizarlos acá.',
    accionConfirmar: "confirmar-insumo-picker",
    confirmarAttrs: ' data-cot="' + cotId + '" data-ref="' + refId + '"'
  });
}

function renderTabsCotizaciones(vista) {
  var total = state.cotizaciones.length;
  var labelNueva = state.cotizacionEditando ? "✎ Editando cotización" : "+ Nueva cotización";
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nueva" ? "active" : "") + '" data-action="cot-vista" data-val="nueva">' + labelNueva + "</button>" +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="cot-vista" data-val="historial">Historial' + (total ? " (" + total + ")" : "") + "</button>" +
    "</div>";
}

// Compartido entre el formulario de "nueva" y la cabecera de una cotización
// ya creada (renderCotHead) — mismo <datalist> para las dos, así las
// sugerencias aprendidas en una aparecen también en la otra.
function renderDatalistMarcas() {
  return '<datalist id="dl-marcas">' +
    marcasConocidas().map(function (m) { return '<option value="' + esc(m) + '">'; }).join("") +
    "</datalist>";
}

function renderFormNueva() {
  var f = state.formCotizacion;
  return renderDatalistMarcas() + '<div class="card"><div class="section-title small">Nueva cotización' +
    renderHelp("Arma cada referencia con sus insumos (o aplica una plantilla), define el precio de venta y el margen se calcula solo. Los gastos reales de producción se registran aparte para comparar contra lo cotizado.") +
    '</div><div class="form-grid">' +
    renderClienteSeleccionCampo({ clienteId: f.clienteId, accionAbrir: "abrir-cliente-picker-cotizacion", permitirNuevo: false }) +
    '<div class="field wide"><label>Descripción</label><input data-form="cotizacion" data-field="descripcion" value="' + esc(f.descripcion) + '" placeholder="Ej. Uniformes equipo San Jorge" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" data-form="cotizacion" data-field="fecha" value="' + esc(f.fecha) + '" /></div>' +
    '<div class="field"><label>Fecha de entrega (opcional)' +
    renderHelp("Se traslada al pedido cuando conviertas esta cotización — es lo que hace que aparezca en \"Próximas entregas\" del Resumen. Si aún no la sabes, puedes definirla después.") +
    '</label><input type="date" data-form="cotizacion" data-field="fechaEntrega" value="' + esc(f.fechaEntrega || "") + '" /></div>' +
    '<div class="field"><label>Marca (opcional)' +
    renderHelp("De qué línea de tu negocio es este pedido (ej. Uniformes, Urbana, Licras) — para saber de un vistazo a qué marca pertenece cada cotización, sin abrirla. Se sugieren las que ya hayas escrito antes.") +
    '</label><input list="dl-marcas" data-form="cotizacion" data-field="marca" value="' + esc(f.marca || "") + '" placeholder="Ej. Urbana" /></div>' +
    '<button class="btn" ' + (f.clienteId ? "" : "disabled") + ' data-action="add-cotizacion">Crear cotización</button>' +
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

// Aviso de "cambios sin guardar" de una cotización.
//
// POR QUÉ CAMBIÓ: antes era una barra sticky a lo ancho, con fondo amarillo y
// borde de alerta, clavada arriba del documento mientras se editaba. Cumplía
// su función (no perder cambios) pero cobraba un precio desproporcionado:
// robaba la parte superior de la pantalla justo donde están los datos del
// cliente, empujaba el contenido al aparecer, y gritaba "problema" cuando en
// realidad editar sin guardar es el estado NORMAL de trabajo — la barra
// estaba encendida casi todo el tiempo.
//
// Ahora es un dock flotante abajo a la derecha: sigue siendo imposible de
// perder de vista (es fijo, no se va con el scroll) y conserva las dos
// salidas — guardar y descartar —, pero no ocupa espacio del documento ni
// usa el color de alerta, que queda reservado para lo que sí es un problema
// (ver `.aviso-barra malo` arriba). Además se puede guardar con Ctrl+S sin
// tener que ir a buscar el botón (ver core/teclado.js).
//
// Si se vuelve a hacer sticky y a lo ancho, se reintroduce exactamente el
// problema que el usuario reportó como "muy invasiva".
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
  // Usa `.aviso-barra`, la MISMA barra con la que el resto de la app avisa de
  // algo que hay que resolver (guardado fallido, recuperación al arrancar —
  // ver core/dom.js). Antes reutilizaba `.save-bar` pisándole los colores con
  // estilos inline: dos avisos con el mismo peso visual que sin embargo
  // significan cosas muy distintas.
  return '<div class="aviso-barra malo">' +
    '<div><b>⚠ El pedido ' + esc(d.pedido.numeroOp || "") + " quedó desactualizado</b>" +
    renderHelp("Este pedido se creó con una versión anterior de la cotización y no se enteró de los cambios que hiciste después. Como los reportes leen del pedido, hasta que no lo actualices seguirán mostrando los números viejos. Actualizar NO toca los abonos ya cobrados, el N.º de OP ni la etapa de producción — solo qué se vende, cuánto y a qué precio.") +
    '<div class="aviso-barra-sub">' + esc(partes.join(" · ")) + "</div></div>" +
    '<button class="btn" data-action="sincronizar-pedido-cotizacion" data-id="' + cot.id + '">Actualizar el pedido</button>' +
    "</div>";
}

function renderBarraGuardado(cot) {
  if (state.cotSucia !== cot.id) return "";
  return '<div class="save-bar guardado-dock">' +
    '<span class="guardado-dock-msg"><span class="guardado-dock-punto"></span>Sin guardar' +
    renderHelp("Lo que editaste se ve en pantalla pero todavía no reemplazó a la cotización guardada. Guardá para confirmarlo (o Ctrl+S), o descartá para volver a la última versión guardada. Registrar un costo real, pagar una comisión o convertir en pedido guardan solos (son movimientos reales, no una simulación).", "right") +
    "</span>" +
    '<button class="btn ghost small" data-action="descartar-cambios-cotizacion">Descartar</button>' +
    // `data-guardar-principal` es lo que hace que Ctrl+S guarde: core/teclado.js
    // busca ese atributo en pantalla en vez de conocer esta pestaña en particular.
    '<button class="btn small" data-guardar-principal data-action="guardar-cotizacion" data-id="' + cot.id + '" title="Guardar cambios (Ctrl+S)">Guardar</button>' +
    "</div>";
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
    (c.marca ? ' <span class="badge" style="background:var(--surface-3);">' + esc(c.marca) + "</span>" : "") +
    '<div class="cot-meta">' + esc(c.descripcion) + " · " + esc(c.fecha) + " · " + fmt(totales.precioTotal) + " venta</div>" +
    "</div></div></div>";
}

// Editor del flujo de etapas de producción de ESTA referencia — cada
// referencia puede necesitar etapas distintas (ej. una lleva sublimación y
// otra no), así que ya no es un flujo único por cotización. Si la plantilla
// de prenda aplicada trae un flujo asignado, nace precargado con ese (ver
// acción "aplicar-plantilla"); si no, parte del flujo estándar de la app.
function renderEstadosRef(cotId, ref) {
  // Antes esta línea era una copia inline de la resolución de etapas que
  // NO contemplaba el caso "comprado a proveedor": el editor ofrecía las 5
  // etapas del taller mientras la tarjeta del pedido mostraba las 2 del
  // proveedor. Ahora las dos entran por la misma puerta (ver etapasDe en
  // core/calc.js).
  var estados = etapasDe(ref);
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
  html += renderCotStatsRow(totales, real.comision);
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
  var html = renderDatalistMarcas() + '<div class="cot-head">' +
    '<div class="cot-head-info">' +
    '<div class="cot-head-top">' +
    renderClienteSeleccionCampo({
      clienteId: c.clienteId, nombreLibre: (!c.clienteId && c.cliente) ? c.cliente : "",
      accionAbrir: "abrir-cliente-picker-cotizacion-editar", dataId: c.id, permitirNuevo: false, prominente: true
    }) +
    '<span class="badge ' + c.estado + '">' + (c.estado === "convertida" ? "Convertida a pedido" : "Borrador") + "</span>" +
    (pedidoVinculado ? '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;" title="Pedido vinculado — clic para verlo" data-action="ver-cotizacion-relacionada-pedido" data-id="' + pedidoVinculado.id + '">' + esc(pedidoVinculado.numeroOp || "OP-????") + "</span>" : "") +
    "</div>" +
    (c.descripcion ? '<div class="cot-descripcion">' + esc(c.descripcion) + "</div>" : "") +
    '<div class="cot-meta">' +
    '<span class="cot-meta-item"><span class="cot-meta-label">Fecha</span><input type="date" class="mini-input" style="width:135px;" value="' + esc(c.fecha) + '" data-action-change="set-cot-fecha" data-id="' + c.id + '" /></span>' +
    '<span class="cot-meta-item"><span class="cot-meta-label">Entrega' +
    renderHelp("Fecha comprometida de entrega. Al convertir esta cotización en pedido se traslada al pedido, que es lo que alimenta \"Próximas entregas\" en el Resumen y el recordatorio en Google Calendar.") +
    '</span><input type="date" class="mini-input" style="width:135px;" value="' + esc(c.fechaEntrega || "") + '" data-action-change="set-cot-fecha-entrega" data-id="' + c.id + '" /></span>' +
    '<span class="cot-meta-item"><span class="cot-meta-label">Marca</span><input list="dl-marcas" class="mini-input" style="width:120px;" value="' + esc(c.marca || "") + '" placeholder="Opcional" data-action-change="set-cot-marca" data-id="' + c.id + '" /></span>' +
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
//
// "Ganancia estimada" ya descuenta la comisión del vendedor (si hay uno) —
// antes NO lo hacía acá, pero SÍ en "Real" (pestaña Producción), así que la
// misma cotización parecía perder plata sola al pasar de una a otra sin
// ningún aviso de por qué. Con la nota entre paréntesis queda visible de
// entrada, no solo si se entra a mirar el detalle de Producción.
function renderCotStatsRow(totales, comision) {
  var gananciaNeta = totales.gananciaTotal - (comision || 0);
  var margenNeto = totales.precioTotal > 0 ? (gananciaNeta / totales.precioTotal * 100) : 0;
  return '<div class="cot-hero-stats">' +
    '<div class="cot-hero-stat"><div class="rl">Precio total cotizado</div><div class="rv">' + fmt(totales.precioTotal) + "</div></div>" +
    '<div class="cot-hero-stat"><div class="rl">Ganancia estimada</div><div class="rv" style="color:' + (gananciaNeta >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(gananciaNeta) +
    (comision > 0 ? '<div class="section-sub" style="margin:2px 0 0;font-size:11px;font-weight:400;text-transform:none;letter-spacing:normal;">(ya se descontó ' + fmt(comision) + " de comisión del vendedor)</div>" : "") +
    "</div></div>" +
    '<div class="cot-hero-stat"><div class="rl">Margen</div><div class="rv">' + margenNeto.toFixed(1) + "%</div></div>" +
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
  // Una vez la cotización tiene un pedido REAL detrás (convertida, o
  // escalada y ya aplicada), la comisión pasa a gestionarse SOLO desde ahí
  // (toggle-comision en pedidos.js) — mostrar acá un segundo botón activo
  // permitía pagarla (o deshacerla) dos veces sobre la misma venta, cada
  // lado con su propio tx sin cruzarse. Auditoría financiera 2026-09-20.
  var tieneDetrasUnPedido = !!c.pedidoId;
  // Escalada desde un pedido que se canceló: la comisión pendiente quedó
  // anulada (Hallazgo #56) — se dice así y no se ofrece pagarla.
  var anulada = estadoComisionCot(c) === "anulada";
  // El cliente todavía no acepta: la comisión aún no se debe (Hallazgo #57).
  var porAceptar = estadoComisionCot(c) === "por-aceptar";

  if (!expandido) {
    var resumen = v.nombre ? (esc(v.nombre) + " · " + fmt(valor) + (pagado ? " · pagada" : anulada ? " · anulada (pedido cancelado)" : porAceptar && cotConPedidoEliminado(c) ? " · su pedido se eliminó" : porAceptar ? " · se debe cuando el cliente acepte" : " · pendiente")) : "Sin vendedor asignado";
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
      (tieneDetrasUnPedido
        ? '<span class="badge" title="Esta cotización ya tiene un pedido real — la comisión se paga/deshace desde ahí.">' + (pagado ? "pagada" : "pendiente") + " · ver Pedidos</span>"
        : anulada
        ? '<span class="badge" title="El pedido de esta cotización se canceló: su comisión pendiente dejó de deberse.">anulada · pedido cancelado</span>'
        : porAceptar && cotConPedidoEliminado(c)
        ? '<span class="badge" title="El pedido de esta cotización se eliminó: restáuralo desde la papelera (Pedidos) para que la comisión vuelva a deberse.">pedido eliminado · restáuralo</span>'
        : porAceptar
        ? '<span class="badge" title="La comisión se debe desde que el cliente acepta: cuando esta cotización se convierta en pedido pasa a Por pagar.">se debe cuando el cliente acepte</span>'
        : ('<button class="status-pill ' + (pagado ? "pagado" : "pendiente") + '" data-action="toggle-comision-cot" data-id="' + c.id + '">' + (pagado ? "pagada" : "pendiente") + "</button>" +
          (!pagado ? ('<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-soft);">Fecha de pago<input type="date" class="mini-input" value="' + esc(v.fechaPago || "") + '" data-action-change="set-cot-vendedor-fecha" data-id="' + c.id + '" /></label>') : "")))) : "") +
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
  // "Real" ya descuenta la comisión del vendedor (ver calcCotResultadoReal),
  // pero "Estimado" no lo hacía: la misma cotización parecía perder plata de
  // más —más allá del sobrecosto— sin ningún aviso del porqué. La comisión no
  // cambia entre estimado y real (se calcula sobre el precio cotizado, no
  // sobre costos reales), así que se usa el mismo valor en los dos lados.
  var comisionVal = real.comision;
  var gananciaEstimadaNeta = totales.gananciaTotal - comisionVal;
  var margenEstimadoNeto = totales.precioTotal > 0 ? (gananciaEstimadaNeta / totales.precioTotal * 100) : 0;
  var notaComision = comisionVal > 0 ? '<div class="section-sub" style="margin:2px 0 0;font-size:11px;font-weight:400;text-transform:none;letter-spacing:normal;">(ya se descontó ' + fmt(comisionVal) + " de comisión del vendedor)</div>" : "";

  var html = '<div class="cot-col-title">Estimado vs. real' + renderHelp("Estimado es lo que se planeó al cotizar. Real ajusta esos números con los costos reales que hayas registrado abajo, para comparar lo planeado contra lo que en verdad pasó. Las dos ganancias ya tienen descontada la comisión del vendedor, si hay uno.") + "</div>";
  html += '<div class="cot-compara-grid">' +
    '<div class="cot-compara-col">' +
    '<div class="cot-compara-titulo">Estimado</div>' +
    '<div class="cot-resumen-total">' +
    '<div><div class="rl">Costo total</div><div class="rv">' + fmt(totales.costoTotal) + "</div></div>" +
    '<div><div class="rl">Precio total</div><div class="rv">' + fmt(totales.precioTotal) + "</div></div>" +
    '<div><div class="rl">Ganancia</div><div class="rv" style="color:' + (gananciaEstimadaNeta >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(gananciaEstimadaNeta) + notaComision + "</div></div>" +
    '<div><div class="rl">Margen</div><div class="rv">' + margenEstimadoNeto.toFixed(1) + "%</div></div>" +
    "</div></div>" +
    '<div class="cot-compara-col">' +
    '<div class="cot-compara-titulo">Real</div>' +
    '<div class="cot-resumen-total">' +
    '<div><div class="rl">Costo total</div><div class="rv">' + fmt(real.costoTotal) + "</div></div>" +
    '<div><div class="rl">Precio total</div><div class="rv">' + fmt(real.precioTotal) + "</div></div>" +
    '<div><div class="rl">Ganancia</div><div class="rv" style="color:' + (real.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(real.gananciaTotal) + notaComision + "</div></div>" +
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
  // Ya no hay "referencia de proveedor" como concepto — una prenda comprada
  // hecha es un insumo tipo "producto_comprado" más (ver TIPOS_COSTO en
  // core/constants.js), reconocido en la lista de compras por `esProducto`
  // (ver agregarInsumosDeReferencias en core/calc.js).
  var hayProveedor = compras.some(function (l) { return l.esProducto; });

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
// Las dos columnas flexibles llevan un mínimo (ver el porqué grande junto a
// ".tx-row" en css/tables.css): "qué comprar" es un nombre de insumo, "para
// / a quién" puede llevar varios badges — ninguna de las dos puede quedar en
// 0px sin que su texto se parta letra por letra.
var COMPRA_COLS = "minmax(130px,1.3fr) minmax(110px,1fr) 90px 105px 90px 105px 120px";

function renderTablaCompras(c, compras, hayProveedor) {
  var resumen = calcResumenCompras(c);
  var html = '<div class="cot-col-title">Compras del pedido' +
    renderHelp("Cada línea es algo que hay que comprar (o producir), con lo que se estimó al cotizar y lo que en verdad costó. Marca su estado: \"Sí\" si se pagó de verdad y aparte (el botón de abajo la lleva a Finanzas como gasto); \"Servicio\" si se hizo en el taller —corte, confección— y no hubo un pago instantáneo (se paga vía nómina, aparte): cuenta como costo real para que la ganancia no se infle, pero no genera ningún movimiento en Finanzas; \"Ahorro\" si decidiste NO comprarlo/hacerlo y no hizo falta — cuenta como el ahorro completo frente al estimado, sin pedirte escribir cantidad ni costo (por definición es $0) y sin generar movimiento en Finanzas. La diferencia contra lo estimado se calcula sola y alimenta el resultado real de arriba." +
      (hayProveedor ? " Una prenda comprada ya hecha a un proveedor aparece como una sola línea, en unidades." : "")) +
    "</div>";

  if (!compras.length) {
    return html + '<div class="empty" style="padding:8px 0;">Agrega insumos a las referencias (o costos globales del pedido) para ver acá lo que hay que comprar.</div>';
  }

  html += '<div class="tx-row head" style="grid-template-columns:' + COMPRA_COLS + ';">' +
    "<span>Qué comprar</span><span>Para / a quién</span><span>Cant. est.</span><span>Costo est.</span><span>Cant. real</span><span>Costo real</span><span>Estado</span></div>";

  compras.forEach(function (linea) {
    html += renderFilaCompra(c, linea);
  });

  // "Resuelto" cuenta lo pagado, lo de servicio Y lo ahorrado: las tres son
  // un costo real ya sabido (aunque el de ahorro sea $0), solo que cada una
  // llegó ahí por un camino distinto. Comparar el estimado contra ese total
  // combinado es lo que deja ver el sobrecosto/ahorro real del pedido aunque
  // nunca se marque "Sí" en corte/confección hechos en el taller, ni se
  // escriba nada en una línea que de verdad no hizo falta.
  // `resueltas` viene de calcResumenCompras: una línea pagada a la que
  // todavía le falta material (recibo con faltante) NO está resuelta — si
  // no, "Se ahorró" contaba lo que falta comprar como ahorro (Hallazgo #54).
  var resuelto = resumen.resueltas;
  var realCombinado = resumen.real + resumen.realServicio;
  var diferencia = realCombinado - resumen.estimado;
  html += '<div class="section-sub" style="margin:10px 0 0;">' +
    resumen.compradas + " pagado(s)" + (resumen.conFaltante ? " (" + resumen.conFaltante + " con faltante)" : "") + " · " + resumen.servicio + " en servicio · " + resumen.ahorro + " ahorrado(s) · " + resumen.pendientes + " pendiente(s)" +
    " · estimado <b>" + fmt(resumen.estimado) + "</b>" +
    (resumen.compradas ? " · pagado <b>" + fmt(resumen.real) + "</b>" : "") +
    (resumen.conFaltante ? " · falta comprar ≈ <b>" + fmt(resumen.faltante) + "</b>" : "") +
    (resumen.servicio ? " · para apartar (nómina) <b>" + fmt(resumen.realServicio) + "</b>" : "") +
    (resumen.ahorro ? " · ahorrado <b>" + fmt(resumen.ahorrado) + "</b>" : "") +
    "</div>";
  if (resuelto && diferencia !== 0 && resuelto === resumen.total) {
    html += '<div class="section-sub" style="margin:2px 0 0;color:' + (diferencia > 0 ? "var(--danger-ink)" : "var(--success-ink)") + ';">' +
      (diferencia > 0 ? "Se gastó " + fmt(diferencia) + " más de lo estimado." : "Se ahorró " + fmt(Math.abs(diferencia)) + " frente a lo estimado.") + "</div>";
  }

  // Compras "Sí" que todavía no están en Finanzas (p. ej. marcadas antes
  // del Hallazgo #58, cuando solo las llevaba el botón): se dice en vez de
  // dejar que la caja y "pagado" cuenten cosas distintas sin aviso.
  var desfasadas = comprasDesfasadasConFinanzas(c);
  if (desfasadas.length) {
    html += '<div class="section-sub" style="margin:6px 0 0;color:var(--warning-ink);">⚠ ' + desfasadas.length + (desfasadas.length === 1 ? " compra no coincide" : " compras no coinciden") + " con Finanzas: " +
      (estimadoTxDeCot(c, state.tx) ? "este pedido tiene el estimado completo registrado, así que no se actualizan solas (contaría el costo dos veces)."
        : state.cotSucia === c.id ? "se ponen al día al pulsar Guardar."
        : "pulsa «Actualizar movimientos financieros» para ponerlas al día.") + "</div>";
  }
  html += '<div class="row-actions" style="margin-top:12px;flex-wrap:wrap;">' +
    '<button class="btn" data-action="sincronizar-compras-finanzas" data-id="' + c.id + '" title="Crea (o actualiza) un movimiento de gasto en Finanzas por cada compra en estado \'Sí\', y borra el de las que ya no lo estén. Esto se hace solo al pulsar Guardar; el botón sirve para poner al día compras viejas. Las de \'Servicio\' NO generan movimiento: no hubo un pago instantáneo que registrar. Se puede volver a pulsar cuantas veces haga falta: nunca duplica.">Actualizar movimientos financieros</button>' +
    (c.estado === "convertida"
      ? '<button class="btn ghost small" data-action="add-cot-estimado-movimiento" data-id="' + c.id + '" title="Registra el costo total ESTIMADO del pedido como UN solo movimiento en Finanzas. Es una alternativa a llevar las compras reales una por una: registrar los dos contaría el mismo costo dos veces.">' +
        (estimadoTxDeCot(c, state.tx) ? "Actualizar el estimado ya registrado" : "Registrar estimado completo como movimiento") + "</button>"
      : '<span class="tag" style="background:var(--surface-3);" title="Disponible una vez esta cotización ya sea un pedido — es una medida de seguridad para no registrar gastos sin que exista un pedido con abono real.">🔒 Estimado completo (disponible al convertir en pedido)</span>') +
    "</div>";
  return html;
}

function renderFilaCompra(c, linea) {
  var compra = compraDeLinea(c, linea.clave) || {};
  // Sin ningún estado guardado todavía, una línea de servicio (corte,
  // confección — ver esInsumoServicio en core/calc.js) nace en "Servicio" en
  // vez de "No": es lo normal (se hace en el taller, se paga vía nómina), así
  // no hay que tocarla a mano en cada pedido. Sigue siendo editable por si
  // ESTA vez sí se tercerizó. Misma regla que usa calcResumenCompras — una
  // sola fuente para esta pregunta, no dos que puedan divergir.
  var estado = estadoLineaCompra(c, linea);
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

  if (esMiembroRecibo(compra)) return renderFilaCompraRecibo(c, linea, compra, abierta, attrs, estimadoCant, paraQuien);

  // Rastro sutil de "Compras conjuntas" (ver modules/finanzas.js): un ícono +
  // tooltip, no un aviso que interrumpa — el usuario pidió explícitamente que
  // no rompiera la armonía de la tabla. El tooltip excluye la etiqueta de
  // ESTE mismo pedido de la lista de "con quién" (no tiene sentido decir que
  // se compartió consigo mismo).
  var tagCompartida = "";
  if (compra.compartida) {
    var pedidoDeEsta = (state.pedidos || []).filter(function (p) { return p.cotizacionId === c.id; })[0];
    var etiquetaPropia = pedidoDeEsta ? (pedidoDeEsta.numeroOp || "OP-????") + " · " + (pedidoDeEsta.cliente || "Sin cliente") : "";
    var otras = (compra.compartida.etiquetas || []).filter(function (e) { return e !== etiquetaPropia; });
    tagCompartida = ' <span class="tag" title="Comprada junto con ' + esc(otras.join(", ") || "otro pedido") + " el " + esc(compra.compartida.fecha || "") + '">🔗 compartida</span>';
  }

  // "Ahorro" no pide cantidad ni costo: por definición es $0, así que
  // pedirlos sería como pedir "escribe 0 a mano" — justo la rareza que el
  // usuario señaló (elegir "Sí" y escribir "0" para decir, en el fondo,
  // "no lo compré"). Ver set-cot-compra: al elegir "Ahorro" los deja en 0
  // explícito solo (no hace falta que el usuario los toque).
  var esAhorro = estado === "ahorro";
  // Cuánto de esta compra se separó como excedente (compra de insumo aparte,
  // no cuenta como costo de este pedido) — ver cantidadExcedenteCompra en
  // core/calc.js. Un tag sutil en la fila para que se note sin tener que
  // abrir el detalle, mismo criterio que tagCompartida arriba.
  var excTag = "";
  if (estado === "si" && cantidadExcedenteCompra(compra) > 0) {
    excTag = ' <span class="tag" title="' + esc(cantidadExcedenteCompra(compra).toFixed(2) + " " + (linea.unidad || "") + " (" + fmt(costoExcedenteCompra(compra)) + ") separados como compra de insumo aparte — no cuentan como costo de este pedido") + '">📦 excedente</span>';
  }
  var html = '<div class="tx-row" style="grid-template-columns:' + COMPRA_COLS + ';">' +
    '<span class="mobile-th">Qué comprar</span><span>' + (linea.esGlobal ? "🌐 " : (linea.esProducto ? "📦 " : "")) + esc(linea.nombre) +
    (linea.esServicio ? ' <span class="tag">servicio</span>' : "") + tagCompartida + excTag + "</span>" +
    '<span class="mobile-th">Para / a quién</span><span>' + paraQuien + "</span>" +
    '<span class="mobile-th">Cant. est.</span><span class="amount">' + estimadoCant + "</span>" +
    '<span class="mobile-th">Costo est.</span><span class="amount">' + fmt(linea.costoTotal) + "</span>" +
    '<span class="mobile-th">Cant. real</span>' +
    (linea.esServicio || esAhorro
      ? '<span class="amount" style="color:var(--ink-faint);">—</span>'
      : '<input type="number" class="mini-input" style="width:100%" placeholder="' + (linea.esProducto ? linea.cantidadFisica : num(linea.cantidadFisica).toFixed(2)) + '" value="' + esc(compra.cantidadReal !== undefined ? compra.cantidadReal : "") + '"' + attrs + ' data-campo="cantidadReal" />') +
    '<span class="mobile-th">Costo real</span>' +
    (esAhorro
      ? '<span class="amount" style="color:var(--ink-faint);">—</span>'
      : '<input type="number" class="mini-input" style="width:100%" placeholder="' + Math.round(num(linea.costoTotal)) + '" value="' + esc(compra.costoReal !== undefined ? compra.costoReal : "") + '"' + attrs + ' data-campo="costoReal" />') +
    '<span class="mobile-th">Estado</span><span style="display:flex;gap:6px;align-items:center;">' +
    '<select class="mini-input" style="width:auto;"' + attrs + ' data-campo="estado" title="Aún no: nada registrado todavía. Sí: se pagó de verdad y aparte (crea un movimiento en Finanzas). Servicio: mano de obra propia (corte, confección…) — cuenta como costo real para que la ganancia no se infle, pero no crea movimiento en Finanzas porque no hubo un pago instantáneo, se paga vía nómina aparte. Ahorro: se decidió NO comprarlo/hacerlo y no hizo falta — cuenta como el ahorro completo frente al estimado, tampoco crea movimiento en Finanzas.">' +
    '<option value="no"' + (estado === "no" ? " selected" : "") + ">Aún no</option>" +
    '<option value="si"' + (estado === "si" ? " selected" : "") + ">Sí</option>" +
    '<option value="servicio"' + (estado === "servicio" ? " selected" : "") + ">Servicio</option>" +
    '<option value="ahorro"' + (estado === "ahorro" ? " selected" : "") + ">Ahorro</option>" +
    "</select>" +
    '<button class="btn ghost small" data-action="toggle-compra-detalle" data-cot="' + c.id + '" data-clave="' + esc(linea.clave) + '" title="Proveedor y observaciones de esta compra">' + (abierta ? "▾" : "▸") + "</button>" +
    "</span></div>";

  if (abierta) {
    html += '<div class="compra-detalle">' +
      '<div class="field"><label>Proveedor</label>' + renderSelectProveedorCompra(c, linea, proveedorId, attrs) + "</div>" +
      '<div class="field" style="flex:1;"><label>Observaciones</label><input class="mini-input" style="width:100%" placeholder="Ej. quedó pendiente medio rollo, precio subió" value="' + esc(compra.observaciones || "") + '"' + attrs + ' data-campo="observaciones" /></div>' +
      (estado === "si" && !linea.esServicio ? renderCampoExcedenteCompra(compra, linea, attrs) : "") +
      "</div>";
  }
  return html;
}

// Fila de una compra que está en uno o más Recibos de compra (ver "Recibo de
// compra" en core/calc.js). Estado y costo ya no se tocan acá — los manda
// el recibo (el papel del proveedor); se corrigen anulándolo. Lo único
// editable es "Cant. real" = cuánto usa de verdad este pedido: subirla toma
// de la reserva del recibo (y el costo de eso pasa a este pedido), bajarla
// devuelve a la reserva. Se aplica al Guardar, como el resto del editor.
// Estado y costo se REEMPLAZAN por texto (no se deshabilitan): un control
// deshabilitado hace que Tab lo salte y rompe el recorrido del teclado (ver
// ronda_seis_pedidos en la memoria del proyecto).
function renderFilaCompraRecibo(c, linea, compra, abierta, attrs, estimadoCant, paraQuien) {
  var reservas = reservasDeCompra(compra, state.cotizaciones, state.tx);
  var libres = reservas.reduce(function (a, r) { return a + Math.max(0, num(r.reserva.cantidad)); }, 0);
  var dec = linea.esProducto ? 0 : 2;
  var faltante = num(compra.faltante);
  var usado = num(compra.cantidadReal) + faltante;
  var recibosIds = [];
  (compra.partesRecibo || []).forEach(function (p) { if (recibosIds.indexOf(p.reciboId) === -1) recibosIds.push(p.reciboId); });
  var chipRecibo = ' <button class="tag" style="cursor:pointer;border:none;" data-action="ver-recibo" data-recibo-id="' + esc(recibosIds[0]) + '" title="Ver el recibo de compra en Finanzas">🧾 ' + (recibosIds.length > 1 ? recibosIds.length + " recibos" : "Recibo") + "</button>" +
    (libres > 0 ? ' <span class="tag" title="Libres en la reserva de su recibo: si este pedido necesita más, sube Cant. real y se toma de ahí.">↺ ' + libres.toFixed(dec) + " libres</span>" : "") +
    (faltante > 0 ? ' <span class="tag" style="background:var(--warning-soft);color:var(--warning-ink);" title="La reserva no alcanzó: esto falta comprar — regístralo en un recibo nuevo (Finanzas → Recibos de compra).">faltan ' + faltante.toFixed(dec) + "</span>" : "");
  var html = '<div class="tx-row" style="grid-template-columns:' + COMPRA_COLS + ';">' +
    '<span class="mobile-th">Qué comprar</span><span>' + (linea.esGlobal ? "🌐 " : (linea.esProducto ? "📦 " : "")) + esc(linea.nombre) + chipRecibo + "</span>" +
    '<span class="mobile-th">Para / a quién</span><span>' + paraQuien + "</span>" +
    '<span class="mobile-th">Cant. est.</span><span class="amount">' + estimadoCant + "</span>" +
    '<span class="mobile-th">Costo est.</span><span class="amount">' + fmt(linea.costoTotal) + "</span>" +
    '<span class="mobile-th">Cant. real</span>' +
    (lineaSinCantidad(linea) || linea.esServicio
      ? '<span class="amount" style="color:var(--ink-faint);">—</span>'
      : '<input type="number" class="mini-input" style="width:100%" ' + (linea.esProducto ? 'step="1" ' : "") + 'value="' + esc(usado) + '"' + attrs + ' data-campo="cantidadReal" title="Cuánto usa de verdad este pedido. Si sube, se toma de la reserva del recibo; si baja, vuelve a la reserva." />') +
    '<span class="mobile-th">Costo real</span><span class="amount" title="Lo que le toca a este pedido del recibo de compra">' + fmt(compra.costoReal) + "</span>" +
    '<span class="mobile-th">Estado</span><span style="display:flex;gap:6px;align-items:center;">' +
    '<span class="tag" title="Comprado con un recibo de compra: se corrige desde el recibo (Finanzas → Recibos de compra).">Sí · 🧾</span>' +
    '<button class="btn ghost small" data-action="toggle-compra-detalle" data-cot="' + c.id + '" data-clave="' + esc(linea.clave) + '" title="Recibos y observaciones de esta compra">' + (abierta ? "▾" : "▸") + "</button>" +
    "</span></div>";
  if (abierta) {
    html += '<div class="compra-detalle">';
    (compra.partesRecibo || []).forEach(function (p) {
      var r = calcRecibo(p.reciboId, state.cotizaciones, state.tx);
      var L = r.lineas.filter(function (x) { return x.linea === p.linea; })[0];
      var cab = r.cabecera || {};
      var prov = cab.proveedorId ? clienteById(cab.proveedorId) : null;
      html += '<div class="section-sub" style="margin:0 0 6px;flex-basis:100%;">🧾 Recibo del ' + esc(cab.fecha || "") + (prov ? " · " + esc(prov.nombre) : "") +
        " · su parte: " + (lineaSinCantidad(linea) ? "" : num(p.cantidad).toFixed(dec) + " " + esc(linea.unidad || "") + " ") + fmt(p.costo) +
        (L && (L.reserva.cantidad > 0 || L.reserva.costo > 0) ? " · reserva libre: " + (lineaSinCantidad(linea) ? "" : num(L.reserva.cantidad).toFixed(dec) + " " + esc(linea.unidad || "") + " ") + fmt(L.reserva.costo) : "") +
        ' <button class="btn ghost small" data-action="ver-recibo" data-recibo-id="' + esc(p.reciboId) + '">Ver recibo</button></div>';
    });
    html += '<div class="field" style="flex:1;"><label>Observaciones</label><input class="mini-input" style="width:100%" placeholder="Ej. quedó pendiente medio rollo" value="' + esc(compra.observaciones || "") + '"' + attrs + ' data-campo="observaciones" /></div>';
    html += "</div>";
  }
  return html;
}

// Cuánto de lo comprado se separa como "compra de insumo" aparte (mínimo del
// proveedor, conviene comprar de más, quedó material disponible para otro
// pedido) — esa parte no es costo ni sobrecosto de ESTE pedido. Se sugiere
// sola al escribir "Cant. real" (ver set-cot-compra), pero queda editable
// por si en realidad todo se usó en el pedido (ej. por daño/desperdicio) o
// si solo una parte del sobrante aplica. Ver conversación con el usuario
// 2026-09-21 y costoRealPedido/cantidadExcedenteCompra en core/calc.js.
function renderCampoExcedenteCompra(compra, linea, attrs) {
  var costoExc = costoExcedenteCompra(compra);
  var costoPedido = costoRealPedido(compra);
  return '<div class="field"><label>Excedente → compra de insumo' +
    renderHelp("Cuánto de lo comprado sobra para otro pedido — esa parte no cuenta como costo ni sobrecosto de ESTE pedido: se registra sola como una compra de insumo aparte en Finanzas (Gasto, \"Es insumo\"), vinculada a esta compra.") +
    "</label>" +
    '<input type="number" class="mini-input" style="width:100%" placeholder="0" value="' + esc(compra.cantidadExcedente !== undefined && compra.cantidadExcedente !== "" ? compra.cantidadExcedente : "") + '"' + attrs + ' data-campo="cantidadExcedente" />' +
    (costoExc > 0
      ? '<span class="section-sub" style="margin:4px 0 0;">De ' + fmt(num(compra.costoReal)) + " pagados: " + fmt(costoPedido) + " quedan en este pedido, " + fmt(costoExc) + " se separan como compra de insumo.</span>"
      : "") +
    "</div>";
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

// Insumo es la columna protagonista (crece con 1fr); Unidad/Enlace/Cant. se
// dejan angostas (Enlace prácticamente un ícono — el botón "🔗 N" no
// necesita más espacio); Costo/Costo x prenda quedan medianas. Pedido del
// usuario 2026-09-21: "que insumo sea más grandesito y con mayor
// protagonismo... enlace que prácticamente sea un icono".
var INS_COLS_REF = "minmax(150px,1fr) 55px 75px 165px 58px 55px 85px 30px";

// Aviso de que un insumo cambió en el catálogo desde que se copió a esta
// referencia (ver insumoCambioDeCatalogo en core/calc.js). A propósito NO es
// un banner ni una ventana: una franja angosta justo debajo de SU fila, del
// mismo color de advertencia que ya usa la app para "esto no bloquea nada,
// pero conviene mirarlo" — se lee de un vistazo y no interrumpe editar el
// resto de la referencia. Las dos salidas quedan una al lado de la otra:
// traer el número nuevo, o decir explícitamente que este, por ahora, se
// queda como está (útil en una cotización vieja que no tiene sentido
// repretinar).
function renderAvisoInsumoCambio(cotId, refId, insId, cambio) {
  var attrs = ' data-cot="' + cotId + '" data-ref="' + refId + '" data-ins="' + insId + '"';
  return '<div class="ins-aviso-cambio">' +
    '<span class="ins-aviso-cambio-msg">⚠ Este insumo cambió en el catálogo — antes ' + fmt(cambio.costoLinea) + ", ahora " + fmt(cambio.costoCatalogo) + "</span>" +
    '<span class="ins-aviso-cambio-acciones">' +
    '<button class="btn ghost small" data-action="actualizar-insumo-catalogo"' + attrs + '>Actualizar a ' + fmt(cambio.costoCatalogo) + "</button>" +
    '<button class="btn ghost small" data-action="descartar-aviso-insumo-cambio"' + attrs + '>Mantener ' + fmt(cambio.costoLinea) + "</button>" +
    "</span></div>";
}

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
    // Un insumo agregado del catálogo puede terminar acá (ver
    // moverInsumoAGlobal más abajo) sin perder su vínculo — el mismo aviso
    // de "el catálogo cambió" que ya existe para un insumo de referencia
    // aplica igual acá; antes NADIE lo revisaba en esta lista, así que un
    // insumo reclasificado como "Costo global del pedido" (ej. Domicilio)
    // dejaba de avisar para siempre aunque el vínculo siguiera intacto.
    // Reportado en producción 2026-09-21.
    var cambio = insumoCambioDeCatalogo(g);
    html += '<div class="ins-row global' + (cambio ? " cambio-catalogo" : "") + '" style="grid-template-columns:' + INS_COLS_REF + ';">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" placeholder="Ej. domicilio, diseño" value="' + esc(g.nombre || "") + '"' + attrs + ' data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><span class="insumo-unidad-cell"><input class="mini-input insumo-unidad" id="cotglobal-unidad-' + g.id + '" style="width:100%" value="' + esc(g.unidad || "") + '"' + attrs + ' data-campo="unidad" />' +
      renderComboUnidad({ id: "cotglobal-unidad-" + g.id }) + "</span>" +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(g.costo) + '"' + attrs + ' data-campo="costo" title="' + (cambio ? "El catálogo cambió este costo — ver el aviso debajo" : "") + '" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%"' + attrs + ' data-campo="tipo">' + renderTipoCostoOptions("global", true) + "</select>" +
      // El enlace no aplica a un costo global (se paga una vez, no por
      // prenda) — celda vacía solo para no desalinear las columnas con la
      // tabla de insumos de arriba, que comparte el mismo grid.
      '<span class="mobile-th">Enlace</span><span></span>' +
      // La cantidad no aplica: se paga una vez, no por prenda.
      '<span class="mobile-th">Cant.</span><input type="number" class="mini-input" style="width:100%" value="1" disabled />' +
      '<span class="mobile-th">Costo x prenda</span><span class="amount" title="' + fmt(g.costo) + " entre " + unidades + ' prenda(s) del pedido">' + fmt(calcCostoPrendaGlobal(cot, g)) + "</span>" +
      '<button class="ins-remove-btn" data-action="remove-costo-global" data-cot="' + cotId + '" data-global="' + g.id + '" title="Quitar" aria-label="Quitar">✕</button>' +
      "</div>";
    if (cambio) html += renderAvisoInsumoCambio(cotId, "", g.id, cambio);
  });
  return html;
}

// Servicios que se le COBRAN aparte al cliente (el diseño, un arreglo, un
// bordado suelto). Se ven al final de la tabla de insumos igual que los
// costos globales, pero son otra cosa y por eso van en su propio bloque: un
// costo global se reparte entre las prendas y se recupera dentro del precio
// de ellas; esto sale como su propia línea en la cotización del cliente, con
// su precio, y NO se reparte — repartirlo además de cobrarlo sería cobrarlo
// dos veces y dejaría el margen de cada prenda peor de lo que es.
//
// Un insumo se convierte en servicio cobrado eligiéndole el tipo de costo
// "Se cobra aparte al cliente", igual que con los globales.
function renderFilasServicios(cotId) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  var servicios = (cot && cot.serviciosCobrados) || [];
  if (!servicios.length) return "";
  var tot = calcServiciosCobrados(cot);
  var html = '<div class="ins-row-separador">' +
    '<span class="ins-row-separador-nota">Se le cobra aparte al cliente' +
    renderHelp("Sale como su propia línea en la cotización del cliente, aparte de las prendas: suma " + fmt(tot.precio) +
      " al total. Su costo (" + fmt(tot.costo) + ") es lo que te cuesta a ti producirlo, y NO se reparte entre las prendas — " +
      "si se repartiera lo estarías cobrando dos veces. La diferencia es la ganancia de esta línea.") +
    "</span></div>" +
    // Encabezado propio: estas filas NO significan lo mismo que las de
    // arriba (las columnas 5 y 6 son precio y ganancia, no cantidad y costo
    // por prenda), así que reusar el encabezado de la tabla de insumos las
    // haría leer al revés.
    '<div class="ins-row head" style="grid-template-columns:' + INS_COLS_REF + ';">' +
    "<span>Servicio</span><span>Unidad</span><span class=\"ins-th-num\">Te cuesta</span><span>Tipo de costo</span><span></span><span class=\"ins-th-num\">Le cobras</span><span class=\"ins-th-num\">Ganancia</span><span></span></div>";
  servicios.forEach(function (s) {
    var attrs = ' data-action-change="set-servicio-cobrado" data-cot="' + cotId + '" data-servicio="' + s.id + '"';
    var ganancia = num(s.precio) - num(s.costo);
    // Mismo aviso de "el catálogo cambió" que ya existe para un insumo de
    // referencia — un insumo agregado del catálogo puede terminar acá (ver
    // moverInsumoAServicio) sin perder su vínculo, y antes nadie lo
    // revisaba en esta lista. Reportado en producción 2026-09-21.
    var cambio = insumoCambioDeCatalogo(s);
    html += '<div class="ins-row servicio' + (cambio ? " cambio-catalogo" : "") + '" style="grid-template-columns:' + INS_COLS_REF + ';">' +
      '<span class="mobile-th">Servicio</span><input class="mini-input" style="width:100%" placeholder="Ej. diseño" value="' + esc(s.nombre || "") + '"' + attrs + ' data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><span class="insumo-unidad-cell"><input class="mini-input insumo-unidad" id="cotserv-unidad-' + s.id + '" style="width:100%" value="' + esc(s.unidad || "") + '"' + attrs + ' data-campo="unidad" />' +
      renderComboUnidad({ id: "cotserv-unidad-" + s.id }) + "</span>" +
      '<span class="mobile-th">Te cuesta</span><input type="number" class="mini-input" style="width:100%" value="' + esc(s.costo) + '"' + attrs + ' data-campo="costo" title="' + (cambio ? "El catálogo cambió este costo — ver el aviso debajo" : "Lo que te cuesta producirlo (lo que le pagas al diseñador). Si lo haces tú y no sale plata, déjalo en 0.") + '" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%"' + attrs + ' data-campo="tipo">' + renderTipoCostoOptions("servicio_cobrado", true) + "</select>" +
      "<span></span>" +
      '<span class="mobile-th">Le cobras</span><input type="number" class="mini-input" style="width:100%" value="' + esc(s.precio) + '"' + attrs + ' data-campo="precio" title="Lo que le cobras al cliente por este servicio. Es lo que sale en la cotización." />' +
      '<span class="mobile-th">Ganancia</span><span class="amount' + (ganancia < 0 ? " neg" : "") + '" title="Lo que le cobras menos lo que te cuesta">' + fmt(ganancia) + "</span>" +
      '<button class="ins-remove-btn" data-action="remove-servicio-cobrado" data-cot="' + cotId + '" data-servicio="' + s.id + '" title="Quitar" aria-label="Quitar">✕</button>' +
      "</div>";
    if (cambio) html += renderAvisoInsumoCambio(cotId, "", s.id, cambio);
  });
  return html;
}

// El ORIGEN de la referencia no es un campo más: es lo que decide qué
// formulario se muestra. Una referencia fabricada en el taller se costea con
// insumos, sin distinción de "origen" — una prenda comprada hecha a un
// proveedor es, desde 2026-09-21, un insumo más ("Prenda comprada a
// proveedor", ver TIPOS_COSTO en core/constants.js) dentro de la MISMA
// lista, no una referencia entera hecha de otra forma. El usuario lo pidió
// explícito para simplificar el formulario: "dejar la camiseta como
// insumo y ahí decidir si se le agregan más cosas o no (insumos o
// procesos)". Así, agregar un DTF o una planchada sobre una prenda ya
// comprada es agregar otro insumo más, igual que agregar tela para una
// que se fabrica — nunca un caso especial.

// Tabla de insumos de una referencia (fila por insumo + costos globales +
// servicios cobrados + botones para agregar, incluyendo "Aplicar
// plantilla"/"Aplicar producto" — sin distinción de origen, cualquiera de
// los dos puede incluir una "prenda comprada" como parte de su receta).
function renderTablaInsumosRef(cotId, ref) {
  var html = '<div class="ins-table">' +
    '<div class="ins-row head" style="grid-template-columns:' + INS_COLS_REF + ';"><span>Insumo</span><span>Unidad</span><span class="ins-th-num">Costo</span><span>Tipo de costo</span><span>Enlace</span><span class="ins-th-num">Cant.</span><span class="ins-th-num">Costo x prenda</span><span></span></div>';
  (ref.insumos || []).forEach(function (i) {
    // El insumo se copió del catálogo al agregarlo (costo incluido) para que
    // esta cotización no cambie de precio sola si el catálogo se repone más
    // caro después. Pero esa copia puede quedar vieja sin que nadie se entere
    // — esto compara la copia contra el catálogo VIGENTE (ver
    // insumoCambioDeCatalogo en core/calc.js) y avisa, sin bloquear nada: la
    // cotización sigue funcionando igual con el número que tenía, hasta que
    // alguien decida actualizarla.
    var cambio = insumoCambioDeCatalogo(i);
    var attrsIdent = ' data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '"';
    var attrsIns = ' data-action-change="set-ins-campo"' + attrsIdent;
    // Reordenar por arrastre con SortableJS (ver bindEvents en core/dom.js y
    // reordenarInsumos más abajo) — no con el API nativo de drag-and-drop:
    // esta librería trae soporte real por touch de fábrica, que el nativo no
    // ofrece de forma confiable. El manijo se posiciona ABSOLUTO (ver
    // css/cotizaciones.css) para no participar del grid ni de las parejas
    // etiqueta/valor del colapso responsivo (ver responsive.css) — no hizo
    // falta tocar esa lógica para nada.
    html += '<div class="ins-row' + (cambio ? " cambio-catalogo" : "") + '" style="grid-template-columns:' + INS_COLS_REF + ';" data-ins-row data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '">' +
      '<span class="ins-drag-handle" title="Arrastra para reordenar">⠿</span>' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '"' + attrsIns + ' data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><span class="insumo-unidad-cell"><input class="mini-input insumo-unidad" id="cotins-unidad-' + i.id + '" style="width:100%" value="' + esc(i.unidad) + '"' + attrsIns + ' data-campo="unidad" />' +
      renderComboUnidad({ id: "cotins-unidad-" + i.id }) + "</span>" +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '"' + attrsIns + ' data-campo="costo" title="' + (cambio ? "El catálogo cambió este costo — ver el aviso debajo" : "") + '" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%"' + attrsIns + ' data-campo="tipo">' + renderTipoCostoOptions(i.tipo, true) + "</select>" +
      '<span class="mobile-th">Enlace</span><span class="enlace-celda" data-ins-celda="' + i.id + '">' +
      (TIPOS_ENLAZABLES.indexOf(i.tipo) !== -1
        ? renderEnlacePanel(i, ref.insumos || [], state.catalogoCategorias, {
            abierto: !!(state.enlacePanelAbierto || {})[i.id],
            busqueda: (state.enlaceBusqueda || {})[i.id] || "",
            toggleAction: "toggle-enlace-panel", catAction: "toggle-ins-enlace-categoria", insAction: "toggle-ins-enlace-insumo", buscarAction: "set-enlace-busqueda",
            propiaCategoriaAction: "set-ins-categoria-propia",
            mismoTipoAction: "toggle-ins-enlace-mismotipo",
            categoriasEnlazables: categoriasUsadasPorInsumos(state.catalogoCategorias, ref.insumos || []),
            contenedor: ref,
            attrsBase: attrsIdent
          })
        : '<span class="section-sub" style="margin:0;">—</span>') +
      "</span>" +
      // Para "tela", la cantidad ES el consumo (metros) de ESTA tela — ya
      // no la comparte con la referencia (ver calcCostoPrenda en
      // core/calc.js): dos sublimados distintos en la misma referencia
      // pueden consumir cantidades distintas. "Fijo por pedido" sigue
      // deshabilitado — no tiene cantidad propia, la determina
      // cantidadPedida de la referencia. Un insumo ENLAZADO (ver arriba)
      // no se edita a mano: se calcula solo, ver renderCeldaCantidadInsumo.
      '<span class="mobile-th">Cant.</span>' + renderCeldaCantidadInsumo(i, ref, attrsIns) +
      '<span class="mobile-th">Costo x prenda</span><span class="amount">' + fmt(calcCostoPrenda(i, ref)) + "</span>" +
      '<button class="ins-remove-btn" data-action="remove-insumo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-insumo="' + i.id + '" title="Quitar" aria-label="Quitar">✕</button>' +
      "</div>";
    if (cambio) html += renderAvisoInsumoCambio(cotId, ref.id, i.id, cambio);
  });
  if ((ref.insumos || []).length === 0) { html += '<div class="empty" style="padding:8px 0;">Sin insumos aún.</div>'; }
  html += renderFilasGlobales(cotId, ref);
  html += renderFilasServicios(cotId);
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
  return html;
}
function renderRefCard(cotId, ref) {
  var cotRef = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  // Costo CARGADO: el directo de la referencia más la parte que le toca de
  // los costos globales del pedido. Es el mismo número que usan el total de
  // la cotización y el reporte de productos vendidos — antes la referencia
  // mostraba solo el directo y parecía que las cuentas no cuadraban.
  var calc = calcRefTotalesConGlobales(cotRef, ref);
  var attrs = ' data-cot="' + cotId + '" data-ref="' + ref.id + '"';
  var html = '<div class="ref-card" data-ref-id="' + ref.id + '">' +
    '<div class="ref-top">' +
    renderThumb(cotId, ref) +
    '<div class="ref-top-info">' +
    '<span class="ref-nombre"><input class="mini-input" style="width:100%;font-weight:700;font-size:14px;" placeholder="Nombre de la referencia (ej. Camiseta jugador)" value="' + esc(ref.nombre) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="nombre" /></span>' +
    '<div class="ref-fields" style="margin-top:8px;">' +
    '<span><label>Cantidad pedido</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.cantidadPedida) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="cantidadPedida" /></span>' +
    '<span><label>Precio venta x1</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.precioVenta) + '" data-action-change="set-ref-campo"' + attrs + ' data-campo="precioVenta" /></span>' +
    '<button class="btn danger small" style="align-self:flex-start;" data-action="remove-referencia"' + attrs + ">Eliminar referencia</button>" +
    "</div>" +
    "</div>" +
    "</div>";

  // Ya no hay interruptor "se fabrica en el taller / se compra a
  // proveedor": una prenda comprada hecha es, desde 2026-09-21, un insumo
  // más (tipo "Prenda comprada a proveedor", ver TIPOS_COSTO en
  // core/constants.js) en esta MISMA tabla — el usuario lo pidió
  // explícito para simplificar el formulario ("dejar la camiseta como
  // insumo y ahí decidir si se le agregan más cosas"). "Consumo tela
  // (MT)" también se quitó de acá: cada tela ya lleva su propio consumo
  // en su fila (ver nuevoInsumo), no hace falta un valor de arranque a
  // nivel de referencia. Ver repararReferenciasProveedorAInsumo en
  // core/store.js para la migración de lo ya guardado con el modelo
  // anterior.
  html += renderTablaInsumosRef(cotId, ref);

  html += '<div class="ref-summary">' +
    '<div class="rs-item"><div class="rl">Costo x prenda' +
    (calc.costoGlobalUnit
      ? renderHelp("Incluye " + fmt(calc.costoDirectoUnit) + " de los insumos de esta referencia, más " + fmt(calc.costoGlobalUnit) + " que le toca de los costos globales del pedido (los de abajo de la línea intermitente). Es el costo ESTIMADO con el que cuenta el total de la cotización. Los reportes (Pedidos y Productos vendidos) usan el costo real una vez registradas las compras.")
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
  // Estilo propio (no el genérico .cot-col-title, gris y chico que usan
  // todos los demás encabezados de esta tarjeta): acá vive el flujo de
  // producción y el detalle de tallas/observaciones, lo que arma el PDF de
  // producción de un uniforme completo — fácil de pasar por alto si se ve
  // igual de discreto que "Costos globales del pedido". Con color de acento
  // llama la atención de que hay algo que vale la pena abrir.
  var titulo = "Opciones adicionales" + (detalle.length ? " · tallas (" + detalle.length + ")" : "");
  var html = renderToggleSeccion({
    titulo: titulo, abierta: abierta, action: "toggle-ref-seccion",
    attrs: ' data-cot="' + cotId + '" data-ref="' + ref.id + '"', margenSuperior: "14px"
  });
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
      '<div class="det-row head"><span>#</span><span>Nombre</span><span>Talla</span><span>Número</span><span>Tipo</span><span>Prendas</span><span>Observaciones</span><span></span></div>';
    detalle.forEach(function (d, i) {
      html += '<div class="det-row">' +
        '<span class="mobile-th">#</span><span>' + (i + 1) + "</span>" +
        '<span class="mobile-th">Nombre</span><input class="mini-input" value="' + esc(d.nombre) + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="nombre" />' +
        '<span class="mobile-th">Talla</span><input class="mini-input" value="' + esc(d.talla || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="talla" />' +
        '<span class="mobile-th">Número</span><input class="mini-input" value="' + esc(d.numero || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="numero" />' +
        '<span class="mobile-th">Tipo</span><input class="mini-input" value="' + esc(d.tipo || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="tipo" />' +
        '<span class="mobile-th">Prendas</span><input class="mini-input" value="' + esc(d.prendas || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="prendas" />' +
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
    '<input class="mini-input" data-role="det-prendas-' + ref.id + '" placeholder="Prendas (Conjunto, Camiseta...)" style="width:170px" />' +
    '<input class="mini-input" data-role="det-obs-' + ref.id + '" placeholder="Observaciones" style="width:160px" />' +
    '<button class="btn ghost small" data-action="add-ref-detalle" data-cot="' + cotId + '" data-ref="' + ref.id + '">Agregar fila</button>' +
    "</div>";
  html += '<div class="inline-form" style="margin-top:6px;">' +
    '<label class="btn ghost small" style="cursor:pointer;">📥 Importar Excel<input type="file" accept=".xlsx,.xls,.csv" data-action-change="import-ref-detalle-csv" data-cot="' + cotId + '" data-ref="' + ref.id + '" style="display:none" /></label>' +
    '<button class="btn ghost small" data-action="descargar-plantilla-csv">Descargar plantilla Excel</button>' +
    renderHelp("El archivo debe tener columnas: nombre, talla, numero, tipo, prendas, observaciones (en cualquier orden, y las últimas tres son opcionales). Descarga la plantilla para verlo con un ejemplo — es un .xlsx normal, se abre bien tanto en Excel como en Sheets. También aceptamos CSV si lo prefieres.") +
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

  var COLS = "34px minmax(110px,1.4fr) 70px 70px minmax(90px,1fr) 34px";
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
  "abrir-cliente-picker-cotizacion": function () {
    state.clientePickerAbierto = true;
    state.clientePickerBusqueda = "";
    state.clientePickerCotizacionId = ""; // por si quedó de una edición anterior sin cerrar bien
    notify();
  },
  "cerrar-cliente-picker": function () {
    state.clientePickerAbierto = false;
    state.clientePickerCotizacionId = "";
    notify();
  },
  "seleccionar-cliente-picker-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var c = state.clientes.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    state.formCotizacion.clienteId = c.id;
    state.formCotizacion.cliente = c.nombre;
    state.clientePickerAbierto = false;
    notify();
  },
  // Cambiar el cliente de una cotización que YA EXISTE, desde el botón en la
  // cabecera del detalle (renderCotHead) — a diferencia de
  // "seleccionar-cliente-picker-cotizacion" (arriba), que edita el
  // BORRADOR de "nueva cotización", esto edita de una el registro real.
  "abrir-cliente-picker-cotizacion-editar": function (el) {
    state.clientePickerAbierto = true;
    state.clientePickerBusqueda = "";
    state.clientePickerCotizacionId = el.getAttribute("data-id");
    notify();
  },
  "seleccionar-cliente-picker-cotizacion-editar": function (el) {
    var id = el.getAttribute("data-id");
    var c = state.clientes.filter(function (x) { return x.id === id; })[0];
    var cotId = state.clientePickerCotizacionId;
    if (!c || !cotId) return;
    state.cotizaciones = state.cotizaciones.map(function (cot) {
      return cot.id === cotId ? Object.assign({}, cot, { clienteId: c.id, cliente: c.nombre }) : cot;
    });
    marcarSucia(cotId);
    state.clientePickerAbierto = false;
    state.clientePickerCotizacionId = "";
    notify();
  },
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
  // Solo cambia cómo se VE la referencia (abierta/cerrada) — no es un dato
  // que el usuario esté editando, así que NO debe marcar la cotización como
  // "cambios sin guardar" (mapRef sí lo hace, vía conRef -> marcarSucia).
  // Antes lo hacía, y con una referencia larga (roster de un uniforme
  // completo) simplemente abrir "Opciones adicionales" para MIRARLA ya hacía
  // aparecer el botón flotante de Guardar, sin que nada real hubiera
  // cambiado — se sentía como si la pantalla "soltara" el botón de guardado
  // sola. Muta `state.cotizaciones` directo (igual que mapRef) para que si
  // MÁS ADELANTE sí hay un cambio real y se guarda, este toggle viaje con él;
  // pero por sí solo no dispara ni el aviso ni una escritura a la Sheet.
  "toggle-ref-seccion": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, {
        referencias: (c.referencias || []).map(function (r) {
          if (r.id !== refId) return r;
          var abierta = r.seccionOpcionalesAbierta !== undefined ? !!r.seccionOpcionalesAbierta : (r.detalle || []).length > 0;
          return Object.assign({}, r, { seccionOpcionalesAbierta: !abierta });
        })
      });
    });
    notify();
  },
  "add-cotizacion": function () {
    var fc = state.formCotizacion;
    if (!exigirCampos([["Cliente", fc.cliente], ["Descripción", fc.descripcion]])) return;
    var nueva = { id: uid(), clienteId: fc.clienteId || "", cliente: fc.cliente, descripcion: fc.descripcion, fecha: fc.fecha, fechaEntrega: fc.fechaEntrega || "", marca: fc.marca || "", referencias: [nuevaReferencia()], costosGlobales: [], serviciosCobrados: [], gastosReales: [], estado: "borrador", pedidoId: "", iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: codigoPublico() };
    state.cotizaciones.unshift(nueva);
    state.formCotizacion = { clienteId: "", cliente: "", descripcion: "", fecha: todayStr(), fechaEntrega: "", marca: "" };
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
  // Solo informativo (de qué línea del negocio es el pedido) — no se
  // traslada al pedido al convertir, a propósito: es un dato exclusivo de
  // Cotizaciones (ver datosPedidoDesdeCot, que no lo incluye).
  "set-cot-marca": function (el) {
    var id = el.getAttribute("data-id");
    var valor = el.value;
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { marca: valor }) : c; });
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
    // "Nunca negativo" en un servicio se protege en todo el resto del
    // sistema (validarServiciosAsignados) — esta era la única puerta por
    // donde se podía romper: borrar la cotización que aportó un servicio
    // YA gastado (asignado a un gasto/nómina real) dejaba su "disponible"
    // en negativo, sin ningún aviso. Se bloquea acá, no solo se avisa —
    // misma severidad que el resto de esa regla. Auditoría 2026-09-20.
    var serviciosRotos = serviciosQueQuedanNegativosSiSeBorra(cot);
    if (serviciosRotos.length) {
      window.alert('No se puede eliminar: ya se gastó plata del servicio "' + serviciosRotos[0].nombre + '" que esta cotización aportó (quedaría en ' + fmt(serviciosRotos[0].quedaria) + '). Deshaz esa asignación primero desde Finanzas/Pendientes, o esperar a que se pague por otra vía.');
      return;
    }
    var movimientos = movimientosGeneradosPorCotizacion(cot);
    var neto = movimientos.reduce(function (a, t) { return t.tipo === "ingreso" ? a + num(t.monto) : a - num(t.monto); }, 0);
    var aviso = movimientos.length
      ? ("\n\nSe van con ella " + movimientos.length + " movimiento(s) de Finanzas que generó (comisión, compras, estimado)" +
         (neto ? ", con un efecto neto de " + fmt(Math.abs(neto)) + " en la caja" : "") +
         ". Quedan en la papelera de movimientos por si alguno correspondía a un gasto que sí ocurrió.")
      : "";
    // Su parte de un Recibo de compra NO se va con ella: esa plata ya se le
    // pagó al proveedor. Pasa a la reserva del recibo (ver
    // reconciliarTxRecibo en core/calc.js) — la caja no cambia.
    var recibosCot = idsRecibosDeCot(cot);
    var avisoRecibos = recibosCot.length
      ? "\n\nSu parte de " + recibosCot.length + " recibo(s) de compra vuelve a la reserva del recibo: esa plata ya se pagó y no sale de la caja."
      : "";
    if (!window.confirm('¿Eliminar la cotización "' + (cot.descripcion || cot.cliente) + '"?\n\nNo hay papelera de cotizaciones: esto no se puede deshacer.' + aviso + avisoRecibos)) return;
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
    if (recibosCot.length) {
      ejecutarAccionRecibo({ recibos: recibosCot, deltaCaja: 0, permitirCotSucia: true }, function () {
        recibosCot.forEach(function (rid) { state.tx = reconciliarTxRecibo(state.tx, rid, state.cotizaciones).tx; });
      });
    }
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
  "set-ref-campo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), campo = el.getAttribute("data-campo");
    var textual = campo === "nombre";
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
  // ---------- explorador de insumos (modal, ver core/dom.js para el resto
  // de las acciones — cerrar/categoría/marcar son transversales) ----------
  "abrir-insumo-picker": function (el) {
    state.insumoPickerAbierto = "cotizacion";
    state.insumoPickerCotId = el.getAttribute("data-cot");
    state.insumoPickerRefId = el.getAttribute("data-ref");
    state.insumoPickerCategoria = "todos";
    state.insumoPickerBusqueda = "";
    state.insumoPickerSeleccion = [];
    notify();
  },
  "confirmar-insumo-picker": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var ids = state.insumoPickerSeleccion || [];
    if (!ids.length) return;
    // La referencia actual, solo para heredarle su consumo de tela como
    // valor de arranque a cualquier insumo nuevo tipo "tela" (ver
    // nuevoInsumo más arriba) — no se muta nada acá.
    var cotActual = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
    var refActual = cotActual && (cotActual.referencias || []).filter(function (r) { return r.id === refId; })[0];
    // Se agregan en el orden del catálogo (no en el orden en que se fueron
    // marcando), que es el mismo que se ve en la lista de la izquierda.
    var nuevos = (state.catalogoInsumos || [])
      .filter(function (i) { return ids.indexOf(i.id) !== -1; })
      .map(function (i) { return nuevoInsumo(i, refActual); });
    state.insumoPickerAbierto = "";
    state.insumoPickerCotId = ""; state.insumoPickerRefId = "";
    state.insumoPickerSeleccion = [];
    state.insumoPickerBusqueda = "";
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).concat(nuevos) }); });
  },
  "remove-insumo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-insumo");
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  // Trae a esta cotización el costo que el insumo tiene HOY en el catálogo.
  // Limpia cualquier "mantener" anterior (avisoInsumoDescartado): si el
  // catálogo vuelve a cambiar más adelante, tiene que poder avisar de nuevo.
  // Sin `refId` (ver renderFilasGlobales/renderFilasServicios) el insumo ya
  // no vive en una referencia — se reclasificó a "Costo global del pedido"
  // o "Se cobra aparte al cliente" (ver moverInsumoAGlobal/AServicio), pero
  // sigue apuntando al mismo insumo del catálogo.
  "actualizar-insumo-catalogo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins");
    if (refId) {
      mapRef(cotId, refId, function (r) {
        return Object.assign({}, r, {
          insumos: (r.insumos || []).map(function (i) {
            if (i.id !== insId) return i;
            var actual = (state.catalogoInsumos || []).filter(function (c) { return c.id === i.origenCatalogoId; })[0];
            if (!actual) return i;
            return Object.assign({}, i, { costo: num(actual.costo), avisoInsumoDescartado: undefined });
          })
        });
      });
      return;
    }
    aplicarCambioCatalogoFueraDeReferencia(cotId, insId, function (linea, actual) {
      return Object.assign({}, linea, { costo: num(actual.costo), avisoInsumoDescartado: undefined });
    });
  },
  // "Mantener": el usuario ya vio que el catálogo cambió y decide, a
  // conciencia, seguir con el número que ya tenía la cotización — típico de
  // una cotización vieja que no tiene sentido repretinar. No borra el aviso
  // para siempre: guarda CONTRA QUÉ costo del catálogo se decidió esto, así
  // que si el catálogo cambia OTRA vez después, vuelve a avisar.
  "descartar-aviso-insumo-cambio": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins");
    if (refId) {
      mapRef(cotId, refId, function (r) {
        return Object.assign({}, r, {
          insumos: (r.insumos || []).map(function (i) {
            if (i.id !== insId) return i;
            var actual = (state.catalogoInsumos || []).filter(function (c) { return c.id === i.origenCatalogoId; })[0];
            if (!actual) return i;
            return Object.assign({}, i, { avisoInsumoDescartado: num(actual.costo) });
          })
        });
      });
      return;
    }
    aplicarCambioCatalogoFueraDeReferencia(cotId, insId, function (linea, actual) {
      return Object.assign({}, linea, { avisoInsumoDescartado: num(actual.costo) });
    });
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
    // Y "Se cobra aparte al cliente" lo saca de la referencia hacia la lista
    // de servicios cobrados: deja de ser un costo escondido en el precio de
    // la prenda y pasa a ser una línea propia de la cotización.
    if (campo === "tipo" && valor === "servicio_cobrado") {
      moverInsumoAServicio(cotId, refId, insId);
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
  // Marcar/desmarcar una CATEGORÍA o un insumo ESPECÍFICO en el panel de
  // enlace (ver renderEnlacePanel en core/components.js) — el checkbox ES
  // la forma de "agregar o quitar" un enlace, el usuario lo pidió explícito
  // tras corregir el primer intento (enlazar por tipo de costo, equivocado
  // — "lo que quiero enlazar son cantidades"). Si al quitar el último
  // enlace la lista queda vacía, se congela la última cantidad calculada en
  // el campo manual — si no, "Cant." saltaría de golpe al valor viejo que
  // tenía guardado desde antes de enlazarse (nunca se actualizó mientras
  // estuvo enlazado, ver cantidadEfectivaInsumo en core/calc.js), como si
  // se hubiera corregido algo sin que nadie lo tocara.
  "toggle-ins-enlace-categoria": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins"), catId = el.getAttribute("data-cat");
    mapRef(cotId, refId, function (r) {
      var insumos = (r.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var enlace = i.enlace || { categorias: [], insumos: [] };
        var categorias = (enlace.categorias || []).slice();
        var idx = categorias.indexOf(catId);
        if (idx === -1) categorias.push(catId); else categorias.splice(idx, 1);
        var nuevoEnlace = { categorias: categorias, insumos: enlace.insumos || [], mismoTipo: !!enlace.mismoTipo };
        var patch = { enlace: nuevoEnlace };
        if (!categorias.length && !nuevoEnlace.insumos.length && !nuevoEnlace.mismoTipo) patch.cantidad = cantidadEfectivaInsumo(i, r);
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, r, { insumos: insumos });
    });
  },
  "toggle-ins-enlace-insumo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins"), nombreClave = el.getAttribute("data-nombre");
    mapRef(cotId, refId, function (r) {
      var insumos = (r.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var enlace = i.enlace || { categorias: [], insumos: [] };
        var lista = (enlace.insumos || []).slice();
        var idx = lista.indexOf(nombreClave);
        if (idx === -1) lista.push(nombreClave); else lista.splice(idx, 1);
        var nuevoEnlace = { categorias: enlace.categorias || [], insumos: lista, mismoTipo: !!enlace.mismoTipo };
        var patch = { enlace: nuevoEnlace };
        if (!nuevoEnlace.categorias.length && !lista.length && !nuevoEnlace.mismoTipo) patch.cantidad = cantidadEfectivaInsumo(i, r);
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, r, { insumos: insumos });
    });
  },
  // "Todos los insumos <tipo> de aquí" (ver mismoTipoAction en
  // renderEnlacePanel, core/components.js) — suma automáticamente
  // cualquier insumo hermano con el MISMO tipo de costo, sin tener que
  // asignarle categoría uno por uno. Reportado en producción 2026-09-21:
  // el usuario ya había enlazado Sublimación a "Telas" y le había
  // asignado esa categoría a Sublimación misma, pero las demás telas de
  // la referencia (Corte, Elástico, Montreal) nunca se habían etiquetado
  // individualmente — "está seleccionada la categoría telas, pero no lee
  // las telas que ya están agregadas". Mismo criterio de "congelar al
  // quitar el último enlace" que las otras dos acciones de enlace.
  "toggle-ins-enlace-mismotipo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins");
    mapRef(cotId, refId, function (r) {
      var insumos = (r.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var enlace = i.enlace || { categorias: [], insumos: [] };
        var mismoTipo = !enlace.mismoTipo;
        var nuevoEnlace = { categorias: enlace.categorias || [], insumos: enlace.insumos || [], mismoTipo: mismoTipo };
        var patch = { enlace: nuevoEnlace };
        if (!nuevoEnlace.categorias.length && !nuevoEnlace.insumos.length && !mismoTipo) patch.cantidad = cantidadEfectivaInsumo(i, r);
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, r, { insumos: insumos });
    });
  },
  // A qué categoría del catálogo pertenece ESTE insumo (ver "Este insumo
  // pertenece a…" en renderEnlacePanel, core/components.js) — a diferencia
  // de Catálogo, un insumo de una referencia no tiene ningún otro campo
  // para asignarla, así que un insumo escrito directo en la cotización (sin
  // pasar por el catálogo) nunca podía ser el DESTINO de un enlace por
  // categoría de otro insumo. Reportado en producción 2026-09-21: el
  // enlace "funcionaba cuando selecciono los insumos manualmente" (por
  // NOMBRE específico) pero no por categoría — porque esas telas nunca
  // tuvieron categoriaId. Ver Hallazgo #34 en CONTABILIDAD.md.
  "set-ins-categoria-propia": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins");
    var valor = el.value;
    mapRef(cotId, refId, function (r) {
      var insumos = (r.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        return Object.assign({}, i, { categoriaId: valor });
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
        // esServicio ya viene resuelto desde la plantilla (ver add-pla-insumo-
        // catalogo en modules/plantillas.js) — se hereda tal cual, no se
        // vuelve a calcular acá (la referencia tampoco guarda categoriaId).
        // `origenCatalogoId` se hereda igual, si la plantilla lo trae — es
        // lo que permite avisar acá si el catálogo cambió de precio (ver
        // insumoCambioDeCatalogo en core/calc.js). Reportado en producción
        // 2026-09-21: sin esto, TODO insumo agregado vía "Aplicar
        // plantilla" perdía el vínculo, sin importar que la plantilla sí lo
        // tuviera. `consumoPropio: true` también viaja con la tela: este
        // consumo YA es el propio de la plantilla, no el genérico de la
        // referencia — sin esto, la reparación retroactiva
        // (repararConsumoTelaPorInsumo en core/store.js) lo pisaría con
        // consumoAprox de la referencia en el próximo loadAll().
        return { id: uid(), nombre: ins.nombre, unidad: ins.unidad, costo: num(ins.costo), tipo: ins.tipo, cantidad: num(ins.cantidad) || 1, esServicio: !!ins.esServicio, origenCatalogoId: ins.origenCatalogoId || "", consumoPropio: ins.tipo === "tela", categoriaId: ins.categoriaId || "", enlace: { categorias: ((ins.enlace && ins.enlace.categorias) || []).slice(), insumos: ((ins.enlace && ins.enlace.insumos) || []).slice(), mismoTipo: !!(ins.enlace && ins.enlace.mismoTipo) } };
      });
      var patch = { insumos: (r.insumos || []).concat(nuevosInsumos) };
      if (!r.nombre) patch.nombre = pla.nombre;
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
  // Igual que "aplicar-plantilla" (copia insumos/imagen/flujo), pero además
  // marca la referencia como ligada a un producto del catálogo (r.productoId
  // + r.precioVenta sugerido). Eso es lo que permite, al convertir la
  // cotización en pedido, descontar el stock real de ese producto agrupando
  // las filas de "Tallas y observaciones" por talla (ver función auxiliar
  // descontarStockPorTallas más abajo). El producto del catálogo SÍ sigue
  // teniendo su propio origen (taller/proveedor, ver modules/productos.js —
  // eso no cambió); lo que cambió 2026-09-21 es que un producto comprado a
  // proveedor ya no reescribe la referencia entera: se traduce en UN insumo
  // "Prenda comprada a proveedor" más, que se SUMA a lo que la referencia ya
  // tuviera (igual que cualquier otro insumo de plantilla/producto).
  "aplicar-producto": function (el) {
    if (!el.value) return;
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var prod = (state.productos || []).filter(function (p) { return p.id === el.value; })[0];
    if (!prod) return;
    mapRef(cotId, refId, function (r) {
      var patch = { productoId: prod.id };
      if (!r.nombre) patch.nombre = prod.nombre;
      if (prod.imagenUrl && !r.imagenUrl) patch.imagenUrl = prod.imagenUrl;
      if (prod.precioVenta && (!r.precioVenta || Number(r.precioVenta) === 0)) patch.precioVenta = num(prod.precioVenta);
      if (prod.origen === "proveedor") {
        patch.insumos = (r.insumos || []).concat([{
          id: uid(), nombre: prod.nombre || "Producto de proveedor", unidad: "UND",
          costo: num(prod.costoCompra), tipo: "producto_comprado", cantidad: 1,
          esServicio: false, proveedorId: prod.proveedorId || "", origenCatalogoId: "", categoriaId: "", enlace: { categorias: [], insumos: [] }
        }]);
      } else {
        patch.insumos = (r.insumos || []).concat((prod.insumos || []).map(function (ins) {
          // esServicio ya viene resuelto desde el producto (ver
          // confirmar-insumo-picker-producto en modules/productos.js).
          // `origenCatalogoId`/`consumoPropio` se heredan igual — ver el
          // mismo comentario en "aplicar-plantilla" más arriba.
          return { id: uid(), nombre: ins.nombre, unidad: ins.unidad, costo: num(ins.costo), tipo: ins.tipo, cantidad: num(ins.cantidad) || 1, esServicio: !!ins.esServicio, origenCatalogoId: ins.origenCatalogoId || "", consumoPropio: ins.tipo === "tela", categoriaId: ins.categoriaId || "", enlace: { categorias: ((ins.enlace && ins.enlace.categorias) || []).slice(), insumos: ((ins.enlace && ins.enlace.insumos) || []).slice(), mismoTipo: !!(ins.enlace && ins.enlace.mismoTipo) } };
        }));
      }
      if (prod.flujoEstadosId) {
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
    // Compra que es parte de un Recibo de compra: estado, costo, proveedor
    // y excedente los manda el recibo (se corrigen anulándolo). "Cant. real"
    // sí se edita: mueve material y costo entre este pedido y la reserva del
    // recibo (ajustarCantidadMiembro, core/calc.js). Todo queda "sin
    // guardar" hasta Guardar, igual que cualquier otra edición — al guardar,
    // guardarCotizaciones deja al día los movimientos del recibo.
    var cotActual = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
    var compraActual = cotActual ? compraDeLinea(cotActual, clave) : null;
    if (esMiembroRecibo(compraActual) && campo !== "observaciones") {
      if (campo !== "cantidadReal") {
        mostrarToast("Esta compra es parte de un recibo de compra: se corrige desde el recibo (Finanzas → Recibos de compra → Anular y corregir).");
        notify();
        return;
      }
      var ajuste = ajustarCantidadMiembro(compraActual, num(el.value), state.cotizaciones, state.tx);
      state.cotizaciones = state.cotizaciones.map(function (c) {
        if (c.id !== cotId) return c;
        return Object.assign({}, c, { compras: c.compras.map(function (x) { return x.clave === clave ? ajuste.compra : x; }) });
      });
      marcarSucia(cotId);
      var u = ajuste.unidad ? " " + ajuste.unidad : "";
      var avisos = [];
      if (ajuste.tomado.cantidad > 0) avisos.push("✓ Se tomaron " + ajuste.tomado.cantidad + u + " de la reserva del recibo (+" + fmt(ajuste.tomado.costo) + " a este pedido)");
      if (ajuste.devuelto.cantidad > 0) avisos.push("↺ Volvieron " + ajuste.devuelto.cantidad + u + " a la reserva (−" + fmt(ajuste.devuelto.costo) + " de este pedido)");
      if (ajuste.faltante > num(compraActual.faltante)) avisos.push("La reserva no alcanzó: faltan " + ajuste.faltante + u + " — regístralos en un recibo nuevo (Finanzas → Recibos de compra)");
      if (avisos.length) mostrarToast(avisos.join(". ") + ". Se refleja en Finanzas al guardar.");
      return;
    }
    var esNumerico = campo === "cantidadReal" || campo === "costoReal" || campo === "cantidadExcedente";
    var valor = esNumerico ? num(el.value) : el.value;
    // Si esto sube la cantidad real de una compra que vino de "Compras
    // conjuntas" (tiene compartida.grupoId), puede haber reserva compartida
    // de la que tomar — ver tomarDeReservaCompraConjunta más abajo. Se
    // captura ACÁ (dentro del .map de abajo, sobre la cotización que
    // cambia) porque es donde se conoce el valor ANTERIOR de cantidadReal;
    // la toma de la reserva en sí pasa DESPUÉS, una vez que este .map ya
    // dejó la cotización editada al día.
    var incrementoParaReserva = 0, grupoIdParaReserva = null, unidadParaReserva = "";
    var tomadoReservaPropia = 0, unidadReservaPropia = "";
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      var compras = (c.compras || []).slice();
      var idx = -1;
      compras.forEach(function (x, i) { if (x.clave === clave) idx = i; });
      var linea = calcListaCompras(c).filter(function (l) { return l.clave === clave; })[0];
      // Una línea de servicio nace en "servicio" (ver renderFilaCompra): si
      // esta es la primera vez que se toca (no había registro), hay que
      // partir de ese mismo default y no de "no", o el primer clic en
      // "Costo real" la dejaría silenciosamente en "no".
      var estadoInicial = linea && linea.esServicio ? "servicio" : "no";
      var base = idx >= 0 ? compras[idx] : {
        clave: clave, cantidadReal: "", costoReal: "", cantidadExcedente: "", proveedorId: (linea && linea.proveedorId) || "",
        observaciones: "", estado: estadoInicial, txId: "", excedenteTxId: "", fecha: ""
      };
      var patch = {}; patch[campo] = valor;
      if (campo === "estado" && valor !== "no") {
        if (valor === "ahorro") {
          // Por definición no costó nada: se fija en 0 EXPLÍCITO (no un
          // campo vacío — ver calcCotGastosReales en core/calc.js, un 0
          // escrito a propósito sí cuenta como ahorro real, uno nunca
          // escrito no cuenta como nada) en vez de heredar cualquier
          // cantidad/costo que hubiera quedado de un estado anterior.
          patch.costoReal = 0;
          patch.cantidadReal = 0;
          patch.cantidadExcedente = 0;
        } else if (!num(base.costoReal) && linea) {
          // Elegir "Sí" o "Servicio" sin haber escrito el costo real toma
          // el estimado como el valor: es el caso corriente (se
          // produjo/compró por lo que se había presupuestado) y evita
          // tener que teclear el mismo número.
          patch.costoReal = num(linea.costoTotal);
        }
        if (!base.fecha) patch.fecha = todayStr();
      }
      // Al escribir cuánto se compró en total, si es más de lo que este
      // pedido necesitaba se sugiere el excedente solo — pero nunca
      // pisando un valor que el usuario ya haya escrito a mano (ver
      // excedenteYaEscrito): puede ser 0 a propósito (todo se usó en el
      // pedido, ej. por daño/desperdicio, ver conversación con el
      // usuario 2026-09-21) y eso no se debe revertir solo.
      if (campo === "cantidadReal" && linea && !linea.esServicio) {
        var excedenteYaEscrito = base.cantidadExcedente !== "" && base.cantidadExcedente !== undefined && base.cantidadExcedente !== null;
        if (!excedenteYaEscrito) {
          var sugerido = valor - num(linea.cantidadFisica);
          if (sugerido > 0) patch.cantidadExcedente = sugerido;
        } else if (!(base.compartida && base.compartida.grupoId) && base.cantidadReal !== "" && base.cantidadReal !== undefined && base.cantidadReal !== null) {
          // Reposición sobre la RESERVA PROPIA de esta misma compra, sin
          // compartirla con nadie — mismo concepto que la reserva de
          // "Compras conjuntas" (tomarDeReservaCompraConjunta, más abajo),
          // pero sin ninguna otra cotización de por medio: se descuenta
          // directo acá mismo, sin nada async. Reportado por el usuario
          // 2026-09-22: "lo del excedente también debería funcionar...
          // para pedidos individuales... compré de más pero solo es para
          // 1 solo pedido, los demás no comparten el insumo" (caso real:
          // medias). Antes, una vez escrito el excedente una vez, subir
          // cantidadReal de nuevo no lo tocaba más — quedaba "congelado"
          // en vez de consumirse solo, igual que el bug original que
          // motivó tomarDeReservaCompraConjunta para el caso compartido.
          //
          // El chequeo extra de "cantidadReal ya escrita" (raro, pero
          // posible: el detalle de la compra deja tocar el excedente sin
          // haber tocado cantidadReal todavía) evita tratar la PRIMERA
          // escritura de cantidadReal como un "incremento" contra 0 — ese
          // caso ya lo cubre la rama de arriba (!excedenteYaEscrito) o,
          // si el excedente se escribió a mano primero, simplemente no
          // hay ninguna reposición de la que hablar todavía.
          var incrementoPropio = valor - num(base.cantidadReal);
          var reservaPropia = num(base.cantidadExcedente);
          if (incrementoPropio > 0 && reservaPropia > 0) {
            var tomadoAhora = Math.min(incrementoPropio, reservaPropia);
            patch.cantidadExcedente = reservaPropia - tomadoAhora;
            tomadoReservaPropia = tomadoAhora;
            unidadReservaPropia = linea.unidad || "";
          }
        }
        // Reposición sobre un insumo de compra conjunta: si sube por encima
        // de lo que ya tenía, esa diferencia es lo que se intenta cubrir con
        // la reserva compartida (ver el comentario grande más abajo, junto a
        // tomarDeReservaCompraConjunta) — reportado por el usuario
        // 2026-09-21: "si aumento el consumo de tela de pedido1,
        // automáticamente se resta del excedente".
        if (base.compartida && base.compartida.grupoId) {
          var incremento = valor - num(base.cantidadReal);
          if (incremento > 0) { incrementoParaReserva = incremento; grupoIdParaReserva = base.compartida.grupoId; unidadParaReserva = linea.unidad || ""; }
        }
      }
      var actualizada = Object.assign({}, base, patch);
      if (idx >= 0) compras[idx] = actualizada; else compras.push(actualizada);
      return Object.assign({}, c, { compras: compras });
    });
    marcarSucia(cotId);
    if (tomadoReservaPropia > 0) {
      // A diferencia de la reserva compartida, esto es 100% local a la
      // MISMA cotización que ya se acaba de tocar arriba — no hace falta
      // ningún persist() inmediato aparte, sigue el flujo normal de
      // "guardado explícito" (marcarSucia) como cualquier otra edición de
      // esta compra.
      mostrarToast("✓ Se tomaron " + num(tomadoReservaPropia).toFixed(2) + " " + unidadReservaPropia + " de tu propia reserva — no hizo falta comprar de nuevo.");
    }
    if (incrementoParaReserva > 0) {
      var tomado = tomarDeReservaCompraConjunta(grupoIdParaReserva, clave, incrementoParaReserva);
      if (tomado > 0) {
        // A diferencia del resto de este manejador (que solo deja el
        // cambio marcado como "sucio" y espera a "Actualizar movimientos
        // financieros"), acá sí se guarda de inmediato: tomar de la reserva
        // puede tocar el movimiento de OTRA cotización, y dejarlo a medias
        // hasta un guardado manual dejaría esa otra cotización con un
        // excedente desactualizado frente a lo que ya se ve en pantalla.
        persist("cotizaciones"); persist("tx"); notify();
        mostrarToast("✓ Se tomaron " + num(tomado).toFixed(2) + " " + unidadParaReserva + " de la reserva compartida — no hizo falta comprar de nuevo.");
      }
    }
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
    if (estimadoTxDeCot(cot, state.tx)) {
      if (!window.confirm("Este pedido ya tiene su costo ESTIMADO completo registrado como un movimiento en Finanzas.\n\n" +
        "Si además llevas las compras reales, el costo de este pedido va a contarse DOS veces.\n\n" +
        "Lo recomendable es borrar el movimiento del estimado en Finanzas y quedarte solo con las compras reales.\n\n¿Continuar de todos modos?")) return;
    }
    var llevado = llevarComprasAFinanzas(id, { promover: true });
    guardarCotizaciones({ sinLlevarCompras: true }); persist("tx"); notify();
    var partes = partesLlevarCompras(llevado);
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
    if (campo === "tipo" && valor === "servicio_cobrado") {
      moverGlobalAServicio(cotId, gId);
      return;
    }
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
  "set-servicio-cobrado": function (el) {
    var cotId = el.getAttribute("data-cot"), sId = el.getAttribute("data-servicio"), campo = el.getAttribute("data-campo");
    var valor = (campo === "costo" || campo === "precio") ? num(el.value) : el.value;
    // Devolverle un tipo normal lo saca de la lista de servicios: vuelve a
    // ser un costo (global, o un insumo de la referencia que se esté viendo).
    if (campo === "tipo" && valor !== "servicio_cobrado") {
      moverServicioACosto(cotId, sId, valor);
      return;
    }
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, {
        serviciosCobrados: (c.serviciosCobrados || []).map(function (s) {
          if (s.id !== sId) return s;
          var patch = {}; patch[campo] = valor;
          return Object.assign({}, s, patch);
        })
      });
    });
    marcarSucia(cotId);
  },
  "remove-servicio-cobrado": function (el) {
    var cotId = el.getAttribute("data-cot"), sId = el.getAttribute("data-servicio");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, { serviciosCobrados: (c.serviciosCobrados || []).filter(function (s) { return s.id !== sId; }) });
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
      // Si la comisión ya se había pagado ANTES de convertir (desde el
      // propio toggle de la cotización), el tx real que la respalda se
      // re-etiqueta como del PEDIDO nuevo — de acá en adelante la única
      // fuente para pagar/deshacer esa comisión es el pedido
      // (renderCotVendedorCompact deja de mostrar el toggle una vez
      // c.pedidoId existe). Sin este re-etiquetado, "Deshacer el pago"
      // desde el pedido no encontraba el tx (seguía marcado
      // origenComisionCotId, no origenComisionPedidoId) y un segundo pago
      // creaba un SEGUNDO gasto real por la misma comisión — hallazgo
      // confirmado 3 veces en la auditoría financiera 2026-09-20.
      if (nuevoP.vendedor && nuevoP.vendedor.estado === "pagado") {
        state.tx = state.tx.map(function (t) {
          if (t.origenComisionCotId !== id) return t;
          return Object.assign({}, t, { origenComisionCotId: "", origenComisionPedidoId: nuevoP.id, pedidoId: nuevoP.id });
        });
        persist("tx");
      }
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
  // pagada después no duplique el pago en Finanzas. Y, desde la auditoría
  // financiera 2026-09-20, mismo par de arreglos que ya tenía su gemela:
  // (1) si la cotización ya tiene un pedido real detrás, esta acción queda
  // bloqueada — la comisión se gestiona SOLO desde ahí (ver
  // renderCotVendedorCompact, que además deja de mostrar el botón en ese
  // caso: este guardia es la red de seguridad si de todos modos llega a
  // dispararse); (2) pide confirmación con el monto antes de mover plata
  // real — antes esto era una pastilla clicable sin preguntar nada, el
  // mismo patrón ya rechazado hace tiempo en pedidos.js.
  "toggle-comision-cot": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot || !cot.vendedor || !cot.vendedor.nombre) return;
    if (cot.pedidoId) { window.alert("Esta cotización ya tiene un pedido real — paga o deshaz la comisión desde ahí (Pedidos)."); return; }
    var pagando = cot.vendedor.estado !== "pagado";
    var valor = calcComisionValorCot(cot);
    // Escalada desde un pedido que después se canceló: su comisión pendiente
    // ya no se debe (estadoComisionCot, Hallazgo #56). Deshacer sí se puede.
    if (pagando && estadoComisionCot(cot) === "anulada") {
      window.alert("El pedido de esta cotización está cancelado: su comisión pendiente ya no se debe. Si de verdad se va a pagar, reactiva el pedido primero.");
      return;
    }
    // La comisión se debe desde que el cliente acepta (Hallazgo #57).
    if (pagando && estadoComisionCot(cot) === "por-aceptar") {
      window.alert(cotConPedidoEliminado(cot)
        ? "El pedido de esta cotización se eliminó: la comisión no se puede registrar. Restaura el pedido desde la papelera (Pedidos) para poder pagarla."
        : "El cliente todavía no acepta esta cotización: la comisión se debe desde que se convierte en pedido.");
      return;
    }
    if (pagando) {
      if (!window.confirm("¿Marcar como pagada la comisión de " + cot.vendedor.nombre + "?\n\n" +
        "Monto: " + fmt(valor) + "\n\n" +
        "Se registra un gasto de " + fmt(valor) + " en Finanzas (esa plata sale de la caja). Puedes deshacerlo desde esta misma cotización.")) return;
      state.tx.unshift({ id: uid(), tipo: "comision", concepto: "Comisión — " + cot.vendedor.nombre, monto: valor, contraparte: cot.vendedor.nombre, fecha: todayStr(), pedidoId: pedidoIdDeCotParaTx(cot), cotizacionId: cot.id, origenComisionCotId: id });
    } else {
      if (!window.confirm("¿Deshacer el pago de la comisión de " + cot.vendedor.nombre + " (" + fmt(valor) + ")?\n\n" +
        (cotSobrePedidoCancelado(cot)
          ? "Se retira de Finanzas el gasto que se había creado. Como el pedido de esta cotización está CANCELADO, la comisión queda anulada (no pendiente): no se podrá volver a registrar sin reactivar el pedido. Hazlo solo si ese pago nunca ocurrió."
          // Pagada desde un borrador (antes del #57 se podía): al deshacer
          // queda "por aceptar" y no se puede volver a registrar hasta que el
          // cliente acepte. Se dice así (revisión del #57).
          : !cotizacionAceptada(cot)
          ? "Se retira de Finanzas el gasto que se había creado. Como el cliente todavía no acepta esta cotización, la comisión queda POR ACEPTAR: no se podrá volver a registrar hasta que la cotización se convierta en pedido. Hazlo solo si ese pago nunca ocurrió."
          : "Se retira de Finanzas el gasto que se había creado y la comisión vuelve a quedar pendiente de pago."))) return;
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
    // Mismo chequeo de cotizacionId que en sincronizar-compras-finanzas: un
    // estimadoTxId heredado de ANTES de que duplicarCotizacionCompleta lo
    // limpiara podía apuntar al movimiento de OTRA cotización — se trata
    // como si no existiera, y se crea uno nuevo propio en vez de reescribir
    // el ajeno.
    var existente = estimadoTxDeCot(cot, state.tx);
    // Las compras ya llevadas a Finanzas, por CUALQUIERA de las dos vías:
    // compra suelta o parte de un Recibo de compra. Antes se miraba solo
    // `compra.txId`, que en una compra de recibo está vacío — con la tela
    // pagada en un recibo, el aviso de doble conteo no salía (Hallazgo #53).
    var enFinanzas = comprasEnFinanzas(cot, state.tx);
    var yaHayCompras = enFinanzas.costoPedido > 0;
    var avisoCompras = "⚠ Ojo: este pedido ya tiene " + fmt(enFinanzas.costoPedido) + " en compras reales llevadas a Finanzas (sueltas o en un recibo de compra). Si registras también el estimado, el costo de este pedido va a contarse DOS veces en la caja y en el reporte.";

    if (existente) {
      if (!window.confirm("Este pedido ya tiene su costo estimado registrado en Finanzas por " + fmt(existente.monto) + ".\n\n¿Actualizarlo a " + fmt(totales.costoTotal) + "?\n\nSe modifica ese mismo movimiento, no se crea uno nuevo." + (yaHayCompras ? "\n\n" + avisoCompras : ""))) return;
      state.tx = state.tx.map(function (t) {
        return t.id === existente.id ? Object.assign({}, t, { monto: totales.costoTotal, concepto: "Estimado completo del pedido — " + cot.descripcion }) : t;
      });
      persist("tx"); notify();
      mostrarToast("✓ Estimado actualizado a " + fmt(totales.costoTotal) + ".");
      return;
    }

    if (!window.confirm("Se registra en Finanzas un gasto de " + fmt(totales.costoTotal) + " (el costo ESTIMADO de todo el pedido)." +
      (yaHayCompras ? "\n\n" + avisoCompras : "") +
      "\n\n¿Continuar?")) return;
    var txId = uid();
    state.tx.unshift({
      id: txId, tipo: "gasto", concepto: "Estimado completo del pedido — " + cot.descripcion,
      monto: totales.costoTotal, contraparte: cot.cliente, fecha: todayStr(),
      pedidoId: pedidoIdDeCotParaTx(cot), cotizacionId: cot.id
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
    var fila = { id: uid(), nombre: nombreD, talla: val(card, "det-talla-" + refId), numero: val(card, "det-numero-" + refId), tipo: val(card, "det-tipo-" + refId), prendas: val(card, "det-prendas-" + refId), observaciones: val(card, "det-obs-" + refId) };
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
        window.alert("No se encontraron filas válidas en el archivo. Revisa que tenga columnas: nombre, talla, numero, tipo, prendas, observaciones (y que 'nombre' no esté vacío).");
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
      { header: "prendas", key: "prendas", width: 18 },
      { header: "observaciones", key: "observaciones", width: 26 }
    ];
    hoja.getRow(1).eachCell(function (cell) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E1E1E" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
    hoja.addRow({ nombre: "Juan Pérez", talla: "M", numero: "10", tipo: "Jugador", prendas: "Conjunto", observaciones: "" });
    hoja.addRow({ nombre: "María López", talla: "S", numero: "7", tipo: "Arquero", prendas: "Conjunto", observaciones: "Pedido especial" });
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
        // "cot.vendedor" siempre es un objeto no-nulo una vez se toca el
        // panel Vendedor de la cotización (set-cot-vendedor lo rellena con
        // valores por defecto: {nombre:"", ...}) — comparar solo contra
        // "truthy" lo hacía SIEMPRE reemplazar al del pedido, incluso vacío.
        // Como una cotización escalada nace con su propia COPIA del vendedor
        // (ver escalar-a-cotizacion) sin sincronización automática después,
        // asignar el vendedor directo en el PEDIDO (después de escalar) y
        // luego pulsar "Aplicar a pedido" borraba ese vendedor real —
        // incluida su comisión ya marcada "pagada" — con el objeto vacío de
        // la cotización. Ahora solo reemplaza si la cotización de verdad
        // tiene un nombre escrito.
        vendedor: (cot.vendedor && cot.vendedor.nombre) ? Object.assign({}, cot.vendedor) : p.vendedor,
        // Solo pisa la fecha del pedido si la cotización define una — si se
        // dejó vacía al cotizar, se conserva la que el pedido rápido ya tenía
        // en vez de borrársela.
        fechaEntrega: cot.fechaEntrega || p.fechaEntrega || "",
        stockConsumido: (p.stockConsumido || []).concat(stockAplicado)
      });
    });
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: cot.pedidoOrigenId }) : c; });
    // Mismo re-etiquetado que en "convertir-cotizacion": si la comisión de
    // esta cotización escalada ya estaba pagada, su tx pasa a ser del
    // pedido — ver ese comentario para el porqué completo.
    if (cot.vendedor && cot.vendedor.nombre && cot.vendedor.estado === "pagado") {
      state.tx = state.tx.map(function (t) {
        if (t.origenComisionCotId !== id) return t;
        return Object.assign({}, t, { origenComisionCotId: "", origenComisionPedidoId: cot.pedidoOrigenId, pedidoId: cot.pedidoOrigenId });
      });
      persist("tx");
    }
    // Terminado — vuelve al índice; ahí se ve, ya resumida, como "Convertida a pedido".
    // guardarCotizaciones recibe el id: el editor ya se cerró, y sin él las
    // compras "Sí" de esta cotización no se llevaban a Finanzas (revisión
    // del #58).
    state.cotizacionEditando = "";
    state.cotizacionesVista = "historial";
    persist("pedidos"); guardarCotizaciones({ cotId: id }); notify();
  },
  "set-estado-ref-label": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), idx = Number(el.getAttribute("data-idx"));
    mapRef(cotId, refId, function (r) {
      var estados = etapasDe(r).map(function (e) { return Object.assign({}, e); });
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
      var estados = etapasDe(r).map(function (e) { return Object.assign({}, e); });
      estados.push({ id: uid(), label: nombre });
      return Object.assign({}, r, { estadosDef: estados });
    });
  },
  "remove-estado-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), idx = Number(el.getAttribute("data-idx"));
    mapRef(cotId, refId, function (r) {
      var estados = etapasDe(r).map(function (e) { return Object.assign({}, e); });
      if (estados.length <= 1) { window.alert("Debe quedar al menos una etapa en el flujo."); return r; }
      estados.splice(idx, 1);
      return Object.assign({}, r, { estadosDef: estados });
    });
  },
  "mover-estado-ref": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), idx = Number(el.getAttribute("data-idx")), dir = Number(el.getAttribute("data-dir"));
    mapRef(cotId, refId, function (r) {
      var estados = etapasDe(r).map(function (e) { return Object.assign({}, e); });
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
        // De qué referencia salió: el reporte de Productos le atribuye a
        // esta línea las compras de SU referencia (Hallazgo #55).
        refId: ref.id || "",
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
  // Los servicios cobrados se agregan DESPUÉS del reparto, a propósito: no
  // son prendas, así que no les toca nada de los costos globales del pedido.
  // Si entraran antes, el domicilio se repartiría también sobre el diseño y
  // las prendas cargarían de menos.
  (cot.serviciosCobrados || []).forEach(function (s) {
    lineas.push({
      id: uid(), tipo: "libre", productoId: "",
      servicioId: s.id || "", // ver refId arriba: a esta línea van las compras de SU servicio
      productoNombre: s.nombre || "Servicio",
      imagenUrl: "", talla: "", cantidad: 1,
      precioUnitario: num(s.precio), costoUnitario: num(s.costo),
      costoIndirectoUnitario: 0,
      // Lo que hace que el pedido resultante sepa que esta línea no es una
      // prenda: la comisión del vendedor la excluye (ver calcBaseComision).
      esServicioCobrado: true,
      observacion: "", campos: []
    });
  });
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

// pedidoIdDeCotParaTx vive en core/calc.js (también la usan las filas de
// un Recibo de compra) — ver el porqué completo allá.

// Sincroniza las compras de UNA cotización contra Finanzas: por cada línea
// marcada "Sí" crea o actualiza su movimiento de gasto, y por cada línea que
// dejó de estarlo (o cuyo insumo/costo global ya no existe) retira el suyo.
// Es el cuerpo puro de la acción "sincronizar-compras-finanzas" de abajo,
// extraído para que la compra COMPARTIDA entre varios pedidos (ver
// "registrar-compra-conjunta" en modules/finanzas.js) deje a cada uno al día
// en Finanzas con la MISMA lógica exacta, sin reimplementarla aparte — dos
// caminos distintos para "crear el movimiento de una compra" es justo el
// tipo de cosa que se desincroniza sola con el tiempo (ver CONTABILIDAD.md).
//
// Muta `state.tx` directamente (crea/actualiza/retira movimientos) y
// devuelve el nuevo `compras` de la cotización — quien llama decide qué
// hacer con eso (asignarlo a `state.cotizaciones`, persistir, avisar).
export function sincronizarComprasFinanzasDe(cot) {
  var lineas = calcListaCompras(cot);
  var creados = 0, actualizados = 0, borrados = 0, huerfanas = 0;
  var recibosTocados = [];

  // Borra de la caja el movimiento `id` SOLO si es de verdad una compra
  // suelta de ESTA cotización. Un id guardado en una compra apunta hacia
  // afuera: en una cotización duplicada antes del arreglo de
  // duplicarCotizacionCompleta puede ser el movimiento del ORIGINAL, y
  // desde la fase 3 del Recibo ese movimiento pudo pasar a ser la parte o
  // la reserva de un recibo (mismo id). Borrarlo por id a secas sacaba
  // plata real de la caja y descuadraba el recibo del original (Hallazgo
  // #53). Devuelve si borró algo; quien llama limpia el puntero igual,
  // porque un id ajeno nunca es válido.
  function quitarPropio(id) {
    if (!id) return false;
    var antes = state.tx.length;
    state.tx = state.tx.filter(function (t) { return !(t.id === id && t.cotizacionId === cot.id && !t.reciboCompraId); });
    return state.tx.length !== antes;
  }
  // Los movimientos sueltos de ESTA cotización que llevan la marca de esta
  // compra (`campo` = origenCompraClave u origenCompraExcedenteClave),
  // tengan o no el puntero de la compra. Es el MISMO criterio con el que el
  // registro de un recibo detecta "un movimiento viejo" (comprasEnFinanzas):
  // si aquí solo se miraba el puntero, un movimiento que lo perdió (p. ej.
  // un guardado a medias entre Cotizaciones y Movimientos) dejaba el recibo
  // bloqueado para siempre, con un aviso que pedía justo este botón
  // (revisión del Hallazgo #53).
  // Al guardar, esto corre cada vez (Hallazgo #58): "actualizado" cuenta
  // solo un movimiento que de verdad cambió, no cada uno que se revisó. Los
  // números se comparan como números: después de una recarga, un "" vuelve
  // de la Sheet como 0 y no es un cambio.
  function mismoValor(k, a, b) {
    if (k === "monto" || k === "cantidad") return num(a) === num(b);
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function cambiaMovimiento(t, datos) {
    return Object.keys(datos).some(function (k) { return !mismoValor(k, t[k], datos[k]); });
  }
  // Los datos "del papel" de un movimiento (fecha, concepto, persona,
  // cantidad) se pueden corregir a mano en Finanzas, y también cambiar desde
  // la compra. Se decide campo por campo comparando con lo que la compra
  // pedía la ÚLTIMA vez que se sincronizó (compra.txSync):
  //   - si la compra cambió desde entonces, gana la compra (es lo más nuevo);
  //   - si no cambió, se conserva lo que tenga Finanzas — lo haya escrito la
  //     sincronización o lo haya corregido alguien a mano.
  // Sin registro previo (un movimiento viejo o reparado) se conserva lo de
  // Finanzas si tiene algo. Desde que Guardar sincroniza solo (Hallazgo
  // #58), sin esto cualquier guardado deshacía esas correcciones en
  // silencio — y podía pasar un gasto de mes (revisión del #58).
  var PAPEL = ["fecha", "concepto", "contraparte", "cantidad"];
  function aplicarAMovimiento(existente, datos, sync) {
    var final = Object.assign({}, datos);
    PAPEL.forEach(function (k) {
      var lleno = existente[k] !== undefined && existente[k] !== null && existente[k] !== "";
      var cambioEnLaCompra = sync ? !mismoValor(k, datos[k], sync[k]) : false;
      if (lleno && !cambioEnLaCompra) final[k] = existente[k];
    });
    var cambio = cambiaMovimiento(existente, final);
    Object.assign(existente, final);
    return cambio;
  }
  function papelDe(datos) {
    var r = {};
    PAPEL.forEach(function (k) { r[k] = datos[k] === undefined ? "" : datos[k]; });
    return r;
  }
  // Una compra sin fecha propia (p. ej. reconstruida desde su movimiento)
  // toma la de su movimiento, nunca la de hoy: si no, cada día "cambiaba".
  function fechaDeCompra(compra, idMovimiento, marca) {
    if (compra.fecha) return compra.fecha;
    var t = state.tx.filter(function (x) { return x.cotizacionId === cot.id && !x.reciboCompraId && (x.id === idMovimiento || x[marca] === compra.clave); })[0];
    return (t && t.fecha) || todayStr();
  }
  function propiosPorMarca(campo, clave) {
    return state.tx.filter(function (t) { return t.cotizacionId === cot.id && !t.reciboCompraId && t[campo] === clave; });
  }
  function quitarLista(lista) {
    if (!lista.length) return 0;
    var ids = lista.map(function (t) { return t.id; });
    state.tx = state.tx.filter(function (t) { return ids.indexOf(t.id) === -1; });
    return lista.length;
  }

  var compras = (cot.compras || []).map(function (compra) {
    // Una compra que es parte de un Recibo de compra no se sincroniza por
    // acá: sus movimientos los arma el recibo (reconciliarTxRecibo, al
    // final). Se salta ANTES de la limpieza de "global|" de abajo, que
    // borra por id — el recibo nunca deja que una compra suya se borre
    // así, sin pasar su plata a la reserva.
    if (esMiembroRecibo(compra)) {
      compra.partesRecibo.forEach(function (p) {
        if (recibosTocados.indexOf(p.reciboId) === -1) recibosTocados.push(p.reciboId);
      });
      // La plata de una compra de recibo vive en las filas del recibo: un
      // movimiento suelto propio con su marca es plata contada dos veces.
      borrados += quitarLista(propiosPorMarca("origenCompraClave", compra.clave).concat(propiosPorMarca("origenCompraExcedenteClave", compra.clave)));
      return compra;
    }
    var linea = lineas.filter(function (l) { return l.clave === compra.clave; })[0];
    // Sin `linea`, el insumo/referencia/costo global/servicio cobrado que
    // originó esta compra ya no existe en la cotización — pero "no hay
    // línea con esta clave EXACTA" no siempre significa "se borró":
    // solo la clave de un costo global es un id estable ("global|" +
    // g.id, ver calcListaCompras). La de un insumo o una referencia de
    // proveedor se arma con su NOMBRE + unidad/tipo (para poder sumar
    // el mismo insumo repetido en varias referencias) — así que
    // corregir un nombre, una unidad o un tipo (una edición normal, no
    // un borrado) también cambia esa clave. Tratar ESO como huérfana
    // borraba de verdad una compra real y desconectaba su movimiento en
    // Finanzas (quedaba con la insignia "Origen eliminado" sin que nada
    // se hubiera borrado). Pasó de verdad: reportado por el usuario el
    // mismo día que se agregó este chequeo. Auditoría 2026-09-20,
    // corregido el mismo día tras el reporte.
    if (!linea && compra.clave.indexOf("global|") === 0) {
      quitarPropio(compra.txId);
      quitarPropio(compra.excedenteTxId);
      quitarLista(propiosPorMarca("origenCompraClave", compra.clave).concat(propiosPorMarca("origenCompraExcedenteClave", compra.clave)));
      huerfanas++;
      return null;
    }
    if (!linea) return compra; // insumo/producto: clave inestable ante una edición, no se toca
    var nombre = linea.nombre;
    var esCompraSi = estadoCompra(compra) === "si";
    var proveedor = compra.proveedorId ? clienteById(compra.proveedorId) : null;
    var resultado = compra;

    // --- Costo que le corresponde al PEDIDO (neto, sin el excedente) ---
    // Solo "Sí" (pagado de verdad, aparte) genera un movimiento en
    // Finanzas. "Servicio" (mano de obra propia, va a nómina) y "No" no
    // deberían: si esta línea tenía un movimiento de un estado anterior
    // (ej. se cambió de "Sí" a "Servicio"), se retira.
    var monto = esCompraSi ? costoRealPedido(compra) : 0;
    if (!esCompraSi || monto <= 0) {
      if (resultado.txId) {
        if (quitarPropio(resultado.txId)) borrados++;
        resultado = Object.assign({}, resultado, { txId: "" });
      }
      borrados += quitarLista(propiosPorMarca("origenCompraClave", compra.clave));
    } else {
      var datos = {
        tipo: "gasto",
        concepto: "Compra — " + nombre + " — " + cot.descripcion,
        monto: monto,
        contraparte: proveedor ? proveedor.nombre : "",
        fecha: fechaDeCompra(compra, resultado.txId, "origenCompraClave"),
        pedidoId: pedidoIdDeCotParaTx(cot),
        cotizacionId: cot.id,
        // Una compra de la lista es, por definición, insumo/material del
        // pedido — de acá sale el desglose "Gasto en insumos" del reporte.
        esInsumo: "1",
        proveedorId: compra.proveedorId || "",
        insumoNombre: nombre,
        cantidad: compra.cantidadReal !== "" && compra.cantidadReal !== undefined ? cantidadRealPedido(compra) : (!linea.esServicio ? num(linea.cantidadFisica) : ""),
        unidad: linea.unidad || "",
        // Marca de origen: es lo que permite reconocer "este movimiento lo
        // generó esta línea de compra" al volver a sincronizar.
        origenCompraClave: compra.clave
      };
      // El chequeo de cotizacionId es a propósito, no redundante: una
      // cotización duplicada ANTES de este fix pudo quedar con un txId
      // heredado del original (ver duplicarCotizacionCompleta) — sin esto,
      // "sincronizar" desde el duplicado encontraba el tx del original (por
      // id) y lo reescribía en vez de crear uno nuevo, dejando al original
      // sin su propio movimiento. Un txId que apunta a un tx de OTRA
      // cotización se trata como si no existiera: se crea uno nuevo, propio.
      // Primero el del puntero; si no sirve, uno propio con la marca (se
      // adopta en vez de crear otro); cualquier otro con la marca sobra.
      var marcados = propiosPorMarca("origenCompraClave", compra.clave);
      var existente = (resultado.txId ? state.tx.filter(function (t) { return t.id === resultado.txId && t.cotizacionId === cot.id && !t.reciboCompraId; })[0] : null) || marcados[0] || null;
      borrados += quitarLista(marcados.filter(function (t) { return t !== existente; }));
      if (existente) {
        if (aplicarAMovimiento(existente, datos, resultado.txSync)) actualizados++;
        resultado = Object.assign({}, resultado, { txId: existente.id, txSync: papelDe(datos) });
      } else {
        var txId = uid();
        state.tx.unshift(Object.assign({ id: txId }, datos));
        creados++;
        resultado = Object.assign({}, resultado, { txId: txId, txSync: papelDe(datos) });
      }
    }

    // --- Excedente: lo comprado de más, separado como compra de insumo
    // aparte (ver cantidadExcedenteCompra en core/calc.js) — su PROPIO
    // movimiento en Finanzas, independiente del de arriba, para que no
    // cuente como costo ni sobrecosto de este pedido. Solo aplica a una
    // compra "Sí" real de algo con cantidad física (un servicio no se
    // compra por cantidad). Se evalúa aparte del bloque de arriba a
    // propósito: si TODO lo comprado resultó excedente (monto del pedido
    // en 0), igual hay que registrar el excedente completo.
    //
    // SIN pedidoId a propósito (2026-09-21): el excedente no es "de este
    // pedido" — es una reserva que puede terminar usando OTRO pedido más
    // adelante (ver calcReservaCompraConjunta/tomarDeReservaCompraConjunta
    // en core/calc.js), así que no tiene sentido mostrarlo agrupado bajo
    // ninguno en particular. Sin pedidoId, cae solo en "Movimientos sueltos
    // (sin pedido)" (ver renderHistorial, modules/finanzas.js) — sección que
    // YA existía, no hizo falta crear una vista nueva. cotizacionId/
    // origenCompraExcedenteClave siguen intactos: son los que usan "Ver
    // origen" y la protección de borrado (movimientosGeneradosPorCotizacion,
    // core/calc.js), y ningún reporte agregado de "Gasto en insumos"
    // depende de pedidoId (filtran por esInsumo/tipo/fecha, no por pedido).
    var costoExc = (esCompraSi && !linea.esServicio) ? costoExcedenteCompra(compra) : 0;
    if (costoExc > 0) {
      var datosExc = {
        tipo: "gasto",
        concepto: "Compra de insumo (excedente) — " + nombre + " — " + cot.descripcion,
        monto: costoExc,
        contraparte: proveedor ? proveedor.nombre : "",
        fecha: fechaDeCompra(compra, resultado.excedenteTxId, "origenCompraExcedenteClave"),
        pedidoId: "",
        cotizacionId: cot.id,
        esInsumo: "1",
        proveedorId: compra.proveedorId || "",
        insumoNombre: nombre,
        cantidad: cantidadExcedenteCompra(compra),
        unidad: linea.unidad || "",
        origenCompraExcedenteClave: compra.clave
      };
      var marcadosExc = propiosPorMarca("origenCompraExcedenteClave", compra.clave);
      var existenteExc = (resultado.excedenteTxId ? state.tx.filter(function (t) { return t.id === resultado.excedenteTxId && t.cotizacionId === cot.id && !t.reciboCompraId; })[0] : null) || marcadosExc[0] || null;
      borrados += quitarLista(marcadosExc.filter(function (t) { return t !== existenteExc; }));
      if (existenteExc) {
        if (aplicarAMovimiento(existenteExc, datosExc, resultado.excedenteTxSync)) actualizados++;
        resultado = Object.assign({}, resultado, { excedenteTxId: existenteExc.id, excedenteTxSync: papelDe(datosExc) });
      } else {
        var excId = uid();
        state.tx.unshift(Object.assign({ id: excId }, datosExc));
        creados++;
        resultado = Object.assign({}, resultado, { excedenteTxId: excId, excedenteTxSync: papelDe(datosExc) });
      }
    } else {
      if (resultado.excedenteTxId) {
        if (quitarPropio(resultado.excedenteTxId)) borrados++;
        resultado = Object.assign({}, resultado, { excedenteTxId: "" });
      }
      borrados += quitarLista(propiosPorMarca("origenCompraExcedenteClave", compra.clave));
    }

    return resultado;
  }).filter(Boolean); // las huérfanas devuelven null arriba: se descartan de cot.compras

  // Recibos de esta cotización: sus filas se reconcilian contra la versión
  // de la cotización que se está sincronizando (puede no estar todavía en
  // state.cotizaciones) — ej. si cambió su descripción o su pedido.
  if (recibosTocados.length) {
    var cotizacionesVista = state.cotizaciones.map(function (c) {
      return c.id === cot.id ? Object.assign({}, cot, { compras: compras }) : c;
    });
    recibosTocados.forEach(function (reciboId) {
      var rec = reconciliarTxRecibo(state.tx, reciboId, cotizacionesVista);
      state.tx = rec.tx;
      creados += rec.creadas; actualizados += rec.actualizadas; borrados += rec.borradas;
    });
  }

  return { compras: compras, creados: creados, actualizados: actualizados, borrados: borrados, huerfanas: huerfanas };
}

// Envoltorio de TODA acción que toca un Recibo de compra: toma una foto de
// la plata, corre la acción, y solo guarda si cada recibo tocado cuadra al
// peso (verificarRecibo) Y la caja se movió exactamente lo esperado. Si no,
// restaura la foto y no guarda nada — criterio bancario: nada descuadrado
// llega a la Sheet.
// opts: { recibos: [ids] | function () -> [ids] (si la acción crea el id),
//         deltaCaja: número exacto esperado (ej. -total al registrar),
//         permitirCotSucia: true solo para "Guardar" de la propia cotización }
// Devuelve true si guardó.
export function ejecutarAccionRecibo(opts, fn) {
  var sucia = state.cotSucia ? state.cotizaciones.filter(function (c) { return c.id === state.cotSucia; })[0] : null;
  if (sucia && !opts.permitirCotSucia) {
    // Guardar ahora arrastraría también sus cambios sin confirmar (se
    // guarda la clave "cotizaciones" entera). Una marca "sin guardar" que
    // apunta a una cotización que ya no existe no frena nada: no hay
    // cambios de nadie que arrastrar.
    window.alert("Primero guarda o descarta los cambios de la cotización \"" + (sucia.descripcion || sucia.cliente || "abierta") + "\".");
    return false;
  }
  var foto = {
    tx: JSON.stringify(state.tx),
    cotizaciones: JSON.stringify(state.cotizaciones),
    txPapelera: JSON.stringify(state.txPapelera || [])
  };
  var cajaAntes = calcCaja();
  var problemas = [];
  try {
    fn();
    var ids = typeof opts.recibos === "function" ? opts.recibos() : (opts.recibos || []);
    ids.forEach(function (id) {
      verificarRecibo(id, state.cotizaciones, state.tx).forEach(function (p) { problemas.push(p); });
    });
    var delta = calcCaja() - cajaAntes;
    if (Math.abs(delta - num(opts.deltaCaja)) > 0.005) {
      problemas.push("La caja se movería " + fmt(delta) + " y se esperaba " + fmt(num(opts.deltaCaja)) + ".");
    }
  } catch (e) {
    console.error(e);
    problemas.push("Error inesperado: " + (e && e.message ? e.message : e));
  }
  if (problemas.length) {
    state.tx = JSON.parse(foto.tx);
    state.cotizaciones = JSON.parse(foto.cotizaciones);
    state.txPapelera = JSON.parse(foto.txPapelera);
    console.error("Recibo de compra — no se guardó nada:", problemas);
    window.alert("No se guardó nada: " + problemas[0]);
    return false;
  }
  persist("cotizaciones");
  persist("tx");
  if (JSON.stringify(state.txPapelera || []) !== foto.txPapelera) persist("txPapelera");
  return true;
}

// Los recibos en los que participa una cotización (sin repetir).
export function idsRecibosDeCot(cot) {
  var ids = [];
  ((cot && cot.compras) || []).forEach(function (compra) {
    (compra.partesRecibo || []).forEach(function (p) { if (ids.indexOf(p.reciboId) === -1) ids.push(p.reciboId); });
  });
  return ids;
}

function cotDePedido(pedido) {
  if (!pedido) return null;
  return state.cotizaciones.filter(function (c) { return c.id === pedido.cotizacionId; })[0] || null;
}

// Cuánto de sus recibos tiene un pedido (para avisar antes de eliminarlo).
export function resumenRecibosDePedido(pedido) {
  var cot = cotDePedido(pedido);
  var ids = idsRecibosDeCot(cot);
  var monto = 0;
  ((cot && cot.compras) || []).forEach(function (compra) {
    (compra.partesRecibo || []).forEach(function (p) { monto += Math.round(num(p.costo)); });
  });
  return { recibos: ids.length, monto: monto };
}

// Eliminar un pedido (no debió existir) devuelve su parte de cada recibo a
// la reserva: esa plata ya se pagó al proveedor, no sale de la caja. Corre
// ANTES de quitar el pedido: si no se puede (ej. hay una cotización con
// cambios sin guardar), el pedido no se elimina. Devuelve true si siguió.
export function devolverRecibosAlEliminarPedido(pedido) {
  var cot = cotDePedido(pedido);
  var ids = idsRecibosDeCot(cot);
  if (!ids.length) return true;
  return ejecutarAccionRecibo({ recibos: ids, deltaCaja: 0 }, function () {
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === cot.id ? devolverPartesPorEliminar(c, pedido.id) : c; });
    ids.forEach(function (rid) { state.tx = reconciliarTxRecibo(state.tx, rid, state.cotizaciones).tx; });
  });
}

// Restaurar ese pedido vuelve a tomar su parte — hasta donde la reserva
// todavía alcance. Devuelve { ok, faltantes } para avisar lo que faltó.
export function retomarRecibosAlRestaurarPedido(pedido) {
  var cot = cotDePedido(pedido);
  var ids = idsRecibosDeCot(cot);
  var faltantes = [];
  if (!ids.length) return { ok: true, faltantes: faltantes };
  var ok = ejecutarAccionRecibo({ recibos: ids, deltaCaja: 0 }, function () {
    var res = retomarPartesPorRestaurar(cot, pedido.id, state.cotizaciones, state.tx);
    faltantes = res.faltantes;
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === cot.id ? res.cot : c; });
    ids.forEach(function (rid) { state.tx = reconciliarTxRecibo(state.tx, rid, state.cotizaciones).tx; });
  });
  return { ok: ok, faltantes: faltantes };
}

// Toma `cantidadNecesaria` de la reserva compartida de excedente de una
// compra conjunta (ver calcReservaCompraConjunta en core/calc.js) —
// reportado por el usuario 2026-09-21: si un pedido participante necesita
// más insumo del que se le calculó (ej. una reposición), en vez de comprarlo
// otra vez se descuenta de lo que ya se compró de más. Puede tocar la compra
// de OTRA cotización (quien terminó "quedándose" con la reserva al repartir
// no tiene por qué ser quien la necesite después) — por eso recorre
// `state.cotizaciones` entero, no solo la que llamó. Devuelve cuánto de
// verdad se pudo tomar (puede ser menos de lo pedido si la reserva no
// alcanza — el resto sigue el camino de siempre, sin caso especial).
//
// Límite conocido, a propósito no resuelto: solo se ajusta
// `cantidadExcedente` del tenedor, no su `costoReal` — como
// costoRealPedido = costoReal − costoExcedenteCompra(compra), al bajarle la
// reserva a un tenedor su PROPIO costo atribuido sube un poco (matemática
// pura del mismo cálculo, ver core/calc.js). La plata total en Finanzas NO
// cambia (nadie gasta de más, el tx de excedente simplemente encoge) — solo
// puede quedar atribuida al pedido que tenía la reserva en vez de al que la
// usó, si son cotizaciones distintas. Documentado en CONTABILIDAD.md.
function tomarDeReservaCompraConjunta(grupoId, clave, cantidadNecesaria) {
  var reserva = calcReservaCompraConjunta(grupoId, clave);
  var porTomar = Math.min(cantidadNecesaria, reserva.disponible);
  if (porTomar <= 0) return 0;
  var restante = porTomar;
  var porCotizacion = {};
  reserva.tenedores.forEach(function (t) {
    if (restante <= 0) return;
    var deEste = Math.min(restante, t.disponible);
    restante -= deEste;
    porCotizacion[t.cotId] = (porCotizacion[t.cotId] || 0) + deEste;
  });
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (!porCotizacion[c.id]) return c;
    var compras = (c.compras || []).map(function (compra) {
      if (compra.clave !== clave || !compra.compartida || compra.compartida.grupoId !== grupoId) return compra;
      var nuevoExcedente = Math.max(0, num(compra.cantidadExcedente) - porCotizacion[c.id]);
      return Object.assign({}, compra, { cantidadExcedente: nuevoExcedente });
    });
    var sinc = sincronizarComprasFinanzasDe(Object.assign({}, c, { compras: compras }));
    return Object.assign({}, c, { compras: sinc.compras });
  });
  return porTomar;
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
// Lleva a Finanzas las compras de una cotización: cada compra "Sí" con su
// movimiento de gasto, retira el de las que ya no lo están, y convierte en
// recibo lo comprado de más para un solo pedido (caso "medias", Hallazgo
// #52). Es lo que hacía el botón "Actualizar movimientos financieros"; desde
// el Hallazgo #58 también corre solo al Guardar la cotización. Idempotente:
// nunca duplica. Devuelve { r, promocion } o null.
//
// `opts.promover`: convertir en recibo lo comprado de más (caso "medias").
// Solo lo hace el botón (y la carga de la app, fase 3); el guardado
// automático NO: convertir en cada Guardar volvía recibo hasta un excedente
// de redondeo, y una compra de recibo ya no se corrige desde la cotización
// — un costo mal tecleado quedaba sin arreglo inmediato (revisión del #58).
function llevarComprasAFinanzas(id, opts) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
  if (!cot) return null;
  var r = sincronizarComprasFinanzasDe(cot);
  state.cotizaciones = state.cotizaciones.map(function (c) {
    return c.id === id ? Object.assign({}, c, { compras: r.compras }) : c;
  });
  // Caso "medias" (decisión del usuario 2026-09-23): lo que se compró de
  // más para UN pedido pasa en el acto a ser un recibo de compra de 1
  // pedido — su excedente queda como la reserva de ese recibo, el mismo
  // mecanismo que una compra para varios pedidos (Hallazgo #52, fase 3).
  // Misma conversión verificada al peso que corre al cargar la app.
  var promocion = { convertidos: [], saltados: [] };
  if (opts && opts.promover) {
    promocion = migrarComprasARecibos(state.tx, state.cotizaciones, { soloCotId: id });
    if (promocion.convertidos.length) {
      state.tx = promocion.tx;
      state.cotizaciones = promocion.cotizaciones;
    }
  }
  return { r: r, promocion: promocion };
}
function partesLlevarCompras(llevado) {
  var partes = [];
  if (!llevado) return partes;
  var r = llevado.r, promocion = llevado.promocion;
  if (promocion.convertidos.length) partes.push(promocion.convertidos.length + " compra(s) con excedente pasaron a ser recibo de compra (lo que sobró queda como su reserva)");
  if (promocion.saltados.length) partes.push("no se pudo pasar a recibo: " + promocion.saltados[0].motivo);
  if (r.creados) partes.push(r.creados + " movimiento(s) creado(s)");
  if (r.actualizados) partes.push(r.actualizados + " actualizado(s)");
  if (r.borrados) partes.push(r.borrados + " retirado(s)");
  if (r.huerfanas) partes.push(r.huerfanas + " compra(s) vieja(s) limpiada(s) (su insumo/línea ya no existe)");
  return partes;
}
// Las compras de una cotización cuya plata en Finanzas no coincide con lo
// que dicen: una "Sí" sin su movimiento o con otro monto, o una que dejó de
// ser "Sí" y conserva el suyo. Las de un recibo siempre coinciden (las arma
// el recibo). Solo compras con su línea viva: la sincronización no toca
// las demás, y prometer que se arreglan al guardar sería mentir.
function comprasDesfasadasConFinanzas(cot) {
  var lineas = calcListaCompras(cot);
  return ((cot && cot.compras) || []).filter(function (c) {
    if (esMiembroRecibo(c)) return false;
    if (!lineas.some(function (l) { return l.clave === c.clave; })) return false;
    var esperado = estadoCompra(c) === "si" ? costoRealPedido(c) : 0;
    return Math.abs(comprasEnFinanzas(cot, state.tx, c.clave).costoPedido - esperado) >= 0.5;
  });
}

// Guarda de verdad y vuelve a dejar la cotización "limpia". Cualquier acción
// transaccional la llama, así que después de registrar un costo real o pagar
// una comisión no queda un aviso de "sin guardar" colgado por cambios que ya
// se guardaron.
function guardarCotizaciones(opts) {
  // Si la cotización abierta está en algún Recibo de compra, sus
  // movimientos se dejan al día en el mismo acto (ej. tomó de la reserva:
  // su parte sube, la reserva baja — la caja no cambia). Si algo no
  // cuadrara al peso, ejecutarAccionRecibo no guarda NADA y avisa: la
  // cotización sigue "sin guardar" para poder descartarla.
  // `opts.cotId`: la cotización a cerrar cuando el editor ya no la tiene
  // abierta (ej. "Aplicar a pedido").
  var idAbierta = (opts && opts.cotId) || state.cotizacionEditando;
  var cotAbierta = idAbierta ? state.cotizaciones.filter(function (c) { return c.id === idAbierta; })[0] : null;
  var recibosAbierta = idsRecibosDeCot(cotAbierta);
  if (recibosAbierta.length) {
    var okRecibos = ejecutarAccionRecibo({ recibos: recibosAbierta, deltaCaja: 0, permitirCotSucia: true }, function () {
      recibosAbierta.forEach(function (rid) { state.tx = reconciliarTxRecibo(state.tx, rid, state.cotizaciones).tx; });
    });
    if (!okRecibos) return;
  }
  // Las compras marcadas "Sí" van a Finanzas solas al guardar (decisión del
  // dueño 2026-09-25, Hallazgo #58). Antes solo iban al pulsar
  // "Actualizar movimientos financieros": mientras tanto Compras del pedido
  // decía "pagado $X" y el reporte ya contaba ese costo, pero la Caja, el
  // Balance y la Ganancia todavía no — y nada lo avisaba. Si el pedido tiene
  // su costo ESTIMADO completo registrado, no se llevan (contaría el costo
  // dos veces): se avisa y se deja en manos del botón, que sí pregunta.
  var avisos = [];
  if (cotAbierta && !(opts && opts.sinLlevarCompras)) {
    if (estimadoTxDeCot(cotAbierta, state.tx)) {
      var pendientes = comprasDesfasadasConFinanzas(cotAbierta);
      if (pendientes.length) avisos.push("⚠ " + pendientes.length + " compra(s) no coinciden con Finanzas y no se actualizaron: este pedido tiene su costo estimado completo registrado. Bórralo en Finanzas, o usa \"Actualizar movimientos financieros\".");
    } else {
      var llevado = llevarComprasAFinanzas(cotAbierta.id);
      var partesLlevado = partesLlevarCompras(llevado);
      if (partesLlevado.length) { persist("tx"); avisos.push("✓ Finanzas al día: " + partesLlevado.join(", ") + "."); }
    }
  }
  persist("cotizaciones");
  state.cotSucia = "";
  tomarSnapshotCotizacion(); // el nuevo punto de retorno es lo recién guardado
  // Si esta cotización ya es un pedido, sus números bajan al pedido en el
  // mismo acto de guardar. Antes el pedido era una foto del momento de
  // convertir: cambiar una cantidad o agregar una referencia después dejaba al
  // pedido —y a todos los reportes, que leen de él— contando lo viejo, sin
  // ningún aviso. Guardar es el momento deliberado para propagarlo (editar no
  // escribe nada hasta que se confirma, ver marcarSucia).
  var id = idAbierta;
  var cot = id ? state.cotizaciones.filter(function (c) { return c.id === id; })[0] : null;
  if (cot) {
    var aplicado = sincronizarPedidoDeCotizacion(cot);
    if (aplicado) {
      avisos.push("✓ El pedido " + (aplicado.pedido.numeroOp || "") + " se actualizó con estos cambios: " +
        aplicado.cantidadCot + " unidad(es) por " + fmt(aplicado.totalCot) + ".");
    }
  }
  if (avisos.length) mostrarToast(avisos.join(" "));
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
// global se paga una vez, no por prenda. `esServicio` también se conserva en
// esta y las otras 4 funciones "mover*" de más abajo: si el insumo era
// servicio por vivir en una categoría marcada así (ver esInsumoServicio en
// core/calc.js), esa marca no se puede recalcular después —ni un costo
// global ni un servicio cobrado guardan categoriaId— así que si no se copia
// acá se pierde en silencio la primera vez que alguien cambia el "Tipo de
// costo" de la fila.
// Reordena los insumos de UNA referencia tras arrastrar y soltar con
// SortableJS (ver bindEvents en core/dom.js, que llama acá con el orden final
// de ids leído directo del DOM tras soltar). Puro cambio de orden visual — no
// toca costos, cantidades ni nada que afecte un cálculo — así que igual pasa
// por "guardado explícito" como cualquier otra edición de la cotización (ver
// marcarSucia): el usuario puede reordenar y arrepentirse con "Descartar"
// antes de confirmar.
export function reordenarInsumos(cotId, refId, nuevoOrdenIds) {
  var huboCambio = false;
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    return Object.assign({}, c, {
      referencias: (c.referencias || []).map(function (r) {
        if (r.id !== refId) return r;
        var actuales = r.insumos || [];
        var porId = {};
        actuales.forEach(function (i) { porId[i.id] = i; });
        var reordenado = nuevoOrdenIds.map(function (id) { return porId[id]; }).filter(Boolean);
        // Cualquier insumo que no vino en `nuevoOrdenIds` (no debería pasar,
        // pero por seguridad — ej. un id repetido o desconocido) se agrega al
        // final en vez de perderse.
        actuales.forEach(function (i) { if (reordenado.indexOf(i) === -1) reordenado.push(i); });
        if (reordenado.length !== actuales.length) return r; // algo no calzó: se deja tal cual, sin arriesgar perder un insumo
        huboCambio = true;
        return Object.assign({}, r, { insumos: reordenado });
      })
    });
  });
  if (!huboCambio) return;
  // El orden de los insumos es puramente visual — no cambia ningún costo,
  // cantidad ni total de la cotización. El usuario lo pidió explícito: no
  // tiene sentido interrumpir con el dock de "sin guardar" por algo que no
  // afecta la cotización de ninguna forma, así que esto se guarda solo.
  // ÚNICA excepción: si esta misma cotización YA tenía otra edición sin
  // confirmar (cotSucia === cotId) — ahí NO se auto-guarda nada, porque
  // guardar ahora arrastraría también esa otra edición sin que el usuario la
  // haya confirmado con "Guardar".
  if (state.cotSucia === cotId) {
    notify();
    return;
  }
  persist("cotizaciones");
  tomarSnapshotCotizacion(); // el nuevo punto de retorno de "Descartar" ya incluye este orden
  notify();
}

// Aplica un cambio (actualizar al costo del catálogo, o marcarlo
// descartado) a un costo global o un servicio cobrado que vino del
// catálogo — los dos únicos lugares, aparte de un insumo de referencia,
// donde puede vivir un `origenCatalogoId` (ver moverInsumoAGlobal/
// moverInsumoAServicio abajo). `patchFn(linea, actual)` recibe la línea
// actual y el insumo vigente del catálogo, y devuelve la línea ya
// parchada — así "actualizar" y "descartar" (arriba, en `actions`)
// comparten toda la búsqueda y solo difieren en el parche.
function aplicarCambioCatalogoFueraDeReferencia(cotId, insId, patchFn) {
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    var enGlobales = (c.costosGlobales || []).some(function (g) { return g.id === insId; });
    var enServicios = !enGlobales && (c.serviciosCobrados || []).some(function (s) { return s.id === insId; });
    if (!enGlobales && !enServicios) return c;
    var patch = {};
    if (enGlobales) {
      patch.costosGlobales = c.costosGlobales.map(function (g) {
        if (g.id !== insId) return g;
        var actual = (state.catalogoInsumos || []).filter(function (i) { return i.id === g.origenCatalogoId; })[0];
        return actual ? patchFn(g, actual) : g;
      });
    } else {
      patch.serviciosCobrados = c.serviciosCobrados.map(function (s) {
        if (s.id !== insId) return s;
        var actual = (state.catalogoInsumos || []).filter(function (i) { return i.id === s.origenCatalogoId; })[0];
        return actual ? patchFn(s, actual) : s;
      });
    }
    return Object.assign({}, c, patch);
  });
  marcarSucia(cotId);
}

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
        costo: num(insumo.costo), proveedorId: insumo.proveedorId || "",
        origenCatalogoId: insumo.origenCatalogoId || "", esServicio: !!insumo.esServicio
      }])
    });
  });
  mostrarToast('"' + (insumo.nombre || "El costo") + '" pasó a ser global: ahora aparece al final de todas las referencias y se reparte entre todas las prendas del pedido.');
  marcarSucia(cotId);
}

// Un insumo pasa a ser un servicio que se le cobra al cliente. Conserva lo
// que costaba (eso no cambia: sigue siendo lo que hay que pagarle a quien lo
// hace) y nace con precio 0 — el precio es una decisión aparte, y arrancarlo
// en 0 obliga a ponerlo a conciencia en vez de heredar un número que no
// significaba lo mismo.
function moverInsumoAServicio(cotId, refId, insId) {
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
      serviciosCobrados: (c.serviciosCobrados || []).concat([{
        id: insumo.id, nombre: insumo.nombre, unidad: insumo.unidad || "",
        costo: num(insumo.costo), precio: 0, proveedorId: insumo.proveedorId || "",
        origenCatalogoId: insumo.origenCatalogoId || "", esServicio: !!insumo.esServicio
      }])
    });
  });
  mostrarToast('"' + (insumo.nombre || "El costo") + '" ahora se cobra aparte: ponle cuánto le cobras al cliente y saldrá como su propia línea en la cotización.');
  marcarSucia(cotId);
}

// Un costo global pasa a cobrarse aparte. Es el caso del diseño cuando se
// deja de absorber dentro del precio de las prendas y se empieza a facturar.
function moverGlobalAServicio(cotId, gId) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  var global = cot && (cot.costosGlobales || []).filter(function (g) { return g.id === gId; })[0];
  if (!global) return;
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    return Object.assign({}, c, {
      costosGlobales: (c.costosGlobales || []).filter(function (g) { return g.id !== gId; }),
      serviciosCobrados: (c.serviciosCobrados || []).concat([{
        id: global.id, nombre: global.nombre, unidad: global.unidad || "",
        costo: num(global.costo), precio: 0, proveedorId: global.proveedorId || "",
        origenCatalogoId: global.origenCatalogoId || "", esServicio: !!global.esServicio
      }])
    });
  });
  mostrarToast('"' + (global.nombre || "El costo") + '" dejó de repartirse entre las prendas y ahora se cobra aparte. Ponle cuánto le cobras al cliente.');
  marcarSucia(cotId);
}

// El camino de vuelta de un servicio cobrado: vuelve a ser un costo. Si se
// elige "global" se va a la lista global; con cualquier otro tipo baja como
// insumo de la referencia que se esté viendo. El precio se descarta: como
// costo ya no hay nada que cobrar aparte.
function moverServicioACosto(cotId, sId, tipo) {
  var cot = state.cotizaciones.filter(function (c) { return c.id === cotId; })[0];
  var serv = cot && (cot.serviciosCobrados || []).filter(function (s) { return s.id === sId; })[0];
  if (!serv) return;
  var destino = null;
  if (tipo !== "global") {
    var refs = cot.referencias || [];
    if (!refs.length) { window.alert("No hay ninguna referencia a la que devolverlo. Crea una primero, o déjalo como costo global del pedido."); return; }
    destino = refs.filter(function (r) { return r.id === state.refActiva[cotId]; })[0] || refs[0];
  }
  state.cotizaciones = state.cotizaciones.map(function (c) {
    if (c.id !== cotId) return c;
    var base = Object.assign({}, c, {
      serviciosCobrados: (c.serviciosCobrados || []).filter(function (s) { return s.id !== sId; })
    });
    if (tipo === "global") {
      base.costosGlobales = (c.costosGlobales || []).concat([{
        id: serv.id, nombre: serv.nombre, unidad: serv.unidad || "",
        costo: num(serv.costo), proveedorId: serv.proveedorId || "",
        origenCatalogoId: serv.origenCatalogoId || "", esServicio: !!serv.esServicio
      }]);
      return base;
    }
    base.referencias = (c.referencias || []).map(function (r) {
      if (r.id !== destino.id) return r;
      return Object.assign({}, r, {
        insumos: (r.insumos || []).concat([{
          id: serv.id, nombre: serv.nombre, unidad: serv.unidad || "UND",
          costo: num(serv.costo), tipo: tipo, cantidad: 1, proveedorId: serv.proveedorId || "",
          origenCatalogoId: serv.origenCatalogoId || "", esServicio: !!serv.esServicio
        }])
      });
    });
    return base;
  });
  mostrarToast('"' + (serv.nombre || "El servicio") + '" volvió a ser un costo: ya no se le cobra aparte al cliente.');
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
            costo: num(global.costo), tipo: tipo, cantidad: 1, proveedorId: global.proveedorId || "",
            origenCatalogoId: global.origenCatalogoId || "", esServicio: !!global.esServicio
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
