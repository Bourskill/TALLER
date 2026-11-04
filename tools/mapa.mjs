// Generador del mapa técnico (Hallazgo #67). Lee el código de js/ (sin ejecutarlo)
// y escribe/actualiza los documentos de docs/:
//
//   docs/MAPA-DEL-CODIGO.md        100 % generado (qué hace cada archivo y función, quién la usa)
//   docs/MAPA-DEL-DINERO.md        los bloques entre «GENERADO:inicio/fin» (quién escribe dinero)
//   docs/ARQUITECTURA.md           los bloques entre «GENERADO:inicio/fin» (claves, hojas, roles)
//   docs/REGLAS-DE-ARQUITECTURA.md los bloques entre «GENERADO:inicio/fin» (estado y lista base)
//   docs/esquemas.snapshot.json    la foto de las columnas de cada hoja (regla R5)
//   docs/citas.snapshot.json       el texto de cada línea que los documentos citan (para reanclarlas, tools/citas.mjs)
//
// Uso:   npm run mapa          (escribe lo que haya cambiado)
//        npm run mapa -- --comprobar   (no escribe; sale con error si algo está viejo)
//
// DETERMINISTA: sin fechas, sin rutas del equipo, todo en orden fijo, saltos de
// línea \n. Dos corridas sobre el mismo código dan archivos idénticos, y
// test/arquitectura.mjs lo comprueba (falla si los documentos quedaron viejos).
//
// Solo módulos nativos de Node. Lo escrito a mano en los documentos (la
// narrativa) NO se toca: solo se reemplaza lo que está entre las marcas.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RAIZ, leerFuentes, analizar, ciclos, comparar, normalizarTexto } from "./analisis.mjs";
import { REGLAS, evaluarReglas, esquemasActuales, compararEsquemas } from "./reglas.mjs";
import { crearResolver, reanclar } from "./citas.mjs";

