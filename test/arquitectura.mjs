// Reglas de arquitectura (Hallazgo #67): revisan el código FUENTE, sin ejecutarlo,
// y comprueban que los documentos de docs/ estén al día con él.
//
// Se corre solo, aparte de smoke.mjs:   node test/arquitectura.mjs
//   --candidatas   imprime las entradas de docs/reglas-baseline.json para los casos nuevos
//
// No necesita jsdom ni npm: usa solo módulos nativos de Node (tools/analisis.mjs
// lee el código; tools/reglas.mjs aplica las reglas; tools/mapa.mjs arma los
// documentos). Reglas explicadas en docs/REGLAS-DE-ARQUITECTURA.md.
//
// Política (decisión del dueño): lo que YA incumple una regla está en
// docs/reglas-baseline.json con su motivo y solo AVISA; cualquier caso nuevo
// FALLA. Los documentos generados que quedaron viejos también FALLAN.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const T = new URL("../tools/", import.meta.url).href;
const { leerContexto, generarDocumentos, estadoReglas } = await import(T + "mapa.mjs");
const { REGLAS, evaluarReglas, compararEsquemas, esquemasActuales } = await import(T + "reglas.mjs");
const { analizar, ciclos, normalizarTexto, comparar } = await import(T + "analisis.mjs");

let fallos = 0, pruebas = 0, avisos = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { ok(a === b, msg + "  (obtuvo " + a + ", esperaba " + b + ")"); }
function aviso(msg) { avisos++; console.log("  ⚠ AVISO " + msg); }
const quieroCandidatas = process.argv.indexOf("--candidatas") !== -1;

const ctx = leerContexto(RAIZ);
const M = ctx.M;

// ======================= 1. El analizador entiende el código =======================
// Si el analizador se rompiera y no encontrara nada, todas las reglas pasarían
// "en vacío". Estas cifras mínimas son el seguro contra eso.
console.log("== el analizador lee el código");
{
  ok(M.rutas.length >= 40, "lee los archivos de js/ (" + M.rutas.length + ")");
  ok(M.acciones.length >= 300, "encuentra las acciones de la interfaz (" + M.acciones.length + ")");
  ok(M.marcas.length >= 10, "encuentra MARCAS_ORIGEN_SISTEMA (" + M.marcas.length + ")");
  ok(Object.keys(M.KEYS).length >= 20, "encuentra KEYS (" + Object.keys(M.KEYS).length + ")");
  const persists = M.rutas.reduce((a, r) => a + M.archivos[r].persists.length, 0);
  ok(persists >= 150, "encuentra las llamadas a persist (" + persists + ")");
  const creaciones = M.rutas.reduce((a, r) => a + M.archivos[r].unidades.reduce((b, u) => b + u.sitios.filter((s) => s.clave === "tx" && s.operacion === "crear").length, 0), 0);
  ok(creaciones >= 15, "encuentra los sitios que crean movimientos (" + creaciones + ")");
  const pestanas = Object.keys(esquemasActuales(M));
  ok(["Bitacora", "Cierres", "Clientes", "Cotizaciones", "Movimientos"].every((p) => pestanas.indexOf(p) !== -1), "encuentra las 5 hojas con columnas propias (" + pestanas.join(", ") + ")");
  const add = M.acciones.filter((a) => a.nombre === "add-abono")[0];
  ok(!!add && M.alcance(add).some((u) => u.guardas.length) && M.alcance(add).some((u) => u.sitios.some((s) => s.operacion === "crear")), "reconoce que add-abono crea un movimiento y llama a exigirMesAbierto");
  ok(ciclos(M).length >= 1, "sabe de los ciclos de importación que ya existen");
}

