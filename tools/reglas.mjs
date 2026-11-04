// Reglas de arquitectura del Panel del Taller (Hallazgo #67): revisan el código
// FUENTE, sin ejecutarlo, y devuelven las violaciones que encuentran. No juzgan
// si una violación es aceptable: eso lo decide docs/reglas-baseline.json (la
// lista base de lo ya conocido, cada entrada con su motivo). Quien juzga es
// test/arquitectura.mjs: lo que está en la lista base solo AVISA; lo que no está
// FALLA. Texto explicado para el dueño: docs/REGLAS-DE-ARQUITECTURA.md.
//
// Una violación es { clave, archivo, linea, detalle }. La `clave` NO lleva número
// de línea (para que no se desactualice con cada edición): es archivo + nombre
// de la función/acción + lo que identifica el caso.

import { comparar } from "./analisis.mjs";

export const REGLAS = [
  { id: "R1-mes-cerrado", titulo: "Toda acción que crea, cambia o quita un movimiento (o una transferencia) llama a exigirMesAbierto" },
  { id: "R1b-guarda-primero", titulo: "La guarda del mes cerrado va ANTES de la primera escritura de la acción" },
  { id: "R2-porcentaje-redondeado", titulo: "Todo cálculo con porcentaje de dinero pasa por redondearPesos / calcIvaDeBase" },
  { id: "R3-iva-una-fuente", titulo: "El IVA solo sale de calcIvaDeBase" },
  { id: "R4-marca-de-origen", titulo: "Todo movimiento que crea el sistema lleva una marca de origen registrada" },
  { id: "R5-esquemas-solo-crecen", titulo: "Las columnas de las hojas solo crecen AL FINAL (foto en docs/esquemas.snapshot.json)" },
  { id: "R6-pruebas-en-ci", titulo: "Todo test/*.mjs está en el workflow de la CI y en el script test de package.json" },
  { id: "R7-persist-clave-valida", titulo: "Todo persist(\"x\") usa una clave que existe en KEYS" },
  { id: "R8-acciones-unicas", titulo: "Ninguna acción de la interfaz está definida dos veces" }
];

