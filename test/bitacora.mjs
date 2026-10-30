// Bitácora de cambios y cierre de mes del dinero (Hallazgo #65): cada cambio de
// plata queda anotado con quién, cuándo y cómo estaba antes; un mes cerrado no
// deja crear, editar, borrar ni restaurar nada de dinero con fecha en él hasta
// que el admin lo reabre con un motivo; y «Salud de los datos» avisa cuando un
// mes cerrado deja de valer lo que valía.
//
// Se corre solo, aparte de smoke.mjs:   node test/bitacora.mjs
//
// No necesita jsdom (mismo método que test/cuentas.mjs y test/salud.mjs): se
// stubean los pocos globales que store.js toca al importarse y se llaman las
// acciones REALES con elementos falsos. La Sheet se simula: la bitácora con una
// lista en memoria, y las demás escrituras fallan como si no hubiera red (la
// app sigue y las deja en cola, que es justo lo que no debe romper nada).

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; } }; };
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], remove: noop });
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { getElementById: () => null, createElement: el, addEventListener: noop, dispatchEvent: noop, querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el(), head: el(), visibilityState: "visible" };
let avisos = []; // todo window.alert queda anotado
// OJO: window.storage tiene que existir ANTES de importar store.js (STORAGE_OK
// se decide al importarlo); sin él persist() no hace nada y no habría bitácora.
const kv = {};
globalThis.window = Object.assign(globalThis.window || {}, {
  localStorage, sessionStorage, document, addEventListener: noop, removeEventListener: noop,
  location: { href: "http://localhost/", search: "", hash: "" }, matchMedia: () => ({ matches: false, addEventListener: noop }),
  confirm: () => true, alert: (m) => { avisos.push(String(m)); },
  storage: { get: async (k) => (kv[k] !== undefined ? { value: kv[k] } : null), set: async (k, v) => { kv[k] = v; return true; } }
});
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.confirm = () => true; globalThis.alert = noop;
globalThis.window.jspdf = { jsPDF: function () { return new Proxy({}, { get: () => () => ({}) }); } };
// Todo lo que no sea la bitácora intenta la red de verdad: aquí no hay.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("sin red (prueba)"); };

