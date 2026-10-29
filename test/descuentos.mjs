// Descuentos (Hallazgo #61): por ítem y por toda la orden, en cotizaciones y
// pedidos. Cubre los cálculos (core/calc.js), la conversión cotización →
// pedido, los formularios, el editor de un pedido ya creado y lo que se
// imprime en los PDFs. También el redondeo a pesos enteros del IVA y la
// comisión (Hallazgo #62), que va aquí porque los descuentos hacen que los
// totales dejen de ser redondos.
//
// Se corre solo, aparte de smoke.mjs:   node test/descuentos.mjs
//
// No necesita jsdom: se stubean los pocos globales que store.js toca al
// importarse, y un jsPDF falso anota cada texto y cada tabla que el PDF
// imprimiría — así se comprueban los montos que le llegan al cliente.

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] || null, get length() { return m.size; } }; };
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], remove: noop });
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { getElementById: () => null, createElement: el, addEventListener: noop, dispatchEvent: noop, querySelector: () => null, querySelectorAll: () => [], body: el(), documentElement: el(), head: el(), visibilityState: "visible" };
globalThis.window = Object.assign(globalThis.window || {}, { localStorage, sessionStorage, document, addEventListener: noop, removeEventListener: noop, location: { href: "http://localhost/", search: "", hash: "" }, matchMedia: () => ({ matches: false, addEventListener: noop }), confirm: () => true, alert: noop });
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.confirm = () => true; globalThis.alert = noop;

// --- jsPDF falso: anota cada texto y cada tabla ---
const impreso = [];   // { t, x, y }
const tablas = [];    // opciones de cada autoTable
function crearDoc() {
  const doc = {
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 }, getNumberOfPages: () => 1 },
    lastAutoTable: { finalY: 300 },
    text(t, x, y) { impreso.push({ t: Array.isArray(t) ? t.join(" ") : String(t), x: x, y: y }); return doc; },
    autoTable(o) { tablas.push(o); doc.lastAutoTable = { finalY: 300 }; return doc; },
    getTextWidth: () => 50, splitTextToSize: (t) => [String(t)], getNumberOfPages: () => 1,
    output: () => new ArrayBuffer(0), save: noop
  };
  return new Proxy(doc, { get(t, p) { return p in t ? t[p] : (() => doc); } });
}
globalThis.window.jspdf = { jsPDF: function () { return crearDoc(); } };

const R = new URL("../js/", import.meta.url).href;
const calc = await import(R + "core/calc.js");
const { state } = await import(R + "core/store.js");
const cots = await import(R + "modules/cotizaciones.js");
const ped = await import(R + "modules/pedidos.js");
const pdf = await import(R + "core/pdf.js");

let fallos = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallos++; console.log("  X FALLA: " + msg); } else console.log("  ok " + msg); }
function igual(a, b, msg) { ok(a === b, msg + "  (obtuvo " + a + ", esperaba " + b + ")"); }
const fakeEl = (attrs, value) => ({ value: value, checked: false, getAttribute: k => (k in attrs ? attrs[k] : null) });
const textos = () => impreso.map(i => i.t);
const hay = (s) => impreso.some(i => i.t.indexOf(s) !== -1);

