// Espacio en la hoja (Hallazgo #70, riesgo #67-2 del mapa técnico, paso 1 del
// paquete 3 de docs/PLAN-DE-CORRECCION.md).
//
// El problema: Google no deja guardar más de 50.000 caracteres en UNA celda, y
// casi todas las áreas de datos (pedidos, papeleras, deudas, configuración…)
// viven en una sola celda de la pestaña «kv». Cuando una crece de más, TODO
// guardado de esa área falla (ya pasó con Cotizaciones, Hallazgo #42), y nada
// avisaba antes. Además «kv» solo se lee hasta la fila 5.000: lo que se escriba
// más abajo no se vuelve a cargar. Este paso solo MIDE y AVISA (no mueve datos):
// mide cada área al cargar y al guardar, avisa desde el 70 % (aviso) y el 90 %
// (error), y cuenta las filas de «kv».
//
// Se corre solo, aparte de smoke.mjs:   node test/espacio.mjs
//
// No necesita jsdom: se stubean los globales que store.js toca al importarse,
// «kv» es un objeto en memoria y las pestañas propias son listas vacías.

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; } }; };
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], remove: noop });
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { getElementById: () => null, createElement: el, addEventListener: noop, dispatchEvent: noop, querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el(), head: el(), visibilityState: "visible" };

const kv = {};
let filasKv = 12;            // lo que diría sheetsStorage.filasUsadas()
let fallaEscritura = false;  // simula que Google rechaza el guardado (celda llena)
globalThis.window = Object.assign(globalThis.window || {}, {
  localStorage, sessionStorage, document, addEventListener: noop, removeEventListener: noop,
  location: { href: "http://localhost/", search: "", hash: "" }, matchMedia: () => ({ matches: false, addEventListener: noop }),
  confirm: () => true, alert: noop,
  storage: {
    get: async (k) => (kv[k] !== undefined ? { value: kv[k] } : null),
    set: async (k, v) => { if (fallaEscritura) throw new Error("Your input contains more than the maximum of 50000 characters in a single cell."); kv[k] = v; return true; },
    filasUsadas: () => filasKv
  }
});
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.confirm = () => true; globalThis.alert = noop;
globalThis.window.jspdf = { jsPDF: function () { return new Proxy({}, { get: () => () => ({}) }); } };
globalThis.fetch = async () => { throw new Error("sin red (prueba)"); };

const R = new URL("../js/", import.meta.url).href;
const store = await import(R + "core/store.js");
const salud = await import(R + "core/salud.js");
const esquemas = await import(R + "core/sheetsEsquemas.js");
const constants = await import(R + "core/constants.js");
const { state } = store;

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { pruebas++; if (a !== b) { fallos++; console.log("  X FALLA: " + msg + "  (obtuvo " + a + ", esperaba " + b + ")"); } else console.log("  ok " + msg); }

// Las pestañas propias, vacías (aquí no se prueban).
[esquemas.tablaMovimientos, esquemas.tablaClientes, esquemas.tablaCotizaciones, esquemas.tablaCierres].forEach((t) => {
  t.leer = async () => []; t.escribir = async () => {};
});

const hallazgosEspacio = () => salud.calcSaludDatos().filter((h) => h.regla === "espacio-hoja");
const conTamanos = (t, filas) => { state.tamanosClaves = t; state.filasKv = filas === undefined ? null : filas; };
// Un arreglo de pedidos cuyo JSON mide EXACTAMENTE `n` caracteres.
function pedidosDeTamano(n) {
  const base = JSON.stringify([{ id: "P", nota: "" }]).length;
  return [{ id: "P", nota: "x".repeat(n - base) }];
}

