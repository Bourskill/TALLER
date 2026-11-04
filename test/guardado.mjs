// Cola y rondas de guardado (core/guardado.js): Hallazgos #67-5 y #67-10 del
// mapa técnico (docs/PLAN-DE-CORRECCION.md, paquete 1).
//
//  - #67-5: cuando una escritura terminaba bien, se borraba de disco la marca
//    «esta clave está en cola» aunque ya hubiera un cambio más nuevo esperando
//    su propia ronda. Si el navegador moría durante esa segunda ronda, al
//    reabrir no se ofrecía recuperar y el cambio quedaba solo en el espejo.
//  - #67-10: el reintento automático lanzaba su propia escritura sin mirar si
//    ya había una ronda en vuelo para la clave (y la ronda que lanzaba no se
//    anotaba como «en vuelo»), así que dos escrituras completas de la misma
//    clave podían correr a la vez y entrelazarse.
//
// Se corre solo, aparte de smoke.mjs:   node test/guardado.mjs
//
// No necesita jsdom: guardado.js no importa nada. Se le inyecta un «escritor»
// controlado a mano (cada escritura queda esperando hasta que la prueba la
// libere o la haga fallar) y un localStorage falso para ver la marca en disco.

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
const disco = mem();
globalThis.window = { localStorage: disco }; // sin addEventListener: configurarGuardado no registra nada

const R = new URL("../js/", import.meta.url).href;
let nModulo = 0;
async function guardadoNuevo() {
  disco.clear();
  return import(R + "core/guardado.js?caso-" + (++nModulo)); // instancia aislada por escenario
}

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { ok(a === b, msg + "  (obtuvo " + a + ", esperaba " + b + ")"); }

const tick = () => new Promise(r => setTimeout(r, 0));
async function ticks(n) { for (let i = 0; i < (n || 5); i++) await tick(); }

// Escritor falso: cada llamada queda colgada hasta liberar() o fallar().
function crearEscritor() {
  const e = { llamadas: 0, enCurso: {}, maxConcurrente: {}, cola: [] };
  e.escribir = function (clave) {
    e.llamadas++;
    e.enCurso[clave] = (e.enCurso[clave] || 0) + 1;
    e.maxConcurrente[clave] = Math.max(e.maxConcurrente[clave] || 0, e.enCurso[clave]);
    return new Promise(function (resolve, reject) {
      e.cola.push({
        ok: function () { e.enCurso[clave]--; resolve(); },
        mal: function (err) { e.enCurso[clave]--; reject(err); }
      });
    });
  };
  e.liberar = function () { e.cola.shift().ok(); };
  e.fallar = function (err) { e.cola.shift().mal(err || new Error("sin red (prueba)")); };
  return e;
}
const enDisco = (g, clave) => g.pendientesDeSesionAnterior().indexOf(clave) !== -1;

// Deja la clave «k» como pendiente (una escritura falló por la red) y devuelve
// el módulo y el escritor listos.
async function conClavePendiente() {
  const g = await guardadoNuevo();
  const e = crearEscritor();
  g.configurarGuardado({ escribir: e.escribir, alCambiar: function () {} });
  const p = g.guardarClave("k", "{}");
  await ticks(2);
  e.fallar();
  await p;
  return { g, e };
}

// ======================= 0. Lo que ya funcionaba =======================
{
  console.log("== una escritura normal");
  const g = await guardadoNuevo();
  const e = crearEscritor();
  g.configurarGuardado({ escribir: e.escribir, alCambiar: function () {} });
  const p = g.guardarClave("k", "{}");
  await ticks(2);
  ok(enDisco(g, "k"), "mientras escribe, la clave queda anotada en disco (para poder recuperar)");
  e.liberar();
  await p;
  ok(!enDisco(g, "k"), "al terminar bien, la marca de disco se borra");
  igual(g.estadoGuardado().cantidad, 0, "y no queda nada pendiente");
  igual(e.llamadas, 1, "con una sola escritura");

  console.log("== una escritura que falla");
  const f = await conClavePendiente();
  ok(enDisco(f.g, "k"), "si falla, la marca sigue en disco");
  igual(f.g.estadoGuardado().cantidad, 1, "y la clave queda pendiente (lo visible)");
}