const PALABRAS_REDONDEO = /redondearPesos\s*\(|calcIvaDeBase\s*\(/;

function lineaTexto(src, linea) {
  return (src.split("\n")[linea - 1] || "").trim().replace(/\s+/g, " ");
}

function esAccion(u) { return u.tipo === "accion"; }

// ---------------------------------------------------------------------------
// R1 y R1b
// ---------------------------------------------------------------------------
const CLAVES_MOVIMIENTO = ["tx", "txPapelera", "transferencias"];

function r1(M) {
  const out = [], out1b = [];
  M.acciones.forEach((a) => {
    const alc = M.alcance(a);
    const sitios = [];
    alc.forEach((u) => u.sitios.forEach((s) => { if (CLAVES_MOVIMIENTO.indexOf(s.clave) !== -1) sitios.push({ s, u }); }));
    // Cargar datos al abrir la app (loadAll) no es una acción; aquí solo se miran acciones.
    // Además de los sitios que el análisis ve, cuenta el `persist` de movimientos o
    // transferencias: es la intención de guardar y no depende de alias (una variable
    // que apunta a un movimiento y le cambia el monto).
    const persisteMov = [];
    alc.forEach((u) => u.persists.forEach((p) => { if (p.clave && CLAVES_MOVIMIENTO.indexOf(p.clave) !== -1) persisteMov.push(p.clave); }));
    if (!sitios.length && !persisteMov.length) return;
    const guardas = [];
    alc.forEach((u) => u.guardas.forEach((g) => { if (u.archivo !== "js/core/cierre.js") guardas.push({ g, u }); }));
    const clave = a.archivo + "::accion:" + a.nombre;
    if (!guardas.length) {
      out.push({
        clave, archivo: a.archivo, linea: a.linea,
        detalle: "la acción «" + a.nombre + "» escribe " + ([...new Set(sitios.map((x) => x.s.clave + " (" + x.s.operacion + ")"))].join(", ") || "persist(" + [...new Set(persisteMov)].join(", ") + ")") + " y no llama a exigirMesAbierto"
      });
      return;
    }
    // R1b: si la propia acción escribe y guarda, la guarda debe ir antes de su primera escritura
    const propios = sitios.filter((x) => x.u === a);
    const propiasGuardas = guardas.filter((x) => x.u === a);
    if (propios.length && propiasGuardas.length) {
      const primeraEscritura = Math.min.apply(null, propios.map((x) => x.s.off));
      const primeraGuarda = Math.min.apply(null, propiasGuardas.map((x) => x.g.off));
      if (primeraGuarda > primeraEscritura) {
        out1b.push({ clave, archivo: a.archivo, linea: a.linea, detalle: "la acción «" + a.nombre + "» llama a la guarda DESPUÉS de escribir (línea de la guarda " + propiasGuardas[0].g.linea + ")" });
      }
    }
  });
  return { r1: out, r1b: out1b };
}

// ---------------------------------------------------------------------------
// R2: porcentajes de dinero
// ---------------------------------------------------------------------------
function r2(M, fuentes) {
  const out = [];
  M.rutas.forEach((ruta) => {
    const A = M.archivos[ruta];
    const { cd, L } = A._interno;
    const re = /\/\s*100(?![\d.])/g;
    let m;
    while ((m = re.exec(cd)) !== null) {
      const linea = L(m.index);
      const lineas = fuentes[ruta].split("\n");
      const ventana = [lineas[linea - 2] || "", lineas[linea - 1] || "", lineas[linea] || ""].join("\n");
      if (PALABRAS_REDONDEO.test(ventana)) continue;
      const u = A.unidades.filter((x) => m.index >= x.inicio && m.index <= x.cierra)[0];
      out.push({
        clave: ruta + "::" + (u ? u.nombre : "(módulo)") + "::" + lineaTexto(fuentes[ruta], linea).slice(0, 110).trimEnd(),
        archivo: ruta, linea,
        detalle: "división entre 100 sin redondearPesos/calcIvaDeBase cerca: " + lineaTexto(fuentes[ruta], linea).slice(0, 110)
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// R3: el IVA
// ---------------------------------------------------------------------------
function r3(M, fuentes) {
  const out = [];
  M.rutas.forEach((ruta) => {
    const A = M.archivos[ruta];
    const { cd, L } = A._interno;
    const lineasCd = cd.split("\n");
    const lineasSrc = fuentes[ruta].split("\n");
    // aritmética con el porcentaje del IVA, o la tasa escrita a mano
    const patrones = [/\biva\w*\s*\.\s*porcentaje\b|\bivaPct\b|\bporcentajeIva\b/gi, /(?:\*|\/)\s*(?:1\.19|0\.19)\b/g];
    const vistos = new Set();
    patrones.forEach((re, k) => {
      let m;
      while ((m = re.exec(cd)) !== null) {
        const linea = L(m.index);
        if (vistos.has(linea)) continue;
        if (k === 0 && !/[*/]/.test(lineasCd[linea - 1])) continue; // solo mostrarlo no es calcularlo
        vistos.add(linea);
        const u = A.unidades.filter((x) => m.index >= x.inicio && m.index <= x.cierra)[0];
        if (u && u.nombre === "calcIvaDeBase") continue;
        const texto = (lineasSrc[linea - 1] || "").trim().replace(/\s+/g, " ").slice(0, 110).trimEnd();
        out.push({
          clave: ruta + "::" + (u ? u.nombre : "(módulo)") + "::" + texto,
          archivo: ruta, linea,
          detalle: "cuenta con el IVA fuera de calcIvaDeBase: " + texto
        });
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// R4: marca de origen
// ---------------------------------------------------------------------------
function r4(M) {
  const campos = M.marcas.map((m) => m.campo);
  const out = [];
  M.acciones.concat(M.rutas.flatMap((r) => M.archivos[r].unidades.filter((u) => u.tipo === "funcion"))).forEach((u) => {
    u.sitios.forEach((s) => {
      if (s.clave !== "tx" || s.operacion !== "crear") return;
      if (s.claves.some((k) => campos.indexOf(k) !== -1)) return;
      out.push({
        clave: u.archivo + "::" + (u.tipo === "accion" ? "accion:" : "") + u.nombre,
        archivo: u.archivo, linea: s.linea,
        detalle: "«" + u.nombre + "» crea un movimiento" + (s.tipoMov ? " de tipo «" + s.tipoMov + "»" : "") + " sin ningún campo de MARCAS_ORIGEN_SISTEMA (" + (s.claves.join(", ") || s.detalle) + ")"
      });
    });
  });
  // un mismo caso puede tener varios sitios: una violación por clave
  const visto = new Set();
  return out.filter((v) => { if (visto.has(v.clave)) return false; visto.add(v.clave); return true; });
}

// ---------------------------------------------------------------------------
// R5: esquemas de hoja
// ---------------------------------------------------------------------------
export function esquemasActuales(M) {
  const res = {};
  M.rutas.forEach((r) => M.archivos[r].tablas.forEach((t) => {
    res[t.pestana] = t.columnas.map((c) => ({ key: c.key, header: c.header, tipo: c.tipo }));
  }));
  const ordenado = {};
  Object.keys(res).sort(comparar).forEach((k) => { ordenado[k] = res[k]; });
  return ordenado;
}

// Compara la foto guardada con las columnas de hoy. Devuelve { violaciones, nuevas }:
//   violaciones → algo ya fotografiado cambió de lugar, de nombre o de tipo, o se quitó
//   nuevas      → columnas/tablas agregadas AL FINAL (permitido, pero la foto debe ponerse al día)
export function compararEsquemas(foto, actual) {
  const violaciones = [], nuevas = [];
  Object.keys(foto).sort(comparar).forEach((pestana) => {
    const antes = foto[pestana], ahora = actual[pestana];
    if (!ahora) { violaciones.push({ clave: "esquema:" + pestana + ":tabla-quitada", archivo: "js/core/sheetsEsquemas.js", linea: 0, detalle: "la pestaña «" + pestana + "» ya no tiene esquema" }); return; }
    antes.forEach((col, i) => {
      const c = ahora[i];
      if (!c) { violaciones.push({ clave: "esquema:" + pestana + ":quitada:" + col.key, archivo: "js/core/sheetsEsquemas.js", linea: 0, detalle: "«" + pestana + "»: la columna " + (i + 1) + " («" + col.key + "») ya no está" }); return; }
      if (c.key !== col.key || c.header !== col.header || c.tipo !== col.tipo) {
        violaciones.push({
          clave: "esquema:" + pestana + ":cambio:" + (i + 1), archivo: "js/core/sheetsEsquemas.js", linea: 0,
          detalle: "«" + pestana + "», columna " + (i + 1) + ": era «" + col.key + "/" + col.header + "/" + col.tipo + "» y ahora es «" + c.key + "/" + c.header + "/" + c.tipo + "» (una columna nueva va al FINAL, nunca en medio)"
        });
      }
    });
    for (let i = antes.length; i < ahora.length; i++) nuevas.push(pestana + " columna " + (i + 1) + " «" + ahora[i].key + "»");
  });
  Object.keys(actual).sort(comparar).forEach((pestana) => { if (!foto[pestana]) nuevas.push("pestaña nueva «" + pestana + "»"); });
  return { violaciones, nuevas };
}

function r5(M, ctx) {
  if (!ctx.fotoEsquemas) return [{ clave: "esquema:sin-foto", archivo: "docs/esquemas.snapshot.json", linea: 0, detalle: "falta docs/esquemas.snapshot.json: corre npm run mapa" }];
  return compararEsquemas(ctx.fotoEsquemas, esquemasActuales(M)).violaciones;
}

// ---------------------------------------------------------------------------
// R6: pruebas en la CI
// ---------------------------------------------------------------------------
function r6(ctx) {
  const out = [];
  (ctx.pruebasEnDisco || []).forEach((t) => {
    if (ctx.workflow.indexOf("node test/" + t) === -1) out.push({ clave: "prueba:" + t + ":workflow", archivo: ".github/workflows/test.yml", linea: 0, detalle: "test/" + t + " no está en .github/workflows/test.yml" });
    if (ctx.scriptTest.indexOf("node test/" + t) === -1) out.push({ clave: "prueba:" + t + ":package", archivo: "package.json", linea: 0, detalle: "test/" + t + " no está en el script test de package.json" });
  });
  return out;
}

// ---------------------------------------------------------------------------
// R7: persist
// ---------------------------------------------------------------------------
function r7(M) {
  const out = [];
  const validas = new Set(Object.keys(M.KEYS));
  M.rutas.forEach((r) => M.archivos[r].persists.forEach((p) => {
    if (p.clave !== null) {
      if (!validas.has(p.clave)) out.push({ clave: r + "::" + p.unidad + "::" + p.clave, archivo: r, linea: p.linea, detalle: "persist(\"" + p.clave + "\") usa una clave que no está en KEYS (js/core/constants.js)" });
    } else {
      out.push({ clave: r + "::" + p.unidad + "::dinamico:" + p.expr, archivo: r, linea: p.linea, detalle: "persist(" + p.expr + ") usa una clave calculada: no se puede comprobar con el código" });
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// R8: acciones repetidas
// ---------------------------------------------------------------------------
function r8(M) {
  const por = {};
  M.acciones.forEach((a) => { (por[a.nombre] = por[a.nombre] || []).push(a); });
  const out = [];
  Object.keys(por).sort(comparar).forEach((n) => {
    if (por[n].length > 1) {
      out.push({ clave: "accion-repetida:" + n, archivo: por[n][0].archivo, linea: por[n][0].linea, detalle: "la acción «" + n + "» está definida en " + por[n].map((a) => a.archivo + ":" + a.linea).join(" y ") + ": la última que se registre pisa a la otra" });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------
// ctx: { fuentes, fotoEsquemas, pruebasEnDisco: ["a.mjs"], workflow: "texto", scriptTest: "texto" }
export function evaluarReglas(M, ctx) {
  const { r1: a, r1b: b } = r1(M);
  const res = {
    "R1-mes-cerrado": a,
    "R1b-guarda-primero": b,
    "R2-porcentaje-redondeado": r2(M, ctx.fuentes),
    "R3-iva-una-fuente": r3(M, ctx.fuentes),
    "R4-marca-de-origen": r4(M),
    "R5-esquemas-solo-crecen": r5(M, ctx),
    "R6-pruebas-en-ci": r6(ctx),
    "R7-persist-clave-valida": r7(M),
    "R8-acciones-unicas": r8(M)
  };
  Object.keys(res).forEach((k) => { res[k].sort((x, y) => comparar(x.clave, y.clave)); });
  return res;
}
