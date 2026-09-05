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

// DOS LISTAS, no una. Al principio había una sola y la clave se marcaba como
// pendiente ANTES de intentar escribir: como cada guardado normal tarda
// milisegundos, en pantalla eso significaba que el chip rojo "Sin guardar" y
// la barra de error aparecían y desaparecían con cada tecla y cada clic. Un
// aviso de emergencia parpadeando todo el tiempo deja de leerse como una
// emergencia, que es justo lo contrario de lo que tiene que pasar.
//
//  - `enCola`: hay una escritura en curso (o falló). Se anota en disco de
//    inmediato para poder recuperar si la pestaña muere a mitad de camino.
//    NO se muestra: que algo esté escribiéndose ahora mismo no es noticia.
//  - `pendientes`: la escritura YA FALLÓ. Esto sí se muestra y sí se reintenta.
var pendientes = {};   // { [clave]: true } — falló y espera reintento (lo visible)
var enCola = {};       // { [clave]: true } — escribiéndose ahora o pendiente (para recuperación)
// Subconjunto de `pendientes`: falló porque otro dispositivo guardó algo
// distinto mientras tanto (ver verificarConflicto en core/store.js), NO por
// red. Reintentar a ciegas cada 15s no arregla esto (el conflicto sigue
// exactamente igual hasta que la pestaña se recargue con lo más reciente),
// así que estas claves se saltan del reintento automático — solo cuentan
// para el aviso, que le pide al usuario recargar en vez de solo esperar.
var conflictos = {};
var enVuelo = 0;       // escrituras en curso ahora mismo
var ultimoError = "";
var ultimoOkEl = 0;
var escritor = null;   // async (clave) => void — lo inyecta store.js
var notificar = function () {};
var temporizador = null;

// "Guardando…" solo se anuncia si el guardado se está DEMORANDO. Casi todo lo
// que se hace en la app dispara un guardado, y esos guardados tardan
// milisegundos: mostrar el aviso en cada uno hacía que algo apareciera y
// desapareciera en la esquina con cada tecla y cada clic. Molesta y, peor,
// vuelve invisible el aviso que sí importa (el de "no se pudo guardar"), que
// termina leyéndose como un parpadeo más.
//
// Con este umbral, un guardado normal no produce NINGÚN cambio en pantalla: el
// chip se queda quieto en "Guardado". Solo si algo tarda más de lo esperable
// —conexión lenta, token renovándose— aparece el aviso, que es justo cuando
// enterarse aporta algo.
var MS_PARA_ANUNCIAR_LENTITUD = 900;
var guardadoLento = false;
var temporizadorLentitud = null;

function marcarPosibleLentitud() {
  if (temporizadorLentitud) return;
  temporizadorLentitud = setTimeout(function () {
    temporizadorLentitud = null;
    if (enVuelo > 0) { guardadoLento = true; notificar(); }
  }, MS_PARA_ANUNCIAR_LENTITUD);
}

function limpiarLentitudSiTerminó() {
  if (enVuelo > 0) return;
  clearTimeout(temporizadorLentitud);
  temporizadorLentitud = null;
  guardadoLento = false;
}

function almacen() {
  try { return window.localStorage; } catch (e) { return null; }
}

// El mensaje que ve el usuario cuando algo no se pudo guardar. Sin conexión,
// el error crudo del navegador es del tipo "Failed to fetch" / "NetworkError"
// — jerga técnica que no ayuda y suena a que algo se rompió. Estar sin
// conexión es un estado NORMAL y esperable (por eso existe todo este
// archivo): se reemplaza por un mensaje que dice justo eso, con la misma
// calma con la que ya se anuncia en el resto de la app.
function mensajeDeError(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Sin conexión — se reintenta solo en cuanto vuelva.";
  }
  return (e && e.message) ? e.message : String(e);
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

