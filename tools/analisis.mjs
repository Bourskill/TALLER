// Analizador del código del Panel del Taller (Hallazgo #67): lee los archivos de
// js/ SIN ejecutarlos y arma un modelo con lo que importa para revisar la app
// antes de leer el código: qué exporta cada archivo, quién lo usa, qué claves de
// `state` toca, qué `persist(...)` llama, qué acciones de la interfaz existen y
// qué movimientos de dinero crea, cambia o quita cada una.
//
// Lo usan dos cosas, y nada más:
//   - tools/mapa.mjs      → escribe los documentos de docs/ (npm run mapa)
//   - test/arquitectura.mjs → comprueba las reglas de docs/REGLAS-DE-ARQUITECTURA.md
//
// Solo módulos nativos de Node (nada de npm), para correr igual en la CI y en
// el Node de Adobe Photoshop de esta máquina. NO modifica ningún archivo del
// proyecto y NO ejecuta el código de la app.
//
// CÓMO LEE EL CÓDIGO (y sus límites, que también se dicen en los documentos):
// primero "limpia" cada archivo —tapa comentarios, el contenido de los textos y
// las expresiones regulares— y trabaja sobre esa copia con expresiones
// regulares y emparejando llaves. No es un intérprete de JavaScript: no ve una
// mutación hecha a través de un alias (`var p = state.pedidos[0]; p.abono = 1`)
// ni una función llamada por un nombre armado en tiempo de ejecución. Por eso el
// mapa cruza dos fuentes: lo que el código escribe en `state` y los
// `persist("clave")`, que es la intención de guardar y no depende de alias.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizarTexto(s) {
  return String(s).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

// Comparación de textos sin depender del idioma del equipo (determinismo).
export function comparar(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function listarJs(raiz = RAIZ) {
  const out = [];
  (function rec(dir) {
    const nombres = fs.readdirSync(path.join(raiz, dir), { withFileTypes: true }).sort((a, b) => comparar(a.name, b.name));
    for (const e of nombres) {
      const rel = dir + "/" + e.name;
      if (e.isDirectory()) rec(rel);
      else if (e.name.endsWith(".js")) out.push(rel);
    }
  })("js");
  return out.sort(comparar);
}

export function leerFuentes(raiz = RAIZ) {
  const f = {};
  for (const r of listarJs(raiz)) f[r] = normalizarTexto(fs.readFileSync(path.join(raiz, r), "utf8"));
  return f;
}

// ---------------------------------------------------------------------------
// 1. Limpieza: tapar comentarios, textos y expresiones regulares
// ---------------------------------------------------------------------------
const MARCA_TEXTO = "\u0001";
const MARCA_REGEX = "\u0002";

function esInicioDeRegex(prevSig, prevPalabra) {
  if (prevSig === "") return true;
  if ("(,=:[!&|?{};+-*%<>~^".indexOf(prevSig) !== -1) return true;
  if (prevSig === "a") {
    return ["return", "typeof", "case", "in", "of", "delete", "void", "throw", "else", "do", "instanceof", "new"].indexOf(prevPalabra) !== -1;
  }
  return false;
}

function finDeTexto(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === q) return j + 1;
    if (c === "\n") return j; // texto sin cerrar: se corta en la línea
    j++;
  }
  return src.length;
}

function finDeRegex(src, i) {
  let j = i + 1, enClase = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\n") throw new Error("expresión regular sin cerrar cerca del carácter " + i);
    if (c === "\\") { j += 2; continue; }
    if (c === "[") enClase = true;
    else if (c === "]") enClase = false;
    else if (c === "/" && !enClase) { j++; break; }
    j++;
  }
  while (j < src.length && /[a-z]/.test(src[j])) j++;
  return j;
}

// Devuelve dos copias del archivo, del MISMO largo (así un desplazamiento vale
// para las tres versiones):
//   sinComentarios → sin comentarios, con los textos intactos (para leer nombres)
//   codigo         → sin comentarios y con el contenido de textos y regex tapado
//                    (para buscar estructura sin que un texto la confunda)
export function limpiar(src) {
  const n = src.length;
  const sc = src.split("");
  const cd = src.split("");
  const tapar = (arr, desde, hasta, marca) => {
    for (let k = desde; k < hasta; k++) if (src[k] !== "\n") arr[k] = marca;
  };
  let i = 0, prevSig = "", prevPalabra = "";
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = src.indexOf("\n", i); if (j < 0) j = n;
      tapar(sc, i, j, " "); tapar(cd, i, j, " "); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2;
      tapar(sc, i, j, " "); tapar(cd, i, j, " "); i = j; continue;
    }
    if (c === '"' || c === "'") {
      const j = finDeTexto(src, i);
      tapar(cd, i + 1, j - 1, MARCA_TEXTO);
      prevSig = '"'; prevPalabra = ""; i = j; continue;
    }
    if (c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== "`") { if (src[j] === "\\") j++; j++; }
      if (src.slice(i, j).indexOf("${") !== -1) throw new Error("plantilla con ${} cerca del carácter " + i + ": el analizador no la soporta");
      tapar(cd, i + 1, j, MARCA_TEXTO);
      prevSig = '"'; prevPalabra = ""; i = j + 1; continue;
    }
    if (c === "/") {
      if (esInicioDeRegex(prevSig, prevPalabra)) {
        const j = finDeRegex(src, i);
        tapar(cd, i, j, MARCA_REGEX);
        prevSig = '"'; prevPalabra = ""; i = j; continue;
      }
      prevSig = "/"; prevPalabra = ""; i++; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      prevSig = "a"; prevPalabra = src.slice(i, j); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      prevSig = "0"; prevPalabra = ""; i = j; continue;
    }
    prevSig = c; prevPalabra = ""; i++;
  }
  return { sinComentarios: sc.join(""), codigo: cd.join("") };
}

