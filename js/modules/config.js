// Pestaña "Configuración": datos de marca (nombre + ícono, que se reflejan en
// el PDF) y datos de facturación, más el reporte financiero de solo lectura.
// La nómina, los gastos fijos, la meta y las deudas viven en la pestaña
// "Pendientes" (ver modules/pendientes.js).

import { state, persist, notify } from "../core/store.js";
import { esc, fmt, num, todayStr } from "../core/utils.js";
import {
  calcBalancePeriodo, calcCaja, calcPorCobrar, calcPedidosActivos, calcResumenPorPagar,
  calcResumenMovimientos, calcGastoInsumosMensual
} from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { generarPDFReporteFinanciero } from "../core/pdf.js";
import { respaldarSiCorresponde } from "../core/backup.js";
import { subirImagenReferencia, compartirRecursosConNuevoMiembro } from "../core/drive.js";
import { agregarMiembroEquipo } from "../core/auth.js";

// Único lugar de la app donde se ven los KPIs del negocio (antes se
// repetían arriba de TODAS las pestañas) — reportado como ruido: se
// consolidan acá, junto con el reporte financiero completo.
function renderKpis() {
  var caja = calcCaja(), porCobrar = calcPorCobrar(), activos = calcPedidosActivos();
  var resumenPago = calcResumenPorPagar();
  return '<div class="kpis">' +
    '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="finanzas" title="Ver historial de movimientos"><div class="kpi-label">Caja actual</div><div class="kpi-value ' + (caja < 0 ? "danger" : "success") + '">' + fmt(caja) + '</div><div class="kpi-note">Ingresos y gastos ya pagados</div></div>' +
    '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pedidos" data-filtro-saldo="1" title="Ver pedidos con saldo pendiente"><div class="kpi-label">Por cobrar</div><div class="kpi-value warning">' + fmt(porCobrar) + '</div><div class="kpi-note">Clientes que aún deben</div></div>' +
    renderKpiPorPagar(resumenPago) +
    '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pedidos" title="Ver pedidos activos"><div class="kpi-label">Pedidos activos</div><div class="kpi-value info">' + activos + '</div><div class="kpi-note">Solo pedidos (no cuenta cotizaciones)</div></div>' +
    "</div>";
}
// KPI "Por pagar" inteligente: en vez del total acumulado, muestra lo más
// urgente — obligaciones vencidas (si las hay) o el próximo vencimiento. El
// total general de todo lo pendiente sigue viviendo en Pendientes.
function renderKpiPorPagar(r) {
  if (r.estado === "aldia") {
    return '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pendientes" title="Ver cuentas por pagar"><div class="kpi-label">Por pagar</div><div class="kpi-value success">Al día</div><div class="kpi-note">Sin obligaciones pendientes</div></div>';
  }
  if (r.estado === "vencidas") {
    return '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pendientes" title="Ver cuentas por pagar"><div class="kpi-label">Obligaciones vencidas</div><div class="kpi-value danger">' + fmt(r.monto) + '</div><div class="kpi-note">' + r.cantidad + (r.cantidad === 1 ? " obligación vencida" : " obligaciones vencidas") + "</div></div>";
  }
  var fechaCorta = r.fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }).replace(".", "");
  return '<div class="kpi kpi-clickable" data-action="kpi-nav" data-tab="pendientes" title="Ver cuentas por pagar"><div class="kpi-label">Próximo vencimiento</div><div class="kpi-value warning">' + esc(fechaCorta) + " · " + fmt(r.monto) + '</div><div class="kpi-note">' + r.cantidad + (r.cantidad === 1 ? " obligación" : " obligaciones") + "</div></div>";
}