// ======================= 2. Las reglas =======================
console.log("== reglas de arquitectura (lista base: avisa · casos nuevos: fallan)");
const estado = estadoReglas(ctx);
{
  REGLAS.forEach((r) => {
    const e = estado[r.id];
    const base = e.conocidas;
    const riesgos = base.filter((v) => e.base.some((b) => b.clave === v.clave && b.clasificacion === "riesgo-real"));
    console.log("  " + r.id + " — " + r.titulo);
    base.forEach((v) => {
      const b = e.base.filter((x) => x.clave === v.clave)[0];
      aviso(r.id + (b.clasificacion === "riesgo-real" ? " [RIESGO REAL " + (b.hallazgo || "") + (b.severidad ? ", " + b.severidad : "") + "]" : " [excepción legítima]") + " " + v.archivo + (v.linea ? ":" + v.linea : "") + " — " + v.detalle.slice(0, 120));
    });
    e.obsoletas.forEach((b) => aviso(r.id + " la lista base trae «" + b.clave.slice(0, 100) + "» que ya no se da: bórrala de docs/reglas-baseline.json"));
    ok(e.nuevas.length === 0, r.id + ": ningún caso nuevo (" + e.violaciones.length + " en total, " + base.length + " conocidos" + (riesgos.length ? ", " + riesgos.length + " riesgos reales" : "") + ")");
    e.nuevas.forEach((v) => {
      console.log("      → " + v.archivo + (v.linea ? ":" + v.linea : "") + ": " + v.detalle);
      console.log("        Si es un error: corrígelo. Si es a propósito: agrega a docs/reglas-baseline.json la clave «" + v.clave + "» con su motivo (ver docs/REGLAS-DE-ARQUITECTURA.md).");
    });
  });
  // toda entrada de la lista base trae su motivo y su clasificación
  const todas = [];
  Object.keys(ctx.baseline.reglas || {}).forEach((rid) => ctx.baseline.reglas[rid].forEach((b) => todas.push({ rid, b })));
  ok(todas.every((x) => x.b.motivo && x.b.motivo.length >= 20), "toda entrada de la lista base trae un motivo");
  ok(todas.every((x) => x.b.clasificacion === "excepcion-legitima" || x.b.clasificacion === "riesgo-real"), "y una clasificación: excepción legítima o riesgo real");
  ok(todas.filter((x) => x.b.clasificacion === "riesgo-real").every((x) => x.b.hallazgo && x.b.severidad), "y todo riesgo real trae su hallazgo y su severidad");
  ok(Object.keys(ctx.baseline.reglas || {}).every((rid) => REGLAS.some((r) => r.id === rid)), "y solo habla de reglas que existen");
  if (quieroCandidatas) {
    console.log("\n-- entradas candidatas para docs/reglas-baseline.json --");
    REGLAS.forEach((r) => estado[r.id].nuevas.forEach((v) => console.log(JSON.stringify({ regla: r.id, clave: v.clave, clasificacion: "excepcion-legitima", motivo: "(explica por qué es a propósito)" }, null, 2))));
  }
}

