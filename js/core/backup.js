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
import { getAccessToken, getSession } from "./auth.js";
import { SPREADSHEET_ID } from "./google-config.js";

var FOLDER_NAME = "Panel del Taller — respaldos";
var VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

async function driveFetch(path, options) {
  var res = await fetch("https://www.googleapis.com/drive/v3/" + path, Object.assign({}, options, {
    headers: Object.assign({ Authorization: "Bearer " + getAccessToken() }, (options && options.headers) || {})
  }));
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
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

// forzar=true ignora el chequeo de 24h (lo usa el botón "Respaldar ahora" en
// Configuración). Solo el admin lo dispara: es quien tiene acceso real de
// Drive sobre la Sheet (un vendedor no puede copiarla).
export async function respaldarSiCorresponde(forzar) {
  var session = getSession();
  if (!session || session.rol !== "admin") return;
  var ultimo = state.config.ultimoBackupISO;
  if (!forzar && ultimo && (Date.now() - new Date(ultimo).getTime()) < VEINTICUATRO_HORAS_MS) return;
  try {
    var folderId = await obtenerCarpetaRespaldos();
    var fecha = new Date().toISOString().slice(0, 10);
    await driveFetch("files/" + SPREADSHEET_ID + "/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Panel del Taller — datos (respaldo " + fecha + ")", parents: [folderId] })
    });
    state.config.ultimoBackupISO = new Date().toISOString();
    await persist("config");
  } catch (e) {
    console.error("No se pudo hacer el respaldo diario de la Sheet", e);
  }
}