export function render() {
  var cfg = state.config;

  var html = renderKpis();

  html += '<div class="card"><div class="section-title small">Marca del taller' +
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

  html += '<div class="card"><div class="section-title small">Equipo' +
    renderHelp("Agrega a alguien nuevo (admin o vendedor) en un solo paso desde acá: se guarda en la pestaña \"roles\" de la Sheet Y se le comparte automáticamente la Sheet y la carpeta de imágenes de Drive (si ya existe) — antes había que hacer esas dos cosas a mano, aparte. El único paso que sigue quedando FUERA de la app es agregar su correo como \"test user\" en Google Cloud Console → OAuth consent screen: es una política de Google mientras la app esté en modo Testing, no algo resoluble por API.") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>Correo</label><input type="email" id="inp-equipo-correo" placeholder="correo@gmail.com" /></div>' +
    '<div class="field"><label>Rol</label><select id="inp-equipo-rol"><option value="vendedor" selected>Vendedor</option><option value="admin">Admin</option></select></div>' +
    '<div class="field"><label>Nombre (si es vendedor)</label><input id="inp-equipo-nombre" placeholder="Igual al que usa en Pedidos/Cotizaciones" /></div>' +
    '<button class="btn small" data-action="agregar-miembro-equipo">Agregar al equipo</button>' +
    "</div></div>";

  html += '<div class="card"><div class="section-title small">Respaldo de datos' +
    renderHelp("Copia completa de la Google Sheet (todo lo que gestiona la app) a una carpeta aparte en tu Drive — un respaldo de seguridad, no la base de datos en uso (esa sigue siendo la Sheet). Se actualiza sola como mucho una vez cada 24 horas, al abrir la app, para no generar llamadas de más a la API.") +
    '</div>' +
    '<div class="section-sub" style="margin:0 0 10px;">Último respaldo: <b style="color:var(--ink);">' + (cfg.ultimoBackupISO ? fechaHoraCorta(cfg.ultimoBackupISO) : "Aún no se ha hecho ninguno") + "</b></div>" +
    '<button class="btn ghost small" data-action="respaldar-ahora">Respaldar ahora</button>' +
    "</div>";

  var meta = cfg.meta || { label: "Meta", monto: 0, periodo: "mensual" };
  var metaMonto = num(meta.monto);
  var balancePeriodo = metaMonto > 0 ? calcBalancePeriodo(meta.periodo || "mensual") : 0;
  var progresoMeta = metaMonto > 0 ? Math.max(0, Math.min(100, (balancePeriodo / metaMonto) * 100)) : null;
  if (progresoMeta !== null) {
    html += '<div class="card"><div class="section-title small">Meta' +
      renderHelp("Se define en Pendientes → Meta. Progreso del balance neto dentro de SU PROPIO periodo (no del rango de fechas que elijas abajo en el reporte, que son conceptos independientes).") +
      "</div>" +
      '<div class="report-grid"><div class="report-item"><div class="rl">' + esc(meta.label || "Meta de balance neto") + "</div><div class=\"rv\">" + progresoMeta.toFixed(0) + "% (" + fmt(balancePeriodo) + " de " + fmt(metaMonto) + ")</div></div></div>" +
      "</div>";
  }

  html += renderReportePeriodo();
  html += renderGastoInsumos();
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
      '<button class="ref-thumb-zoom" data-action="abrir-imagen-preview" data-url="' + esc(cfg.pdfPiePaginaImagenUrl) + '" title="Ver en grande">🔍</button>' +
      '<button class="ref-thumb-remove" data-action="quitar-pie-imagen" title="Quitar imagen">✕</button>' +
      "</div>";
  }
  return '<div class="ref-thumb ref-thumb-empty" data-action="set-pie-imagen" title="Subir una imagen desde tu dispositivo (se guarda en tu Google Drive)">+ imagen</div>';
}