// ======================= 1. Cálculos puros =======================
{
console.log("== calcMontoDescuento");
igual(calc.calcMontoDescuento({ tipo: "porcentaje", valor: 10 }, 100000), 10000, "10% de 100.000");
igual(calc.calcMontoDescuento({ tipo: "fijo", valor: 5000 }, 100000), 5000, "$5.000 fijo");
igual(calc.calcMontoDescuento({ tipo: "fijo", valor: 999999 }, 100000), 100000, "fijo mayor al valor se topa");
igual(calc.calcMontoDescuento({ tipo: "porcentaje", valor: 150 }, 100000), 100000, "porcentaje >100 se topa");
igual(calc.calcMontoDescuento(null, 100000), 0, "sin descuento");
igual(calc.calcMontoDescuento({ tipo: "porcentaje", valor: 7.5 }, 33333), 2500, "redondea a pesos (7.5% de 33.333)");
igual(calc.calcMontoDescuento({ tipo: "fijo", valor: -5 }, 1000), 0, "valor negativo no cuenta");

console.log("== calcTotalesLineasPedido (pedido rápido)");
const lineas = [
  { id: "a", cantidad: 3, precioUnitario: 50000, costoUnitario: 30000 },                                  // 150.000
  { id: "b", cantidad: 2, precioUnitario: 40000, costoUnitario: 20000, descuento: { tipo: "porcentaje", valor: 10 } } // 80.000 - 8.000
];
let t = calc.calcTotalesLineasPedido(lineas, null);
igual(t.precioBruto, 230000, "bruto");
igual(t.descuentoItems, 8000, "descuento de ítems");
igual(t.precioTotal, 222000, "total con descuento de línea");
t = calc.calcTotalesLineasPedido(lineas, { tipo: "porcentaje", valor: 5 });
igual(t.subtotal, 222000, "subtotal tras ítems");
igual(t.descuentoOrden, 11100, "5% de la orden sobre 222.000");
igual(t.precioTotal, 210900, "total con ambos");
igual(t.gananciaTotal, 210900 - (3 * 30000 + 2 * 20000), "ganancia sobre el total rebajado");
t = calc.calcTotalesLineasPedido(lineas.map(l => ({ ...l, descuento: undefined })), undefined);
igual(t.precioTotal, 230000, "sin descuentos = el número de siempre");
igual(t.descuento, 0, "descuento 0");

console.log("== calcDesglosePedido + IVA + saldo");
let p = { id: "p1", total: 210900, abono: 100000, lineas, descuento: { tipo: "porcentaje", valor: 5 }, iva: { activo: true, porcentaje: 19 } };
let d = calc.calcDesglosePedido(p);
igual(d.bruto, 230000, "bruto = total + descuento");
igual(d.descuento, 19100, "descuento total (8.000 + 11.100)");
igual(Math.round(calc.calcIvaPedido(p)), Math.round(210900 * 0.19), "IVA sobre el valor rebajado");
igual(Math.round(calc.calcSaldoPedido(p)), Math.round(210900 * 1.19 - 100000), "saldo con IVA sobre lo rebajado");
d = calc.calcDesglosePedido({ id: "viejo", total: 500000, lineas: [{ cantidad: 1, precioUnitario: 500000 }] });
igual(d.descuento, 0, "pedido viejo: descuento 0");
igual(d.bruto, 500000, "pedido viejo: bruto = total");
d = calc.calcDesglosePedido({ id: "sinlineas", total: 120000 });
igual(d.descuento, 0, "pedido sin líneas: descuento 0");
d = calc.calcDesglosePedido({ id: "cons", total: 0, consignacion: {}, lineas, descuento: { tipo: "porcentaje", valor: 50 } });
igual(d.descuento, 0, "consignación no lleva descuento");

console.log("== reparto por línea (reportes) suma el total");
const netos = calc.calcNetoLineasPedido(p);
igual(netos.reduce((a, b) => a + b, 0), 210900, "suma de netos por línea = total del pedido");

console.log("== comisión del vendedor: base con descuento");
let pc = { id: "pc", total: 0, vendedor: { nombre: "Ana", tipo: "porcentaje", valor: 10 }, descuento: { tipo: "porcentaje", valor: 10 },
  lineas: [
    { cantidad: 10, precioUnitario: 20000, costoUnitario: 8000 },                                       // prendas 200.000
    { cantidad: 1, precioUnitario: 100000, costoUnitario: 20000, esServicioCobrado: true }              // servicio 100.000
  ] };
const tl = calc.calcTotalesLineasPedido(pc.lineas, pc.descuento);
pc.total = tl.precioTotal;
igual(pc.total, 270000, "total = 300.000 - 10%");
igual(calc.calcBaseComision(pc), 180000, "base de comisión = prendas rebajadas (200.000 - 10%)");
igual(calc.calcComisionValor(pc), 18000, "comisión 10% sobre 180.000");
let pSin = { id: "ps", total: 300000, vendedor: { nombre: "Ana", tipo: "porcentaje", valor: 10 }, lineas: pc.lineas };
igual(calc.calcBaseComision(pSin), 200000, "sin descuento la base es la de siempre");

console.log("== cotización");
const ref = { id: "r1", nombre: "Camiseta", cantidadPedida: 10, precioVenta: 20000, insumos: [], detalle: [] };
let cot = { id: "c1", referencias: [ref], costosGlobales: [], serviciosCobrados: [{ id: "s1", nombre: "Diseño", precio: 100000, costo: 20000 }], iva: { activo: false, porcentaje: 19 } };
let tot = calc.calcCotizacionTotales(cot);
igual(tot.precioTotal, 300000, "sin descuento: 200.000 + 100.000");
igual(tot.precioBruto, 300000, "bruto");
igual(tot.descuento, 0, "descuento 0");
cot = { ...cot, referencias: [{ ...ref, descuento: { tipo: "porcentaje", valor: 10 } }], descuento: { tipo: "fijo", valor: 30000 } };
tot = calc.calcCotizacionTotales(cot);
igual(tot.descuentoItems, 20000, "descuento de la referencia (10% de 200.000)");
igual(tot.descuentoOrden, 30000, "descuento de la orden");
igual(tot.precioTotal, 300000 - 20000 - 30000, "precio total");
igual(tot.gananciaTotal, tot.precioTotal - tot.costoTotal, "ganancia = precio - costo");
// El pedido que sale de esa cotización: misma base de comisión
const ped = {
  total: tot.precioTotal, descuento: cot.descuento,
  lineas: [
    { cantidad: 6, precioUnitario: 20000, descuento: { tipo: "fijo", valor: 12000 } },
    { cantidad: 4, precioUnitario: 20000, descuento: { tipo: "fijo", valor: 8000 } },
    { cantidad: 1, precioUnitario: 100000, esServicioCobrado: true }
  ]
};
igual(calc.calcDesglosePedido(ped).descuento, tot.descuento, "el pedido explica el mismo descuento que la cotización");
cot.vendedor = { nombre: "Ana", tipo: "porcentaje", valor: 10 };
ped.vendedor = cot.vendedor;
igual(calc.calcBaseComision(ped), tot.precioPrendas, "base de comisión idéntica en cotización y pedido");
igual(calc.calcComisionValor(ped), calc.calcComisionValorCot(cot), "comisión idéntica al convertir");

console.log("== calcTotalConDescuentos (pedido ya creado)");
const lineasLista = lineas.map(l => ({ ...l, descuento: undefined })); // las mismas líneas, a precio de lista
const orig = { id: "x", total: 230000, lineas: lineasLista, abono: 0 };
const lineasConDescB = lineasLista.map(l => l.id === "b" ? { ...l, descuento: { tipo: "porcentaje", valor: 10 } } : l);
let nuevo = calc.calcTotalConDescuentos(orig, lineasConDescB, { tipo: "porcentaje", valor: 10 });
igual(nuevo.total, 230000 - 8000 - Math.round(222000 * 0.10), "aplicar descuento (línea + orden) a un pedido sin descuento");
igual(nuevo.bruto, 230000, "conserva el valor de lista");
const conDesc = { ...orig, total: nuevo.total, lineas: lineasConDescB, descuento: { tipo: "porcentaje", valor: 10 } };
igual(calc.calcDesglosePedido(conDesc).descuento, 30200, "el pedido guardado explica sus 30.200 de descuento");
const sinDesc = calc.calcTotalConDescuentos(conDesc, lineasLista, null);
igual(sinDesc.total, 230000, "quitar los descuentos devuelve el precio de lista");
const cambiado = calc.calcTotalConDescuentos(conDesc, lineasLista, { tipo: "fijo", valor: 10000 });
igual(cambiado.total, 220000, "cambiar el descuento de un pedido que ya tenía uno");

console.log("== descuentoDesdeForm / parchearDescuento");
igual(calc.descuentoDesdeForm("porcentaje", "", ""), null, "vacío = sin descuento");
igual(calc.descuentoDesdeForm("fijo", "0", ""), null, "0 = sin descuento");
igual(JSON.stringify(calc.descuentoDesdeForm("porcentaje", "250", "x")), JSON.stringify({ tipo: "porcentaje", valor: 100, motivo: "x" }), "porcentaje se topa en 100");
igual(calc.parchearDescuento(null, "descuentoValor", "12").valor, 12, "parchear valor");
igual(calc.parchearDescuento({ tipo: "fijo", valor: 5 }, "descuentoTipo", "porcentaje").tipo, "porcentaje", "parchear tipo");

}

