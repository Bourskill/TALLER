// Salud de los datos: el chequeo de integridad (core/salud.js), el registro de
// lo que loadAll() corrige en silencio (core/store.js) y el panel que lo
// muestra (modules/salud.js).
//
// Se corre solo, aparte de smoke.mjs:   node test/salud.mjs
//
// No necesita jsdom (igual que descuentos.mjs): se stubean los pocos globales
// que store.js toca al importarse.
//
// La idea de fondo: un conjunto de datos LIMPIO tiene que dar CERO hallazgos
// (si no, el panel grita por nada y el dueño aprende a ignorarlo), y cada
// corrupción tiene que dar EXACTAMENTE el hallazgo esperado, ni más ni menos
// (si da dos por una sola causa, el dueño cuenta el problema doble).

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; } }; };
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, removeChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], remove: noop, select: noop });
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { getElementById: () => null, createElement: el, addEventListener: noop, dispatchEvent: noop, querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el(), head: el(), visibilityState: "visible", execCommand: () => true };
globalThis.window = Object.assign(globalThis.window || {}, { localStorage, sessionStorage, document, addEventListener: noop, removeEventListener: noop, location: { href: "http://localhost/", search: "", hash: "" }, matchMedia: () => ({ matches: false, addEventListener: noop }), confirm: () => true, alert: noop });
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.confirm = () => true; globalThis.alert = noop;
// store.js/pdf.js importan jsPDF al cargarse aunque aquí no se imprima nada.
globalThis.window.jspdf = { jsPDF: function () { return new Proxy({}, { get: () => () => ({}) }); } };

const R = new URL("../js/", import.meta.url).href;
const calc = await import(R + "core/calc.js");
const utils = await import(R + "core/utils.js");
const store = await import(R + "core/store.js");
const salud = await import(R + "core/salud.js");
const ui = await import(R + "modules/salud.js");
const config = await import(R + "modules/config.js");
const { state } = store;

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { ok(a === b, msg + "  (obtuvo " + a + ", esperaba " + b + ")"); }
const fakeEl = (attrs) => ({ value: "", getAttribute: k => (k in attrs ? attrs[k] : null) });

