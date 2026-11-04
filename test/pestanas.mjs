// Pestañas propias que quedan vacías (Hallazgo #69, riesgo #67-1 del mapa
// técnico, paquete 2 de docs/PLAN-DE-CORRECCION.md).
//
// El problema: movimientos, contactos, cotizaciones y cierres viven en su propia
// pestaña de la hoja, pero "kv" todavía guarda el blob que tenían el día que
// migraron — congelado desde entonces. Si la pestaña propia llegaba con 0 filas
// (alguien la vació, o «borrar y escribir» falló entre sus dos pasos), loadAll()
// lo tomaba por «primera migración» y la rellenaba con esa foto de hace meses,
// sin avisar. Ahora una marca «ya migrado» (fila «__migrado__:<clave>» en «kv») y
// la copia local de este equipo distinguen la primera migración de una pestaña
// vaciada, y en ese caso NO se toca nada y se avisa.
//
// Se corre solo, aparte de smoke.mjs:   node test/pestanas.mjs
//
// No necesita jsdom: se stubean los globales que store.js toca al importarse, la
// pestaña «kv» es un objeto en memoria y las cuatro pestañas propias son listas
// en memoria (se les cambia leer/escribir). Se llama a loadAll() de verdad.

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; } }; };
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], remove: noop });
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { getElementById: () => null, createElement: el, addEventListener: noop, dispatchEvent: noop, querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el(), head: el(), visibilityState: "visible" };

// «kv» en memoria. `falloLectura` / `falloEscritura`: claves que simulan fallar.
const kv = {};
const sets = []; // toda escritura a «kv», en orden
const falloLectura = new Set();
const falloEscritura = new Set();
globalThis.window = Object.assign(globalThis.window || {}, {
  localStorage, sessionStorage, document, addEventListener: noop, removeEventListener: noop,
  location: { href: "http://localhost/", search: "", hash: "" }, matchMedia: () => ({ matches: false, addEventListener: noop }),
  confirm: () => true, alert: noop,
  storage: {
    get: async (k) => { if (falloLectura.has(k)) throw new Error("no se pudo leer (prueba)"); return kv[k] !== undefined ? { value: kv[k] } : null; },
    set: async (k, v) => { if (falloEscritura.has(k)) throw new Error("no se pudo escribir (prueba)"); sets.push(k); kv[k] = v; return true; }
  }
});
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.confirm = () => true; globalThis.alert = noop;
globalThis.window.jspdf = { jsPDF: function () { return new Proxy({}, { get: () => () => ({}) }); } };
globalThis.fetch = async () => { throw new Error("sin red (prueba)"); }; // la bitácora y lo demás no tienen red aquí

const R = new URL("../js/", import.meta.url).href;
const store = await import(R + "core/store.js");
const esquemas = await import(R + "core/sheetsEsquemas.js");
const constants = await import(R + "core/constants.js");
const { state } = store;

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { pruebas++; if (a !== b) { fallos++; console.log("  X FALLA: " + msg + "  (obtuvo " + a + ", esperaba " + b + ")"); } else console.log("  ok " + msg); }
const copia = (x) => JSON.parse(JSON.stringify(x));

// ---- las cuatro pestañas propias, en memoria ----
const TABLAS = { tx: esquemas.tablaMovimientos, clientes: esquemas.tablaClientes, cotizaciones: esquemas.tablaCotizaciones, cierres: esquemas.tablaCierres };
const hojas = {};
Object.keys(TABLAS).forEach((k) => {
  hojas[k] = { filas: [], escrituras: 0, falla: false };
  TABLAS[k].leer = async () => { if (hojas[k].falla) throw new Error("Google Sheets API 500 (prueba)"); return copia(hojas[k].filas); };
  TABLAS[k].escribir = async (items) => { hojas[k].escrituras++; hojas[k].filas = copia(items || []); };
});

const mov = (id, extra) => Object.assign({ id: id, tipo: "gasto", fecha: "2026-10-05", concepto: "Hilo " + id, monto: 100000, cuenta: "efectivo", contraparte: "", pedidoId: "", cotizacionId: "" }, extra || {});
const BLOB_VIEJO = [mov("viejo-1"), mov("viejo-2")]; // la foto congelada de «kv» del día que migró
const FILAS_HOY = [mov("hoy-1"), mov("hoy-2"), mov("hoy-3")]; // lo que de verdad hay hoy en la pestaña
const MARCA = "__migrado__:";
const ESPEJO = (k) => "taller_espejo_v1:" + k;
const ACUSE = "taller_tabla_vacia_ok_v1";
const marcaEn = (k) => kv[MARCA + k];
const marcasEscritas = (k) => sets.filter((s) => s === MARCA + k).length;
const ids = (lista) => lista.map((x) => x.id).join(",");

