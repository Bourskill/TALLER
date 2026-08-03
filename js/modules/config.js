// Pestaña "Configuración": datos de marca (nombre + ícono, que se reflejan en
// el PDF), datos de facturación, equipo y respaldo. Los KPIs y el reporte
// financiero viven en Resumen (ver modules/resumen.js) — acá es donde se
// configura el taller, no donde se consultan los números del día a día. La
// nómina, los gastos fijos, la meta y las deudas viven en la pestaña
// "Pendientes" (ver modules/pendientes.js).

import { state, persist, notify } from "../core/store.js";
import { esc, fmt, num } from "../core/utils.js";
import { calcBalancePeriodo } from "../core/calc.js";
import { renderHelp } from "../core/components.js";
import { respaldarSiCorresponde } from "../core/backup.js";
import { subirImagenReferencia, compartirRecursosConNuevoMiembro } from "../core/drive.js";
import { agregarMiembroEquipo } from "../core/auth.js";

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
      renderHelp("Se define en Pendientes → Meta. Progreso del balance neto dentro de SU PROPIO periodo (no del rango de fechas del reporte financiero de Resumen, que son conceptos independientes).") +
      "</div>" +
      '<div class="report-grid"><div class="report-item"><div class="rl">' + esc(meta.label || "Meta de balance neto") + "</div><div class=\"rv\">" + progresoMeta.toFixed(0) + "% (" + fmt(balancePeriodo) + " de " + fmt(metaMonto) + ")</div></div></div>" +
      "</div>";
  }

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
