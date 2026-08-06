// Helpers genéricos y sin estado para hablar con la API REST de Google
// Sheets (v4) usando fetch + un access token ya obtenido. No sabe nada de
// sesión ni de storage: eso lo resuelven auth.js y sheetsStorage.js, que lo
// importan (evita una dependencia circular entre ellos dos).

var BASE = "https://sheets.googleapis.com/v4/spreadsheets/";

async function request(accessToken, path, options) {
  var res = await fetch(BASE + path, Object.assign({}, options, {
    headers: Object.assign({ Authorization: "Bearer " + accessToken }, (options && options.headers) || {})
  }));
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
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

// Nombres de todas las pestañas que ya existen en la Sheet — para saber si
// hay que crear una nueva antes de escribir en ella (ver sheetsAddSheet).
export async function sheetsGetSheetNames(accessToken, spreadsheetId) {
  var data = await request(accessToken, spreadsheetId + "?fields=sheets.properties.title", { method: "GET" });
  return (data.sheets || []).map(function (s) { return s.properties.title; });
}

// Crea una pestaña nueva (vacía) con el nombre dado.
export async function sheetsAddSheet(accessToken, spreadsheetId, title) {
  return request(accessToken, spreadsheetId + ":batchUpdate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: title } } }] })
  });
}