// ======================= 3. Las reglas SÍ detectan (prueba de las pruebas) =======================
// Se le da al analizador un archivo inventado con un defecto de cada tipo y se
// comprueba que la regla correspondiente lo señala. Sin esto, una regla rota
// pasaría siempre.
console.log("== cada regla detecta su defecto en un archivo de prueba");
{
  const trampa = [
    'import { state, persist } from "../core/store.js";',
    'export var actions = {',
    '  "prueba-sin-guarda": function () {',
    '    state.tx.unshift({ id: "x", tipo: "gasto", monto: 5, fecha: "2026-01-01" });',
    '    persist("tx");',
    '  },',
    '  "prueba-guarda-tarde": function () {',
    '    state.tx.unshift({ id: "y", tipo: "gasto", monto: 5, fecha: "2026-01-01", origenAbonoId: "a" });',
    '    exigirMesAbierto(["2026-01-01"], "probar");',
    '    persist("tx");',
    '  },',
    '  "prueba-porcentaje": function () { var comision = 5000 * 7 / 100; return comision; },',
    '  "prueba-iva": function (p) { var total = p.total * p.iva.porcentaje / 100; return total; },',
    '  "prueba-clave": function () { persist("clave-que-no-existe"); },',
    '  "add-abono": function () {}',
    '};'
  ].join("\n");
  const fuentes2 = Object.assign({}, ctx.fuentes, { "js/modules/_prueba.js": trampa });
  const M2 = analizar(fuentes2);
  const v = evaluarReglas(M2, { fuentes: fuentes2, fotoEsquemas: esquemasActuales(M2), pruebasEnDisco: ["a.mjs", "b.mjs"], workflow: "node test/a.mjs", scriptTest: "node test/a.mjs && node test/b.mjs" });
  const tiene = (regla, clave) => v[regla].some((x) => x.clave === clave || x.clave.indexOf(clave) === 0);
  ok(tiene("R1-mes-cerrado", "js/modules/_prueba.js::accion:prueba-sin-guarda"), "R1 señala una acción que escribe movimientos sin exigirMesAbierto");
  ok(!tiene("R1-mes-cerrado", "js/modules/_prueba.js::accion:prueba-guarda-tarde"), "...y no señala a la que sí lo llama");
  ok(tiene("R1b-guarda-primero", "js/modules/_prueba.js::accion:prueba-guarda-tarde"), "R1b señala una guarda que va DESPUÉS de escribir");
  ok(tiene("R2-porcentaje-redondeado", "js/modules/_prueba.js::prueba-porcentaje"), "R2 señala un porcentaje de dinero sin redondear");
  ok(tiene("R3-iva-una-fuente", "js/modules/_prueba.js::prueba-iva"), "R3 señala el IVA calculado fuera de calcIvaDeBase");
  ok(tiene("R4-marca-de-origen", "js/modules/_prueba.js::accion:prueba-sin-guarda"), "R4 señala un movimiento creado sin marca de origen");
  ok(!tiene("R4-marca-de-origen", "js/modules/_prueba.js::accion:prueba-guarda-tarde"), "...y no al que trae una marca registrada");
  ok(tiene("R7-persist-clave-valida", "js/modules/_prueba.js::prueba-clave::clave-que-no-existe"), "R7 señala un persist con una clave que no existe");
  ok(tiene("R8-acciones-unicas", "accion-repetida:add-abono"), "R8 señala una acción definida en dos módulos");
  ok(tiene("R6-pruebas-en-ci", "prueba:b.mjs:workflow") && !tiene("R6-pruebas-en-ci", "prueba:b.mjs:package"), "R6 señala una prueba que falta en el workflow (y no si está en package.json)");
  // R5
  const foto = { Hoja: [{ key: "a", header: "a", tipo: "texto" }, { key: "b", header: "b", tipo: "texto" }] };
  const alFinal = compararEsquemas(foto, { Hoja: foto.Hoja.concat([{ key: "c", header: "c", tipo: "texto" }]) });
  ok(alFinal.violaciones.length === 0 && alFinal.nuevas.length === 1, "R5 acepta una columna agregada AL FINAL (y la anota como nueva)");
  const enMedio = compararEsquemas(foto, { Hoja: [foto.Hoja[0], { key: "c", header: "c", tipo: "texto" }, foto.Hoja[1]] });
  ok(enMedio.violaciones.length >= 1, "R5 rechaza una columna insertada en medio");
  const quitada = compararEsquemas(foto, { Hoja: [foto.Hoja[0]] });
  ok(quitada.violaciones.length === 1, "R5 rechaza una columna quitada");
  const otroTipo = compararEsquemas(foto, { Hoja: [foto.Hoja[0], { key: "b", header: "b", tipo: "numero" }] });
  ok(otroTipo.violaciones.length === 1, "R5 rechaza una columna que cambió de tipo");
}

// ======================= 4. Los esquemas contra su foto =======================
console.log("== esquemas de las hojas contra docs/esquemas.snapshot.json");
{
  ok(!!ctx.fotoEsquemas, "existe la foto de las columnas");
  const cmp = compararEsquemas(ctx.fotoEsquemas || {}, esquemasActuales(M));
  igual(cmp.violaciones.length, 0, "ninguna columna cambió de lugar, nombre o tipo, ni se quitó" + (cmp.violaciones.length ? ": " + cmp.violaciones[0].detalle : ""));
  igual(cmp.nuevas.length, 0, "y no hay columnas nuevas sin registrar en la foto" + (cmp.nuevas.length ? " (" + cmp.nuevas.join(", ") + "): corre npm run mapa" : ""));
}