// ======================= 1. #67-5: la marca no se pierde con un cambio esperando =======================
{
  console.log("== #67-5 un cambio llega mientras la ronda 1 sigue en vuelo");
  const g = await guardadoNuevo();
  const e = crearEscritor();
  g.configurarGuardado({ escribir: e.escribir, alCambiar: function () {} });
  const p1 = g.guardarClave("k", "{}"); // ronda 1
  await ticks(2);
  igual(e.llamadas, 1, "la ronda 1 está en vuelo");
  const p2 = g.guardarClave("k", "{}"); // cambio nuevo: queda agendada la ronda 2
  await ticks(2);
  igual(e.llamadas, 1, "el cambio nuevo no lanza una escritura en paralelo");

  e.liberar(); // termina la ronda 1
  await ticks(3);
  igual(e.llamadas, 2, "la ronda 2 (el cambio nuevo) arrancó");
  ok(enDisco(g, "k"), "mientras la ronda 2 escribe, la marca SIGUE en disco (antes se borraba al terminar la ronda 1)");

  e.liberar(); // termina la ronda 2
  await Promise.all([p1, p2]);
  ok(!enDisco(g, "k"), "al terminar la última ronda, la marca se borra");
  igual(g.estadoGuardado().cantidad, 0, "y no queda nada pendiente");

  console.log("== #67-5 varios cambios seguidos");
  const g2 = await guardadoNuevo();
  const e2 = crearEscritor();
  g2.configurarGuardado({ escribir: e2.escribir, alCambiar: function () {} });
  const ps = [g2.guardarClave("k", "{}")];
  await ticks(2);
  ps.push(g2.guardarClave("k", "{}"), g2.guardarClave("k", "{}"), g2.guardarClave("k", "{}"));
  e2.liberar();
  await ticks(3);
  igual(e2.llamadas, 2, "tres cambios más terminan en UNA ronda agrupada (2 escrituras en total)");
  ok(enDisco(g2, "k"), "la marca sigue en disco durante esa ronda agrupada");
  e2.liberar();
  await Promise.all(ps);
  ok(!enDisco(g2, "k"), "y se borra al final");

  console.log("== #67-5 la ronda 1 falla y hay un cambio esperando");
  const g3 = await guardadoNuevo();
  const e3 = crearEscritor();
  g3.configurarGuardado({ escribir: e3.escribir, alCambiar: function () {} });
  const q1 = g3.guardarClave("k", "{}");
  await ticks(2);
  const q2 = g3.guardarClave("k", "{}");
  e3.fallar();
  await ticks(3);
  ok(enDisco(g3, "k"), "si la ronda 1 falla, la marca sigue en disco");
  igual(e3.llamadas, 2, "la ronda agrupada igual se intenta");
  e3.liberar();
  await Promise.all([q1, q2]);
  ok(!enDisco(g3, "k"), "y si esa sale bien, la marca se borra");
  igual(g3.estadoGuardado().cantidad, 0, "y ya no hay nada pendiente");
}

