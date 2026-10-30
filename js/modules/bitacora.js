// Finanzas → 📒 Bitácora (Hallazgo #65, solo admin, SOLO LECTURA): quién cambió
// qué, cuándo, y cómo estaba antes. Lo que se muestra sale de la pestaña
// «Bitacora» de la Sheet y de lo que todavía espera conexión para escribirse
// (core/bitacora.js). Nada de acá edita ni borra una anotación.

import { state, notify } from "../core/store.js";
import { esc, norm, fmt } from "../core/utils.js";
import { renderHelp, renderBuscador } from "../core/components.js";
import { esAdmin } from "../core/cierre.js";
import { cargarBitacora, entradasBitacora, estadoBitacora, estadoLecturaBitacora, reintentarBitacora } from "../core/bitacora.js";

var PAGINA = 100;
var ACCION_TEXTO = {
  crear: "Creó", editar: "Editó", eliminar: "Eliminó", restaurar: "Restauró",
  "cerrar-mes": "Cerró el mes", "reabrir-mes": "Reabrió el mes", inicio: "Inicio"
};
var ACCION_BADGE = { crear: "success", restaurar: "success", editar: "warning", eliminar: "danger", "cerrar-mes": "success", "reabrir-mes": "warning" };
var CAMPOS_PLATA = { monto: 1, total: 1, costo: 1, comision: 1, salario: 1 };
var CHIPS = [["todas", "Todos"], ["crear", "Creó"], ["editar", "Editó"], ["eliminar", "Eliminó"], ["restaurar", "Restauró"], ["mes", "Cierres"]];

