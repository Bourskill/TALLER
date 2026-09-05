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

import { state, persist, notify, recuperarDelEspejo, descartarRecuperacion, revisarBorradoresSinGuardar, ETIQUETA_CLAVE } from "./store.js";
import { esc } from "./utils.js";
import { calcNotificaciones } from "./calc.js";
import { ICONS } from "./icons.js";
import { getSession, logout, haySesionPorVencer, renovarSesionAhora } from "./auth.js";
import { estadoGuardado, reintentarPendientes } from "./guardado.js";
import { subirImagenReferencia } from "./drive.js";
import { initTeclado, renderAtajos, atajosActions } from "./teclado.js";

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
  ["clientes", "Contactos", clientes],
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
// Orden real de las pestañas tal como se ven en el menú, aplanando las
// categorías. Es lo que usan Alt+1…0 y Alt+↑/↓ (ver core/teclado.js) para que
// "la tercera sección" sea la tercera que se VE, no la tercera de TABS — y
// para que un vendedor solo pueda saltar a las suyas.
function pestanasVisibles() {
  return navGroupsActivo().reduce(function (acc, g) { return acc.concat(g[2]); }, []);
}
var TAB_LABEL = TABS.reduce(function (acc, t) { acc[t[0]] = t[1]; return acc; }, {});

// Pone el tema en el <html> (lo que activa las variables de color.css) y de
// paso el color de la barra del sistema en móvil (<meta name="theme-color">,
// ver index.html) — que un navegador instalado como PWA muestre esa franja
// del color del taller, no de un gris genérico. Estaba duplicado dos veces
// (acá y en render()); un solo sitio evita que se desincronicen.
function aplicarTema() {
  var esClaro = state.ui.tema === "claro";
  document.documentElement.setAttribute("data-theme", esClaro ? "light" : "dark");
  var meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", esClaro ? "#f4f5f8" : "#0e1015");
}

// Timers de debounce por campo de búsqueda en vivo (ver bindEvents). Vive a nivel
// de módulo, no dentro de bindEvents, para que sobreviva entre renders sucesivos.
var liveFilterTimers = {};

// Acciones que no pertenecen a un módulo de pestaña porque son transversales
// (cambiar de pestaña, o vincular un cliente sugerido desde el combobox
// compartido entre Pedidos y Cotizaciones).
// Cambiar de pestaña. Extraído de la acción "tab" porque el teclado
// (Alt+1…0, Alt+↑/↓ — ver core/teclado.js) tiene que hacer exactamente lo
// mismo que un clic en el menú, incluidos los reseteos de filtros de abajo.
function irAPestana(key) {
  if (!key) return;
  state.tab = key;
  state.sidebarMobileOpen = false; // al elegir una pestaña en móvil, cerrar el cajón
  if (state.tab !== "finanzas") { state.filtroTxVista = "activos"; state.txEditando = ""; }
  if (state.tab !== "pedidos") { state.filtroPedidosVista = "activos"; }
  // Nota: `cotizacionesVista` NO se resetea acá — arranca en "nueva" (ver
  // DEFAULT en store.js) para que la primera vez que se entra a
  // Cotizaciones reciba con el formulario, pero después queda como el
  // usuario la haya dejado. Resetearla en cada clic de pestaña rompía ir y
  // volver de Pedidos a seguir editando algo en el historial.
  notify();
}

