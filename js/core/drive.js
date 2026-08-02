// Sube imágenes de referencia (Cotizaciones → miniatura de cada referencia)
// a UNA carpeta compartida en el Drive del admin — no en el Drive de quien
// las suba — para que todo quede centralizado en la cuenta del taller. Cada
// archivo se deja con permiso "cualquiera con el link puede ver" — así la
// miniatura (<img src>) y el PDF (que las descarga con fetch simple, sin
// token) las pueden mostrar exactamente igual que antes, cuando imagenUrl
// era un link externo pegado a mano.
//
// Nota honesta sobre "queda en mi Drive": Google no deja transferir la
// propiedad de un archivo a otra cuenta personal (@gmail.com) por API sin
// que esa cuenta la acepte a mano — no es algo que se pueda automatizar
// sin un backend propio. Lo que sí se puede automatizar, y es lo que hace
// esto: todos (admin y vendedores) suben SIEMPRE a la misma carpeta, creada
// y compartida por el admin, así que todo queda organizado y visible desde
// la cuenta del admin en un solo lugar aunque un archivo puntual que subió
// un vendedor técnicamente siga contando contra el almacenamiento de esa
// cuenta (no el del admin).
//
// Por eso necesita el scope amplio "drive" (no "drive.file"): un vendedor
// tiene que poder escribir dentro de una carpeta que NO creó él — eso no lo
// permite "drive.file", que solo ve archivos que el propio usuario creó o
// abrió con esta app.

import { state, persist } from "./store.js";
import { getAccessToken, getSession, listarEquipoEmail } from "./auth.js";
import { SPREADSHEET_ID } from "./google-config.js";

var FOLDER_NAME = "Panel del Taller — imágenes";

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

// La carpeta la crea (una sola vez) quien la use primero siendo admin — así
// queda garantizado que vive en la cuenta del admin, no en la de quien
// resulte estar de turno subiendo la primera imagen. Un vendedor que llega
// antes de que exista simplemente ve un mensaje pidiéndole al admin que
// suba la primera imagen (o entre y la cree desde Configuración).
async function obtenerCarpetaCompartida() {
  if (state.config.driveFolderId) return state.config.driveFolderId;

  var session = getSession();
  if (!session || session.rol !== "admin") {
    throw new Error("El admin todavía no configuró la carpeta compartida de Drive para las imágenes. Pídele que suba la primera imagen para crearla.");
  }

  // La carpeta se crea junto a la Google Sheet (misma carpeta que la
  // contiene), no suelta en la raíz de "Mi unidad" — así queda ordenada
  // dentro de la carpeta del proyecto en vez de perdida en otro lugar.
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
  var folderId = creada.id;

  await compartirCarpetaConEquipo(folderId);

  state.config.driveFolderId = folderId;
  await persist("config");
  return folderId;
}

async function compartirCarpetaConEquipo(folderId) {
  var equipo = await listarEquipoEmail();
  await Promise.all(equipo.map(function (email) {
    return driveFetch("files/" + folderId + "/permissions?sendNotificationEmail=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "writer", type: "user", emailAddress: email })
    }).catch(function (e) { console.error("No se pudo compartir la carpeta de Drive con " + email, e); });
  }));
}

// El reparto de arriba solo corre UNA vez, al crear la carpeta — si después
// se agrega un admin o vendedor nuevo a la pestaña "roles", nunca queda
// compartido automáticamente (nadie vuelve a llamar a esa función). Este
// botón ("Actualizar acceso del equipo" en Configuración) lo resuelve: re-
// comparte la carpeta YA EXISTENTE con todos los correos que hoy están en
// "roles", así que agregarlos de nuevo no rompe nada (Drive simplemente
// confirma el permiso que ya tenían).
export async function actualizarAccesoEquipoDrive() {
  var session = getSession();
  if (!session || session.rol !== "admin") throw new Error("Solo el admin puede actualizar los accesos del equipo.");
  if (!state.config.driveFolderId) throw new Error("Todavía no existe la carpeta compartida de Drive — sube una imagen de referencia en Cotizaciones primero para crearla.");
  await compartirCarpetaConEquipo(state.config.driveFolderId);
}

async function hacerPublica(fileId) {
  await driveFetch("files/" + fileId + "/permissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  });
}

// Sube un File (del input) y devuelve la URL lista para usar como imagenUrl.
export async function subirImagenReferencia(file) {
  var folderId = await obtenerCarpetaCompartida();
  var metadata = { name: file.name, parents: [folderId] };
  var boundary = "panel_taller_" + Date.now();
  var buffer = await file.arrayBuffer();
  var body = new Blob([
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n",
    "--" + boundary + "\r\nContent-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n",
    buffer,
    "\r\n--" + boundary + "--"
  ]);

  var res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: "Bearer " + getAccessToken(), "Content-Type": "multipart/related; boundary=" + boundary },
    body: body
  });
  if (!res.ok) {
    var errText = await res.text().catch(function () { return ""; });
    throw new Error("Google Drive API " + res.status + ": " + errText);
  }
  var creado = await res.json();
  await hacerPublica(creado.id);
  // "uc?export=view" (el link "clásico" para hotlinkear Drive) muchas veces
  // ya no sirve para <img src> directo: Google intercala una página de
  // aviso en vez de servir el binario. El dominio de imágenes de Google sí
  // sirve el archivo real y con CORS abierto (lo necesita pdf.js para
  // descargarlo con fetch al armar el PDF).
  return "https://lh3.googleusercontent.com/d/" + creado.id;
}
