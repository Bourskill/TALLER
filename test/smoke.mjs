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

// --- clientes: pestañas "+ Nuevo cliente" / "Historial" (mismo patrón que
// Cotizaciones) — se entra viendo el formulario, y tras crear salta al
// historial para confirmar que quedó registrado. ---
click('[data-action="tab"][data-tab="clientes"]');
assert(state.clientesVista === "nueva" && !!document.querySelector('[data-form="cliente"][data-field="nombre"]'), "Clientes entra mostrando el formulario en blanco");
setInput('[data-form="cliente"][data-field="nombre"]', "Cliente Prueba");
click('[data-action="add-cliente"]');
assert(state.clientes.length === 1, "agrega cliente");
assert(state.clientesVista === "historial", "tras crear el cliente salta al Historial");
assert(!!document.querySelector(".cliente-card"), "el cliente recién creado aparece en el Historial");

// --- pedidos: pestañas "+ Nuevo pedido" / "Historial" — mismo patrón ---
click('[data-action="tab"][data-tab="pedidos"]');
assert(state.pedidosVista === "nueva" && !!document.querySelector('[data-form="pedido"][data-field="cliente"]'), "Pedidos entra mostrando el formulario en blanco");

// --- pedidos: crear pedido vinculado al cliente + abono inicial ---
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

// insumos: colapsado por defecto (sección "Costeo y producción") hasta que se usa
assert(!document.querySelector('select[data-action-change="add-pro-insumo-catalogo"][data-pro="' + productoId + '"]'), "la sección de insumos nace colapsada");
click('[data-action="toggle-producto-costeo"][data-id="' + productoId + '"]');
assert(!!document.querySelector('select[data-action-change="add-pro-insumo-catalogo"][data-pro="' + productoId + '"]'), "se puede desplegar la sección de insumos");

// pestaña "Catálogo": índice visual en cards — clic en una abre su detalle completo
click('[data-action="cerrar-producto-editor"]');
click('[data-action="producto-vista"][data-val="catalogo"]');
assert(!!document.querySelector('.producto-card-mini[data-id="' + productoId + '"]'), "el producto creado aparece como card visual en el Catálogo");
click('[data-action="abrir-producto-editor"][data-id="' + productoId + '"]');
assert(state.productoEditando === productoId && state.productosVista === "nueva", "la card abre el detalle completo en la otra pestaña");

// --- pedidos: buscador de producto (por nombre/referencia/categoría) con
// miniatura, venta directa descuenta stock, y se restituye si se elimina ---
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
setInput('#inp-buscar-producto-pedido', "CAM-001");
render(); // data-live-filter debounce; el estado ya quedó actualizado, solo falta repintar
assert(!!document.querySelector('.producto-combo-item[data-id="' + productoId + '"]'), "el buscador sugiere el producto por referencia (no solo por nombre)");
click('.producto-combo-item[data-id="' + productoId + '"]');
assert(state.formPedido.productoSel === productoId, "selecciona el producto desde el buscador");
assert(!!document.querySelector('[data-action="ver-producto-en-catalogo"][data-id="' + productoId + '"]'), "muestra un enlace para verificar el producto en el Catálogo");
document.querySelector('[data-role="pedido-producto-talla"]').value = "M";
document.querySelector('[data-role="pedido-producto-cantidad"]').value = "3";
click('[data-action="add-pedido-producto-linea"][data-id="' + productoId + '"]');
assert(state.formPedido.stockConsumido.length === 1, "agrega la línea del producto al pedido en construcción");
click('[data-action="add-pedido"]');
const pedidoVentaDirecta = state.pedidos.find(p => (p.stockConsumido || []).length > 0);
assert(!!pedidoVentaDirecta, "crea el pedido de venta directa con el producto");
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 17, "el stock baja al crear el pedido (20 - 3 = 17)");
click('[data-action="toggle-pedido-panel"][data-id="' + pedidoVentaDirecta.id + '"]');
click('[data-action="remove-pedido"][data-id="' + pedidoVentaDirecta.id + '"]');
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 20, "el stock se restituye al eliminar el pedido");

