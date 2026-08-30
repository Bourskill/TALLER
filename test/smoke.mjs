import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><div id=\"app\"></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.CustomEvent = dom.window.CustomEvent;
global.Blob = dom.window.Blob || class {};
global.URL = dom.window.URL;
if (!global.URL.createObjectURL) global.URL.createObjectURL = () => "blob:mock";
if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
global.alert = dom.window.alert = () => {}; // jsPDF no está cargado en este entorno de prueba
global.confirm = dom.window.confirm = () => true; // simula que el usuario siempre acepta el confirm()
global.sessionStorage = dom.window.sessionStorage; // para simular login de vendedor/admin (ver core/auth.js)

// Mock mínimo de window.storage (interfaz get/set de core/sheetsStorage.js) en
// memoria — sin esto STORAGE_OK queda en false y persist() es un no-op total,
// lo que dejaría sin probar el gate de aprobación para vendedores (vive
// DENTRO de persist(), ver core/store.js). Debe asignarse ANTES de importar
// core/store.js: STORAGE_OK se evalúa una sola vez, al cargar ese módulo.
const _memStorage = {};
global.window.storage = {
  get: async function (key) { return _memStorage[key] !== undefined ? { value: _memStorage[key] } : null; },
  set: async function (key, value) { _memStorage[key] = value; return true; }
};

const { render } = await import("../js/core/dom.js");
const { loadAll, state } = await import("../js/core/store.js");
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

// --- pedidos: pestañas "+ Nuevo pedido" / "Historial" — mismo patrón ---
click('[data-action="tab"][data-tab="pedidos"]');
assert(state.pedidosVista === "nueva" && !!document.querySelector('[data-form="pedido"][data-field="cliente"]'), "Pedidos entra mostrando el formulario en blanco");

// --- pedidos: crear pedido vinculado al cliente + abono inicial ---
// El total y el costo del pedido ya NO son campos que se escriban: salen de
// las líneas (ver renderPrecioYPago en modules/pedidos.js), así que crear un
// pedido pasa por agregar al menos una línea con su cantidad y su precio.
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
assert(document.querySelector(".combo-item"), "sugiere el cliente en el combobox");
click('.combo-item[data-action="select-cliente"]');
assert(state.formPedido.clienteId === state.clientes[0].id, "vincula clienteId en el combobox");
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

// --- catálogo: agrega un insumo reutilizable ---
click('[data-action="tab"][data-tab="catalogo"]');
click('[data-action="add-cat-item"]');
assert(state.catalogoInsumos.length > 0, "el catálogo trae insumos semilla + el agregado");
const catItemId = state.catalogoInsumos[state.catalogoInsumos.length - 1].id;

// --- plantillas: agrega una plantilla con un insumo desde el catálogo ---
click('[data-action="tab"][data-tab="plantillas"]');
const plantillasPrevias = state.plantillasPrendas.length;
click('[data-action="add-plantilla"]');
assert(state.plantillasPrendas.length === plantillasPrevias + 1, "agrega plantilla");
const nuevaPlaId = state.plantillasPrendas[state.plantillasPrendas.length - 1].id;
const plaCard = document.querySelector('[data-plantilla-id="' + nuevaPlaId + '"]');
const plaSelect = plaCard.querySelector('select[data-action-change="add-pla-insumo-catalogo"]');
plaSelect.value = catItemId;
plaSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(
  state.plantillasPrendas.find(p => p.id === nuevaPlaId).insumos.length === 1,
  "agrega insumo del catálogo a la plantilla"
);

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
setInput('[data-form="cotizacion"][data-field="cliente"]', "Cliente Prueba");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Uniformes de prueba");
click('[data-action="add-cotizacion"]');
assert(state.cotizaciones.length === 1, "crea cotización");
assert(state.cotizaciones[0].referencias.length === 1, "la cotización nace con una referencia en blanco");

const cotId = state.cotizaciones[0].id;
const refId = state.cotizaciones[0].referencias[0].id;

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
assert(state.insumoPickerAbierto === cotId, "el explorador de insumos se abre sobre la referencia elegida");
assert(!!document.querySelector(".picker-modal"), "el modal del explorador se renderiza");
assert(!!document.querySelector('[data-action="set-insumo-picker-categoria"][data-val="todos"]'), "el explorador lista las categorías en el panel lateral");
assert(!!document.querySelector("#inp-insumo-picker-buscar"), "el explorador tiene barra de búsqueda");
click('[data-action="toggle-insumo-picker-item"][data-id="' + catItemId + '"]');
assert(state.insumoPickerSeleccion.length === 1, "marcar un insumo lo agrega a la selección múltiple");
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

