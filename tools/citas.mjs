// Citas `archivo:línea` de los documentos escritos a mano (Hallazgo #67).
//
// El problema: los documentos citan líneas de código («`js/core/store.js:1898`»)
// y el código se mueve cada vez que alguien agrega una función arriba. Una cita
// que apunta 15 líneas más arriba de su función engaña sin avisar.
//
// La solución: docs/citas.snapshot.json guarda, por cada cita, el TEXTO de la
// línea que apuntaba cuando el autor la verificó. `npm run mapa`:
//   - si el texto sigue en esa línea: no hace nada;
//   - si el texto se movió: REANCLA la cita (cambia el número en el documento);
//   - si el texto ya no está en el archivo: la deja como está y la reporta para
//     revisarla a mano (la línea cambió de verdad, no solo se movió);
//   - una cita nueva (aún sin foto) se fotografía tal como está: se da por
//     verificada por quien la escribió.
// Las tablas generadas no pasan por aquí: ya salen del código.
//
// Solo módulos nativos de Node.

import { comparar } from "./analisis.mjs";

const EXT = "(?:js|mjs|md|json|yml)";

// Nombres de archivo del proyecto: ruta completa, o un nombre suelto si es único.
export function crearResolver(rutasJs, pruebas) {
  const porNombre = {};
  rutasJs.forEach((r) => { const n = r.split("/").pop(); (porNombre[n] = porNombre[n] || []).push(r); });
  return function resolver(token) {
    if (/^(js|test|tools|docs)\//.test(token)) return { rel: token };
    if (/^(core|modules)\//.test(token)) return { rel: "js/" + token };
    const m = porNombre[token];
    if (m && m.length === 1) return { rel: m[0] };
    if (m) return { error: "«" + token + "» es ambiguo (" + m.join(" o ") + "): escribe la ruta completa" };
    if (/^[\w.-]+\.mjs$/.test(token) && pruebas.indexOf(token) !== -1) return { rel: "test/" + token };
    return null;
  };
}

// Todas las citas de un documento, fuera de los bloques GENERADO.
// Cada una: { rel, desde, hasta, ini, fin, linea, simbolo, sinArchivo }
//   ini..fin = desplazamientos DENTRO del documento del texto entre las comillas
//   invertidas (el «js/core/x.js:12-14» o el «:12»), para poder reescribirlo.
export function extraerCitas(texto, resolver) {
  const citas = [], errores = [];
  const lineas = texto.split("\n");
  let off = 0, dentro = false;
  lineas.forEach((ln, i) => {
    const base = off;
    off += ln.length + 1;
    if (/<!-- GENERADO:inicio/.test(ln)) dentro = true;
    if (/<!-- GENERADO:fin/.test(ln)) { dentro = false; return; }
    if (dentro) return;
    let ultimoArchivo = null, ultimoSimbolo = null, finSimbolo = -1;
    const re = /`([^`]+)`/g;
    let m;
    while ((m = re.exec(ln)) !== null) {
      const tok = m[1];
      const iniTok = base + m.index + 1, finTok = iniTok + tok.length;
      let mm = new RegExp("^([\\w./-]+\\." + EXT + "):(\\d+)(?:-(\\d+))?$").exec(tok);
      let rel = null, sinArchivo = false;
      if (mm) {
        const r = resolver(mm[1]);
        if (!r) continue; // no es un archivo del proyecto (p. ej. un ejemplo)
        if (r.error) { errores.push({ linea: i + 1, error: r.error }); continue; }
        rel = r.rel; ultimoArchivo = rel;
      } else if (new RegExp("^[\\w./-]+\\." + EXT + "$").test(tok) && resolver(tok) && resolver(tok).rel) {
        ultimoArchivo = resolver(tok).rel; // un archivo nombrado sin línea: un «`:123`» posterior es de ESTE archivo
        continue;
      } else if ((mm = /^:(\d+)(?:-(\d+))?$/.exec(tok)) && ultimoArchivo) {
        rel = ultimoArchivo; sinArchivo = true; mm = [tok, rel, mm[1], mm[2]];
      } else {
        if (/^[A-Za-z_$][\w$-]*(\(\))?$/.test(tok)) { ultimoSimbolo = tok.replace(/\(\)$/, ""); finSimbolo = m.index + m[0].length; }
        continue;
      }
      // el nombre solo cuenta si la cita va PEGADA a él: «`nombre` (`archivo:línea`)» o «`nombre`, `archivo:línea`»
      const pegado = ultimoSimbolo && finSimbolo >= 0 && /^\s*(\(|,\s*)$/.test(ln.slice(finSimbolo, m.index));
      citas.push({
        rel, desde: Number(mm[2]), hasta: Number(mm[3] || mm[2]), ini: iniTok, fin: finTok, linea: i + 1,
        simbolo: pegado ? ultimoSimbolo : null, sinArchivo, token: tok
      });
      ultimoSimbolo = null;
    }
  });
  return { citas, errores };
}

function textoDeLinea(lineasDe, rel, n) {
  const ls = lineasDe(rel);
  return ls && ls[n - 1] !== undefined ? ls[n - 1].trim().replace(/\s+/g, " ").slice(0, 120) : null;
}

// Reancla las citas de UN documento según la foto. Devuelve
//   { texto, foto: [{cita, texto}], movidas, rotas, nuevas }
// `lineasDe(rel)` devuelve las líneas del archivo (o null si no existe).
export function reanclar(textoDoc, resolver, lineasDe, fotoDoc) {
  const { citas, errores } = extraerCitas(textoDoc, resolver);
  const previa = {};
  (fotoDoc || []).forEach((e) => { previa[e.cita] = e.texto; });
  const cambios = []; // { ini, fin, nuevo }
  const movidas = [], rotas = [];
  let nuevas = 0;
  const foto = [];
  const vistas = {};
  citas.forEach((c) => {
    const clave = c.rel + ":" + c.desde;
    const ahora = textoDeLinea(lineasDe, c.rel, c.desde);
    let desdeFinal = c.desde, hastaFinal = c.hasta;
    let textoFoto = ahora;
    if (previa[clave] === undefined) {
      nuevas++; // se fotografía como está
    } else if (ahora !== previa[clave]) {
      const ls = lineasDe(c.rel) || [];
      const candidatas = [];
      ls.forEach((l, k) => { if (l.trim().replace(/\s+/g, " ").slice(0, 120) === previa[clave]) candidatas.push(k + 1); });
      candidatas.sort((a, b) => Math.abs(a - c.desde) - Math.abs(b - c.desde) || a - b);
      const vale = previa[clave].length >= 8 && candidatas.length && (candidatas.length === 1 || Math.abs(candidatas[0] - c.desde) < Math.abs(candidatas[1] - c.desde));
      if (vale) {
        const delta = candidatas[0] - c.desde;
        desdeFinal = c.desde + delta; hastaFinal = c.hasta + delta;
        const nuevoTok = (c.sinArchivo ? "" : c.token.replace(/:\d+(?:-\d+)?$/, "")) + ":" + desdeFinal + (hastaFinal !== desdeFinal ? "-" + hastaFinal : "");
        cambios.push({ ini: c.ini, fin: c.fin, nuevo: nuevoTok });
        movidas.push({ linea: c.linea, de: c.rel + ":" + c.desde, a: c.rel + ":" + desdeFinal });
        textoFoto = textoDeLinea(lineasDe, c.rel, desdeFinal);
      } else {
        rotas.push({ linea: c.linea, cita: c.rel + ":" + c.desde, antes: previa[clave], ahora: ahora });
        textoFoto = previa[clave]; // la foto no se toca: el aviso sigue hasta que alguien la revise
      }
    }
    const k2 = c.rel + ":" + desdeFinal;
    if (!vistas[k2]) { vistas[k2] = true; foto.push({ cita: k2, texto: textoFoto }); }
  });
  let texto = textoDoc;
  cambios.sort((a, b) => b.ini - a.ini).forEach((x) => { texto = texto.slice(0, x.ini) + x.nuevo + texto.slice(x.fin); });
  return { texto, foto, movidas, rotas, nuevas, errores };
}

export function ordenarFoto(foto) {
  const out = {};
  Object.keys(foto).sort(comparar).forEach((d) => { out[d] = foto[d]; });
  return out;
}