// ======================= 2. Conversión, formulario y editor de pedido =======================
{
console.log("== cotización con tallas, descuento por referencia y por orden → pedido");
const cot = {
  id: "c1", cliente: "Club", descripcion: "Uniformes", estado: "borrador", pedidoId: "p1",
  referencias: [
    { id: "r1", nombre: "Camiseta", cantidadPedida: 10, precioVenta: 20000, insumos: [], descuento: { tipo: "porcentaje", valor: 10 },
      detalle: [{ talla: "S" }, { talla: "S" }, { talla: "M" }, { talla: "M" }, { talla: "M" }, { talla: "L" }, { talla: "L" }, { talla: "L" }, { talla: "L" }, { talla: "L" }] },
    { id: "r2", nombre: "Short", cantidadPedida: 7, precioVenta: 15000, insumos: [], detalle: [] }
  ],
  costosGlobales: [{ id: "g1", nombre: "Domicilio", costo: 30000 }],
  serviciosCobrados: [{ id: "s1", nombre: "Diseño", precio: 100000, costo: 20000, descuento: { tipo: "fijo", valor: 10000 } }],
  iva: { activo: true, porcentaje: 19 },
  descuento: { tipo: "porcentaje", valor: 5, motivo: "cliente frecuente" },
  vendedor: { nombre: "Ana", tipo: "porcentaje", valor: 10, estado: "pendiente" }
};
const tot = calc.calcCotizacionTotales(cot);
// refs: 200.000-20.000=180.000 ; short 105.000 ; servicio 100.000-10.000 = 90.000 ; subtotal 375.000 ; orden 5% = 18.750
igual(tot.descuentoItems, 30000, "descuento por ítems (20.000 + 10.000)");
igual(tot.descuentoOrden, 18750, "descuento de la orden: 5% de 375.000");
igual(tot.precioTotal, 356250, "precio total de la cotización");

state.cotizaciones = [cot];
state.pedidos = [{ id: "p1", total: 0, costo: 0, cantidad: "0", abono: 0, abonos: [], cotizacionId: "c1", vendedor: cot.vendedor, iva: cot.iva, lineas: [], numeroOp: "OP-1", cliente: "Club", descripcion: "x" }];
const desfase = cots.calcDesfaseCotizacionPedido(cot);
ok(desfase && desfase.datos, "hay desfase inicial (el pedido está en 0) y trae los datos que heredaría");
const datos = desfase.datos;
let p1 = Object.assign({}, state.pedidos[0], datos);
igual(p1.total, tot.precioTotal, "el pedido hereda el total ya rebajado");
igual(calc.calcDesglosePedido(p1).descuento, tot.descuento, "el pedido explica el mismo descuento (" + tot.descuento + ")");
igual(calc.calcDesglosePedido(p1).bruto, tot.precioBruto, "y el mismo valor de lista (" + tot.precioBruto + ")");
igual(p1.descuento && p1.descuento.motivo, "cliente frecuente", "el motivo viaja al pedido");
const lineasCamiseta = p1.lineas.filter(l => l.refId === "r1");
igual(lineasCamiseta.length, 3, "la camiseta se parte en 3 líneas (S, M, L)");
igual(lineasCamiseta.reduce((a, l) => a + (l.descuento ? l.descuento.valor : 0), 0), 20000, "los descuentos de las líneas suman el de la referencia (sin perder un peso)");
igual(lineasCamiseta[0].precioUnitario, 20000, "las líneas llevan el precio de LISTA");
igual(lineasCamiseta[0].descuento.porcentajeOrigen, 10, "recuerdan que venía en 10 %");
const lineaServ = p1.lineas.filter(l => l.esServicioCobrado)[0];
igual(lineaServ.descuento && lineaServ.descuento.valor, 10000, "el servicio conserva su descuento");
igual(calc.calcBaseComision(p1), tot.precioPrendas, "misma base de comisión que la cotización");
igual(calc.calcComisionValor(p1), calc.calcComisionValorCot(cot), "misma comisión que la cotización");
igual(calc.calcNetoLineasPedido(p1).reduce((a, b) => a + b, 0), p1.total, "reportes: la suma de las líneas es el total del pedido");
state.pedidos = [p1];
igual(cots.calcDesfaseCotizacionPedido(cot), null, "ya sincronizado: no hay desfase");
// Cambiar solo el descuento de la orden mueve el desfase
const cot2 = Object.assign({}, cot, { descuento: { tipo: "porcentaje", valor: 10 } });
state.cotizaciones = [cot2];
const d2 = cots.calcDesfaseCotizacionPedido(cot2);
ok(d2 && d2.difDescuento !== 0, "cambiar el descuento de la orden hace que el pedido se entere (difDescuento " + (d2 && d2.difDescuento) + ")");
state.cotizaciones = [cot];

console.log("== pedido rápido: formulario");
state.tab = "pedidos"; state.pedidosVista = "nueva";
state.formPedido.cliente = "Ana";
state.formPedido.lineas = [
  { id: "l1", tipo: "libre", productoNombre: "Bordado", talla: "", cantidad: 2, precioUnitario: 50000, costoUnitario: 20000, observacion: "", campos: [] },
  { id: "l2", tipo: "libre", productoNombre: "Gorra", talla: "", cantidad: 1, precioUnitario: 30000, costoUnitario: 10000, observacion: "", campos: [] }
];
ped.actions["set-pedido-linea-descuento"](fakeEl({ "data-linea": "l1", "data-campo": "descuentoValor" }, "10"));
igual(state.formPedido.lineas[0].descuento.valor, 10, "el descuento de la línea queda en el borrador");
ped.actions["set-form-pedido-campo"](fakeEl({ "data-campo": "descuentoValor" }, "5"));
ped.actions["set-form-pedido-campo"](fakeEl({ "data-campo": "descuentoMotivo" }, "pago de contado"));
let html = ped.render();
ok(html.indexOf("Descuento al total") !== -1, "el formulario muestra 'Descuento al total'");
ok(html.indexOf("descuento-campo") !== -1, "el formulario muestra los campos de descuento por línea");
ok(html.indexOf("A precio de lista") !== -1, "el resumen muestra 'A precio de lista' cuando hay descuento");
// 100.000 + 30.000 = 130.000 ; l1 10% = 10.000 ; subtotal 120.000 ; 5% = 6.000 ; total 114.000
ok(html.indexOf("114.000") !== -1, "el total del formulario es 114.000");
ok(html.indexOf("Subtotal $120.000") !== -1, "explica el subtotal tras los descuentos de línea");

console.log("== crear el pedido");
state.pedidos = []; state.clientes = state.clientes || [];
await ped.actions["add-pedido"]();
igual(state.pedidos.length, 1, "se creó el pedido");
const nuevo = state.pedidos[0];
igual(nuevo.total, 114000, "total guardado = 114.000 (ya rebajado)");
igual(nuevo.descuento && nuevo.descuento.valor, 5, "guarda el descuento al total");
igual(nuevo.descuento && nuevo.descuento.motivo, "pago de contado", "guarda el motivo");
igual(nuevo.lineas[0].descuento.valor, 10, "guarda el descuento de la línea");
ok(!nuevo.lineas[1].descuento, "la línea sin descuento no guarda uno");
igual(state.formPedido.descuentoValor, "", "el formulario se limpia");
igual(calc.calcSaldoPedido(nuevo), 114000, "saldo por cobrar = lo rebajado");
html = ped.render();
ok(true, "render del historial no revienta");

console.log("== pedido ya creado: editor de descuento");
state.pedidosVista = "historial";
state.pedidoPanelAbierto = { [nuevo.id]: true };
nuevo.abono = 50000; nuevo.abonos = [{ id: "a1", monto: 50000, fecha: "2026-10-29", metodoPago: "efectivo" }];
html = ped.render();
ok(html.indexOf("Cambiar el descuento") !== -1, "la tarjeta ofrece 'Cambiar el descuento'");
ok(html.indexOf("A precio de lista") !== -1 && html.indexOf("130.000") !== -1, "la tarjeta muestra el valor de lista");
ped.actions["abrir-descuento-pedido"](fakeEl({ "data-id": nuevo.id }));
igual(state.pedidoDescuentoEditando, nuevo.id, "abre el editor");
ped.actions["set-descuento-pedido-orden"](fakeEl({ "data-campo": "descuentoValor", "data-id": nuevo.id }, "20"));
html = ped.render();
ok(html.indexOf("Guardar descuento") !== -1, "el editor muestra 'Guardar descuento'");
ok(html.indexOf("Quitar los descuentos") !== -1, "y 'Quitar los descuentos' (ya tiene)");
// 130.000 - 10.000 (línea) = 120.000 ; 20% = 24.000 ; total 96.000
ok(html.indexOf("96.000") !== -1, "vista previa: nuevo total 96.000");
ped.actions["guardar-descuento-pedido"](fakeEl({ "data-id": nuevo.id }));
igual(state.pedidos[0].total, 96000, "guarda el nuevo total");
igual(state.pedidos[0].descuento.valor, 20, "guarda el nuevo descuento al total");
igual(state.pedidoDescuentoEditando, "", "cierra el editor");
igual(calc.calcSaldoPedido(state.pedidos[0]), 96000 - 50000, "el saldo respeta lo ya abonado");
// Quitar todo
ped.actions["quitar-descuentos-pedido"](fakeEl({ "data-id": nuevo.id }));
igual(state.pedidos[0].total, 130000, "quitar los descuentos vuelve al precio de lista");
ok(!state.pedidos[0].descuento, "sin descuento al total");
ok(!state.pedidos[0].lineas[0].descuento, "sin descuento en la línea");
// Descuento mayor a lo abonado → saldo a favor (con confirm)
ped.actions["abrir-descuento-pedido"](fakeEl({ "data-id": nuevo.id }));
ped.actions["set-descuento-pedido-orden"](fakeEl({ "data-campo": "descuentoValor", "data-id": nuevo.id }, "70"));
html = ped.render();
ok(html.indexOf("saldo a favor") !== -1, "avisa que el cliente ya abonó más que el nuevo total");
ped.actions["cerrar-descuento-pedido"]();

console.log("== un pedido que sigue a su cotización no se edita en el pedido");
state.cotizaciones = [Object.assign({}, cot, { pedidoId: "p-cot", estado: "convertida" })];
state.pedidos = [Object.assign({}, p1, { id: "p-cot", cotizacionId: "c1" })];
state.pedidoPanelAbierto = { "p-cot": true };
html = ped.render();
ok(html.indexOf("Abrir la cotización") !== -1 && html.indexOf("Aplicar un descuento") === -1 && html.indexOf("Cambiar el descuento") === -1, "ofrece abrir la cotización, no editar acá");

console.log("== duplicar: nace sin descuento");
state.cotizaciones = []; // sin cotización → camino del pedido rápido
const base = { id: "pd", total: 114000, abono: 0, cliente: "Ana", tipoCliente: "propio", numeroOp: "OP-9", descripcion: "x", cantidad: "3",
  descuento: { tipo: "porcentaje", valor: 5 }, lineas: [{ id: "q1", tipo: "libre", productoNombre: "Bordado", cantidad: 2, precioUnitario: 50000, costoUnitario: 20000, descuento: { tipo: "porcentaje", valor: 10 }, campos: [] }] };
state.pedidos = [base];
ped.actions["duplicar-pedido"](fakeEl({ "data-id": "pd" }));
ok(!state.formPedido.lineas[0].descuento, "las líneas del duplicado no traen descuento");
igual(state.formPedido.descuentoValor, "", "el duplicado no trae descuento al total");

console.log("== escalar a cotización conserva los descuentos");
state.cotizaciones = [];
state.pedidos = [Object.assign({}, base, { cotizacionId: undefined })];
state.cotizaciones = [];
ped.actions["escalar-a-cotizacion"](fakeEl({ "data-id": "pd" }));
const cotEsc = state.cotizaciones[0];
igual(cotEsc.descuento && cotEsc.descuento.valor, 5, "la cotización escalada trae el descuento al total");
igual(cotEsc.referencias[0].descuento && cotEsc.referencias[0].descuento.valor, 10, "y el de cada referencia");
igual(calc.calcCotizacionTotales(cotEsc).precioTotal, 85500, "el total de la cotización escalada = líneas (100.000 - 10%) - 5% de la orden");
igual(calc.calcCotizacionTotales(cotEsc).descuento, 14500, "y explica los mismos 14.500 de descuento");

}

