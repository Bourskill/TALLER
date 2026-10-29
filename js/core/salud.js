// Salud de los datos: un chequeo de integridad que VERIFICA Y REPORTA. No
// repara nada y no escribe nada: solo lee `state` y dice cuándo algo de dinero
// deja de cuadrar. Es el espejo de verificarRecibo (core/calc.js), que hasta
// ahora era la única verificación que avisaba: el resto se arreglaba en
// silencio al cargar (ver REPARACIONES_AL_CARGAR en core/store.js) o no se
// miraba nunca.
//
// POR QUÉ ES SOLO LECTURA (no volver a hacerlo "autoreparable"): arreglar en
// silencio es justo lo que escondió los descuadres de los Hallazgos #15-#22.
// Aquí el dueño tiene que ENTERARSE; quién y cómo lo corrige es otra decisión.
//
// Cómo extenderlo: una verificación es { id, titulo, porque, donde, correr }.
// `correr()` lee `state` y devuelve [{ clave, severidad, titulo, detalle,
// afectados, donde? }] (vacío = cuadra). Se agrega con registrarVerificacion
// o sumándola a VERIFICACIONES_SALUD. Una verificación que lanza una excepción
// NO se calla: sale como un error propio ("no se pudo revisar"), porque si no
// corrió, no se sabe si cuadra.
//
// Severidad: "error" = la plata de la app y la de la realidad ya no coinciden
// (o no pueden coincidir). "aviso" = hay que mirarlo, pero la app puede
// producirlo en su uso normal (un saldo a favor, centavos de una nómina) o es
// una decisión pendiente del dueño.

import { state, REPARACIONES_AL_CARGAR } from "./store.js";
import { num, fmt } from "./utils.js";
import {
  calcAbonadoDeLista, calcCaja, calcResumenMovimientos, calcDesglosePedido,
  calcServiciosDisponibles, calcIdsRecibos, calcRecibo, verificarRecibo,
  listaSaldosAFavorClientes, origenSistemaHuerfano, MARCAS_ORIGEN_SISTEMA,
  estadoComisionPedido, estadoComisionCot, esFilaRecibo, pedidoIdDeCotParaTx,
  calcSaldosPorCuenta, transferenciasVigentes, existeCuenta, nombreCuenta, cuentaDeTx
} from "./calc.js";

// Ruido de coma flotante, no un peso: 0,1 + 0,2 no es 0,3 en un computador.
var TOL = 0.005;
function distinto(a, b) { return Math.abs(num(a) - num(b)) > TOL; }
function tieneCentavos(n) { return Math.abs(n - Math.round(n)) > TOL; }
// fmt() redondea a pesos; para mostrar un monto CON centavos (que es justo lo
// que se está reportando) hace falta uno que no los esconda.
function exacto(n) { return "$" + Number(n).toLocaleString("es-CO", { maximumFractionDigits: 3 }); }

var TIPOS_TX = ["ingreso", "gasto", "nomina", "comision"];

function etiquetaPedido(p) { return (p.numeroOp || "Pedido") + " · " + (p.cliente || "sin cliente"); }
// Con la OP del pedido cuando el movimiento tiene uno: así el buscador del
// panel encuentra «OP-12» también en los hallazgos de sus movimientos.
function etiquetaTx(t) {
  var ped = t.pedidoId ? state.pedidos.filter(function (p) { return p.id === t.pedidoId; })[0] : null;
  return (t.concepto || "Movimiento") + " (" + fmt(t.monto) + (t.fecha ? ", " + t.fecha : "") + (ped && ped.numeroOp ? ", " + ped.numeroOp : "") + ")";
}
function refPedido(p) { return { tipo: "pedido", id: p.id, etiqueta: etiquetaPedido(p) }; }
function refTx(t) { return { tipo: "movimiento", id: t.id, etiqueta: etiquetaTx(t) }; }
function refCot(c) { return { tipo: "cotizacion", id: c.id, etiqueta: "Cotización · " + (c.descripcion || c.cliente || "sin nombre") }; }

function indexarPorId(lista) {
  var m = {};
  (lista || []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; });
  return m;
}

