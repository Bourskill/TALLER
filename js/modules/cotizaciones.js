import { state, persist, notify } from "../core/store.js";
import { esc, opt, num, uid, todayStr, val, fmt, generarNumeroOp, parseDetalleCSV, codigoPublico, parseCurvaTallas } from "../core/utils.js";
import { calcCotizacionTotales, calcRefTotales, calcCostoPrenda, calcCotResultadoReal, calcListaCompras, calcCotGastoVariacion, calcCotGastoEstimadoBase, calcComisionValorCot, clienteById } from "../core/calc.js";
import { renderClienteCombo, renderTipoCostoOptions, renderHelp } from "../core/components.js";
import { generarPDFCotizacion, generarPDFInternoCotizacion } from "../core/pdf.js";
import { subirImagenReferencia } from "../core/drive.js";
import { enviarCorreoConAdjunto, plantillaCorreoHtml } from "../core/gmail.js";
import { todosNumerosOp } from "./pedidos.js";
import { ESTADOS_DEFAULT } from "../core/constants.js";

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

// Dos pestañas arriba (estilo hoja de cálculo, a la derecha) en vez de una
// sola vista con el formulario y todo el historial apilados: "Nueva
// cotización" recibe con el formulario en blanco como protagonista, y
// "Historial" es donde vive/se sigue editando todo lo ya creado. Crear una
// cotización nueva salta automáticamente a Historial (ver acción
// "add-cotizacion") para seguir trabajándola ahí mismo.
export function render() {
  var vista = state.cotizacionesVista || "nueva";
  var html = renderTabsCotizaciones(vista);
  html += vista === "historial" ? renderHistorial() : renderFormNueva();
  return html;
}

function renderTabsCotizaciones(vista) {
  var total = state.cotizaciones.length;
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nueva" ? "active" : "") + '" data-action="cot-vista" data-val="nueva">+ Nueva cotización</button>' +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="cot-vista" data-val="historial">Historial' + (total ? " (" + total + ")" : "") + "</button>" +
    "</div>";
}

function renderFormNueva() {
  var f = state.formCotizacion;
  return '<div class="card"><div class="section-title small">Nueva cotización' +
    renderHelp("Arma cada referencia con sus insumos (o aplica una plantilla), define el precio de venta y el margen se calcula solo. Los gastos reales de producción se registran aparte para comparar contra lo cotizado.") +
    '</div><div class="form-grid">' +
    renderClienteCombo("cotizacion", "cot-cliente-nombre", f) +
    '<div class="field wide"><label>Descripción general</label><input data-form="cotizacion" data-field="descripcion" value="' + esc(f.descripcion) + '" placeholder="Ej. Uniformes equipo San Jorge" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" data-form="cotizacion" data-field="fecha" value="' + esc(f.fecha) + '" /></div>' +
    '<button class="btn" data-action="add-cotizacion">Crear cotización</button>' +
    "</div></div>";
}

function renderHistorial() {
  if (state.cotizaciones.length === 0) { return '<div class="empty">Aún no has creado cotizaciones — creá la primera en la pestaña "+ Nueva cotización".</div>'; }
  var html = "";
  state.cotizaciones.forEach(function (c) { html += renderCotCard(c); });
  return html;
}

// Sección desplegable genérica dentro de una cotización — para que no todo
// quede amontonado: el título siempre se ve, el contenido solo si está
// abierta. El estado (abierta/cerrada) se guarda en la propia cotización
// bajo `campo`, así que se recuerda entre renders.
function renderSeccionColapsable(c, campo, titulo, ayudaHtml, contenidoHtml) {
  var abierta = !!c[campo];
  var html = '<div class="cot-col-title" style="margin-top:16px;cursor:pointer;" data-action="toggle-cot-seccion" data-id="' + c.id + '" data-campo="' + campo + '">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierta ? "\u25be" : "\u25b8") + "</button> " + titulo + (ayudaHtml || "") +
    "</div>";
  if (abierta) html += contenidoHtml;
  return html;
}