// Para cada `{ [ (` el desplazamiento de su pareja (o -1), y la profundidad de
// llaves en cada posición.
function emparejar(codigo) {
  const n = codigo.length;
  const pareja = new Int32Array(n).fill(-1);
  const prof = new Int32Array(n + 1);
  const pila = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    prof[i] = p;
    const c = codigo[i];
    if (c === "{" || c === "[" || c === "(") { pila.push(i); if (c === "{") p++; }
    else if (c === "}" || c === "]" || c === ")") {
      const a = pila.pop();
      if (a === undefined) throw new Error("cierra '" + c + "' sin abrir, carácter " + i);
      const esperado = c === "}" ? "{" : c === "]" ? "[" : "(";
      if (codigo[a] !== esperado) throw new Error("'" + codigo[a] + "' (carácter " + a + ") se cierra con '" + c + "' (carácter " + i + ")");
      pareja[a] = i; pareja[i] = a;
      if (c === "}") p--;
    }
  }
  prof[n] = p;
  if (pila.length) throw new Error("quedaron " + pila.length + " llaves sin cerrar");
  return { pareja, prof };
}

function indiceDeLineas(src) {
  const inicios = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") inicios.push(i + 1);
  return inicios;
}
function lineaDe(inicios, off) {
  let lo = 0, hi = inicios.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (inicios[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// 2. Comentarios: cabecera del archivo y "qué hace" de cada función
// ---------------------------------------------------------------------------
function textoDeComentario(linea) {
  return linea.replace(/^\s*\/\/+\s?/, "").replace(/^\s*\/?\*+\/?\s?/, "").replace(/\*\/\s*$/, "").trim();
}
function esSeparador(t) {
  return t === "" || /^[-=─_*#~.\s]+$/.test(t) || /^[-=─_]{3,}.*[-=─_]{3,}$/.test(t);
}

export function cabeceraDeArchivo(lineas) {
  const out = [];
  let i = 0;
  while (i < lineas.length && /^\s*\/\//.test(lineas[i])) {
    const t = textoDeComentario(lineas[i]);
    if (t === "" && out.length) break; // fin del primer párrafo
    if (t !== "") out.push(t);
    i++;
  }
  return out.join(" ");
}

// La primera línea con contenido del bloque de comentarios pegado, justo
// encima, a la línea `linea1` (base 1).
export function comentarioPrevio(lineas, linea1) {
  let i = linea1 - 2;
  const bloque = [];
  while (i >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lineas[i])) { bloque.unshift(lineas[i]); i--; }
  for (const l of bloque) {
    const t = textoDeComentario(l);
    if (!esSeparador(t)) return t;
  }
  return "";
}

// ---------------------------------------------------------------------------
// 3. Análisis de un archivo
// ---------------------------------------------------------------------------
const MUTADORES = ["push", "unshift", "splice", "pop", "shift", "sort", "reverse", "fill", "copyWithin"];
const RE_ID = "[A-Za-z_$][\\w$]*";

function resolverImport(desde, destino) {
  const base = path.posix.dirname(desde);
  return path.posix.normalize(path.posix.join(base, destino));
}

function leerTexto(sc, off) {
  // sc[off] es una comilla: devuelve el contenido sin las comillas
  const q = sc[off];
  let j = off + 1, s = "";
  while (j < sc.length && sc[j] !== q && sc[j] !== "\n") {
    if (sc[j] === "\\") { s += sc[j + 1]; j += 2; continue; }
    s += sc[j]; j++;
  }
  return s;
}

function primerArgumento(sc, cd, abreParen) {
  // abreParen: desplazamiento de "(" → { tipo: "texto"|"expr"|"vacio", valor }
  let j = abreParen + 1;
  while (j < sc.length && /\s/.test(sc[j])) j++;
  if (sc[j] === ")") return { tipo: "vacio", valor: "" };
  if (sc[j] === '"' || sc[j] === "'") return { tipo: "texto", valor: leerTexto(sc, j) };
  let k = j;
  while (k < sc.length && sc[k] !== ")" && sc[k] !== ",") k++;
  return { tipo: "expr", valor: sc.slice(j, k).trim() };
}

function parseColumnas(sc, cd, pareja, prof, abreArray) {
  const cierre = pareja[abreArray];
  const cols = [];
  for (let i = abreArray + 1; i < cierre; i++) {
    // elemento del arreglo: un objeto directo dentro del [ ] (las llaves de un
    // objeto anidado tienen más profundidad y se saltan con `i = fin`)
    if (cd[i] === "{" && prof[i] === prof[abreArray]) {
      const fin = pareja[i];
      const txt = sc.slice(i, fin + 1);
      const key = /\bkey:\s*"([^"]+)"/.exec(txt);
      const header = /\bheader:\s*"([^"]+)"/.exec(txt);
      if (key && header) {
        cols.push({ key: key[1], header: header[1], tipo: /\bjson:\s*true\b/.test(txt) ? "json" : /\bnumero:\s*true\b/.test(txt) ? "numero" : "texto" });
      }
      i = fin;
    }
  }
  return cols;
}