// ======================= datos limpios =======================
// Un taller "sano" con un poco de todo lo que la app genera sola: abonos con su
// reembolso, descuentos, una comisión de pedido y una de cotización, un pedido
// viejo (con su base sin respaldo), gasto fijo pagado y de un periodo cerrado,
// cuotas de deuda, un servicio con lo gastado, y un recibo de compra.
const HOY = "2026-10-29";
// La nómina se mira en el periodo EN CURSO, que sale de la fecha de hoy de
// verdad (no de HOY): sus pagos de prueba llevan esta fecha.
const HOY_REAL = utils.todayStr();
// Una cotización con un insumo («Tela») que sí aparece en la lista de compras.
function cotConInsumo(id, extra) {
  return Object.assign({
    id, cliente: "Cliente", descripcion: "Pedido " + id, fecha: HOY, estado: "convertida", pedidoId: "", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: id,
    referencias: [{ id: "ref-" + id, nombre: "Camiseta", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 20000, origen: "taller", costoCompra: 0, proveedorId: "",
      insumos: [{ id: "ins-" + id, nombre: "Tela", unidad: "mt", costo: 9000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }], detalle: [], estado: "nuevo", estadosDef: null }],
    costosGlobales: [], serviciosCobrados: [], compras: []
  }, extra || {});
}
const claveTela = (c) => calc.calcListaCompras(c).filter(l => l.nombre === "Tela")[0].clave;
function datosLimpios() {
  const pedidos = [
    { id: "P1", numeroOp: "OP-1", cliente: "Ana", descripcion: "Camisetas", total: 200000, abono: 100000, iva: { activo: false, porcentaje: 19 },
      lineas: [{ id: "l1", cantidad: 10, precioUnitario: 20000 }],
      abonos: [{ id: "a1", monto: 100000, fecha: "2026-10-20", metodoPago: "efectivo" }] },
    { id: "P2", numeroOp: "OP-2", cliente: "Club Sol", descripcion: "Uniformes", total: 300000, abono: 250000, iva: { activo: false, porcentaje: 19 },
      lineas: [{ id: "l2a", cantidad: 10, precioUnitario: 30000, descuento: { tipo: "porcentaje", valor: 10 } }, { id: "l2b", cantidad: 1, precioUnitario: 50000 }],
      descuento: { tipo: "fijo", valor: 20000 },
      abonos: [{ id: "a2", monto: 300000, fecha: "2026-10-21" }, { id: "r2", monto: 50000, tipo: "reembolso", fecha: "2026-10-22" }] },
    { id: "P3", numeroOp: "OP-3", cliente: "Luis", descripcion: "Gorras", total: 200000, abono: 0, abonos: [], iva: { activo: false, porcentaje: 19 },
      lineas: [{ id: "l3", cantidad: 2, precioUnitario: 100000 }],
      vendedor: { nombre: "Ana V", tipo: "fijo", valor: 10000, estado: "pagado" } },
    // Pedido VIEJO: sin líneas y con lo abonado sin ninguna fila de abono detrás.
    { id: "P4", numeroOp: "OP-0", cliente: "Marta", descripcion: "Pedido de antes", total: 80000, abono: 50000, iva: { activo: false, porcentaje: 19 } },
    // Un vendedor por PORCENTAJE (10 %) con su comisión ya pagada por lo que da hoy la fórmula.
    { id: "P8", numeroOp: "OP-8", cliente: "Leo", descripcion: "Bolsos", total: 100000, abono: 100000, iva: { activo: false, porcentaje: 19 },
      lineas: [{ id: "l8", cantidad: 1, precioUnitario: 100000 }], abonos: [{ id: "a8", monto: 100000, fecha: "2026-10-27" }],
      vendedor: { nombre: "Zoe V", tipo: "porcentaje", valor: 10, estado: "pagado" } },
    // Consignación: el punto reportó tres ventas. v1 con su comisión ya pagada; v2 con la
    // comisión pendiente; v3 es de ANTES de septiembre (su ingreso perdió la marca de origen).
    { id: "P6", numeroOp: "OP-6", cliente: "Punto Sur", descripcion: "Consignación", total: 0, abono: 0, abonos: [], iva: { activo: false, porcentaje: 19 },
      consignacion: { puntoId: "", comisionTipo: "porcentaje", comisionValor: 10, precioUnitario: 50000, cantidadEnviada: 0, retiros: [], remisiones: [],
        ventas: [
          { id: "v1", cantidad: 2, fecha: "2026-10-24", montoTotal: 100000, comisionMonto: 10000, comisionPagada: true },
          { id: "v2", cantidad: 1, fecha: "2026-10-25", montoTotal: 50000, comisionMonto: 5000, comisionPagada: false },
          { id: "v3", cantidad: 1, fecha: "2026-08-10", montoTotal: 30000, comisionMonto: 3000, comisionPagada: false }
        ] } }
  ];
  const cotServ = {
    id: "cot-serv", cliente: "Cliente", descripcion: "Servicios", fecha: HOY, estado: "convertida", pedidoId: "", gastosReales: [], iva: { activo: false, porcentaje: 19 }, vendedor: null, codigoPublico: "cs1",
    referencias: [{ id: "ref1", nombre: "Camiseta", imagenUrl: "", consumoAprox: 1, cantidadPedida: 10, precioVenta: 40000, origen: "taller", costoCompra: 0, proveedorId: "",
      insumos: [{ id: "ins-conf", nombre: "Confección", unidad: "servicio", costo: 5000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" }], detalle: [], estado: "nuevo", estadosDef: null }],
    costosGlobales: [], serviciosCobrados: [], compras: []
  };
  const claveConf = calc.calcListaCompras(cotServ).filter(l => l.nombre === "Confección")[0].clave;
  cotServ.compras = [{ clave: claveConf, estado: "servicio", costoReal: 50000 }];
  const cotComision = { id: "C1", cliente: "Beto", descripcion: "Cotización con vendedor", estado: "borrador", pedidoId: "", referencias: [], compras: [], costosGlobales: [], serviciosCobrados: [],
    vendedor: { nombre: "Beto V", tipo: "fijo", valor: 5000, estado: "pagado" } };
  // Un recibo de compra bien armado, con sus filas en Finanzas.
  const CLAVE_TELA = "tela montreal|mt|tela";
  const grupo = { linea: CLAVE_TELA, nombre: "Tela Montreal", unidad: "MT", esProducto: false, esGlobal: false, participantes: [
    { cotId: "cotA-rc", pedidoId: "pA-rc", compraClave: CLAVE_TELA, necesita: 10, costoEstimado: 90000 },
    { cotId: "cotB-rc", pedidoId: "pB-rc", compraClave: CLAVE_TELA, necesita: 20, costoEstimado: 180000 }] };
  const reparto = calc.calcRepartoLineaRecibo(grupo, { cantidadComprada: 36, costoPagado: 360000 });
  const cotsRc = calc.aplicarReciboACotizaciones(
    [{ id: "cotA-rc", descripcion: "Uniformes A", pedidoId: "pA-rc", compras: [] }, { id: "cotB-rc", descripcion: "Uniformes B", pedidoId: "pB-rc", compras: [] }],
    "R1", { fecha: "2026-09-23", proveedorId: "", numero: "4411", servicios: [], etiquetas: [] }, [{ grupo, reparto }]);
  const txRecibo = calc.reconciliarTxRecibo([], "R1", cotsRc).tx;
  // Hallazgo #66: una compra «Sí» ya llevada a Finanzas; un pedido con el costo ESTIMADO completo
  // registrado (y una compra «Sí» que por eso NO se llevó, a propósito); y una cotización ya
  // convertida en el pedido P1, con su mismo total.
  const cotCompra = cotConInsumo("cot-compra");
  cotCompra.compras = [{ clave: claveTela(cotCompra), estado: "si", costoReal: 90000, cantidadReal: 10, txId: "t-tela" }];
  const cotEst = cotConInsumo("cot-est", { estimadoTxId: "t-est" });
  cotEst.compras = [{ clave: claveTela(cotEst), estado: "si", costoReal: 80000, cantidadReal: 10 }];
  const cotLink = cotConInsumo("cot-link", { pedidoId: "P1" });

  const tx = [
    { id: "t-a1", tipo: "ingreso", concepto: "Abono — Camisetas", monto: 100000, fecha: "2026-10-20", pedidoId: "P1", origenAbonoId: "a1" },
    { id: "t-a2", tipo: "ingreso", concepto: "Abono — Uniformes", monto: 300000, fecha: "2026-10-21", pedidoId: "P2", origenAbonoId: "a2" },
    { id: "t-r2", tipo: "gasto", concepto: "Reembolso — Uniformes", monto: 50000, fecha: "2026-10-22", pedidoId: "P2", origenReembolsoId: "r2" },
    { id: "t-c3", tipo: "comision", concepto: "Comisión — Ana V", monto: 10000, contraparte: "Ana V", fecha: "2026-10-23", pedidoId: "P3", origenComisionPedidoId: "P3" },
    { id: "t-c1", tipo: "comision", concepto: "Comisión — Beto V", monto: 5000, contraparte: "Beto V", fecha: "2026-10-23", pedidoId: "", cotizacionId: "C1", origenComisionCotId: "C1" },
    { id: "t-old", tipo: "ingreso", concepto: "Abono (de antes)", monto: 50000, fecha: "2026-01-10", pedidoId: "P4" },
    { id: "t-hilo", tipo: "gasto", concepto: "Hilo", monto: 25000, fecha: "2026-10-24" },
    { id: "t-nom", tipo: "nomina", concepto: "Nómina — Luis", monto: 400000, fecha: "2026-10-25" },
    { id: "t-gf1", tipo: "gasto", concepto: "Arriendo octubre", monto: 150000, fecha: "2026-10-01", gastoFijoId: "gf1", origenGastoFijoPeriodo: "gf1|2026-10" },
    { id: "t-gf0", tipo: "gasto", concepto: "Arriendo septiembre", monto: 150000, fecha: "2026-09-01", gastoFijoId: "gf1", origenGastoFijoPeriodo: "gf1|2026-09" },
    { id: "t-d1", tipo: "gasto", concepto: "Cuota préstamo 1", monto: 250000, fecha: "2026-09-15", deudaId: "d1" },
    { id: "t-d2", tipo: "gasto", concepto: "Cuota préstamo 2", monto: 250000, fecha: "2026-10-15", deudaId: "d1" },
    { id: "t-botones", tipo: "gasto", concepto: "Botones", monto: 60000, fecha: "2026-10-26", serviciosDescuento: [{ nombre: "Confección", monto: 50000 }] },
    // Hallazgo #66 ----------------------------------------------------------
    // el abono de P8 y su comisión (10 %), pagada por lo que da hoy la fórmula
    { id: "t-a8", tipo: "ingreso", concepto: "Abono — Bolsos", monto: 100000, fecha: "2026-10-27", pedidoId: "P8", origenAbonoId: "a8" },
    { id: "t-c8", tipo: "comision", concepto: "Comisión — Zoe V", monto: 10000, contraparte: "Zoe V", fecha: "2026-10-28", pedidoId: "P8", origenComisionPedidoId: "P8" },
    // nómina del periodo en curso (y un pago viejo, del sueldo de antes del aumento)
    { id: "t-n1", tipo: "nomina", concepto: "Nómina — Luis", monto: 1300000, contraparte: "Luis", empleadoId: "e1", fecha: HOY_REAL },
    { id: "t-n0", tipo: "nomina", concepto: "Nómina enero — Luis", monto: 1100000, contraparte: "Luis", empleadoId: "e1", fecha: "2026-01-15" },
    { id: "t-n2", tipo: "nomina", concepto: "Nómina — Marta (+$50.000 bono)", monto: 450000, contraparte: "Marta", empleadoId: "e2", fecha: HOY_REAL },
    { id: "t-n3", tipo: "nomina", concepto: "Nómina — Teo (−$100.000 descuento)", monto: 700000, contraparte: "Teo", empleadoId: "e3", fecha: HOY_REAL },
    // deudas: una con su historial enlazado, una saldada y una condonada (se le bajaron las cuotas)
    { id: "t-e1", tipo: "gasto", concepto: "Cuota 1/3 — Crédito proveedor", monto: 200000, fecha: "2026-10-05", deudaId: "d2" },
    { id: "t-f1", tipo: "gasto", concepto: "Cuota 1/2 — Préstamo viejo", monto: 150000, fecha: "2026-09-15", deudaId: "d3" },
    { id: "t-f2", tipo: "gasto", concepto: "Cuota 2/2 — Préstamo viejo", monto: 150000, fecha: "2026-09-30", deudaId: "d3" },
    { id: "t-g1", tipo: "gasto", concepto: "Cuota 1 — Deuda condonada", monto: 100000, fecha: "2026-06-30", deudaId: "d4" },
    { id: "t-g2", tipo: "gasto", concepto: "Cuota 2 — Deuda condonada", monto: 100000, fecha: "2026-07-31", deudaId: "d4" },
    { id: "t-g3", tipo: "gasto", concepto: "Cuota 3 — Deuda condonada", monto: 100000, fecha: "2026-08-15", deudaId: "d4" },
    // compra «Sí» llevada a Finanzas, y el costo estimado completo de OTRO pedido
    { id: "t-tela", tipo: "gasto", concepto: "Compra — Tela — Pedido cot-compra", monto: 90000, fecha: "2026-10-12", cotizacionId: "cot-compra", esInsumo: "1", origenCompraClave: claveTela(cotCompra) },
    { id: "t-est", tipo: "gasto", concepto: "Estimado completo del pedido — Pedido cot-est", monto: 500000, fecha: "2026-10-13", cotizacionId: "cot-est" },
    // consignación: v1 y su comisión, v2, y v3 (de antes: el ingreso SIN marca)
    { id: "t-v1", tipo: "ingreso", concepto: "Venta consignación", monto: 100000, fecha: "2026-10-24", pedidoId: "P6", origenVentaConsignacionId: "v1" },
    { id: "t-vc1", tipo: "gasto", concepto: "Comisión consignación", monto: 10000, fecha: "2026-10-26", pedidoId: "P6", origenComisionConsignacionId: "v1" },
    { id: "t-v2", tipo: "ingreso", concepto: "Venta consignación", monto: 50000, fecha: "2026-10-25", pedidoId: "P6", origenVentaConsignacionId: "v2" },
    { id: "t-v3", tipo: "ingreso", concepto: "Venta consignación (de antes)", monto: 30000, fecha: "2026-08-10", pedidoId: "P6" }
  ].concat(txRecibo);
  // Lo que ya estaba en la papelera, en regla: un pedido eliminado con su abono (los dos
  // lados), un gasto borrado a mano, el gasto de una cotización eliminada, y la fila de un
  // recibo anulado (que conserva el id de la viva, porque al registrarlo otra vez se reusa).
  const pedidosPapelera = [
    { id: "P7", numeroOp: "OP-7", cliente: "Eva", descripcion: "Pedido borrado", total: 100000, abono: 100000, iva: { activo: false, porcentaje: 19 }, abonos: [{ id: "a7", monto: 100000, fecha: "2026-10-02" }], eliminadoEl: "2026-10-03" }
  ];
  const txPapelera = [
    { id: "tp-a7", tipo: "ingreso", concepto: "Abono — Pedido borrado", monto: 100000, fecha: "2026-10-02", pedidoId: "P7", origenAbonoId: "a7", eliminadoEl: "2026-10-03", eliminadoConPedido: "P7" },
    { id: "tp-hilo", tipo: "gasto", concepto: "Gasto borrado a mano", monto: 5000, fecha: "2026-10-04", eliminadoEl: "2026-10-04" },
    { id: "tp-cot", tipo: "gasto", concepto: "Compra de una cotización eliminada", monto: 7000, fecha: "2026-10-05", cotizacionId: "cot-borrada", origenCompraClave: "k", eliminadoEl: "2026-10-06", eliminadoConCotizacion: "cot-borrada" },
    Object.assign({}, txRecibo[0], { eliminadoConRecibo: "R1", eliminadoEl: HOY })
  ];
  return {
    pedidos, tx, cotizaciones: [cotServ, cotComision].concat(cotsRc, [cotCompra, cotEst, cotLink]),
    deudas: [
      { id: "d1", concepto: "Préstamo", monto: 1000000, cuotas: 4, cuotasPagadas: 2 }, // de antes del historial: sin líneas
      { id: "d2", concepto: "Crédito proveedor", contraparte: "Telas SA", monto: 600000, cuotas: 3, cuotasPagadas: 1, historial: [{ fecha: "2026-10-05", monto: 200000, txId: "t-e1" }] }
    ],
    deudasHistorial: [
      { id: "d3", concepto: "Préstamo viejo", monto: 300000, cuotas: 2, cuotasPagadas: 2, fechaCompletada: "2026-09-30", historial: [{ fecha: "2026-09-15", monto: 150000, txId: "t-f1" }, { fecha: "2026-09-30", monto: 150000, txId: "t-f2" }] },
      // se le bajaron las cuotas de 4 a 2 después de tres pagos: queda con todas pagadas y más pagos que cuotas
      { id: "d4", concepto: "Deuda condonada", monto: 400000, cuotas: 2, cuotasPagadas: 2, fechaCompletada: "2026-08-31", historial: [{ fecha: "2026-06-30", monto: 100000, txId: "t-g1" }, { fecha: "2026-07-31", monto: 100000, txId: "t-g2" }, { fecha: "2026-08-15", monto: 100000, txId: "t-g3" }] }
    ],
    nomina: [
      { id: "e1", nombre: "Luis", salario: 1300000, salarioPeriodo: "mensual", periodo: "mensual" },
      { id: "e2", nombre: "Marta", salario: 400000, salarioPeriodo: "semanal", periodo: "semanal" },
      { id: "e3", nombre: "Teo", salario: 800000, salarioPeriodo: "mensual", periodo: "mensual" }
    ],
    pedidosPapelera, txPapelera,
    gastosFijos: [{ id: "gf1", nombre: "Arriendo", pagadoHasta: "2026-10" }]
  };
}
function cargar(d) {
  state.pedidos = d.pedidos; state.tx = d.tx; state.cotizaciones = d.cotizaciones;
  state.deudas = d.deudas; state.deudasHistorial = d.deudasHistorial || []; state.pedidosPapelera = d.pedidosPapelera || []; state.txPapelera = d.txPapelera || [];
  state.clientes = []; state.config.gastosFijos = d.gastosFijos; state.config.colchonMovimientos = [];
  state.config.nomina = d.nomina || []; state.cotSucia = d.cotSucia || "";
}
const t = (d, id) => d.tx.filter(x => x.id === id)[0];
const p = (d, id) => d.pedidos.filter(x => x.id === id)[0];
const sinTx = (d, id) => { d.tx = d.tx.filter(x => x.id !== id); };

// Corre UNA corrupción sobre datos limpios y exige exactamente esos hallazgos
// ("regla:severidad"), ni uno más.
function escenario(nombre, mutar, esperado, extra) {
  const d = datosLimpios(); mutar(d); cargar(d);
  const hs = salud.calcSaludDatos();
  const obtenido = hs.map(h => h.regla + ":" + h.severidad).sort();
  const quiero = esperado.slice().sort();
  ok(JSON.stringify(obtenido) === JSON.stringify(quiero), nombre + " → " + (quiero.join(", ") || "nada") + (JSON.stringify(obtenido) === JSON.stringify(quiero) ? "" : "   (obtuvo: " + (obtenido.join(", ") || "nada") + ")"));
  if (extra) extra(hs, d);
  return hs;
}

// ======================= 1. Datos limpios =======================
console.log("== datos limpios: cero hallazgos");
{
  const d = datosLimpios(); cargar(d);
  const antes = JSON.stringify({ p: state.pedidos, t: state.tx, c: state.cotizaciones, d: state.deudas, cfg: state.config.gastosFijos });
  const hs = salud.calcSaludDatos();
  ok(hs.length === 0, "un taller sano no tiene ningún hallazgo" + (hs.length ? "  (hay: " + hs.map(h => h.id).join(", ") + ")" : ""));
  const r = salud.calcResumenSalud();
  ok(r.errores === 0 && r.avisos === 0 && r.revisadas.length === salud.VERIFICACIONES_SALUD.length, "el resumen cuenta 0 errores, 0 avisos y las " + salud.VERIFICACIONES_SALUD.length + " cosas revisadas");
  ok(salud.VERIFICACIONES_SALUD.length >= 10, "hay al menos las 10 verificaciones pedidas");
  ok(JSON.stringify({ p: state.pedidos, t: state.tx, c: state.cotizaciones, d: state.deudas, cfg: state.config.gastosFijos }) === antes, "SOLO LEE: ni los pedidos, ni los movimientos, ni las cotizaciones cambian");
  ok(salud.textoInformeSalud("2026-10-29").indexOf("Todo cuadra") !== -1, "el informe de unos datos limpios dice «Todo cuadra»");
  // Los datos limpios de verdad son una caja con sentido (no un cero vacío).
  ok(calc.calcCaja() !== 0, "(los datos limpios no son un caso vacío: la caja vale " + calc.calcCaja() + ")");
}
console.log("== sin datos: tampoco inventa nada");
{
  cargar({ pedidos: [], tx: [], cotizaciones: [], deudas: [], gastosFijos: [] });
  ok(salud.calcSaludDatos().length === 0, "una app recién creada no tiene hallazgos");
}

// ======================= 2. Cada corrupción, su hallazgo =======================
console.log("== 1. lo abonado de cada pedido");
escenario("p.abono menor que la suma de sus abonos (imposible)", d => { p(d, "P1").abono = 50000; }, ["abonado-pedido:error"],
  hs => ok(hs[0].afectados[0].tipo === "pedido" && hs[0].afectados[0].id === "P1", "y señala al pedido"));
escenario("p.abono mayor, sin ingresos sueltos que lo expliquen → aviso", d => { p(d, "P1").abono = 130000; }, ["abonado-pedido:aviso"]);
escenario("un pedido viejo con su base explicada por un ingreso suelto NO se señala", d => {}, []);
escenario("pedido viejo: su base sin respaldo cambia y deja de coincidir con lo suelto", d => { p(d, "P4").abono = 70000; }, ["abonado-pedido:aviso"]);

console.log("== 2. cada abono y reembolso en Finanzas");
escenario("un abono sin su movimiento", d => sinTx(d, "t-a1"), ["abono-movimiento:error"],
  hs => ok(hs[0].titulo.indexOf("abono") !== -1 && hs[0].afectados[0].id === "P1", "dice que es un abono y señala al pedido"));
escenario("un reembolso sin su movimiento", d => sinTx(d, "t-r2"), ["abono-movimiento:error"],
  hs => ok(hs[0].titulo.indexOf("reembolso") !== -1, "dice que es un reembolso"));
escenario("el movimiento tiene otro monto que el abono", d => { t(d, "t-a1").monto = 90000; }, ["abono-movimiento:error"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "t-a1"), "y señala también el movimiento"));
escenario("un movimiento apunta a un abono que ya no existe", d => { p(d, "P1").abonos = []; p(d, "P1").abono = 0; }, ["abono-movimiento:error"],
  hs => ok(hs[0].titulo.indexOf("ya no tiene") !== -1, "dice que el pedido ya no lo tiene"));
escenario("un reembolso en Finanzas cuyo reembolso ya no existe", d => { p(d, "P2").abonos = p(d, "P2").abonos.filter(a => a.id !== "r2"); p(d, "P2").abono = 300000; }, ["abono-movimiento:error"]);
escenario("el movimiento de un abono es de OTRO pedido (una sola falla, un solo hallazgo)", d => { t(d, "t-a1").pedidoId = "P3"; }, ["abono-movimiento:error"],
  hs => ok(hs[0].titulo.indexOf("otro pedido") !== -1 && hs[0].afectados.length === 2, "dice que quedó en otro pedido y señala el pedido y el movimiento"));

console.log("== 3. duplicados y orígenes que ya no existen");
escenario("una comisión pagada dos veces (dos movimientos con la misma marca)", d => { d.tx.push(Object.assign({}, t(d, "t-c3"), { id: "t-c3-bis" })); }, ["movimiento-duplicado:error"],
  hs => ok(hs[0].titulo === "Una comisión aparece pagada dos veces" && hs[0].afectados.length === 2 && hs[0].afectados.every(a => a.tipo === "movimiento"), "dice «comisión pagada dos veces» y señala los DOS movimientos"));
escenario("un abono que aparece dos veces en Finanzas", d => { d.tx.push(Object.assign({}, t(d, "t-a1"), { id: "t-a1-bis" })); }, ["movimiento-duplicado:error"]);
escenario("un gasto fijo pagado dos veces en el mismo periodo", d => { d.tx.push(Object.assign({}, t(d, "t-gf1"), { id: "t-gf1-bis" })); }, ["movimiento-duplicado:error"]);
escenario("la MISMA clave de compra en OTRA cotización no es un duplicado", d => {
  d.tx.push({ id: "t-k1", tipo: "gasto", concepto: "Tela", monto: 1000, fecha: HOY, cotizacionId: "C1", origenCompraClave: "tela|mt" });
  d.cotizaciones[1].compras = [{ clave: "tela|mt", estado: "si", costoReal: 1000, txId: "t-k1" }];
  d.tx.push({ id: "t-k2", tipo: "gasto", concepto: "Tela", monto: 1000, fecha: HOY, cotizacionId: "cot-serv", origenCompraClave: "tela|mt" });
  d.cotizaciones[0].compras.push({ clave: "tela|mt", estado: "si", costoReal: 1000, txId: "t-k2" });
}, []);
escenario("dos compras con la misma clave EN la misma cotización sí son duplicado", d => {
  d.cotizaciones[1].compras = [{ clave: "tela|mt", estado: "si", costoReal: 1000, txId: "t-k1" }];
  d.tx.push({ id: "t-k1", tipo: "gasto", concepto: "Tela", monto: 1000, fecha: HOY, cotizacionId: "C1", origenCompraClave: "tela|mt" });
  d.tx.push({ id: "t-k2", tipo: "gasto", concepto: "Tela", monto: 1000, fecha: HOY, cotizacionId: "C1", origenCompraClave: "tela|mt" });
}, ["movimiento-duplicado:error"]);
escenario("varias cuotas de la misma deuda NO son duplicado (ya están en los datos limpios)", d => {}, []);
escenario("la comisión de un pedido que ya no existe queda suelta (aviso)", d => { d.pedidos = d.pedidos.filter(x => x.id !== "P3"); }, ["origen-huerfano:aviso"],
  hs => ok(hs[0].afectados[0].id === "t-c3", "y señala el movimiento suelto"));
escenario("las cuotas de una deuda que ya no existe quedan sueltas (un aviso por cuota)", d => { d.deudas = d.deudas.filter(x => x.id !== "d1"); }, ["origen-huerfano:aviso", "origen-huerfano:aviso"]);
escenario("el pago de un gasto fijo de un periodo ya cerrado NO es un hallazgo", d => { d.gastosFijos = []; }, []);

console.log("== 4. comisiones");
escenario("comisión de un pedido marcada pagada, sin movimiento", d => sinTx(d, "t-c3"), ["comision:error"],
  hs => ok(hs[0].afectados[0].tipo === "pedido" && hs[0].afectados[0].id === "P3", "señala al pedido"));
escenario("comisión de una cotización marcada pagada, sin movimiento", d => sinTx(d, "t-c1"), ["comision:error"],
  hs => ok(hs[0].afectados[0].tipo === "cotizacion" && hs[0].afectados[0].id === "C1", "señala la cotización"));
escenario("movimiento de comisión sin que el pedido la tenga pagada", d => { p(d, "P3").vendedor.estado = "pendiente"; }, ["comision:error"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "t-c3"), "señala el movimiento"));
escenario("movimiento de comisión sin que la cotización la tenga pagada", d => { d.cotizaciones[1].vendedor.estado = "pendiente"; }, ["comision:error"]);
escenario("la comisión pagada desde la cotización Y desde su pedido", d => { d.cotizaciones[1].pedidoOrigenId = "P3"; }, ["comision:error"],
  hs => ok(hs[0].titulo === "Una comisión aparece pagada dos veces", "dice «pagada dos veces»"));
escenario("una cotización ya convertida no exige movimiento propio (la comisión es del pedido)", d => { d.cotizaciones[1].estado = "convertida"; sinTx(d, "t-c1"); }, []);

console.log("== 5. monto, fecha y tipo de cada movimiento");
escenario("monto que no es un número", d => { t(d, "t-hilo").monto = "abc"; }, ["movimiento-datos:error"]);
escenario("monto vacío", d => { t(d, "t-hilo").monto = ""; }, ["movimiento-datos:error"]);
escenario("monto negativo", d => { t(d, "t-hilo").monto = -25000; }, ["movimiento-datos:error"]);
escenario("monto en cero (aviso)", d => { t(d, "t-hilo").monto = 0; }, ["movimiento-datos:aviso"]);
escenario("monto con centavos (aviso): no va a coincidir con el banco", d => { t(d, "t-hilo").monto = 25000.5; }, ["movimiento-datos:aviso"],
  hs => ok(hs[0].detalle.indexOf("25.000,5") !== -1 || hs[0].detalle.indexOf("25,000.5") !== -1 || hs[0].detalle.indexOf("25000") !== -1, "y dice el monto CON sus centavos"));
escenario("la comisión con centavos de coma flotante (10000.375)", d => { t(d, "t-c3").monto = 10000.375; }, ["movimiento-datos:aviso"]);
escenario("fecha inválida", d => { t(d, "t-hilo").fecha = "2026-13-45"; }, ["movimiento-datos:error"]);
escenario("fecha vacía", d => { t(d, "t-hilo").fecha = ""; }, ["movimiento-datos:error"]);
escenario("fecha que no existe (30 de febrero)", d => { t(d, "t-hilo").fecha = "2026-02-30"; }, ["movimiento-datos:error"]);
escenario("tipo desconocido", d => { t(d, "t-hilo").tipo = "transferencia"; }, ["movimiento-datos:error"]);
escenario("un monto en cero de una fila de recibo (reserva) NO se señala", d => { const f = d.tx.filter(x => x.reciboCompraRol === "reserva")[0]; f.monto = 0; }, ["recibo-compra:error"]);

console.log("== 6. el total del pedido contra sus líneas");
escenario("el total guardado no sale de las líneas y descuentos", d => { p(d, "P2").total = 310000; p(d, "P2").abono = 250000; }, ["total-pedido:aviso"]);
escenario("un total sin descuento que no coincide con la línea", d => { p(d, "P1").total = 250000; }, ["total-pedido:aviso"]);
escenario("un pedido viejo sin líneas NO se compara", d => { p(d, "P4").total = 999999; }, []);
escenario("una consignación NO se compara con líneas", d => { p(d, "P1").consignacion = { ventas: [] }; p(d, "P1").total = 150000; }, []);

console.log("== 7. recibos de compra");
escenario("a un recibo le falta su movimiento en Finanzas", d => { const f = d.tx.filter(x => x.reciboCompraRol === "reserva")[0]; d.tx = d.tx.filter(x => x !== f); }, ["recibo-compra:error"],
  hs => ok(hs[0].afectados[0].tipo === "recibo" && hs[0].afectados[0].id === "R1" && hs[0].afectados.some(a => a.tipo === "cotizacion"), "señala el recibo y sus cotizaciones"));
escenario("el costo de una compra no coincide con sus partes", d => { d.cotizaciones[3].compras[0].costoReal = 99999; }, ["recibo-compra:error"]);

console.log("== 8. servicios");
escenario("un servicio con más gastado que acumulado", d => { t(d, "t-botones").serviciosDescuento = [{ nombre: "Confección", monto: 80000 }]; }, ["servicio-negativo:error"],
  hs => ok(hs[0].afectados.some(a => a.id === "t-botones"), "señala el movimiento que lo gastó"));

console.log("== 9. la caja");
escenario("un monto infinito hace que las dos cuentas de la caja se separen", d => { t(d, "t-hilo").monto = Infinity; }, ["movimiento-datos:error", "caja:error"]);

console.log("== 10. saldo a favor del cliente");
escenario("un cliente pagó de más", d => {
  d.pedidos.push({ id: "P5", numeroOp: "OP-5", cliente: "Zoe", descripcion: "Bolsos", total: 100000, abono: 150000, iva: { activo: false, porcentaje: 19 }, lineas: [{ id: "l5", cantidad: 1, precioUnitario: 100000 }], abonos: [{ id: "a5", monto: 150000, fecha: "2026-10-27" }] });
  d.tx.push({ id: "t-a5", tipo: "ingreso", concepto: "Abono — Bolsos", monto: 150000, fecha: "2026-10-27", pedidoId: "P5", origenAbonoId: "a5" });
}, ["saldo-a-favor:aviso"],
  hs => ok(hs[0].afectados[0].id === "P5", "señala al pedido"));

console.log("== 11. las cuentas contra la Caja (Hallazgo #63)");
{
  const CUENTAS = [{ id: "efectivo", nombre: "Efectivo" }, { id: "banco", nombre: "Banco" }];
  const conCuentas = d => { state.config.cuentas = CUENTAS; state.transferencias = []; d.tx.forEach((x, i) => { x.cuenta = i % 2 ? "banco" : "efectivo"; }); };
  const transf = (extra) => Object.assign({ id: "tr1", fecha: "2026-10-25", de: "efectivo", a: "banco", monto: 50000, anulada: "", conciliadoDe: "", conciliadoA: "" }, extra || {});
  escenario("movimientos repartidos entre cuentas de verdad: cero hallazgos", conCuentas, []);
  {
    cargar(datosLimpios()); conCuentas({ tx: state.tx });
    ok(calc.calcSaldosPorCuenta().cuadra === true, "(la suma de las cuentas es la Caja con datos limpios)");
  }
  escenario("una transferencia válida entre cuentas NO es un hallazgo", d => { conCuentas(d); state.transferencias = [transf()]; }, []);
  escenario("movimientos sin cuenta («Sin asignar») NO se señalan: es el estado normal de antes", d => { conCuentas(d); d.tx.forEach(x => { delete x.cuenta; }); }, []);
  escenario("movimientos en una cuenta que ya no existe → aviso", d => { conCuentas(d); t(d, "t-a1").cuenta = "caja-vieja"; }, ["cuentas:aviso"],
    hs => ok(hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "t-a1") && hs[0].detalle.indexOf("caja-vieja") !== -1, "señala el movimiento y la cuenta"));
  escenario("transferencia con monto negativo → error", d => { conCuentas(d); state.transferencias = [transf({ monto: -5000 })]; }, ["cuentas:error"]);
  escenario("transferencia con monto cero → error", d => { conCuentas(d); state.transferencias = [transf({ monto: 0 })]; }, ["cuentas:error"]);
  escenario("transferencia con un monto que no es número → error", d => { conCuentas(d); state.transferencias = [transf({ monto: "abc" })]; }, ["cuentas:error"]);
  escenario("transferencia hacia una cuenta que ya no existe → aviso", d => { conCuentas(d); state.transferencias = [transf({ a: "nequi-vieja" })]; }, ["cuentas:aviso"]);
  escenario("transferencia que sale y entra a la misma cuenta → aviso", d => { conCuentas(d); state.transferencias = [transf({ a: "efectivo" })]; }, ["cuentas:aviso"]);
  escenario("una transferencia ANULADA con datos raros no se señala (ya no cuenta)", d => { conCuentas(d); state.transferencias = [transf({ monto: -1, a: "nequi-vieja", anulada: "2026-10-26" })]; }, []);
  escenario("el monto infinito sigue dando solo sus dos hallazgos (las cuentas no se suman al ruido)", d => { conCuentas(d); t(d, "t-hilo").monto = Infinity; }, ["movimiento-datos:error", "caja:error"]);
  ok(salud.VERIFICACIONES_SALUD.some(v => v.id === "cuentas" && v.porque && v.donde), "la verificación «cuentas» está registrada con su porqué y su dónde");
  state.config.cuentas = []; state.transferencias = []; // no contaminar lo que sigue
}

// ======================= Hallazgo #66: lo que antes no se revisaba =======================
console.log("== 12. la fecha de un abono contra la de su movimiento (aviso)");
escenario("el abono y su movimiento tienen fechas distintas, el monto sí coincide", d => { t(d, "t-a1").fecha = "2026-10-22"; }, ["abono-movimiento:aviso"],
  hs => ok(hs[0].detalle.indexOf("2026-10-20") !== -1 && hs[0].detalle.indexOf("2026-10-22") !== -1 && hs[0].detalle.indexOf("meses distintos") === -1 && hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "t-a1"), "dice las dos fechas, no dice «meses distintos» y señala el movimiento"));