click('[data-action="toggle-pend-form"][data-key="gastoFijo"]');
setInput('[data-form="gastoFijo"][data-field="nombre"]', "Arriendo");
setInput('[data-form="gastoFijo"][data-field="monto"]', "500000");
click('[data-action="add-gasto-fijo"]');
assert(state.config.gastosFijos.length === 1, "agrega gasto fijo");
assert(state.config.gastosFijos[0].periodo === "mensual", "gasto fijo nace con periodo mensual por defecto");

click('[data-action="toggle-pend-form"][data-key="deuda"]');
setInput('[data-form="deuda"][data-field="concepto"]', "Préstamo máquina");
setInput('[data-form="deuda"][data-field="monto"]', "300000");
click('[data-action="add-deuda"]');
assert(state.deudas.length === 1, "agrega deuda");
assert(state.deudas[0].concepto === "Préstamo máquina", "deuda nace con los datos del formulario");
assert(state.deudasHistorial.length === 0, "deuda recién creada no aparece en el historial (sigue pendiente)");

// --- KPIs sincronizados: "por cobrar" debe reflejar el saldo de pedidos ---
const { calcPorCobrar, calcPorPagar } = await import("../js/core/calc.js");
const pedidoConSaldo = state.pedidos.find(p => (p.total - p.abono) > 0);
assert(!!pedidoConSaldo, "hay al menos un pedido con saldo (para probar el KPI)");
assert(calcPorCobrar() >= (pedidoConSaldo.total - pedidoConSaldo.abono), "Por cobrar incluye el saldo de pedidos");
assert(calcPorPagar() >= (state.deudas[0].monto + state.config.gastosFijos[0].monto), "Por pagar incluye gastos fijos y deudas pendientes");

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

// --- cotizaciones: el cliente es editable directamente en la cabecera del detalle ---
const cotClienteInput = document.querySelector('.cot-cliente-input[data-id="' + cotConvertida.id + '"]');
assert(!!cotClienteInput, "el nombre del cliente de la cotización se edita con un input en la cabecera");
cotClienteInput.value = "Cliente Prueba Renombrado";
cotClienteInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.cotizaciones.find(c => c.id === cotConvertida.id).cliente === "Cliente Prueba Renombrado", "editar el input de cliente actualiza el nombre en la cotización");

// --- pedidos: comisión de vendedor ---
// Pedidos ahora se divide en pestañas "+ Nuevo pedido" / "Historial" (mismo
// patrón que Cotizaciones) — tras convertir la cotización quedó viendo el
// Historial (para mostrar el pedido recién creado), así que hay que volver
// explícitamente al formulario en blanco antes de poder llenarlo de nuevo.
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
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
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
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
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
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