export function analizarArchivo(ruta, src) {
  const { sinComentarios: sc, codigo: cd } = limpiar(src);
  const { pareja, prof } = emparejar(cd);
  const inicios = indiceDeLineas(src);
  const lineas = src.split("\n");
  const L = (off) => lineaDe(inicios, off);

  const A = {
    ruta,
    capa: ruta === "js/app.js" ? "app" : ruta.startsWith("js/core/") ? "core" : ruta.startsWith("js/modules/") ? "modules" : "otro",
    lineas: lineas.length,
    cabecera: cabeceraDeArchivo(lineas),
    imports: [], dinamicos: [], reexports: [],
    unidades: [], acciones: [], exportsDato: [],
    persists: [], estado: [], guardas: [], roles: [], dataActions: []
  };

  // ---- imports estáticos
  const reImp = new RegExp("\\bimport\\s*(\\*\\s*as\\s+(" + RE_ID + ")|\\{([^}]*)\\}|(" + RE_ID + "))\\s*from\\s*([\"'])([^\"']+)\\5", "g");
  let m;
  while ((m = reImp.exec(sc)) !== null) {
    if (cd.substr(m.index, 6) !== "import" || prof[m.index] !== 0) continue;
    const destino = m[6];
    const imp = { desde: destino.startsWith(".") ? resolverImport(ruta, destino) : destino, linea: L(m.index), espacio: m[2] || null, nombres: [] };
    if (m[3] !== undefined) {
      imp.nombres = m[3].split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
        const p = x.split(/\s+as\s+/);
        return { original: p[0].trim(), local: (p[1] || p[0]).trim() };
      });
    }
    A.imports.push(imp);
  }
  // ---- imports dinámicos: var x = await import("...")
  const reDin = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  while ((m = reDin.exec(sc)) !== null) {
    if (cd.substr(m.index, 6) !== "import") continue;
    const antes = sc.slice(Math.max(0, m.index - 60), m.index);
    const asig = new RegExp("(?:var|const|let)\\s+(" + RE_ID + ")\\s*=\\s*(?:await\\s+)?$").exec(antes);
    A.dinamicos.push({ desde: resolverImport(ruta, m[2]), linea: L(m.index), espacio: asig ? asig[1] : null });
  }
  // ---- export { A, B } sin "from"
  const reRe = /\bexport\s*\{([^}]*)\}\s*;?/g;
  while ((m = reRe.exec(sc)) !== null) {
    if (cd.substr(m.index, 6) !== "export" || prof[m.index] !== 0) continue;
    m[1].split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => A.reexports.push({ nombre: x.split(/\s+as\s+/).pop().trim(), linea: L(m.index) }));
  }

  // ---- unidades: funciones de nivel superior
  const reDecl = new RegExp("(^|[^\\w$.])(?:(export)\\s+)?(?:(async)\\s+)?function\\s*\\*?\\s*(" + RE_ID + ")\\s*\\(", "g");
  while ((m = reDecl.exec(cd)) !== null) {
    const off = m.index + m[1].length;
    if (prof[off] !== 0) continue;
    if (/=\s*(async\s+)?$/.test(cd.slice(Math.max(0, off - 24), off))) continue; // `var x = function nombre(` ya es la unidad de `x`
    const abreP = cd.indexOf("(", off + 8);
    const cierraP = pareja[abreP];
    const abreL = cd.indexOf("{", cierraP);
    A.unidades.push({
      tipo: "funcion", nombre: m[4], exportada: !!m[2], asincrona: !!m[3],
      params: sc.slice(abreP + 1, cierraP).replace(/\s+/g, " ").trim(),
      inicio: off, abre: abreL, cierra: pareja[abreL]
    });
  }
  // var f = function (...) { ... }
  const reVarFn = new RegExp("(^|[^\\w$.])(?:(export)\\s+)?(?:var|const|let)\\s+(" + RE_ID + ")\\s*=\\s*(?:(async)\\s+)?function\\s*\\*?\\s*(?:" + RE_ID + ")?\\s*\\(", "g");
  while ((m = reVarFn.exec(cd)) !== null) {
    const off = m.index + m[1].length;
    if (prof[off] !== 0) continue;
    const abreP = cd.indexOf("(", cd.indexOf("function", off));
    const cierraP = pareja[abreP];
    const abreL = cd.indexOf("{", cierraP);
    A.unidades.push({
      tipo: "funcion", nombre: m[3], exportada: !!m[2], asincrona: !!m[4],
      params: sc.slice(abreP + 1, cierraP).replace(/\s+/g, " ").trim(),
      inicio: off, abre: abreL, cierra: pareja[abreL]
    });
  }
  // var X = <dato>  (arreglos, objetos, constantes) de nivel superior
  const reVar = new RegExp("(^|[^\\w$.])(?:(export)\\s+)?(var|const|let)\\s+(" + RE_ID + ")\\s*=\\s*", "g");
  const objetosAcciones = [];
  while ((m = reVar.exec(cd)) !== null) {
    const off = m.index + m[1].length;
    if (prof[off] !== 0) continue;
    const resto = cd.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (/^(async\s+)?function\b/.test(resto)) continue; // ya es una unidad
    const nombre = m[4];
    let tipo = "valor";
    const posValor = m.index + m[0].length;
    if (cd[posValor] === "{") tipo = "objeto";
    else if (cd[posValor] === "[") tipo = "arreglo";
    else if (/^Object\.assign\(/.test(cd.slice(posValor, posValor + 14))) tipo = "objeto";
    if (m[2]) A.exportsDato.push({ nombre, tipo, linea: L(off), constante: m[3] !== "var" });
    if (/[aA]ctions?$/.test(nombre) && tipo === "objeto") {
      // objeto(s) literal(es) con las acciones
      const rangos = [];
      if (cd[posValor] === "{") rangos.push([posValor, pareja[posValor]]);
      else {
        const abreP = cd.indexOf("(", posValor);
        const cierraP = pareja[abreP];
        for (let k = abreP + 1; k < cierraP; k++) {
          if (cd[k] === "{" && prof[k] === prof[off]) { rangos.push([k, pareja[k]]); k = pareja[k]; }
          else if (cd[k] === "(" || cd[k] === "[") k = pareja[k];
        }
      }
      objetosAcciones.push({ nombre, rangos, exportada: !!m[2] });
    }
  }
  // columnas de hoja y claves: se leen al final de la función (necesitan `pareja`)

  // ---- acciones: propiedades-función dentro de los objetos de acciones
  const reProp = new RegExp("(\"" + MARCA_TEXTO + "*\"|'" + MARCA_TEXTO + "*'|" + RE_ID + ")\\s*:\\s*(?:(async)\\s+)?function\\s*\\*?\\s*(?:" + RE_ID + ")?\\s*\\(", "g");
  for (const oa of objetosAcciones) {
    for (const [a, b] of oa.rangos) {
      const profHijos = prof[a] + 1;
      reProp.lastIndex = a + 1;
      while ((m = reProp.exec(cd)) !== null && m.index < b) {
        if (prof[m.index] !== profHijos) continue;
        const nombre = (m[1][0] === '"' || m[1][0] === "'") ? leerTexto(sc, m.index) : m[1];
        const abreP = cd.indexOf("(", cd.indexOf("function", m.index));
        const cierraP = pareja[abreP];
        const abreL = cd.indexOf("{", cierraP);
        A.unidades.push({
          tipo: "accion", nombre, exportada: false, asincrona: !!m[2], objeto: oa.nombre,
          params: sc.slice(abreP + 1, cierraP).replace(/\s+/g, " ").trim(),
          inicio: m.index, abre: abreL, cierra: pareja[abreL]
        });
        reProp.lastIndex = pareja[abreL] + 1;
      }
    }
  }

  // ---- completar unidades
  A.unidades.sort((x, y) => x.inicio - y.inicio);
  A.unidades.forEach((u) => {
    u.archivo = ruta;
    u.clave = ruta + "::" + (u.tipo === "accion" ? "accion:" : "") + u.nombre;
    u.linea = L(u.inicio);
    u.lineaFin = L(u.cierra);
    u.comentario = comentarioPrevio(lineas, u.linea);
    u.persists = []; u.estado = []; u.guardas = []; u.roles = []; u.referencias = new Set(); u.sitios = [];
  });
  // unidad que contiene un desplazamiento (las unidades no se solapan)
  const unidadEn = (off) => {
    let lo = 0, hi = A.unidades.length - 1, r = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const u = A.unidades[mid];
      if (off < u.inicio) hi = mid - 1;
      else if (off > u.cierra) lo = mid + 1;
      else { r = u; break; }
    }
    return r;
  };
  // ---- persist("clave")
  const rePersist = /(^|[^\w$.])persist\s*\(/g;
  while ((m = rePersist.exec(cd)) !== null) {
    const off = m.index + m[1].length;
    const antes = cd.slice(Math.max(0, off - 12), off);
    if (/function\s*$/.test(antes)) continue; // la definición
    const abreP = cd.indexOf("(", off);
    const arg = primerArgumento(sc, cd, abreP);
    const ev = { clave: arg.tipo === "texto" ? arg.valor : null, expr: arg.tipo === "texto" ? null : arg.valor, linea: L(off), off };
    const u = unidadEn(off);
    ev.unidad = u ? u.nombre : "(módulo)";
    A.persists.push(ev);
    if (u) u.persists.push(ev);
  }
  // ---- guardas de mes cerrado
  const reGuarda = /(^|[^\w$.])(exigirMesAbierto|bloqueoMesCerrado)\s*\(/g;
  while ((m = reGuarda.exec(cd)) !== null) {
    const off = m.index + m[1].length;
    if (/function\s*$/.test(cd.slice(Math.max(0, off - 12), off))) continue;
    const ev = { nombre: m[2], linea: L(off), off };
    const u = unidadEn(off);
    ev.unidad = u ? u.nombre : "(módulo)";
    A.guardas.push(ev);
    if (u) u.guardas.push(ev);
  }
  // ---- chequeos de rol
  const reRol = /(?:(^|[^\w$.])esAdmin\s*\(|\.rol\s*[!=]==)/g;
  while ((m = reRol.exec(cd)) !== null) {
    const ev = { linea: L(m.index), off: m.index };
    const u = unidadEn(m.index);
    ev.unidad = u ? u.nombre : "(módulo)";
    A.roles.push(ev);
    if (u) u.roles.push(ev);
  }
  // ---- acceso a `state`
  const reCadena = new RegExp("^\\s*\\.\\s*(" + RE_ID + ")");
  const reState = new RegExp("(^|[^\\w$.])state\\s*\\.\\s*(" + RE_ID + ")", "g");
  while ((m = reState.exec(cd)) !== null) {
    const off = m.index + m[1].length;
    const clave = m[2];
    let fin = m.index + m[0].length;
    let sub = null;
    // cadena de propiedades: .a.b[0].c
    const cadena = [];
    let k = fin;
    for (;;) {
      const mm = reCadena.exec(cd.slice(k, k + 80));
      if (mm) { cadena.push(mm[1]); k += mm[0].length; continue; }
      if (cd[k] === "[") { const cierra = pareja[k]; cadena.push("[]"); k = cierra + 1; continue; }
      break;
    }
    if (clave === "config" && cadena.length && cadena[0] !== "[]") sub = cadena[0];
    let modo = "lee";
    let metodo = null;
    const sigue = cd.slice(k, k + 4);
    if (/^\s*(=(?!=)|\+=|-=|\*=|\/=|\+\+|--)/.test(cd.slice(k, k + 6))) modo = "escribe";
    else if (cd[k] === "(" || /^\s*\(/.test(sigue)) {
      // la última propiedad de la cadena es un método
      const metodoNombre = cadena[cadena.length - 1];
      if (cadena.length && MUTADORES.indexOf(metodoNombre) !== -1) { modo = "muta"; metodo = metodoNombre; }
    }
    if (/delete\s+$/.test(cd.slice(Math.max(0, off - 10), off))) modo = "escribe";
    // si el método es lo único tras la clave (state.tx.unshift), la cadena sin él es vacía
    const profundidad = (modo === "muta") ? cadena.slice(0, -1) : cadena;
    const ev = { clave, sub, modo, metodo, directo: profundidad.length === 0, cadena: profundidad, linea: L(off), off, finCadena: k };
    const u = unidadEn(off);
    ev.unidad = u ? u.nombre : "(módulo)";
    A.estado.push(ev);
    if (u) u.estado.push(ev);
  }
  // ---- mutaciones por referencia a campos de dinero (el mapa no puede seguir un
  // alias, así que las anota aparte para revisarlas a mano)
  A.alias = [];
  const reAlias1 = /(^|[^\w$.])([A-Za-z_$][\w$]*)\.(monto|fecha|tipo|cuenta|concepto|conciliadoEn|total|abono)\s*=(?!=)/g;
  while ((m = reAlias1.exec(cd)) !== null) {
    if (m[2] === "state" || m[2] === "this") continue;
    const u = unidadEn(m.index);
    A.alias.push({ forma: m[2] + "." + m[3] + " = …", linea: L(m.index + m[1].length), unidad: u ? u.nombre : "(módulo)" });
  }
  const reAlias2 = /(^|[^\w$.])Object\.assign\(\s*([A-Za-z_$][\w$]*)\s*,/g;
  while ((m = reAlias2.exec(cd)) !== null) {
    const u = unidadEn(m.index);
    A.alias.push({ forma: "Object.assign(" + m[2] + ", …)", linea: L(m.index + m[1].length), unidad: u ? u.nombre : "(módulo)" });
  }
  // ---- data-action="..." (usos en pantalla)
  const reDA = /data-action(-change)?\s*=\s*\\?["']([^"'\\]+)\\?["']/g;
  while ((m = reDA.exec(sc)) !== null) {
    A.dataActions.push({ accion: m[2], cambio: !!m[1], linea: L(m.index) });
  }

  // ---- referencias a otras funciones
  const nombresConocidos = new Set();
  A.imports.forEach((im) => im.nombres.forEach((n) => nombresConocidos.add(n.local)));
  A.unidades.forEach((u) => { if (u.tipo === "funcion") nombresConocidos.add(u.nombre); });
  const espacios = new Set();
  A.imports.forEach((im) => { if (im.espacio) espacios.add(im.espacio); });
  A.dinamicos.forEach((im) => { if (im.espacio) espacios.add(im.espacio); });
  const reRef = new RegExp("(^|[^\\w$.])(" + RE_ID + ")(?![\\w$])(\\s*\\.\\s*(" + RE_ID + "))?", "g");
  A.unidades.forEach((u) => {
    const cuerpo = cd.slice(u.abre, u.cierra + 1);
    reRef.lastIndex = 0;
    let r;
    while ((r = reRef.exec(cuerpo)) !== null) {
      const id = r[2];
      if (espacios.has(id) && r[4]) u.referencias.add(id + "." + r[4]);
      else if (nombresConocidos.has(id)) u.referencias.add(id);
    }
  });

  // ---- sitios de dinero (movimientos y transferencias)
  A.unidades.forEach((u) => {
    u.estado.forEach((ev) => {
      if (["tx", "txPapelera", "transferencias"].indexOf(ev.clave) === -1) return;
      if (!ev.directo) return;
      if (ev.modo === "lee") return;
      u.sitios.push(describirSitio(ev, sc, cd, pareja, prof, L));
    });
  });

  // ---- columnas de hoja
  A.tablas = [];
  const reTabla = new RegExp("(?:export\\s+)?(?:var|const|let)\\s+(" + RE_ID + ")\\s*=\\s*crearTablaSheet\\s*\\(\\s*\"([^\"]+)\"\\s*,\\s*", "g");
  while ((m = reTabla.exec(sc)) !== null) {
    const pos = m.index + m[0].length;
    let columnas = null, origenColumnas = "";
    if (sc[pos] === "[") { columnas = parseColumnas(sc, cd, pareja, prof, pos); origenColumnas = "en línea"; }
    else {
      const nom = new RegExp("^(" + RE_ID + ")").exec(sc.slice(pos, pos + 60));
      if (nom) {
        origenColumnas = nom[1];
        const reCol = new RegExp("(?:var|const|let)\\s+" + nom[1] + "\\s*=\\s*\\[");
        const mc = reCol.exec(cd);
        if (mc) columnas = parseColumnas(sc, cd, pareja, prof, mc.index + mc[0].length - 1);
      }
    }
    A.tablas.push({ variable: m[1], pestana: m[2], columnas: columnas || [], origenColumnas, linea: L(m.index) });
  }

  // ---- objetos de datos que interesan por contenido (KEYS, MARCAS, state, TABLAS_SHEET)
  A.datos = {};
  const entradasObjeto = (nombre) => {
    const mo = new RegExp("(?:var|const|let)\\s+" + nombre + "\\s*=\\s*\\{").exec(cd);
    if (!mo) return null;
    const abre = mo.index + mo[0].length - 1;
    const cierra = pareja[abre];
    const out = [];
    const re = new RegExp("(^|[,{\\s])(" + RE_ID + "|\"" + MARCA_TEXTO + "*\")\\s*:", "g");
    const cuerpo = cd.slice(abre, cierra + 1);
    let e;
    while ((e = re.exec(cuerpo)) !== null) {
      const off = abre + e.index + e[1].length;
      if (prof[off] !== prof[abre] + 1) continue;
      const nom = e[2][0] === '"' ? leerTexto(sc, off) : e[2];
      // valor: hasta la coma de nivel o el cierre
      let k = off + e[2].length + (e[0].length - e[1].length - e[2].length);
      let v = k;
      while (v < cierra) {
        const ch = cd[v];
        if (ch === "{" || ch === "[" || ch === "(") { v = pareja[v] + 1; continue; }
        if (ch === "," || ch === "}") break;
        v++;
      }
      out.push({ nombre: nom, valor: sc.slice(k, v).trim(), linea: L(off), off });
    }
    return out;
  };
  if (ruta === "js/core/constants.js") A.datos.KEYS = entradasObjeto("KEYS");
  if (ruta === "js/core/store.js") {
    A.datos.TABLAS_SHEET = entradasObjeto("TABLAS_SHEET");
    A.datos.state = entradasObjeto("state");
    A.datos.ETIQUETA_CLAVE = entradasObjeto("ETIQUETA_CLAVE");
  }
  if (ruta === "js/core/calc.js") {
    const mm = /export\s+var\s+MARCAS_ORIGEN_SISTEMA\s*=\s*\[/.exec(cd);
    if (mm) {
      const abre = mm.index + mm[0].length - 1;
      const marcas = [];
      for (let i = abre + 1; i < pareja[abre]; i++) {
        if (cd[i] === "{" && prof[i] === prof[abre]) {
          const fin = pareja[i];
          const txt = sc.slice(i, fin + 1);
          const campo = /\bcampo:\s*"([^"]+)"/.exec(txt);
          const que = /\bque:\s*("(?:[^"\\]|\\.)*")/.exec(txt);
          const donde = /\bdonde:\s*("(?:[^"\\]|\\.)*")/.exec(txt);
          if (campo) marcas.push({ campo: campo[1], que: que ? JSON.parse(que[1]) : "", donde: donde ? JSON.parse(donde[1]) : "", linea: L(i) });
          i = fin;
        }
      }
      A.datos.MARCAS_ORIGEN_SISTEMA = marcas;
    }
  }

  A._interno = { sc, cd, pareja, prof, L };
  return A;
}

// Qué hace un acceso de escritura a state.tx / txPapelera / transferencias.
function describirSitio(ev, sc, cd, pareja, prof, L) {
  const sitio = {
    clave: ev.clave, linea: ev.linea, off: ev.off, unidad: ev.unidad, modo: ev.modo,
    operacion: "", tipoMov: "", concepto: "", claves: [], detalle: ""
  };
  if (ev.modo === "muta") {
    if (ev.metodo === "unshift" || ev.metodo === "push") sitio.operacion = "crear";
    else if (ev.metodo === "splice") sitio.operacion = "quitar";
    else sitio.operacion = "reordenar";
    // argumento: literal { ... } o Object.assign({...}, x) o variable
    const abreP = cd.indexOf("(", ev.finCadena);
    const resto = sc.slice(abreP + 1, pareja[abreP] === -1 ? abreP + 400 : pareja[abreP]);
    sitio.detalle = resumenArgumento(resto);
    if (/^\s*\{/.test(cd.slice(abreP + 1, abreP + 6))) {
      const abre = cd.indexOf("{", abreP);
      const lit = leerLiteral(sc, cd, pareja, prof, abre);
      sitio.claves = lit.claves; sitio.tipoMov = lit.tipo; sitio.concepto = lit.concepto;
    } else if (/^\s*Object\.assign\s*\(/.test(cd.slice(abreP + 1, abreP + 20))) {
      const abre = cd.indexOf("{", abreP);
      const lit = leerLiteral(sc, cd, pareja, prof, abre);
      sitio.claves = lit.claves; sitio.tipoMov = lit.tipo; sitio.concepto = lit.concepto;
      sitio.detalle = "Object.assign({…}, …)";
      // Object.assign({ id: x }, datos): los campos viven en `datos`, un literal
      // declarado antes en la misma función. Se lee de ahí (marca "~" = indirecto).
      const segundo = /,\s*(\w+)\s*\)\s*\)\s*$/.exec(sc.slice(abre, pareja[abreP] + 1));
      if (segundo) {
        const re = new RegExp("(?:var|let|const)\\s+" + segundo[1] + "\\s*=\\s*\\{");
        const antes = cd.slice(0, ev.off);
        let ult = -1, mm;
        const g = new RegExp(re.source, "g");
        while ((mm = g.exec(antes)) !== null) ult = mm.index + mm[0].length - 1;
        if (ult >= 0) {
          const lit2 = leerLiteral(sc, cd, pareja, prof, ult);
          sitio.claves = sitio.claves.concat(lit2.claves);
          if (!sitio.tipoMov) sitio.tipoMov = lit2.tipo;
          if (!sitio.concepto) sitio.concepto = lit2.concepto;
          sitio.detalle = "Object.assign({…}, " + segundo[1] + ")";
        }
      }
    } else {
      sitio.detalle = resumenArgumento(resto);
    }
  } else {
    // asignación: mirar lo que se asigna
    const rhsIni = cd.indexOf("=", ev.finCadena) + 1;
    const rhs = sc.slice(rhsIni, rhsIni + 160).trim();
    const mismo = new RegExp("^\\(?\\s*state\\s*\\.\\s*" + ev.clave + "(?:\\s*\\|\\|\\s*\\[\\]\\s*\\))?\\s*\\.\\s*(" + RE_ID + ")\\s*\\(").exec(rhs);
    if (mismo) {
      sitio.operacion = { filter: "quitar", map: "modificar", concat: "crear", slice: "copiar" }[mismo[1]] || "reemplazar";
      sitio.detalle = "state." + ev.clave + "." + mismo[1] + "(…)";
      if (mismo[1] === "concat") {
        const abre = cd.indexOf("{", rhsIni);
        if (abre > 0 && abre < rhsIni + 120) {
          const lit = leerLiteral(sc, cd, pareja, prof, abre);
          sitio.claves = lit.claves; sitio.tipoMov = lit.tipo; sitio.concepto = lit.concepto;
        }
      }
    } else if (/^JSON\.parse\s*\(/.test(rhs)) { sitio.operacion = "restaurar"; sitio.detalle = "JSON.parse(copia)"; }
    else if (/^\[\s*\]/.test(rhs)) { sitio.operacion = "vaciar"; sitio.detalle = "[]"; }
    else if (/^\[/.test(rhs)) { sitio.operacion = "reemplazar"; sitio.detalle = "[…]"; }
    else {
      sitio.operacion = "reemplazar";
      const f = new RegExp("^(" + RE_ID + "(?:\\." + RE_ID + ")*)\\s*(\\(|$|;|\\.)").exec(rhs);
      sitio.detalle = f ? f[1] + (f[2] === "(" ? "(…)" : "") : rhs.slice(0, 30);
    }
  }
  return sitio;
}

function resumenArgumento(txt) {
  const t = txt.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}

function leerLiteral(sc, cd, pareja, prof, abre) {
  const cierra = pareja[abre];
  const claves = [];
  const re = new RegExp("(^|[,{\\s])(" + RE_ID + ")\\s*:", "g");
  const cuerpo = cd.slice(abre, cierra + 1);
  let e;
  while ((e = re.exec(cuerpo)) !== null) {
    const off = abre + e.index + e[1].length;
    if (prof[off] !== prof[abre] + 1) continue;
    claves.push(e[2]);
  }
  const txt = sc.slice(abre, cierra + 1);
  const tipo = /\btipo:\s*"([^"]*)"/.exec(txt);
  const concepto = /\bconcepto:\s*"([^"]*)"/.exec(txt);
  return { claves, tipo: tipo ? tipo[1] : "", concepto: concepto ? concepto[1] : "" };
}