escenario("fechas en meses distintos (31 de octubre contra 1 de noviembre): lo dice", d => { p(d, "P1").abonos[0].fecha = "2026-10-31"; t(d, "t-a1").fecha = "2026-11-01"; }, ["abono-movimiento:aviso"],
  hs => ok(hs[0].detalle.indexOf("meses distintos") !== -1, "dice que caen en meses distintos"));
escenario("el reembolso y su movimiento con fechas distintas", d => { t(d, "t-r2").fecha = "2026-10-23"; }, ["abono-movimiento:aviso"],
  hs => ok(hs[0].titulo.indexOf("reembolso") !== -1, "habla del reembolso"));
escenario("monto Y fecha distintos: UN solo hallazgo (el del monto), que también dice la fecha", d => { t(d, "t-a1").monto = 90000; t(d, "t-a1").fecha = "2026-10-22"; }, ["abono-movimiento:error"],
  hs => ok(hs[0].detalle.indexOf("2026-10-22") !== -1, "el error del monto menciona la fecha distinta"));
escenario("un abono viejo SIN fecha no se compara", d => { delete p(d, "P1").abonos[0].fecha; }, []);
escenario("la fecha del abono con hora no es una diferencia (mismo día)", d => { p(d, "P1").abonos[0].fecha = "2026-10-20T14:30:00"; }, []);

