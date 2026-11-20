// Copias locales atadas a una hoja (js/core/hojaLocal.js): al cambiar de hoja
// se borran las copias de la anterior; con la misma hoja no se toca nada.
import assert from "node:assert/strict";
import { alinearCopiasConHoja, HOJA_LOCAL_KEY, HOJA_ANTERIOR_CONOCIDA } from "../js/core/hojaLocal.js";

function almacen(inicial) {
  var m = new Map(Object.entries(inicial || {}));
  return {
    get length() { return m.size; },
    key: function (i) { return Array.from(m.keys())[i] ?? null; },
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); },
    _m: m
  };
}

// 1. Navegador viejo (sin marca) con la hoja de siempre: no borra nada.
var a = almacen({ "taller_espejo_v1:pedidos": "[1]", otra: "x" });
assert.equal(alinearCopiasConHoja(HOJA_ANTERIOR_CONOCIDA, a), 0);
assert.equal(a.getItem("taller_espejo_v1:pedidos"), "[1]");
assert.equal(a.getItem(HOJA_LOCAL_KEY), HOJA_ANTERIOR_CONOCIDA);

// 2. Navegador viejo (sin marca) y hoja nueva: borra las copias "taller_", deja lo ajeno.
var b = almacen({ "taller_espejo_v1:pedidos": "[1]", taller_pendientes_v1: "{}", taller_borradores_v1: "{}", otra: "x" });
assert.equal(alinearCopiasConHoja("HOJA_NUEVA", b), 3);
assert.equal(b.getItem("taller_espejo_v1:pedidos"), null);
assert.equal(b.getItem("otra"), "x");
assert.equal(b.getItem(HOJA_LOCAL_KEY), "HOJA_NUEVA");

// 3. Ya anotada con la hoja nueva: la siguiente carga no borra nada.
b.setItem("taller_espejo_v1:pedidos", "[]");
assert.equal(alinearCopiasConHoja("HOJA_NUEVA", b), 0);
assert.equal(b.getItem("taller_espejo_v1:pedidos"), "[]");

// 4. Volver a la hoja archivada también limpia (las copias son de la nueva).
assert.equal(alinearCopiasConHoja(HOJA_ANTERIOR_CONOCIDA, b), 2);

console.log("hojaLocal: OK");
