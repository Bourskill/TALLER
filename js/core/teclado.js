// Navegación por teclado de toda la app, en un solo lugar.
//
// Por qué acá y no repartido en cada módulo: los atajos son transversales
// (valen igual en Pedidos que en Finanzas) y todos necesitan lo mismo — saber
// si el foco está en un campo de escritura, qué capa está abierta encima, y
// cuál es el orden real de las pestañas del menú. Repartirlo habría
// significado repetir esas tres respuestas en cada archivo.
//
// Este archivo NO conoce el DOM de las pestañas ni el registro de acciones:
// core/dom.js le entrega lo que necesita con initTeclado() (ver el final de
// dom.js). Así no hay import circular — teclado.js solo importa el estado.
//
// Los listeners se registran UNA vez, al cargar el módulo, sobre `document`:
// el contenido de #app se reemplaza entero en cada render, así que cualquier
// listener puesto adentro se perdería.

import { state, notify, persist } from "./store.js";
import { esc } from "./utils.js";

// Puente hacia core/dom.js: { pestanas(), irAPestana(clave), dispatch(accion, el) }.
var api = null;

export function initTeclado(config) {
  api = config;
}

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

// ¿El foco está en algo donde la persona está ESCRIBIENDO? Si sí, las teclas
// sueltas ("/" para buscar, "?" para la ayuda) tienen que llegar al campo, no
// dispararse como atajo. Las casillas y los radios no cuentan: ahí no se
// escribe nada, y su Espacio/Enter nativo sigue funcionando igual.
function escribiendo(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  var tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  var t = (el.type || "text").toLowerCase();
  return t !== "checkbox" && t !== "radio" && t !== "button" && t !== "submit" && t !== "file";
}

// Capas que se cierran con Escape, de la de más arriba a la de más abajo
// (mismo orden que sus z-index). Se resuelven por selector y no por clave de
// estado a propósito: cada overlay ya lleva en su `data-action` la acción que
// lo cierra bien (limpiando su selección, su búsqueda, etc.), así que un
// picker nuevo que siga el mismo patrón queda cubierto sin tocar este archivo.
var CAPAS = [".atajos-overlay", ".imgprev-overlay", ".pdfprev-overlay", ".picker-overlay", ".campanita-overlay"];

function cerrarCapaSuperior() {
  for (var i = 0; i < CAPAS.length; i++) {
    var el = document.querySelector(CAPAS[i]);
    if (!el) continue;
    var accion = el.getAttribute("data-action");
    if (accion && api) api.dispatch(accion, el);
    return true;
  }
  if (state.sidebarMobileOpen) { state.sidebarMobileOpen = false; notify(); return true; }
  return false;
}

// Items del menú lateral alcanzables ahora mismo con las flechas: los de las
// categorías abiertas. En modo colapsado (riel de íconos) no hay categorías
// plegadas, se ven todos. Se decide por clase y no por offsetParent porque
// este mismo código corre en jsdom (test/smoke.mjs), donde no hay layout y
// offsetParent siempre es null.
function itemsMenu() {
  var todos = Array.prototype.slice.call(document.querySelectorAll(".nav .nav-item"));
  if (document.querySelector(".shell.sidebar-collapsed")) return todos;
  return todos.filter(function (it) {
    var grupo = it.closest(".nav-group");
    return grupo && grupo.classList.contains("open");
  });
}

function enfocarPorId(id) {
  var el = id ? document.getElementById(id) : null;
  if (el && typeof el.focus === "function") el.focus();
  return el;
}

// ---------------------------------------------------------------------------
// Panel de ayuda (la lista de atajos)
// ---------------------------------------------------------------------------

// Fuente única: lo que se dibuja en el panel es exactamente lo que el
// manejador de abajo implementa. Si se agrega un atajo, se agrega acá también
// o queda invisible para quien no lo adivine.
var ATAJOS = [
  ["Moverse", [
    ["Tab", "Ir al siguiente elemento (Mayús + Tab, al anterior)"],
    ["Enter", "Estando en un campo: saltar al campo siguiente"],
    ["Esc", "Cerrar lo que esté abierto encima: ventana, panel de avisos, menú"]
  ]],
  ["Secciones", [
    ["Alt + 1 … 9, 0", "Ir directo a esa sección del menú, en el orden en que se ven"],
    ["Alt + ↓ / Alt + ↑", "Sección siguiente / anterior"],
    ["Alt + M", "Poner el foco en el menú lateral"],
    ["↑ ↓", "Dentro del menú: moverse entre secciones"],
    ["← →", "Dentro del menú: cerrar / abrir la categoría"],
    ["Inicio / Fin", "Dentro del menú: primera / última sección"]
  ]],
  ["Lo demás", [
    ["/ o Ctrl + K", "Ir al buscador de la sección (si tiene)"],
    ["Ctrl + S", "Guardar lo que esté sin guardar en pantalla"],
    ["Alt + B", "Colapsar o expandir el menú lateral"],
    ["Alt + T", "Cambiar entre tema claro y oscuro"],
    ["?", "Mostrar u ocultar esta ayuda"]
  ]]
];

