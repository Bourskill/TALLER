// Adaptador de storage "tabular": lee/escribe un array de objetos como filas
// de su PROPIA pestaña en la Google Sheet, con una columna real por campo —
// a diferencia de core/sheetsStorage.js (usado por store.js para el resto de
// claves), que guarda el array COMPLETO como un solo blob JSON en una celda
// de la pestaña "kv". Esa pestaña "kv" sigue existiendo y sigue sirviendo a
// las claves que todavía no se migraron aquí (ver store.js) — este archivo
// no la toca ni la borra.
//
// Cada entidad (ver ENTIDADES más abajo) define su propio esquema: una lista
// de columnas en orden. Un campo puede ser:
//   - plano: un valor simple (texto/número) → una celda tal cual.
//   - { json: true }: una lista u objeto anidado (ej. los abonos de un
//     pedido) que no encaja en una sola celda como texto plano → se guarda
//     como JSON compacto en su propia columna. Sigue siendo MUCHO más legible
//     que antes (cada registro es una fila con sus campos principales como
//     columnas reales; solo el detalle anidado queda en JSON).
//
// Estrategia de escritura: en cada persist() se BORRA todo el rango de datos
// (fila 2 en adelante) y se reescribe completo con la lista actual — mismo
// costo/patrón que ya usa sheetsStorage.js (siempre guarda el array entero,
// nunca un diff parcial), así que no es un cambio de comportamiento, solo de
// dónde queda visible la información.

import { getAccessToken } from "./auth.js";
import { sheetsValuesGet, sheetsValuesUpdate, sheetsValuesClear, sheetsGetSheetNames, sheetsAddSheet } from "./googleRest.js";
import { SPREADSHEET_ID } from "./google-config.js";

var sheetsExistentesCache = null; // Set de nombres de pestaña ya confirmados — evita
// consultar "¿existe la pestaña?" en cada guardado, solo la primera vez.
var headersVerificados = {}; // nombre de pestaña -> true, una vez confirmado/completado su encabezado esta sesión.

async function asegurarPestana(token, nombre, columnas) {
  if (!sheetsExistentesCache) {
    var nombres = await sheetsGetSheetNames(token, SPREADSHEET_ID);
    sheetsExistentesCache = {};
    nombres.forEach(function (n) { sheetsExistentesCache[n] = true; });
  }
  if (!sheetsExistentesCache[nombre]) {
    await sheetsAddSheet(token, SPREADSHEET_ID, nombre);
    await sheetsValuesUpdate(token, SPREADSHEET_ID, nombre + "!A1:" + letraColumna(columnas.length) + "1", [columnas.map(function (c) { return c.header; })]);
    sheetsExistentesCache[nombre] = true;
    headersVerificados[nombre] = true;
    return;
  }
  // La pestaña ya existía de antes de que el esquema ganara columnas nuevas
  // (ej. origenGastoId/esInsumo en tablaMovimientos): la fila de encabezados
  // de una Sheet real no se reescribe sola, así que hay que completarla a
  // mano o quedarían columnas sin nombre — los DATOS igual se escriben en la
  // posición correcta (el orden lo define `columnas`, no el header), esto es
  // solo para que la fila 1 siga siendo legible si el usuario abre la Sheet
  // directamente. Se revisa una sola vez por pestaña por sesión.
  if (headersVerificados[nombre]) return;
  headersVerificados[nombre] = true;
  var filaActual = await sheetsValuesGet(token, SPREADSHEET_ID, nombre + "!A1:" + letraColumna(columnas.length) + "1");
  var actuales = (filaActual && filaActual[0]) || [];
  if (actuales.length >= columnas.length) return;
  var faltantes = columnas.slice(actuales.length).map(function (c) { return c.header; });
  var rangoFaltante = nombre + "!" + letraColumna(actuales.length + 1) + "1:" + letraColumna(columnas.length) + "1";
  await sheetsValuesUpdate(token, SPREADSHEET_ID, rangoFaltante, [faltantes]);
}

function letraColumna(n) {
  var s = "";
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function celdaDesdeValor(item, col) {
  var v = item[col.key];
  if (col.json) return v === undefined || v === null ? "" : JSON.stringify(v);
  return v === undefined || v === null ? "" : String(v);
}

function valorDesdeCelda(cruda, col) {
  if (col.json) {
    if (!cruda) return col.jsonDefault ? col.jsonDefault() : [];
    try { var v = JSON.parse(cruda); return v == null ? (col.jsonDefault ? col.jsonDefault() : []) : v; }
    catch (e) { return col.jsonDefault ? col.jsonDefault() : []; }
  }
  if (col.numero) return cruda === "" ? 0 : Number(cruda) || 0;
  return cruda || "";
}

// crearTablaSheet(nombrePestana, columnas, opts) -> { leer, escribir }
// columnas: [{ key, header, json?, jsonDefault?, numero? }, ...] en el orden
// exacto en que aparecen como columnas A, B, C... en la Sheet.
// opts.post(item): transforma un item recién leído de sus columnas planas a
//   la forma que espera el resto de la app (ej. reconstruir un objeto
//   anidado a partir de dos columnas sueltas). Opcional.
// opts.pre(item): transforma un item del estado de la app a la forma plana
//   que esperan las columnas ANTES de convertirlo a fila (el inverso de
//   post). Opcional.
export function crearTablaSheet(nombrePestana, columnas, opts) {
  opts = opts || {};
  var rangoDatos = nombrePestana + "!A2:" + letraColumna(columnas.length) + "200000";

  return {
    leer: async function () {
      var token = getAccessToken();
      await asegurarPestana(token, nombrePestana, columnas);
      var filas = await sheetsValuesGet(token, SPREADSHEET_ID, rangoDatos);
      return filas
        .filter(function (fila) { return fila.some(function (c) { return c !== undefined && c !== ""; }); })
        .map(function (fila) {
          var item = {};
          columnas.forEach(function (col, i) { item[col.key] = valorDesdeCelda(fila[i], col); });
          return opts.post ? opts.post(item) : item;
        });
    },
    escribir: async function (items) {
      var token = getAccessToken();
      await asegurarPestana(token, nombrePestana, columnas);
      await sheetsValuesClear(token, SPREADSHEET_ID, rangoDatos);
      if (!items || !items.length) return;
      var filas = items.map(function (itemOriginal) {
        var item = opts.pre ? opts.pre(itemOriginal) : itemOriginal;
        return columnas.map(function (col) { return celdaDesdeValor(item, col); });
      });
      await sheetsValuesUpdate(token, SPREADSHEET_ID, rangoDatos, filas);
    }
  };
}
