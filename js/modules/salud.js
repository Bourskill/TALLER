// Panel «Salud de los datos» (solo admin, vive dentro de Configuración, ver
// modules/config.js). Es de SOLO LECTURA: muestra lo que calcSaludDatos() y
// calcReparacionesAlCargar() (core/salud.js) encuentran y lleva a cada caso;
// no corrige nada ni escribe ningún dato. La lógica está en core/salud.js, acá
// solo se pinta y se navega.

import { state, notify, mostrarToast } from "../core/store.js";
import { esc, norm, todayStr } from "../core/utils.js";
import { renderHelp, renderBuscador } from "../core/components.js";
import { calcResumenSalud, calcReparacionesAlCargar, textoInformeSalud } from "../core/salud.js";
import { irARecibo } from "./finanzas.js";
import { cargarBitacora, estadoLecturaBitacora } from "../core/bitacora.js";

// Cuántos botones «Ver…» se muestran por hallazgo; el resto se cuenta. (Todos
// están en el informe copiado.)
var MAX_ENLACES = 4;

function pluralCosas(n) { return n + (n === 1 ? " cosa" : " cosas"); }

function textoBuscable(h) {
  return norm([h.titulo, h.detalle].concat(h.afectados.map(function (a) { return a.etiqueta || ""; })).join(" | "));
}

// Los afectados pasan a botones: uno por pedido / cotización / recibo, y UNO
// para todos los movimientos (Finanzas los muestra juntos, ver txEnfocados).
function renderEnlaces(h) {
  var movs = h.afectados.filter(function (a) { return a.tipo === "movimiento"; });
  var otros = h.afectados.filter(function (a) { return a.tipo !== "movimiento"; });
  var ICONO = { pedido: "Pedido", cotizacion: "Cotización", recibo: "Recibo" };
  var botones = otros.slice(0, MAX_ENLACES).map(function (a) {
    return '<button class="btn ghost small salud-ir" data-action="salud-ir" data-tipo="' + a.tipo + '" data-id="' + esc(a.id) + '" title="' + esc(a.etiqueta || "") + '">↗ ' +
      (ICONO[a.tipo] || "Ver") + "</button>";
  });
  if (movs.length) {
    botones.push('<button class="btn ghost small salud-ir" data-action="salud-ir" data-tipo="movimiento" data-id="' + esc(movs.map(function (m) { return m.id; }).join(",")) + '" title="' + esc(movs.map(function (m) { return m.etiqueta || ""; }).join(" · ")) + '">↗ ' +
      (movs.length === 1 ? "Movimiento" : movs.length + " movimientos") + "</button>");
  }
  var resto = otros.length - MAX_ENLACES;
  return botones.join("") + (resto > 0 ? '<span class="salud-mas">y ' + resto + " más</span>" : "");
}

function renderHallazgo(h) {
  var esError = h.severidad === "error";
  return '<div class="salud-item ' + (esError ? "error" : "aviso") + '">' +
    '<div class="salud-item-head"><span class="badge ' + (esError ? "danger" : "warning") + '">' + (esError ? "Error" : "Aviso") + "</span>" +
    "<b>" + esc(h.titulo) + "</b>" + renderHelp(h.porque) + "</div>" +
    '<div class="salud-detalle">' + esc(h.detalle) + "</div>" +
    '<div class="salud-pie"><span class="salud-donde">Se arregla en: ' + esc(h.donde) + "</span>" +
    '<span class="salud-enlaces">' + renderEnlaces(h) + "</span></div>" +
    "</div>";
}

function renderReparaciones() {
  var rep = calcReparacionesAlCargar();
  // Sin señal, las reparaciones se saltan (solo corren con red real, ver
  // loadAll): se dice, para que «no corrigió nada» no se lea como «todo estaba bien».
  var sinRed = rep.omitidas ? " Esta carga mostró la copia guardada sin conexión: las demás correcciones se saltaron y se reintentan al cargar con señal." : "";
  if (!rep.total) {
    return '<div class="salud-rep">' + (rep.omitidas ? "<b>Al cargar:</b> no se corrigió nada." + sinRed : "Al cargar, la app no tuvo que corregir nada.") + "</div>";
  }
  return '<div class="salud-rep aviso"><b>Al cargar, la app corrigió ' + pluralCosas(rep.total) + " por su cuenta:</b>" +
    "<ul>" + rep.filas.map(function (f) { return "<li><b>" + f.cantidad + "</b> " + esc(f.texto) + "</li>"; }).join("") + "</ul>" + (sinRed ? "<div>" + sinRed.trim() + "</div>" : "") + "</div>";
}