// ---------- borradores: edición en curso que NUNCA se intentó guardar ----------
// Distinto de `pendientes`/`enCola` de arriba (que son intentos de escritura
// que fallaron o quedaron a medias): una cotización en modo "guardado
// explícito" (ver marcarSucia en modules/cotizaciones.js) o un "Nuevo pedido
// rápido" a medio llenar viven SOLO en `state`, en memoria — nadie llamó
// jamás a guardarClave() para ellos, así que `pendientes`/`enCola` nunca se
// enteran de que existen. Si la pestaña se cierra sola (se actualizó el
// navegador, se cayó, se recargó por accidente) esas horas de trabajo
// desaparecían sin ningún aviso ni forma de recuperarlas — justo lo que este
// archivo existe para evitar en el resto de los casos. `borradores` cierra
// ese hueco: se anota qué claves tienen edición sin guardar (para el aviso de
// "¿seguro que quieres salir?" de abajo) y, con calma unos segundos después
// del último cambio, se refresca su copia en el espejo (para poder
// recuperarla al volver a abrir la app — ver detectarRecuperacion en
// core/store.js, que ya sabía leer el espejo, solo no sabía de este motivo
// nuevo para que hubiera uno que recuperar).
var borradores = {}; // { [clave]: true } — hay edición sin guardar para esta clave, ahora mismo
var BORRADORES_KEY = "taller_borradores_v1";
var TIEMPO_ESPEJO_BORRADOR_MS = 1500; // se espera una pausa en la escritura antes de mirar el estado completo
var timersBorrador = {};

function anotarBorradoresEnDisco() {
  var ls = almacen();
  if (!ls) return;
  try {
    var claves = Object.keys(borradores);
    if (claves.length) ls.setItem(BORRADORES_KEY, JSON.stringify(claves));
    else ls.removeItem(BORRADORES_KEY);
  } catch (e) { /* cuota llena */ }
}

// `obtenerJson` es una FUNCIÓN, no el JSON ya armado: como esto se llama en
// cada render mientras se edita (ver revisarBorradoresSinGuardar en
// core/store.js), armar el JSON del estado completo en cada tecla sería
// carísimo para nada — solo se paga ese costo cuando de verdad pasa el
// tiempo de espera sin que haya un cambio más reciente.
export function marcarBorrador(clave, obtenerJson) {
  if (!borradores[clave]) {
    borradores[clave] = true;
    anotarBorradoresEnDisco();
  }
  clearTimeout(timersBorrador[clave]);
  timersBorrador[clave] = setTimeout(function () {
    espejar(clave, obtenerJson());
  }, TIEMPO_ESPEJO_BORRADOR_MS);
}
export function olvidarBorrador(clave) {
  clearTimeout(timersBorrador[clave]);
  delete timersBorrador[clave];
  if (!borradores[clave]) return;
  delete borradores[clave];
  anotarBorradoresEnDisco();
}
// Claves con un borrador anotado en disco de una sesión ANTERIOR — mismo
// papel que pendientesDeSesionAnterior() de abajo, pero para este motivo
// nuevo. Vive en su propia clave de localStorage (no mezclada con
// PENDIENTES_KEY) porque conceptualmente son cosas distintas: un intento de
// guardado que falló vs. una edición que nunca se intentó guardar.
export function borradoresDeSesionAnterior() {
  var ls = almacen();
  if (!ls) return [];
  try {
    var raw = ls.getItem(BORRADORES_KEY);
    var lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch (e) { return []; }
}
export function hayBorradores() { return Object.keys(borradores).length > 0; }

function anotarEnDisco() {
  var ls = almacen();
  if (!ls) return;
  try {
    var claves = Object.keys(enCola);
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
    guardando: guardadoLento,
    ultimoError: ultimoError,
    ultimoOkEl: ultimoOkEl,
    clavesConflicto: claves.filter(function (c) { return conflictos[c]; })
  };
}
export function hayPendientes() { return Object.keys(pendientes).length > 0; }
function hayPendientesReintentables() {
  return Object.keys(pendientes).some(function (c) { return !conflictos[c]; });
}

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
      // Antes solo miraba hayPendientes() (intentos de guardado fallidos) —
      // una cotización a medio armar en modo "guardado explícito", o un
      // pedido rápido a medio llenar, nunca pasan por ahí (nadie intentó
      // guardarlos todavía), así que se podían cerrar sin ningún aviso y
      // perderse enteros. Ver "borradores" más arriba.
      if (!hayPendientes() && !hayBorradores()) return;
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
  if (temporizador || !hayPendientesReintentables()) return;
  temporizador = setTimeout(function () {
    temporizador = null;
    reintentarPendientes();
  }, REINTENTO_MS);
}

