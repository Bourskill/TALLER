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
    }).catch(function (e) {
      // Si esta lectura falla (sin conexión, token vencido sin poder
      // renovar), NO se deja la promesa en rechazado para siempre: sin este
      // reseteo, un solo fallo en la PRIMERA lectura de toda la sesión
      // (ej. se abre la app ya sin señal) dejaba cargaPendiente atascada en
      // "rechazada" — y como get()/set() siempre esperan esta MISMA
      // promesa, TODO guardado basado en "kv" (la mayoría de las claves:
      // pedidos, cotizaciones, config...) quedaba roto hasta recargar la
      // página a mano, aunque la conexión volviera. El reintento automático
      // de core/guardado.js habría llamado a set() una y otra vez sin que
      // ninguno pudiera funcionar jamás.
      cargaPendiente = null;
      throw e;
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
  },
  // Claves de "kv" que empiezan con un prefijo dado. No cuesta ninguna
  // lectura de red aparte: cargar() ya trae TODA la pestaña "kv" a memoria
  // para cualquier get/set normal, esto solo filtra lo que ya está en
  // caché. Lo usan los borradores en la nube de core/store.js: al recuperar
  // desde OTRO dispositivo no se sabe de antemano cuál cotización tiene un
  // borrador pendiente ahí (cada una tiene su propia clave), así que hace
  // falta poder listarlas por prefijo en vez de pedirlas una por una.
  keysConPrefijo: async function (prefijo) {
    await cargar();
    return Object.keys(valueByKey).filter(function (k) { return k.indexOf(prefijo) === 0 && valueByKey[k]; });
  }
};