// Único panel de reporte financiero (antes había dos: uno con números de
// TODO el histórico, sin relación con el rango de fechas del otro, que solo
// servía para el PDF). Ahora el mismo rango alimenta los números en vivo, la
// gráfica y el PDF — nunca puede pasar que la pantalla y el PDF de un mismo
// periodo digan cosas distintas, porque los tres usan calcResumenMovimientos().
function renderReportePeriodo() {
  var fr = state.formReporte;
  var movimientos = state.tx.filter(function (t) { return t.fecha >= fr.desde && t.fecha <= fr.hasta; });
  var resumen = calcResumenMovimientos(movimientos);
  var html = '<div class="card"><div class="section-title small">Reporte financiero' +
    renderHelp("Elige un rango de fechas (o usa los atajos) — los números y el PDF de abajo son siempre del mismo rango, para que nunca digan cosas distintas entre sí. La gráfica de ingresos/gastos vive en Resumen.") +
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
    "</div>";

  html += '<div class="report-grid" style="margin-top:14px;">' +
    '<div class="report-item"><div class="rl">Ingresos</div><div class="rv" style="color:var(--success-ink);">' + fmt(resumen.ingresos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Gastos</div><div class="rv" style="color:var(--danger-ink);">' + fmt(resumen.gastos) + "</div></div>" +
    '<div class="report-item"><div class="rl">Nómina</div><div class="rv" style="color:var(--warning-ink);">' + fmt(resumen.nomina) + "</div></div>" +
    '<div class="report-item"><div class="rl">Comisiones</div><div class="rv" style="color:var(--info-ink);">' + fmt(resumen.comisiones) + "</div></div>" +
    '<div class="report-item"><div class="rl">Balance neto</div><div class="rv">' + fmt(resumen.balance) + "</div></div>" +
    "</div>";

  html += '<div class="section-sub" style="margin-top:10px;">' + movimientos.length + " movimiento(s) en este rango.</div>";
  html += '<div class="pedido-actions" style="margin-top:6px;">' +
    '<button class="btn" data-action="generar-reporte-pdf">Generar PDF del periodo</button>' +
    '<button class="btn ghost small" data-action="export-csv">Descargar CSV de todos los movimientos</button>' +
    "</div>";
  html += "</div>";
  return html;
}

// "Inventario negativo" (ver calcGastoInsumosMensual en core/calc.js): no
// cuánto insumo hay en stock, sino cuánto se gastó en insumos cada mes —
// para saber cuándo conviene empezar a comprar al por mayor.
function renderGastoInsumos() {
  var meses = calcGastoInsumosMensual();
  var html = '<div class="card"><div class="section-title small">Gasto en insumos por mes' +
    renderHelp("No es un inventario de lo que tenés guardado (no manejás stock) — es cuánto gastaste en insumos cada mes, sumado desde las cotizaciones de ese mes. Sirve para decidir cuándo conviene empezar a comprar al por mayor — ahí sí tendría sentido llevar inventario de verdad.") +
    "</div>";
  if (!meses.length) {
    html += '<div class="empty">Todavía no hay cotizaciones con insumos para reportar.</div></div>';
    return html;
  }
  meses.slice(0, 6).forEach(function (m) {
    html += '<div class="section-sub" style="margin:14px 0 6px;display:flex;justify-content:space-between;">' +
      "<b style=\"color:var(--ink);\">" + esc(etiquetaMes(m.mes)) + "</b><span class=\"amount\">" + fmt(m.total) + "</span></div>";
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
      m.insumos.slice(0, 8).map(function (i) { return '<span class="badge">' + esc(i.nombre) + " · " + fmt(i.costoTotal) + "</span>"; }).join("") +
      "</div>";
  });
  html += "</div>";
  return html;
}
function etiquetaMes(mes) {
  var partes = mes.split("-");
  var meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return meses[Number(partes[1]) - 1] + " " + partes[0];
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
  "agregar-miembro-equipo": async function () {
    var correoEl = document.getElementById("inp-equipo-correo");
    var rolEl = document.getElementById("inp-equipo-rol");
    var nombreEl = document.getElementById("inp-equipo-nombre");
    var correo = correoEl ? correoEl.value.trim() : "";
    var rol = rolEl ? rolEl.value : "vendedor";
    var nombre = nombreEl ? nombreEl.value.trim() : "";
    if (!correo) { window.alert("Escribe un correo."); return; }
    try {
      await agregarMiembroEquipo(correo, rol, nombre);
      await compartirRecursosConNuevoMiembro(correo);
      if (correoEl) correoEl.value = "";
      if (nombreEl) nombreEl.value = "";
      window.alert(
        "Listo — " + correo + " ya está en el equipo (\"roles\") y tiene acceso a la Sheet" +
        (state.config.driveFolderId ? " y a la carpeta de Drive" : "") + ".\n\n" +
        "Último paso, fuera de la app: agregalo como \"test user\" en Google Cloud Console → APIs & Services → OAuth consent screen, para que pueda completar el login con Google."
      );
    } catch (e) {
      window.alert("No se pudo agregar al equipo: " + (e && e.message ? e.message : e));
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
