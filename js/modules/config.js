// Pestaña "Configuración": datos de marca (nombre + ícono, que se reflejan en
// el PDF) y datos de facturación, más el reporte financiero de solo lectura.
// La nómina, los gastos fijos, la meta y las deudas viven en la pestaña
// "Pendientes" (ver modules/pendientes.js).

import { state, persist, notify } from "../core/store.js";
import { esc, fmt, num, todayStr } from "../core/utils.js";
import { calcIngresosTotales, calcGastosTotales, calcNominaPagada, calcCaja, calcGastosFijosMensuales, calcBalancePeriodo } from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { generarPDFReporteFinanciero } from "../core/pdf.js";
import { respaldarSiCorresponde } from "../core/backup.js";
import { subirImagenReferencia, actualizarAccesoEquipoDrive } from "../core/drive.js";

export function render() {
  var cfg = state.config;

  var html = '<div class="card"><div class="section-title small">Marca del taller' +
    renderHelp("El nombre se edita también desde el encabezado del panel. El ícono puede ser un emoji corto (ej. \uD83E\uDDF5) o el link a una imagen — ambos se reflejan en el PDF de cotización.") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>Ícono</label><input id="inp-config-logo" value="' + esc(cfg.logoUrl) + '" placeholder="Emoji o link a imagen" /></div>' +
    '<div class="field wide"><label>Nombre del taller</label><input id="inp-config-nombre" value="' + esc(cfg.nombre) + '" /></div>' +
    "</div>" +
    '<div class="pedido-actions"><button class="btn small" data-action="save-marca">Guardar marca</button></div></div>';

  html += '<div class="card"><div class="section-title small">Datos del negocio para el PDF' +
    renderHelp("Aparecen como remitente (\"DE\") en las cotizaciones, recibos y facturas que generas en PDF para tus clientes. No aparecen en la orden de producción.") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>NIT o cédula</label><input value="' + esc(cfg.nit) + '" data-action-change="set-config-campo" data-campo="nit" /></div>' +
    '<div class="field"><label>Dirección</label><input value="' + esc(cfg.direccion) + '" data-action-change="set-config-campo" data-campo="direccion" /></div>' +
    '<div class="field"><label>Ciudad</label><input value="' + esc(cfg.ciudad) + '" data-action-change="set-config-campo" data-campo="ciudad" /></div>' +
    '<div class="field"><label>Teléfono</label><input value="' + esc(cfg.telefono) + '" data-action-change="set-config-campo" data-campo="telefono" /></div>' +
    "</div></div>";

  html += '<div class="card"><div class="section-title small">Personalización de PDF y correos' +
    renderHelp("La imagen (logo, sello, firma) y el texto del pie de página se imprimen al final de cotizaciones, facturas, recibos y la orden de producción. El color de acento se usa en el encabezado de los correos HTML que le llegan al cliente cuando envías un PDF por correo.") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>Imagen del pie de página (PDF)</label>' + renderPiePaginaImg(cfg) + "</div>" +
    '<div class="field wide"><label>Texto del pie de página (PDF)</label><input value="' + esc(cfg.pdfPiePagina) + '" data-action-change="set-config-campo" data-campo="pdfPiePagina" placeholder="Ej. Garantía de 30 días · Síguenos @criyeak" /></div>' +
    '<div class="field"><label>Color de acento (correos)</label><input type="color" value="' + esc(cfg.colorAcento || "#6a59f0") + '" data-action-change="set-config-campo" data-campo="colorAcento" /></div>' +
    "</div></div>";

  html += '<div class="card"><div class="section-title small">Acceso del equipo a Drive' +
    renderHelp("La carpeta de imágenes de referencia (Cotizaciones) se comparte con todo el equipo (admin y vendedores) automáticamente, pero solo la PRIMERA vez que se crea — si agregas a alguien nuevo en la pestaña \"roles\" DESPUÉS de eso, no queda compartido solo. Este botón vuelve a compartir la carpeta ya existente con todos los correos que hoy están en \"roles\".") +
    '</div>' +
    '<button class="btn ghost small" data-action="actualizar-acceso-equipo">Actualizar acceso del equipo</button>' +
    "</div>";

  html += '<div class="card"><div class="section-title small">Respaldo de datos' +
    renderHelp("Copia completa de la Google Sheet (todo lo que gestiona la app) a una carpeta aparte en tu Drive — un respaldo de seguridad, no la base de datos en uso (esa sigue siendo la Sheet). Se actualiza sola como mucho una vez cada 24 horas, al abrir la app, para no generar llamadas de más a la API.") +
    '</div>' +
    '<div class="section-sub" style="margin:0 0 10px;">Último respaldo: <b style="color:var(--ink);">' + (cfg.ultimoBackupISO ? fechaHoraCorta(cfg.ultimoBackupISO) : "Aún no se ha hecho ninguno") + "</b></div>" +
    '<button class="btn ghost small" data-action="respaldar-ahora">Respaldar ahora</button>' +
    "</div>";

  var ingresos = calcIngresosTotales(), gastos = calcGastosTotales(), nominaPagada = calcNominaPagada(), caja = calcCaja();
  var gastosFijosTotal = calcGastosFijosMensuales();
  var meta = cfg.meta || { label: "Meta", monto: 0, periodo: "mensual" };
  var metaMonto = num(meta.monto);
  var balancePeriodo = metaMonto > 0 ? calcBalancePeriodo(meta.periodo || "mensual") : 0;
  var progresoMeta = metaMonto > 0 ? Math.max(0, Math.min(100, (balancePeriodo / metaMonto) * 100)) : null;

  html += '<div class="card"><div class="section-title small">Reporte financiero' +
    renderHelp("Balance con todos los movimientos registrados hasta hoy (sin importar el rango de fechas de abajo).") +
    "</div>";
  html += '<div class="report-grid">' +
    '<div class="report-item"><div class="rl">Ingresos totales</div><div class="rv" style="color:var(--success-ink);">' + fmt(ingresos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Gastos totales</div><div class="rv" style="color:var(--danger-ink);">' + fmt(gastos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Nómina pagada</div><div class="rv" style="color:var(--warning-ink);">' + fmt(nominaPagada) + "</div></div>" +
    '<div class="report-item"><div class="rl">Gastos fijos (mensualizado)</div><div class="rv" style="color:var(--info-ink);">' + fmt(gastosFijosTotal) + "</div></div>" +
    '<div class="report-item"><div class="rl">Balance neto (caja)</div><div class="rv">' + fmt(caja) + "</div></div>" +
    (progresoMeta !== null ? '<div class="report-item"><div class="rl">' + esc(meta.label || "Meta de balance neto") + "</div><div class=\"rv\">" + progresoMeta.toFixed(0) + "% (" + fmt(balancePeriodo) + " de " + fmt(metaMonto) + ")</div></div>" : "") +
    "</div>" +
    '<div class="pedido-actions"><button class="btn ghost small" data-action="export-csv">Descargar CSV de movimientos</button></div>' +
    "</div>";

  html += renderReportePeriodo();
  return html;
}

// Igual patrón que la miniatura de imagen de referencia en Cotizaciones
// (renderThumb en cotizaciones.js): sube a la misma carpeta compartida de
// Drive del admin, con un estado "Subiendo…" mientras tanto.
function renderPiePaginaImg(cfg) {
  if (state.configPiePaginaSubiendo) {
    return '<div class="ref-thumb ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</div>';
  }
  if (cfg.pdfPiePaginaImagenUrl) {
    return '<div class="ref-thumb" data-action="set-pie-imagen" title="Clic para subir otra imagen desde tu dispositivo">' +
      '<img src="' + esc(cfg.pdfPiePaginaImagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-remove" data-action="quitar-pie-imagen" title="Quitar imagen">✕</button>' +
      "</div>";
  }
  return '<div class="ref-thumb ref-thumb-empty" data-action="set-pie-imagen" title="Subir una imagen desde tu dispositivo (se guarda en tu Google Drive)">+ imagen</div>';
}

// Selector de rango de fechas para el reporte en PDF — mismos atajos de
// periodo que usa Nómina (semana/quincena/mes actual) más fechas de corte
// personalizadas, para poder revisar "lo que hice cierta semana o mes".
function renderReportePeriodo() {
  var fr = state.formReporte;
  var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
  var html = '<div class="card"><div class="section-title small">Reporte financiero en PDF' +
    renderHelp("Elige un rango de fechas (o usa los atajos) y descarga un PDF con el detalle de movimientos de ese periodo y sus totales — útil para saber qué pasó en una semana, un mes, o entre dos fechas de corte específicas.") +
    "</div>";
  html += '<div class="filters" style="margin-bottom:10px;">' +
    ["hoy", "semana", "mes", "año"].map(function (k) {
      var label = { hoy: "Hoy", semana: "Esta semana", mes: "Este mes", "año": "Este año" }[k];
      return '<button class="chip" data-action="set-reporte-atajo" data-val="' + k + '">' + label + "</button>";
    }).join("") +
    "</div>";
  html += '<div class="form-grid">' +
    '<div class="field"><label>Desde</label><input type="date" data-form="reporte" data-field="desde" value="' + esc(fr.desde) + '" /></div>' +
    '<div class="field"><label>Hasta</label><input type="date" data-form="reporte" data-field="hasta" value="' + esc(fr.hasta) + '" /></div>' +
    '<div class="field"><label>&nbsp;</label><button class="btn" data-action="generar-reporte-pdf">Generar PDF del periodo</button></div>' +
    "</div>";
  html += '<div class="section-sub" style="margin-top:8px;">' + movimientos.length + " movimiento(s) en este rango.</div>";
  html += "</div>";
  return html;
}

export var actions = {
  "set-config-campo": function (el) {
    state.config[el.getAttribute("data-campo")] = el.value;
    persist("config"); notify();
  },
  "save-marca": function () {
    var logoEl = document.getElementById("inp-config-logo");
    var nombreEl = document.getElementById("inp-config-nombre");
    state.config.logoUrl = logoEl ? logoEl.value.trim() : state.config.logoUrl;
    state.config.nombre = (nombreEl && nombreEl.value.trim()) || "Mi Taller";
    persist("config"); notify();
  },
  "export-csv": function () {
    exportCSV();
  },
  "set-reporte-atajo": function (el) {
    var hoy = new Date();
    var desde, hasta = todayStr();
    var k = el.getAttribute("data-val");
    if (k === "hoy") {
      desde = todayStr();
    } else if (k === "semana") {
      var d = new Date(hoy);
      var diaSemana = (d.getDay() + 6) % 7; // lunes = 0
      d.setDate(d.getDate() - diaSemana);
      desde = isoDate(d);
    } else if (k === "mes") {
      desde = isoDate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    } else if (k === "año") {
      desde = isoDate(new Date(hoy.getFullYear(), 0, 1));
    }
    state.formReporte = { desde: desde, hasta: hasta };
    notify();
  },
  "generar-reporte-pdf": async function () {
    var fr = state.formReporte;
    if (!fr.desde || !fr.hasta) { window.alert("Elige una fecha de inicio y una de corte."); return; }
    var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
    var etiqueta = fr.desde === fr.hasta ? fr.desde : (fr.desde + " a " + fr.hasta);
    await generarPDFReporteFinanciero(movimientos, fr.desde, fr.hasta, etiqueta);
  },
  "respaldar-ahora": async function () {
    await respaldarSiCorresponde(true);
    notify();
  },
  "actualizar-acceso-equipo": async function () {
    try {
      await actualizarAccesoEquipoDrive();
      window.alert("Listo — la carpeta de Drive se volvió a compartir con todos los correos que están hoy en la pestaña \"roles\".");
    } catch (e) {
      window.alert("No se pudo actualizar el acceso: " + (e && e.message ? e.message : e));
    }
  },
  "set-pie-imagen": function () {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.configPiePaginaSubiendo = true;
      notify();
      try {
        var url = await subirImagenReferencia(file);
        state.configPiePaginaSubiendo = false;
        state.config.pdfPiePaginaImagenUrl = url;
        persist("config"); notify();
      } catch (e) {
        state.configPiePaginaSubiendo = false;
        window.alert("No se pudo subir la imagen a Drive: " + (e && e.message ? e.message : e));
        notify();
      }
    });
    input.click();
  },
  "quitar-pie-imagen": function () {
    state.config.pdfPiePaginaImagenUrl = "";
    persist("config"); notify();
  }
};

function fechaHoraCorta(iso) {
  return new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
}

function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function exportCSV() {
  try {
    var rows = [["Fecha", "Tipo", "Concepto", "Persona/Cliente", "Monto"]];
    state.tx.forEach(function (t) {
      rows.push([t.fecha, t.tipo, t.concepto, t.contraparte || "", t.monto]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "balance-" + todayStr() + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("No se pudo exportar CSV", e);
  }
}
