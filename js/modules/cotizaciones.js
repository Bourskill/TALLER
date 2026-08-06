import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, fmt, generarNumeroOp, parseDetalleCSV, parseDetalleFilas, codigoPublico } from "../core/utils.js";
import { calcCotizacionTotales, calcRefTotales, calcCostoPrenda, calcCotResultadoReal, calcListaCompras, calcCotGastoVariacion, calcCotGastoEstimadoBase, calcComisionValorCot, clienteById, estadoAgregadoDeCot, productoById, validarStockLineas } from "../core/calc.js";
import { renderClienteCombo, renderTipoCostoOptions, renderHelp } from "../core/components.js";
import { generarPDFCotizacion, generarPDFInternoCotizacion } from "../core/pdf.js";
import { subirImagenReferencia } from "../core/drive.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { todosNumerosOp } from "./pedidos.js";
import { ESTADOS_DEFAULT } from "../core/constants.js";
import { ajustarStockProducto } from "../core/stock.js";

function nuevaReferencia() {
  return { id: uid(), nombre: "", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 0, insumos: [], detalle: [] };
}
function nuevoInsumo(fuente) {
  return {
    id: uid(),
    nombre: fuente ? fuente.nombre : "",
    unidad: fuente ? fuente.unidad : "UND",
    costo: fuente ? num(fuente.costo) : 0,
    tipo: fuente ? fuente.tipo : "por_prenda",
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
  html += renderCotCard(cot);
  return html;
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
  var html = '<div class="cot-head">' +
    '<div class="cot-head-info">' +
    '<div class="cot-head-top">' +
    '<input class="cot-cliente-input" value="' + esc(c.cliente) + '" placeholder="Nombre del cliente" data-action-change="set-cot-cliente" data-id="' + c.id + '" title="Editar el nombre del cliente" />' +
    '<span class="badge ' + c.estado + '">' + (c.estado === "convertida" ? "Convertida a pedido" : "Borrador") + "</span>" +
    "</div>" +
    (c.descripcion ? '<div class="cot-descripcion">' + esc(c.descripcion) + "</div>" : "") +
    '<div class="cot-meta">' +
    '<span class="cot-meta-item"><span class="cot-meta-label">Fecha</span><input type="date" class="mini-input" style="width:135px;" value="' + esc(c.fecha) + '" data-action-change="set-cot-fecha" data-id="' + c.id + '" /></span>' +
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
    var variacionPct = totales.costoTotal > 0 ? (sobrecosto / totales.costoTotal * 100) : 0;
    html += '<div class="variacion ' + vClass + '">' +
      (sobrecosto > 0 ? "Sobrecosto de " : "Ahorro de ") +
      fmt(Math.abs(sobrecosto)) + (totales.costoTotal > 0 ? " (" + (sobrecosto >= 0 ? "+" : "") + variacionPct.toFixed(1) + "% vs. lo cotizado)" : "") +
      "</div>";
  }

  var compras = calcListaCompras(c);
  var htmlCostosReales = "";
  (c.gastosReales || []).forEach(function (g) {
    var etiquetaDestino = g.destino === "insumo" ? (" — insumo: " + esc(g.destinoNombre || "")) : " — costo total";
    var variacion = calcCotGastoVariacion(c, g);
    var estimadoBase = calcCotGastoEstimadoBase(c, g);
    var vTxt = variacion === 0 ? "igual a lo estimado" : (variacion > 0 ? "+" + fmt(variacion) + " sobre lo estimado" : "-" + fmt(Math.abs(variacion)) + " bajo lo estimado");
    htmlCostosReales += '<div class="cot-line"><span class="concept">' + esc(g.concepto) + etiquetaDestino + (g.nota ? " — " + esc(g.nota) : "") + " · " + esc(g.fecha) +
      '<br><span style="color:var(--ink-faint);font-size:11.5px;">Estimado: ' + fmt(estimadoBase) + " · " + vTxt + "</span></span>" +
      '<span class="amount">' + fmt(g.monto) + "</span> " +
      '<button class="btn danger small" data-action="remove-cot-gasto" data-cot="' + c.id + '" data-gasto="' + g.id + '">✕</button></div>';
  });
  if ((c.gastosReales || []).length === 0) { htmlCostosReales += '<div class="empty" style="padding:8px 0;">Sin costos reales registrados aún.</div>'; }
  htmlCostosReales += '<div class="cot-gasto-grid">' +
    '<input class="mini-input" data-role="gasto-concepto" placeholder="Concepto (ej. tela)" />' +
    '<input type="number" class="mini-input" data-role="gasto-monto" placeholder="Costo real" />' +
    '<select class="mini-input" data-role="gasto-destino">' +
    '<option value="total">Costo real del total</option>' +
    compras.map(function (comp) { return '<option value="insumo::' + esc(comp.nombre) + '">Insumo: ' + esc(comp.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<input class="mini-input" data-role="gasto-nota" placeholder="Nota / imprevisto" />' +
    "</div>";
  htmlCostosReales += '<div class="row-actions" style="margin-top:10px;">' +
    '<button class="btn ghost small" data-action="add-cot-gasto" data-id="' + c.id + '" title="Solo ajusta el resultado real de ESTA cotización — no crea un movimiento en Finanzas ni afecta el KPI.">Registrar costo real</button>' +
    (c.estado === "convertida"
      ? '<button class="btn ghost small" data-action="add-cot-estimado-movimiento" data-id="' + c.id + '" title="Registra el costo total ESTIMADO del pedido como un solo movimiento en Finanzas, para llevar el registro completo por pedido.">Registrar estimado completo como movimiento</button>'
      : '<span class="tag" style="background:var(--surface-3);" title="Disponible una vez esta cotización ya sea un pedido — es una medida de seguridad para no registrar gastos sin que exista un pedido con abono real.">🔒 Estimado completo (disponible al convertir en pedido)</span>') +
    "</div>";
  html += '<hr class="stitch cot-section-divider" />';
  html += '<div class="cot-col-title">Costos reales registrados' +
    renderHelp("Registra el costo REAL total de un insumo (o del total) — no una diferencia. La diferencia contra lo estimado se calcula sola y se ve al lado de cada línea. Cada registro también crea un movimiento en Finanzas, para que la caja quede sincronizada.") +
    "</div>";
  html += htmlCostosReales;

  html += '<hr class="stitch cot-section-divider" />';
  html += '<div class="cot-col-title">Qué falta comprar</div>';
  html += renderListaCompras(compras);

  html += '<hr class="stitch cot-section-divider" />';
  html += renderProduccionDocumentos(c);

  return html;
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
    '<button class="btn ghost cot-doc-btn" data-action="enviar-cotizacion-correo" data-id="' + c.id + '" title="Envía el PDF de la cotización al correo del cliente (debe estar registrado en Clientes)">✉ Enviar por correo</button>' +
    "</div>";

  html += '<div class="cot-docs-col">' +
    '<div class="cot-docs-titulo">Para ti (control interno)' + renderHelp("Este PDF no es para el cliente: es para tu propio control interno. Elige qué secciones incluir — de pronto solo quieres la lista de compras, o de pronto toda la información.") + "</div>" +
    '<div class="row-actions" style="flex-wrap:wrap;gap:10px;margin-bottom:10px;">' +
      checkboxPdfInterno("pdfint-general", "Datos generales", true) +
      checkboxPdfInterno("pdfint-referencias", "Referencias e insumos", true) +
      checkboxPdfInterno("pdfint-compras", "Lista de compras", true) +
      checkboxPdfInterno("pdfint-reales", "Costos reales", true) +
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

function renderRefCard(cotId, ref) {
  var calc = calcRefTotales(ref);
  var html = '<div class="ref-card" data-ref-id="' + ref.id + '">' +
    '<div class="ref-top">' +
    renderThumb(cotId, ref) +
    '<div class="ref-top-info">' +
    '<span class="ref-nombre"><input class="mini-input" style="width:100%;font-weight:700;font-size:14px;" placeholder="Nombre de la referencia (ej. Camiseta jugador)" value="' + esc(ref.nombre) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="nombre" /></span>' +
    '<div class="ref-fields">' +
    '<span><label>Consumo tela (MT)</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.consumoAprox) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="consumoAprox" /></span>' +
    '<span><label>Cantidad pedido</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.cantidadPedida) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="cantidadPedida" /></span>' +
    '<span><label>Precio venta x1</label><input type="number" class="mini-input" style="flex:1;" value="' + esc(ref.precioVenta) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="precioVenta" /></span>' +
    '<button class="btn danger small" style="align-self:flex-start;" data-action="remove-referencia" data-cot="' + cotId + '" data-ref="' + ref.id + '">Eliminar referencia</button>' +
    "</div>" +
    "</div>" +
    "</div>";

  html += '<div class="ins-table">' +
    '<div class="ins-row head" style="grid-template-columns:1fr 60px 90px 150px 70px 90px 30px;"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant.</span><span>Costo x prenda</span><span></span></div>';
  (ref.insumos || []).forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:1fr 60px 90px 150px 70px 90px 30px;">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" value="' + esc(i.unidad) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<span class="mobile-th">Cant.</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<span class="mobile-th">Costo x prenda</span><span class="amount">' + fmt(calcCostoPrenda(i, ref)) + "</span>" +
      '<button class="btn danger small" data-action="remove-insumo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-insumo="' + i.id + '">✕</button>' +
      "</div>";
  });
  if ((ref.insumos || []).length === 0) { html += '<div class="empty" style="padding:8px 0;">Sin insumos aún.</div>'; }
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;">' +
    '<select class="mini-input addFromCatalog" style="max-width:240px" data-action-change="add-insumo-catalogo" data-cot="' + cotId + '" data-ref="' + ref.id + '">' +
    '<option value="">+ Insumos predeterminados…</option>' +
    (state.catalogoInsumos || []).map(function (item) { return '<option value="' + item.id + '">' + esc(item.nombre) + "</option>"; }).join("") +
    "</select>" +
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
    "</div>" +
    (ref.productoId ? '<div class="combo-linked">✓ Vinculado al producto del catálogo — al convertir en pedido, el stock de las tallas de "Tallas y observaciones" se descuenta solo</div>' : "");

  html += '<div class="ref-summary">' +
    '<div class="rs-item"><div class="rl">Costo x prenda</div><div class="rv">' + fmt(calc.costoUnit) + "</div></div>" +
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
  // adelante; se puede colapsar/expandir a mano.
  var abierta = ref.seccionOpcionalesAbierta !== undefined ? !!ref.seccionOpcionalesAbierta : (detalle.length > 0 || tieneEstadosPersonalizados);
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
  if (clienteRoster && (clienteRoster.roster || []).length) {
    html += '<div class="section-sub" style="margin:0 0 8px;">' +
      '<button class="btn ghost small" data-action="cargar-roster-cliente" data-cot="' + cotId + '" data-ref="' + ref.id + '">🎽 Cargar roster de ' + esc(clienteRoster.nombre) + " (" + clienteRoster.roster.length + ")</button></div>";
  }
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

function renderListaCompras(compras) {
  if (compras.length === 0) {
    return '<div class="empty" style="padding:8px 0;">Agrega insumos a las referencias para ver aquí lo que necesitas comprar.</div>';
  }
  var html = '<div class="tx-row head" style="grid-template-columns:1fr 1.4fr 110px 110px;"><span>Insumo</span><span>Usado en</span><span>Cantidad a comprar</span><span>Costo total</span></div>';
  compras.forEach(function (c) {
    html += '<div class="tx-row" style="grid-template-columns:1fr 1.4fr 110px 110px;">' +
      '<span class="mobile-th">Insumo</span><span>' + esc(c.nombre) + "</span>" +
      '<span class="mobile-th">Usado en</span><span>' + (c.refs.length ? c.refs.map(function (r) { return '<span class="badge">' + esc(r) + "</span>"; }).join("") : '<span class="muted">—</span>') + "</span>" +
      '<span class="mobile-th">Cantidad a comprar</span><span class="amount">' + (c.tipo === "fijo_pedido" ? '<span style="color:var(--ink-faint);">servicio</span>' : (c.cantidadFisica.toFixed(2) + " " + esc(c.unidad))) + "</span>" +
      '<span class="mobile-th">Costo total</span><span class="amount">' + fmt(c.costoTotal) + "</span>" +
      "</div>";
  });
  return html;
}

export var actions = {
  "cot-vista": function (el) {
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
    if (!fc.cliente || !fc.descripcion) return;
    var nueva = { id: uid(), clienteId: fc.clienteId || "", cliente: fc.cliente, descripcion: fc.descripcion, fecha: fc.fecha, referencias: [nuevaReferencia()], gastosReales: [], estado: "borrador", pedidoId: "", iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: codigoPublico() };
    state.cotizaciones.unshift(nueva);
    state.formCotizacion = { clienteId: "", cliente: "", descripcion: "", fecha: todayStr() };
    // Se queda en esta misma pestaña, ahora mostrando el detalle completo de
    // la recién creada — el detalle SIEMPRE vive acá, nunca en Historial.
    state.cotizacionEditando = nueva.id;
    persist("cotizaciones"); notify();
  },
  // Abrir desde Historial siempre manda a esta pestaña con el detalle
  // completo — Historial en sí nunca muestra más que la tarjeta chica.
  "abrir-cotizacion-editor": function (el) {
    state.cotizacionEditando = el.getAttribute("data-id");
    state.cotizacionesVista = "nueva";
    notify();
  },
  "cerrar-cotizacion-editor": function () {
    state.cotizacionEditando = "";
    notify();
  },
  "set-cot-fecha": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { fecha: el.value }) : c; });
    persist("cotizaciones"); notify();
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
    persist("cotizaciones"); notify();
  },
  "remove-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.filter(function (c) { return c.id !== id; });
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
    persist("cotizaciones"); notify();
  },
  "remove-referencia": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    conRef(cotId, function (c) {
      return Object.assign({}, c, { referencias: (c.referencias || []).filter(function (r) { return r.id !== refId; }) });
    });
  },
  "set-ref-campo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), campo = el.getAttribute("data-campo");
    var numerico = campo !== "nombre";
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
  "add-insumo-catalogo": function (el) {
    if (!el.value) return;
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var item = (state.catalogoInsumos || []).filter(function (c) { return c.id === el.value; })[0];
    if (!item) return;
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).concat([nuevoInsumo(item)]) }); });
  },
  "remove-insumo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-insumo");
    mapRef(cotId, refId, function (r) { return Object.assign({}, r, { insumos: (r.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  "set-ins-campo": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref"), insId = el.getAttribute("data-ins"), campo = el.getAttribute("data-campo");
    var numerico = campo === "costo" || campo === "cantidad";
    mapRef(cotId, refId, function (r) {
      var insumos = (r.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
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
      var nuevosInsumos = (prod.insumos || []).map(function (ins) {
        return { id: uid(), nombre: ins.nombre, unidad: ins.unidad, costo: num(ins.costo), tipo: ins.tipo, cantidad: num(ins.cantidad) || 1 };
      });
      var patch = { insumos: (r.insumos || []).concat(nuevosInsumos), productoId: prod.id };
      if (!r.nombre) patch.nombre = prod.nombre;
      if (prod.consumoSugerido && (!r.consumoAprox || Number(r.consumoAprox) === 1)) patch.consumoAprox = num(prod.consumoSugerido);
      if (prod.imagenUrl && !r.imagenUrl) patch.imagenUrl = prod.imagenUrl;
      if (prod.precioVenta && (!r.precioVenta || Number(r.precioVenta) === 0)) patch.precioVenta = num(prod.precioVenta);
      if (prod.flujoEstadosId) {
        var flujoP = (state.plantillasEstados || []).filter(function (f) { return f.id === prod.flujoEstadosId; })[0];
        if (flujoP) patch.estadosDef = flujoP.estados.map(function (e) { return { id: e.id, label: e.label }; });
      }
      return Object.assign({}, r, patch);
    });
  },
  "add-cot-gasto": function (el) {
    var id = el.getAttribute("data-id");
    var cotCard = el.closest(".cot-card");
    var concepto = val(cotCard, "gasto-concepto"), monto = num(val(cotCard, "gasto-monto")), nota = val(cotCard, "gasto-nota");
    var destinoSel = cotCard ? cotCard.querySelector('[data-role="gasto-destino"]') : null;
    var destinoVal = destinoSel ? destinoSel.value : "total";
    var destino = "total", destinoNombre = "";
    if (destinoVal && destinoVal.indexOf("insumo::") === 0) { destino = "insumo"; destinoNombre = destinoVal.slice("insumo::".length); }
    if (!concepto || monto <= 0) return;
    // "Registrar costo real" SOLO ajusta el resultado real de la cotización
    // (costo/ganancia real). NO crea un movimiento en Finanzas ni afecta el
    // KPI — para eso está el botón "Registrar estimado completo como
    // movimiento", disponible una vez la cotización ya es un pedido.
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id) return c;
      var gastos = (c.gastosReales || []).concat([{ id: uid(), concepto: concepto, monto: monto, nota: nota, destino: destino, destinoNombre: destinoNombre, fecha: todayStr() }]);
      return Object.assign({}, c, { gastosReales: gastos });
    });
    persist("cotizaciones"); notify();
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
    persist("cotizaciones"); notify();
  },
  "remove-cot-gasto": function (el) {
    var cotId = el.getAttribute("data-cot"), gastoId = el.getAttribute("data-gasto");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== cotId) return c;
      return Object.assign({}, c, { gastosReales: (c.gastosReales || []).filter(function (g) { return g.id !== gastoId; }) });
    });
    // Elimina también el movimiento de Finanzas creado junto con este costo real.
    state.tx = state.tx.filter(function (t) { return t.origenGastoId !== gastoId; });
    persist("cotizaciones"); persist("tx"); notify();
  },
  "convertir-cotizacion": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (cot) {
      var totales = calcCotizacionTotales(cot);
      var cantidadTotal = (cot.referencias || []).reduce(function (a, r) { return a + num(r.cantidadPedida); }, 0) || 1;
      var descripcionRefs = (cot.referencias || []).map(function (r) { return r.nombre + " x" + r.cantidadPedida; }).join(", ") || cot.descripcion;
      // El pedido guarda un estado/flujo "agregado" (el de su referencia menos
      // avanzada) solo para que el filtro por etapa, el KPI y el PDF sigan
      // funcionando sin cambios — el progreso real, referencia por
      // referencia, se edita y se lee siempre desde la cotización (ver
      // pedidos.js: "advance-ref"/"retreat-ref").
      var agregado = estadoAgregadoDeCot(cot);
      var nuevoP = {
        id: uid(), clienteId: cot.clienteId || "", cliente: cot.cliente, tipoCliente: "propio", descripcion: cot.descripcion + (descripcionRefs ? " (" + descripcionRefs + ")" : ""),
        cantidad: String(cantidadTotal), total: totales.precioTotal, abono: 0, fechaEntrega: "", estado: agregado ? agregado.estado : "nuevo", cotizacionId: cot.id,
        numeroOp: generarNumeroOp(todosNumerosOp()),
        iva: cot.iva || { activo: false, porcentaje: 19 },
        abonos: [],
        estadosDef: agregado ? agregado.estadosDef : null,
        // La comisión de vendedor definida en la cotización se traslada al pedido
        // resultante (misma estructura), para que no haya que volver a definirla.
        vendedor: cot.vendedor ? Object.assign({}, cot.vendedor) : null,
        stockConsumido: [] // se completa abajo con lo que en verdad se descontó, para poder revertirlo si el pedido se elimina
      };
      state.pedidos.unshift(nuevoP);
      state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: nuevoP.id }) : c; });
      nuevoP.stockConsumido = descontarStockPorTallas(cot, "pedido:" + nuevoP.id);
      persist("pedidos"); persist("cotizaciones");
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
    if (!correo) { window.alert('Este cliente no tiene correo registrado. Agrégaselo en la pestaña Clientes para poder enviarle el PDF.'); return; }
    try {
      var pdf = await generarPDFCotizacion(cot, { enviarPorCorreo: true });
      await enviarCorreoConAdjunto({
        to: correo,
        subject: "Cotización — " + (cot.descripcion || state.config.nombre),
        bodyHtml: plantillaCorreoHtml({
          cfg: state.config,
          saludo: "Hola " + (cot.cliente || "") + ",",
          mensaje: "Adjuntamos la cotización de \"" + (cot.descripcion || "tu pedido") + "\". Cualquier duda, quedamos atentos.",
          docTitulo: "Cotización"
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
    persist("cotizaciones"); notify();
  },
  "set-cot-vendedor-fecha": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (c.id !== id || !c.vendedor) return c;
      return Object.assign({}, c, { vendedor: Object.assign({}, c.vendedor, { fechaPago: el.value }) });
    });
    persist("cotizaciones"); notify();
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
    persist("cotizaciones"); notify();
  },
  // Registra el costo total ESTIMADO de todo el pedido como un único
  // movimiento en Finanzas (a diferencia de "Registrar costo real", que
  // registra costos reales puntuales). Sirve para llevar el registro de
  // movimientos agrupado y categorizado por pedido desde el principio.
  "add-cot-estimado-movimiento": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var totales = calcCotizacionTotales(cot);
    state.tx.unshift({
      id: uid(), tipo: "gasto", concepto: "Estimado completo del pedido — " + cot.descripcion,
      monto: totales.costoTotal, contraparte: cot.cliente, estado: "pendiente", fecha: todayStr(),
      pedidoId: cot.pedidoId || "", cotizacionId: cot.id
    });
    persist("tx"); notify();
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
  "descargar-plantilla-csv": function () {
    var matriz = [
      ["nombre", "talla", "numero", "tipo", "observaciones"],
      ["Juan Pérez", "M", "10", "Jugador", ""],
      ["María López", "S", "7", "Arquero", "Pedido especial"]
    ];
    var hoja = window.XLSX.utils.aoa_to_sheet(matriz);
    hoja["!cols"] = [{ wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 24 }];
    var libro = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(libro, hoja, "Tallas");
    window.XLSX.writeFile(libro, "plantilla-tallas-referencia.xlsx");
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
        iva: cot.iva || p.iva,
        estado: agregado ? agregado.estado : p.estado,
        estadosDef: agregado ? agregado.estadosDef : null,
        vendedor: cot.vendedor ? Object.assign({}, cot.vendedor) : p.vendedor,
        stockConsumido: (p.stockConsumido || []).concat(stockAplicado)
      });
    });
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: cot.pedidoOrigenId }) : c; });
    // Terminado — vuelve al índice; ahí se ve, ya resumida, como "Convertida a pedido".
    state.cotizacionEditando = "";
    state.cotizacionesVista = "historial";
    persist("pedidos"); persist("cotizaciones"); notify();
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

// Aplica una función de transformación a una cotización completa, guarda y notifica.
function conRef(cotId, transform) {
  state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === cotId ? transform(c) : c; });
  persist("cotizaciones"); notify();
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
