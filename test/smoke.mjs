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
assert(!!document.querySelector('.producto-card-mini[data-id="' + productoId + '"]'), "el producto creado aparece como card visual en el Catálogo");
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

console.log("\n✅ Todos los checks de humo pasaron.");
// Salida explícita: la parte de permisos simula una sesión de Google (ver
// loginComo), así que persist() intenta escribir de verdad en la Sheet y deja
// reintentos de red colgando. Sin esto el proceso quedaba vivo varios minutos
// después de haber pasado todos los checks, como si la prueba se hubiera
// trabado. Los errores de red que aparecen en consola son de ese mismo
// escenario simulado, no de la app.
process.exit(0);
