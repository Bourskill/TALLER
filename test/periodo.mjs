// Periodo nuevo (js/core/periodo.js) y copias locales atadas a la hoja y al
// periodo (js/core/hojaLocal.js).
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

var dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;

var { alinearCopiasConHoja, identidadHoja, HOJA_LOCAL_KEY, HOJA_ANTERIOR_CONOCIDA } = await import("../js/core/hojaLocal.js");
var { kvParaPeriodoNuevo, PERIODO_KEY, CLAVES_KV_A_VACIAR } = await import("../js/core/periodo.js");

var ok = 0;
function prueba(nombre, fn) { fn(); ok++; console.log("  ok " + nombre); }

function almacen(inicial) {
  var m = new Map(Object.entries(inicial || {}));
  return {
    get length() { return m.size; },
    key: function (i) { return Array.from(m.keys())[i] ?? null; },
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
}

var LEGADO = identidadHoja(HOJA_ANTERIOR_CONOCIDA, "");

console.log("== copias locales");
prueba("navegador sin marca, misma hoja y sin periodo: no borra nada", function () {
  var a = almacen({ "taller_espejo_v1:pedidos": "[1]" });
  assert.equal(alinearCopiasConHoja(LEGADO, a), 0);
  assert.equal(a.getItem("taller_espejo_v1:pedidos"), "[1]");
  assert.equal(a.getItem(HOJA_LOCAL_KEY), LEGADO);
});
var b = almacen({ "taller_espejo_v1:pedidos": "[1]", taller_pendientes_v1: "{}", taller_borradores_v1: "{}", otra: "x" });
prueba("navegador sin marca y periodo nuevo: borra lo de la app, deja lo ajeno", function () {
  var nueva = identidadHoja(HOJA_ANTERIOR_CONOCIDA, "2026-11-20@1");
  assert.equal(alinearCopiasConHoja(nueva, b), 3);
  assert.equal(b.getItem("taller_espejo_v1:pedidos"), null);
  assert.equal(b.getItem("otra"), "x");
  assert.equal(b.getItem(HOJA_LOCAL_KEY), nueva);
});
prueba("la carga siguiente, mismo periodo: no borra nada", function () {
  b.setItem("taller_espejo_v1:pedidos", "[]");
  assert.equal(alinearCopiasConHoja(identidadHoja(HOJA_ANTERIOR_CONOCIDA, "2026-11-20@1"), b), 0);
  assert.equal(b.getItem("taller_espejo_v1:pedidos"), "[]");
});
prueba("cambiar de hoja también limpia", function () {
  assert.equal(alinearCopiasConHoja(identidadHoja("OTRA_HOJA", ""), b), 2);
});

console.log("== kv del periodo nuevo");
var cfg = { nombre: "CRIYEAK", nomina: [{ id: "e1" }], gastosFijos: [{ id: "g1" }], colchonMovimientos: [{ id: "c", txId: "t" }], conciliaciones: { banco: { fecha: "x" } }, cuentas: [{ id: "banco" }] };
var filas = [
  ["ui:preferencias", "{\"tema\":\"oscuro\"}"],
  ["config:datos", JSON.stringify(cfg)],
  ["clientes:lista", "[{\"id\":\"cl\"}]"],
  ["cotizaciones:lista", "[{\"id\":\"co\"}]"],
  ["pedidos:lista", "[{\"id\":\"pe\"}]"],
  ["cotizaciones:pdf-contador", "57"],
  ["finanzas:transacciones", "[{\"id\":\"tx\"}]"],
  ["pendientes:lista", "[{\"id\":\"nota\"}]"],
  ["productos:lista", "[{\"id\":\"pr\",\"stock\":{\"M\":3}}]"],
  ["cotizaciones:catalogo", "[{\"id\":\"in\"}]"],
  ["pendientes:deudas", "[{\"id\":\"de\"}]"],
  ["pendientes:deudas-historial", "[{\"id\":\"vieja\"}]"],
  ["pedidos:papelera", "[{\"id\":\"pp\"}]"],
  ["finanzas:papelera", "[{\"id\":\"fp\"}]"],
  ["borrador:cotizaciones:a@b.c:x", "{}"],
  ["__rev__:pedidos", "viejo:1"],
  ["__rev__:config", "viejo:2"],
  ["__migrado__:tx", "1"],
  ["", ""]
];
var n = 0;
var nuevas = kvParaPeriodoNuevo(filas, "2026-11-20@9", function () { return "nueva" + (++n); });
var m = new Map(nuevas.map(function (f) { return [f[0], f[1]]; }));

prueba("vacía pedidos, cotizaciones viejas, movimientos viejos, papeleras y deudas pagadas", function () {
  CLAVES_KV_A_VACIAR.forEach(function (k) { if (m.has(k)) assert.equal(m.get(k), "[]", k); });
  assert.equal(m.get("pedidos:lista"), "[]");
  assert.equal(m.get("finanzas:papelera"), "[]");
});
prueba("conserva clientes, catálogo, productos con stock, notas, deudas pendientes, ui y contador de PDF", function () {
  ["ui:preferencias", "clientes:lista", "cotizaciones:pdf-contador", "pendientes:lista", "productos:lista", "cotizaciones:catalogo", "pendientes:deudas", "__migrado__:tx"].forEach(function (k) {
    assert.equal(m.get(k), filas.find(function (f) { return f[0] === k; })[1], k);
  });
});
prueba("la configuración se conserva salvo Colchón y conciliaciones", function () {
  var c = JSON.parse(m.get("config:datos"));
  assert.equal(c.nombre, "CRIYEAK");
  assert.deepEqual(c.nomina, cfg.nomina);
  assert.deepEqual(c.gastosFijos, cfg.gastosFijos);
  assert.deepEqual(c.cuentas, cfg.cuentas);
  assert.deepEqual(c.colchonMovimientos, []);
  assert.deepEqual(c.conciliaciones, {});
});
prueba("quita los borradores y las filas vacías", function () {
  assert.ok(!nuevas.some(function (f) { return f[0].indexOf("borrador:") === 0 || !f[0]; }));
});
prueba("renueva TODAS las revisiones (una pestaña abierta con datos viejos choca y no sobrescribe)", function () {
  assert.equal(m.get("__rev__:pedidos"), "nueva1");
  assert.equal(m.get("__rev__:config"), "nueva2");
});
prueba("anota la marca de periodo, una sola vez", function () {
  assert.equal(m.get(PERIODO_KEY), "2026-11-20@9");
  var otra = kvParaPeriodoNuevo(nuevas, "2026-12-01@1", function () { return "r"; });
  assert.equal(otra.filter(function (f) { return f[0] === PERIODO_KEY; }).length, 1);
  assert.equal(otra.find(function (f) { return f[0] === PERIODO_KEY; })[1], "2026-12-01@1");
});

console.log("== corrida completa contra una hoja simulada");
var auth = await import("../js/core/auth.js");
var { iniciarPeriodoNuevo } = await import("../js/core/periodo.js");
var { SPREADSHEET_ID } = await import("../js/core/google-config.js");

function loginComo(rol) {
  sessionStorage.setItem("taller_sesion_v1", JSON.stringify({
    session: { email: rol + "@x.co", rol: rol, vendedorNombre: "" }, accessToken: "fake", expiraEl: Date.now() + 999999
  }));
  auth.restaurarSesion();
}

// Hoja en memoria: pestaña -> filas (fila 0 = encabezado).
var hoja = {
  kv: [["key", "value"]].concat(filas.filter(function (f) { return f[0]; })),
  Movimientos: [["id", "tipo"], ["t1", "ingreso"], ["t2", "gasto"]],
  Cotizaciones: [["id"], ["c1"]],
  Cierres: [["mes"], ["2026-09"]],
  Clientes: [["id", "nombre"], ["cl", "Ana"]],
  roles: [["correo", "rol"], ["a@x.co", "admin"]]
};
var llamadas = [];
function colIdx(l) { var n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n - 1; }
function parseRango(r) {
  var m = /^([^!]+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?$/.exec(r);
  return { tab: m[1], c0: colIdx(m[2]), r0: +m[3] - 1, c1: m[4] ? colIdx(m[4]) : colIdx(m[2]), r1: m[5] ? +m[5] - 1 : 1e6 };
}
var copiaFalla = false;
globalThis.fetch = async function (url, options) {
  var metodo = (options && options.method) || "GET";
  llamadas.push(metodo + " " + url);
  function json(o, status) { return { ok: (status || 200) < 400, status: status || 200, json: async function () { return o; }, text: async function () { return JSON.stringify(o); } }; }
  if (url.indexOf("drive/v3/files/" + SPREADSHEET_ID + "/copy") !== -1) {
    if (copiaFalla) return json({ error: "no" }, 500);
    var body = JSON.parse(options.body);
    return json({ id: "archivo1", name: body.name });
  }
  var u = decodeURIComponent(url.replace("https://sheets.googleapis.com/v4/spreadsheets/" + SPREADSHEET_ID, ""));
  if (u.indexOf("?fields=sheets.properties") === 0) {
    return json({ sheets: Object.keys(hoja).map(function (t, i) { return { properties: { title: t, sheetId: i, gridProperties: { columnCount: 26 } } }; }) });
  }
  var m = /^\/values\/(.+?)(:clear)?(\?.*)?$/.exec(u);
  var r = parseRango(m[1]);
  var t = hoja[r.tab];
  if (m[2]) {
    for (var i = r.r0; i < t.length && i <= r.r1; i++) for (var c = r.c0; c <= r.c1; c++) if (t[i]) t[i][c] = "";
    return json({});
  }
  if (metodo === "PUT") {
    JSON.parse(options.body).values.forEach(function (fila, k) {
      t[r.r0 + k] = t[r.r0 + k] || [];
      fila.forEach(function (v, c) { t[r.r0 + k][r.c0 + c] = v; });
    });
    return json({});
  }
  return json({ values: t.slice(r.r0, r.r1 + 1).map(function (f) { return f.slice(r.c0, r.c1 + 1); }) });
};

function filasConDatos(tab) { return hoja[tab].slice(1).filter(function (f) { return f.some(function (v) { return v; }); }); }

loginComo("vendedor");
await assert.rejects(iniciarPeriodoNuevo({ fecha: "2026-11-20", nuevaRev: function () { return "r"; } }), /Solo un admin/);
prueba("un vendedor no puede empezar un periodo nuevo (y no se toca la hoja)", function () {
  assert.equal(llamadas.length, 0);
});

loginComo("admin");
copiaFalla = true;
await assert.rejects(iniciarPeriodoNuevo({ fecha: "2026-11-20", nuevaRev: function () { return "r"; } }), /copia de archivo/);
prueba("si la copia de archivo falla, no se borra nada", function () {
  assert.equal(filasConDatos("Movimientos").length, 2);
  assert.equal(llamadas.filter(function (l) { return l.indexOf("PUT") === 0 || l.indexOf(":clear") !== -1; }).length, 0);
});

copiaFalla = false;
localStorage.setItem("taller_espejo_v1:pedidos", "[{\"id\":\"pe\"}]");
var rn = 0;
var res = await iniciarPeriodoNuevo({ fecha: "2026-11-20", folderId: "carpeta", nuevaRev: function () { return "rev" + (++rn); } });
prueba("hace la copia de archivo con nombre de periodo", function () {
  assert.equal(res.archivoNombre, "Panel del Taller — ARCHIVO periodo hasta 2026-11-20");
});
prueba("vacía Movimientos, Cotizaciones y Cierres pero conserva sus encabezados", function () {
  ["Movimientos", "Cotizaciones", "Cierres"].forEach(function (t) { assert.equal(filasConDatos(t).length, 0, t); });
  assert.deepEqual(hoja.Movimientos[0], ["id", "tipo"]);
});
prueba("no toca Clientes ni roles", function () {
  assert.deepEqual(filasConDatos("Clientes"), [["cl", "Ana"]]);
  assert.deepEqual(filasConDatos("roles"), [["a@x.co", "admin"]]);
});
prueba("kv queda sin pedidos ni borradores, sin filas sobrantes, y con la marca de periodo", function () {
  var kv = new Map(filasConDatos("kv").map(function (f) { return [f[0], f[1]]; }));
  assert.equal(kv.get("pedidos:lista"), "[]");
  assert.equal(kv.get("clientes:lista"), "[{\"id\":\"cl\"}]");
  assert.ok(![...kv.keys()].some(function (k) { return k.indexOf("borrador:") === 0; }));
  assert.equal(kv.get(PERIODO_KEY), res.periodo);
  assert.equal(filasConDatos("kv").length, kv.size);
});
prueba("borra las copias locales de este navegador", function () {
  assert.equal(localStorage.getItem("taller_espejo_v1:pedidos"), null);
  assert.equal(localStorage.getItem(HOJA_LOCAL_KEY), identidadHoja(SPREADSHEET_ID, res.periodo));
});

console.log("OK " + ok + " pruebas de periodo nuevo");
process.exit(0);
