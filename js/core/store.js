// Fuente única de verdad del estado + persistencia.
//
// Patrón importante: este archivo NO conoce el DOM ni cómo se renderiza nada.
// Cuando un módulo cambia el estado y quiere que la UI se actualice, llama a
// notify() en vez de importar la función render() directamente. Esto evita
// dependencias circulares (los módulos de cada pestaña nunca necesitan saber
// del orquestador de render, y viceversa) y deja la puerta abierta a que en
// el futuro varias partes de la UI reaccionen al mismo cambio sin acoplarse.

import { KEYS, DEFAULT_CONFIG, DEFAULT_UI } from "./constants.js";
import { todayStr } from "./utils.js";
import { catalogoInsumosDefault, plantillasPrendasDefault } from "./seed-data.js";

export const STORAGE_OK = typeof window.storage !== "undefined" && window.storage !== null;

// Sincronización entre pestañas: si el mismo taller está abierto en dos pestañas
// (o dos ventanas) del mismo navegador, sin esto la pestaña B podría guardar
// encima de un cambio reciente de la pestaña A usando una copia vieja en memoria
// (ej. A borra un pedido, B todavía lo tiene cargado y al guardar otra cosa lo
// revive sin querer). Con BroadcastChannel, cada vez que una pestaña guarda una
// clave, las demás la recargan al instante desde storage antes de volver a
// guardar nada — así ninguna pestaña escribe sobre datos que ya quedaron atrás.
// No sincroniza entre dispositivos ni entre cuentas distintas (para eso haría
// falta un backend); solo protege el caso real de "la misma persona con dos
// pestañas abiertas".
var TAB_ID = Math.random().toString(36).slice(2);
var syncChannel = null;
if (typeof BroadcastChannel !== "undefined") {
  try { syncChannel = new BroadcastChannel("taller-app-sync-v1"); } catch (e) { syncChannel = null; }
}
if (syncChannel) {
  syncChannel.onmessage = function (ev) {
    var msg = ev && ev.data;
    if (!msg || msg.tabId === TAB_ID || !msg.key) return;
    reloadKey(msg.key);
  };
}

// Recarga una sola área de datos desde storage (usado por la sincronización entre
// pestañas). A diferencia de loadAll(), no corre las migraciones de datos
// antiguos: esas solo tienen sentido en la carga inicial de la app.
async function reloadKey(key) {
  if (!STORAGE_OK || !KEYS[key]) return;
  try {
    var r = await window.storage.get(KEYS[key], false);
    var valor = r ? safeParse(r.value, undefined) : undefined;
    if (key === "config") {
      state.config = Object.assign({}, DEFAULT_CONFIG, valor || {});
      state.config.meta = Object.assign({}, DEFAULT_CONFIG.meta, state.config.meta || {});
    } else if (key === "ui") {
      state.ui = Object.assign({}, DEFAULT_UI, valor || {}, { navGroups: Object.assign({}, DEFAULT_UI.navGroups, (valor && valor.navGroups) || {}) });
    } else if (valor !== undefined) {
      state[key] = valor;
    }
    notify();
  } catch (e) {
    console.error("No se pudo sincronizar", key, e);
  }
}

function primerDiaMes() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