// ======================= 5. Pruebas en la CI =======================
console.log("== todo test/*.mjs corre en la CI y en npm test");
{
  ok(ctx.pruebasEnDisco.length >= 6, "hay archivos de prueba (" + ctx.pruebasEnDisco.join(", ") + ")");
  ctx.pruebasEnDisco.forEach((t) => {
    ok(ctx.workflow.indexOf("node test/" + t) !== -1, "test/" + t + " está en .github/workflows/test.yml");
    ok(ctx.scriptTest.indexOf("node test/" + t) !== -1, "test/" + t + " está en el script test de package.json");
  });
  let pkg = {};
  try { pkg = JSON.parse(normalizarTexto(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"))); } catch (e) { /* abajo falla */ }
  ok(pkg.scripts && pkg.scripts.mapa === "node tools/mapa.mjs", "package.json tiene el script «mapa»");
}

// ======================= 6. Documentos al día =======================
console.log("== los documentos generados están al día");
{
  const docs = generarDocumentos(ctx);
  const docs2 = generarDocumentos(leerContexto(RAIZ));
  ok(Object.keys(docs).every((k) => docs[k] === docs2[k]), "la generación es determinista: dos corridas dan exactamente lo mismo");
  Object.keys(docs).sort(comparar).forEach((rel) => {
    const abs = path.join(RAIZ, rel);
    const enDisco = fs.existsSync(abs) ? normalizarTexto(fs.readFileSync(abs, "utf8")) : null;
    const igualDoc = enDisco === docs[rel];
    ok(igualDoc, rel + " está al día" + (igualDoc ? "" : " — el código cambió: corre  npm run mapa  y sube el documento"));
    if (enDisco !== null && !igualDoc) {
      const a = enDisco.split("\n"), b = docs[rel].split("\n");
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.log("      primera diferencia, línea " + (i + 1) + ":\n        en disco:  " + (a[i] || "").slice(0, 140) + "\n        debería:   " + (b[i] || "").slice(0, 140));
    }
  });
  ["docs/ARQUITECTURA.md", "docs/MAPA-DEL-CODIGO.md", "docs/MAPA-DEL-DINERO.md", "docs/ESCENARIOS-DE-FALLA.md", "docs/REGLAS-DE-ARQUITECTURA.md", "docs/reglas-baseline.json", "docs/esquemas.snapshot.json"].forEach((rel) => {
    ok(fs.existsSync(path.join(RAIZ, rel)), rel + " existe");
  });
}

// ======================= 7. Las citas de los documentos escritos a mano =======================
// Cada `archivo:línea` de un documento escrito a mano tiene que apuntar a una línea que
// existe, y a la MISMA línea que cuando el autor la verificó: docs/citas.snapshot.json
// guarda el texto de cada línea citada y npm run mapa reancla solo las que se
// movieron (tools/citas.mjs). Una cita cuya línea CAMBIÓ de verdad (ya no existe
// ese texto en el archivo) AVISA hasta que alguien la revise; si son demasiadas,
// el documento está viejo y FALLA. Un nombre pegado a su cita («`guardarClave`
// (`js/core/guardado.js:371`)») tiene que seguir en esa línea.
console.log("== las citas archivo:línea de los documentos apuntan a algo real");
{
  const { crearResolver, extraerCitas, reanclar } = await import(T + "citas.mjs");
  const { DOCS_CON_CITAS } = await import(T + "mapa.mjs");
  const resolver = crearResolver(M.rutas, ctx.pruebasEnDisco);
  const cache = {};
  const lineasDe = (rel) => {
    if (cache[rel] === undefined) { const x = ctx.leer(rel); cache[rel] = x === null ? null : x.split("\n"); }
    return cache[rel];
  };
  const rotas = [], desanclados = [];
  let total = 0;
  DOCS_CON_CITAS.forEach((doc) => {
    const { citas, errores } = extraerCitas(ctx.leer(doc), resolver);
    errores.forEach((e) => rotas.push(doc + ":" + e.linea + " " + e.error));
    citas.forEach((c) => {
      total++;
      const ls = lineasDe(c.rel);
      if (!ls) { rotas.push(doc + ":" + c.linea + " cita " + c.rel + ":" + c.desde + " pero el archivo no existe"); return; }
      if (c.desde < 1 || c.hasta > ls.length || c.hasta < c.desde) { rotas.push(doc + ":" + c.linea + " cita " + c.rel + ":" + c.desde + (c.hasta !== c.desde ? "-" + c.hasta : "") + " pero el archivo tiene " + ls.length + " líneas"); return; }
      if (c.simbolo) {
        const ventana = ls.slice(Math.max(0, c.desde - 1), Math.min(ls.length, c.hasta + 3)).join("\n");
        if (ventana.indexOf(c.simbolo) === -1) desanclados.push(doc + ":" + c.linea + " «" + c.simbolo + "» ya no está en " + c.rel + ":" + c.desde);
      }
    });
  });
  ok(total >= 100, "los documentos citan el código (" + total + " citas)");
  rotas.forEach((r) => console.log("      → " + r));
  igual(rotas.length, 0, "ninguna cita apunta a un archivo o una línea que no existe");
  desanclados.slice(0, 15).forEach((d) => aviso("cita desanclada: " + d));
  ok(desanclados.length <= 25, "las citas con nombre siguen apuntando a su función (" + desanclados.length + " desancladas; más de 25 = documento viejo: revísalo)");
  // la foto: ninguna cita cambió de verdad
  const ic = ctx.informeCitas || { rotas: [], movidas: [] };
  ic.rotas.slice(0, 15).forEach((r) => aviso("cita a revisar a mano: " + r.doc + ":" + r.linea + " " + r.cita + " — antes «" + (r.antes || "").slice(0, 60) + "», ahora «" + String(r.ahora || "(ya no existe)").slice(0, 60) + "»"));
  ok(ic.rotas.length <= 25, "las líneas citadas siguen diciendo lo que decían (" + ic.rotas.length + " cambiaron de verdad; más de 25 = documento viejo: revísalo)");
  igual(ic.movidas.length, 0, "ninguna cita quedó fuera de lugar" + (ic.movidas.length ? " — el código se movió: corre  npm run mapa  y se reancla sola" : ""));

  // Prueba de las pruebas: el reanclaje mueve, avisa y fotografía.
  const archivoFalso = ["a", "b", "function persist(key) {", "c", "d"]; // la función estaba en la línea 1 y ahora está en la 3
  const doc = "La función `persist` (`js/core/x.js:1`) y `js/core/x.js:5` y `js/core/x.js:4`.";
  const res2 = crearResolver(["js/core/x.js"], []);
  const lineasFalsas = (rel) => rel === "js/core/x.js" ? archivoFalso : null;
  const foto = [{ cita: "js/core/x.js:1", texto: "function persist(key) {" }, { cita: "js/core/x.js:5", texto: "esta línea ya no existe" }];
  const r = reanclar(doc, res2, lineasFalsas, foto);
  ok(r.texto.indexOf("`js/core/x.js:3`") !== -1 && r.texto.indexOf("`js/core/x.js:1`") === -1, "el reanclaje mueve una cita cuyo texto se movió de línea");
  ok(r.movidas.length === 1 && r.rotas.length === 1, "...avisa de la cita cuyo texto ya no existe (y no la toca)");
  ok(r.nuevas === 1 && r.foto.length === 3, "...y fotografía las citas nuevas tal como están");
  const r2 = reanclar(r.texto, res2, lineasFalsas, r.foto);
  ok(r2.texto === r.texto && r2.movidas.length === 0, "reanclar dos veces da lo mismo (idempotente)");
}

console.log("");
if (avisos) console.log(avisos + " aviso(s): lo conocido (lista base) y las citas desancladas; no hacen fallar.");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de arquitectura");
process.exit(fallos ? 1 : 0);