function reiniciar() {
  Object.keys(kv).forEach((k) => delete kv[k]);
  sets.length = 0; falloLectura.clear(); falloEscritura.clear();
  localStorage.clear(); sessionStorage.clear();
  Object.keys(hojas).forEach((k) => { hojas[k].filas = []; hojas[k].escrituras = 0; hojas[k].falla = false; });
  state.tx = []; state.clientes = []; state.cotizaciones = []; state.cierres = [];
  state.avisoTablaVacia = null; state.avisoTablaSheetFallo = null; state.recuperacion = null;
}
async function cargar() {
  state.avisoTablaVacia = null; state.avisoTablaSheetFallo = null;
  await store.loadAll();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); // deja terminar lo que loadAll() dejó en cola
}

// ======================= 1. La decisión, sola =======================
{
  console.log("== decidirLecturaTabla: la pestaña manda cuando tiene filas");
  const d = store.decidirLecturaTabla;
  let r = d({ items: FILAS_HOY, blob: BLOB_VIEJO, marca: false, espejo: null, acuse: false });
  igual(r.accion, "usar", "con filas, manda la pestaña (no el blob congelado)");
  igual(r.marcar, true, "y si aún no hay marca, se anota que ya migró");
  r = d({ items: FILAS_HOY, blob: BLOB_VIEJO, marca: true, espejo: null, acuse: false });
  igual(r.marcar, false, "con la marca puesta, no se vuelve a anotar");

  console.log("== decidirLecturaTabla: primera migración de verdad");
  r = d({ items: [], blob: BLOB_VIEJO, marca: false, espejo: null, acuse: false });
  igual(r.accion, "sembrar", "pestaña vacía + blob con datos + nunca vista con datos: se siembra (la primera migración)");
  igual(r.marcar, true, "y se anota la marca");
  r = d({ items: [], blob: BLOB_VIEJO, marca: false, espejo: "[]", acuse: false });
  igual(r.accion, "sembrar", "un espejo local vacío no cambia eso");
  r = d({ items: [], blob: undefined, marca: false, espejo: null, acuse: false });
  igual(r.accion, "usar", "pestaña vacía y nada que sembrar: se usa vacía");
  igual(r.marcar, false, "sin marca (todavía no se vio con datos)");
  r = d({ items: [], blob: [], marca: false, espejo: null, acuse: false });
  igual(r.accion, "usar", "un blob vacío tampoco se siembra");

  console.log("== decidirLecturaTabla: vacía habiendo tenido datos");
  r = d({ items: [], blob: BLOB_VIEJO, marca: true, espejo: JSON.stringify(FILAS_HOY), acuse: false });
  igual(r.accion, "vacia-sospechosa", "con marca, vacía, y este equipo la vio con datos: NO se siembra, se avisa");
  igual(r.marcar, false, "y no se toca la marca");
  r = d({ items: [], blob: BLOB_VIEJO, marca: true, espejo: null, acuse: false });
  igual(r.accion, "vacia-sospechosa", "con marca, vacía, equipo sin copia local pero con blob: se avisa");
  r = d({ items: [], blob: undefined, marca: true, espejo: JSON.stringify(FILAS_HOY), acuse: false });
  igual(r.accion, "vacia-sospechosa", "con marca, vacía, sin blob pero con copia local con datos: se avisa");
  r = d({ items: [], blob: BLOB_VIEJO, marca: false, espejo: JSON.stringify(FILAS_HOY), acuse: false });
  igual(r.accion, "vacia-sospechosa", "SIN marca pero con copia local con datos (se vació antes de este arreglo): tampoco se siembra");

  console.log("== decidirLecturaTabla: vaciada a propósito");
  r = d({ items: [], blob: BLOB_VIEJO, marca: true, espejo: "[]", acuse: false });
  igual(r.accion, "usar", "con marca y la copia local de este equipo vacía (la vació él): se usa vacía, sin aviso");
  r = d({ items: [], blob: undefined, marca: true, espejo: null, acuse: false });
  igual(r.accion, "usar", "con marca, sin blob y sin copia local: no hay evidencia de que tuviera datos");
  r = d({ items: [], blob: BLOB_VIEJO, marca: true, espejo: JSON.stringify(FILAS_HOY), acuse: true });
  igual(r.accion, "usar", "si el usuario ya dijo «está bien así», no se vuelve a avisar");
  r = d({ items: [], blob: BLOB_VIEJO, marca: true, espejo: "esto no es json {", acuse: false });
  igual(r.accion, "vacia-sospechosa", "una copia local ilegible no sirve de evidencia: manda el blob");
  r = d({ items: undefined, blob: BLOB_VIEJO, marca: true, espejo: null, acuse: false });
  igual(r.accion, "vacia-sospechosa", "items ausente se trata como vacío");
}