function quien(e) {
  if (e.origen === "automatico") return "Automático (al cargar la app)";
  return e.nombre || e.usuario || "Sin nombre";
}
function fechaLocal(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fechaHora(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "");
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function claveUsuario(e) { return e.origen === "automatico" ? "automatico" : (e.usuario || e.nombre || ""); }
function esDeMes(e) { return e.accion === "cerrar-mes" || e.accion === "reabrir-mes"; }

function textoBuscable(e) {
  return norm([e.etiqueta, e.cambios, e.nombre, e.usuario, e.registroId, e.subId, e.aspecto, e.accion].join(" | "));
}

// Enlace al registro afectado, solo si todavía existe (uno eliminado no tiene a
// dónde llevar). Reutiliza «salud-ir» (modules/salud.js): la misma navegación.
function renderEnlace(e) {
  if (!e.registroId) return "";
  var tipo = "", existe = false;
  if (e.clave === "tx") { tipo = "movimiento"; existe = state.tx.some(function (t) { return t.id === e.registroId; }); }
  else if (e.clave === "pedidos") { tipo = "pedido"; existe = state.pedidos.some(function (p) { return p.id === e.registroId; }); }
  else if (e.clave === "cotizaciones") { tipo = "cotizacion"; existe = state.cotizaciones.some(function (c) { return c.id === e.registroId; }); }
  if (!existe) return "";
  var rotulo = { movimiento: "Movimiento", pedido: "Pedido", cotizacion: "Cotización" }[tipo];
  return '<button class="btn ghost small salud-ir" data-action="salud-ir" data-tipo="' + tipo + '" data-id="' + esc(e.registroId) + '">↗ ' + rotulo + "</button>";
}

function renderCampos(titulo, campos) {
  if (!campos) return "";
  var filas = Object.keys(campos).map(function (k) {
    var v = campos[k];
    return "<li><b>" + esc(k) + ":</b> " + (v === "" || v == null ? "(vacío)" : esc(CAMPOS_PLATA[k] ? fmt(v) : v)) + "</li>";
  }).join("");
  return '<div><div class="bit-detalle-titulo">' + esc(titulo) + "</div><ul>" + filas + "</ul></div>";
}

function renderEntrada(e) {
  var abierto = (state.bitacoraAbierta || {})[e.id];
  var accion = e.accion || "";
  var html = '<div class="bit-item ' + esc(accion) + '">' +
    '<div class="salud-item-head"><span class="badge ' + (ACCION_BADGE[accion] || "") + '">' + esc(ACCION_TEXTO[accion] || accion) + "</span>" +
    "<b>" + esc(e.etiqueta) + "</b>" +
    (e.enMesCerrado ? ' <span class="badge danger" title="Cuando se hizo este cambio, ese mes estaba cerrado">en mes cerrado</span>' : "") +
    "</div>";
  if (e.cambios) html += '<div class="salud-detalle">' + esc(e.cambios) + "</div>";
  html += '<div class="salud-pie"><span class="salud-donde">' + esc(quien(e)) + (e.rol && e.origen !== "automatico" ? " (" + esc(e.rol) + ")" : "") +
    " · " + esc(fechaHora(e.fecha)) + (e.aspecto ? " · " + esc(e.aspecto) : "") + "</span>" +
    '<span class="salud-enlaces">' + renderEnlace(e) +
    ((e.antes || e.despues) ? '<button class="btn ghost small" data-action="bitacora-detalle" data-id="' + esc(e.id) + '">' + (abierto ? "Ocultar" : "Antes y después") + "</button>" : "") +
    "</span></div>";
  if (abierto) html += '<div class="bit-detalle">' + renderCampos("Antes", e.antes) + renderCampos("Después", e.despues) + "</div>";
  return html + "</div>";
}

export function renderBitacora() {
  var ayuda = "Cada vez que alguien crea, edita, elimina o restaura algo de dinero (movimientos, abonos, reembolsos, totales y descuentos de pedidos y cotizaciones, comisiones, cuentas, transferencias, deudas, gastos fijos, nómina) queda aquí con quién, cuándo y cómo estaba antes. " +
    "Lo que la app corrige sola al cargar aparece como «Automático». Es solo para mirar: nada de aquí se edita. " +
    "No impide nada: quien tenga acceso directo a la Google Sheet puede cambiar datos sin dejar rastro, y lo anterior a la primera anotación no tiene historial.";
  var html = '<div class="card"><div class="section-title small">Bitácora de cambios' + renderHelp(ayuda) + "</div>";
  if (!esAdmin()) return html + '<div class="empty">Solo el administrador puede ver la bitácora.</div></div>';

  var lectura = estadoLecturaBitacora();
  if (!lectura.cargada && !lectura.cargando && !lectura.error) cargarBitacora();
  var cola = estadoBitacora();

  if (lectura.cargando && !lectura.cargada) html += '<div class="section-sub">Leyendo la bitácora…</div>';
  if (lectura.error) {
    html += '<div class="descuento-aviso" style="font-size:13px;">No se pudo leer la bitácora de la Sheet: ' + esc(lectura.error) +
      '</div><div class="pedido-actions"><button class="btn ghost small" data-action="bitacora-releer">Intentar de nuevo</button></div>';
  }
  if (cola.pendientes) {
    html += '<div class="descuento-aviso" style="font-size:13px;">' + cola.pendientes + (cola.pendientes === 1 ? " anotación espera" : " anotaciones esperan") +
      " para escribirse en la Sheet" + (cola.error ? " (" + esc(cola.error) + ")" : "") + '. Se reintenta sola. <button class="btn ghost small" data-action="bitacora-reintentar">Reintentar ahora</button></div>';
  }

  var todas = entradasBitacora().sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  if (!todas.length) {
    if (lectura.cargada) html += '<div class="empty">Todavía no hay cambios anotados.</div>';
    return html + "</div>";
  }

  var chip = state.bitacoraChip || "todas";
  var q = norm(state.bitacoraBuscar || "").trim();
  var desde = state.bitacoraDesde || "", hasta = state.bitacoraHasta || "";
  var usuario = state.bitacoraUsuario || "", aspecto = state.bitacoraAspecto || "";
  function pasaChip(e, c) { return c === "todas" || (c === "mes" ? esDeMes(e) : e.accion === c); }
  var base = todas.filter(function (e) {
    if (usuario && claveUsuario(e) !== usuario) return false;
    if (aspecto && e.aspecto !== aspecto) return false;
    var dia = fechaLocal(e.fecha);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    return !q || textoBuscable(e).indexOf(q) >= 0;
  });
  var visibles = base.filter(function (e) { return pasaChip(e, chip); });

  html += '<div class="filters">';
  CHIPS.forEach(function (c) {
    var n = base.filter(function (e) { return pasaChip(e, c[0]); }).length;
    if (c[0] !== "todas" && !n) return;
    html += '<button class="chip' + (chip === c[0] ? " active" : "") + '" data-action="bitacora-chip" data-val="' + c[0] + '">' + c[1] + '<span class="chip-n">' + n + "</span></button>";
  });
  html += "</div>";

  var usuarios = {}, aspectos = {};
  todas.forEach(function (e) { usuarios[claveUsuario(e)] = quien(e); aspectos[e.aspecto] = true; });
  html += '<div class="bit-filtros">' +
    '<div class="field"><label>Desde</label><input type="date" value="' + esc(desde) + '" data-action-change="bitacora-filtro" data-campo="Desde" /></div>' +
    '<div class="field"><label>Hasta</label><input type="date" value="' + esc(hasta) + '" data-action-change="bitacora-filtro" data-campo="Hasta" /></div>' +
    '<div class="field"><label>Quién</label><select data-action-change="bitacora-filtro" data-campo="Usuario"><option value="">Todos</option>' +
    Object.keys(usuarios).filter(Boolean).sort().map(function (k) { return '<option value="' + esc(k) + '"' + (usuario === k ? " selected" : "") + ">" + esc(usuarios[k]) + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label>Qué</label><select data-action-change="bitacora-filtro" data-campo="Aspecto"><option value="">Todo</option>' +
    Object.keys(aspectos).filter(Boolean).sort().map(function (k) { return '<option value="' + esc(k) + '"' + (aspecto === k ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + "</select></div>" +
    "</div>";
  html += '<div style="margin:6px 0 10px;">' + renderBuscador({
    id: "inp-buscar-bitacora", filtro: "bitacoraBuscar", valor: state.bitacoraBuscar, ancho: 360,
    placeholder: "Buscar por registro, persona, concepto…",
    conteo: { visibles: visibles.length, total: todas.length, singular: "cambio", plural: "cambios" }
  }) + "</div>";

  var max = state.bitacoraMax || PAGINA;
  html += visibles.length
    ? visibles.slice(0, max).map(renderEntrada).join("")
    : '<div class="empty">Ningún cambio coincide con esos filtros.</div>';
  if (visibles.length > max) {
    html += '<div class="pedido-actions"><button class="btn ghost small" data-action="bitacora-mas">Mostrar ' + Math.min(PAGINA, visibles.length - max) + " más</button></div>";
  }
  return html + "</div>";
}

export var actions = {
  "bitacora-chip": function (el) {
    state.bitacoraChip = el.getAttribute("data-val") || "todas";
    state.bitacoraMax = PAGINA;
    notify();
  },
  "bitacora-filtro": function (el) {
    state["bitacora" + el.getAttribute("data-campo")] = el.value;
    state.bitacoraMax = PAGINA;
    notify();
  },
  "bitacora-detalle": function (el) {
    var id = el.getAttribute("data-id");
    var abiertas = Object.assign({}, state.bitacoraAbierta || {});
    if (abiertas[id]) delete abiertas[id]; else abiertas[id] = true;
    state.bitacoraAbierta = abiertas;
    notify();
  },
  "bitacora-mas": function () {
    state.bitacoraMax = (state.bitacoraMax || PAGINA) + PAGINA;
    notify();
  },
  "bitacora-releer": function () {
    cargarBitacora(true);
    notify();
  },
  "bitacora-reintentar": function () {
    reintentarBitacora();
  }
};