export const state = {
  tab: "resumen",
  config: Object.assign({}, DEFAULT_CONFIG),
  ui: Object.assign({}, DEFAULT_UI),
  // Estado puramente visual del cajón del menú en móvil: nunca se persiste
  // (siempre debe arrancar cerrado al recargar).
  sidebarMobileOpen: false,
  tx: [],
  txPapelera: [], // movimientos eliminados (papelera): se pueden restaurar o borrar definitivo
  pedidos: [],
  pedidosPapelera: [], // pedidos eliminados: se pueden restaurar o borrar definitivo
  clientes: [],
  cotizaciones: [],
  pendientes: [], // notas (tareas del día a día / mejoras del negocio)
  deudas: [], // deudas del taller AÚN pendientes (préstamos, proveedores, etc.) — suman al KPI "Por pagar"
  deudasHistorial: [], // deudas ya pagadas por completo: se mueven aquí enteras, no quedan mezcladas con las pendientes
  // Catálogo y plantillas nacen con datos de ejemplo editables (no vacíos),
  // aunque no haya storage disponible, para que el cotizador sea útil de una.
  catalogoInsumos: catalogoInsumosDefault(),
  catalogoCategorias: [], // { id, nombre } — para clasificar el catálogo de insumos
  plantillasPrendas: plantillasPrendasDefault(),
  plantillasEstados: [], // { id, nombre, estados: [{id,label}] } — flujos de producción reutilizables

  // Borradores de formularios. Viven en el estado (no en el DOM) para sobrevivir
  // re-renders y para que cualquier módulo pueda leerlos/limpiarlos.
  formTx: { tipo: "ingreso", concepto: "", monto: "", contraparte: "", fecha: todayStr(), pedidoId: "" },
  formPedido: { clienteId: "", cliente: "", tipoCliente: "propio", descripcion: "", cantidad: "1", total: "", costo: "", abono: "", fechaEntrega: "", vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "" },
  formCliente: { nombre: "", cedula: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", telefono: "" },
  formCotizacion: { clienteId: "", cliente: "", descripcion: "", fecha: todayStr() },
  formPend: { texto: "", categoria: "tarea", prioridad: "media", fecha: "" },
  formReporte: { desde: primerDiaMes(), hasta: todayStr() },
  formEmp: { nombre: "", cargo: "", salario: "" },
  formGastoFijo: { nombre: "", monto: "", periodo: "mensual", diasPago: "" },
  formDeuda: { concepto: "", monto: "", contraparte: "", fechaVencimiento: "", cuotas: "", periodo: "mensual", diasPago: "" },
  deudaEditando: "", // id de la deuda actualmente en modo edición (o "")
  flujoEstadosAbierto: "", // id del flujo de producción con sus etapas desplegadas en Plantillas (o "")
  abonoEditando: "", // id del abono de un pedido actualmente en modo edición (o "")

  filtroTx: "todos",
  filtroPedidos: "todos",
  filtroPedidosSoloSaldo: false,
  filtroPedidosVista: "activos", // "activos" | "papelera"
  // Qué pedidos tienen desplegado el panel de "dinero + pdf" (colapsado por
  // defecto para que la tarjeta muestre solo lo básico). Objeto {[id]: bool}.
  pedidoPanelAbierto: {},
  filtroClientes: "",
  filtroCatalogoCategoria: "todos",
  buscarPedidos: "",
  buscarTx: "",
  filtroTxPeriodo: "todos",
  filtroTxVista: "activos", // "activos" | "papelera"
  txEditando: "", // id del movimiento actualmente en edición inline (o "")

  lastError: null
};

function safeParse(raw, fallback) {
  try {
    var v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

// Carga todas las áreas de datos en paralelo. Cada área vive en su propia clave
// de storage, así que un fallo puntual en una no bloquea a las demás.
//
// Usa un mapa nombrado (en vez de índices de array tipo r[0], r[1]...) para que
// agregar una nueva área de datos en el futuro sea solo sumar una línea aquí,
// sin tener que recontar posiciones en todo el resto de la función.
export async function loadAll() {
  if (!STORAGE_OK) return;
  var claves = {
    config: KEYS.config,
    configNombreLegacy: KEYS.configNombreLegacy,
    tx: KEYS.tx,
    txPapelera: KEYS.txPapelera,
    pedidos: KEYS.pedidos,
    pedidosPapelera: KEYS.pedidosPapelera,
    clientes: KEYS.clientes,
    cotizaciones: KEYS.cotizaciones,
    pendientes: KEYS.pendientes,
    deudas: KEYS.deudas,
    deudasHistorial: KEYS.deudasHistorial,
    catalogoInsumos: KEYS.catalogoInsumos,
    catalogoCategorias: KEYS.catalogoCategorias,
    plantillasPrendas: KEYS.plantillasPrendas,
    plantillasEstados: KEYS.plantillasEstados,
    ui: KEYS.ui
  };
  var nombres = Object.keys(claves);
  try {
    var resultados = await Promise.allSettled(nombres.map(function (n) { return window.storage.get(claves[n], false); }));
    var datos = {};
    nombres.forEach(function (n, i) {
      var r = resultados[i];
      datos[n] = (r.status === "fulfilled" && r.value) ? safeParse(r.value.value, undefined) : undefined;
    });

    state.config = Object.assign({}, DEFAULT_CONFIG, datos.config || {});
    if (!datos.config && datos.configNombreLegacy) state.config.nombre = datos.configNombreLegacy;
    // Migración: versiones anteriores guardaban "objetivoMes"/"objetivoLabel" sueltos
    // (siempre mensuales). Si existen y no hay "meta" nueva, se convierten una vez.
    if (datos.config && (datos.config.objetivoMes || datos.config.objetivoLabel) && !datos.config.meta) {
      state.config.meta = { label: datos.config.objetivoLabel || DEFAULT_CONFIG.meta.label, monto: datos.config.objetivoMes || 0, periodo: "mensual" };
    } else {
      state.config.meta = Object.assign({}, DEFAULT_CONFIG.meta, state.config.meta || {});
    }

    if (datos.tx) state.tx = datos.tx;
    if (datos.txPapelera) state.txPapelera = datos.txPapelera;
    if (datos.pedidos) state.pedidos = datos.pedidos;
    if (datos.pedidosPapelera) state.pedidosPapelera = datos.pedidosPapelera;
    if (datos.clientes) state.clientes = datos.clientes;
    if (datos.cotizaciones) state.cotizaciones = datos.cotizaciones;
    if (datos.pendientes) state.pendientes = datos.pendientes;
    if (datos.deudas) state.deudas = datos.deudas;
    if (datos.deudasHistorial) state.deudasHistorial = datos.deudasHistorial;
    // Si nunca se ha guardado nada, se quedan con los datos semilla del estado inicial.
    if (datos.catalogoInsumos && datos.catalogoInsumos.length) state.catalogoInsumos = datos.catalogoInsumos;
    if (datos.catalogoCategorias) state.catalogoCategorias = datos.catalogoCategorias;
    if (datos.plantillasPrendas && datos.plantillasPrendas.length) state.plantillasPrendas = datos.plantillasPrendas;
    if (datos.plantillasEstados) state.plantillasEstados = datos.plantillasEstados;
    if (datos.ui) state.ui = Object.assign({}, DEFAULT_UI, datos.ui, { navGroups: Object.assign({}, DEFAULT_UI.navGroups, datos.ui.navGroups || {}) });

    // Migración: el detalle de tallas/observaciones vivía en el PEDIDO; ahora
    // vive en la REFERENCIA de la cotización de origen (así se puede
    // diferenciar por referencia cuando una cotización tiene varias). Si un
    // pedido antiguo con cotización vinculada aún trae `detalle` propio y esa
    // cotización todavía no tiene tallas guardadas en ninguna referencia, se
    // traslada una sola vez (después de esto, `p.detalle` se borra, así que
    // no se repite en la siguiente carga).
    if (state.pedidos.length && state.cotizaciones.length) {
      var huboMigracion = false;
      state.pedidos.forEach(function (p) {
        if (!p.detalle || !p.detalle.length || !p.cotizacionId) return;
        var cot = state.cotizaciones.filter(function (c) { return c.id === p.cotizacionId; })[0];
        if (!cot || !cot.referencias || !cot.referencias.length) return;
        var yaTieneDetalle = cot.referencias.some(function (r) { return r.detalle && r.detalle.length; });
        if (yaTieneDetalle) return;
        cot.referencias[0].detalle = p.detalle;
        delete p.detalle;
        huboMigracion = true;
      });
      if (huboMigracion) { persist("cotizaciones"); persist("pedidos"); }
    }
  } catch (e) {
    console.error("Error cargando datos", e);
  }
}

// key es una clave de `state` que también existe en KEYS (tx, pedidos, clientes...).
export async function persist(key) {
  if (!STORAGE_OK) return;
  try {
    await window.storage.set(KEYS[key], JSON.stringify(state[key]), false);
    if (syncChannel) { try { syncChannel.postMessage({ key: key, tabId: TAB_ID }); } catch (e) {} }
  } catch (e) {
    console.error("No se pudo guardar", key, e);
  }
}

// Cualquier módulo llama a notify() tras mutar `state` para pedir un re-render,
// sin necesitar importar el motor de render.
export function notify() {
  document.dispatchEvent(new CustomEvent("app:render"));
}
