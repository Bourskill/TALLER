// Este es el único archivo que conoce a la vez el estado y el DOM.
// Ensambla el layout fijo (sidebar categorizada + topbar + KPIs) + el contenido
// de la pestaña activa, y arma un "registro de acciones" combinando lo que cada
// módulo expone en `actions`.
//
// Para agregar una pestaña nueva en el futuro: crear js/modules/<nombre>.js con
// `export function render(){...}` y opcionalmente `export var actions = {...}`,
// añadirlo a TAB_MODULES aquí abajo, agregarlo a la lista de TABS, sumarlo dentro
// de la categoría correspondiente en NAV_GROUPS_ADMIN (y en NAV_GROUPS_VENDEDOR
// si también debe verla un vendedor), y darle un ícono en core/icons.js.
// Nada más necesita cambiar.

import { state, persist, notify } from "./store.js";
import { esc } from "./utils.js";
import { clienteById } from "./calc.js";
import { ICONS } from "./icons.js";
import { getSession, logout } from "./auth.js";

import * as resumen from "../modules/resumen.js";
import * as finanzas from "../modules/finanzas.js";
import * as pedidos from "../modules/pedidos.js";
import * as cotizaciones from "../modules/cotizaciones.js";
import * as catalogo from "../modules/catalogo.js";
import * as productos from "../modules/productos.js";
import * as plantillas from "../modules/plantillas.js";
import * as clientes from "../modules/clientes.js";
import * as pendientes from "../modules/pendientes.js";
import * as notas from "../modules/notas.js";
import * as config from "../modules/config.js";
import * as misVentas from "../modules/mis-ventas.js";

// Nota de nombres (a propósito, pedido explícito del usuario): la clave
// interna "catalogo" sigue siendo el catálogo de INSUMOS de siempre, pero su
// label visible cambió a "Insumos". La clave interna "productos" es el
// catálogo NUEVO de prendas ya hechas con stock, y su label visible es
// "Catálogo" — las etiquetas quedan cruzadas respecto a las claves internas
// para no tener que tocar nada que dependa de state.tab === "catalogo".
var TABS = [
  ["resumen", "Resumen", resumen],
  ["mis-ventas", "Mis ventas", misVentas],
  ["finanzas", "Finanzas", finanzas],
  ["pedidos", "Pedidos", pedidos],
  ["cotizaciones", "Cotizaciones", cotizaciones],
  ["productos", "Catálogo", productos],
  ["catalogo", "Insumos", catalogo],
  ["plantillas", "Plantillas", plantillas],
  ["clientes", "Clientes", clientes],
  ["pendientes", "Pendientes", pendientes],
  ["notas", "Notas", notas],
  ["config", "Configuración", config]
];
var TAB_MODULES = TABS.reduce(function (acc, t) { acc[t[0]] = t[2]; return acc; }, {});

// Categorías del menú lateral. Cada grupo es [clave, título, [claves de pestaña]].
// La clave del grupo debe existir en DEFAULT_UI.navGroups (constants.js) para
// que se recuerde si el usuario lo dejó abierto o cerrado.
//
// Hay dos variantes: admin ve todo (igual que siempre existió esta app);
// vendedor (ver core/auth.js) ve solo su propia venta — sin Finanzas ni
// Pendientes (caja, gastos fijos, nómina, deudas son datos del taller, no
// suyos) ni Configuración. Si no hay sesión (ej. test/smoke.mjs, que nunca
// llama a auth.login()) se trata como admin: es el comportamiento de
// siempre para quien no pasa por el flujo de login real.
var NAV_GROUPS_ADMIN = [
  ["general", "Panel", ["resumen", "notas"]],
  ["ventas", "Ventas", ["pedidos", "cotizaciones", "productos", "clientes"]],
  ["produccion", "Producción", ["catalogo", "plantillas"]],
  ["gestion", "Gestión", ["finanzas", "pendientes"]],
  ["sistema", "Sistema", ["config"]]
];
var NAV_GROUPS_VENDEDOR = [
  ["general", "Panel", ["mis-ventas"]],
  ["ventas", "Ventas", ["pedidos", "cotizaciones", "productos", "clientes"]],
  ["produccion", "Producción", ["catalogo", "plantillas"]]
];
function navGroupsActivo() {
  var session = getSession();
  return (session && session.rol === "vendedor") ? NAV_GROUPS_VENDEDOR : NAV_GROUPS_ADMIN;
}
var TAB_LABEL = TABS.reduce(function (acc, t) { acc[t[0]] = t[1]; return acc; }, {});

