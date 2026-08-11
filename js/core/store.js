// Fuente única de verdad del estado + persistencia.
//
// Patrón importante: este archivo NO conoce el DOM ni cómo se renderiza nada.
// Cuando un módulo cambia el estado y quiere que la UI se actualice, llama a
// notify() en vez de importar la función render() directamente. Esto evita
// dependencias circulares (los módulos de cada pestaña nunca necesitan saber
// del orquestador de render, y viceversa) y deja la puerta abierta a que en
// el futuro varias partes de la UI reaccionen al mismo cambio sin acoplarse.

import { KEYS, DEFAULT_CONFIG, DEFAULT_UI, APPROVAL_REQUIRED_KEYS } from "./constants.js";
import { todayStr, uid } from "./utils.js";
import { catalogoInsumosDefault, plantillasPrendasDefault } from "./seed-data.js";
import { getSession } from "./auth.js";
import { tablaMovimientos, tablaClientes } from "./sheetsEsquemas.js";

// Claves ya migradas de la pestaña "kv" (un blob JSON por clave) a su propia
// pestaña con columnas reales (ver core/sheetsTabular.js) — Fase 1 de la
// reorganización de la Sheet. El resto de las claves (pedidos, cotizaciones,
// config...) sigue viviendo en "kv" hasta que se migren con el mismo patrón.
var TABLAS_SHEET = { tx: tablaMovimientos, clientes: tablaClientes };

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
  if (!STORAGE_OK) return;
  try {
    if (TABLAS_SHEET[key]) { state[key] = await TABLAS_SHEET[key].leer(); notify(); return; }
    if (!KEYS[key]) return;
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
  // Aviso flotante temporal (toast): { msg } o null. Puramente visual, nunca
  // se persiste — ver mostrarToast() más abajo.
  toast: null,
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
  // Cambios de catálogo hechos por un vendedor, a la espera de que el admin
  // los apruebe (ver persist()/proponerCambio() más abajo). Cada uno:
  // { id, key: "catalogoInsumos"|"catalogoCategorias", autor, valor, fecha }.
  catalogoPropuestas: [],
  // Prendas YA HECHAS (no personalizadas, solo cambia la talla) con stock
  // propio — distinto del catálogo de insumos de arriba. Ver modules/productos.js.
  productos: [],
  productoImagenSubiendo: {}, // { [productoId]: true } mientras se sube su foto a Drive — nunca se persiste
  productoMovimientosAbierto: "", // id del producto con su bitácora de stock desplegada (o "")
  // Propuestas de vendedor pendientes de aprobación del admin: SOLO dos
  // acciones puntuales (editar el precio de venta, o un "Registrar
  // movimiento" manual de stock) — las bajas automáticas de stock por una
  // venta o remisión real NUNCA quedan pendientes, se aplican ya mismo (es
  // la venta real, no una edición). Es un parche quirúrgico por producto
  // {id, tipo:"movimiento"|"campo", productoId, productoNombre, autor,
  // fecha, payload} — no una copia de todo el catálogo — para que aprobarla
  // más tarde se aplique sobre el producto tal como esté EN ESE MOMENTO, no
  // sobre una foto vieja que ya no refleje ventas más recientes. Ver
  // core/stock.js: proponerCambioProducto/aprobarPropuestaProducto.
  productoPropuestas: [],
  // Mismo patrón de pestañas que Cotizaciones: "nueva" es un formulario chico
  // enfocado que, al crear, deja abierto el detalle completo del producto
  // recién creado (productoEditando) — nunca una lista completa a la vez. La
  // segunda pestaña ("catalogo") es el catálogo visual en cards, no un
  // historial de eventos.
  productosVista: "nueva", // "nueva" | "catalogo"
  productoEditando: "", // id del producto con el detalle completo abierto en la pestaña "nueva" (o "" = formulario en blanco)
  // origen/proveedorId/costoCompra se eligen ya en el formulario de creación:
  // un producto comprado a proveedor no se arma con insumos ni fases, así que
  // saberlo de entrada es lo que decide qué campos se piden (ver
  // renderFormNuevoProducto en modules/productos.js).
  formProducto: { nombre: "", categoria: "", referencia: "", precioVenta: "", origen: "taller", proveedorId: "", costoCompra: "" },
  filtroProductosCategoria: "todos",
  // Picker de "Insumos predeterminados" al armar un producto del catálogo
  // (mismo patrón ventana-explorador que insumoPicker* de Cotizaciones).
  productoInsumoPickerAbierto: "", // id del producto con el picker abierto (o "")
  productoInsumoPickerCategoria: "todos",
  productoInsumoPickerBusqueda: "",
  productoInsumoPickerSeleccion: [],
  pedidoProductoBusqueda: "", // texto de búsqueda del picker de producto en el formulario de pedido (nombre/referencia/categoría)
  pedidoProductoPickerAbierto: false, // ventana del picker de producto (formulario de pedido) abierta/cerrada — nunca se persiste
  pedidoProductoCategoria: "todos", // "todos" | "sin" | nombre de categoría — panel izquierdo del picker de productos
  // Remisión de consignación en construcción (ver "Agregar remisión" en un
  // pedido de consignación, modules/pedidos.js): se acumulan líneas de
  // producto+talla+cantidad ANTES de confirmar, para que una entrega con
  // varios productos/tallas genere UN solo documento, no uno por línea. Solo
  // puede haber una remisión en construcción a la vez en toda la app (igual
  // que cotVendedorEditando) — abrir otra reemplaza la anterior sin guardar.
  remisionBuilder: { pedidoId: "", productoSel: "", items: [] },

  // Borradores de formularios. Viven en el estado (no en el DOM) para sobrevivir
  // re-renders y para que cualquier módulo pueda leerlos/limpiarlos.
  formTx: { tipo: "ingreso", concepto: "", monto: "", contraparte: "", fecha: todayStr(), pedidoId: "", cotizacionId: "" },
  formPedido: {
    clienteId: "", cliente: "", tipoCliente: "propio", abono: "", fechaEntrega: "",
    vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "",
    // Consignación: enviar mercancía a un punto de venta externo (ver modules/pedidos.js).
    esConsignacion: false, consignacionPrecioUnitario: "", consignacionComisionTipo: "porcentaje", consignacionComisionValor: "",
    // Líneas del pedido: cada una es { id, tipo:"catalogo"|"libre",
    // productoId, productoNombre, imagenUrl, talla, cantidad,
    // precioUnitario, costoUnitario, observacion, campos:[{id,nombre,valor}] }.
    // Son la ÚNICA fuente del total, el costo, la cantidad y la descripción
    // del pedido — por eso el formulario ya no tiene campos "total"/"costo"
    // que pudieran contradecirlas (ver renderPrecioYPago en modules/pedidos.js).
    lineas: []
  },
  pedidoVendedorAbierto: false, // sección de comisión de vendedor desplegada en el formulario de pedido
  formCliente: {
    nombre: "", cedula: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", telefono: "", correo: "",
    // "punto_consignacion": local externo donde se exhibe mercancía por comisión (ver modules/pedidos.js).
    // "proveedor": vende insumos — categoriasInsumo/descripcion/puntuacion son propias de este tipo.
    tipoRelacion: "cliente", comisionDefaultTipo: "porcentaje", comisionDefaultValor: "",
    categoriasInsumo: [], descripcion: "", puntuacion: ""
  },
  formCotizacion: { clienteId: "", cliente: "", descripcion: "", fecha: todayStr(), fechaEntrega: "" },
  formPend: { texto: "", categoria: "tarea", prioridad: "media", fecha: "", hora: "" },
  formReporte: { desde: primerDiaMes(), hasta: todayStr() },
  formEmp: { nombre: "", cargo: "", salario: "", periodo: "", diasPago: [] },
  nominaPagoId: "", // id de la persona con el mini-formulario de "Pagar" abierto (o "")
  empEditando: "", // id de la persona en nómina actualmente en modo edición (o "")
  empEditDraft: null, // { periodo, diasPago } — borrador reactivo del periodo/día mientras se edita (ver renderFilaEdicionEmp)
  formNominaPago: { bono: "", descuento: "", fecha: "" },
  formGastoFijo: { nombre: "", monto: "", periodo: "mensual", diasPago: [] },
  formDeuda: { concepto: "", monto: "", contraparte: "", fechaVencimiento: "", cuotas: "", periodo: "mensual", diasPago: [] },
  deudaEditando: "", // id de la deuda actualmente en modo edición (o "")
  deudasVista: "activas", // "activas" | "historial" — pestañas de la sección Deudas en Pendientes
  comisionVendedorExpandido: "", // nombre del vendedor con el detalle desplegado en "Comisiones de vendedores" (o "")
  // { emp: bool, gastoFijo: bool, meta: bool, deuda: bool } — formularios de
  // "agregar nuevo/a X" en Pendientes, colapsados por defecto para que la
  // pestaña no muestre ~19 campos siempre abiertos junto a las tablas.
  pendFormsAbiertos: {},
  flujoEstadosAbierto: "", // id del flujo de producción con sus etapas desplegadas en Plantillas (o "")
  abonoEditando: "", // id del abono de un pedido actualmente en modo edición (o "")
  reembolsoAbierto: "", // id del pedido con el mini-formulario de reembolso abierto (o "")
  formReembolso: { monto: "", fecha: "", motivo: "" },
  refImagenSubiendo: {}, // { [refId]: true } mientras una imagen de referencia se sube a Drive — nunca se persiste
  plantillaImagenSubiendo: {}, // { [plantillaId]: true } — mismo patrón, para la foto de una plantilla de prenda
  imagenPreview: "", // URL de la foto actualmente abierta en grande (overlay de previsualización), o "" — nunca se persiste

  finanzasVista: "nuevo", // "nuevo" | "historial" — pestañas superiores de Finanzas, mismo patrón que Cotizaciones
  filtroTx: "todos",
  filtroPedidos: "todos",
  filtroPedidosSoloSaldo: false,
  filtroPedidosVista: "activos", // "activos" | "papelera"
  // Qué pedidos tienen desplegado el panel de "dinero + pdf" (colapsado por
  // defecto para que la tarjeta muestre solo lo básico). Objeto {[id]: bool}.
  pedidoPanelAbierto: {},
  pedidosVista: "nueva", // "nueva" | "historial" — pestañas superiores de Pedidos, mismo patrón que Cotizaciones
  cotizacionesVista: "nueva", // "nueva" | "historial" — pestañas superiores de Cotizaciones
  cotizacionEditando: "", // id de la cotización con el detalle completo abierto en la pestaña "nueva" (o "" = formulario en blanco)
  // Guardado explícito de cotizaciones: editar ya no escribe a la hoja en
  // cada tecla (una cotización es un documento que se le muestra al cliente,
  // simular un precio no debe reemplazar el acordado). cotSucia es el id con
  // cambios pendientes; cotSnapshot es la copia de la última versión GUARDADA,
  // que "Descartar" restaura. Ninguno se persiste.
  cotSucia: "",
  cotSnapshot: null,
  // Explorador de insumos (modal de Cotizaciones): reemplaza al <select> que
  // no escalaba con un catálogo grande. Nada de esto se persiste — es estado
  // de UI que debe arrancar cerrado en cada carga.
  insumoPickerAbierto: "", // id de la cotización que lo abrió, o "" (cerrado)
  insumoPickerRef: "", // id de la referencia a la que se le van a agregar los insumos
  insumoPickerCategoria: "todos", // "todos" | "sin" | id de categoría
  insumoPickerBusqueda: "",
  insumoPickerSeleccion: [], // ids de insumos marcados (selección múltiple)
  // { [cotId + "|" + claveLinea]: true } — qué filas de la tabla de compras
  // tienen desplegado su detalle (proveedor y observaciones). Estado de UI:
  // nunca se persiste.
  compraDetalleAbierto: {},
  refActiva: {}, // { [cotId]: refId } — qué referencia está activa en la vista de pestañas de cada cotización
  cotTabActiva: {}, // { [cotId]: "referencias"|"produccion" } — pestaña interna activa dentro del detalle de una cotización
  cotVendedorEditando: "", // id de la cotización con el formulario de vendedor/comisión desplegado, o "" (por defecto solo se ve un resumen de una línea)
  // "nueva" | "contactos" | "proveedores" — quien te compra y quien te vende
  // viven en pestañas separadas: se buscan en momentos distintos y se ordenan
  // distinto (ver modules/clientes.js). "historial" es el nombre viejo de la
  // lista única y se sigue aceptando como sinónimo de "contactos".
  clientesVista: "nueva",
  clientesOrden: "abc", // "abc" | "recientes" | "categoria" (categoría solo aplica a proveedores)
  clienteEditando: "", // id del cliente actualmente en modo edición (o "")
  clienteEditCategorias: [], // borrador reactivo de categoriasInsumo mientras se edita un proveedor (ver renderCamposProveedorEdit)
  clienteRosterAbierto: "", // id del cliente con su roster de equipo desplegado (o "")
  clientePreciosAbierto: "", // id del proveedor con su panel de "Precios y compras" desplegado (o "")
  // true mientras la imagen del pie de página (Configuración) se sube a
  // Drive — nunca se persiste, es puramente visual (igual que refImagenSubiendo).
  configPiePaginaSubiendo: false,
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
    catalogoPropuestas: KEYS.catalogoPropuestas,
    productos: KEYS.productos,
    productoPropuestas: KEYS.productoPropuestas,
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
    if (datos.catalogoPropuestas) state.catalogoPropuestas = datos.catalogoPropuestas;
    if (datos.productos) state.productos = datos.productos;
    if (datos.productoPropuestas) state.productoPropuestas = datos.productoPropuestas;
    if (datos.ui) state.ui = Object.assign({}, DEFAULT_UI, datos.ui, { navGroups: Object.assign({}, DEFAULT_UI.navGroups, datos.ui.navGroups || {}) });

    // Fase 1 de la reorganización de la Sheet: "tx" y "clientes" ya viven en
    // su propia pestaña con columnas reales (ver TABLAS_SHEET arriba), no en
    // el blob de "kv" leído justo arriba. state.tx/state.clientes YA quedaron
    // asignados desde "kv" (líneas de arriba) como piso de seguridad: si algo
    // falla acá (sin conexión, la pestaña nueva no se pudo crear por
    // permisos, etc.), la app sigue funcionando con lo último guardado en
    // "kv" en vez de romperse o quedar vacía.
    await Promise.allSettled(Object.keys(TABLAS_SHEET).map(function (key) {
      return TABLAS_SHEET[key].leer().then(function (items) {
        if (items.length === 0 && state[key] && state[key].length) {
          // Pestaña nueva vacía pero "kv" ya tenía datos: primera vez que se
          // activa esta migración para esta clave — se copian una sola vez
          // (sin borrar el blob de "kv", que queda como respaldo).
          return TABLAS_SHEET[key].escribir(state[key]);
        }
        state[key] = items;
      }).catch(function (e) { console.error("No se pudo leer la hoja estructurada de " + key + " — se sigue usando lo último guardado en kv", e); });
    }));

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
  var session = getSession();
  // Un vendedor puede seguir usando su edición en el momento (ya quedó
  // aplicada en `state[key]` antes de llamar a persist()), pero para las
  // claves de APPROVAL_REQUIRED_KEYS (hoy, el catálogo: define el costo de
  // producción de todo el taller) el cambio no se guarda directo — queda
  // como propuesta a la espera de que el admin la apruebe desde Catálogo.
  if (session && session.rol === "vendedor" && APPROVAL_REQUIRED_KEYS.indexOf(key) !== -1) {
    return proponerCambio(key, session);
  }
  try {
    if (TABLAS_SHEET[key]) { await TABLAS_SHEET[key].escribir(state[key]); }
    else { await window.storage.set(KEYS[key], JSON.stringify(state[key]), false); }
    if (syncChannel) { try { syncChannel.postMessage({ key: key, tabId: TAB_ID }); } catch (e) {} }
  } catch (e) {
    console.error("No se pudo guardar", key, e);
  }
}