// ======================= 2. #67-10: el reintento y las rondas no se pisan =======================
{
  console.log("== #67-10 el reintento llega con una ronda ya en vuelo");
  const { g, e } = await conClavePendiente();
  igual(e.llamadas, 1, "sanity: hubo una escritura (la que falló)");
  const p = g.guardarClave("k", "{}"); // ronda nueva en vuelo
  await ticks(2);
  igual(e.llamadas, 2, "sanity: la ronda nueva está en vuelo");
  const r = g.reintentarPendientes(); // el temporizador de 15 s / el evento «volvió la red»
  await ticks(3);
  igual(e.llamadas, 2, "el reintento NO lanza una segunda escritura de la misma clave en paralelo");
  igual(e.maxConcurrente.k, 1, "nunca hubo dos escrituras de «k» a la vez");
  e.liberar();
  const quedan = await r;
  await p;
  igual(quedan, 0, "el reintento espera esa ronda y cuenta 0 pendientes al terminar");
  igual(g.estadoGuardado().cantidad, 0, "y no queda nada pendiente");
  ok(!enDisco(g, "k"), "ni marca en disco");
  igual(e.llamadas, 2, "en total: la que falló y la que salió bien");
}
{
  console.log("== #67-10 llega un cambio mientras el reintento escribe");
  const { g, e } = await conClavePendiente();
  const r = g.reintentarPendientes();
  await ticks(3);
  igual(e.llamadas, 2, "sanity: el reintento está escribiendo");
  const p = g.guardarClave("k", "{}"); // cambio nuevo durante el reintento
  await ticks(3);
  igual(e.llamadas, 2, "el cambio nuevo NO lanza otra escritura en paralelo: se agenda tras la del reintento");
  e.liberar(); // termina la escritura del reintento
  await ticks(3);
  igual(e.llamadas, 3, "justo después arranca la ronda agrupada con el estado más reciente");
  ok(enDisco(g, "k"), "y mientras tanto la marca de disco sigue (hay un cambio más nuevo sin escribir)");
  e.liberar();
  await Promise.all([r, p]);
  igual(e.maxConcurrente.k, 1, "nunca hubo dos escrituras de «k» a la vez");
  igual(g.estadoGuardado().cantidad, 0, "nada pendiente al final");
  ok(!enDisco(g, "k"), "ni marca en disco");
}

// ======================= 3. El reintento sigue haciendo lo de siempre =======================
{
  console.log("== el reintento sin nada más en vuelo");
  const { g, e } = await conClavePendiente();
  const r = g.reintentarPendientes();
  await ticks(3);
  igual(e.llamadas, 2, "reintenta la clave pendiente");
  e.fallar();
  igual(await r, 1, "si vuelve a fallar, devuelve 1 pendiente");
  igual(g.estadoGuardado().cantidad, 1, "y la clave sigue pendiente");
  ok(enDisco(g, "k"), "con su marca en disco");

  const r2 = g.reintentarPendientes();
  await ticks(3);
  igual(e.llamadas, 3, "se puede volver a reintentar");
  e.liberar();
  igual(await r2, 0, "esta vez sale bien: 0 pendientes");
  ok(!enDisco(g, "k"), "la marca de disco se borra");
  igual(e.maxConcurrente.k, 1, "una escritura a la vez");

  console.log("== un conflicto no se reintenta solo");
  const gc = await guardadoNuevo();
  const ec = crearEscritor();
  gc.configurarGuardado({ escribir: ec.escribir, alCambiar: function () {} });
  const pc = gc.guardarClave("k", "{}");
  await ticks(2);
  const err = new Error("Alguien más guardó (prueba)"); err.esConflicto = true;
  ec.fallar(err);
  await pc;
  igual(gc.estadoGuardado().clavesConflicto.length, 1, "la clave quedó marcada como conflicto");
  const rc = await gc.reintentarPendientes();
  await ticks(2);
  igual(ec.llamadas, 1, "reintentarPendientes() no vuelve a escribir una clave en conflicto");
  igual(rc, 1, "y sigue contando como pendiente");

  console.log("== claves distintas no se estorban");
  const gd = await guardadoNuevo();
  const ed = crearEscritor();
  gd.configurarGuardado({ escribir: ed.escribir, alCambiar: function () {} });
  const pa = gd.guardarClave("a", "{}");
  const pb = gd.guardarClave("b", "{}");
  await ticks(2);
  igual(ed.llamadas, 2, "dos claves distintas escriben a la vez (cada una su ronda)");
  ed.liberar(); ed.liberar();
  await Promise.all([pa, pb]);
  igual(gd.estadoGuardado().cantidad, 0, "y las dos terminan");
}

console.log("");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de la cola de guardado");
process.exit(fallos ? 1 : 0); // sale a la fuerza: el reintento programado (15 s) dejaría el proceso colgado
