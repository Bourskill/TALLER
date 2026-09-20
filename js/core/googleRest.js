// Helpers genéricos y sin estado para hablar con la API REST de Google
// Sheets (v4) usando fetch + un access token ya obtenido. No sabe nada de
// sesión ni de storage: eso lo resuelven auth.js y sheetsStorage.js, que lo
// importan (evita una dependencia circular entre ellos dos).

// fetchGoogleConReintento vive en auth.js y no al revés porque es auth.js
// quien sabe CÓMO renovar el token (tokenClient de Google Identity) — este
// archivo solo arma URLs y cuerpos de Sheets. La importación cruzada
// (auth.js también importa de acá, más abajo) es segura: ninguna de las dos
// funciones se invoca mientras los módulos se están cargando, solo después,
// cuando ya está todo resuelto.
import { fetchGoogleConReintento } from "./auth.js";

var BASE = "https://sheets.googleapis.com/v4/spreadsheets/";

async function request(accessToken, path, options) {
  var res = await fetchGoogleConReintento(BASE + path, options, accessToken);
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    if (res.status === 401) throw new Error("Tu sesión de Google venció. Recarga la página e inicia sesión de nuevo.");
    // Un 404 acá (a diferencia de un rango/pestaña mal escrito, que da 400) es
    // casi siempre la Sheet ENTERA inalcanzable: se borró/movió de Drive, o la
    // cuenta con la que entraste no tiene acceso a ella (Google devuelve 404 en
    // vez de 403 para no revelar si el archivo existe). Pasó de verdad en
    // 2026-09 (ver el comentario junto a SPREADSHEET_ID en google-config.js) —
    // el mensaje crudo de la API no decía nada de esto y dejaba a quien lo veía
    // sin ninguna pista de por dónde arrancar.
    if (res.status === 404) {
      throw new Error("No se encontró la Google Sheet de datos (se borró, se movió, o esta cuenta de Google no tiene acceso a ella). Revisa primero la Papelera de Google Drive de la cuenta administradora: si el archivo sigue ahí, restáuralo — recupera el mismo ID y todo vuelve a funcionar sin tocar nada más. Si no aparece, busca en la carpeta \"Panel del Taller — respaldos\" la copia automática más reciente.");
    }
    throw new Error("Google Sheets API " + res.status + ": " + body);
  }
  return res.json();
}

// Lee un rango (ej. "roles!A2:C200") y devuelve values: string[][] (filas x columnas).
export async function sheetsValuesGet(accessToken, spreadsheetId, range) {
  var data = await request(accessToken, spreadsheetId + "/values/" + encodeURIComponent(range), { method: "GET" });
  return data.values || [];
}

// Sobrescribe un rango exacto (ej. "kv!A5:B5") con las filas dadas.
export async function sheetsValuesUpdate(accessToken, spreadsheetId, range, values) {
  return request(accessToken, spreadsheetId + "/values/" + encodeURIComponent(range) + "?valueInputOption=RAW", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: values })
  });
}

// Agrega filas al final de la tabla que empieza en el rango dado (ej. "kv!A:B").
export async function sheetsValuesAppend(accessToken, spreadsheetId, range, values) {
  return request(accessToken, spreadsheetId + "/values/" + encodeURIComponent(range) + ":append?valueInputOption=RAW", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: values })
  });
}

// Borra el contenido de un rango sin borrar la pestaña ni las celdas de
// alrededor (ej. "Movimientos!A2:Z100000") — usado por core/sheetsTabular.js
// para "vaciar y reescribir" una tabla completa en cada guardado, sin dejar
// filas viejas sueltas más abajo si la lista actual tiene menos filas.
export async function sheetsValuesClear(accessToken, spreadsheetId, range) {
  return request(accessToken, spreadsheetId + "/values/" + encodeURIComponent(range) + ":clear", { method: "POST" });
}

// Nombre, id NUMÉRICO (el que pide updateSheetProperties, distinto del
// nombre/título) y tamaño ACTUAL de grilla de cada pestaña — ver
// sheetsAgrandarColumnas abajo y el incidente 2026-09-20 junto a
// asegurarPestana en sheetsTabular.js: escribir en una columna que la
// grilla de la pestaña todavía no tiene (ej. columna 27 cuando Google la
// creó con el tamaño de fábrica de 26) da un 400 "exceeds grid limits",
// no un error de permisos ni de rango mal escrito — hay que agrandar la
// grilla primero, no solo escribir el encabezado.
export async function sheetsGetSheetsInfo(accessToken, spreadsheetId) {
  var data = await request(accessToken, spreadsheetId + "?fields=sheets.properties(sheetId,title,gridProperties.columnCount)", { method: "GET" });
  return (data.sheets || []).map(function (s) {
    return { title: s.properties.title, sheetId: s.properties.sheetId, columnCount: (s.properties.gridProperties || {}).columnCount || 0 };
  });
}

// Crea una pestaña nueva (vacía) con el nombre dado. `columnCount` opcional
// evita que una pestaña recién creada para un esquema con más de 26
// columnas (el tamaño de fábrica de Google) tenga que agrandarse aparte en
// la siguiente escritura — ver sheetsAgrandarColumnas.
export async function sheetsAddSheet(accessToken, spreadsheetId, title, columnCount) {
  var properties = { title: title };
  if (columnCount) properties.gridProperties = { columnCount: columnCount };
  return request(accessToken, spreadsheetId + ":batchUpdate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: properties } }] })
  });
}

// Agranda (NUNCA achica — quien llama debe pasar ya el máximo entre lo
// actual y lo necesario) la cantidad de columnas de la grilla de una
// pestaña existente. Solo toca columnCount a propósito: la cantidad de
// filas no se ha visto nunca como el límite real (ver el comentario en
// sheetsGetSheetsInfo), y agrandarla sin necesidad acerca la Sheet al
// límite total de 10 millones de celdas de Google sin ningún beneficio.
export async function sheetsAgrandarColumnas(accessToken, spreadsheetId, sheetId, columnCount) {
  return request(accessToken, spreadsheetId + ":batchUpdate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: sheetId, gridProperties: { columnCount: columnCount } },
          fields: "gridProperties.columnCount"
        }
      }]
    })
  });
}
