// Respaldo de seguridad de la Google Sheet que actúa como base de datos
// (ver core/sheetsStorage.js): una copia COMPLETA del archivo, hecha con
// Drive API ("files.copy"), cae en una carpeta aparte del Drive del admin —
// "Panel del Taller — respaldos". No reemplaza la Sheet en uso (esa sigue
// siendo la fuente real): es solo una foto de seguridad.
//
// Sin backend propio, "cada 24h" solo es posible como un chequeo oportunista:
// cada vez que el admin abre la app, si ya pasaron 24h desde el último
// respaldo, se dispara uno nuevo. Si un día nadie abre la app, ese día no hay
// respaldo nuevo (la Sheet real no corre ningún riesgo, solo se atrasa la
// copia) — la alternativa (un respaldo verdaderamente diario sin depender de
// que alguien entre) necesitaría un Google Apps Script con disparador de
// tiempo, fuera de este código.

import { state, persist } from "./store.js";
import { getSession, fetchGoogleConReintento } from "./auth.js";
import { SPREADSHEET_ID } from "./google-config.js";
import { todayStr } from "./utils.js";

var FOLDER_NAME = "Panel del Taller — respaldos";
var VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

async function driveFetch(path, options) {
  var res = await fetchGoogleConReintento("https://www.googleapis.com/drive/v3/" + path, options);
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    if (res.status === 401) throw new Error("Tu sesión de Google venció. Recarga la página e inicia sesión de nuevo.");
    throw new Error("Google Drive API " + res.status + ": " + body);
  }
  return res.json();
}

// Misma carpeta padre que la carpeta de imágenes de Drive (ver
// obtenerCarpetaCompartida en core/drive.js): al lado de la Sheet, no suelta
// en la raíz de "Mi unidad".
async function obtenerCarpetaRespaldos() {
  if (state.config.backupFolderId) return state.config.backupFolderId;
  var sheetMeta = await driveFetch("files/" + SPREADSHEET_ID + "?fields=parents", { method: "GET" });
  var carpetaPadre = sheetMeta.parents && sheetMeta.parents[0];
  var creada = await driveFetch("files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign(
      { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
      carpetaPadre ? { parents: [carpetaPadre] } : {}
    ))
  });
  state.config.backupFolderId = creada.id;
  await persist("config");
  return creada.id;
}

function copiarSheetA(folderId, fecha) {
  return driveFetch("files/" + SPREADSHEET_ID + "/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Panel del Taller — datos (respaldo " + fecha + ")", parents: [folderId] })
  });
}

// Un 404 acá, con el id de la carpeta adentro del mensaje ("File not
// found: <id>"), significa que backupFolderId quedó apuntando a una
// carpeta que ya no existe en Drive (mismo patrón que config.driveFolderId
// en core/drive.js — ver el incidente 2026-09 en el README, ese mismo
// bug real apareció primero ahí).
function esCarpetaInexistente(e, folderId) {
  var msg = (e && e.message) || "";
  return msg.indexOf("404") !== -1 && msg.indexOf(folderId) !== -1;
}

// forzar=true ignora el chequeo de 24h (lo usa el botón "Respaldar ahora" en
// Configuración). Solo el admin lo dispara: es quien tiene acceso real de
// Drive sobre la Sheet (un vendedor no puede copiarla).
//
// Antes esta función se tragaba cualquier error (solo console.error) sin
// importar si venía del chequeo automático al abrir la app o de un clic real
// en "Respaldar ahora" — así que si el respaldo llevaba tiempo fallando
// (permisos, cuota, lo que sea), nadie se enteraba nunca: "Último respaldo"
// se quedaba en "Aún no se ha hecho ninguno" para siempre y ni un clic manual
// lo delataba (ver incidente 2026-09 en el README: se creyó que había un
// respaldo automático protegiendo la Sheet y en realidad nunca se había
// confirmado que corriera). Ahora el error se PROPAGA (no se atrapa acá): el
// llamador automático de app.js lo sigue silenciando (no tiene sentido
// interrumpir un login con una alerta por un respaldo en segundo plano), pero
// el botón "Respaldar ahora" en config.js sí lo muestra — es la única forma
// de que alguien note un respaldo roto ANTES de necesitarlo de verdad.
export async function respaldarSiCorresponde(forzar) {
  var session = getSession();
  if (!session || session.rol !== "admin") return;
  var ultimo = state.config.ultimoBackupISO;
  if (!forzar && ultimo && (Date.now() - new Date(ultimo).getTime()) < VEINTICUATRO_HORAS_MS) return;
  var folderId = await obtenerCarpetaRespaldos();
  // Fecha local (todayStr), no UTC: el nombre del respaldo tiene que decir
  // el día que el usuario vio en pantalla, no el del meridiano de Greenwich.
  var fecha = todayStr();
  try {
    await copiarSheetA(folderId, fecha);
  } catch (e) {
    if (!esCarpetaInexistente(e, folderId)) throw e;
    // La carpeta de respaldos se borró por fuera de la app: se olvida el id
    // muerto, se recrea desde cero (mismo camino que la primera vez) y se
    // reintenta UNA vez, en vez de quedar rota hasta que alguien lo note.
    state.config.backupFolderId = "";
    await persist("config");
    var folderIdNuevo = await obtenerCarpetaRespaldos();
    await copiarSheetA(folderIdNuevo, fecha);
  }
  state.config.ultimoBackupISO = new Date().toISOString();
  await persist("config");
}