console.log("== 13. nómina: lo pagado en el periodo en curso");
escenario("a Luis se le pagó $200.000 de más y el pago no lo explica", d => { t(d, "t-n1").monto = 1500000; }, ["nomina-periodo:aviso"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "empleado" && a.id === "e1") && hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "t-n1") && hs[0].detalle.indexOf("200.000") !== -1, "señala a la persona y su pago, y dice cuánto sobra ($200.000)"));
escenario("el mismo pago registrado dos veces en el periodo", d => { d.tx.push(Object.assign({}, t(d, "t-n1"), { id: "t-n1-bis" })); }, ["nomina-periodo:aviso"]);
escenario("un pago de más con el bono escrito en el concepto NO se señala", d => { t(d, "t-n1").monto = 1500000; t(d, "t-n1").concepto = "Nómina — Luis (+$200.000 bono)"; }, []);
escenario("un bono escrito que no alcanza a explicarlo SÍ se señala", d => { t(d, "t-n1").monto = 1500000; t(d, "t-n1").concepto = "Nómina — Luis (+$50.000 bono)"; }, ["nomina-periodo:aviso"]);
escenario("un pago de MÁS de un periodo pasado NO se señala (pudo subirle el sueldo)", d => { t(d, "t-n0").monto = 9999999; }, []);
escenario("un pago de MENOS NO se señala (eso ya sale en Pendientes como «falta pagar»)", d => { t(d, "t-n1").monto = 100000; }, []);
escenario("el sueldo pagado en dos partes (anticipo + resto) NO se señala", d => { t(d, "t-n1").monto = 500000; d.tx.push(Object.assign({}, t(d, "t-n1"), { id: "t-n1b", monto: 800000, concepto: "Nómina — Luis (resto)" })); }, []);
escenario("centavos de un pago de antes del #62 (menos de un peso de más) NO se señalan como nómina", d => { t(d, "t-n1").monto = 1300000.4; }, ["movimiento-datos:aviso"]);
escenario("una persona sin sueldo cargado NO se compara", d => { d.nomina[0].salario = 0; t(d, "t-n1").monto = 500000; }, []);
escenario("un pago a mano en Finanzas (con el nombre, sin el id) también cuenta", d => { delete t(d, "t-n1").empleadoId; t(d, "t-n1").monto = 1500000; }, ["nomina-periodo:aviso"]);
escenario("el pago a alguien que ya no está en la nómina NO se señala", d => { d.nomina = d.nomina.filter(x => x.id !== "e1"); t(d, "t-n1").monto = 9999999; }, []);
escenario("un salario mensual que se paga por semana (convertido) se compara con la semana", d => { d.nomina[0].periodo = "semanal"; t(d, "t-n1").monto = 325000; }, []);

