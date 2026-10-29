// Cuentas y conciliación (Hallazgo #63): cada movimiento lleva su cuenta, el
// saldo de cada cuenta sale de la MISMA fórmula que la Caja (la suma de las
// cuentas es siempre la Caja), una transferencia entre cuentas no mueve la Caja
// ni cuenta como ingreso/gasto, los movimientos de antes migran a «Sin asignar»
// sin cambiar nada, y la conciliación contra el extracto encuentra lo que falta.
//
// Se corre solo, aparte de smoke.mjs:   node test/cuentas.mjs
//
// No necesita jsdom (mismo método que test/descuentos.mjs): se stubean los pocos
// globales que store.js toca al importarse y se llaman las acciones reales con
// elementos falsos. La hoja de Google se simula con un fetch falso.

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; } }; };
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], remove: noop });
let camposDelDom = {}; // id -> value: lo que "hay escrito" en el DOM falso (document.getElementById)
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { getElementById: (id) => (id in camposDelDom ? { value: camposDelDom[id] } : null), createElement: el, addEventListener: noop, dispatchEvent: noop, querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el(), head: el(), visibilityState: "visible" };
let avisos = []; // todo window.alert queda anotado
globalThis.window = Object.assign(globalThis.window || {}, { localStorage, sessionStorage, document, addEventListener: noop, removeEventListener: noop, location: { href: "http://localhost/", search: "", hash: "" }, matchMedia: () => ({ matches: false, addEventListener: noop }), confirm: () => true, alert: (m) => { avisos.push(String(m)); } });
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.confirm = () => true; globalThis.alert = noop;