// Editor del flujo de etapas de producción de ESTA cotización (y por tanto
// del pedido que salga de ella). Si no se ha personalizado, se parte del
// flujo estándar de toda la app.
function renderEstadosCot(c) {
  var estados = (c.estadosDef && c.estadosDef.length) ? c.estadosDef : ESTADOS_DEFAULT;
  var esPersonalizado = !!(c.estadosDef && c.estadosDef.length);
  var COLS_E = "30px 1fr 36px 36px 30px";
  var html = '<div class="det-row head" style="grid-template-columns:' + COLS_E + ';"><span>#</span><span>Etapa</span><span></span><span></span><span></span></div>';
  estados.forEach(function (e, i) {
    html += '<div class="det-row" style="grid-template-columns:' + COLS_E + ';">' +
      "<span>" + (i + 1) + "</span>" +
      '<input class="mini-input" value="' + esc(e.label) + '" data-action-change="set-estado-cot-label" data-id="' + c.id + '" data-idx="' + i + '" />' +
      '<button class="btn ghost small" ' + (i === 0 ? "disabled" : "") + ' data-action="mover-estado-cot" data-dir="-1" data-id="' + c.id + '" data-idx="' + i + '" title="Subir">↑</button>' +
      '<button class="btn ghost small" ' + (i === estados.length - 1 ? "disabled" : "") + ' data-action="mover-estado-cot" data-dir="1" data-id="' + c.id + '" data-idx="' + i + '" title="Bajar">↓</button>' +
      '<button class="btn danger small" data-action="remove-estado-cot" data-id="' + c.id + '" data-idx="' + i + '">✕</button>' +
      "</div>";
  });
  html += '<div class="inline-form" style="margin-top:8px;">' +
    '<input class="mini-input" data-role="nueva-etapa-' + c.id + '" placeholder="Nombre de la nueva etapa" style="width:180px" />' +
    '<button class="btn ghost small" data-action="add-estado-cot" data-id="' + c.id + '">+ Agregar etapa</button>' +
    (esPersonalizado ? '<button class="btn ghost small" data-action="resetear-estados-cot" data-id="' + c.id + '">Restablecer estándar</button>' : "") +
    "</div>";
  html += '<div class="inline-form" style="margin-top:8px;">' +
    '<button class="btn ghost small" data-action="guardar-plantilla-estados" data-id="' + c.id + '">💾 Guardar este flujo como plantilla</button>';
  if ((state.plantillasEstados || []).length) {
    html += '<select class="mini-input" data-role="plantilla-estados-sel-' + c.id + '" style="width:190px">' +
      (state.plantillasEstados || []).map(function (pl) { return '<option value="' + pl.id + '">' + esc(pl.nombre) + " (" + pl.estados.length + " etapas)</option>"; }).join("") +
      "</select>" +
      '<button class="btn ghost small" data-action="cargar-plantilla-estados" data-id="' + c.id + '">Cargar plantilla</button>';
  }
  html += "</div>";
  return html;
}