// --- BUG REPORTADO: pedir un producto dos veces cuando solo hay 1 en stock
// no debe alcanzar a "pasar" (antes cada línea se validaba contra el stock
// SIN restar lo que la otra línea del mismo borrador ya había apartado), y
// cancelar el pedido debe devolver EXACTAMENTE lo que se descontó — nunca de
// más (antes el pedido guardaba lo PEDIDO, no lo aplicado, y al cancelar se
// restituía de más). ---
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
setInput('#inp-buscar-producto-pedido', "Camiseta unica");
render();
click('.producto-combo-item[data-id="' + prodUnicoId + '"]');
document.querySelector('[data-role="pedido-producto-talla"]').value = "M";
document.querySelector('[data-role="pedido-producto-cantidad"]').value = "1";
click('[data-action="add-pedido-producto-linea"][data-id="' + prodUnicoId + '"]');
assert(state.formPedido.stockConsumido.length === 1, "primera línea de 1 unidad se agrega (había 1 en stock)");
document.querySelector('[data-role="pedido-producto-talla"]').value = "M";
document.querySelector('[data-role="pedido-producto-cantidad"]').value = "1";
click('[data-action="add-pedido-producto-linea"][data-id="' + prodUnicoId + '"]');
assert(state.formPedido.stockConsumido.length === 1, "segunda línea de la MISMA talla se rechaza (ya no queda disponible dentro de este mismo borrador)");

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
// seguimiento por talla y venta reportada contra una línea puntual ---
click('[data-action="tab"][data-tab="pedidos"]');
click('[data-action="pedido-vista"][data-val="nueva"]');
setInput('[data-form="pedido"][data-field="cliente"]', "Cliente Prueba");
setInput('[data-form="pedido"][data-field="descripcion"]', "Consignación tienda");
click('[data-action="toggle-es-consignacion"]');
click('[data-action="add-pedido"]');
const pedidoConsig = state.pedidos.find(p => p.consignacion);
assert(!!pedidoConsig, "crea pedido de consignación");
click('[data-action="iniciar-remision"][data-id="' + pedidoConsig.id + '"]');
const remisionProductoSelect = document.querySelector('select[data-action-change="set-remision-producto-sel"]');
remisionProductoSelect.value = productoId;
remisionProductoSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
document.querySelector('[data-role="remision-cantidad"]').value = "5";
click('[data-action="add-remision-linea"][data-id="' + pedidoConsig.id + '"]');
assert(state.remisionBuilder.items.length === 1, "agrega una línea a la remisión en construcción");
click('[data-action="confirmar-remision"][data-id="' + pedidoConsig.id + '"]');
let pedidoConsigActualizado = state.pedidos.find(p => p.id === pedidoConsig.id);
assert(pedidoConsigActualizado.consignacion.remisiones.length === 1, "confirma la remisión");
producto = state.productos.find(p => p.id === productoId);
assert(producto.variantesTalla[0].stock === 13, "la remisión descuenta el stock del taller (18 - 5 = 13)");
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
assert(seguimiento[0].disponible === 3, "el seguimiento por talla refleja lo vendido (5 enviadas - 2 vendidas = 3 disponibles)");

// --- comisión de vendedor: desmarcar "pagada" debe revertir el movimiento
// de verdad (no solo la etiqueta) — si no, volver a marcarla pagada crea un
// segundo movimiento duplicado para la misma comisión. ---
const txAntesToggle = state.tx.length;
click('[data-action="toggle-comision"][data-id="' + pedidoConVendedor.id + '"]');
assert(state.pedidos.find(p => p.id === pedidoConVendedor.id).vendedor.estado === "pendiente", "desmarca la comisión como pendiente");
assert(state.tx.length === txAntesToggle - 1, "desmarcarla revierte (borra) el movimiento que se había creado, no lo deja huérfano");
click('[data-action="toggle-comision"][data-id="' + pedidoConVendedor.id + '"]');
assert(state.tx.length === txAntesToggle, "volver a marcarla pagada crea un solo movimiento (no quedan dos por la misma comisión)");

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
