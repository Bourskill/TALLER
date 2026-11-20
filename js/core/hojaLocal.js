// Copias locales atadas a UNA hoja de Google y a UN periodo de datos.
//
// Todo lo que la app deja en el navegador (espejo local, cola de guardado,
// borradores, cola de la bitácora, acuse de pestaña vacía — ver
// core/guardado.js, core/bitacora.js y core/store.js) es una copia de los
// datos de la hoja que se estaba usando. Esas claves NO llevan el ID de la
// hoja ni el periodo en el nombre: si cambia SPREADSHEET_ID
// (core/google-config.js) o el admin arranca un periodo nuevo (core/periodo.js
// vacía la hoja y deja la marca "__periodo__" en "kv"), la app tomaría las
// copias viejas como «evidencia» de datos perdidos y los reviviría (barra roja
// de pestaña vacía, recuperación del espejo, reintentos de la cola).
//
// Por eso, antes de cargar nada, se compara la identidad (hoja + periodo) que
// anotó ESTE navegador con la actual: si son distintas, se borran todas las
// copias locales de la app (prefijo "taller_") y se anota la nueva. La sesión
// de Google vive en sessionStorage y no se toca.
//
// Un navegador que nunca anotó su identidad (anterior a este archivo) solo
// pudo trabajar con HOJA_ANTERIOR_CONOCIDA y sin periodo: la única hoja usada
// hasta el 2026-11-20.

export var HOJA_LOCAL_KEY = "taller_hoja_v1";
export var HOJA_ANTERIOR_CONOCIDA = "1T4394Uzbs_vcUNZGgkaPkk1ATU48uoUg3VldGTMJKzs";

export function identidadHoja(hojaId, periodo) {
  return String(hojaId || "") + "|" + String(periodo || "");
}

// Devuelve cuántas claves borró (0 si la identidad es la misma o no hay storage).
export function alinearCopiasConHoja(identidadActual, ls) {
  if (!ls) {
    try { ls = window.localStorage; } catch (e) { return 0; }
  }
  if (!ls || !identidadActual) return 0;
  var anterior;
  try { anterior = ls.getItem(HOJA_LOCAL_KEY) || identidadHoja(HOJA_ANTERIOR_CONOCIDA, ""); } catch (e) { return 0; }
  var borradas = 0;
  if (anterior !== identidadActual) {
    var claves = [];
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (k && k.indexOf("taller_") === 0) claves.push(k);
    }
    claves.forEach(function (k) {
      try { ls.removeItem(k); borradas++; } catch (e) { /* sigue con las demás */ }
    });
  }
  try { ls.setItem(HOJA_LOCAL_KEY, identidadActual); } catch (e) { /* cuota llena: se reintenta la próxima vez */ }
  return borradas;
}