// ======================= 3. Editor de cotización y PDFs =======================
{
function nuevaCot() {
  return {
    id: "c1", cliente: "Club", descripcion: "Uniformes", estado: "borrador", fecha: "2026-10-29", pedidoId: "", codigoPublico: "AB12",
    referencias: [
      { id: "r1", nombre: "Camiseta", cantidadPedida: 10, precioVenta: 20000, insumos: [], detalle: [], descuento: { tipo: "porcentaje", valor: 10 } },
      { id: "r2", nombre: "Short", cantidadPedida: 7, precioVenta: 15000, insumos: [], detalle: [] }
    ],
    costosGlobales: [], compras: [], gastosReales: [],
    serviciosCobrados: [{ id: "s1", nombre: "Diseño", precio: 100000, costo: 20000, descuento: { tipo: "fijo", valor: 10000 } }],
    iva: { activo: true, porcentaje: 19 }, descuento: { tipo: "porcentaje", valor: 5, motivo: "cliente frecuente" }
  };
}

console.log("== editor de cotización");
const cot = nuevaCot();
state.cotizaciones = [cot]; state.pedidos = [];
state.tab = "cotizaciones"; state.cotizacionesVista = "nueva"; state.cotizacionEditando = "c1";
let html = cots.render();
ok(html.indexOf("Descuento") !== -1, "el editor muestra 'Descuento'");
ok(html.indexOf('data-action-change="set-ref-descuento"') !== -1, "cada referencia tiene su campo de descuento");
ok(html.indexOf("cot-vendedor-compact") !== -1 && html.indexOf("toggle-cot-descuento") !== -1, "hay una línea de 'Descuento' al total (colapsada)");
ok(html.indexOf("al total: 5 %") !== -1, "la línea resume el descuento al total (5 %)");
ok(html.indexOf("ya con") !== -1, "las cifras grandes dicen que el precio ya viene con descuento");
state.cotTabActiva = { c1: "referencias" };
html = cots.render();
ok(html.indexOf('data-action-change="set-servicio-descuento"') !== -1, "el servicio cobrado tiene su campo de descuento");
ok(html.indexOf("precio-lista-tachado") !== -1, "la referencia con descuento muestra el precio de lista tachado");
cots.actions["toggle-cot-descuento"](fakeEl({ "data-id": "c1" }));
html = cots.render();
ok(html.indexOf('data-action-change="set-cot-descuento"') !== -1 && html.indexOf("Motivo (opcional)") !== -1, "al abrirlo muestra tipo, valor y motivo");

console.log("== acciones del editor");
cots.actions["set-ref-descuento"](fakeEl({ "data-cot": "c1", "data-ref": "r2", "data-campo": "descuentoValor" }, "20"));
let r2 = state.cotizaciones[0].referencias[1];
igual(r2.descuento.valor, 20, "set-ref-descuento guarda el valor");
cots.actions["set-ref-descuento"](fakeEl({ "data-cot": "c1", "data-ref": "r2", "data-campo": "descuentoTipo" }, "fijo"));
igual(state.cotizaciones[0].referencias[1].descuento.tipo, "fijo", "set-ref-descuento guarda el tipo");
cots.actions["set-servicio-descuento"](fakeEl({ "data-cot": "c1", "data-servicio": "s1", "data-campo": "descuentoValor" }, "25000"));
igual(state.cotizaciones[0].serviciosCobrados[0].descuento.valor, 25000, "set-servicio-descuento guarda el valor");
cots.actions["set-cot-descuento"](fakeEl({ "data-id": "c1", "data-campo": "descuentoValor" }, "8"));
igual(state.cotizaciones[0].descuento.valor, 8, "set-cot-descuento guarda el valor");
igual(state.cotizaciones[0].descuento.motivo, "cliente frecuente", "y conserva el motivo");
cots.actions["set-cot-descuento"](fakeEl({ "data-id": "c1", "data-campo": "descuentoMotivo" }, "pago de contado"));
igual(state.cotizaciones[0].descuento.motivo, "pago de contado", "cambia el motivo");
igual(state.cotizaciones[0].descuento.valor, 8, "sin perder el valor");
ok(state.cotSucia === "c1", "queda como 'cambios sin guardar'");

console.log("== duplicar cotización: nace a precio de lista");
const copia = cots.duplicarCotizacionCompleta(state.cotizaciones[0]);
ok(!copia.descuento, "la copia no trae descuento al total");
ok(copia.referencias.every(r => !r.descuento), "ni en las referencias");
ok(copia.serviciosCobrados.every(s => !s.descuento), "ni en los servicios");
ok(!!state.cotizaciones[0].descuento && state.cotizaciones[0].referencias[0].descuento, "el original conserva los suyos");

console.log("== PDF de la cotización (lo que ve el cliente)");
state.cotizaciones = [nuevaCot()];
impreso.length = 0; tablas.length = 0;
await pdf.generarPDFCotizacion(state.cotizaciones[0], { enviarPorCorreo: true });
const t0 = tablas[0];
igual(t0.head[0].join("|"), "|CANTIDAD|REFERENCIA|PRECIO POR UNIDAD|DESCUENTO|TOTAL DE LA LÍNEA", "la tabla tiene la columna DESCUENTO");
igual(t0.body[0][3], "$20.000", "la camiseta muestra su precio de lista");
igual(t0.body[0][4], "-$20.000", "y lo rebajado en la línea");
igual(t0.body[0][5], "$180.000", "y el total de la línea ya rebajado");
igual(t0.body[1][4], "", "el short sin descuento deja la celda vacía");
igual(t0.body[1][5], "$105.000", "y su total normal");
igual(t0.body[2][4], "-$10.000", "el servicio muestra su descuento");
igual(t0.body[2][5], "$90.000", "y su total rebajado");
ok(hay("SUBTOTAL") && hay("$405.000"), "SUBTOTAL = valor de lista ($405.000)");
ok(hay("DESCUENTO") && hay("-$48.750"), "DESCUENTO = -$48.750 (30.000 de ítems + 18.750 de la orden)");
ok(hay("cliente frecuente"), "imprime el motivo");
ok(hay("VALOR NETO") && hay("$356.250"), "con IVA imprime el VALOR NETO ($356.250)");
ok(hay("IVA 19%") && hay("$67.688") || hay("IVA 19%"), "imprime el IVA 19%");
ok(hay("$423.938") || hay("$423.937"), "TOTAL = neto + IVA (≈ $423.938)");
const iSub = impreso.findIndex(i => i.t === "SUBTOTAL"), iDesc = impreso.findIndex(i => i.t === "DESCUENTO"), iIva = impreso.findIndex(i => i.t.indexOf("IVA 19%") === 0);
ok(iSub < iDesc && iDesc < iIva, "el orden es SUBTOTAL → DESCUENTO → IVA");

console.log("== PDF de la cotización SIN descuentos: igual que siempre");
const sinDesc = nuevaCot(); sinDesc.descuento = null; sinDesc.referencias.forEach(r => delete r.descuento); sinDesc.serviciosCobrados.forEach(s => delete s.descuento); sinDesc.iva = { activo: false, porcentaje: 19 };
state.cotizaciones = [sinDesc];
impreso.length = 0; tablas.length = 0;
await pdf.generarPDFCotizacion(sinDesc, { enviarPorCorreo: true });
igual(tablas[0].head[0].join("|"), "|CANTIDAD|REFERENCIA|PRECIO POR UNIDAD|TOTAL DE LA LÍNEA", "sin descuentos no hay columna DESCUENTO");
ok(hay("SUBTOTAL") && !hay("DESCUENTO") && !hay("VALOR NETO"), "solo SUBTOTAL e IVA (sin descuento ni valor neto)");
ok(hay("$405.000"), "sin descuentos el SUBTOTAL es el valor de lista: 200.000 + 105.000 + 100.000 (imprimió " + textos().filter(t => t.indexOf("$") === 0).join(" ") + ")");

console.log("== PDF cuenta de cobro de un pedido rápido con descuentos");
const pedido = {
  id: "pp", cliente: "Ana", total: 114000, abono: 50000, abonos: [], numeroOp: "OP-1", descripcion: "x", cantidad: "3", codigoPublico: "ZZ99", iva: { activo: false, porcentaje: 19 },
  descuento: { tipo: "porcentaje", valor: 5, motivo: "pago de contado" },
  lineas: [
    { id: "l1", productoNombre: "Bordado", cantidad: 2, precioUnitario: 50000, descuento: { tipo: "porcentaje", valor: 10 } },
    { id: "l2", productoNombre: "Gorra", cantidad: 1, precioUnitario: 30000 }
  ]
};
state.pedidos = [pedido]; state.cotizaciones = [];
impreso.length = 0; tablas.length = 0;
await pdf.generarPDFCuentaCobro(pedido, { enviarPorCorreo: true });
const tc = tablas[0];
igual(tc.head[0].join("|"), "CANTIDAD|DESCRIPCIÓN|VALOR UNITARIO|DESCUENTO|TOTAL", "la cuenta de cobro tiene la columna DESCUENTO");
igual(tc.body[0].join("|"), "2|Bordado|$50.000|-$10.000|$90.000", "línea con descuento: lista, rebaja y total");
igual(tc.body[1].join("|"), "1|Gorra|$30.000||$30.000", "línea sin descuento");
ok(hay("SUBTOTAL") && hay("$130.000"), "SUBTOTAL = $130.000 (lista)");
ok(hay("-$16.000"), "DESCUENTO = -$16.000 (10.000 de la línea + 6.000 del total)");
ok(hay("pago de contado"), "imprime el motivo");
ok(hay("$114.000"), "el TOTAL es $114.000");

}

