// jsPDF y su plugin autotable se cargan como <script> clásicos en index.html
// (no como módulo ES) y quedan disponibles en window.jspdf. Este archivo solo
// arma el documento a partir de una cotización ya calculada por core/calc.js.

import { state, persist } from "./store.js";
import { calcCotizacionTotales, calcRefTotales, clienteById, calcCotResultadoReal, calcListaCompras, calcCotGastoVariacion, calcComisionValorCot, calcSaldoPedido, estadoLabelDe, calcResumenMovimientos, calcGastoInsumosMensual } from "./calc.js";
import { KEYS, ESTADO_LABEL } from "./constants.js";
import { num, slugify, codigoPublico } from "./utils.js";

// Formatea dinero igual que el resto de la app ($1.234). Para cantidades (no
// dinero) usamos numFmt, que no antepone el símbolo de pesos.
function money(n) { return "$" + Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 }); }
function numFmt(n) { return Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 }); }

// Los PDF que le van al cliente (cotización, factura, recibo — no los
// internos ni los reportes) terminan acá: por defecto se descargan como
// siempre, pero con opts.enviarPorCorreo devuelven los bytes en vez de
// descargar, para adjuntarlos a un correo (ver "Enviar por correo" en
// Cotizaciones/Pedidos y core/gmail.js).
function finalizarPDF(doc, nombreArchivo, opts) {
  if (opts && opts.enviarPorCorreo) {
    return { bytes: doc.output("arraybuffer"), nombreArchivo: nombreArchivo };
  }
  doc.save(nombreArchivo);
  return null;
}

// Los documentos que le llegan al cliente (cotización, factura, recibo) NO
// muestran el N.º de PDF secuencial ni el N.º de OP interno — en su lugar
// usan un código corto no secuencial (ver utils.js: codigoPublico()) para
// que nadie pueda deducir cuántos documentos se han generado. Se genera UNA
// sola vez y se guarda en el propio pedido/cotización; si un registro viejo
// (de antes de esta función) todavía no lo tiene, se genera y se guarda acá
// mismo para que quede estable de ahí en adelante.
async function asegurarCodigoPublico(obj, persistKey) {
  if (obj.codigoPublico) return obj.codigoPublico;
  obj.codigoPublico = codigoPublico();
  await persist(persistKey);
  return obj.codigoPublico;
}

// Pie de página opcional (Configuración → Personalización de PDF), impreso
// centrado al final de los documentos que salen del taller (cliente o piso
// de producción) — imagen/vector (logo, sello, firma...) arriba, y debajo el
// texto libre, si hay alguno de los dos. Ver DEFAULT_CONFIG.pdfPiePagina /
// pdfPiePaginaImagenUrl. cargarImagenDataUrl() ya es best-effort (si la
// imagen falla o tarda, simplemente no se incluye) así que esto nunca
// bloquea la generación del PDF.
async function drawPiePagina(doc, y, marginX, pageW) {
  var imgUrl = (state.config.pdfPiePaginaImagenUrl || "").trim();
  if (imgUrl) {
    var durl = await cargarImagenDataUrl(imgUrl);
    if (durl) {
      var anchoImg = 90; // ancho fijo discreto: es un pie de página, no debe dominar la hoja
      var altoImg = anchoImg;
      try {
        var props = doc.getImageProperties(durl);
        if (props && props.width && props.height) altoImg = anchoImg * (props.height / props.width);
      } catch (e) { /* se usa el alto por defecto */ }
      var pageH = doc.internal.pageSize.getHeight();
      if (y + 20 + altoImg > pageH - 30) { doc.addPage(); y = 54; }
      try {
        doc.addImage(durl, formatoImagen(durl), pageW / 2 - anchoImg / 2, y + 10, anchoImg, altoImg);
        y += altoImg + 10;
      } catch (e) { /* imagen no soportada, se omite sin bloquear el PDF */ }
    }
  }
  var pie = (state.config.pdfPiePagina || "").trim();
  if (pie) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(160, 160, 160);
    var lineas = doc.splitTextToSize(pie, pageW - marginX * 2);
    lineas.forEach(function (l) { y += 12; doc.text(l, pageW / 2, y, { align: "center" }); });
  }
  return y;
}

var STORAGE_OK = typeof window.storage !== "undefined" && window.storage !== null;

async function siguienteNumeroPdf() {
  if (!STORAGE_OK) return 1;
  try {
    var r = await window.storage.get(KEYS.pdfContador, false);
    var n = r ? Number(r.value) + 1 : 1;
    await window.storage.set(KEYS.pdfContador, String(n), false);
    return n;
  } catch (e) {
    return 1;
  }
}

function formatoImagen(dataUrl) {
  var m = /^data:image\/(png|jpe?g|webp);/i.exec(dataUrl || "");
  if (!m) return "JPEG";
  var f = m[1].toUpperCase();
  return f === "JPG" ? "JPEG" : f;
}