const R = new URL("../js/", import.meta.url).href;
const calc = await import(R + "core/calc.js");
const store = await import(R + "core/store.js");
const { state } = store;
const constants = await import(R + "core/constants.js");
const esquemas = await import(R + "core/sheetsEsquemas.js");
const { _resetCacheParaPruebas } = await import(R + "core/sheetsTabular.js");
const auth = await import(R + "core/auth.js");
const comp = await import(R + "core/components.js");
const cuentas = await import(R + "modules/cuentas.js");
const fin = await import(R + "modules/finanzas.js");
const ped = await import(R + "modules/pedidos.js");
const resumen = await import(R + "modules/resumen.js");
const cfgMod = await import(R + "modules/config.js");

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { pruebas++; if (a !== b) { fallos++; console.log("  X FALLA: " + msg + "  (obtuvo " + a + ", esperaba " + b + ")"); } else console.log("  ok " + msg); }
const fakeEl = (attrs, value, extra) => Object.assign({ value: value, checked: false, getAttribute: k => (k in attrs ? attrs[k] : null), closest: () => null }, extra || {});
// Una fila en edición: querySelector('[data-role="x"]') devuelve el campo si la fila lo tiene.
const filaEdicion = (valores) => ({ querySelector: (sel) => { const m = /data-role="([^"]+)"/.exec(sel); return m && (m[1] in valores) ? { value: valores[m[1]] } : null; } });
const conFila = (attrs, valores) => fakeEl(attrs, "", { closest: () => filaEdicion(valores) });
const marca = (checked, attrs) => fakeEl(attrs, "", { checked: checked });
const caja = () => calc.calcCaja();
const saldos = () => calc.calcSaldosPorCuenta();
const saldoDe = (id) => { const f = saldos().cuentas.filter(c => c.id === id)[0]; return f ? f.saldo : 0; };
// La garantía del dueño: lo que suman las cuentas es la Caja actual.
const cuadra = (msg) => { const s = saldos(); ok(s.cuadra && Math.abs(s.total - caja()) < 0.005, msg + " (cuentas " + s.total + " / caja " + caja() + ")"); };
const resumenMov = () => JSON.stringify(calc.calcResumenMovimientos(state.tx));
const serie = () => JSON.stringify(calc.calcSerieMovimientos(state.tx, "2026-10-01", "2026-10-31"));

function reiniciar() {
  state.tx = []; state.txPapelera = []; state.transferencias = []; state.pedidos = [];
  state.config = Object.assign({}, state.config, {
    cuentas: [{ id: "efectivo", nombre: "Efectivo" }, { id: "banco", nombre: "Banco" }, { id: "nequi", nombre: "Nequi" }],
    cuentaPredeterminada: "", conciliaciones: {}
  });
  state.formTransferencia = { de: "", a: "", monto: "", fecha: "", nota: "" };
  state.formConciliacion = { cuenta: "", fecha: "", saldo: "", ver: "pendientes" };
  state.formAbono = { pedidoId: "", monto: "", fecha: "", metodo: "" };
  state.formReembolso = { monto: "", fecha: "", motivo: "", cuenta: "" };
  state.formTx = Object.assign({}, state.formTx, { cuenta: "" });
  camposDelDom = {}; avisos = [];
}

// ======================= 1. La regla de signo y la Caja =======================
{
  console.log("== un solo signo para la Caja y las cuentas");
  reiniciar();
  igual(calc.montoConSigno({ tipo: "ingreso", monto: 100 }), 100, "ingreso suma");
  igual(calc.montoConSigno({ tipo: "gasto", monto: 100 }), -100, "gasto resta");
  igual(calc.montoConSigno({ tipo: "nomina", monto: 100 }), -100, "nómina resta");
  igual(calc.montoConSigno({ tipo: "comision", monto: 100 }), -100, "comisión resta");
  igual(calc.montoConSigno({ tipo: "ingreso", monto: "250" }), 250, "el monto como texto también");
  state.tx = [{ id: "a", tipo: "ingreso", monto: 1000 }, { id: "b", tipo: "gasto", monto: 300 }, { id: "c", tipo: "nomina", monto: 200 }, { id: "d", tipo: "comision", monto: 50 }];
  igual(caja(), 450, "Caja = 1000 - 300 - 200 - 50 (igual que antes de las cuentas)");
}

// ======================= 2. Migrar los movimientos de antes =======================
{
  console.log("== migración: los movimientos existentes pasan a «Sin asignar» sin cambiar nada");
  reiniciar();
  const legado = [
    { id: "t1", tipo: "ingreso", fecha: "2026-10-01", concepto: "Abono — Camisas", monto: 500000, contraparte: "Ana", pedidoId: "p1", origenAbonoId: "a1" },
    { id: "t2", tipo: "gasto", fecha: "2026-10-02", concepto: "Tela", monto: 120000, esInsumo: "1", insumoNombre: "Montreal", cantidad: 12, unidad: "MT" },
    { id: "t3", tipo: "nomina", fecha: "2026-10-05", concepto: "Nómina — Ana", monto: 300000, empleadoId: "e1" },
    { id: "t4", tipo: "comision", fecha: "2026-10-06", concepto: "Comisión — Luis", monto: 25000, origenComisionPedidoId: "x" },
    { id: "t5", tipo: "ingreso", fecha: "2026-10-07", concepto: "Abono", monto: 250000 },
    { id: "t6", tipo: "gasto", fecha: "2026-10-09", concepto: "Gasto fijo — Arriendo", monto: 800000, origenGastoFijoPeriodo: "arriendo|2026-10" }
  ];
  state.tx = JSON.parse(JSON.stringify(legado));
  state.txPapelera = [{ id: "tp", tipo: "gasto", fecha: "2026-09-01", concepto: "Borrado", monto: 1 }];
  ok(state.tx.every(t => t.cuenta === undefined), "partimos de movimientos SIN cuenta (como los guardados antes de esta función)");
  const cajaAntes = caja(), resumenAntes = resumenMov(), serieAntes = serie();
  const ingresosAntes = calc.calcIngresosTotales(), gastosAntes = calc.calcGastosTotales(), nominaAntes = calc.calcNominaPagada();
  igual(cajaAntes, -495000, "Caja de partida");

  const m = calc.migrarCuentasMovimientos(state.tx);
  igual(m.migrados, 6, "se migraron los 6");
  ok(m.tx.every(t => t.cuenta === constants.CUENTA_SIN_ASIGNAR), "todos quedan en «sin-asignar»");
  ok(state.tx.every(t => t.cuenta === undefined), "no muta la lista original (devuelve copias)");
  state.tx = m.tx;
  igual(caja(), cajaAntes, "la Caja es EXACTAMENTE la misma después de migrar");
  igual(resumenMov(), resumenAntes, "el resumen de movimientos (ingresos/gastos/nómina/comisiones) es idéntico");
  igual(serie(), serieAntes, "la serie para las gráficas es idéntica");
  igual(calc.calcIngresosTotales(), ingresosAntes, "ingresos totales idénticos");
  igual(calc.calcGastosTotales(), gastosAntes, "gastos totales idénticos");
  igual(calc.calcNominaPagada(), nominaAntes, "nómina pagada idéntica");
  ok(legado.every((t, i) => ["id", "tipo", "fecha", "concepto", "monto"].every(k => state.tx[i][k] === t[k])), "id, tipo, fecha, concepto y monto de cada movimiento no se tocaron");
  ok(legado.every((t, i) => Object.keys(t).every(k => JSON.stringify(state.tx[i][k]) === JSON.stringify(t[k]))), "ningún otro campo (marcas de origen, insumo...) se perdió");

  const s = saldos();
  igual(s.cuentas.length, 4, "salen las 3 cuentas configuradas + «Sin asignar»");
  igual(s.cuentas[s.cuentas.length - 1].id, "sin-asignar", "«Sin asignar» va al final");
  igual(saldoDe("sin-asignar"), cajaAntes, "«Sin asignar» tiene TODA la Caja");
  ok(["efectivo", "banco", "nequi"].every(id => saldoDe(id) === 0), "las demás cuentas empiezan en 0");
  igual(s.total, s.caja, "ANTES de repartir: suma de cuentas = Caja");
  ok(s.cuadra, "y calcSaldosPorCuenta lo confirma (cuadra)");

  const otra = calc.migrarCuentasMovimientos(state.tx);
  igual(otra.migrados, 0, "migrar dos veces no hace nada la segunda");
  ok(otra.tx === state.tx, "...y devuelve la misma lista (sin guardados de más)");
  state.tx[0] = Object.assign({}, state.tx[0], { cuenta: "banco" });
  igual(calc.migrarCuentasMovimientos(state.tx).migrados, 0, "una cuenta ya asignada no se pisa");
  igual(calc.migrarCuentasMovimientos(undefined).migrados, 0, "sin lista no revienta");
  igual(calc.migrarCuentasMovimientos(state.txPapelera).migrados, 1, "la papelera también se migra");
  cuadra("tras asignar uno al Banco, sigue cuadrando");
  igual(saldoDe("banco"), 500000, "el abono de 500.000 quedó en el Banco");
}

// ======================= 3. La hoja: columnas nuevas AL FINAL =======================
{
  console.log("== hoja Movimientos: las columnas nuevas van al final y una celda vacía es «Sin asignar»");
  const claves = esquemas.COLUMNAS_MOVIMIENTOS.map(c => c.key);
  igual(claves.length, 34, "34 columnas (32 de antes + 2)");
  igual(claves[32], "cuenta", "«cuenta» es la columna 33 (después de reciboCompraLinea)");
  igual(claves[33], "conciliadoEn", "«conciliadoEn» es la 34");
  igual(claves[31], "reciboCompraLinea", "la que era la última sigue en su puesto (nada se corrió)");
  igual(claves.indexOf("id"), 0, "id sigue de primera");

  sessionStorage.setItem("taller_sesion_v1", JSON.stringify({ session: { email: "cuentas-test@taller.test", rol: "admin", vendedorNombre: "" }, accessToken: "fake-cuentas", expiraEl: Date.now() + 999999 }));
  auth.restaurarSesion();
  _resetCacheParaPruebas();
  let filas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async function (url, options) {
    const u = decodeURIComponent(String(url));
    const metodo = (options && options.method) || "GET";
    const json = (v) => ({ ok: true, status: 200, json: async () => v });
    if (u.indexOf("fields=sheets.properties") !== -1) return json({ sheets: [{ properties: { sheetId: 88001, title: "Movimientos", gridProperties: { columnCount: 40 } } }] });
    if (u.indexOf("/values/Movimientos") !== -1) {
      const esEnc = u.indexOf("Movimientos!A1:") !== -1;
      if (u.indexOf(":clear") !== -1) { if (!esEnc) filas = []; return json({}); }
      if (metodo === "PUT") { if (!esEnc) filas = JSON.parse(options.body).values; return json({}); }
      if (esEnc) return json({ values: [esquemas.COLUMNAS_MOVIMIENTOS.map(c => c.header)] });
      return json({ values: filas });
    }
    return json({});
  };
  try {
    // Una fila guardada ANTES de las columnas: solo trae las 32 de entonces.
    const filaVieja = new Array(32).fill("");
    filaVieja[0] = "viejo"; filaVieja[1] = "2026-09-01"; filaVieja[2] = "ingreso"; filaVieja[3] = "Abono de antes"; filaVieja[4] = "90000";
    filas = [filaVieja];
    let leidos = await esquemas.tablaMovimientos.leer();
    igual(leidos.length, 1, "se lee la fila vieja (más corta que el esquema)");
    igual(leidos[0].cuenta, "sin-asignar", "su cuenta vacía se lee como «sin-asignar»");
    igual(leidos[0].conciliadoEn, "", "y sin conciliar");
    igual(leidos[0].monto, 90000, "el monto sigue igual");

    await esquemas.tablaMovimientos.escribir([
      { id: "n1", tipo: "ingreso", fecha: "2026-10-02", concepto: "Abono", monto: 100000, cuenta: "banco", conciliadoEn: "2026-10-10" },
      { id: "n2", tipo: "gasto", fecha: "2026-10-03", concepto: "Sin cuenta", monto: 5000 }
    ]);
    igual(filas[0].length, 34, "se escriben las 34 columnas");
    igual(filas[0][32], "banco", "la cuenta cae en la columna 33");
    igual(filas[0][33], "2026-10-10", "la fecha de conciliación en la 34");
    igual(filas[0][31], "", "y la columna 32 (reciboCompraLinea) sigue vacía: nada se corrió");
    leidos = await esquemas.tablaMovimientos.leer();
    igual(leidos[0].cuenta, "banco", "la cuenta sobrevive a escribir() + leer()");
    igual(leidos[0].conciliadoEn, "2026-10-10", "la marca de conciliación también");
    igual(leidos[1].cuenta, "sin-asignar", "un movimiento escrito sin cuenta se lee «sin-asignar»");
  } finally {
    global.fetch = fetchOriginal;
    _resetCacheParaPruebas();
  }
}

// ======================= 4. Cuentas configurables =======================
{
  console.log("== la lista de cuentas (Configuración)");
  reiniciar();
  igual(calc.calcCuentasConfig().length, 3, "por defecto: Efectivo, Banco y Nequi");
  state.config.cuentas = [{ id: "a", nombre: " Caja " }, { id: "a", nombre: "Repetida" }, { id: "", nombre: "Sin id" }, { id: "b", nombre: "   " }, { id: "sin-asignar", nombre: "Colada" }, { id: "c", nombre: "Bancolombia" }];
  igual(calc.calcCuentasConfig().map(c => c.id).join(), "a,c", "se descartan repetidas, sin id, sin nombre y la cuenta reservada");
  igual(calc.nombreCuenta("a"), "Caja", "el nombre sale sin espacios sobrantes");
  igual(calc.nombreCuenta("sin-asignar"), "Sin asignar", "«Sin asignar» siempre tiene nombre");
  igual(calc.nombreCuenta("fantasma"), "Cuenta eliminada", "una cuenta que ya no está se dice");
  ok(calc.existeCuenta("sin-asignar") && calc.existeCuenta("a") && !calc.existeCuenta("fantasma") && !calc.existeCuenta(""), "existeCuenta");
  igual(calc.cuentaDeTx({ cuenta: "c" }), "c", "cuentaDeTx");
  igual(calc.cuentaDeTx({}), "sin-asignar", "sin cuenta = «Sin asignar»");
  igual(calc.cuentaDeTx(null), "sin-asignar", "y sin movimiento tampoco revienta");
  igual(calc.cuentaParaMovimientoNuevo("c"), "c", "para un movimiento nuevo gana la elegida");
  igual(calc.cuentaParaMovimientoNuevo(""), "sin-asignar", "sin elegida ni predeterminada: «Sin asignar» (la app no adivina)");
  state.config.cuentaPredeterminada = "a";
  igual(calc.cuentaParaMovimientoNuevo(""), "a", "con predeterminada, esa");
  igual(calc.cuentaParaMovimientoNuevo("fantasma"), "a", "una elegida que no existe cae en la predeterminada");
  state.config.cuentaPredeterminada = "borrada";
  igual(calc.cuentaParaMovimientoNuevo(""), "sin-asignar", "una predeterminada que ya no existe tampoco se usa");
  state.config.cuentaPredeterminada = "";
  igual(calc.cuentaSugerida(""), "a", "el formulario muestra la primera cuenta si no hay predeterminada");
  igual(calc.cuentaSugerida("c"), "c", "...o la que se eligió");
  state.config.cuentas = [];
  igual(calc.cuentaSugerida(""), "sin-asignar", "sin ninguna cuenta configurada: «Sin asignar»");

  console.log("== medio de pago de un abono = cuenta");
  reiniciar();
  igual(calc.cuentaDeMetodoPago("banco"), "banco", "un id de cuenta es una cuenta");
  igual(calc.cuentaDeMetodoPago("transferencia"), "", "«transferencia» (de antes) no apunta a ninguna cuenta");
  igual(calc.cuentaDeMetodoPago("sin-asignar"), "", "«sin-asignar» no es una cuenta elegible como medio de pago");
  igual(calc.nombreMetodoPago("banco"), "Banco", "se muestra el nombre de la cuenta");
  igual(calc.nombreMetodoPago("transferencia"), "Transferencia", "un abono viejo sigue diciendo «Transferencia»");
  igual(calc.nombreMetodoPago("otro"), "Otro medio", "y «Otro medio»");
  igual(calc.nombreMetodoPago(""), "medio sin registrar", "y sin dato lo dice");
  igual(calc.nombreMetodoPago("sin-asignar"), "Sin asignar", "«sin-asignar» se lee «Sin asignar»");
  state.config.cuentas = [{ id: "efectivo", nombre: "Caja menor" }];
  igual(calc.nombreMetodoPago("efectivo"), "Caja menor", "renombrar la cuenta cambia cómo se ve un abono viejo «efectivo» (es la misma cuenta)");
}

// ======================= 5. Abonos: el movimiento nace en la cuenta =======================
{
  console.log("== pedido rápido con abono inicial");
  reiniciar();
  state.tab = "pedidos"; state.pedidosVista = "nueva";
  state.formPedido.cliente = "Ana";
  state.formPedido.lineas = [{ id: "l1", tipo: "libre", productoNombre: "Bordado", talla: "", cantidad: 2, precioUnitario: 100000, costoUnitario: 30000, observacion: "", campos: [] }];
  ped.actions["set-form-pedido-campo"](fakeEl({ "data-campo": "abono" }, "60000"));
  ped.actions["set-form-pedido-campo"](fakeEl({ "data-campo": "cuentaAbono" }, "nequi"));
  const htmlForm = ped.render();
  ok(htmlForm.indexOf("¿En qué cuenta entró?") !== -1, "el formulario pregunta la cuenta cuando hay abono inicial");
  ok(htmlForm.indexOf('<option value="nequi" selected>Nequi</option>') !== -1, "y muestra elegida «Nequi»");
  ok(htmlForm.indexOf('value="sin-asignar"') === -1, "sin ofrecer «Sin asignar» para un abono nuevo");
  await ped.actions["add-pedido"]();
  const p1 = state.pedidos[0];
  igual(state.tx.length, 1, "el abono inicial creó UN movimiento");
  igual(state.tx[0].cuenta, "nequi", "el movimiento nació en «nequi»");
  igual(p1.abonos[0].metodoPago, "nequi", "y el abono del pedido guarda la misma cuenta como medio de pago");
  igual(state.tx[0].origenAbonoId, p1.abonos[0].id, "con su marca de origen intacta");
  igual(saldoDe("nequi"), 60000, "Nequi tiene 60.000");
  igual(caja(), 60000, "la Caja también");
  cuadra("tras el abono inicial");

  console.log("== registrar un abono");
  const pedido = state.pedidos[0];
  state.formAbono = { pedidoId: pedido.id, monto: "50000", fecha: "2026-10-12", metodo: "banco" };
  await ped.actions["add-abono"](fakeEl({ "data-id": pedido.id }));
  const txAbono = state.tx.filter(t => t.concepto.indexOf("Abono — ") === 0)[0];
  ok(!!txAbono, "se creó el movimiento del abono");
  igual(txAbono.cuenta, "banco", "entró al Banco");
  igual(state.pedidos[0].abonos[1].metodoPago, "banco", "el abono guarda «banco» como medio de pago");
  igual(saldoDe("banco"), 50000, "el Banco tiene 50.000");
  igual(state.formAbono.metodo, "banco", "el formulario recuerda la última cuenta usada");
  cuadra("tras el abono al banco");

  // Lo que el campo del DOM diga manda sobre el borrador (como siempre en add-abono).
  camposDelDom = { ["abono-monto-" + pedido.id]: "10000", ["abono-fecha-" + pedido.id]: "2026-10-13", ["abono-metodo-" + pedido.id]: "efectivo" };
  state.formAbono = { pedidoId: pedido.id, monto: "", fecha: "", metodo: "banco" };
  await ped.actions["add-abono"](fakeEl({ "data-id": pedido.id }));
  camposDelDom = {};
  igual(saldoDe("efectivo"), 10000, "el select que se ve (efectivo) manda sobre el borrador");

  // Sin elegir nada: la predeterminada, o la primera cuenta (lo que el select muestra).
  state.formAbono = { pedidoId: pedido.id, monto: "7000", fecha: "2026-10-14", metodo: "" };
  await ped.actions["add-abono"](fakeEl({ "data-id": pedido.id }));
  igual(state.tx[0].cuenta, "efectivo", "sin elegir: la primera cuenta de la lista (lo que mostraba el select)");
  state.config.cuentaPredeterminada = "nequi";
  state.formAbono = { pedidoId: pedido.id, monto: "3000", fecha: "2026-10-14", metodo: "" };
  await ped.actions["add-abono"](fakeEl({ "data-id": pedido.id }));
  igual(state.tx[0].cuenta, "nequi", "con predeterminada «nequi»: esa");
  state.formAbono = { pedidoId: pedido.id, monto: "2000", fecha: "2026-10-14", metodo: "transferencia" };
  await ped.actions["add-abono"](fakeEl({ "data-id": pedido.id }));
  igual(state.tx[0].cuenta, "nequi", "un medio de antes («transferencia») que llega en un borrador viejo no se vuelve cuenta: cae en la predeterminada");
  state.config.cuentaPredeterminada = "";
  cuadra("tras varios abonos");

  console.log("== editar un abono mueve el movimiento de cuenta");
  const abonoBanco = state.pedidos[0].abonos.filter(a => a.metodoPago === "banco")[0];
  let tBanco = state.tx.filter(t => t.origenAbonoId === abonoBanco.id)[0];
  tBanco.conciliadoEn = "2026-10-20"; // ya lo habían visto en el extracto del banco
  const cajaAntesEdit = caja();
  ped.actions["guardar-abono-edit"](conFila({ "data-id": pedido.id, "data-abono": abonoBanco.id }, { "edit-abono-monto": "50000", "edit-abono-fecha": "2026-10-12", "edit-abono-metodo": "nequi" }));
  tBanco = state.tx.filter(t => t.origenAbonoId === abonoBanco.id)[0];
  igual(tBanco.cuenta, "nequi", "el movimiento pasó a «nequi»");
  igual(state.pedidos[0].abonos.filter(a => a.id === abonoBanco.id)[0].metodoPago, "nequi", "y el abono también");
  igual(saldoDe("banco"), 0, "el Banco quedó en 0");
  igual(tBanco.conciliadoEn, "", "cambiar de cuenta le quita la marca de conciliado (ya no es el del extracto del banco)");
  igual(caja(), cajaAntesEdit, "mover un abono de cuenta NO cambia la Caja");
  cuadra("tras editar la cuenta del abono");

  // Solo cambiar el monto también desconcilia; no cambiar nada relevante no.
  tBanco.conciliadoEn = "2026-10-21";
  ped.actions["guardar-abono-edit"](conFila({ "data-id": pedido.id, "data-abono": abonoBanco.id }, { "edit-abono-monto": "50000", "edit-abono-fecha": "2026-10-12", "edit-abono-metodo": "nequi" }));
  igual(state.tx.filter(t => t.origenAbonoId === abonoBanco.id)[0].conciliadoEn, "2026-10-21", "guardar sin cambiar nada conserva la marca de conciliado");
  ped.actions["guardar-abono-edit"](conFila({ "data-id": pedido.id, "data-abono": abonoBanco.id }, { "edit-abono-monto": "55000", "edit-abono-fecha": "2026-10-12", "edit-abono-metodo": "nequi" }));
  igual(state.tx.filter(t => t.origenAbonoId === abonoBanco.id)[0].conciliadoEn, "", "cambiar el monto sí la quita");
  cuadra("tras cambiar el monto");

  // Un abono anterior a las cuentas: editarlo sin tocar el medio no mueve su movimiento.
  const abonoViejo = { id: "ab-viejo", monto: 12000, fecha: "2026-10-01", metodoPago: "transferencia", comprobanteUrl: "" };
  state.pedidos[0].abonos = state.pedidos[0].abonos.concat([abonoViejo]);
  state.tx.unshift({ id: "tx-viejo", tipo: "ingreso", fecha: "2026-10-01", concepto: "Abono viejo", monto: 12000, cuenta: "sin-asignar", pedidoId: pedido.id, origenAbonoId: "ab-viejo" });
  ped.actions["guardar-abono-edit"](conFila({ "data-id": pedido.id, "data-abono": "ab-viejo" }, { "edit-abono-monto": "12000", "edit-abono-fecha": "2026-10-01", "edit-abono-metodo": "transferencia" }));
  igual(state.tx.filter(t => t.id === "tx-viejo")[0].cuenta, "sin-asignar", "un abono de antes que se edita sin cambiar el medio se queda donde estaba");
  igual(state.pedidos[0].abonos.filter(a => a.id === "ab-viejo")[0].metodoPago, "transferencia", "y conserva su medio «transferencia»");
  ped.actions["guardar-abono-edit"](conFila({ "data-id": pedido.id, "data-abono": "ab-viejo" }, { "edit-abono-monto": "12000", "edit-abono-fecha": "2026-10-01", "edit-abono-metodo": "banco" }));
  igual(state.tx.filter(t => t.id === "tx-viejo")[0].cuenta, "banco", "elegirle una cuenta lo asigna");
  cuadra("tras asignar el abono viejo");

  console.log("== la lista de movimientos del pedido muestra la cuenta");
  state.pedidoPanelAbierto = { [pedido.id]: true };
  const htmlPed = ped.render();
  ok(htmlPed.indexOf("Abono · Nequi") !== -1 && htmlPed.indexOf("Abono · Banco") !== -1, "cada abono dice «Abono · <cuenta>»");
  ok(htmlPed.indexOf('data-action="add-abono"') !== -1 && htmlPed.indexOf('id="abono-metodo-' + pedido.id + '"') !== -1, "el formulario de abono tiene su selector de cuenta");

  console.log("== cobrar el saldo completo");
  state.config.cuentaPredeterminada = "banco";
  const antesCobrar = state.tx.length;
  ped.actions.cobrar(fakeEl({ "data-id": pedido.id }));
  igual(state.tx.length, antesCobrar + 1, "se creó el movimiento del saldo");
  igual(state.tx[0].cuenta, "banco", "cae en la cuenta predeterminada (el botón no pregunta)");
  state.config.cuentaPredeterminada = "";
  cuadra("tras cobrar el saldo");

  console.log("== reembolso: sale de la cuenta elegida");
  const cajaAntesReem = caja(), efectivoAntes = saldoDe("efectivo");
  state.formReembolso = { monto: "4000", fecha: "2026-10-15", motivo: "talla mal", cuenta: "efectivo" };
  ped.actions["add-reembolso"](fakeEl({ "data-id": pedido.id }));
  igual(state.tx[0].tipo, "gasto", "el reembolso es un gasto");
  igual(state.tx[0].cuenta, "efectivo", "...de «efectivo»");
  igual(saldoDe("efectivo"), efectivoAntes - 4000, "el efectivo bajó 4.000");
  igual(caja(), cajaAntesReem - 4000, "la Caja también");
  cuadra("tras el reembolso");

  console.log("== anular un abono");
  ped.actions["eliminar-abono"](fakeEl({ "data-id": pedido.id, "data-abono": abonoBanco.id }));
  ok(state.tx.every(t => t.origenAbonoId !== abonoBanco.id), "su movimiento se retiró");
  cuadra("tras anular un abono");
}

// ======================= 6. Movimientos a mano y edición =======================
{
  console.log("== registrar un movimiento a mano");
  reiniciar();
  state.finanzasVista = "nuevo";
  const htmlNuevo = fin.render();
  ok(htmlNuevo.indexOf("<label>Cuenta") !== -1, "el formulario tiene el campo «Cuenta»");
  ok(htmlNuevo.indexOf('<option value="efectivo" selected>Efectivo</option>') !== -1, "y muestra elegida la primera cuenta");
  state.formTx = Object.assign({}, state.formTx, { tipo: "gasto", concepto: "Hilo", monto: "8000", fecha: "2026-10-10", cuenta: "banco", servicios: [] });
  fin.actions["add-tx"]();
  igual(state.tx[0].cuenta, "banco", "el gasto nació en el Banco");
  igual(state.formTx.cuenta, "banco", "el formulario recuerda la cuenta para el siguiente");
  state.formTx = Object.assign({}, state.formTx, { tipo: "ingreso", concepto: "Venta", monto: "20000", fecha: "2026-10-11", cuenta: "" });
  fin.actions["add-tx"]();
  igual(state.tx[0].cuenta, "efectivo", "sin elegir: la primera cuenta (lo que se veía)");
  cuadra("tras dos movimientos a mano");

  console.log("== editar la fila: la cuenta cambia aunque el movimiento tenga origen");
  const ab = { id: "t-ab", tipo: "ingreso", fecha: "2026-10-12", concepto: "Abono — X", monto: 30000, cuenta: "efectivo", origenAbonoId: "ab-x", conciliadoEn: "2026-10-30" };
  state.tx.unshift(ab);
  state.pedidos = [{ id: "pp", abonos: [{ id: "ab-x", monto: 30000 }] }]; // el origen existe: monto y tipo son de solo lectura
  const htmlEdicion = (state.txEditando = "t-ab", state.finanzasVista = "historial", fin.render());
  ok(htmlEdicion.indexOf('data-role="edit-cuenta"') !== -1, "la fila en edición tiene el selector de cuenta");
  const cajaAntes = caja();
  // Sin edit-monto/edit-tipo en la fila (solo lectura por tener origen): solo cambia la cuenta.
  fin.actions["guardar-tx-edit"](conFila({ "data-id": "t-ab" }, { "edit-fecha": "2026-10-12", "edit-concepto": "Abono — X", "edit-contraparte": "", "edit-cuenta": "nequi" }));
  const editado = state.tx.filter(t => t.id === "t-ab")[0];
  igual(editado.cuenta, "nequi", "la cuenta cambió");
  igual(editado.monto, 30000, "el monto NO cambió (solo lectura con origen)");
  igual(editado.tipo, "ingreso", "el tipo NO cambió");
  igual(editado.origenAbonoId, "ab-x", "la marca de origen sigue");
  igual(editado.conciliadoEn, "", "cambiar de cuenta le quita la marca de conciliado");
  igual(caja(), cajaAntes, "la Caja no se movió");
  cuadra("tras mover el abono de cuenta");

  // Un movimiento ya conciliado que solo cambia de concepto sigue conciliado.
  state.tx.filter(t => t.id === "t-ab")[0].conciliadoEn = "2026-10-30";
  fin.actions["guardar-tx-edit"](conFila({ "data-id": "t-ab" }, { "edit-fecha": "2026-10-12", "edit-concepto": "Abono — Y", "edit-contraparte": "", "edit-cuenta": "nequi" }));
  igual(state.tx.filter(t => t.id === "t-ab")[0].conciliadoEn, "2026-10-30", "cambiar solo el concepto conserva la marca");
  // Un movimiento manual (sin origen) se puede editar entero.
  const manual = state.tx.filter(t => t.concepto === "Hilo")[0];
  fin.actions["guardar-tx-edit"](conFila({ "data-id": manual.id }, { "edit-fecha": manual.fecha, "edit-concepto": "Hilo", "edit-contraparte": "", "edit-tipo": "gasto", "edit-monto": "9000", "edit-cuenta": "efectivo" }));
  igual(saldoDe("banco"), 0, "el hilo salió del Banco...");
  igual(state.tx.filter(t => t.id === manual.id)[0].monto, 9000, "...y su monto sí se pudo editar");
  cuadra("tras editar un movimiento manual");
  igual(fin.actions["guardar-tx-edit"](conFila({ "data-id": manual.id }, { "edit-fecha": manual.fecha, "edit-concepto": "Hilo", "edit-monto": "9000", "edit-cuenta": "fantasma" })), undefined, "(una cuenta inventada no revienta)");
  igual(state.tx.filter(t => t.id === manual.id)[0].cuenta, "efectivo", "una cuenta que no existe no se aplica: se queda donde estaba");

  console.log("== filtrar el historial por cuenta");
  state.txEditando = ""; state.filtroTxCuenta = "efectivo";
  let htmlHist = fin.render();
  ok(htmlHist.indexOf("Venta") !== -1 && htmlHist.indexOf("Abono — Y") === -1, "con el filtro «Efectivo» solo salen sus movimientos");
  ok(htmlHist.indexOf("🏦 Efectivo") !== -1, "cada fila dice su cuenta");
  fin.actions["set-tx-cuenta"](fakeEl({}, "todas"));
  igual(state.filtroTxCuenta, "todas", "«Todas las cuentas» quita el filtro");
  state.filtroTxCuenta = "todas";
}

// ======================= 7. Lo que la app registra sola =======================
{
  console.log("== movimientos que la app registra sola (nómina, gasto fijo...): persist les pone cuenta");
  reiniciar();
  state.tx = calc.migrarCuentasMovimientos([{ id: "v1", tipo: "ingreso", fecha: "2026-09-01", concepto: "De antes", monto: 1000 }]).tx;
  state.tx.unshift({ id: "n1", tipo: "nomina", fecha: "2026-10-01", concepto: "Nómina — Ana", monto: 300, empleadoId: "e1" });
  await store.persist("tx");
  igual(state.tx.filter(t => t.id === "n1")[0].cuenta, "sin-asignar", "sin predeterminada: «Sin asignar» (la app no adivina)");
  state.config.cuentaPredeterminada = "banco";
  state.tx.unshift({ id: "g1", tipo: "gasto", fecha: "2026-10-02", concepto: "Gasto fijo — Arriendo", monto: 800, origenGastoFijoPeriodo: "arriendo|2026-10" });
  state.tx.unshift({ id: "c1", tipo: "comision", fecha: "2026-10-02", concepto: "Comisión", monto: 50, cuenta: "nequi" });
  await store.persist("tx");
  igual(state.tx.filter(t => t.id === "g1")[0].cuenta, "banco", "con predeterminada «banco»: el gasto fijo cae ahí");
  igual(state.tx.filter(t => t.id === "c1")[0].cuenta, "nequi", "uno que ya traía cuenta no se toca");
  igual(state.tx.filter(t => t.id === "n1")[0].cuenta, "sin-asignar", "uno ya guardado antes no cambia de cuenta cuando cambia la predeterminada");
  igual(state.tx.filter(t => t.id === "v1")[0].cuenta, "sin-asignar", "y uno de antes de las cuentas JAMÁS cae en la predeterminada");
  cuadra("con movimientos de la app en tres cuentas");
  const antes = JSON.stringify(state.tx);
  await store.persist("tx");
  igual(JSON.stringify(state.tx), antes, "persist es idempotente: guardar otra vez no cambia nada");
  state.config.cuentaPredeterminada = "";
}

// ======================= 8. Transferencias =======================
{
  console.log("== transferir entre cuentas: no mueve la Caja ni cuenta como ingreso/gasto");
  reiniciar();
  state.tx = [
    { id: "i1", tipo: "ingreso", fecha: "2026-10-01", concepto: "Abono en efectivo", monto: 700000, cuenta: "efectivo" },
    { id: "i2", tipo: "ingreso", fecha: "2026-10-02", concepto: "Abono al banco", monto: 400000, cuenta: "banco" },
    { id: "g1", tipo: "gasto", fecha: "2026-10-03", concepto: "Tela", monto: 150000, cuenta: "banco" },
    { id: "v1", tipo: "ingreso", fecha: "2026-09-01", concepto: "Viejo", monto: 100000, cuenta: "sin-asignar" }
  ];
  const cajaAntes = caja(), resumenAntes = resumenMov(), serieAntes = serie();
  const ingresosAntes = calc.calcIngresosTotales(), gastosAntes = calc.calcGastosTotales();
  const txAntes = JSON.stringify(state.tx);
  igual(cajaAntes, 700000 + 400000 - 150000 + 100000, "Caja de partida: 1.050.000");

  state.formTransferencia = { de: "efectivo", a: "banco", monto: "500000", fecha: "2026-10-05", nota: "Consignación" };
  cuentas.actions["registrar-transferencia"]();
  igual(state.transferencias.length, 1, "se registró la transferencia");
  const tr = state.transferencias[0];
  ok(tr.de === "efectivo" && tr.a === "banco" && tr.monto === 500000 && tr.fecha === "2026-10-05" && tr.nota === "Consignación" && !tr.anulada, "con sus datos");
  igual(saldoDe("efectivo"), 200000, "el efectivo bajó 500.000");
  igual(saldoDe("banco"), 250000 + 500000, "el Banco subió 500.000");
  igual(caja(), cajaAntes, "la Caja NO cambió");
  igual(state.tx.length, 4, "no se creó ningún movimiento: la transferencia no vive en Finanzas");
  igual(JSON.stringify(state.tx), txAntes, "los movimientos quedaron exactamente igual");
  igual(resumenMov(), resumenAntes, "el reporte financiero (ingresos/gastos) es idéntico");
  igual(serie(), serieAntes, "las gráficas son idénticas");
  igual(calc.calcIngresosTotales(), ingresosAntes, "los ingresos totales no suben");
  igual(calc.calcGastosTotales(), gastosAntes, "los gastos totales no suben");
  cuadra("tras la transferencia");

  // Los dos asientos de la transferencia suman cero.
  const asientosTr = calc.calcAsientos().filter(a => a.origen === "transferencia");
  igual(asientosTr.length, 2, "una transferencia son DOS asientos (sale de una, entra a otra)");
  igual(asientosTr.reduce((a, x) => a + x.monto, 0), 0, "que suman cero");
  ok(asientosTr.some(a => a.cuenta === "efectivo" && a.monto === -500000) && asientosTr.some(a => a.cuenta === "banco" && a.monto === 500000), "-500.000 en el efectivo y +500.000 en el Banco");

  console.log("== repartir lo «Sin asignar»");
  cuentas.actions["preparar-reparto"]();
  igual(state.formTransferencia.de, "sin-asignar", "«Repartir ahora» pone «Sin asignar» como origen");
  igual(state.formTransferencia.monto, "100000", "con todo su saldo");
  state.formTransferencia.a = "nequi";
  cuentas.actions["registrar-transferencia"]();
  igual(saldoDe("sin-asignar"), 0, "«Sin asignar» quedó en 0");
  igual(saldoDe("nequi"), 100000, "Nequi recibió el saldo inicial");
  igual(caja(), cajaAntes, "la Caja sigue igual");
  cuadra("tras repartir");

  console.log("== transferencias inválidas");
  const n = state.transferencias.length;
  state.formTransferencia = { de: "banco", a: "banco", monto: "10", fecha: "", nota: "" };
  cuentas.actions["registrar-transferencia"]();
  state.formTransferencia = { de: "banco", a: "nequi", monto: "0", fecha: "", nota: "" };
  cuentas.actions["registrar-transferencia"]();
  state.formTransferencia = { de: "banco", a: "inexistente", monto: "10", fecha: "", nota: "" };
  cuentas.actions["registrar-transferencia"]();
  state.formTransferencia = { de: "banco", a: "nequi", monto: "-5", fecha: "", nota: "" };
  cuentas.actions["registrar-transferencia"]();
  igual(state.transferencias.length, n, "misma cuenta, monto 0, cuenta inexistente o monto negativo: no se crea nada");
  igual(avisos.length, 4, "y cada una avisó por qué");
  cuadra("tras los intentos inválidos");

  console.log("== el DOM manda sobre el borrador");
  state.formTransferencia = { de: "banco", a: "nequi", monto: "1", fecha: "", nota: "" };
  camposDelDom = { "tr-de": "nequi", "tr-a": "efectivo", "tr-monto": "30000", "tr-fecha": "2026-10-06", "tr-nota": "  retiro  " };
  cuentas.actions["registrar-transferencia"]();
  camposDelDom = {};
  const ult = state.transferencias[0];
  ok(ult.de === "nequi" && ult.a === "efectivo" && ult.monto === 30000 && ult.nota === "retiro", "se guarda lo que el usuario veía en pantalla (nota sin espacios)");
  cuadra("tras una transferencia leída del DOM");

  console.log("== anular y restaurar");
  const efectivoAntes = saldoDe("efectivo"), nequiAntes = saldoDe("nequi");
  cuentas.actions["toggle-anular-transferencia"](fakeEl({ "data-id": ult.id }));
  ok(!!state.transferencias[0].anulada, "queda anulada (no se borra)");
  igual(saldoDe("efectivo"), efectivoAntes - 30000, "el efectivo vuelve a lo de antes");
  igual(saldoDe("nequi"), nequiAntes + 30000, "Nequi también");
  igual(state.transferencias.length, n + 1, "la transferencia anulada se conserva en la lista");
  igual(caja(), cajaAntes, "la Caja nunca se movió");
  cuadra("con una transferencia anulada");
  cuentas.actions["toggle-anular-transferencia"](fakeEl({ "data-id": ult.id }));
  ok(!state.transferencias[0].anulada, "se puede restaurar");
  igual(saldoDe("efectivo"), efectivoAntes, "y vuelve a contar");
  cuadra("tras restaurarla");

  console.log("== sacar de una cuenta más de lo que tiene avisa");
  let pregunto = 0; const confirmOriginal = window.confirm;
  window.confirm = (m) => { pregunto++; return false; };
  const antesNeg = state.transferencias.length;
  state.formTransferencia = { de: "nequi", a: "efectivo", monto: "99999999", fecha: "", nota: "" };
  cuentas.actions["registrar-transferencia"]();
  igual(pregunto, 1, "pide confirmación cuando la cuenta quedaría en negativo");
  igual(state.transferencias.length, antesNeg, "y si el dueño dice que no, no se registra");
  window.confirm = confirmOriginal;
}

// ======================= 9. Conciliación =======================
{
  console.log("== conciliar el Banco contra el extracto");
  reiniciar();
  state.tx = [
    { id: "b1", tipo: "ingreso", fecha: "2026-10-01", concepto: "Abono Ana", monto: 1000000, cuenta: "banco" },
    { id: "b2", tipo: "gasto", fecha: "2026-10-03", concepto: "Tela", monto: 200000, cuenta: "banco" },
    { id: "b3", tipo: "ingreso", fecha: "2026-10-20", concepto: "Abono posterior", monto: 300000, cuenta: "banco" },
    { id: "b4", tipo: "gasto", fecha: "2026-10-10", concepto: "Cheque sin cobrar", monto: 50000, cuenta: "banco" },
    { id: "e1", tipo: "ingreso", fecha: "2026-10-04", concepto: "Efectivo", monto: 700000, cuenta: "efectivo" }
  ];
  state.transferencias = [{ id: "tr1", fecha: "2026-10-05", de: "efectivo", a: "banco", monto: 500000, nota: "Consignación", anulada: "", conciliadoDe: "", conciliadoA: "" }];
  cuadra("punto de partida de la conciliación");
  igual(saldoDe("banco"), 1000000 - 200000 + 300000 - 50000 + 500000, "el Banco tiene 1.550.000 en total");
  igual(saldoDe("efectivo"), 200000, "y el efectivo 200.000");

  let r = calc.calcConciliacion("banco", "2026-10-15", "");
  igual(r.saldoCalculado, 1250000, "al 15 de octubre la app calcula 1.250.000 (sin el abono del 20)");
  ok(!r.tieneExtracto && r.diferencia === 0, "sin saldo del extracto no hay diferencia que mostrar");
  igual(r.asientos.length, 4, "y 4 movimientos hasta esa fecha (3 + la punta de la transferencia)");
  igual(r.asientos[0].fecha, "2026-10-10", "ordenados del más reciente al más viejo");

  r = calc.calcConciliacion("banco", "2026-10-15", "1300000");
  ok(r.tieneExtracto, "con saldo del extracto");
  igual(r.diferencia, 50000, "el extracto tiene 50.000 más que la app");
  igual(r.conciliado, 0, "nada marcado todavía");
  igual(r.sinMarcar, 4, "4 por revisar");

  // El dueño marca lo que ve en el extracto: todo menos el cheque sin cobrar.
  cuentas.actions["toggle-conciliado"](marca(true, { "data-clave": "tx:b1" }));
  cuentas.actions["toggle-conciliado"](marca(true, { "data-clave": "tx:b2" }));
  cuentas.actions["toggle-conciliado"](marca(true, { "data-clave": "tr:tr1:a" }));
  ok(state.tx.filter(t => t.id === "b1")[0].conciliadoEn !== "", "el movimiento queda marcado con su fecha");
  igual(state.transferencias[0].conciliadoA, state.tx.filter(t => t.id === "b1")[0].conciliadoEn, "la punta de la transferencia también (conciliadoA)");
  igual(state.transferencias[0].conciliadoDe, "", "la otra punta (la del efectivo) NO: cada cuenta tiene su extracto");
  r = calc.calcConciliacion("banco", "2026-10-15", "1300000");
  igual(r.conciliado, 1300000, "marcados suman 1.300.000");
  igual(r.sinMarcar, 1, "queda 1 por revisar...");
  igual(r.sinConciliar, -50000, "...que suma -50.000: el cheque sin cobrar");
  igual(r.faltaEnApp, 0, "el extracto no tiene nada que la app no tenga");
  igual(r.faltaEnApp - r.sinConciliar, r.diferencia, "la diferencia se explica: lo que falta en la app − lo que sobra en la app");
  igual(r.diferencia, 50000, "...50.000, justo el cheque");

  // Y de verdad: si el cheque se cobra (o se descarta), la diferencia es 0.
  state.formConciliacion = { cuenta: "banco", fecha: "2026-10-15", saldo: "1250000", ver: "pendientes" };
  cuentas.actions["toggle-conciliado"](marca(true, { "data-clave": "tx:b4" }));
  r = calc.calcConciliacion("banco", "2026-10-15", "1250000");
  igual(r.diferencia, 0, "con el saldo que de verdad dice el extracto la diferencia es 0");
  igual(r.sinMarcar, 0, "y todo marcado");

  // El efectivo no se ve afectado por las marcas del banco.
  const re = calc.calcConciliacion("efectivo", "2026-10-31", "200000");
  igual(re.diferencia, 0, "el efectivo cuadra al peso con su conteo");
  igual(re.conciliado, 0, "sin marcas del banco");
  // Desmarcar.
  cuentas.actions["toggle-conciliado"](marca(false, { "data-clave": "tx:b4" }));
  igual(state.tx.filter(t => t.id === "b4")[0].conciliadoEn, "", "desmarcar quita la marca");
  cuentas.actions["toggle-conciliado"](marca(false, { "data-clave": "tr:tr1:a" }));
  igual(state.transferencias[0].conciliadoA, "", "también en la transferencia");
  igual(state.tx.length, 5, "marcar/desmarcar no crea ni borra movimientos");
  cuadra("la conciliación no toca saldos");
  igual(caja(), 1000000 - 200000 + 300000 - 50000 + 700000, "ni la Caja");

  console.log("== guardar la conciliación");
  state.formConciliacion = { cuenta: "banco", fecha: "2026-10-15", saldo: "1300000", ver: "pendientes" };
  cuentas.actions["guardar-conciliacion"]();
  const g = state.config.conciliaciones.banco;
  ok(g && g.fecha === "2026-10-15" && g.saldoExtracto === 1300000 && g.saldoCalculado === 1250000 && g.diferencia === 50000, "queda la última conciliación del Banco (extracto, calculado y diferencia)");
  state.formConciliacion = { cuenta: "banco", fecha: "2026-10-15", saldo: "", ver: "pendientes" };
  const n0 = avisos.length;
  cuentas.actions["guardar-conciliacion"]();
  igual(avisos.length, n0 + 1, "sin saldo del extracto no guarda y avisa");

  console.log("== la pantalla de conciliación");
  state.finanzasVista = "cuentas";
  state.formConciliacion = { cuenta: "banco", fecha: "2026-10-15", saldo: "1300000", ver: "todos" };
  const html = fin.render();
  ok(html.indexOf("Conciliar con el extracto") !== -1, "tiene su sección");
  ok(html.indexOf("$1.250.000") !== -1 && html.indexOf("$1.300.000") !== -1, "muestra el saldo de la app y el del extracto");
  ok(html.indexOf("+$50.000") !== -1, "y la diferencia con signo");
  ok(html.indexOf("Transferencia desde Efectivo — Consignación") !== -1, "la transferencia aparece con su descripción");
  ok(html.indexOf('data-clave="tx:b1"') !== -1 && html.indexOf('data-clave="tr:tr1:a"') !== -1, "cada asiento tiene su casilla");
  ok(html.indexOf("Abono posterior") === -1, "lo posterior a la fecha del extracto no sale");
  state.formConciliacion.ver = "pendientes";
  const htmlPend = fin.render();
  ok(htmlPend.indexOf('data-clave="tx:b1"') === -1 && htmlPend.indexOf('data-clave="tx:b4"') !== -1, "«Solo sin marcar» esconde lo ya conciliado (b1) y deja lo que falta por revisar (b4)");
}

// ======================= 10. Pantallas: Resumen, Cuentas, Configuración =======================
{
  console.log("== Resumen y la pestaña Cuentas");
  reiniciar();
  igual(cuentas.renderCuentasResumen(), "", "sin movimientos, Resumen no muestra tarjetas de cuentas");
  state.tx = [
    { id: "x1", tipo: "ingreso", fecha: "2026-10-01", concepto: "Abono", monto: 900000, cuenta: "banco" },
    { id: "x2", tipo: "gasto", fecha: "2026-10-02", concepto: "Gasto", monto: 100000, cuenta: "sin-asignar" },
    { id: "x3", tipo: "ingreso", fecha: "2026-10-03", concepto: "Efectivo", monto: 50000, cuenta: "efectivo" }
  ];
  const hr = cuentas.renderCuentasResumen();
  ok(hr.indexOf("Banco") !== -1 && hr.indexOf("$900.000") !== -1, "Resumen muestra el saldo del Banco");
  ok(hr.indexOf("Sin asignar") !== -1 && hr.indexOf("$-100.000") !== -1, "y el de «Sin asignar»");
  ok(hr.indexOf("coinciden") !== -1 && hr.indexOf("$850.000") !== -1, "y dice que suman la Caja actual ($850.000)");
  ok(hr.indexOf('data-action="ir-a-cuentas"') !== -1, "cada tarjeta lleva a la pestaña Cuentas");
  state.tab = "resumen"; state.finanzasVista = "nuevo";
  cuentas.actions["ir-a-cuentas"](fakeEl({ "data-cuenta": "banco" }));
  ok(state.tab === "finanzas" && state.finanzasVista === "cuentas" && state.formConciliacion.cuenta === "banco", "tocar una tarjeta abre Finanzas → Cuentas con esa cuenta lista para conciliar");
  const hc = fin.render();
  ok(hc.indexOf("🏦 Cuentas") !== -1, "la pestaña «Cuentas» está en Finanzas");
  ok(hc.indexOf("Saldo por cuenta") !== -1 && hc.indexOf("Pasar plata de una cuenta a otra") !== -1 && hc.indexOf("Movimientos sin cuenta (1)") !== -1, "tiene saldos, transferencia y los movimientos sin cuenta");
  ok(hc.indexOf("Repartir ahora") !== -1, "y ofrece repartir lo «Sin asignar»");
  cuentas.actions["asignar-cuenta-tx"](fakeEl({ "data-id": "x2" }, "efectivo"));
  igual(state.tx.filter(t => t.id === "x2")[0].cuenta, "efectivo", "asignar la cuenta a un movimiento sin cuenta");
  igual(saldoDe("sin-asignar"), 0, "«Sin asignar» queda en 0");
  ok(saldos().cuentas.every(c => c.id !== "sin-asignar"), "y desaparece de la lista: ya no tiene ningún movimiento");
  const htmlResumenCompleto = resumen.render();
  ok(htmlResumenCompleto.indexOf("Caja por cuenta") !== -1 && htmlResumenCompleto.indexOf("Caja actual") !== -1, "la pantalla Resumen muestra «Caja por cuenta» junto a «Caja actual»");
  cuentas.actions["asignar-cuenta-tx"](fakeEl({ "data-id": "x2" }, "fantasma"));
  igual(state.tx.filter(t => t.id === "x2")[0].cuenta, "efectivo", "una cuenta inexistente no se asigna");
  cuadra("tras asignar");

  console.log("== escapar nombres");
  state.config.cuentas = [{ id: "z", nombre: '<img src=x onerror=alert(1)>' }];
  state.tx = [{ id: "x9", tipo: "ingreso", fecha: "2026-10-01", concepto: "A", monto: 1, cuenta: "z" }];
  const hz = cuentas.renderCuentasResumen() + fin.render() + cuentas.renderConfigCuentas();
  ok(hz.indexOf("<img src=x") === -1 && hz.indexOf("&lt;img") !== -1, "un nombre de cuenta con HTML se escapa en todas las pantallas");
  const opciones = comp.renderCuentaSelectOptions("z");
  ok(opciones.indexOf("<img") === -1, "...y en el selector compartido");

  console.log("== Configuración → Cuentas");
  reiniciar();
  state.tx = [{ id: "u1", tipo: "ingreso", fecha: "2026-10-01", concepto: "A", monto: 5, cuenta: "banco" }];
  const hcfg = cfgMod.render();
  ok(hcfg.indexOf(">Cuentas<") !== -1 && hcfg.indexOf('data-action="agregar-cuenta"') !== -1, "Configuración tiene la sección «Cuentas»");
  ok(hcfg.indexOf("Los pagos que la app registra sola caen en") !== -1, "y la cuenta predeterminada");
  ok(hcfg.indexOf("🔒") !== -1 && hcfg.indexOf("🗑") !== -1, "las cuentas con movimientos se marcan 🔒 y las libres 🗑");

  camposDelDom = { "inp-cuenta-nueva": "  Daviplata " };
  cuentas.actions["agregar-cuenta"]();
  igual(calc.calcCuentasConfig().length, 4, "se agregó una cuenta");
  igual(calc.calcCuentasConfig()[3].nombre, "Daviplata", "con el nombre sin espacios sobrantes");
  const nuevaId = calc.calcCuentasConfig()[3].id;
  camposDelDom = { "inp-cuenta-nueva": "daviplata" };
  cuentas.actions["agregar-cuenta"]();
  igual(calc.calcCuentasConfig().length, 4, "un nombre repetido (aunque cambie la mayúscula) no se agrega");
  camposDelDom = { "inp-cuenta-nueva": "Sin asignar" };
  cuentas.actions["agregar-cuenta"]();
  igual(calc.calcCuentasConfig().length, 4, "«Sin asignar» no se puede usar como nombre");
  camposDelDom = { "inp-cuenta-nueva": "   " };
  cuentas.actions["agregar-cuenta"]();
  igual(calc.calcCuentasConfig().length, 4, "un nombre vacío tampoco");
  camposDelDom = {};
  igual(avisos.length, 3, "cada rechazo avisa por qué");

  cuentas.actions["renombrar-cuenta"](fakeEl({ "data-id": "banco" }, "Bancolombia"));
  igual(calc.nombreCuenta("banco"), "Bancolombia", "renombrar una cuenta");
  igual(state.tx[0].cuenta, "banco", "...no toca sus movimientos (el id es el mismo)");
  igual(saldoDe("banco"), 5, "...ni su saldo");
  cuentas.actions["renombrar-cuenta"](fakeEl({ "data-id": "banco" }, "Efectivo"));
  igual(calc.nombreCuenta("banco"), "Bancolombia", "no se renombra con el nombre de otra cuenta");

  cuentas.actions["quitar-cuenta"](fakeEl({ "data-id": "banco" }));
  ok(calc.existeCuenta("banco"), "una cuenta con movimientos NO se borra");
  igual(avisos[avisos.length - 1].indexOf("no se puede borrar") !== -1, true, "y dice por qué");
  state.config.cuentaPredeterminada = nuevaId;
  cuentas.actions["quitar-cuenta"](fakeEl({ "data-id": nuevaId }));
  ok(calc.existeCuenta(nuevaId), "la cuenta predeterminada tampoco");
  cuentas.actions["set-cuenta-predeterminada"](fakeEl({}, ""));
  igual(state.config.cuentaPredeterminada, "", "se puede dejar la predeterminada en «Sin asignar»");
  cuentas.actions["quitar-cuenta"](fakeEl({ "data-id": nuevaId }));
  ok(!calc.existeCuenta(nuevaId), "una cuenta sin uso sí se borra");
  state.transferencias = [{ id: "tq", fecha: "2026-10-01", de: "nequi", a: "efectivo", monto: 1, nota: "", anulada: "2026-10-02" }];
  cuentas.actions["quitar-cuenta"](fakeEl({ "data-id": "nequi" }));
  ok(calc.existeCuenta("nequi"), "una cuenta con una transferencia (aunque esté anulada) tampoco se borra");

  console.log("== una cuenta que desaparece de la lista no hace desaparecer su plata");
  state.config.cuentas = [{ id: "efectivo", nombre: "Efectivo" }];
  const sf = saldos();
  ok(sf.cuentas.some(c => c.id === "banco" && c.huerfana && c.saldo === 5), "el saldo de «banco» sigue a la vista como «Cuenta eliminada»");
  ok(sf.cuadra, "y las cuentas siguen sumando la Caja");
}

// ======================= 11. Caja == suma de cuentas, siempre =======================
{
  console.log("== propiedad: tras cualquier secuencia de operaciones, suma de cuentas = Caja");
  reiniciar();
  let semilla = 20261029;
  const rnd = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ids = ["efectivo", "banco", "nequi", "sin-asignar"];
  const tipos = ["ingreso", "gasto", "nomina", "comision"];
  // Un negocio con historia: 80 movimientos anteriores a las cuentas.
  state.tx = Array.from({ length: 80 }, (_, i) => ({ id: "h" + i, tipo: pick(tipos), fecha: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), concepto: "Hist " + i, monto: 1000 * (1 + Math.floor(rnd() * 500)) }));
  const cajaInicial = caja(), resumenInicial = resumenMov();
  state.tx = calc.migrarCuentasMovimientos(state.tx).tx;
  igual(caja(), cajaInicial, "ANTES y DESPUÉS de migrar 80 movimientos la Caja es la misma (" + cajaInicial + ")");
  igual(resumenMov(), resumenInicial, "y el reporte también");
  igual(saldos().total, cajaInicial, "suma de cuentas antes de repartir = Caja");
  let todoCuadra = true, pasos = 0;
  const revisar = () => { pasos++; const s = saldos(); if (!s.cuadra || Math.abs(s.total - caja()) > 0.005) { todoCuadra = false; console.log("  X no cuadra en el paso " + pasos + ": " + s.total + " vs " + caja()); } };
  for (let i = 0; i < 300; i++) {
    const op = Math.floor(rnd() * 6);
    if (op === 0) state.tx.unshift({ id: "n" + i, tipo: pick(tipos), fecha: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), concepto: "N " + i, monto: 1 + Math.floor(rnd() * 900000), cuenta: pick(ids) });
    else if (op === 1 && state.tx.length) cuentas.actions["asignar-cuenta-tx"](fakeEl({ "data-id": pick(state.tx).id }, pick(ids.filter(x => x !== "sin-asignar"))));
    else if (op === 2) { state.formTransferencia = { de: pick(ids), a: pick(ids), monto: String(1 + Math.floor(rnd() * 500000)), fecha: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), nota: "" }; cuentas.actions["registrar-transferencia"](); }
    else if (op === 3 && state.transferencias.length) cuentas.actions["toggle-anular-transferencia"](fakeEl({ "data-id": pick(state.transferencias).id }));
    else if (op === 4 && state.tx.length) state.tx.splice(Math.floor(rnd() * state.tx.length), 1);
    else if (op === 5 && state.tx.length) { const t = pick(state.tx); cuentas.actions["toggle-conciliado"](marca(rnd() < 0.5, { "data-clave": "tx:" + t.id })); }
    revisar();
  }
  ok(todoCuadra, "en los 300 pasos aleatorios (movimientos, asignaciones, transferencias, anulaciones, borrados, marcas) las cuentas SIEMPRE sumaron la Caja");
  ok(state.transferencias.length > 20, "(se hicieron " + state.transferencias.length + " transferencias en la prueba)");
  igual(JSON.stringify(calc.calcResumenMovimientos(state.tx.filter(t => t.id.indexOf("n") === 0 || t.id.indexOf("h") === 0))), JSON.stringify(calc.calcResumenMovimientos(state.tx)), "las transferencias nunca entraron a los reportes (no están en state.tx)");
}

console.log("");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de cuentas y conciliación");
process.exit(fallos ? 1 : 0);