function renderCotCard(c) {
  var totales = calcCotizacionTotales(c);
  var real = calcCotResultadoReal(c);
  var sobrecosto = real.sobrecosto;
  var vClass = sobrecosto === 0 ? "neutra" : (sobrecosto > 0 ? "mala" : "ok");
  var iva = c.iva || { activo: false, porcentaje: 19 };
  var colapsada = !!c.colapsada;

  var html = '<div class="cot-card' + (colapsada ? " colapsada" : "") + '" data-cot-id="' + c.id + '">' +
    '<div class="cot-top"><div>' +
    '<button class="cot-collapse-toggle" data-action="toggle-cot-colapsada" data-id="' + c.id + '" title="' + (colapsada ? "Expandir" : "Contraer") + '">' + (colapsada ? "\u25b8" : "\u25be") + '</button> ' +
    '<span class="cot-cliente">' + esc(c.cliente) + "</span> " +
    '<span class="badge ' + c.estado + '">' + (c.estado === "convertida" ? "Convertida a pedido" : "Borrador") + "</span>" +
    (c.esDemo ? ' <span class="badge" style="background:var(--warning-soft);color:var(--warning-ink);" title="No cuenta en KPIs, reportes ni Por cobrar \u2014 es solo para practicar el flujo">\ud83e\uddea Prueba</span>' : "") +
    '<div class="cot-meta">' + esc(c.descripcion) + " \u00b7 " +
    '<input type="date" class="mini-input" style="width:135px;display:inline-block;" value="' + esc(c.fecha) + '" data-action-change="set-cot-fecha" data-id="' + c.id + '" />' +
    (c.pedidoOrigenId && c.estado !== "convertida" ? ' \u00b7 <span style="color:var(--accent-ink);">escalada desde pedido r\u00e1pido</span>' : "") +
    (colapsada ? " \u00b7 " + fmt(totales.precioTotal) + " venta" : "") + "</div>" +
    "</div>";

  if (colapsada) {
    html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
      '<button class="btn ghost small" data-action="toggle-cot-colapsada" data-id="' + c.id + '">Expandir y editar</button>' +
      "</div></div></div>";
    return html;
  }

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
    '<label class="mini-label" style="display:flex;align-items:center;gap:5px;">' +
    '<input type="checkbox" data-action-change="set-cot-iva" data-campo="activo" data-id="' + c.id + '" ' + (iva.activo ? "checked" : "") + ' /> IVA' +
    '</label>' +
    (iva.activo ? '<input type="number" class="mini-input" style="width:60px" value="' + esc(iva.porcentaje) + '" data-action-change="set-cot-iva" data-campo="porcentaje" data-id="' + c.id + '" title="Porcentaje de IVA" />%' : "") +
    renderHelp("El IVA es opcional: act\u00edvalo aqu\u00ed (o desde el pedido convertido) y define el %. Si est\u00e1 apagado, el PDF no lo cobra.") +
    '<button class="btn ghost small" data-action="toggle-cot-demo" data-id="' + c.id + '" title="' + (c.esDemo ? "Esta cotizaci\u00f3n es de prueba: no cuenta en KPIs, reportes ni Por cobrar. Clic para convertirla en real." : "Marcarla como prueba la saca de todo c\u00e1lculo financiero real (KPIs, reportes, Por cobrar) \u2014 \u00fatil para practicar el flujo sin ensuciar tus n\u00fameros.") + '">' + (c.esDemo ? "\u2713 Hacer real" : "\ud83e\uddea Marcar como prueba") + "</button>" +
    '<button class="btn ghost small" data-action="generar-pdf" data-id="' + c.id + '">Generar PDF para el cliente</button>' +
    '<button class="btn ghost small" data-action="enviar-cotizacion-correo" data-id="' + c.id + '" title="Envía el PDF de la cotización al correo del cliente (debe estar registrado en Clientes)">✉ Enviar por correo</button>' +
    (c.estado !== "convertida"
      ? (c.pedidoOrigenId
          ? '<button class="btn small" data-action="aplicar-cotizacion-a-pedido" data-id="' + c.id + '" title="Reemplaza el total, descripción, cantidad y vendedor del pedido original con estos valores. Los abonos ya cobrados se conservan.">Aplicar a pedido \u2192</button>'
          : '<button class="btn small" data-action="convertir-cotizacion" data-id="' + c.id + '">Convertir en pedido \u2192</button>')
      : "") +
    "</div></div>";

  html += renderVendedorCot(c);

  html += renderReferenciasTabs(c);

  html += '<div class="pedido-actions" style="margin-top:4px;"><button class="btn ghost small" data-action="add-referencia" data-id="' + c.id + '">+ Agregar referencia</button></div>';

  html += '<div class="cot-col-title">Estimado' + renderHelp("Lo que se plane\u00f3 al armar la cotizaci\u00f3n, antes de producir.") + "</div>";
  html += '<div class="cot-resumen-total">' +
    '<div><div class="rl">Costo total estimado</div><div class="rv">' + fmt(totales.costoTotal) + "</div></div>" +
    '<div><div class="rl">Precio total cotizado</div><div class="rv">' + fmt(totales.precioTotal) + "</div></div>" +
    '<div><div class="rl">Ganancia estimada</div><div class="rv" style="color:' + (totales.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(totales.gananciaTotal) + "</div></div>" +
    '<div><div class="rl">Margen</div><div class="rv">' + totales.margenPct.toFixed(1) + "%</div></div>" +
    "</div>";

  html += '<div class="cot-col-title">Real' + renderHelp("Lo estimado ajustado por la diferencia entre los costos reales que registraste y lo presupuestado para ellos. As\u00ed comparas lo planeado contra lo que en verdad pas\u00f3.") + "</div>";
  html += '<div class="cot-resumen-total">' +
    '<div><div class="rl">Costo total real</div><div class="rv">' + fmt(real.costoTotal) + "</div></div>" +
    '<div><div class="rl">Precio total cotizado</div><div class="rv">' + fmt(real.precioTotal) + "</div></div>" +
    '<div><div class="rl">Ganancia real</div><div class="rv" style="color:' + (real.gananciaTotal >= 0 ? "var(--success)" : "var(--danger)") + ';">' + fmt(real.gananciaTotal) + "</div></div>" +
    '<div><div class="rl">Margen real</div><div class="rv">' + real.margenPct.toFixed(1) + "%</div></div>" +
    "</div>";

  var compras = calcListaCompras(c);
  html += renderSeccionColapsable(c, "seccionCompras", "Lista de compras (insumos a conseguir)", "", renderListaCompras(compras));

  var htmlCostosReales = "";
  (c.gastosReales || []).forEach(function (g) {
    var etiquetaDestino = g.destino === "insumo" ? (" \u2014 insumo: " + esc(g.destinoNombre || "")) : " \u2014 costo total";
    var variacion = calcCotGastoVariacion(c, g);
    var estimadoBase = calcCotGastoEstimadoBase(c, g);
    var vTxt = variacion === 0 ? "igual a lo estimado" : (variacion > 0 ? "+" + fmt(variacion) + " sobre lo estimado" : "-" + fmt(Math.abs(variacion)) + " bajo lo estimado");
    htmlCostosReales += '<div class="cot-line"><span class="concept">' + esc(g.concepto) + etiquetaDestino + (g.nota ? " \u2014 " + esc(g.nota) : "") + " \u00b7 " + esc(g.fecha) +
      '<br><span style="color:var(--ink-faint);font-size:11.5px;">Estimado: ' + fmt(estimadoBase) + " \u00b7 " + vTxt + "</span></span>" +
      '<span class="amount">' + fmt(g.monto) + "</span> " +
      '<button class="btn danger small" data-action="remove-cot-gasto" data-cot="' + c.id + '" data-gasto="' + g.id + '">\u2715</button></div>';
  });
  if ((c.gastosReales || []).length === 0) { htmlCostosReales += '<div class="empty" style="padding:8px 0;">Sin costos reales registrados a\u00fan.</div>'; }
  htmlCostosReales += '<div class="inline-form">' +
    '<input class="mini-input" data-role="gasto-concepto" placeholder="Concepto (ej. tela)" style="width:130px" />' +
    '<input type="number" class="mini-input" data-role="gasto-monto" placeholder="Costo real" style="width:100px" />' +
    '<select class="mini-input" data-role="gasto-destino" style="width:170px">' +
    '<option value="total">Costo real del total</option>' +
    compras.map(function (comp) { return '<option value="insumo::' + esc(comp.nombre) + '">Insumo: ' + esc(comp.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<input class="mini-input" data-role="gasto-nota" placeholder="Nota / imprevisto" style="width:150px" />' +
    '<button class="btn ghost small" data-action="add-cot-gasto" data-id="' + c.id + '" title="Solo ajusta el resultado real de ESTA cotización — no crea un movimiento en Finanzas ni afecta el KPI.">Registrar costo real</button>' +
    (c.estado === "convertida"
      ? '<button class="btn ghost small" data-action="add-cot-estimado-movimiento" data-id="' + c.id + '" title="Registra el costo total ESTIMADO del pedido como un solo movimiento en Finanzas, para llevar el registro completo por pedido.">Registrar estimado completo como movimiento</button>'
      : '<span class="tag" style="background:var(--surface-3);" title="Disponible una vez esta cotización ya sea un pedido — es una medida de seguridad para no registrar gastos sin que exista un pedido con abono real.">🔒 Estimado completo (disponible al convertir en pedido)</span>') +
    "</div>";
  html += renderSeccionColapsable(c, "seccionCostosReales", "Costos reales registrados",
    renderHelp("Registra el costo REAL total de un insumo (o del total) \u2014 no una diferencia. La diferencia contra lo estimado se calcula sola y se ve al lado de cada l\u00ednea. Cada registro tambi\u00e9n crea un movimiento en Finanzas, para que la caja quede sincronizada."),
    htmlCostosReales);

  html += renderSeccionColapsable(c, "seccionEstados", "Estados de producción",
    renderHelp("Define aquí las etapas por las que pasa este pedido (ej. Cortado, Confección, Acabados...) — no todas las prendas pasan por las mismas. Se pueden guardar como plantilla para reutilizarlas en otra cotización."),
    renderEstadosCot(c));

  html += renderSeccionColapsable(c, "seccionPdfInterno", "PDF interno (para ti, con lo que elijas)",
    renderHelp("Este PDF no es para el cliente: es para tu propio control interno. Elige qué secciones incluir — de pronto solo quieres la lista de compras, o de pronto toda la información."),
    '<div class="row-actions" style="flex-wrap:wrap;gap:12px;">' +
      checkboxPdfInterno("pdfint-general", "Datos generales", true) +
      checkboxPdfInterno("pdfint-referencias", "Referencias e insumos", true) +
      checkboxPdfInterno("pdfint-compras", "Lista de compras", true) +
      checkboxPdfInterno("pdfint-reales", "Costos reales", true) +
      checkboxPdfInterno("pdfint-vendedor", "Comisión vendedor", !!(c.vendedor && c.vendedor.nombre)) +
      '<button class="btn ghost small" data-action="generar-pdf-interno" data-id="' + c.id + '">Generar PDF interno</button>' +
      "</div>");

  if (sobrecosto !== 0) {
    var variacionPct = totales.costoTotal > 0 ? (sobrecosto / totales.costoTotal * 100) : 0;
    html += '<div class="variacion ' + vClass + '">' +
      (sobrecosto > 0 ? "Sobrecosto de " : "Ahorro de ") +
      fmt(Math.abs(sobrecosto)) + (totales.costoTotal > 0 ? " (" + (sobrecosto >= 0 ? "+" : "") + variacionPct.toFixed(1) + "% vs. lo cotizado)" : "") +
      "</div>";
  }

  html += '<div class="pedido-actions"><button class="btn danger small" data-action="remove-cotizacion" data-id="' + c.id + '">Eliminar cotizaci\u00f3n</button></div>';
  html += "</div>"; // .cot-card
  return html;
}

function renderVendedorCot(c) {
  var v = c.vendedor || { nombre: "", tipo: "porcentaje", valor: 0, estado: "pendiente" };
  var valor = calcComisionValorCot(c);
  var pagado = v.estado === "pagado";
  return '<div class="section-sub" style="margin:0 0 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
    "<span>Vendedor" + renderHelp("Comisión del vendedor de esta cotización: por % del total cotizado, o por un valor fijo. Si la cotización se convierte en pedido, la comisión se traslada automáticamente.") + ":</span>" +
    '<input class="mini-input" style="width:140px" placeholder="Nombre" value="' + esc(v.nombre) + '" data-action-change="set-cot-vendedor" data-campo="nombre" data-id="' + c.id + '" />' +
    '<select class="mini-input" style="width:120px" data-action-change="set-cot-vendedor" data-campo="tipo" data-id="' + c.id + '">' +
    opt("porcentaje", "% del total", v.tipo) + opt("fijo", "$ Valor fijo", v.tipo) +
    "</select>" +
    '<input type="number" class="mini-input" style="width:100px" placeholder="Valor" value="' + esc(v.valor) + '" data-action-change="set-cot-vendedor" data-campo="valor" data-id="' + c.id + '" />' +
    (v.nombre ? ('<b style="color:var(--ink);">' + fmt(valor) + "</b>" +
      '<button class="status-pill ' + (pagado ? "pagado" : "pendiente") + '" data-action="toggle-comision-cot" data-id="' + c.id + '">' + (pagado ? "pagada" : "pendiente") + "</button>" +
      (!pagado ? ('<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-soft);">Fecha de pago<input type="date" class="mini-input" value="' + esc(v.fechaPago || "") + '" data-action-change="set-cot-vendedor-fecha" data-id="' + c.id + '" /></label>') : "")) : "") +
    "</div>";
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
    '<span class="ref-nombre" style="flex:1;"><input class="mini-input" style="width:100%;font-weight:700;font-size:14px;" placeholder="Nombre de la referencia (ej. Camiseta jugador)" value="' + esc(ref.nombre) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="nombre" /></span>' +
    '<div class="ref-fields">' +
    '<span><label>Consumo tela (MT)</label><input type="number" class="mini-input" style="width:80px" value="' + esc(ref.consumoAprox) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="consumoAprox" /></span>' +
    '<span><label>Cantidad pedido</label><input type="number" class="mini-input" style="width:80px" value="' + esc(ref.cantidadPedida) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="cantidadPedida" /></span>' +
    '<span><label>Precio venta x1</label><input type="number" class="mini-input" style="width:100px" value="' + esc(ref.precioVenta) + '" data-action-change="set-ref-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-campo="precioVenta" /></span>' +
    '<button class="btn danger small" data-action="remove-referencia" data-cot="' + cotId + '" data-ref="' + ref.id + '">Eliminar referencia</button>' +
    "</div>" +
    "</div>";

  html += '<div class="ins-table">' +
    '<div class="ins-row head" style="grid-template-columns:1fr 60px 90px 150px 70px 90px 30px;"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant.</span><span>Costo x prenda</span><span></span></div>';
  (ref.insumos || []).forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:1fr 60px 90px 150px 70px 90px 30px;">' +
      '<input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<input class="mini-input" style="width:100%" value="' + esc(i.unidad) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<select class="mini-input tipo-sel" style="width:100%" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-ins-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<span class="amount">' + fmt(calcCostoPrenda(i, ref)) + "</span>" +
      '<button class="btn danger small" data-action="remove-insumo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-insumo="' + i.id + '">✕</button>' +
      "</div>";
  });
  if ((ref.insumos || []).length === 0) { html += '<div class="empty" style="padding:8px 0;">Sin insumos aún.</div>'; }
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;">' +
    '<select class="mini-input addFromCatalog" style="max-width:240px" data-action-change="add-insumo-catalogo" data-cot="' + cotId + '" data-ref="' + ref.id + '">' +
    '<option value="">+ Agregar desde catálogo…</option>' +
    (state.catalogoInsumos || []).map(function (item) { return '<option value="' + item.id + '">' + esc(item.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<button class="btn ghost small" data-action="add-insumo-personalizado" data-cot="' + cotId + '" data-ref="' + ref.id + '">+ Insumo personalizado</button>' +
    ((state.plantillasPrendas || []).length ? (
      '<select class="mini-input applyPlantilla" style="max-width:220px" data-action-change="aplicar-plantilla" data-cot="' + cotId + '" data-ref="' + ref.id + '">' +
      '<option value="">Aplicar plantilla…</option>' +
      state.plantillasPrendas.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") +
      "</select>"
    ) : "") +
    "</div>";

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

// Tallas/observaciones (antes vivía en el pedido, ahora aquí para poder
// diferenciar el listado por referencia cuando la cotización tiene varias).
// Las filas SÍ son editables in-place (antes en pedidos solo se podían
// borrar y volver a crear si había un error de digitación).
function renderDetalleReferencia(cotId, ref) {
  var detalle = ref.detalle || [];
  // Progresivo: colapsada por defecto hasta que tenga datos (no todas las
  // referencias necesitan tallas por unidad) — en cuanto se usa, queda
  // abierta sola de ahí en adelante; se puede colapsar/expandir a mano.
  // También se abre sola si una plantilla dejó una curva de tallas sugerida
  // para esta referencia — si no, el botón para generarla quedaría escondido.
  var abierta = ref.seccionTallasAbierta !== undefined ? !!ref.seccionTallasAbierta : (detalle.length > 0 || !!state.curvaSugerida[ref.id]);
  var titulo = "Tallas y observaciones" + (detalle.length ? " (" + detalle.length + ")" : "");
  var html = '<div class="cot-col-title" style="margin-top:14px;cursor:pointer;" data-action="toggle-ref-seccion" data-cot="' + cotId + '" data-ref="' + ref.id + '">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierta ? "▾" : "▸") + "</button> " + titulo +
    renderHelp("Para uniformes o pedidos personalizados: cada fila puede ser una persona/unidad con su talla, número y observación propia. Se incluye en el PDF de orden de producción de los pedidos que salgan de esta cotización. Si este listado crece más que la cantidad cotizada de la referencia, la cantidad sube sola para que coincidan (nunca al revés).") +
    "</div>";
  if (!abierta) return html;
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
        "<span>" + (i + 1) + "</span>" +
        '<input class="mini-input" value="' + esc(d.nombre) + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="nombre" />' +
        '<input class="mini-input" value="' + esc(d.talla || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="talla" />' +
        '<input class="mini-input" value="' + esc(d.numero || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="numero" />' +
        '<input class="mini-input" value="' + esc(d.tipo || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="tipo" />' +
        '<input class="mini-input" value="' + esc(d.observaciones || "") + '" data-action-change="set-ref-detalle-campo" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '" data-campo="observaciones" />' +
        '<button class="btn danger small" data-action="remove-ref-detalle" data-cot="' + cotId + '" data-ref="' + ref.id + '" data-item="' + d.id + '">✕</button>' +
        "</div>";
    });
    html += "</div>";
  } else {
    html += '<div class="empty" style="padding:8px 0;">Sin filas aún — útil para uniformes: nombre, talla, número...</div>';
  }
  html += '<div class="inline-form" style="margin-top:6px;">' +
    '<input class="mini-input" data-role="curva-tallas-' + ref.id + '" value="' + esc(state.curvaSugerida[ref.id] || "") + '" placeholder="Curva de tallas, ej. S:2, M:4, L:3, XL:1" style="width:230px" />' +
    '<button class="btn ghost small" data-action="generar-curva-tallas" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Genera una fila por cada unidad de la curva, con esa talla ya puesta">Generar filas por talla</button>' +
    "</div>";
  html += '<div class="inline-form" style="margin-top:6px;">' +
    '<input class="mini-input" data-role="det-nombre-' + ref.id + '" placeholder="Nombre" style="width:120px" />' +
    '<input class="mini-input" data-role="det-talla-' + ref.id + '" placeholder="Talla" style="width:60px" />' +
    '<input class="mini-input" data-role="det-numero-' + ref.id + '" placeholder="Número" style="width:60px" />' +
    '<input class="mini-input" data-role="det-tipo-' + ref.id + '" placeholder="Tipo (jugador, arquero...)" style="width:150px" />' +
    '<input class="mini-input" data-role="det-obs-' + ref.id + '" placeholder="Observaciones" style="width:160px" />' +
    '<button class="btn ghost small" data-action="add-ref-detalle" data-cot="' + cotId + '" data-ref="' + ref.id + '">Agregar fila</button>' +
    "</div>";
  html += '<div class="inline-form" style="margin-top:6px;">' +
    '<label class="btn ghost small" style="cursor:pointer;">📥 Importar CSV<input type="file" accept=".csv,text/csv" data-action-change="import-ref-detalle-csv" data-cot="' + cotId + '" data-ref="' + ref.id + '" style="display:none" /></label>' +
    '<button class="btn ghost small" data-action="descargar-plantilla-csv">Descargar plantilla CSV</button>' +
    renderHelp("El CSV debe tener columnas: nombre, talla, numero, tipo, observaciones (en cualquier orden). Descarga la plantilla para verlo con un ejemplo. Funciona con archivos exportados desde Excel como CSV.") +
    "</div>";
  return html;
}

function renderThumb(cotId, ref) {
  if (state.refImagenSubiendo[ref.id]) {
    return '<span class="ref-thumb ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</span>';
  }
  if (ref.imagenUrl) {
    return '<span class="ref-thumb" data-action="set-ref-imagen" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Clic para subir otra imagen desde tu dispositivo">' +
      '<img src="' + esc(ref.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-remove" data-action="quitar-ref-imagen" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Quitar imagen">✕</button>' +
      "</span>";
  }
  return '<span class="ref-thumb ref-thumb-empty" data-action="set-ref-imagen" data-cot="' + cotId + '" data-ref="' + ref.id + '" title="Subir una imagen desde tu dispositivo (se guarda en tu Google Drive)">+ imagen</span>';
}

function renderListaCompras(compras) {
  var html = '<div class="cot-col-title" style="margin-top:16px;">Lista de compras (insumos a conseguir)</div>';
  if (compras.length === 0) {
    return html + '<div class="empty" style="padding:8px 0;">Agrega insumos a las referencias para ver aquí lo que necesitas comprar.</div>';
  }
  html += '<div class="tx-row head" style="grid-template-columns:1fr 1.4fr 110px 110px;"><span>Insumo</span><span>Usado en</span><span>Cantidad a comprar</span><span>Costo total</span></div>';
  compras.forEach(function (c) {
    html += '<div class="tx-row" style="grid-template-columns:1fr 1.4fr 110px 110px;">' +
      "<span>" + esc(c.nombre) + "</span>" +
      "<span>" + (c.refs.length ? c.refs.map(function (r) { return '<span class="badge">' + esc(r) + "</span>"; }).join("") : '<span class="muted">—</span>') + "</span>" +
      '<span class="amount">' + (c.tipo === "fijo_pedido" ? '<span style="color:var(--ink-faint);">servicio</span>' : (c.cantidadFisica.toFixed(2) + " " + esc(c.unidad))) + "</span>" +
      '<span class="amount">' + fmt(c.costoTotal) + "</span>" +
      "</div>";
  });
  return html;
}

export var actions = {
  "cot-vista": function (el) {
    state.cotizacionesVista = el.getAttribute("data-val");
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
      var abierta = r.seccionTallasAbierta !== undefined ? !!r.seccionTallasAbierta : (r.detalle || []).length > 0;
      return Object.assign({}, r, { seccionTallasAbierta: !abierta });
    });
  },
  "add-cotizacion": function () {
    var fc = state.formCotizacion;
    if (!fc.cliente || !fc.descripcion) return;
    var nueva = { id: uid(), clienteId: fc.clienteId || "", cliente: fc.cliente, descripcion: fc.descripcion, fecha: fc.fecha, referencias: [nuevaReferencia()], gastosReales: [], estado: "borrador", pedidoId: "", iva: { activo: false, porcentaje: 19 }, colapsada: false, vendedor: null, codigoPublico: codigoPublico(), esDemo: false };
    state.cotizaciones.unshift(nueva);
    state.formCotizacion = { clienteId: "", cliente: "", descripcion: "", fecha: todayStr() };
    // Salta directo a Historial para seguir trabajándola ahí — "Nueva
    // cotización" es solo el punto de arranque, no donde se sigue editando.
    state.cotizacionesVista = "historial";
    persist("cotizaciones"); notify();
  },
  "toggle-cot-colapsada": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { colapsada: !c.colapsada }) : c; });
    persist("cotizaciones"); notify();
  },
  // Reversible en los dos sentidos: una cotización de prueba se puede volver
  // real (y al revés) en cualquier momento, sin perder nada de lo cargado —
  // solo cambia si cuenta o no en los cálculos financieros reales (ver
  // origenDeTx-style exclusiones con "esDemo" en core/calc.js).
  "toggle-cot-demo": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { esDemo: !c.esDemo }) : c; });
    persist("cotizaciones"); notify();
  },
  "set-cot-fecha": function (el) {
    var id = el.getAttribute("data-id");
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { fecha: el.value }) : c; });
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
      var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
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
      return Object.assign({}, r, patch);
    });
    // La curva de tallas de la plantilla (si tiene una) queda sugerida en el
    // input de "Tallas y observaciones" de esta referencia, lista para
    // generar las filas con un clic (ver renderDetalleReferencia).
    if (pla.curvaTallas) {
      state.curvaSugerida = Object.assign({}, state.curvaSugerida, { [refId]: pla.curvaTallas });
    }
    // Cada tipo de prenda puede necesitar etapas de producción distintas
    // (ej. sublimación). Si la plantilla trae un flujo asignado, se aplica a
    // la cotización completa (no solo a la referencia) para que la orden de
    // producción salga con las etapas correctas de una vez.
    if (pla.flujoEstadosId) {
      var flujo = (state.plantillasEstados || []).filter(function (f) { return f.id === pla.flujoEstadosId; })[0];
      if (flujo) {
        conRef(cotId, function (c) { return Object.assign({}, c, { estadosDef: flujo.estados.map(function (e) { return { id: e.id, label: e.label }; }) }); });
      }
    }
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
      var estadosDef = (cot.estadosDef && cot.estadosDef.length) ? cot.estadosDef : null;
      var nuevoP = {
        id: uid(), clienteId: cot.clienteId || "", cliente: cot.cliente, tipoCliente: "propio", descripcion: cot.descripcion + (descripcionRefs ? " (" + descripcionRefs + ")" : ""),
        cantidad: String(cantidadTotal), total: totales.precioTotal, abono: 0, fechaEntrega: "", estado: estadosDef ? estadosDef[0].id : "nuevo", cotizacionId: cot.id,
        numeroOp: generarNumeroOp(todosNumerosOp()),
        iva: cot.iva || { activo: false, porcentaje: 19 },
        abonos: [],
        estadosDef: estadosDef,
        // La comisión de vendedor definida en la cotización se traslada al pedido
        // resultante (misma estructura), para que no haya que volver a definirla.
        vendedor: cot.vendedor ? Object.assign({}, cot.vendedor) : null
      };
      state.pedidos.unshift(nuevoP);
      // Se contrae automáticamente para no ocupar tanto espacio; se puede
      // expandir y seguir editando cuando haga falta.
      // Convertir en pedido siempre la vuelve real: no existe el concepto de
      // "pedido de prueba" — si venía marcada como demo, se la desmarca acá.
      state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: nuevoP.id, colapsada: true, esDemo: false }) : c; });
      persist("pedidos"); persist("cotizaciones");
      state.tab = "pedidos";
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
  "toggle-comision-cot": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot || !cot.vendedor || !cot.vendedor.nombre) return;
    var pagando = cot.vendedor.estado !== "pagado";
    if (pagando) {
      var valor = calcComisionValorCot(cot);
      state.tx.unshift({ id: uid(), tipo: "comision", concepto: "Comisión — " + cot.vendedor.nombre, monto: valor, contraparte: cot.vendedor.nombre, fecha: todayStr(), pedidoId: cot.pedidoId || "", cotizacionId: cot.id });
      persist("tx");
    }
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
  // Genera de una vez varias filas de "tallas y observaciones" a partir de
  // una curva tipo "S:2, M:4, L:3" — cada unidad nace con su talla puesta y
  // nombre/número en blanco para completar a mano (útil sobre todo cuando
  // el nombre/número se sabe después, como en uniformes por jugador).
  "generar-curva-tallas": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var card = el.closest(".cot-card");
    var curva = parseCurvaTallas(val(card, "curva-tallas-" + refId));
    if (!curva.length) { window.alert("Escribe la curva como \"S:2, M:4, L:3\" (talla y cantidad separadas por dos puntos)."); return; }
    var filas = [];
    curva.forEach(function (c) {
      for (var i = 0; i < c.cantidad; i++) filas.push({ id: uid(), nombre: "", talla: c.talla, numero: "", tipo: "", observaciones: "" });
    });
    mapRef(cotId, refId, function (r) { return conDetalleAgregado(r, filas); });
    var curvaLimpia = Object.assign({}, state.curvaSugerida); delete curvaLimpia[refId];
    state.curvaSugerida = curvaLimpia;
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
  "import-ref-detalle-csv": function (el) {
    var cotId = el.getAttribute("data-cot"), refId = el.getAttribute("data-ref");
    var file = el.files && el.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var filas = parseDetalleCSV(String(reader.result));
      if (!filas.length) {
        window.alert("No se encontraron filas válidas en el CSV. Revisa que tenga columnas: nombre, talla, numero, tipo, observaciones (y que 'nombre' no esté vacío).");
        return;
      }
      mapRef(cotId, refId, function (r) { return conDetalleAgregado(r, filas); });
    };
    reader.readAsText(file, "UTF-8");
  },
  "descargar-plantilla-csv": function () {
    var contenido = "nombre,talla,numero,tipo,observaciones\nJuan Pérez,M,10,Jugador,\nMaría López,S,7,Arquero,Pedido especial\n";
    var blob = new Blob(["\ufeff" + contenido], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "plantilla-tallas-referencia.csv";
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
    var estadosDef = (cot.estadosDef && cot.estadosDef.length) ? cot.estadosDef : null;
    state.pedidos = state.pedidos.map(function (p) {
      if (p.id !== cot.pedidoOrigenId) return p;
      return Object.assign({}, p, {
        descripcion: cot.descripcion + (descripcionRefs ? " (" + descripcionRefs + ")" : ""),
        cantidad: String(cantidadTotal), total: totales.precioTotal,
        iva: cot.iva || p.iva, estadosDef: estadosDef,
        vendedor: cot.vendedor ? Object.assign({}, cot.vendedor) : p.vendedor
      });
    });
    state.cotizaciones = state.cotizaciones.map(function (c) { return c.id === id ? Object.assign({}, c, { estado: "convertida", pedidoId: cot.pedidoOrigenId, colapsada: true, esDemo: false }) : c; });
    persist("pedidos"); persist("cotizaciones"); notify();
  },
  "toggle-cot-seccion": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    conRef(id, function (c) { var patch = {}; patch[campo] = !c[campo]; return Object.assign({}, c, patch); });
  },
  "set-estado-cot-label": function (el) {
    var id = el.getAttribute("data-id"), idx = Number(el.getAttribute("data-idx"));
    conRef(id, function (c) {
      var estados = ((c.estadosDef && c.estadosDef.length) ? c.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      if (!estados[idx]) return c;
      estados[idx].label = el.value;
      return Object.assign({}, c, { estadosDef: estados });
    });
  },
  "add-estado-cot": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest(".cot-card");
    var nombre = val(card, "nueva-etapa-" + id);
    if (!nombre) return;
    conRef(id, function (c) {
      var estados = ((c.estadosDef && c.estadosDef.length) ? c.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      estados.push({ id: uid(), label: nombre });
      return Object.assign({}, c, { estadosDef: estados });
    });
  },
  "remove-estado-cot": function (el) {
    var id = el.getAttribute("data-id"), idx = Number(el.getAttribute("data-idx"));
    conRef(id, function (c) {
      var estados = ((c.estadosDef && c.estadosDef.length) ? c.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      if (estados.length <= 1) { window.alert("Debe quedar al menos una etapa en el flujo."); return c; }
      estados.splice(idx, 1);
      return Object.assign({}, c, { estadosDef: estados });
    });
  },
  "mover-estado-cot": function (el) {
    var id = el.getAttribute("data-id"), idx = Number(el.getAttribute("data-idx")), dir = Number(el.getAttribute("data-dir"));
    conRef(id, function (c) {
      var estados = ((c.estadosDef && c.estadosDef.length) ? c.estadosDef : ESTADOS_DEFAULT).map(function (e) { return Object.assign({}, e); });
      var nidx = idx + dir;
      if (nidx < 0 || nidx >= estados.length) return c;
      var tmp = estados[idx]; estados[idx] = estados[nidx]; estados[nidx] = tmp;
      return Object.assign({}, c, { estadosDef: estados });
    });
  },
  "resetear-estados-cot": function (el) {
    var id = el.getAttribute("data-id");
    if (!window.confirm('¿Restablecer al flujo de etapas estándar? Se pierden los cambios personalizados de esta cotización (no afecta las plantillas guardadas).')) return;
    conRef(id, function (c) { return Object.assign({}, c, { estadosDef: null }); });
  },
  "guardar-plantilla-estados": function (el) {
    var id = el.getAttribute("data-id");
    var cot = state.cotizaciones.filter(function (c) { return c.id === id; })[0];
    if (!cot) return;
    var estados = (cot.estadosDef && cot.estadosDef.length) ? cot.estadosDef : ESTADOS_DEFAULT;
    var nombre = window.prompt('¿Cómo se llama esta plantilla de etapas? (ej. "Uniformes", "Camisetas simples")');
    if (!nombre) return;
    state.plantillasEstados = (state.plantillasEstados || []).concat([{ id: uid(), nombre: nombre, estados: estados.map(function (e) { return { id: e.id, label: e.label }; }) }]);
    persist("plantillasEstados"); notify();
  },
  "cargar-plantilla-estados": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest(".cot-card");
    var sel = card ? card.querySelector('[data-role="plantilla-estados-sel-' + id + '"]') : null;
    var plantilla = (state.plantillasEstados || []).filter(function (pl) { return pl.id === (sel ? sel.value : ""); })[0];
    if (!plantilla) return;
    conRef(id, function (c) { return Object.assign({}, c, { estadosDef: plantilla.estados.map(function (e) { return { id: e.id, label: e.label }; }) }); });
  }
};

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