// El mensaje de conflicto (ver verificarConflicto en core/store.js) ya trae
// texto claro y específico de qué área chocó — se usa tal cual en vez de
// pasarlo por mensajeDeError, que asume que todo error es de red/conexión.
function mensajeDeConflicto(e) {
  return (e && e.message) ? e.message : "Alguien más guardó un cambio distinto mientras tanto.";
}

// Intenta escribir una clave, dejándola encolada si falla. `json` es solo para
// el espejo: el reintento posterior vuelve a leer el estado actual.
export async function guardarClave(clave, json) {
  espejar(clave, json);
  enCola[clave] = true;
  anotarEnDisco();
  enVuelo++;
  marcarPosibleLentitud();
  // Sin notificar() acá: un guardado que va bien no debe producir NINGÚN
  // cambio en pantalla. El único aviso sale al final, y solo si algo falló.
  try {
    await escritor(clave);
    delete enCola[clave];
    delete pendientes[clave];
    delete conflictos[clave];
    anotarEnDisco();
    ultimoError = "";
    ultimoOkEl = Date.now();
  } catch (e) {
    pendientes[clave] = true; // recién ahora es noticia
    if (e && e.esConflicto) {
      conflictos[clave] = true;
      ultimoError = mensajeDeConflicto(e);
      console.error("Conflicto al guardar", clave, e);
      // NO se programa reintento: reintentar a ciegas repetiría el MISMO
      // conflicto para siempre sin arreglar nada (ver la nota junto a
      // `conflictos` más arriba). Hace falta recargar la página.
    } else {
      delete conflictos[clave];
      ultimoError = mensajeDeError(e);
      console.error("No se pudo guardar", clave, e);
      programarReintento();
    }
  } finally {
    enVuelo--;
    limpiarLentitudSiTerminó();
    notificar();
  }
}

// Vuelve a intentar TODO lo pendiente QUE NO sea un conflicto (ver
// hayPendientesReintentables) con el estado de ahora. Devuelve cuántas claves
// quedaron sin guardar al terminar (conflictos incluidos: siguen sin
// guardarse, solo que no se les vuelve a insistir solas).
export async function reintentarPendientes() {
  var claves = Object.keys(pendientes).filter(function (c) { return !conflictos[c]; });
  if (!claves.length || !escritor) return Object.keys(pendientes).length;
  enVuelo += claves.length;
  marcarPosibleLentitud();
  await Promise.all(claves.map(function (clave) {
    return Promise.resolve()
      .then(function () { return escritor(clave); })
      .then(function () {
        delete pendientes[clave];
        delete enCola[clave];
        delete conflictos[clave];
        ultimoOkEl = Date.now();
      })
      .catch(function (e) {
        if (e && e.esConflicto) {
          conflictos[clave] = true;
          ultimoError = mensajeDeConflicto(e);
        } else {
          ultimoError = mensajeDeError(e);
        }
      })
      .finally(function () { enVuelo--; });
  }));
  limpiarLentitudSiTerminó();
  if (!hayPendientes()) ultimoError = "";
  anotarEnDisco();
  notificar();
  programarReintento();
  return Object.keys(pendientes).length;
}