// Descarga best-effort: si la imagen falla, tarda mucho o el host bloquea CORS,
// simplemente no se incluye en el PDF — nunca bloquea la generación.
function cargarImagenDataUrl(url) {
  if (!url) return Promise.resolve(null);
  var fetchPromise = fetch(url, { mode: "cors" })
    .then(function (res) { return res.ok ? res.blob() : null; })
    .then(function (blob) {
      if (!blob || blob.type.indexOf("image/") !== 0) return null;
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(blob);
      });
    })
    .catch(function () { return null; });
  var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 5000); });
  return Promise.race([fetchPromise, timeout]);
}

export async function generarPDFCotizacion(cot, opts) {
  if (!window.jspdf) {
    window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet).");
    return;
  }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var pageW = doc.internal.pageSize.getWidth();
  var marginX = 42;
  var y = 54;

  var codigo = await asegurarCodigoPublico(cot, "cotizaciones");

  var cfg = state.config;
  var logo = (cfg.logoUrl || "").trim();
  var logoEsImagen = /^(https?:|data:)/.test(logo);
  var logoDataUrl = logoEsImagen ? await cargarImagenDataUrl(logo) : null;
  var tituloX = marginX;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, formatoImagen(logoDataUrl), marginX, y - 24, 30, 30);
      tituloX = marginX + 40;
    } catch (e) { /* si falla, se omite el logo sin bloquear el PDF */ }
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(21);
  doc.setTextColor(20, 20, 20);
  doc.text("COTIZACIÓN", tituloX, y);

  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(110, 110, 110);
  doc.text("N.º " + codigo, pageW - marginX, y - 13, { align: "right" });
  var fecha = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
  doc.text("Fecha  " + fecha, pageW - marginX, y, { align: "right" });

  y += 22;
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(1);
  doc.line(marginX, y, pageW - marginX, y);
  y += 24;

  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(140, 140, 140);
  doc.text("DE", marginX, y);
  doc.text("PARA", pageW / 2 + 14, y);
  y += 14;

  var clienteInfo = cot.clienteId ? clienteById(cot.clienteId) : null;
  var nombreConIcono = (logo && !logoEsImagen ? logo + " " : "") + cfg.nombre;
  var negocioLines = [nombreConIcono, cfg.nit && ("NIT/CC " + cfg.nit), cfg.direccion, cfg.ciudad, cfg.telefono].filter(Boolean);
  var clienteLines = [
    cot.cliente,
    clienteInfo && clienteInfo.cedula && ("NIT/CC " + clienteInfo.cedula),
    clienteInfo && clienteInfo.direccion,
    clienteInfo && clienteInfo.ciudad,
    clienteInfo && clienteInfo.telefono
  ].filter(Boolean);

  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(30, 36, 32);
  var yA = y, yB = y;
  (negocioLines.length ? negocioLines : ["—"]).forEach(function (l) { doc.text(String(l), marginX, yA); yA += 14; });
  (clienteLines.length ? clienteLines : ["—"]).forEach(function (l) { doc.text(String(l), pageW / 2 + 14, yB); yB += 14; });
  y = Math.max(yA, yB) + 14;

  var refs = (cot.referencias || []).map(function (ref) { return { ref: ref, calc: calcRefTotales(ref) }; });
  var totales = calcCotizacionTotales(cot);
  var imagenes = await Promise.all(refs.map(function (r) { return cargarImagenDataUrl(r.ref.imagenUrl); }));
  // La cantidad y la referencia (nombre) son datos clave para el cliente: viven
  // en `ref`, no en `calc` (que solo trae precios/costos), así que se leen de ahí.
  var filas = refs.map(function (r) {
    return ["", numFmt(r.ref.cantidadPedida), r.ref.nombre || "Referencia", money(r.calc.precioUnit), money(r.calc.precioTotal)];
  });

  doc.autoTable({
    startY: y,
    head: [["", "CANTIDAD", "REFERENCIA", "PRECIO POR UNIDAD", "TOTAL DE LA LÍNEA"]],
    body: filas,
    styles: { font: "helvetica", fontSize: 10, textColor: [30, 30, 30], cellPadding: 7, minCellHeight: 32, valign: "middle" },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    margin: { left: marginX, right: marginX },
    columnStyles: { 0: { cellWidth: 34 }, 1: { halign: "center", cellWidth: 60 }, 3: { halign: "right" }, 4: { halign: "right" } },
    didDrawCell: function (data) {
      if (data.section === "body" && data.column.index === 0) {
        var durl = imagenes[data.row.index];
        if (durl) {
          try {
            doc.addImage(durl, formatoImagen(durl), data.cell.x + 3, data.cell.y + 3, 26, 26);
          } catch (e) { /* imagen no soportada, se omite */ }
        }
      }
    }
  });

  // El IVA es opcional y se define en la propia cotización (ver "iva" en
  // cotizaciones.js: casilla + porcentaje). Si no está activo, no se cobra.
  var ivaActivo = !!(cot.iva && cot.iva.activo);
  var ivaPct = ivaActivo ? num(cot.iva.porcentaje) : 0;
  var ivaMonto = ivaActivo ? totales.precioTotal * (ivaPct / 100) : 0;
  var totalConIva = totales.precioTotal + ivaMonto;

  var finalY = doc.lastAutoTable.finalY + 26;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(80, 80, 80);
  doc.text("SUBTOTAL", pageW - marginX - 160, finalY);
  doc.text(money(totales.precioTotal), pageW - marginX, finalY, { align: "right" });
  finalY += 16;
  doc.text(ivaActivo ? ("IVA " + ivaPct + "%") : "IVA (no aplica)", pageW - marginX - 160, finalY);
  doc.text(money(ivaMonto), pageW - marginX, finalY, { align: "right" });
  finalY += 6;
  doc.setDrawColor(190, 190, 190);
  doc.line(pageW - marginX - 160, finalY + 6, pageW - marginX, finalY + 6);
  finalY += 24;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
  doc.text("TOTAL", pageW - marginX - 160, finalY);
  doc.text(money(totalConIva), pageW - marginX, finalY, { align: "right" });

  finalY += 60;
  doc.setFont("helvetica", "italic"); doc.setFontSize(11); doc.setTextColor(120, 120, 120);
  doc.text("Gracias por su confianza", pageW / 2, finalY, { align: "center" });
  await drawPiePagina(doc, finalY, marginX, pageW);

  var nombreSeguro = slugify(cot.descripcion || "cotizacion");
  return finalizarPDF(doc, codigo.replace("#", "") + "-" + nombreSeguro + ".pdf", opts);
}

