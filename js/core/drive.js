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
import { getSession, listarEquipoEmail, fetchGoogleConReintento } from "./auth.js";
import { SPREADSHEET_ID } from "./google-config.js";

var FOLDER_NAME = "Panel del Taller — imágenes";

async function driveFetch(path, options) {
  var res = await fetchGoogleConReintento("https://www.googleapis.com/drive/v3/" + path, options);
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    if (res.status === 401) throw new Error("Tu sesión de Google venció. Recarga la página e inicia sesión de nuevo.");
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

function compartirArchivoConEmail(fileId, email) {
  return driveFetch("files/" + fileId + "/permissions?sendNotificationEmail=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "writer", type: "user", emailAddress: email })
  }).catch(function (e) { console.error("No se pudo compartir " + fileId + " con " + email, e); });
}

async function compartirCarpetaConEquipo(folderId) {
  var equipo = await listarEquipoEmail();
  await Promise.all(equipo.map(function (email) { return compartirArchivoConEmail(folderId, email); }));
}

// Comparte la Google Sheet (base de datos) y, si ya existe, la carpeta de
// imágenes con UN correo nuevo — se llama junto con auth.js:
// agregarMiembroEquipo() desde Configuración → "Equipo", para que agregar a
// alguien sea un solo paso en vez de tener que compartir la Sheet a mano
// aparte. Antes esto solo se resolvía compartiendo una vez al crear la
// carpeta (o con un botón aparte de "actualizar acceso") — ahora pasa en el
// momento de agregar a la persona, así que ese botón manual ya no hace falta.
export async function compartirRecursosConNuevoMiembro(email) {
  var tareas = [compartirArchivoConEmail(SPREADSHEET_ID, email)];
  if (state.config.driveFolderId) tareas.push(compartirArchivoConEmail(state.config.driveFolderId, email));
  await Promise.all(tareas);
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

  var res = await fetchGoogleConReintento("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": "multipart/related; boundary=" + boundary },
    body: body
  });
  if (!res.ok) {
    var errText = await res.text().catch(function () { return ""; });
    if (res.status === 401) throw new Error("Tu sesión de Google venció mientras subías la imagen. Recarga la página, inicia sesión de nuevo y vuelve a subirla.");
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