// Timers de debounce por campo de búsqueda en vivo (ver bindEvents). Vive a nivel
// de módulo, no dentro de bindEvents, para que sobreviva entre renders sucesivos.
var liveFilterTimers = {};

// Acciones que no pertenecen a un módulo de pestaña porque son transversales
// (cambiar de pestaña, o vincular un cliente sugerido desde el combobox
// compartido entre Pedidos y Cotizaciones).
var coreActions = {
  tab: function (el) {
    state.tab = el.getAttribute("data-tab");
    state.sidebarMobileOpen = false; // al elegir una pestaña en móvil, cerrar el cajón
    if (state.tab !== "finanzas") { state.filtroTxVista = "activos"; state.txEditando = ""; }
    if (state.tab !== "pedidos") { state.filtroPedidosVista = "activos"; }
    // Nota: `cotizacionesVista` NO se resetea acá — arranca en "nueva" (ver
    // DEFAULT en store.js) para que la primera vez que se entra a
    // Cotizaciones reciba con el formulario, pero después queda como el
    // usuario la haya dejado. Resetearla en cada clic de pestaña rompía ir y
    // volver de Pedidos a seguir editando algo en el historial.
    notify();
  },
  "kpi-nav": function (el) {
    state.tab = el.getAttribute("data-tab");
    state.sidebarMobileOpen = false;
    state.filtroTxVista = "activos";
    state.txEditando = "";
    state.filtroPedidosVista = "activos";
    if (state.tab === "cotizaciones") state.cotizacionesVista = "historial";
    if (state.tab === "pedidos") state.pedidosVista = "historial";
    var filtroTx = el.getAttribute("data-filtro-tx");
    if (filtroTx) state.filtroTx = filtroTx;
    if (el.getAttribute("data-filtro-saldo")) state.filtroPedidosSoloSaldo = true;
    notify();
  },
  "toggle-sidebar": function () {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    persist("ui");
    notify();
  },
  "toggle-tema": function () {
    state.ui.tema = state.ui.tema === "claro" ? "oscuro" : "claro";
    document.documentElement.setAttribute("data-theme", state.ui.tema === "claro" ? "light" : "dark");
    persist("ui");
    notify();
  },
  "toggle-sidebar-mobile": function () {
    state.sidebarMobileOpen = !state.sidebarMobileOpen;
    notify();
  },
  "toggle-nav-group": function (el) {
    var g = el.getAttribute("data-group");
    if (state.ui.sidebarCollapsed) return; // colapsado: no hay categorías que plegar
    state.ui.navGroups[g] = !state.ui.navGroups[g];
    persist("ui");
    notify();
  },
  "select-cliente": function (el) {
    var form = el.getAttribute("data-form");
    var c = clienteById(el.getAttribute("data-id"));
    if (c) {
      var target = form === "pedido" ? state.formPedido : state.formCotizacion;
      target.clienteId = c.id;
      target.cliente = c.nombre;
    }
    notify();
  },
  "edit-logo": function () {
    var actual = state.config.logoUrl || "";
    var nuevo = window.prompt("Ícono del taller: pega un emoji corto (ej. 🧵) o el link a una imagen.\nDéjalo vacío para volver a las iniciales.", actual);
    if (nuevo === null) return;
    state.config.logoUrl = nuevo.trim();
    persist("config");
    notify();
  },
  // Cualquier foto de la app (referencia, plantilla de prenda, pie de página
  // del PDF) se puede abrir en grande con esto — ver el overlay al final de
  // render(). No depende de qué pestaña esté activa.
  "abrir-imagen-preview": function (el) {
    var url = el.getAttribute("data-url");
    if (!url) return;
    state.imagenPreview = url;
    notify();
  },
  "cerrar-imagen-preview": function () {
    state.imagenPreview = "";
    notify();
  },
  "logout": function () {
    if (!window.confirm("¿Cerrar sesión?")) return;
    logout();
    window.location.reload();
  }
};