// ======================= 3b. Aviso de pérdida =======================
{
  console.log("== el aviso de pérdida solo culpa al descuento si es él quien la causa");
  state.pedidos = []; state.cotizaciones = [];
  state.tab = "pedidos"; state.pedidosVista = "nueva";
  const base = { id: "w1", tipo: "libre", productoNombre: "Gorra", talla: "", cantidad: 1, precioUnitario: 100000, costoUnitario: 80000, observacion: "", campos: [] };
  state.formPedido.cliente = "Ana";
  state.formPedido.lineas = [base];
  state.formPedido.descuentoValor = ""; state.formPedido.descuentoTipo = "porcentaje";
  ok(ped.render().indexOf("queda en pérdida") === -1, "sin descuento no hay aviso");
  state.formPedido.descuentoValor = "5";   // 95.000 > costo 80.000: sigue ganando
  ok(ped.render().indexOf("queda en pérdida") === -1, "un descuento que deja ganancia no avisa");
  state.formPedido.descuentoValor = "30";  // 70.000 < costo 80.000
  ok(ped.render().indexOf("queda en pérdida") !== -1, "un descuento que lo deja en pérdida avisa");
  state.formPedido.lineas = [Object.assign({}, base, { costoUnitario: 120000 })]; // ya perdía sin descuento
  ok(ped.render().indexOf("queda en pérdida") === -1, "si ya perdía sin el descuento, no se le echa la culpa a él");
  state.formPedido.lineas = []; state.formPedido.cliente = ""; state.formPedido.descuentoValor = "";
}