// ---------- helpers compartidos por los demás PDFs (pedido, recibo, factura, interno) ----------

function drawHeaderBasic(doc, titulo, docNum) {
  var pageW = doc.internal.pageSize.getWidth();
  var marginX = 42;
  var y = 54;
  doc.setFont("helvetica", "bold"); doc.setFontSize(21); doc.setTextColor(20, 20, 20);
  doc.text(titulo, marginX, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(110, 110, 110);
  doc.text("N.º " + docNum, pageW - marginX, y - 13, { align: "right" });
  var fecha = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
  doc.text("Fecha  " + fecha, pageW - marginX, y, { align: "right" });
  y += 22;
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(1);
  doc.line(marginX, y, pageW - marginX, y);
  y += 24;
  return { pageW: pageW, marginX: marginX, y: y };
}

function drawParties(doc, y, marginX, pageW, negocioLines, otherLines, otherTitle) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(140, 140, 140);
  doc.text("DE", marginX, y);
  doc.text(otherTitle, pageW / 2 + 14, y);
  y += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(30, 36, 32);
  var yA = y, yB = y;
  (negocioLines.length ? negocioLines : ["—"]).forEach(function (l) { doc.text(String(l), marginX, yA); yA += 14; });
  (otherLines.length ? otherLines : ["—"]).forEach(function (l) { doc.text(String(l), pageW / 2 + 14, yB); yB += 14; });
  return Math.max(yA, yB) + 14;
}

function negocioLinesFrom(cfg) {
  var logo = (cfg.logoUrl || "").trim();
  var logoEsImagen = /^(https?:|data:)/.test(logo);
  var nombreConIcono = (logo && !logoEsImagen ? logo + " " : "") + cfg.nombre;
  return [nombreConIcono, cfg.nit && ("NIT/CC " + cfg.nit), cfg.direccion, cfg.ciudad, cfg.telefono].filter(Boolean);
}

