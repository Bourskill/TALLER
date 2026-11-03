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
  calcSaldosPorCuenta, transferenciasVigentes, existeCuenta, nombreCuenta, cuentaDeTx,
  calcDiferenciasCierre,
  // Hallazgo #66
  periodoDeEmpleado, calcSalarioPorPeriodo, calcPagosNominaEmpleado, calcComisionValor, calcComisionValorCot,
  calcComprasDesfasadasConFinanzas, comprasEnFinanzas, estimadoTxDeCot, esMiembroRecibo, estadoCompra,
  calcDifTotalesCotizacionPedido
} from "./calc.js";
import { entradasBitacora, estadoLecturaBitacora, tocadasDespuesDelCierre } from "./bitacora.js";
import { nombreMes } from "./cierre.js";

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
// Agrupa los movimientos por la clave que devuelve `clave(t)` (vacía = no entra).
function agruparTx(clave) {
  var m = {};
  state.tx.forEach(function (t) {
    var k = clave(t);
    if (k) (m[k] = m[k] || []).push(t);
  });
  return m;
}
// «2026-10-20» de una fecha que puede traer hora; "" si no es una fecha.
function dia(f) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(f == null ? "" : f));
  return m ? m[1] : "";
}
function pluralN(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

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
      // La fecha (Hallazgo #66): el movimiento se puede reeditar en Finanzas, y
      // si su fecha deja de ser la del abono, cada lado lo ubica en un día
      // (o un mes) distinto en los reportes y en el cierre de mes. Sin fecha en
      // alguno de los dos lados (abonos muy viejos) no hay con qué comparar.
      var diaAbono = dia(a.fecha), diaTx = dia(t.fecha);
      var fechaDistinta = !!diaAbono && !!diaTx && diaAbono !== diaTx;
      var cuandoFecha = fechaDistinta
        ? " El " + que + " dice " + diaAbono + " y su movimiento dice " + diaTx + (diaAbono.slice(0, 7) !== diaTx.slice(0, 7) ? " (caen en meses distintos)" : "") + "."
        : "";
      if (distinto(t.monto, a.monto)) {
        // Un solo problema, un solo hallazgo: si además la fecha difiere, se
        // dice aquí en vez de abrir un segundo aviso.
        out.push({
          clave: "monto:" + a.id, severidad: "error",
          titulo: "El " + que + " y su movimiento tienen montos distintos",
          detalle: etiquetaPedido(p) + ": el " + que + " dice " + fmt(a.monto) + cuando + " y su movimiento en Finanzas dice " + fmt(t.monto) + "." + cuandoFecha,
          afectados: [refPedido(p), refTx(t)]
        });
      } else if (fechaDistinta) {
        out.push({
          clave: "fecha:" + a.id, severidad: "aviso",
          titulo: "El " + que + " y su movimiento tienen fechas distintas",
          detalle: etiquetaPedido(p) + ": el " + que + " de " + fmt(a.monto) + " tiene fecha " + diaAbono + " y su movimiento en Finanzas tiene " + diaTx + (diaAbono.slice(0, 7) !== diaTx.slice(0, 7) ? ": caen en meses distintos" : "") + ". El monto sí coincide; corrige la fecha donde esté mal (editar el abono arregla los dos lados).",
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
// Lo que suman las líneas y descuentos de un pedido, o null si el pedido no se
// puede comparar (consignación, o sin líneas) o si su total sí sale de ellas.
// La comparte «Pedido contra su cotización», para no reportar dos veces el
// mismo total mal escrito.
function totalFueraDeLasLineas(p) {
  if (p.consignacion || !(p.lineas || []).length) return null;
  var d = calcDesglosePedido(p);
  var deLasLineas = d.netos.reduce(function (a, n) { return a + n; }, 0) - d.descuentoOrden;
  return Math.abs(deLasLineas - num(p.total)) <= 0.5 ? null : deLasLineas;
}
function verificarTotalesPedidos() {
  var out = [];
  state.pedidos.forEach(function (p) {
    var deLasLineas = totalFueraDeLasLineas(p);
    if (deLasLineas === null) return;
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
    id: "abono-movimiento", titulo: "Cada abono y reembolso, en Finanzas por el mismo monto y fecha",
    porque: "Cada abono que registras en un pedido tiene que aparecer también en Finanzas, por el mismo valor y el mismo día. Si no, la caja y el pedido cuentan plata distinta y no vas a poder cuadrar con el banco; y con otra fecha, los reportes y el cierre de mes lo ubican en otro día (o mes).",
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

// ---------------------------------------------------------------------------
// 12. Meses cerrados (Hallazgo #65)
// ---------------------------------------------------------------------------
// Un mes cerrado guardó, al cerrarse, lo que valía: ingresos, gastos, Caja al
// final del mes, saldo de cada cuenta. Dos formas de que eso deje de ser cierto
// (y por eso un UNICO hallazgo por mes, no uno por cada forma):
//  - los números de hoy ya no coinciden con los guardados (alguien cambió un
//    movimiento, una transferencia o una fecha de ese mes);
//  - la bitácora dice que algo con fecha en ese mes se tocó DESPUÉS del cierre.
//    Si lo hizo una persona es un error (la app no debió dejarlo: o se le
//    olvidó una acción, o se editó la Sheet directo); si lo hizo la app sola al
//    cargar (una reparación) es un aviso, porque no cambia ningún número.
// Solo lee: no reabre el mes ni corrige nada. Si la bitácora no se pudo leer,
// lo dice (aviso) en vez de callar: sin ella no se sabe quién tocó qué.
var MAX_AFECTADOS_MES = 300;
function verificarMesesCerrados() {
  var cerrados = (state.cierres || []).filter(function (c) { return c && c.estado === "cerrado"; });
  if (!cerrados.length) return [];
  var out = [];
  var lectura = estadoLecturaBitacora();
  var entradas = lectura.cargada ? entradasBitacora() : [];
  cerrados.forEach(function (c) {
    var motivos = [];
    var hayError = false;
    var mesTexto = nombreMes(c.mes);
    mesTexto = mesTexto.charAt(0).toUpperCase() + mesTexto.slice(1); // abre la frase: «Septiembre 2026 …»
    var difs = calcDiferenciasCierre(c);
    if (difs.length) {
      hayError = true;
      motivos.push("Hoy suma distinto de cuando se cerró: " + difs.map(function (d) {
        return d.etiqueta + " (cerró en " + (d.campo === "movimientos" ? d.guardado : fmt(d.guardado)) + ", hoy " + (d.campo === "movimientos" ? d.hoy : fmt(d.hoy)) + ")";
      }).join("; ") + ".");
    }
    var tocadas = tocadasDespuesDelCierre(c, entradas);
    var porPersona = tocadas.filter(function (e) { return e.origen !== "automatico"; });
    if (porPersona.length) {
      hayError = true;
      motivos.push("La bitácora dice que después del cierre " + porPersona.length + " cambio(s) tocaron su dinero: " + porPersona.slice(0, 3).map(function (e) {
        return (e.nombre || e.usuario || "alguien") + " — " + e.accion + " «" + e.etiqueta + "»" + (e.cambios ? " (" + e.cambios + ")" : "") + ", " + String(e.fecha).slice(0, 10);
      }).join("; ") + (porPersona.length > 3 ? "; y " + (porPersona.length - 3) + " más" : "") + ".");
    } else if (difs.length && lectura.cargada) {
      motivos.push("La bitácora no tiene ningún cambio de ese mes después del cierre: pudo editarse directo en la Google Sheet.");
    }
    var automaticas = tocadas.filter(function (e) { return e.origen === "automatico"; });
    if (automaticas.length) {
      motivos.push("Al cargar, la app corrigió sola " + automaticas.length + " dato(s) de ese mes (no cambia ningún número).");
    }
    if (!motivos.length) return;
    var afectados = [];
    var vistos = {};
    (state.tx || []).forEach(function (t) {
      if (String(t.fecha || "").slice(0, 7) === c.mes && afectados.length < MAX_AFECTADOS_MES) { vistos[t.id] = true; afectados.push(refTx(t)); }
    });
    out.push({
      clave: "mes:" + c.mes, severidad: hayError ? "error" : "aviso",
      titulo: mesTexto + " cambió después de cerrarse",
      detalle: mesTexto + " lo cerró " + (c.cerradoPorNombre || c.cerradoPor || "alguien") + " el " + String(c.cerradoEn || "").slice(0, 10) + ". " + motivos.join(" "),
      afectados: afectados
    });
  });
  if (!lectura.cargada) {
    out.push({
      clave: "bitacora-sin-leer", severidad: "aviso",
      titulo: "No se ha podido leer la bitácora para revisar los meses cerrados",
      detalle: lectura.cargando
        ? "Se está leyendo la bitácora; en unos segundos esta revisión queda completa."
        : "Sin la bitácora no se sabe si alguien tocó un mes cerrado después del cierre" + (lectura.error ? " (" + lectura.error + ")" : "") + ". Los números sí se compararon.",
      afectados: [], donde: "Finanzas → 📒 Bitácora (abrirla vuelve a intentar la lectura)"
    });
  }
  return out;
}
registrarVerificacion({
  id: "meses-cerrados", titulo: "Meses cerrados",
  porque: "Un mes cerrado es plata que ya se cuadró con el banco y los reportes. Si sus números cambiaron, o alguien lo tocó después de cerrarlo, lo que cerraste ya no es lo que hay.",
  donde: "Finanzas → 🔒 Cierre de mes (reabre el mes con un motivo, corrígelo y vuelve a cerrarlo) y 📒 Bitácora (quién lo tocó)",
  correr: verificarMesesCerrados
});

// ---------------------------------------------------------------------------
// 13. Nómina: lo pagado a cada persona en el periodo actual (Hallazgo #66)
// ---------------------------------------------------------------------------
// Decisión del dueño: solo el periodo EN CURSO y solo si se pagó de MÁS. Los
// pagos de periodos pasados no se comparan contra el sueldo de hoy (si le subió
// el sueldo a alguien, sus pagos viejos son distintos y están bien), y pagar de
// menos ya se ve en Pendientes como «falta pagar». Un pago por encima del
// sueldo queda explicado si su concepto dice «(+$X bono)» (así lo escribe la
// acción «Confirmar pago» de Pendientes). Un aviso, no un error: la plata de la
// caja sí coincide con la que salió; lo dudoso es si se debía pagar.
function bonoEscritoEnConcepto(concepto) {
  var m = /\(\+([^)]*?)bono\)/i.exec(String(concepto || ""));
  var digitos = m ? m[1].replace(/\D/g, "") : "";
  return digitos ? Number(digitos) : 0;
}
function verificarNomina() {
  var out = [];
  (state.config.nomina || []).forEach(function (e) {
    var periodo = periodoDeEmpleado(e);
    var salario = calcSalarioPorPeriodo(e, periodo);
    if (!(salario > 0)) return;
    var pagos = calcPagosNominaEmpleado(e, periodo);
    if (!pagos.length) return;
    var pagado = pagos.reduce(function (a, t) { return a + num(t.monto); }, 0);
    var bonos = pagos.reduce(function (a, t) { return a + bonoEscritoEnConcepto(t.concepto); }, 0);
    var exceso = pagado - salario - bonos;
    if (exceso < 1) return; // menos de un peso: los centavos de un pago de antes del #62
    out.push({
      clave: "nomina:" + e.id, severidad: "aviso",
      titulo: "A una persona se le pagó más de su sueldo en este periodo",
      detalle: (e.nombre || "Una persona") + ": en el periodo en curso (" + periodo + ") se le registraron " + pluralN(pagos.length, "pago", "pagos") + " por " + fmt(pagado) +
        ", y su sueldo del periodo es " + fmt(salario) + (bonos ? " más " + fmt(bonos) + " de bono escrito en los pagos" : "") + ": sobran " + fmt(exceso) +
        ". Si fue un bono, anótalo al pagar (así queda explicado); si fue un error o un pago repetido, corrígelo en Finanzas.",
      afectados: [{ tipo: "empleado", id: e.id, etiqueta: "Nómina · " + (e.nombre || "sin nombre") }].concat(pagos.map(refTx))
    });
  });
  return out;
}
registrarVerificacion({
  id: "nomina-periodo", titulo: "Nómina: lo pagado a cada persona en el periodo",
  porque: "A cada persona se le paga su sueldo del periodo (más el bono que anotes). Si en el periodo en curso se le pagó más de eso sin que el pago lo explique, puede ser un error de digitación o un pago repetido, y esa plata ya salió de la caja.",
  donde: "Pendientes → Nómina (o Finanzas → el movimiento → Editar)",
  correr: verificarNomina
});

// ---------------------------------------------------------------------------
// 14. Deudas: cuotas pagadas y sus movimientos (Hallazgo #66)
// ---------------------------------------------------------------------------
// «Pagar» una cuota hace tres cosas a la vez (pendientes.js): un movimiento de
// gasto con `deudaId`, una línea en `historial` con el `txId` de ese movimiento
// y +1 en `cuotasPagadas`. «Deshacer último pago» revierte las tres. Si no
// cuadran entre sí, la deuda ya no dice lo mismo que la caja.
//
// UN hallazgo por deuda, con todos sus motivos (no uno por cada forma de
// fallar). Es ERROR cuando un pago enlazado ya no está en Finanzas o su monto es
// otro, o cuando Finanzas tiene más pagos de los que la deuda registra (el
// siguiente «Pagar» cobraría una cuota ya pagada). Es AVISO cuando los números
// pueden ser de datos viejos: pagos de antes del historial (sin `txId`), cuotas
// que se bajaron al editar, o un monto de deuda que se cambió después.
function verificarDeudas() {
  var out = [];
  var porDeuda = agruparTx(function (t) { return t.deudaId; });
  var txPorId = indexarPorId(state.tx), enPapelera = indexarPorId(state.txPapelera);
  var activas = indexarPorId(state.deudas);
  var enHistorial = indexarPorId(state.deudasHistorial);
  var lista = state.deudas.map(function (d) { return { d: d, saldada: false }; })
    .concat(state.deudasHistorial.filter(function (d) { return !activas[d.id]; }).map(function (d) { return { d: d, saldada: true }; }));
  lista.forEach(function (x) {
    var d = x.d;
    if (!d || d.id == null) return;
    var cuotas = num(d.cuotas) || 1;
    var pagadas = Math.min(num(d.cuotasPagadas) || 0, cuotas);
    var lineas = d.historial || [];
    var txs = porDeuda[d.id] || [];
    var motivos = [], hayError = false, lineaRota = false;
    function marcar(esError, texto) { if (esError) hayError = true; motivos.push(texto); }

    lineas.forEach(function (l) {
      if (!l || !l.txId) return; // un pago de antes de que se guardara el txId: no hay con qué enlazarlo
      var t = txPorId[l.txId];
      var queFue = fmt(l.monto) + (l.fecha ? " del " + l.fecha : "");
      if (!t) {
        lineaRota = true;
        marcar(true, "El pago de " + queFue + " ya no está en Finanzas" + (enPapelera[l.txId] ? " (su movimiento está en la papelera)" : "") + ": la caja no sabe que esa plata salió.");
      } else if (t.deudaId !== d.id) {
        lineaRota = true;
        marcar(true, "El movimiento del pago de " + queFue + " no está marcado como de esta deuda.");
      } else if (distinto(t.monto, l.monto)) {
        lineaRota = true;
        marcar(true, "El pago de " + queFue + " tiene en Finanzas otro monto (" + fmt(t.monto) + ").");
      }
    });
    var registrados = Math.max(lineas.length, pagadas);
    if (txs.length > registrados) {
      marcar(true, "Finanzas tiene " + pluralN(txs.length, "pago", "pagos") + " de esta deuda y ella solo registra " + registrados + ": el siguiente «Pagar» cobraría una cuota que ya se pagó.");
    } else if (!lineaRota && pagadas > txs.length) {
      marcar(false, "Dice " + pagadas + " de " + cuotas + " cuotas pagadas pero Finanzas solo tiene " + pluralN(txs.length, "movimiento", "movimientos") + " de pago. Es normal solo si pagaste cuotas antes de que la app registrara cada pago, o si las anotaste como un gasto suelto.");
    }
    // Más pagos en el historial que cuotas pagadas (y no es una deuda a la que
    // se le bajaron las cuotas, que queda con todas pagadas): el siguiente
    // «Pagar» cobraría una cuota ya pagada.
    if (lineas.length > pagadas && pagadas < cuotas) {
      marcar(false, "Su historial registra " + pluralN(lineas.length, "pago", "pagos") + " pero dice " + pagadas + " de " + cuotas + " cuotas pagadas: el siguiente «Pagar» cobraría una cuota que ya se pagó.");
    }
    var pagado = txs.reduce(function (a, t) { return a + num(t.monto); }, 0);
    if (pagado > num(d.monto) + 1) {
      marcar(false, "En Finanzas se pagaron " + fmt(pagado) + " en cuotas de esta deuda, más que su monto total (" + fmt(d.monto) + "). Puede ser que el monto se cambiara después de pagar.");
    }
    if (x.saldada && pagadas < cuotas) {
      marcar(false, "Está en el historial de deudas saldadas pero dice " + pagadas + " de " + cuotas + " cuotas pagadas.");
    }
    if (!x.saldada && pagadas >= cuotas) {
      marcar(false, "Sigue en las deudas activas pero ya tiene todas sus cuotas pagadas: «Por pagar» todavía cuenta una cuota de ella.");
    }
    if (enHistorial[d.id] && !x.saldada) {
      marcar(false, "Aparece también en el historial de deudas saldadas.");
    }
    if (!motivos.length) return;
    out.push({
      clave: "deuda:" + d.id, severidad: hayError ? "error" : "aviso",
      titulo: "Una deuda y sus pagos en Finanzas no coinciden",
      detalle: "«" + (d.concepto || "Deuda sin nombre") + "»" + (d.contraparte ? " (con " + d.contraparte + ")" : "") + ". " + motivos.join(" "),
      afectados: [{ tipo: "deuda", id: d.id, etiqueta: "Deuda · " + (d.concepto || "sin nombre") + (x.saldada ? " (saldada)" : "") }].concat(txs.map(refTx))
    });
  });
  return out;
}
registrarVerificacion({
  id: "deuda-pagos", titulo: "Deudas: cuotas pagadas y sus movimientos",
  porque: "Cada cuota que pagas de una deuda es un gasto en Finanzas y una cuota más pagada. Si la deuda y Finanzas cuentan pagos distintos, la caja o lo que debes está mal, y el siguiente «Pagar» puede cobrar una cuota que ya pagaste.",
  donde: "Pendientes → Deudas (o su historial) → «↩ Deshacer último pago», o Editar la deuda",
  correr: verificarDeudas
});

// ---------------------------------------------------------------------------
// 15. Compras «Sí» de una cotización contra su movimiento (Hallazgo #66)
// ---------------------------------------------------------------------------
// Una compra marcada «Sí» (pagada aparte, fuera de un recibo) tiene que estar
// en Finanzas por su costo; al guardar la cotización se lleva sola (#58). La
// cuenta es la MISMA que usa la cotización para su aviso
// (calcComprasDesfasadasConFinanzas). Aviso y no error: una cotización marcada
// antes del #58 nunca llevó sus compras, y si el gasto se anotó a mano en
// Finanzas, «ponerla al día» lo contaría dos veces.
// No se señala: la cotización abierta con cambios sin guardar (se pone al día
// al guardar); la que tiene el estimado completo registrado (ahí las compras no
// se llevan A PROPÓSITO; si además hay compras en Finanzas lo dice la
// verificación siguiente); ni una compra con dos movimientos (es un duplicado
// y ya lo dice «Movimientos duplicados»).
function hayComprasQueMirar(c, txC) {
  return (c.compras || []).some(function (co) { return !esMiembroRecibo(co) && estadoCompra(co) === "si"; }) ||
    txC.some(function (t) { return !t.reciboCompraId && (t.origenCompraClave || t.origenCompraExcedenteClave); });
}
function verificarComprasEnFinanzas() {
  var out = [];
  var porCot = agruparTx(function (t) { return t.cotizacionId; });
  state.cotizaciones.forEach(function (c) {
    if (c.id === state.cotSucia) return;
    var txC = porCot[c.id] || [];
    if (estimadoTxDeCot(c, txC) || !hayComprasQueMirar(c, txC)) return;
    var desfasadas = calcComprasDesfasadasConFinanzas(c, txC).filter(function (d) {
      return txC.filter(function (t) { return !t.reciboCompraId && t.origenCompraClave === d.compra.clave; }).length < 2;
    });
    if (!desfasadas.length) return;
    var claves = desfasadas.map(function (d) { return d.compra.clave; });
    out.push({
      clave: "compras:" + c.id, severidad: "aviso",
      titulo: "Compras de una cotización que no coinciden con Finanzas",
      detalle: refCot(c).etiqueta + ": " + pluralN(desfasadas.length, "compra no coincide", "compras no coinciden") + " con Finanzas. " +
        desfasadas.slice(0, 4).map(function (d) {
          return "«" + d.nombre + "» debería tener " + fmt(d.esperado) + " en Finanzas y tiene " + fmt(d.enFinanzas);
        }).join("; ") + (desfasadas.length > 4 ? "; y " + (desfasadas.length - 4) + " más" : "") +
        ". Una compra marcada «Sí» va a Finanzas al guardar la cotización. Si ese gasto ya lo anotaste a mano en Finanzas, bórralo ahí antes de ponerla al día, o se contaría dos veces.",
      afectados: [refCot(c)].concat(txC.filter(function (t) {
        return !t.reciboCompraId && (claves.indexOf(t.origenCompraClave) !== -1 || claves.indexOf(t.origenCompraExcedenteClave) !== -1);
      }).map(refTx))
    });
  });
  return out;
}
registrarVerificacion({
  id: "compras-finanzas", titulo: "Compras «Sí» de las cotizaciones y su movimiento",
  porque: "Una compra marcada «Sí» ya se pagó: tiene que estar en Finanzas por lo que costó. Si no está (o está por otro valor), «Pagado» en la cotización y la caja cuentan cosas distintas.",
  donde: "Cotizaciones → la cotización → Compras → «Actualizar movimientos financieros» (o Guardar)",
  correr: verificarComprasEnFinanzas
});

// ---------------------------------------------------------------------------
// 16. El costo estimado completo y las compras reales a la vez (Hallazgo #66)
// ---------------------------------------------------------------------------
// «Registrar estimado completo» mete el costo de TODO el pedido como un solo
// gasto; las compras reales llevan ese mismo costo pieza por pieza. Con los
// dos, el costo de ese pedido está dos veces en la caja y en los reportes.
// Decisión del dueño: es un ERROR (no se hace a propósito).
function verificarEstimadoDoble() {
  var out = [];
  var porCot = agruparTx(function (t) { return t.cotizacionId; });
  state.cotizaciones.forEach(function (c) {
    if (!c.estimadoTxId) return;
    var txC = porCot[c.id] || [];
    var estimado = estimadoTxDeCot(c, txC);
    if (!estimado || !(num(estimado.monto) > 0)) return;
    var reales = comprasEnFinanzas(c, txC);
    if (!(reales.costoPedido >= 0.5)) return;
    out.push({
      clave: "estimado:" + c.id, severidad: "error",
      titulo: "El costo de un pedido está dos veces: estimado y compras reales",
      detalle: refCot(c).etiqueta + ": el costo estimado completo (" + fmt(estimado.monto) + ") está registrado en Finanzas y además hay " + fmt(reales.costoPedido) +
        " en compras reales (sueltas o de un recibo). Ese costo se cuenta dos veces en la caja y en los reportes. Borra el movimiento del estimado en Finanzas y quédate con las compras reales.",
      afectados: [refCot(c), refTx(estimado)].concat(reales.sueltas.map(refTx))
    });
  });
  return out;
}
registrarVerificacion({
  id: "estimado-doble", titulo: "Costo estimado y compras reales a la vez",
  porque: "El costo estimado completo y las compras reales son dos formas de registrar el mismo costo del pedido. Con las dos a la vez, ese costo está contado dos veces y la caja queda más baja de lo real.",
  donde: "Finanzas → buscar «Estimado completo del pedido» → borrar ese movimiento",
  correr: verificarEstimadoDoble
});

// ---------------------------------------------------------------------------
// 17. Consignación: las ventas y la comisión del punto (Hallazgo #66)
// ---------------------------------------------------------------------------
// Cada venta que reporta el punto tiene su ingreso en Finanzas
// (origenVentaConsignacionId) y, si su comisión está «pagada», un gasto
// (origenComisionConsignacionId) por el monto de esa comisión. Es lo mismo que
// los abonos, y con la misma gravedad.
//
// OJO, datos viejos: estas dos marcas se PERDÍAN en cada recarga hasta
// septiembre de 2026 (les faltaba la columna en la hoja, Hallazgo #19/#20), así
// que una venta anterior puede tener su movimiento sin marca. Por eso, si no hay
// un movimiento marcado, se busca uno SIN marca del mismo pedido con el mismo
// monto: si existe, la venta se da por respaldada.
function sinMarcaDeOrigen(t) {
  return MARCAS_ORIGEN_SISTEMA.every(function (m) { return !t[m.campo]; });
}
function verificarConsignacion() {
  var out = [];
  var porVenta = agruparTx(function (t) { return t.origenVentaConsignacionId; });
  var porComision = agruparTx(function (t) { return t.origenComisionConsignacionId; });
  var sinMarca = agruparTx(function (t) { return t.pedidoId && sinMarcaDeOrigen(t) ? t.pedidoId : ""; });
  state.pedidos.forEach(function (p) {
    if (!p.consignacion) return;
    var usados = {};
    // Un movimiento sin marca solo respalda UNA venta (si no, dos ventas del
    // mismo valor se taparían con un único movimiento).
    function respaldoSinMarca(tipo, monto) {
      var c = (sinMarca[p.id] || []).filter(function (t) { return !usados[t.id] && t.tipo === tipo && !distinto(t.monto, monto); })[0];
      if (c) usados[c.id] = true;
      return !!c;
    }
    (p.consignacion.ventas || []).forEach(function (v) {
      if (!v || v.id == null) return;
      var cuando = v.fecha ? " del " + v.fecha : "";
      var rotulo = etiquetaPedido(p) + ": la venta" + cuando + " de " + pluralN(num(v.cantidad), "unidad", "unidades") + " por " + fmt(v.montoTotal);
      // El ingreso de la venta. Si el movimiento marcado cuelga de OTRO pedido,
      // lo reporta «Movimientos cuyo origen ya no existe»; con dos, el duplicado.
      var todos = porVenta[v.id] || [];
      var propios = todos.filter(function (t) { return t.pedidoId === p.id; });
      if (!todos.length) {
        if (num(v.montoTotal) > 0 && !respaldoSinMarca("ingreso", v.montoTotal)) {
          out.push({
            clave: "sin-ingreso:" + v.id, severidad: "error",
            titulo: "Una venta de consignación no está en Finanzas",
            detalle: rotulo + " no tiene su ingreso en Finanzas, así que la caja no cuenta esa plata.",
            afectados: [refPedido(p)]
          });
        }
      } else if (propios.length === 1 && distinto(propios[0].monto, v.montoTotal)) {
        out.push({
          clave: "monto-venta:" + v.id, severidad: "error",
          titulo: "Una venta de consignación y su ingreso tienen montos distintos",
          detalle: rotulo + "; su ingreso en Finanzas dice " + fmt(propios[0].monto) + ".",
          afectados: [refPedido(p), refTx(propios[0])]
        });
      }
      // La comisión del punto.
      var cs = porComision[v.id] || [];
      var cp = cs.filter(function (t) { return t.pedidoId === p.id; });
      if (v.comisionPagada) {
        if (!cs.length) {
          if (num(v.comisionMonto) > 0 && !respaldoSinMarca("gasto", v.comisionMonto)) {
            out.push({
              clave: "comision-sin-movimiento:" + v.id, severidad: "error",
              titulo: "La comisión de un punto figura pagada pero no está en Finanzas",
              detalle: rotulo + ": su comisión de " + fmt(v.comisionMonto) + " está marcada como pagada, pero Finanzas no tiene ese gasto. Esa plata salió y la caja no lo sabe.",
              afectados: [refPedido(p)]
            });
          }
        } else if (cp.length === 1 && distinto(cp[0].monto, v.comisionMonto)) {
          out.push({
            clave: "comision-monto:" + v.id, severidad: "error",
            titulo: "La comisión pagada a un punto y su movimiento tienen montos distintos",
            detalle: rotulo + ": su comisión pagada es " + fmt(v.comisionMonto) + " y el gasto en Finanzas dice " + fmt(cp[0].monto) + ".",
            afectados: [refPedido(p), refTx(cp[0])]
          });
        }
      } else if (cp.length) {
        out.push({
          clave: "comision-sin-pago:" + v.id, severidad: "error",
          titulo: "Finanzas tiene la comisión de un punto pagada que la venta no tiene como pagada",
          detalle: rotulo + ": su comisión sigue pendiente, pero Finanzas ya tiene un gasto de " + fmt(cp[0].monto) + " por ella: se puede volver a pagar.",
          afectados: [refPedido(p)].concat(cp.map(refTx))
        });
      }
    });
  });
  return out;
}
registrarVerificacion({
  id: "consignacion", titulo: "Consignación: ventas y comisión del punto",
  porque: "Cada venta que reporta un punto de consignación es plata que entra, y su comisión es plata que sale. Si la venta o la comisión no están en Finanzas por el mismo valor, la caja y el pedido cuentan cosas distintas.",
  donde: "Pedidos → tarjeta de la consignación → Ventas reportadas (anular la venta retira sus dos movimientos)",
  correr: verificarConsignacion
});

// ---------------------------------------------------------------------------
// 18. El total del pedido contra su cotización de origen (Hallazgo #66)
// ---------------------------------------------------------------------------
// Un pedido convertido de una cotización es una foto de ella al convertir. Si la
// cotización cambia después (o el pedido se toca por su lado) y no se
// sincronizan, el total del pedido deja de ser lo que dice su cotización. Es la
// misma cuenta de calcDesfaseCotizacionPedido (solo el total y el descuento;
// el costo y la cantidad no son plata de la caja). Solo mira `pedidoId`: una
// cotización escalada es un borrador hasta «Aplicar a pedido». Aviso: la
// cotización pudo cambiarse a propósito y falta sincronizarla.
// No se señala la cotización abierta con cambios sin guardar, ni un pedido que
// ya señala «El total de cada pedido contra sus líneas» (un solo total mal
// escrito, un solo hallazgo).
function verificarTotalContraCotizacion() {
  var out = [];
  var pedidos = indexarPorId(state.pedidos);
  state.cotizaciones.forEach(function (c) {
    if (!c.pedidoId || c.id === state.cotSucia) return;
    var p = pedidos[c.pedidoId];
    if (!p || p.consignacion || totalFueraDeLasLineas(p) !== null) return;
    var d = calcDifTotalesCotizacionPedido(c, p);
    if (Math.abs(d.difTotal) <= 0.5 && Math.abs(d.difDescuento) <= 0.5) return;
    out.push({
      clave: "cotizacion:" + c.id, severidad: "aviso",
      titulo: "El total del pedido no es el de su cotización",
      detalle: etiquetaPedido(p) + ": el pedido tiene un total de " + fmt(p.total) + " y su cotización «" + (c.descripcion || c.cliente || "sin nombre") + "» hoy suma " + fmt(d.totalCot) +
        (Math.abs(d.difTotal) > 0.5 ? " (diferencia " + fmt(d.difTotal) + ")" : " (el total es igual pero el descuento se reparte distinto)") +
        ". El IVA, el saldo y la comisión del pedido salen de su total. Si el cambio fue a propósito, sincroniza el pedido; si no, devuélvele a la cotización su valor.",
      afectados: [refPedido(p), refCot(c)]
    });
  });
  return out;
}
registrarVerificacion({
  id: "total-cotizacion", titulo: "El pedido contra su cotización de origen",
  porque: "El pedido toma su precio de la cotización con que se creó. Si la cotización cambió y el pedido no (o al revés), el pedido cobra un valor que la cotización ya no dice.",
  donde: "Cotizaciones → la cotización → «Sincronizar con el pedido» (o Aplicar a pedido)",
  correr: verificarTotalContraCotizacion
});

// ---------------------------------------------------------------------------
// 19. Lo que está en la papelera (Hallazgo #66)
// ---------------------------------------------------------------------------
// Eliminar un pedido manda el pedido a su papelera y sus movimientos a la de
// Finanzas (con `eliminadoConPedido`); restaurarlo los devuelve juntos. Eliminar
// una cotización manda los suyos con `eliminadoConCotizacion` (las cotizaciones
// no tienen papelera). Esto señala lo que ya no cuadra con esa mecánica. Todo
// es AVISO: la papelera no cuenta en la caja ni en los reportes, el riesgo es
// restaurar algo que duplique o deje sin respaldo.
// NO se compara contra las filas de un recibo anulado: sus ids son fijos (se
// vuelven a usar al registrar el recibo otra vez) y estar en los dos lados es lo
// normal. Y no se repite lo que ya dice otra verificación (un pedido restaurado
// cuyo abono quedó sin movimiento lo señala «Cada abono y reembolso…»).
function refTxPapelera(t) { return { tipo: "papelera-movimiento", id: t.id, etiqueta: etiquetaTx(t) + " · en la papelera" }; }
function yaLoDiceOtraVerificacion(t, p) {
  var hayTx = function (campo, id) { return state.tx.some(function (x) { return x[campo] === id; }); };
  if (t.origenAbonoId || t.origenReembolsoId) {
    var id = t.origenAbonoId || t.origenReembolsoId, campo = t.origenAbonoId ? "origenAbonoId" : "origenReembolsoId";
    return (p.abonos || []).some(function (a) { return a.id === id; }) && !hayTx(campo, id);
  }
  if (t.origenComisionPedidoId) return estadoComisionPedido(p) === "pagada" && !hayTx("origenComisionPedidoId", t.origenComisionPedidoId);
  var vId = t.origenVentaConsignacionId || t.origenComisionConsignacionId;
  if (vId) {
    var venta = ((p.consignacion && p.consignacion.ventas) || []).filter(function (v) { return v.id === vId; })[0];
    if (!venta) return false;
    return t.origenVentaConsignacionId ? !hayTx("origenVentaConsignacionId", vId) : (!!venta.comisionPagada && !hayTx("origenComisionConsignacionId", vId));
  }
  return false;
}
function verificarPapelera() {
  var out = [];
  var vivos = indexarPorId(state.pedidos), enPapelera = indexarPorId(state.pedidosPapelera);
  var cots = indexarPorId(state.cotizaciones), txVivos = indexarPorId(state.tx);
  (state.pedidosPapelera || []).forEach(function (p) {
    if (!p || !vivos[p.id]) return;
    out.push({
      clave: "pedido-doble:" + p.id, severidad: "aviso",
      titulo: "Un pedido está a la vez entre los activos y en la papelera",
      detalle: etiquetaPedido(vivos[p.id]) + " existe en la lista de pedidos y también en su papelera. Si lo restauras desde la papelera quedaría repetido; conviene borrar para siempre la copia de la papelera.",
      afectados: [refPedido(vivos[p.id]), { tipo: "papelera-pedido", id: p.id, etiqueta: etiquetaPedido(p) + " · en la papelera" }]
    });
  });
  (state.txPapelera || []).forEach(function (t) {
    if (!t || t.id == null) return;
    var deRecibo = t.reciboCompraId || t.eliminadoConRecibo;
    if (!deRecibo && txVivos[t.id]) {
      out.push({
        clave: "tx-doble:" + t.id, severidad: "aviso",
        titulo: "Un movimiento está a la vez en Finanzas y en la papelera",
        detalle: etiquetaTx(t) + " está en la lista de movimientos y también en la papelera. Si lo restauras quedaría repetido y la caja contaría esa plata dos veces; conviene borrar para siempre la copia de la papelera.",
        afectados: [refTx(txVivos[t.id]), refTxPapelera(t)]
      });
      return;
    }
    var pid = t.eliminadoConPedido;
    if (pid && vivos[pid]) {
      if (yaLoDiceOtraVerificacion(t, vivos[pid])) return;
      out.push({
        clave: "tx-pedido-vivo:" + t.id, severidad: "aviso",
        titulo: "Un movimiento de la papelera pertenece a un pedido que ya está activo",
        detalle: etiquetaTx(t) + " se fue a la papelera junto con " + etiquetaPedido(vivos[pid]) + ", pero ese pedido ya fue restaurado y el movimiento se quedó allá. Si lo restauras, puede quedar repetido o sin el abono/comisión al que correspondía.",
        afectados: [refPedido(vivos[pid]), refTxPapelera(t)]
      });
    } else if (pid && !enPapelera[pid]) {
      out.push({
        clave: "tx-sin-pedido:" + t.id, severidad: "aviso",
        titulo: "Un movimiento de la papelera perdió su pedido",
        detalle: etiquetaTx(t) + " se fue a la papelera junto con un pedido que ya no existe (ni activo ni en la papelera). Si lo restauras queda suelto, sin nada que lo respalde.",
        afectados: [refTxPapelera(t)]
      });
    }
    var cid = t.eliminadoConCotizacion;
    if (cid && cots[cid]) {
      out.push({
        clave: "tx-cot-viva:" + t.id, severidad: "aviso",
        titulo: "Un movimiento de la papelera pertenece a una cotización que sigue existiendo",
        detalle: etiquetaTx(t) + " se fue a la papelera cuando se eliminó una cotización, pero " + refCot(cots[cid]).etiqueta + " sigue existiendo (una cotización eliminada no se puede restaurar).",
        afectados: [refCot(cots[cid]), refTxPapelera(t)]
      });
    }
  });
  return out;
}
registrarVerificacion({
  id: "papelera", titulo: "Lo que hay en la papelera",
  porque: "Lo que está en la papelera no cuenta en la caja, pero se puede restaurar. Si un pedido o un movimiento está en los dos lados, o quedó separado de lo que lo originó, restaurarlo puede duplicar plata o dejarla sin respaldo.",
  donde: "Pedidos → 🗑 Papelera, y Finanzas → 🗑 Papelera (restaurar o borrar para siempre)",
  correr: verificarPapelera
});

// ---------------------------------------------------------------------------
// 20. Comisión ya pagada contra la fórmula de hoy (Hallazgo #66)
// ---------------------------------------------------------------------------
// Por regla del #62 un movimiento conserva lo que se PAGÓ aunque el pedido cambie
// después (un descuento, otro total, otro porcentaje): la app nunca lo toca. Esto
// solo lo hace visible, a pedido del dueño, y siempre como AVISO informativo.
// Un solo movimiento por pedido/cotización (con dos lo dice «Comisiones…»), y
// una diferencia de menos de un peso (centavos de antes del #62) no cuenta.
function verificarComisionContraFormula() {
  var out = [];
  var porPedido = agruparTx(function (t) { return t.origenComisionPedidoId; });
  var porCot = agruparTx(function (t) { return t.origenComisionCotId; });
  state.pedidos.forEach(function (p) {
    if (estadoComisionPedido(p) !== "pagada" || (porPedido[p.id] || []).length !== 1) return;
    var t = porPedido[p.id][0], hoy = calcComisionValor(p);
    if (Math.abs(num(t.monto) - hoy) < 1) return;
    out.push({
      clave: "pedido:" + p.id, severidad: "aviso",
      titulo: "La comisión pagada no es la que daría hoy la fórmula",
      detalle: etiquetaPedido(p) + ": a " + p.vendedor.nombre + " se le pagó " + fmt(t.monto) + " y con el total y el porcentaje de hoy daría " + fmt(hoy) + " (" + (hoy > num(t.monto) ? "faltarían " : "sobrarían ") + fmt(Math.abs(hoy - num(t.monto))) + "). Es solo informativo: la app no cambia lo ya pagado. Pasa cuando el pedido cambió después de pagar (un descuento, otro total).",
      afectados: [refPedido(p), refTx(t)]
    });
  });
  state.cotizaciones.forEach(function (c) {
    if (estadoComisionCot(c) !== "pagada" || (porCot[c.id] || []).length !== 1) return;
    var pid = pedidoIdDeCotParaTx(c);
    if (pid && (porPedido[pid] || []).length) return; // pagada también desde el pedido: es un duplicado
    var t = porCot[c.id][0], hoy = calcComisionValorCot(c);
    if (Math.abs(num(t.monto) - hoy) < 1) return;
    out.push({
      clave: "cot:" + c.id, severidad: "aviso",
      titulo: "La comisión pagada no es la que daría hoy la fórmula",
      detalle: refCot(c).etiqueta + ": a " + c.vendedor.nombre + " se le pagó " + fmt(t.monto) + " y con los precios y el porcentaje de hoy daría " + fmt(hoy) + " (" + (hoy > num(t.monto) ? "faltarían " : "sobrarían ") + fmt(Math.abs(hoy - num(t.monto))) + "). Es solo informativo: la app no cambia lo ya pagado.",
      afectados: [refCot(c), refTx(t)]
    });
  });
  return out;
}
registrarVerificacion({
  id: "comision-formula", titulo: "Comisión pagada contra la fórmula de hoy",
  porque: "Una comisión pagada se queda como se pagó aunque el pedido cambie después. Si hoy la fórmula daría otro valor, puede que le hayas pagado de más o de menos al vendedor; esto solo te lo hace ver, no cambia nada.",
  donde: "Pedidos (o Cotizaciones) → el vendedor: si hay que ajustar, se hace con un movimiento aparte en Finanzas",
  correr: verificarComisionContraFormula
});

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
