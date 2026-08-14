// Red de seguridad del guardado.
//
// EL PROBLEMA QUE RESUELVE
// La única copia de los datos vive en la Google Sheet. El token de Google dura
// ~1h y se renueva solo, pero esa renovación silenciosa la bloquean los
// navegadores con cookies de terceros restringidas (Brave, Safari, incógnito,
// algunas extensiones). Cuando eso pasaba, persist() atrapaba el error, lo
// escribía en la consola y seguía como si nada: el usuario registraba abonos y
// pedidos toda la tarde viéndolos en pantalla —porque el estado en memoria sí
// cambiaba— y al cerrar la pestaña se perdía el día entero. Para una app que
// mueve la plata del negocio ese es el peor fallo posible, y era invisible.
//
// LA SOLUCIÓN, EN TRES PIEZAS
//  1. ESPEJO LOCAL: cada intento de guardado deja una copia en localStorage
//     (no sessionStorage: tiene que sobrevivir a cerrar el navegador y a que
//     se caiga la máquina). El disco del usuario pasa a ser una segunda copia
//     real, así que "no se pudo guardar" deja de significar "se perdió".
//  2. COLA CON REINTENTO: lo que no se pudo escribir queda anotado y se
//     reintenta solo — al volver la conexión, al volver a la pestaña, y cada
//     pocos segundos mientras siga fallando.
//  3. VISIBILIDAD: el estado se expone para que la barra superior lo muestre,
//     y el navegador pregunta antes de cerrar si algo quedó sin guardar.
//
// POR QUÉ REINTENTAR ES SEGURO ACÁ (y no haría falta ningún merge)
// Cada escritura manda el blob COMPLETO de esa clave, no un delta. O sea que
// reintentar es simplemente volver a escribir el estado actual, y una sola
// escritura exitosa repara todas las que fallaron antes. Por eso el reintento
// no guarda el JSON viejo: le pide a store.js el valor de AHORA (ver
// `escritor`), que ya incluye todo lo que pasó mientras tanto.
//
// LO QUE ESTO NO RESUELVE (a propósito)
// No es sincronización entre dispositivos. Si el mismo taller se edita desde
// dos máquinas a la vez, sigue mandando la última escritura que llegue — para
// resolver eso haría falta versionado por fila en la Sheet, que es otro
// proyecto. Por eso la recuperación del espejo al arrancar NUNCA es
// automática: se le pregunta al usuario (ver recuperacionPendiente()).

var ESPEJO_PREFIX = "taller_espejo_v1:";
var PENDIENTES_KEY = "taller_pendientes_v1";
var REINTENTO_MS = 15000;

var pendientes = {};   // { [clave]: true } — lo que todavía no llegó a la Sheet
var enVuelo = 0;       // escrituras en curso ahora mismo
var ultimoError = "";
var ultimoOkEl = 0;
var escritor = null;   // async (clave) => void — lo inyecta store.js
var notificar = function () {};
var temporizador = null;

function almacen() {
  try { return window.localStorage; } catch (e) { return null; }
}

// ---------- espejo local ----------
export function espejar(clave, json) {
  var ls = almacen();
  if (!ls) return;
  // Si el espejo no cabe (cuota llena), no es motivo para tumbar el guardado
  // real: se sigue igual, solo que sin esa red de seguridad para esa clave.
  try { ls.setItem(ESPEJO_PREFIX + clave, json); } catch (e) { /* cuota llena */ }
}
export function leerEspejo(clave) {
  var ls = almacen();
  if (!ls) return null;
  try { return ls.getItem(ESPEJO_PREFIX + clave); } catch (e) { return null; }
}

function anotarPendientes() {
  var ls = almacen();
  if (!ls) return;
  try {
    var claves = Object.keys(pendientes);
    if (claves.length) ls.setItem(PENDIENTES_KEY, JSON.stringify(claves));
    else ls.removeItem(PENDIENTES_KEY);
  } catch (e) { /* cuota llena */ }
}

// Claves que quedaron sin guardar en una sesión ANTERIOR (la pestaña se cerró,
// se cayó el navegador, se acabó la batería). Es lo que permite ofrecer la
// recuperación al arrancar.
export function pendientesDeSesionAnterior() {
  var ls = almacen();
  if (!ls) return [];
  try {
    var raw = ls.getItem(PENDIENTES_KEY);
    var lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch (e) { return []; }
}
export function olvidarPendientesDeSesionAnterior() {
  var ls = almacen();
  if (!ls) return;
  try { ls.removeItem(PENDIENTES_KEY); } catch (e) { /* nada que limpiar */ }
}

// ---------- estado observable (lo lee la barra superior) ----------
export function estadoGuardado() {
  var claves = Object.keys(pendientes);
  return {
    pendientes: claves,
    cantidad: claves.length,
    guardando: enVuelo > 0,
    ultimoError: ultimoError,
    ultimoOkEl: ultimoOkEl
  };
}
export function hayPendientes() { return Object.keys(pendientes).length > 0; }

// ---------- motor ----------
export function configurarGuardado(opts) {
  escritor = opts.escribir;
  notificar = opts.alCambiar || function () {};

  // Tres disparadores de reintento, porque los tres casos son reales: se
  // recuperó la conexión, el usuario volvió a la pestaña (donde el navegador
  // suele desbloquear la renovación del token), o simplemente pasó el tiempo.
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", function () { reintentarPendientes(); });
    window.addEventListener("beforeunload", function (e) {
      if (!hayPendientes()) return;
      // El texto lo decide el navegador (hace años que ignoran el nuestro);
      // lo que importa es que NO se pueda cerrar sin ver la advertencia.
      e.preventDefault();
      e.returnValue = "";
      return "";
    });
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) reintentarPendientes();
    });
  }
}

function programarReintento() {
  if (temporizador || !hayPendientes()) return;
  temporizador = setTimeout(function () {
    temporizador = null;
    reintentarPendientes();
  }, REINTENTO_MS);
}

// Intenta escribir una clave, dejándola encolada si falla. `json` es solo para
// el espejo: el reintento posterior vuelve a leer el estado actual.
export async function guardarClave(clave, json) {
  espejar(clave, json);
  pendientes[clave] = true;
  anotarPendientes();
  enVuelo++;
  notificar();
  try {
    await escritor(clave);
    delete pendientes[clave];
    anotarPendientes();
    ultimoError = "";
    ultimoOkEl = Date.now();
  } catch (e) {
    ultimoError = (e && e.message) ? e.message : String(e);
    console.error("No se pudo guardar", clave, e);
    programarReintento();
  } finally {
    enVuelo--;
    notificar();
  }
}

// Vuelve a intentar TODO lo pendiente con el estado de ahora. Devuelve cuántas
// claves quedaron sin guardar al terminar.
export async function reintentarPendientes() {
  var claves = Object.keys(pendientes);
  if (!claves.length || !escritor) return 0;
  enVuelo += claves.length;
  notificar();
  await Promise.all(claves.map(function (clave) {
    return Promise.resolve()
      .then(function () { return escritor(clave); })
      .then(function () {
        delete pendientes[clave];
        ultimoOkEl = Date.now();
      })
      .catch(function (e) {
        ultimoError = (e && e.message) ? e.message : String(e);
      })
      .finally(function () { enVuelo--; });
  }));
  if (!hayPendientes()) ultimoError = "";
  anotarPendientes();
  notificar();
  programarReintento();
  return Object.keys(pendientes).length;
}
