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
import { configurarGuardado, guardarClave, espejar, leerEspejo, pendientesDeSesionAnterior, olvidarPendientesDeSesionAnterior, marcarBorrador, olvidarBorrador, borradoresDeSesionAnterior } from "./guardado.js";

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
  // { claves: [...], etiquetas: [...] } si la sesión anterior se cerró con
  // cambios que nunca llegaron a la Sheet y el espejo local sí los tiene
  // (ver detectarRecuperacion). null el resto del tiempo.
  recuperacion: null,
  // Panel de la campanita desplegado o no — estado de UI, nunca se persiste.
  notificacionesAbiertas: false,
  // Panel con la lista de atajos de teclado (tecla "?" o el botón del teclado
  // en la topbar, ver core/teclado.js). También es solo de UI: nunca se persiste.
  atajosAbiertos: false,
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
  // Los campos de compra de insumo (esInsumo/insumoNombre/proveedorId/cantidad/
  // unidad) viven en el borrador y no se leen del DOM al enviar: de eso depende
  // que el formulario pueda MOSTRARLOS solo cuando aplican, en vez de tener
  // cuatro campos vacíos ahí siempre.
  formTx: { tipo: "ingreso", concepto: "", monto: "", contraparte: "", fecha: todayStr(), pedidoId: "", cotizacionId: "", esInsumo: false, insumoNombre: "", proveedorId: "", cantidad: "", unidad: "" },
  formPedido: {
    clienteId: "", cliente: "", tipoCliente: "propio", abono: "", fechaEntrega: "",
    vendedorNombre: "", vendedorTipo: "porcentaje", vendedorValor: "",
    // No todo pedido rápido pasa por producción (cortado, confección…): algo
    // ya listo, un servicio, una reventa. En `true` por defecto para no
    // cambiarle el comportamiento a nadie que no toque esta casilla — ver
    // renderFormNuevoPedido/"add-pedido" en modules/pedidos.js.
    conFlujoProduccion: true,
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
    // Nombre de usuario de WhatsApp (el que empieza por @): se guarda sin la
    // arroba y en minúsculas, ver normalizarUsuarioWhatsapp en modules/clientes.js.
    usuarioWhatsapp: "",
    // "punto_consignacion": local externo donde se exhibe mercancía por comisión (ver modules/pedidos.js).
    // "proveedor": vende insumos — categoriasInsumo/descripcion/puntuacion son propias de este tipo.
    tipoRelacion: "cliente", comisionDefaultTipo: "porcentaje", comisionDefaultValor: "",
    categoriasInsumo: [], descripcion: "", puntuacion: ""
  },
  formCotizacion: { clienteId: "", cliente: "", descripcion: "", fecha: todayStr(), fechaEntrega: "" },
  formPend: { texto: "", categoria: "tarea", prioridad: "media", fecha: "", hora: "" },
  formReporte: { desde: primerDiaMes(), hasta: todayStr() },
  // Qué apartados del reporte están desplegados. El resumen financiero no
  // está acá porque va siempre visible: es el titular, no un detalle.
  reporteSecciones: {},
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
  // Borrador del abono. Antes vivía SOLO en el DOM (se leía con data-role al
  // pulsar "Registrar"), así que cualquier re-render en medio —un filtro que
  // se dispara, otra pestaña que guarda— borraba el monto ya tecleado y
  // devolvía el foco a ninguna parte. Es plata: no puede depender de que no
  // ocurra un render.
  // `pedidoId` acota el borrador al pedido que lo está escribiendo: pueden
  // estar abiertos varios paneles a la vez, y un borrador global hacía que lo
  // tecleado en un pedido apareciera dentro del formulario de otro.
  formAbono: { pedidoId: "", monto: "", fecha: "", metodo: "efectivo" },
  refImagenSubiendo: {}, // { [refId]: true } mientras una imagen de referencia se sube a Drive — nunca se persiste
  plantillaImagenSubiendo: {}, // { [plantillaId]: true } — mismo patrón, para la foto de una plantilla de prenda
  imagenPreview: "", // URL de la foto actualmente abierta en grande (overlay de previsualización), o "" — nunca se persiste
  // { url (blob:), nombreArchivo } del PDF recién generado, mostrado en un
  // visor DENTRO de la app en vez de descargarlo directo — o null. Ver
  // mostrarPdfEnApp() en core/pdf.js. Nunca se persiste.
  pdfPreview: null,

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
  // id de la cotización cuyo listado de tallas está en modo "repartir entre
  // referencias" (ver renderRepartoReferencias en modules/cotizaciones.js), o "".
  detalleModoRefs: "",
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
  sincronizandoContactos: false, // true mientras se empujan todos los contactos a Google Contacts — nunca se persiste
  clienteRosterAbierto: "", // id del cliente con su roster de equipo desplegado (o "")
  clientePreciosAbierto: "", // id del proveedor con su panel de "Precios y compras" desplegado (o "")
  // true mientras la imagen del pie de página (Configuración) se sube a
  // Drive — nunca se persiste, es puramente visual (igual que refImagenSubiendo).
  configPiePaginaSubiendo: false,
  // true mientras el ícono del taller se sube a Drive — mismo patrón que
  // configPiePaginaSubiendo; nunca se persiste.
  configLogoSubiendo: false,
  filtroClientes: "",
  filtroCatalogoCategoria: "todos",
  // Buscador y orden del catálogo de insumos. Sin buscador, encontrar un
  // insumo entre decenas obligaba a recorrer la lista con los ojos — era la
  // única de las listas grandes de la app que no tenía uno.
  buscarCatalogo: "",
  ordenCatalogo: "abc", // "abc" | "caro" | "nuevos"
  // Panel para renombrar/eliminar categorías, plegado por defecto: se
  // administra de vez en cuando, no en el día a día.
  catalogoCategoriasAbierto: false,
  // Pestaña Plantillas. Mismo patrón maestro/detalle que Catálogo y
  // Cotizaciones: una vista de índice (tarjetas con foto) y el detalle de UNA
  // sola a la vez, en vez de todas desplegadas siempre.
  buscarPlantillas: "",
  plantillasVista: "plantillas", // "plantillas" | "flujos"
  plantillaEditando: "", // id de la plantilla con el detalle abierto, o ""
  filtroPlantillaCategoria: "todos",
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
  // Se toma ANTES de leer nada de la red: más abajo, cada lectura que SÍ
  // tiene éxito reescribe el espejo local con lo recién leído (para que la
  // PRÓXIMA caída de red tenga algo reciente de dónde caer). Si
  // detectarRecuperacion() comparara contra el espejo EN VIVO, esa
  // reescritura borraría la evidencia del borrador antes de que la
  // recuperación alcance a compararla — y nunca se ofrecería recuperar nada
  // con la red andando, que es justo el caso más común (abrir la app al otro
  // día con wifi bien). Por eso se congela una foto de "cómo estaba el
  // espejo AL ENTRAR" y se compara contra esa foto, no contra el espejo que
  // este mismo loadAll() está a punto de pisar.
  var candidatasRecuperacion = pendientesDeSesionAnterior().concat(borradoresDeSesionAnterior())
    .filter(function (c, i, arr) { return arr.indexOf(c) === i; });
  var espejoAntesDeCargar = {};
  candidatasRecuperacion.forEach(function (c) { espejoAntesDeCargar[c] = leerEspejo(c); });
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
  // Se pone en true si ALGUNA clave tuvo que caer a la copia local (ver
  // abajo) — es lo que decide, al final de loadAll(), si avisar que lo que
  // se ve pudo no ser lo más reciente.
  var huboFalloDeRed = false;
  try {
    var resultados = await Promise.allSettled(nombres.map(function (n) { return window.storage.get(claves[n], false); }));
    var datos = {};
    // Claves cuyo valor cayó al espejo local (no se pudieron leer de la
    // Sheet). Se usa más abajo para blindar la migración de tallas: si
    // pedidos o cotizaciones vinieron de acá, pueden estar desactualizados
    // frente a lo que YA tiene la Sheet real (ver el comentario junto a esa
    // migración).
    var clavesDeEspejo = {};
    nombres.forEach(function (n, i) {
      var r = resultados[i];
      if (r.status === "fulfilled") {
        if (r.value) {
          datos[n] = safeParse(r.value.value, undefined);
          // Copia local de lo que SÍ se pudo leer — es lo único de donde
          // puede salir algo la próxima vez que esto falle (ver el "else" de
          // abajo). "configNombreLegacy" no es una clave real de `state` (es
          // solo un campo viejo que se lee una vez para migrar el nombre del
          // taller), así que no tiene sentido guardarle copia.
          if (n !== "configNombreLegacy") espejar(n, r.value.value);
        } else {
          // La Sheet SÍ respondió (no es un fallo de red) pero esta clave no
          // tiene fila todavía — es un "no hay nada guardado aún" legítimo,
          // no un "no se pudo leer". Antes esto se trataba igual que el
          // fallo de red de abajo, y podía resucitar una copia local vieja
          // (de una clave que el usuario borró o que nunca se guardó en este
          // navegador) como si fuera el dato vigente, y mostrar el aviso de
          // "sin conexión" estando en línea.
          datos[n] = undefined;
        }
      } else {
        // No se pudo leer de la Sheet (sin conexión, o el token no se pudo
        // renovar). Antes esto dejaba la clave en su valor SEMILLA de
        // fábrica — lo que borraba de la pantalla datos reales que sí
        // existen, solo porque no se pudieron alcanzar justo ahora. Se cae a
        // la última copia que este mismo dispositivo guardó localmente (ver
        // core/guardado.js) en vez de mostrar la app como si estuviera recién
        // instalada.
        var espejo = n !== "configNombreLegacy" ? leerEspejo(n) : null;
        if (espejo != null) {
          datos[n] = safeParse(espejo, undefined);
          huboFalloDeRed = true;
          clavesDeEspejo[n] = true;
        } else {
          datos[n] = undefined;
        }
      }
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
    // el blob de "kv" leído justo arriba. Si la lectura de acá abajo falla
    // (sin conexión, la pestaña nueva no se pudo crear por permisos, etc.),
    // hay DOS redes de seguridad, en este orden de preferencia:
    //   1. el ESPEJO de tx/clientes específicamente (ver el catch de abajo) —
    //      la copia MÁS RECIENTE que este dispositivo haya leído o guardado
    //      de esta pestaña puntual;
    //   2. si no hay espejo, state.tx/state.clientes ya quedaron asignados
    //      desde el blob de "kv" (líneas de arriba) — más viejo (esa pestaña
    //      dejó de actualizarse desde que esto se migró), pero mejor que
    //      nada.
    await Promise.allSettled(Object.keys(TABLAS_SHEET).map(function (key) {
      return TABLAS_SHEET[key].leer().then(function (items) {
        if (items.length === 0 && state[key] && state[key].length) {
          // Pestaña nueva vacía pero "kv" ya tenía datos: primera vez que se
          // activa esta migración para esta clave — se copian una sola vez
          // (sin borrar el blob de "kv", que queda como respaldo).
          return TABLAS_SHEET[key].escribir(state[key]);
        }
        state[key] = items;
        // Copia local, igual que con las claves de "kv" arriba — esta es la
        // que se usa si el próximo intento de leer esta pestaña falla.
        espejar(key, JSON.stringify(items));
      }).catch(function (e) {
        console.error("No se pudo leer la hoja estructurada de " + key + " — se intenta con la última copia local", e);
        // "Lo último guardado en kv" ya no es del todo cierto para tx/clientes
        // desde que viven en su propia pestaña (ver el comentario grande más
        // abajo): ese blob puede llevar meses sin actualizarse. Se prefiere
        // el ESPEJO —si hay uno, es de la última vez que ESTE dispositivo
        // leyó o guardó tx/clientes de verdad— por encima del blob viejo de
        // "kv" que `state[key]` ya trae como piso de seguridad.
        var espejo = leerEspejo(key);
        if (espejo == null) return;
        var parsed = safeParse(espejo, undefined);
        if (parsed !== undefined) { state[key] = parsed; huboFalloDeRed = true; }
      });
    }));

    // Migración: el detalle de tallas/observaciones vivía en el PEDIDO; ahora
    // vive en la REFERENCIA de la cotización de origen (así se puede
    // diferenciar por referencia cuando una cotización tiene varias). Si un
    // pedido antiguo con cotización vinculada aún trae `detalle` propio y esa
    // cotización todavía no tiene tallas guardadas en ninguna referencia, se
    // traslada una sola vez (después de esto, `p.detalle` se borra, así que
    // no se repite en la siguiente carga).
    //
    // Si pedidos o cotizaciones cayeron al espejo local (offline), esta copia
    // puede ser más vieja que lo que YA está en la Sheet real desde otro
    // dispositivo (ej. ese otro dispositivo ya migró tallas y guardó; este
    // espejo es de antes de eso). Migrar sobre esa copia vieja y guardarla
    // (persist, más abajo) escribiría ese dato desactualizado ENCIMA de lo
    // real en cuanto vuelva la señal — justo lo que la "red de seguridad" de
    // core/guardado.js existe para evitar (nunca escribir a ciegas algo que
    // pudo quedar viejo frente a otro dispositivo). Se salta la migración por
    // completo en ese caso: se repite sola, sin problema, la próxima vez que
    // este dispositivo cargue con conexión real.
    if (state.pedidos.length && state.cotizaciones.length && !clavesDeEspejo.pedidos && !clavesDeEspejo.cotizaciones) {
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

    // Borradores en la nube: solo importan para "cotizaciones"/"formPedido"
    // (las dos únicas áreas en "guardado explícito" / formulario a medio
    // llenar — ver revisarBorradoresSinGuardar). Mejor esfuerzo: si esto
    // falla, la recuperación local (de este mismo dispositivo) sigue
    // funcionando igual, así que no bloquea nada del resto de loadAll().
    var borradoresNube = {};
    try {
      var draftsCot = await leerBorradoresNubeCotizaciones();
      if (draftsCot.length) borradoresNube.cotizaciones = draftsCot;
      var draftFp = await leerBorradorNubeFormPedido();
      if (draftFp) borradoresNube.formPedido = draftFp;
    } catch (e) { /* mejor esfuerzo, ver arriba */ }

    detectarRecuperacion(espejoAntesDeCargar, borradoresNube);

    // Un aviso breve, no una barra fija: haber caído a la copia local no es
    // un problema que resolver (no hace falta ninguna acción), es solo un
    // dato que conviene saber al entrar — igual de sutil que el resto de los
    // avisos "informativos" de la app (ver mostrarToast). Se calla solo a
    // los pocos segundos; si la próxima recarga sí tiene conexión, no vuelve
    // a aparecer.
    if (huboFalloDeRed) {
      mostrarToast("📶 Sin conexión: mostrando la última copia guardada en este dispositivo. Se actualiza sola en cuanto vuelva la señal.");
    }
  } catch (e) {
    console.error("Error cargando datos", e);
  }
}

// Nombre legible de cada área de datos, para poder decirle al usuario QUÉ
// quedó sin guardar en vez de mostrarle la clave interna.
export var ETIQUETA_CLAVE = {
  tx: "movimientos de Finanzas", pedidos: "pedidos", clientes: "contactos",
  cotizaciones: "cotizaciones", productos: "catálogo de productos",
  catalogoInsumos: "catálogo de insumos", catalogoCategorias: "categorías de insumos",
  plantillasPrendas: "plantillas de prendas", plantillasEstados: "flujos de producción",
  pendientes: "notas", deudas: "deudas", deudasHistorial: "historial de deudas",
  config: "configuración del taller", ui: "preferencias de interfaz",
  txPapelera: "papelera de movimientos", pedidosPapelera: "papelera de pedidos",
  catalogoPropuestas: "cambios propuestos del catálogo", productoPropuestas: "cambios propuestos de productos",
  // No es una clave que se guarde en la Sheet (ver CLAVES_PERSISTIBLES más
  // abajo) — es el formulario de "Nuevo pedido rápido" a medio llenar. Se
  // recupera igual que cualquier otra, solo que sin volver a escribirla a la
  // Sheet (recuperarDelEspejo lo sabe).
  formPedido: "un pedido rápido a medio llenar"
};

// Únicas claves que de verdad viven en la Sheet (ver KEYS en constants.js).
// recuperarDelEspejo() la usa para no intentar guardar un borrador que nunca
// tuvo una fila propia ahí (ej. formPedido) — eso escribiría con una clave
// inventada en la pestaña "kv" en vez de fallar en silencio.
var CLAVES_PERSISTIBLES = Object.keys(KEYS);

// ---------- borradores en la nube (recuperar desde OTRO dispositivo) ----------
// El espejo local (core/guardado.js) resuelve "se me cerró la pestaña sola"
// en ESTE mismo navegador — pero vive en localStorage, así que abrir desde
// otro computador, otro navegador, o después de borrar datos de navegación
// no tiene nada de dónde recuperar. Para esos casos, la MISMA edición que ya
// se espeja localmente también se manda —cada pocos segundos, mejor
// esfuerzo, sin cola de reintento— a su propia fila en la pestaña "kv",
// separada por correo Y por cotización (cada una la suya: si la misma
// persona tiene dos pestañas o dos dispositivos editando cotizaciones
// DISTINTAS a la vez, no se pisan el borrador — antes de esto, las dos
// mandaban a la MISMA fila y la última en escribir se comía a la otra).
//
// "formPedido" no lleva id propio (hay un solo formulario de "Nuevo pedido
// rápido" por sesión, no una lista): sigue siendo una clave por correo.
var TIEMPO_BORRADOR_NUBE_MS = 4000;
var timersBorradorNube = {}; // clave completa -> timer
var idBorradorNubeActivo = {}; // area -> sufijo (id) actualmente programado, o null

function claveBorradorNube(area, sufijo) {
  var session = getSession();
  var email = session && session.email;
  if (!email) return null;
  var base = "borrador:" + area + ":" + email.toLowerCase();
  return sufijo != null ? base + ":" + sufijo : base;
}

function guardarBorradorNubeAhora(clave, obtenerPayload) {
  if (!clave || !STORAGE_OK) return;
  var payload = obtenerPayload();
  if (!payload) return;
  try { window.storage.set(clave, JSON.stringify(payload), false).catch(function () {}); }
  catch (e) { /* mejor esfuerzo: si falla, se reintenta con el próximo cambio */ }
}

// A propósito NO es un debounce (que se reprogramaría en cada tecla y, con
// alguien escribiendo sin parar, nunca llegaría a mandar nada): es un tope
// de "como mucho cada X segundos" — la primera vez que hay algo que mandar
// programa un envío; mientras ese envío sigue pendiente, más cambios no
// reprograman nada; al disparar, toma el estado MÁS RECIENTE (no el de
// cuando se programó) y queda libre para programar el siguiente.
function programarBorradorNube(clave, obtenerPayload) {
  if (!clave || timersBorradorNube[clave]) return;
  timersBorradorNube[clave] = setTimeout(function () {
    timersBorradorNube[clave] = null;
    guardarBorradorNubeAhora(clave, obtenerPayload);
  }, TIEMPO_BORRADOR_NUBE_MS);
}

function borrarBorradorNube(clave) {
  if (!clave) return;
  clearTimeout(timersBorradorNube[clave]);
  timersBorradorNube[clave] = null;
  if (!STORAGE_OK) return;
  try { window.storage.set(clave, "", false).catch(function () {}); } catch (e) {}
}

// Puede haber MÁS de un borrador de cotización en la nube a la vez (dos
// pestañas, dos dispositivos, cada uno con la suya) — por eso se listan por
// prefijo en vez de leer una sola clave fija. `basadaEn` es la cotización
// TAL COMO ESTABA GUARDADA cuando este borrador arrancó (el mismo dato que
// ya guarda state.cotSnapshot, ver modules/cotizaciones.js): si lo que hay
// guardado de verdad HOY ya no es eso, es porque esta edición ya se guardó
// (acá o desde otro lado) o alguien guardó algo más nuevo encima — el
// borrador quedó viejo y NO debe ofrecerse (ver detectarRecuperacion).
async function leerBorradoresNubeCotizaciones() {
  var prefijo = claveBorradorNube("cotizaciones");
  if (!prefijo || !STORAGE_OK || !window.storage.keysConPrefijo) return [];
  try {
    var claves = await window.storage.keysConPrefijo(prefijo + ":");
    var resultados = await Promise.all(claves.map(function (k) {
      return window.storage.get(k, false).then(function (r) {
        if (!r || !r.value) return null;
        try {
          var d = JSON.parse(r.value);
          return d && d.cotizacionId && d.cotizacion ? d : null;
        } catch (e) { return null; }
      }).catch(function () { return null; });
    }));
    return resultados.filter(Boolean);
  } catch (e) { return []; }
}

async function leerBorradorNubeFormPedido() {
  var clave = claveBorradorNube("formPedido");
  if (!clave || !STORAGE_OK) return null;
  try {
    var r = await window.storage.get(clave, false);
    if (!r || !r.value) return null;
    var d = JSON.parse(r.value);
    return d && d.formPedido ? d : null;
  } catch (e) { return null; }
}

// ¿La sesión anterior se cerró con cambios que nunca llegaron a la Sheet?
// El espejo local los tiene; se comparan contra lo que sí está guardado y, si
// difieren, se ofrece recuperarlos. NUNCA se restaura solo: el espejo es de
// ESTE navegador, y restaurarlo a ciegas podría pisar algo hecho después
// desde otro dispositivo (ver la nota final de core/guardado.js).
function detectarRecuperacion(espejoAntesDeCargar, borradoresNube) {
  // Dos motivos por los que una clave puede tener algo que recuperar: un
  // intento de guardado que quedó a medias (pendientesDeSesionAnterior, de
  // siempre) o una edición que nunca se intentó guardar — una cotización en
  // modo "guardado explícito", un pedido rápido a medio llenar
  // (borradoresDeSesionAnterior, ver core/guardado.js). Se juntan en una sola
  // lista: al usuario no le importa POR QUÉ quedó algo sin guardar, solo que
  // hay algo que ofrecerle recuperar.
  var claves = pendientesDeSesionAnterior().concat(borradoresDeSesionAnterior())
    .filter(function (c, i, arr) { return arr.indexOf(c) === i; });
  var recuperables = claves.filter(function (clave) {
    if (!(clave in state)) return false;
    // Se usa la foto de ANTES de leer la red (ver loadAll) y no el espejo en
    // vivo: para cuando esto corre, loadAll ya pudo haber reescrito el
    // espejo con lo recién leído de la Sheet, y comparar contra eso siempre
    // daría "igual" (ver el comentario grande en loadAll).
    var espejo = (espejoAntesDeCargar && clave in espejoAntesDeCargar) ? espejoAntesDeCargar[clave] : leerEspejo(clave);
    if (!espejo) return false;
    try { return espejo !== JSON.stringify(state[clave]); } catch (e) { return false; }
  });

  // Borradores en la nube (ver más arriba): solo se ofrecen para un área que
  // el espejo LOCAL no cubra ya — si este mismo dispositivo tiene una
  // versión (se actualiza cada 1.5s, la nube cada 4s como mucho), esa es la
  // que se ofrece; la nube es el respaldo para cuando NO hay nada local
  // (otro dispositivo, otro navegador, se borraron los datos de navegación)
  // — es lo único que hace posible recuperar algo sin depender de QUE
  // pendientesDeSesionAnterior()/borradoresDeSesionAnterior() (ambas leen
  // localStorage de ESTE navegador) tengan algo que decir.
  var nube = {};
  if (borradoresNube) {
    if (borradoresNube.cotizaciones && borradoresNube.cotizaciones.length && recuperables.indexOf("cotizaciones") === -1) {
      // Puede haber varios (una pestaña/dispositivo por cotización distinta,
      // ver leerBorradoresNubeCotizaciones) — se ofrecen TODOS los que sigan
      // siendo válidos, no solo el primero.
      var validos = borradoresNube.cotizaciones.filter(function (d) {
        var actual = state.cotizaciones.filter(function (c) { return c.id === d.cotizacionId; })[0];
        if (!actual) return false;
        // Descarta un borrador VIEJO: si `basadaEn` no coincide con lo que
        // hay guardado de verdad HOY, esta edición ya se guardó (por acá o
        // por otro lado) o alguien más guardó algo más nuevo encima —
        // ofrecerlo igual regresaría la cotización a una versión vieja.
        if (d.basadaEn !== undefined && JSON.stringify(actual) !== JSON.stringify(d.basadaEn)) return false;
        return JSON.stringify(actual) !== JSON.stringify(d.cotizacion);
      });
      if (validos.length) nube.cotizaciones = validos;
    }
    if (borradoresNube.formPedido && recuperables.indexOf("formPedido") === -1) {
      nube.formPedido = borradoresNube.formPedido;
    }
  }

  var todasLasClaves = recuperables.concat(Object.keys(nube));
  if (!todasLasClaves.length) { olvidarPendientesDeSesionAnterior(); claves.forEach(olvidarBorrador); return; }
  state.recuperacion = {
    claves: todasLasClaves,
    etiquetas: todasLasClaves.map(function (c) { return ETIQUETA_CLAVE[c] || c; }),
    // La misma foto con la que se detectó, no el espejo en vivo: entre que
    // se muestra el aviso y que el usuario pulsa "Restaurar" puede correr
    // otro loadAll() (cambio de pestaña, "online") que vuelva a pisar el
    // espejo con lo recién leído — recuperarDelEspejo() debe restaurar
    // exactamente lo que se prometió mostrar, no lo que haya en el espejo
    // en ese momento posterior.
    espejo: espejoAntesDeCargar,
    nube: Object.keys(nube).length ? nube : undefined
  };
}

// Vuelca el espejo local sobre el estado. Las claves que de verdad viven en
// la Sheet (CLAVES_PERSISTIBLES) se mandan a guardar de nuevo, como siempre;
// un borrador que nunca tuvo fila propia ahí (ej. formPedido) solo se
// restaura EN PANTALLA — no hay a dónde guardarlo todavía, eso lo decide el
// usuario terminando de llenarlo y pulsando el botón de siempre ("Crear
// pedido"), igual que si nunca se hubiera ido.
export async function recuperarDelEspejo() {
  var pendiente = state.recuperacion;
  if (!pendiente) return;
  pendiente.claves.forEach(function (clave) {
    // Borrador que vino de la nube (otro dispositivo/navegador, ver más
    // arriba): merge puntual, NO se pisa el área entera — "cotizaciones" es
    // una LISTA de cotizaciones editadas (puede haber más de una, cada una
    // fusionada por su propio id dentro del arreglo completo que sí está al
    // día); "formPedido" sí se reemplaza entero porque es un formulario
    // propio, no un arreglo compartido.
    var deNube = pendiente.nube && pendiente.nube[clave];
    if (deNube) {
      if (clave === "cotizaciones") {
        deNube.forEach(function (d) {
          var yaEsta = state.cotizaciones.some(function (c) { return c.id === d.cotizacionId; });
          state.cotizaciones = yaEsta
            ? state.cotizaciones.map(function (c) { return c.id === d.cotizacionId ? d.cotizacion : c; })
            : state.cotizaciones.concat([d.cotizacion]);
        });
      } else if (clave === "formPedido") {
        state.formPedido = deNube.formPedido;
      }
      return;
    }
    // Misma foto que detectarRecuperacion() usó para decidir que esto SÍ
    // difería (ver esa función) — no una relectura en vivo, que ya pudo
    // haber sido pisada por otro loadAll() de por medio.
    var espejo = (pendiente.espejo && clave in pendiente.espejo) ? pendiente.espejo[clave] : leerEspejo(clave);
    if (!espejo) return;
    try { state[clave] = JSON.parse(espejo); } catch (e) { /* espejo corrupto: se ignora esa clave */ }
  });
  state.recuperacion = null;
  olvidarPendientesDeSesionAnterior();
  pendiente.claves.forEach(olvidarBorrador);
  limpiarBorradoresNubeDe(pendiente);
  notify();
  for (var i = 0; i < pendiente.claves.length; i++) {
    var clave = pendiente.claves[i];
    if (CLAVES_PERSISTIBLES.indexOf(clave) !== -1) await persist(clave);
  }
}

// Limpia en la nube justo lo que se acaba de restaurar (o descartar): cada
// cotización recuperada, por su propia clave con id — a propósito NO toca
// idBorradorNubeActivo (el borrador de una edición que pueda estar EN CURSO
// ahora mismo en esta pestaña, si el usuario se puso a editar algo distinto
// mientras el aviso seguía en pantalla): ese es un borrador legítimo y
// aparte, no el que se está resolviendo acá.
function limpiarBorradoresNubeDe(pendiente) {
  pendiente.claves.forEach(function (c) {
    if (c === "cotizaciones") {
      (pendiente.nube && pendiente.nube.cotizaciones || []).forEach(function (d) {
        borrarBorradorNube(claveBorradorNube("cotizaciones", d.cotizacionId));
      });
    } else if (c === "formPedido" && pendiente.nube && pendiente.nube.formPedido) {
      borrarBorradorNube(claveBorradorNube("formPedido"));
    }
  });
}

export function descartarRecuperacion() {
  var pendiente = state.recuperacion;
  var claves = (pendiente && pendiente.claves) || [];
  state.recuperacion = null;
  olvidarPendientesDeSesionAnterior();
  claves.forEach(olvidarBorrador);
  if (pendiente) limpiarBorradoresNubeDe(pendiente);
  notify();
}

// Se llama en CADA render (ver core/dom.js) — no en cada acción de edición
// una por una, que son decenas de sitios distintos y fácil olvidar alguno.
// Mirando el estado mismo en vez de instrumentar cada mutación, esto no
// puede quedar desactualizado: si algo nuevo empieza a usar "guardado
// explícito" en el futuro, basta con agregarlo acá una vez.
//
// Es lo que cierra el hueco real: antes de esto, "guardado explícito"
// (cotizaciones) y el formulario de pedido rápido vivían SOLO en memoria
// hasta que alguien pulsara Guardar/Crear — si la pestaña se cerraba antes
// (se actualizó el navegador, se recargó sin querer, se cayó), esas horas de
// trabajo desaparecían sin ningún aviso ni forma de recuperarlas.
export function revisarBorradoresSinGuardar() {
  if (state.cotSucia) {
    marcarBorrador("cotizaciones", function () { return JSON.stringify(state.cotizaciones); });
    // Si se saltó de editar OTRA cotización a esta sin pasar por "no sucia"
    // (cotSucia cambió de id directamente), el borrador en la nube de la
    // anterior ya no aplica — se limpia antes de programar el de esta.
    if (idBorradorNubeActivo.cotizaciones && idBorradorNubeActivo.cotizaciones !== state.cotSucia) {
      borrarBorradorNube(claveBorradorNube("cotizaciones", idBorradorNubeActivo.cotizaciones));
    }
    idBorradorNubeActivo.cotizaciones = state.cotSucia;
    programarBorradorNube(claveBorradorNube("cotizaciones", state.cotSucia), function () {
      var cot = state.cotizaciones.filter(function (c) { return c.id === state.cotSucia; })[0];
      return cot ? { cotizacionId: state.cotSucia, cotizacion: cot, basadaEn: state.cotSnapshot } : null;
    });
  } else {
    olvidarBorrador("cotizaciones");
    if (idBorradorNubeActivo.cotizaciones) {
      borrarBorradorNube(claveBorradorNube("cotizaciones", idBorradorNubeActivo.cotizaciones));
      idBorradorNubeActivo.cotizaciones = null;
    }
  }

  var fp = state.formPedido;
  var fpTieneContenido = !!(fp && ((fp.cliente || "").trim() || (fp.lineas || []).length));
  if (fpTieneContenido) {
    marcarBorrador("formPedido", function () { return JSON.stringify(state.formPedido); });
    idBorradorNubeActivo.formPedido = true;
    programarBorradorNube(claveBorradorNube("formPedido"), function () { return { formPedido: state.formPedido }; });
  } else {
    olvidarBorrador("formPedido");
    if (idBorradorNubeActivo.formPedido) {
      borrarBorradorNube(claveBorradorNube("formPedido"));
      idBorradorNubeActivo.formPedido = false;
    }
  }
}

// La escritura de verdad de UNA clave. Se pasa a core/guardado.js, que se
// encarga de encolarla y reintentarla si falla — acá solo vive el "cómo se
// escribe", no el "qué pasa si no se pudo".
//
// Lee `state[key]` en el momento de escribir (no recibe una copia): eso es lo
// que hace que un reintento mande siempre lo último, incluido todo lo que el
// usuario haya hecho mientras la conexión estaba caída.
async function escribirClave(key) {
  if (TABLAS_SHEET[key]) { await TABLAS_SHEET[key].escribir(state[key]); }
  else { await window.storage.set(KEYS[key], JSON.stringify(state[key]), false); }
  if (syncChannel) { try { syncChannel.postMessage({ key: key, tabId: TAB_ID }); } catch (e) {} }
}

configurarGuardado({ escribir: escribirClave, alCambiar: notify });

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
  // Antes esto era un try/catch que solo hacía console.error: si fallaba, el
  // usuario no se enteraba y el cambio se perdía al cerrar la pestaña. Ahora
  // pasa por la red de seguridad (espejo local + cola de reintento).
  await guardarClave(key, JSON.stringify(state[key]));
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