// ---------------------------------------------------------------------------
// 1. El abonado de cada pedido
// ---------------------------------------------------------------------------
// p.abono se calcula SIEMPRE desde la lista de abonos (recalcularAbonoPedido,
// modules/pedidos.js): max(0, base sin respaldo) + calcAbonadoDeLista(lista).
// La "base" es lo que un pedido anterior a la lista ya tenía abonado sin
// ninguna fila detrás, y no es un error. Por eso:
//  - abono MENOR que la suma de la lista = imposible con esa fórmula (la base
//    se topa en 0): error.
//  - abono MAYOR = hay una base. Normal en un pedido viejo, y se da por
//    explicada si Finanzas tiene ingresos sueltos de ese pedido por el mismo
//    monto; si no, un aviso (no se puede saber si la base es legítima).
function verificarAbonadoPedidos() {
  var out = [];
  var sueltos = {};
  state.tx.forEach(function (t) {
    if (t.tipo !== "ingreso" || !t.pedidoId || t.origenAbonoId || t.origenVentaConsignacionId) return;
    sueltos[t.pedidoId] = (sueltos[t.pedidoId] || 0) + num(t.monto);
  });
  state.pedidos.forEach(function (p) {
    var enLista = calcAbonadoDeLista(p.abonos);
    var abono = num(p.abono);
    if (abono < enLista - TOL) {
      out.push({
        clave: "menor:" + p.id, severidad: "error",
        titulo: "El pedido dice que cobró menos de lo que suman sus abonos",
        detalle: etiquetaPedido(p) + ": figura abonado " + fmt(abono) + ", pero sus abonos registrados suman " + fmt(enLista) + ".",
        afectados: [refPedido(p)]
      });
    } else if (abono > enLista + TOL) {
      var base = abono - enLista;
      if (!distinto(sueltos[p.id] || 0, base)) return;
      out.push({
        clave: "base:" + p.id, severidad: "aviso",
        titulo: "Parte de lo abonado no tiene su abono registrado",
        detalle: etiquetaPedido(p) + ": figura abonado " + fmt(abono) + " y sus abonos suman " + fmt(enLista) + "; " + fmt(base) + " no tienen fila de abono ni un ingreso suelto igual en Finanzas. Es normal solo en un pedido anterior a la lista de abonos.",
        afectados: [refPedido(p)]
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 2. Cada abono / reembolso tiene su movimiento, por el mismo monto
// ---------------------------------------------------------------------------
function verificarAbonosYMovimientos() {
  var out = [];
  var porAbono = {}, porReembolso = {};
  state.tx.forEach(function (t) {
    if (t.origenAbonoId) (porAbono[t.origenAbonoId] = porAbono[t.origenAbonoId] || []).push(t);
    if (t.origenReembolsoId) (porReembolso[t.origenReembolsoId] = porReembolso[t.origenReembolsoId] || []).push(t);
  });
  var yaReportados = {}; // movimientos ya explicados en un hallazgo: el otro sentido no los repite
  state.pedidos.forEach(function (p) {
    (p.abonos || []).forEach(function (a) {
      var esReembolso = a.tipo === "reembolso";
      var que = esReembolso ? "reembolso" : "abono";
      var todos = (esReembolso ? porReembolso : porAbono)[a.id] || [];
      var propios = todos.filter(function (t) { return t.pedidoId === p.id; });
      var cuando = a.fecha ? " del " + a.fecha : "";
      if (!propios.length && todos.length) {
        // El movimiento existe pero cuelga de OTRO pedido: es una sola falla
        // vista desde los dos lados, y se cuenta una vez.
        todos.forEach(function (t) { yaReportados[t.id] = true; });
        out.push({
          clave: "movimiento-en-otro-pedido:" + a.id, severidad: "error",
          titulo: "El movimiento de " + (esReembolso ? "un reembolso" : "un abono") + " quedó en otro pedido",
          detalle: etiquetaPedido(p) + ": el " + que + " de " + fmt(a.monto) + cuando + " tiene su movimiento en Finanzas, pero asignado a otro pedido; en este la caja no lo cuenta.",
          afectados: [refPedido(p)].concat(todos.map(refTx))
        });
        return;
      }
      if (!propios.length) {
        out.push({
          clave: "sin-movimiento:" + a.id, severidad: "error",
          titulo: esReembolso ? "Un reembolso del pedido no está en Finanzas" : "Un abono del pedido no está en Finanzas",
          detalle: etiquetaPedido(p) + ": el " + que + " de " + fmt(a.monto) + cuando + " no tiene su movimiento de " + (esReembolso ? "gasto" : "ingreso") + " en Finanzas, así que la caja no lo cuenta.",
          afectados: [refPedido(p)]
        });
        return;
      }
      // Con más de uno es un duplicado (lo reporta la otra verificación): no se
      // compara el monto contra una suma que ya se sabe mala.
      if (propios.length !== 1) return;
      var t = propios[0];
      if (distinto(t.monto, a.monto)) {
        out.push({
          clave: "monto:" + a.id, severidad: "error",
          titulo: "El " + que + " y su movimiento tienen montos distintos",
          detalle: etiquetaPedido(p) + ": el " + que + " dice " + fmt(a.monto) + cuando + " y su movimiento en Finanzas dice " + fmt(t.monto) + ".",
          afectados: [refPedido(p), refTx(t)]
        });
      }
    });
  });
  // El otro sentido: un movimiento que apunta a un abono que ya no existe.
  state.tx.forEach(function (t) {
    var h = origenSistemaHuerfano(t);
    if (!h || (h.campo !== "origenAbonoId" && h.campo !== "origenReembolsoId") || yaReportados[t.id]) return;
    var esReembolso = h.campo === "origenReembolsoId";
    var p = state.pedidos.filter(function (x) { return x.id === t.pedidoId; })[0];
    out.push({
      clave: "movimiento-sin-abono:" + t.id, severidad: "error",
      titulo: "Finanzas tiene " + (esReembolso ? "un reembolso" : "un abono") + " que el pedido ya no tiene",
      detalle: etiquetaTx(t) + " figura como " + (esReembolso ? "reembolso" : "abono") + " de un pedido, pero " + (p ? etiquetaPedido(p) + " ya no tiene ese " + (esReembolso ? "reembolso" : "abono") : "ese pedido ya no existe") + ". La caja cuenta una plata que ningún pedido respalda.",
      afectados: (p ? [refPedido(p)] : []).concat([refTx(t)])
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 3a. Movimientos cuyo origen ya no existe
// ---------------------------------------------------------------------------
// Los de abonos y reembolsos los reporta la verificación 2 (con su gravedad); y
// el pago de un gasto fijo de un periodo cerrado queda "suelto" a propósito
// (ver MARCAS_ORIGEN_SISTEMA), así que no es un hallazgo.
function verificarOrigenesHuerfanos() {
  var out = [];
  var pedidos = indexarPorId(state.pedidos), cots = indexarPorId(state.cotizaciones);
  state.tx.forEach(function (t) {
    var h = origenSistemaHuerfano(t);
    if (!h) return;
    if (h.campo === "origenAbonoId" || h.campo === "origenReembolsoId" || h.campo === "origenGastoFijoPeriodo") return;
    // Si el pedido/cotización de la comisión SÍ existe, el problema es otro (su
    // vendedor ya no figura pagado): lo reporta la verificación de comisiones.
    if (h.campo === "origenComisionPedidoId" && pedidos[h.valor]) return;
    if (h.campo === "origenComisionCotId" && cots[h.valor]) return;
    out.push({
      clave: "huerfano:" + t.id, severidad: "aviso",
      titulo: "Un movimiento quedó suelto: lo que lo originó ya no existe",
      detalle: etiquetaTx(t) + " lo generó " + h.que + ", pero ese registro ya no existe (" + h.campo + ": " + h.valor + "). La plata sí se movió; falta decidir si el movimiento se queda o se borra.",
      afectados: [refTx(t)]
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 3b. Movimientos duplicados: dos con la misma marca de origen
// ---------------------------------------------------------------------------
// Cada marca de MARCAS_ORIGEN_SISTEMA identifica UN hecho (un abono, una
// comisión, el pago de un gasto fijo en un periodo...), así que dos movimientos
// con la misma son el mismo hecho contado dos veces. Excepciones reales, que
// por eso NO se miran:
//  - deudaId: una deuda tiene un movimiento por cada cuota pagada.
//  - reciboCompraId: un recibo tiene varias filas; las revisa verificarRecibo.
// y dos marcas son únicas solo DENTRO de su cotización (la clave de una compra
// es la del insumo, igual en todas las cotizaciones que lo usan).
// test/salud.mjs exige que cada marca nueva de MARCAS_ORIGEN_SISTEMA quede
// clasificada en uno de estos dos arreglos.
export var MARCAS_UNICAS = {
  origenAbonoId: [], origenReembolsoId: [],
  origenComisionPedidoId: [], origenComisionCotId: [],
  origenVentaConsignacionId: [], origenComisionConsignacionId: [],
  origenGastoFijoPeriodo: [], origenDeudaIngresoId: [], origenColchonId: [],
  origenCompraClave: ["cotizacionId"], origenCompraExcedenteClave: ["cotizacionId"]
};
export var MARCAS_REPETIBLES = ["deudaId", "reciboCompraId"];

var TITULO_DUPLICADO = {
  origenComisionPedidoId: "Una comisión aparece pagada dos veces",
  origenComisionCotId: "Una comisión aparece pagada dos veces",
  origenComisionConsignacionId: "Una comisión aparece pagada dos veces",
  origenAbonoId: "Un abono aparece dos veces en Finanzas",
  origenReembolsoId: "Un reembolso aparece dos veces en Finanzas",
  origenVentaConsignacionId: "Una venta de consignación aparece dos veces en Finanzas",
  origenGastoFijoPeriodo: "Un gasto fijo aparece pagado dos veces en el mismo periodo"
};

function verificarMovimientosDuplicados() {
  var out = [];
  var grupos = {}, orden = [];
  state.tx.forEach(function (t) {
    Object.keys(MARCAS_UNICAS).forEach(function (campo) {
      if (!t[campo]) return;
      // La parte de un recibo comparte origenCompraClave con una compra suelta.
      if (t.reciboCompraId && (campo === "origenCompraClave" || campo === "origenCompraExcedenteClave")) return;
      var k = JSON.stringify([campo, t[campo]].concat(MARCAS_UNICAS[campo].map(function (c) { return t[c] || ""; })));
      if (!grupos[k]) { grupos[k] = { campo: campo, valor: t[campo], txs: [] }; orden.push(k); }
      grupos[k].txs.push(t);
    });
  });
  orden.forEach(function (k) {
    var g = grupos[k];
    if (g.txs.length < 2) return;
    var marca = MARCAS_ORIGEN_SISTEMA.filter(function (m) { return m.campo === g.campo; })[0];
    var total = g.txs.reduce(function (a, t) { return a + num(t.monto); }, 0);
    out.push({
      clave: "duplicado:" + k, severidad: "error",
      titulo: TITULO_DUPLICADO[g.campo] || "Dos movimientos para el mismo origen",
      detalle: g.txs.length + " movimientos nacieron de " + (marca ? marca.que : "lo mismo") + " y suman " + fmt(total) + ": debería haber uno solo. " + g.txs.map(etiquetaTx).join(" · "),
      afectados: g.txs.map(refTx)
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 4. Comisiones: "pagada" y su movimiento tienen que ir juntos
// ---------------------------------------------------------------------------
function verificarComisiones() {
  var out = [];
  var porPedido = {}, porCot = {};
  state.tx.forEach(function (t) {
    if (t.origenComisionPedidoId) (porPedido[t.origenComisionPedidoId] = porPedido[t.origenComisionPedidoId] || []).push(t);
    if (t.origenComisionCotId) (porCot[t.origenComisionCotId] = porCot[t.origenComisionCotId] || []).push(t);
  });
  var pedidos = indexarPorId(state.pedidos), cots = indexarPorId(state.cotizaciones);

  state.pedidos.forEach(function (p) {
    if (estadoComisionPedido(p) === "pagada" && !(porPedido[p.id] || []).length) {
      out.push({
        clave: "pedido-sin-movimiento:" + p.id, severidad: "error",
        titulo: "Una comisión figura pagada pero no está en Finanzas",
        detalle: etiquetaPedido(p) + ": la comisión de " + p.vendedor.nombre + " está marcada como pagada, pero Finanzas no tiene ese gasto. Esa plata salió y la caja no lo sabe.",
        afectados: [refPedido(p)]
      });
    }
  });
  state.cotizaciones.forEach(function (c) {
    if (estadoComisionCot(c) === "pagada" && !(porCot[c.id] || []).length) {
      out.push({
        clave: "cot-sin-movimiento:" + c.id, severidad: "error",
        titulo: "Una comisión figura pagada pero no está en Finanzas",
        detalle: "Cotización · " + (c.descripcion || "sin nombre") + ": la comisión de " + c.vendedor.nombre + " está marcada como pagada, pero Finanzas no tiene ese gasto. Esa plata salió y la caja no lo sabe.",
        afectados: [refCot(c)]
      });
    }
    // Pagada desde la cotización Y desde el pedido que salió de ella (Hallazgo
    // #48): el mismo vendedor cobrado dos veces.
    var pid = pedidoIdDeCotParaTx(c);
    if ((porCot[c.id] || []).length && pid && (porPedido[pid] || []).length) {
      out.push({
        clave: "cot-y-pedido:" + c.id, severidad: "error",
        titulo: "Una comisión aparece pagada dos veces",
        detalle: "La comisión de " + (c.vendedor && c.vendedor.nombre || "un vendedor") + " está pagada desde la cotización \"" + (c.descripcion || "sin nombre") + "\" y también desde su pedido: son dos gastos para la misma comisión.",
        afectados: [refCot(c)].concat(pedidos[pid] ? [refPedido(pedidos[pid])] : []).concat((porCot[c.id] || []).concat(porPedido[pid] || []).map(refTx))
      });
    }
  });
  // El otro sentido: el movimiento existe y el pedido/cotización no lo tiene
  // pagado. (Si el pedido o la cotización ya no existen, es un movimiento
  // suelto y lo reporta la verificación 3a.)
  Object.keys(porPedido).forEach(function (pid) {
    var p = pedidos[pid];
    if (!p || estadoComisionPedido(p) === "pagada") return;
    porPedido[pid].forEach(function (t) {
      out.push({
        clave: "movimiento-sin-pago-pedido:" + t.id, severidad: "error",
        titulo: "Finanzas tiene una comisión pagada que el pedido no tiene como pagada",
        detalle: etiquetaTx(t) + " salió de la caja como comisión de " + etiquetaPedido(p) + ", pero el pedido la muestra pendiente: se puede volver a pagar.",
        afectados: [refPedido(p), refTx(t)]
      });
    });
  });
  Object.keys(porCot).forEach(function (cid) {
    var c = cots[cid];
    if (!c || estadoComisionCot(c) === "pagada") return;
    porCot[cid].forEach(function (t) {
      out.push({
        clave: "movimiento-sin-pago-cot:" + t.id, severidad: "error",
        titulo: "Finanzas tiene una comisión pagada que la cotización no tiene como pagada",
        detalle: etiquetaTx(t) + " salió de la caja como comisión de la cotización \"" + (c.descripcion || "sin nombre") + "\", pero ella la muestra pendiente (o ya es un pedido): se puede volver a pagar.",
        afectados: [refCot(c), refTx(t)]
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 5. Los montos, fechas y tipos de los movimientos
// ---------------------------------------------------------------------------
function fechaValida(f) {
  if (typeof f !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  var d = new Date(f + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

function verificarMovimientos() {
  var out = [];
  state.tx.forEach(function (t) {
    var m = t.monto;
    var numerico = !(m === "" || m == null || typeof m === "boolean" || !isFinite(Number(m)));
    if (!numerico) {
      out.push({
        clave: "monto-no-numerico:" + t.id, severidad: "error",
        titulo: "Un movimiento tiene un monto que no es un número",
        detalle: (t.concepto || "Movimiento") + " (" + (t.fecha || "sin fecha") + ") tiene como monto «" + String(m) + "». La caja lo cuenta como $0.",
        afectados: [refTx(t)]
      });
    } else {
      var v = Number(m);
      if (v < 0) {
        out.push({
          clave: "monto-negativo:" + t.id, severidad: "error",
          titulo: "Un movimiento tiene un monto negativo",
          detalle: etiquetaTx(t) + ": un movimiento no puede ser negativo; para devolver plata se registra el reembolso, no un monto con signo menos.",
          afectados: [refTx(t)]
        });
      } else if (v === 0 && !esFilaRecibo(t)) {
        out.push({
          clave: "monto-cero:" + t.id, severidad: "aviso",
          titulo: "Un movimiento está en $0",
          detalle: etiquetaTx(t) + ": no mueve plata y solo ensucia las listas; conviene borrarlo.",
          afectados: [refTx(t)]
        });
      } else if (tieneCentavos(v)) {
        out.push({
          clave: "monto-centavos:" + t.id, severidad: "aviso",
          titulo: "Un movimiento tiene centavos",
          detalle: (t.concepto || "Movimiento") + " (" + (t.fecha || "sin fecha") + ") es de " + exacto(v) + ". Ningún banco muestra centavos de peso: este movimiento no va a coincidir con el extracto.",
          afectados: [refTx(t)]
        });
      }
    }
    if (!fechaValida(t.fecha)) {
      out.push({
        clave: "fecha-invalida:" + t.id, severidad: "error",
        titulo: "Un movimiento tiene una fecha inválida",
        detalle: (t.concepto || "Movimiento") + " (" + fmt(t.monto) + ") tiene como fecha «" + String(t.fecha == null ? "" : t.fecha) + "»: los reportes por periodo no lo ubican.",
        afectados: [refTx(t)]
      });
    }
    if (TIPOS_TX.indexOf(t.tipo) === -1) {
      out.push({
        clave: "tipo-desconocido:" + t.id, severidad: "error",
        titulo: "Un movimiento tiene un tipo que la app no conoce",
        detalle: etiquetaTx(t) + " es de tipo «" + String(t.tipo) + "» (solo existen ingreso, gasto, nómina y comisión). La caja lo cuenta como si fuera un gasto.",
        afectados: [refTx(t)]
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 6. El total del pedido sale de sus líneas y descuentos
// ---------------------------------------------------------------------------
// p.total es lo que lee el resto de la app; las líneas y los descuentos solo lo
// EXPLICAN (Hallazgo #61). Sin líneas (los pedidos viejos) no hay nada contra
// qué comparar, y la consignación no lleva líneas ni descuento.
// Es un aviso y no un error porque un pedido muy viejo puede traer líneas que
// nunca sumaron su total (calcTotalConDescuentos ya lo prevé).
function verificarTotalesPedidos() {
  var out = [];
  state.pedidos.forEach(function (p) {
    if (p.consignacion || !(p.lineas || []).length) return;
    var d = calcDesglosePedido(p);
    var deLasLineas = d.netos.reduce(function (a, n) { return a + n; }, 0) - d.descuentoOrden;
    if (Math.abs(deLasLineas - num(p.total)) <= 0.5) return;
    out.push({
      clave: "total:" + p.id, severidad: "aviso",
      titulo: "El total del pedido no sale de sus líneas",
      detalle: etiquetaPedido(p) + ": sus líneas y descuentos suman " + fmt(deLasLineas) + " y el total guardado es " + fmt(p.total) + " (diferencia " + fmt(num(p.total) - deLasLineas) + "). El IVA, el saldo y la comisión se calculan desde el total guardado.",
      afectados: [refPedido(p)]
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 7. Recibos de compra: lo que ya verifica verificarRecibo
// ---------------------------------------------------------------------------
function verificarRecibos() {
  var out = [];
  calcIdsRecibos(state.cotizaciones, state.tx).forEach(function (id) {
    var problemas = verificarRecibo(id, state.cotizaciones, state.tx);
    if (!problemas.length) return;
    var r = calcRecibo(id, state.cotizaciones, state.tx);
    var cab = r.cabecera || {};
    var quien = cab.contraparte || (cab.proveedorId && (state.clientes.filter(function (c) { return c.id === cab.proveedorId; })[0] || {}).nombre) || "sin proveedor";
    var cotIds = [];
    r.lineas.forEach(function (L) { L.partes.forEach(function (p) { if (cotIds.indexOf(p.cotId) === -1) cotIds.push(p.cotId); }); });
    var afectados = [{ tipo: "recibo", id: id, etiqueta: "Recibo de compra · " + quien + (cab.fecha ? " · " + cab.fecha : "") }];
    cotIds.forEach(function (cid) {
      var c = state.cotizaciones.filter(function (x) { return x.id === cid; })[0];
      if (c) afectados.push(refCot(c));
    });
    out.push({
      clave: "recibo:" + id, severidad: "error",
      titulo: "Un recibo de compra no cuadra",
      detalle: "Recibo de " + quien + (cab.fecha ? " del " + cab.fecha : "") + ": " + problemas.join(" "),
      afectados: afectados
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 8. Servicios disponibles negativos
// ---------------------------------------------------------------------------
function verificarServicios() {
  var out = [];
  calcServiciosDisponibles().forEach(function (s) {
    if (s.disponible >= -0.5) return;
    var movs = state.tx.filter(function (t) {
      return (t.serviciosDescuento || []).some(function (d) { return d.nombre === s.nombre; });
    });
    out.push({
      clave: "servicio:" + s.nombre, severidad: "error",
      titulo: "Un servicio tiene gastado más de lo que acumuló",
      detalle: "«" + s.nombre + "» acumuló " + fmt(s.acumulado) + " y ya se le descontaron " + fmt(s.usado) + ": le faltan " + fmt(-s.disponible) + ".",
      afectados: movs.map(refTx)
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 9. La caja contra una suma independiente
// ---------------------------------------------------------------------------
// Se suma aparte, en centavos enteros (sin el ruido de la coma flotante), y se
// compara con las dos cuentas que la app ya tiene de lo mismo: calcCaja() (el
// KPI «Caja actual») y el balance de calcResumenMovimientos() (el del reporte).
// Si dos formas de contar lo mismo dan distinto, algún movimiento se lee mal.
function verificarCaja() {
  var centavos = 0;
  state.tx.forEach(function (t) {
    var m = Number(t.monto);
    if (!isFinite(m)) return;
    var c = Math.round(m * 100);
    centavos += t.tipo === "ingreso" ? c : -c;
  });
  var independiente = centavos / 100;
  var caja = calcCaja();
  var balance = calcResumenMovimientos(state.tx).balance;
  if (Math.abs(caja - independiente) <= 0.5 && Math.abs(balance - independiente) <= 0.5) return [];
  return [{
    clave: "caja", severidad: "error",
    titulo: "La caja no coincide con la suma de los movimientos",
    detalle: "«Caja actual» dice " + fmt(caja) + ", el reporte de movimientos dice " + fmt(balance) + " y sumando uno por uno los ingresos y los egresos da " + fmt(independiente) + ".",
    afectados: []
  }];
}

// ---------------------------------------------------------------------------
// 10. Las cuentas contra la Caja (Hallazgo #63)
// ---------------------------------------------------------------------------
// La garantía de las cuentas es que SU SUMA es la Caja: el signo de un
// movimiento sale de una sola función (montoConSigno) y cada transferencia suma
// cero, así que por construcción coinciden. Esto es el cable de seguridad por si
// algún día dejan de coincidir. Además señala lo que haría que una cuenta no se
// pueda comparar con su extracto: movimientos en una cuenta que ya no existe, o
// una transferencia con un monto o una cuenta imposibles.
//
// «Sin asignar» NO se señala: es el estado normal de los movimientos de antes
// de las cuentas, y la pantalla de Cuentas ya tiene su botón «Repartir ahora».
// Esto avisa de INCONSISTENCIAS, no de tareas pendientes.
function verificarCuentas() {
  var res = [];
  var s = calcSaldosPorCuenta();
  // Si un monto no es un número, la comparación no tiene sentido (y la
  // verificación de «Monto, fecha y tipo» ya lo señala con nombre propio).
  if (isFinite(s.total) && isFinite(s.caja) && !s.cuadra) {
    res.push({
      clave: "suma-cuentas", severidad: "error",
      titulo: "La suma de las cuentas no es la Caja",
      detalle: "Sumando el saldo de cada cuenta da " + fmt(s.total) + " y «Caja actual» dice " + fmt(s.caja) + ". Algún movimiento o transferencia se está leyendo mal.",
      afectados: []
    });
  }
  s.cuentas.filter(function (c) { return c.huerfana; }).forEach(function (c) {
    var movs = state.tx.filter(function (t) { return cuentaDeTx(t) === c.id; });
    // Si solo hay transferencias hacia/desde esa cuenta, ya las señala la
    // revisión de transferencias de abajo: un problema, un hallazgo.
    if (!movs.length) return;
    res.push({
      clave: "cuenta-eliminada:" + c.id, severidad: "aviso",
      titulo: "Hay movimientos en una cuenta que ya no existe",
      detalle: movs.length + " movimiento(s) están en la cuenta «" + c.id + "», que ya no está en Configuración → Cuentas, y la cuenta suma " + fmt(c.saldo) + ". Esa plata cuenta en la Caja pero no en ningún saldo que puedas comparar con un extracto.",
      afectados: movs.map(refTx)
    });
  });
  transferenciasVigentes().forEach(function (tr) {
    var m = Number(tr.monto);
    var rotulo = "La transferencia del " + (tr.fecha || "?") + " de " + fmt(isFinite(m) ? m : 0);
    if (!isFinite(m) || m <= 0) {
      res.push({
        clave: "transferencia-monto:" + tr.id, severidad: "error",
        titulo: "Una transferencia entre cuentas tiene un monto imposible",
        detalle: rotulo + " tiene un monto que no es un valor positivo, así que no se sabe cuánto movió entre las dos cuentas.",
        afectados: []
      });
    }
    var raras = [tr.de, tr.a].filter(function (id) { return id && !existeCuenta(id); });
    if (raras.length) {
      res.push({
        clave: "transferencia-cuenta:" + tr.id, severidad: "aviso",
        titulo: "Una transferencia usa una cuenta que ya no existe",
        detalle: rotulo + " (" + nombreCuenta(tr.de) + " → " + nombreCuenta(tr.a) + ") usa una cuenta que ya no está en Configuración → Cuentas: ese saldo no se puede comparar con ningún extracto.",
        afectados: []
      });
    }
    if (tr.de && tr.de === tr.a) {
      res.push({
        clave: "transferencia-misma:" + tr.id, severidad: "aviso",
        titulo: "Una transferencia sale y entra a la misma cuenta",
        detalle: rotulo + " no mueve nada: origen y destino son la misma cuenta («" + nombreCuenta(tr.de) + "»).",
        afectados: []
      });
    }
  });
  return res;
}

// ---------------------------------------------------------------------------
// 11. Clientes a quienes se les cobró de más
// ---------------------------------------------------------------------------
function verificarSaldosAFavor() {
  var pedidos = indexarPorId(state.pedidos);
  return listaSaldosAFavorClientes().map(function (s) {
    var p = pedidos[s.pedidoId];
    return {
      clave: "saldo-a-favor:" + s.pedidoId, severidad: "aviso",
      titulo: "A un cliente se le cobró de más",
      detalle: (p ? etiquetaPedido(p) : (s.nombre || "Un cliente")) + ": pagó " + fmt(s.monto) + " más de lo que debía. Esa plata no es del taller y ya está sumada en «Por pagar».",
      afectados: p ? [refPedido(p)] : []
    };
  });
}

// ---------------------------------------------------------------------------
// El registro
// ---------------------------------------------------------------------------
export var VERIFICACIONES_SALUD = [
  {
    id: "abonado-pedido", titulo: "Lo abonado de cada pedido",
    porque: "El pedido muestra cuánto te han pagado. Si ese número no es la suma de sus abonos, el saldo por cobrar (y lo que le cobras al cliente) está mal.",
    donde: "Pedidos → tarjeta del pedido → Abonos registrados",
    correr: verificarAbonadoPedidos
  },
  {
    id: "abono-movimiento", titulo: "Cada abono y reembolso, en Finanzas por el mismo monto",
    porque: "Cada abono que registras en un pedido tiene que aparecer también en Finanzas, por el mismo valor. Si no, la caja y el pedido cuentan plata distinta y no vas a poder cuadrar con el banco.",
    donde: "Pedidos → tarjeta del pedido → Abonos registrados (editar o eliminar el abono arregla los dos lados)",
    correr: verificarAbonosYMovimientos
  },
  {
    id: "movimiento-duplicado", titulo: "Movimientos duplicados",
    porque: "Dos movimientos que nacieron de lo mismo (por ejemplo, la misma comisión pagada dos veces) hacen que la caja quede más baja o más alta que la real.",
    donde: "Finanzas → buscar el movimiento → borrar el que sobra (si el origen sigue existiendo, se deshace desde el pedido o la cotización)",
    correr: verificarMovimientosDuplicados
  },
  {
    id: "origen-huerfano", titulo: "Movimientos cuyo origen ya no existe",
    porque: "Hay movimientos que la app creó sola (una comisión, una compra…) cuyo pedido o cotización ya no existe. La plata sí se movió, pero nadie la explica: conviene revisar si se queda o se borra.",
    donde: "Finanzas → filtro «Sueltos»",
    correr: verificarOrigenesHuerfanos
  },
  {
    id: "comision", titulo: "Comisiones pagadas y su movimiento",
    porque: "Pagar una comisión mueve plata. Si el pedido dice «pagada» y Finanzas no tiene el gasto (o al revés), la caja o lo que le debes al vendedor está mal.",
    donde: "Pedidos (o Cotizaciones) → el vendedor → botón «pagada»",
    correr: verificarComisiones
  },
  {
    id: "movimiento-datos", titulo: "Monto, fecha y tipo de cada movimiento",
    porque: "Un monto, una fecha o un tipo mal escritos descuadran la caja y los reportes; y un valor con centavos no existe en el banco, así que nunca va a cuadrar con tu extracto.",
    donde: "Finanzas → el movimiento → Editar",
    correr: verificarMovimientos
  },
  {
    id: "total-pedido", titulo: "El total de cada pedido contra sus líneas",
    porque: "El total del pedido tiene que salir de sus líneas y descuentos. Si no, el IVA, el saldo, la comisión y los reportes parten de un número que no se puede explicar.",
    donde: "Pedidos → tarjeta del pedido (Aplicar un descuento recalcula el total desde las líneas)",
    correr: verificarTotalesPedidos
  },
  {
    id: "recibo-compra", titulo: "Recibos de compra",
    porque: "Un recibo de compra reparte lo que pagaste entre pedidos y reserva. Si los pesos no cuadran, el costo de los pedidos o la caja no son los reales.",
    donde: "Finanzas → Recibos de compra → el recibo",
    correr: verificarRecibos
  },
  {
    id: "servicio-negativo", titulo: "Servicios con el disponible negativo",
    porque: "Un servicio es mano de obra propia ya cobrada. Si se gastó más de lo que se acumuló, estás descontando plata que no existe.",
    donde: "Resumen → el servicio → ver historial",
    correr: verificarServicios
  },
  {
    id: "caja", titulo: "La caja contra la suma de los movimientos",
    porque: "La Caja actual tiene que ser lo que entró menos lo que salió. Si dos formas de sumarlo dan distinto, algún movimiento se está leyendo mal.",
    donde: "Finanzas → revisar los movimientos señalados arriba",
    correr: verificarCaja
  },
  {
    id: "cuentas", titulo: "Las cuentas contra la Caja",
    porque: "El saldo de cada cuenta (efectivo, banco, Nequi…) tiene que sumar exactamente la Caja actual. Si no suma, o hay plata en una cuenta que ya no existe, no vas a poder comparar una cuenta con su extracto bancario.",
    donde: "Finanzas → 🏦 Cuentas (saldos y transferencias) y Configuración → Cuentas",
    correr: verificarCuentas
  },
  {
    id: "saldo-a-favor", titulo: "Clientes con saldo a favor",
    porque: "Cuando un cliente paga más de lo que debía, esa plata no es tuya: hay que devolverla (ya cuenta en «Por pagar»).",
    donde: "Pedidos → tarjeta del pedido → registrar el reembolso",
    correr: verificarSaldosAFavor
  }
];

// Para sumar una verificación nueva sin tocar nada de lo demás. Si el id ya
// existe, la reemplaza.
export function registrarVerificacion(v) {
  var i = VERIFICACIONES_SALUD.map(function (x) { return x.id; }).indexOf(v.id);
  if (i === -1) VERIFICACIONES_SALUD.push(v); else VERIFICACIONES_SALUD[i] = v;
}

function correrVerificacion(v) {
  var encontrados;
  try {
    encontrados = v.correr() || [];
  } catch (e) {
    encontrados = [{
      clave: "no-corrio", severidad: "error",
      titulo: "No se pudo revisar: " + v.titulo,
      detalle: "La revisión falló (" + (e && e.message ? e.message : e) + "). Mientras no corra, no se sabe si esto cuadra.",
      afectados: []
    }];
  }
  return encontrados.map(function (h) {
    return {
      id: v.id + ":" + h.clave, regla: v.id, severidad: h.severidad,
      titulo: h.titulo, detalle: h.detalle, porque: v.porque,
      afectados: h.afectados || [], donde: h.donde || v.donde
    };
  });
}

// La lista de hallazgos: errores primero, avisos después, y dentro de cada
// grupo en el orden del registro. Vacía = todo cuadra.
export function calcSaludDatos() {
  var todos = [];
  VERIFICACIONES_SALUD.forEach(function (v) { todos = todos.concat(correrVerificacion(v)); });
  var errores = todos.filter(function (h) { return h.severidad === "error"; });
  var avisos = todos.filter(function (h) { return h.severidad !== "error"; });
  return errores.concat(avisos);
}

// Lo que necesita la pantalla y el informe: los hallazgos ya contados y qué se
// revisó (para poder decir «se revisaron 11 cosas» y que «todo cuadra» sea
// una afirmación sobre algo concreto).
export function calcResumenSalud() {
  var hallazgos = calcSaludDatos();
  return {
    hallazgos: hallazgos,
    errores: hallazgos.filter(function (h) { return h.severidad === "error"; }).length,
    avisos: hallazgos.filter(function (h) { return h.severidad !== "error"; }).length,
    revisadas: VERIFICACIONES_SALUD.map(function (v) {
      var hs = hallazgos.filter(function (h) { return h.regla === v.id; });
      return {
        id: v.id, titulo: v.titulo, porque: v.porque,
        errores: hs.filter(function (h) { return h.severidad === "error"; }).length,
        avisos: hs.filter(function (h) { return h.severidad !== "error"; }).length
      };
    })
  };
}

// Lo que las reparaciones de loadAll() corrigieron en silencio en esta carga,
// con su frase (REPARACIONES_AL_CARGAR) y el orden en que corren.
export function calcReparacionesAlCargar() {
  var cantidades = {};
  (state.reparacionesAlCargar || []).forEach(function (r) { cantidades[r.clave] = (cantidades[r.clave] || 0) + r.cantidad; });
  var filas = Object.keys(REPARACIONES_AL_CARGAR).filter(function (k) { return cantidades[k] > 0; }).map(function (k) {
    return { clave: k, cantidad: cantidades[k], texto: REPARACIONES_AL_CARGAR[k] };
  });
  return {
    total: filas.reduce(function (a, f) { return a + f.cantidad; }, 0),
    filas: filas,
    omitidas: !!state.reparacionesOmitidas
  };
}

// El informe como texto plano, para pegarlo en un mensaje o un correo.
export function textoInformeSalud(fecha) {
  var r = calcResumenSalud();
  var rep = calcReparacionesAlCargar();
  var lineas = ["Salud de los datos" + (fecha ? " — " + fecha : "")];
  lineas.push(r.hallazgos.length
    ? r.errores + " error(es) y " + r.avisos + " aviso(s). Se revisaron " + r.revisadas.length + " cosas."
    : "Todo cuadra. Se revisaron " + r.revisadas.length + " cosas.");
  [["error", "ERRORES"], ["aviso", "AVISOS"]].forEach(function (g) {
    var hs = r.hallazgos.filter(function (h) { return (h.severidad === "error") === (g[0] === "error"); });
    if (!hs.length) return;
    lineas.push("", g[1] + " (" + hs.length + ")");
    hs.forEach(function (h, i) {
      lineas.push((i + 1) + ". " + h.titulo, "   " + h.detalle, "   Dónde se arregla: " + h.donde);
      if (h.afectados.length) lineas.push("   Afecta: " + h.afectados.map(function (a) { return a.etiqueta || (a.tipo + " " + a.id); }).join("; "));
    });
  });
  lineas.push("");
  if (!rep.total) lineas.push(rep.omitidas ? "Al cargar: no se corrigió nada." : "Al cargar: la app no tuvo que corregir nada.");
  else {
    lineas.push("Al cargar, la app corrigió " + rep.total + " cosa(s) en silencio:");
    rep.filas.forEach(function (f) { lineas.push("- " + f.cantidad + " " + f.texto); });
  }
  if (rep.omitidas) lineas.push("Esta carga usó la copia sin conexión: las demás correcciones se saltaron y se reintentan al cargar con señal.");
  return lineas.join("\n");
}