var coreActions = {
  tab: function (el) {
    irAPestana(el.getAttribute("data-tab"));
  },
  "kpi-nav": function (el) {
    state.tab = el.getAttribute("data-tab");
    state.sidebarMobileOpen = false;
    state.filtroTxVista = "activos";
    state.txEditando = "";
    state.filtroPedidosVista = "activos";
    if (state.tab === "cotizaciones") state.cotizacionesVista = "historial";
    if (state.tab === "pedidos") state.pedidosVista = "historial";
    if (state.tab === "finanzas") state.finanzasVista = "historial";
    var filtroTx = el.getAttribute("data-filtro-tx");
    if (filtroTx) state.filtroTx = filtroTx;
    if (el.getAttribute("data-filtro-saldo")) state.filtroPedidosSoloSaldo = true;
    notify();
  },
  // Botón ✕ de cualquier barra de búsqueda de la app (ver renderBuscador en
  // core/components.js). Vive acá, en las acciones transversales, porque la
  // barra es una sola pieza compartida: si cada pestaña trajera su propia
  // acción de limpiar volveríamos a tener seis variantes de lo mismo.
  "limpiar-buscador": function (el) {
    var clave = el.getAttribute("data-filtro");
    if (!clave) return;
    state[clave] = "";
    notify();
    // El foco vuelve al campo, no se queda en un botón que acaba de
    // desaparecer: quien limpia casi siempre quiere escribir otra cosa.
    var input = document.getElementById(el.getAttribute("data-input"));
    if (input) input.focus();
  },
  "toggle-sidebar": function () {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    persist("ui");
    notify();
  },
  "toggle-tema": function () {
    state.ui.tema = state.ui.tema === "claro" ? "oscuro" : "claro";
    aplicarTema();
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
  // El ícono del taller se SUBE, igual que cualquier otra imagen de la app
  // (referencia de cotización, foto de plantilla, pie de página del PDF): se
  // elige un archivo del dispositivo y se guarda en la misma carpeta
  // compartida de Drive. Antes esto pedía por `prompt` que uno pegara el LINK
  // de una imagen ya alojada en otro lado — quedó de una época en la que no
  // existía la subida a Drive, y era el único punto de la app que seguía
  // funcionando así. Para usar un emoji en vez de una imagen está el campo de
  // Configuración → Marca (ver renderIconoTaller en modules/config.js).
  "edit-logo": function () {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.configLogoSubiendo = true;
      notify();
      try {
        var url = await subirImagenReferencia(file);
        state.config.logoUrl = url;
        state.configLogoSubiendo = false;
        persist("config");
      } catch (e) {
        state.configLogoSubiendo = false;
        window.alert("No se pudo subir el ícono a Drive: " + (e && e.message ? e.message : e));
      }
      notify();
    });
    input.click();
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
  "cerrar-pdf-preview": function () {
    if (state.pdfPreview && state.pdfPreview.url) URL.revokeObjectURL(state.pdfPreview.url);
    state.pdfPreview = null;
    notify();
  },
  // La descarga de verdad queda como un paso aparte y explícito: un <a
  // download> sobre el mismo blob: URL que ya se está mostrando — no hace
  // ninguna llamada a Google ni abre nada nuevo, es puramente local.
  "descargar-pdf-preview": function () {
    var p = state.pdfPreview;
    if (!p) return;
    var a = document.createElement("a");
    a.href = p.url;
    a.download = p.nombreArchivo || "documento.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
  // Ver renderComboUnidad en core/components.js. Un solo panel abierto a la
  // vez en toda la app (clave global, no por módulo): abrir otro cierra el
  // anterior solo, sin necesitar un listener de "clic afuera cierra".
  "toggle-combo-unidad": function (el) {
    var clave = el.getAttribute("data-clave");
    state.comboUnidadAbierto = state.comboUnidadAbierto === clave ? "" : clave;
    notify();
  },
  // Escribe la unidad elegida sobre el <input> ORIGINAL (por su id) y le
  // dispara su evento normal — "input" para un campo enlazado con
  // data-form/data-field (ver handleFormInput), "change" para uno con
  // data-action-change (el patrón genérico 3, más abajo). Se disparan los
  // dos: cada input solo escucha el suyo, así que no hay doble efecto, y
  // este componente no necesita saber cuál usa cada llamador.
  "elegir-unidad": function (el) {
    var targetId = el.getAttribute("data-target"), valor = el.getAttribute("data-valor");
    state.comboUnidadAbierto = "";
    var input = document.getElementById(targetId);
    if (input) {
      input.value = valor;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    notify();
  },
  "logout": function () {
    // Cerrar sesión con cambios sin guardar sería tirarlos a la basura: el
    // espejo local sobrevive, pero la sesión siguiente no sabría de quién es.
    if (estadoGuardado().cantidad) {
      if (!window.confirm("Todavía hay cambios que no se pudieron guardar en la hoja de datos.\n\nSi cierras sesión ahora, quedarán en este navegador esperando a que vuelvas a entrar (se te va a ofrecer recuperarlos).\n\n¿Cerrar sesión igual?")) return;
    } else if (!window.confirm("¿Cerrar sesión?")) return;
    logout();
    window.location.reload();
  },
  "reintentar-guardado": function () {
    // Si TODO lo pendiente es un conflicto (otro dispositivo guardó algo
    // distinto — ver core/store.js: verificarConflicto), reintentar no hace
    // nada: hace falta recargar. Se avisa eso en vez del mensaje genérico de
    // "revisa tu conexión", que acá sería engañoso.
    var antes = estadoGuardado();
    if (antes.cantidad && antes.clavesConflicto.length === antes.cantidad) {
      window.alert("Esto no es un problema de conexión: alguien más guardó cambios distintos en " +
        antes.clavesConflicto.map(function (c) { return ETIQUETA_CLAVE[c] || c; }).join(", ") +
        ".\n\nRecarga la página para verlos y aplicar tu cambio encima.");
      return;
    }
    reintentarPendientes().then(function (quedan) {
      if (!quedan) return;
      window.alert("Todavía no se pudo guardar.\n\nRevisa tu conexión. Si el problema sigue, recarga la página e inicia sesión de nuevo — al volver se te va a ofrecer recuperar lo que quedó pendiente.");
    });
  },
  "recargar-pagina": function () {
    window.location.reload();
  },
  "renovar-sesion": function () {
    renovarSesionAhora().catch(function () {
      window.alert("No se pudo renovar la sesión sola.\n\nGuarda lo que puedas y recarga la página para iniciar sesión de nuevo — no vas a perder tu trabajo: se te va a ofrecer recuperarlo al volver a entrar.");
    });
  },
  "recuperar-espejo": function () {
    recuperarDelEspejo();
  },
  "descartar-recuperacion": function () {
    if (!window.confirm("¿Descartar la copia local de esos cambios?\n\nLa app se queda con lo que está guardado en la hoja de datos. No se puede deshacer.")) return;
    descartarRecuperacion();
  },
  "toggle-notificaciones": function () {
    var abriendo = !state.notificacionesAbiertas;
    state.notificacionesAbiertas = abriendo;
    if (abriendo) {
      var session = getSession();
      marcarAvisosComoVistos(calcNotificaciones(!session || session.rol !== "vendedor"));
    }
    notify();
  },
  "cerrar-notificaciones": function () {
    state.notificacionesAbiertas = false;
    notify();
  },
  // Cada aviso lleva a donde se resuelve. Las entregas, además, hacen scroll
  // hasta la tarjeta del pedido y la hacen destellar — mismo patrón que
  // "↗ Origen" en Finanzas.
  "ir-a-notificacion": function (el) {
    var tab = el.getAttribute("data-tab");
    var pedidoId = el.getAttribute("data-pedido");
    state.tab = tab;
    state.notificacionesAbiertas = false;
    state.sidebarMobileOpen = false;
    if (tab === "pedidos") { state.pedidosVista = "historial"; state.filtroPedidosVista = "activos"; }
    notify();
    if (!pedidoId) return;
    setTimeout(function () {
      var card = document.querySelector('[data-pedido-id="' + pedidoId + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("destello");
    }, 60);
  }
};

var actionRegistry = Object.assign(
  {},
  coreActions, atajosActions,
  resumen.actions, finanzas.actions, pedidos.actions, cotizaciones.actions,
  catalogo.actions, productos.actions, plantillas.actions,
  clientes.actions, pendientes.actions, notas.actions, config.actions,
  misVentas.actions
);

// form -> clave en `state` que guarda su borrador.
var FORM_STATE_KEY = { tx: "formTx", pend: "formPend", cliente: "formCliente", emp: "formEmp", gastoFijo: "formGastoFijo", deuda: "formDeuda", pedido: "formPedido", cotizacion: "formCotizacion", reporte: "formReporte", producto: "formProducto", nominaPago: "formNominaPago", reembolso: "formReembolso", abono: "formAbono" };

// ---------------------------------------------------------------------------
// Restaurar el foco tras un render sin id propio en el campo
// ---------------------------------------------------------------------------
// EL PROBLEMA QUE RESUELVE: render() reconstruye TODO el HTML de la pestaña
// activa en cada cambio (ver más abajo: app.innerHTML = html) — no hay una
// sola pieza del DOM que sobreviva intacta. Para que esto no se sintiera como
// recargar la página en cada clic, ya existía una restauración de foco POR
// ID: se anota qué elemento tenía el foco antes de redibujar, y se le vuelve
// a poner después. Pero eso solo funciona si el campo tiene un `id` — y la
// enorme mayoría de los campos de la app (un "mini-input" de una línea de
// pedido, una casilla, un <select> de tipo de costo...) NO lo tienen: se
// identifican por sus atributos data-* (data-campo, data-linea, data-ins...),
// no por id.
//
// Por qué esto se sentía justo al usar Tab (reportado por el usuario): un
// campo con `data-action-change` dispara su acción en el evento "change" —
// que el navegador lanza AL SALIR del campo, incluida la salida por Tab,
// ANTES de terminar de mover el foco al siguiente campo. Si ese campo no
// tenía id, la reconstrucción de HTML que la propia acción dispara (vía
// notify()) no tenía a dónde devolver el foco: quedaba en document.body. Sin
// ninguna posición “actual” en el orden de tabulación, el SIGUIENTE Tab
// arrancaba desde el principio del documento — aterrizando en el enlace
// "Saltar al contenido" (el primer elemento tabulable de toda la página) en
// vez de seguir avanzando con naturalidad. Se sentía como que Tab
// "deseleccionaba" el campo y no hacía nada, cuando en realidad sí hacía
// algo: perdía el hilo por completo.
//
// LA SOLUCIÓN: si el campo con foco no tiene id, se arma un selector CSS con
// sus atributos data-* (los mismos que ya usan las acciones para saber sobre
// qué fila/línea/insumo operar) — alcanza para volver a encontrar EXACTAMENTE
// ese campo entre sus hermanos después de reconstruir el HTML, sin necesitar
// ponerle un id a cada uno de los cientos de campos de la app.
var ATRIBUTOS_IDENTIDAD_FOCO = [
  "data-campo", "data-field", "data-form", "data-action-change", "data-role",
  "data-linea", "data-id", "data-cot", "data-ref", "data-ins", "data-idx",
  "data-insumo", "data-pedido", "data-venta", "data-resource"
];
function selectorEstableParaFoco(el) {
  if (!el || el.nodeType !== 1 || el === document.body || !el.tagName) return null;
  var partes = [el.tagName.toLowerCase()];
  ATRIBUTOS_IDENTIDAD_FOCO.forEach(function (attr) {
    var v = el.getAttribute(attr);
    if (v != null) partes.push("[" + attr + '="' + v.replace(/["\\]/g, "\\$&") + '"]');
  });
  // Sin ningún atributo identificador no hay forma confiable de volver a
  // encontrarlo entre varios hermanos iguales (ej. dos <select> sueltos sin
  // marcar) — se deja pasar en vez de arriesgar enfocar el elemento
  // equivocado, que sería peor que no restaurar nada.
  return partes.length > 1 ? partes.join("") : null;
}
// Vuelve a poner el foco (y la posición del cursor, si aplica) en `el`,
// compartido por las tres vías de restauración (por Tab pendiente, por id y
// por selector) de render() más abajo.
function reponerFoco(el, selStart) {
  if (!el) return;
  el.focus();
  if (selStart != null && typeof el.setSelectionRange === "function") {
    try { el.setSelectionRange(selStart, selStart); } catch (e) { /* elementos sin selección de texto (ej. checkbox) */ }
  }
}

// ---------------------------------------------------------------------------
// Tab que de verdad avanza al siguiente campo (no solo "no pierde el foco")
// ---------------------------------------------------------------------------
// La solución de arriba (selectorEstableParaFoco) evita que el foco quede
// perdido en document.body, pero por sí sola solo logra que, tras el render
// que el propio "change" dispara, el foco vuelva a caer en EL MISMO campo
// que se acaba de dejar — Tab dejaba de romperse, pero tampoco avanzaba: el
// usuario reportó que seguía sin sentirse natural. Falta la otra mitad:
// saber A DÓNDE iba Tab ANTES de que el campo se destruya, para reponer el
// foco AHÍ y no en el campo de origen.
//
// Se calcula en la fase de CAPTURA de "keydown" — antes que cualquier otro
// manejador, incluido el "change" nativo que Tab dispara al salir del campo
// (que es lo que a su vez llama a notify()/render()) — recorriendo los
// mismos campos que ya usa Enter (ver saltarAlSiguienteCampo en
// core/teclado.js) más botones y enlaces, en orden del documento (que es,
// para esta app, el mismo orden que usa el Tab nativo: nada acá define un
// tabindex positivo que lo reordene). Se guarda solo su identidad (id, o el
// mismo selector por atributos data-* de arriba) — el propio elemento se
// habrá destruido para cuando haga falta usarlo.
//
// Se limpia solo (setTimeout 0) si nadie lo consume: la enorme mayoría de
// los campos NO disparan ningún render al perder el foco (data-form normal,
// sin notify() en cada tecla), así que esto tiene que evaporarse antes de
// que un render de verdad, pero completamente ajeno a este Tab (ej. el chip
// de guardado actualizándose 15s después), lo encuentre todavía puesto y
// mande el foco a un campo que el usuario ya ni recuerda haber rozado.
var CAMPOS_TABULABLES = 'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), ' +
  'select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), ' +
  'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"])';
var pendingTabId = null;
var pendingTabSelector = null;
document.addEventListener("keydown", function (e) {
  if (e.key !== "Tab") return;
  var app = document.getElementById("app");
  var el = e.target;
  if (!app || !el || !app.contains(el)) return;
  var campos = Array.prototype.slice.call(app.querySelectorAll(CAMPOS_TABULABLES))
    .filter(function (f) { return f.offsetParent !== null; });
  var idx = campos.indexOf(el);
  if (idx === -1) return;
  var destino = e.shiftKey ? campos[idx - 1] : campos[idx + 1];
  pendingTabId = destino && destino.id ? destino.id : null;
  pendingTabSelector = destino && !pendingTabId ? selectorEstableParaFoco(destino) : null;
  setTimeout(function () { pendingTabId = null; pendingTabSelector = null; }, 0);
}, true);

var rendering = false;
var pendingRerender = false;
// Última pestaña dibujada, para poder avisarle cuando se sale de ella (ver
// beforeUnmount más abajo).
var tabAnterior = null;

export function render() {
  // Blindaje contra reentradas: si algo dispara notify() DENTRO de este mismo
  // render (ej. un evento sincrónico que mutó el estado a medio camino), no
  // se anida otro render inmediatamente — se encola uno solo para justo
  // después de que termine el actual, sin perder el cambio.
  if (rendering) { pendingRerender = true; return; }
  rendering = true;

  // Se revisa en CADA render (no en cada acción de edición suelta) si hay una
  // cotización en modo "guardado explícito" o un pedido rápido a medio
  // llenar — es lo que hace que cerrar la pestaña con eso a medias avise y,
  // si aun así se pierde, se pueda recuperar al volver a abrir (ver
  // revisarBorradoresSinGuardar en core/store.js).
  revisarBorradoresSinGuardar();

  aplicarTema();
  var active = document.activeElement;
  var activeId = active && active.id ? active.id : null;
  // Sin id propio: se guarda un selector armado con sus atributos data-*
  // (ver selectorEstableParaFoco arriba) para poder restaurarle el foco
  // igual — es el caso de la enorme mayoría de los campos de la app.
  var activeSelector = !activeId ? selectorEstableParaFoco(active) : null;
  var selStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
  // El explorador de insumos (ver renderInsumoPicker en modules/cotizaciones.js)
  // se re-renderiza ENTERO con cada marca/desmarca (checkbox de selección) —
  // sin esto, su scroll volvía al principio con cada clic, y bajar hasta el
  // insumo #40 para marcarlo lo devolvía al insumo #1. Mismo patrón que el
  // foco/cursor de arriba: se guarda antes de tocar el DOM, se repone después.
  var listaPicker = document.querySelector(".picker-list");
  var scrollPicker = listaPicker ? listaPicker.scrollTop : null;

  try {
    var app = document.getElementById("app");
    var mod = TAB_MODULES[state.tab];
    var tabHtml = mod && mod.render ? mod.render() : "";

    var mainInner = "";
    if (state.lastError) {
      mainInner += '<div class="error-box">Ocurrió un error inesperado y se muestra aquí para poder corregirlo:\n' + esc(state.lastError) + "</div>";
    }
    mainInner += renderTopbar();
    mainInner += renderAvisoRecuperacion();
    mainInner += renderAvisoSinGuardar();
    mainInner += '<div class="tab-panel">' + tabHtml + "</div>";

    var html = "" +
      // Primer elemento tabulable de la app: con el menú lateral navegándose
      // por flechas (roving tabindex, ver renderSidebar), este enlace es la
      // forma de saltarse el menú y la topbar de un solo Tab. Solo se ve
      // cuando tiene el foco.
      '<a class="skip-link" href="#contenido">Saltar al contenido</a>' +
      '<div class="shell' + (state.ui.sidebarCollapsed ? " sidebar-collapsed" : "") + (state.sidebarMobileOpen ? " sidebar-mobile-open" : "") + '">' +
      renderSidebar() +
      '<div class="sidebar-overlay" data-action="toggle-sidebar-mobile"></div>' +
      '<main class="main"><div class="main-inner" id="contenido" tabindex="-1">' + mainInner + "</div></main>" +
      "</div>" +
      renderImagenPreview() +
      renderPdfPreview() +
      renderAtajos() +
      renderToast();

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

    // Simétrico a afterRender, y ANTES de tocar el DOM: si la pestaña CAMBIÓ,
    // se avisa a la que se deja atrás para que suelte lo que haya creado a
    // mano (hoy: Resumen destruye sus gráficas de Chart.js, que si no quedaban
    // vivas apuntando a un <canvas> ya desechado con sus listeners de resize
    // colgando). Opcional: la mayoría de los módulos no lo necesitan.
    //
    // POR QUÉ ACÁ Y NO DESPUÉS: corría después del afterRender de la pestaña
    // NUEVA, así que la de salida limpiaba cuando la de entrada ya se había
    // montado. Con Chart.js todavía funcionaba de casualidad; en cuanto dos
    // pestañas tocaran el mismo recurso global, la que se va le borraría la
    // configuración a la que acaba de llegar.
    if (tabAnterior && tabAnterior !== state.tab) {
      var modAnterior = TAB_MODULES[tabAnterior];
      if (modAnterior && modAnterior.beforeUnmount) {
        try { modAnterior.beforeUnmount(); } catch (e) { console.error(e); }
      }
    }
    tabAnterior = state.tab;

    app.innerHTML = html;
    bindEvents();
    // Punto de extensión para módulos que necesitan JS imperativo después de
    // que su HTML ya quedó en el DOM (ej. Resumen instanciando gráficas de
    // Chart.js sobre un <canvas> — no se puede hacer solo con el string de
    // render()). Opcional: la mayoría de los módulos no lo necesitan.
    if (mod && mod.afterRender) mod.afterRender();

    // Si Tab (o Shift+Tab) disparó este mismo render (ver el "keydown" de
    // arriba), el foco va A DONDE IBA — no de vuelta al campo que se acaba
    // de dejar. Tiene que ir ANTES que la restauración normal por
    // id/selector: esa restauraría el campo de origen, que es justo el salto
    // que Tab quería dejar atrás.
    var destinoTab = pendingTabId ? document.getElementById(pendingTabId)
      : (pendingTabSelector ? (function () { try { return app.querySelector(pendingTabSelector); } catch (e) { return null; } })() : null);
    if (destinoTab) {
      pendingTabId = null; pendingTabSelector = null;
      reponerFoco(destinoTab, null); // campo nuevo: no hay cursor previo que seguir
    } else if (activeId) {
      reponerFoco(document.getElementById(activeId), selStart);
    } else if (activeSelector) {
      var elRestaurado;
      try { elRestaurado = app.querySelector(activeSelector); } catch (e) { elRestaurado = null; }
      reponerFoco(elRestaurado, selStart);
    }
    if (scrollPicker != null) {
      var listaPicker2 = document.querySelector(".picker-list");
      if (listaPicker2) listaPicker2.scrollTop = scrollPicker;
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
  if (state.configLogoSubiendo) logoInner = '<span style="font-size:11px;">···</span>';
  var logoHtml = puedeEditarMarca
    ? '<button class="sidebar-logo" data-action="edit-logo" title="' + (state.configLogoSubiendo ? "Subiendo a Drive…" : "Subir una imagen para el ícono del taller") + '">' + logoInner + "</button>"
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
    '<nav class="nav" aria-label="Secciones">';

  // Tabindex "rotatorio" (roving tabindex, el patrón estándar de un menú):
  // solo la sección ACTIVA es tabulable, las demás se alcanzan con ↑/↓ desde
  // ella (ver core/teclado.js). Sin esto, entrar al contenido desde el menú
  // costaba pasar por las doce secciones una por una con Tab.
  var visibles = pestanasVisibles();
  var conFoco = visibles.indexOf(state.tab) >= 0 ? state.tab : visibles[0];

  navGroupsActivo().forEach(function (g) {
    var groupKey = g[0], groupLabel = g[1], tabs = g[2];
    var open = !!state.ui.navGroups[groupKey];
    html += '<div class="nav-group' + (open ? " open" : "") + '">';
    // El encabezado de categoría queda fuera del recorrido de Tab a propósito:
    // se pliega/despliega con ←/→ estando en cualquiera de sus secciones, así
    // que tabularlo aparte solo agregaría paradas sin destino.
    html += '<button class="nav-group-head" data-action="toggle-nav-group" data-group="' + groupKey + '" tabindex="-1" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="nav-group-title">' + esc(groupLabel) + "</span>" +
      '<span class="nav-group-chevron">' + chevronIcon() + "</span>" +
      "</button>";
    html += '<div class="nav-group-items">';
    tabs.forEach(function (key) {
      var label = TAB_LABEL[key];
      var active = state.tab === key;
      html += '<button class="nav-item' + (active ? " active" : "") + '" id="nav-tab-' + key + '" data-action="tab" data-tab="' + key + '" title="' + esc(label) + '"' +
        ' tabindex="' + (key === conFoco ? "0" : "-1") + '"' + (active ? ' aria-current="page"' : "") + ">" +
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

function tecladoIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M6.5 12.5h.01M10 12.5h.01M13.5 12.5h.01M17 12.5h.01M8.5 15.5h7"/></svg>';
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
    renderIndicadorConexion() +
    renderAvisoSesionPorVencer() +
    renderIndicadorGuardado() +
    renderCampanita() +
    (session && session.email ? '<div class="topbar-user" title="Sesión iniciada">' + esc(session.email) + "</div>" : "") +
    '<button class="theme-toggle-btn atajos-btn" data-action="abrir-atajos" title="Atajos de teclado (tecla ?)" aria-label="Atajos de teclado">' + tecladoIcon() + "</button>" +
    '<button class="theme-toggle-btn" data-action="toggle-tema" title="' + (esClaro ? "Cambiar a modo oscuro" : "Cambiar a modo claro") + '" aria-label="Cambiar tema">' + (esClaro ? moonIcon() : sunIcon()) + "</button>" +
    '<button class="theme-toggle-btn" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">' + logoutIcon() + "</button>" +
    "</div>";
}

// ---------- conexión ----------
// navigator.onLine NO es 100% confiable para afirmar "sí hay internet" (una
// wifi conectada pero sin salida real igual puede decir true) — pero SÍ es
// confiable para "no hay ninguna red", que es justo lo único que hace falta
// saber acá. Por eso el chip solo aparece cuando dice explícitamente false;
// nunca se afirma "en línea", solo se calla cuando no hay evidencia de lo
// contrario. Si el navegador no expone el API (entornos viejos, jsdom en las
// pruebas) se asume conectado — más vale no molestar de más que mostrar un
// "sin conexión" falso.
function sinConexion() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Aviso PROACTIVO, antes de que nada falle: sin esto, quien se queda sin
// señal a mitad de una tarea solo se enteraba cuando el próximo guardado
// fallaba (el chip de abajo). Deliberadamente en tono neutro/informativo, no
// de alerta — estar sin conexión acá es un estado normal y previsto (ver
// core/guardado.js), no un error.
function renderIndicadorConexion() {
  if (!sinConexion()) return "";
  return '<span class="guardado-chip offline" title="Sin conexión a internet. Podés seguir trabajando: lo que hagas se guarda en este dispositivo y se sube solo en cuanto vuelva la señal.">📶 Sin conexión</span>';
}

// ---------- estado del guardado ----------
// Un punto siempre visible que contesta la única pregunta que importa: "lo que
// acabo de hacer, ¿quedó guardado?". Antes no había forma de saberlo — un
// fallo de red o de sesión solo dejaba rastro en la consola del navegador.
function renderIndicadorGuardado() {
  var g = estadoGuardado();
  if (g.cantidad) {
    return '<button class="guardado-chip malo" data-action="reintentar-guardado" title="' +
      esc(g.ultimoError || "No se pudo guardar en la hoja de datos.") + ' — clic para reintentar ahora">' +
      "● Sin guardar (" + g.cantidad + ")</button>";
  }
  if (g.guardando) return '<span class="guardado-chip guardando">● Guardando…</span>';
  if (!g.ultimoOkEl) return ""; // todavía no se ha guardado nada en esta sesión: no hay nada que afirmar
  return '<span class="guardado-chip ok" title="Todos los cambios están en la hoja de datos">● Guardado</span>';
}

// Barra fija mientras algo no se pueda guardar. El chip de arriba es discreto
// a propósito; esto no: si la plata que se acaba de registrar no está a salvo,
// tiene que estorbar hasta resolverse.
function renderAvisoSinGuardar() {
  var g = estadoGuardado();
  if (!g.cantidad) return "";
  // Un conflicto (otro dispositivo guardó algo distinto mientras tanto — ver
  // verificarConflicto en core/store.js) es un caso aparte: reintentar sin
  // más no arregla nada, porque la causa sigue ahí. La salida es recargar la
  // página, lo que trae lo más reciente y a la vez ofrece "Restaurar" para
  // aplicar este cambio encima (ver renderAvisoRecuperacion) — mismo mensaje
  // que ya usa esa recuperación para este caso exacto.
  if (g.clavesConflicto.length) {
    var etiquetas = g.clavesConflicto.map(function (c) { return ETIQUETA_CLAVE[c] || c; }).join(", ");
    return '<div class="aviso-barra malo">' +
      '<div><b>Alguien más guardó cambios distintos en: ' + esc(etiquetas) + ".</b>" +
      '<div class="aviso-barra-sub">Para no perder ni pisar nada, tu cambio NO se sobrescribió encima. Sigue copiado en este navegador. Recarga la página: vas a ver lo más reciente y se te va a ofrecer aplicar tu cambio encima.</div></div>' +
      '<button class="btn" data-action="recargar-pagina">Recargar ahora</button>' +
      "</div>";
  }
  return '<div class="aviso-barra malo">' +
    '<div><b>No se pudieron guardar ' + g.cantidad + (g.cantidad === 1 ? " cambio" : " cambios") + " en la hoja de datos.</b>" +
    '<div class="aviso-barra-sub">Lo que hiciste NO se perdió: quedó copiado en este navegador y se reintenta solo. ' +
    "Mientras tanto no cierres la pestaña. " + (g.ultimoError ? "(" + esc(g.ultimoError) + ")" : "") + "</div></div>" +
    '<button class="btn" data-action="reintentar-guardado">Reintentar ahora</button>' +
    "</div>";
}

// Aviso corto en la barra superior: la renovación silenciosa del token de
// Google falló varias veces seguidas (típico: cookies de terceros
// bloqueadas) y la sesión está por vencer de verdad. Sin esto, el usuario se
// enteraba recién cuando algo fallaba a mitad de una acción, o cuando la
// pantalla de login aparecía "de la nada" — acá se avisa CON TIEMPO, para
// renovar con un clic sin perder el lugar en el que se estaba trabajando.
function renderAvisoSesionPorVencer() {
  if (!haySesionPorVencer()) return "";
  return '<button class="guardado-chip malo" data-action="renovar-sesion" title="Google no pudo renovar tu sesión solo (pasa con algunos navegadores/configuraciones de privacidad). Clic para renovarla ahora, antes de que se cierre.">⏳ Sesión por vencer</button>';
}

// Al arrancar: la sesión anterior se cerró con cambios que nunca llegaron a la
// hoja, pero el espejo local sí los tiene. Se pregunta en vez de restaurar
// solo, porque el espejo es de ESTE navegador (ver core/guardado.js).
function renderAvisoRecuperacion() {
  var r = state.recuperacion;
  if (!r) return "";
  // "Este navegador tiene una copia" es cierto para el espejo local, pero NO
  // para un borrador que llegó de la nube (ver core/store.js: recuperación
  // desde otro dispositivo/navegador, donde este navegador no tiene nada
  // local) — decirlo igual sería confuso justo en el caso para el que existe
  // esa vía (abriste desde OTRO sitio y acá no hay ningún rastro).
  var hayNube = !!(r.nube && Object.keys(r.nube).length);
  var todoNube = hayNube && r.claves.every(function (c) { return r.nube[c]; });
  var origen = todoNube
    ? "Encontramos, guardada en la nube, una copia sin guardar de: "
    : hayNube
      ? "Este navegador (o la nube, si la edición viene de otro dispositivo) tiene una copia sin guardar de: "
      : "Este navegador tiene una copia de: ";
  return '<div class="aviso-barra recuperar">' +
    "<div><b>Quedaron cambios sin guardar de la última vez que usaste la app.</b>" +
    '<div class="aviso-barra-sub">' + origen + esc(r.etiquetas.join(", ")) + ". " +
    "Si fuiste tú y no los guardaste, restaurálos. Si mientras tanto trabajaste desde otro dispositivo con una versión más nueva, descartálos para no pisar lo de allá.</div></div>" +
    '<span style="display:flex;gap:8px;flex-wrap:wrap;">' +
    '<button class="btn ghost small" data-action="descartar-recuperacion">Descartar</button>' +
    '<button class="btn" data-action="recuperar-espejo">Restaurar</button>' +
    "</span></div>";
}

// ---------- campanita ----------
// Avisos que el usuario todavía NO ha mirado. El punto rojo cuenta estos, no
// el total: si contara el total, seguiría encendido después de abrir el panel
// y leerlo entero — que es exactamente lo que pasaba. El panel sí muestra
// todo, visto o no; lo que se apaga es la alerta, no la información.
function avisosNoVistos(items) {
  var vistos = (state.ui && state.ui.avisosVistos) || [];
  return items.filter(function (i) { return vistos.indexOf(i.id) === -1; });
}

// Al abrir el panel se dan por vistos los avisos que hay EN ESE MOMENTO. Uno
// nuevo que aparezca después vuelve a encender el punto, que es lo que se
// espera de una campanita.
//
// La lista se poda a lo que sigue existiendo: los ids llevan dentro el id del
// registro (nota, propuesta, pedido), así que sin podar crecería para siempre
// con avisos de cosas ya resueltas.
function marcarAvisosComoVistos(items) {
  var idsActuales = items.map(function (i) { return i.id; });
  var vistosPrevios = (state.ui.avisosVistos || []).filter(function (id) { return idsActuales.indexOf(id) !== -1; });
  var nuevos = idsActuales.filter(function (id) { return vistosPrevios.indexOf(id) === -1; });
  if (!nuevos.length && vistosPrevios.length === (state.ui.avisosVistos || []).length) return false;
  state.ui.avisosVistos = vistosPrevios.concat(nuevos);
  persist("ui");
  return true;
}

function renderCampanita() {
  var session = getSession();
  var esAdmin = !session || session.rol !== "vendedor";
  var items = calcNotificaciones(esAdmin);
  var sinVer = avisosNoVistos(items);
  var urgentesSinVer = sinVer.filter(function (i) { return i.urgente; }).length;
  var abierto = !!state.notificacionesAbiertas;

  var html = '<div class="campanita-wrap">' +
    '<button class="theme-toggle-btn campanita-btn' + (abierto ? " activa" : "") + '" data-action="toggle-notificaciones" title="' +
    (sinVer.length ? sinVer.length + " aviso(s) sin ver" : (items.length ? "Avisos del día (ya los viste)" : "Sin avisos por hoy")) +
    '" aria-label="Avisos del día">' +
    campanaIcon() +
    (sinVer.length ? '<span class="campanita-badge' + (urgentesSinVer ? " urgente" : "") + '">' + (sinVer.length > 9 ? "9+" : sinVer.length) + "</span>" : "") +
    "</button>";

  if (abierto) {
    // Capa transparente detrás del panel: cerrar tocando fuera es lo que
    // espera cualquiera de una campanita, y sin ella el panel se quedaba
    // abierto tapando contenido hasta volver a pulsar el ícono.
    html += '<div class="campanita-overlay" data-action="cerrar-notificaciones"></div>';
    html += '<div class="campanita-panel">' +
      '<div class="campanita-head">Avisos del día' +
      (items.length ? '<span class="campanita-head-n">' + items.length + "</span>" : "") + "</div>";
    if (!items.length) {
      html += '<div class="empty" style="padding:22px 14px;">Nada pendiente por hoy. 🎉</div>';
    } else {
      items.forEach(function (it) {
        html += '<button class="campanita-item' + (it.urgente ? " urgente" : "") + '" data-action="ir-a-notificacion" data-tab="' + it.tab + '"' +
          (it.pedidoId ? ' data-pedido="' + it.pedidoId + '"' : "") + ">" +
          '<span class="campanita-item-icono">' + it.icono + "</span>" +
          '<span class="campanita-item-texto"><b>' + esc(it.titulo) + "</b><small>" + esc(it.detalle) + "</small></span>" +
          "</button>";
      });
    }
    html += "</div>";
  }
  html += "</div>";
  return html;
}

function campanaIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
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

// Visor de PDF DENTRO de la app (ver mostrarPdfEnApp en core/pdf.js): en la
// versión instalada como PWA, descargar de una vez con doc.save() se sentía
// como salirse de la app hacia el navegador. Con esto, ver el documento es
// una pantalla más de la app misma — data-action="pdfprev-stop" en el panel
// interior es el mismo truco que ya usa picker-modal (ver core/dom.js más
// abajo y core/teclado.js): cada [data-action] frena su propio clic antes de
// que burbujee, así que clickear DENTRO del panel no cierra el overlay.
function renderPdfPreview() {
  var p = state.pdfPreview;
  if (!p) return "";
  return '<div class="pdfprev-overlay" data-action="cerrar-pdf-preview">' +
    '<div class="pdfprev-panel" data-action="pdfprev-stop">' +
    '<div class="pdfprev-bar">' +
    '<span class="pdfprev-nombre">' + esc(p.nombreArchivo) + "</span>" +
    '<span style="display:flex;gap:8px;">' +
    '<button class="btn small" data-action="descargar-pdf-preview">⬇ Descargar</button>' +
    '<button class="imgprev-close" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="cerrar-pdf-preview" aria-label="Cerrar">✕</button>' +
    "</span></div>" +
    '<iframe class="pdfprev-frame" src="' + esc(p.url) + '" title="' + esc(p.nombreArchivo) + '"></iframe>' +
    "</div></div>";
}

function renderToast() {
  if (!state.toast) return "";
  return '<div class="toast">' + esc(state.toast.msg) + "</div>";
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

  // Patrón genérico 5: arrastrar y soltar para reordenar una lista — hoy,
  // solo los insumos de una referencia de cotización (ver el manijo "⠿" en
  // modules/cotizaciones.js). Se usa SortableJS (window.Sortable, cargado
  // como script clásico en index.html) en vez de mecánica propia con el API
  // nativo de drag-and-drop: trae soporte real por touch de fábrica, y no
  // tiene sentido reinventar algo que una librería madura ya resuelve bien.
  // No encaja en el patrón 4 (data-action/click): Sortable necesita quedarse
  // "escuchando" todo el gesto de arrastre, no solo un clic — por eso se
  // inicializa acá en vez de pasar por dispatch().
  //
  // Se crea una instancia nueva en CADA render (igual que el resto de los
  // patrones de acá arriba): el HTML se regenera entero cada vez, así que la
  // instancia vieja quedó colgada de un nodo que ya no existe y se descarta
  // sola (sin falta de destroy() explícito).
  if (window.Sortable) {
    app.querySelectorAll(".ins-table").forEach(function (tabla) {
      window.Sortable.create(tabla, {
        handle: ".ins-drag-handle",
        draggable: '.ins-row[data-ins-row]', // dejar afuera el encabezado y las filas de globales/servicios
        animation: 150,
        onEnd: function (evt) {
          var fila = evt.item;
          var ids = Array.prototype.slice.call(tabla.querySelectorAll('.ins-row[data-ins-row]'))
            .map(function (el) { return el.getAttribute("data-ins"); });
          cotizaciones.reordenarInsumos(fila.getAttribute("data-cot"), fila.getAttribute("data-ref"), ids);
        }
      });
    });
  }
}

function handleFormInput(el) {
  var form = el.getAttribute("data-form");
  var field = el.getAttribute("data-field");
  var stateKey = FORM_STATE_KEY[form];
  if (!stateKey) return;

  // Caso especial: el campo "cliente" de pedido/cotización limpia el vínculo
  // (clienteId) al escribir y necesita re-render inmediato para refrescar el combobox.
  // El borrador del abono se marca con el pedido al que pertenece: hay un solo
  // state.formAbono pero puede haber varios paneles de pedido abiertos, y sin
  // esto lo tecleado en uno se veía dentro del formulario del otro (ver
  // renderAbonoForm en modules/pedidos.js).
  if (form === "abono") {
    var pedidoDelAbono = el.getAttribute("data-pedido");
    if (pedidoDelAbono) state.formAbono.pedidoId = pedidoDelAbono;
  }

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

// El chip "Sin conexión" (ver renderIndicadorConexion) se lee de
// navigator.onLine en cada render, no de `state` — así que lo único que hace
// falta acá es forzar un render cuando ese valor CAMBIA, para que el chip
// aparezca/desaparezca solo, sin esperar a que el usuario haga algo que
// dispare un render por otra razón.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
}

// Navegación por teclado de toda la app (Enter entre campos, Esc para cerrar,
// Alt+número para saltar de sección, flechas en el menú…): vive en
// core/teclado.js. Acá solo se le entregan las tres cosas que necesita de
// este archivo y que él no puede importar sin crear un ciclo.
initTeclado({
  pestanas: pestanasVisibles,
  irAPestana: irAPestana,
  dispatch: dispatch
});
