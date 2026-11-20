// Copias locales atadas a UNA hoja de Google.
//
// Todo lo que la app deja en el navegador (espejo local, cola de guardado,
// borradores, cola de la bitácora, acuse de pestaña vacía — ver
// core/guardado.js, core/bitacora.js y core/store.js) es una copia de los
// datos de la hoja que se estaba usando. Esas claves NO llevan el ID de la
// hoja en el nombre: si SPREADSHEET_ID (core/google-config.js) cambia —por
// ejemplo, al arrancar un periodo nuevo con una hoja nueva y dejar la vieja
// archivada—, la app tomaría las copias de la hoja vieja como «evidencia» de
// datos perdidos y los reviviría en la nueva (barra roja de pestaña vacía,
// recuperación del espejo, reintentos de la cola).
//
// Por eso, antes de cargar nada, se compara la hoja de ESTE navegador con la
// configurada: si son distintas, se borran todas las copias locales de la app
// (prefijo "taller_") y se anota la hoja nueva. La sesión de Google vive en
// sessionStorage y no se toca.
//
// Un navegador que nunca anotó su hoja (anterior a este archivo) solo pudo
// trabajar con HOJA_ANTERIOR_CONOCIDA: la única hoja usada hasta el 2026-11-20.

export var HOJA_LOCAL_KEY = "taller_hoja_v1";
export var HOJA_ANTERIOR_CONOCIDA = "1T4394Uzbs_vcUNZGgkaPkk1ATU48uoUg3VldGTMJKzs";

// Devuelve cuántas claves borró (0 si la hoja es la misma o no hay storage).
export function alinearCopiasConHoja(hojaActual, ls) {
  if (!ls) {
    try { ls = window.localStorage; } catch (e) { return 0; }
  }
  if (!ls || !hojaActual) return 0;
  var anterior;
  try { anterior = ls.getItem(HOJA_LOCAL_KEY) || HOJA_ANTERIOR_CONOCIDA; } catch (e) { return 0; }
  var borradas = 0;
  if (anterior !== hojaActual) {
    var claves = [];
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (k && k.indexOf("taller_") === 0) claves.push(k);
    }
    claves.forEach(function (k) {
      try { ls.removeItem(k); borradas++; } catch (e) { /* sigue con las demás */ }
    });
  }
  try { ls.setItem(HOJA_LOCAL_KEY, hojaActual); } catch (e) { /* cuota llena: se reintenta la próxima vez */ }
  return borradas;
}