// ======================= 4. Google Sheets: la columna nueva =======================
{
  console.log("== Sheets: el descuento de la cotización tiene su columna, al FINAL");
  const { COLUMNAS_COTIZACIONES, tablaCotizaciones } = await import(R + "core/sheetsEsquemas.js");
  const { _resetCacheParaPruebas } = await import(R + "core/sheetsTabular.js");
  const auth = await import(R + "core/auth.js");
  const llaves = COLUMNAS_COTIZACIONES.map(c => c.key);
  igual(llaves[llaves.length - 1], "descuento", "'descuento' es la ÚLTIMA columna (una en medio correría todo lo ya guardado, Hallazgos #15 y #19)");
  igual(llaves.slice(0, 19).join(","), "id,clienteId,cliente,descripcion,fecha,fechaEntrega,marca,estado,pedidoId,pedidoOrigenId,codigoPublico,estimadoTxId,iva,vendedor,referencias,costosGlobales,serviciosCobrados,gastosReales,compras", "las 19 columnas de antes siguen en su mismo sitio y orden");
  igual(llaves.length, 20, "y solo se sumó una columna");

  sessionStorage.setItem("taller_sesion_v1", JSON.stringify({ session: { email: "admin-descuentos@taller.test", rol: "admin", vendedorNombre: "" }, accessToken: "fake-token", expiraEl: Date.now() + 999999 }));
  auth.restaurarSesion();
  _resetCacheParaPruebas();
  let hoja = [];
  const fetchPrevio = global.fetch;
  global.fetch = async function (url, options) {
    const u = decodeURIComponent(String(url));
    const metodo = (options && options.method) || "GET";
    const res = (v) => ({ ok: true, status: 200, json: async () => v });
    if (u.indexOf("fields=sheets.properties") !== -1) return res({ sheets: [{ properties: { sheetId: 1, title: "Cotizaciones", gridProperties: { columnCount: 80 } } }] });
    if (u.indexOf("/values/Cotizaciones") !== -1) {
      const esEnc = u.indexOf("Cotizaciones!A1:") !== -1;
      if (u.indexOf(":clear") !== -1) { if (!esEnc) hoja = []; return res({}); }
      if (metodo === "PUT") { if (!esEnc) hoja = JSON.parse(options.body).values; return res({}); }
      if (esEnc) return res({ values: [COLUMNAS_COTIZACIONES.map(c => c.header)] });
      return res({ values: hoja });
    }
    return res({});
  };
  const conDesc = { id: "c1", cliente: "Club", descripcion: "Uniformes", estado: "borrador", fecha: "2026-10-29", pedidoId: "", iva: { activo: false, porcentaje: 19 },
    referencias: [{ id: "r1", nombre: "Camiseta", cantidadPedida: 10, precioVenta: 20000, insumos: [], detalle: [], descuento: { tipo: "porcentaje", valor: 10 } }],
    serviciosCobrados: [{ id: "s1", nombre: "Diseño", precio: 100000, costo: 0, descuento: { tipo: "fijo", valor: 5000 } }],
    descuento: { tipo: "fijo", valor: 30000, motivo: "pago de contado" } };
  const sinDesc = { id: "c2", cliente: "Otro", descripcion: "Viejo", estado: "borrador", fecha: "2026-10-01", pedidoId: "", iva: { activo: false, porcentaje: 19 }, referencias: [], serviciosCobrados: [] };
  await tablaCotizaciones.escribir([conDesc, sinDesc]);
  igual(hoja[0].length, COLUMNAS_COTIZACIONES.length, "cada fila escrita tiene todas las columnas");
  igual(JSON.parse(hoja[0][llaves.length - 1]).valor, 30000, "el descuento queda en la última celda");
  igual(hoja[1][llaves.length - 1], "", "una cotización sin descuento deja la celda vacía");
  const leidas = await tablaCotizaciones.leer();
  igual(leidas[0].descuento.motivo, "pago de contado", "al leer vuelve el descuento al total (con su motivo)");
  igual(leidas[0].referencias[0].descuento.valor, 10, "y el de la referencia (dentro de referencias_json)");
  igual(leidas[0].serviciosCobrados[0].descuento.valor, 5000, "y el del servicio (dentro de servicios_cobrados_json)");
  igual(leidas[1].descuento, null, "una cotización sin descuento lee null");
  // Una fila de ANTES de la columna nueva (una celda menos) se sigue leyendo bien.
  hoja = [hoja[0].slice(0, llaves.length - 1)];
  const vieja = (await tablaCotizaciones.leer())[0];
  igual(vieja.descuento, null, "una fila guardada antes de esta columna lee descuento null");
  igual(vieja.referencias[0].nombre, "Camiseta", "y el resto de la fila se lee igual");
  global.fetch = fetchPrevio;
  _resetCacheParaPruebas();
}