var actionRegistry = Object.assign(
  {},
  coreActions,
  resumen.actions, finanzas.actions, pedidos.actions, cotizaciones.actions,
  catalogo.actions, productos.actions, plantillas.actions,
  clientes.actions, pendientes.actions, notas.actions, config.actions,
  misVentas.actions
);

// form -> clave en `state` que guarda su borrador.
var FORM_STATE_KEY = { tx: "formTx", pend: "formPend", cliente: "formCliente", emp: "formEmp", gastoFijo: "formGastoFijo", deuda: "formDeuda", pedido: "formPedido", cotizacion: "formCotizacion", reporte: "formReporte", producto: "formProducto" };

var rendering = false;
var pendingRerender = false;

export function render() {
  // Blindaje contra reentradas: si algo dispara notify() DENTRO de este mismo
  // render (ej. un evento sincrónico que mutó el estado a medio camino), no
  // se anida otro render inmediatamente — se encola uno solo para justo
  // después de que termine el actual, sin perder el cambio.
  if (rendering) { pendingRerender = true; return; }
  rendering = true;

  document.documentElement.setAttribute("data-theme", state.ui.tema === "claro" ? "light" : "dark");
  var active = document.activeElement;
  var activeId = active && active.id ? active.id : null;
  var selStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;

  try {
    var app = document.getElementById("app");
    var mod = TAB_MODULES[state.tab];
    var tabHtml = mod && mod.render ? mod.render() : "";

    var mainInner = "";
    if (state.lastError) {
      mainInner += '<div class="error-box">Ocurrió un error inesperado y se muestra aquí para poder corregirlo:\n' + esc(state.lastError) + "</div>";
    }
    mainInner += renderTopbar();
    mainInner += '<div class="tab-panel">' + tabHtml + "</div>";

    var html = "" +
      '<div class="shell' + (state.ui.sidebarCollapsed ? " sidebar-collapsed" : "") + (state.sidebarMobileOpen ? " sidebar-mobile-open" : "") + '">' +
      renderSidebar() +
      '<div class="sidebar-overlay" data-action="toggle-sidebar-mobile"></div>' +
      '<main class="main"><div class="main-inner">' + mainInner + "</div></main>" +
      "</div>" +
      renderImagenPreview();

    // Blindaje contra un quirk de Chrome: si el elemento con foco (ej. un
    // <select> cuyo desplegable nativo seguía abierto) sigue activo justo
    // cuando se reemplaza innerHTML, el navegador puede lanzar internamente
    // un blur A MITAD del reemplazo y tirar "Failed to set the 'innerHTML'
    // property... the node to be removed is no longer a child of this node".
    // Sacarle el foco a mano ANTES de tocar innerHTML evita esa carrera — si
    // el elemento tenía id, el foco se restaura de todos modos más abajo.
    if (active && typeof active.blur === "function" && app && app.contains(active)) {
      active.blur();
    }

    app.innerHTML = html;
    bindEvents();

    if (activeId) {
      var el2 = document.getElementById(activeId);
      if (el2) {
        el2.focus();
        if (selStart != null && el2.setSelectionRange) { try { el2.setSelectionRange(selStart, selStart); } catch (e) {} }
      }
    }
  } catch (e) {
    console.error(e);
    state.lastError = e && e.message ? e.message : String(e);
    var app2 = document.getElementById("app");
    if (app2) app2.innerHTML = '<div class="error-box">Ocurrió un error y el panel no pudo dibujarse:\n' + esc(state.lastError) + "</div>";
  } finally {
    rendering = false;
    if (pendingRerender) { pendingRerender = false; render(); }
  }
}