export function renderSalud() {
  // «Meses cerrados» compara contra la bitácora: si hay algún mes cerrado y aún
  // no se leyó (ni falló), se pide ahora; al terminar vuelve a pintar sola.
  var lectura = estadoLecturaBitacora();
  if (!lectura.cargada && !lectura.cargando && !lectura.error && (state.cierres || []).some(function (c) { return c.estado === "cerrado"; })) cargarBitacora();
  var r = calcResumenSalud();
  var ayuda = "Revisa que el dinero cuadre: solo lee, no cambia nada. Cada punto explica por qué importa y lleva al caso. " +
    "Se revisa: " + r.revisadas.map(function (v) { return v.titulo; }).join("; ") + ".";
  var html = '<div class="card"><div class="section-title small">Salud de los datos' + renderHelp(ayuda) + "</div>";

  if (!r.hallazgos.length) {
    html += '<div class="salud-ok"><span class="badge success">Todo cuadra</span> <span>Se revisaron ' + pluralCosas(r.revisadas.length) + ".</span></div>";
  } else {
    var filtro = state.saludFiltro || "todos";
    var q = norm(state.saludBuscar || "").trim();
    var visibles = r.hallazgos.filter(function (h) {
      if (filtro === "error" && h.severidad !== "error") return false;
      if (filtro === "aviso" && h.severidad === "error") return false;
      return !q || textoBuscable(h).indexOf(q) >= 0;
    });
    html += '<div class="filters">';
    [["todos", "Todos", r.hallazgos.length, ""], ["error", "Errores", r.errores, ""], ["aviso", "Avisos", r.avisos, "chip-aviso"]].forEach(function (c) {
      if (c[0] !== "todos" && !c[2]) return;
      html += '<button class="chip ' + c[3] + (filtro === c[0] ? " active" : "") + '" data-action="salud-filtro" data-val="' + c[0] + '">' + c[1] + '<span class="chip-n">' + c[2] + "</span></button>";
    });
    html += "</div>";
    html += '<div style="margin:6px 0 10px;">' + renderBuscador({
      id: "inp-buscar-salud", filtro: "saludBuscar", valor: state.saludBuscar, ancho: 340,
      placeholder: "Buscar por pedido, cliente, movimiento…",
      conteo: { visibles: visibles.length, total: r.hallazgos.length, singular: "hallazgo", plural: "hallazgos" }
    }) + "</div>";
    html += visibles.length
      ? visibles.map(renderHallazgo).join("")
      : '<div class="empty">Nada coincide con esa búsqueda o filtro.</div>';
  }

  html += renderReparaciones();
  html += '<div class="pedido-actions"><button class="btn ghost small" data-action="copiar-informe-salud">Copiar informe</button></div>';
  return html + "</div>";
}

// Copia al portapapeles. navigator.clipboard solo existe en páginas seguras
// (https / localhost); el respaldo con un textarea cubre el resto.
function copiarTexto(texto) {
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texto).then(function () { return true; }, function () { return copiarConTextarea(texto); });
  }
  return Promise.resolve(copiarConTextarea(texto));
}
function copiarConTextarea(texto) {
  try {
    var ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

// Lleva al registro del caso, igual que «↗ Origen» en Finanzas (ver-origen-tx):
// cambia de pestaña, deja los filtros en «todos» para que el registro no quede
// escondido, y destella la tarjeta.
function destellar(selector) {
  setTimeout(function () {
    var card = document.querySelector(selector);
    if (!card) return;
    if (card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("destello");
  }, 60);
}

export var actions = {
  "salud-filtro": function (el) {
    state.saludFiltro = el.getAttribute("data-val") || "todos";
    notify();
  },
  "copiar-informe-salud": function () {
    copiarTexto(textoInformeSalud(todayStr())).then(function (ok) {
      mostrarToast(ok ? "✓ Informe copiado: pégalo donde quieras." : "No se pudo copiar el informe en este navegador.");
    });
  },
  "salud-ir": function (el) {
    var tipo = el.getAttribute("data-tipo"), id = el.getAttribute("data-id");
    if (!id) return;
    state.sidebarMobileOpen = false;
    if (tipo === "recibo") { irARecibo(id); return; }
    if (tipo === "pedido") {
      state.tab = "pedidos";
      state.pedidosVista = "historial";
      state.filtroPedidosVista = "activos";
      state.filtroPedidos = "todos";
      state.filtroPedidosSoloSaldo = false;
      state.buscarPedidos = "";
      notify();
      destellar('[data-pedido-id="' + id + '"]');
    } else if (tipo === "cotizacion") {
      state.tab = "cotizaciones";
      state.cotizacionEditando = id;
      state.cotizacionesVista = "nueva";
      notify();
    } else if (tipo === "movimiento") {
      // Finanzas se queda solo con esos movimientos (ver txEnfocados) y deja
      // un chip para volver a verlos todos.
      state.tab = "finanzas";
      state.finanzasVista = "historial";
      state.filtroTxVista = "activos";
      state.filtroTx = "todos";
      state.filtroTxPeriodo = "todos";
      state.buscarTx = "";
      state.txEnfocados = id.split(",");
      notify();
    }
  }
};
