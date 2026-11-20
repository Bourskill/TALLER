// Empezar un periodo nuevo: dejar lo de antes archivado y arrancar de cero
// con pedidos, cotizaciones y dinero, conservando lo que no es «historia»
// (usuarios y roles, clientes, catálogo, productos con su stock, plantillas,
// notas, deudas aún pendientes y la configuración del taller).
//
// Pasos, en este orden (si algo falla a mitad, se puede volver a correr):
//  1. Copia COMPLETA de la hoja en la carpeta de respaldos de Drive, con el
//     nombre «ARCHIVO — periodo hasta <fecha>». Si esto falla, no se toca nada.
//  2. Reescribe la pestaña "kv" con kvParaPeriodoNuevo() (abajo): vacía las
//     listas del periodo, quita los borradores, renueva todas las revisiones
//     "__rev__:*" (así una pestaña abierta en otro computador NO puede volver a
//     escribir sus datos viejos: su guardado choca como conflicto, ver
//     verificarConflicto en core/store.js) y anota la marca "__periodo__".
//  3. Vacía las filas (no los encabezados) de Movimientos, Cotizaciones,
//     Cierres y Bitacora.
//  4. Borra las copias locales de este navegador (core/hojaLocal.js); los
//     demás computadores las borran solos al abrir la app, porque la marca
//     "__periodo__" ya no coincide con la que anotaron.

import { getAccessToken, getSession, fetchGoogleConReintento } from "./auth.js";
import { sheetsValuesGet, sheetsValuesUpdate, sheetsValuesClear, sheetsGetSheetsInfo } from "./googleRest.js";
import { SPREADSHEET_ID } from "./google-config.js";
import { identidadHoja, alinearCopiasConHoja } from "./hojaLocal.js";

export var PERIODO_KEY = "__periodo__";

// Claves de "kv" que son historia del periodo: quedan como lista vacía.
// Incluye las copias viejas de antes de que Movimientos y Cotizaciones
// tuvieran su pestaña propia: si quedaran con datos, la app las tomaría como
// prueba de que la pestaña «perdió» registros (Hallazgo #69).
export var CLAVES_KV_A_VACIAR = [
  "pedidos:lista",
  "pedidos:papelera",
  "finanzas:papelera",
  "finanzas:transferencias",
  "finanzas:transacciones",
  "cotizaciones:lista",
  "pendientes:deudas-historial"
];

// Pestañas con una fila por registro que se vacían (se conserva la fila 1).
export var PESTANAS_A_VACIAR = ["Movimientos", "Cotizaciones", "Cierres", "Bitacora"];

// Recibe las filas de "kv" (sin el encabezado) y devuelve las nuevas.
// Pura (sin red), para poder probarla.
export function kvParaPeriodoNuevo(filas, periodo, nuevaRev) {
  var salida = [];
  var vistoPeriodo = false;
  (filas || []).forEach(function (fila) {
    var key = fila && fila[0];
    if (!key) return;
    var value = fila[1] == null ? "" : String(fila[1]);
    if (key.indexOf("borrador:") === 0) return;
    if (key.indexOf("__rev__:") === 0) { salida.push([key, nuevaRev()]); return; }
    if (key === PERIODO_KEY) { vistoPeriodo = true; salida.push([key, periodo]); return; }
    if (CLAVES_KV_A_VACIAR.indexOf(key) !== -1) { salida.push([key, "[]"]); return; }
    if (key === "config:datos") {
      var cfg;
      try { cfg = JSON.parse(value || "{}"); } catch (e) { cfg = null; }
      if (cfg && typeof cfg === "object") {
        // Apuntan a movimientos que ya no existen en el periodo nuevo.
        cfg.colchonMovimientos = [];
        cfg.conciliaciones = {};
        value = JSON.stringify(cfg);
      }
    }
    salida.push([key, value]);
  });
  if (!vistoPeriodo) salida.push([PERIODO_KEY, periodo]);
  return salida;
}

async function copiarHojaComoArchivo(folderId, fecha) {
  var res = await fetchGoogleConReintento("https://www.googleapis.com/drive/v3/files/" + SPREADSHEET_ID + "/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign(
      { name: "Panel del Taller — ARCHIVO periodo hasta " + fecha },
      folderId ? { parents: [folderId] } : {}
    ))
  });
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    throw new Error("No se pudo hacer la copia de archivo (Drive " + res.status + "): " + body);
  }
  return res.json();
}

function aLetraDeColumna(n) {
  var s = "";
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// opts: { fecha: "AAAA-MM-DD", folderId, nuevaRev: () => string }
export async function iniciarPeriodoNuevo(opts) {
  var session = getSession();
  if (!session || session.rol !== "admin") throw new Error("Solo un admin puede empezar un periodo nuevo.");
  var token = getAccessToken();
  var fecha = opts.fecha;
  var periodo = fecha + "@" + Date.now();

  // 1. Archivo completo (si falla, no se toca nada).
  var archivo = await copiarHojaComoArchivo(opts.folderId, fecha);

  // 2. kv
  var filas = await sheetsValuesGet(token, SPREADSHEET_ID, "kv!A2:B5000");
  var nuevas = kvParaPeriodoNuevo(filas, periodo, opts.nuevaRev);
  await sheetsValuesUpdate(token, SPREADSHEET_ID, "kv!A2:B" + (nuevas.length + 1), nuevas);
  if (filas.length > nuevas.length) {
    await sheetsValuesClear(token, SPREADSHEET_ID, "kv!A" + (nuevas.length + 2) + ":B" + (filas.length + 1));
  }

  // 3. Pestañas propias
  var info = await sheetsGetSheetsInfo(token, SPREADSHEET_ID);
  for (var i = 0; i < PESTANAS_A_VACIAR.length; i++) {
    var nombre = PESTANAS_A_VACIAR[i];
    var p = info.find(function (s) { return s.title === nombre; });
    if (!p) continue;
    var ultima = aLetraDeColumna(Math.max(p.columnCount || 26, 26));
    await sheetsValuesClear(token, SPREADSHEET_ID, nombre + "!A2:" + ultima);
  }

  // 4. Copias locales de este navegador
  alinearCopiasConHoja(identidadHoja(SPREADSHEET_ID, periodo));
  return { archivoId: archivo && archivo.id, archivoNombre: archivo && archivo.name, periodo: periodo };
}