console.log("== 14. deudas: cuotas pagadas y sus movimientos");
escenario("el movimiento de un pago enlazado ya no está en Finanzas", d => sinTx(d, "t-e1"), ["deuda-pagos:error"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "deuda" && a.id === "d2") && hs[0].detalle.indexOf("ya no está en Finanzas") !== -1, "señala la deuda y dice que el pago ya no está en Finanzas"));
escenario("…y el movimiento está en la papelera: lo dice", d => { const x = t(d, "t-e1"); sinTx(d, "t-e1"); d.txPapelera.push(Object.assign({}, x, { eliminadoEl: HOY })); }, ["deuda-pagos:error"],
  hs => ok(hs[0].detalle.indexOf("papelera") !== -1, "dice que su movimiento está en la papelera"));
escenario("el movimiento tiene otro monto que el pago del historial", d => { t(d, "t-e1").monto = 190000; }, ["deuda-pagos:error"]);
escenario("Finanzas tiene un pago más de los que la deuda registra", d => { d.tx.push({ id: "t-e2", tipo: "gasto", concepto: "Cuota repetida", monto: 200000, fecha: "2026-10-06", deudaId: "d2" }); }, ["deuda-pagos:error"],
  hs => ok(hs[0].detalle.indexOf("cobraría una cuota que ya se pagó") !== -1, "avisa que el siguiente «Pagar» cobraría una cuota ya pagada"));
escenario("el historial tiene más pagos que cuotas pagadas (sin que se hayan bajado las cuotas)", d => { d.deudas[1].cuotasPagadas = 0; }, ["deuda-pagos:aviso"]);
escenario("una deuda de ANTES dice más cuotas pagadas que movimientos de pago → aviso", d => { d.deudas[0].cuotasPagadas = 3; }, ["deuda-pagos:aviso"]);
escenario("se pagó más de lo que vale la deuda (el monto se cambió después) → aviso", d => { d.deudas[1].monto = 100000; }, ["deuda-pagos:aviso"]);
escenario("una deuda activa que ya tiene todas sus cuotas pagadas: UN hallazgo con todos sus motivos", d => { d.deudas[0].cuotasPagadas = 4; }, ["deuda-pagos:aviso"],
  hs => ok(hs[0].detalle.indexOf("Por pagar") !== -1 && hs[0].detalle.indexOf("2 movimientos") !== -1, "dice que «Por pagar» sigue contando una cuota Y que falta respaldo (dos motivos, un hallazgo)"));
escenario("una deuda saldada que dice tener cuotas pendientes: UN hallazgo", d => { d.deudasHistorial[0].cuotasPagadas = 1; }, ["deuda-pagos:aviso"]);
escenario("una deuda que está a la vez entre las activas y las saldadas", d => { d.deudas.push(Object.assign({}, d.deudasHistorial[0])); }, ["deuda-pagos:aviso"],
  hs => ok(hs.length === 1 && hs[0].detalle.indexOf("también en el historial") !== -1, "un solo hallazgo, no uno por cada copia"));
escenario("pagos de ANTES de que se guardara el txId (historial sin enlace) NO se señalan", d => { d.deudas[1].historial = [{ fecha: "2026-10-05", monto: 200000 }]; }, []);
escenario("una deuda sin historial ni movimientos y sin cuotas pagadas NO se señala", d => { d.deudas.push({ id: "d9", concepto: "Nueva", monto: 500000, cuotas: 2, cuotasPagadas: 0 }); }, []);
escenario("una deuda condonada (se le bajaron las cuotas) NO se señala (ya está en los datos limpios)", d => {}, []);

console.log("== 15. compras «Sí» de una cotización contra su movimiento");
escenario("una compra «Sí» sin su movimiento en Finanzas", d => sinTx(d, "t-tela"), ["compras-finanzas:aviso"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "cotizacion" && a.id === "cot-compra") && hs[0].detalle.indexOf("Tela") !== -1 && hs[0].detalle.indexOf("90.000") !== -1, "señala la cotización y dice la compra y cuánto debería haber"));
escenario("el movimiento de la compra tiene otro monto", d => { t(d, "t-tela").monto = 80000; }, ["compras-finanzas:aviso"]);
escenario("una compra que dejó de ser «Sí» y conserva su movimiento", d => { d.cotizaciones.filter(c => c.id === "cot-compra")[0].compras[0].estado = "no"; }, ["compras-finanzas:aviso"]);
escenario("la cotización con cambios sin guardar NO se señala (se pone al día al guardar)", d => { sinTx(d, "t-tela"); d.cotSucia = "cot-compra"; }, []);
escenario("con el costo estimado registrado, una compra «Sí» sin movimiento NO se señala (no se lleva a propósito; ya está en los datos limpios)", d => {}, []);
escenario("dos movimientos para la misma compra: solo lo dice «Movimientos duplicados»", d => { d.tx.push(Object.assign({}, t(d, "t-tela"), { id: "t-tela-bis" })); }, ["movimiento-duplicado:error"]);
escenario("una compra marcada «Sí» cuya línea ya no existe (insumo renombrado) NO se compara", d => { d.cotizaciones.filter(c => c.id === "cot-compra")[0].compras.push({ clave: "insumo viejo|mt|tela", estado: "si", costoReal: 5000 }); }, []);
escenario("una compra de un RECIBO no se compara contra un movimiento suelto (las arma el recibo)", d => {}, []);
{
  cargar(datosLimpios());
  ok(Array.isArray(calc.calcComprasDesfasadasConFinanzas(state.cotizaciones.filter(c => c.id === "cot-compra")[0])) && calc.calcComprasDesfasadasConFinanzas(state.cotizaciones.filter(c => c.id === "cot-compra")[0]).length === 0, "(la cuenta compartida con la cotización da vacío con datos sanos)");
}

console.log("== 16. el costo estimado completo y las compras reales a la vez");
escenario("el estimado completo Y una compra real llevada a Finanzas → ERROR", d => {
  const cot = d.cotizaciones.filter(c => c.id === "cot-est")[0];
  cot.compras[0].txId = "t-est-compra";
  d.tx.push({ id: "t-est-compra", tipo: "gasto", concepto: "Compra — Tela", monto: 80000, fecha: "2026-10-14", cotizacionId: "cot-est", esInsumo: "1", origenCompraClave: cot.compras[0].clave });
}, ["estimado-doble:error"],
  hs => ok(hs[0].afectados.some(a => a.id === "cot-est") && hs[0].afectados.some(a => a.id === "t-est") && hs[0].afectados.some(a => a.id === "t-est-compra") && hs[0].detalle.indexOf("dos veces") !== -1, "señala la cotización, el estimado y la compra, y dice «dos veces»"));
escenario("el estimado Y la parte de un recibo de compra también se cuenta doble", d => {
  const cot = d.cotizaciones.filter(c => c.id === "cotA-rc")[0];
  cot.estimadoTxId = "t-est-rc";
  d.tx.push({ id: "t-est-rc", tipo: "gasto", concepto: "Estimado completo del pedido — Uniformes A", monto: 400000, fecha: "2026-10-14", cotizacionId: "cotA-rc" });
}, ["estimado-doble:error"]);
escenario("el estimado solo (sin compras reales en Finanzas) NO se señala (ya está en los datos limpios)", d => {}, []);
escenario("un estimado cuyo movimiento ya no existe: su compra «Sí» sin llevar vuelve a contar como pendiente (aviso, no el error del estimado)", d => { sinTx(d, "t-est"); }, ["compras-finanzas:aviso"]);

console.log("== 17. consignación: ventas y comisión del punto");
escenario("una venta reportada sin su ingreso en Finanzas", d => sinTx(d, "t-v1"), ["consignacion:error"],
  hs => ok(hs[0].afectados[0].id === "P6" && hs[0].detalle.indexOf("100.000") !== -1, "señala el pedido y el monto de la venta"));
escenario("la venta y su ingreso tienen montos distintos", d => { t(d, "t-v1").monto = 90000; }, ["consignacion:error"]);
escenario("la comisión figura pagada pero no está en Finanzas", d => sinTx(d, "t-vc1"), ["consignacion:error"]);
escenario("la comisión pagada y su gasto tienen montos distintos", d => { t(d, "t-vc1").monto = 9000; }, ["consignacion:error"]);
escenario("Finanzas ya tiene la comisión pagada y la venta la muestra pendiente (se puede pagar otra vez)", d => { p(d, "P6").consignacion.ventas[0].comisionPagada = false; }, ["consignacion:error"]);
escenario("una venta de ANTES, con su ingreso sin marca de origen, NO se señala", d => { t(d, "t-v1").origenVentaConsignacionId = ""; }, []);
escenario("la comisión de antes, pagada con un gasto sin marca, NO se señala", d => { t(d, "t-vc1").origenComisionConsignacionId = ""; }, []);
escenario("dos ventas del mismo valor y UN solo movimiento sin marca: una queda sin respaldo", d => {
  p(d, "P6").consignacion.ventas.push({ id: "v4", cantidad: 1, fecha: "2026-08-11", montoTotal: 30000, comisionMonto: 3000, comisionPagada: false });
}, ["consignacion:error"]);
escenario("el ingreso de una venta aparece dos veces: solo lo dice «Movimientos duplicados»", d => { d.tx.push(Object.assign({}, t(d, "t-v1"), { id: "t-v1-bis" })); }, ["movimiento-duplicado:error"]);
escenario("el ingreso de una venta cuelga de OTRO pedido: solo lo dice «origen que ya no existe»", d => { t(d, "t-v1").pedidoId = "P1"; }, ["origen-huerfano:aviso"]);
escenario("una venta con $0 de comisión pagada no exige un gasto", d => { p(d, "P6").consignacion.ventas[0].comisionMonto = 0; sinTx(d, "t-vc1"); }, []);

