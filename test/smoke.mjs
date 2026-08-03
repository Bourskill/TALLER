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

const { render } = await import("../js/core/dom.js");
const { loadAll, state } = await import("../js/core/store.js");

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
function assert(cond, msg) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("OK: " + msg);
}

await loadAll();
render();
assert(document.querySelector(".sidebar"), "renderiza sidebar en el primer render");
// Los KPIs ya NO se muestran en todas las pestañas (reportado como ruido) —
// viven solo en Configuración, ver más abajo.
assert(!document.querySelector(".kpis"), "no renderiza KPIs fuera de Configuración");

// --- recorre cada pestaña y verifica que renderiza sin lanzar ---
const tabs = ["resumen", "finanzas", "pedidos", "cotizaciones", "clientes", "pendientes", "notas", "config"];
for (const t of tabs) {
  click('[data-action="tab"][data-tab="' + t + '"]');
  assert(state.tab === t, "cambia a la pestaña " + t);
  assert(!state.lastError, "sin error de render en " + t + (state.lastError ? (": " + state.lastError) : ""));
}
assert(document.querySelector(".kpis"), "renderiza KPIs en Configuración (único lugar)");

// --- finanzas: agregar transacción ---
click('[data-action="tab"][data-tab="finanzas"]');
setInput('[data-form="tx"][data-field="concepto"]', "Venta de prueba");
setInput('[data-form="tx"][data-field="monto"]', "50000");
click('[data-action="add-tx"]');
assert(state.tx.length === 1 && state.tx[0].concepto === "Venta de prueba", "agrega transacción");

// --- clientes: agregar cliente ---
click('[data-action="tab"][data-tab="clientes"]');
setInput('[data-form="cliente"][data-field="nombre"]', "Cliente Prueba");
click('[data-action="add-cliente"]');
assert(state.clientes.length === 1, "agrega cliente");

// --- pedidos: crear pedido vinculado al cliente + abono inicial ---
click('[data-action="tab"][data-tab="pedidos"]');
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
assert(document.querySelector(".combo-item"), "sugiere el cliente en el combobox");
click('.combo-item[data-action="select-cliente"]');
assert(state.formPedido.clienteId === state.clientes[0].id, "vincula clienteId en el combobox");
setInput('[data-form="pedido"][data-field="descripcion"]', "40 camisetas");
setInput('[data-form="pedido"][data-field="total"]', "400000");
setInput('[data-form="pedido"][data-field="abono"]', "100000");
click('[data-action="add-pedido"]');
assert(state.pedidos.length === 1, "crea pedido");
assert(state.tx.some(t => t.concepto.indexOf("Abono inicial") === 0), "registra abono inicial en finanzas");

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

// agregar insumo desde el catálogo
const addCatSelect = document.querySelector('select[data-action-change="add-insumo-catalogo"][data-cot="' + cotId + '"][data-ref="' + refId + '"]');
addCatSelect.value = catItemId;
addCatSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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

// --- notas (antes "pendientes": tareas/mejoras) ---
click('[data-action="tab"][data-tab="notas"]');
setInput('[data-form="pend"][data-field="texto"]', "Comprar hilo");
click('[data-action="add-pend"]');
assert(state.pendientes.length === 1, "agrega nota");
click('[data-action="toggle-pend"][data-id="' + state.pendientes[0].id + '"]');
assert(state.pendientes[0].hecho === true, "marca nota como hecha");

// --- pendientes (nómina, gastos fijos, meta, deudas) ---
click('[data-action="tab"][data-tab="pendientes"]');
setInput('[data-form="emp"][data-field="nombre"]', "Costurera 1");
setInput('[data-form="emp"][data-field="salario"]', "1200000");
click('[data-action="add-emp"]');
assert(state.config.nomina.length === 1, "agrega persona a nómina");

setInput('[data-form="gastoFijo"][data-field="nombre"]', "Arriendo");
setInput('[data-form="gastoFijo"][data-field="monto"]', "500000");
click('[data-action="add-gasto-fijo"]');
assert(state.config.gastosFijos.length === 1, "agrega gasto fijo");
assert(state.config.gastosFijos[0].periodo === "mensual", "gasto fijo nace con periodo mensual por defecto");

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

// --- pedidos: comisión de vendedor ---
click('[data-action="tab"][data-tab="pedidos"]');
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
setInput('[data-form="pedido"][data-field="descripcion"]', "Pedido con vendedor");
setInput('[data-form="pedido"][data-field="total"]', "200000");
setInput('[data-form="pedido"][data-field="vendedorNombre"]', "Ana Vendedora");
setInput('[data-form="pedido"][data-field="vendedorValor"]', "10");
click('[data-action="add-pedido"]');
const pedidoConVendedor = state.pedidos.find(p => p.vendedor && p.vendedor.nombre === "Ana Vendedora");
assert(!!pedidoConVendedor, "crea pedido con vendedor/comisión");
assert(pedidoConVendedor.vendedor.estado === "pendiente", "la comisión nace pendiente");
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoConVendedor.id + '"]');
const txAntes = state.tx.length;
click('[data-action="toggle-comision"][data-id="' + pedidoConVendedor.id + '"]');
assert(state.pedidos.find(p => p.id === pedidoConVendedor.id).vendedor.estado === "pagado", "marca la comisión como pagada");
assert(state.tx.length === txAntes + 1 && state.tx[0].tipo === "comision", "pagar la comisión crea un movimiento en Finanzas");

console.log("\n✅ Todos los checks de humo pasaron.");
