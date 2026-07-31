// Adaptador de storage que habla contra la pestaña "kv" de la Google Sheet
// (columnas key, value) en vez de contra el `window.storage` que la app
// esperaba encontrar inyectado (y que en producción nunca existió: ver
// README). Implementa el mismo contrato que store.js y pdf.js ya usan
// (`get(key) -> {value}|null`, `set(key, value)`), así que ningún otro
// archivo necesita cambiar para hablar con Sheets en vez de con la memoria
// del navegador.

import { getAccessToken } from "./auth.js";
import { sheetsValuesGet, sheetsValuesUpdate, sheetsValuesAppend } from "./googleRest.js";
import { SPREADSHEET_ID } from "./google-config.js";

var rowByKey = {}; // key -> número de fila real en la hoja (1-based)
var valueByKey = {}; // key -> value (string JSON), caché en memoria
var cargaPendiente = null; // promesa compartida: una sola lectura de red al iniciar

function cargar() {
  if (!cargaPendiente) {
    cargaPendiente = sheetsValuesGet(getAccessToken(), SPREADSHEET_ID, "kv!A2:B5000").then(function (filas) {
      filas.forEach(function (fila, i) {
        var key = fila[0];
        if (!key) return;
        rowByKey[key] = i + 2; // la fila 1 de la pestaña es el encabezado
        valueByKey[key] = fila[1] || "";
      });
    });
  }
  return cargaPendiente;
}

export var sheetsStorage = {
  get: async function (key) {
    await cargar();
    return key in valueByKey ? { value: valueByKey[key] } : null;
  },
  set: async function (key, value) {
    await cargar();
    valueByKey[key] = value;
    var fila = rowByKey[key];
    if (fila) {
      await sheetsValuesUpdate(getAccessToken(), SPREADSHEET_ID, "kv!A" + fila + ":B" + fila, [[key, value]]);
      return;
    }
    var res = await sheetsValuesAppend(getAccessToken(), SPREADSHEET_ID, "kv!A:B", [[key, value]]);
    var rango = res && res.updates && res.updates.updatedRange; // ej. "kv!A5:B5"
    var m = rango && /![A-Z]+(\d+):/.exec(rango);
    if (m) rowByKey[key] = Number(m[1]);
  }
};