// ======================= 2. loadAll() de verdad =======================
{
  console.log("== primera migración: la pestaña nunca tuvo nada y «kv» sí");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  await cargar();
  igual(ids(hojas.tx.filas), "viejo-1,viejo-2", "la pestaña se siembra con lo que había en «kv» (una sola vez)");
  igual(ids(state.tx), "viejo-1,viejo-2", "y la pantalla muestra eso");
  ok(!!marcaEn("tx"), "se anota la marca «ya migrado» de movimientos");
  ok(state.avisoTablaVacia === null, "sin aviso: es la primera migración, no una pestaña vaciada");
  ok(marcaEn("clientes") === undefined && marcaEn("cotizaciones") === undefined && marcaEn("cierres") === undefined, "las pestañas que siguen vacías y sin nada que migrar no se marcan");
}
{
  console.log("== carga normal: la pestaña manda y se marca una sola vez");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  hojas.tx.filas = copia(FILAS_HOY);
  await cargar();
  igual(ids(state.tx), "hoy-1,hoy-2,hoy-3", "se muestra lo de la pestaña, no la foto vieja de «kv»");
  igual(hojas.tx.escrituras, 0, "no se escribió nada en la pestaña");
  ok(!!marcaEn("tx"), "se anota la marca");
  igual(marcasEscritas("tx"), 1, "una sola escritura de la marca");
  await cargar();
  igual(marcasEscritas("tx"), 1, "una segunda carga no la vuelve a escribir");
  ok(localStorage.getItem(ESPEJO("tx")).indexOf("hoy-3") !== -1, "y la copia local de este equipo quedó con lo de hoy");
}
{
  console.log("== EL CASO: la pestaña se vació y «kv» guarda la foto vieja");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  hojas.tx.filas = copia(FILAS_HOY);
  await cargar(); // un día normal: queda la marca y la copia local
  hojas.tx.filas = []; // «borrar y escribir» falló entre sus dos pasos, o alguien vació la pestaña
  hojas.tx.escrituras = 0;
  await cargar();
  igual(hojas.tx.filas.length, 0, "la pestaña NO se vuelve a llenar con la foto vieja de «kv»");
  igual(hojas.tx.escrituras, 0, "no se escribió nada en ella");
  igual(state.tx.length, 0, "y la pantalla muestra lo que la hoja dice (nada), no los 2 movimientos de hace meses");
  ok(!!state.avisoTablaVacia && state.avisoTablaVacia.claves.join() === "tx", "hay aviso rojo, y nombra «tx»");
  ok(localStorage.getItem(ESPEJO("tx")).indexOf("hoy-3") !== -1, "la copia local de este equipo (la única copia buena) NO se pisó");
  ok(state.avisoTablaSheetFallo === null, "no se confunde con «no se pudo leer»: la hoja respondió");

  console.log("== «está bien así»");
  store.reconocerTablasVacias();
  ok(state.avisoTablaVacia === null, "pulsarlo quita el aviso");
  ok(String(localStorage.getItem(ACUSE) || "").indexOf("tx") !== -1, "y lo anota en este navegador");
  await cargar();
  ok(state.avisoTablaVacia === null, "una carga más con la pestaña todavía vacía ya no avisa");
  igual(hojas.tx.filas.length, 0, "y sigue sin rellenarse con la foto vieja");
  hojas.tx.filas = [mov("nuevo-1")];
  await cargar();
  ok(localStorage.getItem(ACUSE) === null, "cuando la pestaña vuelve a tener datos, se olvida el «está bien así»");
  hojas.tx.filas = [];
  await cargar();
  ok(!!state.avisoTablaVacia, "y si se vacía otra vez, avisa otra vez");
}
{
  console.log("== vaciada a propósito en este equipo: sin aviso");
  reiniciar();
  kv[constants.KEYS.clientes] = JSON.stringify([{ id: "c-viejo", nombre: "Ana" }]);
  hojas.clientes.filas = [{ id: "c1", nombre: "Ana" }, { id: "c2", nombre: "Luis" }];
  await cargar();
  ok(!!marcaEn("clientes"), "primero se ve con datos y queda la marca");
  // el usuario borra todos los contactos aquí: el guardado deja la copia local vacía
  hojas.clientes.filas = [];
  localStorage.setItem(ESPEJO("clientes"), "[]");
  await cargar();
  ok(state.avisoTablaVacia === null, "con la copia local vacía (la vació este equipo) no hay aviso");
  igual(state.clientes.length, 0, "y se muestra vacía");
  igual(hojas.clientes.filas.length, 0, "sin rellenarla con el contacto viejo de «kv»");
}
{
  console.log("== equipo nuevo (sin copia local) y pestaña vaciada");
  reiniciar();
  kv[constants.KEYS.cotizaciones] = JSON.stringify([{ id: "q-viejo", cliente: "Ana", referencias: [] }]);
  kv[MARCA + "cotizaciones"] = "2026-09-21T00:00:00.000Z";
  await cargar();
  ok(!!state.avisoTablaVacia && state.avisoTablaVacia.claves.join() === "cotizaciones", "con la marca puesta y la foto vieja en «kv», se avisa");
  igual(hojas.cotizaciones.filas.length, 0, "y no se rellena");
  igual(state.cotizaciones.length, 0, "ni se muestra la cotización de la foto vieja");
}
{
  console.log("== vacía y sin ninguna evidencia de que tuviera datos: sin aviso");
  reiniciar();
  kv[MARCA + "cierres"] = "2026-11-01T00:00:00.000Z";
  await cargar();
  ok(state.avisoTablaVacia === null, "con marca pero sin blob ni copia local, no hay de qué avisar");
}
{
  console.log("== antes de este arreglo: la pestaña ya estaba vacía y no hay marca, pero este equipo la vio con datos");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  localStorage.setItem(ESPEJO("tx"), JSON.stringify(FILAS_HOY));
  await cargar();
  igual(hojas.tx.filas.length, 0, "la copia local con datos evita sembrar desde la foto vieja");
  ok(!!state.avisoTablaVacia && state.avisoTablaVacia.claves.join() === "tx", "y avisa");
  ok(marcaEn("tx") === undefined, "sin escribir la marca (la pestaña no se vio con datos hoy)");
}
{
  console.log("== la marca no se pudo escribir, o no se pudo leer");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  hojas.tx.filas = copia(FILAS_HOY);
  falloEscritura.add(MARCA + "tx");
  await cargar();
  igual(ids(state.tx), "hoy-1,hoy-2,hoy-3", "si la marca no se puede escribir, la carga sigue igual");
  ok(marcaEn("tx") === undefined, "(y no quedó marca; se reintenta en la próxima carga)");
  falloEscritura.clear();
  await cargar();
  ok(!!marcaEn("tx"), "en la próxima carga sí se anota");

  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  falloLectura.add(MARCA + "tx"); // no se sabe si ya migró
  await cargar();
  igual(hojas.tx.filas.length, 0, "si no se puede leer la marca, ante la duda NO se siembra desde la foto vieja");
}
{
  console.log("== si la pestaña no se puede leer, todo sigue como antes");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  hojas.tx.falla = true;
  await cargar();
  ok(!!state.avisoTablaSheetFallo && state.avisoTablaSheetFallo.claves.indexOf("tx") !== -1, "avisa que no se pudo leer (el aviso de siempre)");
  ok(state.avisoTablaVacia === null, "y no lo confunde con una pestaña vacía");
  igual(hojas.tx.escrituras, 0, "no escribe nada en la pestaña");
  ok(marcaEn("tx") === undefined, "ni anota la marca");
  igual(ids(state.tx), "viejo-1,viejo-2", "(sigue mostrando la foto de «kv» como único piso, igual que antes, ya avisado)");
}
{
  console.log("== varias pestañas a la vez");
  reiniciar();
  kv[constants.KEYS.tx] = JSON.stringify(BLOB_VIEJO);
  kv[constants.KEYS.clientes] = JSON.stringify([{ id: "c-viejo", nombre: "Ana" }]);
  hojas.tx.filas = copia(FILAS_HOY);
  hojas.clientes.filas = [{ id: "c1", nombre: "Ana" }];
  await cargar();
  hojas.tx.filas = []; hojas.clientes.filas = [];
  await cargar();
  ok(!!state.avisoTablaVacia && state.avisoTablaVacia.claves.slice().sort().join() === "clientes,tx", "si se vacían dos, el aviso nombra las dos");
  store.reconocerTablasVacias();
  await cargar();
  ok(state.avisoTablaVacia === null, "y un solo «está bien así» vale para las dos");
}

console.log("");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de pestañas propias vacías");
process.exit(fallos ? 1 : 0);