console.log("== 18. el total del pedido contra su cotización de origen");
escenario("la cotización cambió (de $200.000 a $220.000) y el pedido no", d => { d.cotizaciones.filter(c => c.id === "cot-link")[0].referencias[0].precioVenta = 22000; }, ["total-cotizacion:aviso"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "pedido" && a.id === "P1") && hs[0].afectados.some(a => a.tipo === "cotizacion" && a.id === "cot-link") && hs[0].detalle.indexOf("220.000") !== -1, "señala el pedido y la cotización y dice cuánto suma la cotización"));
escenario("el total del pedido está mal escrito: UN solo hallazgo (el de las líneas), no también el de la cotización", d => { p(d, "P1").total = 250000; }, ["total-pedido:aviso"]);
escenario("la cotización abierta con cambios sin guardar NO se señala", d => { d.cotizaciones.filter(c => c.id === "cot-link")[0].referencias[0].precioVenta = 22000; d.cotSucia = "cot-link"; }, []);
escenario("una cotización ESCALADA (solo pedidoOrigenId) es un borrador: no se compara", d => {
  const c = d.cotizaciones.filter(x => x.id === "cot-link")[0]; c.pedidoId = ""; c.pedidoOrigenId = "P1"; c.referencias[0].precioVenta = 22000;
}, []);
escenario("una cotización cuyo pedido ya no existe NO se señala", d => { d.cotizaciones.filter(c => c.id === "cot-link")[0].pedidoId = "P-borrado"; }, []);
escenario("un pedido viejo sin líneas, ligado a su cotización, también se compara", d => { delete p(d, "P1").lineas; d.cotizaciones.filter(c => c.id === "cot-link")[0].referencias[0].precioVenta = 22000; }, ["total-cotizacion:aviso"]);

console.log("== 19. lo que hay en la papelera");
escenario("un pedido está a la vez entre los activos y en la papelera", d => { d.pedidosPapelera.push(Object.assign({}, p(d, "P1"), { eliminadoEl: HOY })); }, ["papelera:aviso"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "pedido" && a.id === "P1") && hs[0].afectados.some(a => a.tipo === "papelera-pedido"), "señala el pedido vivo y su copia en la papelera"));
escenario("un movimiento está a la vez en Finanzas y en la papelera", d => { d.txPapelera.push(Object.assign({}, t(d, "t-hilo"), { eliminadoEl: HOY })); }, ["papelera:aviso"],
  hs => ok(hs[0].afectados.some(a => a.tipo === "movimiento" && a.id === "t-hilo") && hs[0].afectados.some(a => a.tipo === "papelera-movimiento" && a.id === "t-hilo"), "señala el movimiento vivo y el de la papelera"));
escenario("un movimiento de la papelera perdió su pedido (ya no está ni activo ni en la papelera)", d => { d.pedidosPapelera = []; }, ["papelera:aviso"]);
escenario("un pedido restaurado cuyo abono quedó sin movimiento: solo lo dice «Cada abono…» (error), no la papelera", d => {
  const x = Object.assign({}, d.pedidosPapelera[0]); delete x.eliminadoEl; d.pedidos.push(x); d.pedidosPapelera = [];
}, ["abono-movimiento:error"]);
escenario("un movimiento de la papelera de un pedido ya restaurado, que no explica nada más", d => {
  const x = Object.assign({}, d.pedidosPapelera[0], { abonos: [], abono: 0 }); delete x.eliminadoEl; d.pedidos.push(x); d.pedidosPapelera = [];
}, ["papelera:aviso"]);
escenario("un movimiento de la papelera de una cotización que SIGUE existiendo", d => { d.txPapelera[2].eliminadoConCotizacion = "cot-compra"; }, ["papelera:aviso"]);
escenario("la fila de un recibo anulado, con el id de la fila viva, NO se señala (ya está en los datos limpios)", d => {}, []);
escenario("un movimiento de la papelera sin pedido ni cotización (borrado a mano) NO se señala", d => { d.txPapelera.push({ id: "tp-otro", tipo: "gasto", concepto: "Otro", monto: 1000, fecha: HOY, eliminadoEl: HOY }); }, []);
escenario("la papelera no cambia la caja", d => {}, [],
  () => { const antes = calc.calcCaja(); state.txPapelera.push({ id: "tp-x", tipo: "gasto", concepto: "x", monto: 999999, fecha: HOY, eliminadoEl: HOY }); ok(calc.calcCaja() === antes, "(un movimiento en la papelera no se suma a la caja)"); state.txPapelera.pop(); });

console.log("== 20. comisión ya pagada contra la fórmula de hoy (informativo)");
escenario("el vendedor pasó del 10 % al 12 % después de pagar la comisión", d => { p(d, "P8").vendedor.valor = 12; }, ["comision-formula:aviso"],
  hs => ok(hs[0].afectados.some(a => a.id === "P8") && hs[0].afectados.some(a => a.id === "t-c8") && hs[0].detalle.indexOf("10.000") !== -1 && hs[0].detalle.indexOf("12.000") !== -1 && hs[0].detalle.indexOf("informativo") !== -1, "dice lo pagado ($10.000) y lo de hoy ($12.000), y que es informativo"));
escenario("el pedido bajó de total (un descuento) después de pagar la comisión", d => {
  const x = p(d, "P8"); x.total = 90000; x.lineas[0].precioUnitario = 90000; x.abono = 90000; x.abonos[0].monto = 90000; t(d, "t-a8").monto = 90000;
}, ["comision-formula:aviso"],
  hs => ok(hs[0].detalle.indexOf("sobrarían") !== -1 && hs[0].detalle.indexOf("1.000") !== -1, "dice que sobraron $1.000 (le pagaste $10.000 y hoy daría $9.000)"));
escenario("centavos de antes del #62 (menos de un peso de diferencia) NO se señalan como comisión", d => { t(d, "t-c8").monto = 10000.4; }, ["movimiento-datos:aviso"]);
escenario("la comisión de una cotización pagada por otro valor", d => { d.cotizaciones.filter(c => c.id === "C1")[0].vendedor.valor = 6000; }, ["comision-formula:aviso"]);
escenario("una comisión pagada dos veces no se repite como «fórmula»", d => { d.tx.push(Object.assign({}, t(d, "t-c8"), { id: "t-c8-bis" })); p(d, "P8").vendedor.valor = 12; }, ["movimiento-duplicado:error"]);
escenario("una comisión por valor FIJO que coincide NO se señala (ya está en los datos limpios)", d => {}, []);

console.log("== combinaciones y orden");
{
  const d = datosLimpios();
  sinTx(d, "t-a1"); p(d, "P3").vendedor.estado = "pendiente"; t(d, "t-hilo").monto = 25000.5;
  cargar(d);
  const hs = salud.calcSaludDatos();
  const sev = hs.map(h => h.severidad);
  ok(hs.length === 3, "tres problemas distintos dan tres hallazgos (sin duplicar ninguno)  (obtuvo " + hs.length + ")");
  ok(sev.indexOf("aviso") > sev.lastIndexOf("error"), "los errores van antes que los avisos");
  ok(hs.every(h => h.id && h.regla && h.titulo && h.detalle && h.porque && h.donde && Array.isArray(h.afectados)), "todo hallazgo trae id, regla, título, detalle, porqué, dónde y afectados");
  ok(new Set(hs.map(h => h.id)).size === hs.length, "los ids no se repiten");
  const r = salud.calcResumenSalud();
  ok(r.errores === 2 && r.avisos === 1, "el resumen cuenta 2 errores y 1 aviso");
  const inf = salud.textoInformeSalud("2026-10-29");
  ok(inf.indexOf("ERRORES (2)") !== -1 && inf.indexOf("AVISOS (1)") !== -1 && inf.indexOf("Dónde se arregla") !== -1 && inf.indexOf("Afecta:") !== -1, "el informe en texto trae errores, avisos, dónde se arregla y qué afecta");
}

// ======================= 3. El registro es extensible =======================
console.log("== el registro de verificaciones");
{
  cargar(datosLimpios());
  const antes = salud.VERIFICACIONES_SALUD.length;
  salud.registrarVerificacion({ id: "prueba-nueva", titulo: "Una verificación nueva", porque: "porque sí", donde: "en algún lado",
    correr: () => [{ clave: "x", severidad: "aviso", titulo: "Algo nuevo", detalle: "detalle nuevo", afectados: [{ tipo: "pedido", id: "P1" }] }] });
  let hs = salud.calcSaludDatos();
  ok(salud.VERIFICACIONES_SALUD.length === antes + 1 && hs.length === 1 && hs[0].id === "prueba-nueva:x" && hs[0].donde === "en algún lado" && hs[0].porque === "porque sí", "una verificación nueva se suma y sus hallazgos salen con su porqué y dónde");
  salud.registrarVerificacion({ id: "prueba-nueva", titulo: "Reemplazada", porque: "p", donde: "d", correr: () => [] });
  ok(salud.VERIFICACIONES_SALUD.length === antes + 1 && salud.calcSaludDatos().length === 0, "registrar el mismo id la reemplaza (no la duplica)");
  salud.registrarVerificacion({ id: "prueba-nueva", titulo: "Que falla", porque: "p", donde: "d", correr: () => { throw new Error("se rompió"); } });
  hs = salud.calcSaludDatos();
  ok(hs.length === 1 && hs[0].severidad === "error" && hs[0].titulo.indexOf("No se pudo revisar") !== -1 && hs[0].detalle.indexOf("se rompió") !== -1, "una verificación que falla NO se calla: sale como error (si no corrió, no se sabe si cuadra)");
  salud.VERIFICACIONES_SALUD.pop();
  ok(salud.calcSaludDatos().length === 0, "(se quita la de prueba)");
}
console.log("== cada marca de origen está clasificada (duplicados)");
{
  const campos = calc.MARCAS_ORIGEN_SISTEMA.map(m => m.campo);
  const clasificadas = Object.keys(salud.MARCAS_UNICAS).concat(salud.MARCAS_REPETIBLES);
  ok(campos.every(c => clasificadas.indexOf(c) !== -1), "toda marca de MARCAS_ORIGEN_SISTEMA está en MARCAS_UNICAS o MARCAS_REPETIBLES  (sin clasificar: " + campos.filter(c => clasificadas.indexOf(c) === -1).join(", ") + ")");
  ok(clasificadas.every(c => campos.indexOf(c) !== -1), "y no sobra ninguna que ya no exista");
}