// Un vendedor solo puede tener UNA propuesta pendiente por clave a la vez:
// si sigue editando el catálogo, se actualiza la misma propuesta en vez de
// acumular una por cada campo que toque. "catalogoPropuestas" en sí NO es
// una clave de APPROVAL_REQUIRED_KEYS, así que este persist("catalogoPropuestas")
// de acá abajo sí se guarda directo (es lo que le permite al admin verla
// desde su propia sesión, en otro dispositivo).
async function proponerCambio(key, session) {
  var autor = session.vendedorNombre || session.email || "Vendedor";
  var lista = (state.catalogoPropuestas || []).slice();
  var idx = lista.findIndex(function (p) { return p.key === key && p.autor === autor; });
  var propuesta = { id: idx >= 0 ? lista[idx].id : uid(), key: key, autor: autor, valor: state[key], fecha: new Date().toISOString() };
  if (idx >= 0) lista[idx] = propuesta; else lista.push(propuesta);
  state.catalogoPropuestas = lista;
  await persist("catalogoPropuestas");
}

// Admin aprueba: la propuesta pasa a ser el valor real de esa clave (ya
// visible para todos) y sale de la lista de pendientes.
export async function aprobarPropuesta(id) {
  var propuesta = (state.catalogoPropuestas || []).filter(function (p) { return p.id === id; })[0];
  if (!propuesta) return;
  state[propuesta.key] = propuesta.valor;
  await persist(propuesta.key);
  state.catalogoPropuestas = (state.catalogoPropuestas || []).filter(function (p) { return p.id !== id; });
  await persist("catalogoPropuestas");
}

// Admin descarta: desaparece de la lista sin tocar el catálogo real (el
// vendedor que la propuso sigue viendo su edición en su sesión hasta que
// recargue la página, ahí vuelve a traer el catálogo real).
export async function descartarPropuesta(id) {
  state.catalogoPropuestas = (state.catalogoPropuestas || []).filter(function (p) { return p.id !== id; });
  await persist("catalogoPropuestas");
}

// Cualquier módulo llama a notify() tras mutar `state` para pedir un re-render,
// sin necesitar importar el motor de render.
export function notify() {
  document.dispatchEvent(new CustomEvent("app:render"));
}

var toastTimer = null;
// Aviso flotante que se muestra unos segundos y desaparece solo — para
// confirmaciones rápidas (ej. "vinculado al producto del catálogo") que no
// necesitan quedar como texto permanente en pantalla. Un toast nuevo
// reemplaza al anterior (y su temporizador) en vez de acumularse.
export function mostrarToast(msg) {
  state.toast = { msg: msg };
  notify();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    state.toast = null;
    notify();
  }, 3200);
}