// ---------------------------------------------------------------------------
// 4. Análisis de todo el proyecto
// ---------------------------------------------------------------------------
export function analizar(fuentes) {
  const archivos = {};
  Object.keys(fuentes).sort(comparar).forEach((ruta) => { archivos[ruta] = analizarArchivo(ruta, fuentes[ruta]); });
  const rutas = Object.keys(archivos);

  // ---- dependencias
  const deps = {};   // ruta -> Set(rutas importadas, estáticas o dinámicas)
  const depsEstaticas = {};
  const usadoPor = {}; // ruta -> Set(rutas)
  rutas.forEach((r) => { deps[r] = new Set(); depsEstaticas[r] = new Set(); usadoPor[r] = new Set(); });
  rutas.forEach((r) => {
    archivos[r].imports.forEach((im) => { if (archivos[im.desde]) { deps[r].add(im.desde); depsEstaticas[r].add(im.desde); usadoPor[im.desde].add(r); } });
    archivos[r].dinamicos.forEach((im) => { if (archivos[im.desde]) { deps[r].add(im.desde); usadoPor[im.desde].add(r); } });
  });

  // ---- tabla de unidades y exports
  const unidades = {};
  rutas.forEach((r) => archivos[r].unidades.forEach((u) => { unidades[u.clave] = u; }));
  const porNombre = {}; // ruta -> nombre -> unidad (solo funciones)
  rutas.forEach((r) => {
    porNombre[r] = {};
    archivos[r].unidades.forEach((u) => { if (u.tipo === "funcion") porNombre[r][u.nombre] = u; });
  });

  // ---- quién usa cada export
  const usosExport = {}; // "ruta::nombre" -> Set(rutas que lo importan o referencian)
  rutas.forEach((r) => {
    const A = archivos[r];
    A.imports.forEach((im) => {
      if (!archivos[im.desde]) return;
      im.nombres.forEach((n) => {
        const k = im.desde + "::" + n.original;
        (usosExport[k] = usosExport[k] || new Set()).add(r);
      });
    });
    // espacios de nombres: ns.nombre
    const espacios = {};
    A.imports.forEach((im) => { if (im.espacio) espacios[im.espacio] = im.desde; });
    A.dinamicos.forEach((im) => { if (im.espacio) espacios[im.espacio] = im.desde; });
    if (Object.keys(espacios).length) {
      const re = new RegExp("(^|[^\\w$.])(" + Object.keys(espacios).join("|") + ")\\s*\\.\\s*(" + RE_ID + ")", "g");
      let m;
      while ((m = re.exec(A._interno.cd)) !== null) {
        const k = espacios[m[2]] + "::" + m[3];
        (usosExport[k] = usosExport[k] || new Set()).add(r);
      }
    }
  });

  // ---- cierre de llamadas (por unidad, entre archivos)
  function resolverRef(ruta, ref) {
    const A = archivos[ruta];
    if (ref.indexOf(".") !== -1) {
      const [ns, nombre] = ref.split(".");
      let destino = null;
      A.imports.forEach((im) => { if (im.espacio === ns) destino = im.desde; });
      A.dinamicos.forEach((im) => { if (im.espacio === ns) destino = im.desde; });
      return destino && porNombre[destino] && porNombre[destino][nombre] ? porNombre[destino][nombre] : null;
    }
    if (porNombre[ruta][ref]) return porNombre[ruta][ref];
    for (const im of A.imports) {
      for (const n of im.nombres) {
        if (n.local === ref && porNombre[im.desde] && porNombre[im.desde][n.original]) return porNombre[im.desde][n.original];
      }
    }
    return null;
  }
  Object.keys(unidades).forEach((k) => {
    const u = unidades[k];
    u.llama = [];
    u.referencias.forEach((ref) => {
      const d = resolverRef(u.archivo, ref);
      if (d && d !== u && u.llama.indexOf(d.clave) === -1) u.llama.push(d.clave);
    });
    u.llama.sort(comparar);
  });
  // `persist` es el sumidero del guardado (después de él ya no es la acción la
  // que decide qué se guarda) y cierre.js es la guarda misma: no se entra a
  // ninguno de los dos al seguir las llamadas de una acción.
  const TERMINALES = ["js/core/store.js::persist"];
  function alcance(u) {
    const visto = new Set([u.clave]);
    const cola = [u.clave];
    while (cola.length) {
      const k = cola.shift();
      unidades[k].llama.forEach((h) => {
        if (visto.has(h)) return;
        // una acción no se "alcanza" desde otra: son puntos de entrada
        if (unidades[h].tipo === "accion") return;
        if (TERMINALES.indexOf(h) !== -1 || unidades[h].archivo === "js/core/cierre.js") return;
        visto.add(h); cola.push(h);
      });
    }
    return [...visto].sort(comparar).map((k) => unidades[k]);
  }

  // ---- constantes del proyecto
  const KEYS = {};
  (archivos["js/core/constants.js"].datos.KEYS || []).forEach((e) => { KEYS[e.nombre] = e.valor.replace(/^"|"$/g, ""); });
  const marcas = (archivos["js/core/calc.js"].datos.MARCAS_ORIGEN_SISTEMA || []);
  const CLAVES_PERSISTIBLES = Object.keys(KEYS);

  // ---- acciones
  const acciones = [];
  rutas.forEach((r) => archivos[r].unidades.filter((u) => u.tipo === "accion").forEach((u) => acciones.push(u)));
  const usosPantalla = {};
  rutas.forEach((r) => archivos[r].dataActions.forEach((d) => {
    const e = (usosPantalla[d.accion] = usosPantalla[d.accion] || { cantidad: 0, archivos: new Set() });
    e.cantidad++; e.archivos.add(r);
  }));

  return { archivos, rutas, deps, depsEstaticas, usadoPor, unidades, porNombre, usosExport, alcance, KEYS, marcas, CLAVES_PERSISTIBLES, acciones, usosPantalla, resolverRef };
}

// Componentes que se llaman entre sí por imports estáticos (ciclos).
export function ciclos(modelo) {
  const { rutas, depsEstaticas } = modelo;
  let indice = 0;
  const pila = [], enPila = new Set(), idx = {}, low = {}, comps = [];
  function fuerte(v) {
    idx[v] = low[v] = indice++; pila.push(v); enPila.add(v);
    [...depsEstaticas[v]].sort(comparar).forEach((w) => {
      if (idx[w] === undefined) { fuerte(w); low[v] = Math.min(low[v], low[w]); }
      else if (enPila.has(w)) low[v] = Math.min(low[v], idx[w]);
    });
    if (low[v] === idx[v]) {
      const comp = [];
      let w;
      do { w = pila.pop(); enPila.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) comps.push(comp.sort(comparar));
    }
  }
  rutas.forEach((v) => { if (idx[v] === undefined) fuerte(v); });
  return comps.sort((a, b) => comparar(a[0], b[0]));
}