// --- cotizaciones: aplicar un producto del catálogo a una referencia también
// descuenta stock — pero solo al convertir en pedido, agrupando las filas de
// "Tallas y observaciones" por talla ---
click('[data-action="tab"][data-tab="cotizaciones"]');
click('[data-action="cerrar-cotizacion-editor"]'); // la pestaña "nueva" seguía mostrando el detalle de la cotización abierta antes
setInput('[data-form="cotizacion"][data-field="cliente"]', "Cliente Prueba");
setInput('[data-form="cotizacion"][data-field="descripcion"]', "Uniformes con producto de catálogo");
click('[data-action="add-cotizacion"]');
const cotProdId = state.cotizaciones[0].id;
const refProdId = state.cotizaciones[0].referencias[0].id;
const aplicarProductoSelect = document.querySelector('select[data-action-change="aplicar-producto"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
aplicarProductoSelect.value = productoId;
aplicarProductoSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert(state.cotizaciones[0].referencias[0].productoId === productoId, "vincula la referencia al producto del catálogo");
click('[data-action="toggle-ref-seccion"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
document.querySelector('[data-role="det-nombre-' + refProdId + '"]').value = "Talla M unidad 1";
document.querySelector('[data-role="det-talla-' + refProdId + '"]').value = "M";
click('[data-action="add-ref-detalle"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
document.querySelector('[data-role="det-nombre-' + refProdId + '"]').value = "Talla M unidad 2";
document.querySelector('[data-role="det-talla-' + refProdId + '"]').value = "M";
click('[data-action="add-ref-detalle"][data-cot="' + cotProdId + '"][data-ref="' + refProdId + '"]');
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
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
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
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
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
assert(!!origenSistemaHuerfano(txHuerfano), "y se reconoce como huérfano, para poder avisarlo en pantalla");

click('[data-action="tab"][data-tab="finanzas"]');
click('[data-action="finanzas-vista"][data-val="historial"]');
assert(!!document.querySelector('[data-action="filtro-tx"][data-val="huerfanos"]'), "aparece el filtro para encontrar los movimientos sueltos");
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
function tecla(key, opts) {
  const o = Object.assign({ key: key, bubbles: true, cancelable: true }, opts || {});
  const destino = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : document;
  destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", o));
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
// Servicios que se le cobran aparte al cliente (el diseño). Lo que se prueba
// no es que cada cálculo funcione por separado, sino que los MISMOS números
// sobrevivan cotización → pedido → líneas → reporte, con igualdad exacta.
// ---------------------------------------------------------------------------
const calcMod = await import("../js/core/calc.js");

state.tab = "cotizaciones";
state.cotizacionEditando = "";
render();
setInput('[data-form="cotizacion"][data-field="cliente"]', "Cliente Diseño");
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
const refProveedor = { id: "r1", origen: "proveedor", estado: "pendiente", estadosDef: null };
const refTaller = { id: "r2", origen: "taller", estado: "cortado", estadosDef: null };

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
  { id: "rp", origen: "proveedor", estado: "recibido", estadosDef: null },
  { id: "rt", origen: "taller", estado: "confeccion", estadosDef: null }
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
// Ajustes de feedback (Insumos + estados de producción).
// ---------------------------------------------------------------------------

// Unidad "conocida": el datalist compartido ya no es una lista fija — aprende
// de lo que se escribe en cualquier campo de unidad de la app.
state.catalogoInsumos = [{ id: "iu1", nombre: "Cinta rara", unidad: "rollo-40m", costo: 1000, tipo: "por_prenda", categoriaId: "", proveedorId: "" }];
assert(calcMod.unidadesConocidas().includes("rollo-40m"), "una unidad escrita en cualquier insumo queda disponible como sugerencia para los demás campos");
assert(calcMod.unidadesConocidas().includes("UND"), "las sugerencias de base (UND, MT…) siguen ahí aunque no se hayan usado todavía");

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

// El toggle "pasa por producción" del formulario de pedido rápido.
state.tab = "pedidos";
state.pedidosVista = "nueva";
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

// La cotización: la referencia hereda "servicio" al copiar el insumo desde
// el catálogo (por el picker), aunque la copia no guarde categoriaId.
state.tab = "cotizaciones";
state.cotizacionEditando = "";
render();
setInput('[data-form="cotizacion"][data-field="cliente"]', "Cliente Servicio");
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
const plaCardServ = document.querySelector('[data-plantilla-id="' + plaServId + '"]');
const plaSelectServ = plaCardServ.querySelector('select[data-action-change="add-pla-insumo-catalogo"]');
plaSelectServ.value = insConfeccion.id;
plaSelectServ.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const plaInsServ = state.plantillasPrendas.find(p => p.id === plaServId).insumos[0];
assert(plaInsServ.esServicio === true, "add-pla-insumo-catalogo (plantillas.js) también resuelve 'servicio' al copiar del catálogo, no solo el picker de una referencia");

state.tab = "productos";
state.productosVista = "nueva";
state.productoEditando = "";
render();
setInput('[data-form="producto"][data-field="nombre"]', "Producto de prueba servicio");
click('[data-action="add-producto"]');
const proServId = state.productos[state.productos.length - 1].id;
click('[data-action="toggle-producto-costeo"][data-id="' + proServId + '"]'); // la sección de insumos nace colapsada
click('[data-action="abrir-insumo-picker-producto"][data-pro="' + proServId + '"]');
click('[data-action="toggle-insumo-picker-producto-item"][data-id="' + insConfeccion.id + '"]');
click('[data-action="confirmar-insumo-picker-producto"][data-pro="' + proServId + '"]');
const proInsServ = state.productos.find(p => p.id === proServId).insumos[0];
assert(proInsServ.esServicio === true, "confirmar-insumo-picker-producto (productos.js) también resuelve 'servicio' al copiar del catálogo");

// Y de la plantilla/producto hacia una referencia nueva (aplicar-plantilla /
// aplicar-producto), la marca ya resuelta se hereda tal cual.
state.tab = "cotizaciones";
state.cotizacionEditando = "";
render();
setInput('[data-form="cotizacion"][data-field="cliente"]', "Cliente Servicio 2");
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
setInput('[data-form="cotizacion"][data-field="cliente"]', "Cliente Comisión");
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

console.log("\n✅ Todos los checks de humo pasaron.");
// Salida explícita: la parte de permisos simula una sesión de Google (ver
// loginComo), así que persist() intenta escribir de verdad en la Sheet y deja
// reintentos de red colgando. Sin esto el proceso quedaba vivo varios minutos
// después de haber pasado todos los checks, como si la prueba se hubiera
// trabado. Los errores de red que aparecen en consola son de ese mismo
// escenario simulado, no de la app.
process.exit(0);