// Reporte financiero en PDF para un rango de fechas (fechas de corte, igual
// que se piensa el periodo de pago de Nómina): lista los movimientos de ese
// rango con sus totales por tipo, más el balance neto del periodo.
export async function generarPDFReporteFinanciero(movimientos, desde, hasta, etiquetaPeriodo) {
  var jsPDFCtor = window.jspdf.jsPDF;
  var doc = new jsPDFCtor({ unit: "pt", format: "letter" });
  var docNum = String(await siguienteNumeroPdf()).padStart(4, "0");
  var h = drawHeaderBasic(doc, "REPORTE FINANCIERO", docNum);
  var y = h.y, marginX = h.marginX, pageW = h.pageW;

  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
  doc.text((state.config.nombre || "Mi Taller"), marginX, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
  // etiquetaPeriodo YA es "desde a hasta" (o solo la fecha si es un único
  // día) — armado en resumen.js a partir de los mismos campos del
  // formulario. Repetir "(desde a hasta)" acá al lado imprimía la misma
  // fecha dos veces seguidas en el PDF.
  doc.text("Periodo: " + etiquetaPeriodo, pageW - marginX, y, { align: "right" });
  y += 20;

  var resumen = calcResumenMovimientos(movimientos);
  var ingresos = resumen.ingresos, gastos = resumen.gastos, nomina = resumen.nomina, comisiones = resumen.comisiones, balance = resumen.balance;

  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60);
  var resumenY = y;
  [["Ingresos", money(ingresos)], ["Gastos", money(gastos)], ["Nómina", money(nomina)], ["Comisiones", money(comisiones)], ["Balance neto", money(balance)]].forEach(function (item, i) {
    var colW = (pageW - marginX * 2) / 5;
    var x = marginX + colW * i;
    doc.setTextColor(140, 140, 140); doc.setFontSize(7.5); doc.text(item[0].toUpperCase(), x, resumenY);
    doc.setTextColor(20, 20, 20); doc.setFontSize(11); doc.text(item[1], x, resumenY + 15);
  });
  y = resumenY + 34;
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(1);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;

  var body = movimientos
    .slice()
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); })
    .map(function (t) {
      return [t.fecha || "—", t.tipo, t.concepto || "—", t.contraparte || "—", (t.tipo === "ingreso" ? "+" : "-") + money(t.monto)];
    });

  doc.autoTable({
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [["Fecha", "Tipo", "Concepto", "Persona", "Monto"]],
    body: body.length ? body : [["—", "—", "Sin movimientos en este periodo", "—", "—"]],
    styles: { font: "helvetica", fontSize: 8.5, textColor: [40, 40, 40], cellPadding: 5 },
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 4: { halign: "right" } },
    theme: "grid"
  });

  y = doc.lastAutoTable.finalY + 26;
  var pageH = doc.internal.pageSize.getHeight();

  // Gasto en insumos por mes — mismo cálculo que el panel en vivo de Resumen
  // (calcGastoInsumosMensual), acotado a los meses dentro del rango del
  // reporte para que el PDF y la pantalla nunca cuenten periodos distintos.
  var mesDesde = desde.slice(0, 7), mesHasta = hasta.slice(0, 7);
  var mesesInsumos = calcGastoInsumosMensual().filter(function (m) { return m.mes >= mesDesde && m.mes <= mesHasta; });

  if (mesesInsumos.length) {
    if (y + 40 > pageH - 60) { doc.addPage(); y = 54; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text("GASTO EN INSUMOS POR MES", marginX, y);
    y += 18;

    var filasInsumos = [];
    mesesInsumos.forEach(function (m) {
      filasInsumos.push([m.mes, "TOTAL DEL MES", money(m.total)]);
      m.insumos.forEach(function (i) { filasInsumos.push(["", i.nombre, money(i.costoTotal)]); });
    });
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [["Mes", "Insumo", "Costo"]],
      body: filasInsumos,
      styles: { font: "helvetica", fontSize: 8.5, textColor: [40, 40, 40], cellPadding: 5 },
      headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: { 2: { halign: "right" } },
      didParseCell: function (data) {
        if (data.row.raw && data.row.raw[1] === "TOTAL DEL MES") data.cell.styles.fontStyle = "bold";
      },
      theme: "grid"
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  doc.save(docNum + "-reporte-financiero-" + slugify(etiquetaPeriodo) + ".pdf");
}


// Reporte en PDF para UN vendedor (pestaña "Mis ventas"): sus pedidos y
// cotizaciones con el estado de su comisión en cada uno, más el resumen de
// totales. Mismo patrón que generarPDFReporteFinanciero pero la fuente de
// filas es state.pedidos/cotizaciones filtrados por vendedor, no state.tx.
export async function generarPDFReporteVendedor(nombreVendedor, filas, resumen) {
  var jsPDFCtor = window.jspdf.jsPDF;
  var doc = new jsPDFCtor({ unit: "pt", format: "letter" });
  var docNum = String(await siguienteNumeroPdf()).padStart(4, "0");
  var h = drawHeaderBasic(doc, "REPORTE DE VENTAS", docNum);
  var y = h.y, marginX = h.marginX, pageW = h.pageW;

  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
  doc.text("Vendedor: " + nombreVendedor, marginX, y);
  y += 20;

  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60);
  var resumenY = y;
  [["Total vendido", money(resumen.totalVendido)], ["Comisión pendiente", money(resumen.comisionPendiente)], ["Comisión pagada", money(resumen.comisionPagada)]].forEach(function (item, i) {
    var colW = (pageW - marginX * 2) / 3;
    var x = marginX + colW * i;
    doc.setTextColor(140, 140, 140); doc.setFontSize(7.5); doc.text(item[0].toUpperCase(), x, resumenY);
    doc.setTextColor(20, 20, 20); doc.setFontSize(11); doc.text(item[1], x, resumenY + 15);
  });
  y = resumenY + 34;
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(1);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;

  var body = filas.map(function (f) {
    return [f.cliente || "—", f.descripcion || "—", money(f.total), money(f.comision), f.pagado ? "Pagada" : "Pendiente"];
  });

  doc.autoTable({
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [["Cliente", "Descripción", "Total", "Comisión", "Estado"]],
    body: body.length ? body : [["—", "Sin pedidos ni cotizaciones registrados", "—", "—", "—"]],
    styles: { font: "helvetica", fontSize: 8.5, textColor: [40, 40, 40], cellPadding: 5 },
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
    theme: "grid"
  });

  doc.save(docNum + "-reporte-" + slugify(nombreVendedor) + ".pdf");
}

