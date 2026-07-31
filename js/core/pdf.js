// jsPDF y su plugin autotable se cargan como <script> clásicos en index.html
// (no como módulo ES) y quedan disponibles en window.jspdf. Este archivo solo
// arma el documento a partir de una cotización ya calculada por core/calc.js.

import { state } from "./store.js";
import { calcCotizacionTotales, calcRefTotales, clienteById, calcCotResultadoReal, calcListaCompras, calcCotGastoVariacion, calcComisionValorCot, calcSaldoPedido, estadoLabelDe } from "./calc.js";
import { KEYS, ESTADO_LABEL } from "./constants.js";
import { num, slugify } from "./utils.js";

// Formatea dinero igual que el resto de la app ($1.234). Para cantidades (no
// dinero) usamos numFmt, que no antepone el símbolo de pesos.
function money(n) { return "$" + Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 }); }
function numFmt(n) { return Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 }); }

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

export async function generarPDFCotizacion(cot) {
  if (!window.jspdf) {
    window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet).");
    return;
  }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var pageW = doc.internal.pageSize.getWidth();
  var marginX = 42;
  var y = 54;

  var n = await siguienteNumeroPdf();
  var docNum = "COT" + String(n).padStart(4, "0");

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
  doc.text("N.º " + docNum, pageW - marginX, y - 13, { align: "right" });
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

  var nombreSeguro = slugify(cot.descripcion || "cotizacion");
  doc.save(docNum + "-" + nombreSeguro + ".pdf");
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
  doc.text("Periodo: " + etiquetaPeriodo + "  (" + desde + " a " + hasta + ")", pageW - marginX, y, { align: "right" });
  y += 20;

  var ingresos = 0, gastos = 0, nomina = 0, comisiones = 0;
  movimientos.forEach(function (t) {
    var v = num(t.monto);
    if (t.tipo === "ingreso") ingresos += v;
    else if (t.tipo === "nomina") { gastos += v; nomina += v; }
    else if (t.tipo === "comision") { gastos += v; comisiones += v; }
    else gastos += v;
  });
  var balance = ingresos - gastos;

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

  doc.save(docNum + "-reporte-financiero-" + slugify(etiquetaPeriodo) + ".pdf");
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

  var nombreSeguro = slugify(p.descripcion || "pedido");
  doc.save(docNum + "-orden-" + nombreSeguro + ".pdf");
}

// PDF de RECIBO DE ABONO: uno por cada abono registrado, para claridad con el cliente.
export async function generarPDFRecibo(p, abono) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var n = await siguienteNumeroPdf();
  var docNum = "REC" + String(n).padStart(4, "0");
  var head = drawHeaderBasic(doc, "RECIBO DE ABONO", docNum);
  var pageW = head.pageW, marginX = head.marginX, y = head.y;
  var cfg = state.config;

  y = drawParties(doc, y, marginX, pageW, negocioLinesFrom(cfg), [p.cliente, "OP: " + (p.numeroOp || "—")].filter(Boolean), "RECIBIDO DE");

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

  var nombreSeguro = slugify(p.cliente || "recibo");
  doc.save(docNum + "-recibo-" + nombreSeguro + ".pdf");
}

// PDF de FACTURA: documento final, con desglose (si viene de una cotización
// usa sus referencias como líneas), IVA si aplica, y saldo pendiente/pagado.
export async function generarPDFFactura(p) {
  if (!window.jspdf) { window.alert("No se pudo cargar el generador de PDF (revisa tu conexión a internet)."); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "pt", format: "letter" });
  var n = await siguienteNumeroPdf();
  var docNum = "FAC" + String(n).padStart(4, "0");
  var head = drawHeaderBasic(doc, "FACTURA", docNum);
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

  var nombreSeguro = slugify(p.cliente || "factura");
  doc.save(docNum + "-factura-" + nombreSeguro + ".pdf");
}