// ======================= 1. Cuánto ocupa cada área =======================
{
  console.log("== calcEspacioHoja: los umbrales");
  igual(salud.LIMITE_CELDA_KV, 50000, "el límite de Google es de 50.000 caracteres por celda");
  conTamanos({}, null);
  let e = salud.calcEspacioHoja();
  ok(e.medido === false && e.claves.length === 0 && e.filas === null && e.nivel === "ok", "sin medir nada, no hay nada que decir");
  conTamanos({ pedidos: 34999, deudas: 10 }, 12);
  e = salud.calcEspacioHoja();
  igual(e.nivel, "ok", "34.999 (69 %) todavía está bien");
  igual(e.claves[0].clave, "pedidos", "la más llena va primera");
  igual(e.claves[0].porcentaje, 69, "y el porcentaje se redondea hacia abajo (69, no 70)");
  igual(e.claves[1].clave, "deudas", "la siguiente después");
  conTamanos({ pedidos: 35000 }, null);
  e = salud.calcEspacioHoja();
  igual(e.claves[0].nivel, "aviso", "35.000 (70 %) ya es aviso");
  igual(e.nivel, "aviso", "y el nivel general también");
  conTamanos({ pedidos: 44999 }, null);
  igual(salud.calcEspacioHoja().claves[0].nivel, "aviso", "44.999 (89 %) sigue siendo aviso");
  conTamanos({ pedidos: 45000 }, null);
  e = salud.calcEspacioHoja();
  igual(e.claves[0].nivel, "error", "45.000 (90 %) es error");
  igual(e.nivel, "error", "y el nivel general también");
  conTamanos({ pedidos: 52000 }, null);
  e = salud.calcEspacioHoja();
  igual(e.claves[0].porcentaje, 104, "pasado el límite se ve (104 %), no se tapa en 100");
  igual(e.claves[0].nivel, "error", "y es error");
  conTamanos({ txPapelera: 20000, pedidos: 30000 }, null);
  igual(salud.calcEspacioHoja().masLlena.clave, "pedidos", "«masLlena» es la de más caracteres");
  conTamanos({ pedidos: "no es numero", deudas: -5 }, null);
  ok(salud.calcEspacioHoja().claves.every((c) => c.caracteres >= 0), "un valor basura no rompe (se trata como 0)");

  console.log("== calcEspacioHoja: las filas de «kv»");
  conTamanos({}, 3999);
  igual(salud.calcEspacioHoja().filas.nivel, "ok", "fila 3.999 de 5.000 está bien");
  conTamanos({}, 4000);
  igual(salud.calcEspacioHoja().filas.nivel, "aviso", "fila 4.000 ya es aviso");
  conTamanos({}, 4750);
  igual(salud.calcEspacioHoja().filas.nivel, "error", "fila 4.750 es error");
  conTamanos({}, 5000);
  e = salud.calcEspacioHoja();
  igual(e.filas.limite, 5000, "«kv» se lee hasta la fila 5.000");
  igual(e.filas.usadas, 5000, "y dice cuántas usa");
  conTamanos({}, null);
  ok(salud.calcEspacioHoja().filas === null, "sin dato de filas, no inventa");
}

// ======================= 2. Salud de los datos =======================
{
  console.log("== la verificación de Salud");
  ok(salud.VERIFICACIONES_SALUD.some((v) => v.id === "espacio-hoja" && v.porque && v.donde), "está registrada, con su porqué y su dónde");
  conTamanos({ pedidos: 20000, deudas: 5000 }, 100);
  igual(hallazgosEspacio().length, 0, "con todo por debajo del 70 % no dice nada");
  conTamanos({}, null);
  igual(hallazgosEspacio().length, 0, "sin medir nada tampoco");

  conTamanos({ pedidos: 36000, deudas: 5000 }, 100);
  let hs = hallazgosEspacio();
  igual(hs.length, 1, "una sola área pasada del 70 % → un solo hallazgo");
  igual(hs[0].severidad, "aviso", "es un aviso");
  ok(hs[0].titulo.indexOf("pedidos") !== -1 && hs[0].titulo.indexOf("72 %") !== -1, "dice qué área y cuánto: «" + hs[0].titulo + "»");
  ok(hs[0].detalle.indexOf("36.000") !== -1 && hs[0].detalle.indexOf("50.000") !== -1, "y los caracteres contra el límite: «" + hs[0].detalle + "»");
  ok(hs[0].detalle.indexOf("deja de guardarse") !== -1, "y qué pasa si se llena");
  igual(hs[0].id, "espacio-hoja:pedidos", "con su id estable");

  conTamanos({ pedidos: 46000, txPapelera: 38000 }, 100);
  hs = hallazgosEspacio();
  igual(hs.length, 2, "dos áreas → dos hallazgos");
  const errPed = hs.filter((h) => h.id === "espacio-hoja:pedidos")[0];
  igual(errPed.severidad, "error", "pasado el 90 % es un error");
  const avisoPapelera = hs.filter((h) => h.id === "espacio-hoja:txPapelera")[0];
  igual(avisoPapelera.severidad, "aviso", "la otra sigue siendo aviso");
  ok(avisoPapelera.detalle.indexOf("para siempre") !== -1, "la papelera de movimientos dice que borrar para siempre libera espacio");
  ok(avisoPapelera.afectados.length === 1 && avisoPapelera.afectados[0].tipo === "papelera-movimiento" && !!avisoPapelera.afectados[0].id, "y lleva un botón a esa papelera");
  conTamanos({ pedidosPapelera: 40000 }, 100);
  hs = hallazgosEspacio();
  ok(hs[0].afectados.length === 1 && hs[0].afectados[0].tipo === "papelera-pedido", "la papelera de pedidos lleva a la papelera de pedidos");
  conTamanos({ config: 40000 }, 100);
  hs = hallazgosEspacio();
  ok(hs[0].afectados.length === 0 && hs[0].detalle.indexOf("para siempre") === -1, "una área sin papelera no promete algo que no existe");

  console.log("== las filas de «kv» en Salud");
  conTamanos({}, 4100);
  hs = hallazgosEspacio();
  igual(hs.length, 1, "pasadas las 4.000 filas hay un hallazgo");
  igual(hs[0].severidad, "aviso", "aviso");
  ok(hs[0].detalle.indexOf("4.100") !== -1 && hs[0].detalle.indexOf("5.000") !== -1, "con las filas usadas y el tope: «" + hs[0].detalle + "»");
  conTamanos({}, 4900);
  igual(hallazgosEspacio()[0].severidad, "error", "casi llena es error");
  conTamanos({ pedidos: 46000 }, 4900);
  igual(hallazgosEspacio().length, 2, "área y filas, cada una el suyo");

  console.log("== el panel y el informe");
  conTamanos({ pedidos: 36000, deudas: 5000 }, 4100);
  const informe = salud.textoInformeSalud("2026-11-04");
  ok(informe.indexOf("Espacio en la hoja") !== -1, "el informe copiado trae el espacio en la hoja");
  ok(informe.indexOf("pedidos") !== -1 && informe.indexOf("72 %") !== -1, "con la más llena y su porcentaje");
  ok(informe.indexOf("4.100") !== -1, "y las filas");
  conTamanos({}, null);
  ok(salud.textoInformeSalud("x").indexOf("Espacio en la hoja: todavía no se midió") !== -1, "sin medir, lo dice");
}