export async function generarPDFInternoCotizacion(cot, opts) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  opts = opts || {};
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var n = await siguienteNumeroPdf();
  var docNum = "INT" + String(n).padStart(4, "0");
  var head = drawHeaderBasic(doc, "COTIZACIÓN — USO INTERNO", docNum);
  var pageW = head.pageW, marginX = head.marginX, y = head.y;

  var totales = calcCotizacionTotales(cot);
  var real = calcCotResultadoReal(cot);

  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(140, 140, 140);
  doc.text("CLIENTE", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(30, 36, 32);
  doc.text(String(cot.cliente || "—"), marginX, y);
  y += 14;
  doc.text(String(cot.descripcion || ""), marginX, y);
  y += 26;

  if (opts.general) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text("Resumen", marginX, y); y += 16;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 60, 60);
    [
      "Costo total estimado: " + money(totales.costoTotal),
      "Precio total cotizado: " + money(totales.precioTotal),
      "Ganancia estimada: " + money(totales.gananciaTotal) + " (" + totales.margenPct.toFixed(1) + "%)",
      "Costo total real: " + money(real.costoTotal),
      "Ganancia real: " + money(real.gananciaTotal) + " (" + real.margenPct.toFixed(1) + "%)"
    ].forEach(function (l) { doc.text(l, marginX, y); y += 15; });
    y += 10;
  }

  if (opts.referencias && (cot.referencias || []).length) {
    var filasRef = (cot.referencias || []).map(function (ref) {
      var c = calcRefTotales(ref);
      return [ref.nombre || "—", numFmt(ref.cantidadPedida), money(c.costoUnit), money(c.precioUnit), c.margenPct.toFixed(1) + "%", money(c.costoTotal), money(c.precioTotal)];
    });
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text("Referencias", marginX, y); y += 8;
    doc.autoTable({
      startY: y,
      head: [["Referencia", "Cant.", "Costo x1", "Precio x1", "Margen", "Costo total", "Precio total"]],
      body: filasRef,
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontSize: 8 },
      margin: { left: marginX, right: marginX }
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  if (opts.compras) {
    var compras = calcListaCompras(cot);
    if (compras.length) {
      if (y > 640) { doc.addPage(); y = 54; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
      doc.text("Lista de compras", marginX, y); y += 8;
      doc.autoTable({
        startY: y,
        head: [["Insumo", "Cantidad a comprar", "Costo total"]],
        body: compras.map(function (c) { return [c.nombre, c.tipo === "fijo_pedido" ? "servicio" : (numFmt(c.cantidadFisica) + " " + c.unidad), money(c.costoTotal)]; }),
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontSize: 8 },
        margin: { left: marginX, right: marginX }
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  if (opts.reales) {
    var gastos = cot.gastosReales || [];
    if (gastos.length) {
      if (y > 640) { doc.addPage(); y = 54; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
      doc.text("Costos reales registrados", marginX, y); y += 8;
      doc.autoTable({
        startY: y,
        head: [["Concepto", "Fecha", "Monto", "Variación"]],
        body: gastos.map(function (g) {
          var variacion = calcCotGastoVariacion(cot, g);
          return [g.concepto + (g.destino === "insumo" ? " — " + g.destinoNombre : " — total"), g.fecha, money(g.monto), (variacion >= 0 ? "+" : "-") + money(Math.abs(variacion))];
        }),
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontSize: 8 },
        margin: { left: marginX, right: marginX }
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  if (opts.vendedor && cot.vendedor && cot.vendedor.nombre) {
    if (y > 700) { doc.addPage(); y = 54; }
    var valorCom = calcComisionValorCot(cot);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text("Comisión vendedor", marginX, y); y += 16;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 60, 60);
    var etiquetaCom = cot.vendedor.tipo === "fijo" ? "valor fijo" : (cot.vendedor.valor + "%");
    doc.text(cot.vendedor.nombre + " — " + etiquetaCom + " = " + money(valorCom) + " (" + (cot.vendedor.estado === "pagado" ? "pagada" : "pendiente") + ")", marginX, y);
    y += 20;
  }

  var nombreSeguro = slugify(cot.descripcion || "cotizacion");
  doc.save(docNum + "-interno-" + nombreSeguro + ".pdf");
}

// PDF de ORDEN DE PRODUCCIÓN: confirma lo que el cliente aceptó y sirve para
// imprimir y entregar a colaboradores (tallas/observaciones), sin precios.
// La orden de producción es un documento de TALLER, no de oficina: lo puede
// ver cualquiera del equipo en el piso de producción. Por eso NO lleva datos
// del negocio ni del cliente (nombre, dirección, teléfono, cédula/NIT) —
// solo lo que hace falta para coser: número de OP, entrega, estado, tallas/
// observaciones, y ahora también las imágenes de referencia de la cotización
// (si el pedido viene de una), para que quede clarísimo qué se está haciendo.
export async function generarPDFPedido(p) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var n = await siguienteNumeroPdf();
  var docNum = "PED" + String(n).padStart(4, "0");
  var head = drawHeaderBasic(doc, "ORDEN DE PRODUCCIÓN", docNum);
  var pageW = head.pageW, marginX = head.marginX, y = head.y, pageH = doc.internal.pageSize.getHeight();

  // Ya no se imprime "ESTADO: COTIZACIÓN" para pedidos que aún no avanzan de
  // etapa — ese id de estado ahora se llama "Nuevo" (ver constants.js), y en
  // su lugar se indica el origen (producción propia o de un tercero), que es
  // el dato que de verdad le sirve a quien está en el piso de producción.
  var origen = p.tipoCliente === "tercero" ? "TERCERO" : "PRODUCCIÓN PROPIA";
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(140, 140, 140);
  doc.text("OP: " + (p.numeroOp || "—") + (p.fechaEntrega ? "   ·   ENTREGA: " + p.fechaEntrega : "") + "   ·   " + origen + "   ·   ETAPA: " + estadoLabelDe(p).toUpperCase(), marginX, y);
  y += 22;

  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
  doc.text(p.descripcion || "", marginX, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(110, 110, 110);
  doc.text("Cantidad total: " + (p.cantidad || "—"), marginX, y);
  y += 24;

  // El detalle de tallas/observaciones vive en la cotización de origen (por
  // referencia), no en el pedido — así un pedido con varias referencias
  // distintas mantiene sus listados separados.
  var cot = p.cotizacionId ? state.cotizaciones.filter(function (c) { return c.id === p.cotizacionId; })[0] : null;
  var refs = cot ? (cot.referencias || []) : [];
  var multiplesRefs = refs.length > 1;
  var detalle = [];
  refs.forEach(function (ref) {
    (ref.detalle || []).forEach(function (d) { detalle.push(Object.assign({ _ref: ref.nombre || "" }, d)); });
  });

  if (detalle.length) {
    doc.autoTable({
      startY: y,
      head: multiplesRefs
        ? [["#", "Referencia", "Nombre", "Talla", "Número", "Tipo", "Observaciones"]]
        : [["#", "Nombre", "Talla", "Número", "Tipo", "Observaciones"]],
      body: detalle.map(function (d, i) {
        return multiplesRefs
          ? [i + 1, d._ref || "—", d.nombre || "—", d.talla || "—", d.numero || "—", d.tipo || "—", d.observaciones || "—"]
          : [i + 1, d.nombre || "—", d.talla || "—", d.numero || "—", d.tipo || "—", d.observaciones || "—"];
      }),
      styles: { font: "helvetica", fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontSize: 8.5 },
      margin: { left: marginX, right: marginX }
    });
    y = doc.lastAutoTable.finalY + 24;
  } else {
    doc.setFont("helvetica", "italic"); doc.setFontSize(10); doc.setTextColor(140, 140, 140);
    doc.text("Sin filas de detalle (tallas/observaciones) registradas.", marginX, y);
    y += 24;
  }

  if (p.observacionesGenerales) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
    doc.text("OBSERVACIONES GENERALES", marginX, y); y += 13;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60);
    var obsLines = doc.splitTextToSize(String(p.observacionesGenerales), pageW - marginX * 2);
    obsLines.forEach(function (l) { doc.text(l, marginX, y); y += 13; });
    y += 12;
  }

  // ---------- Imágenes de referencia (de la cotización, si el pedido viene de una) ----------
  var refsConImagen = refs.filter(function (r) { return r.imagenUrl; });
  if (refsConImagen.length) {
    var anchoImg = 141.73; // ~5cm de ancho; el alto se calcula según la proporción real de cada imagen
    var margenInferior = 50;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
    if (y + 20 > pageH - margenInferior) { doc.addPage(); y = 54; }
    doc.text("IMÁGENES DE REFERENCIA", marginX, y); y += 18;
    for (var i = 0; i < refsConImagen.length; i++) {
      var ref = refsConImagen[i];
      var durl = await cargarImagenDataUrl(ref.imagenUrl);
      if (!durl) continue;
      var altoImg = anchoImg; // fallback cuadrado si no se puede leer la proporción real
      try {
        var props = doc.getImageProperties(durl);
        if (props && props.width && props.height) altoImg = anchoImg * (props.height / props.width);
      } catch (e) { /* se usa el alto por defecto */ }
      if (y + 14 + altoImg > pageH - margenInferior) { doc.addPage(); y = 54; }
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
      doc.text(ref.nombre || ("Referencia " + (i + 1)), marginX, y);
      y += 8;
      try {
        doc.addImage(durl, formatoImagen(durl), marginX, y, anchoImg, altoImg);
      } catch (e) { /* imagen no soportada, se omite sin bloquear el PDF */ }
      y += altoImg + 20;
    }
  }

  doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(150, 150, 150);
  if (y + 14 > pageH - 30) { doc.addPage(); y = 54; }
  doc.text("Documento de uso interno para producción — no incluye precios ni datos del cliente.", marginX, y);
  await drawPiePagina(doc, y, marginX, pageW);

  var nombreSeguro = slugify(p.descripcion || "pedido");
  doc.save(docNum + "-orden-" + nombreSeguro + ".pdf");
}

// PDF de RECIBO DE ABONO: uno por cada abono registrado, para claridad con el cliente.
export async function generarPDFRecibo(p, abono, opts) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var codigo = await asegurarCodigoPublico(p, "pedidos");
  var head = drawHeaderBasic(doc, "RECIBO DE ABONO", codigo);
  var pageW = head.pageW, marginX = head.marginX, y = head.y;
  var cfg = state.config;

  y = drawParties(doc, y, marginX, pageW, negocioLinesFrom(cfg), [p.cliente].filter(Boolean), "RECIBIDO DE");

  var saldoActual = calcSaldoPedido(p);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(60, 60, 60);
  [
    "Pedido: " + (p.descripcion || "—"),
    "Fecha del abono: " + (abono.fecha || "—"),
    "Método de pago: " + (abono.metodoPago || "—")
  ].forEach(function (l) { doc.text(l, marginX, y); y += 16; });
  y += 14;

  doc.setDrawColor(210, 210, 210); doc.line(marginX, y, pageW - marginX, y); y += 24;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(80, 80, 80);
  doc.text("VALOR RECIBIDO", marginX, y);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(20, 20, 20);
  doc.text(money(abono.monto), pageW - marginX, y, { align: "right" });
  y += 26;

  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(80, 80, 80);
  doc.text("Total del pedido", marginX, y);
  doc.text(money(p.total), pageW - marginX, y, { align: "right" });
  y += 16;
  doc.text("Saldo pendiente", marginX, y);
  doc.text(money(saldoActual), pageW - marginX, y, { align: "right" });

  y += 60;
  doc.setFont("helvetica", "italic"); doc.setFontSize(11); doc.setTextColor(120, 120, 120);
  doc.text("Gracias por su pago", pageW / 2, y, { align: "center" });
  await drawPiePagina(doc, y, marginX, pageW);

  var nombreSeguro = slugify(p.cliente || "recibo");
  return finalizarPDF(doc, codigo.replace("#", "") + "-recibo-" + nombreSeguro + ".pdf", opts);
}

// PDF de FACTURA: documento final, con desglose (si viene de una cotización
// usa sus referencias como líneas), IVA si aplica, y saldo pendiente/pagado.
export async function generarPDFFactura(p, opts) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var codigo = await asegurarCodigoPublico(p, "pedidos");
  var head = drawHeaderBasic(doc, "FACTURA", codigo);
  var pageW = head.pageW, marginX = head.marginX, y = head.y;
  var cfg = state.config;
  var clienteInfo = p.clienteId ? clienteById(p.clienteId) : null;
  var clienteLines = [p.cliente, clienteInfo && clienteInfo.cedula && ("NIT/CC " + clienteInfo.cedula), clienteInfo && clienteInfo.direccion, clienteInfo && clienteInfo.ciudad].filter(Boolean);

  y = drawParties(doc, y, marginX, pageW, negocioLinesFrom(cfg), clienteLines, "PARA");

  var cot = p.cotizacionId ? state.cotizaciones.filter(function (c) { return c.id === p.cotizacionId; })[0] : null;
  var filas;
  if (cot && (cot.referencias || []).length) {
    filas = cot.referencias.map(function (ref) {
      var c = calcRefTotales(ref);
      return [numFmt(ref.cantidadPedida), ref.nombre || "Referencia", money(c.precioUnit), money(c.precioTotal)];
    });
  } else {
    filas = [[String(p.cantidad || 1), p.descripcion || "Pedido", money(num(p.total) / (num(p.cantidad) || 1)), money(p.total)]];
  }

  doc.autoTable({
    startY: y,
    head: [["CANTIDAD", "DESCRIPCIÓN", "VALOR UNITARIO", "TOTAL"]],
    body: filas,
    styles: { font: "helvetica", fontSize: 10, textColor: [30, 30, 30], cellPadding: 7 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    margin: { left: marginX, right: marginX },
    columnStyles: { 0: { halign: "center", cellWidth: 70 }, 2: { halign: "right" }, 3: { halign: "right" } }
  });

  var ivaActivo = !!(p.iva && p.iva.activo);
  var ivaPct = ivaActivo ? num(p.iva.porcentaje) : 0;
  var subtotal = num(p.total);
  var ivaMonto = ivaActivo ? subtotal * (ivaPct / 100) : 0;
  var totalConIva = subtotal + ivaMonto;
  var saldo = calcSaldoPedido(p);

  var finalY = doc.lastAutoTable.finalY + 26;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(80, 80, 80);
  [["SUBTOTAL", money(subtotal)], [ivaActivo ? ("IVA " + ivaPct + "%") : "IVA (no aplica)", money(ivaMonto)]].forEach(function (row) {
    doc.text(row[0], pageW - marginX - 160, finalY);
    doc.text(row[1], pageW - marginX, finalY, { align: "right" });
    finalY += 16;
  });
  doc.setDrawColor(190, 190, 190);
  doc.line(pageW - marginX - 160, finalY + 6, pageW - marginX, finalY + 6);
  finalY += 24;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
  doc.text("TOTAL", pageW - marginX - 160, finalY);
  doc.text(money(totalConIva), pageW - marginX, finalY, { align: "right" });
  finalY += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(80, 80, 80);
  doc.text("Abonado", pageW - marginX - 160, finalY);
  doc.text(money(p.abono), pageW - marginX, finalY, { align: "right" });
  finalY += 16;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(saldo > 0 ? 190 : 30, saldo > 0 ? 60 : 140, 40);
  doc.text(saldo > 0 ? "SALDO PENDIENTE" : "PAGADO COMPLETO", pageW - marginX - 160, finalY);
  doc.text(money(saldo), pageW - marginX, finalY, { align: "right" });

  finalY += 60;
  doc.setFont("helvetica", "italic"); doc.setFontSize(11); doc.setTextColor(120, 120, 120);
  doc.text("Gracias por su confianza", pageW / 2, finalY, { align: "center" });
  await drawPiePagina(doc, finalY, marginX, pageW);

  var nombreSeguro = slugify(p.cliente || "factura");
  return finalizarPDF(doc, codigo.replace("#", "") + "-factura-" + nombreSeguro + ".pdf", opts);
}

// PDF de REMISIÓN: sustento de qué se entregó/recibió en UNA entrega puntual
// de consignación (un pedido puede acumular varias remisiones en el tiempo —
// cada reposición de stock al punto genera la suya, ver modules/pedidos.js
// "Agregar remisión"). No es una factura: los valores son de referencia para
// dejar constancia de lo entregado — el cobro real nace cuando el punto
// reporte ventas. Termina con dos líneas en blanco para firma, como soporte
// físico de que el punto recibió conforme.
export async function generarPDFRemision(p, remision, opts) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var codigo = remision.codigoPublico || codigoPublico();
  var head = drawHeaderBasic(doc, "REMISIÓN", codigo);
  var pageW = head.pageW, marginX = head.marginX, y = head.y;
  var cfg = state.config;
  var clienteInfo = p.clienteId ? clienteById(p.clienteId) : null;
  var clienteLines = [p.cliente, clienteInfo && clienteInfo.direccion, clienteInfo && clienteInfo.ciudad, clienteInfo && clienteInfo.telefono].filter(Boolean);

  y = drawParties(doc, y, marginX, pageW, negocioLinesFrom(cfg), clienteLines, "PARA (punto de consignación)");

  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(110, 110, 110);
  doc.text("Pedido: " + (p.numeroOp || "—") + (remision.fecha ? "   ·   Fecha: " + remision.fecha : "") + (remision.nota ? "   ·   " + remision.nota : ""), marginX, y);
  y += 20;

  var items = remision.items || [];
  var totalRef = items.reduce(function (a, it) { return a + num(it.cantidad) * num(it.precioUnitario); }, 0);
  doc.autoTable({
    startY: y,
    head: [["PRODUCTO", "TALLA", "CANTIDAD", "VALOR REF.", "SUBTOTAL"]],
    body: items.map(function (it) {
      return [it.productoNombre || "—", it.talla || "—", numFmt(it.cantidad), money(it.precioUnitario), money(num(it.cantidad) * num(it.precioUnitario))];
    }),
    styles: { font: "helvetica", fontSize: 10, textColor: [30, 30, 30], cellPadding: 7 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    margin: { left: marginX, right: marginX },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "right" }, 4: { halign: "right" } }
  });

  var finalY = doc.lastAutoTable.finalY + 22;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
  doc.text("VALOR DE REFERENCIA TOTAL", marginX, finalY);
  doc.text(money(totalRef), pageW - marginX, finalY, { align: "right" });
  finalY += 20;
  doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
  var nota = doc.splitTextToSize("Documento de entrega en consignación — no es una factura. El cobro nace solo cuando el punto reporte ventas reales.", pageW - marginX * 2);
  nota.forEach(function (l) { finalY += 12; doc.text(l, marginX, finalY); });

  finalY += 46;
  var pageH = doc.internal.pageSize.getHeight();
  if (finalY + 60 > pageH - 60) { doc.addPage(); finalY = 54; }
  doc.setDrawColor(160, 160, 160);
  doc.line(marginX, finalY, marginX + 200, finalY);
  doc.line(pageW - marginX - 200, finalY, pageW - marginX, finalY);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90);
  doc.text("Recibido conforme — firma", marginX, finalY + 14);
  doc.text("Nombre y fecha", pageW - marginX - 200, finalY + 14);
  finalY += 40;
  await drawPiePagina(doc, finalY, marginX, pageW);

  var nombreSeguro = slugify(p.cliente || "remision");
  return finalizarPDF(doc, codigo.replace("#", "") + "-remision-" + nombreSeguro + ".pdf", opts);
}