// ======================= 4. Lo que loadAll() corrige en silencio =======================
console.log("== bitácora de lo corregido al cargar");
{
  const lim = () => { state.reparacionesAlCargar = []; };
  const cant = (clave) => { const f = state.reparacionesAlCargar.filter(r => r.clave === clave)[0]; return f ? f.cantidad : 0; };
  function caso(nombre, clave, correr, esperado) {
    lim();
    const r1 = correr();
    ok(r1 === true && cant(clave) === esperado, nombre + ": corrige " + esperado + " y devuelve true  (anotó " + cant(clave) + ", devolvió " + r1 + ")");
    const antes = cant(clave);
    const r2 = correr();
    ok(r2 === false && cant(clave) === antes, nombre + ": correrla de nuevo no corrige ni anota nada más");
  }
  let txA, cotsA;
  txA = [{ id: "x1", tipo: "gasto", origenComisionPedidoId: "p" }, { id: "x2", tipo: "gasto", origenColchonId: "c", origenComisionCotId: "c" }, { id: "x3", tipo: "gasto", origenGastoFijoPeriodo: "abc" }, { id: "ok", tipo: "comision", origenComisionPedidoId: "p" }];
  caso("marcas imposibles", "marcasInconsistentes", () => store.repararMarcasOrigenInconsistentes(txA), 3);
  ok(txA[1].origenColchonId === "" && txA[1].origenComisionCotId === "" && txA[3].origenComisionPedidoId === "p", "(y dejó limpia la mala y la buena intacta; el movimiento con dos marcas falsas cuenta como UNA cosa)");
  txA = [{ id: "e1", origenCompraExcedenteClave: "k", pedidoId: "p1" }, { id: "e2", origenCompraExcedenteClave: "k", pedidoId: "p2" }, { id: "n", pedidoId: "p3" }];
  caso("excedente con pedido", "pedidoIdExcedente", () => store.repararPedidoIdExcedente(txA), 2);
  txA = [{ id: "t1", cotizacionId: "c1" }, { id: "t2", cotizacionId: "c1" }]; cotsA = [{ id: "c1", compras: [{ clave: "k1", excedenteTxId: "t1" }, { clave: "k2", excedenteTxId: "t2" }] }];
  caso("excedente sin marca", "marcaExcedente", () => store.repararMarcaExcedentePerdida(txA, cotsA), 2);
  txA = [{ id: "h1", cotizacionId: "c1", pedidoId: "" }]; cotsA = [{ id: "c1", pedidoOrigenId: "p1" }];
  caso("movimiento sin pedido", "txHuerfanosCotEscalada", () => store.repararTxHuerfanosDeCotEscalada(txA, cotsA, [{ id: "p1" }]), 1);
  const pedsV = [{ id: "p1", vendedor: { nombre: "" } }, { id: "p2", vendedor: null }];
  txA = [{ tipo: "comision", origenComisionPedidoId: "p1", contraparte: "Ana", monto: 1000 }, { tipo: "comision", origenComisionPedidoId: "p2", contraparte: "Beto", monto: 2000 }];
  caso("vendedor perdido", "vendedorPerdido", () => store.repararVendedorPerdido(pedsV, txA), 2);
  const catalogo = [{ id: "c1", nombre: "Hilo", categoriaId: "cat1" }];
  const plantillas = [{ insumos: [{ nombre: "hilo" }, { nombre: "HILO" }] }];
  const cotsI = [{ referencias: [{ insumos: [{ nombre: "Hilo" }] }] }];
  caso("insumo sin catálogo", "origenCatalogo", () => store.repararOrigenCatalogoInsumos(catalogo, plantillas, [], cotsI), 3);
  const plantCat = [{ insumos: [{ origenCatalogoId: "c1" }] }]; const cotsCat = [{ referencias: [{ insumos: [{ origenCatalogoId: "c1" }, { origenCatalogoId: "zz" }] }] }];
  caso("insumo sin categoría", "categoriaInsumos", () => store.repararCategoriaIdInsumos(catalogo, plantCat, [], cotsCat), 2);
  const plantTela = [{ consumoSugerido: 1.5, insumos: [{ tipo: "tela" }, { tipo: "tela", consumoPropio: true }, { tipo: "hilo" }] }]; const cotsTela = [{ referencias: [{ consumoAprox: 2, insumos: [{ tipo: "tela" }] }] }];
  caso("tela sin consumo propio", "consumoTela", () => store.repararConsumoTelaPorInsumo(plantTela, [], cotsTela), 2);
  const cotsProv = [{ referencias: [{ origen: "proveedor", nombre: "Camisa", costoCompra: 1000, insumos: [] }, { origen: "taller", insumos: [] }] }];
  caso("referencia de proveedor", "referenciasProveedor", () => store.repararReferenciasProveedorAInsumo(cotsProv), 1);
  const d = datosLimpios();
  const cotSeg = Object.assign({}, d.cotizaciones[0], { compras: [] });
  const claveSeg = calc.calcListaCompras(cotSeg).filter(l => l.nombre === "Confección")[0].clave;
  const txSeg = [{ id: "s1", tipo: "gasto", monto: 50000, cotizacionId: "cot-serv", origenCompraClave: claveSeg }];
  caso("compra sin seguimiento", "comprasSinSeguimiento", () => calc.repararComprasSinSeguimiento(txSeg, [cotSeg]), 1);

  const anotadas = Object.keys(store.REPARACIONES_AL_CARGAR);
  ok(anotadas.length === 12 && anotadas.every(k => typeof store.REPARACIONES_AL_CARGAR[k] === "string" && store.REPARACIONES_AL_CARGAR[k].length > 10), "las 12 correcciones silenciosas (11 funciones + el detalle de tallas) tienen su frase");
  ok(state.reparacionesAlCargar.every(r => anotadas.indexOf(r.clave) !== -1), "toda clave anotada tiene frase");

  console.log("== el resumen de lo corregido");
  state.reparacionesAlCargar = []; state.reparacionesOmitidas = false;
  let rep = salud.calcReparacionesAlCargar();
  ok(rep.total === 0 && rep.filas.length === 0 && !rep.omitidas, "sin correcciones: total 0");
  store.anotarReparacion("marcasInconsistentes", 2); store.anotarReparacion("recibos", 1); store.anotarReparacion("marcasInconsistentes", 3); store.anotarReparacion("tallas", 0);
  rep = salud.calcReparacionesAlCargar();
  ok(rep.total === 6 && rep.filas.length === 2 && rep.filas[0].clave === "marcasInconsistentes" && rep.filas[0].cantidad === 5, "suma por clave (2 + 3), ignora los 0 y respeta el orden de loadAll");
  state.reparacionesOmitidas = true;
  ok(salud.calcReparacionesAlCargar().omitidas === true, "dice si esta carga se saltó las correcciones por falta de red");
  state.reparacionesOmitidas = false;
}