export function renderAtajos() {
  if (!state.atajosAbiertos) return "";
  var html = '<div class="atajos-overlay" data-action="cerrar-atajos">' +
    '<div class="atajos-modal" data-action="picker-stop" role="dialog" aria-label="Atajos de teclado">' +
    '<div class="atajos-head">' +
    "<div><b>Atajos de teclado</b>" +
    '<div class="atajos-sub">La app entera se puede usar sin mouse. Este panel se abre y se cierra con <kbd>?</kbd>.</div></div>' +
    '<button class="imgprev-close" id="btn-cerrar-atajos" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="cerrar-atajos" aria-label="Cerrar">✕</button>' +
    "</div>" +
    '<div class="atajos-body">';
  ATAJOS.forEach(function (bloque) {
    html += '<div class="atajos-grupo"><div class="atajos-grupo-titulo">' + esc(bloque[0]) + "</div>";
    bloque[1].forEach(function (fila) {
      html += '<div class="atajos-fila"><kbd class="atajos-teclas">' + esc(fila[0]) + "</kbd>" +
        '<span class="atajos-desc">' + esc(fila[1]) + "</span></div>";
    });
    html += "</div>";
  });
  html += "</div></div></div>";
  return html;
}

// Acciones que core/dom.js suma a su registro (ver actionRegistry allá).
export var atajosActions = {
  "abrir-atajos": function () {
    state.atajosAbiertos = true;
    notify();
    enfocarPorId("btn-cerrar-atajos");
  },
  "cerrar-atajos": function () {
    state.atajosAbiertos = false;
    notify();
  }
};

// ---------------------------------------------------------------------------
// Manejador único de teclas
// ---------------------------------------------------------------------------