const R = new URL("../js/", import.meta.url).href;
const calc = await import(R + "core/calc.js");
const store = await import(R + "core/store.js");
const bit = await import(R + "core/bitacora.js");
const cierre = await import(R + "core/cierre.js");
const salud = await import(R + "core/salud.js");
const esquemas = await import(R + "core/sheetsEsquemas.js");
const { _resetCacheParaPruebas } = await import(R + "core/sheetsTabular.js");
const constants = await import(R + "core/constants.js");
const auth = await import(R + "core/auth.js");
const fin = await import(R + "modules/finanzas.js");
const ped = await import(R + "modules/pedidos.js");
const cot = await import(R + "modules/cotizaciones.js");
const cuentas = await import(R + "modules/cuentas.js");
const resumen = await import(R + "modules/resumen.js");
const cierresUi = await import(R + "modules/cierres.js");
const bitacoraUi = await import(R + "modules/bitacora.js");
const { state } = store;

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { pruebas++; if (a !== b) { fallos++; console.log("  X FALLA: " + msg + "  (obtuvo " + a + ", esperaba " + b + ")"); } else console.log("  ok " + msg); }
const fakeEl = (attrs, value, extra) => Object.assign({ value: value, checked: false, getAttribute: k => (k in attrs ? attrs[k] : null), closest: () => null }, extra || {});
const filaEdicion = (valores) => ({ querySelector: (sel) => { const m = /data-role="([^"]+)"/.exec(sel); return m && (m[1] in valores) ? { value: valores[m[1]] } : null; } });
const conFila = (attrs, valores) => fakeEl(attrs, "", { closest: () => filaEdicion(valores) });
const marca = (checked, attrs) => fakeEl(attrs, "", { checked: checked });

function login(rol, nombre, email) {
  sessionStorage.setItem("taller_sesion_v1", JSON.stringify({ session: { email: email, rol: rol, vendedorNombre: nombre }, accessToken: "fake-" + email, expiraEl: Date.now() + 999999 }));
  auth.restaurarSesion();
}
const ADMIN = { rol: "admin", nombre: "Dueño Taller", email: "dueno@taller.test" };
const VENDE = { rol: "vendedor", nombre: "Vero", email: "vero@taller.test" };
const comoAdmin = () => login(ADMIN.rol, ADMIN.nombre, ADMIN.email);
const comoVendedor = () => login(VENDE.rol, VENDE.nombre, VENDE.email);

// La bitácora de la Sheet, en memoria. `hoja` es lo que "hay escrito" en ella.
let hoja = [];
const copia = (x) => JSON.parse(JSON.stringify(x));
function conectarHoja() {
  bit._configurarParaPruebas({
    agregar: async (items) => { hoja = hoja.concat(copia(items)); },
    leer: async () => copia(hoja)
  });
}
const anotaciones = () => bit.entradasBitacora();
const ultima = () => { const e = anotaciones(); return e[e.length - 1]; };

function reiniciar() {
  bit._reiniciarParaPruebas(); hoja = []; conectarHoja();
  state.tx = []; state.txPapelera = []; state.transferencias = []; state.pedidos = []; state.pedidosPapelera = [];
  state.cotizaciones = []; state.deudas = []; state.deudasHistorial = []; state.cierres = [];
  state.config = Object.assign({}, state.config, {
    cuentas: [{ id: "efectivo", nombre: "Efectivo" }, { id: "banco", nombre: "Banco" }, { id: "nequi", nombre: "Nequi" }],
    cuentaPredeterminada: "", conciliaciones: {}, gastosFijos: [], nomina: [], colchonMovimientos: []
  });
  state.formAbono = { pedidoId: "", monto: "", fecha: "", metodo: "" };
  state.formReembolso = { monto: "", fecha: "", motivo: "", cuenta: "" };
  state.formTransferencia = { de: "", a: "", monto: "", fecha: "", nota: "" };
  state.cierreReabriendo = ""; state.cierreMotivo = "";
  avisos = [];
  bit.tomarFotos(state);
}
const tx = (id, extra) => Object.assign({ id: id, tipo: "gasto", fecha: "2026-10-05", concepto: "Hilo", monto: 100000, cuenta: "efectivo", contraparte: "", pedidoId: "", cotizacionId: "" }, extra || {});

// ======================= 1. Las dos pestañas nuevas de la Sheet =======================
{
  console.log("== esquemas: una fila por cambio, una fila por mes cerrado");
  const k = esquemas.COLUMNAS_BITACORA.map(c => c.key);
  igual(k.length, 17, "la bitácora tiene 17 columnas");
  igual(k[0], "id", "id va de primera");
  igual(k[10], "accion", "«accion» es la columna 11");
  igual(k[16], "enMesCerrado", "y «en_mes_cerrado» la última (una columna nueva va siempre al final)");
  ok(esquemas.COLUMNAS_BITACORA.filter(c => c.json).map(c => c.key).join() === "antes,despues", "solo antes y después son JSON (lo demás son columnas reales)");
  igual(esquemas.COLUMNAS_CIERRES.map(c => c.key).join(), "mes,estado,cerradoPor,cerradoPorNombre,cerradoEn,resumen,historial", "los cierres: una fila por mes");
  igual(constants.KEYS.cierres, "finanzas:cierres", "los cierres tienen su clave");
  ok(Array.isArray(state.cierres) && state.cierres.length === 0, "y nacen vacíos");
  ok(!!state.tx && !("bitacora" in constants.KEYS), "la bitácora NO es una clave de «kv» (no es un blob en una sola celda)");
}

// ======================= 2. La pestaña se crea sola, con su primera entrada =======================
{
  console.log("== agregar filas al final (sin reescribir) y la primera entrada");
  _resetCacheParaPruebas();
  comoAdmin();
  const llamadas = [];
  let filasLeer = [];
  globalThis.fetch = async function (url, options) {
    const u = decodeURIComponent(String(url));
    const metodo = (options && options.method) || "GET";
    const json = (v) => ({ ok: true, status: 200, json: async () => v });
    llamadas.push(metodo + " " + u.replace(/^.*spreadsheets\//, ""));
    if (u.indexOf("fields=sheets.properties") !== -1) return json({ sheets: [{ properties: { sheetId: 1, title: "Movimientos", gridProperties: { columnCount: 40 } } }] });
    if (u.indexOf(":batchUpdate") !== -1) return json({ replies: [{ addSheet: { properties: { sheetId: 77, title: "Bitacora" } } }] });
    if (u.indexOf(":append") !== -1) { filasLeer = filasLeer.concat(JSON.parse(options.body).values); return json({}); }
    if (u.indexOf("/values/Bitacora!A2") !== -1 && metodo === "GET") return json({ values: filasLeer });
    return json({});
  };
  try {
    const e1 = { id: "e1", fecha: "2026-10-05T10:00:00.000Z", usuario: "a@x.co", nombre: "A", rol: "admin", origen: "persona", clave: "tx", registroId: "t1", subId: "", aspecto: "movimiento", accion: "editar", etiqueta: "Hilo", cambios: "monto", antes: { monto: 1 }, despues: { monto: 2 }, meses: "2026-10", enMesCerrado: "" };
    await esquemas.tablaBitacora.agregar([e1], { alCrear: () => [{ id: "ini", fecha: "2026-10-05T09:59:59.999Z", usuario: "", nombre: "", rol: "", origen: "sistema", clave: "bitacora", registroId: "", subId: "", aspecto: "bitácora", accion: "inicio", etiqueta: "La bitácora empieza aquí", cambios: "", antes: null, despues: null, meses: "", enMesCerrado: "" }] });
    igual(filasLeer.length, 2, "al crear la pestaña se agregan 2 filas: la primera entrada y el cambio");
    igual(filasLeer[0][10], "inicio", "la primera es «inicio» (dice que lo anterior no tiene historial)");
    igual(filasLeer[1][0], "e1", "y después el cambio");
    ok(llamadas.some(l => l.indexOf("POST") === 0 && l.indexOf(":batchUpdate") !== -1), "la pestaña se creó (addSheet)");
    ok(llamadas.some(l => l.indexOf("POST") === 0 && l.indexOf("Bitacora!A1:append") !== -1), "se escribió con :append, al final de la tabla");
    ok(!llamadas.some(l => l.indexOf(":clear") !== -1), "NO se borró ni reescribió la pestaña");
    await esquemas.tablaBitacora.agregar([Object.assign({}, e1, { id: "e2" })], { alCrear: () => [{ id: "otra-ini" }] });
    igual(filasLeer.length, 3, "la segunda vez agrega UNA fila (no repite la primera entrada)");
    ok(!llamadas.some(l => l.indexOf(":clear") !== -1), "y sigue sin reescribir nada");
    const leidas = await esquemas.tablaBitacora.leer();
    igual(leidas.length, 3, "leer devuelve las 3 filas");
    ok(leidas[1].antes && leidas[1].antes.monto === 1 && leidas[1].despues.monto === 2, "el antes y el después vuelven como objetos (JSON de su columna)");
    igual(leidas[1].usuario, "a@x.co", "y el resto de campos como columnas reales");
  } finally {
    globalThis.fetch = async () => { throw new Error("sin red (prueba)"); };
    _resetCacheParaPruebas();
  }
}

// ======================= 3. Un cambio queda con su antes, su después y su autor =======================
{
  console.log("== editar un movimiento");
  reiniciar(); comoAdmin();
  state.tx = [tx("t1")];
  bit.tomarFotos(state);
  fin.actions["guardar-tx-edit"](conFila({ "data-id": "t1" }, { "edit-concepto": "Hilo", "edit-monto": "120000", "edit-fecha": "2026-10-05", "edit-tipo": "gasto", "edit-cuenta": "efectivo", "edit-contraparte": "" }));
  igual(anotaciones().length, 1, "UN cambio, UNA anotación");
  const e = ultima();
  igual(e.accion, "editar", "la acción es «editar»");
  igual(e.clave, "tx", "de la clave «tx»");
  igual(e.registroId, "t1", "del movimiento t1");
  igual(e.aspecto, "movimiento", "es un movimiento");
  igual(e.antes.monto, 100000, "ANTES: el monto era 100.000");
  igual(e.despues.monto, 120000, "DESPUÉS: 120.000");
  igual(e.antes.fecha, "2026-10-05", "trae también la fecha (para saber de qué mes es la plata)");
  ok(e.cambios.indexOf("monto") !== -1 && e.cambios.indexOf("$100.000") !== -1 && e.cambios.indexOf("$120.000") !== -1, "y lo dice en palabras: «" + e.cambios + "»");
  igual(e.usuario, ADMIN.email, "AUTOR: el correo de la sesión");
  igual(e.nombre, ADMIN.nombre, "y su nombre en la app");
  igual(e.rol, "admin", "con su rol");
  igual(e.origen, "persona", "hecho por una persona");
  ok(!isNaN(Date.parse(e.fecha)) && /^\d{4}-\d{2}-\d{2}T/.test(e.fecha), "con fecha y hora ISO: " + e.fecha);
  igual(e.meses, "2026-10", "y el mes de la plata tocada");
  igual(e.enMesCerrado, "", "(ese mes está abierto)");
  igual(state.tx[0].monto, 120000, "la acción SIGUIÓ: el dinero se guardó igual");
  ok(!!e.id, "cada anotación tiene su id");

  console.log("== cambiar la fecha anota los dos meses");
  fin.actions["guardar-tx-edit"](conFila({ "data-id": "t1" }, { "edit-concepto": "Hilo", "edit-monto": "120000", "edit-fecha": "2026-11-02", "edit-tipo": "gasto", "edit-cuenta": "efectivo", "edit-contraparte": "" }));
  igual(ultima().meses, "2026-10,2026-11", "pasar un movimiento de octubre a noviembre anota ambos meses");
  ok(ultima().cambios.indexOf("fecha") !== -1, "y dice que cambió la fecha");

  console.log("== guardar sin cambiar nada de dinero no anota nada");
  const antes = anotaciones().length;
  fin.actions["guardar-tx-edit"](conFila({ "data-id": "t1" }, { "edit-concepto": "Hilo", "edit-monto": "120000", "edit-fecha": "2026-11-02", "edit-tipo": "gasto", "edit-cuenta": "efectivo", "edit-contraparte": "" }));
  igual(anotaciones().length, antes, "una edición idéntica no deja ruido en la bitácora");
  state.tx[0].conciliadoEn = "2026-11-05";
  store.persist("tx");
  igual(anotaciones().length, antes, "marcar un movimiento como conciliado tampoco (no es dinero que cambia)");
}

{
  console.log("== crear, eliminar, restaurar y borrar para siempre");
  reiniciar(); comoAdmin();
  state.formTx = Object.assign({}, state.formTx, { tipo: "gasto", concepto: "Botones", monto: "8000", fecha: "2026-10-10", cuenta: "banco", servicios: [] });
  fin.actions["add-tx"]();
  igual(anotaciones().length, 1, "crear: UNA anotación");
  igual(ultima().accion, "crear", "«crear»");
  igual(ultima().antes, null, "sin «antes»");
  igual(ultima().despues.monto, 8000, "con el monto nuevo");
  igual(ultima().despues.cuenta, "banco", "y su cuenta");
  const id = state.tx[0].id;
  fin.actions["remove-tx"](fakeEl({ "data-id": id }));
  igual(anotaciones().length, 2, "eliminar: UNA anotación más (no una por cada lista que se guarda)");
  igual(ultima().accion, "eliminar", "«eliminar»");
  igual(ultima().despues, null, "sin «después»");
  igual(ultima().antes.monto, 8000, "con cómo estaba");
  ok(ultima().cambios.indexOf("papelera") !== -1, "dice que fue a la papelera: «" + ultima().cambios + "»");
  fin.actions["restaurar-tx"](fakeEl({ "data-id": id }));
  igual(anotaciones().length, 3, "restaurar: UNA anotación más");
  igual(ultima().accion, "restaurar", "«restaurar» (no un «crear» cualquiera)");
  fin.actions["remove-tx"](fakeEl({ "data-id": id }));
  fin.actions["eliminar-tx-definitivo"](fakeEl({ "data-id": id }));
  igual(anotaciones().length, 5, "eliminar y borrar para siempre: dos anotaciones");
  igual(ultima().accion, "eliminar", "«eliminar»");
  ok(ultima().cambios.indexOf("para siempre") !== -1, "y dice que fue definitivo: «" + ultima().cambios + "»");
}

{
  console.log("== abonos y totales de un pedido");
  reiniciar(); comoAdmin();
  state.pedidos = [{ id: "P1", numeroOp: "OP-1", cliente: "Ana", descripcion: "Camisetas", total: 200000, costo: 100000, abono: 0, abonos: [], iva: { activo: false, porcentaje: 19 }, lineas: [], estado: "nuevo" }];
  bit.tomarFotos(state);
  state.formAbono = { pedidoId: "P1", monto: "50000", fecha: "2026-10-12", metodo: "banco" };
  await ped.actions["add-abono"](fakeEl({ "data-id": "P1" }));
  const lista = anotaciones();
  igual(lista.length, 2, "un abono deja 2 anotaciones: el abono y su movimiento en Finanzas");
  const a = lista.filter(x => x.aspecto === "abono")[0];
  ok(!!a && a.accion === "crear" && a.registroId === "P1" && a.despues.monto === 50000, "el abono: del pedido P1, por 50.000");
  igual(a.despues.fecha, "2026-10-12", "con su fecha");
  igual(a.despues.cuenta, "banco", "y su cuenta");
  ok(lista.some(x => x.aspecto === "movimiento" && x.despues.monto === 50000), "y el movimiento de ingreso");
  state.pedidos[0].total = 250000;
  state.pedidos[0].descuento = { tipo: "fijo", valor: 10000, motivo: "cliente frecuente" };
  await store.persist("pedidos");
  const p = ultima();
  igual(p.aspecto, "pedido", "cambiar el total anota el pedido");
  igual(p.antes.total, 200000, "antes: 200.000");
  igual(p.despues.total, 250000, "después: 250.000");
  ok(p.despues.descuento.indexOf("cliente frecuente") !== -1 && p.antes.descuento === "", "y el descuento (con su motivo) que antes no había");
  ok(p.cambios.indexOf("descuento") !== -1, "en palabras: «" + p.cambios + "»");
  igual(anotaciones().length, 3, "una sola anotación para el pedido, no una por campo");
  await ped.actions["eliminar-abono"](fakeEl({ "data-id": "P1", "data-abono": state.pedidos[0].abonos[0].id }));
  ok(anotaciones().some(x => x.aspecto === "abono" && x.accion === "eliminar"), "anular el abono también queda anotado");
}

{
  console.log("== cotizaciones, transferencias, cuentas, gastos fijos y deudas");
  reiniciar(); comoAdmin();
  state.cotizaciones = [{ id: "C1", cliente: "X", descripcion: "Uniformes", estado: "borrador", referencias: [], compras: [], costosGlobales: [], serviciosCobrados: [], iva: { activo: false, porcentaje: 19 }, vendedor: null }];
  state.transferencias = [{ id: "tr1", fecha: "2026-10-02", de: "efectivo", a: "banco", monto: 50000, nota: "", anulada: "", conciliadoDe: "", conciliadoA: "" }];
  state.config.gastosFijos = [{ id: "gf1", nombre: "Arriendo", monto: 150000, periodo: "mensual" }];
  state.deudas = [{ id: "d1", concepto: "Préstamo", contraparte: "Banco", monto: 1000000, cuotas: 4, cuotasPagadas: 0, periodo: "mensual", historial: [] }];
  bit.tomarFotos(state);
  state.cotizaciones[0].vendedor = { nombre: "Vero", tipo: "fijo", valor: 5000, estado: "pendiente" };
  await store.persist("cotizaciones");
  ok(ultima().aspecto === "cotización" && ultima().cambios.indexOf("comisión del vendedor") !== -1, "cotización: la comisión del vendedor queda anotada");
  state.formTransferencia = { de: "banco", a: "efectivo", monto: "20000", fecha: "2026-10-03", nota: "" };
  cuentas.actions["registrar-transferencia"]();
  ok(ultima().aspecto === "transferencia" && ultima().accion === "crear" && ultima().despues.monto === 20000, "transferencia nueva");
  cuentas.actions["toggle-anular-transferencia"](fakeEl({ "data-id": "tr1" }));
  ok(ultima().accion === "editar" && ultima().despues.anulada !== "" && ultima().antes.anulada === "", "anular una transferencia");
  state.config.gastosFijos = [{ id: "gf1", nombre: "Arriendo", monto: 180000, periodo: "mensual" }];
  await store.persist("config");
  ok(ultima().aspecto === "gasto fijo" && ultima().antes.monto === 150000 && ultima().despues.monto === 180000, "gasto fijo: de 150.000 a 180.000");
  state.config.cuentas = state.config.cuentas.concat([{ id: "davi", nombre: "Davivienda" }]);
  await store.persist("config");
  ok(ultima().aspecto === "cuenta" && ultima().accion === "crear", "agregar una cuenta");
  const antesConfig = anotaciones().length;
  state.config.nombre = "Otro nombre"; state.config.colorAcento = "#000000";
  await store.persist("config");
  igual(anotaciones().length, antesConfig, "cambiar el nombre o el color del taller no es dinero: no se anota");
  state.deudas[0].cuotasPagadas = 1;
  await store.persist("deudas");
  ok(ultima().aspecto === "deuda" && ultima().despues.cuotasPagadas === 1, "deuda: una cuota pagada");
  state.deudasHistorial = [Object.assign({}, state.deudas[0], { cuotasPagadas: 4 })]; state.deudas = [];
  await store.persist("deudasHistorial"); await store.persist("deudas");
  ok(ultima().accion === "eliminar" && ultima().cambios.indexOf("historial") !== -1, "al saldarla pasa al historial: «" + ultima().cambios + "»");
}

// ======================= 4. Automático, vendedor, sin red =======================
{
  console.log("== lo que la app corrige sola al cargar es «automático»");
  reiniciar(); comoAdmin();
  state.tx = [tx("t1")];
  bit.tomarFotos(state);
  bit.modoAutomatico(true);
  state.tx[0].pedidoId = "P9"; state.tx[0].cuenta = "banco";
  store.persist("tx");
  bit.modoAutomatico(false);
  igual(ultima().origen, "automatico", "origen «automatico»");
  igual(ultima().usuario, "automatico", "no lleva el correo de ninguna persona");
  ok(ultima().nombre.indexOf("automática") !== -1, "ni su nombre: «" + ultima().nombre + "»");
  state.tx[0].cuenta = "efectivo";
  store.persist("tx");
  igual(ultima().origen, "persona", "al terminar la carga, lo siguiente vuelve a ser de una persona");

  console.log("== el vendedor queda con su nombre");
  comoVendedor();
  state.formAbono = { pedidoId: "", monto: "", fecha: "", metodo: "" };
  state.pedidos = [{ id: "P1", numeroOp: "OP-1", cliente: "Ana", descripcion: "Gorras", total: 100000, costo: 0, abono: 0, abonos: [], iva: { activo: false, porcentaje: 19 }, lineas: [], estado: "nuevo" }];
  bit.tomarFotos(state);
  state.formAbono = { pedidoId: "P1", monto: "30000", fecha: "2026-10-15", metodo: "efectivo" };
  await ped.actions["add-abono"](fakeEl({ "data-id": "P1" }));
  const del = anotaciones().filter(x => x.aspecto === "abono")[0];
  igual(del.nombre, "Vero", "nombre del vendedor");
  igual(del.usuario, VENDE.email, "su correo");
  igual(del.rol, "vendedor", "y su rol");
  comoAdmin();
}

{
  console.log("== sin red: la acción sigue y la anotación espera");
  reiniciar(); comoAdmin();
  let falla = true;
  bit._configurarParaPruebas({
    agregar: async (items) => { if (falla) throw new Error("Failed to fetch"); hoja = hoja.concat(copia(items)); },
    leer: async () => copia(hoja)
  });
  state.tx = [tx("t1")];
  bit.tomarFotos(state);
  fin.actions["guardar-tx-edit"](conFila({ "data-id": "t1" }, { "edit-concepto": "Hilo", "edit-monto": "130000", "edit-fecha": "2026-10-05", "edit-tipo": "gasto", "edit-cuenta": "efectivo", "edit-contraparte": "" }));
  igual(state.tx[0].monto, 130000, "el cambio de dinero NO se bloqueó");
  await bit.volcar();
  igual(bit.estadoBitacora().pendientes, 1, "la anotación quedó en cola (1 pendiente)");
  ok(bit.estadoBitacora().error.indexOf("Failed to fetch") !== -1, "con el motivo a la vista: «" + bit.estadoBitacora().error + "»");
  igual(hoja.length, 0, "y la Sheet sigue sin ella");
  ok(!!localStorage.getItem("taller_bitacora_cola_v1"), "la cola está en el disco del navegador (sobrevive a cerrar la pestaña)");
  igual(JSON.parse(localStorage.getItem("taller_bitacora_cola_v1"))[0].despues.monto, 130000, "con el cambio completo");
  ok(anotaciones().length === 1, "y la pantalla ya la ve (cola incluida)");
  falla = false;
  await bit.volcar();
  igual(bit.estadoBitacora().pendientes, 0, "al volver la red se escribe y la cola queda vacía");
  igual(hoja.length, 1, "la Sheet la tiene");
  igual(localStorage.getItem("taller_bitacora_cola_v1"), null, "y el disco se limpia");
  hoja = hoja.concat(copia(hoja)); // un append reintentado que SÍ había llegado: la fila queda repetida
  await bit.cargarBitacora(true);
  igual(anotaciones().length, 1, "una fila repetida (mismo id) se cuenta una sola vez");
}

// ======================= 5. Cierre de mes =======================
const FEC = "2025-09"; // un mes que ya terminó, pase lo que pase con el reloj
function datosCierre() {
  reiniciar(); comoAdmin();
  state.tx = [
    { id: "i1", tipo: "ingreso", fecha: "2025-09-10", concepto: "Abono — Camisetas", monto: 300000, cuenta: "banco", pedidoId: "P1", origenAbonoId: "a1", contraparte: "", cotizacionId: "" },
    { id: "g1", tipo: "gasto", fecha: "2025-09-15", concepto: "Hilo", monto: 80000, cuenta: "efectivo", contraparte: "", pedidoId: "", cotizacionId: "" },
    { id: "c1", tipo: "comision", fecha: "2025-09-25", concepto: "Comisión — Vero", monto: 20000, cuenta: "efectivo", pedidoId: "P1", origenComisionPedidoId: "P1", contraparte: "Vero", cotizacionId: "" },
    { id: "o1", tipo: "ingreso", fecha: "2025-10-03", concepto: "Venta de octubre", monto: 50000, cuenta: "efectivo", contraparte: "", pedidoId: "", cotizacionId: "" }
  ];
  state.txPapelera = [{ id: "x1", tipo: "gasto", fecha: "2025-09-12", concepto: "Borrado antes", monto: 1000, cuenta: "efectivo", eliminadoEl: "2025-09-13", contraparte: "", pedidoId: "", cotizacionId: "" }];
  state.pedidos = [{
    id: "P1", numeroOp: "OP-1", cliente: "Ana", descripcion: "Camisetas", total: 300000, costo: 0, abono: 300000,
    abonos: [{ id: "a1", monto: 300000, fecha: "2025-09-10", metodoPago: "banco" }],
    iva: { activo: false, porcentaje: 19 }, lineas: [], estado: "nuevo",
    vendedor: { nombre: "Vero", tipo: "fijo", valor: 20000, estado: "pagado" }
  }];
  state.transferencias = [{ id: "tr1", fecha: "2025-09-20", de: "banco", a: "efectivo", monto: 50000, nota: "", anulada: "", conciliadoDe: "", conciliadoA: "" }];
  bit.tomarFotos(state);
}

{
  console.log("== el resumen de un mes sale de las mismas funciones que los reportes");
  datosCierre();
  const r = calc.calcResumenMes(FEC);
  igual(r.ingresos, 300000, "ingresos de septiembre");
  igual(r.gastos, 100000, "gastos (el gasto + la comisión)");
  igual(r.balance, 200000, "balance");
  igual(r.caja, 200000, "Caja al final del mes (octubre no cuenta)");
  igual(r.movimientos, 3, "3 movimientos");
  const porId = {}; r.cuentas.forEach(c => { porId[c.id] = c.saldo; });
  igual(porId.banco, 250000, "Banco: +300.000 − 50.000 de la transferencia");
  igual(porId.efectivo, -50000, "Efectivo: −80.000 −20.000 +50.000");
  igual(r.cuentas.reduce((a, c) => a + c.saldo, 0), r.caja, "las cuentas suman la Caja de ese mes (la garantía de siempre)");
  igual(calc.calcSaldosPorCuenta().caja, calc.calcCaja(), "y sin mes, calcSaldosPorCuenta se comporta como antes");
  igual(calc.calcResumenMovimientos(state.tx.filter(t => t.fecha.slice(0, 7) === FEC)).balance, r.balance, "el balance es el de calcResumenMovimientos");
}

{
  console.log("== cerrar: solo el admin, solo un mes que ya terminó");
  datosCierre();
  comoVendedor();
  let res = cierre.cerrarMes(FEC);
  ok(!res.ok && res.error.indexOf("administrador") !== -1, "un vendedor no puede cerrar un mes");
  igual(state.cierres.length, 0, "y no queda nada cerrado");
  comoAdmin();
  const hoy = new Date().toISOString().slice(0, 7);
  res = cierre.cerrarMes(hoy);
  ok(!res.ok && res.error.indexOf("en curso") !== -1, "el mes en curso no se puede cerrar");
  res = cierre.cerrarMes("2099-01");
  ok(!res.ok, "ni uno futuro");
  res = cierre.cerrarMes("2025-13");
  ok(!res.ok, "ni un mes inventado");
  res = cierre.cerrarMes(FEC);
  ok(res.ok, "el admin cierra septiembre 2025");
  const c = state.cierres[0];
  igual(c.mes, FEC, "mes");
  igual(c.estado, "cerrado", "estado «cerrado»");
  igual(c.cerradoPor, ADMIN.email, "quién (correo)");
  igual(c.cerradoPorNombre, ADMIN.nombre, "quién (nombre)");
  ok(!isNaN(Date.parse(c.cerradoEn)), "cuándo: " + c.cerradoEn);
  igual(c.resumen.ingresos, 300000, "resumen: ingresos");
  igual(c.resumen.gastos, 100000, "resumen: gastos");
  igual(c.resumen.caja, 200000, "resumen: Caja al final del mes");
  ok(c.resumen.cuentas.some(x => x.id === "banco" && x.saldo === 250000), "resumen: saldo por cuenta");
  res = cierre.cerrarMes(FEC);
  ok(!res.ok && res.error.indexOf("ya está cerrado") !== -1, "cerrarlo otra vez no hace nada");
  ok(!!calc.periodoCerrado("2025-09-01") && !!calc.periodoCerrado("2025-09-30"), "periodoCerrado: cualquier día de septiembre");
  igual(calc.periodoCerrado("2025-10-01"), null, "octubre sigue abierto");
  igual(calc.periodoCerrado("2025-08-31"), null, "y agosto");
  igual(calc.periodoCerrado(""), null, "una fecha vacía no es de ningún mes");
  igual(calc.periodoCerrado("no es fecha"), null, "ni un texto cualquiera");
  const ev = anotaciones().filter(x => x.accion === "cerrar-mes")[0];
  ok(!!ev && ev.usuario === ADMIN.email && ev.registroId === FEC && ev.meses === FEC, "el cierre quedó en la bitácora, con quién lo hizo");
  igual(cierre.listaMesesCierre().filter(m => m.mes === FEC)[0].estado, "cerrado", "la pantalla lo lista como cerrado");
}

{
  console.log("== un mes cerrado bloquea CADA tipo de escritura");
  datosCierre();
  comoAdmin();
  cierre.cerrarMes(FEC);
  const foto = () => JSON.stringify({ tx: state.tx, p: state.txPapelera, ped: state.pedidos, tr: state.transferencias, col: state.config.colchonMovimientos });
  const cajaAntes = calc.calcCaja();
  const entradasAntes = anotaciones().length;
  let n = 0;
  async function bloquea(que, fn) {
    n++;
    avisos = []; const f0 = foto();
    await fn();
    ok(avisos.length === 1 && avisos[0].indexOf("septiembre 2025") !== -1 && avisos[0].indexOf("cerrado") !== -1, que + ": se rechaza y dice qué mes está cerrado");
    ok(foto() === f0, que + ": no cambió NADA");
  }

  await bloquea("registrar un movimiento", () => { state.formTx = Object.assign({}, state.formTx, { tipo: "gasto", concepto: "Tarde", monto: "5000", fecha: "2025-09-30", cuenta: "efectivo", servicios: [] }); fin.actions["add-tx"](); });
  await bloquea("editar el monto de un movimiento", () => fin.actions["guardar-tx-edit"](conFila({ "data-id": "g1" }, { "edit-concepto": "Hilo", "edit-monto": "90000", "edit-fecha": "2025-09-15", "edit-tipo": "gasto", "edit-cuenta": "efectivo", "edit-contraparte": "" })));
  await bloquea("sacar un movimiento de septiembre cambiándole la fecha", () => fin.actions["guardar-tx-edit"](conFila({ "data-id": "g1" }, { "edit-concepto": "Hilo", "edit-monto": "80000", "edit-fecha": "2025-10-02", "edit-tipo": "gasto", "edit-cuenta": "efectivo", "edit-contraparte": "" })));
  await bloquea("meter un movimiento en septiembre cambiándole la fecha", () => fin.actions["guardar-tx-edit"](conFila({ "data-id": "o1" }, { "edit-concepto": "Venta de octubre", "edit-monto": "50000", "edit-fecha": "2025-09-28", "edit-tipo": "ingreso", "edit-cuenta": "efectivo", "edit-contraparte": "" })));
  await bloquea("eliminar un movimiento", () => fin.actions["remove-tx"](fakeEl({ "data-id": "g1" })));
  await bloquea("restaurar un movimiento de la papelera", () => fin.actions["restaurar-tx"](fakeEl({ "data-id": "x1" })));
  await bloquea("borrar para siempre uno de la papelera", () => fin.actions["eliminar-tx-definitivo"](fakeEl({ "data-id": "x1" })));
  await bloquea("cambiar la cuenta de un movimiento", () => cuentas.actions["asignar-cuenta-tx"](fakeEl({ "data-id": "g1" }, "banco")));
  await bloquea("registrar un abono", () => { state.formAbono = { pedidoId: "P1", monto: "10000", fecha: "2025-09-18", metodo: "banco" }; return ped.actions["add-abono"](fakeEl({ "data-id": "P1" })); });
  await bloquea("editar un abono", () => ped.actions["guardar-abono-edit"](conFila({ "data-id": "P1", "data-abono": "a1" }, { "edit-abono-monto": "310000", "edit-abono-fecha": "2025-09-10", "edit-abono-metodo": "banco" })));
  await bloquea("anular un abono", () => ped.actions["eliminar-abono"](fakeEl({ "data-id": "P1", "data-abono": "a1" })));
  await bloquea("registrar un reembolso", () => { state.formReembolso = { monto: "10000", fecha: "2025-09-18", motivo: "", cuenta: "" }; return ped.actions["add-reembolso"](fakeEl({ "data-id": "P1" })); });
  await bloquea("deshacer el pago de una comisión", () => ped.actions["toggle-comision"](fakeEl({ "data-id": "P1" })));
  await bloquea("eliminar un pedido con plata de ese mes", () => ped.actions["remove-pedido"](fakeEl({ "data-id": "P1" })));
  await bloquea("registrar una transferencia", () => { state.formTransferencia = { de: "banco", a: "efectivo", monto: "1000", fecha: "2025-09-22", nota: "" }; return cuentas.actions["registrar-transferencia"](); });
  await bloquea("anular una transferencia", () => cuentas.actions["toggle-anular-transferencia"](fakeEl({ "data-id": "tr1" })));
  await bloquea("aportar al Colchón", () => { state.formColchon = { monto: "1000", origen: "aporte", fecha: "2025-09-20", nota: "" }; return resumen.actions["guardar-relleno-colchon"](); });
  await bloquea("un recibo de compra que toque ese mes", () => {
    const ok1 = cot.ejecutarAccionRecibo({ recibos: [], deltaCaja: -5000 }, () => { state.tx.unshift({ id: "rc1", tipo: "gasto", fecha: "2025-09-11", concepto: "Recibo", monto: 5000, cuenta: "efectivo" }); });
    ok(ok1 === false, "(un recibo de compra devuelve false y restaura lo que había)");
  });

  igual(calc.calcCaja(), cajaAntes, "después de todos los intentos la Caja es la misma");
  igual(anotaciones().length, entradasAntes, "y la bitácora no anotó ningún cambio (no hubo ninguno)");
  ok(n >= 17, "se probaron " + n + " tipos de escritura");

  console.log("== lo que SÍ se puede");
  avisos = [];
  state.formTx = Object.assign({}, state.formTx, { tipo: "gasto", concepto: "Octubre", monto: "7000", fecha: "2025-10-05", cuenta: "efectivo", servicios: [] });
  fin.actions["add-tx"]();
  ok(avisos.length === 0 && state.tx.some(t => t.concepto === "Octubre"), "un movimiento de un mes abierto se registra normal");
  cuentas.actions["toggle-conciliado"](marca(true, { "data-clave": "tx:g1" }));
  ok(avisos.length === 0 && !!state.tx.filter(t => t.id === "g1")[0].conciliadoEn, "conciliar con el extracto un movimiento de un mes cerrado sí (no cambia ningún número)");
  ok(calc.calcDiferenciasCierre(state.cierres[0]).length === 0, "y el mes cerrado sigue valiendo lo mismo");

  console.log("== el mensaje dice quién lo cerró, y le habla a cada rol");
  avisos = [];
  fin.actions["remove-tx"](fakeEl({ "data-id": "g1" }));
  ok(avisos[0].indexOf("Dueño Taller") !== -1, "dice quién lo cerró (" + ADMIN.nombre + ")");
  ok(avisos[0].indexOf("Cierre de mes") !== -1, "al admin le dice dónde reabrirlo");
  comoVendedor(); avisos = [];
  fin.actions["remove-tx"](fakeEl({ "data-id": "g1" }));
  ok(avisos[0].indexOf("Pídele al administrador") !== -1, "al vendedor le dice que se lo pida al admin");
  comoAdmin();
}

{
  console.log("== reabrir exige un motivo y queda en la bitácora");
  datosCierre();
  comoAdmin();
  cierre.cerrarMes(FEC);
  let res = cierre.reabrirMes(FEC, "");
  ok(!res.ok && res.error.indexOf("motivo") !== -1, "sin motivo no se reabre");
  res = cierre.reabrirMes(FEC, "  x ");
  ok(!res.ok, "un motivo de una letra tampoco");
  igual(state.cierres[0].estado, "cerrado", "sigue cerrado");
  comoVendedor();
  res = cierre.reabrirMes(FEC, "Quiero cambiar algo");
  ok(!res.ok && res.error.indexOf("administrador") !== -1, "un vendedor no puede reabrir");
  comoAdmin();
  res = cierre.reabrirMes("2025-08", "No estaba cerrado");
  ok(!res.ok, "un mes que no está cerrado no se reabre");
  res = cierre.reabrirMes(FEC, "Faltó registrar un abono de ese mes");
  ok(res.ok, "con motivo, el admin lo reabre");
  igual(state.cierres[0].estado, "reabierto", "estado «reabierto»");
  igual(calc.periodoCerrado("2025-09-15"), null, "ya no bloquea");
  const ev = anotaciones().filter(x => x.accion === "reabrir-mes")[0];
  ok(!!ev && ev.usuario === ADMIN.email && ev.cambios.indexOf("Faltó registrar un abono") !== -1, "la reapertura quedó en la bitácora con quién y el motivo");
  const h = state.cierres[0].historial;
  ok(h.length === 2 && h[1].accion === "reabierto" && h[1].motivo.indexOf("Faltó") !== -1, "y en el historial del propio mes");
  avisos = [];
  state.formTx = Object.assign({}, state.formTx, { tipo: "ingreso", concepto: "Abono olvidado", monto: "15000", fecha: "2025-09-29", cuenta: "efectivo", servicios: [] });
  fin.actions["add-tx"]();
  ok(avisos.length === 0 && state.tx.some(t => t.concepto === "Abono olvidado"), "mientras está reabierto se puede corregir");
  ok(calc.calcDiferenciasCierre(state.cierres[0]).length > 0, "y el mes ya no vale lo que valía al cerrarlo");
  await new Promise(r => setTimeout(r, 5));
  res = cierre.cerrarMes(FEC);
  ok(res.ok, "se vuelve a cerrar");
  igual(state.cierres[0].resumen.ingresos, 315000, "con los números nuevos");
  igual(state.cierres[0].historial.length, 3, "el historial guarda el cierre, la reapertura y el nuevo cierre");
  igual(state.cierres.length, 1, "sigue siendo UNA fila por mes");
  ok(calc.calcDiferenciasCierre(state.cierres[0]).length === 0, "y vuelve a coincidir");
}

// ======================= 6. Salud de los datos: «Meses cerrados» =======================
{
  console.log("== la verificación detecta un mes cerrado que cambió");
  datosCierre();
  comoAdmin();
  const regla = () => salud.calcSaludDatos().filter(h => h.regla === "meses-cerrados");
  ok(salud.VERIFICACIONES_SALUD.some(v => v.id === "meses-cerrados"), "está registrada con registrarVerificacion");
  ok(salud.calcResumenSalud().revisadas.some(v => v.id === "meses-cerrados"), "y el resumen la cuenta entre lo revisado");
  igual(regla().length, 0, "sin ningún mes cerrado no dice nada");
  cierre.cerrarMes(FEC);
  let hs = regla();
  igual(hs.length, 1, "con un mes cerrado y la bitácora sin leer: un aviso");
  ok(hs[0].id === "meses-cerrados:bitacora-sin-leer" && hs[0].severidad === "aviso", "«no se ha podido leer la bitácora» (no calla)");
  await bit.volcar(); await bit.cargarBitacora(true);
  igual(regla().length, 0, "leída la bitácora y con el mes intacto: todo cuadra");

  const g1 = state.tx.filter(t => t.id === "g1")[0];
  g1.monto = 90000; // alguien lo cambió sin pasar por la app
  hs = regla();
  igual(hs.length, 1, "si los números del mes cambian: UN hallazgo");
  ok(hs[0].severidad === "error", "es un error");
  ok(hs[0].id === "meses-cerrados:mes:2025-09" && hs[0].titulo.indexOf("Septiembre 2025") === 0, "del mes correcto: «" + hs[0].titulo + "»");
  ok(hs[0].detalle.indexOf("Gastos") !== -1 && hs[0].detalle.indexOf("$100.000") !== -1 && hs[0].detalle.indexOf("$110.000") !== -1, "dice qué número cambió, de cuánto a cuánto");
  ok(hs[0].detalle.indexOf("Google Sheet") !== -1, "y que la bitácora no sabe de ese cambio (pudo ser directo en la Sheet)");
  ok(hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "g1"), "con enlace a los movimientos del mes");
  const antesTx = JSON.stringify(state.tx);
  salud.calcSaludDatos();
  igual(JSON.stringify(state.tx), antesTx, "SOLO LEE: no arregla nada");
  g1.monto = 80000;
  igual(regla().length, 0, "al deshacerlo vuelve a cuadrar");

  console.log("== o cuando la bitácora dice que lo tocaron después del cierre");
  const cierreEn = state.cierres[0].cerradoEn;
  const despues = new Date(Date.parse(cierreEn) + 60000).toISOString();
  const antes = new Date(Date.parse(cierreEn) - 60000).toISOString();
  const entrada = (extra) => Object.assign({ id: "z" + Math.random(), fecha: despues, usuario: VENDE.email, nombre: "Vero", rol: "vendedor", origen: "persona", clave: "tx", registroId: "g1", subId: "", aspecto: "movimiento", accion: "editar", etiqueta: "Hilo ($80.000, 2025-09-15)", cambios: "monto: $80.000 → $90.000", antes: { fecha: "2025-09-15", monto: 80000 }, despues: { fecha: "2025-09-15", monto: 90000 }, meses: FEC, enMesCerrado: "1" }, extra || {});
  hoja.push(entrada({ id: "persona-1" }));
  await bit.cargarBitacora(true);
  hs = regla();
  igual(hs.length, 1, "un cambio posterior al cierre: UN hallazgo (aunque los números hayan vuelto a coincidir)");
  ok(hs[0].severidad === "error" && hs[0].detalle.indexOf("Vero") !== -1 && hs[0].detalle.indexOf("editar") !== -1, "error, con quién y qué hizo: «" + hs[0].detalle.slice(0, 160) + "…»");
  g1.monto = 90000;
  hs = regla();
  igual(hs.length, 1, "si además los números cambiaron, SIGUE siendo un solo hallazgo por mes (no cuenta el problema doble)");
  ok(hs[0].detalle.indexOf("Hoy suma distinto") !== -1 && hs[0].detalle.indexOf("Vero") !== -1, "con las dos razones juntas");
  ok(hs[0].detalle.indexOf("Google Sheet") === -1, "(y ya no dice que fue directo en la Sheet: la bitácora lo explica)");
  g1.monto = 80000;

  hoja = [entrada({ id: "auto-1", origen: "automatico", usuario: "automatico", nombre: "Corrección automática al cargar", rol: "sistema" })];
  await bit.cargarBitacora(true);
  hs = regla();
  ok(hs.length === 1 && hs[0].severidad === "aviso", "si fue una reparación automática al cargar: solo un aviso");
  hoja = [entrada({ id: "link-1", cambios: "pedido", antes: { fecha: "2025-09-15", monto: 80000, pedidoId: "" }, despues: { fecha: "2025-09-15", monto: 80000, pedidoId: "P1" } })];
  await bit.cargarBitacora(true);
  igual(regla().length, 0, "reapuntar un movimiento a su pedido no mueve plata: no cuenta");
  hoja = [entrada({ id: "vieja-1", fecha: antes })];
  await bit.cargarBitacora(true);
  igual(regla().length, 0, "lo hecho ANTES del cierre no cuenta");
  hoja = [entrada({ id: "otro-mes", meses: "2025-10", antes: { fecha: "2025-10-15" }, despues: { fecha: "2025-10-15" } })];
  await bit.cargarBitacora(true);
  igual(regla().length, 0, "ni lo de otro mes");
  hoja = [entrada({ id: "ev-1", accion: "reabrir-mes", origen: "persona" }), entrada({ id: "ev-2", accion: "cerrar-mes" })];
  await bit.cargarBitacora(true);
  igual(regla().length, 0, "ni el propio cierre o reapertura");

  console.log("== un mes reabierto no se vigila; y el texto del informe lo incluye");
  hoja = [entrada({ id: "persona-2" })];
  await bit.cargarBitacora(true);
  ok(regla().length === 1, "(de nuevo con un cambio posterior)");
  cierre.reabrirMes(FEC, "Corregir un gasto");
  igual(regla().length, 0, "reabierto: ya no hay nada que vigilar");
  cierre.cerrarMes(FEC);
  hoja = [entrada({ id: "persona-3" })];
  await bit.cargarBitacora(true);
  ok(salud.textoInformeSalud("2025-10-31").indexOf("Septiembre 2025 cambió después de cerrarse") !== -1, "el informe copiable cuenta el hallazgo");
}

// ======================= 7. Las pantallas =======================
{
  console.log("== Cierre de mes y Bitácora (solo lectura, solo admin)");
  datosCierre();
  comoAdmin();
  cierre.cerrarMes(FEC);
  let html = cierresUi.renderCierre();
  ok(html.indexOf("Cierre de mes") !== -1 && html.indexOf("septiembre 2025") !== -1, "la pantalla de cierre lista septiembre 2025");
  ok(html.indexOf("Cerrado") !== -1 && html.indexOf("Reabrir") !== -1, "cerrado, con su botón de reabrir");
  ok(html.indexOf("Dueño Taller") !== -1, "y quién lo cerró");
  ok(html.indexOf("buscador") !== -1 && html.indexOf("mes") !== -1, "con buscador y contador (reglas de UX)");
  state.cierreReabriendo = FEC;
  ok(cierresUi.renderCierre().indexOf("Motivo para reabrir") !== -1, "al reabrir pide el motivo en pantalla");
  state.cierreReabriendo = "";
  state.tx.filter(t => t.id === "g1")[0].monto = 91000;
  ok(cierresUi.renderCierre().indexOf("ya no suma lo que sumaba") !== -1, "si el mes cambió, la pantalla lo grita");
  state.tx.filter(t => t.id === "g1")[0].monto = 80000;

  await bit.volcar(); await bit.cargarBitacora(true);
  hoja.push({ id: "mc", fecha: new Date().toISOString(), usuario: VENDE.email, nombre: "Vero", rol: "vendedor", origen: "persona", clave: "tx", registroId: "g1", subId: "", aspecto: "movimiento", accion: "editar", etiqueta: "Hilo", cambios: "monto: $80.000 → $81.000", antes: { monto: 80000 }, despues: { monto: 81000 }, meses: FEC, enMesCerrado: "1" });
  await bit.cargarBitacora(true);
  html = bitacoraUi.renderBitacora();
  ok(html.indexOf("Bitácora de cambios") !== -1, "la bitácora tiene su pantalla");
  ok(html.indexOf("cambios") !== -1 && html.indexOf("buscador") !== -1, "con buscador y contador de cambios");
  ok(html.indexOf("Quién") !== -1 && html.indexOf("Desde") !== -1 && html.indexOf("Hasta") !== -1 && html.indexOf("Qué") !== -1, "y filtros por fecha, persona y tipo");
  ok(html.indexOf("en mes cerrado") !== -1, "marca lo hecho en un mes cerrado");
  ok(html.indexOf('data-action="salud-ir"') !== -1, "con enlace al registro afectado");
  ok(html.indexOf("Cerró el mes") !== -1 && html.indexOf("Editó") !== -1, "y dice en español qué se hizo");
  ok(!/data-action="(editar|remove|eliminar)[^"]*"/.test(html.replace(/data-action="eliminar-?"/g, "")), "es de solo lectura: sin botones de editar ni borrar");
  state.bitacoraBuscar = "Vero";
  ok(bitacoraUi.renderBitacora().indexOf("de ") !== -1, "buscar filtra y el contador dice «X de Y»");
  state.bitacoraBuscar = "";
  comoVendedor();
  ok(bitacoraUi.renderBitacora().indexOf("Solo el administrador") !== -1 && cierresUi.renderCierre().indexOf("Solo el administrador") !== -1, "un vendedor no ve ninguna de las dos");
  comoAdmin();
  state.finanzasVista = "cierre";
  ok(fin.render().indexOf("Cierre de mes") !== -1, "Finanzas tiene la pestaña «Cierre de mes»");
  state.finanzasVista = "bitacora";
  ok(fin.render().indexOf("Bitácora") !== -1, "y la pestaña «Bitácora»");
  state.finanzasVista = "nuevo";
  ok(fin.render().indexOf("🔒 Cierre de mes") !== -1 && fin.render().indexOf("📒 Bitácora") !== -1, "ambas siempre a la vista en las pestañas de Finanzas");
}

globalThis.fetch = fetchOriginal;
console.log("\n" + (fallos ? "FALLARON " + fallos + " de " + pruebas : "OK " + pruebas + " pruebas de bitácora y cierre de mes"));
process.exit(fallos ? 1 : 0);