// ======================= 5. Pesos enteros (Hallazgo #62) =======================
// El IVA y la comisión por % no pueden dejar centavos: el banco solo ve pesos,
// y una fracción dejaba un "saldo fantasma" en pedidos ya pagados por completo.
{
  console.log("== IVA a pesos enteros: una sola fórmula");
  igual(calc.redondearPesos(16071.375), 16071, "16.071,375 -> 16.071");
  igual(calc.redondearPesos(16071.525), 16072, "16.071,525 -> 16.072");
  igual(Object.is(calc.redondearPesos(-0.4), 0), true, "una fracción negativa pequeña es 0, no -0");
  igual(calc.calcIvaDeBase(133333, { activo: true, porcentaje: 19 }), 25333, "19% de 133.333 = 25.333 (no 25.333,27)");
  igual(calc.calcIvaDeBase(356250, { activo: true, porcentaje: 19 }), 67688, "un medio peso exacto (67.687,5) sube: 67.688");
  igual(calc.calcIvaDeBase(100001, { activo: true, porcentaje: 19 }), 19000, "19% de 100.001 = 19.000");
  igual(calc.calcIvaDeBase(1000000, { activo: true, porcentaje: 19 }), 190000, "los totales redondos dan lo mismo de siempre");
  igual(calc.calcIvaDeBase(1000000, { activo: false, porcentaje: 19 }), 0, "con el IVA apagado es 0");
  igual(calc.calcIvaDeBase(1000000, null), 0, "sin objeto de IVA es 0");

  console.log("== un pedido pagado completo con el monto redondeado queda en CERO (sin saldo fantasma)");
  for (const total of [133333, 100001, 356250, 104500, 99999, 250001]) {
    const p = { id: "z" + total, total, abono: 0, iva: { activo: true, porcentaje: 19 } };
    const aPagar = calc.calcTotalConIvaPedido(p);
    igual(Number.isInteger(aPagar), true, "total " + total + ": lo que se le factura es un entero (" + aPagar + ")");
    p.abono = aPagar;
    igual(calc.calcSaldoPedido(p), 0, "total " + total + ": pagando " + aPagar + " el saldo es 0");
    state.pedidos = [p];
    igual(calc.calcPorCobrar(), 0, "total " + total + ": no queda nada en 'Por cobrar'");
    igual(calc.listaDeudores().length, 0, "total " + total + ": no aparece como deudor");
    igual(calc.listaSaldosAFavorClientes().length, 0, "total " + total + ": tampoco como saldo a favor");
  }
  {
    // El caso que reportó el análisis: el cliente transfiere el valor redondeado.
    const p = { id: "caso", total: 133333, abono: 158666, iva: { activo: true, porcentaje: 19 } };
    igual(calc.calcSaldoPedido(p), 0, "133.333 + IVA: transfiere 158.666 y el saldo es 0 (antes quedaba 0,27)");
    p.abono = 158665;
    igual(calc.calcSaldoPedido(p), 1, "y si faltó un peso, falta exactamente 1");
  }
  {
    const p = { id: "iv", total: 133333, abono: 79333, iva: { activo: true, porcentaje: 19 } };
    igual(Number.isInteger(calc.calcIvaCobrado(p)), true, "el IVA cobrado (proporcional a lo pagado) también es entero");
    p.abono = 158666;
    igual(calc.calcIvaCobrado(p), 25333, "pagado todo, el IVA cobrado es el IVA de la factura");
  }

  console.log("== la comisión por % es en pesos enteros");
  const vend = (valor, tipo) => ({ nombre: "Ana", tipo: tipo || "porcentaje", valor: valor, estado: "pendiente" });
  igual(calc.calcComisionValor({ id: "c1", total: 214285, vendedor: vend(7.5), lineas: [] }), 16071, "7,5% de 214.285 = 16.071 (no 16.071,375)");
  igual(calc.calcComisionValor({ id: "c2", total: 214287, vendedor: vend(7.5), lineas: [] }), 16072, "7,5% de 214.287 = 16.072 (16.071,525 sube)");
  igual(calc.calcComisionValor({ id: "c3", total: 200000, vendedor: vend(10), lineas: [] }), 20000, "un total redondo da lo mismo de siempre");
  igual(calc.calcComisionValor({ id: "c4", total: 214285, vendedor: vend(25000, "fijo"), lineas: [] }), 25000, "una comisión fija se respeta tal cual");
  igual(calc.calcComisionValor({ id: "c5", total: 214285, vendedor: null, lineas: [] }), 0, "sin vendedor es 0");
  {
    // Con descuento el total deja de ser redondo: la comisión sigue en pesos enteros.
    const lineas = [{ cantidad: 3, precioUnitario: 33333, costoUnitario: 0 }];
    const desc = { tipo: "porcentaje", valor: 7 };
    const total = calc.calcTotalesLineasPedido(lineas, desc).precioTotal;
    const comision = calc.calcComisionValor({ id: "c6", total, lineas, descuento: desc, vendedor: vend(8.5) });
    igual(Number.isInteger(total), true, "un descuento % deja un total entero (" + total + ")");
    igual(Number.isInteger(comision), true, "y la comisión sobre él también (" + comision + ")");
  }
  {
    const cot = { id: "cc", referencias: [{ id: "r", nombre: "x", cantidadPedida: 3, precioVenta: 71429, insumos: [], detalle: [] }], serviciosCobrados: [], costosGlobales: [], vendedor: vend(7.5) };
    igual(Number.isInteger(calc.calcComisionValorCot(cot)), true, "la comisión de una cotización también es entera (" + calc.calcComisionValorCot(cot) + ")");
    igual(calc.calcComisionValorCot(cot), Math.round(214287 * 7.5 / 100), "y es el % de las prendas, redondeado");
  }
  {
    const consig = { comisionTipo: "porcentaje", comisionValor: 7.5 };
    igual(calc.calcConsignacionComision(consig, 3, 214285), 16071, "la comisión de una venta en consignación: 7,5% de 214.285 = 16.071");
    igual(calc.calcConsignacionComision({ comisionTipo: "fijo", comisionValor: 2500 }, 3, 214285), 7500, "la fija por unidad no cambia");
  }

  console.log("== los PDF imprimen el MISMO IVA que la app (pesos enteros)");
  state.pedidos = []; state.cotizaciones = [];
  {
    const cot = { id: "pc", cliente: "Club", descripcion: "x", estado: "borrador", fecha: "2026-10-29", pedidoId: "", codigoPublico: "AB12",
      referencias: [{ id: "r1", nombre: "Camiseta", cantidadPedida: 1, precioVenta: 133333, insumos: [], detalle: [] }],
      serviciosCobrados: [], costosGlobales: [], compras: [], gastosReales: [], iva: { activo: true, porcentaje: 19 } };
    impreso.length = 0; tablas.length = 0;
    await pdf.generarPDFCotizacion(cot, { enviarPorCorreo: true });
    ok(hay("$25.333"), "la cotización imprime el IVA entero ($25.333)");
    ok(hay("$158.666"), "y el TOTAL entero ($158.666)");
    ok(!hay("25.333,2") && !hay("158.666,2"), "sin centavos");
  }
  {
    const p = { id: "pcc", cliente: "Ana", total: 356250, abono: 423938, abonos: [], numeroOp: "OP-1", descripcion: "x", cantidad: "1", codigoPublico: "ZZ99",
      iva: { activo: true, porcentaje: 19 }, lineas: [{ id: "l", productoNombre: "Gorra", cantidad: 1, precioUnitario: 356250 }] };
    state.pedidos = [p];
    impreso.length = 0; tablas.length = 0;
    await pdf.generarPDFCuentaCobro(p, { enviarPorCorreo: true });
    ok(hay("$67.688"), "la cuenta de cobro imprime el IVA redondeado ($67.688)");
    ok(hay("$423.938"), "y el TOTAL ($423.938)");
    ok(hay("PAGADO COMPLETO"), "y con 423.938 abonados dice PAGADO COMPLETO (la app y el PDF coinciden)");
  }
  state.pedidos = [];
}

console.log("");
console.log(fallos ? "X " + fallos + " de " + pruebas + " pruebas FALLARON" : "OK " + pruebas + " pruebas de descuentos y redondeo");
process.exit(fallos ? 1 : 0);