// ======================= 3. Se mide de verdad: al guardar y al cargar =======================
{
  console.log("== al guardar");
  state.tamanosClaves = {}; state.filasKv = null;
  state.pedidos = pedidosDeTamano(12345);
  filasKv = 33;
  await store.persist("pedidos");
  igual(state.tamanosClaves.pedidos, 12345, "al guardar «pedidos» se anota cuánto mide su celda");
  igual(kv[constants.KEYS.pedidos].length, 12345, "(y es lo que de verdad se escribió)");
  igual(state.filasKv, 33, "y se actualiza cuántas filas usa «kv»");

  state.pedidos = pedidosDeTamano(50500);
  fallaEscritura = true;
  await store.persist("pedidos");
  fallaEscritura = false;
  igual(state.tamanosClaves.pedidos, 50500, "aunque Google rechace el guardado por llena, el tamaño que no cupo queda anotado (se ve 101 %)");
  igual(salud.calcEspacioHoja().claves[0].porcentaje, 101, "y se ve como 101 %");
  ok(hallazgosEspacio().some((h) => h.severidad === "error"), "y Salud lo marca como error");

  console.log("== las pestañas propias no se miden (no son una celda)");
  state.tx = [{ id: "t1", tipo: "gasto", fecha: "2026-10-05", concepto: "Hilo", monto: 1000, cuenta: "efectivo" }];
  await store.persist("tx");
  ok(state.tamanosClaves.tx === undefined, "«tx» vive en su pestaña, una fila por movimiento: no tiene tope de celda");

  console.log("== al cargar");
  Object.keys(kv).forEach((k) => delete kv[k]);
  state.tamanosClaves = {}; state.filasKv = null;
  kv[constants.KEYS.pedidos] = JSON.stringify(pedidosDeTamano(36500));
  kv[constants.KEYS.deudas] = JSON.stringify([{ id: "d1", concepto: "Tela", monto: 1000, cuotas: "1" }]);
  kv[constants.KEYS.tx] = JSON.stringify([{ id: "viejo" }]); // la foto congelada de «kv»: no cuenta
  filasKv = 4321;
  await store.loadAll();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  igual(state.tamanosClaves.pedidos, 36500, "al cargar se mide lo que HAY en la hoja (no hace falta guardar para saberlo)");
  igual(state.tamanosClaves.deudas, kv[constants.KEYS.deudas].length, "también las áreas chicas");
  ok(state.tamanosClaves.tx === undefined, "la foto congelada de «tx» en «kv» no se cuenta");
  ok(state.tamanosClaves.ui === undefined && state.tamanosClaves.plantillasEstados === undefined, "lo que no tiene fila en la hoja no se inventa");
  igual(state.filasKv, 4321, "y se anotan las filas de «kv»");
  igual(salud.calcEspacioHoja().masLlena.clave, "pedidos", "la más llena es «pedidos»");
  ok(hallazgosEspacio().some((h) => h.id === "espacio-hoja:pedidos" && h.severidad === "aviso") && hallazgosEspacio().some((h) => h.id === "espacio-hoja:kv-filas"), "y Salud avisa de las dos cosas");
}
{
  console.log("== un almacenamiento que no sabe contar filas");
  delete window.storage.filasUsadas;
  state.tamanosClaves = {}; state.filasKv = 77;
  await store.loadAll();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  ok(state.filasKv === null, "sin filasUsadas() el dato queda en «no sé» (no se queda con uno viejo)");
}

console.log("");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de espacio en la hoja");
process.exit(fallos ? 1 : 0);