function renderSidebar() {
  var collapsed = state.ui.sidebarCollapsed;
  var initials = (state.config.nombre || "MT").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
  var logo = (state.config.logoUrl || "").trim();
  var isImg = /^(https?:|data:)/.test(logo);
  var logoInner = isImg ? '<img src="' + esc(logo) + '" alt="" />' : esc(logo || initials || "MT");

  // El ícono y el nombre del taller son de marca del negocio — un vendedor
  // no debe poder cambiarlos aunque los vea. Sin sesión (ej. smoke test) se
  // trata como admin, igual que el resto del filtrado por rol de este archivo.
  var session = getSession();
  var puedeEditarMarca = !session || session.rol !== "vendedor";
  var logoHtml = puedeEditarMarca
    ? '<button class="sidebar-logo" data-action="edit-logo" title="Cambiar ícono del taller">' + logoInner + "</button>"
    : '<div class="sidebar-logo" style="cursor:default;" title="' + esc(state.config.nombre) + '">' + logoInner + "</div>";
  var nombreHtml = puedeEditarMarca
    ? '<input class="sidebar-brand" id="inp-nombre" value="' + esc(state.config.nombre) + '" />'
    : '<div class="sidebar-brand" style="cursor:default;">' + esc(state.config.nombre) + "</div>";

  var html = '<aside class="sidebar">' +
    '<div class="sidebar-inner">' +
    '<div class="sidebar-head">' +
    logoHtml +
    '<div class="sidebar-brandwrap">' +
    nombreHtml +
    '<div class="sidebar-brand-sub">Panel de gestión</div>' +
    "</div>" +
    '<button class="sidebar-collapse-btn" data-action="toggle-sidebar" title="' + (collapsed ? "Expandir menú" : "Colapsar menú") + '" aria-label="' + (collapsed ? "Expandir menú" : "Colapsar menú") + '">' + collapseIcon() + "</button>" +
    "</div>" +
    '<nav class="nav">';

  navGroupsActivo().forEach(function (g) {
    var groupKey = g[0], groupLabel = g[1], tabs = g[2];
    var open = !!state.ui.navGroups[groupKey];
    html += '<div class="nav-group' + (open ? " open" : "") + '">';
    html += '<button class="nav-group-head" data-action="toggle-nav-group" data-group="' + groupKey + '">' +
      '<span class="nav-group-title">' + esc(groupLabel) + "</span>" +
      '<span class="nav-group-chevron">' + chevronIcon() + "</span>" +
      "</button>";
    html += '<div class="nav-group-items">';
    tabs.forEach(function (key) {
      var label = TAB_LABEL[key];
      var active = state.tab === key;
      html += '<button class="nav-item' + (active ? " active" : "") + '" data-action="tab" data-tab="' + key + '" title="' + esc(label) + '">' +
        '<span class="nav-icon">' + (ICONS[key] || "") + "</span>" +
        '<span class="nav-label">' + esc(label) + "</span>" +
        "</button>";
    });
    html += "</div></div>";
  });

  html += "</nav></div></aside>";
  return html;
}

function collapseIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
}
function chevronIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
}
function menuIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/></svg>';
}

function sunIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>';
}
function moonIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/></svg>';
}

function logoutIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>';
}

function renderTopbar() {
  var fecha = new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  var titulo = TAB_LABEL[state.tab] || "";
  var esClaro = state.ui.tema === "claro";
  var session = getSession();
  return "" +
    '<div class="topbar">' +
    '<button class="sidebar-mobile-toggle" data-action="toggle-sidebar-mobile" aria-label="Abrir menú">' + menuIcon() + "</button>" +
    '<div class="topbar-title">' + esc(titulo) + "</div>" +
    '<div class="topbar-date">' + esc(fecha) + "</div>" +
    (session && session.email ? '<div class="topbar-user" title="Sesión iniciada">' + esc(session.email) + "</div>" : "") +
    '<button class="theme-toggle-btn" data-action="toggle-tema" title="' + (esClaro ? "Cambiar a modo oscuro" : "Cambiar a modo claro") + '" aria-label="Cambiar tema">' + (esClaro ? moonIcon() : sunIcon()) + "</button>" +
    '<button class="theme-toggle-btn" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">' + logoutIcon() + "</button>" +
    "</div>";
}

// Overlay a pantalla completa para ver en grande cualquier foto de la app
// (referencia de cotización, plantilla de prenda, pie de página del PDF).
// Vive fuera de ".shell" para no depender de qué pestaña esté activa.
function renderImagenPreview() {
  if (!state.imagenPreview) return "";
  return '<div class="imgprev-overlay" data-action="cerrar-imagen-preview">' +
    '<button class="imgprev-close" data-action="cerrar-imagen-preview" aria-label="Cerrar">✕</button>' +
    '<img class="imgprev-img" src="' + esc(state.imagenPreview) + '" alt="" />' +
    "</div>";
}