// ---------------------------------------------------------------------------
// Entradas desde el disco
// ---------------------------------------------------------------------------
export function leerContexto(raiz = RAIZ) {
  const fuentes = leerFuentes(raiz);
  const M = analizar(fuentes);
  const leer = (rel) => { const p = path.join(raiz, rel); return fs.existsSync(p) ? normalizarTexto(fs.readFileSync(p, "utf8")) : null; };
  const fotoTxt = leer("docs/esquemas.snapshot.json");
  const citasTxt = leer("docs/citas.snapshot.json");
  const baseTxt = leer("docs/reglas-baseline.json");
  const pruebasEnDisco = fs.existsSync(path.join(raiz, "test"))
    ? fs.readdirSync(path.join(raiz, "test")).filter((f) => f.endsWith(".mjs")).sort(comparar) : [];
  const workflow = leer(".github/workflows/test.yml") || "";
  let scriptTest = "";
  try { scriptTest = JSON.parse(leer("package.json")).scripts.test || ""; } catch (e) { scriptTest = ""; }
  return {
    raiz, fuentes, M, leer,
    fotoEsquemas: fotoTxt ? JSON.parse(fotoTxt) : null,
    citasFoto: citasTxt ? JSON.parse(citasTxt) : {},
    baseline: baseTxt ? JSON.parse(baseTxt) : { reglas: {} },
    pruebasEnDisco, workflow, scriptTest
  };
}

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------
const corto = (s, n) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const celda = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ").trim() || "—";
const cod = (s) => "`" + String(s).replace(/`/g, "'") + "`";
const sinJs = (r) => r.replace(/^js\//, "");
const unicos = (arr) => [...new Set(arr)].sort(comparar);
const listaCorta = (arr, n) => arr.length > n ? arr.slice(0, n).join(", ") + " (+" + (arr.length - n) + ")" : arr.join(", ");
function tabla(cabeceras, filas) {
  if (!filas.length) return "_(ninguno)_";
  return ["| " + cabeceras.join(" | ") + " |", "| " + cabeceras.map(() => "---").join(" | ") + " |"]
    .concat(filas.map((f) => "| " + f.map(celda).join(" | ") + " |")).join("\n");
}
function plegado(titulo, cuerpo) {
  return "<details>\n<summary>" + titulo + "</summary>\n\n" + cuerpo + "\n\n</details>";
}
function nodoId(ruta) { return sinJs(ruta).replace(/[/.-]/g, "_"); }
function resumenConteo(lista) {
  const cuenta = {};
  lista.forEach((x) => { cuenta[x] = (cuenta[x] || 0) + 1; });
  return Object.keys(cuenta).sort(comparar).map((k) => k + (cuenta[k] > 1 ? " ×" + cuenta[k] : "")).join(", ");
}

// ---------------------------------------------------------------------------
// Lo que se calcula para varias tablas
// ---------------------------------------------------------------------------
const CLAVES_DINERO = ["tx", "txPapelera", "transferencias", "cierres", "deudas", "deudasHistorial"];
const SUB_CONFIG_DINERO = ["nomina", "gastosFijos", "colchonMovimientos", "cuentas", "cuentaPredeterminada", "conciliaciones"];

function infoAccion(M, a) {
  const alc = M.alcance(a);
  const persists = [];
  alc.forEach((u) => u.persists.forEach((p) => persists.push(p.clave || "?" + p.expr)));
  const guardas = [];
  alc.forEach((u) => { if (u.archivo !== "js/core/cierre.js") u.guardas.forEach((g) => guardas.push({ g, u })); });
  const sitios = [];
  alc.forEach((u) => u.sitios.forEach((s) => sitios.push({ s, u })));
  const roles = [];
  alc.forEach((u) => u.roles.forEach((r) => roles.push(r)));
  const subConfig = [];
  alc.forEach((u) => u.estado.forEach((e) => { if (e.clave === "config" && e.sub && e.modo !== "lee" && SUB_CONFIG_DINERO.indexOf(e.sub) !== -1 && e.directo === false) subConfig.push(e.sub); else if (e.clave === "config" && e.sub && e.modo !== "lee" && SUB_CONFIG_DINERO.indexOf(e.sub) !== -1) subConfig.push(e.sub); }));
  return { alc, persists: unicos(persists), guardas, sitios, roles, subConfig: unicos(subConfig) };
}

function accionesQueLlegan(M, unidad) {
  // acciones desde las que se llega a una unidad (por las llamadas)
  return M.acciones.filter((a) => M.alcance(a).some((u) => u === unidad));
}

// ---------------------------------------------------------------------------
// MAPA-DEL-CODIGO.md
// ---------------------------------------------------------------------------
function docMapaCodigo(ctx) {
  const M = ctx.M;
  const L = [];
  const capas = [["app", "Punto de entrada"], ["core", "Núcleo (js/core): estado, guardado, cálculos, hojas, PDF"], ["modules", "Pantallas (js/modules): una por pestaña"]];
  const nombreCapa = { app: "app", core: "core", modules: "modules" };

  L.push("# Mapa del código");
  L.push("");
  L.push("> **GENERADO — no se edita a mano.** Lo escribe `tools/mapa.mjs` leyendo `js/` (sin ejecutar nada). Para ponerlo al día: `npm run mapa`. `test/arquitectura.mjs` falla si quedó viejo.");
  L.push("> Cómo leerlo: [ARQUITECTURA.md](ARQUITECTURA.md) → «Cómo leer este mapa». El mapa del dinero: [MAPA-DEL-DINERO.md](MAPA-DEL-DINERO.md).");
  L.push("");
  L.push("## Contenido");
  L.push("");
  L.push("1. [En números](#1-en-números)");
  L.push("2. [Quién depende de quién](#2-quién-depende-de-quién)");
  L.push("3. [Archivo por archivo](#3-archivo-por-archivo)");
  L.push("4. [Registro de acciones de la interfaz](#4-registro-de-acciones-de-la-interfaz)");
  L.push("5. [Qué se guarda y quién lo guarda (persist)](#5-qué-se-guarda-y-quién-lo-guarda-persist)");
  L.push("");
  L.push("**Límites del análisis** (dicho una vez, vale para todo el documento): el mapa lee el texto del código, no lo ejecuta. No ve una función llamada por un nombre armado en tiempo de ejecución ni un cambio hecho por referencia (`var p = state.pedidos[0]; p.abono = 1`). Por eso cruza lo que el código escribe en `state` con los `persist(\"clave\")`, que son la intención de guardar y no dependen de alias. «Lo usan» cuenta archivos que importan el nombre o lo llaman con su espacio (`calc.fn()`).");
  L.push("");

  // 1. En números
  L.push("## 1. En números");
  L.push("");
  const filas = capas.map(([c]) => {
    const rs = M.rutas.filter((r) => M.archivos[r].capa === c);
    const lineas = rs.reduce((a, r) => a + M.archivos[r].lineas, 0);
    const funcs = rs.reduce((a, r) => a + M.archivos[r].unidades.filter((u) => u.tipo === "funcion").length, 0);
    const exp = rs.reduce((a, r) => a + M.archivos[r].unidades.filter((u) => u.tipo === "funcion" && u.exportada).length, 0);
    const acc = rs.reduce((a, r) => a + M.archivos[r].unidades.filter((u) => u.tipo === "accion").length, 0);
    const pers = rs.reduce((a, r) => a + M.archivos[r].persists.length, 0);
    return [nombreCapa[c], rs.length, lineas, funcs, exp, acc, pers];
  });
  const totales = ["**Total**"].concat([1, 2, 3, 4, 5, 6].map((i) => filas.reduce((a, f) => a + f[i], 0)));
  L.push(tabla(["Capa", "Archivos", "Líneas", "Funciones de nivel superior", "Exportadas", "Acciones de la interfaz", "Llamadas a persist"], filas.concat([totales])));
  L.push("");

  // 2. Dependencias
  L.push("## 2. Quién depende de quién");
  L.push("");
  L.push("Una flecha `A → B` quiere decir «A importa algo de B». Línea punteada = import dinámico (`import()`, solo `app.js`: carga el resto después de iniciar sesión, ver [ARQUITECTURA.md](ARQUITECTURA.md)).");
  L.push("");
  L.push("### 2.1 Las tres capas");
  L.push("");
  const entre = (a, b) => { let n = 0; M.rutas.filter((r) => M.archivos[r].capa === a).forEach((r) => M.deps[r].forEach((d) => { if (M.archivos[d].capa === b) n++; })); return n; };
  L.push("```mermaid");
  L.push("flowchart LR");
  L.push("  app[\"app.js\"]");
  L.push("  mod[\"modules/ · " + M.rutas.filter((r) => M.archivos[r].capa === "modules").length + " pantallas\"]");
  L.push("  core[\"core/ · " + M.rutas.filter((r) => M.archivos[r].capa === "core").length + " archivos\"]");
  L.push("  app -.->|\"" + entre("app", "core") + " imports\"| core");
  L.push("  app -.->|\"" + entre("app", "modules") + " imports\"| mod");
  L.push("  mod -->|\"" + entre("modules", "core") + " imports\"| core");
  L.push("  mod -->|\"" + entre("modules", "modules") + " entre pantallas\"| mod");
  L.push("  core -->|\"" + entre("core", "core") + " dentro del núcleo\"| core");
  L.push("  core -->|\"" + entre("core", "modules") + " imports (dom.js reúne las pantallas)\"| mod");
  L.push("```");
  L.push("");
  L.push("### 2.2 Dentro de `js/core`");
  L.push("");
  L.push("```mermaid");
  L.push("flowchart LR");
  const core = M.rutas.filter((r) => M.archivos[r].capa === "core");
  core.forEach((r) => L.push("  " + nodoId(r) + "[\"" + path.posix.basename(r) + "\"]"));
  core.forEach((r) => [...M.depsEstaticas[r]].sort(comparar).forEach((d) => { if (M.archivos[d].capa === "core") L.push("  " + nodoId(r) + " --> " + nodoId(d)); }));
  L.push("```");
  L.push("");
  L.push("### 2.3 De las pantallas hacia el núcleo (solo los archivos que usan 5 o más)");
  L.push("");
  const hubs = core.filter((r) => [...M.usadoPor[r]].filter((u) => M.archivos[u].capa === "modules").length >= 5);
  L.push("```mermaid");
  L.push("flowchart LR");
  const mods = M.rutas.filter((r) => M.archivos[r].capa === "modules");
  mods.forEach((r) => L.push("  " + nodoId(r) + "[\"" + path.posix.basename(r) + "\"]"));
  hubs.forEach((r) => L.push("  " + nodoId(r) + "([\"" + path.posix.basename(r) + "\"])"));
  mods.forEach((r) => [...M.depsEstaticas[r]].sort(comparar).forEach((d) => { if (hubs.indexOf(d) !== -1) L.push("  " + nodoId(r) + " --> " + nodoId(d)); }));
  L.push("```");
  L.push("");
  const cs = ciclos(M);
  L.push("### 2.4 Ciclos de importación");
  L.push("");
  L.push("Archivos que se importan unos a otros. Funcionan porque lo que se importa solo se usa **en tiempo de ejecución**, nunca mientras el archivo se está evaluando (cada ciclo está explicado en el comentario del archivo). Un ciclo nuevo es una señal de alerta: ver [ARQUITECTURA.md](ARQUITECTURA.md).");
  L.push("");
  cs.forEach((c) => L.push("- " + c.map((r) => cod(sinJs(r))).join(" ↔ ")));
  if (!cs.length) L.push("_(ninguno)_");
  L.push("");

  // 3. Archivo por archivo
  L.push("## 3. Archivo por archivo");
  L.push("");
  capas.forEach(([c, titulo]) => {
    L.push("### " + titulo);
    L.push("");
    L.push(M.rutas.filter((r) => M.archivos[r].capa === c).map((r) => "[" + sinJs(r) + "](#" + ancla(r) + ")").join(" · "));
    L.push("");
    M.rutas.filter((r) => M.archivos[r].capa === c).forEach((r) => L.push(seccionArchivo(ctx, r)));
  });

  // 4. Registro de acciones
  L.push("## 4. Registro de acciones de la interfaz");
  L.push("");
  L.push("Cada botón o campo de la pantalla lleva `data-action=\"nombre\"` (o `data-action-change`); `dom.js` busca ese nombre en el registro y llama a la función. **No hay ninguna comprobación de rol al despachar**: quien llega a la acción la ejecuta (ver «Roles y permisos» en [ARQUITECTURA.md](ARQUITECTURA.md)).");
  L.push("");
  L.push("- **Guarda** = lo que `persist(...)` llama en todo el camino de la acción (incluye las funciones que ella llama).");
  L.push("- **Mes cerrado** = ✔ si en su camino hay `exigirMesAbierto`/`bloqueoMesCerrado`; ✘ si escribe movimientos o transferencias y no lo tiene; `·` si no escribe movimientos.");
  L.push("- **Rol** = sí, si en su camino se mira el rol (`esAdmin()` o `session.rol`).");
  L.push("- **Pantalla** = cuántas veces aparece su nombre escrito en un `data-action` del código (0 = solo se arma dinámicamente o no se usa).");
  L.push("");
  const accPorArchivo = {};
  M.acciones.forEach((a) => { (accPorArchivo[a.archivo] = accPorArchivo[a.archivo] || []).push(a); });
  Object.keys(accPorArchivo).sort(comparar).forEach((r) => {
    const lista = accPorArchivo[r].slice().sort((x, y) => x.linea - y.linea);
    const filasA = lista.map((a) => {
      const inf = infoAccion(M, a);
      const mes = (inf.sitios.some((x) => ["tx", "txPapelera", "transferencias"].indexOf(x.s.clave) !== -1) || inf.persists.some((k) => k === "tx" || k === "txPapelera" || k === "transferencias"))
        ? (inf.guardas.length ? "✔" : "✘") : "·";
      const uso = M.usosPantalla[a.nombre];
      return [cod(a.nombre), r.replace(/^js\//, "") + ":" + a.linea, corto(a.comentario || "(sin comentario)", 110), inf.persists.length ? inf.persists.join(", ") : "—", mes, inf.roles.length ? "sí" : "—", uso ? uso.cantidad : 0];
    });
    L.push(plegado("<b>" + sinJs(r) + "</b> — " + lista.length + " acciones", tabla(["Acción", "Dónde", "Qué hace", "Guarda", "Mes cerrado", "Rol", "Pantalla"], filasA)));
    L.push("");
  });

  // 5. persist
  L.push("## 5. Qué se guarda y quién lo guarda (persist)");
  L.push("");
  L.push("Cada `persist(\"clave\")` manda a la hoja de Google **la clave entera** (no un cambio suelto). Esta tabla cuenta las llamadas por clave y dónde están. Las llamadas con clave calculada (`persist(variable)`) aparecen aparte.");
  L.push("");
  const porClave = {};
  M.rutas.forEach((r) => M.archivos[r].persists.forEach((p) => {
    const k = p.clave === null ? "(calculada: " + p.expr + ")" : p.clave;
    (porClave[k] = porClave[k] || []).push(r);
  }));
  const filasP = Object.keys(porClave).sort(comparar).map((k) => {
    const rs = porClave[k];
    return [cod(k), rs.length, resumenConteo(rs.map(sinJs))];
  });
  L.push(tabla(["Clave", "Llamadas", "Dónde (archivo ×llamadas)"], filasP));
  L.push("");
  return L.join("\n");
}

function ancla(ruta) { return "f-" + nodoId(ruta); }

function seccionArchivo(ctx, ruta) {
  const M = ctx.M, A = M.archivos[ruta];
  const L = [];
  L.push('<a id="' + ancla(ruta) + '"></a>');
  L.push("");
  L.push("#### " + cod(sinJs(ruta)) + " — " + A.lineas + " líneas");
  L.push("");
  L.push("**Para qué sirve:** " + (A.cabecera ? corto(A.cabecera, 420) : "(el archivo no tiene comentario de cabecera)"));
  L.push("");
  const dep = [...M.deps[ruta]].sort(comparar);
  const usan = [...M.usadoPor[ruta]].sort(comparar);
  L.push("- **Depende de:** " + (dep.length ? dep.map((d) => cod(sinJs(d))).join(", ") : "nada de este proyecto"));
  L.push("- **Lo usan:** " + (usan.length ? usan.map((d) => cod(sinJs(d))).join(", ") : "nadie (se carga directo desde `index.html`)"));
  const lee = [], escribe = [];
  A.estado.forEach((e) => {
    const nombre = e.clave === "config" && e.sub ? "config." + e.sub : e.clave;
    if (e.modo === "lee") lee.push(nombre); else escribe.push(nombre);
  });
  const soloLee = unicos(lee).filter((k) => unicos(escribe).indexOf(k) === -1);
  L.push("- **Claves de `state` que escribe:** " + (escribe.length ? unicos(escribe).map(cod).join(", ") : "ninguna"));
  L.push("- **Claves de `state` que solo lee:** " + (soloLee.length ? (soloLee.length > 14 ? soloLee.slice(0, 14).map(cod).join(", ") + " y " + (soloLee.length - 14) + " más" : soloLee.map(cod).join(", ")) : "ninguna"));
  L.push("- **`persist(...)`:** " + (A.persists.length ? resumenConteo(A.persists.map((p) => p.clave === null ? "(" + p.expr + ")" : p.clave)) : "ninguno"));
  const acc = A.unidades.filter((u) => u.tipo === "accion");
  if (acc.length) L.push("- **Acciones de la interfaz:** " + acc.length + " (tabla en la sección 4)");
  if (A.tablas.length) L.push("- **Hojas de Google que define:** " + A.tablas.map((t) => cod(t.pestana) + " (" + t.columnas.length + " columnas)").join(", "));
  L.push("");
  const funcs = A.unidades.filter((u) => u.tipo === "funcion" && u.exportada);
  const exps = A.exportsDato.slice();
  const otras = A.reexports;
  if (funcs.length || exps.length || otras.length) {
    const filas = funcs.map((u) => {
      const usos = M.usosExport[ruta + "::" + u.nombre] ? [...M.usosExport[ruta + "::" + u.nombre]].sort(comparar) : [];
      const internos = A.unidades.filter((x) => x !== u && x.referencias.has(u.nombre)).length;
      const quien = usos.length ? corto(usos.map(sinJs).slice(0, 5).join(", ") + (usos.length > 5 ? " (+" + (usos.length - 5) + ")" : ""), 120) : (internos ? "solo este archivo" : "nadie");
      const guarda = unicos(u.persists.map((p) => p.clave || "?")).join(", ");
      return [cod(u.nombre + "(" + corto(u.params, 40) + ")"), ruta.replace(/^js\//, "") + ":" + u.linea, corto(u.comentario || "(sin comentario)", 110), guarda || "—", quien];
    });
    exps.forEach((e) => {
      const usos = M.usosExport[ruta + "::" + e.nombre] ? [...M.usosExport[ruta + "::" + e.nombre]].sort(comparar) : [];
      filas.push([cod(e.nombre) + " _(" + e.tipo + ")_", ruta.replace(/^js\//, "") + ":" + e.linea, "(dato exportado)", "—", usos.length ? corto(usos.map(sinJs).slice(0, 5).join(", ") + (usos.length > 5 ? " (+" + (usos.length - 5) + ")" : ""), 120) : "nadie"]);
    });
    otras.forEach((e) => filas.push([cod(e.nombre) + " _(re-exportado)_", ruta.replace(/^js\//, "") + ":" + e.linea, "(se vuelve a exportar)", "—", "—"]));
    L.push(plegado("Exportado (" + filas.length + ")", tabla(["Nombre", "Dónde", "Qué hace (1.ª línea de su comentario)", "Guarda", "Lo usan"], filas)));
    L.push("");
  }
  const internas = A.unidades.filter((u) => u.tipo === "funcion" && !u.exportada);
  if (internas.length) {
    L.push("<sub>Funciones internas (no exportadas): " + internas.length + ".</sub>");
    L.push("");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// MAPA-DEL-DINERO.md: los bloques generados
// ---------------------------------------------------------------------------
const OPERACIONES = { crear: "crea", quitar: "quita", modificar: "cambia", reemplazar: "reemplaza la lista", restaurar: "deshace (vuelve a una copia)", vaciar: "vacía", reordenar: "reordena", copiar: "copia" };
const NOMBRE_CLAVE = { tx: "movimientos", txPapelera: "papelera de movimientos", transferencias: "transferencias" };

function bloqueSitios(ctx) {
  const M = ctx.M;
  const campos = M.marcas.map((m) => m.campo);
  const filas = [];
  const sitios = [];
  M.rutas.forEach((r) => M.archivos[r].unidades.forEach((u) => u.sitios.forEach((s) => {
    // leer lo que trae la hoja al abrir la app no es escribir dinero
    if (u.nombre === "loadAll" && /^datos./.test(s.detalle)) return;
    sitios.push({ r, u, s });
  })));
  sitios.sort((a, b) => comparar(a.r, b.r) || a.s.linea - b.s.linea);
  sitios.forEach(({ r, u, s }) => {
    // marcas mencionadas en el propio sitio
    const A = M.archivos[r];
    let marcas = s.claves.filter((k) => campos.indexOf(k) !== -1);
    if (s.operacion !== "crear") {
      const { cd, pareja } = A._interno;
      const abre = cd.indexOf("(", s.off + 4);
      const ventana = abre > 0 && pareja[abre] > 0 && pareja[abre] - abre < 1500 ? cd.slice(abre, pareja[abre]) : "";
      const src = A._interno.sc.slice(abre, abre + (ventana.length || 0));
      marcas = campos.filter((c) => new RegExp("\\b" + c + "\\b").test(src));
    }
    const llamadas = accionesQueLlegan(M, u);
    const esAccion = u.tipo === "accion";
    const propia = u.guardas.filter(() => u.archivo !== "js/core/cierre.js");
    let mes;
    if (propia.length) mes = "sí, en la misma función (línea " + propia[0].linea + ")";
    else if (!llamadas.length) mes = "no es una acción: corre al abrir la app";
    else {
      const guardasCamino = [];
      llamadas.forEach((a) => infoAccion(M, a).guardas.forEach((x) => guardasCamino.push(x.u.nombre + ":" + x.g.linea)));
      mes = llamadas.every((a) => infoAccion(M, a).guardas.length) ? "en el camino de quien la llama (" + unicos(guardasCamino)[0] + ")" : "**NO**";
    }
    const llamaTxt = esAccion ? "—" : (llamadas.length ? listaCorta(llamadas.map((a) => a.nombre), 4) : "carga de la app");
    const guarda = unicos(u.persists.map((p) => p.clave || "?")).join(", ") || "quien la llama";
    const que = (OPERACIONES[s.operacion] || s.operacion) + " " + NOMBRE_CLAVE[s.clave] + (s.tipoMov ? " «" + s.tipoMov + "»" : "");
    filas.push([
      (esAccion ? "acción " : "función ") + cod(u.nombre),
      r.replace(/^js\//, "") + ":" + s.linea,
      que,
      marcas.length ? marcas.map(cod).join(", ") : "—",
      mes, guarda, llamaTxt
    ]);
  });
  const nCrear = sitios.filter((x) => x.s.clave === "tx" && x.s.operacion === "crear").length;
  return "**" + sitios.length + " sitios** escriben en `state.tx`, `state.txPapelera` o `state.transferencias`; **" + nCrear + "** de ellos crean un movimiento nuevo en la caja (`state.tx`). Los ordena archivo y línea. «Mes cerrado» dice dónde está la guarda `exigirMesAbierto`: en la misma función, o en el camino de la acción que la llama (aproximado: el mapa ve que la guarda existe en el camino, no que cubra todas las ramas).\n\n" +
    tabla(["Quién", "Dónde", "Qué hace", "Marca de origen", "Mes cerrado", "Guarda (persist)", "La llaman"], filas);
}

function bloqueMarcas(ctx) {
  const M = ctx.M;
  const colMov = (M.archivos["js/core/sheetsEsquemas.js"].tablas.filter((t) => t.pestana === "Movimientos")[0] || { columnas: [] }).columnas.map((c) => c.key);
  const filas = M.marcas.map((m) => {
    const crean = [];
    M.rutas.forEach((r) => M.archivos[r].unidades.forEach((u) => u.sitios.forEach((s) => { if (s.clave === "tx" && s.operacion === "crear" && s.claves.indexOf(m.campo) !== -1) crean.push(u.nombre); })));
    return [cod(m.campo), "js/core/calc.js:" + m.linea, m.que, colMov.indexOf(m.campo) !== -1 ? "sí" : "**NO**", crean.length ? unicos(crean).join(", ") : "(la crea una función auxiliar)", corto(m.donde, 160)];
  });
  return tabla(["Marca (campo del movimiento)", "Dónde se declara", "Qué representa", "Tiene columna en la hoja", "Quién la pone", "Cómo se deshace (lo que le dice la app al usuario)"], filas);
}

function bloqueAccionesDinero(ctx) {
  const M = ctx.M;
  const filas = [];
  const otras = [];
  M.acciones.slice().sort((a, b) => comparar(a.archivo, b.archivo) || a.linea - b.linea).forEach((a) => {
    const inf = infoAccion(M, a);
    const dinero = inf.persists.filter((k) => CLAVES_DINERO.indexOf(k) !== -1);
    const sitiosMov = inf.sitios.filter((x) => ["tx", "txPapelera", "transferencias"].indexOf(x.s.clave) !== -1);
    const tocaConfig = inf.persists.indexOf("config") !== -1 && inf.subConfig.length;
    if (!dinero.length && !sitiosMov.length && !tocaConfig) {
      if (inf.persists.indexOf("pedidos") !== -1 || inf.persists.indexOf("cotizaciones") !== -1 || inf.persists.indexOf("pedidosPapelera") !== -1) otras.push(a);
      return;
    }
    const toca = unicos(dinero.concat(tocaConfig ? inf.subConfig.map((s) => "config." + s) : []).concat(inf.persists.filter((k) => k === "pedidos" || k === "cotizaciones")));
    const persisteMov = inf.persists.some((k) => k === "tx" || k === "txPapelera" || k === "transferencias");
    const mes = (sitiosMov.length || persisteMov) ? (inf.guardas.length ? "✔" : "✘ SIN guarda") : "· (no escribe movimientos)";
    filas.push([cod(a.nombre), a.archivo.replace(/^js\//, "") + ":" + a.linea, corto(a.comentario || "(sin comentario)", 90), toca.map(cod).join(", "), mes, inf.roles.length ? "sí" : "—"]);
  });
  const resto = otras.length
    ? "\n\n" + plegado("Acciones que solo guardan pedidos o cotizaciones, sin tocar movimientos (" + otras.length + ")",
      "El cierre de mes **no las bloquea** (decisión del Hallazgo #65: pedidos y cotizaciones solo se anotan en la bitácora). Cambian totales, descuentos, comisión o estado, no la caja.\n\n" + otras.map((a) => cod(a.nombre) + " (" + a.archivo.replace(/^js\//, "") + ":" + a.linea + ")").join(" · "))
    : "";
  return "**" + filas.length + " acciones** guardan movimientos, transferencias, cierres, deudas o la parte de dinero de la configuración (nómina, gastos fijos, Colchón, cuentas, conciliaciones).\n\n" +
    tabla(["Acción", "Dónde", "Qué hace", "Toca", "Mes cerrado", "Mira el rol"], filas) + resto;
}

function bloqueAlias(ctx) {
  const M = ctx.M;
  const filas = [];
  M.rutas.forEach((r) => M.archivos[r].alias.forEach((a) => filas.push([r.replace(/^js\//, "") + ":" + a.linea, cod(a.unidad), cod(a.forma)])));
  return "El análisis no puede seguir una variable que apunta a un movimiento. Estos son los sitios donde el código cambia un campo de dinero **por referencia** (no aparecen en la tabla de arriba); hay que mirarlos a mano:\n\n" +
    tabla(["Dónde", "En", "Forma"], filas);
}

// ---------------------------------------------------------------------------
// ARQUITECTURA.md: los bloques generados
// ---------------------------------------------------------------------------
function bloqueCapas(ctx) {
  const M = ctx.M;
  const filas = ["app", "core", "modules"].map((c) => {
    const rs = M.rutas.filter((r) => M.archivos[r].capa === c);
    return [c === "app" ? "`js/app.js`" : "`js/" + c + "/`", rs.length, rs.reduce((a, r) => a + M.archivos[r].lineas, 0)];
  });
  return tabla(["Capa", "Archivos", "Líneas de JavaScript"], filas.concat([["**Total**", filas.reduce((a, f) => a + f[1], 0), filas.reduce((a, f) => a + f[2], 0)]]));
}

function bloqueClaves(ctx) {
  const M = ctx.M;
  const tablas = {};
  const arch = M.archivos["js/core/store.js"];
  ((arch.datos.TABLAS_SHEET) || []).forEach((e) => { tablas[e.nombre] = e.valor; });
  const porTabla = {};
  M.rutas.forEach((r) => M.archivos[r].tablas.forEach((t) => { porTabla[t.variable] = t; }));
  const etiquetas = {};
  ((arch.datos.ETIQUETA_CLAVE) || []).forEach((e) => { etiquetas[e.nombre] = e.valor.replace(/^"|"$/g, ""); });
  const persistPor = {};
  M.rutas.forEach((r) => M.archivos[r].persists.forEach((p) => { if (p.clave) (persistPor[p.clave] = persistPor[p.clave] || []).push(r); }));
  const filas = Object.keys(M.KEYS).sort(comparar).map((k) => {
    const t = tablas[k] && porTabla[tablas[k]];
    const donde = t ? "Pestaña " + cod(t.pestana) + " — una fila por registro, " + t.columnas.length + " columnas" : "Pestaña " + cod("kv") + " — una fila, clave " + cod(M.KEYS[k]) + ", todo el contenido como un texto JSON en una celda";
    const quien = persistPor[k] ? resumenConteo(persistPor[k].map(sinJs)) : "—";
    return [cod(k), donde, etiquetas[k] || "—", quien];
  });
  return tabla(["Clave de `state`", "Dónde vive en la hoja de Google", "Cómo se llama en los avisos", "Quién la guarda (archivo ×llamadas a persist)"], filas);
}

function bloqueEsquemas(ctx) {
  const act = esquemasActuales(ctx.M);
  const cuerpo = Object.keys(act).map((p) => {
    return "**`" + p + "`** — " + act[p].length + " columnas, en este orden (la posición es lo que importa: la app lee por posición, no por el nombre del encabezado):\n\n" +
      act[p].map((c, i) => (i + 1) + ". `" + c.key + "`" + (c.tipo !== "texto" ? " _(" + c.tipo + ")_" : "")).join("  \n");
  });
  return plegado("Las " + Object.keys(act).length + " hojas con columnas propias y el orden de cada una", cuerpo.join("\n\n"));
}

function bloqueRoles(ctx) {
  const M = ctx.M;
  const filas = [];
  M.rutas.forEach((r) => M.archivos[r].roles.forEach((e) => filas.push([r.replace(/^js\//, "") + ":" + e.linea, cod(e.unidad)])));
  const mAprob = /APPROVAL_REQUIRED_KEYS\s*=\s*\[([^\]]*)\]/.exec(ctx.fuentes["js/core/constants.js"]);
  const aprobacion = mAprob ? mAprob[1].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean).map(cod).join(" y ") : "(no se pudo leer)";
  return "El código mira el rol del usuario en **" + filas.length + " sitios** (`esAdmin()` o `session.rol`). Casi todos deciden **qué se dibuja**; solo unos pocos deciden **qué se permite hacer**. `persist` además desvía a «propuesta» los cambios de un vendedor a " + aprobacion + " (`APPROVAL_REQUIRED_KEYS`).\n\n" +
    plegado("Los " + filas.length + " sitios donde se mira el rol", tabla(["Dónde", "En"], filas));
}

// ---------------------------------------------------------------------------
// REGLAS-DE-ARQUITECTURA.md: los bloques generados
// ---------------------------------------------------------------------------
export function estadoReglas(ctx) {
  const viol = evaluarReglas(ctx.M, {
    fuentes: ctx.fuentes, fotoEsquemas: ctx.fotoEsquemas, pruebasEnDisco: ctx.pruebasEnDisco, workflow: ctx.workflow, scriptTest: ctx.scriptTest
  });
  const res = {};
  REGLAS.forEach((r) => {
    const base = (ctx.baseline.reglas && ctx.baseline.reglas[r.id]) || [];
    const clavesBase = base.map((b) => b.clave);
    const v = viol[r.id] || [];
    res[r.id] = {
      regla: r, base, violaciones: v,
      conocidas: v.filter((x) => clavesBase.indexOf(x.clave) !== -1),
      nuevas: v.filter((x) => clavesBase.indexOf(x.clave) === -1),
      obsoletas: base.filter((b) => !v.some((x) => x.clave === b.clave))
    };
  });
  return res;
}

function bloqueEstadoReglas(ctx) {
  const est = estadoReglas(ctx);
  const filas = REGLAS.map((r) => {
    const e = est[r.id];
    return [cod(r.id), r.titulo, e.violaciones.length, e.conocidas.length, e.nuevas.length];
  });
  return tabla(["Regla", "Qué exige", "Casos hoy", "En la lista base", "Nuevos (hacen fallar la CI)"], filas);
}

function bloqueListaBase(ctx) {
  const est = estadoReglas(ctx);
  const filas = [];
  REGLAS.forEach((r) => est[r.id].base.forEach((b) => filas.push([cod(r.id), cod(b.clave), b.clasificacion === "riesgo-real" ? "**riesgo real**" + (b.severidad ? " (" + b.severidad + ")" : "") : "excepción legítima", b.hallazgo || "—", b.motivo])));
  const reales = filas.filter((f) => f[2].indexOf("riesgo real") !== -1).length;
  return "**" + filas.length + " entradas**: " + (filas.length - reales) + " excepciones legítimas y " + reales + " riesgos reales (cada riesgo real tiene su Hallazgo en `CONTABILIDAD.md`).\n\n" +
    tabla(["Regla", "Caso (clave)", "Qué es", "Hallazgo", "Por qué está en la lista"], filas);
}

// ---------------------------------------------------------------------------
// Foto de esquemas
// ---------------------------------------------------------------------------
export function textoFotoEsquemas(M) {
  return JSON.stringify(esquemasActuales(M), null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Armar todos los archivos
// ---------------------------------------------------------------------------
const GENERADORES = {
  "docs/MAPA-DEL-DINERO.md": {
    "sitios-tx": bloqueSitios, "marcas": bloqueMarcas, "acciones-dinero": bloqueAccionesDinero, "alias": bloqueAlias
  },
  "docs/ARQUITECTURA.md": {
    "capas": bloqueCapas, "claves": bloqueClaves, "esquemas": bloqueEsquemas, "roles": bloqueRoles
  },
  "docs/REGLAS-DE-ARQUITECTURA.md": {
    "estado": bloqueEstadoReglas, "lista-base": bloqueListaBase
  }
};

export function reemplazarBloques(texto, generadores, archivo, ctx) {
  let out = texto;
  const nombres = Object.keys(generadores);
  nombres.forEach((n) => {
    const re = new RegExp("(<!-- GENERADO:inicio " + n + " -->)[\\s\\S]*?(<!-- GENERADO:fin " + n + " -->)");
    if (!re.test(out)) throw new Error(archivo + ": falta el bloque <!-- GENERADO:inicio " + n + " --> … <!-- GENERADO:fin " + n + " -->");
    out = out.replace(re, (_, a, b) => a + "\n\n" + generadores[n](ctx) + "\n\n" + b);
  });
  const presentes = [...out.matchAll(/<!-- GENERADO:inicio ([\w-]+) -->/g)].map((m) => m[1]);
  presentes.forEach((p) => { if (nombres.indexOf(p) === -1) throw new Error(archivo + ": el bloque «" + p + "» no tiene generador en tools/mapa.mjs"); });
  return out;
}

// Devuelve { "ruta relativa": texto } con TODO lo que debería haber en disco.
export function generarDocumentos(ctx) {
  const out = {};
  out["docs/MAPA-DEL-CODIGO.md"] = docMapaCodigo(ctx) + "\n";
  out["docs/esquemas.snapshot.json"] = textoFotoEsquemas(ctx.M);
  Object.keys(GENERADORES).forEach((arch) => {
    const actual = ctx.leer(arch);
    if (actual === null) throw new Error("falta " + arch + " (el texto escrito a mano con sus marcas GENERADO)");
    out[arch] = reemplazarBloques(actual, GENERADORES[arch], arch, ctx);
  });
  // Citas archivo:línea de los textos a mano: reancladas contra la foto de lo que apuntaban
  // (docs/citas.snapshot.json; ver tools/citas.mjs).
  const resolver = crearResolver(ctx.M.rutas, ctx.pruebasEnDisco);
  const cache = {};
  const lineasDe = (rel) => {
    if (cache[rel] === undefined) { const x = ctx.leer(rel); cache[rel] = x === null ? null : x.split("\n"); }
    return cache[rel];
  };
  const foto = {};
  ctx.informeCitas = { movidas: [], rotas: [], nuevas: 0, errores: [] };
  DOCS_CON_CITAS.forEach((arch) => {
    const base = out[arch] !== undefined ? out[arch] : ctx.leer(arch);
    if (base === null) throw new Error("falta " + arch);
    const r = reanclar(base, resolver, lineasDe, ctx.citasFoto[arch]);
    out[arch] = r.texto;
    foto[arch] = r.foto;
    r.movidas.forEach((x) => ctx.informeCitas.movidas.push(Object.assign({ doc: arch }, x)));
    r.rotas.forEach((x) => ctx.informeCitas.rotas.push(Object.assign({ doc: arch }, x)));
    r.errores.forEach((x) => ctx.informeCitas.errores.push(Object.assign({ doc: arch }, x)));
    ctx.informeCitas.nuevas += r.nuevas;
  });
  out["docs/citas.snapshot.json"] = textoFotoCitas(foto);
  return out;
}

// Documentos con texto escrito a mano que cita código (sus citas se reanclan solas).
export const DOCS_CON_CITAS = ["docs/ARQUITECTURA.md", "docs/ESCENARIOS-DE-FALLA.md", "docs/MAPA-DEL-DINERO.md", "docs/REGLAS-DE-ARQUITECTURA.md"];

// Una línea por cita: legible y con diferencias pequeñas en git.
function textoFotoCitas(foto) {
  const docs = Object.keys(foto).sort(comparar);
  return "{\n" + docs.map((d) => "  " + JSON.stringify(d) + ": [\n" + foto[d].map((e) => "    " + JSON.stringify(e)).join(",\n") + "\n  ]").join(",\n") + "\n}\n";
}

// ---------------------------------------------------------------------------
// Línea de comandos
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const soloComprobar = args.indexOf("--comprobar") !== -1;
  const forzar = args.indexOf("--forzar-esquemas") !== -1;
  const ctx = leerContexto(RAIZ);

  // R5: la foto de las columnas solo se actualiza si lo nuevo está AL FINAL.
  if (ctx.fotoEsquemas) {
    const cmp = compararEsquemas(ctx.fotoEsquemas, esquemasActuales(ctx.M));
    if (cmp.violaciones.length && !forzar) {
      console.error("✘ Una columna de una hoja cambió de lugar, de nombre o se quitó. Las columnas nuevas van AL FINAL (Hallazgos #15-#19).");
      cmp.violaciones.forEach((v) => console.error("  - " + v.detalle));
      console.error("No se escribió nada. Si de verdad es a propósito (y ya moviste los datos de la hoja), corre con --forzar-esquemas.");
      process.exit(1);
    }
  }

  const docs = generarDocumentos(ctx);
  const cambios = [];
  Object.keys(docs).sort(comparar).forEach((rel) => {
    const abs = path.join(RAIZ, rel);
    const actual = fs.existsSync(abs) ? normalizarTexto(fs.readFileSync(abs, "utf8")) : null;
    if (actual === docs[rel]) return;
    cambios.push(rel);
    if (!soloComprobar) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, docs[rel], "utf8"); }
  });
  if (soloComprobar) {
    if (cambios.length) { console.error("✘ Documentos viejos (corre npm run mapa): " + cambios.join(", ")); process.exit(1); }
    console.log("✔ Los documentos están al día.");
    return;
  }
  console.log(cambios.length ? "Se actualizaron: " + cambios.join(", ") : "Todo estaba al día: sin diferencias.");
  const ic = ctx.informeCitas;
  if (ic && ic.movidas.length) console.log("Citas reancladas (el código se movió): " + ic.movidas.length + " — " + ic.movidas.slice(0, 5).map((m) => m.de + " → " + m.a).join(", ") + (ic.movidas.length > 5 ? "…" : ""));
  if (ic && ic.rotas.length) {
    console.log("⚠ Citas a revisar a mano (la línea citada cambió de verdad): " + ic.rotas.length);
    ic.rotas.forEach((r) => console.log("   " + r.doc + ":" + r.linea + " " + r.cita + "\n      antes:  " + (r.antes || "").slice(0, 100) + "\n      ahora:  " + String(r.ahora || "(ya no existe)").slice(0, 100)));
  }
  if (ic && ic.errores.length) ic.errores.forEach((e) => console.log("⚠ " + e.doc + ":" + e.linea + " " + e.error));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