// Enter dentro de un campo salta al SIGUIENTE campo visible en vez de no hacer
// nada (o de disparar un submit accidental). Vale también para el botón
// "Ir/Enter" del teclado táctil de un teléfono.
function saltarAlSiguienteCampo(el) {
  var app = document.getElementById("app");
  if (!app || !app.contains(el)) return;
  var campos = Array.prototype.slice.call(
    app.querySelectorAll('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
  ).filter(function (f) { return f.offsetParent !== null; }); // solo los visibles
  var idx = campos.indexOf(el);
  if (idx < 0 || idx >= campos.length - 1) return;
  var next = campos[idx + 1];
  next.focus();
  if (typeof next.select === "function" && next.tagName === "INPUT") next.select();
}

function irAlBuscador() {
  var campo = document.querySelector(".tab-panel [data-live-filter]:not([disabled])");
  if (!campo) return false;
  campo.focus();
  if (typeof campo.select === "function") campo.select();
  return true;
}

// Salta N pestañas hacia adelante/atrás en el orden en que se ven en el menú.
function moverPestana(paso) {
  var claves = api.pestanas();
  if (!claves.length) return;
  var i = claves.indexOf(state.tab);
  if (i === -1) i = 0;
  var destino = claves[(i + paso + claves.length) % claves.length];
  api.irAPestana(destino);
  enfocarPorId("nav-tab-" + destino);
}

// Flechas dentro del menú lateral. Después de cualquier cambio de estado el
// render rehace el DOM entero, así que el foco se vuelve a poner por id (los
// botones del menú lo tienen justamente para esto, ver renderSidebar).
function tecladoEnMenu(e, item) {
  var key = e.key;
  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    var items = itemsMenu();
    var i = items.indexOf(item);
    if (i === -1) return false;
    var destino;
    if (key === "ArrowDown") destino = items[(i + 1) % items.length];
    else if (key === "ArrowUp") destino = items[(i - 1 + items.length) % items.length];
    else if (key === "Home") destino = items[0];
    else destino = items[items.length - 1];
    e.preventDefault();
    if (destino) destino.focus();
    return true;
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (state.ui.sidebarCollapsed) return false; // colapsado: no hay categorías que plegar
    var grupo = item.closest(".nav-group");
    var head = grupo ? grupo.querySelector(".nav-group-head") : null;
    var clave = head ? head.getAttribute("data-group") : null;
    if (!clave) return false;
    var abrir = key === "ArrowRight";
    if (!!state.ui.navGroups[clave] === abrir) return false; // ya estaba así
    e.preventDefault();
    var idItem = item.id;
    state.ui.navGroups[clave] = abrir;
    persist("ui");
    notify();
    // Al cerrar la categoría, el item que tenía el foco deja de ser alcanzable:
    // el foco pasa a la primera sección que sí lo esté, para no quedar en un
    // elemento oculto (desde donde las flechas ya no harían nada).
    if (abrir) {
      enfocarPorId(idItem);
    } else {
      var visibles = itemsMenu();
      if (visibles.length) visibles[0].focus();
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Flechas en el combo de "Unidad" (renderComboUnidad, core/components.js)
// ---------------------------------------------------------------------------
// Es un <input> de texto libre con un panel de sugerencias aparte, no un
// <select> nativo — por eso las flechas del teclado no hacían nada ahí,
// a diferencia del resto de listas desplegables de la app (<select>, que el
// navegador ya maneja solo). Este bloque le da el mismo comportamiento a
// mano, solo para este campo: ↓/↑ abre el panel y mueve el resaltado,
// Enter elige lo resaltado, Escape cierra sin elegir.

function flechaDeComboUnidad(input) {
  var celda = input.closest(".insumo-unidad-cell");
  return celda ? celda.querySelector(".combo-unidad-flecha") : null;
}

function panelDeComboUnidad(input) {
  var celda = input.closest(".insumo-unidad-cell");
  return celda ? celda.querySelector(".combo-unidad-suggestions") : null;
}

function itemsComboUnidad(panel) {
  return Array.prototype.slice.call(panel.querySelectorAll(".combo-item"));
}

function resaltarItemCombo(panel, item) {
  itemsComboUnidad(panel).forEach(function (it) { it.classList.remove("activo"); });
  if (item) {
    item.classList.add("activo");
    if (typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "nearest" });
  }
}

function tecladoEnComboUnidad(e, input) {
  var key = e.key;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter" && key !== "Escape") return false;
  var flecha = flechaDeComboUnidad(input);
  if (!flecha) return false; // no es un campo de unidad
  var panel = panelDeComboUnidad(input);

  if (key === "Escape") {
    if (!panel) return false; // deja que Escape siga su curso normal (sacar el foco)
    e.preventDefault();
    api.dispatch("toggle-combo-unidad", flecha);
    return true;
  }

  if (!panel) {
    if (key === "Enter") return false; // panel cerrado: Enter salta de campo, como siempre
    e.preventDefault();
    // api.dispatch() llama a notify(), que reconstruye TODO el HTML de la
    // pestaña (ver render() en core/dom.js) — `input` y `flecha` quedan
    // apuntando al árbol viejo, ya desconectado de document. Hay que volver a
    // buscar el campo por su id (siempre lo tiene, ver renderComboUnidad) una
    // vez terminado el redibujado, igual que hace tecladoEnMenu con el foco.
    var idCampo = input.id;
    api.dispatch("toggle-combo-unidad", flecha); // abre y redibuja
    var inputFresco = idCampo ? document.getElementById(idCampo) : null;
    panel = inputFresco ? panelDeComboUnidad(inputFresco) : null;
    if (panel) {
      var recienAbiertos = itemsComboUnidad(panel);
      resaltarItemCombo(panel, key === "ArrowUp" ? recienAbiertos[recienAbiertos.length - 1] : recienAbiertos[0]);
    }
    return true;
  }

  var items = itemsComboUnidad(panel);
  if (!items.length) {
    if (key === "Enter") return false;
    e.preventDefault();
    return true;
  }
  var idx = items.indexOf(panel.querySelector(".combo-item.activo"));

  if (key === "ArrowDown") {
    e.preventDefault();
    resaltarItemCombo(panel, items[idx < 0 ? 0 : Math.min(idx + 1, items.length - 1)]);
    return true;
  }
  if (key === "ArrowUp") {
    e.preventDefault();
    resaltarItemCombo(panel, items[idx < 0 ? items.length - 1 : Math.max(idx - 1, 0)]);
    return true;
  }
  // Enter
  if (idx < 0) return false; // nada resaltado: que Enter siga de largo
  e.preventDefault();
  api.dispatch("elegir-unidad", items[idx]);
  return true;
}

document.addEventListener("keydown", function (e) {
  if (!api) return;
  var el = e.target;

  if (el && el.classList && el.classList.contains("insumo-unidad")) {
    if (tecladoEnComboUnidad(e, el)) return;
  }

  // Escape: primero cierra capas; si no hay ninguna, saca el foco del campo —
  // una salida sin mouse de un buscador o de un formulario largo.
  if (e.key === "Escape") {
    if (cerrarCapaSuperior()) { e.preventDefault(); return; }
    if (escribiendo(el) && typeof el.blur === "function") { el.blur(); e.preventDefault(); }
    return;
  }

  // Alt + tecla: atajos globales. Funcionan igual mientras se escribe en un
  // campo — Alt no produce texto, así que no le quitan nada a nadie.
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    var digito = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || "");
    if (digito) {
      var n = Number(digito[1]);
      var pos = n === 0 ? 9 : n - 1; // 1…9 son las nueve primeras; 0 es la décima
      var claves = api.pestanas();
      if (pos < claves.length) {
        e.preventDefault();
        api.irAPestana(claves[pos]);
        enfocarPorId("nav-tab-" + claves[pos]);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); moverPestana(1); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moverPestana(-1); return; }
    var letra = (e.key || "").toLowerCase();
    if (letra === "m") {
      e.preventDefault();
      if (!enfocarPorId("nav-tab-" + state.tab)) {
        var items = itemsMenu();
        if (items.length) items[0].focus();
      }
      return;
    }
    if (letra === "b") {
      e.preventDefault();
      api.dispatch("toggle-sidebar", null);
      enfocarPorId("nav-tab-" + state.tab);
      return;
    }
    if (letra === "t") { e.preventDefault(); api.dispatch("toggle-tema", null); return; }
    return;
  }

  // Ctrl/⌘ + K: ir al buscador de la sección.
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
    if (irAlBuscador()) e.preventDefault();
    return;
  }
  // Ctrl/⌘ + S: guardar lo que esté sin guardar en pantalla. No conoce
  // ninguna pestaña en particular: busca el botón que se haya marcado como la
  // acción de guardado principal (hoy, el dock de la cotización). Cualquier
  // pantalla futura con guardado explícito solo tiene que poner ese atributo.
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    var botonGuardar = document.querySelector("[data-guardar-principal]");
    if (botonGuardar) { e.preventDefault(); botonGuardar.click(); }
    return;
  }
  if (e.ctrlKey || e.metaKey) return;

  // Flechas en el menú lateral (solo cuando el foco ya está adentro).
  if (el && el.classList && el.classList.contains("nav-item") && el.closest(".nav")) {
    if (tecladoEnMenu(e, el)) return;
  }

  if (e.key === "Enter") {
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "SELECT")) return;
    if (el.type === "checkbox" || el.type === "radio" || el.type === "file") return; // su Enter/Espacio nativo ya funciona bien
    // Un campo puede declarar QUE hace su Enter con `data-enter-action`. Es
    // para los campos que son un mini-formulario de una sola linea ("Nueva
    // categoria", "Nueva etapa"): ahi el gesto obvio —y el unico que ofrece
    // el teclado tactil de un telefono— es pulsar Enter, y saltar al
    // siguiente campo en vez de dar de alta la cosa dejaba al usuario
    // escribiendo dentro de un dato real sin darse cuenta.
    var accionEnter = el.getAttribute("data-enter-action");
    if (accionEnter) { e.preventDefault(); api.dispatch(accionEnter, el); return; }
    e.preventDefault();
    saltarAlSiguienteCampo(el);
    return;
  }

  // Teclas sueltas: solo valen si no se está escribiendo en ningún campo.
  if (escribiendo(el)) return;
  if (e.key === "/") { if (irAlBuscador()) e.preventDefault(); return; }
  if (e.key === "?") {
    e.preventDefault();
    atajosActions[state.atajosAbiertos ? "cerrar-atajos" : "abrir-atajos"]();
  }
});