// ======================= 5. El panel =======================
console.log("== el panel «Salud de los datos»");
{
  state.reparacionesAlCargar = []; state.reparacionesOmitidas = false; state.saludFiltro = "todos"; state.saludBuscar = "";
  cargar(datosLimpios());
  let html = ui.renderSalud();
  ok(html.indexOf("Todo cuadra") !== -1 && html.indexOf("salud-item") === -1, "con datos limpios dice «Todo cuadra» y no lista nada");
  ok(html.indexOf("Se revisaron " + salud.VERIFICACIONES_SALUD.length + " cosas") !== -1, "...y dice cuántas cosas se revisaron");
  ok(html.indexOf("no tuvo que corregir nada") !== -1, "...y que al cargar no se corrigió nada");
  ok(html.indexOf('data-action="copiar-informe-salud"') !== -1, "tiene el botón de copiar el informe");
  ok(html.indexOf("help-tip") !== -1, "la explicación vive en el «?» (renderHelp), no en un párrafo visible");

  const d = datosLimpios(); sinTx(d, "t-a1"); d.tx.push(Object.assign({}, t(d, "t-c3"), { id: "t-c3-bis" })); t(d, "t-hilo").monto = 25000.5; cargar(d);
  store.anotarReparacion("marcasInconsistentes", 2); store.anotarReparacion("recibos", 1);
  html = ui.renderSalud();
  ok(html.indexOf("Todo cuadra") === -1 && (html.match(/class="salud-item /g) || []).length === 3, "con 3 problemas lista 3 filas");
  ok(html.indexOf("Una comisión aparece pagada dos veces") !== -1 && html.indexOf("Un abono del pedido no está en Finanzas") !== -1, "cada fila dice su título");
  ok(html.indexOf('data-action="salud-ir" data-tipo="pedido" data-id="P1"') !== -1, "el hallazgo del abono lleva al pedido P1");
  ok(html.indexOf('data-tipo="movimiento" data-id="t-c3,t-c3-bis"') !== -1, "el duplicado lleva a los DOS movimientos juntos");
  ok(html.indexOf("Se arregla en:") !== -1, "cada fila dice dónde se arregla");
  ok(html.indexOf("Al cargar, la app corrigió 3 cosas por su cuenta") !== -1 && html.indexOf("<b>2</b> movimiento(s) con una marca de origen imposible") !== -1, "muestra «al cargar, la app corrigió 3 cosas» con el detalle de cada una");
  ok(html.indexOf('data-val="error"') !== -1 && html.indexOf('data-val="aviso"') !== -1 && html.indexOf("2 de") === -1 && html.indexOf("3 hallazgos") !== -1, "chips Todos/Errores/Avisos y el contador «3 hallazgos»");

  state.saludFiltro = "aviso"; html = ui.renderSalud();
  ok((html.match(/class="salud-item /g) || []).length === 1 && html.indexOf("1 de 3 hallazgos") !== -1, "el filtro «Avisos» deja 1 fila y el contador dice «1 de 3 hallazgos»");
  state.saludFiltro = "todos"; state.saludBuscar = "OP-3"; html = ui.renderSalud();
  ok((html.match(/class="salud-item /g) || []).length === 1 && html.indexOf("comisión") !== -1, "buscar «OP-3» deja solo lo del pedido OP-3");
  state.saludBuscar = "zzz-nada"; html = ui.renderSalud();
  ok(html.indexOf("Nada coincide") !== -1, "una búsqueda sin resultados lo dice");
  state.saludBuscar = "";
  state.reparacionesOmitidas = true; html = ui.renderSalud();
  ok(html.indexOf("sin conexión") !== -1 && html.indexOf("Al cargar, la app corrigió 3 cosas") !== -1, "si la carga fue sin red, lo dice sin esconder lo que sí se corrigió");
  state.reparacionesAlCargar = []; html = ui.renderSalud();
  ok(html.indexOf("sin conexión") !== -1 && html.indexOf("no tuvo que corregir nada") === -1, "sin red y sin correcciones NO dice «no tuvo que corregir nada» (no se lee como «todo estaba bien»)");
  state.reparacionesOmitidas = false;

  console.log("== navegación del panel");
  const accion = ui.actions;
  accion["salud-filtro"](fakeEl({ "data-val": "error" }));
  ok(state.saludFiltro === "error", "salud-filtro cambia el filtro");
  accion["salud-ir"](fakeEl({ "data-tipo": "pedido", "data-id": "P1" }));
  ok(state.tab === "pedidos" && state.pedidosVista === "historial" && state.filtroPedidos === "todos" && state.buscarPedidos === "", "ir a un pedido: pestaña Pedidos, Historial, sin filtros");
  accion["salud-ir"](fakeEl({ "data-tipo": "cotizacion", "data-id": "C1" }));
  ok(state.tab === "cotizaciones" && state.cotizacionEditando === "C1", "ir a una cotización: la abre");
  accion["salud-ir"](fakeEl({ "data-tipo": "movimiento", "data-id": "t-c3,t-c3-bis" }));
  ok(state.tab === "finanzas" && state.filtroTx === "todos" && state.buscarTx === "" && state.txEnfocados.join() === "t-c3,t-c3-bis", "ir a movimientos: Finanzas se queda solo con esos");
  accion["salud-ir"](fakeEl({ "data-tipo": "recibo", "data-id": "R1" }));
  ok(state.tab === "finanzas" && state.reciboExpandido.R1 === true, "ir a un recibo: abre su tarjeta en Finanzas");
  // Hallazgo #66: los enlaces nuevos
  accion["salud-ir"](fakeEl({ "data-tipo": "deuda", "data-id": "d2" }));
  ok(state.tab === "pendientes" && state.deudasVista === "activas", "ir a una deuda activa: Pendientes, pestaña Deudas");
  accion["salud-ir"](fakeEl({ "data-tipo": "deuda", "data-id": "d3" }));
  ok(state.tab === "pendientes" && state.deudasVista === "historial", "ir a una deuda saldada: Pendientes, pestaña Historial de deudas");
  state.tab = "inicio";
  accion["salud-ir"](fakeEl({ "data-tipo": "empleado", "data-id": "e1" }));
  ok(state.tab === "pendientes", "ir a una persona de la nómina: Pendientes");
  accion["salud-ir"](fakeEl({ "data-tipo": "papelera-pedido", "data-id": "P7" }));
  ok(state.tab === "pedidos" && state.pedidosVista === "historial" && state.filtroPedidosVista === "papelera", "ir a un pedido de la papelera: Pedidos, vista Papelera");
  accion["salud-ir"](fakeEl({ "data-tipo": "papelera-movimiento", "data-id": "tp-a7" }));
  ok(state.tab === "finanzas" && state.filtroTxVista === "papelera" && state.txEnfocados.length === 0, "ir a un movimiento de la papelera: Finanzas, vista Papelera");
  state.filtroTxVista = "activos"; state.filtroPedidosVista = "activos";
  {
    const foto = { pedidos: state.pedidos, tx: state.tx, cotizaciones: state.cotizaciones, deudas: state.deudas, deudasHistorial: state.deudasHistorial, pedidosPapelera: state.pedidosPapelera, txPapelera: state.txPapelera, nomina: state.config.nomina, gastosFijos: state.config.gastosFijos, cotSucia: state.cotSucia };
    const d2 = datosLimpios(); t(d2, "t-n1").monto = 1500000; sinTx(d2, "t-e1"); d2.pedidosPapelera.push(Object.assign({}, p(d2, "P1"))); cargar(d2);
    state.saludFiltro = "todos"; state.saludBuscar = "";
    const h = ui.renderSalud();
    ok(h.indexOf('data-tipo="empleado" data-id="e1"') !== -1 && h.indexOf("↗ Nómina") !== -1, "el hallazgo de nómina trae su botón «↗ Nómina»");
    ok(h.indexOf('data-tipo="deuda" data-id="d2"') !== -1 && h.indexOf("↗ Deuda") !== -1, "el de la deuda trae «↗ Deuda»");
    ok(h.indexOf('data-tipo="papelera-pedido"') !== -1 && h.indexOf("↗ Papelera de pedidos") !== -1, "el de la papelera trae «↗ Papelera de pedidos»");
    cargar(foto); // vuelve a los datos de antes para lo que sigue
  }
  state.txEnfocados = []; state.saludFiltro = "todos";

  console.log("== copiar el informe");
  let copiado = null;
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (txt) => { copiado = txt; } } }, configurable: true, writable: true });
  accion["copiar-informe-salud"]();
  await new Promise(r => setTimeout(r, 20));
  ok(copiado && copiado.indexOf("Salud de los datos") === 0 && copiado.indexOf("Una comisión aparece pagada dos veces") !== -1, "el botón copia el informe al portapapeles");
  ok(state.toast && state.toast.msg.indexOf("copiado") !== -1, "y avisa con un toast");

  console.log("== solo admin, dentro de Configuración");
  html = config.render();
  ok(html.indexOf("Salud de los datos") !== -1 && html.indexOf("Marca del taller") > html.indexOf("Salud de los datos"), "Configuración muestra el panel PRIMERO (sin sesión = admin, como en el resto de la app)");
  ok(typeof config.actions["salud-ir"] === "function" && typeof config.actions["copiar-informe-salud"] === "function" && typeof config.actions["save-marca"] === "function", "las acciones del panel están en el registro de Configuración, junto a las suyas");
}

// ======================= 6. Cuánto cuesta =======================
console.log("== con un taller grande");
{
  const d = datosLimpios();
  for (let i = 0; i < 800; i++) {
    const id = "PX" + i;
    d.pedidos.push({ id, numeroOp: "OP-X" + i, cliente: "Cliente " + i, descripcion: "Pedido " + i, total: 100000, abono: 100000, iva: { activo: false, porcentaje: 19 },
      lineas: [{ id: "lx" + i, cantidad: 1, precioUnitario: 100000 }], abonos: [{ id: "ax" + i, monto: 100000, fecha: "2026-10-01" }] });
    d.tx.push({ id: "tx" + i, tipo: "ingreso", concepto: "Abono " + i, monto: 100000, fecha: "2026-10-01", pedidoId: id, origenAbonoId: "ax" + i });
  }
  for (let i = 0; i < 2500; i++) d.tx.push({ id: "tg" + i, tipo: "gasto", concepto: "Gasto " + i, monto: 1000 + i, fecha: "2026-09-15" });
  // Hallazgo #66: 300 cotizaciones de 6 compras «Sí», cada una ya llevada a Finanzas (1.800 movimientos más),
  // 40 deudas con su historial, 30 personas en la nómina y 200 cosas en la papelera.
  for (let i = 0; i < 300; i++) {
    const cot = cotConInsumo("cx" + i, { pedidoId: "PX" + i }); // ya convertida en su pedido (también se compara su total)
    cot.referencias[0].precioVenta = 10000; // 10 x $10.000 = los $100.000 del pedido
    for (let j = 1; j <= 5; j++) cot.referencias[0].insumos.push({ id: "ins" + i + "-" + j, nombre: "Insumo " + j, unidad: "u", costo: 1000, tipo: "por_prenda", cantidad: 1, categoriaId: "", proveedorId: "" });
    cot.compras = calc.calcListaCompras(cot).map((l, k) => {
      const txId = "tc" + i + "-" + k;
      d.tx.push({ id: txId, tipo: "gasto", concepto: "Compra", monto: 1000 + k, fecha: "2026-09-10", cotizacionId: cot.id, origenCompraClave: l.clave });
      return { clave: l.clave, estado: "si", costoReal: 1000 + k, cantidadReal: 10, txId };
    });
    d.cotizaciones.push(cot);
  }
  for (let i = 0; i < 40; i++) {
    d.tx.push({ id: "td" + i, tipo: "gasto", concepto: "Cuota", monto: 100000, fecha: "2026-09-12", deudaId: "dx" + i });
    d.deudas.push({ id: "dx" + i, concepto: "Deuda " + i, monto: 400000, cuotas: 4, cuotasPagadas: 1, historial: [{ fecha: "2026-09-12", monto: 100000, txId: "td" + i }] });
  }
  for (let i = 0; i < 30; i++) {
    d.nomina.push({ id: "ex" + i, nombre: "Persona " + i, salario: 1000000, salarioPeriodo: "mensual", periodo: "mensual" });
    d.tx.push({ id: "tn" + i, tipo: "nomina", concepto: "Nómina", monto: 1000000, contraparte: "Persona " + i, empleadoId: "ex" + i, fecha: HOY_REAL });
  }
  for (let i = 0; i < 200; i++) d.txPapelera.push({ id: "tpx" + i, tipo: "gasto", concepto: "Borrado " + i, monto: 1000, fecha: "2026-09-01", eliminadoEl: "2026-09-02" });
  cargar(d);
  const t0 = Date.now();
  const hs = salud.calcSaludDatos();
  const ms = Date.now() - t0;
  ok(hs.length === 0, "800 pedidos, 300 cotizaciones con compras, 40 deudas, 30 personas en nómina y 5.000 movimientos sanos siguen dando cero hallazgos" + (hs.length ? "  (hay: " + hs.slice(0, 3).map(h => h.id).join(", ") + ")" : ""));
  ok(ms < 1500, "y la revisión completa tarda " + ms + " ms (se corre en cada render para el insignia del menú)");
}

console.log("");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de Salud de los datos");
process.exit(fallos ? 1 : 0);