function bindEvents() {
  var app = document.getElementById("app");

  // El nombre del taller vive en el header (fuera de cualquier módulo de pestaña).
  var nombreInput = document.getElementById("inp-nombre");
  if (nombreInput) {
    nombreInput.addEventListener("change", function () {
      state.config.nombre = nombreInput.value || "Mi Taller";
      persist("config");
    });
  }

  // Patrón genérico 1: data-form + data-field -> escribe en state.form<X>.
  app.querySelectorAll("[data-form]").forEach(function (el) {
    el.addEventListener("input", function () { handleFormInput(el); });
  });

  // Patrón genérico 2: data-live-filter -> escribe directo en state[key] y re-renderiza
  // poco después de que el usuario deja de escribir (no en cada tecla: con listas
  // grandes, redibujar toda la app en cada carácter se siente lento y es trabajo
  // de sobra si el usuario sigue escribiendo).
  app.querySelectorAll("[data-live-filter]").forEach(function (el) {
    el.addEventListener("input", function () {
      var key = el.getAttribute("data-live-filter");
      state[key] = el.value;
      clearTimeout(liveFilterTimers[key]);
      liveFilterTimers[key] = setTimeout(notify, 150);
    });
  });

  // Patrón genérico 3: data-action-change -> dispara una acción del registro en "change".
  app.querySelectorAll("[data-action-change]").forEach(function (el) {
    el.addEventListener("change", function () {
      dispatch(el.getAttribute("data-action-change"), el);
    });
  });

  // Patrón genérico 4: data-action -> dispara una acción del registro en "click".
  // stopPropagation() es necesario porque hay data-action anidados a propósito
  // (ej. el botón "quitar imagen" o "ver en grande" dentro de un thumb que a su
  // vez tiene su propio data-action para "subir otra imagen") — sin esto, un
  // clic en el botón interior burbujea hasta el contenedor y dispara las DOS
  // acciones a la vez.
  app.querySelectorAll("[data-action]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      dispatch(el.getAttribute("data-action"), el);
    });
  });
}

function handleFormInput(el) {
  var form = el.getAttribute("data-form");
  var field = el.getAttribute("data-field");
  var stateKey = FORM_STATE_KEY[form];
  if (!stateKey) return;

  // Caso especial: el campo "cliente" de pedido/cotización limpia el vínculo
  // (clienteId) al escribir y necesita re-render inmediato para refrescar el combobox.
  if ((form === "pedido" || form === "cotizacion") && field === "cliente") {
    state[stateKey].cliente = el.value;
    state[stateKey].clienteId = "";
    notify();
    return;
  }
  state[stateKey][field] = el.value;
}

function dispatch(action, el) {
  var handler = actionRegistry[action];
  if (handler) handler(el);
}

// Cualquier notify() de cualquier módulo termina aquí, sin que ese módulo
// necesite importar este archivo.
document.addEventListener("app:render", render);

// Navegación por teclado (y por "Enter/Ir" del teclado táctil) en TODA la
// app: al presionar Enter en un campo, salta al siguiente campo visible en
// vez de no hacer nada (o de disparar un submit accidental). Se registra
// UNA sola vez sobre `document` (no dentro de bindEvents, que se ejecuta en
// cada render) porque el contenedor #app persiste entre renders aunque su
// contenido interno se reemplace por completo.
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;
  var el = e.target;
  if (!el || (el.tagName !== "INPUT" && el.tagName !== "SELECT")) return;
  if (el.type === "checkbox" || el.type === "radio" || el.type === "file") return; // su Enter/Espacio nativo ya funciona bien
  var app = document.getElementById("app");
  if (!app || !app.contains(el)) return;
  e.preventDefault();
  var focusables = Array.prototype.slice.call(
    app.querySelectorAll('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
  ).filter(function (f) { return f.offsetParent !== null; }); // solo los visibles
  var idx = focusables.indexOf(el);
  if (idx >= 0 && idx < focusables.length - 1) {
    var next = focusables[idx + 1];
    next.focus();
    if (typeof next.select === "function" && next.tagName === "INPUT") next.select();
  }
});
