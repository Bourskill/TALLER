import { JSDOM } from "jsdom";

// Los 4 <link> del <head> (ver index.html) se replican acá con sus mismos
// ids e hrefs de fábrica porque core/appIcon.js los busca por id — sin ellos
// esa función no tiene nada que tocar (no rompe: setHref no hace nada si el
// elemento no existe) y su comportamiento quedaría totalmente sin probar.
const dom = new JSDOM(
  "<!DOCTYPE html><head>" +
  '<link rel="icon" sizes="32x32" href="icons/favicon-32.png" id="link-favicon-32">' +
  '<link rel="icon" sizes="16x16" href="icons/favicon-16.png" id="link-favicon-16">' +
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" id="link-apple-touch-icon">' +
  '<link rel="manifest" href="manifest.json" id="link-manifest">' +
  '</head><body><div id="app"></div></body>',
  { url: "http://localhost/" }
);
global.window = dom.window;
global.document = dom.window.document;
global.CustomEvent = dom.window.CustomEvent;
// Node trae su propio Event global (desde Node 15+) que NO es el mismo que
// el de jsdom — sin este parche, cualquier `new Event(...)` que la app haga
// (ver "elegir-unidad" en core/dom.js) crea un Event de Node, y jsdom lo
// rechaza al hacer dispatchEvent sobre un nodo suyo ("parameter 1 is not of
// type 'Event'"). En un navegador real esto no pasa: solo hay un Event.
global.Event = dom.window.Event;
global.Blob = dom.window.Blob || class {};
global.URL = dom.window.URL;
if (!global.URL.createObjectURL) global.URL.createObjectURL = () => "blob:mock";
if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
global.alert = dom.window.alert = () => {}; // jsPDF no está cargado en este entorno de prueba
global.confirm = dom.window.confirm = () => true; // simula que el usuario siempre acepta el confirm()
global.sessionStorage = dom.window.sessionStorage; // para simular login de vendedor/admin (ver core/auth.js)
// jsdom no calcula layout real: offsetParent es SIEMPRE null para todo el
// mundo, sin importar si el elemento está visible de verdad o no. El propio
// código de la app usa "offsetParent !== null" como filtro de "¿esto está
// visible?" en más de un lado (saltarAlSiguienteCampo en core/teclado.js,
// y el cálculo de a dónde va Tab en core/dom.js) — sin este parche, esos
// filtros vacían la lista de campos en CADA prueba y ese camino queda sin
// probar de verdad. En un navegador real esto no hace falta: offsetParent
// funciona solo.
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", { get() { return this.ownerDocument.body; }, configurable: true });

// Mock mínimo de window.storage (interfaz get/set de core/sheetsStorage.js) en
// memoria — sin esto STORAGE_OK queda en false y persist() es un no-op total,
// lo que dejaría sin probar el gate de aprobación para vendedores (vive
// DENTRO de persist(), ver core/store.js). Debe asignarse ANTES de importar
// core/store.js: STORAGE_OK se evalúa una sola vez, al cargar ese módulo.
const _memStorage = {};
global.window.storage = {
  get: async function (key) { return _memStorage[key] !== undefined ? { value: _memStorage[key] } : null; },
  set: async function (key, value) { _memStorage[key] = value; return true; },
  keysConPrefijo: async function (prefijo) {
    return Object.keys(_memStorage).filter(function (k) { return k.indexOf(prefijo) === 0 && _memStorage[k]; });
  }
};

const { render } = await import("../js/core/dom.js");
const { loadAll, state, repararTxHuerfanosDeCotEscalada, repararVendedorPerdido, repararMarcasOrigenInconsistentes } = await import("../js/core/store.js");
const auth = await import("../js/core/auth.js");
function loginComo(rol, nombre, email) {
  sessionStorage.setItem("taller_sesion_v1", JSON.stringify({
    session: { email: email, rol: rol, vendedorNombre: nombre },
    accessToken: "fake-" + email,
    expiraEl: Date.now() + 999999
  }));
  auth.restaurarSesion();
}

function click(selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error("No se encontró: " + selector);
  el.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
}
function setInput(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error("No se encontró input: " + selector);
  el.value = value;
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
// El cliente de una cotización se ELIGE de Contactos (ver
// renderClientePickerCotizacion en modules/cotizaciones.js) — ya no es un
// campo de texto libre como en Pedidos. Para las pruebas que solo necesitan
// "una cotización con este cliente" (no están probando el buscador en sí),
// esto crea el contacto si hace falta y lo deja elegido directo en el
// borrador, sin simular el clic en cada uno de los pasos del picker.
function elegirClienteCotizacion(nombre) {
  const id = "cli-test-" + nombre.replace(/\s+/g, "-").toLowerCase();
  if (!state.clientes.some(c => c.id === id)) {
    state.clientes.push({ id, nombre, tipoRelacion: "cliente", cedula: "", ciudad: "", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] });
  }
  state.formCotizacion.clienteId = id;
  state.formCotizacion.cliente = nombre;
}
// Mismo atajo que elegirClienteCotizacion, pero para Pedidos: para las
// pruebas que solo necesitan "un pedido con este cliente" (no están probando
// el buscador en sí). A diferencia de Cotizaciones, Pedidos SÍ admite un
// cliente libre (sin contacto real) — ver "usar-cliente-nuevo-pedido" en
// modules/pedidos.js — pero acá se crea igual el contacto para que las
// pruebas que sí verifican clienteId (no solo el nombre) también funcionen.
function elegirClientePedido(nombre) {
  const id = "cli-test-" + nombre.replace(/\s+/g, "-").toLowerCase();
  if (!state.clientes.some(c => c.id === id)) {
    state.clientes.push({ id, nombre, tipoRelacion: "cliente", cedula: "", ciudad: "", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] });
  }
  state.formPedido.clienteId = id;
  state.formPedido.cliente = nombre;
}
// Los campos que alimentan un cálculo en pantalla no usan data-form (que
// escribe en el borrador sin repintar) sino data-action-change, que dispara
// una acción en "change" — ver bindEvents en core/dom.js.
function setChange(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error("No se encontró campo: " + selector);
  el.value = value;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function setLinea(lineaId, campo, value) {
  setChange('[data-action-change="set-pedido-linea-campo"][data-linea="' + lineaId + '"][data-campo="' + campo + '"]', value);
}
function assert(cond, msg) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("OK: " + msg);
}

await loadAll();
render();
assert(document.querySelector(".sidebar"), "renderiza sidebar en el primer render");
// Los KPIs viven en Resumen (la pestaña por defecto) — antes vivían en
// Configuración, pero ahí nadie los busca en el día a día.
assert(document.querySelector(".kpis"), "renderiza KPIs en Resumen desde el primer render");

// --- recorre cada pestaña y verifica que renderiza sin lanzar ---
const tabs = ["resumen", "finanzas", "pedidos", "cotizaciones", "productos", "clientes", "pendientes", "notas", "config"];
for (const t of tabs) {
  click('[data-action="tab"][data-tab="' + t + '"]');
  assert(state.tab === t, "cambia a la pestaña " + t);
  assert(!state.lastError, "sin error de render en " + t + (state.lastError ? (": " + state.lastError) : ""));
}
assert(!document.querySelector(".kpis"), "ya no renderiza KPIs en Configuración (se movieron a Resumen)");

// --- finanzas: agregar transacción ---
click('[data-action="tab"][data-tab="finanzas"]');
setInput('[data-form="tx"][data-field="concepto"]', "Venta de prueba");
setInput('[data-form="tx"][data-field="monto"]', "50000");
click('[data-action="add-tx"]');
assert(state.tx.length === 1 && state.tx[0].concepto === "Venta de prueba", "agrega transacción");

// --- clientes: pestañas "+ Nuevo contacto" / "Contactos" (mismo patrón que
// Cotizaciones) — se entra viendo el formulario, y tras crear salta a la
// lista para confirmar que quedó registrado. ---
click('[data-action="tab"][data-tab="clientes"]');
assert(state.clientesVista === "nueva" && !!document.querySelector('[data-form="cliente"][data-field="nombre"]'), "Contactos entra mostrando el formulario en blanco");
setInput('[data-form="cliente"][data-field="nombre"]', "Cliente Prueba");
click('[data-action="add-cliente"]');
assert(state.clientes.length === 1, "agrega cliente");
assert(state.clientesVista === "contactos", "tras crear el cliente salta a la lista de Contactos");
assert(!!document.querySelector(".cliente-card"), "el cliente recién creado aparece en la lista");

// El usuario reportó desorden al editar un contacto: "salen opciones como si
// fuera vendedor, o cliente por consignación etc". Causa: el formulario de
// ALTA (renderFormNuevoCliente) ya escondía comisión/proveedor según el tipo,
// pero el de EDICIÓN (renderClienteEdit) los mostraba siempre los tres a la
// vez, sin importar qué tipo de contacto se estuviera editando — recién se
// filtraban al guardar, cuando el usuario ya los había visto y podido llenar.
state.clientes.push({ id: "cli-punto", nombre: "Punto Test", tipoRelacion: "punto_consignacion", comisionDefault: { tipo: "porcentaje", valor: 15 }, cedula: "", telefono: "", correo: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", categoriasInsumo: [] });
render();
click('[data-action="editar-cliente"][data-id="cli-punto"]');
let filaEdit = document.querySelector('[data-cliente-edit-row="cli-punto"]');
assert(!!filaEdit.querySelector('[data-role="edit-comision-valor"]'), "editando un PUNTO DE CONSIGNACIÓN, sí se ve el campo de comisión");
assert(!filaEdit.querySelector('[data-role="edit-descripcion"]'), "pero NO los campos de proveedor (categorías, descripción): no le aplican a un punto");
setChange('[data-cliente-edit-row="cli-punto"] [data-role="edit-tipo-relacion"]', "cliente");
filaEdit = document.querySelector('[data-cliente-edit-row="cli-punto"]');
assert(!filaEdit.querySelector('[data-role="edit-comision-valor"]'), "cambiar el tipo a \"Cliente\" (sin guardar todavía) esconde la comisión DE INMEDIATO, no recién al guardar");
setChange('[data-cliente-edit-row="cli-punto"] [data-role="edit-tipo-relacion"]', "proveedor");
filaEdit = document.querySelector('[data-cliente-edit-row="cli-punto"]');
assert(!filaEdit.querySelector('[data-role="edit-comision-valor"]') && !!filaEdit.querySelector('[data-role="edit-descripcion"]'), "y cambiarlo a \"Proveedor\" muestra sus campos (categorías/descripción/puntuación) en vez de los de comisión");
click('[data-action="guardar-cliente-edit"][data-id="cli-punto"]');
assert(state.clientes.find(c => c.id === "cli-punto").tipoRelacion === "proveedor", "guardar aplica el tipo elegido en el borrador reactivo");
assert(state.clientes.find(c => c.id === "cli-punto").comisionDefault === null, "y como ya no es un punto, su comisión por defecto se limpia (no queda un dato huérfano de otro tipo)");
state.clientes = state.clientes.filter(c => c.id !== "cli-punto");
render();

// --- pedidos: pestañas "+ Nuevo pedido" / "Historial" — mismo patrón ---
click('[data-action="tab"][data-tab="pedidos"]');
assert(state.pedidosVista === "nueva" && !!document.querySelector('[data-action="abrir-cliente-picker-pedido"]'), "Pedidos entra mostrando el formulario en blanco");

// --- pedidos: crear pedido vinculado al cliente + abono inicial ---
// El total y el costo del pedido ya NO son campos que se escriban: salen de
// las líneas (ver renderPrecioYPago en modules/pedidos.js), así que crear un
// pedido pasa por agregar al menos una línea con su cantidad y su precio.
// El cliente, igual que en Cotizaciones, se elige con el mismo buscador de
// contactos — acá se ejercita el flujo real (abrir, buscar, elegir) porque
// "Cliente Prueba" ya es un contacto real (se registró arriba, en Contactos).
click('[data-action="abrir-cliente-picker-pedido"]');
assert(!!document.querySelector(".picker-overlay"), "el buscador de cliente se abre en Pedidos");
setInput("#inp-cliente-picker-buscar", "Cliente Prueba");
render(); // data-live-filter debounce; el estado ya quedó actualizado, solo falta repintar
click('[data-action="seleccionar-cliente-picker-pedido"][data-id="' + state.clientes[0].id + '"]');
assert(state.formPedido.clienteId === state.clientes[0].id && state.formPedido.cliente === "Cliente Prueba", "vincula clienteId con el contacto elegido en el buscador");
assert(!state.clientePickerAbierto, "y cierra el buscador solo");
click('[data-action="add-pedido-linea-libre"]');
assert(state.formPedido.lineas.length === 1, "agrega una línea escrita a mano al pedido");
const lineaLibreId = state.formPedido.lineas[0].id;
setLinea(lineaLibreId, "productoNombre", "Camisetas");
setLinea(lineaLibreId, "cantidad", "40");
setLinea(lineaLibreId, "precioUnitario", "10000");
setLinea(lineaLibreId, "costoUnitario", "6000");
assert(state.formPedido.lineas[0].cantidad === 40 && state.formPedido.lineas[0].precioUnitario === 10000, "la línea guarda cantidad y precio unitario");
setChange('[data-action-change="set-form-pedido-campo"][data-campo="abono"]', "100000");
click('[data-action="add-pedido"]');
assert(state.pedidos.length === 1, "crea pedido");
// Total y costo son el RESULTADO de las líneas, nunca un campo suelto.
assert(state.pedidos[0].total === 400000, "el total del pedido sale de las líneas (40 x $10.000)");
assert(state.pedidos[0].costo === 240000, "el costo del pedido sale de las líneas (40 x $6.000)");
assert(state.pedidos[0].abono === 100000, "registra el abono inicial en el pedido");
assert(state.tx.some(t => t.concepto.indexOf("Abono inicial") === 0), "registra abono inicial en finanzas");
assert(state.pedidosVista === "historial", "tras crear el pedido salta al Historial (donde vive la tarjeta recién creada)");

// avanzar estado del pedido
const pedidoId = state.pedidos[0].id;
click('[data-action="advance"][data-id="' + pedidoId + '"]');
assert(state.pedidos[0].estado === "cortado", "avanza estado del pedido");

// "Factura" se renombró a "Cuenta de cobro": no es una factura de verdad
// (no pasa por la DIAN, sin CUFE ni resolución de numeración) — el usuario
// lo señaló y pidió el cambio de nombre para no prometer algo que el
// documento no cumple.
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoId + '"]');
assert(!!document.querySelector('[data-action="generar-pdf-cuenta-cobro"][data-id="' + pedidoId + '"]'), "el botón ahora dice/hace 'Cuenta de cobro', no 'Factura'");
assert(!document.querySelector('[data-action="generar-pdf-factura"]'), "la acción vieja 'generar-pdf-factura' ya no existe en ningún lado");
assert(!document.querySelector('[data-action="enviar-factura-correo"]'), "...ni 'enviar-factura-correo'");
click('[data-action="generar-pdf-cuenta-cobro"][data-id="' + pedidoId + '"]');
assert(!state.lastError, "generar la cuenta de cobro no rompe el render aunque jsPDF no esté cargado en este entorno de prueba");

// --- catálogo: agrega un insumo reutilizable ---
click('[data-action="tab"][data-tab="catalogo"]');
click('[data-action="add-cat-item"]');
assert(state.catalogoInsumos.length > 0, "el catálogo trae insumos semilla + el agregado");
const catItemId = state.catalogoInsumos[state.catalogoInsumos.length - 1].id;

// El usuario reportó: "apenas relleno el primer campo [del insumo nuevo] y lo
// deselecciono, automáticamente se organiza donde cree que va, como si ya le
// hubiera dado guardar". Causa: el orden A-Z se recalcula en cada tecla, así
// que escribir la primera letra del nombre ya reubicaba la fila en su lugar
// alfabético real, lejos de donde se seguía trabajando.
assert(state.catalogoInsumoNuevoId === catItemId, "el insumo recién creado queda marcado como borrador sin guardar todavía");

// El usuario reportó: "el botón de guardar se lo salta [con Tab], sí o sí
// me toca con el mouse". Causa: el botón nacía con `disabled` hasta que
// hubiera un nombre — pero un botón deshabilitado desaparece de los
// candidatos a Tab justo en el momento en que Tab decide "a dónde voy"
// (antes de que el cambio en Nombre termine de redibujar y lo habilite), así
// que Tab lo saltaba siempre, sin importar qué tan rápido o lento se
// escribiera. Fix: el botón ya nace SIN disabled (tabulable de una), y si de
// verdad falta el nombre, avisa en vez de guardar en silencio.
const botonGuardarNuevo = document.querySelector('[data-action="guardar-cat-item-nuevo"][data-id="' + catItemId + '"]');
assert(!!botonGuardarNuevo && !botonGuardarNuevo.hasAttribute("disabled"), "el botón 'Guardar' de un insumo nuevo NUNCA se deshabilita — así Tab no lo salta esperando a que el nombre se termine de escribir");
var alertaGuardarVacio = "";
var alertaOriginalGuardarVacio = global.alert;
global.window.alert = global.alert = function (msg) { alertaGuardarVacio = msg; };
click('[data-action="guardar-cat-item-nuevo"][data-id="' + catItemId + '"]');
global.window.alert = global.alert = alertaOriginalGuardarVacio;
assert(state.catalogoInsumoNuevoId === catItemId, "clicar 'Guardar' sin nombre NO lo confirma (sigue siendo el borrador sin guardar)");
assert(alertaGuardarVacio.toLowerCase().indexOf("nombre") !== -1, "...y avisa qué falta, en vez de no hacer nada en silencio");

state.catalogoInsumos.unshift({ id: "ins-zzz-test", nombre: "Zíper", unidad: "UND", costo: 500, tipo: "por_prenda", categoriaId: "", proveedorId: "" });
render();
setChange("#ins-nombre-" + catItemId, "Algodón"); // alfabéticamente antes que "Zíper"
let ordenNombres = [...document.querySelectorAll(".insumo-nombre")].map(i => i.id);
assert(ordenNombres.indexOf("ins-nombre-" + catItemId) > ordenNombres.indexOf("ins-nombre-ins-zzz-test"), "mientras no se guarda, escribir el nombre NO reubica la fila (sigue quieta, no salta a su lugar alfabético)");
assert(!!document.querySelector('[data-action="guardar-cat-item-nuevo"][data-id="' + catItemId + '"]'), "aparece un botón explícito de Guardar para el insumo nuevo");
click('[data-action="guardar-cat-item-nuevo"][data-id="' + catItemId + '"]');
assert(!state.catalogoInsumoNuevoId, "Guardar confirma el insumo: deja de ser un borrador");
ordenNombres = [...document.querySelectorAll(".insumo-nombre")].map(i => i.id);
assert(ordenNombres.indexOf("ins-nombre-" + catItemId) < ordenNombres.indexOf("ins-nombre-ins-zzz-test"), "y ahí SÍ toma su lugar alfabético real (Algodón antes que Zíper)");
state.catalogoInsumos = state.catalogoInsumos.filter(c => c.id !== "ins-zzz-test");
render();

// --- plantillas: agrega una plantilla con un insumo desde el catálogo —
// el usuario reportó que acá seguía siendo un <select> plano en vez del
// mismo explorador (modal con categorías/buscador/selección múltiple) que
// ya tenían Cotizaciones y Productos. Ahora las tres pestañas comparten UNA
// sola implementación (ver renderExploradorInsumos en core/components.js). ---
click('[data-action="tab"][data-tab="plantillas"]');
const plantillasPrevias = state.plantillasPrendas.length;
click('[data-action="add-plantilla"]');
assert(state.plantillasPrendas.length === plantillasPrevias + 1, "agrega plantilla");
const nuevaPlaId = state.plantillasPrendas[state.plantillasPrendas.length - 1].id;
assert(!document.querySelector('select[data-action-change="add-pla-insumo-catalogo"]'), "el <select> plano de insumos predeterminados ya no existe en Plantillas");
click('[data-action="abrir-insumo-picker-plantilla"][data-pla="' + nuevaPlaId + '"]');
assert(state.insumoPickerAbierto === "plantilla" && state.insumoPickerPlantillaId === nuevaPlaId, "abre el MISMO explorador de insumos que Cotizaciones y Productos, sobre esta plantilla");
assert(!!document.querySelector(".picker-modal"), "el modal del explorador se renderiza en Plantillas");
click('[data-action="toggle-insumo-picker-item"][data-id="' + catItemId + '"]');
click('[data-action="confirmar-insumo-picker-plantilla"][data-pla="' + nuevaPlaId + '"]');
assert(state.insumoPickerAbierto === "", "confirmar cierra el explorador");
assert(
  state.plantillasPrendas.find(p => p.id === nuevaPlaId).insumos.length === 1,
  "agrega insumo del catálogo a la plantilla"
);
assert(state.plantillasPrendas.find(p => p.id === nuevaPlaId).insumos[0].origenCatalogoId === catItemId, "...y ese insumo queda vinculado al insumo del catálogo del que salió (origenCatalogoId) — antes esto no se guardaba, y el aviso de \"el catálogo cambió de precio\" nunca podía aparecer para ningún insumo agregado a una plantilla (reportado en producción 2026-09-21)");

// --- flujos de producción: se crean y editan directamente en Plantillas ---
const flujosPrevios = state.plantillasEstados.length;
click('[data-action="add-flujo-estados"]');
assert(state.plantillasEstados.length === flujosPrevios + 1, "agrega flujo de producción");
const nuevoFlujoId = state.plantillasEstados[state.plantillasEstados.length - 1].id;
assert(state.flujoEstadosAbierto === nuevoFlujoId, "el flujo nuevo se abre listo para editar etapas");

const flujoCard = document.querySelector('[data-flujo-id="' + nuevoFlujoId + '"]');
const nombreFlujoInput = flujoCard.querySelector('input[data-action-change="set-flujo-estados-nombre"]');
nombreFlujoInput.value = "Con sublimación";
nombreFlujoInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.plantillasEstados.find(f => f.id === nuevoFlujoId).nombre === "Con sublimación", "renombra el flujo de producción");

const flujoCardActual = document.querySelector('[data-flujo-id="' + nuevoFlujoId + '"]');
const nuevaEtapaInput = flujoCardActual.querySelector('[data-role="nueva-etapa-flujo-' + nuevoFlujoId + '"]');
nuevaEtapaInput.value = "Sublimado";
click('[data-action="add-etapa-flujo"][data-id="' + nuevoFlujoId + '"]');
assert(
  state.plantillasEstados.find(f => f.id === nuevoFlujoId).estados.some(e => e.label === "Sublimado"),
  "agrega una etapa nueva al flujo"
);

const flujoSelectEnPlantilla = document.querySelector('[data-plantilla-id="' + nuevaPlaId + '"] select[data-campo="flujoEstadosId"]');
flujoSelectEnPlantilla.value = nuevoFlujoId;
flujoSelectEnPlantilla.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(
  state.plantillasPrendas.find(p => p.id === nuevaPlaId).flujoEstadosId === nuevoFlujoId,
  "asigna el flujo de producción a la plantilla de prenda"
);

// --- cotizaciones: crear cotización (ya trae una referencia en blanco), tipos de costo y PDF ---
click('[data-action="tab"][data-tab="cotizaciones"]');
elegirClienteCotizacion("Cliente Prueba");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Uniformes de prueba");
click('[data-action="add-cotizacion"]');
assert(state.cotizaciones.length === 1, "crea cotización");
assert(state.cotizaciones[0].referencias.length === 1, "la cotización nace con una referencia en blanco");
assert(state.cotizaciones[0].marca === "", "\"marca\" nace vacía si no se llenó (es opcional)");

const cotId = state.cotizaciones[0].id;
const refId = state.cotizaciones[0].referencias[0].id;

// ---------------------------------------------------------------------------
// Campo opcional "Marca" en Cotizaciones: de qué línea del negocio es el
// pedido (ej. Uniformes, Urbana, Licras) — pedido explícito por el usuario,
// con sugerencias aprendidas de lo ya escrito antes (mismo patrón que el
// datalist de "Persona" en Finanzas: <input list> + <datalist> nativo, sin
// componente propio — el usuario pidió "texto libre con sugerencias", no
// una lista fija que mantener aparte).
// ---------------------------------------------------------------------------
const { marcasConocidas: marcasConocidasTest } = await import("../js/core/calc.js");
const inputMarcaCabecera = document.querySelector('[data-action-change="set-cot-marca"][data-id="' + cotId + '"]');
assert(!!inputMarcaCabecera, "la cabecera de una cotización ya creada tiene su campo Marca");
assert(inputMarcaCabecera.getAttribute("list") === "dl-marcas", "...con sugerencias desde el datalist compartido");
inputMarcaCabecera.value = "Urbana";
inputMarcaCabecera.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.cotizaciones.find(c => c.id === cotId).marca === "Urbana", "escribir en el campo guarda la marca en la cotización");
assert(marcasConocidasTest().indexOf("Urbana") !== -1, "marcasConocidas() la recuerda para sugerirla después");
// como cualquier otra edición de cabecera, queda "sin guardar" hasta pulsar
// Guardar — salir sin guardar (confirmarSalidaSiSucia) la revertiría.
render();
click('[data-action="guardar-cotizacion"][data-id="' + cotId + '"]');

click('[data-action="cot-vista"][data-val="historial"]');
const cardConMarca = document.querySelector('[data-cot-id="' + cotId + '"]');
assert(!!cardConMarca && cardConMarca.textContent.includes("Urbana"), "la tarjeta del Historial muestra la marca, para saber de un vistazo a qué línea pertenece sin abrirla");
click('[data-action="abrir-cotizacion-editor"][data-id="' + cotId + '"]');
assert(document.querySelector('datalist#dl-marcas option[value="Urbana"]') !== null, "el datalist compartido ya ofrece \"Urbana\" como sugerencia (aprendida de esta misma cotización)");

// una cotización SIN marca no muestra ningún badge de más en el Historial
const cotSinMarcaId = "cot-sin-marca-test";
state.cotizaciones = state.cotizaciones.concat([{
  id: cotSinMarcaId, cliente: "Cliente Sin Marca", descripcion: "Sin marca", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", marca: "", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "csm1",
  referencias: [], costosGlobales: [], serviciosCobrados: [], compras: []
}]);
click('[data-action="cot-vista"][data-val="historial"]');
const cardSinMarca = document.querySelector('[data-cot-id="' + cotSinMarcaId + '"]');
assert(!!cardSinMarca && !cardSinMarca.querySelector(".badge[style*=\"surface-3\"]"), "sin marca, no aparece ningún badge de más (campo opcional, no estorba a quien no lo usa)");
state.cotizaciones = state.cotizaciones.filter(c => c.id !== cotSinMarcaId); // limpieza
// "cotizacionEditando" se queda en cotId (cambiar de vista no lo limpia),
// así que volver a "nueva" muestra otra vez su detalle completo, sin
// necesidad de reabrir desde el Historial.
click('[data-action="cot-vista"][data-val="nueva"]');

// al convertir en pedido, "marca" NO se traslada — es un dato exclusivo de
// Cotizaciones, a propósito (el usuario pidió agregarlo "a cotizaciones").

// insumo personalizado con tipo "tela"
click('[data-action="add-insumo-personalizado"][data-cot="' + cotId + '"][data-ref="' + refId + '"]');
let ref = state.cotizaciones[0].referencias[0];
assert(ref.insumos.length === 1, "agrega insumo personalizado a la referencia");
const insId = ref.insumos[0].id;
const refCard = document.querySelector('[data-ref-id="' + refId + '"]');
const costoInput = refCard.querySelector('input[data-ins="' + insId + '"][data-campo="costo"]');
costoInput.value = "8000";
costoInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const tipoSelect = refCard.querySelector('select[data-ins="' + insId + '"][data-campo="tipo"]');
tipoSelect.value = "tela";
tipoSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
ref = state.cotizaciones[0].referencias[0];
assert(ref.insumos[0].tipo === "tela" && ref.insumos[0].costo === 8000, "actualiza costo y tipo de costo del insumo");

// El consumo de una tela es PROPIO de ese insumo, no de la referencia (ver
// calcCostoPrenda en core/calc.js) — así una referencia con 2 telas
// sublimadas distintas (ej. 0.8m delantero + 0.4m mangas) puede darle a
// cada una su propia cantidad, en vez de que las dos "consuman" el mismo
// número. Reportado en producción 2026-09-21: "cuando hay más de 1 tela
// sublimada, la cotización está hecha para 1 tela".
const campoCantTela = document.querySelector('[data-ref-id="' + refId + '"] input[data-ins="' + insId + '"][data-campo="cantidad"]');
assert(campoCantTela.disabled === false, "\"Cant.\" de un insumo tipo \"tela\" ya NO está deshabilitado — cada tela lleva su propio consumo, editable");
campoCantTela.value = "1.6";
campoCantTela.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
ref = state.cotizaciones[0].referencias[0];
assert(ref.insumos[0].cantidad === 1.6, "escribir en \"Cant.\" guarda el consumo PROPIO de esa tela (insumo.cantidad), no el de la referencia");
const costoPrendaTela = document.querySelector('[data-ref-id="' + refId + '"] [data-ins-row][data-ins="' + insId + '"] .amount');
assert(costoPrendaTela.textContent.indexOf("12.800") >= 0 || costoPrendaTela.textContent.indexOf("12,800") >= 0, "\"Costo x prenda\" (8.000 × 1.6 = 12.800) usa el consumo PROPIO de la tela");
// Cambiar el consumo de la REFERENCIA (el "valor por defecto para telas
// nuevas") no debe tocar el consumo YA guardado de esta tela — son
// independientes desde que se editó a mano.
state.cotizaciones[0].referencias[0].consumoAprox = 99;
render();
const campoCantTelaTrasCambioRef = document.querySelector('[data-ref-id="' + refId + '"] input[data-ins="' + insId + '"][data-campo="cantidad"]');
assert(campoCantTelaTrasCambioRef.value === "1.6", "...y cambiar el \"Consumo tela\" de la referencia NO pisa el consumo ya personalizado de esta tela — son campos independientes");
state.cotizaciones[0].referencias[0].consumoAprox = 1; // deja la referencia como la esperan las pruebas siguientes
state.cotizaciones[0].referencias[0].insumos[0].cantidad = 1; // ídem para el insumo
render();

// --- guardado explícito: editar una cotización NO reescribe los datos
// oficiales hasta confirmar; "Descartar" vuelve al último guardado ---
assert(state.cotSucia === cotId, "editar la cotización la marca como 'cambios sin guardar'");
assert(!!document.querySelector(".save-bar"), "aparece la barra de guardado");
const costoInputSucio = document.querySelector('[data-ref-id="' + refId + '"] input[data-ins="' + insId + '"][data-campo="costo"]');
costoInputSucio.value = "99999";
costoInputSucio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.cotizaciones[0].referencias[0].insumos[0].costo === 99999, "el cambio se ve en pantalla aunque no esté guardado");
click('[data-action="descartar-cambios-cotizacion"]');
assert(state.cotizaciones[0].referencias[0].insumos.length === 0, "descartar revierte TODOS los cambios desde el último guardado (incluido el primero)");
assert(state.cotSucia === "", "descartar deja la cotización limpia");
assert(!document.querySelector(".save-bar"), "la barra de guardado desaparece al descartar");

// se rehace lo descartado y ahora sí se guarda
click('[data-action="add-insumo-personalizado"][data-cot="' + cotId + '"][data-ref="' + refId + '"]');
const insId2 = state.cotizaciones[0].referencias[0].insumos[0].id;
const costoInput2 = document.querySelector('[data-ref-id="' + refId + '"] input[data-ins="' + insId2 + '"][data-campo="costo"]');
costoInput2.value = "8000";
costoInput2.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const tipoSelect2 = document.querySelector('[data-ref-id="' + refId + '"] select[data-ins="' + insId2 + '"][data-campo="tipo"]');
tipoSelect2.value = "tela";
tipoSelect2.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
click('[data-action="guardar-cotizacion"][data-id="' + cotId + '"]');
assert(state.cotSucia === "", "guardar deja la cotización limpia");
assert(state.cotizaciones[0].referencias[0].insumos[0].costo === 8000, "lo guardado conserva los valores editados");
ref = state.cotizaciones[0].referencias[0];
const insId3 = ref.insumos[0].id;
// tras guardar, el nuevo punto de retorno es lo recién guardado
const costoInput3 = document.querySelector('[data-ref-id="' + refId + '"] input[data-ins="' + insId3 + '"][data-campo="costo"]');
costoInput3.value = "1234";
costoInput3.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
click('[data-action="descartar-cambios-cotizacion"]');
assert(state.cotizaciones[0].referencias[0].insumos[0].costo === 8000, "descartar después de guardar vuelve a la ÚLTIMA versión guardada, no a la original");

// agregar insumo desde el catálogo — ahora vía el explorador (modal con
// panel de categorías, buscador y selección múltiple) en vez del <select>
// plano, que no escalaba con un catálogo grande.
click('[data-action="abrir-insumo-picker"][data-cot="' + cotId + '"][data-ref="' + refId + '"]');
assert(state.insumoPickerAbierto === "cotizacion" && state.insumoPickerCotId === cotId && state.insumoPickerRefId === refId, "el explorador de insumos se abre sobre la referencia elegida");
assert(!!document.querySelector(".picker-modal"), "el modal del explorador se renderiza");
assert(!!document.querySelector('[data-action="set-insumo-picker-categoria"][data-val="todos"]'), "el explorador lista las categorías en el panel lateral");
assert(!!document.querySelector("#inp-insumo-picker-buscar"), "el explorador tiene barra de búsqueda");
// El usuario reportó: "cada que selecciono uno, el explorador me lleva
// devuelta al inicio de la lista" — marcar un insumo (checkbox) dispara un
// re-render de TODA la app, y sin nada que lo evite eso reconstruye
// ".picker-list" desde cero con scrollTop = 0. Se simula haber bajado en la
// lista antes de marcar, para comprobar que el scroll sobrevive al re-render.
document.querySelector(".picker-list").scrollTop = 234;
click('[data-action="toggle-insumo-picker-item"][data-id="' + catItemId + '"]');
assert(state.insumoPickerSeleccion.length === 1, "marcar un insumo lo agrega a la selección múltiple");
assert(document.querySelector(".picker-list").scrollTop === 234, "y el explorador NO vuelve al inicio de la lista: conserva el scroll de antes de marcar");
click('[data-action="confirmar-insumo-picker"][data-cot="' + cotId + '"][data-ref="' + refId + '"]');
assert(state.insumoPickerAbierto === "", "confirmar cierra el explorador");
ref = state.cotizaciones[0].referencias[0];
assert(ref.insumos.length === 2, "agrega insumo desde el catálogo a la referencia");

// generar PDF vive dentro de la pestaña "Producción" de la tarjeta (antes
// era un botón siempre visible arriba de la tarjeta, y luego tuvo su propia
// pestaña "Documentos" — se fusionó en Producción por ser muy chica sola).
click('[data-action="set-cot-tab"][data-id="' + cotId + '"][data-val="produccion"]');
// sin jsPDF cargado (no aplica en este entorno de prueba) debe fallar de
// forma controlada, sin romper el render ni lanzar una excepción.
click('[data-action="generar-pdf"][data-id="' + cotId + '"]');
assert(!state.lastError, "el botón de generar PDF no rompe el render aunque jsPDF no esté cargado");

click('[data-action="convertir-cotizacion"][data-id="' + cotId + '"]');
assert(state.cotizaciones[0].estado === "convertida", "convierte cotización en pedido");
assert(state.pedidos.length === 2, "el pedido convertido aparece en Pedidos");
assert(state.tab === "pedidos", "navega a Pedidos tras convertir");

// --- pedidos: progreso de producción POR REFERENCIA (no un solo "tape" para
// todo el pedido) — el pedido recién convertido trae la referencia de la
// cotización de origen, con su propio avance. ---
const pedidoConvertidoId = state.pedidos[0].id;
const refIdProduccion = state.cotizaciones[0].referencias[0].id;
assert(!!document.querySelector('[data-action="advance-ref"][data-pedido="' + pedidoConvertidoId + '"][data-ref="' + refIdProduccion + '"]'), "la tarjeta del pedido muestra el botón de avanzar por referencia");
const estadoRefAntes = state.cotizaciones[0].referencias[0].estado;
const estadoPedidoAntes = state.pedidos[0].estado;
click('[data-action="advance-ref"][data-pedido="' + pedidoConvertidoId + '"][data-ref="' + refIdProduccion + '"]');
assert(state.cotizaciones[0].referencias[0].estado !== estadoRefAntes, "avanzar la referencia cambia su propio estado en la cotización de origen");
assert(state.pedidos[0].estado !== estadoPedidoAntes, "el estado agregado del pedido se resincroniza tras avanzar la referencia");
assert(state.pedidos[0].estado === state.cotizaciones[0].referencias[0].estado, "con una sola referencia, el estado del pedido coincide con el de esa referencia (es la única, así que también es la 'menos avanzada')");

// --- notas (antes "pendientes": tareas/mejoras) ---
click('[data-action="tab"][data-tab="notas"]');
setInput('[data-form="pend"][data-field="texto"]', "Comprar hilo");
click('[data-action="add-pend"]');
assert(state.pendientes.length === 1, "agrega nota");
click('[data-action="toggle-pend"][data-id="' + state.pendientes[0].id + '"]');
assert(state.pendientes[0].hecho === true, "marca nota como hecha");

// --- pendientes (nómina, gastos fijos, meta, deudas) ---
// Los formularios de "agregar" viven colapsados detrás de un botón (menos
// ruido visual junto a las tablas) — hay que abrirlos antes de poder tocar
// sus campos.
click('[data-action="tab"][data-tab="pendientes"]');
click('[data-action="toggle-pend-form"][data-key="emp"]');
setInput('[data-form="emp"][data-field="nombre"]', "Costurera 1");
setInput('[data-form="emp"][data-field="salario"]', "1200000");
click('[data-action="add-emp"]');
assert(state.config.nomina.length === 1, "agrega persona a nómina");

// ---------------------------------------------------------------------------
// "Asignar a servicio(s)" a un gasto o a un pago de nómina (2026-09). El
// usuario lo pidió así: al comprar medias, poder descontarlo de la plata que
// YA se cobró por el "servicio Medias" (marcado así en "Compras del pedido"
// de una cotización — ver calcServiciosPorCategoriaRango en core/calc.js) en
// vez de que cuente como un gasto nuevo sin relación; "si no alcanza, poder
// seleccionar varios"; y el único monto que puede quedar negativo es la
// Ganancia (lo que no se cubre con ningún servicio).
// ---------------------------------------------------------------------------
const { calcListaCompras: calcListaComprasServ, calcServiciosDisponibles: calcServDisp, calcServiciosPendientesPorCategoriaRango: calcServPendientes, calcHistorialServicio } = await import("../js/core/calc.js");
const { todayStr: hoyStrServicios } = await import("../js/core/utils.js");
var fechaCotServicios = hoyStrServicios(); // hoy: para que el tile del dashboard de 30 días la vea, sin depender de una fecha fija
var cotServicios = {
  id: "cot-servicios-test", cliente: "Cliente Servicios", descripcion: "Prueba servicios", fecha: fechaCotServicios,
  // "convertida" a propósito: una cotización SIN convertir no tiene pedido
  // ni cobro real detrás, así que ya no cuenta como "servicio" acumulado
  // (ver el fix de listaEntradasServicio más abajo, en su propia prueba).
  estado: "convertida", pedidoId: "", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "csrv1",
  referencias: [{
    id: "ref-serv-1", nombre: "Camiseta", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 40000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [{ id: "ins-conf", nombre: "Confección", unidad: "servicio", costo: 5000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }],
    detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
};
state.cotizaciones = state.cotizaciones.concat([cotServicios]);
var claveConfeccion = calcListaComprasServ(cotServicios).filter(function (l) { return l.nombre === "Confección"; })[0].clave;
// 10 prendas x $5.000 estimado = $50.000, pero se marca "servicio" con un
// costoReal distinto ($50.000 igual, a propósito, para no complicar el
// ejemplo) — mano de obra propia, ya cobrada al cliente, todavía sin pagar.
state.cotizaciones = state.cotizaciones.map(function (c) {
  return c.id === "cot-servicios-test" ? Object.assign({}, c, { compras: [{ clave: claveConfeccion, estado: "servicio", costoReal: 50000 }] }) : c;
});
render();
assert(calcServDisp().some(function (s) { return s.nombre === "Confección" && s.disponible === 50000; }), "calcServiciosDisponibles: \"Confección\" acumula 50.000 (marcado \"servicio\" en Compras del pedido)");

// --- Finanzas: registrar un GASTO asignado a un servicio ---
click('[data-action="tab"][data-tab="finanzas"]');
click('[data-action="finanzas-vista"][data-val="nuevo"]');
click('[data-action="set-tx-tipo"][data-val="gasto"]');
assert(!!document.querySelector('[data-action="agregar-fila-servicio"][data-form-destino="formTx"]'), "el formulario de gasto ofrece \"Asignar a servicio(s)\" — hay plata disponible en \"Confección\"");
setInput('[data-form="tx"][data-field="concepto"]', "Botones para el pedido");
setInput('[data-form="tx"][data-field="monto"]', "30000");
click('[data-action="agregar-fila-servicio"][data-form-destino="formTx"]');
assert(state.formTx.servicios.length === 1, "agrega una fila de asignación");
setChange('select[data-action-change="set-fila-servicio-nombre"][data-form-destino="formTx"][data-idx="0"]', "Confección");
assert(state.formTx.servicios[0].nombre === "Confección", "elige \"Confección\" en la fila");
setChange('input[data-action-change="set-fila-servicio-monto"][data-form-destino="formTx"][data-idx="0"]', "30000");
click('[data-action="add-tx"]');
var gastoConServicio = state.tx[0];
assert(gastoConServicio.tipo === "gasto" && gastoConServicio.monto === 30000, "crea el gasto con su monto de siempre");
assert(gastoConServicio.serviciosDescuento.length === 1 && gastoConServicio.serviciosDescuento[0].nombre === "Confección" && gastoConServicio.serviciosDescuento[0].monto === 30000, "...y guarda de qué servicio se descontó y cuánto");
assert(calcServDisp().filter(function (s) { return s.nombre === "Confección"; })[0].disponible === 20000, "\"Confección\" queda con 20.000 disponibles (50.000 − 30.000)");
click('[data-action="finanzas-vista"][data-val="historial"]');
assert(!!document.querySelector('[title="Descontado de: Confección $30.000"]'), "el historial de Finanzas muestra de qué servicio se descontó este gasto");

// --- Validación: ningún servicio puede quedar negativo (el aviso bloquea el guardado) ---
click('[data-action="finanzas-vista"][data-val="nuevo"]');
click('[data-action="set-tx-tipo"][data-val="gasto"]');
setInput('[data-form="tx"][data-field="concepto"]', "Gasto de más");
setInput('[data-form="tx"][data-field="monto"]', "999999");
click('[data-action="agregar-fila-servicio"][data-form-destino="formTx"]');
setChange('select[data-action-change="set-fila-servicio-nombre"][data-form-destino="formTx"][data-idx="0"]', "Confección");
setChange('input[data-action-change="set-fila-servicio-monto"][data-form-destino="formTx"][data-idx="0"]', "999999");
var txAntesDelRechazo = state.tx.length;
var alertaOriginal = global.alert;
var alertaCapturada = "";
global.window.alert = global.alert = function (msg) { alertaCapturada = msg; };
click('[data-action="add-tx"]');
assert(state.tx.length === txAntesDelRechazo, "asignar más de lo disponible NO guarda el gasto");
assert(alertaCapturada.indexOf("Confección") >= 0, "...y avisa cuál servicio no alcanza");
global.window.alert = global.alert = alertaOriginal;
state.formTx.servicios = []; // limpia el intento fallido para no arrastrarlo a la próxima prueba

// --- Auditoría financiera 2026-09-20: dos filas del MISMO servicio no
// pueden sumar más de lo disponible, aunque cada una por separado sí
// alcance — antes validarServiciosAsignados comparaba cada fila contra un
// `disponible` congelado, sin acumular entre filas del mismo formulario.
// "Confección" tiene 20.000 disponibles en este punto (línea de arriba).
// La UI real solo ofrece "+ Agregar servicio" mientras queden nombres
// distintos por elegir (filas.length < disponibles.length) — con un solo
// servicio ("Confección") en este punto, no se puede llegar a 2 filas por
// esa vía. Se arma el borrador directo (mismo resultado que si hubiera 2+
// servicios disponibles y el usuario eligiera el mismo nombre dos veces,
// que el <select> nunca lo impide): lo que se está probando es
// validarServiciosAsignados, no el botón "+".
click('[data-action="finanzas-vista"][data-val="nuevo"]');
click('[data-action="set-tx-tipo"][data-val="gasto"]');
setInput('[data-form="tx"][data-field="concepto"]', "Dos filas mismo servicio");
setInput('[data-form="tx"][data-field="monto"]', "30000");
state.formTx.servicios = [{ nombre: "Confección", monto: "15000" }, { nombre: "Confección", monto: "15000" }];
render();
var txAntesFilasRepetidas = state.tx.length;
var alertaFilasRepetidasOriginal = global.alert;
var alertaFilasRepetidas = "";
global.window.alert = global.alert = function (msg) { alertaFilasRepetidas = msg; };
click('[data-action="add-tx"]');
assert(state.tx.length === txAntesFilasRepetidas, "dos filas del MISMO servicio que suman más de lo disponible (15.000+15.000=30.000 > 20.000) NO se guardan, aunque cada una por separado sí alcanzara");
assert(alertaFilasRepetidas.indexOf("Confección") >= 0, "...y avisa cuál servicio no alcanza");
global.window.alert = global.alert = alertaFilasRepetidasOriginal;
state.formTx.servicios = [];

// --- Auditoría 2026-09-20: un gasto ya asignado a un servicio no queda con
// Monto/Tipo libremente editables (antes sí, y bajarle el monto a mano
// dejaba serviciosDescuento "congelado" con el valor viejo, inflando
// Ganancia sin que nada lo delate).
click('[data-action="finanzas-vista"][data-val="historial"]');
click('[data-action="editar-tx"][data-id="' + gastoConServicio.id + '"]');
assert(!document.querySelector('[data-tx-edit-row="' + gastoConServicio.id + '"] [data-role="edit-monto"]'), "un gasto ya asignado a un servicio no deja el Monto editable a mano");
assert(!document.querySelector('[data-tx-edit-row="' + gastoConServicio.id + '"] [data-role="edit-tipo"]'), "...ni el Tipo, por el mismo motivo (desincronizaría serviciosDescuento del monto/tipo real)");
click('[data-action="cancelar-edicion-tx"]');

// --- Auditoría 2026-09-20: eliminar la cotización que aportó un servicio
// YA gastado (asignado a un gasto/nómina real) se bloquea, no solo se
// avisa — misma severidad que "nunca negativo" en el resto del sistema.
const pedidosPreviosRemoveCotServ = state.pedidos, cotizacionesPreviasRemoveCotServ = state.cotizaciones, txPreviosRemoveCotServ = state.tx;
const cotServicioParaBorrar = {
  id: "cot-borrar-servicio-test", clienteId: "", cliente: "Cliente Borrar", descripcion: "Prueba borrar", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-borrar-servicio-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cbst1",
  referencias: [{
    id: "r-cbst1", nombre: "Camisa", imagenUrl: "", consumoAprox: 1, cantidadPedida: 5, precioVenta: 40000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [{ id: "i-cbst1", nombre: "Confección Borrar", unidad: "servicio", costo: 10000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }],
    detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
};
const claveServicioBorrar = calcListaComprasServ(cotServicioParaBorrar).filter(function (l) { return l.nombre === "Confección Borrar"; })[0].clave;
cotServicioParaBorrar.compras = [{ clave: claveServicioBorrar, estado: "servicio", costoReal: 50000 }];
state.pedidos = [{
  id: "ped-borrar-servicio-test", numeroOp: "OP-BORRAR-SERV", cliente: "Cliente Borrar", descripcion: "Prueba",
  cantidad: "1", total: 200000, costo: 100000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-borrar-servicio-test",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [cotServicioParaBorrar];
state.tx = [{ id: "tx-gasto-servicio-borrar", tipo: "gasto", concepto: "Pago a la operaria", monto: 50000, contraparte: "Operaria", fecha: "2026-01-02", pedidoId: "", serviciosDescuento: [{ nombre: "Confección Borrar", monto: 50000 }] }];
assert(calcServDisp().filter(function (s) { return s.nombre === "Confección Borrar"; })[0].disponible === 0, "sanity: \"Confección Borrar\" está totalmente gastado (50.000 acumulado, 50.000 usado)");
var alertaBorrarServOriginal = global.alert;
var alertaBorrarServ = "";
global.window.alert = global.alert = function (msg) { alertaBorrarServ = msg; };
const { actions: cotAccionesRemoveTest } = await import("../js/modules/cotizaciones.js");
cotAccionesRemoveTest["remove-cotizacion"]({ getAttribute: function () { return "cot-borrar-servicio-test"; } });
assert(state.cotizaciones.some(function (c) { return c.id === "cot-borrar-servicio-test"; }), "no se pudo eliminar la cotización: dejaría \"Confección Borrar\" en negativo (ya se le pagó a la operaria)");
assert(alertaBorrarServ.indexOf("Confección Borrar") >= 0, "...y el aviso dice cuál servicio se rompería");
global.window.alert = global.alert = alertaBorrarServOriginal;
state.pedidos = pedidosPreviosRemoveCotServ; state.cotizaciones = cotizacionesPreviasRemoveCotServ; state.tx = txPreviosRemoveCotServ;

// --- Auditoría 2026-09-20: borrar el insumo/costo global que originó una
// compra "Sí" ya registrada deja una "compra fantasma" — sigue inflando
// el costo real Y sigue generando/actualizando su movimiento cada vez que
// se pulsa "Actualizar movimientos financieros". Se prueba con un costo
// global (clave más simple: "global|id") pero el mecanismo es el mismo
// para un insumo o una referencia entera.
const pedidosPreviosHuerfanaTest = state.pedidos, cotizacionesPreviasHuerfanaTest = state.cotizaciones, txPreviosHuerfanaTest = state.tx;
const cotHuerfanaTest = {
  id: "cot-huerfana-test", clienteId: "", cliente: "Cliente Huérfana", descripcion: "Prueba huérfana", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-huerfana-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "chft1",
  referencias: [],
  // Dos costos globales: "Empaque" se queda (así la tabla de "Compras del
  // pedido" — y su botón de sincronizar — sigue teniendo algo que mostrar),
  // "Domicilio" es el que se borra para simular la compra huérfana.
  costosGlobales: [
    { id: "cg-huerfana", nombre: "Domicilio", costo: 50000, proveedorId: "", esServicio: false },
    { id: "cg-se-queda", nombre: "Empaque", costo: 5000, proveedorId: "", esServicio: false }
  ],
  // "Empaque" también viene YA sincronizada de antes (su propio tx real) —
  // sirve para probar el caso que reportó el usuario en producción
  // (2026-09-20): una compra que SIGUE existiendo de verdad no se puede
  // marcar huérfana solo por volver a pulsar el botón sin haber cambiado
  // nada.
  serviciosCobrados: [], compras: [
    { clave: "global|cg-huerfana", estado: "si", costoReal: 75000, txId: "tx-huerfana-test" },
    { clave: "global|cg-se-queda", estado: "si", costoReal: 5000, txId: "tx-se-queda-test" }
  ]
};
state.pedidos = [{
  id: "ped-huerfana-test", numeroOp: "OP-HUERFANA", cliente: "Cliente Huérfana", descripcion: "Prueba",
  cantidad: "1", total: 100000, costo: 50000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-huerfana-test",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [cotHuerfanaTest];
state.tx = [
  { id: "tx-huerfana-test", tipo: "gasto", concepto: "Compra — Domicilio — Prueba huérfana", monto: 75000, contraparte: "", fecha: "2026-01-02", pedidoId: "ped-huerfana-test", cotizacionId: "cot-huerfana-test", origenCompraClave: "global|cg-huerfana" },
  { id: "tx-se-queda-test", tipo: "gasto", concepto: "Compra — Empaque — Prueba huérfana", monto: 5000, contraparte: "", fecha: "2026-01-02", pedidoId: "ped-huerfana-test", cotizacionId: "cot-huerfana-test", origenCompraClave: "global|cg-se-queda" }
];
const { calcCotGastosReales: calcCotGastosRealesTest } = await import("../js/core/calc.js");
assert(calcCotGastosRealesTest(cotHuerfanaTest) === 25000, "sanity: con el costo global todavía ahí, la variación es 75.000 (real) − 50.000 (estimado) = 25.000");
// Se borra SOLO "Domicilio" (como haría "remove-costo-global") SIN limpiar
// cot.compras — así queda exactamente huérfana, como en el reporte real.
// "Empaque" se queda, para que la tabla de "Compras del pedido" (y su
// botón de sincronizar) sigan teniendo algo que mostrar.
cotHuerfanaTest.costosGlobales = cotHuerfanaTest.costosGlobales.filter(function (g) { return g.id !== "cg-huerfana"; });
assert(calcCotGastosRealesTest(cotHuerfanaTest) === 0, "y al quedar huérfana (su costo global ya no existe), YA NO se cuenta como sobrecosto — antes sumaba los 75.000 completos, inflando el costo real para siempre");
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-huerfana-test"]');
click('[data-action="set-cot-tab"][data-id="cot-huerfana-test"][data-val="produccion"]');
click('[data-action="sincronizar-compras-finanzas"][data-id="cot-huerfana-test"]');
const cotHuerfanaTrasSync = state.cotizaciones.find(function (c) { return c.id === "cot-huerfana-test"; });
assert(!!cotHuerfanaTrasSync && cotHuerfanaTrasSync.compras.length === 1, "\"Actualizar movimientos financieros\" limpia SOLO la compra huérfana de la cotización (Domicilio), no las dos");
assert(!state.tx.some(function (t) { return t.id === "tx-huerfana-test"; }), "...y retira su movimiento de Finanzas (ya no hay insumo real detrás)");
// El reporte real del usuario en producción: "Empaque" (que SIGUE
// existiendo en costosGlobales, sin tocar) no se marca huérfana solo por
// haber pulsado el botón — su compra y su tx tienen que sobrevivir intactos.
assert(cotHuerfanaTrasSync.compras[0].clave === "global|cg-se-queda", "...y la compra que SÍ sigue existiendo (Empaque) permanece en la cotización, sin falsos positivos");
assert(state.tx.some(function (t) { return t.id === "tx-se-queda-test"; }), "...su movimiento en Finanzas tampoco se borra — no queda con la insignia \"Origen eliminado\" estando vivo de verdad");
state.pedidos = pedidosPreviosHuerfanaTest; state.cotizaciones = cotizacionesPreviasHuerfanaTest; state.tx = txPreviosHuerfanaTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// --- Reporte real en producción (2026-09-20): a diferencia de un costo
// global (clave = "global|" + su id, estable), la clave de un INSUMO se
// arma con nombre+unidad+tipo (para poder sumar el mismo insumo repetido
// en varias referencias — ver agregarInsumosDeReferencias) — así que
// CORREGIR el nombre de un insumo ya marcado "Sí" (una edición normal,
// nada se borró) cambia esa clave. El usuario reportó exactamente esto:
// "Bordado bolsillero"/"Sublimación"/"Riquelme" con la insignia "Origen
// eliminado" sin que nada estuviera eliminado de verdad.
const pedidosPreviosRenameTest = state.pedidos, cotizacionesPreviasRenameTest = state.cotizaciones, txPreviosRenameTest = state.tx;
const cotRenameTest = {
  id: "cot-rename-test", clienteId: "", cliente: "Cliente Rename", descripcion: "Prueba rename", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-rename-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "chrn1",
  referencias: [{
    id: "r-rename-test", nombre: "Camiseta", imagenUrl: "", consumoAprox: 1, cantidadPedida: 1, precioVenta: 100000, origen: "taller", costoCompra: 0, proveedorId: "",
    // Nombre YA corregido ("Bordado bolsillero" en vez de "Bordado") — la
    // clave actual de calcListaCompras ya no es la que se guardó en
    // cot.compras cuando se marcó "Sí" la primera vez.
    insumos: [{ id: "i-rename-test", nombre: "Bordado bolsillero", unidad: "UND", costo: 8400, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }],
    detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [],
  // Clave vieja (antes de corregir el nombre a "Bordado bolsillero"): ya
  // no coincide con ninguna línea actual.
  compras: [{ clave: "bordado|und|por_prenda", estado: "si", costoReal: 8400, txId: "tx-rename-test" }]
};
state.pedidos = [{
  id: "ped-rename-test", numeroOp: "OP-RENAME", cliente: "Cliente Rename", descripcion: "Prueba",
  cantidad: "1", total: 100000, costo: 8400, abono: 100000, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-rename-test",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [cotRenameTest];
state.tx = [{ id: "tx-rename-test", tipo: "gasto", concepto: "Compra — Bordado — Prueba rename", monto: 8400, contraparte: "", fecha: "2026-01-02", pedidoId: "ped-rename-test", cotizacionId: "cot-rename-test", origenCompraClave: "bordado|und|por_prenda" }];
const { origenSistemaHuerfano: origenHuerfanoRenameTest } = await import("../js/core/calc.js");
assert(!origenHuerfanoRenameTest(state.tx[0]), "sanity: ANTES de sincronizar, la clave vieja de cot.compras y la de la tx siguen coincidiendo entre sí — el mismatch solo se nota al comparar contra calcListaCompras, que es justo lo que hace \"Actualizar movimientos financieros\"");
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-rename-test"]');
click('[data-action="set-cot-tab"][data-id="cot-rename-test"][data-val="produccion"]');
click('[data-action="sincronizar-compras-finanzas"][data-id="cot-rename-test"]');
const cotRenameTrasSync = state.cotizaciones.find(function (c) { return c.id === "cot-rename-test"; });
assert(!!cotRenameTrasSync && cotRenameTrasSync.compras.length === 1, "corregir el NOMBRE de un insumo ya marcado \"Sí\" no lo deja huérfano al sincronizar — sigue en la cotización");
assert(state.tx.some(function (t) { return t.id === "tx-rename-test"; }), "...su movimiento en Finanzas tampoco se borra — nada se eliminó de verdad, solo se corrigió un nombre");
assert(!origenHuerfanoRenameTest(state.tx[0]), "...y ya no aparece con la insignia \"Origen eliminado\" en Finanzas — antes SÍ quedaba así tras pulsar el botón, con el nombre corregido pero nada más");
state.pedidos = pedidosPreviosRenameTest; state.cotizaciones = cotizacionesPreviasRenameTest; state.tx = txPreviosRenameTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// --- Nómina: servicio por defecto de un empleado + "si no alcanza, varios" ---
click('[data-action="tab"][data-tab="pendientes"]');
var costurera = state.config.nomina[0];
click('[data-action="editar-emp"][data-id="' + costurera.id + '"]');
var selectServDefault = document.querySelector('[data-emp-edit-row="' + costurera.id + '"] [data-role="edit-servicio-default"]');
assert(!!selectServDefault, "el modo edición de una persona en nómina ofrece un servicio por defecto");
selectServDefault.value = "Confección";
selectServDefault.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
click('[data-action="guardar-emp-edit"][data-id="' + costurera.id + '"]');
assert(state.config.nomina[0].servicioDefault === "Confección", "guarda el servicio por defecto de la persona");
click('[data-action="toggle-nomina-pago"][data-id="' + costurera.id + '"]');
assert(state.formNominaPago.servicios.length === 1 && state.formNominaPago.servicios[0].nombre === "Confección", "\"Pagar\" precarga el servicio por defecto de esa persona");
// A la costurera se le paga $1.200.000, pero "Confección" solo tiene 20.000
// disponibles — el usuario pidió justo esto: "si no me alcanza, seleccionar
// otro monto". Se agrega una segunda fila con OTRO servicio para cubrir el
// resto; lo que siga faltando sale de Ganancia sin más.
state.cotizaciones = state.cotizaciones.map(function (c) {
  if (c.id !== "cot-servicios-test") return c;
  var refConMedias = Object.assign({}, c.referencias[0], { insumos: c.referencias[0].insumos.concat([{ id: "ins-medias", nombre: "Medias", unidad: "servicio", costo: 200000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }]) });
  return Object.assign({}, c, { referencias: [refConMedias] });
});
var claveMedias = calcListaComprasServ(state.cotizaciones.find(function (c) { return c.id === "cot-servicios-test"; })).filter(function (l) { return l.nombre === "Medias"; })[0].clave;
state.cotizaciones = state.cotizaciones.map(function (c) {
  return c.id === "cot-servicios-test" ? Object.assign({}, c, { compras: c.compras.concat([{ clave: claveMedias, estado: "servicio", costoReal: 2000000 }]) }) : c;
});
render();
click('[data-action="agregar-fila-servicio"][data-form-destino="formNominaPago"]');
setChange('select[data-action-change="set-fila-servicio-nombre"][data-form-destino="formNominaPago"][data-idx="1"]', "Medias");
setChange('input[data-action-change="set-fila-servicio-monto"][data-form-destino="formNominaPago"][data-idx="1"]', "1000000");
setChange('input[data-action-change="set-fila-servicio-monto"][data-form-destino="formNominaPago"][data-idx="0"]', "20000");
var txAntesDePagar = state.tx.length;
click('[data-action="pagar-nomina"][data-id="' + costurera.id + '"]');
assert(state.tx.length === txAntesDePagar + 1, "el pago de nómina se registra: cubrir con VARIOS servicios sí alcanza aunque uno solo no bastara");
var pagoNomina = state.tx[0];
assert(pagoNomina.tipo === "nomina" && pagoNomina.monto === 1200000, "el monto pagado sigue siendo el salario completo");
assert(pagoNomina.serviciosDescuento.length === 2, "queda registrado que se cubrió con LOS DOS servicios");
var totalCubierto = pagoNomina.serviciosDescuento.reduce(function (a, s) { return a + s.monto; }, 0);
assert(totalCubierto === 1020000, "cubierto por servicios: 20.000 (Confección, todo lo que tenía) + 1.000.000 (Medias)");
assert(1200000 - totalCubierto === 180000, "y los 180.000 restantes, al no venir de ningún servicio, salen de la Ganancia (el único monto que puede quedar negativo)");
assert(calcServDisp().filter(function (s) { return s.nombre === "Confección"; })[0].disponible === 0, "\"Confección\" queda en 0 (no negativo)");
assert(calcServDisp().filter(function (s) { return s.nombre === "Medias"; })[0].disponible === 1000000, "\"Medias\" queda con 1.000.000 disponibles (2.000.000 − 1.000.000)");

// --- Auditoría 2026-09-20: los pagos de nómina se identifican por el id del
// empleado, no solo por su nombre — renombrarlo (o tener dos personas con
// el mismo nombre) no debe desconectar sus pagos ya hechos.
assert(pagoNomina.empleadoId === costurera.id, "el tx del pago de nómina queda marcado con el id del empleado");
const { calcNominaPagadaEmpleado: calcNominaPagadaTest } = await import("../js/core/calc.js");
const costureraRenombrada = { id: costurera.id, nombre: costurera.nombre + " (corregido)" };
assert(calcNominaPagadaTest(costureraRenombrada, "mensual") >= 1200000, "renombrar al empleado NO desconecta el pago que ya se le hizo (se busca por empleadoId, no por el nombre viejo que quedó guardado en el tx)");
assert(calcNominaPagadaTest({ id: "otro-id-cualquiera", nombre: costurera.nombre }, "mensual") === 0, "...y otra persona con el MISMO nombre (pero id distinto) no hereda ese pago por error");

// --- Auditoría 2026-09-20: bug de huso horario en periodoKey() para
// periodo "semanal" — new Date(fechaStr) parsea un string como medianoche
// UTC, no local, y en Colombia (UTC-5) eso desfasaba el cálculo justo los
// domingos (el sábado y el domingo caían en la MISMA semana calculada,
// cuando el domingo ya era la siguiente). Se verificó en vivo, ejecutando
// el código real un domingo (2026-09-20): daba "2026-W38" para el sábado
// 19 Y el domingo 20 — deberían ser semanas distintas.
const { periodoKey: periodoKeyTest } = await import("../js/core/calc.js");
assert(periodoKeyTest("2026-09-19", "semanal") === "2026-W38", "periodoKey: sábado 2026-09-19 cae en la semana 38");
assert(periodoKeyTest("2026-09-20", "semanal") === "2026-W39", "periodoKey: domingo 2026-09-20 YA es la semana 39 (antes del fix, daba 38 — la misma que el sábado anterior)");
assert(periodoKeyTest("2026-09-21", "semanal") === "2026-W39", "...y el lunes 2026-09-21 sigue en la semana 39, junto con el domingo");

// Consecuencia real del bug: toggle-gasto-fijo-pagado (pendientes.js)
// reimplementaba esta misma lógica A MANO, con `new Date()` real (sin el
// bug) — así que las dos versiones podían DIVERGIR: marcar pagado un
// domingo con una, y consultar "¿está pendiente?" con la otra, daba
// respuestas distintas. Ahora las dos llaman a periodoKey(): confirma que
// un gasto fijo semanal marcado pagado HOY (cualquier día que sea) se ve
// de inmediato como ya pagado, sin importar qué día de la semana es.
const pedidosPreviosPeriodoKey = state.pedidos, cotizacionesPreviasPeriodoKey = state.cotizaciones;
state.config.gastosFijos = (state.config.gastosFijos || []).concat([{ id: "gf-semanal-test", nombre: "Prueba semanal", monto: 20000, periodo: "semanal", diasPago: [], pagadoHasta: "" }]);
state.tab = "pendientes"; render();
click('[data-action="toggle-gasto-fijo-pagado"][data-id="gf-semanal-test"]');
const gfSemanalTrasPagar = state.config.gastosFijos.find(function (g) { return g.id === "gf-semanal-test"; });
assert(!!gfSemanalTrasPagar && !!gfSemanalTrasPagar.pagadoHasta, "sanity: marcar pagado guarda la clave del periodo actual");
const { calcGastoFijoPendiente: calcGastoFijoPendienteTest } = await import("../js/core/calc.js");
assert(calcGastoFijoPendienteTest(gfSemanalTrasPagar) === 0, "y calcGastoFijoPendiente (la fuente que decide si sigue \"pendiente\") está de acuerdo de inmediato — antes, un desfase de un día podía volver a mostrarlo pendiente el mismo día que se pagó");
state.config.gastosFijos = state.config.gastosFijos.filter(function (g) { return g.id !== "gf-semanal-test"; });
state.pedidos = pedidosPreviosPeriodoKey; state.cotizaciones = cotizacionesPreviasPeriodoKey;

// --- Auditoría 2026-09-20: editar una deuda para bajar "Cuotas" a un valor
// ya cubierto por cuotasPagadas debe moverla al historial (saldada) — antes
// se quedaba "activa" con saldo $0 para siempre, sumando una cuota
// fantasma en "Por pagar" que el botón "Pagar" no podía corregir.
const deudasPreviasCuotasTest = state.deudas, deudasHistorialPreviasCuotasTest = state.deudasHistorial;
state.deudas = [{
  id: "deuda-cuotas-editar-test", concepto: "Préstamo máquina plana", contraparte: "", monto: 600000,
  cuotas: 6, cuotasPagadas: 4, periodo: "mensual", diasPago: [], fechaVencimiento: "", calendarEventId: "",
  historial: [
    { fecha: "2026-01-01", monto: 100000, txId: "tx-cuota-1" }, { fecha: "2026-02-01", monto: 100000, txId: "tx-cuota-2" },
    { fecha: "2026-03-01", monto: 100000, txId: "tx-cuota-3" }, { fecha: "2026-04-01", monto: 100000, txId: "tx-cuota-4" }
  ]
}];
state.deudasHistorial = [];
state.tab = "pendientes"; state.deudasVista = "activas"; render();
click('[data-action="editar-deuda"][data-id="deuda-cuotas-editar-test"]');
document.querySelector('[data-deuda-edit-row="deuda-cuotas-editar-test"] [data-role="edit-cuotas"]').value = "4";
click('[data-action="guardar-deuda-edit"][data-id="deuda-cuotas-editar-test"]');
assert(!state.deudas.some(function (d) { return d.id === "deuda-cuotas-editar-test"; }), "bajar \"Cuotas\" a las ya pagadas mueve la deuda al historial (saldada), no la deja \"activa\" con saldo fantasma");
const deudaSaldadaPorEdicion = state.deudasHistorial.find(function (d) { return d.id === "deuda-cuotas-editar-test"; });
assert(!!deudaSaldadaPorEdicion && deudaSaldadaPorEdicion.cuotas === 4 && deudaSaldadaPorEdicion.cuotasPagadas === 4, "...y aparece en el historial con las cuotas corregidas");
state.deudas = deudasPreviasCuotasTest; state.deudasHistorial = deudasHistorialPreviasCuotasTest;

// --- El usuario reportó: "en resumen no se está viendo reflejado estos
// cambios en sus KPIs de servicios" — el KPI "Ganancia" restaba el
// acumulado BRUTO de cada servicio sin importar si ya se había pagado,
// contando ese pago dos veces (una vez como el gasto/nómina real, otra vez
// como si TODAVÍA estuviera pendiente). ---
var pendientesHoy = calcServPendientes(fechaCotServicios, fechaCotServicios);
var confeccionPendiente = pendientesHoy.filter(function (s) { return s.nombre === "Confección"; })[0];
assert(!!confeccionPendiente && confeccionPendiente.monto === 0, "\"Confección\" ya no resta de Ganancia (se pagó por completo)... pero SIGUE en la lista, en $0 — no se olvida de ella");
var mediasPendiente = pendientesHoy.filter(function (s) { return s.nombre === "Medias"; })[0];
assert(!!mediasPendiente && mediasPendiente.monto === 1000000, "\"Medias\" solo resta lo que TODAVÍA está pendiente (1.000.000), no el acumulado bruto (2.000.000) — ese millón ya salió de Balance por su cuenta, vía la nómina");

// --- El usuario también pidió: "que los campos de servicios sean botones
// que muestren el historial de entradas y salidas". ---
var historialMedias = calcHistorialServicio("Medias");
assert(historialMedias.length === 2 && historialMedias[0].tipo === "entrada" && historialMedias[0].monto === 2000000, "calcHistorialServicio: la entrada es la cotización que marcó \"Medias\" como servicio");
assert(historialMedias[1].tipo === "salida" && historialMedias[1].monto === 1000000, "...y la salida es la nómina que se le asignó");
assert(historialMedias[1].saldo === 1000000, "...con el saldo corriente ya descontado (2.000.000 − 1.000.000)");

// ---------------------------------------------------------------------------
// Una cotización que NUNCA tuvo un pedido real detrás (ni convertida, ni
// escalada desde un pedido rápido) no debe poder acumular "servicio"
// disponible para pagar nómina — es una CLAIM sobre plata ya cobrada, y acá
// no se cobró nada todavía, solo se está cotizando. (Distinto de marcar una
// compra "Sí" y sincronizarla como gasto real: ESO sí puede pasar antes de
// convertir, porque representa dinero que de verdad salió de la caja al
// comprar algo — cierre o no la venta, esa plata ya se gastó. Por eso
// "sincronizar-compras-finanzas" sigue disponible desde el día uno, ver la
// prueba de "movimientos sueltos" más abajo en este archivo.)
// ---------------------------------------------------------------------------
const { calcServiciosPorCategoriaRango: calcServCatBorrador } = await import("../js/core/calc.js");
var cotBorrador = {
  id: "cot-borrador-servicio-test", cliente: "Cliente Borrador", descripcion: "Sin convertir todavía", fecha: fechaCotServicios,
  estado: "borrador", pedidoId: "", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "cbor1",
  referencias: [{
    id: "ref-bor-1", nombre: "Pantalón", imagenUrl: "", consumoAprox: 1, cantidadPedida: 5, precioVenta: 60000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [{ id: "ins-corte-bor", nombre: "Corte", unidad: "servicio", costo: 8000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }],
    detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
};
state.cotizaciones = state.cotizaciones.concat([cotBorrador]);
var claveCorteBorrador = calcListaComprasServ(cotBorrador).filter(function (l) { return l.nombre === "Corte"; })[0].clave;
state.cotizaciones = state.cotizaciones.map(function (c) {
  return c.id === "cot-borrador-servicio-test" ? Object.assign({}, c, { compras: [{ clave: claveCorteBorrador, estado: "servicio", costoReal: 40000 }] }) : c;
});
render();
assert(!calcServCatBorrador().some(function (s) { return s.nombre === "Corte"; }), "una cotización SIN convertir (borrador) marcada \"servicio\" NO cuenta como plata disponible — no hay pedido ni cobro real todavía");

// convertirla sí la hace contar (mismo criterio de siempre, ahora con el
// precondition explícito)
state.cotizaciones = state.cotizaciones.map(function (c) {
  return c.id === "cot-borrador-servicio-test" ? Object.assign({}, c, { estado: "convertida" }) : c;
});
render();
assert(calcServCatBorrador().some(function (s) { return s.nombre === "Corte" && s.monto === 40000; }), "...pero en cuanto se convierte en pedido, sí cuenta (40.000)");

// una cotización ESCALADA (todavía "borrador", pero con un pedido rápido
// real detrás vía pedidoOrigenId) también cuenta, sin necesidad de
// "convertida" — mientras ese pedido rápido siga existiendo de verdad
// (ver el caso contrario justo abajo).
const pedidosPreviosEscServTest = state.pedidos;
state.pedidos = state.pedidos.concat([{
  id: "ped-esc-servicio-real-test", numeroOp: "OP-ESC-SERV", cliente: "Cliente Esc Servicio", descripcion: "Prueba",
  cantidad: "1", total: 100000, costo: 40000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}]);
state.cotizaciones = state.cotizaciones.map(function (c) {
  return c.id === "cot-borrador-servicio-test" ? Object.assign({}, c, { estado: "borrador", pedidoOrigenId: "ped-esc-servicio-real-test" }) : c;
});
assert(calcServCatBorrador().some(function (s) { return s.nombre === "Corte" && s.monto === 40000; }), "y una cotización escalada desde un pedido rápido real (pedidoOrigenId) también cuenta, aunque siga en \"borrador\"");

// Auditoría financiera 2026-09-20: si ese pedido rápido se eliminó DESPUÉS
// de escalar (antes de aplicar la cotización), pedidoOrigenId queda
// "truthy pero obsoleto" — ya no debe contar, mismo patrón que el bug
// hermano de movimientos sueltos (desincronizacion_movimientos_pedido_escalado).
state.pedidos = pedidosPreviosEscServTest; // el pedido "se elimina": ya no existe en state.pedidos
assert(!calcServCatBorrador().some(function (s) { return s.nombre === "Corte"; }), "...pero si ese pedido rápido se elimina antes de aplicar la cotización, deja de contar: pedidoOrigenId truthy ya no basta, tiene que seguir existiendo de verdad");

state.cotizaciones = state.cotizaciones.filter(function (c) { return c.id !== "cot-borrador-servicio-test"; }); // limpieza

click('[data-action="tab"][data-tab="resumen"]');
var tileConfeccion = document.querySelector('[data-action="abrir-historial-servicio"][data-nombre="Confección"]');
assert(!!tileConfeccion && tileConfeccion.textContent.indexOf("$0") >= 0, "el dashboard de Resumen SIGUE mostrando el tile de \"Confección\" en $0 — no desaparece por quedar pagado del todo");
var tileMedias = document.querySelector('[data-action="abrir-historial-servicio"][data-nombre="Medias"]');
assert(!!tileMedias && tileMedias.textContent.indexOf("1.000.000") >= 0, "...pero sí uno para \"Medias\", mostrando lo pendiente (1.000.000), no el acumulado bruto");
click('[data-action="abrir-historial-servicio"][data-nombre="Medias"]');
assert(state.historialServicioAbierto === "Medias", "el tile es un botón: hace clic y abre el historial de ese servicio");
assert(!!document.querySelector(".picker-overlay"), "...con su propio overlay");
assert(document.querySelectorAll(".picker-overlay .tx-row").length >= 3, "...listando la entrada y la salida (más la fila de encabezado)");
click('[data-action="cerrar-historial-servicio"]');
assert(state.historialServicioAbierto === "", "y se cierra igual que los demás pickers de la app");

click('[data-action="tab"][data-tab="pendientes"]');
click('[data-action="toggle-pend-form"][data-key="gastoFijo"]');
setInput('[data-form="gastoFijo"][data-field="nombre"]', "Arriendo");
setInput('[data-form="gastoFijo"][data-field="monto"]', "500000");
click('[data-action="add-gasto-fijo"]');
assert(state.config.gastosFijos.length === 1, "agrega gasto fijo");
assert(state.config.gastosFijos[0].periodo === "mensual", "gasto fijo nace con periodo mensual por defecto");

// ---------------------------------------------------------------------------
// Marcar/desmarcar un gasto fijo como pagado es una pastilla chica que
// parece solo una etiqueta de estado — igual que ya pasaba con la comisión
// de vendedor (toggle-comision), un doble clic sin aviso crea y borra un
// movimiento real sin que el usuario se entere. Debe preguntar en los dos
// sentidos, igual que toggle-comision.
// ---------------------------------------------------------------------------
const idGastoFijo = state.config.gastosFijos[0].id;
const confirmOriginalGastoFijo = global.confirm;
let confirmLlamadasGastoFijo = 0, confirmMsgGastoFijo = null;
global.window.confirm = global.confirm = function (msg) { confirmLlamadasGastoFijo++; confirmMsgGastoFijo = msg; return false; };
const txAntesToggleGastoFijo = state.tx.length;
click('[data-action="toggle-gasto-fijo-pagado"][data-id="' + idGastoFijo + '"]');
assert(confirmLlamadasGastoFijo === 1, "marcar un gasto fijo como pagado SÍ pregunta antes de crear el movimiento");
assert(confirmMsgGastoFijo.indexOf("Arriendo") !== -1 && confirmMsgGastoFijo.indexOf("500.000") !== -1, "...con el nombre y el monto en el aviso");
assert(state.tx.length === txAntesToggleGastoFijo, "cancelar el aviso no crea ningún movimiento");
assert(state.config.gastosFijos[0].pagadoHasta === "", "...ni marca el gasto como pagado");

global.window.confirm = global.confirm = function (msg) { confirmLlamadasGastoFijo++; confirmMsgGastoFijo = msg; return true; };
click('[data-action="toggle-gasto-fijo-pagado"][data-id="' + idGastoFijo + '"]');
assert(state.tx.length === txAntesToggleGastoFijo + 1, "aceptando el aviso, sí se crea el movimiento de gasto");
assert(state.config.gastosFijos[0].pagadoHasta !== "", "...y el gasto queda marcado pagado este periodo");

confirmLlamadasGastoFijo = 0;
global.window.confirm = global.confirm = function (msg) { confirmLlamadasGastoFijo++; confirmMsgGastoFijo = msg; return false; };
click('[data-action="toggle-gasto-fijo-pagado"][data-id="' + idGastoFijo + '"]');
assert(confirmLlamadasGastoFijo === 1, "desmarcarlo (deshacer el pago) TAMBIÉN pregunta");
assert(confirmMsgGastoFijo.indexOf("Deshacer") !== -1, "...con un mensaje distinto, que dice que se va a deshacer");
assert(state.tx.length === txAntesToggleGastoFijo + 1, "cancelar el aviso de deshacer no borra el movimiento");

global.window.confirm = global.confirm = function () { return true; };
click('[data-action="toggle-gasto-fijo-pagado"][data-id="' + idGastoFijo + '"]');
assert(state.tx.length === txAntesToggleGastoFijo, "aceptando, sí se revierte: vuelve a quedar pendiente sin el movimiento");
assert(state.config.gastosFijos[0].pagadoHasta === "", "...y el gasto vuelve a \"pendiente\"");
global.window.confirm = global.confirm = confirmOriginalGastoFijo;

// ---------------------------------------------------------------------------
// El bloqueo de borrado de un gasto fijo pagado antes solo miraba si el
// gasto fijo EXISTÍA, sin mirar el periodo — pero el botón "pagado" solo
// puede revertir el tx del periodo ACTUAL. Un tx de un periodo que ya
// quedó atrás (el gasto fijo se volvió a marcar/desmarcar después, sin
// pasar por ESE tx) debe dejar de estar protegido, igual que cualquier
// otro movimiento cuyo origen ya no lo respalda.
// ---------------------------------------------------------------------------
const { origenSistemaDeTx: origenSisGastoFijoTx, origenSistemaHuerfano: origenHuerfanoGastoFijoTx } = await import("../js/core/calc.js");
global.window.confirm = global.confirm = function () { return true; };
click('[data-action="toggle-gasto-fijo-pagado"][data-id="' + idGastoFijo + '"]');
const txPeriodoViejo = state.tx.find(t => t.gastoFijoId === idGastoFijo);
assert(!!txPeriodoViejo, "se vuelve a marcar pagado, crea su tx de este periodo");
assert(!!origenSisGastoFijoTx(txPeriodoViejo), "protegido mientras es el periodo vigente del gasto fijo");
// Simula que pasó el tiempo: el periodo avanzó (o alguien lo desmarcó desde
// entonces) sin que nadie haya vuelto a tocar ESE tx viejo en particular —
// pagadoHasta ya no coincide con lo que el tx recuerda en su marca.
state.config.gastosFijos = state.config.gastosFijos.map(g => g.id === idGastoFijo ? Object.assign({}, g, { pagadoHasta: "" }) : g);
assert(!origenSisGastoFijoTx(txPeriodoViejo), "un tx de un periodo que ya quedó atrás deja de estar protegido");
assert(!!origenHuerfanoGastoFijoTx(txPeriodoViejo), "...y se reconoce como huérfano: se puede borrar aparte desde Finanzas");
state.tx = state.tx.filter(t => t.id !== txPeriodoViejo.id); // limpieza
global.window.confirm = global.confirm = confirmOriginalGastoFijo;

click('[data-action="toggle-pend-form"][data-key="deuda"]');
setInput('[data-form="deuda"][data-field="concepto"]', "Préstamo máquina");
setInput('[data-form="deuda"][data-field="monto"]', "300000");
click('[data-action="add-deuda"]');
assert(state.deudas.length === 1, "agrega deuda");
assert(state.deudas[0].concepto === "Préstamo máquina", "deuda nace con los datos del formulario");
assert(state.deudasHistorial.length === 0, "deuda recién creada no aparece en el historial (sigue pendiente)");
assert(!state.tx.some(t => t.origenDeudaIngresoId === state.deudas[0].id), "sin marcar el checkbox, la deuda NO crea ningún ingreso en Finanzas (ej. crédito de proveedor, sin plata en efectivo)");

// ---------------------------------------------------------------------------
// Registrar una deuda que SÍ trajo plata en efectivo (un préstamo real):
// antes NINGUNA deuda generaba su ingreso, así que gastar esa plata después
// dejaba Caja/Balance/Ganancia negativos sin explicación. Ahora un checkbox
// explícito ("¿trajo dinero en efectivo?") decide si se crea el tx — nunca
// automático para TODA deuda, porque "deuda" también cubre crédito de
// proveedor (mercancía fiada, sin plata real de por medio). Ver
// CONTABILIDAD.md y calcAbonosPendientesPorPedido para el mismo criterio de
// "no adivinar, preguntar explícito".
// ---------------------------------------------------------------------------
const checkTrajoDinero = document.querySelector('[data-action-change="toggle-deuda-trajo-dinero"]');
assert(!!checkTrajoDinero && !checkTrajoDinero.checked, "el checkbox existe y nace SIN marcar (default seguro: no inventar un ingreso)");
checkTrajoDinero.checked = true;
checkTrajoDinero.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.formDeuda.trajoDineroEfectivo === true, "marcar el checkbox lo guarda en el borrador");
setInput('[data-form="deuda"][data-field="concepto"]', "Préstamo del banco");
setInput('[data-form="deuda"][data-field="monto"]', "3000000");
const txAntesPrestamo = state.tx.length;
click('[data-action="add-deuda"]');
const deudaPrestamo = state.deudas.find(d => d.concepto === "Préstamo del banco");
assert(!!deudaPrestamo, "la deuda se crea igual, con o sin el checkbox");
assert(state.tx.length === txAntesPrestamo + 1, "CON el checkbox marcado, sí se crea un movimiento nuevo en Finanzas");
const txPrestamo = state.tx.find(t => t.origenDeudaIngresoId === deudaPrestamo.id);
assert(!!txPrestamo && txPrestamo.tipo === "ingreso" && txPrestamo.monto === 3000000, "el movimiento es un INGRESO por el monto completo del préstamo");
assert(state.formDeuda.trajoDineroEfectivo === false, "el checkbox se limpia solo después de guardar (no se queda marcado para la siguiente deuda por error)");

const { origenSistemaDeTx: origenSisDeudaTx, origenSistemaHuerfano: origenHuerfanoDeudaTx } = await import("../js/core/calc.js");
assert(!!origenSisDeudaTx(txPrestamo), "el ingreso del préstamo queda protegido contra borrado suelto mientras la deuda exista");

// editar la deuda sincroniza el tx vinculado (mismo criterio que editar un abono)
click('[data-action="editar-deuda"][data-id="' + deudaPrestamo.id + '"]');
const filaEditDeuda = document.querySelector('[data-deuda-edit-row="' + deudaPrestamo.id + '"]');
filaEditDeuda.querySelector('[data-role="edit-monto"]').value = "2800000";
click('[data-action="guardar-deuda-edit"][data-id="' + deudaPrestamo.id + '"]');
assert(state.tx.find(t => t.origenDeudaIngresoId === deudaPrestamo.id).monto === 2800000, "corregir el monto de la deuda actualiza el mismo monto en su ingreso de Finanzas, sin crear uno nuevo");
assert(state.tx.filter(t => t.origenDeudaIngresoId === deudaPrestamo.id).length === 1, "sigue siendo un solo movimiento, no se duplicó al editar");

// eliminar la deuda deja el ingreso suelto (huérfano), igual que ya pasa con
// el historial de pagos — nunca se borra en silencio junto con la deuda.
click('[data-action="remove-deuda"][data-id="' + deudaPrestamo.id + '"]');
assert(!state.deudas.some(d => d.id === deudaPrestamo.id), "eliminar la deuda la saca de la lista");
const txPrestamoTrasBorrar = state.tx.find(t => t.origenDeudaIngresoId === deudaPrestamo.id);
assert(!!txPrestamoTrasBorrar, "...pero el ingreso que ya generó en Finanzas NO se borra con ella");
assert(!origenSisDeudaTx(txPrestamoTrasBorrar), "ya no está protegido (su origen se borró)");
assert(!!origenHuerfanoDeudaTx(txPrestamoTrasBorrar), "y se reconoce como huérfano, para poder borrarlo aparte si ya no corresponde");
state.tx = state.tx.filter(t => t.id !== txPrestamoTrasBorrar.id); // limpieza para no afectar los KPIs de las pruebas siguientes

// --- KPIs sincronizados: "por cobrar" debe reflejar el saldo de pedidos ---
const { calcPorCobrar, calcPorPagar } = await import("../js/core/calc.js");
const pedidoConSaldo = state.pedidos.find(p => (p.total - p.abono) > 0);
assert(!!pedidoConSaldo, "hay al menos un pedido con saldo (para probar el KPI)");
assert(calcPorCobrar() >= (pedidoConSaldo.total - pedidoConSaldo.abono), "Por cobrar incluye el saldo de pedidos");
assert(calcPorPagar() >= (state.deudas[0].monto + state.config.gastosFijos[0].monto), "Por pagar incluye gastos fijos y deudas pendientes");

// ---------------------------------------------------------------------------
// "Por pagar" no incluía los saldos a favor del cliente (sobrepagos): un
// abono mal digitado, o mercancía devuelta, dejaba calcSaldoPedido(p)
// negativo — esa plata es una obligación real del taller (hay que
// devolverla) pero calcPorCobrarPedidos/listaDeudores la descartan sin más
// (saldo > 0), y el KPI "Por pagar" solo miraba seis fuentes que no la
// incluían. Ahora calcSaldosAFavorClientes()/listaSaldosAFavorClientes() la
// suman aparte y se incluyen en calcPorPagar, calcPorPagarDesglose y
// calcResumenPorPagar (tratada como "vencida", igual que una comisión).
// ---------------------------------------------------------------------------
const { calcPorPagarDesglose, calcResumenPorPagar, listaSaldosAFavorClientes, calcSaldosAFavorClientes } = await import("../js/core/calc.js");
const pedidosPreviosSobrepago = state.pedidos;
const porPagarAntesSobrepago = calcPorPagar();
state.pedidos = state.pedidos.concat([{
  id: "ped-sobrepago", numeroOp: "OP-SOBREPAGO", cliente: "Cliente Sobrepago", descripcion: "Pagó de más por error",
  cantidad: "1", total: 100000, costo: 40000, abono: 150000, estado: "entregado", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [{ id: "ab-sobrepago", monto: 150000, fecha: "2026-01-01", metodoPago: "Transferencia" }], lineas: [], stockConsumido: [], vendedor: null
}]);
const sobrepagos = listaSaldosAFavorClientes();
assert(sobrepagos.length === 1 && sobrepagos[0].nombre === "Cliente Sobrepago" && sobrepagos[0].monto === 50000, "listaSaldosAFavorClientes detecta el pedido con saldo negativo (150.000 abonado - 100.000 de total = 50.000 de más)");
assert(calcSaldosAFavorClientes() === 50000, "calcSaldosAFavorClientes suma esos 50.000");
assert(Math.abs(calcPorPagar() - porPagarAntesSobrepago - 50000) < 1, "\"Por pagar\" ahora sube esos mismos 50.000");
const desgloseConSobrepago = calcPorPagarDesglose();
const categoriaSobrepago = desgloseConSobrepago.find(c => c.categoria === "Saldos a favor de clientes");
assert(!!categoriaSobrepago && categoriaSobrepago.monto === 50000, "el desglose de \"Por pagar\" (Pendientes) trae una categoría propia para esto");
const resumenConSobrepago = calcResumenPorPagar();
assert(resumenConSobrepago.estado === "vencidas", "el saldo a favor se trata como urgente (\"vencida\"), no tiene una fecha propia que esperar");

// un pedido CANCELADO con saldo negativo no cuenta (esa venta no se completó)
state.pedidos = state.pedidos.map(p => p.id === "ped-sobrepago" ? Object.assign({}, p, { cancelado: true }) : p);
assert(listaSaldosAFavorClientes().length === 0, "un pedido cancelado con saldo a favor no cuenta (esa venta no se va a completar)");
state.pedidos = pedidosPreviosSobrepago;

// --- pagar una deuda de pago único: debe salir de "pendientes" y moverse
// entera (no como un simple cambio de estado) al historial de deudas ---
const idDeudaPagada = state.deudas[0].id;
click('[data-action="pagar-deuda"][data-id="' + idDeudaPagada + '"]');
assert(state.deudas.length === 0, "deuda pagada por completo sale de la lista de pendientes");
assert(state.deudasHistorial.length === 1, "deuda pagada por completo se mueve al historial de deudas");
assert(state.deudasHistorial[0].id === idDeudaPagada, "el registro movido al historial es la misma deuda");
assert(state.deudasHistorial[0].concepto === "Préstamo máquina", "el historial conserva los datos de la deuda");
assert(!!state.deudasHistorial[0].fechaCompletada, "el historial guarda la fecha en que quedó saldada");
assert(state.tx.some(t => t.concepto.includes("Préstamo máquina")), "pagar la deuda crea un movimiento de gasto en Finanzas");

// --- el KPI "Por pagar" debe subir según el valor de la CUOTA, no el monto
// total de una deuda en cuotas (evita mostrar como "por pagar ya" toda la
// deuda cuando solo vence la siguiente cuota) ---
const porPagarAntesDeudaEnCuotas = calcPorPagar();
setInput('[data-form="deuda"][data-field="concepto"]', "Máquina fileteadora");
setInput('[data-form="deuda"][data-field="monto"]', "900000");
setInput('[data-form="deuda"][data-field="cuotas"]', "3");
click('[data-action="add-deuda"]');
const deudaEnCuotas = state.deudas.find(d => d.concepto === "Máquina fileteadora");
assert(!!deudaEnCuotas && deudaEnCuotas.cuotas === 3, "agrega deuda en 3 cuotas de $300.000 cada una");
const incrementoPorPagar = calcPorPagar() - porPagarAntesDeudaEnCuotas;
assert(Math.abs(incrementoPorPagar - 300000) < 1, "Por pagar sube según el valor de la cuota ($300.000), no el monto total de la deuda ($900.000)");

// ---------------------------------------------------------------------------
// "Deshacer último pago": antes el mensaje de bloqueo de Finanzas prometía
// una ruta de reversión en Pendientes → Deudas que no existía de verdad —
// un clic por error en "Pagar" dejaba el movimiento atrapado para siempre.
// ---------------------------------------------------------------------------
const confirmOriginalDeuda = global.confirm;
global.window.confirm = global.confirm = function () { return true; };
click('[data-action="pagar-deuda"][data-id="' + deudaEnCuotas.id + '"]');
let deudaCuotasTrasPago1 = state.deudas.find(d => d.id === deudaEnCuotas.id);
assert(deudaCuotasTrasPago1.cuotasPagadas === 1, "se paga la cuota 1 de 3");
const txCuota1 = state.tx.find(t => t.deudaId === deudaEnCuotas.id);
assert(!!txCuota1, "y crea su movimiento en Finanzas");
assert(deudaCuotasTrasPago1.historial[deudaCuotasTrasPago1.historial.length - 1].txId === txCuota1.id, "el historial de la deuda guarda el id de ESE movimiento");

let confirmLlamadasDeuda = 0;
global.window.confirm = global.confirm = function () { confirmLlamadasDeuda++; return false; };
click('[data-action="deshacer-pago-deuda"][data-id="' + deudaEnCuotas.id + '"]');
assert(confirmLlamadasDeuda === 1, "deshacer el último pago SÍ pregunta antes de tocar nada");
assert(state.tx.some(t => t.id === txCuota1.id), "cancelar el aviso no borra el movimiento");
assert(state.deudas.find(d => d.id === deudaEnCuotas.id).cuotasPagadas === 1, "...ni resta la cuota pagada");

global.window.confirm = global.confirm = function () { return true; };
click('[data-action="deshacer-pago-deuda"][data-id="' + deudaEnCuotas.id + '"]');
assert(!state.tx.some(t => t.id === txCuota1.id), "aceptando, SÍ se retira el movimiento de Finanzas");
deudaCuotasTrasPago1 = state.deudas.find(d => d.id === deudaEnCuotas.id);
assert(deudaCuotasTrasPago1.cuotasPagadas === 0, "...y la cuota vuelve a quedar pendiente (0 de 3)");
assert(deudaCuotasTrasPago1.historial.length === 0, "...con su línea de historial también retirada");

// pagar las 3 cuotas hasta saldarla, y deshacer la ÚLTIMA (la que la saldó)
// desde la vista de Historial — debe volver a Activas, no quedarse a medias
click('[data-action="pagar-deuda"][data-id="' + deudaEnCuotas.id + '"]');
click('[data-action="pagar-deuda"][data-id="' + deudaEnCuotas.id + '"]');
click('[data-action="pagar-deuda"][data-id="' + deudaEnCuotas.id + '"]');
assert(!state.deudas.some(d => d.id === deudaEnCuotas.id), "al pagar la 3ª cuota, la deuda sale de \"activas\"");
let deudaSaldada = state.deudasHistorial.find(d => d.id === deudaEnCuotas.id);
assert(!!deudaSaldada && !!deudaSaldada.fechaCompletada, "...y se mueve entera al historial, saldada");
const txCuota3 = state.tx.find(t => t.deudaId === deudaEnCuotas.id);
assert(!!txCuota3, "la 3ª cuota también dejó su movimiento en Finanzas");

click('[data-action="deudas-vista"][data-val="historial"]');
click('[data-action="deshacer-pago-deuda"][data-id="' + deudaEnCuotas.id + '"]');
assert(!state.tx.some(t => t.id === txCuota3.id), "deshacer desde el Historial retira el movimiento de la 3ª cuota");
assert(!state.deudasHistorial.some(d => d.id === deudaEnCuotas.id), "...saca la deuda del historial de saldadas");
const deudaDeVueltaActiva = state.deudas.find(d => d.id === deudaEnCuotas.id);
assert(!!deudaDeVueltaActiva, "...y la devuelve a \"activas\"");
assert(deudaDeVueltaActiva.cuotasPagadas === 2, "con 2 de 3 cuotas pagadas (la 3ª es la que se deshizo)");
assert(deudaDeVueltaActiva.fechaCompletada === "", "y ya no figura como saldada");
click('[data-action="deudas-vista"][data-val="activas"]');

// un pago de ANTES de que existiera este botón (sin txId en su línea de
// historial) no se debe adivinar ni descuadrar: se avisa y no se toca nada.
const alertOriginalDeuda = global.alert;
let alertMsgDeuda = null;
state.deudas = state.deudas.map(d => d.id === deudaEnCuotas.id
  ? Object.assign({}, d, { historial: d.historial.concat([{ fecha: "2020-01-01", monto: 300000 }]) })
  : d);
const txCountAntesAlertaDeuda = state.tx.length;
global.window.alert = global.alert = function (msg) { alertMsgDeuda = msg; };
click('[data-action="deshacer-pago-deuda"][data-id="' + deudaEnCuotas.id + '"]');
assert(!!alertMsgDeuda && alertMsgDeuda.indexOf("antes de que existiera") !== -1, "un pago viejo sin txId avisa que no se puede deshacer solo, en vez de adivinar cuál movimiento le corresponde");
assert(state.tx.length === txCountAntesAlertaDeuda, "...y no toca ningún movimiento de Finanzas");
assert(state.deudas.find(d => d.id === deudaEnCuotas.id).cuotasPagadas === 2, "...ni cambia las cuotas pagadas");
global.window.alert = global.alert = alertOriginalDeuda;
global.window.confirm = global.confirm = confirmOriginalDeuda;

// --- cotizaciones: Historial es siempre un resumen chico; abrirlo manda al
// detalle completo en la otra pestaña (state.cotizacionEditando) ---
const cotConvertida = state.cotizaciones[0];
assert(state.cotizacionEditando === "", "convertir cierra el editor de la cotización");
click('[data-action="tab"][data-tab="cotizaciones"]');
click('[data-action="cot-vista"][data-val="historial"]');
assert(!!document.querySelector('[data-action="abrir-cotizacion-editor"][data-id="' + cotConvertida.id + '"]'), "el historial muestra un resumen de la cotización convertida");
click('[data-action="abrir-cotizacion-editor"][data-id="' + cotConvertida.id + '"]');
assert(state.cotizacionEditando === cotConvertida.id && state.cotizacionesVista === "nueva", "abrir desde el historial abre el detalle completo");
assert(!!document.querySelector('.cot-card[data-cot-id="' + cotConvertida.id + '"]'), "el detalle completo se renderiza en la pestaña de edición");

// --- cotizaciones: el cliente de una cotización YA EXISTENTE (no solo la
// del formulario de "nueva") también se elige del buscador de contactos —
// el usuario aclaró que era justo ESTE campo el que le faltaba: "cuando
// dupliqué el pedido necesitaba cambiarle el cliente... no salía la opción
// para seleccionar un cliente existente". ---
state.clientes = state.clientes.concat([
  { id: "cli-recambio", nombre: "Cliente Recambio", tipoRelacion: "cliente", cedula: "", ciudad: "", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] }
]);
render();
assert(!document.querySelector(".cot-cliente-input"), "la cabecera de una cotización ya no tiene un input de texto libre para el cliente");
click('[data-action="abrir-cliente-picker-cotizacion-editar"][data-id="' + cotConvertida.id + '"]');
assert(!!document.querySelector(".picker-overlay"), "el mismo buscador de contactos se abre desde la cabecera de una cotización ya existente");
assert(state.clientePickerCotizacionId === cotConvertida.id, "...y sabe para cuál cotización es, para no editar la equivocada");
setInput("#inp-cliente-picker-buscar", "Recambio");
render(); // data-live-filter debounce; el estado ya quedó actualizado, solo falta repintar
click('[data-action="seleccionar-cliente-picker-cotizacion-editar"][data-id="cli-recambio"]');
const cotRenombrada = state.cotizaciones.find(c => c.id === cotConvertida.id);
assert(cotRenombrada.clienteId === "cli-recambio" && cotRenombrada.cliente === "Cliente Recambio", "elegir un contacto desde la cabecera vincula clienteId Y el nombre de ESA cotización, no del formulario de \"nueva\"");
assert(!state.clientePickerAbierto && state.clientePickerCotizacionId === "", "cierra el buscador y limpia a cuál cotización apuntaba (para no engancharla por error la próxima vez)");
render();
const botonClienteCabecera = document.querySelector('[data-action="abrir-cliente-picker-cotizacion-editar"][data-id="' + cotConvertida.id + '"]');
assert(botonClienteCabecera.textContent === "Cliente Recambio", "el botón de la cabecera muestra SOLO el nombre — el usuario pidió \"no tan exagerado\", nada de ✓/ciudad/\"— cambiar\" ahí");

// --- pedidos: comisión de vendedor ---
// Pedidos ahora se divide en pestañas "+ Nuevo pedido" / "Historial" (mismo
// patrón que Cotizaciones) — tras convertir la cotización quedó viendo el
// Historial (para mostrar el pedido recién creado), así que hay que volver
// explícitamente al formulario en blanco antes de poder llenarlo de nuevo.
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
elegirClientePedido("Cliente Prueba");
click('[data-action="add-pedido-linea-libre"]');
const lineaVendedorId = state.formPedido.lineas[0].id;
setLinea(lineaVendedorId, "productoNombre", "Pedido con vendedor");
setLinea(lineaVendedorId, "cantidad", "1");
setLinea(lineaVendedorId, "precioUnitario", "200000");
// La sección de vendedor nace recogida (no todo pedido tiene comisión).
click('[data-action="toggle-pedido-vendedor"]');
setInput('[data-form="pedido"][data-field="vendedorNombre"]', "Ana Vendedora");
setChange('[data-action-change="set-form-pedido-campo"][data-campo="vendedorValor"]', "10");
click('[data-action="add-pedido"]');
const pedidoConVendedor = state.pedidos.find(p => p.vendedor && p.vendedor.nombre === "Ana Vendedora");
assert(!!pedidoConVendedor, "crea pedido con vendedor/comisión");
assert(pedidoConVendedor.total === 200000, "el total del pedido con vendedor sale de su línea");
assert(pedidoConVendedor.vendedor.estado === "pendiente", "la comisión nace pendiente");
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoConVendedor.id + '"]');
const txAntes = state.tx.length;
click('[data-action="toggle-comision"][data-id="' + pedidoConVendedor.id + '"]');
assert(state.pedidos.find(p => p.id === pedidoConVendedor.id).vendedor.estado === "pagado", "marca la comisión como pagada");
assert(state.tx.length === txAntes + 1 && state.tx[0].tipo === "comision", "pagar la comisión crea un movimiento en Finanzas");

// --- productos: pestañas "+ Nuevo producto" / "Catálogo" (cards visuales,
// NO un historial de eventos) — mismo patrón que Cotizaciones/Pedidos/Clientes ---
click('[data-action="tab"][data-tab="productos"]');
assert(state.productosVista === "nueva" && !!document.querySelector('[data-form="producto"][data-field="nombre"]'), "Catálogo entra mostrando el formulario chico en blanco");
setInput('[data-form="producto"][data-field="nombre"]', "Camiseta básica algodón");
setInput('[data-form="producto"][data-field="categoria"]', "Camisetas");
setInput('[data-form="producto"][data-field="referencia"]', "CAM-001");
click('[data-action="add-producto"]');
const productoId = state.productos[state.productos.length - 1].id;
assert(!!productoId, "crea producto en el catálogo");
assert(state.productoEditando === productoId, "tras crear, deja abierto el detalle completo del producto recién creado");

document.querySelector('[data-role="nueva-talla-' + productoId + '"]').value = "M";
click('[data-action="add-pro-talla"][data-id="' + productoId + '"]');
assert(state.productos.find(p => p.id === productoId).variantesTalla.length === 1, "agrega talla al producto");
const precioInput = document.querySelector('input[data-action-change="set-pro-campo"][data-id="' + productoId + '"][data-campo="precioVenta"]');
precioInput.value = "40000";
precioInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
document.querySelector('[data-role="stock-cantidad-' + productoId + '"]').value = "20";
click('[data-action="add-pro-stock"][data-id="' + productoId + '"]');
let producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 20, "registra entrada de stock (20 unidades talla M)");
assert(producto.movimientosStock.length === 1, "el movimiento de stock queda en la bitácora");

// insumos: colapsado por defecto (sección "Costeo y producción") hasta que se
// usa. El acceso al catálogo de insumos es el explorador modal, no un <select>.
assert(!document.querySelector('[data-action="abrir-insumo-picker-producto"][data-pro="' + productoId + '"]'), "la sección de insumos nace colapsada");
click('[data-action="toggle-producto-costeo"][data-id="' + productoId + '"]');
assert(!!document.querySelector('[data-action="abrir-insumo-picker-producto"][data-pro="' + productoId + '"]'), "se puede desplegar la sección de insumos");

// pestaña "Catálogo": índice visual en cards — clic en una abre su detalle completo
click('[data-action="cerrar-producto-editor"]');
click('[data-action="producto-vista"][data-val="catalogo"]');
assert(!!document.querySelector('.tarjeta-mini[data-id="' + productoId + '"]'), "el producto creado aparece como card visual en el Catálogo");
click('[data-action="abrir-producto-editor"][data-id="' + productoId + '"]');
assert(state.productoEditando === productoId && state.productosVista === "nueva", "la card abre el detalle completo en la otra pestaña");

// --- pedidos: explorador de productos del catálogo (busca por nombre,
// referencia o categoría), venta directa descuenta stock, y se restituye si el
// pedido se elimina. Elegir un producto lo agrega DIRECTO como línea: ya no
// queda "seleccionado" en un segundo mini-formulario aparte. ---
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
elegirClientePedido("Cliente Prueba");
click('[data-action="abrir-producto-picker-pedido"]');
assert(state.pedidoProductoPickerAbierto === true, "abre el explorador de productos del catálogo");
setInput('#inp-producto-picker-pedido-buscar', "CAM-001");
render(); // data-live-filter debounce; el estado ya quedó actualizado, solo falta repintar
assert(!!document.querySelector('[data-action="select-producto-pedido-picker"][data-id="' + productoId + '"]'), "el explorador encuentra el producto por referencia (no solo por nombre)");
click('[data-action="select-producto-pedido-picker"][data-id="' + productoId + '"]');
assert(state.formPedido.lineas.length === 1 && state.formPedido.lineas[0].productoId === productoId, "elegir el producto lo agrega de una vez como línea del pedido");
assert(state.formPedido.lineas[0].precioUnitario === 40000, "la línea llega con el precio del catálogo");
assert(!!document.querySelector('[data-action="ver-producto-en-catalogo"][data-id="' + productoId + '"]'), "muestra un enlace para verificar el producto en el Catálogo");
const lineaCatalogoId = state.formPedido.lineas[0].id;
setLinea(lineaCatalogoId, "cantidad", "3");
assert(state.formPedido.lineas[0].cantidad === 3, "se puede ajustar la cantidad en la propia línea");
click('[data-action="add-pedido"]');
const pedidoVentaDirecta = state.pedidos.find(p => (p.stockConsumido || []).length > 0);
assert(!!pedidoVentaDirecta, "crea el pedido de venta directa con el producto");
assert(pedidoVentaDirecta.total === 120000, "el total sale de la línea de catálogo (3 x $40.000)");
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 17, "el stock baja al crear el pedido (20 - 3 = 17)");
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoVentaDirecta.id + '"]');
click('[data-action="remove-pedido"][data-id="' + pedidoVentaDirecta.id + '"]');
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 20, "el stock se restituye al eliminar el pedido");

// --- BUG REPORTADO: pedir un producto dos veces cuando solo hay 1 en stock
// no debe alcanzar a "pasar" (cada línea se valida contra el stock RESTANDO lo
// que las otras líneas del mismo borrador ya apartaron), y cancelar el pedido
// debe devolver EXACTAMENTE lo que se descontó — nunca de más (antes el pedido
// guardaba lo PEDIDO, no lo aplicado, y al cancelar se restituía de más). ---
click('[data-action="tab"][data-tab="productos"]');
click('[data-action="producto-vista"][data-val="nueva"]');
click('[data-action="cerrar-producto-editor"]');
setInput('[data-form="producto"][data-field="nombre"]', "Camiseta unica");
click('[data-action="add-producto"]');
const prodUnicoId = state.productos[state.productos.length - 1].id;
document.querySelector('[data-role="nueva-talla-' + prodUnicoId + '"]').value = "M";
click('[data-action="add-pro-talla"][data-id="' + prodUnicoId + '"]');
document.querySelector('[data-role="stock-cantidad-' + prodUnicoId + '"]').value = "1";
click('[data-action="add-pro-stock"][data-id="' + prodUnicoId + '"]');
assert(state.productos.find(p => p.id === prodUnicoId).variantesTalla[0].stock === 1, "producto de prueba nace con 1 solo en stock");

click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
elegirClientePedido("Cliente Prueba");
click('[data-action="abrir-producto-picker-pedido"]');
setInput('#inp-producto-picker-pedido-buscar', "Camiseta unica");
render();
click('[data-action="select-producto-pedido-picker"][data-id="' + prodUnicoId + '"]');
assert(state.formPedido.lineas.length === 1, "primera línea de 1 unidad se agrega (había 1 en stock)");
// Segunda línea del MISMO producto: el borrador ya apartó la única unidad que
// había, así que el explorador la rechaza en vez de dejar armar un pedido que
// después no se va a poder crear.
click('[data-action="abrir-producto-picker-pedido"]');
click('[data-action="select-producto-pedido-picker"][data-id="' + prodUnicoId + '"]');
assert(state.formPedido.lineas.length === 1, "no deja agregar una segunda línea si el borrador ya apartó todo el stock");
// Subir la cantidad de la línea que sí existe también se topa en lo que hay.
setLinea(state.formPedido.lineas[0].id, "cantidad", "5");
assert(state.formPedido.lineas[0].cantidad === 1, "la cantidad de la línea se topa en el stock real (1)");

click('[data-action="add-pedido"]');
const pedidoUnico = state.pedidos.find(p => (p.stockConsumido || []).some(l => l.productoId === prodUnicoId));
assert(!!pedidoUnico && pedidoUnico.stockConsumido[0].cantidad === 1, "el pedido registra exactamente 1 unidad consumida");
assert(state.productos.find(p => p.id === prodUnicoId).variantesTalla[0].stock === 0, "el stock queda en 0 tras crear el pedido");
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoUnico.id + '"]');
click('[data-action="remove-pedido"][data-id="' + pedidoUnico.id + '"]');
assert(state.productos.find(p => p.id === prodUnicoId).variantesTalla[0].stock === 1, "al cancelar el pedido, el stock vuelve EXACTO a 1 (no 2, no 3)");

// --- "Tallas y observaciones": columna "Prendas" (2026-09, se agregó para
// poder importar listados de equipos que traen, además de nombre/talla/
// número/tipo, qué prendas le corresponden a cada integrante — ej. un
// arquero que solo lleva "Camiseta" mientras el resto lleva "Conjunto").
// parseDetalleFilas es la ÚNICA puerta de entrada tanto para el CSV como
// para el Excel (ver utils.js) — probarla directo alcanza para cubrir ambos
// caminos de importación sin necesitar un stub de SheetJS. ---
{
  const { parseDetalleFilas } = await import("../js/core/utils.js");
  const filas = parseDetalleFilas([
    ["#", "Nombre", "Talla", "Numero", "Tipo", "Prendas", "Observaciones"],
    [1, "Reinaldo.G", "M", 11, "jugador", "Conjunto", ""],
    [2, "G.Arias", "L", 8, "jugador", "Camiseta", "Solo camiseta"]
  ]);
  assert(filas.length === 2, "parseDetalleFilas reconoce las dos filas con datos");
  assert(filas[0].prendas === "Conjunto" && filas[1].prendas === "Camiseta", "la columna 'Prendas' (con mayúscula, como la exportan las plantillas de equipos) se mapea al campo prendas de cada fila");
  assert(filas[0].nombre === "Reinaldo.G" && filas[0].talla === "M" && filas[0].numero === "11", "el resto de columnas sigue mapeando igual que antes de agregar 'Prendas'");
  const filaSingular = parseDetalleFilas([["nombre", "prenda"], ["Ana", "Pantaloneta"]]);
  assert(filaSingular[0].prendas === "Pantaloneta", "también acepta el encabezado en singular 'prenda'");
}

// --- cotizaciones: aplicar un producto del catálogo a una referencia también
// descuenta stock — pero solo al convertir en pedido, agrupando las filas de
// "Tallas y observaciones" por talla ---
click('[data-action="tab"][data-tab="cotizaciones"]');
click('[data-action="cerrar-cotizacion-editor"]'); // la pestaña "nueva" seguía mostrando el detalle de la cotización abierta antes
elegirClienteCotizacion("Cliente Prueba");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Uniformes con producto de catálogo");
click('[data-action="add-cotizacion"]');
const cotProdId = state.cotizaciones[0].id;
const refProdId = state.cotizaciones[0].referencias[0].id;
const aplicarProductoSelect = document.querySelector('select[data-action-change="aplicar-producto"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
aplicarProductoSelect.value = productoId;
aplicarProductoSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.cotizaciones[0].referencias[0].productoId === productoId, "vincula la referencia al producto del catálogo");
// Abrir/cerrar "Opciones adicionales" es solo una preferencia de vista (¿se
// ve expandida o no?), no una edición real — no debe hacer aparecer el botón
// flotante de "Guardar" por sí sola. Se limpia cotSucia antes (ya estaba
// sucia por el aplicar-producto de arriba) para aislar el efecto de ESTE
// clic puntual.
state.cotSucia = "";
click('[data-action="toggle-ref-seccion"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
assert(state.cotizaciones[0].referencias[0].seccionOpcionalesAbierta === true, "el clic sí abre la sección de verdad");
assert(state.cotSucia === "", "pero abrirla NO marca la cotización como 'cambios sin guardar' — antes sí, y aparecía el botón de Guardar solo con mirar");
document.querySelector('[data-role="det-nombre-' + refProdId + '"]').value = "Talla M unidad 1";
document.querySelector('[data-role="det-talla-' + refProdId + '"]').value = "M";
document.querySelector('[data-role="det-prendas-' + refProdId + '"]').value = "Conjunto";
click('[data-action="add-ref-detalle"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
document.querySelector('[data-role="det-nombre-' + refProdId + '"]').value = "Talla M unidad 2";
document.querySelector('[data-role="det-talla-' + refProdId + '"]').value = "M";
document.querySelector('[data-role="det-prendas-' + refProdId + '"]').value = "Camiseta";
click('[data-action="add-ref-detalle"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
var detalleProdTrasAgregar = state.cotizaciones[0].referencias[0].detalle;
assert(detalleProdTrasAgregar[0].prendas === "Conjunto" && detalleProdTrasAgregar[1].prendas === "Camiseta", "el formulario manual de 'Agregar fila' guarda la columna Prendas por fila");
assert(document.querySelector('input[data-campo="prendas"][data-item="' + detalleProdTrasAgregar[0].id + '"]').value === "Conjunto", "la tabla de Tallas y observaciones muestra la columna Prendas ya guardada, no solo en el state");
setChange('input[data-campo="prendas"][data-item="' + detalleProdTrasAgregar[0].id + '"]', "Conjunto + medias");
assert(state.cotizaciones[0].referencias[0].detalle[0].prendas === "Conjunto + medias", "editar la celda 'Prendas' en el sitio actualiza esa fila, igual que ya podía hacerse con tipo/observaciones");
click('[data-action="convertir-cotizacion"][data-id="' + cotProdId + '"]');
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 18, "convertir la cotización descuenta 2 unidades de stock (20 - 2 = 18) según las filas de talla M");

// --- pedidos: consignación con remisión (envío con soporte en PDF),
// seguimiento por talla y venta reportada contra una línea puntual.
// Una consignación se crea con lo que se le deja al punto (líneas de
// catálogo, que salen del stock del taller como su primera remisión) y el
// precio al público acordado con él. ---
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
elegirClientePedido("Cliente Prueba");
click('[data-action="set-tipo-pedido"][data-val="consignacion"]');
click('[data-action="abrir-producto-picker-pedido"]');
click('[data-action="select-producto-pedido-picker"][data-id="' + productoId + '"]');
assert(state.formPedido.lineas.length === 1, "agrega al punto un producto del catálogo");
assert(Number(state.formPedido.consignacionPrecioUnitario) === 40000, "precarga el precio al público con el del catálogo");
setChange('[data-action-change="set-form-pedido-campo"][data-campo="consignacionComisionValor"]', "20");
click('[data-action="add-pedido"]');
const pedidoConsig = state.pedidos.find(p => p.consignacion);
assert(!!pedidoConsig, "crea pedido de consignación");
assert(pedidoConsig.consignacion.remisiones.length === 1, "lo entregado queda como la primera remisión, con su PDF");
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 17, "lo entregado al punto sale del stock del taller (18 - 1 = 17)");
click('[data-action="iniciar-remision"][data-id="' + pedidoConsig.id + '"]');
const remisionProductoSelect = document.querySelector('select[data-action-change="set-remision-producto-sel"]');
remisionProductoSelect.value = productoId;
remisionProductoSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
document.querySelector('[data-role="remision-cantidad"]').value = "5";
click('[data-action="add-remision-linea"][data-id="' + pedidoConsig.id + '"]');
assert(state.remisionBuilder.items.length === 1, "agrega una línea a la remisión en construcción");
click('[data-action="confirmar-remision"][data-id="' + pedidoConsig.id + '"]');
let pedidoConsigActualizado = state.pedidos.find(p => p.id === pedidoConsig.id);
assert(pedidoConsigActualizado.consignacion.remisiones.length === 2, "confirma la remisión (la del envío inicial más esta)");
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 12, "la remisión descuenta el stock del taller (17 - 5 = 12)");
click('[data-action="generar-pdf-remision"][data-id="' + pedidoConsig.id + '"][data-remision="' + pedidoConsigActualizado.consignacion.remisiones[0].id + '"]');
assert(!state.lastError, "generar el PDF de la remisión no rompe el render aunque jsPDF no esté cargado");

const ventaItemSelect = document.querySelector('select[data-role="consig-venta-item"]');
assert(!!ventaItemSelect, "el formulario de venta ofrece elegir producto y talla cuando el pedido ya tiene remisiones");
ventaItemSelect.value = productoId + "|M";
ventaItemSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
document.querySelector('[data-role="consig-venta-cantidad"]').value = "2";
click('[data-action="registrar-venta-consignacion"][data-id="' + pedidoConsig.id + '"]');
pedidoConsigActualizado = state.pedidos.find(p => p.id === pedidoConsig.id);
assert(pedidoConsigActualizado.consignacion.ventas.length === 1, "registra la venta contra la línea del producto");
assert(pedidoConsigActualizado.consignacion.ventas[0].montoTotal === 80000, "calcula el monto con el precio de esa línea (2 x $40.000)");

const { calcConsignacionDisponiblePorTalla } = await import("../js/core/calc.js");
const seguimiento = calcConsignacionDisponiblePorTalla(pedidoConsigActualizado);
assert(seguimiento[0].enviado === 6, "el seguimiento por talla suma las dos remisiones (1 + 5 = 6 enviadas)");
assert(seguimiento[0].disponible === 4, "el seguimiento por talla refleja lo vendido (6 enviadas - 2 vendidas = 4 disponibles)");

// --- comisión de vendedor: desmarcar "pagada" debe revertir el movimiento
// de verdad (no solo la etiqueta) — si no, volver a marcarla pagada crea un
// segundo movimiento duplicado para la misma comisión. ---
const txAntesToggle = state.tx.length;
click('[data-action="toggle-comision"][data-id="' + pedidoConVendedor.id + '"]');
assert(state.pedidos.find(p => p.id === pedidoConVendedor.id).vendedor.estado === "pendiente", "desmarca la comisión como pendiente");
assert(state.tx.length === txAntesToggle - 1, "desmarcarla revierte (borra) el movimiento que se había creado, no lo deja huérfano");
click('[data-action="toggle-comision"][data-id="' + pedidoConVendedor.id + '"]');
assert(state.tx.length === txAntesToggle, "volver a marcarla pagada crea un solo movimiento (no quedan dos por la misma comisión)");

// --- DINERO: los dos lados de un abono nunca pueden separarse ---
// El pedido dice cuánto se le abonó; Finanzas dice cuánta plata entró. Si uno
// se puede tocar sin el otro, la app miente en alguna de las dos pantallas.
const { calcAbonadoDeLista, calcSaldoPedido } = await import("../js/core/calc.js");
// `pedidoId` es el primer pedido creado más arriba: 40 camisetas por $400.000
// con un abono inicial de $100.000.
let pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(!!pedDinero && pedDinero.abono === 100000, "hay un pedido con abonos para probar la sincronía del dinero");
assert(pedDinero.abono === calcAbonadoDeLista(pedDinero.abonos), "el abonado del pedido es exactamente la suma de sus abonos");

// un reembolso RESTA del abonado (vive en la misma lista pero con signo)
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="historial"]');
if (!state.pedidoPanelAbierto[pedidoId]) click('[data-action="toggle-pedido-panel"][data-id="' + pedidoId + '"]');
// toggle-reembolso-form limpia el borrador al abrirse: hay que llenarlo después.
click('[data-action="toggle-reembolso-form"][data-id="' + pedidoId + '"]');
state.formReembolso = { monto: "30000", fecha: "2026-01-15", motivo: "prueba" };
click('[data-action="add-reembolso"][data-id="' + pedidoId + '"]');
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 70000, "el reembolso baja el abonado del pedido (100.000 - 30.000)");
assert(pedDinero.abono === calcAbonadoDeLista(pedDinero.abonos), "tras el reembolso el abonado sigue cuadrando con la lista");

// editar un abono en un pedido QUE YA TIENE UN REEMBOLSO no puede volver a
// sumar ese reembolso (antes se recalculaba sumando todas las filas, y el
// reembolso —que debe restar— inflaba el abonado y borraba saldo por cobrar real)
const abonoEditableId = pedDinero.abonos.find(a => a.tipo !== "reembolso").id;
click('[data-action="editar-abono"][data-id="' + abonoEditableId + '"]');
setChange('[data-abono-edit-row="' + abonoEditableId + '"] [data-role="edit-abono-monto"]', "120000");
click('[data-action="guardar-abono-edit"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 90000, "editar un abono con un reembolso de por medio da 120.000 - 30.000 = 90.000 (el reembolso resta, no suma)");
assert(calcSaldoPedido(pedDinero) === 310000, "el saldo por cobrar refleja ese abonado (400.000 - 90.000)");

// ---------------------------------------------------------------------------
// Editar un abono viejo por un monto mayor al saldo disponible debe avisar,
// igual que registrar uno nuevo — antes solo el alta preguntaba, la edición
// guardaba directo y podía inventar un "saldo a favor" grande sin aviso.
// ---------------------------------------------------------------------------
const confirmOriginalEditAbono = global.confirm;
let confirmMsgEditAbono = null, confirmLlamadasEditAbono = 0;
// el confirm cancelado deja la fila en modo edición (para poder corregir el
// número, no la cierra de golpe) — por eso el siguiente paso NO vuelve a
// hacer clic en "editar-abono": la fila ya está abierta.
click('[data-action="editar-abono"][data-id="' + abonoEditableId + '"]');
global.window.confirm = global.confirm = function (msg) { confirmLlamadasEditAbono++; confirmMsgEditAbono = msg; return false; };
setChange('[data-abono-edit-row="' + abonoEditableId + '"] [data-role="edit-abono-monto"]', "500000");
click('[data-action="guardar-abono-edit"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
assert(confirmLlamadasEditAbono === 1, "editar un abono por más del saldo disponible SÍ pregunta antes de guardar");
assert(confirmMsgEditAbono.indexOf("mayor que el saldo pendiente") !== -1, "...con un mensaje que explica por qué");
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 90000, "cancelar el aviso (confirm devuelve false) NO guarda el monto editado");
assert(state.tx.find(t => t.origenAbonoId === abonoEditableId).monto === 120000, "...y el tx vinculado en Finanzas tampoco cambia");
assert(state.abonoEditando === abonoEditableId, "...y la fila se queda en modo edición, para poder corregir el número");

global.window.confirm = global.confirm = function (msg) { confirmLlamadasEditAbono++; confirmMsgEditAbono = msg; return true; };
setChange('[data-abono-edit-row="' + abonoEditableId + '"] [data-role="edit-abono-monto"]', "500000");
click('[data-action="guardar-abono-edit"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 470000, "aceptando el aviso, el nuevo monto sí se guarda (500.000 - 30.000 de reembolso)");
assert(state.tx.find(t => t.origenAbonoId === abonoEditableId).monto === 500000, "...y el tx vinculado se sincroniza con el nuevo monto");

// deshacer lo anterior para no afectar las pruebas siguientes que dependen
// de este pedido con su abono de 90.000
click('[data-action="editar-abono"][data-id="' + abonoEditableId + '"]');
setChange('[data-abono-edit-row="' + abonoEditableId + '"] [data-role="edit-abono-monto"]', "120000");
click('[data-action="guardar-abono-edit"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 90000, "sanity: vuelve a 90.000 tras deshacer la prueba anterior");

// dentro del saldo disponible, editar NO pregunta nada
confirmLlamadasEditAbono = 0;
click('[data-action="editar-abono"][data-id="' + abonoEditableId + '"]');
setChange('[data-abono-edit-row="' + abonoEditableId + '"] [data-role="edit-abono-monto"]', "150000");
click('[data-action="guardar-abono-edit"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
assert(confirmLlamadasEditAbono === 0, "editar dentro del saldo disponible no interrumpe con ningún aviso");
click('[data-action="editar-abono"][data-id="' + abonoEditableId + '"]');
setChange('[data-abono-edit-row="' + abonoEditableId + '"] [data-role="edit-abono-monto"]', "120000");
click('[data-action="guardar-abono-edit"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
global.window.confirm = global.confirm = confirmOriginalEditAbono;
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 90000, "sanity: pedido queda otra vez en 90.000 abonado para el resto de las pruebas");

// ---------------------------------------------------------------------------
// Doble clic al registrar un abono CON comprobante adjunto: la lectura del
// archivo es asíncrona (FileReader), así que dos clics rápidos disparaban
// dos registros del mismo pago real. El guard es state.abonosProcesando —
// se prueba directo (sin simular la carrera real del FileReader, que jsdom
// no reproduce de forma confiable) marcando el pedido como "ya en curso" y
// confirmando que un segundo "add-abono" no hace nada mientras tanto.
// ---------------------------------------------------------------------------
const txCountAntesDobleClic = state.tx.length, abonosCountAntesDobleClic = pedDinero.abonos.length;
setInput('#abono-monto-' + pedidoId, "50000");
state.abonosProcesando = [pedidoId];
click('[data-action="add-abono"][data-id="' + pedidoId + '"]');
assert(state.tx.length === txCountAntesDobleClic, "con el pedido marcado \"en curso\", un segundo add-abono no crea ningún movimiento nuevo");
assert(state.pedidos.find(p => p.id === pedidoId).abonos.length === abonosCountAntesDobleClic, "...ni una fila nueva de abono");
state.abonosProcesando = [];
click('[data-action="add-abono"][data-id="' + pedidoId + '"]');
assert(state.tx.length === txCountAntesDobleClic + 1, "sin el guard activo, el abono se registra normal");
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abonos.length === abonosCountAntesDobleClic + 1, "...con su fila nueva");
// deshacer el abono de prueba (eliminar-abono revierte los dos lados a la
// vez) para no descuadrar los números que asumen las pruebas siguientes
const abonoDePrueba = pedDinero.abonos[pedDinero.abonos.length - 1];
click('[data-action="eliminar-abono"][data-id="' + pedidoId + '"][data-abono="' + abonoDePrueba.id + '"]');
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(pedDinero.abono === 90000, "sanity: deshacer el abono de prueba deja el pedido otra vez en 90.000");

// borrar en Finanzas el movimiento de un abono NO puede dejar al pedido cobrado
const txDelAbono = state.tx.find(t => t.origenAbonoId === abonoEditableId);
assert(!!txDelAbono, "el abono tiene su movimiento en Finanzas");
click('[data-action="tab"][data-tab="finanzas"]');
click('[data-action="finanzas-vista"][data-val="historial"]');
click('[data-action="remove-tx"][data-id="' + txDelAbono.id + '"]');
assert(state.tx.some(t => t.id === txDelAbono.id), "Finanzas no deja borrar suelto el movimiento de un abono (dejaría al pedido cobrado sin plata en caja)");

// el camino correcto SÍ revierte los dos lados a la vez
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="historial"]');
click('[data-action="eliminar-abono"][data-id="' + pedidoId + '"][data-abono="' + abonoEditableId + '"]');
pedDinero = state.pedidos.find(p => p.id === pedidoId);
assert(!state.tx.some(t => t.id === txDelAbono.id), "anular el abono desde el pedido retira su movimiento de Finanzas");
assert(pedDinero.abono === calcAbonadoDeLista(pedDinero.abonos), "tras anularlo, el abonado del pedido sigue cuadrando con su lista");

// --- un pedido con costo pero sin precio de venta no puede tumbar la pestaña ---
// (el porcentaje de ganancia no existe sin precio: antes se intentaba
// formatear un null y se caía el render de Pedidos entero)
state.pedidos.unshift({
  id: "ped-sin-precio", cliente: "Cliente Prueba", tipoCliente: "propio",
  descripcion: "Costeado sin precio", cantidad: "5", total: 0, costo: 90000,
  abono: 0, abonos: [], estado: "nuevo", numeroOp: "OP-0000", lineas: [], stockConsumido: []
});
state.tab = "pedidos"; state.pedidosVista = "historial"; state.lastError = null;
render();
assert(!state.lastError, "un pedido con costo y sin precio de venta no rompe el render de Pedidos");
assert(document.body.textContent.includes("sin precio de venta asignado"), "y se explica por qué no hay porcentaje de ganancia");
state.pedidos = state.pedidos.filter(p => p.id !== "ped-sin-precio");

// --- ELIMINAR vs CANCELAR: la diferencia es de plata, no de etiqueta ---
// Eliminar = no debió existir, así que sus movimientos se van con él.
// Cancelar = sí existió y sí movió plata, así que los movimientos se quedan.
const { movimientosGeneradosPorPedido, pedidoCancelado, calcPorCobrar: porCobrarAhora, calcPedidosActivos } = await import("../js/core/calc.js");

// se arma un pedido con un abono real (plata que de verdad entró)
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
elegirClientePedido("Cliente Prueba");
click('[data-action="add-pedido-linea-libre"]');
const lineaCancelId = state.formPedido.lineas[0].id;
setLinea(lineaCancelId, "productoNombre", "Pedido que se va a caer");
setLinea(lineaCancelId, "cantidad", "2");
setLinea(lineaCancelId, "precioUnitario", "150000");
setChange('[data-action-change="set-form-pedido-campo"][data-campo="abono"]', "50000");
click('[data-action="add-pedido"]');
const pedCancel = state.pedidos.find(p => p.descripcion.indexOf("Pedido que se va a caer") === 0);
assert(!!pedCancel && pedCancel.abono === 50000, "pedido de prueba creado con un abono real de $50.000");
assert(movimientosGeneradosPorPedido(pedCancel.id).length === 1, "el abono dejó su movimiento en Finanzas");

// --- CANCELAR: el registro y la plata se conservan ---
const cajaAntesCancelar = state.tx.reduce((a, t) => t.tipo === "ingreso" ? a + Number(t.monto) : a - Number(t.monto), 0);
const porCobrarAntes = porCobrarAhora();
const activosAntes = calcPedidosActivos();
click('[data-action="pedido-vista"][data-val="historial"]');
// Cancelar y eliminar viven en el panel de "Dinero y documentos" de la
// tarjeta (son las dos salidas del pedido, no acciones de un clic suelto).
click('[data-action="toggle-pedido-panel"][data-id="' + pedCancel.id + '"]');
click('[data-action="cancelar-pedido"][data-id="' + pedCancel.id + '"]');
let pc = state.pedidos.find(p => p.id === pedCancel.id);
assert(!!pc && pedidoCancelado(pc), "el pedido cancelado SIGUE existiendo (es el registro de que pasó)");
assert(movimientosGeneradosPorPedido(pedCancel.id).length === 1, "cancelar NO borra el movimiento: esa plata entró de verdad");
const cajaDespuesCancelar = state.tx.reduce((a, t) => t.tipo === "ingreso" ? a + Number(t.monto) : a - Number(t.monto), 0);
assert(cajaDespuesCancelar === cajaAntesCancelar, "la caja no cambia al cancelar (no se toca nada ya movido)");
assert(porCobrarAhora() === porCobrarAntes - 250000, "el saldo del cancelado sale de 'por cobrar' (300.000 - 50.000 abonados)");
assert(calcPedidosActivos() === activosAntes - 1, "un pedido cancelado deja de contar como activo");

// no cuenta como venta en los reportes, pero sí queda listado como registro
const { calcPedidosRango: rangoPed, calcResumenPedidos: resumenPed } = await import("../js/core/calc.js");
const filasRango = rangoPed(pc.fechaCreacion, pc.fechaCreacion);
const filaCancelada = filasRango.find(f => f.id === pedCancel.id);
assert(!!filaCancelada && filaCancelada.cancelado === true, "el cancelado aparece en el reporte, marcado como tal");
assert(filaCancelada.estado === "Cancelado", "el reporte lo muestra como Cancelado, no en su etapa de producción");
const resumenRango = resumenPed(filasRango);
assert(resumenRango.cancelados >= 1, "el resumen dice cuántos cancelados hay");
assert(!resumenPed([filaCancelada]).total, "un cancelado no suma a lo vendido");

// ---------------------------------------------------------------------------
// calcPedidosRango calculaba su propio "saldo" SIN IVA (total - abonado con
// el total crudo), reproduciendo el mismo bug que ya se corrigió una vez en
// calcSaldoPedido: un pedido pagado por completo con IVA activo daba un
// saldo NEGATIVO de exactamente el IVA, y la tabla "Desglose de pedidos" (y
// el PDF que reutiliza esta misma función) lo pintaba en verde como si
// fuera un saldo a favor del cliente, en vez de $0.
// ---------------------------------------------------------------------------
const pedidosPreviosIva = state.pedidos;
const fechaPedIva = state.pedidos[0] ? state.pedidos[0].fechaCreacion : pc.fechaCreacion;
state.pedidos = [{
  id: "ped-iva-completo", numeroOp: "OP-IVA-1", cliente: "Cliente IVA", descripcion: "Uniformes con IVA",
  cantidad: "5", total: 1000000, costo: 400000, abono: 1190000, estado: "entregado", estadosDef: null,
  fechaCreacion: fechaPedIva, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  iva: { activo: true, porcentaje: 19 }, abonos: [{ id: "ab-iva", monto: 1190000, fecha: fechaPedIva, metodoPago: "Transferencia" }],
  lineas: [], stockConsumido: [], vendedor: null
}];
const filaIva = rangoPed(fechaPedIva, fechaPedIva).find(f => f.id === "ped-iva-completo");
assert(!!filaIva, "el pedido con IVA aparece en el reporte del rango");
assert(filaIva.saldo === 0, "pagado por completo CON IVA, el saldo del reporte da $0 (no -190.000, el monto del IVA)");
assert(filaIva.total === 1000000, "\"total\" del reporte se queda en la base SIN IVA a propósito (misma cifra que usa \"ganancia\", el IVA nunca es utilidad)");
state.pedidos = pedidosPreviosIva;

// ---------------------------------------------------------------------------
// calcPedidosRango usaba el costo ESTIMADO congelado en p.costo al
// convertir, para siempre — aunque después se registraran compras reales en
// Producción, el reporte seguía mostrando "lo cotizado". El usuario lo
// pidió explícito: "el reporte lo quiero con datos de verdad". Ahora, si el
// pedido viene de una cotización, usa el costo REAL (calcCotResultadoReal)
// en su lugar — un pedido rápido (sin cotización) no tiene "real" que
// comparar, se queda con su único costo tal cual.
// ---------------------------------------------------------------------------
const pedidosPreviosRealTest = state.pedidos, cotizacionesPreviasRealTest = state.cotizaciones;
const cotRealReporteTest = {
  id: "cot-realreporte-test", clienteId: "", cliente: "Cliente Real Reporte", descripcion: "Prueba reporte real", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-realreporte-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "crealrep1",
  referencias: [], serviciosCobrados: [],
  costosGlobales: [{ id: "cg-realreporte-test", nombre: "Tela", costo: 20000, cantidad: 1, proveedorId: "", esServicio: false }],
  // Costó menos de lo estimado: real $12.000 contra $20.000 estimado.
  compras: [{ clave: "global|cg-realreporte-test", estado: "si", costoReal: 12000, txId: "" }]
};
const fechaRealReporteTest = "2026-02-01";
state.pedidos = [{
  id: "ped-realreporte-test", numeroOp: "OP-REALREP", cliente: "Cliente Real Reporte", descripcion: "Prueba",
  cantidad: "1", total: 50000, costo: 20000, abono: 50000, estado: "entregado", estadosDef: null,
  fechaCreacion: fechaRealReporteTest, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-realreporte-test",
  abonos: [{ id: "ab-realrep", monto: 50000, fecha: fechaRealReporteTest, metodoPago: "Transferencia" }],
  lineas: [], stockConsumido: [], vendedor: null
}, {
  // Pedido rápido, sin cotización: no hay "estimado vs. real" que comparar.
  id: "ped-rapido-realtest", numeroOp: "OP-RAPIDOREAL", cliente: "Cliente Rápido", descripcion: "Pedido a mano",
  cantidad: "1", total: 30000, costo: 18000, abono: 30000, estado: "entregado", estadosDef: null,
  fechaCreacion: fechaRealReporteTest, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [{ id: "ab-rapreal", monto: 30000, fecha: fechaRealReporteTest, metodoPago: "Transferencia" }],
  lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [cotRealReporteTest];
const filasRealReporteTest = rangoPed(fechaRealReporteTest, fechaRealReporteTest);
const filaRealReporteTest = filasRealReporteTest.find(f => f.id === "ped-realreporte-test");
assert(!!filaRealReporteTest, "el pedido con cotización aparece en el reporte");
assert(filaRealReporteTest.costo === 12000, "el reporte usa el costo REAL (lo que de verdad se compró, $12.000) en vez del estimado congelado en el pedido ($20.000)");
assert(filaRealReporteTest.ganancia === 50000 - 12000, "...y la ganancia del reporte se calcula sobre ese costo real, no sobre el estimado");
const filaRapidaRealTest = filasRealReporteTest.find(f => f.id === "ped-rapido-realtest");
assert(filaRapidaRealTest.costo === 18000, "un pedido rápido (sin cotización) sigue usando su único costo (p.costo) tal cual");
state.pedidos = pedidosPreviosRealTest; state.cotizaciones = cotizacionesPreviasRealTest;

// reactivar lo devuelve a la circulación
click('[data-action="reactivar-pedido"][data-id="' + pedCancel.id + '"]');
pc = state.pedidos.find(p => p.id === pedCancel.id);
assert(!pedidoCancelado(pc), "se puede reactivar un pedido cancelado");
assert(porCobrarAhora() === porCobrarAntes, "al reactivarlo su saldo vuelve a 'por cobrar'");

// --- ELIMINAR: se lleva los movimientos que generó ---
const txAntesEliminar = state.tx.length;
const movsDelPedido = movimientosGeneradosPorPedido(pedCancel.id).map(t => t.id);
click('[data-action="remove-pedido"][data-id="' + pedCancel.id + '"]');
assert(state.tx.length === txAntesEliminar - movsDelPedido.length, "eliminar el pedido se lleva sus movimientos de Finanzas");
assert(!state.tx.some(t => movsDelPedido.indexOf(t.id) >= 0), "esos movimientos ya no están en la caja");
assert(state.txPapelera.some(t => t.eliminadoConPedido === pedCancel.id), "van a la papelera de movimientos, no se borran");

// y restaurar el pedido los devuelve, para que la caja quede como estaba
click('[data-action="ver-papelera-pedidos"]');
click('[data-action="restaurar-pedido"][data-id="' + pedCancel.id + '"]');
assert(state.tx.length === txAntesEliminar, "restaurar el pedido devuelve sus movimientos a la caja");
assert(!state.txPapelera.some(t => t.eliminadoConPedido === pedCancel.id), "y los saca de la papelera de movimientos");
click('[data-action="ver-papelera-pedidos"]');

// un movimiento cargado A MANO y solo asociado al pedido NO se va con él
state.tx.unshift({ id: "manual-suelto", tipo: "gasto", concepto: "Tela comprada aparte", monto: 20000, fecha: state.pedidos[0].fechaCreacion, pedidoId: pedCancel.id });
assert(!movimientosGeneradosPorPedido(pedCancel.id).some(t => t.id === "manual-suelto"), "un gasto propio asociado al pedido no cuenta como generado por él (no se borraría con él)");
state.tx = state.tx.filter(t => t.id !== "manual-suelto");

// --- MOVIMIENTOS HUÉRFANOS: si el origen ya no existe, se pueden borrar ---
// El bloqueo de borrado en Finanzas existe para no descuadrar la caja contra
// el registro que generó el movimiento. Pero si ese registro YA NO EXISTE, no
// hay nada que descuadrar y el movimiento tiene que poder borrarse: si no,
// queda atrapado para siempre (no se puede desde la app, y editar la Sheet a
// mano tampoco sirve porque se reescribe desde memoria al guardar).
const { origenSistemaDeTx, origenSistemaHuerfano, movimientosGeneradosPorCotizacion } = await import("../js/core/calc.js");
const _h = new Date();
const fechaDePrueba = _h.getFullYear() + "-" + String(_h.getMonth() + 1).padStart(2, "0") + "-" + String(_h.getDate()).padStart(2, "0");

// un movimiento con marca de origen cuyo pedido ya no existe
state.tx.unshift({ id: "tx-huerfano", tipo: "ingreso", concepto: "Abono de un pedido que ya se borró",
  monto: 90000, fecha: fechaDePrueba, pedidoId: "pedido-que-no-existe", origenAbonoId: "abono-fantasma" });
const txHuerfano = state.tx.find(t => t.id === "tx-huerfano");
assert(origenSistemaDeTx(txHuerfano) === null, "un movimiento cuyo origen ya no existe deja de estar protegido");
const huerfanoInfo = origenSistemaHuerfano(txHuerfano);
assert(!!huerfanoInfo, "y se reconoce como huérfano, para poder avisarlo en pantalla");
// Post-mortem 2026-09-20: diagnosticar un caso real en producción exigía
// adivinar a ciegas cuál de los ~10 campos de marca era y con qué valor —
// origenSistemaHuerfano ahora también devuelve el campo/valor EXACTOS
// (no solo la explicación humana `que`), y el tooltip de la insignia los
// muestra, para que el reporte del usuario ya traiga el dato preciso.
assert(huerfanoInfo.campo === "origenAbonoId" && huerfanoInfo.valor === "abono-fantasma", "...con el campo y el valor EXACTOS que no encontraron respaldo, no solo la explicación humana");

click('[data-action="tab"][data-tab="finanzas"]');
click('[data-action="finanzas-vista"][data-val="historial"]');
assert(!!document.querySelector('[data-action="filtro-tx"][data-val="huerfanos"]'), "aparece el filtro para encontrar los movimientos sueltos");
const insigniaHuerfano = document.querySelector('.tag[title*="origenAbonoId"]');
assert(!!insigniaHuerfano && insigniaHuerfano.title.indexOf("abono-fantasma") !== -1, "la insignia \"origen eliminado\" en pantalla trae el campo y el valor exactos en su tooltip, no solo el texto genérico");
click('[data-action="remove-tx"][data-id="tx-huerfano"]');
assert(!state.tx.some(t => t.id === "tx-huerfano"), "un movimiento huérfano SÍ se puede borrar desde Finanzas");
assert(state.txPapelera.some(t => t.id === "tx-huerfano"), "y va a la papelera como cualquier otro");
state.txPapelera = state.txPapelera.filter(t => t.id !== "tx-huerfano");

// el mismo movimiento, pero con su pedido vivo, sigue protegido
const pedVivo = state.pedidos.find(p => (p.abonos || []).length > 0);
assert(!!pedVivo, "hay un pedido con abonos para comprobar el caso contrario");
const abonoVivo = pedVivo.abonos.find(a => a.tipo !== "reembolso");
state.tx.unshift({ id: "tx-protegido", tipo: "ingreso", concepto: "Abono con pedido vivo",
  monto: 1000, fecha: fechaDePrueba, pedidoId: pedVivo.id, origenAbonoId: abonoVivo.id });
assert(!!origenSistemaDeTx(state.tx.find(t => t.id === "tx-protegido")), "con su pedido vivo, el movimiento sigue protegido");
render(); // el movimiento se insertó directo en el estado: hay que repintar para poder clicarlo
click('[data-action="remove-tx"][data-id="tx-protegido"]');
assert(state.tx.some(t => t.id === "tx-protegido"), "y Finanzas se niega a borrarlo suelto");
state.tx = state.tx.filter(t => t.id !== "tx-protegido");

// --- eliminar una cotización se lleva los movimientos que generó ---
click('[data-action="tab"][data-tab="cotizaciones"]');
const cotParaBorrar = state.cotizaciones[0];
state.tx.unshift({ id: "tx-comision-cot", tipo: "comision", concepto: "Comisión de la cotización",
  monto: 15000, fecha: fechaDePrueba, cotizacionId: cotParaBorrar.id, origenComisionCotId: cotParaBorrar.id });
assert(movimientosGeneradosPorCotizacion(cotParaBorrar).some(t => t.id === "tx-comision-cot"), "se reconocen los movimientos que generó una cotización");
render();
const txAntesCot = state.tx.length;
// El botón de eliminar vive en la cabecera del detalle, no en el historial.
click('[data-action="cot-vista"][data-val="historial"]');
click('[data-action="abrir-cotizacion-editor"][data-id="' + cotParaBorrar.id + '"]');
click('[data-action="remove-cotizacion"][data-id="' + cotParaBorrar.id + '"]');
assert(!state.cotizaciones.some(c => c.id === cotParaBorrar.id), "elimina la cotización");
assert(state.tx.length === txAntesCot - 1, "y se lleva su movimiento de Finanzas en vez de dejarlo suelto");
assert(state.txPapelera.some(t => t.id === "tx-comision-cot" && t.eliminadoConCotizacion === cotParaBorrar.id), "el movimiento queda en la papelera, no se borra de una");
state.txPapelera = state.txPapelera.filter(t => t.id !== "tx-comision-cot");

// --- la fecha de "hoy" es la del reloj del usuario, no la de UTC ---
// En Colombia (UTC-5), a partir de las 7pm `toISOString()` ya devuelve el día
// siguiente: todo lo registrado en la tarde-noche quedaba fechado mañana, y el
// último día del mes el corte de periodo saltaba al mes siguiente.
const { todayStr: hoyStr } = await import("../js/core/utils.js");
const ahora = new Date();
const fechaLocalEsperada = ahora.getFullYear() + "-" +
  String(ahora.getMonth() + 1).padStart(2, "0") + "-" + String(ahora.getDate()).padStart(2, "0");
assert(hoyStr() === fechaLocalEsperada, "todayStr() devuelve la fecha local (" + fechaLocalEsperada + "), no la de UTC");

// --- la campanita avisa lo del día: notas, autorizaciones y entregas ---
const { calcNotificaciones } = await import("../js/core/calc.js");
state.pendientes.push({ id: "n-hoy", texto: "Nota de hoy", categoria: "tarea", prioridad: "alta", fecha: hoyStr(), hecho: false });
const avisos = calcNotificaciones(true);
assert(avisos.some(a => a.tipo === "nota" && a.titulo === "Nota de hoy"), "la campanita incluye la nota del día");
assert(!calcNotificaciones(true).some(a => a.tipo === "autorizacion"), "sin propuestas pendientes no hay avisos de autorización");
state.productoPropuestas = [{ id: "prop-x", tipo: "campo", productoId: productoId, productoNombre: "Camiseta", autor: "Ana", fecha: new Date().toISOString(), payload: {} }];
assert(calcNotificaciones(true).some(a => a.tipo === "autorizacion"), "un cambio propuesto por un vendedor aparece como aviso para el admin");
assert(!calcNotificaciones(false).some(a => a.tipo === "autorizacion"), "un vendedor no ve los avisos de autorización (no aprueba nada)");
state.productoPropuestas = [];
state.pendientes = state.pendientes.filter(n => n.id !== "n-hoy");

// --- permisos: un vendedor no puede cambiar el precio de un producto ni
// registrar un movimiento de stock directo — queda pendiente de aprobación
// del admin, y las bajas de stock por una venta/remisión real (ya probadas
// arriba) NUNCA pasan por este control. ---
loginComo("vendedor", "Vendedor de prueba", "vendedor@taller.test");
assert(!!auth.getSession() && auth.getSession().rol === "vendedor", "sesión de vendedor simulada");
render();
click('[data-action="tab"][data-tab="productos"]');
click('[data-action="producto-vista"][data-val="catalogo"]');
click('[data-action="abrir-producto-editor"][data-id="' + prodUnicoId + '"]');
const precioAntesVendedor = state.productos.find(p => p.id === prodUnicoId).precioVenta;
const precioInputVendedor = document.querySelector('input[data-action-change="set-pro-campo"][data-id="' + prodUnicoId + '"][data-campo="precioVenta"]');
precioInputVendedor.value = "123456";
precioInputVendedor.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.productos.find(p => p.id === prodUnicoId).precioVenta === precioAntesVendedor, "el precio NO cambia cuando lo edita un vendedor");
assert(state.productoPropuestas.some(p => p.productoId === prodUnicoId && p.tipo === "campo"), "queda una propuesta pendiente con el cambio de precio");

document.querySelector('[data-role="stock-cantidad-' + prodUnicoId + '"]').value = "50";
click('[data-action="add-pro-stock"][data-id="' + prodUnicoId + '"]');
assert(state.productos.find(p => p.id === prodUnicoId).variantesTalla[0].stock === 1, "el stock NO cambia cuando el movimiento manual lo registra un vendedor");
assert(state.productoPropuestas.some(p => p.productoId === prodUnicoId && p.tipo === "movimiento"), "queda una propuesta pendiente con el movimiento de stock");

const avisoVendedorResumen = (() => { state.tab = "resumen"; render(); return document.body.textContent.includes("cambio propuesto") || document.body.textContent.includes("cambios propuestos"); })();
assert(!avisoVendedorResumen, "el aviso de cambios pendientes en Resumen es solo para el admin, un vendedor no lo ve");

// el admin entra, ve el aviso en Resumen, y aprueba ambas propuestas
auth.logout();
render();
state.tab = "resumen";
render();
assert(document.body.textContent.includes("cambio propuesto") || document.body.textContent.includes("cambios propuestos"), "el admin ve el aviso de cambios pendientes en Resumen");
click('[data-action="kpi-nav"][data-tab="productos"]');
assert(state.tab === "productos", "el aviso lleva directo a Productos para revisarlos");
const propuestaPrecio = state.productoPropuestas.find(p => p.productoId === prodUnicoId && p.tipo === "campo");
const propuestaStock = state.productoPropuestas.find(p => p.productoId === prodUnicoId && p.tipo === "movimiento");
click('[data-action="aprobar-propuesta-producto"][data-id="' + propuestaPrecio.id + '"]');
click('[data-action="aprobar-propuesta-producto"][data-id="' + propuestaStock.id + '"]');
assert(state.productos.find(p => p.id === prodUnicoId).precioVenta === 123456, "al aprobar, el precio propuesto por el vendedor se aplica");
assert(state.productos.find(p => p.id === prodUnicoId).variantesTalla[0].stock === 51, "al aprobar, el movimiento de stock propuesto se aplica (1 + 50 = 51)");
assert(!state.productoPropuestas.some(p => p.productoId === prodUnicoId), "no quedan propuestas pendientes de este producto");

// ---------------------------------------------------------------------------
// Navegación por teclado (core/teclado.js): que la app entera se pueda usar
// sin mouse. Se simulan teclas reales sobre el elemento que tiene el foco,
// igual que click() simula clics reales.
// ---------------------------------------------------------------------------
// Devuelve lo mismo que dispatchEvent: false si algún manejador llamó a
// preventDefault() (útil para confirmar que una tecla se dejó pasar tal
// cual, ej. que ←/→ siguen moviendo el cursor de texto en vez de haber sido
// interceptadas).
function tecla(key, opts) {
  const o = Object.assign({ key: key, bubbles: true, cancelable: true }, opts || {});
  const destino = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : document;
  return destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", o));
}
function focoId() {
  return document.activeElement ? document.activeElement.id : "";
}

state.tab = "resumen";
render();
assert(document.querySelector('.skip-link[href="#contenido"]'), 'existe el enlace "Saltar al contenido" y apunta al contenido');
assert(document.getElementById("contenido"), "el contenedor del contenido tiene el id al que salta ese enlace");
assert(document.getElementById("nav-tab-resumen"), "cada sección del menú tiene un id estable, para poder devolverle el foco después del render");
const tabulables = Array.from(document.querySelectorAll(".nav .nav-item")).filter(b => b.getAttribute("tabindex") === "0");
assert(tabulables.length === 1 && tabulables[0].id === "nav-tab-resumen", "solo la sección activa es tabulable (roving tabindex): Tab sale del menú de una");
assert(document.getElementById("nav-tab-resumen").getAttribute("aria-current") === "page", "la sección activa se anuncia con aria-current");

// Alt + flechas recorre las secciones en el orden en que se VEN en el menú
// (Panel: resumen, notas → Ventas: pedidos...), no en el orden interno de TABS.
tecla("ArrowDown", { altKey: true });
assert(state.tab === "notas", "Alt + ↓ pasa a la sección siguiente del menú");
assert(focoId() === "nav-tab-notas", "el foco sigue a la sección nueva, así las flechas encadenan");
tecla("ArrowUp", { altKey: true });
assert(state.tab === "resumen", "Alt + ↑ vuelve a la anterior");

// Alt + número salta directo a la n-ésima sección visible.
tecla("3", { altKey: true, code: "Digit3" });
assert(state.tab === "pedidos", "Alt + 3 va a la tercera sección tal como se ve en el menú");

// Flechas dentro del menú: mueven el foco, sin cambiar de sección todavía.
document.getElementById("nav-tab-pedidos").focus();
tecla("ArrowDown");
assert(focoId() === "nav-tab-cotizaciones", "↑/↓ dentro del menú mueven el foco a la sección de al lado");
assert(state.tab === "pedidos", "mover el foco con las flechas NO cambia de sección: eso lo hace Enter");
tecla("Home");
assert(focoId() === "nav-tab-resumen", "Inicio lleva el foco a la primera sección");
tecla("End");
assert(focoId() === "nav-tab-config", "Fin lleva el foco a la última");

// ← cierra la categoría del item con foco: sus secciones dejan de ser
// alcanzables con las flechas, y el foco no puede quedarse en una oculta.
document.getElementById("nav-tab-pedidos").focus();
tecla("ArrowLeft");
assert(state.ui.navGroups.ventas === false, "← cierra la categoría en la que se está parado");
assert(focoId() && focoId() !== "nav-tab-pedidos", "al cerrarse la categoría el foco se mueve a una sección que sí se puede alcanzar");
document.getElementById("nav-tab-resumen").focus();
tecla("ArrowDown");
assert(focoId() === "nav-tab-notas", "las flechas se saltan las secciones de una categoría cerrada");
document.getElementById("nav-tab-notas").focus();
tecla("ArrowRight");
assert(state.ui.navGroups.general === true, "→ deja abierta la categoría que ya lo estaba, sin cerrarla por error");
state.ui.navGroups.ventas = true;
render();

// "?" abre y cierra la ayuda; Esc también la cierra.
tecla("?");
assert(state.atajosAbiertos && document.querySelector(".atajos-overlay"), '"?" abre el panel de atajos');
assert(document.body.textContent.includes("Alt + M"), "el panel lista los atajos de verdad, no un texto genérico");
tecla("Escape");
assert(!state.atajosAbiertos && !document.querySelector(".atajos-overlay"), "Esc cierra el panel de atajos");

// Esc cierra SOLO la capa de más arriba, en orden: primero la imagen, después
// el panel de avisos. Cerrar las dos de un golpe haría perder el contexto.
state.notificacionesAbiertas = true;
state.imagenPreview = "https://example.com/foto.png";
render();
tecla("Escape");
assert(!state.imagenPreview, "Esc cierra primero la imagen ampliada, que es la capa de más arriba");
assert(state.notificacionesAbiertas, "y deja abierto el panel de avisos que estaba debajo");
tecla("Escape");
assert(!state.notificacionesAbiertas, "el segundo Esc ya cierra el panel de avisos");

// El visor de PDF (core/pdf.js: mostrarPdfEnApp) se abre DENTRO de la app —
// ninguna pestaña ni ventana nueva, para que la versión instalada como PWA
// se sienta como una app de escritorio — y encaja en la misma pila de capas
// que se cierran con Esc, justo debajo de la imagen ampliada.
state.pdfPreview = { url: "blob:mock-pdf", nombreArchivo: "reporte-prueba.pdf" };
state.notificacionesAbiertas = true;
state.imagenPreview = "https://example.com/foto.png";
render();
assert(!!document.querySelector(".pdfprev-overlay"), "el visor de PDF se muestra como una capa más de la app, no como una descarga o pestaña aparte");
tecla("Escape");
assert(!state.imagenPreview && !!state.pdfPreview, "Esc sigue cerrando primero la imagen ampliada, que va por encima del visor de PDF");
tecla("Escape");
assert(!state.pdfPreview && !document.querySelector(".pdfprev-overlay"), "el segundo Esc cierra el visor de PDF");
assert(state.notificacionesAbiertas, "sin tocar el panel de avisos, que sigue debajo de todo");
state.notificacionesAbiertas = false;
render();

// "Descargar" no debe navegar ni abrir nada — solo un <a download> sobre el
// mismo blob: que ya se estaba mostrando en el visor.
state.pdfPreview = { url: "blob:mock-pdf-2", nombreArchivo: "reporte-prueba-2.pdf" };
render();
let anchorCreado = null;
const origCreateElement = document.createElement.bind(document);
document.createElement = function (tag) {
  const el = origCreateElement(tag);
  if (tag === "a") { anchorCreado = el; el.click = () => {}; } // evita el intento de navegación real de jsdom
  return el;
};
click('[data-action="descargar-pdf-preview"]');
document.createElement = origCreateElement;
assert(!!anchorCreado && anchorCreado.href.indexOf("blob:mock-pdf-2") !== -1 && anchorCreado.download === "reporte-prueba-2.pdf", "'Descargar' arma un <a download> sobre el mismo blob: que ya se estaba viendo, sin navegar a ningún lado ni abrir nada nuevo");
assert(!!state.pdfPreview, "descargar NO cierra el visor: son dos acciones independientes");
click('[data-action="cerrar-pdf-preview"]');
assert(!state.pdfPreview, "'Cerrar' sí lo cierra");

// Un vendedor solo salta con el teclado a las secciones que le tocan: los
// atajos usan la misma lista filtrada por rol con la que se dibuja el menú.
loginComo("vendedor", "Juana", "juana@taller.test");
state.tab = "mis-ventas";
render();
assert(!document.getElementById("nav-tab-config"), "el menú de un vendedor no incluye Configuración");
tecla("1", { altKey: true, code: "Digit1" });
assert(state.tab === "mis-ventas", "Alt + 1 lleva a la primera sección del menú del vendedor");
let fueraDeRol = false;
for (let i = 0; i < 12; i++) {
  tecla("ArrowDown", { altKey: true });
  if (state.tab === "config" || state.tab === "finanzas" || state.tab === "pendientes") fueraDeRol = true;
}
assert(!fueraDeRol, "recorriendo con Alt + ↓ nunca se cae en una sección que el rol no puede ver");
auth.logout();
state.tab = "resumen";
render();

// ---------------------------------------------------------------------------
// Auditoría financiera 2026-09-20 (post-mortem en vivo): si "tx" (o
// "clientes") no se puede leer de su propia pestaña de Sheets al cargar,
// antes esto solo quedaba en console.error — Caja/Balance/Resumen podían
// mostrarse calculados sobre una copia vieja (o el blob de "kv" de antes de
// que existiera esa pestaña propia) sin ningún aviso visible. Pasó de
// verdad: el usuario reportó "Caja actual" muy por debajo de lo real y la
// gráfica de Resumen vacía, y el Historial mostraba solo un puñado de
// movimientos de prueba de meses atrás. Ahora state.avisoTablaSheetFallo
// arma una barra fija (no un toast que se calla solo) con el motivo real.
// ---------------------------------------------------------------------------
// (No se afirma "sin avisoTablaSheetFallo no hay ninguna .aviso-barra": para
// esta altura de la suite puede seguir viva la barra de "cambios sin
// guardar" de una prueba anterior — es otro aviso-barra legítimo, no el de
// acá. Se busca el texto propio de ESTE aviso, no la ausencia del selector.)
state.avisoTablaSheetFallo = { claves: ["tx"], detalle: "Google Sheets API 500: fallo simulado" };
render();
var avisosTabla = Array.from(document.querySelectorAll(".aviso-barra.malo")).filter(function (el) { return el.textContent.indexOf("Google Sheets API 500: fallo simulado") !== -1; });
assert(avisosTabla.length === 1, "con avisoTablaSheetFallo puesto, aparece la barra fija (no un toast temporal)");
assert(avisosTabla[0].textContent.indexOf("movimientos de Finanzas") !== -1, "...nombra el área legible (ETIQUETA_CLAVE), no la clave interna \"tx\"");
assert(!!avisosTabla[0].querySelector('[data-action="recargar-pagina"]'), "...con un botón para recargar, la forma de reintentar la carga completa");
state.avisoTablaSheetFallo = null;
render();
assert(document.body.textContent.indexOf("Google Sheets API 500: fallo simulado") === -1, "quitar avisoTablaSheetFallo hace desaparecer la barra en el siguiente render");

// ---------------------------------------------------------------------------
// Servicios que se le cobran aparte al cliente (el diseño). Lo que se prueba
// no es que cada cálculo funcione por separado, sino que los MISMOS números
// sobrevivan cotización → pedido → líneas → reporte, con igualdad exacta.
// ---------------------------------------------------------------------------
const calcMod = await import("../js/core/calc.js");

state.tab = "cotizaciones";
state.cotizacionEditando = "";
render();
elegirClienteCotizacion("Cliente Diseño");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Pedido con diseño cobrado");
click('[data-action="add-cotizacion"]');
const cotD = state.cotizaciones[0];
const cotDId = cotD.id;
const refDId = cotD.referencias[0].id;

// Una referencia sencilla: 10 prendas a $50.000, con un insumo de $20.000 por
// prenda. Números redondos a propósito: cualquier descuadre salta a la vista.
setChange('[data-ref-id="' + refDId + '"] input[data-campo="cantidadPedida"]', "10");
setChange('[data-ref-id="' + refDId + '"] input[data-campo="precioVenta"]', "50000");
setChange('[data-ref-id="' + refDId + '"] input[data-campo="nombre"]', "Camiseta");
click('[data-action="add-insumo-personalizado"][data-cot="' + cotDId + '"][data-ref="' + refDId + '"]');
const ultimoInsumo = () => { const is = state.cotizaciones.find(c => c.id === cotDId).referencias[0].insumos; return is[is.length - 1].id; };
const insDId = ultimoInsumo();
setChange('[data-ref-id="' + refDId + '"] input[data-ins="' + insDId + '"][data-campo="costo"]', "20000");
setChange('[data-ref-id="' + refDId + '"] select[data-ins="' + insDId + '"][data-campo="tipo"]', "por_prenda");

// Un costo global de verdad (domicilio $30.000): no se cobra aparte, se
// reparte entre las prendas. Sirve para comprobar que el diseño NO lo diluye.
// Se crea como se crea de verdad: un insumo al que se le elige el tipo
// "Costo global del pedido".
click('[data-action="add-insumo-personalizado"][data-cot="' + cotDId + '"][data-ref="' + refDId + '"]');
const globDId = ultimoInsumo();
setChange('[data-ref-id="' + refDId + '"] input[data-ins="' + globDId + '"][data-campo="nombre"]', "Domicilio");
setChange('[data-ref-id="' + refDId + '"] input[data-ins="' + globDId + '"][data-campo="costo"]', "30000");
setChange('[data-ref-id="' + refDId + '"] select[data-ins="' + globDId + '"][data-campo="tipo"]', "global");
assert(state.cotizaciones.find(c => c.id === cotDId).costosGlobales.length === 1, "el domicilio queda como costo global del pedido");

// El diseño: nace como insumo de la referencia y se convierte en servicio
// cobrado eligiéndole el tipo de costo, que es el gesto real del usuario.
click('[data-action="add-insumo-personalizado"][data-cot="' + cotDId + '"][data-ref="' + refDId + '"]');
const insDisId = ultimoInsumo();
setChange('[data-ref-id="' + refDId + '"] input[data-ins="' + insDisId + '"][data-campo="nombre"]', "Diseño");
setChange('[data-ref-id="' + refDId + '"] input[data-ins="' + insDisId + '"][data-campo="costo"]', "50000");
setChange('[data-ref-id="' + refDId + '"] select[data-ins="' + insDisId + '"][data-campo="tipo"]', "servicio_cobrado");

let cotDs = state.cotizaciones.find(c => c.id === cotDId);
assert(cotDs.referencias[0].insumos.length === 1, "al cobrarse aparte, el diseño deja de ser un insumo de la prenda");
assert(cotDs.serviciosCobrados.length === 1 && cotDs.serviciosCobrados[0].costo === 50000, "pasa a la lista de servicios cobrados, conservando lo que cuesta");
assert(cotDs.serviciosCobrados[0].precio === 0, "nace sin precio: cuánto cobrar es una decisión aparte, no se hereda del costo");

setChange('[data-cot="' + cotDId + '"][data-servicio="' + insDisId + '"][data-campo="precio"]', "80000");
cotDs = state.cotizaciones.find(c => c.id === cotDId);

// --- los totales de la cotización ---
const tD = calcMod.calcCotizacionTotales(cotDs);
assert(tD.precioPrendas === 500000, "el precio de las prendas son 10 × $50.000, sin el diseño");
assert(tD.precioServicios === 80000, "el diseño aporta su precio aparte");
assert(tD.precioTotal === 580000, "el total cotizado suma prendas + diseño");
assert(tD.costoTotal === 200000 + 30000 + 50000, "el costo total suma insumos + domicilio + lo que cuesta el diseño");
assert(tD.gananciaTotal === 580000 - 280000, "la ganancia es exactamente precio total − costo total");

// El diseño NO es una prenda: no diluye el reparto del domicilio ni infla la
// cantidad. Esto es justo lo que se rompía si se modelaba como una referencia.
assert(calcMod.calcUnidadesCotizacion(cotDs) === 10, "el diseño no cuenta como una prenda más del pedido");
assert(calcMod.calcCostoGlobalPorPrenda(cotDs) === 3000, "el domicilio se reparte entre las 10 prendas, no entre 11");

// --- comisión: se calcula sobre las prendas, no sobre el diseño ---
// El formulario del vendedor está plegado por defecto; acá lo que se prueba
// es la fórmula de la comisión, no el desplegable, así que se asigna directo.
state.cotizaciones = state.cotizaciones.map(c => c.id === cotDId
  ? Object.assign({}, c, { vendedor: { nombre: "Vendedora", tipo: "porcentaje", valor: 10, estado: "pendiente" } })
  : c);
cotDs = state.cotizaciones.find(c => c.id === cotDId);
assert(calcMod.calcComisionValorCot(cotDs) === 50000, "la comisión del 10% se calcula sobre las prendas ($500.000), no sobre el total facturado");

// --- la lista de compras ve el diseño como algo que hay que PAGAR ---
const comprasD = calcMod.calcListaCompras(cotDs);
const lineaDiseño = comprasD.find(c => c.nombre === "Diseño");
assert(!!lineaDiseño, "el diseño aparece en la lista de compras: a quien lo hace hay que pagarle");
assert(lineaDiseño.costoTotal === 50000, "entra con lo que CUESTA ($50.000), nunca con lo que se cobra ($80.000)");

// --- el PDF del cliente lo ve como su propia línea ---
// (se comprueba sobre los datos que alimentan la tabla, no generando el PDF:
// jsPDF no está cargado en este entorno)
assert(cotDs.serviciosCobrados[0].nombre === "Diseño", "el servicio lleva el nombre con el que sale en la cotización del cliente");

// --- convertir en pedido: los números tienen que sobrevivir intactos ---
click('[data-action="guardar-cotizacion"][data-id="' + cotDId + '"]');
click('[data-action="convertir-cotizacion"][data-id="' + cotDId + '"]');
const pedD = state.pedidos.find(p => p.cotizacionId === cotDId);
assert(!!pedD, "la cotización se convierte en pedido");
assert(pedD.total === tD.precioTotal, "el total del pedido es EXACTAMENTE el total cotizado (prendas + diseño)");
assert(pedD.costo === tD.costoTotal, "y su costo es exactamente el costo cotizado");
assert(pedD.cantidad === "10", "la cantidad del pedido cuenta prendas: el diseño no suma una unidad");

const lineaServicio = pedD.lineas.find(l => l.esServicioCobrado);
assert(!!lineaServicio, "el diseño viaja al pedido como una línea propia, marcada como servicio cobrado");
assert(lineaServicio.precioUnitario === 80000 && lineaServicio.costoUnitario === 50000, "esa línea lleva su precio y su costo");
assert(lineaServicio.costoIndirectoUnitario === 0, "y no carga con nada del domicilio: no es una prenda");

const totLineas = calcMod.calcTotalesLineasPedido(pedD.lineas);
assert(totLineas.precioTotal === pedD.total, "la suma de las líneas da exactamente el total del pedido");
assert(totLineas.costoTotal === pedD.costo, "y la suma de sus costos da exactamente el costo del pedido");
assert(calcMod.calcComisionValor(pedD) === calcMod.calcComisionValorCot(cotDs), "la comisión no cambia al convertir: misma base antes y después");

// --- el reporte de productos vendidos cuadra con el pedido ---
const filasD = calcMod.calcProductosVendidosRango("2000-01-01", "2100-12-31").filter(f => f.numeroOp === pedD.numeroOp);
const precioReporte = filasD.reduce((a, f) => a + f.precioTotal, 0);
const costoReporte = filasD.reduce((a, f) => a + f.costoTotal, 0);
assert(precioReporte === pedD.total, "lo que el reporte dice que se vendió es exactamente el total del pedido");
assert(costoReporte === pedD.costo, "y lo que dice que costó es exactamente el costo del pedido");

// --- el camino de vuelta: dejar de cobrarlo aparte ---
state.tab = "cotizaciones";
state.cotizacionEditando = cotDId;
render();
setChange('[data-cot="' + cotDId + '"][data-servicio="' + insDisId + '"][data-campo="tipo"]', "global");
cotDs = state.cotizaciones.find(c => c.id === cotDId);
assert(cotDs.serviciosCobrados.length === 0 && cotDs.costosGlobales.length === 2, "devolverle un tipo de costo normal lo saca de los servicios cobrados");
assert(calcMod.calcCotizacionTotales(cotDs).precioTotal === 500000, "al dejar de cobrarse aparte, su precio desaparece del total");
assert(calcMod.calcCotizacionTotales(cotDs).costoTotal === 280000, "pero su costo sigue contando: se volvió a repartir entre las prendas");

// ---------------------------------------------------------------------------
// Estados de producción: UNA sola resolución de etapas.
// El usuario reportó que "en una parte se actualizó y en la otra se quedó
// viejo". La causa era que la misma pregunta —cuáles son las etapas de esto—
// estaba respondida en siete lugares distintos, y no todos conocían los
// mismos casos. Estos checks fijan que ahora hay una sola puerta.
// ---------------------------------------------------------------------------
// Desde 2026-09-21 no hay más "origen: proveedor" — una referencia que solo
// trae insumos tipo "producto_comprado" (prenda comprada hecha) usa el
// flujo corto; en cuanto tiene CUALQUIER otro insumo (ej. una tela), usa el
// flujo completo de taller. Ver esSoloPrendaComprada en core/calc.js.
const refProveedor = { id: "r1", insumos: [{ id: "i1", nombre: "Camiseta", tipo: "producto_comprado", costo: 20000, cantidad: 1 }], estado: "pendiente", estadosDef: null };
const refTaller = { id: "r2", insumos: [{ id: "i2", nombre: "Tela", tipo: "tela", costo: 5000, cantidad: 1 }], estado: "cortado", estadosDef: null };

assert(calcMod.etapasDe(refProveedor).length === 2, "una referencia comprada a proveedor tiene su propio flujo de 2 etapas");
assert(calcMod.etapasDe(refTaller).length === 5, "una que se fabrica en el taller usa el flujo de producción completo");
assert(calcMod.estadosDefDe(refProveedor) === calcMod.etapasDe(refProveedor), "estadosDefDe y etapasDe son la MISMA función: no pueden divergir");
assert(calcMod.estadosDefDeRef(refProveedor) === calcMod.etapasDe(refProveedor), "estadosDefDeRef también");

// Antes esto fallaba: el pedido salía con el `estado` de un flujo y la lista
// de etapas de OTRO, así que su etiqueta no se podía resolver.
const cotProv = { referencias: [refProveedor] };
const agregado = calcMod.estadoAgregadoDeCot(cotProv);
assert(agregado.estadosDef.some(e => e.id === agregado.estado), "el estado agregado del pedido SIEMPRE existe dentro de la lista de etapas que lo acompaña");
assert(calcMod.estadoLabelDe(agregado) === "Pendiente proveedor", "y por eso su etiqueta se resuelve, en vez de mostrar el id crudo");

// Un flujo hecho a mano desde Plantillas tiene ids uid(), nunca "entregado".
const flujoPropio = [{ id: "aaa", label: "Corte" }, { id: "bbb", label: "Despachado" }];
assert(calcMod.pedidoTerminado({ estado: "bbb", estadosDef: flujoPropio }), "un pedido está terminado si va en la ÚLTIMA etapa de su flujo, se llame como se llame");
assert(!calcMod.pedidoTerminado({ estado: "aaa", estadosDef: flujoPropio }), "y no lo está si le falta alguna");
assert(calcMod.pedidoTerminado({ estado: "entregado", estadosDef: null }), "con el flujo estándar, la última sigue siendo Entregado");

assert(calcMod.siguienteEtapa(flujoPropio, "aaa", 1) === "bbb", "avanzar una etapa lleva a la siguiente");
assert(calcMod.siguienteEtapa(flujoPropio, "bbb", 1) === "bbb", "avanzar en la última no se sale del flujo");
assert(calcMod.siguienteEtapa(flujoPropio, "aaa", -1) === "aaa", "retroceder en la primera tampoco");

// El bug concreto que reportó el usuario: un pedido rápido que ya iba
// avanzado perdía su progreso al cotizarlo. Desde ese momento la tarjeta leía
// el progreso por referencia (que nacía vacío) mientras el KPI y los filtros
// seguían leyendo el `estado` viejo del pedido — "en una parte se actualizó y
// en la otra se quedó viejo".
state.pedidos = [{
  id: "ped-esc", numeroOp: "OP-9999", cliente: "Cliente Escalado", descripcion: "Camisetas",
  cantidad: "8", total: 400000, costo: 200000, abono: 0, estado: "acabados", estadosDef: null,
  fechaCreacion: "2026-08-29", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [];
state.tab = "pedidos";
state.pedidosVista = "historial";
render();
click('[data-action="escalar-a-cotizacion"][data-id="ped-esc"]');
const cotEscalada = state.cotizaciones.find(c => c.pedidoOrigenId === "ped-esc");
assert(!!cotEscalada, "cotizar un pedido rápido crea su cotización");
assert(cotEscalada.referencias.every(r => r.estado === "acabados"), "y cada referencia nace CON el progreso que el pedido ya llevaba, no desde cero");
assert(calcMod.estadoAgregadoDeCot(cotEscalada).estado === "acabados", "así el estado agregado del pedido sigue siendo el mismo: las dos vistas no se pueden contradecir");

// El progreso lo pinta UNA sola pieza para los dos caminos (pedido rápido y
// desde cotización): si vuelve a haber dos renderizadores, esto se cae.
state.pedidos[0].cotizacionId = cotEscalada.id;
state.tab = "pedidos";
render();
const filasProgreso = document.querySelectorAll(".pedido-ref-progreso");
assert(filasProgreso.length === cotEscalada.referencias.length, "el pedido desde cotización pinta una fila de progreso por referencia");
state.pedidos[0].cotizacionId = "";
render();
assert(document.querySelectorAll(".pedido-ref-progreso").length === 1, "y el pedido rápido usa EXACTAMENTE la misma fila, una sola vez");
// La barra vieja con TODAS las etapas escritas (.tape-labels) existió, se
// quitó, y volvió a aparecer MEZCLADA con la fila compacta en un pedido
// rápido — el usuario lo reportó dos veces. No debe quedar ni rastro de ella,
// en ningún camino.
assert(!document.querySelector(".tape-labels"), "el pedido rápido no muestra la barra vieja con todas las etapas: solo la fila compacta");

// ---------------------------------------------------------------------------
// El bug reportado: "creé un pedido rápido, luego lo pasé a cotización,
// generé movimientos, pero quedaron como Movimientos sueltos (sin pedido)".
// Causa: una cotización "escalada" desde un pedido rápido (pedidoOrigenId)
// sigue siendo un BORRADOR — no tiene `pedidoId` hasta pulsar "Aplicar a
// pedido" — pero sí puede generar movimientos reales (comisión, costo
// estimado, compras) antes de eso. Esos movimientos armaban su `pedidoId`
// mirando solo `cot.pedidoId` (vacío en ese momento), así que quedaban sin
// pedido aunque el vínculo con el pedido real (pedidoOrigenId) siguiera ahí.
// ---------------------------------------------------------------------------
cotEscalada.vendedor = { nombre: "Vendedor Escalado", tipo: "fijo", valor: 30000, estado: "pendiente" };
state.cotVendedorEditando = cotEscalada.id;
state.tab = "cotizaciones";
state.cotizacionesVista = "nueva";
state.cotizacionEditando = cotEscalada.id;
render();
click('[data-action="toggle-comision-cot"][data-id="' + cotEscalada.id + '"]');
const txComisionEscalada = state.tx.find(t => t.origenComisionCotId === cotEscalada.id);
assert(!!txComisionEscalada, "pagar la comisión de una cotización escalada (sin aplicar aún) sí crea el movimiento");
assert(txComisionEscalada.pedidoId === "ped-esc", "y queda ligado al pedido rápido original (vía pedidoOrigenId), no huérfano");

// "sincronizar-compras-finanzas" (a diferencia del estimado completo, que
// exige la cotización ya convertida) está disponible desde el día uno, así
// que es el camino más típico para "generar movimientos" sobre un borrador
// escalado todavía sin aplicar — justo lo que reportó el usuario.
// Ojo: "toggle-comision-cot" ya reemplazó el objeto cotización en state (ver
// su handler, que usa Object.assign para devolver uno nuevo) — hay que
// tomarlo de nuevo del state en vez de seguir mutando la referencia vieja.
const cotEscaladaV2 = state.cotizaciones.find(c => c.id === cotEscalada.id);
cotEscaladaV2.costosGlobales = [{ id: "cg1", nombre: "Domicilio", costo: 20000, proveedorId: "", esServicio: false }];
cotEscaladaV2.compras = [{ clave: "global|cg1", estado: "si", costoReal: 20000 }];
render();
click('[data-action="set-cot-tab"][data-id="' + cotEscalada.id + '"][data-val="produccion"]');
click('[data-action="sincronizar-compras-finanzas"][data-id="' + cotEscalada.id + '"]');
const txCompraEscalada = state.tx.find(t => t.origenCompraClave === "global|cg1");
assert(!!txCompraEscalada, "registrar una compra real también funciona antes de aplicar la cotización");
assert(txCompraEscalada.pedidoId === "ped-esc", "y también queda agrupado bajo el pedido rápido en vez de aparecer como suelto");

state.tab = "finanzas";
state.finanzasVista = "historial";
state.filtroTx = "todos"; state.filtroTxPeriodo = "todos";
render();
const cards = [...document.querySelectorAll(".card")];
const cardOp = cards.find(c => c.textContent.includes("OP-9999"));
const cardSueltos = cards.find(c => c.textContent.includes("Movimientos sueltos"));
assert(!!cardOp && cardOp.textContent.includes("Vendedor Escalado") && cardOp.textContent.includes("Compra — Domicilio"), "en Finanzas, los dos movimientos aparecen agrupados bajo el pedido OP-9999");
assert(!cardSueltos || (!cardSueltos.textContent.includes("Vendedor Escalado") && !cardSueltos.textContent.includes("Compra — Domicilio")), "y NINGUNO de los dos cae en \"Movimientos sueltos (sin pedido)\"");

// La reparación de arriba corre en vivo (al registrar el movimiento), pero
// quien reportó el bug ya tenía tx VIEJOS quedados huérfanos en su Sheet real
// desde antes de este fix. repararTxHuerfanosDeCotEscalada (store.js) es la
// auto-reparación que corre una vez en loadAll() para esos casos ya
// existentes — se prueba aparte, en aislamiento, porque loadAll() completo
// necesita una sesión de Google real.
const txViejoHuerfano = { id: "tx-viejo-huerfano", tipo: "gasto", concepto: "Compra vieja", cotizacionId: "cot-vieja-esc", pedidoId: "" };
const cotViejaEscalada = { id: "cot-vieja-esc", pedidoOrigenId: "ped-viejo", pedidoId: "" };
const pedOrigenViejo = { id: "ped-viejo", numeroOp: "OP-0001" };
let reparoAlgo = repararTxHuerfanosDeCotEscalada([txViejoHuerfano], [cotViejaEscalada], [pedOrigenViejo]);
assert(reparoAlgo === true, "repararTxHuerfanosDeCotEscalada avisa que sí reparó algo");
assert(txViejoHuerfano.pedidoId === "ped-viejo", "y le rellena el pedidoId huérfano usando pedidoOrigenId de su cotización");

// No toca nada que no deba: un tx ya ligado, uno sin cotización, uno cuya
// cotización ya no existe, y uno cuyo pedido de destino ya no existe tampoco.
const txYaLigado = { id: "tx-ok", cotizacionId: "cot-vieja-esc", pedidoId: "ya-tenia" };
const txSinCot = { id: "tx-suelto-real", cotizacionId: "", pedidoId: "" };
const txCotBorrada = { id: "tx-cot-borrada", cotizacionId: "no-existe", pedidoId: "" };
const txPedidoBorrado = { id: "tx-pedido-borrado", cotizacionId: "cot-pedido-borrado", pedidoId: "" };
const cotPedidoBorrado = { id: "cot-pedido-borrado", pedidoOrigenId: "pedido-que-ya-no-existe", pedidoId: "" };
reparoAlgo = repararTxHuerfanosDeCotEscalada(
  [txYaLigado, txSinCot, txCotBorrada, txPedidoBorrado],
  [cotViejaEscalada, cotPedidoBorrado],
  [pedOrigenViejo]
);
assert(reparoAlgo === false, "y si no hay nada reparable, lo dice (no queda tocando cosas sin necesidad)");
assert(txYaLigado.pedidoId === "ya-tenia", "un tx que ya tenía pedidoId no se toca");
assert(txSinCot.pedidoId === "", "uno sin cotizacionId (huérfano de verdad, sin pedido de origen) se deja para la papelera/filtro de \"Sueltos\", no se inventa un pedido");
assert(txCotBorrada.pedidoId === "", "uno cuya cotización ya no existe tampoco se toca: no hay de dónde sacar el pedido");
assert(txPedidoBorrado.pedidoId === "", "y si el pedido de destino también fue eliminado, no se resucita un pedidoId que apunta a la nada");

// ---------------------------------------------------------------------------
// El usuario reportó, con un reporte financiero real: un pedido con una
// comisión de vendedor YA PAGADA ("Comisión — negra", $31.500 en Finanzas)
// aparecía como "(sin vendedor)" en "Pedidos del periodo" y "Ventas por
// vendedor". Causa: "aplicar-cotizacion-a-pedido" (modules/cotizaciones.js)
// comparaba cot.vendedor contra "truthy" en vez de contra su .nombre — un
// vendedor asignado directo en el pedido (después de escalarlo a
// cotización, sin tocar el vendedor DE LA COTIZACIÓN) se borraba al
// "Aplicar a pedido" si esa cotización nunca tuvo su propio vendedor. Fix
// de origen en ese punto; repararVendedorPerdido (store.js) es la
// auto-reparación en loadAll() para pedidos que ya habían quedado así con
// datos viejos — mismo patrón que repararTxHuerfanosDeCotEscalada arriba.
// ---------------------------------------------------------------------------
const pedVendedorPerdido = { id: "ped-vendedor-perdido", numeroOp: "OP-0002", vendedor: null };
const txComisionVendedorPerdido = { id: "tx-comision-negra", tipo: "comision", concepto: "Comisión — negra", contraparte: "negra", monto: 31500, origenComisionPedidoId: "ped-vendedor-perdido" };
let reparoVendedor = repararVendedorPerdido([pedVendedorPerdido], [txComisionVendedorPerdido]);
assert(reparoVendedor === true, "repararVendedorPerdido avisa que sí reparó algo");
assert(pedVendedorPerdido.vendedor && pedVendedorPerdido.vendedor.nombre === "negra", "reconstruye el nombre del vendedor a partir del tx de la comisión ya pagada");
assert(pedVendedorPerdido.vendedor.valor === 31500 && pedVendedorPerdido.vendedor.estado === "pagado", "...con el monto que de verdad se pagó y marcado como pagado (no se puede saber si era % o fijo, así que se restaura como fijo por lo ya pagado)");

// No toca nada que no deba: un pedido que YA tiene vendedor, uno sin
// ninguna comisión que lo respalde, y un tx de otro tipo (nunca debería
// llevar origenComisionPedidoId, pero por si acaso no cuenta).
const pedConVendedorOk = { id: "ped-vendedor-ok", numeroOp: "OP-0003", vendedor: { nombre: "Carlos", tipo: "porcentaje", valor: 5, estado: "pendiente" } };
const pedSinComisionQueLoRespalde = { id: "ped-sin-comision", numeroOp: "OP-0004", vendedor: null };
const txGastoConMarcaRara = { id: "tx-gasto-raro", tipo: "gasto", contraparte: "no debería contar", monto: 1000, origenComisionPedidoId: "ped-sin-comision" };
reparoVendedor = repararVendedorPerdido([pedConVendedorOk, pedSinComisionQueLoRespalde], [txComisionVendedorPerdido, txGastoConMarcaRara]);
assert(reparoVendedor === false, "y si no hay nada reparable, lo dice");
assert(pedConVendedorOk.vendedor.nombre === "Carlos" && pedConVendedorOk.vendedor.tipo === "porcentaje", "un pedido que ya tiene vendedor no se toca, aunque exista una comisión pagada de otro pedido");
assert(pedSinComisionQueLoRespalde.vendedor === null, "un pedido sin vendedor pero sin ninguna comisión real que lo respalde se deja tal cual (no se inventa un vendedor)");

// ---------------------------------------------------------------------------
// Post-mortem en vivo 2026-09-20: sheetsTabular.js lee "Movimientos" por
// POSICIÓN — el esquema (core/sheetsEsquemas.js) tuvo una columna insertada
// en medio del arreglo TRES veces en su historia (2026-09-10, 2026-09-19,
// 2026-09-20 — la última ya corregida). Cualquier movimiento anterior a cada
// una de esas fechas terminó leyendo, en sus campos de marca de origen, el
// dato de una columna vecina — el usuario reportó una compra de insumo real
// con la insignia "origen eliminado" cuyo tooltip decía "se generó desde la
// comisión de un vendedor", y un pago de nómina real cuyo tooltip decía "se
// generó desde un aporte nuevo al Colchón". Ninguno de los dos es posible
// por construcción: una comisión SIEMPRE nace con tipo "comision", nunca
// "gasto"/"nomina"; un aporte al Colchón SIEMPRE nace con tipo "ingreso".
// repararMarcasOrigenInconsistentes (store.js) limpia esos campos
// imposibles — no puede recuperar el dato ORIGINAL que se perdió con el
// corrimiento, pero al menos el movimiento deja de mostrar una insignia
// confusa y falsa.
// ---------------------------------------------------------------------------
const txCompraConComisionFalsa = { id: "tx-compra-marca-falsa", tipo: "gasto", concepto: "Compra — Elastico — Uniformes de futbol", contraparte: "", monto: 8000, origenComisionPedidoId: "algo-que-nunca-fue-esto" };
const txNominaConColchonFalso = { id: "tx-nomina-marca-falsa", tipo: "nomina", concepto: "Nómina 6-12 sept — Doña Janneh", contraparte: "Doña Janneh", monto: 50000, origenColchonId: "algo-que-nunca-fue-esto" };
// Control: una comisión REAL con origenComisionPedidoId (combinación válida
// para su tipo) no se toca.
const txComisionRealIntacta = { id: "tx-comision-real-intacta", tipo: "comision", concepto: "Comisión — negra", contraparte: "negra", monto: 31500, origenComisionPedidoId: "ped-vendedor-perdido" };
let reparoMarcas = repararMarcasOrigenInconsistentes([txCompraConComisionFalsa, txNominaConColchonFalso, txComisionRealIntacta]);
assert(reparoMarcas === true, "repararMarcasOrigenInconsistentes avisa que sí reparó algo");
assert(txCompraConComisionFalsa.origenComisionPedidoId === "", "una compra (tipo \"gasto\") con origenComisionPedidoId queda limpia — ninguna comisión nace como gasto");
assert(txNominaConColchonFalso.origenColchonId === "", "un pago de nómina con origenColchonId queda limpio — ningún aporte al Colchón nace como nómina");
assert(txComisionRealIntacta.origenComisionPedidoId === "ped-vendedor-perdido", "...pero una comisión real (tipo \"comision\") con esa misma marca NO se toca");
assert(repararMarcasOrigenInconsistentes([txComisionRealIntacta]) === false, "y sobre datos ya limpios, no reporta ninguna reparación");

// El caso MÁS extendido, confirmado por el usuario tras agregar el
// campo/valor exacto al tooltip: "origenGastoFijoPeriodo: 1" en una compra
// real. Ese "1" es el `esInsumo: "1"` de TODA compra de insumo (ver
// sincronizar-compras-finanzas en modules/cotizaciones.js), leído en la
// posición equivocada por el corrimiento de columnas del 2026-09-10. Como
// "gasto" SÍ es válido para origenGastoFijoPeriodo (un gasto fijo real
// también es "gasto"), el chequeo por tipo NO alcanza acá — hace falta el
// chequeo de forma ("<id>|<periodo>", nunca solo "1").
const txCompraConGastoFijoFalso = { id: "tx-compra-gastofijo-falso", tipo: "gasto", concepto: "Compra — Ojales Herraje — Bandera del equipo x1", contraparte: "", monto: 6400, origenGastoFijoPeriodo: "1", origenCompraClave: "global|cg-ojales-real" };
const txGastoFijoRealIntacto = { id: "tx-gastofijo-real-intacto", tipo: "gasto", concepto: "Gasto fijo — Arriendo", contraparte: "Arriendo", monto: 500000, origenGastoFijoPeriodo: "gf-arriendo|2026-09" };
let reparoGastoFijoFalso = repararMarcasOrigenInconsistentes([txCompraConGastoFijoFalso, txGastoFijoRealIntacto]);
assert(reparoGastoFijoFalso === true, "repararMarcasOrigenInconsistentes también avisa que reparó esto");
assert(txCompraConGastoFijoFalso.origenGastoFijoPeriodo === "", "origenGastoFijoPeriodo sin \"|\" (el \"1\" de esInsumo, leído en la posición equivocada) queda limpio, aunque \"gasto\" sea un tipo válido para ese campo");
assert(txCompraConGastoFijoFalso.origenCompraClave === "global|cg-ojales-real", "...y NO toca origenCompraClave — la marca real de esta compra sigue intacta, así que ahora SÍ puede respaldarla si la línea existe");
assert(txGastoFijoRealIntacto.origenGastoFijoPeriodo === "gf-arriendo|2026-09", "un origenGastoFijoPeriodo real (con \"<id>|<periodo>\") no se toca");

// ---------------------------------------------------------------------------
// Reporte en producción, mismo día: el usuario notó que "Origen eliminado"
// solo le salía en SALIDAS de dinero (gastos), nunca en ingresos — pista
// correcta: es una compra que perdió su seguimiento en cot.compras (el bug
// de clave inestable de un insumo renombrado, ya evitado hacia adelante en
// sincronizar-compras-finanzas) mientras la línea que la originó sigue
// viva. Sin reparar esto, el usuario no puede corregirlo solo desde la UI:
// volver a marcar "Sí" crea un movimiento NUEVO en vez de reconectar el
// que ya existe, contando el mismo gasto dos veces.
// ---------------------------------------------------------------------------
const { repararComprasSinSeguimiento } = await import("../js/core/calc.js");
const cotSeguimientoTest = {
  id: "cot-seguimiento-test", cliente: "Cliente Seguimiento", descripcion: "Prueba seguimiento", fecha: "2026-08-30",
  estado: "convertida", pedidoId: "", pedidoOrigenId: "", vendedor: null,
  referencias: [],
  costosGlobales: [
    { id: "cg-sigue-vivo", nombre: "Sublimación", costo: 38000, proveedorId: "", esServicio: false },
    { id: "cg-ya-no-existe-de-verdad", nombre: "Ya no existe", costo: 1000, proveedorId: "", esServicio: false }
  ],
  serviciosCobrados: [],
  // cot.compras vacío a propósito: así queda exactamente como el reporte
  // real (la línea sigue en costosGlobales, pero su seguimiento se perdió).
  compras: []
};
const txSublimacionSinSeguimiento = { id: "tx-sublimacion-sin-seguimiento", tipo: "gasto", concepto: "Compra — Sublimación — Prueba seguimiento", monto: 38000, contraparte: "", fecha: "2026-08-30", cotizacionId: "cot-seguimiento-test", origenCompraClave: "global|cg-sigue-vivo" };
// Este segundo caso simula un costo global que SÍ se borró de verdad —
// nunca debe reconectarse, tiene que seguir huérfano.
cotSeguimientoTest.costosGlobales = cotSeguimientoTest.costosGlobales.filter(function (g) { return g.id !== "cg-ya-no-existe-de-verdad"; });
const txGenuinoHuerfanoSeguimiento = { id: "tx-genuino-huerfano-seguimiento", tipo: "gasto", concepto: "Compra — Ya no existe — Prueba seguimiento", monto: 1000, contraparte: "", fecha: "2026-08-30", cotizacionId: "cot-seguimiento-test", origenCompraClave: "global|cg-ya-no-existe-de-verdad" };
let reparoSeguimiento = repararComprasSinSeguimiento([txSublimacionSinSeguimiento, txGenuinoHuerfanoSeguimiento], [cotSeguimientoTest]);
assert(reparoSeguimiento === true, "repararComprasSinSeguimiento avisa que sí reparó algo");
assert(cotSeguimientoTest.compras.length === 1, "reconecta SOLO la compra cuya línea sigue viva de verdad (Sublimación), no la que de verdad ya no existe");
const comprasReconectada = cotSeguimientoTest.compras[0];
assert(comprasReconectada.clave === "global|cg-sigue-vivo" && comprasReconectada.txId === "tx-sublimacion-sin-seguimiento" && comprasReconectada.costoReal === 38000, "...reconectada al MISMO tx existente (mismo id, mismo monto) — ningún movimiento nuevo, la función solo toca cot.compras");
assert(!cotSeguimientoTest.compras.some(function (co) { return co.clave === "global|cg-ya-no-existe-de-verdad"; }), "la compra genuinamente eliminada NO se reconecta — sigue huérfana, que es lo correcto");
assert(repararComprasSinSeguimiento([txSublimacionSinSeguimiento], [cotSeguimientoTest]) === false, "y una vez reconectada, correr la reparación de nuevo no hace nada (ya está al día)");

// El fix de ORIGEN (no solo la reparación de datos viejos): "Aplicar a
// pedido" sobre una cotización escalada, cuando esa cotización nunca tuvo
// su propio vendedor (el vendedor se asignó directo en el pedido), ya NO
// borra el vendedor real del pedido — antes cualquier objeto no-nulo de
// cot.vendedor (incluido uno vacío) ganaba sobre el del pedido.
const pedidosPreviosVendedorFix = state.pedidos, cotizacionesPreviasVendedorFix = state.cotizaciones;
state.pedidos = state.pedidos.concat([{
  id: "ped-aplicar-vendedor-test", numeroOp: "OP-APLICAR-VEND", cliente: "Cliente Aplicar", descripcion: "Prueba aplicar",
  cantidad: "1", total: 100000, costo: 40000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-aplicar-vendedor-test",
  vendedor: { nombre: "Vendedor Real", tipo: "fijo", valor: 25000, estado: "pagado" },
  abonos: [], lineas: [], stockConsumido: []
}]);
state.cotizaciones = state.cotizaciones.concat([{
  id: "cot-aplicar-vendedor-test", cliente: "Cliente Aplicar", descripcion: "Prueba aplicar", fecha: "2026-01-01",
  estado: "borrador", pedidoOrigenId: "ped-aplicar-vendedor-test", pedidoId: "",
  // Truthy pero vacío — exactamente lo que deja set-cot-vendedor (core/calc.js)
  // en cuanto se toca el panel Vendedor de la cotización sin escribir un
  // nombre: null hubiera sido un caso demasiado fácil (falsy en los dos
  // casos, con o sin el bug) y no habría detectado nada.
  vendedor: { nombre: "", tipo: "porcentaje", valor: 0, estado: "pendiente" },
  gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "capv1",
  referencias: [{
    id: "ref-apv-1", nombre: "Producto", imagenUrl: "", consumoAprox: 1, cantidadPedida: 1, precioVenta: 100000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [], detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}]);
click('[data-action="tab"][data-tab="cotizaciones"]');
click('[data-action="cot-vista"][data-val="historial"]');
click('[data-action="abrir-cotizacion-editor"][data-id="cot-aplicar-vendedor-test"]');
click('[data-action="aplicar-cotizacion-a-pedido"][data-id="cot-aplicar-vendedor-test"]');
const pedTrasAplicar = state.pedidos.find(p => p.id === "ped-aplicar-vendedor-test");
assert(!!pedTrasAplicar && pedTrasAplicar.vendedor && pedTrasAplicar.vendedor.nombre === "Vendedor Real", "\"Aplicar a pedido\" con la cotización SIN su propio vendedor NO borra el vendedor real del pedido");
assert(pedTrasAplicar.vendedor.estado === "pagado", "...y conserva que su comisión ya estaba pagada");
assert(pedTrasAplicar.total === 100000, "...mientras que el resto de los datos SÍ se aplican normal (total tomado de la cotización)");
state.pedidos = pedidosPreviosVendedorFix; state.cotizaciones = cotizacionesPreviasVendedorFix;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// ---------------------------------------------------------------------------
// Auditoría financiera 2026-09-20: la comisión de un vendedor se podía pagar
// DOS VECES — una desde el pedido, otra desde la cotización que lo originó —
// porque cada lado usa un campo de origen distinto (origenComisionPedidoId
// vs. origenComisionCotId) que nunca se cruzan. Se corrigió con dos piezas:
// (1) al convertir/aplicar, si la comisión ya estaba pagada, el tx real se
// RE-ETIQUETA como del pedido; (2) una vez la cotización tiene un pedido real
// (c.pedidoId), su propio toggle queda bloqueado — la única fuente pasa a
// ser el pedido.
// ---------------------------------------------------------------------------
const { duplicarCotizacionCompleta: duplicarCotTest, actions: cotAccionesTest } = await import("../js/modules/cotizaciones.js");

// --- 1) Duplicar una cotización con la comisión ya pagada la resetea ---
const cotComisionPagadaParaDuplicar = {
  id: "cot-dup-comision-test", cliente: "Cliente Original", descripcion: "Prueba", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-dup-comision-test", pedidoOrigenId: "",
  vendedor: { nombre: "Vendedor Duplicado", tipo: "fijo", valor: 90000, estado: "pagado", fechaPago: "2026-01-05" },
  gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cdct1",
  referencias: [],
  costosGlobales: [{ id: "cg-original-dup-test", nombre: "Domicilio", costo: 17000, proveedorId: "", esServicio: false }],
  serviciosCobrados: [{ id: "sc-original-dup-test", nombre: "Diseño", costo: 20000, proveedorId: "" }],
  compras: []
};
const copiaConComisionReseteada = duplicarCotTest(cotComisionPagadaParaDuplicar);
assert(copiaConComisionReseteada.vendedor.nombre === "Vendedor Duplicado", "duplicar una cotización conserva el NOMBRE del vendedor");
assert(copiaConComisionReseteada.vendedor.estado === "pendiente" && copiaConComisionReseteada.vendedor.fechaPago === "", "...pero resetea el estado 'pagado' — la copia no tiene ningún pago real detrás (auditoría 2026-09-20)");
// Post-mortem 2026-09-20: un costo global/servicio cobrado con el MISMO id
// que el original hace que su clave en calcListaCompras ("global|"+id) sea
// IDÉNTICA entre las dos cotizaciones — dos registros que deberían ser
// independientes comparten identidad por accidente (el mismo hueco que
// referencias/insumos ya tenían tapado arriba).
assert(copiaConComisionReseteada.costosGlobales[0].nombre === "Domicilio" && copiaConComisionReseteada.costosGlobales[0].id !== "cg-original-dup-test", "el costo global se conserva (mismo nombre/costo) pero con un id PROPIO, no el del original");
assert(copiaConComisionReseteada.serviciosCobrados[0].nombre === "Diseño" && copiaConComisionReseteada.serviciosCobrados[0].id !== "sc-original-dup-test", "...mismo criterio para un servicio cobrado");

// --- 2) Escalar un pedido con comisión ya pagada a cotización también la resetea ---
const pedidosPreviosEscComision = state.pedidos, cotizacionesPreviasEscComision = state.cotizaciones;
state.pedidos = state.pedidos.concat([{
  id: "ped-esc-comision-test", numeroOp: "OP-ESC-COM", cliente: "Cliente Esc", descripcion: "Prueba escalar",
  cantidad: "1", total: 100000, costo: 40000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  vendedor: { nombre: "Vendedor Escalado Pagado", tipo: "fijo", valor: 15000, estado: "pagado" },
  abonos: [], lineas: [], stockConsumido: []
}]);
state.tab = "pedidos"; state.pedidosVista = "historial"; render();
click('[data-action="escalar-a-cotizacion"][data-id="ped-esc-comision-test"]');
const cotDeEscComision = state.cotizaciones.find(c => c.pedidoOrigenId === "ped-esc-comision-test");
assert(!!cotDeEscComision && cotDeEscComision.vendedor.nombre === "Vendedor Escalado Pagado", "escalar un pedido conserva el nombre del vendedor");
assert(cotDeEscComision.vendedor.estado === "pendiente", "...pero resetea 'pagado' a 'pendiente': el tx real sigue siendo del pedido, no de esta cotización nueva (auditoría 2026-09-20)");
state.pedidos = pedidosPreviosEscComision; state.cotizaciones = cotizacionesPreviasEscComision;

// --- 3) Convertir una cotización con comisión YA pagada: el tx se re-etiqueta ---
const pedidosPreviosConvComision = state.pedidos, cotizacionesPreviasConvComision = state.cotizaciones, txPreviosConvComision = state.tx;
state.pedidos = [];
state.cotizaciones = [{
  id: "cot-conv-comision-test", clienteId: "", cliente: "Cliente Convertir", descripcion: "Prueba convertir", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: { nombre: "Vendedor Convertido", tipo: "fijo", valor: 50000, estado: "pagado", fechaPago: "2026-01-02" },
  gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "ccct1",
  referencias: [{ id: "r-ccct1", nombre: "Producto", imagenUrl: "", consumoAprox: 1, cantidadPedida: 1, precioVenta: 100000, origen: "taller", costoCompra: 0, proveedorId: "", insumos: [], detalle: [], estado: "nuevo", estadosDef: null }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.tx = [{ id: "tx-comision-preconversion", tipo: "comision", concepto: "Comisión — Vendedor Convertido", monto: 50000, contraparte: "Vendedor Convertido", fecha: "2026-01-02", pedidoId: "", cotizacionId: "cot-conv-comision-test", origenComisionCotId: "cot-conv-comision-test" }];
state.tab = "cotizaciones"; state.cotVendedorEditando = ""; state.cotizacionEditando = ""; state.cotizacionesVista = "historial";
render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-conv-comision-test"]');
click('[data-action="convertir-cotizacion"][data-id="cot-conv-comision-test"]');
const pedidoRecienConvertido = state.pedidos.find(p => p.cotizacionId === "cot-conv-comision-test");
assert(!!pedidoRecienConvertido && pedidoRecienConvertido.vendedor.estado === "pagado", "el pedido nuevo hereda la comisión ya pagada");
const txsDeEstaComision = state.tx.filter(t => t.contraparte === "Vendedor Convertido");
assert(txsDeEstaComision.length === 1, "sigue existiendo UN SOLO movimiento de esa comisión (no se duplicó al convertir)");
assert(txsDeEstaComision[0].origenComisionPedidoId === pedidoRecienConvertido.id && !txsDeEstaComision[0].origenComisionCotId, "...y quedó re-etiquetado como del PEDIDO (antes seguía marcado origenComisionCotId, invisible para 'Deshacer el pago' del lado del pedido)");
// "Deshacer el pago" desde el PEDIDO ahora sí encuentra y borra ESE tx (antes no lo encontraba, y el pedido igual quedaba "pendiente" con el gasto real todavía ahí).
state.tab = "pedidos"; state.pedidosVista = "historial"; render();
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoRecienConvertido.id + '"]');
click('[data-action="toggle-comision"][data-id="' + pedidoRecienConvertido.id + '"]');
assert(state.tx.filter(t => t.contraparte === "Vendedor Convertido").length === 0, "\"Deshacer el pago\" desde el pedido SÍ retira el tx real (antes no lo encontraba por el campo de origen distinto)");
assert(state.pedidos.find(p => p.id === pedidoRecienConvertido.id).vendedor.estado === "pendiente", "...y el pedido vuelve a quedar pendiente de verdad");
// Volver a marcarla pagada crea UN solo tx nuevo, no un segundo fantasma.
click('[data-action="toggle-comision"][data-id="' + pedidoRecienConvertido.id + '"]');
assert(state.tx.filter(t => t.contraparte === "Vendedor Convertido").length === 1, "volver a pagarla crea un único movimiento nuevo, no arrastra ningún duplicado");
// Y la cotización ya convertida ya NO puede tocar esa comisión por su cuenta.
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-conv-comision-test"]');
state.cotVendedorEditando = "cot-conv-comision-test";
render();
assert(!document.querySelector('[data-action="toggle-comision-cot"][data-id="cot-conv-comision-test"]'), "una cotización ya convertida ya no muestra el botón para tocar la comisión por su cuenta — la única fuente es el pedido");
const txsAntesDeIntentoBloqueado = state.tx.length;
cotAccionesTest["toggle-comision-cot"]({ getAttribute: function () { return "cot-conv-comision-test"; } });
assert(state.tx.length === txsAntesDeIntentoBloqueado, "...y si de todos modos se dispara la acción (red de seguridad), el guardia la bloquea sin tocar Finanzas");
state.pedidos = pedidosPreviosConvComision; state.cotizaciones = cotizacionesPreviasConvComision; state.tx = txPreviosConvComision;
state.cotVendedorEditando = ""; state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// ---------------------------------------------------------------------------
// La serie de movimientos es una LÍNEA DE TIEMPO, no una lista de fechas con
// datos. Antes solo existían los periodos con movimientos, así que dos días
// separados por una semana se dibujaban pegados y la forma de la curva mentía.
// ---------------------------------------------------------------------------
const serieHuecos = calcMod.calcSerieMovimientos([
  { tipo: "ingreso", monto: 100000, fecha: "2026-03-02" },
  { tipo: "gasto", monto: 40000, fecha: "2026-03-12" }
], "2026-03-01", "2026-03-15");
assert(serieHuecos.puntos.length === 15, "la serie trae un punto por cada día del rango, no solo por los días con movimientos");
assert(serieHuecos.puntos[0].clave === "2026-03-01" && serieHuecos.puntos[14].clave === "2026-03-15", "empieza y termina exactamente en el rango pedido");
assert(serieHuecos.puntos[0].ingresos === 0 && serieHuecos.puntos[0].gastos === 0, "un día sin nada existe y vale cero");
assert(serieHuecos.puntos[1].ingresos === 100000, "y el día con movimiento conserva su monto");
const sumaIngresos = serieHuecos.puntos.reduce((a, p) => a + p.ingresos, 0);
const sumaGastos = serieHuecos.puntos.reduce((a, p) => a + p.gastos, 0);
assert(sumaIngresos === 100000 && sumaGastos === 40000, "rellenar con ceros no inventa ni pierde plata: los totales son exactos");

// El borrador del abono es de UN pedido: con varios paneles abiertos, lo
// tecleado en uno no puede aparecer escrito dentro del formulario del otro.
state.pedidos = [
  { id: "pa", numeroOp: "OP-A", cliente: "A", descripcion: "A", cantidad: "1", total: 100000, costo: 0,
    abono: 0, estado: "nuevo", estadosDef: null, fechaCreacion: "2026-08-29", fechaEntrega: "",
    tipoCliente: "propio", cotizacionId: "", abonos: [], lineas: [], stockConsumido: [], vendedor: null },
  { id: "pb", numeroOp: "OP-B", cliente: "B", descripcion: "B", cantidad: "1", total: 200000, costo: 0,
    abono: 0, estado: "nuevo", estadosDef: null, fechaCreacion: "2026-08-29", fechaEntrega: "",
    tipoCliente: "propio", cotizacionId: "", abonos: [], lineas: [], stockConsumido: [], vendedor: null }
];
state.tab = "pedidos";
state.pedidosVista = "historial";
state.pedidoPanelAbierto = { pa: true, pb: true };
state.formAbono = { pedidoId: "", monto: "", fecha: "", metodo: "efectivo" };
render();
setInput('#abono-monto-pa', "50000");
assert(state.formAbono.monto === "50000" && state.formAbono.pedidoId === "pa", "escribir un abono lo guarda en el estado, marcado con su pedido");
render();
assert(document.getElementById("abono-monto-pa").value === "50000", "al redibujar, el monto tecleado sigue ahí (antes se perdía: es plata)");
assert(document.getElementById("abono-monto-pb").value === "", "y NO aparece dentro del formulario del otro pedido");

// ---------------------------------------------------------------------------
// Regresiones encontradas en la revisión adversarial. Cada assert de acá fija
// un caso que ya se rompió una vez.
// ---------------------------------------------------------------------------

// Dos referencias del mismo pedido pueden tener flujos de LARGO distinto. Una
// comprada a proveedor tiene 2 etapas; una del taller, 5. Comparando índices
// crudos, la de proveedor ya recibida (1 de 2 = terminada) salía "menos
// avanzada" que la del taller en Confección (2 de 5 = a la mitad), y el pedido
// entero se daba por entregado con la prenda todavía en la máquina.
const cotMixta = { referencias: [
  { id: "rp", insumos: [{ id: "irp", nombre: "Camiseta", tipo: "producto_comprado", costo: 20000, cantidad: 1 }], estado: "recibido", estadosDef: null },
  { id: "rt", insumos: [{ id: "irt", nombre: "Tela", tipo: "tela", costo: 5000, cantidad: 1 }], estado: "confeccion", estadosDef: null }
] };
const agrMixto = calcMod.estadoAgregadoDeCot(cotMixta);
assert(agrMixto.estado === "confeccion", "el pedido sigue el ritmo de la pieza REALMENTE menos avanzada, comparando fracción de avance y no índices de flujos de distinto largo");
assert(!calcMod.pedidoTerminado(agrMixto), "y por lo tanto NO se da por terminado mientras esa pieza siga en producción");

// Desde que la serie es continua, la cantidad de puntos la fija el rango: un
// año mal tecleado no puede generar decenas de miles de etiquetas.
const serieAbsurda = calcMod.calcSerieMovimientos(
  [{ tipo: "ingreso", monto: 1000, fecha: "2026-08-01" }], "1900-01-01", "2026-12-31");
assert(serieAbsurda.granularidad === "anio", "un rango de más de cinco años se agrupa por año, no por mes");
assert(serieAbsurda.puntos.length <= 600, "y en ningún caso la serie pasa del tope de periodos (" + serieAbsurda.puntos.length + ")");
assert(serieAbsurda.puntos.some(p => p.ingresos === 1000), "el movimiento real sigue estando en la serie recortada");

// Insumos: un filtro que apunta a una categoría borrada dejaba la lista vacía
// sin ningún chip encendido que lo explicara.
state.catalogoCategorias = [{ id: "cx", nombre: "Telas" }];
state.catalogoInsumos = [{ id: "ix", nombre: "Tela", unidad: "MT", costo: 1000, tipo: "tela", categoriaId: "cx", proveedorId: "" }];
state.filtroCatalogoCategoria = "cx";
state.buscarCatalogo = "";
state.tab = "catalogo";
render();
state.catalogoCategorias = []; // la categoría desaparece (aprobar una propuesta, otra pestaña…)
render();
assert(state.filtroCatalogoCategoria === "todos", "si la categoría filtrada deja de existir, el filtro se sanea EN EL ESTADO (no solo en la vista, o resucita)");
assert(document.querySelectorAll(".tx-row.insumo:not(.head)").length === 1, "y el insumo vuelve a verse en vez de quedar una lista vacía sin explicación");

// El conteo del buscador no puede prometer resultados que el chip ya descartó.
state.catalogoCategorias = [{ id: "c1", nombre: "Telas" }, { id: "c2", nombre: "Hilos" }];
state.catalogoInsumos = [
  { id: "i1", nombre: "Tela", unidad: "MT", costo: 1, tipo: "tela", categoriaId: "c1", proveedorId: "" },
  { id: "i2", nombre: "Hilo", unidad: "UND", costo: 1, tipo: "por_prenda", categoriaId: "c2", proveedorId: "" }
];
state.filtroCatalogoCategoria = "c2";
render();
assert(document.querySelector(".buscador-conteo").textContent === "1 insumo", "con un chip activo el conteo habla de lo que el chip deja pasar, no del catálogo entero");

// Registrar un abono no puede borrar el borrador que hay tecleado en OTRO pedido.
state.pedidos = [
  { id: "pa", numeroOp: "OP-A", cliente: "A", descripcion: "A", cantidad: "1", total: 100000, costo: 0,
    abono: 0, estado: "nuevo", estadosDef: null, fechaCreacion: "2026-08-29", fechaEntrega: "",
    tipoCliente: "propio", cotizacionId: "", abonos: [], lineas: [], stockConsumido: [], vendedor: null },
  { id: "pb", numeroOp: "OP-B", cliente: "B", descripcion: "B", cantidad: "1", total: 200000, costo: 0,
    abono: 0, estado: "nuevo", estadosDef: null, fechaCreacion: "2026-08-29", fechaEntrega: "",
    tipoCliente: "propio", cotizacionId: "", abonos: [], lineas: [], stockConsumido: [], vendedor: null }
];
state.tab = "pedidos"; state.pedidosVista = "historial"; state.pedidoPanelAbierto = { pa: true, pb: true };
state.formAbono = { pedidoId: "", monto: "", fecha: "", metodo: "efectivo" };
render();
setInput('#abono-monto-pb', "30000");
click('[data-action="add-abono"][data-id="pa"]');
assert(state.formAbono.monto === "30000" && state.formAbono.pedidoId === "pb", "el borrador del OTRO pedido sobrevive: solo se limpia el de aquel en el que se registró");

// Un pedido cancelado no ofrece cobrar lo que la propia tarjeta da por perdido.
state.pedidos = [{ id: "pc", numeroOp: "OP-C", cliente: "C", descripcion: "C", cantidad: "1",
  total: 500000, costo: 0, abono: 0, estado: "cancelado", cancelado: true, estadosDef: null,
  fechaCreacion: "2026-08-29", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null }];
state.pedidoPanelAbierto = { pc: true };
render();
if (calcMod.pedidoCancelado(state.pedidos[0])) {
  assert(!document.querySelector('[data-action="add-abono"][data-id="pc"]'), "un pedido cancelado no muestra el formulario de abono");
  assert(document.body.textContent.includes("Quedó sin cobrar"), "y su saldo se etiqueta 'Quedó sin cobrar', no 'Falta por cobrar'");
}

// Y al revés: un pedido ya cobrado SÍ debe dejar registrar otro abono (antes
// el formulario solo salía con saldo > 0, así que no había forma).
state.pedidos = [{ id: "pd", numeroOp: "OP-D", cliente: "D", descripcion: "D", cantidad: "1",
  total: 100000, costo: 0, abono: 100000, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-08-29", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null }];
state.pedidoPanelAbierto = { pd: true };
render();
assert(!!document.querySelector('[data-action="add-abono"][data-id="pd"]'), "un pedido cobrado completo sigue permitiendo registrar un abono (antes era imposible)");

// El estado vacío de la gráfica quedó inalcanzable al volverse continua la
// serie: en vez del aviso se dibujaban 30 barras en cero con "Entró $0".
state.tx = [];
state.tab = "resumen";
render();
assert(document.body.textContent.includes("Sin movimientos en este rango para graficar"),
  "sin movimientos, la tarjeta de la gráfica lo DICE en vez de dibujar 30 barras en cero");
assert(!document.getElementById("chart-ingresos-gastos"),
  "y ni siquiera emite el canvas: no hay nada que graficar");

// ---------------------------------------------------------------------------
// IVA. La regla contable: se le cobra al cliente y se le gira al Estado.
//   - lo que el cliente DEBE lo incluye (se lo facturaste),
//   - lo que el taller GANA no lo incluye (nunca fue suyo).
// Antes el saldo se calculaba sin IVA mientras la factura cobraba con IVA:
// pagar la factura completa dejaba el pedido en saldo NEGATIVO y la app
// anunciaba un "saldo a favor del cliente" que era exactamente el IVA.
// ---------------------------------------------------------------------------
const pedIva = {
  id: "piva", numeroOp: "OP-IVA", cliente: "Con IVA", descripcion: "Uniformes", cantidad: "10",
  total: 1000000, costo: 600000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-08-29", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null,
  iva: { activo: true, porcentaje: 19 }
};
assert(calcMod.calcIvaPedido(pedIva) === 190000, "el IVA del 19% sobre un millón son $190.000");
assert(calcMod.calcTotalConIvaPedido(pedIva) === 1190000, "lo que se le factura al cliente es la base más el IVA");
assert(calcMod.calcSaldoPedido(pedIva) === 1190000, "y eso es lo que el cliente DEBE mientras no haya abonado nada");

const pedIvaPago = Object.assign({}, pedIva, { abono: 1190000 });
assert(calcMod.calcSaldoPedido(pedIvaPago) === 0, "pagar la factura completa deja el saldo en CERO, no en negativo");
assert(calcMod.calcIvaCobrado(pedIvaPago) === 190000, "y todo el IVA quedó cobrado");

const pedIvaMitad = Object.assign({}, pedIva, { abono: 595000 });
assert(calcMod.calcIvaCobrado(pedIvaMitad) === 95000, "si pagan la mitad de la factura, se cobró la mitad del IVA");
assert(calcMod.calcSaldoPedido(pedIvaMitad) === 595000, "y falta por cobrar la otra mitad");

// Sin IVA nada cambia: es exactamente el número de siempre.
const pedSinIva = Object.assign({}, pedIva, { iva: { activo: false, porcentaje: 19 }, abono: 400000 });
assert(calcMod.calcIvaPedido(pedSinIva) === 0 && calcMod.calcSaldoPedido(pedSinIva) === 600000,
  "un pedido sin IVA sigue dando total − abonado, igual que siempre");
const pedViejo = Object.assign({}, pedIva); delete pedViejo.iva; pedViejo.abono = 400000;
assert(calcMod.calcSaldoPedido(pedViejo) === 600000, "y un pedido viejo, guardado antes de que existiera el campo iva, tampoco cambia");

// El IVA NO es ganancia: la ganancia se sigue midiendo sobre la base.
state.pedidos = [Object.assign({}, pedIva, { abono: 1190000 })];
state.tx = [];
assert(calcMod.calcIvaCobradoTotal() === 190000, "la app sabe cuánta plata de la caja es IVA que hay que girar");
const lineasIva = calcMod.calcTotalesLineasPedido(state.pedidos[0].lineas);
assert(lineasIva.precioTotal === 0, "las líneas del pedido siguen midiéndose sin IVA (acá no hay líneas, pero la fórmula no lo suma)");

// Y se ve en pantalla: el desglose y el aviso de que esa plata tiene dueño.
state.tab = "pedidos";
state.pedidosVista = "historial";
state.pedidoPanelAbierto = { piva: true };
render();
const textoIva = document.body.textContent;
assert(textoIva.includes("IVA 19%"), "el panel desglosa el IVA en vez de esconderlo dentro del total");
assert(textoIva.includes("Total a cobrar"), "y muestra el total que de verdad se le factura al cliente");
assert(textoIva.includes("es IVA — no es plata del taller"), "avisa que parte de lo cobrado le pertenece al Estado");

state.tab = "resumen";
render();
assert(document.body.textContent.includes("IVA cobrado"), "el Resumen avisa cuánta plata de la caja es IVA");
state.pedidos = [];
render();
assert(!document.body.textContent.includes("IVA cobrado"), "y si no se factura IVA, esa tarjeta no aparece: no estorba a quien no lo usa");

// ---------------------------------------------------------------------------
// "Ganancia" (Resumen, tarjeta "Ingresos y gastos"): rechazada la primera
// implementación (KPI "Ganancia disponible" + dona "De qué es la caja") —
// el usuario la quería distinta: sumar lo marcado como "servicio" (corte,
// confección — trabajo del taller mismo, nunca pagado de verdad) en tiles
// chicos y discretos, y que "Ganancia" sea "Balance" menos eso. Con sus
// palabras: "la ganancia es lo que queda cuando del dinero de la caja se le
// resta lo de los servicios". Ver calcServiciosPorCategoriaRango.
// ---------------------------------------------------------------------------
const txPreviosGan = state.tx, cotizacionesPreviasGan = state.cotizaciones;
const hoyGan = hoyStr();
state.tx = [{ id: "tx-gan-ingreso", tipo: "ingreso", monto: 1000000, concepto: "Venta con corte propio", fecha: hoyGan, contraparte: "" }];
state.cotizaciones = [{
  id: "cot-gan", cliente: "Cliente Ganancia", descripcion: "Camisetas", fecha: hoyGan, estado: "convertida", pedidoId: "",
  referencias: [{
    id: "r1", nombre: "Camiseta", origen: "taller", estado: "nuevo", estadosDef: null, cantidadPedida: 10, consumoAprox: 1, precioVenta: 100000,
    insumos: [{ id: "i1", nombre: "Corte", unidad: "servicio", tipo: "por_prenda", costo: 20000, cantidad: 1 }], detalle: []
  }],
  costosGlobales: [], serviciosCobrados: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "gan1",
  compras: [{ clave: "corte|servicio|por_prenda", estado: "servicio", cantidadReal: "", costoReal: "" }]
}];
const serviciosGan = calcMod.calcServiciosPorCategoriaRango(hoyGan, hoyGan);
assert(serviciosGan.length === 1 && serviciosGan[0].nombre.toLowerCase() === "corte" && serviciosGan[0].monto > 0, "calcServiciosPorCategoriaRango agrupa por nombre y usa el costo ESTIMADO (nadie escribió un costoReal todavía)");
assert(!calcMod.calcServiciosPorCategoriaRango("2000-01-01", "2000-01-01").length, "y fuera del rango de la cotización, no cuenta nada");
state.tab = "resumen";
render();
const textoResumenGan = document.body.textContent;
assert(textoResumenGan.includes("Ganancia"), "la tarjeta de Ingresos y gastos ahora incluye una cifra de Ganancia junto a Entró/Salió/Balance");
assert(textoResumenGan.includes("Corte"), "y debajo, un tile propio (con menos protagonismo que los KPI) por cada categoría de servicio restada");
assert(!!document.querySelector(".kpis-mini") && !!document.querySelector(".kpi-mini"), "usando el componente de tiles chicos, no la dona rechazada");
assert(!document.querySelector("#chart-composicion-caja"), "la dona \"De qué es la caja actual\" no existe más — se descartó por completo, no se dejó a medias");
// Sin ningún servicio en el periodo, SU fila de tiles ni aparece — ver
// renderServiciosMini. El tile de "Colchón" (ver renderColchon) es
// distinto a propósito: siempre se muestra, aunque esté en $0, porque es
// una herramienta que se gestiona a mano, no un desglose de qué hubo en
// el periodo — por eso ya no se puede afirmar que TODO ".kpis-mini"
// desaparece, solo el tile de "Corte".
state.cotizaciones = [];
render();
assert(!document.body.textContent.includes("Corte"), "sin servicios en el periodo, su tile no se dibuja (nada que desglosar)");
assert(!!document.querySelector('[data-action="abrir-historial-servicio"][data-nombre="Colchón"]'), "...pero el tile de \"Colchón\" sigue ahí (es una reserva que se gestiona a mano, no un desglose del periodo)");
state.tx = txPreviosGan; state.cotizaciones = cotizacionesPreviasGan;
render();

// ---------------------------------------------------------------------------
// Auditoría financiera 2026-09-20: 3 hallazgos más en la fórmula de
// "Ganancia" — el mismo patrón de "falta restar una categoría más" que ya
// se había repetido antes (servicios → abonos pendientes → Colchón). Cada
// escenario reemplaza TODO el estado relevante (pedidos/cotizaciones/tx)
// por uno mínimo y controlado, para que el número de Ganancia leído del
// DOM sea 100% predecible sin depender de ningún otro fixture del archivo.
// ---------------------------------------------------------------------------
function leerCifraGrafica(label) {
  var celdas = Array.prototype.slice.call(document.querySelectorAll(".grafica-cifra"));
  var celda = celdas.filter(function (c) { return c.querySelector(".grafica-cifra-label").textContent === label; })[0];
  return celda ? celda.querySelector(".amount").textContent : null;
}
const { fmt: fmtGananciaTest } = await import("../js/core/utils.js");
const estadoPrevioGananciaTest = { pedidos: state.pedidos, cotizaciones: state.cotizaciones, tx: state.tx, config: Object.assign({}, state.config) };
const hoyGananciaTest = hoyStr();

// --- 13) El IVA cobrado nunca se restaba de "Ganancia" ---
state.pedidos = [{
  id: "ped-gan-iva-test", numeroOp: "OP-GAN-IVA", cliente: "Cliente Ganancia IVA", descripcion: "Prueba",
  cantidad: "1", total: 1000000, costo: 400000, abono: 1190000, estado: "nuevo", estadosDef: null,
  fechaCreacion: hoyGananciaTest, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [{ id: "ab-gan-iva", monto: 1190000, fecha: hoyGananciaTest, metodoPago: "efectivo", comprobanteUrl: "" }],
  lineas: [], stockConsumido: [], vendedor: null, iva: { activo: true, porcentaje: 19 }
}];
state.cotizaciones = [];
state.tx = [{ id: "tx-gan-iva", tipo: "ingreso", concepto: "Pago factura con IVA", monto: 1190000, contraparte: "Cliente Ganancia IVA", fecha: hoyGananciaTest, pedidoId: "ped-gan-iva-test", origenAbonoId: "ab-gan-iva" }];
state.config.colchonMovimientos = [];
state.tab = "resumen"; render();
assert(calcMod.calcIvaCobradoTotal() === 190000, "sanity: este pedido tiene $190.000 de IVA ya cobrado (19% de $1.000.000, pagado completo)");
assert(leerCifraGrafica("Ganancia") === fmtGananciaTest(1000000), "Ganancia ya resta el IVA cobrado: $1.190.000 de caja − $190.000 de IVA = $1.000.000 (antes mostraba $1.190.000, como si el IVA fuera utilidad)");

// --- 14) Un pedido con servicio pendiente Y abono sin terminar de pagar
// restaba la misma plata dos veces ---
const cotGanDobleId = "cot-gan-doble-test";
const cotGanDoble = {
  id: cotGanDobleId, clienteId: "", cliente: "Cliente Doble", descripcion: "Prueba doble conteo", fecha: hoyGananciaTest,
  estado: "convertida", pedidoId: "ped-gan-doble-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cgdt1",
  referencias: [{
    id: "r-cgdt1", nombre: "Camiseta", imagenUrl: "", consumoAprox: 1, cantidadPedida: 5, precioVenta: 200000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [{ id: "i-cgdt1", nombre: "Confección Doble", unidad: "servicio", costo: 40000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }],
    detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
};
const claveConfeccionDoble = calcListaComprasServ(cotGanDoble).filter(function (l) { return l.nombre === "Confección Doble"; })[0].clave;
cotGanDoble.compras = [{ clave: claveConfeccionDoble, estado: "servicio", costoReal: 200000 }];
state.pedidos = [{
  id: "ped-gan-doble-test", numeroOp: "OP-GAN-DOBLE", cliente: "Cliente Doble", descripcion: "Prueba",
  cantidad: "5", total: 1000000, costo: 400000, abono: 500000, estado: "nuevo", estadosDef: null,
  fechaCreacion: hoyGananciaTest, fechaEntrega: "", tipoCliente: "propio", cotizacionId: cotGanDobleId,
  abonos: [{ id: "ab-gan-doble", monto: 500000, fecha: hoyGananciaTest, metodoPago: "efectivo", comprobanteUrl: "" }],
  lineas: [], stockConsumido: [], vendedor: null, iva: { activo: false, porcentaje: 19 }
}];
state.cotizaciones = [cotGanDoble];
state.tx = [{ id: "tx-gan-doble", tipo: "ingreso", concepto: "Abono con servicio pendiente", monto: 500000, contraparte: "Cliente Doble", fecha: hoyGananciaTest, pedidoId: "ped-gan-doble-test", origenAbonoId: "ab-gan-doble" }];
render();
assert(leerCifraGrafica("Ganancia") === fmtGananciaTest(0), "un pedido con servicio Y abono pendiente a la vez ya NO resta la misma plata dos veces: Ganancia queda en $0 (500.000 de balance − 500.000 de abono pendiente, el servicio no se resta aparte porque ya está incluido en ese abono) — antes daba −$200.000, una \"pérdida\" ficticia");

// --- 15) El excedente de un sobrepago no se restaba de "Ganancia" ---
state.pedidos = [{
  id: "ped-gan-sobrepago-test", numeroOp: "OP-GAN-SOBRE", cliente: "Cliente Sobrepago", descripcion: "Prueba sobrepago",
  cantidad: "1", total: 500000, costo: 200000, abono: 600000, estado: "nuevo", estadosDef: null,
  fechaCreacion: hoyGananciaTest, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [{ id: "ab-gan-sobre", monto: 600000, fecha: hoyGananciaTest, metodoPago: "efectivo", comprobanteUrl: "" }],
  lineas: [], stockConsumido: [], vendedor: null, iva: { activo: false, porcentaje: 19 }
}];
state.cotizaciones = [];
state.tx = [{ id: "tx-gan-sobre", tipo: "ingreso", concepto: "Abono de más", monto: 600000, contraparte: "Cliente Sobrepago", fecha: hoyGananciaTest, pedidoId: "ped-gan-sobrepago-test", origenAbonoId: "ab-gan-sobre" }];
render();
assert(calcMod.calcSaldosAFavorClientes() === 100000, "sanity: este pedido dejó $100.000 de saldo a favor del cliente (abonó 600.000 sobre un pedido de 500.000)");
assert(leerCifraGrafica("Ganancia") === fmtGananciaTest(500000), "Ganancia ya resta el excedente del sobrepago: $600.000 de caja − $100.000 que hay que devolver = $500.000 (antes mostraba $600.000, contando esa plata como utilidad Y como deuda con el cliente al mismo tiempo)");

state.pedidos = estadoPrevioGananciaTest.pedidos; state.cotizaciones = estadoPrevioGananciaTest.cotizaciones; state.tx = estadoPrevioGananciaTest.tx; state.config = estadoPrevioGananciaTest.config;
render();

// ---------------------------------------------------------------------------
// "Colchón" (2026-09): reserva para cubrir el hueco cuando un cliente abona
// más de lo que en realidad es margen — el usuario lo pidió con "mismo
// funcionamiento que los otros servicios, se puede rellenar o gastar". A
// diferencia de Confección/Corte (cuya entrada nace sola de una cotización),
// Colchón se rellena a mano de DOS formas confirmadas por el usuario:
// apartando plata que ya estaba en caja (sin tx nuevo) o con un aporte
// nuevo de su bolsillo (sí genera un ingreso real en Finanzas). "Gastar"
// reutiliza el mecanismo YA probado arriba (asignar a servicio en un
// gasto/nómina) sin ningún cambio — por diseño.
// ---------------------------------------------------------------------------
const txAntesColchon = state.tx.length;
state.tab = "resumen";
render();
click('[data-action="abrir-rellenar-colchon"]');
assert(!!document.querySelector('[data-action-change="set-colchon-campo"][data-campo="monto"]'), "\"+ Rellenar\" abre el formulario del Colchón");
setChange('[data-action-change="set-colchon-campo"][data-campo="monto"]', "100000");
click('[data-action="guardar-relleno-colchon"]');
assert(state.config.colchonMovimientos.length === 1, "guarda el primer relleno");
const rellenoSepararId = state.config.colchonMovimientos[0].id;
assert(state.config.colchonMovimientos[0].origen === "separar" && !state.config.colchonMovimientos[0].txId, "por defecto es \"separar\": no genera ningún movimiento en Finanzas");
assert(state.tx.length === txAntesColchon, "...confirmado: el conteo de movimientos de Finanzas no cambió");
assert(calcServDisp().filter(function (s) { return s.nombre === "Colchón"; })[0].disponible === 100000, "\"Colchón\" ya tiene 100.000 disponibles, sin ningún tx nuevo");
assert(document.body.textContent.includes("$100.000") , "el tile de Colchón en pantalla ya refleja el nuevo disponible");

// --- Rellenar con "aporte" (plata nueva de bolsillo): SÍ genera un ingreso real ---
click('[data-action="abrir-rellenar-colchon"]');
setChange('[data-action-change="set-colchon-campo"][data-campo="monto"]', "50000");
setChange('[data-action-change="set-colchon-campo"][data-campo="origen"]', "aporte");
setChange('[data-action-change="set-colchon-campo"][data-campo="nota"]', "Prueba aporte");
click('[data-action="guardar-relleno-colchon"]');
assert(state.config.colchonMovimientos.length === 2, "guarda el segundo relleno");
const rellenoAporte = state.config.colchonMovimientos[1];
assert(rellenoAporte.origen === "aporte" && !!rellenoAporte.txId, "este sí quedó marcado \"aporte\", con su propio tx vinculado");
assert(state.tx.length === txAntesColchon + 1, "...y ahora SÍ hay un movimiento nuevo en Finanzas");
const txAporte = state.tx.filter(function (t) { return t.id === rellenoAporte.txId; })[0];
assert(!!txAporte && txAporte.tipo === "ingreso" && txAporte.monto === 50000, "el tx del aporte es un ingreso real por el monto exacto");
assert(txAporte.concepto.indexOf("Aporte a Colchón") !== -1 && txAporte.concepto.indexOf("Prueba aporte") !== -1, "...con la nota incluida en el concepto");
assert(txAporte.origenColchonId === rellenoAporte.id, "...y queda marcado con origenColchonId (protegido contra borrado suelto, ver MARCAS_ORIGEN_SISTEMA)");
assert(calcServDisp().filter(function (s) { return s.nombre === "Colchón"; })[0].disponible === 150000, "\"Colchón\" acumula los dos rellenos: 150.000 disponibles");

// --- Historial: entradas manuales muestran su concepto propio y un botón "quitar" ---
click('[data-action="abrir-historial-servicio"][data-nombre="Colchón"]');
var textoHistorialColchon = document.body.textContent;
assert(textoHistorialColchon.indexOf("Apartado de caja") !== -1, "el relleno \"separar\" aparece en el historial con su concepto propio");
assert(textoHistorialColchon.indexOf("Aporte — Prueba aporte") !== -1, "...y el de \"aporte\", con la nota en el concepto");
assert(!!document.querySelector('[data-action="quitar-relleno-colchon"][data-id="' + rellenoSepararId + '"]'), "cada relleno manual trae su botón para quitarlo");
click('[data-action="cerrar-historial-servicio"]');

// --- Quitar un relleno: se puede, mientras no deje el Colchón en negativo ---
click('[data-action="abrir-historial-servicio"][data-nombre="Colchón"]');
click('[data-action="quitar-relleno-colchon"][data-id="' + rellenoSepararId + '"]');
assert(state.config.colchonMovimientos.length === 1 && state.config.colchonMovimientos[0].id === rellenoAporte.id, "quitar el relleno \"separar\" lo saca de la lista (no tenía tx que borrar)");
assert(calcServDisp().filter(function (s) { return s.nombre === "Colchón"; })[0].disponible === 50000, "\"Colchón\" vuelve a 50.000 (solo queda el aporte)");

// --- Gastar del Colchón: mismo mecanismo YA probado con \"Confección\" arriba, sin ningún cambio ---
state.tab = "finanzas";
render();
click('[data-action="finanzas-vista"][data-val="nuevo"]');
click('[data-action="set-tx-tipo"][data-val="gasto"]');
setInput('[data-form="tx"][data-field="concepto"]', "Insumo cubierto con el Colchón");
setInput('[data-form="tx"][data-field="monto"]', "40000");
click('[data-action="agregar-fila-servicio"][data-form-destino="formTx"]');
setChange('select[data-action-change="set-fila-servicio-nombre"][data-form-destino="formTx"][data-idx="0"]', "Colchón");
setChange('input[data-action-change="set-fila-servicio-monto"][data-form-destino="formTx"][data-idx="0"]', "40000");
click('[data-action="add-tx"]');
const gastoColchonId = state.tx[0].id;
assert(calcServDisp().filter(function (s) { return s.nombre === "Colchón"; })[0].disponible === 10000, "gastar del Colchón funciona exactamente igual que con cualquier otro servicio: 50.000 − 40.000 = 10.000 disponibles");

// --- Ahora sí, quitar el aporte (50.000) dejaría el Colchón en -40.000: se bloquea ---
state.tab = "resumen";
render();
click('[data-action="abrir-historial-servicio"][data-nombre="Colchón"]');
var alertaColchonOriginal = global.alert;
var alertaColchonBloqueo = "";
global.window.alert = global.alert = function (msg) { alertaColchonBloqueo = msg; };
click('[data-action="quitar-relleno-colchon"][data-id="' + rellenoAporte.id + '"]');
assert(alertaColchonBloqueo.indexOf("No se puede quitar") !== -1, "quitar un relleno que ya se gastó (en parte) se bloquea con un aviso, no lo deja descuadrado");
assert(state.config.colchonMovimientos.length === 1, "...y de verdad no lo quita: sigue en la lista");
assert(state.tx.some(function (t) { return t.id === rellenoAporte.txId; }), "...ni borra su tx en Finanzas");
global.window.alert = global.alert = alertaColchonOriginal;
click('[data-action="cerrar-historial-servicio"]');

// --- limpieza: fuera del alcance de este bloque, no debe arrastrarse a las siguientes pruebas ---
state.config.colchonMovimientos = [];
state.tx = state.tx.filter(function (t) { return t.id !== rellenoAporte.txId && t.id !== gastoColchonId; });
state.formTx = { tipo: "gasto", concepto: "", monto: "", contraparte: "", fecha: hoyStr(), pedidoId: "", cotizacionId: "", esInsumo: false, insumoNombre: "", proveedorId: "", cantidad: "", unidad: "", servicios: [] };

// ---------------------------------------------------------------------------
// "Ganancia" también debe excluir el abonado de pedidos SIN terminar de
// pagar — reporte real del usuario: "acabo de recibir un abono pero la app
// lo detectó como ganancia... no es ganancia, de ahí tengo que empezar a
// comprar los insumos". Mismo criterio que los servicios de arriba: se
// resta de Balance hasta que el pedido quede pagado por completo. Ver
// calcAbonosPendientesPorPedido.
// ---------------------------------------------------------------------------
const txPreviosAbo = state.tx, pedidosPreviosAbo = state.pedidos, cotizacionesPreviasAbo = state.cotizaciones;
const hoyAbo = hoyStr();
state.tx = [
  { id: "tx-abo-1", tipo: "ingreso", monto: 300000, concepto: "Abono pedido sin terminar", fecha: hoyAbo, contraparte: "" },
  { id: "tx-abo-2", tipo: "ingreso", monto: 500000, concepto: "Abono pedido ya pagado", fecha: hoyAbo, contraparte: "" }
];
state.pedidos = [
  { id: "ped-abo-pend", numeroOp: "OP-ABO-1", cliente: "Cliente Sin Terminar", descripcion: "Camisetas", cantidad: "5",
    total: 1000000, costo: 400000, abono: 300000, estado: "corte", estadosDef: null,
    fechaCreacion: hoyAbo, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
    abonos: [{ id: "ab-1", monto: 300000, fecha: hoyAbo, metodoPago: "Transferencia" }], lineas: [], stockConsumido: [], vendedor: null },
  { id: "ped-abo-pagado", numeroOp: "OP-ABO-2", cliente: "Cliente Ya Pagó", descripcion: "Buzos", cantidad: "3",
    total: 500000, costo: 200000, abono: 500000, estado: "entregado", estadosDef: null,
    fechaCreacion: hoyAbo, fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
    abonos: [{ id: "ab-2", monto: 500000, fecha: hoyAbo, metodoPago: "Efectivo" }], lineas: [], stockConsumido: [], vendedor: null }
];
state.cotizaciones = [];

const abonosPend = calcMod.calcAbonosPendientesPorPedido(hoyAbo, hoyAbo);
assert(abonosPend.length === 1 && abonosPend[0].nombre === "Cliente Sin Terminar" && abonosPend[0].monto === 300000, "calcAbonosPendientesPorPedido solo cuenta el abono del pedido con saldo pendiente, no el del que ya pagó completo");

state.tab = "resumen";
render();
const textoResumenAbo = document.body.textContent;
assert(textoResumenAbo.includes("Cliente Sin Terminar"), "el Resumen muestra un tile por el pedido sin terminar de pagar");
assert(!textoResumenAbo.includes("Cliente Ya Pagó"), "...pero no por el que ya se pagó por completo: ese abono ya es ganancia real");
const botonAbonoPend = [...document.querySelectorAll(".kpi-mini")].find(function (b) { return b.textContent.includes("Cliente Sin Terminar"); });
assert(!!botonAbonoPend && botonAbonoPend.getAttribute("data-action") === "kpi-nav" && botonAbonoPend.getAttribute("data-filtro-saldo") === "1", "el tile navega a Pedidos filtrado por saldo, igual que el KPI \"Por cobrar\"");

// Un pedido CANCELADO no resta de Ganancia aunque tenga saldo sin cubrir:
// esa venta no se va a completar, no tiene sentido reservarle plata.
state.pedidos[0].cancelado = true;
assert(!calcMod.calcAbonosPendientesPorPedido(hoyAbo, hoyAbo).length, "un pedido cancelado no cuenta en calcAbonosPendientesPorPedido");
state.pedidos[0].cancelado = false;

// Un reembolso dentro de los abonos no se suma como plata pendiente: ya
// salió de caja por su cuenta y ya bajó calcAbonadoDeLista/p.abono — sumarlo
// también acá lo contaría dos veces.
state.pedidos[0].abonos.push({ id: "reemb-1", monto: 50000, fecha: hoyAbo, tipo: "reembolso", motivo: "Prueba" });
assert(calcMod.calcAbonosPendientesPorPedido(hoyAbo, hoyAbo)[0].monto === 300000, "un reembolso en la lista de abonos no se suma al monto pendiente");

// Fuera del rango de fechas, no cuenta — mismo criterio que los servicios.
assert(!calcMod.calcAbonosPendientesPorPedido("2000-01-01", "2000-01-01").length, "y fuera del rango del abono, calcAbonosPendientesPorPedido no cuenta nada");

state.tx = txPreviosAbo; state.pedidos = pedidosPreviosAbo; state.cotizaciones = cotizacionesPreviasAbo;
render();

// ---------------------------------------------------------------------------
// Ajustes de feedback (Insumos + estados de producción).
// ---------------------------------------------------------------------------

// Unidad "conocida": el datalist compartido no es una lista fija — aprende
// de lo que se escribe en cualquier campo de unidad de la app. El usuario
// pidió explícitamente que NO aparezca ninguna sugerencia "de base": si
// nunca se escribió "UND" en ningún campo, "UND" no debe salir en el panel,
// así sea una unidad común — nada inventado, solo lo que él mismo ya usó.
// unidadesConocidas() recorre 4 áreas (catalogoInsumos, productos,
// plantillasPrendas, cotizaciones) — se limpian las 4 para que la prueba sea
// de verdad aislada: si no, un "UND" que quedó de un insumo creado 800 líneas
// atrás en este mismo archivo lo haría aparecer por una razón real, no por el
// bug que se está probando.
const productosPrevios = state.productos, plantillasPreviase = state.plantillasPrendas, cotizacionesPreviasUnidad = state.cotizaciones;
state.catalogoInsumos = [{ id: "iu1", nombre: "Cinta rara", unidad: "rollo-40m", costo: 1000, tipo: "por_prenda", categoriaId: "", proveedorId: "" }];
state.productos = []; state.plantillasPrendas = []; state.cotizaciones = [];
assert(calcMod.unidadesConocidas().includes("rollo-40m"), "una unidad escrita en cualquier insumo queda disponible como sugerencia para los demás campos");
assert(!calcMod.unidadesConocidas().includes("UND"), "y ninguna unidad que nunca se haya escrito aparece — ni siquiera una \"común\" como UND");
state.productos = productosPrevios; state.plantillasPrendas = plantillasPreviase; state.cotizaciones = cotizacionesPreviasUnidad;

// "+" por categoría en Insumos: agrega YA CLASIFICADO en esa sección, sin
// tener que elegirle la categoría después ni saltar de filtro para verlo.
state.catalogoCategorias = [{ id: "ci1", nombre: "Telas" }, { id: "ci2", nombre: "Hilos" }];
state.catalogoInsumos = [
  { id: "i1", nombre: "Tela A", unidad: "MT", costo: 1000, tipo: "tela", categoriaId: "ci1", proveedorId: "" },
  { id: "i2", nombre: "Hilo A", unidad: "UND", costo: 500, tipo: "por_prenda", categoriaId: "ci2", proveedorId: "" }
];
state.filtroCatalogoCategoria = "todos";
state.buscarCatalogo = "";
state.tab = "catalogo";
render();
const botonGrupoHilos = document.querySelector('.cat-grupo-add[data-categoria="ci2"]');
assert(!!botonGrupoHilos, "cada grupo de categoría tiene su propio botón + (ver renderGrupos en catalogo.js)");
click('.cat-grupo-add[data-categoria="ci2"]');
const insumoNuevoDeGrupo = state.catalogoInsumos[state.catalogoInsumos.length - 1];
assert(insumoNuevoDeGrupo.categoriaId === "ci2", "el insumo nace clasificado en la categoría de SU botón, no en la del filtro activo");
assert(state.filtroCatalogoCategoria === "todos", "y la vista NO salta a otro filtro para mostrarlo: ya es visible donde se está");

// El aviso de "insumo cambió en el catálogo" — la pieza más delicada: no
// puede aparecer donde no corresponde, tiene que desaparecer al actualizar, y
// "mantener" tiene que dejar de insistir con ESE mismo valor sin taparle la
// puerta a un cambio futuro.
state.catalogoInsumos = [{ id: "cat-1", nombre: "Tela premium", unidad: "MT", costo: 15000, tipo: "tela", categoriaId: "", proveedorId: "" }];
state.cotizaciones = [{
  id: "cot-cambio", cliente: "Cliente", descripcion: "d", fecha: "2026-08-29", estado: "borrador",
  pedidoId: "", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "C1",
  costosGlobales: [], serviciosCobrados: [],
  referencias: [{
    id: "ref-cambio", nombre: "Camisa", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 40000,
    origen: "taller", costoCompra: 0, proveedorId: "", detalle: [],
    // Recién copiado del catálogo: el mismo costo que tiene ahí (15.000).
    insumos: [{ id: "ins-cambio", nombre: "Tela premium", unidad: "MT", costo: 15000, tipo: "tela", cantidad: 1, proveedorId: "", origenCatalogoId: "cat-1" }]
  }]
}];
state.tab = "cotizaciones";
state.cotizacionesVista = "nueva";
state.cotizacionEditando = "cot-cambio";
render();
assert(!document.querySelector(".ins-aviso-cambio"), "recién copiado, el insumo todavía coincide con el catálogo: no hay nada que avisar");

// El catálogo sube de precio DESPUÉS de haberlo copiado a la cotización — el
// caso real que describió el usuario.
state.catalogoInsumos[0].costo = 20000;
render();
assert(!!document.querySelector(".ins-row.cambio-catalogo"), "ahora sí: la fila se marca porque el catálogo cambió después de copiarla");
assert(document.querySelector(".ins-aviso-cambio-msg").textContent.includes("15.000") && document.querySelector(".ins-aviso-cambio-msg").textContent.includes("20.000"), "el aviso dice los dos números: el que quedó guardado y el vigente");
assert(state.cotizaciones[0].referencias[0].insumos[0].costo === 15000, "y mientras tanto la cotización sigue funcionando con SU número: nada se actualiza solo");

// "Mantener": decisión consciente de seguir con el valor viejo.
click('[data-action="descartar-aviso-insumo-cambio"][data-ins="ins-cambio"]');
assert(!document.querySelector(".ins-aviso-cambio"), "tras 'Mantener', el aviso se apaga para ESTE cambio puntual");
assert(state.cotizaciones[0].referencias[0].insumos[0].costo === 15000, "sin tocar el costo: seguir viendo $15.000 fue la decisión");
state.catalogoInsumos[0].costo = 22000;
render();
assert(!!document.querySelector(".ins-aviso-cambio"), "pero si el catálogo cambia OTRA VEZ después, vuelve a avisar — 'mantener' no calla el aviso para siempre");

// "Actualizar": trae el número vigente y limpia cualquier 'mantener' previo.
click('[data-action="actualizar-insumo-catalogo"][data-ins="ins-cambio"]');
assert(state.cotizaciones[0].referencias[0].insumos[0].costo === 22000, "'Actualizar' copia el costo vigente del catálogo a la cotización");
assert(!state.cotizaciones[0].referencias[0].insumos[0].avisoInsumoDescartado, "y limpia el 'mantener' anterior, para no arrastrar una decisión que ya no aplica");
render();
assert(!document.querySelector(".ins-aviso-cambio"), "ya actualizado, el aviso desaparece");

// Un insumo escrito a mano en la cotización (no viene del catálogo) nunca
// avisa: no hay con qué compararlo.
click('[data-action="add-insumo-personalizado"][data-cot="cot-cambio"][data-ref="ref-cambio"]');
const insumoManual = state.cotizaciones[0].referencias[0].insumos.find(i => i.id !== "ins-cambio");
assert(!insumoManual.origenCatalogoId, "un insumo agregado a mano no queda vinculado a ningún insumo del catálogo");
assert(calcMod.insumoCambioDeCatalogo(insumoManual) === null, "y por lo tanto nunca dispara el aviso de cambio");

// Estados de producción: la barra vieja con todas las etapas visibles no
// vuelve a aparecer, ni sola ni mezclada con la fila compacta.
state.pedidos = [{ id: "prod-1", numeroOp: "OP-1", cliente: "C", descripcion: "d", cantidad: "1", total: 1, costo: 0,
  abono: 0, estado: "confeccion", estadosDef: null, fechaCreacion: "2026-08-29", fechaEntrega: "",
  tipoCliente: "propio", cotizacionId: "", abonos: [], lineas: [], stockConsumido: [], vendedor: null }];
state.tab = "pedidos";
state.pedidosVista = "historial";
render();
assert(!document.querySelector(".tape-labels"), "un pedido rápido ya no dibuja la barra vieja de etapas");
assert(document.querySelectorAll(".pedido-ref-progreso").length === 1, "solo la fila compacta de siempre, la misma que usa un pedido desde cotización");

// ---------------------------------------------------------------------------
// Segunda ronda de ajustes: botón de agregar insumo abajo, y el pedido rápido
// puede marcarse "sin flujo de producción".
// ---------------------------------------------------------------------------

// No hay un botón general de "agregar" aparte: el "+" vive DENTRO de cada
// sección, al final de su tabla — nunca uno grande y genérico en la cabecera.
state.catalogoCategorias = [];
state.catalogoInsumos = [
  { id: "za1", nombre: "Zíper", unidad: "UND", costo: 100, tipo: "por_prenda", categoriaId: "", proveedorId: "" },
  { id: "aa1", nombre: "Algodón", unidad: "MT", costo: 100, tipo: "tela", categoriaId: "", proveedorId: "" }
];
state.ordenCatalogo = "abc";
state.filtroCatalogoCategoria = "todos";
state.buscarCatalogo = "";
state.tab = "catalogo";
render();
assert(!document.querySelector(".cat-head [data-action=\"add-cat-item\"]"), "no hay ningún botón de agregar en la cabecera");
const botonMini = document.querySelector(".cat-grupo .cat-agregar-mini [data-action=\"add-cat-item\"]");
assert(!!botonMini, "el botón de agregar vive DENTRO de la sección, al final de su tabla");
assert(botonMini.closest(".cat-grupo").querySelector(".ins-table, .tx-row") !== null, "y no antes de la tabla, sino después de ella");
click(".cat-grupo .cat-agregar-mini [data-action=\"add-cat-item\"]");
const nombresOrdenados = state.catalogoInsumos.map(i => i.id);
assert(nombresOrdenados[nombresOrdenados.length - 1] !== nombresOrdenados[0], "sanity: hay más de un insumo");
const filasTrasAgregar = [...document.querySelectorAll(".insumo-nombre")].map(i => i.id);
assert(filasTrasAgregar[filasTrasAgregar.length - 1].includes(state.catalogoInsumos[state.catalogoInsumos.length - 1].id), "bajo A–Z, un insumo sin nombre todavía se dibuja AL FINAL — cerca del botón que se acaba de pulsar, no al principio");

// "Opciones avanzadas" (tipo de pedido, flujo, origen): el usuario corrigió
// que esto SOLO debía recogerse cuando el formulario viene de "Duplicar
// pedido" — el formulario NORMAL de "+ Nuevo pedido rápido" no cambia de
// forma (sigue mostrando estos tres campos inline, como siempre).
state.tab = "pedidos";
state.pedidosVista = "nueva";
state.pedidoFormDuplicado = false;
state.pedidoOpcionesAvanzadasAbierto = false;
state.formPedido = { clienteId: "", cliente: "", tipoCliente: "propio", abono: "", fechaEntrega: "",
  vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "", conFlujoProduccion: true,
  esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "", lineas: [] };
render();
assert(!!document.querySelector('[data-action-change="toggle-pedido-flujo"]'), "el formulario NORMAL de pedido rápido muestra la casilla de flujo inline, sin ningún colapsable");
assert(!!document.querySelector('[data-form="pedido"][data-field="tipoCliente"]'), "...y el selector de Origen también, igual que siempre");
assert(!document.querySelector('[data-action="toggle-pedido-opciones-avanzadas"]'), "...no existe ningún botón de 'Opciones avanzadas' en el formulario normal");

// Con un formulario que SÍ viene de "Duplicar pedido" (pedidoFormDuplicado),
// esos mismos tres campos se recogen detrás de "Opciones avanzadas" —
// colapsada salvo que ya traiga algo distinto del default (mismo criterio
// "con bulto" que ya usa Vendedor: si hay algo que de verdad hay que
// revisar, no queda escondido).
state.pedidoFormDuplicado = true;
state.pedidoOpcionesAvanzadasAbierto = false;
render();
assert(!document.querySelector('[data-action-change="toggle-pedido-flujo"]'), "en un formulario DUPLICADO, con todo en su valor por defecto, 'Opciones avanzadas' arranca colapsada");
assert(!document.querySelector('[data-form="pedido"][data-field="tipoCliente"]'), "...ni el selector de Origen se ve suelto");
assert(!!document.querySelector('[data-action="toggle-pedido-opciones-avanzadas"]'), "...pero sí el botón para abrirla");
click('[data-action="toggle-pedido-opciones-avanzadas"]');
assert(!!document.querySelector('[data-action-change="toggle-pedido-flujo"]'), "al abrirla, aparece la casilla de flujo");
state.pedidoOpcionesAvanzadasAbierto = false;
state.formPedido.tipoCliente = "tercero";
render();
assert(!!document.querySelector('[data-form="pedido"][data-field="tipoCliente"]'), "en un duplicado con Origen ya en 'tercero' (no el default), la sección se abre sola aunque nadie la haya tocado");
state.formPedido.tipoCliente = "propio";
state.pedidoFormDuplicado = false; // se restaura para no afectar las pruebas siguientes

// El toggle "pasa por producción" del formulario de pedido rápido (normal,
// no duplicado — inline, sin colapsable).
state.formPedido = { clienteId: "", cliente: "Cliente Sin Flujo", tipoCliente: "propio", abono: "", fechaEntrega: "",
  vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "", conFlujoProduccion: true,
  esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "", lineas: [] };
render();
assert(!!document.querySelector('[data-action-change="toggle-pedido-flujo"]'), "el formulario de pedido rápido ofrece elegir si lleva flujo de producción");
click('[data-action="add-pedido-linea-libre"]');
const lineaSinFlujoId = state.formPedido.lineas[0].id;
setLinea(lineaSinFlujoId, "productoNombre", "Arreglo");
setLinea(lineaSinFlujoId, "cantidad", "1");
setLinea(lineaSinFlujoId, "precioUnitario", "50000");
setLinea(lineaSinFlujoId, "costoUnitario", "10000");
// Se desmarca: este pedido no pasa por producción.
const checkFlujo = document.querySelector('[data-action-change="toggle-pedido-flujo"]');
checkFlujo.checked = false;
checkFlujo.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.formPedido.conFlujoProduccion === false, "desmarcar la casilla queda en el borrador del formulario");
click('[data-action="add-pedido"]');
const pedidoSinFlujo = state.pedidos.find(p => p.cliente === "Cliente Sin Flujo");
assert(!!pedidoSinFlujo, "el pedido se crea igual, con la casilla desmarcada");
assert(pedidoSinFlujo.sinFlujoProduccion === true, "queda marcado como sin flujo de producción");
assert(pedidoSinFlujo.estado === "entregado", "nace directo como terminado — no hay etapas que seguir");
assert(calcMod.pedidoTerminado(pedidoSinFlujo), "y por lo tanto cuenta como terminado, no como un pedido activo eterno");
state.pedidosVista = "historial";
state.pedidoPanelAbierto = {};
render();
const cardSinFlujo = document.querySelector('[data-pedido-id="' + pedidoSinFlujo.id + '"]');
assert(!cardSinFlujo.querySelector(".pedido-ref-progreso"), "su tarjeta NO muestra ningún widget de progreso");

// El caso contrario: casilla marcada (el valor por defecto) sigue creando un
// pedido con su flujo de producción normal, igual que siempre.
state.formPedido = { clienteId: "", cliente: "Cliente Con Flujo", tipoCliente: "propio", abono: "", fechaEntrega: "",
  vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "", conFlujoProduccion: true,
  esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "", lineas: [] };
state.pedidosVista = "nueva";
render();
click('[data-action="add-pedido-linea-libre"]');
const lineaConFlujoId = state.formPedido.lineas[0].id;
setLinea(lineaConFlujoId, "productoNombre", "Camisetas");
setLinea(lineaConFlujoId, "cantidad", "5");
setLinea(lineaConFlujoId, "precioUnitario", "20000");
setLinea(lineaConFlujoId, "costoUnitario", "8000");
click('[data-action="add-pedido"]');
const pedidoConFlujo = state.pedidos.find(p => p.cliente === "Cliente Con Flujo");
assert(pedidoConFlujo.sinFlujoProduccion === false, "con la casilla marcada, el pedido SÍ lleva flujo");
assert(pedidoConFlujo.estado === "nuevo", "y arranca en la primera etapa, como cualquier pedido rápido de siempre");
state.pedidosVista = "historial";
render();
const cardConFlujo = document.querySelector('[data-pedido-id="' + pedidoConFlujo.id + '"]');
assert(!!cardConFlujo.querySelector(".pedido-ref-progreso"), "y su tarjeta sí muestra el progreso, como antes de este cambio");

// La casilla no se ofrece en consignación: ya nace sin flujo por su cuenta.
state.formPedido.esConsignacion = true;
render();
assert(!document.querySelector('[data-action-change="toggle-pedido-flujo"]'), "en consignación la casilla no se muestra: ese tipo de pedido ya es 'sin flujo' de por sí");

// ---------------------------------------------------------------------------
// Modo sin conexión: instalar la app (PWA) + que siga funcionando y suba todo
// solo al volver la señal.
// ---------------------------------------------------------------------------

// El chip "Sin conexión" sigue a navigator.onLine, y los eventos
// online/offline lo actualizan SOLOS, sin que el usuario haga nada.
state.tab = "resumen";
render();
assert(!document.querySelector(".guardado-chip.offline"), "con conexión, el chip de conexión no aparece");
navigator.onLine = false;
window.dispatchEvent(new dom.window.Event("offline"));
assert(!!document.querySelector(".guardado-chip.offline"), "al perder la señal, el chip aparece SOLO — sin ninguna acción del usuario");
navigator.onLine = true;
window.dispatchEvent(new dom.window.Event("online"));
assert(!document.querySelector(".guardado-chip.offline"), "y desaparece solo al volver la señal");

// loadAll(): si la lectura de una clave falla, se usa la copia local (el
// "espejo" de core/guardado.js) en vez de dejar la pantalla con los datos de
// fábrica — que borraría de encima algo real que sí existe, solo por no
// poder alcanzarlo justo en este momento.
const constantsMod = await import("../js/core/constants.js");
window.localStorage.setItem("taller_espejo_v1:pedidos", JSON.stringify([
  { id: "espejo-1", numeroOp: "OP-ESPEJO", cliente: "Desde el espejo", descripcion: "d", cantidad: "1", total: 1, costo: 0, abono: 0, estado: "nuevo", abonos: [], lineas: [], stockConsumido: [] }
]));
const getOriginal = window.storage.get;
window.storage.get = async function (key, arg2) {
  if (key === constantsMod.KEYS.pedidos) throw new Error("Failed to fetch"); // simula sin conexión SOLO para esta clave
  return getOriginal(key, arg2);
};
state.pedidos = [{ id: "lo-que-habia-en-memoria", numeroOp: "OP-VIEJO" }]; // lo que loadAll() reemplazaría de haber podido leer
state.toast = null;
await loadAll();
assert(state.pedidos.length === 1 && state.pedidos[0].id === "espejo-1", "si la lectura de red de una clave falla, loadAll() usa la copia local de ESA clave en vez de vaciarla o dejarla como estaba");
assert(!!state.toast && state.toast.msg.indexOf("Sin conexión") !== -1, "y avisa con un toast discreto — no bloquea nada, solo informa");
window.storage.get = getOriginal; // se restaura: las pruebas de abajo (si las hay) no deben heredar esta falla simulada

// Las tablas "tx"/"clientes" (su propia pestaña, no el blob de "kv") tienen el
// MISMO fallback. En este entorno de prueba esa lectura YA falla de verdad
// (no hay credenciales reales de Google) en cada loadAll(), así que sirve
// para probar el camino real sin tener que simular nada más.
window.localStorage.setItem("taller_espejo_v1:tx", JSON.stringify([
  { id: "tx-espejo-1", tipo: "ingreso", concepto: "Desde el espejo", monto: 1000, fecha: "2026-08-30" }
]));
await loadAll();
assert(state.tx.some(t => t.id === "tx-espejo-1"), "la tabla de movimientos también cae a su copia local cuando su lectura falla");

// Si SOLO se pudo leer "kv" pero una clave puntual no tiene fila (la Sheet
// respondió bien, simplemente no hay nada guardado ahí — no es un fallo de
// red), no debe tratarse como si la lectura hubiera fallado: no debe
// resucitar una copia local vieja encima de lo que ya hay en memoria (antes
// este caso entraba por la misma rama del "else" que un fallo de red real).
// Nota: en este entorno de prueba tx/clientes SIEMPRE fallan de verdad (sin
// credenciales), así que huboFalloDeRed/el toast ya no sirven acá como señal
// aislada — se verifica directo sobre el dato, que si es más específico.
window.localStorage.setItem("taller_espejo_v1:catalogoPropuestas", JSON.stringify([{ id: "propuesta-vieja-y-obsoleta" }]));
const propuestaEnMemoria = [{ id: "en-memoria-actual" }];
state.catalogoPropuestas = propuestaEnMemoria;
window.storage.get = async function (key, arg2) {
  if (key === constantsMod.KEYS.catalogoPropuestas) return null; // fulfilled, sin fila — no es un error
  return getOriginal(key, arg2);
};
await loadAll();
assert(state.catalogoPropuestas === propuestaEnMemoria, "una clave sin fila en la Sheet (lectura OK, sin dato) no resucita una copia local vieja encima de lo que ya había en memoria");
window.storage.get = getOriginal;

// La migración de "detalle de tallas" (pedido → referencia de cotización) NO
// debe correr sobre pedidos/cotizaciones que cayeron al espejo local: esa
// copia puede ser más vieja que lo que YA está en la Sheet real desde otro
// dispositivo, y migrar + persistir escribiría ese dato viejo ENCIMA de lo
// real en cuanto vuelva la señal — justo lo que la red de seguridad de
// core/guardado.js existe para evitar.
window.localStorage.setItem("taller_espejo_v1:pedidos", JSON.stringify([
  { id: "ped-espejo-migra", numeroOp: "OP-M", cotizacionId: "cot-espejo-migra", detalle: ["S", "M"] }
]));
window.localStorage.setItem("taller_espejo_v1:cotizaciones", JSON.stringify([
  { id: "cot-espejo-migra", referencias: [{ id: "ref-1", detalle: [] }] }
]));
window.storage.get = async function (key, arg2) {
  if (key === constantsMod.KEYS.pedidos || key === constantsMod.KEYS.cotizaciones) throw new Error("Failed to fetch");
  return getOriginal(key, arg2);
};
const guardadoMod = await import("../js/core/guardado.js");
const pendientesAntes = guardadoMod.estadoGuardado().cantidad;
await loadAll();
const pedM = state.pedidos.find(p => p.id === "ped-espejo-migra");
const cotM = state.cotizaciones.find(c => c.id === "cot-espejo-migra");
assert(!!pedM.detalle, "si pedidos/cotizaciones vinieron del espejo (offline), la migración de tallas NO corre: el pedido conserva su 'detalle' propio");
assert(!cotM.referencias[0].detalle || !cotM.referencias[0].detalle.length, "y la cotización NO recibe el detalle migrado desde ese espejo, que podía estar desactualizado frente a la Sheet real");
assert(guardadoMod.estadoGuardado().cantidad === pendientesAntes, "y no se intenta persistir nada nuevo a la Sheet (la migración saltada no dispara ningún guardado)");
window.storage.get = getOriginal;

// Contraprueba: si pedidos/cotizaciones SÍ se pudieron leer de la red (no
// vinieron del espejo), la migración sigue funcionando exactamente igual que
// antes — el fix de arriba es específico a la copia local, no rompe el
// camino normal.
window.storage.get = async function (key, arg2) {
  if (key === constantsMod.KEYS.pedidos) return { value: JSON.stringify([{ id: "ped-red-migra", numeroOp: "OP-R", cotizacionId: "cot-red-migra", detalle: ["L", "XL"] }]) };
  if (key === constantsMod.KEYS.cotizaciones) return { value: JSON.stringify([{ id: "cot-red-migra", referencias: [{ id: "ref-1", detalle: [] }] }]) };
  return getOriginal(key, arg2);
};
await loadAll();
const pedR = state.pedidos.find(p => p.id === "ped-red-migra");
const cotR = state.cotizaciones.find(c => c.id === "cot-red-migra");
assert(!pedR.detalle, "si pedidos/cotizaciones SÍ se leyeron de la red, la migración de tallas sigue corriendo normal: se borra el detalle del pedido...");
assert(cotR.referencias[0].detalle && cotR.referencias[0].detalle.length === 2, "...y se traslada a la referencia de la cotización, como siempre");
window.storage.get = getOriginal;

// ---------------------------------------------------------------------------
// "Servicio" en Producción: corte/confección hechos en el taller se pagan vía
// nómina (no al instante), así que necesitan un tercer estado además de
// "comprado sí/no" — uno que cuente como costo real (para que la ganancia no
// se infle) pero que NO cree un movimiento en Finanzas (no hubo pago
// instantáneo que registrar). Controlado por una categoría de insumos
// marcada "de servicio", no por escribir "servicio" a mano en cada insumo.
// ---------------------------------------------------------------------------
loginComo("admin", "Admin de prueba", "admin@taller.test");
const calcMod2 = await import("../js/core/calc.js");

// Categoría marcada como servicio: sus insumos cuentan como servicio aunque
// su Unidad sea una medida real (UND), no el texto "servicio". "catalogo" es
// la clave interna de la pestaña "Insumos" (ver dom.js). El filtro se fuerza
// a "todos": es lo que activa la vista agrupada por categoría (con su propio
// "+" por grupo) — un filtro de una prueba anterior podría haber dejado
// activa la vista plana de una sola categoría.
state.tab = "catalogo";
state.filtroCatalogoCategoria = "todos";
render();
click('[data-action="toggle-admin-categorias"]');
setInput("#inp-nueva-categoria", "Producción");
click('[data-action="add-cat-categoria"]');
const catProduccion = state.catalogoCategorias.find(c => c.nombre === "Producción");
assert(!!catProduccion, "se crea la categoría Producción");
assert(!catProduccion.esServicio, "nace sin marcar como servicio (no cambia nada existente por sorpresa)");
const checkCatServicio = document.querySelector('[data-action-change="toggle-cat-categoria-servicio"][data-id="' + catProduccion.id + '"]');
checkCatServicio.checked = true;
checkCatServicio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.catalogoCategorias.find(c => c.id === catProduccion.id).esServicio === true, "marcar la casilla de la categoría la deja como 'de servicio'");

// Insumo NUEVO en esa categoría, con Unidad "UND" (no "servicio") a
// propósito. Una categoría recién creada no tiene su propia sección en la
// vista "Todas" (un grupo vacío ahí no se dibuja, es solo ruido — ver
// renderGrupos): hay que filtrar por ELLA primero para que aparezca su "+".
click('[data-action="filtro-cat-categoria"][data-val="' + catProduccion.id + '"]');
click('[data-action="add-cat-item"][data-categoria="' + catProduccion.id + '"]');
const insConfeccion = state.catalogoInsumos[state.catalogoInsumos.length - 1];
setChange('#ins-nombre-' + insConfeccion.id, "Confección");
setChange('.insumo-costo[data-id="' + insConfeccion.id + '"]', "3000");
render();
assert(insConfeccion.unidad !== "servicio", "sanity: el insumo NO usa la unidad especial servicio");
assert(calcMod2.esInsumoServicio(state.catalogoInsumos.find(i => i.id === insConfeccion.id)), "esInsumoServicio() lo reconoce como servicio por vivir en una categoría marcada así, sin tocar Unidad");
assert(!!document.querySelector('#ins-nombre-' + insConfeccion.id).closest(".insumo-nombre-cell").querySelector(".insumo-tag-servicio"), "y el catálogo le muestra la etiqueta 'servicio' en su fila");

// Insumo en una categoría SIN marcar: no debe contar como servicio.
click('[data-action="add-cat-categoria"]');
document.getElementById("inp-nueva-categoria").value = "Telas";
click('[data-action="add-cat-categoria"]');
const catTelas = state.catalogoCategorias.find(c => c.nombre === "Telas");
click('[data-action="filtro-cat-categoria"][data-val="' + catTelas.id + '"]');
click('[data-action="add-cat-item"][data-categoria="' + catTelas.id + '"]');
const insTela = state.catalogoInsumos[state.catalogoInsumos.length - 1];
assert(!calcMod2.esInsumoServicio(state.catalogoInsumos.find(i => i.id === insTela.id)), "un insumo en una categoría NO marcada como servicio sigue sin serlo");

// --- Subcategorías (2026-09): una categoría puede tener sus propias
// subcategorías (el usuario dio el ejemplo exacto: "Telas" -> "Deportivas"/
// "Polos"/"Licradas"). Se guardan FLAT con parentId (ver
// categoriasAplanadas/idsConSubcategorias en core/calc.js), no como un
// árbol anidado — así un insumo sigue apuntando a un solo categoriaId,
// de cualquiera de los dos niveles. ---
setInput("#inp-nueva-subcategoria-" + catTelas.id, "Deportivas");
click('[data-action="add-cat-subcategoria"][data-padre="' + catTelas.id + '"]');
const subDeportivas = state.catalogoCategorias.find(c => c.nombre === "Deportivas");
assert(!!subDeportivas && subDeportivas.parentId === catTelas.id, "se crea 'Deportivas' como subcategoría de 'Telas' (parentId apunta a la madre)");
setInput("#inp-nueva-subcategoria-" + catTelas.id, "Polos");
click('[data-action="add-cat-subcategoria"][data-padre="' + catTelas.id + '"]');
const subPolos = state.catalogoCategorias.find(c => c.nombre === "Polos");
assert(!!subPolos && subPolos.parentId === catTelas.id, "y 'Polos', otra subcategoría de la misma madre");
assert(!!document.querySelector('.cat-admin-fila.cat-admin-sub input[data-id="' + subDeportivas.id + '"]'), "el panel de administrar categorías muestra la subcategoría indentada bajo su madre");

// Un insumo puede clasificarse directo en la subcategoría, no solo en la madre.
click('[data-action="filtro-cat-categoria"][data-val="' + subDeportivas.id + '"]');
click('[data-action="add-cat-item"][data-categoria="' + subDeportivas.id + '"]');
const insLycra = state.catalogoInsumos[state.catalogoInsumos.length - 1];
assert(insLycra.categoriaId === subDeportivas.id, "el insumo nuevo queda clasificado directo en la subcategoría 'Deportivas', no en 'Telas'");

// Filtrar por la categoría MADRE también trae lo clasificado en sus
// subcategorías, no solo lo pegado directo a ella.
click('[data-action="filtro-cat-categoria"][data-val="' + catTelas.id + '"]');
render();
assert(!!document.querySelector("#ins-nombre-" + insTela.id) && !!document.querySelector("#ins-nombre-" + insLycra.id), "filtrar por la categoría MADRE 'Telas' también trae lo clasificado en su subcategoría 'Deportivas'");

// Filtrar por la SUBCATEGORÍA en sí sigue siendo exacto (no trae el resto de la madre).
click('[data-action="filtro-cat-categoria"][data-val="' + subDeportivas.id + '"]');
render();
assert(!document.querySelector("#ins-nombre-" + insTela.id) && !!document.querySelector("#ins-nombre-" + insLycra.id), "filtrar por la SUBCATEGORÍA 'Deportivas' en sí solo trae lo de ella, no el resto de 'Telas'");

// El <select> de categoría de una fila ofrece la madre como opción por su
// cuenta Y sus subcategorías agrupadas con <optgroup> (jerarquía nativa).
click('[data-action="filtro-cat-categoria"][data-val="todos"]');
render();
const selectCategoriaLycra = document.querySelector('select.insumo-categoria[data-id="' + insLycra.id + '"]');
assert(!!selectCategoriaLycra.querySelector('option[value="' + catTelas.id + '"]'), "el <select> de categoría de un insumo ofrece la madre 'Telas' como opción seleccionable por su cuenta");
assert(!!selectCategoriaLycra.querySelector('optgroup[label="Telas"] option[value="' + subDeportivas.id + '"]'), "...y sus subcategorías agrupadas bajo un <optgroup> con el nombre de la madre");

// El explorador de insumos compartido (Cotizaciones/Productos/Plantillas,
// ver renderExploradorInsumos en core/components.js) hereda la misma
// jerarquía — se prueba una vez acá, ya que las tres pestañas reusan la
// misma función.
state.tab = "cotizaciones";
state.cotizacionesVista = "nueva";
state.cotizacionEditando = "";
render();
elegirClienteCotizacion("Cliente Picker Subcategoria");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Prueba picker subcategoria");
click('[data-action="add-cotizacion"]');
const cotSubId = state.cotizaciones[0].id;
const refSubId = state.cotizaciones[0].referencias[0].id;
click('[data-action="abrir-insumo-picker"][data-cot="' + cotSubId + '"][data-ref="' + refSubId + '"]');
assert(!!document.querySelector('.picker-cat.picker-cat-sub[data-val="' + subDeportivas.id + '"]'), "el explorador de insumos compartido también muestra la subcategoría indentada (↳) en su panel lateral");
click('[data-action="set-insumo-picker-categoria"][data-val="' + catTelas.id + '"]');
assert(!!document.querySelector('.picker-item input[data-id="' + insLycra.id + '"]'), "filtrar el explorador por la madre 'Telas' también trae el insumo clasificado en su subcategoría 'Deportivas'");
click('[data-action="cerrar-insumo-picker"]');
state.tab = "catalogo";
render();

// Eliminar la MADRE no se lleva las subcategorías: quedan como categoría
// propia (mismo criterio que ya usan los insumos al perder su categoría —
// nada se borra en cascada sin que el usuario lo pida explícito).
click('[data-action="remove-cat-categoria"][data-id="' + catTelas.id + '"]');
assert(!state.catalogoCategorias.some(c => c.id === catTelas.id), "eliminar 'Telas' sí la quita a ella");
assert(state.catalogoCategorias.some(c => c.id === subDeportivas.id), "...pero 'Deportivas' NO se borra junto con su madre");
assert(state.catalogoCategorias.find(c => c.id === subDeportivas.id).parentId === "", "...queda promovida a categoría propia (parentId vacío), no huérfana apuntando a una madre que ya no existe");

// La cotización: la referencia hereda "servicio" al copiar el insumo desde
// el catálogo (por el picker), aunque la copia no guarde categoriaId.
state.tab = "cotizaciones";
state.cotizacionEditando = "";
render();
elegirClienteCotizacion("Cliente Servicio");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Prueba de servicio en producción");
click('[data-action="add-cotizacion"]');
const cotServ = state.cotizaciones.find(c => c.descripcion === "Prueba de servicio en producción");
const refServ = cotServ.referencias[0];
click('[data-action="abrir-insumo-picker"][data-cot="' + cotServ.id + '"][data-ref="' + refServ.id + '"]');
click('[data-action="toggle-insumo-picker-item"][data-id="' + insConfeccion.id + '"]');
click('[data-action="confirmar-insumo-picker"][data-cot="' + cotServ.id + '"][data-ref="' + refServ.id + '"]');
let refServAhora = state.cotizaciones.find(c => c.id === cotServ.id).referencias[0];
assert(refServAhora.insumos[0].esServicio === true, "al copiar el insumo a la referencia, hereda 'servicio' ya resuelto (no depende de categoriaId, que la copia no guarda)");

click('[data-action="set-cot-tab"][data-id="' + cotServ.id + '"][data-val="produccion"]');
render();
const lineaConfeccion = calcMod2.calcListaCompras(state.cotizaciones.find(c => c.id === cotServ.id)).filter(l => l.nombre === "Confección")[0];
const lineaServClave = lineaConfeccion.clave;
const selectEstado = document.querySelector('select[data-action-change="set-cot-compra"][data-clave="' + lineaServClave + '"]');
assert(!!selectEstado, "la línea de Confección en Producción tiene el selector de 3 estados");
assert(selectEstado.value === "servicio", "nace en 'Servicio' sin que nadie la toque, porque el insumo ya viene marcado como tal");

let resumenServ = calcMod2.calcResumenCompras(state.cotizaciones.find(c => c.id === cotServ.id));
assert(resumenServ.servicio === 1 && resumenServ.compradas === 0 && resumenServ.pendientes === 0, "para el resumen ya cuenta como resuelta (ni pagada en Finanzas ni pendiente)");

// "Servicio" cuenta como costo real (no infla la ganancia) pero NO crea
// movimiento en Finanzas — justo lo que se pidió: se sabe cuánto entra pero
// no es ganancia, sin fingir un pago instantáneo que no ocurrió. El costo
// estimado de la LÍNEA (no el del insumo suelto) ya multiplica por la
// cantidad pedida de la referencia (10 por defecto) — se parte de ese número
// real, no de los $3.000 del catálogo, para no dar por hecho el multiplicador.
const costoRealServ = lineaConfeccion.costoTotal + 200; // la operaria cobró un poco más de lo catalogado
const costoRealInput = document.querySelector('input[data-action-change="set-cot-compra"][data-clave="' + lineaServClave + '"][data-campo="costoReal"]');
costoRealInput.value = String(costoRealServ);
costoRealInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const txAntesServ = state.tx.length;
click('[data-action="sincronizar-compras-finanzas"][data-id="' + cotServ.id + '"]');
assert(state.tx.length === txAntesServ, "sincronizar NO crea ningún movimiento en Finanzas para una línea 'servicio'");
const realServ = calcMod2.calcCotResultadoReal(state.cotizaciones.find(c => c.id === cotServ.id));
const estimadoServ = calcMod2.calcCotizacionTotales(state.cotizaciones.find(c => c.id === cotServ.id));
assert(realServ.costoTotal === estimadoServ.costoTotal + 200, "pero SÍ ajusta el costo/ganancia real: la diferencia contra lo catalogado se refleja igual que si hubiera sido 'Sí'");

// Cambiar a "Sí" (se terceriza esta vez, pago real y aparte): ahora sí debe
// generar el movimiento en Finanzas.
const selectEstado2 = document.querySelector('select[data-action-change="set-cot-compra"][data-clave="' + lineaServClave + '"]');
selectEstado2.value = "si";
selectEstado2.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
click('[data-action="sincronizar-compras-finanzas"][data-id="' + cotServ.id + '"]');
assert(state.tx.length === txAntesServ + 1, "cambiar a 'Sí' y sincronizar SÍ crea el movimiento de gasto en Finanzas");

// Y si se vuelve a "Servicio" (era un error, en realidad se hizo en el
// taller), el movimiento que ya no corresponde se retira al sincronizar.
const selectEstado3 = document.querySelector('select[data-action-change="set-cot-compra"][data-clave="' + lineaServClave + '"]');
selectEstado3.value = "servicio";
selectEstado3.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
click('[data-action="sincronizar-compras-finanzas"][data-id="' + cotServ.id + '"]');
assert(state.tx.length === txAntesServ, "y volver a 'Servicio' retira el movimiento que ya no aplica, sin dejarlo huérfano en Finanzas");

// Compatibilidad: una cotización vieja con el "comprado" booleano de antes
// (sin el campo `estado` nuevo) se sigue leyendo igual que siempre.
assert(calcMod2.estadoCompra({ comprado: true }) === "si", "comprado:true (formato viejo) se lee como 'si'");
assert(calcMod2.estadoCompra({ comprado: false }) === "no", "comprado:false (formato viejo) se lee como 'no'");
assert(calcMod2.estadoCompra(null) === "no", "sin ningún registro, se lee como 'no'");
// Caso cruzado: un registro VIEJO explícito sobre una línea que hoy por
// defecto caería en 'servicio' — el registro real siempre gana sobre el
// default nuevo, nunca al revés.
assert(calcMod2.estadoLineaCompra({ compras: [{ clave: "x", comprado: true }] }, { clave: "x", esServicio: true }) === "si", "un 'comprado:true' viejo sobre una línea de servicio se lee como 'si', no como 'servicio'");

// Un costo GLOBAL del pedido (domicilio) trae esServicio:true por diseño —
// significa "no se compra por cantidad", NO "es mano de obra de nómina": un
// domicilio casi siempre SÍ es un pago instantáneo real al mensajero. No debe
// heredar el default 'servicio' que sí aplica a insumos de una referencia
// (ver el comentario junto a estadoLineaCompra en core/calc.js).
state.cotizaciones = state.cotizaciones.map(c => c.id === cotServ.id
  ? Object.assign({}, c, { costosGlobales: (c.costosGlobales || []).concat([{ id: "domicilio-test", nombre: "Domicilio", costo: 15000, proveedorId: "", esServicio: true }]) })
  : c);
render();
const lineaDomicilio = calcMod2.calcListaCompras(state.cotizaciones.find(c => c.id === cotServ.id)).filter(l => l.nombre === "Domicilio")[0];
assert(lineaDomicilio.esGlobal === true, "sanity: la línea de domicilio es un costo global, igual que confección es un insumo de referencia");
assert(calcMod2.estadoLineaCompra(state.cotizaciones.find(c => c.id === cotServ.id), lineaDomicilio) === "no", "un costo global (domicilio) NO nace en 'Servicio' por defecto: sigue neutral, como cualquier pago que sí puede ser real y aparte");
const selectDomicilio = document.querySelector('select[data-action-change="set-cot-compra"][data-clave="' + lineaDomicilio.clave + '"]');
assert(selectDomicilio.value === "no", "y la pantalla lo confirma: el selector nace en 'No', no en 'Servicio'");
selectDomicilio.value = "si";
selectDomicilio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const txAntesDomicilio = state.tx.length;
click('[data-action="sincronizar-compras-finanzas"][data-id="' + cotServ.id + '"]');
assert(state.tx.length === txAntesDomicilio + 1, "y marcarlo 'Sí' y sincronizar SÍ crea su movimiento de gasto, como cualquier pago real al mensajero");

// calcResumenCompras: un costoReal de 0 escrito A PROPÓSITO en una línea de
// servicio no debe leerse como "no se escribió nada" y sustituirse por el
// estimado — 0 es una respuesta real ("no costó nada"), no un vacío.
const costoRealInputCero = document.querySelector('input[data-action-change="set-cot-compra"][data-clave="' + lineaServClave + '"][data-campo="costoReal"]');
const selectVolverServicio = document.querySelector('select[data-action-change="set-cot-compra"][data-clave="' + lineaServClave + '"]');
selectVolverServicio.value = "servicio";
selectVolverServicio.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
costoRealInputCero.value = "0";
costoRealInputCero.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const resumenTrasCero = calcMod2.calcResumenCompras(state.cotizaciones.find(c => c.id === cotServ.id));
assert(resumenTrasCero.realServicio === 0, "un costoReal de 0 escrito a propósito en una línea de servicio se respeta (no se reemplaza por el estimado)");

// ---------------------------------------------------------------------------
// Los otros 3 sitios donde un insumo del catálogo se copia a otra estructura
// (plantilla, producto, y de ahí a una referencia) deben resolver "servicio"
// igual que el picker de una referencia directa — no basta con que el
// comentario del código lo diga, tiene que quedar demostrado corriendo el
// flujo real.
// ---------------------------------------------------------------------------
// state.plantillasVista puede haber quedado en "flujos" (de las pruebas de
// flujos de producción, más arriba en este archivo): esa vista no tiene
// botón "+ Nueva plantilla", así que se fuerza de vuelta a "plantillas".
state.tab = "plantillas";
state.plantillasVista = "plantillas";
state.plantillaEditando = "";
render();
const plantillasAntesServ = state.plantillasPrendas.length;
click('[data-action="add-plantilla"]');
const plaServId = state.plantillasPrendas[state.plantillasPrendas.length - 1].id;
assert(state.plantillasPrendas.length === plantillasAntesServ + 1, "sanity: se crea la plantilla de prueba");
click('[data-action="abrir-insumo-picker-plantilla"][data-pla="' + plaServId + '"]');
click('[data-action="toggle-insumo-picker-item"][data-id="' + insConfeccion.id + '"]');
click('[data-action="confirmar-insumo-picker-plantilla"][data-pla="' + plaServId + '"]');
const plaInsServ = state.plantillasPrendas.find(p => p.id === plaServId).insumos[0];
assert(plaInsServ.esServicio === true, "confirmar-insumo-picker-plantilla (plantillas.js) también resuelve 'servicio' al copiar del catálogo, no solo el picker de una referencia");

state.tab = "productos";
state.productosVista = "nueva";
state.productoEditando = "";
render();
setInput('[data-form="producto"][data-field="nombre"]', "Producto de prueba servicio");
click('[data-action="add-producto"]');
const proServId = state.productos[state.productos.length - 1].id;
click('[data-action="toggle-producto-costeo"][data-id="' + proServId + '"]'); // la sección de insumos nace colapsada
click('[data-action="abrir-insumo-picker-producto"][data-pro="' + proServId + '"]');
click('[data-action="toggle-insumo-picker-item"][data-id="' + insConfeccion.id + '"]');
click('[data-action="confirmar-insumo-picker-producto"][data-pro="' + proServId + '"]');
const proInsServ = state.productos.find(p => p.id === proServId).insumos[0];
assert(proInsServ.esServicio === true, "confirmar-insumo-picker-producto (productos.js) también resuelve 'servicio' al copiar del catálogo");

// Y de la plantilla/producto hacia una referencia nueva (aplicar-plantilla /
// aplicar-producto), la marca ya resuelta se hereda tal cual.
state.tab = "cotizaciones";
state.cotizacionEditando = "";
render();
elegirClienteCotizacion("Cliente Servicio 2");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Prueba plantilla/producto servicio");
click('[data-action="add-cotizacion"]');
const cotServ2 = state.cotizaciones.find(c => c.descripcion === "Prueba plantilla/producto servicio");
const refServ2 = cotServ2.referencias[0];
const plaSelectEnRef = document.querySelector('[data-ref-id="' + refServ2.id + '"] select[data-action-change="aplicar-plantilla"]');
plaSelectEnRef.value = plaServId;
plaSelectEnRef.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const refConPla = state.cotizaciones.find(c => c.id === cotServ2.id).referencias[0];
assert(refConPla.insumos.some(i => i.esServicio === true), "aplicar-plantilla hereda 'servicio' ya resuelto desde la plantilla hacia la referencia");

// ---------------------------------------------------------------------------
// La ganancia mostrada (arriba de la cotización Y en Producción) tiene que
// descontar la comisión del vendedor tanto en "Estimado" como en "Real" — de
// lo contrario la MISMA cotización parece perder plata de más al entrar a
// Producción, sin ningún aviso de por qué (justo el reporte real que motivó
// este fix: "Ganancia estimada $88.280" vs "Ganancia real $20.350", una
// diferencia mayor que el sobrecosto, por la comisión sin descontar en el
// estimado).
// ---------------------------------------------------------------------------
const { fmt } = await import("../js/core/utils.js");
state.cotizacionEditando = "";
render();
elegirClienteCotizacion("Cliente Comisión");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Prueba comisión en estimado y real");
click('[data-action="add-cotizacion"]');
const cotCom = state.cotizaciones.find(c => c.descripcion === "Prueba comisión en estimado y real");
const refCom = cotCom.referencias[0];
const refComCard = document.querySelector('[data-ref-id="' + refCom.id + '"]');
const cantidadInputCom = refComCard.querySelector('input[data-campo="cantidadPedida"]');
cantidadInputCom.value = "1"; // por defecto nace en 10 — se fija en 1 para que el precio total sea igual al precio x1
cantidadInputCom.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const precioInputCom = document.querySelector('[data-ref-id="' + refCom.id + '"] input[data-campo="precioVenta"]');
precioInputCom.value = "50000";
precioInputCom.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
// Sin insumos (costo 0), cantidad 1: ganancia bruta = precio = 50.000, para
// que la cuenta de comisión (10% de las prendas) sea fácil de verificar a
// mano: 5.000.
click('[data-action="toggle-cot-vendedor"][data-id="' + cotCom.id + '"]');
setChange('input[data-action-change="set-cot-vendedor"][data-id="' + cotCom.id + '"][data-campo="nombre"]', "Vendedor Prueba");
setChange('select[data-action-change="set-cot-vendedor"][data-id="' + cotCom.id + '"][data-campo="tipo"]', "porcentaje");
setChange('input[data-action-change="set-cot-vendedor"][data-id="' + cotCom.id + '"][data-campo="valor"]', "10");
render();
const cotComAhora = state.cotizaciones.find(c => c.id === cotCom.id);
const totalesCom = calcMod2.calcCotizacionTotales(cotComAhora);
const realCom = calcMod2.calcCotResultadoReal(cotComAhora);
assert(realCom.comision === 5000, "sanity: 10% de 50.000 de precio de prendas da 5.000 de comisión");
assert(totalesCom.gananciaTotal === 50000, "sanity: la ganancia BRUTA (sin descontar comisión) es el precio completo, sin insumos de por medio");

const heroGanancia = document.querySelector('[data-cot-id="' + cotCom.id + '"] .cot-hero-stat:nth-child(2) .rv');
assert(heroGanancia.textContent.indexOf(fmt(45000)) !== -1, "'Ganancia estimada' arriba de la cotización YA descuenta la comisión (50.000 - 5.000 = 45.000), no muestra la bruta");
assert(heroGanancia.textContent.indexOf(fmt(5000)) !== -1, "y la nota entre paréntesis dice cuánto se descontó de comisión");

click('[data-action="set-cot-tab"][data-id="' + cotCom.id + '"][data-val="produccion"]');
render();
const colEstimado = document.querySelectorAll('[data-cot-id="' + cotCom.id + '"] .cot-compara-col')[0];
const colReal = document.querySelectorAll('[data-cot-id="' + cotCom.id + '"] .cot-compara-col')[1];
assert(colEstimado.textContent.indexOf(fmt(45000)) !== -1, "en Producción, 'Estimado' también muestra la ganancia ya neta de comisión (antes mostraba la bruta 50.000, distinta de 'Real' sin ningún aviso)");
assert(colEstimado.textContent.indexOf("comisión del vendedor") !== -1, "'Estimado' explica con la misma nota cuánto se le descontó");
assert(colReal.textContent.indexOf(fmt(45000)) !== -1, "'Real' coincide con 'Estimado' cuando no hay sobrecosto (los dos ya restan la misma comisión)");
assert(colReal.textContent.indexOf("comisión del vendedor") !== -1, "'Real' también trae la nota, no solo 'Estimado'");

// ---------------------------------------------------------------------------
// Borradores sin guardar: una cotización en modo "guardado explícito" (o un
// "Nuevo pedido rápido" a medio llenar) vivía SOLO en memoria hasta pulsar
// Guardar/Crear — si la pestaña se cerraba antes (se actualizó el navegador,
// se recargó por accidente, se cayó), esas horas de trabajo desaparecían sin
// ningún aviso ni forma de recuperarlas. Se prueba: (1) el aviso de "¿seguro
// que sales?" ahora sí se dispara, (2) el espejo local se refresca solo
// mientras se edita, (3) al "reabrir la app" se ofrece recuperar el
// borrador, y (4) recuperarlo nunca intenta guardar en la Sheet una clave
// que no tiene fila propia ahí (formPedido) — eso corrompería la pestaña "kv".
// ---------------------------------------------------------------------------
const storeMod2 = await import("../js/core/store.js");

// (1) beforeunload: antes solo miraba si había un guardado FALLIDO
// (hayPendientes) — una edición que nunca se INTENTÓ guardar no pasaba por
// ahí y se podía cerrar sin ningún aviso.
// (nota: esta sesión de pruebas ya dejó un guardado fallido real colgado más
// arriba — simula sesión de Google vencida a propósito — así que
// hayPendientes() por sí solo ya dispara la advertencia de aquí en adelante.
// Por eso solo se puede probar la mitad "con borrador SÍ advierte", que es
// justamente la que antes NO existía; la mitad "sin nada, no advierte" ya
// estaba cubierta por el hayPendientes() original y no cambió con este fix.)
guardadoMod.marcarBorrador("cotizaciones", () => JSON.stringify(state.cotizaciones));
const evtConBorrador = new dom.window.Event("beforeunload", { cancelable: true });
window.dispatchEvent(evtConBorrador);
assert(evtConBorrador.defaultPrevented, "cerrar la pestaña con una edición sin guardar (sin ningún intento de guardado fallido de por medio) SÍ dispara la advertencia del navegador");
guardadoMod.olvidarBorrador("cotizaciones");

// (2) el espejo se refresca solo mientras se edita, sin que nadie pulse
// Guardar — reutiliza la cotización de la prueba de comisión de arriba.
state.cotSucia = cotCom.id;
render(); // dispara revisarBorradoresSinGuardar() -> marcarBorrador("cotizaciones", ...)
assert(guardadoMod.hayBorradores(), "editar una cotización marca de inmediato que hay un borrador sin guardar (sin esperar el debounce del espejo)");
const descripcionOriginalCotCom = state.cotizaciones.find(c => c.id === cotCom.id).descripcion;
state.cotizaciones = state.cotizaciones.map(c => c.id === cotCom.id ? Object.assign({}, c, { descripcion: "Editado justo antes de que se cerrara sola" }) : c);
render();
await new Promise(r => setTimeout(r, 2500)); // pasa el tiempo de espera del espejo de borradores (1500ms) con margen de sobra
const espejoTrasEspera = guardadoMod.leerEspejo("cotizaciones");
assert(!!espejoTrasEspera && espejoTrasEspera.indexOf("Editado justo antes de que se cerrara sola") !== -1, "y unos segundos después (sin que nadie pulse Guardar) esa edición ya quedó en el espejo local, lista para recuperarse si la pestaña se cierra sola");

// (3) al "reabrir la app" (loadAll de nuevo) con el borrador todavía
// marcado, se ofrece recuperarlo — simulando que la Sheet real SIGUE con la
// versión de antes (nadie guardó todavía) mientras el espejo de este
// navegador ya tiene el cambio.
const cotizacionesComoEnLaSheet = state.cotizaciones.map(c => c.id === cotCom.id ? Object.assign({}, c, { descripcion: descripcionOriginalCotCom }) : c);
const getOriginalRecup = window.storage.get;
window.storage.get = async function (key, arg2) {
  if (key === constantsMod.KEYS.cotizaciones) return { value: JSON.stringify(cotizacionesComoEnLaSheet) };
  return getOriginalRecup(key, arg2);
};
state.recuperacion = null;
await loadAll();
window.storage.get = getOriginalRecup;
assert(!!state.recuperacion, "al 'reabrir la app' con un borrador de cotización todavía marcado, se ofrece recuperarlo — antes esto NUNCA pasaba para una edición que nunca se intentó guardar");
assert(state.recuperacion.claves.indexOf("cotizaciones") !== -1, "...específicamente señalando la clave 'cotizaciones'");
assert(state.cotizaciones.find(c => c.id === cotCom.id).descripcion === descripcionOriginalCotCom, "sanity: justo después del 'reinicio', la pantalla muestra la versión SIN el cambio (la que ya estaba guardada)");

await storeMod2.recuperarDelEspejo();
assert(state.cotizaciones.find(c => c.id === cotCom.id).descripcion === "Editado justo antes de que se cerrara sola", "restaurar el borrador SÍ trae de vuelta la edición que nunca se guardó");
assert(state.recuperacion === null, "y cierra el aviso de recuperación");
state.cotSucia = "";
render();

// (4) el caso más delicado: un borrador de "Nuevo pedido rápido" (formPedido)
// NUNCA tuvo una fila propia en la Sheet — recuperarlo debe restaurarlo EN
// PANTALLA, pero jamás intentar escribirlo (eso mandaría una clave
// inventada a la pestaña "kv" y la corrompería).
guardadoMod.espejar("formPedido", JSON.stringify({
  clienteId: "", cliente: "Cliente Recuperado", tipoCliente: "propio", abono: "", fechaEntrega: "",
  vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "", conFlujoProduccion: true,
  esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "",
  lineas: [{ id: "lx", productoNombre: "Prueba recuperación", cantidad: 2 }]
}));
state.recuperacion = { claves: ["formPedido"], etiquetas: [storeMod2.ETIQUETA_CLAVE.formPedido] };
const setCallsRecup = [];
const originalSetRecup = window.storage.set;
window.storage.set = async function (key, value, arg2) { setCallsRecup.push(key); return originalSetRecup(key, value, arg2); };
await storeMod2.recuperarDelEspejo();
window.storage.set = originalSetRecup;
assert(state.formPedido.cliente === "Cliente Recuperado" && state.formPedido.lineas.length === 1, "recuperarDelEspejo restaura un borrador de 'Nuevo pedido rápido' EN PANTALLA...");
// Esta recuperación viene del espejo LOCAL (state.recuperacion no lleva
// .nube), así que no hay ninguna limpieza en la nube que hacer — pero pase
// lo que pase, JAMÁS debe escribirse con una clave inventada o vacía
// (KEYS.formPedido ni siquiera existe: sería `undefined` como clave), que
// es lo que de verdad corrompería la pestaña "kv".
assert(setCallsRecup.indexOf(undefined) === -1 && setCallsRecup.indexOf(constantsMod.KEYS.formPedido) === -1, "...y jamás con una clave inventada o vacía que corrompería la pestaña 'kv'");
assert(setCallsRecup.length === 0, "...de hecho, al venir del espejo local (no de la nube), no hay ninguna limpieza de nube que hacer: cero escrituras");
assert(state.recuperacion === null, "y también cierra el aviso de recuperación para este caso");

// ---------------------------------------------------------------------------
// Borrador EN LA NUBE: el espejo local de arriba resuelve "se me cerró la
// pestaña sola" en ESTE navegador, pero vive en localStorage — abrir desde
// otro computador, otro navegador, o después de borrar datos de navegación
// no tiene nada local de dónde recuperar. Por eso la misma edición también
// se manda —mejor esfuerzo, como mucho cada 4s— a su propia fila de la
// pestaña "kv", separada por correo Y por cotización. Se prueba: (1) que de
// verdad se manda mientras se edita, con la versión más reciente aunque se
// siga editando mientras la cuenta regresiva corre, y con `basadaEn`
// incluido; (2) que recuperar desde la nube funciona con CERO rastro local
// (la prueba real de "otro dispositivo"), tanto para una cotización
// (fusionada por id, sin pisar las demás) como para un pedido rápido a
// medio llenar; (3) que un borrador VIEJO (cuya `basadaEn` ya no coincide
// con lo guardado de verdad — ej. la limpieza tras Guardar falló en
// silencio) NO se ofrece, porque restaurarlo regresaría la cotización a una
// versión vieja; y (4) que dos borradores de cotizaciones DISTINTAS en la
// nube a la vez (dos pestañas o dos dispositivos) ya no se pisan entre sí.
// ---------------------------------------------------------------------------
const claveNubeCot = "borrador:cotizaciones:admin@taller.test:" + cotCom.id;
const claveNubeFp = "borrador:formPedido:admin@taller.test";

// (1) se manda mientras se edita, respetando el tope de "como mucho cada 4s"
// (no un debounce que se reinicia con cada tecla y nunca llega a mandar
// nada si alguien escribe sin parar) — y cuando por fin manda, va con la
// versión MÁS RECIENTE, no la que había cuando arrancó la cuenta regresiva.
state.cotSucia = cotCom.id;
state.cotizaciones = state.cotizaciones.map(c => c.id === cotCom.id ? Object.assign({}, c, { descripcion: "Borrador en la nube v1" }) : c);
render(); // arranca la cuenta regresiva de 4s

const enviosNube = [];
const origSetNube = window.storage.set;
window.storage.set = async function (key, value, arg2) {
  if (key === claveNubeCot) enviosNube.push(value);
  return origSetNube(key, value, arg2);
};

await new Promise(r => setTimeout(r, 1800)); // menos de 4s: todavía no debería haber mandado nada
state.cotizaciones = state.cotizaciones.map(c => c.id === cotCom.id ? Object.assign({}, c, { descripcion: "Borrador en la nube v2 (la más reciente)" }) : c);
render(); // sigue "escribiendo" — esto NO debe reprogramar la cuenta regresiva
await new Promise(r => setTimeout(r, 2700)); // total ~4.5s desde el primer render: ya debió mandar

window.storage.set = origSetNube;
assert(enviosNube.length >= 1, "mientras se edita una cotización, el borrador también se manda a la nube (no solo al espejo local) — como mucho cada 4 segundos, en su propia clave con el id de la cotización");
const payloadNube = JSON.parse(enviosNube[enviosNube.length - 1]);
assert(payloadNube.cotizacionId === cotCom.id && payloadNube.cotizacion.descripcion === "Borrador en la nube v2 (la más reciente)", "y cuando manda, va con la versión más reciente — no la que había cuando arrancó la cuenta regresiva, aunque se haya seguido editando mientras tanto");
assert(!!payloadNube.basadaEn && payloadNube.basadaEn.id === cotCom.id, "y guarda de qué versión partió (basadaEn), para poder distinguir después un borrador todavía vigente de uno que ya quedó viejo");

state.cotSucia = "";
render(); // limpia el borrador local Y en la nube antes de seguir

// (2) recuperar desde CERO rastro local — la prueba real de "otro
// dispositivo": se borra el rastro local de "cotizaciones" (como si nunca
// hubiera pasado por este navegador) y solo queda la versión "ya guardada"
// (como si viniera de la Sheet real) más el borrador que sí quedó en la nube.
guardadoMod.olvidarBorrador("cotizaciones");
window.localStorage.removeItem("taller_espejo_v1:cotizaciones");
const cotBaseGuardada = Object.assign({}, state.cotizaciones.find(c => c.id === cotCom.id), { descripcion: "Descripción ya guardada de verdad (sin el cambio del otro dispositivo)" });
const cantidadCotizacionesAntes = state.cotizaciones.length;
state.cotizaciones = state.cotizaciones.map(c => c.id === cotCom.id ? cotBaseGuardada : c);
await window.storage.set(constantsMod.KEYS.cotizaciones, JSON.stringify(state.cotizaciones), false); // fija "lo que de verdad está en la Sheet"
const cotDesdeOtroDispositivo = Object.assign({}, cotBaseGuardada, { descripcion: "Cambio hecho desde el celular, nunca guardado" });
await window.storage.set(claveNubeCot, JSON.stringify({ cotizacionId: cotCom.id, cotizacion: cotDesdeOtroDispositivo, basadaEn: cotBaseGuardada }), false);
state.recuperacion = null;

await loadAll();
assert(!!state.recuperacion, "abrir la app SIN NINGÚN rastro local (como si fuera otro dispositivo o navegador distinto) igual ofrece recuperar, porque el borrador quedó guardado también en la nube");
assert(state.recuperacion.claves.indexOf("cotizaciones") !== -1, "...con la clave correcta");
assert(state.recuperacion.nube && Array.isArray(state.recuperacion.nube.cotizaciones) && state.recuperacion.nube.cotizaciones.some(d => d.cotizacionId === cotCom.id), "...y sabe que viene de la nube, no de un espejo local que acá no existe");

await storeMod2.recuperarDelEspejo();
assert(state.cotizaciones.find(c => c.id === cotCom.id).descripcion === "Cambio hecho desde el celular, nunca guardado", "restaurar desde la nube trae de vuelta ese cambio, aunque ESTE navegador nunca lo haya visto");
assert(state.cotizaciones.length === cantidadCotizacionesAntes, "...fusionando solo esa cotización por id, sin pisar ni perder ninguna otra del arreglo completo");

// (3) un borrador VIEJO en la nube — su `basadaEn` ya NO coincide con lo que
// hay guardado de verdad (como si esta edición ya se hubiera guardado por
// otro lado, o la limpieza tras Guardar hubiera fallado en silencio) — NO
// se ofrece: ofrecerlo regresaría la cotización a una versión vieja.
const cotYaGuardadaDeVerdad = state.cotizaciones.find(c => c.id === cotCom.id);
const basadaEnVieja = Object.assign({}, cotYaGuardadaDeVerdad, { descripcion: "Versión de hace rato, de la que partió un borrador que nunca se limpió" });
await window.storage.set(claveNubeCot, JSON.stringify({
  cotizacionId: cotCom.id,
  cotizacion: Object.assign({}, cotYaGuardadaDeVerdad, { descripcion: "Cambio de un borrador viejo que ya no aplica" }),
  basadaEn: basadaEnVieja
}), false);
state.recuperacion = null;
await loadAll();
assert(!state.recuperacion, "un borrador en la nube cuya base (basadaEn) YA NO coincide con lo guardado de verdad no se ofrece — ofrecerlo regresaría la cotización a una versión vieja, aunque el 'borrador' en sí sea distinto de lo actual");
await window.storage.set(claveNubeCot, "", false); // limpio para no interferir con lo que sigue

// (4) dos borradores de cotizaciones DISTINTAS en la nube a la vez (dos
// pestañas, o dos dispositivos, cada uno editando la suya): antes se pisaban
// entre sí (una sola clave sin id — "el último que escribe gana"); ahora
// cada una tiene su propia clave con id y las dos se ofrecen y se restauran.
const cotBaseB = Object.assign({}, state.cotizaciones.find(c => c.descripcion === "Prueba de servicio en producción"));
await window.storage.set(constantsMod.KEYS.cotizaciones, JSON.stringify(state.cotizaciones), false); // fija la Sheet real con ambas tal como están
const cotEditadaA = Object.assign({}, cotYaGuardadaDeVerdad, { descripcion: "Editada en la pestaña 1" });
const cotEditadaB = Object.assign({}, cotBaseB, { descripcion: "Editada en la pestaña 2" });
await window.storage.set("borrador:cotizaciones:admin@taller.test:" + cotYaGuardadaDeVerdad.id, JSON.stringify({ cotizacionId: cotYaGuardadaDeVerdad.id, cotizacion: cotEditadaA, basadaEn: cotYaGuardadaDeVerdad }), false);
await window.storage.set("borrador:cotizaciones:admin@taller.test:" + cotBaseB.id, JSON.stringify({ cotizacionId: cotBaseB.id, cotizacion: cotEditadaB, basadaEn: cotBaseB }), false);
state.recuperacion = null;
await loadAll();
assert(!!state.recuperacion && state.recuperacion.nube && state.recuperacion.nube.cotizaciones.length === 2, "dos pestañas/dispositivos editando cotizaciones DISTINTAS a la vez ya no se pisan el borrador en la nube: las dos se ofrecen juntas");
await storeMod2.recuperarDelEspejo();
assert(state.cotizaciones.find(c => c.id === cotYaGuardadaDeVerdad.id).descripcion === "Editada en la pestaña 1", "...y restaurar trae de vuelta la primera...");
assert(state.cotizaciones.find(c => c.id === cotBaseB.id).descripcion === "Editada en la pestaña 2", "...y también la segunda, sin que ninguna se perdiera por compartir la misma fila de la nube");

// Lo mismo para "Nuevo pedido rápido": sin rastro local, con un borrador en
// la nube — se restaura EN PANTALLA igual que el caso local ya probado
// arriba, sin escribir nada a KEYS.formPedido (que no existe).
window.localStorage.removeItem("taller_espejo_v1:formPedido");
await window.storage.set(claveNubeFp, JSON.stringify({ formPedido: { cliente: "Cliente desde otro navegador", lineas: [{ id: "y1", productoNombre: "Otra prueba", cantidad: 3 }] } }), false);
state.recuperacion = null;
await loadAll();
assert(!!state.recuperacion && state.recuperacion.claves.indexOf("formPedido") !== -1, "un pedido rápido a medio llenar también se ofrece recuperar desde la nube sin ningún rastro local");
await storeMod2.recuperarDelEspejo();
assert(state.formPedido.cliente === "Cliente desde otro navegador" && state.formPedido.lineas.length === 1, "y restaurarlo trae de vuelta exactamente lo que había en la nube");
assert(state.recuperacion === null, "y cierra el aviso");

// ---------------------------------------------------------------------------
// El mismo mecanismo de arriba (marcar borrador + espejo local + ofrecer
// recuperar), generalizado al RESTO de los formularios de "+ Nuevo" — antes
// SOLO cotizaciones/formPedido lo tenían. El usuario reportó perder trabajo
// real haciendo "cotizaciones, insumos, moviendo plata" justo al tener que
// recargar la página: un movimiento de Finanzas a medio llenar (formTx)
// vivía SOLO en memoria hasta pulsar "Registrar" — el mismo hueco que ya se
// había cerrado para formPedido, pero seguía abierto ahí (y en formCliente/
// formEmp/formGastoFijo/formDeuda/formCotizacion/formProducto/
// formNominaPago/formReembolso/formAbono/formPend). Se prueba con formTx
// ("moviendo plata") y formCliente (un formulario cualquiera) — el resto
// comparte la misma función genérica (FORMULARIOS_CON_BORRADOR en
// core/store.js), probar dos alcanza para confiar en el mecanismo
// compartido sin repetir la misma prueba once veces.
// ---------------------------------------------------------------------------
const formTxVacio = { tipo: "ingreso", concepto: "", monto: "", contraparte: "", fecha: hoyStr(), pedidoId: "", cotizacionId: "", esInsumo: false, insumoNombre: "", proveedorId: "", cantidad: "", unidad: "", servicios: [] };
state.formTx = Object.assign({}, formTxVacio, { concepto: "Compra de tela urgente", monto: "150000" });
render(); // dispara revisarBorradoresSinGuardar()
assert(guardadoMod.borradoresDeSesionAnterior().indexOf("formTx") !== -1, "escribir en 'Nuevo movimiento' de Finanzas marca de inmediato que hay un borrador sin guardar (antes NUNCA pasaba para este formulario)");
await new Promise(r => setTimeout(r, 2000)); // pasa el tiempo de espera del espejo de borradores (1500ms) con margen
const espejoFormTx = guardadoMod.leerEspejo("formTx");
assert(!!espejoFormTx && espejoFormTx.indexOf("Compra de tela urgente") !== -1, "y unos segundos después esa edición ya quedó en el espejo local, sin que nadie pulse 'Registrar'");

// Un formulario vacío (solo con sus valores por defecto — tipo:"ingreso", la
// fecha de hoy) NO cuenta como borrador: abrir el formulario y no escribir
// nada no debe quedar marcado como "algo que recuperar".
state.formTx = formTxVacio;
render();
assert(guardadoMod.borradoresDeSesionAnterior().indexOf("formTx") === -1, "un formulario vacío (solo con sus valores por defecto) no cuenta como borrador");

// Recuperación: mismo camino que ya se probó arriba para formPedido — nunca
// intenta escribir a la Sheet una clave que no tiene fila propia ahí.
guardadoMod.espejar("formTx", JSON.stringify(Object.assign({}, formTxVacio, { tipo: "gasto", concepto: "Recuperado de un cierre accidental", monto: "80000" })));
state.recuperacion = { claves: ["formTx"], etiquetas: [storeMod2.ETIQUETA_CLAVE.formTx] };
const setCallsFormTx = [];
const originalSetFormTx = window.storage.set;
window.storage.set = async function (key, value, arg2) { setCallsFormTx.push(key); return originalSetFormTx(key, value, arg2); };
await storeMod2.recuperarDelEspejo();
window.storage.set = originalSetFormTx;
assert(state.formTx.concepto === "Recuperado de un cierre accidental" && state.formTx.monto === "80000", "recuperarDelEspejo también restaura un movimiento de Finanzas a medio llenar EN PANTALLA...");
assert(setCallsFormTx.length === 0, "...sin escribir nada a la Sheet (formTx tampoco tiene fila propia ahí)");
state.formTx = formTxVacio;
render();

// Un segundo formulario cualquiera (Contactos → nuevo cliente), para
// confirmar que esto no fue una casualidad de formTx en particular.
state.formCliente = Object.assign({}, state.formCliente, { nombre: "Cliente a medio registrar" });
render();
assert(guardadoMod.borradoresDeSesionAnterior().indexOf("formCliente") !== -1, "lo mismo aplica a 'Nuevo contacto' (formCliente) — y al resto de la lista en FORMULARIOS_CON_BORRADOR, core/store.js");
state.formCliente = Object.assign({}, state.formCliente, { nombre: "" });
render();

// ---------------------------------------------------------------------------
// "Rendimiento de planta" no reflejaba nada: el usuario reportó "ya despaché
// algo y no refleja nada". Causa: solo contaba salidas de stock de Catálogo
// (movimientosStock), que solo existen para pedidos con un producto de
// catálogo asociado — un pedido a la medida nunca las genera, sin importar
// cuántas etapas avance. Fix: moveEstado/moveEstadoRef (modules/pedidos.js)
// estampan fechaTerminado/fechaTerminada al LLEGAR a la última etapa, y
// calcPrendasTerminadasPorDia (core/calc.js) cuenta eso en vez de stock.
// ---------------------------------------------------------------------------
state.pedidos = [{
  id: "ped-planta", numeroOp: "OP-7777", cliente: "Cliente Planta", descripcion: "Camisetas a la medida",
  cantidad: "5", total: 250000, costo: 150000, abono: 0, estado: "nuevo", estadosDef: null,
  fechaCreacion: "2026-08-30", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [];
state.tab = "pedidos";
state.pedidosVista = "historial";
render();
click('[data-action="advance"][data-id="ped-planta"]'); // nuevo -> cortado
click('[data-action="advance"][data-id="ped-planta"]'); // cortado -> confeccion
click('[data-action="advance"][data-id="ped-planta"]'); // confeccion -> acabados
assert(!state.pedidos.find(p => p.id === "ped-planta").fechaTerminado, "en una etapa intermedia todavía no hay fecha de terminado");
click('[data-action="advance"][data-id="ped-planta"]'); // acabados -> entregado
let pedPlanta = state.pedidos.find(p => p.id === "ped-planta");
assert(pedPlanta.estado === "entregado", "avanza hasta la última etapa");
assert(pedPlanta.fechaTerminado === hoyStr(), "y al LLEGAR ahí queda estampada la fecha de hoy");
click('[data-action="retreat"][data-id="ped-planta"]');
pedPlanta = state.pedidos.find(p => p.id === "ped-planta");
assert(pedPlanta.estado === "acabados" && !pedPlanta.fechaTerminado, "retroceder desde la última etapa borra la fecha: ya no está \"terminado\"");
click('[data-action="advance"][data-id="ped-planta"]');
pedPlanta = state.pedidos.find(p => p.id === "ped-planta");
assert(pedPlanta.fechaTerminado === hoyStr(), "y volver a llegar la vuelve a estampar");

// Lo mismo por REFERENCIA en un pedido con cotización vinculada: cada una
// puede terminar un día distinto de las demás del mismo pedido.
state.cotizaciones = [{
  id: "cot-planta", cliente: "Cliente Planta 2", descripcion: "Uniformes", pedidoId: "ped-planta-2",
  estado: "convertida", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "cpx",
  referencias: [
    { id: "ref-a", nombre: "Camisetas", origen: "taller", estado: "acabados", estadosDef: null, cantidadPedida: 3, consumoAprox: 1, precioVenta: 20000, insumos: [], detalle: [], costoCompra: 0, proveedorId: "" },
    { id: "ref-b", nombre: "Pantalones", origen: "taller", estado: "nuevo", estadosDef: null, cantidadPedida: 2, consumoAprox: 1, precioVenta: 30000, insumos: [], detalle: [], costoCompra: 0, proveedorId: "" }
  ]
}];
state.pedidos = [Object.assign({}, pedPlanta, { id: "ped-planta-2", cotizacionId: "cot-planta", estado: "acabados", fechaTerminado: "" })];
render();
click('[data-action="advance-ref"][data-pedido="ped-planta-2"][data-cot="cot-planta"][data-ref="ref-a"]');
let cotPlanta = state.cotizaciones.find(c => c.id === "cot-planta");
let refA = cotPlanta.referencias.find(r => r.id === "ref-a");
let refB = cotPlanta.referencias.find(r => r.id === "ref-b");
assert(refA.estado === "entregado" && refA.fechaTerminada === hoyStr(), "la referencia A llega a su última etapa y queda estampada, sola");
assert(!refB.fechaTerminada, "la referencia B, que sigue atrás en el flujo, no tiene fecha");

// calcPrendasTerminadasPorDia: pedido rápido cuenta su cantidad completa,
// pedido con cotización reparte por referencia, cancelado y sin fecha no cuentan.
state.pedidos = [
  pedPlanta, // sin cotización: cuenta p.cantidad (5) completa
  { id: "ped-planta-2", cotizacionId: "cot-planta", estado: "acabados", estadosDef: null, cantidad: "5" }, // con cotización: se ignora p.cantidad, cuenta por referencia
  { id: "ped-cancelado-planta", cotizacionId: "", estado: "entregado", estadosDef: null, cantidad: "99", fechaTerminado: hoyStr(), cancelado: true }
];
const porDiaHoy = calcMod.calcPrendasTerminadasPorDia(hoyStr(), hoyStr());
assert(porDiaHoy[hoyStr()] === 8, "cuenta 5 del pedido rápido + 3 de la referencia A ya terminada = 8; la referencia B (atrás) y el pedido cancelado no suman");
assert(!calcMod.calcPrendasTerminadasPorDia("2020-01-01", "2020-01-01")[hoyStr()], "y fuera del rango pedido no cuenta nada de hoy");

// ---------------------------------------------------------------------------
// Conflicto entre dispositivos: el usuario reportó que trabajar desde dos
// computadores distintos perdía cambios en silencio ("hice cambios en otro
// computador y no se guardaron"). Causa: cada guardado reescribía la clave
// ENTERA sin comprobar antes si alguien más ya la había cambiado — "el último
// que guarda gana", sin ningún aviso, porque desde el punto de vista de cada
// dispositivo su propia escritura sí tenía éxito. Fix: verificarConflicto()/
// fijarRevNueva() en core/store.js sellan una revisión por clave
// ("__rev__:<clave>", en la misma pestaña "kv") y la comparan, EN CALIENTE,
// justo antes de escribir de verdad.
// ---------------------------------------------------------------------------
await loadAll(); // primero se sincroniza con lo que haya de pruebas anteriores y fija revConocida["deudas"] contra eso
state.deudas = [{ id: "deuda-conflicto-1", concepto: "Original", monto: 100000, contraparte: "", fechaVencimiento: "", cuotas: "1", periodo: "mensual", diasPago: [] }];
await storeMod2.persist("deudas");
assert(guardadoMod.estadoGuardado().clavesConflicto.indexOf("deudas") === -1, "el primer guardado de la sesión para 'deudas' no se marca como conflicto");
const revTrasGuardar = await window.storage.get("__rev__:deudas");
assert(!!revTrasGuardar && !!revTrasGuardar.value, "tras guardar, queda sellada una revisión nueva para 'deudas'");

// Simula que OTRO dispositivo guardó "deudas" mientras tanto: cambia la
// revisión sellada en la Sheet sin que esta pestaña se entere.
await window.storage.set("__rev__:deudas", "otro-dispositivo:999", false);
state.deudas = state.deudas.concat([{ id: "deuda-conflicto-2", concepto: "Agregada acá", monto: 50000, contraparte: "", fechaVencimiento: "", cuotas: "1", periodo: "mensual", diasPago: [] }]);
await storeMod2.persist("deudas");
const gConflicto = guardadoMod.estadoGuardado();
assert(gConflicto.clavesConflicto.indexOf("deudas") !== -1, "si la revisión en la Sheet cambió desde otro lado, el guardado se marca como CONFLICTO, no como fallo de red genérico");
const filaDeudasTrasConflicto = await window.storage.get(constantsMod.KEYS.deudas);
const deudasEnSheetTrasConflicto = JSON.parse(filaDeudasTrasConflicto.value);
assert(deudasEnSheetTrasConflicto.length === 1 && deudasEnSheetTrasConflicto[0].id === "deuda-conflicto-1", "y NO se sobrescribe lo que había en la Sheet: la 'deuda-conflicto-2' de este dispositivo no se escribe encima de lo del otro");

render();
const bannerConflicto = document.querySelector(".aviso-barra.malo");
assert(!!bannerConflicto && bannerConflicto.textContent.indexOf("Alguien más guardó") !== -1, "el aviso en pantalla explica que fue otro dispositivo, no un problema de red");
assert(!!document.querySelector('[data-action="recargar-pagina"]'), 'y ofrece recargar la página en vez de "reintentar", que no arreglaría nada');

// El reintento automático NO debe insistir solo en un conflicto (repetiría el
// mismo choque para siempre, sin arreglar nada, hasta que se recargue).
const setCallsDuranteReintento = [];
const origSetConflicto = window.storage.set;
window.storage.set = async function (key, value, arg2) { setCallsDuranteReintento.push(key); return origSetConflicto(key, value, arg2); };
await guardadoMod.reintentarPendientes();
window.storage.set = origSetConflicto;
assert(setCallsDuranteReintento.indexOf(constantsMod.KEYS.deudas) === -1, "reintentarPendientes() no vuelve a intentar escribir sola una clave marcada como conflicto");

// "Recargar la página" (acá: volver a cargar) resuelve el conflicto: la
// próxima carga trae lo más reciente y sella una base fresca.
state.deudas = [];
await loadAll();
assert(state.deudas.length === 1 && state.deudas[0].id === "deuda-conflicto-1", 'al recargar, se trae lo que de verdad quedó guardado (lo del otro dispositivo), listo para ofrecerse en "Restaurar"');
await storeMod2.persist("deudas");
assert(guardadoMod.estadoGuardado().clavesConflicto.indexOf("deudas") === -1, "y con una base fresca, el siguiente guardado ya no choca");
state.recuperacion = null;

// ---------------------------------------------------------------------------
// Ronda de 6 pedidos del usuario (2026-09-04): duplicar pedidos, reordenar
// insumos por arrastre, notas como bloc de notas, distintivo en contactos e
// importar desde los Contactos de Google. ("Comisiones pendientes en Cuentas
// por pagar" ya existía — ver calcSaldosVendedores/calcSaldosConsignacion —
// y no necesitó cambios.)
// ---------------------------------------------------------------------------

// ---------- Duplicar pedido ----------
loginComo("admin", "", "admin@taller.test");
state.pedidos = [{
  id: "ped-dup-1", numeroOp: "OP-9001", cliente: "Cliente Original", tipoCliente: "propio",
  descripcion: "Camisetas", cantidad: "3", total: 90000, costo: 60000, abono: 0, abonos: [],
  fechaEntrega: "", fechaCreacion: hoyStr(), estado: "nuevo", estadosDef: null,
  lineas: [{ id: "lin-1", tipo: "libre", productoId: "", productoNombre: "Camiseta", imagenUrl: "", talla: "M", cantidad: 3, precioUnitario: 30000, costoUnitario: 20000, observacion: "", campos: [] }],
  stockConsumido: [], vendedor: { nombre: "Vendedor X", tipo: "porcentaje", valor: 10, estado: "pendiente" },
  consignacion: null, sinFlujoProduccion: false, codigoPublico: "abcde", calendarEventId: ""
}];
state.cotizaciones = [];
state.pedidosVista = "historial";
state.filtroPedidosVista = "activos";
state.tab = "pedidos";
render();
click('[data-action="duplicar-pedido"][data-id="ped-dup-1"]');
assert(state.pedidosVista === "nueva", "duplicar-pedido lleva al formulario de \"Nuevo pedido rápido\"");
assert(state.formPedido.cliente === "" && state.formPedido.clienteId === "", "...con el cliente en blanco, listo para elegir uno nuevo");
assert(state.formPedido.lineas.length === 1 && state.formPedido.lineas[0].productoNombre === "Camiseta", "...con las mismas líneas copiadas");
assert(state.formPedido.lineas[0].id !== "lin-1", "...pero cada línea con un id nuevo, no el mismo objeto del pedido original");
assert(state.formPedido.vendedorNombre === "Vendedor X", "...y el mismo vendedor de referencia (se puede cambiar antes de confirmar)");
assert(!state.formPedido.esConsignacion, "...nunca como consignación, aunque el pedido original lo fuera");
assert(state.pedidoFormDuplicado === true, "...y queda marcado como formulario duplicado (solo ahí se recoge la base detrás de 'Opciones avanzadas')");
render();
assert(!!document.querySelector('[data-action="toggle-pedido-opciones-avanzadas"]'), "el formulario recién duplicado muestra el colapsable de 'Opciones avanzadas'");
// La línea duplicada ("Camiseta") ya trae datos válidos, no hace falta agregar
// otra — solo falta el cliente, que es justo lo que reportó el usuario: al
// duplicar (típicamente porque OTRO cliente pidió lo mismo) el campo de
// cliente no ofrecía nada para elegirlo. Se prueba con "usar cliente nuevo"
// (no un contacto ya registrado) porque ese es el caso de uso real de duplicar.
click('[data-action="abrir-cliente-picker-pedido"]');
setInput("#inp-cliente-picker-buscar", "Cliente Nuevo Dup");
render(); // data-live-filter debounce; el estado ya quedó actualizado, solo falta repintar
click('[data-action="usar-cliente-nuevo-pedido"]');
assert(state.formPedido.cliente === "Cliente Nuevo Dup" && state.formPedido.clienteId === "", "\"usar cliente nuevo\" deja el nombre libre sin atarlo a un contacto registrado");
assert(!state.clientePickerAbierto, "y cierra el buscador solo");
click('[data-action="add-pedido"]');
assert(state.pedidoFormDuplicado === false, "al crear el pedido de verdad, se apaga la marca de 'duplicado' — el próximo formulario en blanco vuelve a ser el normal");

// Duplicar un pedido que VIENE de una cotización: p.lineas no tiene el
// detalle real (insumos, tallas) — hay que duplicar la cotización completa,
// no solo el formulario de pedido rápido, o la copia queda vacía de contenido.
state.cotizaciones = [{
  id: "cot-origen-dup", clienteId: "cli-original", cliente: "Cliente Original", descripcion: "Uniformes", fecha: hoyStr(),
  estado: "convertida", pedidoId: "ped-dup-2", referencias: [{
    id: "ref-origen-dup", nombre: "Camiseta", origen: "taller", consumoAprox: 1, cantidadPedida: 5, precioVenta: 40000,
    insumos: [{ id: "ins-origen-dup", nombre: "Tela", unidad: "MT", costo: 8000, tipo: "por_prenda", cantidad: 1 }],
    detalle: [], costoCompra: 0, proveedorId: ""
  }],
  gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: { nombre: "Vendedor Y", tipo: "porcentaje", valor: 8, estado: "pendiente" },
  codigoPublico: "cotorigdup"
}];
state.pedidos = [{
  id: "ped-dup-2", numeroOp: "OP-9002", cliente: "Cliente Original", tipoCliente: "propio",
  descripcion: "Uniformes", cantidad: "5", total: 200000, costo: 40000, abono: 0, abonos: [],
  fechaEntrega: "", fechaCreacion: hoyStr(), estado: "nuevo", estadosDef: null,
  cotizacionId: "cot-origen-dup", lineas: [], stockConsumido: [], vendedor: { nombre: "Vendedor Y", tipo: "porcentaje", valor: 8, estado: "pendiente" },
  consignacion: null, sinFlujoProduccion: false, codigoPublico: "peddup2", calendarEventId: ""
}];
state.pedidosVista = "historial";
state.tab = "pedidos";
render();
click('[data-action="duplicar-pedido"][data-id="ped-dup-2"]');
assert(state.tab === "cotizaciones", "duplicar un pedido con cotización de origen lleva a Cotizaciones, no al formulario de pedido rápido");
const cotDuplicada = state.cotizaciones.find(c => c.id === state.cotizacionEditando);
assert(!!cotDuplicada && cotDuplicada.id !== "cot-origen-dup", "se creó una cotización nueva (id distinto de la original)");
assert(cotDuplicada.estado === "borrador", "la copia nace en borrador, no 'convertida' como la original");
assert(!cotDuplicada.pedidoId && !cotDuplicada.pedidoOrigenId, "...y sin vínculo a ningún pedido (ni origen ni destino)");
assert(cotDuplicada.cliente === "" && cotDuplicada.clienteId === "", "...con el cliente en blanco, para elegir uno nuevo");
assert(cotDuplicada.referencias.length === 1 && cotDuplicada.referencias[0].nombre === "Camiseta", "...con las mismas referencias");
assert(cotDuplicada.referencias[0].id !== "ref-origen-dup", "...pero con id nuevo para la referencia");
assert(cotDuplicada.referencias[0].insumos[0].nombre === "Tela" && cotDuplicada.referencias[0].insumos[0].id !== "ins-origen-dup", "...y el insumo real copiado, con su propio id nuevo (esto es justo lo que se perdía duplicando solo p.lineas)");
assert(state.cotizaciones.some(c => c.id === "cot-origen-dup"), "la cotización ORIGINAL sigue intacta, no se modificó ni se movió");
assert(cotDuplicada.compras.length === 0 && !cotDuplicada.estimadoTxId, "el duplicado nace SIN historial de compras/movimientos reales — todavía no ha comprado ni pagado nada (es de OTRO cliente)");

// ---------------------------------------------------------------------------
// El usuario reportó: "cuando duplico un pedido y quiero registrar los
// movimientos, a pesar de ser los mismos movimientos pero de diferente
// pedido se están sobreescribiendo en el historial de finanzas... tiene que
// poderse registrar el movimiento ya que es de un pedido diferente a pesar
// de tener los mismos datos, pero son de diferente cliente".
//
// Causa real: duplicarCotizacionCompleta SÍ limpia compras/estimadoTxId
// ahora (arriba), pero cualquier cotización que el usuario ya hubiera
// duplicado ANTES de este fix pudo quedar con un txId heredado del
// ORIGINAL — se simula ese escenario a mano para probar la segunda capa de
// protección: sincronizar-compras-finanzas ignora un txId que en realidad
// pertenece a OTRA cotización, en vez de reescribir su movimiento.
// ---------------------------------------------------------------------------
state.cotizacionEditando = "cot-origen-dup";
state.cotTabActiva = Object.assign({}, state.cotTabActiva, { "cot-origen-dup": "produccion" });
render();
var claveTelaOrigen = document.querySelector('select[data-cot="cot-origen-dup"][data-campo="estado"]').getAttribute("data-clave");
setChange('[data-cot="cot-origen-dup"][data-clave="' + claveTelaOrigen + '"][data-campo="costoReal"]', "40000");
setChange('[data-cot="cot-origen-dup"][data-clave="' + claveTelaOrigen + '"][data-campo="estado"]', "si");
click('[data-action="sincronizar-compras-finanzas"][data-id="cot-origen-dup"]');
var cotOrigenTrasSync = state.cotizaciones.find(c => c.id === "cot-origen-dup");
var txIdOriginal = cotOrigenTrasSync.compras[0].txId;
assert(!!txIdOriginal, "sanity: el pedido ORIGINAL sí registró su movimiento real en Finanzas");
var txOriginal = state.tx.find(t => t.id === txIdOriginal);
assert(txOriginal.cotizacionId === "cot-origen-dup" && txOriginal.monto === 40000, "sanity: ese movimiento le pertenece a la cotización ORIGINAL");

// Se simula el bug: el duplicado "hereda" (a mano, como haría un JSON.parse/
// stringify sin limpiar) el mismo txId del original para la misma línea.
state.cotizaciones = state.cotizaciones.map(c => c.id === cotDuplicada.id
  ? Object.assign({}, c, { compras: [{ clave: claveTelaOrigen, estado: "si", costoReal: 40000, txId: txIdOriginal }] })
  : c);
state.cotizacionEditando = cotDuplicada.id;
state.cotTabActiva = Object.assign({}, state.cotTabActiva, { [cotDuplicada.id]: "produccion" });
render();
var txsAntesDeSincronizarDuplicado = state.tx.length;
click('[data-action="sincronizar-compras-finanzas"][data-id="' + cotDuplicada.id + '"]');
assert(state.tx.length === txsAntesDeSincronizarDuplicado + 1, "sincronizar desde el DUPLICADO crea un movimiento NUEVO — no reutiliza el txId heredado, aunque apunte a un tx que sí existe");
var txOriginalTrasSync = state.tx.find(t => t.id === txIdOriginal);
assert(txOriginalTrasSync.cotizacionId === "cot-origen-dup" && txOriginalTrasSync.monto === 40000, "...y el movimiento del ORIGINAL queda intacto — no se sobreescribió con los datos del duplicado");
var cotDuplicadaTrasSync = state.cotizaciones.find(c => c.id === cotDuplicada.id);
var txIdDuplicado = cotDuplicadaTrasSync.compras[0].txId;
assert(!!txIdDuplicado && txIdDuplicado !== txIdOriginal, "el duplicado queda apuntando a SU PROPIO movimiento nuevo, distinto del original");
assert(state.tx.find(t => t.id === txIdDuplicado).cotizacionId === cotDuplicada.id, "...correctamente vinculado a la cotización del duplicado, no a la del original");
assert(movimientosGeneradosPorCotizacion(cotOrigenTrasSync).every(t => t.cotizacionId === "cot-origen-dup"), "movimientosGeneradosPorCotizacion (usado al ELIMINAR una cotización) tampoco confunde un txId ajeno con uno propio");

// ---------- Distintivo en contactos ----------
state.clientes = [];
state.formCliente = Object.assign({}, state.formCliente, { nombre: "Juan Pérez", distintivo: "Equipo Fenix" });
state.clientesVista = "nueva";
state.tab = "clientes";
render();
click('[data-action="add-cliente"]');
var juanCreado = state.clientes.filter(function (c) { return c.nombre === "Juan Pérez"; })[0];
assert(!!juanCreado && juanCreado.distintivo === "Equipo Fenix", "add-cliente guarda el distintivo junto con el resto del contacto");
state.clientesVista = "contactos";
render();
var cardHtml = document.querySelector(".cliente-card").outerHTML;
assert(cardHtml.indexOf("Equipo Fenix") !== -1, "el distintivo se muestra junto al nombre en la tarjeta del contacto");
state.filtroClientes = "fenix";
render();
assert(document.querySelectorAll(".cliente-card").length === 1, "buscar por el distintivo también encuentra el contacto");
state.filtroClientes = "";

// ---------- Notas como bloc de notas (título + párrafo + tarjetas) ----------
state.pendientes = [];
state.formPend = { titulo: "Compras pendientes", texto: "Primera línea\nSegunda línea, más larga todavía", categoria: "tarea", prioridad: "media", fecha: "", hora: "" };
state.tab = "notas";
render();
assert(!!document.querySelector(".nota-form-titulo") && !!document.querySelector(".nota-form-parrafo"), "el formulario tiene un campo de título y un párrafo grande dedicado, no un solo campo de descripción");
click('[data-action="add-pend"]');
assert(state.pendientes.length === 1 && state.pendientes[0].texto.indexOf("\n") !== -1, "una nota guarda texto de varias líneas, no solo una tarea corta");
assert(state.pendientes[0].titulo === "Compras pendientes", "y guarda el título por separado del párrafo");
render();
assert(!!document.querySelector(".notas-grid"), "las notas se guardan como tarjetas en grilla, no como filas de lista");
var cardHtmlNota = document.querySelector(".nota-card").outerHTML;
assert(cardHtmlNota.indexOf("Compras pendientes") !== -1, "la tarjeta muestra el título");
assert(document.querySelector(".nota-card-texto").textContent.indexOf("Segunda línea") !== -1, "y el párrafo completo, sin truncar");
var notaId = state.pendientes[0].id;
click('[data-action="editar-pend"][data-id="' + notaId + '"]');
assert(state.pendEditando === notaId, "editar-pend entra en modo edición explícito");
render();
var textareaNota = document.querySelector('[data-pend-edit-row="' + notaId + '"] textarea');
assert(!!textareaNota, "el modo edición muestra un textarea (no un input de una sola línea)");
var tituloEdit = document.querySelector('[data-pend-edit-row="' + notaId + '"] [data-role="edit-titulo"]');
assert(!!tituloEdit, "y también un campo para editar el título");
tituloEdit.value = "Título editado";
textareaNota.value = "Texto reescrito por completo";
click('[data-action="guardar-pend-edit"][data-id="' + notaId + '"]');
assert(state.pendientes[0].texto === "Texto reescrito por completo", "guardar-pend-edit reemplaza el texto de la nota");
assert(state.pendientes[0].titulo === "Título editado", "...y también el título");
assert(state.pendEditando === "", "y cierra el modo edición al guardar");

// ---------- Reordenar insumos de una referencia (arrastrar y soltar) ----------
var cotizacionesMod = await import("../js/modules/cotizaciones.js");
state.cotizaciones = [{
  id: "cot-reorder-1", clienteId: "", cliente: "Cliente Reorder", descripcion: "d", fecha: hoyStr(),
  estado: "borrador", referencias: [{
    id: "ref-reorder-1", nombre: "Camiseta", origen: "taller", consumoAprox: 1, cantidadPedida: 1, precioVenta: 0,
    insumos: [
      { id: "ins-A", nombre: "Tela", unidad: "MT", costo: 1000, tipo: "por_prenda", cantidad: 1 },
      { id: "ins-B", nombre: "Hilo", unidad: "UND", costo: 500, tipo: "por_prenda", cantidad: 1 },
      { id: "ins-C", nombre: "Botón", unidad: "UND", costo: 200, tipo: "por_prenda", cantidad: 4 }
    ],
    detalle: [], costoCompra: 0, proveedorId: ""
  }],
  gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "xyz"
}];
state.cotSucia = "";
state.cotizacionEditando = "cot-reorder-1";
cotizacionesMod.reordenarInsumos("cot-reorder-1", "ref-reorder-1", ["ins-C", "ins-A", "ins-B"]);
var ordenTrasArrastre = state.cotizaciones[0].referencias[0].insumos.map(function (i) { return i.id; });
assert(ordenTrasArrastre.join(",") === "ins-C,ins-A,ins-B", "reordenarInsumos aplica el nuevo orden leído del DOM tras soltar (SortableJS)");
// El usuario reportó: reordenar insumos no debería encender el dock de "sin
// guardar" — es puramente visual, no afecta ningún costo/cantidad/total de
// la cotización, así que se guarda solo en vez de pedir confirmación.
assert(state.cotSucia === "", "reordenar insumos NO marca la cotización como \"sin guardar\" — se guarda solo, sin pedir confirmación");
assert(!!state.cotSnapshot && state.cotSnapshot.referencias[0].insumos.map(function (i) { return i.id; }).join(",") === "ins-C,ins-A,ins-B", "...y el nuevo punto de \"Descartar\" ya incluye este orden (quedó guardado de verdad, no solo en pantalla)");
cotizacionesMod.reordenarInsumos("cot-reorder-1", "ref-reorder-1", ["ins-C", "ins-A", "ins-B"]);
assert(state.cotizaciones[0].referencias[0].insumos.map(function (i) { return i.id; }).join(",") === "ins-C,ins-A,ins-B", "aplicar el mismo orden de nuevo no cambia nada");
// Excepción: si YA había otra edición sin confirmar en esta misma
// cotización, reordenar no se auto-guarda — eso arrastraría esa otra edición
// sin que el usuario la haya confirmado con "Guardar".
state.cotizaciones[0].descripcion = "Editado a mano, todavía sin guardar";
state.cotSucia = "cot-reorder-1";
cotizacionesMod.reordenarInsumos("cot-reorder-1", "ref-reorder-1", ["ins-B", "ins-A", "ins-C"]);
assert(state.cotSucia === "cot-reorder-1", "si ya había otra edición pendiente en la misma cotización, reordenar NO se auto-guarda — se suma a lo ya pendiente de confirmar");
state.cotSucia = "";
state.cotizacionEditando = "";

// ---------- Reordenar insumos de una PLANTILLA (mismo mecanismo que
// Cotizaciones, sin referencias de por medio — el usuario pidió "poder
// también arrastrar los insumos para reorganizarlos, en el apartado de
// plantillas, así como se hace en cotizaciones") ----------
var plantillasMod = await import("../js/modules/plantillas.js");
state.plantillasPrendas = [{
  id: "pla-reorder-1", nombre: "Plantilla reorder", categoria: "", consumoSugerido: "", flujoEstadosId: "", imagenUrl: "",
  insumos: [
    { id: "plains-A", nombre: "Tela", unidad: "MT", costo: 1000, tipo: "por_prenda", cantidad: 1 },
    { id: "plains-B", nombre: "Hilo", unidad: "UND", costo: 500, tipo: "por_prenda", cantidad: 1 },
    { id: "plains-C", nombre: "Botón", unidad: "UND", costo: 200, tipo: "por_prenda", cantidad: 4 }
  ]
}];
state.tab = "plantillas";
state.plantillasVista = "plantillas";
state.plantillaEditando = "pla-reorder-1";
render();
assert(!!document.querySelector('.ins-row[data-ins-row][data-pla="pla-reorder-1"][data-ins="plains-A"] .ins-drag-handle'), "cada fila de insumo de una plantilla trae el mismo manijo de arrastre (⠿) que Cotizaciones");
plantillasMod.reordenarInsumosPlantilla("pla-reorder-1", ["plains-C", "plains-A", "plains-B"]);
assert(state.plantillasPrendas[0].insumos.map(function (i) { return i.id; }).join(",") === "plains-C,plains-A,plains-B", "reordenarInsumosPlantilla aplica el nuevo orden leído del DOM tras soltar, igual que en Cotizaciones");
plantillasMod.reordenarInsumosPlantilla("pla-reorder-1", ["plains-C", "plains-A", "plains-B"]);
assert(state.plantillasPrendas[0].insumos.map(function (i) { return i.id; }).join(",") === "plains-C,plains-A,plains-B", "aplicar el mismo orden de nuevo no cambia nada");
state.plantillaEditando = "";

// ---------- Buscador de cliente en Cotizaciones (ya no es texto libre) ----------
// El usuario aclaró: una cotización SIEMPRE es de un contacto real ya
// registrado (nombre, cédula, dirección van al PDF) — a diferencia de
// Pedidos, donde "cliente libre" tiene sentido para una venta rápida e
// informal. Pedidos usa el MISMO buscador (ver bloque más abajo), pero con
// permitirNuevo:true — ahí sí se ofrece "usar cliente nuevo" cuando no hay
// coincidencia con ningún contacto registrado.
state.tab = "cotizaciones";
state.cotizacionesVista = "nueva";
state.cotizacionEditando = "";
state.clientePickerAbierto = false;
state.clientePickerBusqueda = "";
state.clientes = [
  { id: "cli-pick-1", nombre: "Ana Torres", tipoRelacion: "cliente", cedula: "111", ciudad: "Cali", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] },
  { id: "cli-pick-2", nombre: "Carlos Ruiz", tipoRelacion: "cliente", cedula: "222", ciudad: "Cali", distintivo: "Equipo Fenix", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] },
  { id: "cli-pick-3", nombre: "Distribuidora Textil", tipoRelacion: "proveedor", cedula: "333", ciudad: "Cali", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] }
];
state.formCotizacion = { clienteId: "", cliente: "", descripcion: "", fecha: hoyStr(), fechaEntrega: "" };
render();
assert(!document.querySelector('[data-form="cotizacion"][data-field="cliente"]'), "el cliente de una cotización ya no es un campo de texto libre");
assert(!!document.querySelector('[data-action="abrir-cliente-picker-cotizacion"]'), "...sino un botón que abre el buscador de contactos");
assert(document.querySelector('[data-action="add-cotizacion"]').disabled, "sin cliente elegido, \"Crear cotización\" queda deshabilitado");
click('[data-action="abrir-cliente-picker-cotizacion"]');
assert(!!document.querySelector(".picker-overlay"), "el buscador se abre");
assert(document.querySelectorAll('[data-action="seleccionar-cliente-picker-cotizacion"]').length === 2, "lista los contactos que SÍ son clientes (2), sin el proveedor");
setInput("#inp-cliente-picker-buscar", "fenix");
render(); // data-live-filter debounce; el estado ya quedó actualizado, solo falta repintar
assert(document.querySelectorAll('[data-action="seleccionar-cliente-picker-cotizacion"]').length === 1, "el buscador también filtra por el distintivo del contacto");
click('[data-action="seleccionar-cliente-picker-cotizacion"][data-id="cli-pick-2"]');
assert(state.formCotizacion.clienteId === "cli-pick-2" && state.formCotizacion.cliente === "Carlos Ruiz", "elegir un contacto vincula clienteId Y copia el nombre");
assert(!state.clientePickerAbierto, "y cierra el buscador solo");
render();
assert(!document.querySelector('[data-action="add-cotizacion"]').disabled, "con un cliente ya elegido, \"Crear cotización\" se habilita");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Uniformes Fenix");
click('[data-action="add-cotizacion"]');
assert(state.cotizaciones.some(function (c) { return c.clienteId === "cli-pick-2" && c.cliente === "Carlos Ruiz"; }), "la cotización se crea con el cliente elegido en el buscador");
state.cotizacionEditando = "";

// ---------- Mismo buscador en Pedidos, CON la puerta de "cliente nuevo" ----------
state.tab = "pedidos";
state.pedidosVista = "nueva";
state.clientePickerAbierto = false;
state.clientePickerBusqueda = "";
state.formPedido = { clienteId: "", cliente: "", tipoCliente: "propio", abono: "", fechaEntrega: "", vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "", conFlujoProduccion: true, esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "", lineas: [] };
render();
assert(!document.querySelector('[data-form="pedido"][data-field="cliente"]'), "en Pedidos el cliente tampoco es ya un campo de texto libre");
click('[data-action="abrir-cliente-picker-pedido"]');
assert(!!document.querySelector(".picker-overlay"), "el mismo buscador se abre en Pedidos");
assert(!document.querySelector('[data-action="usar-cliente-nuevo-pedido"]'), "sin nada escrito en la búsqueda, no se ofrece \"usar cliente nuevo\" todavía");
setInput("#inp-cliente-picker-buscar", "Carlos");
render();
assert(document.querySelectorAll('[data-action="seleccionar-cliente-picker-pedido"]').length === 1, "encuentra el contacto real que coincide");
assert(!document.querySelector('[data-action="usar-cliente-nuevo-pedido"]'), "y como SÍ hay coincidencia, tampoco se ofrece crear uno nuevo (evita duplicar el mismo contacto por error)");
setInput("#inp-cliente-picker-buscar", "Nadie Registrado Aún");
render();
assert(document.querySelectorAll('[data-action="seleccionar-cliente-picker-pedido"]').length === 0, "sin coincidencias entre los contactos reales");
assert(!!document.querySelector('[data-action="usar-cliente-nuevo-pedido"]'), "acá sí aparece la puerta de \"usar cliente nuevo\" — Pedidos admite ventas informales, a diferencia de Cotizaciones");
click('[data-action="usar-cliente-nuevo-pedido"]');
assert(state.formPedido.cliente === "Nadie Registrado Aún" && state.formPedido.clienteId === "", "\"usar cliente nuevo\" copia el texto buscado como cliente libre, sin clienteId");
assert(!state.clientePickerAbierto, "y cierra el buscador solo");

// ---------- Importar desde mis Contactos de Google ----------
state.clientes = [];
state.contactosGoogle = [{ resourceName: "people/c1", nombre: "María Gómez", telefono: "3001234567", correo: "maria@example.com" }];
state.panelImportarGoogleAbierto = true;
state.buscarContactosGoogleImportar = "";
state.clientesVista = "contactos";
state.tab = "clientes";
render();
assert(!!document.querySelector('[data-action="importar-contacto-google"][data-resource="people/c1"]'), "un contacto de Google todavía no importado aparece con su botón de importar");
click('[data-action="importar-contacto-google"][data-resource="people/c1"]');
assert(state.clientesVista === "nueva", "importar-contacto-google lleva al formulario de alta");
assert(state.formCliente.nombre === "María Gómez" && state.formCliente.telefono === "3001234567" && state.formCliente.correo === "maria@example.com", "...con nombre, teléfono y correo prellenados desde el contacto de Google");
// Contraprueba: uno YA importado (mismo resourceName que un cliente existente
// de esta cuenta) no debe volver a ofrecerse.
state.clientes = [{ id: "cli-ya-importado", nombre: "María Gómez", contactResourceNames: { "admin@taller.test": "people/c1" }, contactResourceName: "people/c1", tipoRelacion: "cliente" }];
state.clientesVista = "contactos";
render();
assert(!document.querySelector('[data-action="importar-contacto-google"][data-resource="people/c1"]'), "un contacto que ya es cliente de esta cuenta no se vuelve a ofrecer para importar");
state.panelImportarGoogleAbierto = false;
state.contactosGoogle = null;

// ---------------------------------------------------------------------------
// Navegación por teclado: el usuario reportó que Tab se sentía "tedioso" y
// dio el repro exacto — al salir de un campo con Tab, en vez de avanzar al
// siguiente, "se deselecciona" y aparece el aviso "Saltar al contenido".
// Causa real: un campo con data-action-change dispara su acción en "change"
// (el navegador lo lanza AL SALIR del campo, antes de terminar de mover el
// foco) — la acción llama a notify(), que reconstruye TODO el HTML de la
// pestaña. La restauración de foco de siempre solo funcionaba por id, y la
// enorme mayoría de los campos (como este) no tienen uno — se identifican
// por sus atributos data-*. Sin ningún elemento al que devolver el foco,
// quedaba en document.body; el SIGUIENTE Tab arrancaba desde el principio
// del documento, aterrizando en el enlace "Saltar al contenido" (el primer
// elemento tabulable de toda la página) en vez de seguir avanzando. Fix:
// selectorEstableParaFoco en core/dom.js arma un selector con esos mismos
// atributos data-* para restaurar el foco igual, sin id.
state.tab = "pedidos";
state.pedidosVista = "nueva";
state.formPedido = {
  clienteId: "", cliente: "Cliente Teclado", tipoCliente: "propio", abono: "", fechaEntrega: "",
  vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "", conFlujoProduccion: true,
  esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "",
  lineas: [{ id: "lin-teclado", tipo: "libre", productoId: "", productoNombre: "Arreglo", imagenUrl: "", talla: "", cantidad: 1, precioUnitario: 10000, costoUnitario: 5000, observacion: "", campos: [] }]
};
render();
const campoCantidad = document.querySelector('[data-action-change="set-pedido-linea-campo"][data-linea="lin-teclado"][data-campo="cantidad"]');
const campoPrecioAntes = document.querySelector('[data-action-change="set-pedido-linea-campo"][data-linea="lin-teclado"][data-campo="precioUnitario"]');
assert(!!campoCantidad && !campoCantidad.id, "sanity: el campo de cantidad de una línea no tiene id propio (es el caso típico, no la excepción)");
assert(!!campoPrecioAntes, "sanity: existe un campo siguiente (Precio x1) al que Tab debería avanzar");
campoCantidad.focus();
assert(document.activeElement === campoCantidad, "sanity: el campo queda enfocado antes de presionar Tab");
// Primero el keydown de Tab de verdad (fase de captura, ANTES que nada más
// — así es como se calcula a dónde iba, mientras el campo de origen todavía
// existe) y RECIÉN DESPUÉS el "change" que el navegador dispara al salir del
// campo — es el mismo orden real de eventos al tabular fuera de un input.
campoCantidad.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
campoCantidad.value = "3";
campoCantidad.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.formPedido.lineas[0].cantidad === 3, "sanity: el cambio sí se aplicó (dispara set-pedido-linea-campo → notify → render)");
assert(document.activeElement !== document.body, "tras Tab, el foco NO queda perdido en <body> (que es lo que hacía que el SIGUIENTE Tab aterrizara en \"Saltar al contenido\")");
assert(document.activeElement && document.activeElement.getAttribute("data-campo") === "precioUnitario", "y Tab de verdad AVANZA al siguiente campo (Precio x1) — no se queda ni vuelve al que se acaba de dejar, que es lo que reportó el usuario que seguía pasando");

// Contraprueba: un "change" SIN que Tab lo haya precedido (ej. el usuario
// hizo clic en otra parte, no tabuló) no tiene a dónde "avanzar" — se cae al
// respaldo de antes (mismo campo, por su selector data-*), que sigue siendo
// mejor que perder el foco en document.body.
const campoCosto = document.querySelector('[data-action-change="set-pedido-linea-campo"][data-linea="lin-teclado"][data-campo="costoUnitario"]');
campoCosto.focus();
campoCosto.value = "7000";
campoCosto.dispatchEvent(new dom.window.Event("change", { bubbles: true })); // sin keydown Tab antes
assert(document.activeElement !== document.body, "un 'change' sin Tab de por medio tampoco pierde el foco...");
assert(document.activeElement && document.activeElement.getAttribute("data-campo") === "costoUnitario", "...y sin un destino de Tab que seguir, se queda en el mismo campo (mejor que caer a document.body)");

// ---------------------------------------------------------------------------
// Flechas del teclado en el combo de "Unidad" (renderComboUnidad): el usuario
// notó que ESTE campo en particular no se manejaba con ↑/↓ "como las otras
// listas desplegables" de la app — esas son <select> nativos, que el
// navegador ya maneja solo. Este campo es un <input> de texto con un panel de
// sugerencias aparte (no un <select>), así que había que dárselo a mano —
// ver tecladoEnComboUnidad en core/teclado.js. El panel ahora vive SIEMPRE en
// el DOM y se muestra/oculta con el atributo nativo `hidden` (antes requería
// notify() — redibujar TODA la pestaña — para abrir o cerrar tres líneas de
// sugerencias, que el usuario sintió "poco fluido"), así que las pruebas de
// abierto/cerrado revisan `panel.hidden`, no si el nodo existe.
// ---------------------------------------------------------------------------
const productosPreviosFlecha = state.productos, plantillasPreviasFlecha = state.plantillasPrendas, cotizacionesPreviasFlecha = state.cotizaciones;
state.productos = []; state.plantillasPrendas = []; state.cotizaciones = [];
state.catalogoInsumos = [
  { id: "iu-flecha", nombre: "Cinta flecha", unidad: "MT", costo: 1000, tipo: "por_prenda", categoriaId: "", proveedorId: "" },
  { id: "iu-flecha-2", nombre: "Otro insumo", unidad: "ROLLO", costo: 500, tipo: "por_prenda", categoriaId: "", proveedorId: "" },
  { id: "iu-flecha-3", nombre: "Tercer insumo", unidad: "UND", costo: 500, tipo: "por_prenda", categoriaId: "", proveedorId: "" }
];
state.catalogoCategorias = [];
state.filtroCatalogoCategoria = "todos";
state.buscarCatalogo = "";
state.tab = "catalogo";
render();
const campoUnidad = document.getElementById("ins-unidad-iu-flecha");
assert(!!campoUnidad, "sanity: existe el campo de unidad del primer insumo");
const panelUnidad = campoUnidad.closest(".insumo-unidad-cell").querySelector(".combo-unidad-suggestions");
assert(!!panelUnidad && panelUnidad.hidden === true, "sanity: el panel de sugerencias ya vive en el DOM desde el primer render, pero arranca oculto");
campoUnidad.focus();
// Con el panel CERRADO, ←/→ tienen que seguir siendo el cursor de texto de
// siempre — el usuario probó justo esto y reportó "las flechas solo me
// permiten moverme entre los caracteres" (el primer intento solo cubría
// ↓/↑). Acá, con el panel cerrado, ESE comportamiento es el correcto: no se
// interceptan, para poder seguir corrigiendo a mano una unidad escrita.
let noInterceptada = tecla("ArrowRight");
assert(noInterceptada === true, "← /→ con el panel cerrado NO se interceptan (dispatchEvent devuelve true: nadie llamó preventDefault)");
assert(panelUnidad.hidden === true, "...y no abren el panel (a diferencia de ↓/↑)");
tecla("ArrowDown");
assert(panelUnidad.hidden === false, "↓ con el panel cerrado lo abre, igual que un <select> — sin pasar por notify() (fluido, cero redibujado)");
let itemActivo = panelUnidad.querySelector(".combo-item.activo");
assert(!!itemActivo && itemActivo.textContent === "MT", "...y resalta la primera sugerencia en orden alfabético (MT, ROLLO, UND)");
tecla("ArrowDown");
itemActivo = panelUnidad.querySelector(".combo-item.activo");
assert(itemActivo && itemActivo.textContent === "ROLLO", "↓ de nuevo mueve el resaltado a la siguiente sugerencia");
tecla("ArrowDown");
tecla("ArrowDown"); // ya en la última: una de más no debe dar la vuelta al principio
itemActivo = panelUnidad.querySelector(".combo-item.activo");
assert(itemActivo && itemActivo.textContent === "UND", "↓ se detiene en la última sugerencia, no da la vuelta (igual que un <select>)");
tecla("ArrowUp");
itemActivo = panelUnidad.querySelector(".combo-item.activo");
assert(itemActivo && itemActivo.textContent === "ROLLO", "↑ mueve el resaltado hacia atrás");
// Con el panel YA ABIERTO, las 4 flechas navegan — no solo ↑/↓ — para que se
// sienta igual sea cual sea la dirección que el usuario pruebe primero.
tecla("ArrowRight");
itemActivo = panelUnidad.querySelector(".combo-item.activo");
assert(itemActivo && itemActivo.textContent === "UND", "con el panel abierto, → se comporta como ↓ (siguiente)");
tecla("ArrowLeft");
itemActivo = panelUnidad.querySelector(".combo-item.activo");
assert(itemActivo && itemActivo.textContent === "ROLLO", "...y ← se comporta como ↑ (anterior)");
assert(document.getElementById("ins-unidad-iu-flecha") === campoUnidad, "sanity: navegar con las flechas nunca redibujó la pestaña (mismo nodo de siempre, no uno nuevo)");
tecla("Enter");
assert(panelUnidad.hidden === true, "Enter elige lo resaltado y cierra el panel");
assert(document.getElementById("ins-unidad-iu-flecha").value === "ROLLO", "...escribe la unidad elegida sobre el campo original");
assert(state.catalogoInsumos[0].unidad === "ROLLO", "...y el cambio queda guardado en el insumo (mismo camino que elegirlo con el mouse)");
assert(document.activeElement && document.activeElement.id === "ins-unidad-iu-flecha", "tras elegir con Enter, el foco se queda en el campo (no se pierde ni salta)");
// Escape cierra sin elegir nada.
// "Enter" (arriba) sí disparó un notify() real — set-cat-campo persiste y
// redibuja, como cualquier otro campo de esta fila — así que el panel de
// antes quedó en el árbol viejo; se vuelve a buscar el de verdad.
const panelUnidadTrasElegir = document.getElementById("ins-unidad-iu-flecha").closest(".insumo-unidad-cell").querySelector(".combo-unidad-suggestions");
tecla("ArrowDown");
assert(panelUnidadTrasElegir.hidden === false, "sanity: el panel vuelve a abrirse");
tecla("Escape");
assert(panelUnidadTrasElegir.hidden === true, "Escape cierra el panel");
assert(state.catalogoInsumos[0].unidad === "ROLLO", "...sin haber cambiado la unidad");
state.productos = productosPreviosFlecha; state.plantillasPrendas = plantillasPreviasFlecha; state.cotizaciones = cotizacionesPreviasFlecha;

// --- core/appIcon.js: el favicon/manifest de verdad sigue al "Icono del
// taller" que ya existe en Configuración → Marca (o el logo del sidebar),
// en vez de quedarse siempre en el archivo estático. Se prueba en su forma
// pura (mutar state.config + render()) porque no depende de ninguna acción
// nueva: reutiliza el mismo campo logoUrl de siempre. ---
state.config.logoUrl = "https://drive.google.com/uc?id=logo-de-prueba";
render();
assert(document.getElementById("link-favicon-32").getAttribute("href") === "https://drive.google.com/uc?id=logo-de-prueba", "una imagen en 'Icono del taller' se aplica directo al favicon de 32px");
assert(document.getElementById("link-favicon-16").getAttribute("href") === "https://drive.google.com/uc?id=logo-de-prueba", "...también al de 16px");
assert(document.getElementById("link-apple-touch-icon").getAttribute("href") === "https://drive.google.com/uc?id=logo-de-prueba", "...y al apple-touch-icon (lo único que iOS lee para 'Agregar a inicio')");
assert(document.getElementById("link-manifest").getAttribute("href") !== "manifest.json", "el manifest se reemplaza por uno armado en memoria con ese mismo logo (deja de apuntar al archivo estático)");
const hrefFaviconConLogo = document.getElementById("link-favicon-32").getAttribute("href");
render();
assert(document.getElementById("link-favicon-32").getAttribute("href") === hrefFaviconConLogo, "volver a renderizar sin cambiar el logo no repite el trabajo (misma firma, no se recalcula)");
// Un emoji no es una URL de imagen: se dibuja a mano en un <canvas>. jsdom no
// trae soporte real de <canvas> (getContext('2d') da null) — el código debe
// notar eso y no romper el render, simplemente no tener nada que aplicar.
state.config.logoUrl = "🧵";
render();
assert(!state.lastError, "un emoji como ícono no rompe el render aunque este entorno de pruebas no pueda dibujar en <canvas>");
assert(document.getElementById("link-favicon-32").getAttribute("href") === hrefFaviconConLogo, "...y sin <canvas> disponible, deja el último favicon aplicado tal cual (no lo deja a medias ni lo borra)");
// Quitar el logo (botón ✕ de la miniatura, ver "quitar-logo" en modules/config.js)
// debe devolver el favicon/manifest al de fábrica, no dejar pegado el último aplicado.
state.config.logoUrl = "";
render();
assert(document.getElementById("link-favicon-32").getAttribute("href") === "icons/favicon-32.png", "quitar el logo devuelve el favicon de 32px al archivo de fábrica");
assert(document.getElementById("link-manifest").getAttribute("href") === "manifest.json", "...y el manifest vuelve a apuntar al archivo estático, no se queda con el Blob URL del logo ya quitado");

// --- core/dom.js: restaurar el foco tras un render NO puede saltar a un
// botón vecino solo porque comparte data-cot+data-ref (el usuario reportó
// "presiono click y me sube, me manda al inicio, en muchas áreas"). En la
// tarjeta de una referencia, "📂 Insumos predeterminados…"
// (abrir-insumo-picker) y "+ Insumo personalizado" (add-insumo-
// personalizado) NO tienen ningún atributo propio de fila — los dos se
// identifican SOLO por data-cot+data-ref, que comparten. (Antes de
// 2026-09-21 el par de ejemplo era "🧵 Se fabrica en el taller"
// (set-ref-origen) vs "+ Insumo personalizado" — ese primer botón ya no
// existe, la referencia perdió su interruptor de origen, pero el mismo
// riesgo de ambigüedad sigue vivo entre estos otros dos.)
// selectorEstableParaFoco() debe notar que ese selector es ambiguo
// (matchea a los dos) y NO restaurar por él, en vez de devolver el primero
// que aparece en el documento como si fuera el que en verdad se clicó. ---
state.tab = "cotizaciones";
state.cotizacionesVista = "nueva";
state.cotizacionEditando = "";
render();
elegirClienteCotizacion("Cliente Foco Ambiguo");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Prueba de foco ambiguo");
click('[data-action="add-cotizacion"]');
const cotFocoId = state.cotizaciones[0].id;
const refFocoId = state.cotizaciones[0].referencias[0].id;
const selectorCompartido = 'button[data-cot="' + cotFocoId + '"][data-ref="' + refFocoId + '"]';
assert(document.querySelectorAll(selectorCompartido).length > 1, "sanity: varios botones de la tarjeta comparten data-cot+data-ref sin nada más que los distinga");
const botonInsumoPicker = document.querySelector('[data-action="abrir-insumo-picker"][data-cot="' + cotFocoId + '"][data-ref="' + refFocoId + '"]');
const botonInsumoPersonalizado = document.querySelector('[data-action="add-insumo-personalizado"][data-cot="' + cotFocoId + '"][data-ref="' + refFocoId + '"]');
assert(!!botonInsumoPicker && !!botonInsumoPersonalizado && botonInsumoPicker !== botonInsumoPersonalizado, "sanity: son dos botones DISTINTOS que comparten data-cot+data-ref");
botonInsumoPersonalizado.focus();
click('[data-action="add-insumo-personalizado"][data-cot="' + cotFocoId + '"][data-ref="' + refFocoId + '"]');
assert((document.activeElement && document.activeElement.getAttribute("data-action")) !== "abrir-insumo-picker", "clicar 'Insumo personalizado' NO deja el foco saltando al botón vecino, solo porque los dos comparten data-cot+data-ref");

// --- Respaldo (core/backup.js): si falla, "Respaldar ahora" tiene que
// avisar con el motivo real, no tragárselo en silencio. Antes de esto,
// respaldarSiCorresponde() atrapaba CUALQUIER error internamente (solo
// console.error) sin importar si venía del chequeo automático al abrir la
// app o de este clic manual — así que un respaldo roto podía llevar
// meses fallando sin que nadie, ni siquiera alguien que apretara el botón
// a propósito para confirmar que funcionaba, se enterara (ver incidente
// 2026-09 en el README). Se mockea global.fetch (nunca se mockea en el
// resto de esta suite — las demás pruebas con sesión simulada golpean la
// red real y fallan solas con un 401, ver el comentario junto a
// process.exit) para forzar un fallo determinístico de Drive.
loginComo("admin", "", "admin-respaldo-test@taller.test");
const configModRespaldo = await import("../js/modules/config.js");
const fetchOriginalRespaldo = global.fetch;
global.fetch = async function () {
  return {
    ok: false,
    status: 403,
    text: async function () { return '{"error":{"message":"insufficient permissions"}}'; }
  };
};
const alertOriginalRespaldo = global.alert;
let alertMsgRespaldo = null;
global.window.alert = global.alert = function (msg) { alertMsgRespaldo = msg; };
await configModRespaldo.actions["respaldar-ahora"]();
assert(!!alertMsgRespaldo && alertMsgRespaldo.indexOf("No se pudo hacer el respaldo") !== -1, "si el respaldo falla, 'Respaldar ahora' avisa con el motivo (antes se tragaba el error en silencio, sin que nadie se enterara)");
assert(alertMsgRespaldo.indexOf("403") !== -1, "...y el aviso trae el error real de la API, no un mensaje genérico");
global.window.alert = global.alert = alertOriginalRespaldo;
global.fetch = fetchOriginalRespaldo;

// --- Mismo patrón, pero en la carpeta de RESPALDOS (backupFolderId): si
// quedó apuntando a una carpeta ya borrada, el respaldo tiene que
// auto-repararse igual que la carpeta de imágenes (ver el bloque de
// abajo) — se olvida el id muerto, recrea la carpeta y reintenta, en vez
// de fallar cada 24h para siempre sin que "Respaldar ahora" pueda arreglarlo.
const folderIdViejoBackup = "carpeta-respaldos-vieja-test";
state.config.backupFolderId = folderIdViejoBackup;
state.config.ultimoBackupISO = "";
let copiaIntentadaTest = false;
const fetchOriginalBackupCarpeta = global.fetch;
global.fetch = async function (url, options) {
  var u = String(url);
  var metodo = (options && options.method) || "GET";
  if (u.indexOf("/copy") !== -1) {
    if (!copiaIntentadaTest) {
      copiaIntentadaTest = true;
      return { ok: false, status: 404, text: async function () { return "File not found: " + folderIdViejoBackup + "."; } };
    }
    return { ok: true, status: 200, json: async function () { return { id: "sheet-copia-test" }; } };
  }
  if (u.indexOf("fields=parents") !== -1) {
    return { ok: true, status: 200, json: async function () { return { parents: ["carpeta-padre-backup-test"] }; } };
  }
  if (u === "https://www.googleapis.com/drive/v3/files" && metodo === "POST") {
    return { ok: true, status: 200, json: async function () { return { id: "carpeta-respaldo-nueva-test" }; } };
  }
  return { ok: true, status: 200, json: async function () { return {}; } };
};
await configModRespaldo.actions["respaldar-ahora"]();
assert(state.config.backupFolderId === "carpeta-respaldo-nueva-test", "una carpeta de respaldos borrada también se auto-repara (mismo patrón que la carpeta de imágenes): se olvida el id muerto y se crea uno nuevo");
assert(!!state.config.ultimoBackupISO, "...y el respaldo SÍ termina completándose en el reintento, no se queda a medias");
global.fetch = fetchOriginalBackupCarpeta;

// --- Drive (core/drive.js): un config.driveFolderId cacheado que apunta a
// una carpeta ya borrada en Drive no debe dejar TODAS las subidas de
// imagen rotas para siempre — pasó de verdad (ver incidente 2026-09 en el
// README): un ID de carpeta viejo, guardado en una copia restaurada de la
// Sheet, ya no existía en Drive, y cada intento de subir una imagen
// fallaba con "File not found: <id>". subirImagenReferencia() ahora
// detecta ESE error puntual (404 con el id de la carpeta adentro del
// mensaje) y se auto-repara: olvida el id muerto, crea una carpeta nueva
// (mismo camino que la primera vez que alguien sube algo) y reintenta UNA
// vez, en vez de quedar rota para siempre.
loginComo("admin", "", "admin-drive-test@taller.test");
const driveMod = await import("../js/core/drive.js");
const folderIdViejoTest = "carpeta-vieja-borrada-test";
state.config.driveFolderId = folderIdViejoTest;
let subidaIntentadaTest = false;
const fetchOriginalDrive = global.fetch;
global.fetch = async function (url, options) {
  var u = String(url);
  var metodo = (options && options.method) || "GET";
  if (u.indexOf("/values/roles") !== -1) {
    return { ok: true, status: 200, json: async function () { return { values: [] }; } };
  }
  if (u.indexOf("/upload/drive/v3/files") !== -1) {
    if (!subidaIntentadaTest) {
      subidaIntentadaTest = true;
      return { ok: false, status: 404, text: async function () { return "File not found: " + folderIdViejoTest + "."; } };
    }
    return { ok: true, status: 200, json: async function () { return { id: "img-nueva-test" }; } };
  }
  if (u.indexOf("/permissions") !== -1) {
    return { ok: true, status: 200, json: async function () { return {}; } };
  }
  if (u.indexOf("fields=parents") !== -1) {
    return { ok: true, status: 200, json: async function () { return { parents: ["carpeta-padre-test"] }; } };
  }
  if (u === "https://www.googleapis.com/drive/v3/files" && metodo === "POST") {
    return { ok: true, status: 200, json: async function () { return { id: "carpeta-nueva-test" }; } };
  }
  return { ok: true, status: 200, json: async function () { return {}; } };
};
const archivoFalso = { name: "logo.png", type: "image/png", arrayBuffer: async function () { return new ArrayBuffer(4); } };
const urlSubida = await driveMod.subirImagenReferencia(archivoFalso);
assert(urlSubida.indexOf("img-nueva-test") !== -1, "una carpeta borrada NO deja la subida rota para siempre: se auto-repara y la imagen sí se sube (en el reintento)");
assert(state.config.driveFolderId === "carpeta-nueva-test", "...y config.driveFolderId queda con la carpeta NUEVA, no con el id muerto (los próximos intentos no vuelven a fallar)");
global.fetch = fetchOriginalDrive;

// --- El bug REAL detrás del post-mortem del 2026-09-20: la pestaña
// "Movimientos" nació con el tamaño de fábrica de Google (26 columnas,
// A-Z) y el esquema creció a 28 (ver COLUMNAS_MOVIMIENTOS abajo) —
// escribir el encabezado más allá de la columna Z daba un 400 "exceeds
// grid limits", que hacía fallar leer() ENTERO (ni siquiera llegaba a
// pedir los datos) y sin ningún aviso visible, la app se quedaba
// mostrando un blob viejísimo de "kv" como si fuera vigente. Este mock
// reproduce el límite real de Google: cualquier escritura (PUT) a una
// columna más allá de `gridColumnCount` responde el mismo 400 real, hasta
// que llega un updateSheetProperties (ver sheetsAgrandarColumnas) que
// agranda la grilla — igual que la API real.
loginComo("admin", "", "admin-grid-test@taller.test");
const { crearTablaSheet: crearTablaSheetGridTest } = await import("../js/core/sheetsTabular.js");
function colLetraANumeroTest(letra) {
  var n = 0;
  for (var i = 0; i < letra.length; i++) n = n * 26 + (letra.charCodeAt(i) - 64);
  return n;
}
function colFinDeRangoTest(range) {
  var partes = range.split("!")[1].split(":");
  var m = partes[partes.length - 1].match(/^[A-Z]+/);
  return colLetraANumeroTest(m[0]);
}
var gridColumnCountTest = 26; // tamaño de fábrica de Google — igual que el incidente real
var sheetIdGridTest = 4242;
var agrandoLlamadoConTest = null;
const fetchOriginalGrid = global.fetch;
global.fetch = async function (url, options) {
  var u = decodeURIComponent(String(url));
  var metodo = (options && options.method) || "GET";
  if (u.indexOf("?fields=sheets.properties(sheetId,title,gridProperties.columnCount)") !== -1) {
    return { ok: true, status: 200, json: async function () { return { sheets: [{ properties: { sheetId: sheetIdGridTest, title: "MovimientosGridTest", gridProperties: { columnCount: gridColumnCountTest } } }] }; } };
  }
  if (u.indexOf(":batchUpdate") !== -1 && metodo === "POST") {
    var body = JSON.parse(options.body);
    var req = body.requests[0];
    if (req.updateSheetProperties) {
      agrandoLlamadoConTest = { sheetId: req.updateSheetProperties.properties.sheetId, columnCount: req.updateSheetProperties.properties.gridProperties.columnCount };
      gridColumnCountTest = req.updateSheetProperties.properties.gridProperties.columnCount; // la API real SÍ agranda de verdad
      return { ok: true, status: 200, json: async function () { return {}; } };
    }
    return { ok: true, status: 200, json: async function () { return { replies: [{ addSheet: { properties: { sheetId: sheetIdGridTest } } }] }; } };
  }
  if (u.indexOf("/values/") !== -1) {
    var range = u.slice(u.indexOf("/values/") + "/values/".length).split("?")[0].split(":clear")[0];
    if (metodo === "GET") {
      // Encabezado ya existente con el tamaño VIEJO (26 columnas) — es lo
      // que fuerza a asegurarPestana a ver que hace falta completar más.
      return { ok: true, status: 200, json: async function () { return { values: [Array.from({ length: 26 }, function (_, i) { return "col" + i; })] }; } };
    }
    // PUT (valores) o POST (:clear): la API real rechaza cualquier rango
    // que se salga de la grilla ACTUAL, exactamente el 400 que se vio en
    // producción.
    if (colFinDeRangoTest(range) > gridColumnCountTest) {
      return { ok: false, status: 400, text: async function () { return '{"error":{"code":400,"message":"Range (' + range + ') exceeds grid limits. Max rows: 1000, max columns: ' + gridColumnCountTest + '","status":"INVALID_ARGUMENT"}}'; } };
    }
    return { ok: true, status: 200, json: async function () { return {}; } };
  }
  return { ok: true, status: 200, json: async function () { return {}; } };
};
// 28 columnas (una más de las 26 de fábrica) — mismo tamaño real que
// tablaMovimientos alcanzó este mismo día.
var columnasGridTest = Array.from({ length: 28 }, function (_, i) { return { key: "c" + i, header: "col" + i }; });
const tablaGridTest = crearTablaSheetGridTest("MovimientosGridTest", columnasGridTest);
const itemsGridTest = await tablaGridTest.leer();
assert(Array.isArray(itemsGridTest), "leer() una pestaña con MENOS columnas en su grilla que el esquema actual ya NO lanza \"exceeds grid limits\" (se agranda la grilla antes de escribir el encabezado)");
assert(!!agrandoLlamadoConTest, "...porque se llamó a updateSheetProperties para agrandar la grilla");
assert(agrandoLlamadoConTest.sheetId === sheetIdGridTest, "...con el sheetId NUMÉRICO correcto (no el nombre/título de la pestaña)");
assert(agrandoLlamadoConTest.columnCount === 28, "...agrandada exactamente a las columnas que el esquema necesita, ni de más ni de menos");
global.fetch = fetchOriginalGrid;

// Incidente 2026-09-20: sheetsTabular.js lee cada fila de "Movimientos" por
// POSICIÓN (columnas[i] <-> fila[i]), nunca por el nombre del encabezado —
// insertar una columna nueva EN MEDIO del arreglo (pasó con "empleadoId",
// metida entre origenColchonId y esInsumo) corre TODO lo que sigue un
// puesto: cada fila YA GUARDADA en la Sheet real queda leyendo el dato de
// su vecina. El daño real de ese día: esInsumo <- (vieja) proveedorId,
// proveedorId <- insumoNombre, insumoNombre <- cantidad, cantidad <- unidad
// (Number("metros") = 0), unidad <- el JSON de serviciosDescuento como
// texto plano, y serviciosDescuento <- nada (columna fuera de rango) => TODO
// movimiento existente perdía en silencio su "asignado a servicio(s)". Este
// test fija el ORDEN exacto de columnas: si alguien vuelve a insertar una
// columna en medio (en vez de agregarla al final), esta lista deja de
// coincidir y el test avisa ANTES de que llegue a producción — no puede
// detectar el bug en sí (no hay red real acá), pero sí congela el contrato
// que lo previene.
const { COLUMNAS_MOVIMIENTOS } = await import("../js/core/sheetsEsquemas.js");
assert(JSON.stringify(COLUMNAS_MOVIMIENTOS.map(function (c) { return c.key; })) === JSON.stringify([
  "id", "fecha", "tipo", "concepto", "monto", "contraparte", "pedidoId", "cotizacionId",
  "gastoFijoId", "deudaId", "origenAbonoId", "origenReembolsoId", "origenVentaConsignacionId",
  "origenComisionConsignacionId", "origenCompraClave", "origenGastoFijoPeriodo", "origenComisionCotId",
  "origenComisionPedidoId", "origenGastoId", "origenDeudaIngresoId", "origenColchonId",
  "esInsumo", "proveedorId", "insumoNombre", "cantidad", "unidad", "serviciosDescuento", "empleadoId"
]), "el orden de columnas de tablaMovimientos no cambió: una columna nueva se agregó al final, nunca insertada en medio (ver el incidente del 2026-09-20 arriba)");

// --- Compras conjuntas: varios pedidos que comparten un insumo (ver
// modules/finanzas.js) — reportado por el usuario 2026-09-20: "hay pedidos
// que comparten insumos... quiero un apartado para eso... se reparten
// equitativamente el insumo comprado". Ejemplo EXACTO que dio: lista1
// necesita 10m, lista2 necesita 20m, se compran 33m -> lista1 +1, lista2 +2.
const { repartirProporcional: repartirTest, calcGruposCompraCompartida: calcGruposTest } = await import("../js/core/calc.js");

// -- repartirProporcional: el ejemplo exacto del usuario --
assert(JSON.stringify(repartirTest(33, [10, 20], 2)) === JSON.stringify([11, 22]), "repartirProporcional reparte 33m entre quien necesitaba 10 y quien necesitaba 20 -> 11 y 22 (el ejemplo exacto que dio el usuario)");
assert(JSON.stringify(repartirTest(99000, [10, 20], 0)) === JSON.stringify([33000, 66000]), "...y el costo total pagado se reparte en la MISMA proporción (1/3, 2/3)");
// -- nunca pierde ni gana nada por el redondeo, aunque no divida parejo --
const repartoImparTest = repartirTest(100, [1, 1, 1], 0);
assert(repartoImparTest.reduce(function (a, b) { return a + b; }, 0) === 100, "repartirProporcional nunca pierde ni gana un centavo por el redondeo: la suma de las partes es SIEMPRE el total exacto, aunque no divida parejo (100 entre 3 pesos iguales) — criterio bancario: cero descuadres");
assert(Math.max.apply(null, repartoImparTest) - Math.min.apply(null, repartoImparTest) <= 1, "...la diferencia entre la parte mayor y la menor nunca es de más de 1 (el residuo se reparte, no se lo lleva uno solo)");
// -- sin ningún estimado que usar de referencia (pesos en 0), reparte parejo en vez de fallar --
assert(JSON.stringify(repartirTest(30, [0, 0], 0)) === JSON.stringify([15, 15]), "todos los pesos en 0: reparte parejo en vez de repartir todo a uno solo o fallar");
assert(JSON.stringify(repartirTest(100, [], 0)) === JSON.stringify([]), "sin participantes, no reparte nada (ni truena)");

// -- calcGruposCompraCompartida: arma la fila consolidada por insumo --
const pedidosPreviosConjuntaTest = state.pedidos, cotizacionesPreviasConjuntaTest = state.cotizaciones, txPreviosConjuntaTest = state.tx;
function cotConTela(id, pedidoId, cantidadPedida) {
  return {
    id: id, clienteId: "", cliente: "Cliente Conjunta", descripcion: "Pedido " + id, fecha: "2026-01-01",
    estado: "convertida", pedidoId: pedidoId, pedidoOrigenId: "",
    vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cconj" + id,
    referencias: [{
      id: "r-" + id, nombre: "Camiseta", imagenUrl: "", consumoAprox: 1, cantidadPedida: cantidadPedida, precioVenta: 50000, origen: "taller", costoCompra: 0, proveedorId: "",
      insumos: [{ id: "i-" + id, nombre: "Tela algodón", unidad: "m", costo: 3000, tipo: "tela", cantidad: 1, categoriaId: "", proveedorId: "" }],
      detalle: [], estado: "nuevo", estadosDef: null
    }],
    costosGlobales: [], serviciosCobrados: [], compras: []
  };
}
function pedidoConjuntaTest(id, cotId, numeroOp) {
  return {
    id: id, numeroOp: numeroOp, cliente: "Cliente Conjunta", descripcion: "Pedido de prueba",
    cantidad: "1", total: 500000, costo: 30000, abono: 0, estado: "nuevo", estadosDef: null,
    fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: cotId,
    abonos: [], lineas: [], stockConsumido: [], vendedor: null
  };
}
const cotConjA = cotConTela("cot-conjA-test", "ped-conjA-test", 10);
const cotConjB = cotConTela("cot-conjB-test", "ped-conjB-test", 20);
const pedConjA = pedidoConjuntaTest("ped-conjA-test", "cot-conjA-test", "OP-CONJA");
const pedConjB = pedidoConjuntaTest("ped-conjB-test", "cot-conjB-test", "OP-CONJB");
state.pedidos = [pedConjA, pedConjB];
state.cotizaciones = [cotConjA, cotConjB];
state.tx = [];

assert(calcGruposTest([pedConjA.id]).length === 0, "con un solo pedido elegido, no hay nada 'compartido' que mostrar (hace falta 2 o más)");

const gruposTest = calcGruposTest([pedConjA.id, pedConjB.id]);
assert(gruposTest.length === 1, "detecta la Tela algodón como un insumo pendiente compartido entre los dos pedidos");
const grupoTelaTest = gruposTest[0];
assert(grupoTelaTest.participantes.length === 2, "con los dos participantes");
assert(grupoTelaTest.totalCantidadEstimada === 30, "necesitan 10 + 20 = 30 metros en total, exactamente el ejemplo del usuario");
const partATest = grupoTelaTest.participantes.filter(function (p) { return p.cotId === "cot-conjA-test"; })[0];
const partBTest = grupoTelaTest.participantes.filter(function (p) { return p.cotId === "cot-conjB-test"; })[0];
assert(partATest.cantidadEstimada === 10 && partBTest.cantidadEstimada === 20, "cada participante trae su propia cantidad estimada (10 y 20)");
assert(partATest.etiqueta.indexOf("OP-CONJA") !== -1 && partBTest.etiqueta.indexOf("OP-CONJB") !== -1, "cada participante se identifica con su número de OP");

// -- una línea que YA se marcó "Sí" por su cuenta deja de estar "pendiente": no aparece más en el grupo --
cotConjA.compras = [{ clave: grupoTelaTest.clave, estado: "si", costoReal: 30000, cantidadReal: 10, txId: "" }];
assert(calcGruposTest([pedConjA.id, pedConjB.id]).length === 0, "si un pedido ya compró su parte por su cuenta (estado \"Sí\"), deja de contar como pendiente compartido — ya no queda nadie con quien repartir");
cotConjA.compras = [];

// -- flujo completo a través del DOM: elegir los 2 pedidos, escribir el
// total comprado y pagado, registrar, y verificar el reparto exacto --
state.tab = "finanzas"; state.finanzasVista = "conjuntas"; render();
assert(!!document.querySelector('[data-action="toggle-compra-conjunta-pedido"][data-id="' + pedConjA.id + '"]'), "Compras conjuntas lista los pedidos con compras pendientes para elegir");
click('[data-action="toggle-compra-conjunta-pedido"][data-id="' + pedConjA.id + '"]');
click('[data-action="toggle-compra-conjunta-pedido"][data-id="' + pedConjB.id + '"]');
assert(state.formCompraConjunta.seleccion.length === 2, "marca los dos pedidos elegidos");
assert(!document.querySelector('[data-action="registrar-compra-conjunta"]'), "sin escribir cantidad/costo todavía, no aparece el botón de registrar (nada que registrar aún)");
setChange('[data-action-change="set-compra-conjunta-campo"][data-clave="' + grupoTelaTest.clave + '"][data-campo="cantidadTotal"]', "33");
setChange('[data-action-change="set-compra-conjunta-campo"][data-clave="' + grupoTelaTest.clave + '"][data-campo="costoTotal"]', "99000");
assert(!!document.querySelector('[data-action="registrar-compra-conjunta"][data-clave="' + grupoTelaTest.clave + '"]'), "con los dos números escritos, aparece 'Registrar esta compra'");
const previewTextoTest = document.getElementById("app").textContent;
assert(previewTextoTest.indexOf("11.00") !== -1 && previewTextoTest.indexOf("22.00") !== -1, "antes de confirmar, ya se ve el reparto exacto que se va a aplicar (11 y 22)");
click('[data-action="registrar-compra-conjunta"][data-clave="' + grupoTelaTest.clave + '"]');

const cotATrasRegistroTest = state.cotizaciones.filter(function (c) { return c.id === "cot-conjA-test"; })[0];
const cotBTrasRegistroTest = state.cotizaciones.filter(function (c) { return c.id === "cot-conjB-test"; })[0];
const compraATest = cotATrasRegistroTest.compras.filter(function (c) { return c.clave === grupoTelaTest.clave; })[0];
const compraBTest = cotBTrasRegistroTest.compras.filter(function (c) { return c.clave === grupoTelaTest.clave; })[0];
assert(compraATest.estado === "si" && compraBTest.estado === "si", "el registro deja las dos compras marcadas \"Sí\"");
assert(compraATest.cantidadReal === 11 && compraBTest.cantidadReal === 22, "reparte los 33m: 11 para quien necesitaba 10, 22 para quien necesitaba 20 — EXACTO el ejemplo que dio el usuario");
assert(compraATest.costoReal + compraBTest.costoReal === 99000, "el costo total pagado se reparte SIN perder ni un peso: la suma vuelve a dar el total exacto");
assert(compraATest.costoReal === 33000 && compraBTest.costoReal === 66000, "el costo se reparte en la misma proporción (1/3 y 2/3): 33.000 y 66.000");
assert(!!compraATest.compartida && !!compraBTest.compartida, "las dos quedan con el rastro de 'compra compartida'");
assert(compraATest.compartida.grupoId === compraBTest.compartida.grupoId, "...con el MISMO id de grupo — es el mismo evento de compra visto desde los dos pedidos");

assert(!!compraATest.txId && !!compraBTest.txId, "cada pedido queda con su PROPIO movimiento en Finanzas (no uno solo repartido a mano)");
const txATest = state.tx.filter(function (t) { return t.id === compraATest.txId; })[0];
const txBTest = state.tx.filter(function (t) { return t.id === compraBTest.txId; })[0];
assert(!!txATest && !!txBTest && txATest.id !== txBTest.id, "los dos movimientos existen y son DISTINTOS");
assert(txATest.monto === 33000 && txBTest.monto === 66000, "cada movimiento tiene el monto que le tocó a SU pedido, no el total compartido");
assert(txATest.cotizacionId === "cot-conjA-test" && txBTest.cotizacionId === "cot-conjB-test", "cada movimiento queda ligado a su propia cotización");

assert(!state.formCompraConjunta.porClave[grupoTelaTest.clave], "tras registrar, el borrador de esa fila se limpia solo");
assert(!document.querySelector('[data-action="registrar-compra-conjunta"]'), "y la fila ya comprada desaparece de \"Compras conjuntas\" (ya no está pendiente)");

// -- el rastro se ve, sutil, en la lista de compras de CADA cotización --
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-conjA-test"]');
click('[data-action="set-cot-tab"][data-id="cot-conjA-test"][data-val="produccion"]');
const tagsCompartidaTest = Array.prototype.filter.call(document.querySelectorAll(".tag"), function (t) { return t.textContent.indexOf("compartida") !== -1; });
assert(tagsCompartidaTest.length === 1, "la fila de Tela algodón en 'Compras del pedido' de A muestra la insignia '🔗 compartida', sutil (un solo tag chico, no un aviso grande)");
assert(tagsCompartidaTest[0].getAttribute("title").indexOf("OP-CONJB") !== -1, "...cuyo tooltip menciona el OTRO pedido (OP-CONJB)");
assert(tagsCompartidaTest[0].getAttribute("title").indexOf("OP-CONJA") === -1, "...pero NO se menciona a sí misma (no tiene sentido decir que se compartió consigo misma)");

state.pedidos = pedidosPreviosConjuntaTest; state.cotizaciones = cotizacionesPreviasConjuntaTest; state.tx = txPreviosConjuntaTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva"; state.finanzasVista = "nuevo";
state.formCompraConjunta = { seleccion: [], porClave: {} };

// --- calcCotGastosReales: un costo real escrito A PROPÓSITO en $0 debe
// contar como el ahorro completo frente al estimado, no ignorarse igual que
// "nunca se escribió" — mismo error de "0 es falsy" ya corregido en
// calcResumenCompras (más arriba en core/calc.js), pero que seguía vivo acá.
// Reportado en producción 2026-09-21: el usuario marcó "Domicilio" y "Rib
// Sublimable" como pagados con costo real $0 (de verdad no costaron nada) y
// la Ganancia real no reflejaba ese ahorro — solo subía por las líneas con
// costo real positivo, como si el $0 nunca se hubiera escrito.
const { calcCotGastosReales: calcCeroRealTest, calcCotResultadoReal: calcResultadoCeroRealTest } = await import("../js/core/calc.js");
const cotCeroRealTest = {
  id: "cot-ceroreal-test", clienteId: "", cliente: "Cliente CeroReal", descripcion: "Prueba costo real cero", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "ccero1",
  referencias: [], serviciosCobrados: [],
  costosGlobales: [
    { id: "cg-domicilio-cero-test", nombre: "Domicilio", costo: 10000, cantidad: 1, proveedorId: "", esServicio: false },
    { id: "cg-diseno-cero-test", nombre: "Diseño", costo: 5000, cantidad: 1, proveedorId: "", esServicio: true }
  ],
  compras: [
    // Se marcó "Sí" pero de verdad no costó nada (ej. domicilio gratis) —
    // el 0 fue ESCRITO a propósito, no es un campo sin tocar.
    { clave: "global|cg-domicilio-cero-test", estado: "si", costoReal: 0, txId: "" },
    { clave: "global|cg-diseno-cero-test", estado: "si", costoReal: 6000, txId: "" }
  ]
};
assert(calcCeroRealTest(cotCeroRealTest) === -9000, "un costo real de $0 ESCRITO a propósito cuenta como el ahorro completo frente al estimado (0 − 10.000 = −10.000), sumado a la variación de la otra línea (6.000 − 5.000 = +1.000) = −9.000 — antes el $0 se ignoraba por completo (0 es falsy) y la variación solo daba +1.000, escondiendo 10.000 de ahorro real");
const resultadoCeroRealTest = calcResultadoCeroRealTest(cotCeroRealTest);
assert(resultadoCeroRealTest.costoTotal === 15000 - 9000, "...y ese ahorro sí baja el Costo total REAL del panel Estimado vs. Real (estimado 15.000 − 9.000 = 6.000)");

// -- pero una compra VIEJA sin costoReal (nunca se escribió, dato de antes
// de que "Sí" autorellenara con el estimado — ver set-cot-compra en
// modules/cotizaciones.js) sigue sin contar como dato, como siempre --
const cotSinEscribirTest = {
  id: "cot-sinescribir-test", clienteId: "", cliente: "Cliente Sin Escribir", descripcion: "Prueba sin escribir", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "csinesc1",
  referencias: [], serviciosCobrados: [],
  costosGlobales: [{ id: "cg-viejo-test", nombre: "Costo viejo", costo: 7000, cantidad: 1, proveedorId: "", esServicio: false }],
  // Dato legado: "comprado" en vez de "estado", sin costoReal en absoluto.
  compras: [{ clave: "global|cg-viejo-test", comprado: true }]
};
assert(calcCeroRealTest(cotSinEscribirTest) === 0, "una compra vieja marcada comprada pero SIN costoReal (nunca se escribió) sigue sin contar como ahorro de $0 — se ignora, como antes de este fix");

// --- Estado "Ahorro" en Compras del pedido: decidir a propósito NO
// comprar/hacer algo, sin la rareza de elegir "Sí" y escribir "0" a mano
// (que fue justo lo que llevó al Hallazgo #23). Pedido explícito del
// usuario 2026-09-21: "el 'NO' debería ser equivalente a no haber hecho el
// gasto... algo así como que 'no se compró' para reflejar que fue un
// ahorro" — con la aclaración de que "No" (default de TODA línea sin
// tocar) no puede pasar a significar eso sin inflar la ganancia de
// cualquier pedido a medio producir, así que quedó como una CUARTA opción
// separada; "No" solo cambió de etiqueta visible a "Aún no".
const pedidosPreviosAhorroTest = state.pedidos, cotizacionesPreviasAhorroTest = state.cotizaciones, txPreviosAhorroTest = state.tx;
const cotAhorroTest = {
  id: "cot-ahorro-test", clienteId: "", cliente: "Cliente Ahorro", descripcion: "Prueba ahorro", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-ahorro-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cahorro1",
  referencias: [], serviciosCobrados: [],
  costosGlobales: [{ id: "cg-ahorro-test", nombre: "Domicilio", costo: 10000, cantidad: 1, proveedorId: "", esServicio: false }],
  compras: []
};
state.pedidos = [{
  id: "ped-ahorro-test", numeroOp: "OP-AHORRO", cliente: "Cliente Ahorro", descripcion: "Prueba",
  cantidad: "1", total: 50000, costo: 10000, abono: 50000, estado: "entregado", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-ahorro-test",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [cotAhorroTest];
state.tx = [];

state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-ahorro-test"]');
click('[data-action="set-cot-tab"][data-id="cot-ahorro-test"][data-val="produccion"]');

const selectorEstadoAhorro = '[data-action-change="set-cot-compra"][data-cot="cot-ahorro-test"][data-clave="global|cg-ahorro-test"][data-campo="estado"]';
assert(!!document.querySelector(selectorEstadoAhorro), "la fila de Domicilio tiene su selector de estado");
const opcionesAhorroTest = Array.prototype.map.call(document.querySelectorAll(selectorEstadoAhorro + " option"), function (o) { return o.textContent; });
assert(opcionesAhorroTest.indexOf("Aún no") !== -1, "el estado por defecto ahora se llama \"Aún no\" (antes \"No\") para no confundirlo con \"no se compró\"");
assert(opcionesAhorroTest.indexOf("Ahorro") !== -1, "hay una opción nueva \"Ahorro\"");

setChange(selectorEstadoAhorro, "ahorro");
var cotAhorroTrasElegir = state.cotizaciones.filter(function (c) { return c.id === "cot-ahorro-test"; })[0];
var compraAhorroTest = cotAhorroTrasElegir.compras.filter(function (c) { return c.clave === "global|cg-ahorro-test"; })[0];
assert(compraAhorroTest.estado === "ahorro", "elegir \"Ahorro\" guarda ese estado");
assert(compraAhorroTest.costoReal === 0 && compraAhorroTest.cantidadReal === 0, "...y fija cantidad/costo en 0 EXPLÍCITO solo, sin que el usuario tenga que escribir nada");

var filaAhorroHtml = document.querySelector(selectorEstadoAhorro).closest(".tx-row");
assert(!filaAhorroHtml.querySelector('[data-campo="cantidadReal"]') && !filaAhorroHtml.querySelector('[data-campo="costoReal"]'), "con \"Ahorro\" elegido, la fila deja de pedir cantidad/costo real (se ve \"—\", no un campo vacío por llenar) — ya no hace falta escribir \"0\" a mano");

const { calcCotGastosReales: calcAhorroTest, calcResumenCompras: resumenAhorroTest } = await import("../js/core/calc.js");
assert(calcAhorroTest(cotAhorroTrasElegir) === -10000, "\"Ahorro\" cuenta como el ahorro completo frente al estimado (-10.000), sin haber escrito ningún número a mano");
var resumenTrasAhorro = resumenAhorroTest(cotAhorroTrasElegir);
assert(resumenTrasAhorro.ahorro === 1 && resumenTrasAhorro.ahorrado === 10000, "el resumen de la tabla cuenta 1 línea ahorrada, por $10.000");
assert(resumenTrasAhorro.pendientes === 0, "y ya NO cuenta como pendiente (se resolvió — resuelta como \"no hizo falta\")");

click('[data-action="sincronizar-compras-finanzas"][data-id="cot-ahorro-test"]');
assert(state.tx.length === 0, "\"Ahorro\" no crea ningún movimiento en Finanzas — no hubo plata que registrar");

state.pedidos = pedidosPreviosAhorroTest; state.cotizaciones = cotizacionesPreviasAhorroTest; state.tx = txPreviosAhorroTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// --- El aviso de "el catálogo cambió" también debe verse cuando ese
// insumo se reclasificó como "Costo global del pedido" o "Se cobra aparte
// al cliente" — antes solo se revisaba mientras seguía siendo un insumo
// DENTRO de una referencia; moverlo a cualquiera de esas dos listas
// preserva el vínculo con el catálogo (origenCatalogoId, ver
// moverInsumoAGlobal/AServicio) pero nadie volvía a comparar el costo ahí,
// así que el aviso (y su botón "Actualizar") dejaban de verse para
// siempre. Reportado en producción 2026-09-21: "actualicé el valor de un
// insumo y no se vio reflejado en cotización... guardado o no, no se
// actualiza el insumo".
const pedidosPreviosCatGlobalTest = state.pedidos, cotizacionesPreviasCatGlobalTest = state.cotizaciones;
state.catalogoInsumos.push({ id: "ins-catglobal-test", nombre: "Domicilio Test", unidad: "UND", costo: 5000, tipo: "por_prenda", categoriaId: "", proveedorId: "" });
state.catalogoInsumos.push({ id: "ins-catserv-test", nombre: "Diseño Test", unidad: "UND", costo: 3000, tipo: "por_prenda", categoriaId: "", proveedorId: "" });
state.cotizaciones = [{
  id: "cot-catglobal-test", clienteId: "", cliente: "Cliente CatGlobal", descripcion: "Prueba aviso catálogo", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "ccatglobal1",
  referencias: [{
    id: "ref-catglobal-test", nombre: "Camiseta CatGlobal", imagenUrl: "", consumoAprox: 1, cantidadPedida: 5, precioVenta: 50000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [], detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [
    { id: "cg-catglobal-test", nombre: "Domicilio Test", unidad: "UND", costo: 5000, proveedorId: "", esServicio: false, origenCatalogoId: "ins-catglobal-test" }
  ],
  serviciosCobrados: [
    { id: "sc-catglobal-test", nombre: "Diseño Test", unidad: "UND", costo: 3000, precio: 8000, proveedorId: "", esServicio: true, origenCatalogoId: "ins-catserv-test" }
  ],
  compras: []
}];
state.pedidos = [];

state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-catglobal-test"]');
assert(!document.querySelector(".ins-aviso-cambio"), "sin diferencia todavía con el catálogo, no hay ningún aviso");

state.tab = "catalogo"; render();
setChange('[data-action-change="set-cat-campo"][data-id="ins-catglobal-test"][data-campo="costo"]', "9000");
setChange('[data-action-change="set-cat-campo"][data-id="ins-catserv-test"][data-campo="costo"]', "6000");
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-catglobal-test"]');

assert(document.querySelectorAll(".ins-aviso-cambio").length === 2, "reclasificar un insumo como \"Costo global del pedido\" o \"Se cobra aparte al cliente\" NO le hace perder el aviso de \"el catálogo cambió\" — antes nadie lo revisaba en esas dos listas y se perdía para siempre");

const btnActualizarGlobalTest = document.querySelector('[data-action="actualizar-insumo-catalogo"][data-ins="cg-catglobal-test"]');
assert(!!btnActualizarGlobalTest && btnActualizarGlobalTest.textContent.indexOf("9.000") !== -1, "el botón \"Actualizar\" del costo global ofrece el nuevo valor del catálogo ($9.000)");
click('[data-action="actualizar-insumo-catalogo"][data-ins="cg-catglobal-test"]');
var cotTrasActualizarGlobal = state.cotizaciones.filter(function (c) { return c.id === "cot-catglobal-test"; })[0];
assert(cotTrasActualizarGlobal.costosGlobales[0].costo === 9000, "\"Actualizar\" sí trae el costo nuevo del catálogo al costo global de la cotización");
assert(state.cotSucia === "cot-catglobal-test", "y deja la cotización marcada como \"con cambios sin guardar\", igual que cualquier otra edición (protegida contra pérdida de borrador)");
assert(!document.querySelector('[data-action="actualizar-insumo-catalogo"][data-ins="cg-catglobal-test"]'), "...y su propio aviso desaparece, ya con los dos costos iguales");

const btnMantenerServicioTest = document.querySelector('[data-action="descartar-aviso-insumo-cambio"][data-ins="sc-catglobal-test"]');
assert(!!btnMantenerServicioTest, "el servicio cobrado también tiene su aviso, con \"Mantener\"");
click('[data-action="descartar-aviso-insumo-cambio"][data-ins="sc-catglobal-test"]');
var cotTrasMantenerServicio = state.cotizaciones.filter(function (c) { return c.id === "cot-catglobal-test"; })[0];
assert(cotTrasMantenerServicio.serviciosCobrados[0].costo === 3000, "\"Mantener\" deja el costo del servicio cobrado TAL CUAL (no lo actualiza)");
assert(!document.querySelector('[data-action="actualizar-insumo-catalogo"][data-ins="sc-catglobal-test"]'), "...y su aviso desaparece — ya se decidió, a conciencia, mantener el número de la cotización");

state.pedidos = pedidosPreviosCatGlobalTest; state.cotizaciones = cotizacionesPreviasCatGlobalTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// --- El mismo vínculo con el catálogo (origenCatalogoId) se perdía al
// copiar un insumo a una plantilla o a un producto, y de ahí a la
// referencia de una cotización vía "Aplicar plantilla"/"Aplicar
// producto" — el camino MÁS COMÚN para armar una referencia rápido, más
// común incluso que agregar insumos uno por uno. El usuario lo confirmó
// tras corregir mi primera teoría (que asumí sin que él lo dijera): no
// era un costo global, era justo este otro hueco. Se prueba el camino
// completo (plantilla -> cotización -> aviso) y la reparación retroactiva
// para lo que ya se guardó sin el vínculo (por nombre, con cuidado de NO
// adivinar si el nombre es ambiguo en el catálogo).
const pedidosPreviosPlaProdTest = state.pedidos, cotizacionesPreviasPlaProdTest = state.cotizaciones,
  plantillasPreviasPlaProdTest = state.plantillasPrendas, productosPreviosPlaProdTest = state.productos,
  catalogoPrevioPlaProdTest = state.catalogoInsumos;

state.catalogoInsumos = state.catalogoInsumos.concat([
  { id: "ins-plaprod-1", nombre: "Tela Plaprod", unidad: "m", costo: 4000, tipo: "tela", categoriaId: "", proveedorId: "" },
  // Dos insumos con el MISMO nombre normalizado: a propósito, para probar
  // que la reparación retroactiva se abstiene de adivinar en vez de
  // vincular al azar con cualquiera de los dos.
  { id: "ins-ambiguo-a-test", nombre: "Broche", unidad: "UND", costo: 500, tipo: "por_prenda", categoriaId: "", proveedorId: "" },
  { id: "ins-ambiguo-b-test", nombre: "broche ", unidad: "UND", costo: 800, tipo: "por_prenda", categoriaId: "", proveedorId: "" }
]);
state.plantillasPrendas = [{
  id: "pla-plaprod-test", nombre: "Camiseta Plaprod", consumoSugerido: 1, imagenUrl: "", flujoEstadosId: "",
  insumos: [{ id: "pla-ins-plaprod-test", nombre: "Tela Plaprod", unidad: "m", costo: 4000, tipo: "tela", cantidad: 1, esServicio: false, origenCatalogoId: "ins-plaprod-1" }]
}];
state.productos = [];
state.clientes.push({ id: "cli-plaprod-test", nombre: "Cliente Plaprod", tipoRelacion: "cliente", cedula: "", ciudad: "", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] });
state.cotizaciones = [{
  id: "cot-plaprod-test", clienteId: "cli-plaprod-test", cliente: "Cliente Plaprod", descripcion: "Prueba plantilla/producto", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cplaprod1",
  referencias: [{
    id: "ref-plaprod-test", nombre: "", imagenUrl: "", consumoAprox: 1, cantidadPedida: 5, precioVenta: 50000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [], detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.pedidos = [];

state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-plaprod-test"]');
setChange('[data-action-change="aplicar-plantilla"][data-cot="cot-plaprod-test"][data-ref="ref-plaprod-test"]', "pla-plaprod-test");

var cotTrasAplicarPlaTest = state.cotizaciones.filter(function (c) { return c.id === "cot-plaprod-test"; })[0];
var insumoCopiadoPlaTest = cotTrasAplicarPlaTest.referencias[0].insumos[0];
assert(insumoCopiadoPlaTest.origenCatalogoId === "ins-plaprod-1", "\"Aplicar plantilla\" propaga el vínculo con el catálogo al insumo copiado — antes se perdía siempre, sin importar que la plantilla sí lo tuviera");

click('[data-action="guardar-cotizacion"][data-id="cot-plaprod-test"]');
state.tab = "catalogo"; render();
setChange('[data-action-change="set-cat-campo"][data-id="ins-plaprod-1"][data-campo="costo"]', "7000");
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-plaprod-test"]');
assert(!!document.querySelector(".ins-aviso-cambio"), "y con eso, el aviso de \"el catálogo cambió\" SÍ aparece para un insumo que llegó a la cotización vía \"Aplicar plantilla\"");
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// -- Reparación retroactiva: dato viejo, guardado ANTES de este fix (sin
// origenCatalogoId en la plantilla ni en la cotización) --
state.plantillasPrendas.find(function (p) { return p.id === "pla-plaprod-test"; }).insumos[0].origenCatalogoId = "";
state.cotizaciones.find(function (c) { return c.id === "cot-plaprod-test"; }).referencias[0].insumos[0].origenCatalogoId = "";
state.productos = [{
  id: "pro-plaprod-test", nombre: "Producto Plaprod", origen: "taller", precioVenta: 60000, costoCompra: 0, proveedorId: "", imagenUrl: "", consumoSugerido: 1, flujoEstadosId: "",
  insumos: [{ id: "pro-ins-plaprod-test", nombre: "Broche", unidad: "UND", costo: 500, tipo: "por_prenda", cantidad: 1, esServicio: false, origenCatalogoId: "" }],
  tallas: []
}];
const { repararOrigenCatalogoInsumos: repararCatTest } = await import("../js/core/store.js");
const huboReparacionTest = repararCatTest(state.catalogoInsumos, state.plantillasPrendas, state.productos, state.cotizaciones);
assert(huboReparacionTest === true, "la reparación retroactiva detecta y arregla los vínculos perdidos");
assert(state.plantillasPrendas.find(function (p) { return p.id === "pla-plaprod-test"; }).insumos[0].origenCatalogoId === "ins-plaprod-1", "...reconstruye el vínculo de la PLANTILLA por nombre, contra el insumo correcto del catálogo");
assert(state.cotizaciones.find(function (c) { return c.id === "cot-plaprod-test"; }).referencias[0].insumos[0].origenCatalogoId === "ins-plaprod-1", "...y también el de la COTIZACIÓN ya guardada, sin que el usuario tenga que volver a aplicar nada a mano");
assert(state.productos.find(function (p) { return p.id === "pro-plaprod-test"; }).insumos[0].origenCatalogoId === "", "...pero NO adivina cuando el nombre es AMBIGUO en el catálogo (\"Broche\" existe dos veces) — mejor no reparar que vincular al insumo equivocado");

state.pedidos = pedidosPreviosPlaProdTest; state.cotizaciones = cotizacionesPreviasPlaProdTest;
state.plantillasPrendas = plantillasPreviasPlaProdTest; state.productos = productosPreviosPlaProdTest;
state.catalogoInsumos = catalogoPrevioPlaProdTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// --- El consumo de una tela (metros) ahora es PROPIO de cada insumo tipo
// "tela", no de la referencia — antes CUALQUIER tela de una referencia
// usaba el mismo "Consumo tela (MT)" de la referencia, así que 2 telas
// sublimadas distintas (ej. 0.8m delantero + 0.4m mangas) se calculaban
// las dos como si consumieran el total completo. Reportado en producción
// 2026-09-21: "cuando hay más de 1 tela sublimada, la cotización está
// hecha para 1 tela". Se prueba el caso real (2 telas, cada una con su
// propio consumo y costo) y la migración retroactiva de lo ya guardado
// (que no debe cambiar ni un peso de lo que YA se estaba calculando).
const pedidosPreviosMultitelaTest = state.pedidos, cotizacionesPreviasMultitelaTest = state.cotizaciones,
  catalogoPrevioMultitelaTest = state.catalogoInsumos;
state.catalogoInsumos = state.catalogoInsumos.concat([
  { id: "ins-tela-a-test", nombre: "Tela sublimada delantero test", unidad: "m", costo: 20000, tipo: "tela", categoriaId: "", proveedorId: "" },
  { id: "ins-tela-b-test", nombre: "Tela sublimada mangas test", unidad: "m", costo: 15000, tipo: "tela", categoriaId: "", proveedorId: "" }
]);
state.clientes.push({ id: "cli-multitela-test", nombre: "Cliente Multitela", tipoRelacion: "cliente", cedula: "", ciudad: "", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] });
state.cotizaciones = [{
  id: "cot-multitela-test", clienteId: "cli-multitela-test", cliente: "Cliente Multitela", descripcion: "Camiseta sublimada", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cmultitelatest",
  referencias: [{
    id: "ref-multitela-test", nombre: "Camiseta sublimada", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 50000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [], detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.pedidos = [];

state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-multitela-test"]');
click('[data-action="abrir-insumo-picker"][data-cot="cot-multitela-test"][data-ref="ref-multitela-test"]');
click('[data-action="toggle-insumo-picker-item"][data-id="ins-tela-a-test"]');
click('[data-action="toggle-insumo-picker-item"][data-id="ins-tela-b-test"]');
click('[data-action="confirmar-insumo-picker"]');

var refMultitelaTest = state.cotizaciones.filter(function (c) { return c.id === "cot-multitela-test"; })[0].referencias[0];
assert(refMultitelaTest.insumos.length === 2, "agrega las 2 telas a la misma referencia");
var idTelaATest = refMultitelaTest.insumos.filter(function (i) { return i.nombre === "Tela sublimada delantero test"; })[0].id;
var idTelaBTest = refMultitelaTest.insumos.filter(function (i) { return i.nombre === "Tela sublimada mangas test"; })[0].id;

setChange('[data-action-change="set-ins-campo"][data-cot="cot-multitela-test"][data-ref="ref-multitela-test"][data-ins="' + idTelaATest + '"][data-campo="cantidad"]', "0.8");
setChange('[data-action-change="set-ins-campo"][data-cot="cot-multitela-test"][data-ref="ref-multitela-test"][data-ins="' + idTelaBTest + '"][data-campo="cantidad"]', "0.4");

const { calcCostoUnitarioRef: calcCostoUnitRefMultitelaTest, calcListaCompras: calcListaComprasMultitelaTest } = await import("../js/core/calc.js");
refMultitelaTest = state.cotizaciones.filter(function (c) { return c.id === "cot-multitela-test"; })[0].referencias[0];
assert(refMultitelaTest.insumos.filter(function (i) { return i.id === idTelaATest; })[0].cantidad === 0.8 && refMultitelaTest.insumos.filter(function (i) { return i.id === idTelaBTest; })[0].cantidad === 0.4, "cada tela guarda su PROPIO consumo, independiente de la otra");
assert(calcCostoUnitRefMultitelaTest(refMultitelaTest) === 22000, "el costo unitario usa el consumo de CADA tela (20.000×0.8 + 15.000×0.4 = 22.000), no el mismo consumo repetido dos veces");

var cotMultitelaTest = state.cotizaciones.filter(function (c) { return c.id === "cot-multitela-test"; })[0];
var listaMultitelaTest = calcListaComprasMultitelaTest(cotMultitelaTest);
var lineaTelaATest = listaMultitelaTest.filter(function (l) { return l.nombre === "Tela sublimada delantero test"; })[0];
var lineaTelaBTest = listaMultitelaTest.filter(function (l) { return l.nombre === "Tela sublimada mangas test"; })[0];
assert(lineaTelaATest.cantidadFisica === 8 && lineaTelaATest.costoTotal === 160000, "la lista de compras trae la tela A con SU propia cantidad física (0.8m × 10 = 8m) y costo (160.000)");
assert(lineaTelaBTest.cantidadFisica === 4 && lineaTelaBTest.costoTotal === 60000, "...y la tela B con la SUYA (0.4m × 10 = 4m, 60.000) — antes las dos habrían mostrado el mismo número");

state.pedidos = pedidosPreviosMultitelaTest; state.cotizaciones = cotizacionesPreviasMultitelaTest;
state.catalogoInsumos = catalogoPrevioMultitelaTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// -- Migración retroactiva: cotización vieja con UNA tela, sin `consumoPropio`, cantidad todavía en el viejo default --
const cotizacionesPreviasMigTelaTest = state.cotizaciones;
const cotViejaTelaTest = {
  id: "cot-viejatela-test", clienteId: "", cliente: "Cliente Vieja", descripcion: "Prueba migración tela", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cviejatela1",
  referencias: [{
    id: "ref-viejatela-test", nombre: "Ref vieja", imagenUrl: "", consumoAprox: 1.5, cantidadPedida: 10, precioVenta: 50000, origen: "taller", costoCompra: 0, proveedorId: "",
    insumos: [{ id: "ins-viejatela-test", nombre: "Tela vieja", unidad: "m", costo: 10000, tipo: "tela", cantidad: 1, esServicio: false, proveedorId: "" }],
    detalle: [], estado: "nuevo", estadosDef: null
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
};
state.cotizaciones = [cotViejaTelaTest];
const { repararConsumoTelaPorInsumo: repararTelaTest } = await import("../js/core/store.js");
const huboMigracionTelaTest = repararTelaTest(state.plantillasPrendas, state.productos, state.cotizaciones);
assert(huboMigracionTelaTest === true, "la migración detecta la tela vieja sin consumo propio");
var insumoMigradoTelaTest = state.cotizaciones[0].referencias[0].insumos[0];
assert(insumoMigradoTelaTest.cantidad === 1.5, "...y le copia el consumo que la referencia YA tenía (1.5) — el mismo número que SIEMPRE usó calcCostoPrenda, no cambia nada de lo ya cotizado");
assert(insumoMigradoTelaTest.consumoPropio === true, "...y la marca como ya migrada");
insumoMigradoTelaTest.cantidad = 3; // el usuario personaliza el consumo DESPUÉS de migrar
const huboSegundaMigracionTelaTest = repararTelaTest(state.plantillasPrendas, state.productos, state.cotizaciones);
assert(huboSegundaMigracionTelaTest === false, "correr la migración de nuevo sobre un insumo ya migrado no hace nada");
assert(state.cotizaciones[0].referencias[0].insumos[0].cantidad === 3, "...así que NO pisa el consumo que el usuario ya personalizó a mano después de migrar");

state.cotizaciones = cotizacionesPreviasMigTelaTest;

// --- Excedente de una compra: a veces se compra más de lo necesario a
// propósito (mínimo del proveedor, conviene comprar de más) y esa parte NO
// es costo ni sobrecosto del pedido — es una compra de insumo aparte. El
// usuario lo pidió con un ejemplo puntual: comprar 15 necesitando 10, y que
// si luego resulta que en realidad se usaron 12 (2 de más por un error), al
// corregirlo el excedente se ajuste solo (de 5 a 3) y el movimiento de
// Finanzas ya registrado se actualice, no se duplique. También pidió
// explícito que, al estar vinculados, los dos movimientos (pedido y
// excedente) se borren juntos. Ver costoRealPedido/costoExcedenteCompra en
// core/calc.js y conversación con el usuario 2026-09-21.
const pedidosPreviosExcTest = state.pedidos, cotizacionesPreviasExcTest = state.cotizaciones, txPreviosExcTest = state.tx;
const cotExcTest = {
  id: "cot-exc-test", clienteId: "", cliente: "Cliente Excedente", descripcion: "Prueba excedente", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "ped-exc-test", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cexc1",
  referencias: [], serviciosCobrados: [],
  costosGlobales: [{ id: "cg-exc-test", nombre: "Tela por unidad", costo: 100000, cantidad: 10, unidad: "m", proveedorId: "", esServicio: false }],
  compras: []
};
state.pedidos = [{
  id: "ped-exc-test", numeroOp: "OP-EXC", cliente: "Cliente Excedente", descripcion: "Prueba",
  cantidad: "1", total: 200000, costo: 100000, abono: 200000, estado: "entregado", estadosDef: null,
  fechaCreacion: "2026-01-01", fechaEntrega: "", tipoCliente: "propio", cotizacionId: "cot-exc-test",
  abonos: [], lineas: [], stockConsumido: [], vendedor: null
}];
state.cotizaciones = [cotExcTest];
state.tx = [];

const { costoRealPedido: costoRealPedidoTest, costoExcedenteCompra: costoExcedenteCompraTest, cantidadRealPedido: cantidadRealPedidoTest, calcCotGastosReales: calcGastosExcTest, calcResumenCompras: calcResumenExcTest, movimientosGeneradosPorCotizacion: movGenExcTest } = await import("../js/core/calc.js");

state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-exc-test"]');
click('[data-action="set-cot-tab"][data-id="cot-exc-test"][data-val="produccion"]');
const claveExcTest = "global|cg-exc-test";
const selEstadoExcTest = '[data-action-change="set-cot-compra"][data-cot="cot-exc-test"][data-clave="' + claveExcTest + '"][data-campo="estado"]';
setChange(selEstadoExcTest, "si");
setChange('[data-action-change="set-cot-compra"][data-cot="cot-exc-test"][data-clave="' + claveExcTest + '"][data-campo="cantidadReal"]', "15");
setChange('[data-action-change="set-cot-compra"][data-cot="cot-exc-test"][data-clave="' + claveExcTest + '"][data-campo="costoReal"]', "150000");

var compraExcTest = state.cotizaciones.filter(function (c) { return c.id === "cot-exc-test"; })[0].compras.filter(function (c) { return c.clave === claveExcTest; })[0];
assert(compraExcTest.cantidadExcedente === 5, "al comprar 15 necesitando 10, se sugiere solo el excedente (5) al escribir la cantidad — el usuario no tiene que calcularlo a mano");
assert(costoExcedenteCompraTest(compraExcTest) === 50000, "el excedente cuesta al mismo costo unitario real de la factura (150.000 ÷ 15 × 5 = 50.000)");
assert(costoRealPedidoTest(compraExcTest) === 100000, "lo que le queda al pedido son los otros 10: 150.000 − 50.000 = 100.000, NUNCA el bruto de la factura");
assert(cantidadRealPedidoTest(compraExcTest) === 10, "...y la cantidad neta del pedido vuelve a ser justo la que necesitaba (10), no las 15 compradas");

var cotExcTestObj = state.cotizaciones.filter(function (c) { return c.id === "cot-exc-test"; })[0];
assert(calcGastosExcTest(cotExcTestObj) === 0, "sin variación de precio real (mismo $10.000/unidad estimado y pagado), el sobrecosto del pedido es $0 — el excedente NO cuenta como sobrecosto");
var resumenExcTest = calcResumenExcTest(cotExcTestObj);
assert(resumenExcTest.real === 100000, "calcResumenCompras también usa el neto del pedido, no el bruto de la factura");
assert(resumenExcTest.excedente === 50000, "...y expone aparte cuánto se separó como excedente (compra de insumo)");

var tagsExcTest = Array.prototype.filter.call(document.querySelectorAll(".tag"), function (t) { return t.textContent.indexOf("excedente") !== -1; });
assert(tagsExcTest.length === 1, "la fila muestra un tag sutil '📦 excedente' sin tener que abrir el detalle");

click('[data-action="toggle-compra-detalle"][data-cot="cot-exc-test"][data-clave="' + claveExcTest + '"]');
var inputExcedenteTest = document.querySelector('input[data-action-change="set-cot-compra"][data-cot="cot-exc-test"][data-clave="' + claveExcTest + '"][data-campo="cantidadExcedente"]');
assert(!!inputExcedenteTest, "el detalle de la compra tiene el campo para ajustar el excedente");
assert(inputExcedenteTest.value === "5", "...precargado con el excedente ya sugerido/guardado");

click('[data-action="sincronizar-compras-finanzas"][data-id="cot-exc-test"]');
cotExcTestObj = state.cotizaciones.filter(function (c) { return c.id === "cot-exc-test"; })[0];
compraExcTest = cotExcTestObj.compras.filter(function (c) { return c.clave === claveExcTest; })[0];
assert(!!compraExcTest.txId, "crea el movimiento del pedido");
assert(!!compraExcTest.excedenteTxId, "...Y crea aparte el movimiento del excedente (compra de insumo)");
var txPedidoExcTest = state.tx.filter(function (t) { return t.id === compraExcTest.txId; })[0];
var txExcedenteTest = state.tx.filter(function (t) { return t.id === compraExcTest.excedenteTxId; })[0];
assert(txPedidoExcTest.monto === 100000, "el movimiento del pedido queda con el neto (100.000)");
assert(txExcedenteTest.monto === 50000 && txExcedenteTest.cantidad === 5, "el movimiento del excedente queda con su propio monto y cantidad (50.000, 5)");
assert(txExcedenteTest.esInsumo === "1" && txExcedenteTest.insumoNombre === "Tela por unidad", "el movimiento del excedente es una compra de insumo normal, reconocible igual que cualquier otra (\"Es insumo\")");
assert(txExcedenteTest.origenCompraExcedenteClave === claveExcTest, "...vinculado a esta misma compra");
assert(txPedidoExcTest.id !== txExcedenteTest.id, "son dos movimientos DISTINTOS en Finanzas, no uno repartido a mano");

// -- corrección: en producción se usaron 12, no 10 (2 del "excedente" se
// gastaron de más por un error) — el usuario ajusta el excedente de 5 a 3 --
setChange('[data-action-change="set-cot-compra"][data-cot="cot-exc-test"][data-clave="' + claveExcTest + '"][data-campo="cantidadExcedente"]', "3");
click('[data-action="sincronizar-compras-finanzas"][data-id="cot-exc-test"]');
cotExcTestObj = state.cotizaciones.filter(function (c) { return c.id === "cot-exc-test"; })[0];
compraExcTest = cotExcTestObj.compras.filter(function (c) { return c.clave === claveExcTest; })[0];
assert(costoRealPedidoTest(compraExcTest) === 120000, "al corregir el excedente de 5 a 3, el costo del pedido sube solo: 150.000 − 30.000 = 120.000");
assert(calcGastosExcTest(cotExcTestObj) === 20000, "...y ahora SÍ hay sobrecosto real: 120.000 − 100.000 = 20.000, justo los 2 extra a $10.000");
var txExcedenteTest2 = state.tx.filter(function (t) { return t.id === compraExcTest.excedenteTxId; })[0];
assert(txExcedenteTest2.id === txExcedenteTest.id, "el movimiento del excedente se ACTUALIZA (mismo id), no se duplica");
assert(txExcedenteTest2.monto === 30000 && txExcedenteTest2.cantidad === 3, "...con la cifra corregida (30.000, 3 unidades)");
var txPedidoExcTest2 = state.tx.filter(function (t) { return t.id === compraExcTest.txId; })[0];
assert(txPedidoExcTest2.id === txPedidoExcTest.id && txPedidoExcTest2.monto === 120000, "el movimiento del pedido también se actualiza solo (mismo id, 120.000)");

var movsExcTest = movGenExcTest(cotExcTestObj);
assert(movsExcTest.some(function (t) { return t.id === compraExcTest.txId; }) && movsExcTest.some(function (t) { return t.id === compraExcTest.excedenteTxId; }), "al eliminar la cotización, los DOS movimientos (pedido y excedente) se reconocen como generados por ella — se borran juntos, tal como lo pidió el usuario");

// -- desmarcar la compra retira los DOS movimientos, no solo el del pedido --
setChange(selEstadoExcTest, "no");
click('[data-action="sincronizar-compras-finanzas"][data-id="cot-exc-test"]');
cotExcTestObj = state.cotizaciones.filter(function (c) { return c.id === "cot-exc-test"; })[0];
compraExcTest = cotExcTestObj.compras.filter(function (c) { return c.clave === claveExcTest; })[0];
assert(!state.tx.some(function (t) { return t.id === txPedidoExcTest.id; }) && !state.tx.some(function (t) { return t.id === txExcedenteTest.id; }), "al desmarcar la compra, los DOS movimientos se retiran juntos de Finanzas");
assert(!compraExcTest.txId && !compraExcTest.excedenteTxId, "...y la compra queda sin ninguno de los dos ids vinculados");

state.pedidos = pedidosPreviosExcTest; state.cotizaciones = cotizacionesPreviasExcTest; state.tx = txPreviosExcTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// --- El mismo excedente, pero repartido entre varios pedidos en "Compras
// conjuntas" — el usuario fue explícito: "tienes que vincularlo a los 2
// pedidos, ya que manejan el mismo insumo, no cambia nada, solo se agrega
// otro pedido, pero el funcionamiento es el mismo". Se reparte con el
// MISMO repartirProporcional que ya reparte cantidad/costo, y cada pedido
// termina con su PROPIA compra de insumo aparte, vinculada a SU cotización
// — nunca una sola suelta sin dueño. Reusa cotConTela/pedidoConjuntaTest/
// calcGruposTest ya definidas más arriba, en el bloque de Compras
// conjuntas.
const pedidosPreviosConjExcTest = state.pedidos, cotizacionesPreviasConjExcTest = state.cotizaciones, txPreviosConjExcTest = state.tx;
const cotConjExcA = cotConTela("cot-conjexcA-test", "ped-conjexcA-test", 10);
const cotConjExcB = cotConTela("cot-conjexcB-test", "ped-conjexcB-test", 20);
const pedConjExcA = pedidoConjuntaTest("ped-conjexcA-test", "cot-conjexcA-test", "OP-CONJEXCA");
const pedConjExcB = pedidoConjuntaTest("ped-conjexcB-test", "cot-conjexcB-test", "OP-CONJEXCB");
state.pedidos = [pedConjExcA, pedConjExcB];
state.cotizaciones = [cotConjExcA, cotConjExcB];
state.tx = [];

const grupoConjExcTest = calcGruposTest([pedConjExcA.id, pedConjExcB.id])[0];
state.tab = "finanzas"; state.finanzasVista = "conjuntas"; render();
click('[data-action="toggle-compra-conjunta-pedido"][data-id="' + pedConjExcA.id + '"]');
click('[data-action="toggle-compra-conjunta-pedido"][data-id="' + pedConjExcB.id + '"]');
setChange('[data-action-change="set-compra-conjunta-campo"][data-clave="' + grupoConjExcTest.clave + '"][data-campo="cantidadTotal"]', "36");
setChange('[data-action-change="set-compra-conjunta-campo"][data-clave="' + grupoConjExcTest.clave + '"][data-campo="costoTotal"]', "108000");
var campoExcedenteConjTest = document.querySelector('input[data-action-change="set-compra-conjunta-campo"][data-clave="' + grupoConjExcTest.clave + '"][data-campo="cantidadExcedente"]');
assert(!!campoExcedenteConjTest, "el formulario de Compras conjuntas también tiene el campo de excedente");
setChange('[data-action-change="set-compra-conjunta-campo"][data-clave="' + grupoConjExcTest.clave + '"][data-campo="cantidadExcedente"]', "6");
var previewExcConjTest = document.getElementById("app").textContent;
assert(previewExcConjTest.indexOf("excedente") !== -1, "el reparto en pantalla ya muestra cuánto excedente le toca a cada pedido antes de confirmar");
click('[data-action="registrar-compra-conjunta"][data-clave="' + grupoConjExcTest.clave + '"]');

var cotConjExcATrasTest = state.cotizaciones.filter(function (c) { return c.id === "cot-conjexcA-test"; })[0];
var cotConjExcBTrasTest = state.cotizaciones.filter(function (c) { return c.id === "cot-conjexcB-test"; })[0];
var compraConjExcA = cotConjExcATrasTest.compras.filter(function (c) { return c.clave === grupoConjExcTest.clave; })[0];
var compraConjExcB = cotConjExcBTrasTest.compras.filter(function (c) { return c.clave === grupoConjExcTest.clave; })[0];

assert(compraConjExcA.cantidadReal === 12 && compraConjExcB.cantidadReal === 24, "el total comprado (36) se reparte a prorrata igual que siempre: 12 y 24");
assert(compraConjExcA.cantidadExcedente === 2 && compraConjExcB.cantidadExcedente === 4, "el excedente (6) se reparte con el MISMO criterio, cada uno a su propia compra — no uno solo sin dueño");
assert(cantidadRealPedidoTest(compraConjExcA) === 10 && cantidadRealPedidoTest(compraConjExcB) === 20, "descontado el excedente, a cada pedido le queda justo lo que necesitaba (10 y 20)");
assert(costoRealPedidoTest(compraConjExcA) === 30000 && costoRealPedidoTest(compraConjExcB) === 60000, "...con su costo neto correspondiente, sin variación de precio (30.000 y 60.000, igual al estimado de cada uno)");
assert(calcGastosExcTest(cotConjExcATrasTest) === 0 && calcGastosExcTest(cotConjExcBTrasTest) === 0, "ningún pedido queda con sobrecosto: el excedente absorbió exactamente lo comprado de más");

assert(!!compraConjExcA.excedenteTxId && !!compraConjExcB.excedenteTxId, "cada pedido queda con su PROPIO movimiento de excedente, vinculado a su propia compra");
var txExcConjA = state.tx.filter(function (t) { return t.id === compraConjExcA.excedenteTxId; })[0];
var txExcConjB = state.tx.filter(function (t) { return t.id === compraConjExcB.excedenteTxId; })[0];
assert(txExcConjA.monto === 6000 && txExcConjB.monto === 12000, "cada movimiento de excedente tiene el monto que le tocó a SU pedido (6.000 y 12.000)");
assert(txExcConjA.cotizacionId === "cot-conjexcA-test" && txExcConjB.cotizacionId === "cot-conjexcB-test", "...ligado cada uno a su propia cotización, igual que el movimiento principal");
assert(txExcConjA.id !== compraConjExcA.txId && txExcConjB.id !== compraConjExcB.txId, "el movimiento de excedente es DISTINTO del movimiento del pedido en cada caso — dos movimientos, no uno mezclado");

state.pedidos = pedidosPreviosConjExcTest; state.cotizaciones = cotizacionesPreviasConjExcTest; state.tx = txPreviosConjExcTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva"; state.finanzasVista = "nuevo";
state.formCompraConjunta = { seleccion: [], porClave: {} };

// --- Sin interruptor "se fabrica en el taller / se compra a proveedor":
// una prenda comprada hecha es, desde 2026-09-21, un insumo más ("Prenda
// comprada a proveedor") en la MISMA tabla — el usuario lo pidió para
// simplificar el formulario: "eliminar la pestaña 'se compra a
// proveedor' y dejar... la camiseta como insumo y ahí decidir si se le
// agregan más cosas o no (insumos o procesos)". "Consumo tela (MT)"
// también se quitó del todo: "dejarlo en el insumo así como ya se está
// haciendo". Se prueba el caso completo del usuario (camiseta comprada +
// DTF + planchada, todo en la misma referencia), que la lista de compras
// separa las tres líneas, que el flujo de progreso cambia solo según los
// insumos, "Aplicar producto" para un producto de proveedor, y la
// migración retroactiva de cotizaciones ya guardadas con el modelo viejo.
const pedidosPreviosProvInsTest = state.pedidos, cotizacionesPreviasProvInsTest = state.cotizaciones,
  plantillasPreviasProvInsTest = state.plantillasPrendas, productosPreviosProvInsTest = state.productos;
state.plantillasPrendas = [{ id: "pla-provins-test", nombre: "Plantilla Provins", consumoSugerido: 1, imagenUrl: "", flujoEstadosId: "", insumos: [] }];
state.productos = [{ id: "pro-provins-test", nombre: "Producto Provins", origen: "taller", precioVenta: 1000, costoCompra: 0, proveedorId: "", imagenUrl: "", consumoSugerido: 1, flujoEstadosId: "", insumos: [], tallas: [] }];
state.clientes.push({ id: "cli-provins-test", nombre: "Cliente Provins", tipoRelacion: "cliente", cedula: "", ciudad: "", contactResourceNames: {}, preciosPorInsumo: [], fechaCreacion: "2026-01-01", roster: [] });
state.cotizaciones = [{
  id: "cot-provins-test", clienteId: "cli-provins-test", cliente: "Cliente Provins", descripcion: "Prueba insumo sobre compra", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cprovins1",
  referencias: [{
    id: "ref-provins-test", nombre: "Camiseta comprada", imagenUrl: "", cantidadPedida: 5, precioVenta: 35000,
    insumos: [], detalle: [], estado: "", estadosDef: []
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.pedidos = [];

state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-provins-test"]');
var refCardProvInsTest = document.querySelector('[data-ref-id="ref-provins-test"]');
assert(!refCardProvInsTest.querySelector('[data-action="set-ref-origen"]'), "ya no existe el interruptor \"se fabrica en el taller / se compra a proveedor\"");
assert(!!refCardProvInsTest.querySelector('[data-action="abrir-insumo-picker"][data-cot="cot-provins-test"][data-ref="ref-provins-test"]'), "toda referencia tiene la tabla de insumos (\"Insumos predeterminados…\")");
assert(!!refCardProvInsTest.querySelector('[data-action="add-insumo-personalizado"][data-cot="cot-provins-test"][data-ref="ref-provins-test"]'), "...y \"+ Insumo personalizado\"");
assert(!!refCardProvInsTest.querySelector('[data-action-change="aplicar-plantilla"]'), "\"Aplicar plantilla\" ya está siempre disponible — una prenda comprada hecha es un insumo más, no un caso especial que lo excluya");
assert(!!refCardProvInsTest.querySelector('[data-action-change="aplicar-producto"]'), "...y \"Aplicar producto\" también");
assert(!refCardProvInsTest.querySelector('input[data-campo="consumoAprox"]'), "\"Consumo tela (MT)\" ya no existe en ninguna referencia — cada tela lleva su propio consumo en su fila");
assert(refCardProvInsTest.textContent.indexOf("Sin insumos aún") !== -1, "sin insumos agregados todavía, se ve el mensaje vacío de siempre");

// -- se agrega la camiseta (comprada), un DTF (insumo) y una planchada (mano de obra) --
click('[data-action="add-insumo-personalizado"][data-cot="cot-provins-test"][data-ref="ref-provins-test"]');
var refTrasCamisetaTest = state.cotizaciones[0].referencias[0];
var camisetaIdTest = refTrasCamisetaTest.insumos[refTrasCamisetaTest.insumos.length - 1].id;
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + camisetaIdTest + '"][data-campo="nombre"]', "Camiseta comprada");
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + camisetaIdTest + '"][data-campo="costo"]', "20000");
setChange('[data-ref-id="ref-provins-test"] select[data-ins="' + camisetaIdTest + '"][data-campo="tipo"]', "producto_comprado");

const { etapasDe: etapasDeProvInsTest } = await import("../js/core/calc.js");
var refSoloComprada = state.cotizaciones[0].referencias[0];
assert(etapasDeProvInsTest(refSoloComprada).length === 2, "con SOLO la prenda comprada (nada del taller), el flujo de progreso es el corto Pendiente/Recibido, automático");

click('[data-action="add-insumo-personalizado"][data-cot="cot-provins-test"][data-ref="ref-provins-test"]');
var refTrasDtfTest = state.cotizaciones[0].referencias[0];
var dtfIdTest = refTrasDtfTest.insumos[refTrasDtfTest.insumos.length - 1].id;
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + dtfIdTest + '"][data-campo="nombre"]', "DTF");
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + dtfIdTest + '"][data-campo="costo"]', "3000");
setChange('[data-ref-id="ref-provins-test"] select[data-ins="' + dtfIdTest + '"][data-campo="tipo"]', "por_prenda");

var refConDtf = state.cotizaciones[0].referencias[0];
assert(etapasDeProvInsTest(refConDtf).length === 5, "en cuanto se agrega CUALQUIER insumo que no sea \"prenda comprada\" (el DTF), el flujo pasa solo al normal de 5 etapas");

click('[data-action="add-insumo-personalizado"][data-cot="cot-provins-test"][data-ref="ref-provins-test"]');
var refTrasPlanchadaTest = state.cotizaciones[0].referencias[0];
var planchadaIdTest = refTrasPlanchadaTest.insumos[refTrasPlanchadaTest.insumos.length - 1].id;
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + planchadaIdTest + '"][data-campo="nombre"]', "Planchada");
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + planchadaIdTest + '"][data-campo="costo"]', "2000");
setChange('[data-ref-id="ref-provins-test"] select[data-ins="' + planchadaIdTest + '"][data-campo="tipo"]', "por_prenda");
setChange('[data-ref-id="ref-provins-test"] input[data-ins="' + planchadaIdTest + '"][data-campo="unidad"]', "servicio");

const { calcCostoUnitarioRef: calcCostoUnitRefProvInsTest, calcRefTotales: calcRefTotalesProvInsTest, calcListaCompras: calcListaComprasProvInsTest } = await import("../js/core/calc.js");
var refFinalProvInsTest = state.cotizaciones[0].referencias[0];
assert(refFinalProvInsTest.insumos.length === 3, "los tres insumos (camiseta comprada, DTF y planchada) quedan en la misma referencia, sin ningún caso especial");
assert(calcCostoUnitRefProvInsTest(refFinalProvInsTest) === 25000, "el costo unitario es simplemente la suma de los tres insumos (20.000 + 3.000 + 2.000 = 25.000) — una sola fórmula, sin rama de \"origen\"");
assert(calcRefTotalesProvInsTest(refFinalProvInsTest).costoTotal === 125000, "...y el costo total de la referencia lo refleja (25.000 × 5 = 125.000)");

var cotProvInsTestObj = state.cotizaciones[0];
var listaProvInsTest = calcListaComprasProvInsTest(cotProvInsTestObj);
var lineaCamisetaTest = listaProvInsTest.filter(function (l) { return l.nombre === "Camiseta comprada"; })[0];
var lineaDtfTest = listaProvInsTest.filter(function (l) { return l.nombre === "DTF"; })[0];
var lineaPlanchadaTest = listaProvInsTest.filter(function (l) { return l.nombre === "Planchada"; })[0];
assert(!!lineaCamisetaTest && lineaCamisetaTest.tipo === "producto_comprado" && lineaCamisetaTest.esProducto === true && lineaCamisetaTest.clave === "producto|camiseta comprada" && lineaCamisetaTest.costoTotal === 100000, "la prenda comprada aparece como su propia línea en la lista de compras (📦, en unidades), con la MISMA clave \"producto|\"+nombre de siempre (20.000 × 5 = 100.000)");
assert(!!lineaDtfTest && lineaDtfTest.costoTotal === 15000, "...y APARTE, una línea propia para el DTF (3.000 × 5 = 15.000)");
assert(!!lineaPlanchadaTest && lineaPlanchadaTest.costoTotal === 10000 && lineaPlanchadaTest.esServicio === true, "...y otra para la Planchada (2.000 × 5 = 10.000), reconocida como mano de obra propia (esServicio)");

state.pedidos = pedidosPreviosProvInsTest; state.cotizaciones = cotizacionesPreviasProvInsTest;
state.plantillasPrendas = plantillasPreviasProvInsTest; state.productos = productosPreviosProvInsTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// -- "Aplicar producto" para un producto de catálogo origen "proveedor":
// ya NO reescribe la referencia entera (origen/costoCompra/insumos=[]) —
// inyecta UN insumo "producto_comprado" y se SUMA a lo que ya hubiera. --
const pedidosPreviosAplProdProvTest = state.pedidos, cotizacionesPreviasAplProdProvTest = state.cotizaciones,
  productosPreviosAplProdProvTest = state.productos;
state.productos = [{ id: "pro-aplprodprov-test", nombre: "Gorra de proveedor", origen: "proveedor", precioVenta: 15000, costoCompra: 8000, proveedorId: "", imagenUrl: "", consumoSugerido: 0, flujoEstadosId: "", insumos: [], tallas: [] }];
state.cotizaciones = [{
  id: "cot-aplprodprov-test", clienteId: "", cliente: "Cliente Aplprodprov", descripcion: "Prueba aplicar producto proveedor", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "caplprodprov1",
  referencias: [{
    id: "ref-aplprodprov-test", nombre: "", imagenUrl: "", cantidadPedida: 3, precioVenta: 0,
    insumos: [{ id: "ins-previo-aplprodprov", nombre: "Bordado previo", unidad: "UND", costo: 1000, tipo: "por_prenda", cantidad: 1, esServicio: false }],
    detalle: [], estado: "", estadosDef: []
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.pedidos = [];
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-aplprodprov-test"]');
setChange('[data-action-change="aplicar-producto"][data-cot="cot-aplprodprov-test"][data-ref="ref-aplprodprov-test"]', "pro-aplprodprov-test");
var refTrasAplProdProv = state.cotizaciones[0].referencias[0];
assert(refTrasAplProdProv.insumos.length === 2, "\"Aplicar producto\" de un producto de proveedor SUMA un insumo — no borra el que ya había (\"Bordado previo\")");
var insumoAplProdProv = refTrasAplProdProv.insumos.filter(function (i) { return i.tipo === "producto_comprado"; })[0];
assert(!!insumoAplProdProv && insumoAplProdProv.costo === 8000 && insumoAplProdProv.nombre === "Gorra de proveedor", "...y ese insumo nuevo trae el nombre y costo de compra del producto del catálogo");
assert(refTrasAplProdProv.productoId === "pro-aplprodprov-test", "la referencia queda vinculada al producto (para el descuento de stock al convertir en pedido), igual que con un producto de taller");

state.pedidos = pedidosPreviosAplProdProvTest; state.cotizaciones = cotizacionesPreviasAplProdProvTest;
state.productos = productosPreviosAplProdProvTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";

// -- Migración retroactiva: cotización vieja con el modelo "origen:
// proveedor" (sin insumos, costo de compra a nivel de referencia) — y una
// compra YA registrada (pagada, con su movimiento en Finanzas) sobre esa
// referencia, para confirmar que la migración no la desconecta. --
const cotizacionesPreviasMigProvTest = state.cotizaciones;
const cotViejaProvTest = {
  id: "cot-viejaprov-test", clienteId: "", cliente: "Cliente Vieja Prov", descripcion: "Prueba migración proveedor", fecha: "2026-01-01",
  estado: "convertida", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cviejaprov1",
  referencias: [{
    id: "ref-viejaprov-test", nombre: "Camiseta migrada", imagenUrl: "", consumoAprox: 0, cantidadPedida: 4, precioVenta: 30000,
    origen: "proveedor", costoCompra: 18000, proveedorId: "prov-viejo-test",
    insumos: [{ id: "ins-viejaprov-extra", nombre: "Bordado ya agregado", unidad: "UND", costo: 500, tipo: "por_prenda", cantidad: 1, esServicio: false }],
    detalle: [], estado: "", estadosDef: []
  }],
  costosGlobales: [], serviciosCobrados: [],
  // Compra YA registrada con la clave vieja "producto|"+nombre — tiene que
  // seguir encontrando su línea después de migrar, o quedaría huérfana.
  compras: [{ clave: "producto|camiseta migrada", estado: "si", costoReal: 72000, cantidadReal: 4, txId: "tx-viejaprov-test", observaciones: "" }]
};
state.cotizaciones = [cotViejaProvTest];
const { repararReferenciasProveedorAInsumo: repararProvTest } = await import("../js/core/store.js");
const huboMigracionProvTest = repararProvTest(state.cotizaciones);
assert(huboMigracionProvTest === true, "la migración detecta la referencia vieja con origen \"proveedor\"");
var refMigradaProvTest = state.cotizaciones[0].referencias[0];
assert(refMigradaProvTest.origen !== "proveedor", "...y la deja sin el origen viejo (para no volver a migrarla en el próximo loadAll)");
assert(refMigradaProvTest.insumos.length === 2, "gana un insumo \"prenda comprada\" nuevo, SIN perder el que ya tenía (\"Bordado ya agregado\")");
var insumoMigradoProvTest = refMigradaProvTest.insumos.filter(function (i) { return i.tipo === "producto_comprado"; })[0];
assert(!!insumoMigradoProvTest && insumoMigradoProvTest.costo === 18000 && insumoMigradoProvTest.proveedorId === "prov-viejo-test", "...con el MISMO costo de compra y proveedor que ya tenía la referencia — no cambia ni un peso de lo ya cotizado");

const { calcListaCompras: calcListaComprasMigProvTest, compraDeLinea: compraDeLineaMigProvTest } = await import("../js/core/calc.js");
var listaMigProvTest = calcListaComprasMigProvTest(state.cotizaciones[0]);
var lineaMigProvTest = listaMigProvTest.filter(function (l) { return l.nombre === "Camiseta migrada"; })[0];
assert(!!lineaMigProvTest && lineaMigProvTest.clave === "producto|camiseta migrada", "la línea migrada usa la MISMA clave que ya usaba (\"producto|\"+nombre) — no una nueva basada en unidad/tipo");
var compraYaRegistradaTest = compraDeLineaMigProvTest(state.cotizaciones[0], "producto|camiseta migrada");
assert(!!compraYaRegistradaTest && compraYaRegistradaTest.txId === "tx-viejaprov-test" && compraYaRegistradaTest.costoReal === 72000, "...así que la compra YA registrada (con su movimiento real en Finanzas) sigue encontrando su línea después de migrar, en vez de quedar huérfana");

const huboSegundaMigracionProvTest = repararProvTest(state.cotizaciones);
assert(huboSegundaMigracionProvTest === false, "correr la migración de nuevo sobre una referencia ya migrada no hace nada (es idempotente: origen ya no es \"proveedor\")");

state.cotizaciones = cotizacionesPreviasMigProvTest;

// ---------------------------------------------------------------------------
// Enlace de cantidad entre insumos, por CATEGORÍA o por insumo ESPECÍFICO
// (ver renderEnlacePanel en core/components.js). El usuario notó, el mismo
// día que se independizó el consumo de cada tela (Hallazgo #28), que eso
// volvió MANUAL algo que antes se actualizaba solo: un insumo como
// "Sublimación" (o "Corte") necesita sumar la cantidad de todas las telas
// de la referencia. Primer intento (enlazar por TIPO de costo) corregido
// el mismo día por el usuario: "el desplegable de enlace está mal... lo
// que quiero enlazar son cantidades" — lo que corresponde es la CATEGORÍA
// del catálogo (con subcategorías incluidas) o un insumo puntual elegido
// con buscador, con checkboxes para agregar/quitar, no un solo valor.
// ---------------------------------------------------------------------------

// -- cantidadEfectivaInsumo: el cálculo puro --
const { cantidadEfectivaInsumo: cantEfectivaTest } = await import("../js/core/calc.js");
const categoriasEnlaceTest = [
  { id: "cat-telas-enl", nombre: "Telas", parentId: "" },
  { id: "cat-telasdeportivas-enl", nombre: "Telas Deportivas", parentId: "cat-telas-enl" }
];
const contEnlaceTest = {
  insumos: [
    { id: "tA-enl", tipo: "tela", cantidad: 1, categoriaId: "cat-telas-enl", nombre: "Tela madre" },
    { id: "tB-enl", tipo: "tela", cantidad: 2, categoriaId: "cat-telasdeportivas-enl", nombre: "Tela subcategoría" },
    { id: "boton-enl", tipo: "por_prenda", cantidad: 5, categoriaId: "", nombre: "Botón especial" },
    { id: "sub-enl", tipo: "por_prenda", cantidad: 99, categoriaId: "", nombre: "Sublimación", enlace: { categorias: ["cat-telas-enl"], insumos: [] } }
  ]
};
const prevCatalogoCategoriasEnlaceTest = state.catalogoCategorias;
state.catalogoCategorias = categoriasEnlaceTest;
assert(cantEfectivaTest(contEnlaceTest.insumos[3], contEnlaceTest) === 3, "un insumo enlazado a la categoría \"Telas\" suma la MADRE (1) y su SUBCATEGORÍA \"Telas Deportivas\" (2) = 3 — el ejemplo exacto que dio el usuario, incluyendo subcategorías solas — ignorando su propia cantidad manual guardada (99)");
contEnlaceTest.insumos[3].enlace = { categorias: ["cat-telas-enl"], insumos: ["botón especial"] };
assert(cantEfectivaTest(contEnlaceTest.insumos[3], contEnlaceTest) === 8, "categoría + insumo específico se COMBINAN (suman juntos): 1 + 2 de la categoría, más 5 del insumo puntual \"Botón especial\" = 8");
assert(cantEfectivaTest(contEnlaceTest.insumos[0], contEnlaceTest) === 1, "un insumo SIN enlace sigue devolviendo su cantidad escrita a mano, sin cambios");
const contSelfEnlaceTest = { insumos: [{ id: "x-enl", tipo: "tela", cantidad: 5, categoriaId: "cat-telas-enl", nombre: "x", enlace: { categorias: ["cat-telas-enl"], insumos: [] } }] };
assert(cantEfectivaTest(contSelfEnlaceTest.insumos[0], contSelfEnlaceTest) === 0, "un insumo enlazado a su PROPIA categoría no se suma a sí mismo — sin insumos hermanos, la suma es 0, no su propia cantidad");
assert(cantEfectivaTest(null, contEnlaceTest) === 0, "sin insumo, no truena: devuelve 0");
state.catalogoCategorias = prevCatalogoCategoriasEnlaceTest;

// -- flujo completo en una cotización: 2 telas (madre + subcategoría) + "Sublimación" enlazada por categoría --
const pedidosPreviosEnlaceTest = state.pedidos, cotizacionesPreviasEnlaceTest = state.cotizaciones,
  catCategoriasPreviasEnlaceTest = state.catalogoCategorias;
state.catalogoCategorias = categoriasEnlaceTest;
state.cotizaciones = [{
  id: "cot-enlace-test", clienteId: "", cliente: "Cliente Enlace", descripcion: "Prueba enlace", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cenlace1",
  referencias: [{
    id: "ref-enlace-test", nombre: "Camiseta sublimada", imagenUrl: "", cantidadPedida: 10, precioVenta: 50000,
    insumos: [
      { id: "ins-telaA-test", nombre: "Tela A", unidad: "m", costo: 20000, tipo: "tela", cantidad: 1, categoriaId: "cat-telas-enl", consumoPropio: true, esServicio: false, enlace: { categorias: [], insumos: [] } },
      { id: "ins-telaB-test", nombre: "Tela B", unidad: "m", costo: 15000, tipo: "tela", cantidad: 2, categoriaId: "cat-telasdeportivas-enl", consumoPropio: true, esServicio: false, enlace: { categorias: [], insumos: [] } },
      { id: "ins-sub-test", nombre: "Sublimación", unidad: "m", costo: 5000, tipo: "por_prenda", cantidad: 1, categoriaId: "", esServicio: false, enlace: { categorias: [], insumos: [] } }
    ],
    detalle: [], estado: "", estadosDef: []
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.pedidos = [];
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-enlace-test"]');
assert(!!document.querySelector('button[data-action="toggle-enlace-panel"][data-ins="ins-sub-test"]'), "cada insumo enlazable de una referencia tiene su propio botón \"Enlace\"");
assert(!!document.querySelector('input[data-ins="ins-sub-test"][data-campo="cantidad"]'), "sin enlazar todavía, \"Cant.\" de Sublimación sigue siendo un campo editable normal");
assert(document.querySelector('button[data-action="toggle-enlace-panel"][data-ins="ins-sub-test"]').textContent.indexOf("Sin enlace") !== -1, "...y el botón dice \"Sin enlace\"");

click('[data-action="toggle-enlace-panel"][data-ins="ins-sub-test"]');
assert(!!document.querySelector('input[data-action="toggle-ins-enlace-categoria"][data-ins="ins-sub-test"][data-cat="cat-telas-enl"]'), "al abrir el panel aparecen las categorías del catálogo como checkboxes (no un desplegable de tipos de costo)");
click('[data-action="toggle-ins-enlace-categoria"][data-ins="ins-sub-test"][data-cat="cat-telas-enl"]');
var refTrasEnlazarTest = state.cotizaciones[0].referencias[0];
assert(refTrasEnlazarTest.insumos.filter(function (i) { return i.id === "ins-sub-test"; })[0].enlace.categorias.indexOf("cat-telas-enl") !== -1, "marcar la categoría \"Telas\" la agrega a la lista de enlace del insumo");
assert(!document.querySelector('input[data-ins="ins-sub-test"][data-campo="cantidad"]'), "una vez enlazada, \"Cant.\" de Sublimación DEJA de ser un campo editable...");
var celdaCantSubTest = document.querySelector('[data-ins-row][data-ins="ins-sub-test"]').textContent;
assert(celdaCantSubTest.indexOf("🔗 3") !== -1, "...y muestra la suma ya calculada (madre 1 + subcategoría 2 = 3), con el ícono de enlace");
const { calcCostoPrenda: calcCostoPrendaEnlaceTest, calcListaCompras: calcListaComprasEnlaceTest } = await import("../js/core/calc.js");
assert(calcCostoPrendaEnlaceTest(refTrasEnlazarTest.insumos[2], refTrasEnlazarTest) === 15000, "el costo x prenda de Sublimación ya usa la cantidad enlazada (5.000 × 3 = 15.000)");

// -- buscar y agregar un insumo ESPECÍFICO además de la categoría (se combinan) --
click('[data-action="add-insumo-personalizado"][data-cot="cot-enlace-test"][data-ref="ref-enlace-test"]');
var refTrasBotonTest = state.cotizaciones[0].referencias[0];
var botonIdTest = refTrasBotonTest.insumos[refTrasBotonTest.insumos.length - 1].id;
setChange('[data-ref-id="ref-enlace-test"] input[data-ins="' + botonIdTest + '"][data-campo="nombre"]', "Botón especial");
setChange('[data-ref-id="ref-enlace-test"] input[data-ins="' + botonIdTest + '"][data-campo="cantidad"]', "4");
setChange('[data-action-change="set-enlace-busqueda"][data-ins="ins-sub-test"]', "botón");
assert(!!document.querySelector('input[data-action="toggle-ins-enlace-insumo"][data-ins="ins-sub-test"][data-nombre="botón especial"]'), "el buscador filtra los insumos de ESTA referencia por nombre y ofrece un checkbox por cada uno");
click('[data-action="toggle-ins-enlace-insumo"][data-ins="ins-sub-test"][data-nombre="botón especial"]');
var refTrasInsumoEspecificoTest = state.cotizaciones[0].referencias[0];
var subConAmbosTest = refTrasInsumoEspecificoTest.insumos.filter(function (i) { return i.id === "ins-sub-test"; })[0];
assert(subConAmbosTest.enlace.insumos.indexOf("botón especial") !== -1, "marcar un insumo específico lo agrega, junto a la categoría ya marcada (no la reemplaza)");
assert(calcCostoPrendaEnlaceTest(subConAmbosTest, refTrasInsumoEspecificoTest) === 5000 * (3 + 4), "el costo de Sublimación ahora suma la categoría (3) MÁS el insumo específico (4) = 7 — categoría e insumo puntual se combinan, no son modos exclusivos");

// -- corregir una tela ACTUALIZA sola la cantidad enlazada, sin tocar la fila de Sublimación --
setChange('[data-ins="ins-telaA-test"][data-campo="cantidad"]', "1.5");
var refTrasCorregirTest = state.cotizaciones[0].referencias[0];
var subTrasCorregirTest = refTrasCorregirTest.insumos.filter(function (i) { return i.id === "ins-sub-test"; })[0];
assert(calcCostoPrendaEnlaceTest(subTrasCorregirTest, refTrasCorregirTest) === 5000 * (1.5 + 2 + 4), "al corregir la Tela A de 1 a 1.5, el costo de Sublimación sube SOLO — para eso se pidió el enlace, que \"en caso de que haya una modificación esta actualice las otras cantidades\"");

// -- quitar TODOS los enlaces CONGELA el último valor calculado, no salta al viejo (1) --
// (se quita primero la categoría: eso deja SOLO el insumo específico activo,
// así que el valor "vivo" baja de 7.5 a 4 — el insumo puntual solo, sin la
// categoría — ANTES de quitar también el insumo específico)
click('[data-action="toggle-ins-enlace-categoria"][data-ins="ins-sub-test"][data-cat="cat-telas-enl"]');
click('[data-action="toggle-ins-enlace-insumo"][data-ins="ins-sub-test"][data-nombre="botón especial"]');
var subTrasDesenlazarTest = state.cotizaciones[0].referencias[0].insumos.filter(function (i) { return i.id === "ins-sub-test"; })[0];
assert(!subTrasDesenlazarTest.enlace.categorias.length && !subTrasDesenlazarTest.enlace.insumos.length, "quitar los dos checkboxes deja la lista de enlace vacía");
assert(subTrasDesenlazarTest.cantidad === 4, "...y CONGELA la cantidad en el último valor que de verdad estaba vivo justo antes de quitar el último enlace (solo el insumo específico, 4 — ya sin la categoría, quitada un paso antes) en vez de saltar al valor manual viejo (1) que tenía guardado desde antes de enlazarse");
assert(!!document.querySelector('input[data-ins="ins-sub-test"][data-campo="cantidad"]'), "y \"Cant.\" vuelve a ser un campo editable normal");

state.pedidos = pedidosPreviosEnlaceTest; state.cotizaciones = cotizacionesPreviasEnlaceTest;
state.catalogoCategorias = catCategoriasPreviasEnlaceTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";
state.enlacePanelAbierto = {}; state.enlaceBusqueda = {};

// -- predefinir el enlace en el Catálogo: se hereda solo al agregar el insumo --
const pedidosPreviosEnlaceCatTest = state.pedidos, cotizacionesPreviasEnlaceCatTest = state.cotizaciones,
  catalogoPrevioEnlaceCatTest = state.catalogoInsumos, catCategoriasPreviasEnlaceCatTest = state.catalogoCategorias;
state.catalogoCategorias = categoriasEnlaceTest;
state.catalogoInsumos = state.catalogoInsumos.concat([
  { id: "cat-sub-enlace-test", nombre: "Sublimación predefinida", unidad: "m", costo: 4000, tipo: "por_prenda", categoriaId: "", proveedorId: "", enlace: { categorias: ["cat-telas-enl"], insumos: [] } }
]);
state.cotizaciones = [{
  id: "cot-enlacecat-test", clienteId: "", cliente: "Cliente Enlace Cat", descripcion: "Prueba enlace desde catálogo", fecha: "2026-01-01",
  estado: "borrador", pedidoId: "", pedidoOrigenId: "",
  vendedor: null, gastosReales: [], iva: { activo: false, porcentaje: 19 }, codigoPublico: "cenlacecat1",
  referencias: [{
    id: "ref-enlacecat-test", nombre: "Ref enlace catálogo", imagenUrl: "", cantidadPedida: 1, precioVenta: 0,
    insumos: [
      { id: "ins-telaX-enlacecat", nombre: "Tela X", unidad: "m", costo: 10000, tipo: "tela", cantidad: 2, categoriaId: "cat-telas-enl", consumoPropio: true, esServicio: false, enlace: { categorias: [], insumos: [] } }
    ],
    detalle: [], estado: "", estadosDef: []
  }],
  costosGlobales: [], serviciosCobrados: [], compras: []
}];
state.pedidos = [];
state.tab = "cotizaciones"; state.cotizacionesVista = "historial"; render();
click('[data-action="abrir-cotizacion-editor"][data-id="cot-enlacecat-test"]');
click('[data-action="abrir-insumo-picker"][data-cot="cot-enlacecat-test"][data-ref="ref-enlacecat-test"]');
click('[data-action="toggle-insumo-picker-item"][data-id="cat-sub-enlace-test"]');
click('[data-action="confirmar-insumo-picker"]');
var refTrasPickerEnlaceTest = state.cotizaciones[0].referencias[0];
var subDelCatalogoTest = refTrasPickerEnlaceTest.insumos.filter(function (i) { return i.origenCatalogoId === "cat-sub-enlace-test"; })[0];
assert(!!subDelCatalogoTest && subDelCatalogoTest.enlace.categorias.indexOf("cat-telas-enl") !== -1, "un insumo del catálogo con enlace PREDEFINIDO (categoría) lo trae ya puesto al agregarlo — no hay que configurarlo cada vez");
const { calcCostoPrenda: calcCostoPrendaEnlaceCatTest } = await import("../js/core/calc.js");
assert(calcCostoPrendaEnlaceCatTest(subDelCatalogoTest, refTrasPickerEnlaceTest) === 8000, "...y su costo ya refleja la suma (4.000 × 2m de Tela X = 8.000), sin que el usuario haya tocado nada más");

state.pedidos = pedidosPreviosEnlaceCatTest; state.cotizaciones = cotizacionesPreviasEnlaceCatTest;
state.catalogoInsumos = catalogoPrevioEnlaceCatTest; state.catalogoCategorias = catCategoriasPreviasEnlaceCatTest;
state.cotizacionEditando = ""; state.cotizacionesVista = "nueva";
state.enlacePanelAbierto = {}; state.enlaceBusqueda = {};

// -- también editable en Plantillas (el usuario lo pidió explícito) --
const plantillasPreviasEnlaceTest = state.plantillasPrendas, catCategoriasPreviasEnlacePlaTest = state.catalogoCategorias;
state.catalogoCategorias = categoriasEnlaceTest;
state.plantillasPrendas = [{
  id: "pla-enlace-test", nombre: "Plantilla enlace", consumoSugerido: 1, imagenUrl: "", flujoEstadosId: "",
  insumos: [
    { id: "plains-telaA-enlace", nombre: "Tela plantilla A", unidad: "m", costo: 8000, tipo: "tela", cantidad: 1, categoriaId: "cat-telas-enl", enlace: { categorias: [], insumos: [] } },
    { id: "plains-telaB-enlace", nombre: "Tela plantilla B", unidad: "m", costo: 6000, tipo: "tela", cantidad: 1, categoriaId: "cat-telas-enl", enlace: { categorias: [], insumos: [] } },
    { id: "plains-corte-enlace", nombre: "Corte", unidad: "m", costo: 2000, tipo: "por_prenda", cantidad: 1, categoriaId: "", enlace: { categorias: [], insumos: [] } }
  ]
}];
state.tab = "plantillas"; state.plantillasVista = "plantillas"; state.plantillaEditando = "pla-enlace-test"; render();
assert(!!document.querySelector('button[data-action="toggle-enlace-panel"][data-pla="pla-enlace-test"][data-ins="plains-corte-enlace"]'), "Plantillas también tiene el botón \"Enlace\" por insumo");
click('[data-action="toggle-enlace-panel"][data-pla="pla-enlace-test"][data-ins="plains-corte-enlace"]');
click('[data-action="toggle-pla-ins-enlace-categoria"][data-pla="pla-enlace-test"][data-ins="plains-corte-enlace"][data-cat="cat-telas-enl"]');
var plaTrasEnlaceTest = state.plantillasPrendas[0];
assert(!document.querySelector('input[data-pla="pla-enlace-test"][data-ins="plains-corte-enlace"][data-campo="cantidad"]'), "enlazado, \"Cant./mult.\" de Corte deja de ser editable en Plantillas también");
const { calcCostoUnitarioRef: calcCostoUnitRefEnlacePlaTest } = await import("../js/core/calc.js");
assert(calcCostoUnitRefEnlacePlaTest({ insumos: plaTrasEnlaceTest.insumos, cantidadPedida: 1 }) === 8000 + 6000 + 2000 * 2, "el costo por prenda de la plantilla YA refleja el enlace: Corte cuesta 2.000 × (1 + 1) = 4.000, sumado a las dos telas (8.000 + 6.000 + 4.000 = 18.000)");
state.plantillasPrendas = plantillasPreviasEnlaceTest; state.catalogoCategorias = catCategoriasPreviasEnlacePlaTest;
state.plantillaEditando = ""; state.plantillasVista = "plantillas";
state.enlacePanelAbierto = {}; state.enlaceBusqueda = {};

// -- también editable en Productos (mismo pedido explícito del usuario) --
const productosPreviosEnlaceTest = state.productos, catCategoriasPreviasEnlaceProTest = state.catalogoCategorias;
state.catalogoCategorias = categoriasEnlaceTest;
state.productos = [{
  id: "pro-enlace-test", nombre: "Producto enlace", origen: "taller", precioVenta: 0, costoCompra: 0, proveedorId: "", imagenUrl: "", consumoSugerido: 1, flujoEstadosId: "",
  insumos: [
    { id: "proins-telaA-enlace", nombre: "Tela producto A", unidad: "m", costo: 5000, tipo: "tela", cantidad: 1, categoriaId: "cat-telas-enl", enlace: { categorias: [], insumos: [] } },
    { id: "proins-telaB-enlace", nombre: "Tela producto B", unidad: "m", costo: 3000, tipo: "tela", cantidad: 1, categoriaId: "cat-telas-enl", enlace: { categorias: [], insumos: [] } },
    { id: "proins-corte-enlace", nombre: "Corte producto", unidad: "m", costo: 1000, tipo: "por_prenda", cantidad: 1, categoriaId: "", enlace: { categorias: [], insumos: [] } }
  ],
  tallas: []
}];
state.tab = "productos"; state.productosVista = "nueva"; state.productoEditando = "pro-enlace-test"; render();
assert(!!document.querySelector('button[data-action="toggle-enlace-panel"][data-pro="pro-enlace-test"][data-ins="proins-corte-enlace"]'), "Productos también tiene el botón \"Enlace\" por insumo");
click('[data-action="toggle-enlace-panel"][data-pro="pro-enlace-test"][data-ins="proins-corte-enlace"]');
click('[data-action="toggle-pro-ins-enlace-categoria"][data-pro="pro-enlace-test"][data-ins="proins-corte-enlace"][data-cat="cat-telas-enl"]');
var proTrasEnlaceTest = state.productos[0];
assert(!document.querySelector('input[data-pro="pro-enlace-test"][data-ins="proins-corte-enlace"][data-campo="cantidad"]'), "enlazado, \"Cant./mult.\" de Corte deja de ser editable en Productos también");
const { calcTotalesProducto: calcTotalesEnlaceProTest } = await import("../js/core/calc.js");
assert(calcTotalesEnlaceProTest(proTrasEnlaceTest).costoUnit === 5000 + 3000 + 1000 * 2, "el costo del producto YA refleja el enlace: Corte cuesta 1.000 × (1 + 1) = 2.000, sumado a las dos telas (5.000 + 3.000 + 2.000 = 10.000)");
state.productos = productosPreviosEnlaceTest; state.catalogoCategorias = catCategoriasPreviasEnlaceProTest;
state.productoEditando = ""; state.productosVista = "nueva";
state.enlacePanelAbierto = {}; state.enlaceBusqueda = {};

console.log("\n✅ Todos los checks de humo pasaron.");
// Salida explícita: la parte de permisos simula una sesión de Google (ver
// loginComo), así que persist() intenta escribir de verdad en la Sheet y deja
// reintentos de red colgando. Sin esto el proceso quedaba vivo varios minutos
// después de haber pasado todos los checks, como si la prueba se hubiera
// trabado. Los errores de red que aparecen en consola son de ese mismo
// escenario simulado, no de la app.
process.exit(0);
