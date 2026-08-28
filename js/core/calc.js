// Todo lo que se "calcula" a partir del estado vive aquí, separado del render.
// Ventaja para el futuro: se pueden probar estas funciones de forma aislada
// (son puras salvo por leer `state`) y reutilizarlas en reportes/exportaciones
// sin arrastrar código de HTML.

import { state } from "./store.js";
import { num, norm, todayStr, diasPagoDe } from "./utils.js";
import { ESTADOS_DEFAULT, UNIDAD_SERVICIO } from "./constants.js";

// Flujo por defecto para una referencia "comprada a proveedor" (sin fases de
// producción propias en el taller) — a diferencia de ESTADOS_DEFAULT (5
// etapas de producción real), acá solo hay que saber si ya llegó o no.
var ESTADOS_PROVEEDOR_DEFAULT = [
  { id: "pendiente", label: "Pendiente proveedor" },
  { id: "recibido", label: "Recibido" }
];

// ---------- estados de producción por pedido ----------
// Un pedido puede traer su propio flujo de estados (definido desde la
// cotización de origen, ver cotizaciones.js: c.estadosDef) porque no todas
// las prendas pasan por las mismas etapas. Si no trae uno propio, se usa el
// flujo por defecto de toda la app.
export function estadosDefDe(p) {
  return (p && p.estadosDef && p.estadosDef.length) ? p.estadosDef : ESTADOS_DEFAULT;
}
export function estadoLabelDe(p) {
  var def = estadosDefDe(p);
  var found = def.filter(function (e) { return e.id === p.estado; })[0];
  return found ? found.label : (p.estado || "—");
}

// ---------- estados de producción por REFERENCIA (dentro de una cotización) ----------
// Cada referencia de una cotización puede llevar su propio flujo (ver
// cotizaciones.js: renderEstadosRef) y, una vez el pedido entra a producción,
// su propio progreso — no todas las piezas de un mismo pedido avanzan al
// mismo ritmo (ver pedidos.js, que ya no muestra un solo "tape" para todo el
// pedido sino el progreso de cada referencia).
export function estadosDefDeRef(ref) {
  if (ref && ref.estadosDef && ref.estadosDef.length) return ref.estadosDef;
  if (ref && ref.origen === "proveedor") return ESTADOS_PROVEEDOR_DEFAULT;
  return ESTADOS_DEFAULT;
}
export function estadoIdxRef(ref) {
  var def = estadosDefDeRef(ref);
  var idx = def.map(function (e) { return e.id; }).indexOf(ref.estado);
  return idx < 0 ? 0 : idx;
}
// El pedido en sí sigue guardando un solo `estado`/`estadosDef` (de eso
// dependen el filtro por etapa, el KPI "Pedidos activos" y el PDF de
// producción — no vale la pena rehacerlos ahora mismo) — pero ese valor deja
// de editarse directo: se recalcula solo a partir de la referencia MENOS
// avanzada cada vez que una referencia avanza o retrocede (ver pedidos.js:
// "advance-ref"/"retreat-ref"), para que un pedido nunca aparezca "más
// adelantado" de lo que en verdad está su pieza más atrasada.
export function estadoAgregadoDeCot(cot) {
  var refs = (cot && cot.referencias) || [];
  if (!refs.length) return null;
  var peor = refs[0], peorIdx = estadoIdxRef(refs[0]);
  refs.forEach(function (r) {
    var idx = estadoIdxRef(r);
    if (idx < peorIdx) { peor = r; peorIdx = idx; }
  });
  var def = estadosDefDeRef(peor);
  return { estado: def[peorIdx].id, estadosDef: (peor.estadosDef && peor.estadosDef.length) ? peor.estadosDef : null };
}

// ---------- finanzas ----------
// Un movimiento registrado en Finanzas SIEMPRE es dinero que ya se movió: no
// existe más el estado "pendiente" a nivel de movimiento (ver README,
// "Registro de cambios"). Lo que el cliente aún debe vive en el saldo del
// pedido (por cobrar); lo que el taller aún debe vive en Pendientes (gastos
// fijos, nómina, deudas, comisiones) — nunca como un tx a medias.
export function calcCaja() {
  return state.tx.reduce(function (acc, t) {
    return t.tipo === "ingreso" ? acc + num(t.monto) : acc - num(t.monto);
  }, 0);
}
export function calcIngresosTotales() {
  return state.tx
    .filter(function (t) { return t.tipo === "ingreso"; })
    .reduce(function (a, t) { return a + num(t.monto); }, 0);
}
export function calcGastosTotales() {
  return state.tx
    .filter(function (t) { return t.tipo === "gasto"; })
    .reduce(function (a, t) { return a + num(t.monto); }, 0);
}
export function calcNominaPagada() {
  return state.tx
    .filter(function (t) { return t.tipo === "nomina"; })
    .reduce(function (a, t) { return a + num(t.monto); }, 0);
}
// Mismo criterio de categorización que usaba (por separado, con su propia
// copia del cálculo) el PDF de reporte financiero — se extrajo acá para que
// el reporte EN VIVO de Configuración y el PDF nunca puedan mostrar números
// distintos para el mismo rango de movimientos.
export function calcResumenMovimientos(movimientos) {
  var ingresos = 0, gastos = 0, nomina = 0, comisiones = 0, insumosReales = 0;
  (movimientos || []).forEach(function (t) {
    var v = num(t.monto);
    if (t.tipo === "ingreso") ingresos += v;
    else if (t.tipo === "nomina") { gastos += v; nomina += v; }
    else if (t.tipo === "comision") { gastos += v; comisiones += v; }
    else {
      gastos += v;
      // insumosReales es un DESGLOSE dentro de "gastos" (compras de insumo
      // reales, marcadas desde "Registrar costo real" en cotización o desde
      // el checkbox "Es compra de insumo" en Finanzas) — no se suma aparte,
      // solo se separa para mostrarla como sub-línea del reporte.
      if (t.esInsumo) insumosReales += v;
    }
  });
  return { ingresos: ingresos, gastos: gastos, nomina: nomina, comisiones: comisiones, insumosReales: insumosReales, balance: ingresos - gastos };
}
// Agrupa los movimientos de un rango en puntos para graficar ingresos vs.
// gastos — la granularidad se adapta al tamaño del rango (día si es corto,
// semana o mes si es largo) para que un año completo no intente dibujar
// 365 barras.
export function calcSerieMovimientos(movimientos, desde, hasta) {
  var dIni = new Date(desde + "T00:00:00"), dFin = new Date(hasta + "T00:00:00");
  var dias = Math.max(1, Math.round((dFin - dIni) / 86400000) + 1);
  var granularidad = dias <= 31 ? "dia" : dias <= 180 ? "semana" : "mes";
  function clave(fechaStr) {
    if (granularidad === "dia") return fechaStr;
    if (granularidad === "mes") return fechaStr.slice(0, 7);
    var d = new Date(fechaStr + "T00:00:00");
    var dow = (d.getDay() + 6) % 7; // lunes = 0
    var lunes = new Date(d); lunes.setDate(d.getDate() - dow);
    return lunes.getFullYear() + "-" + String(lunes.getMonth() + 1).padStart(2, "0") + "-" + String(lunes.getDate()).padStart(2, "0");
  }
  var mapa = {};
  (movimientos || []).forEach(function (t) {
    var k = clave(t.fecha);
    if (!mapa[k]) mapa[k] = { clave: k, ingresos: 0, gastos: 0 };
    var v = num(t.monto);
    if (t.tipo === "ingreso") mapa[k].ingresos += v; else mapa[k].gastos += v;
  });
  var claves = Object.keys(mapa).sort();
  return { granularidad: granularidad, puntos: claves.map(function (k) { return mapa[k]; }) };
}
// Un movimiento generado POR el sistema (abono, comisión, pago de gasto
// fijo/deuda...) siempre tiene un registro real del que salió — a
// diferencia de un movimiento cargado a mano desde "Registrar movimiento",
// que no tiene ninguno. Esto se usa para dos cosas en Finanzas: mostrar un
// botón "Ver origen" que navegue hasta ese registro, y BLOQUEAR la edición
// de tipo/monto en esos movimientos (cambiarlos a mano desincroniza la
// plata del taller de lo que ese pedido/comisión/deuda dice que pasó de
// verdad — ver el "Registro de cambios" sobre por qué esto importa).
export function origenDeTx(t) {
  if (t.pedidoId) {
    var p = state.pedidos.filter(function (x) { return x.id === t.pedidoId; })[0] ||
      state.pedidosPapelera.filter(function (x) { return x.id === t.pedidoId; })[0];
    if (p) return { tipo: "pedido", id: p.id, label: (p.numeroOp || "Pedido") + " — " + p.descripcion };
  }
  if (t.cotizacionId) {
    var c = state.cotizaciones.filter(function (x) { return x.id === t.cotizacionId; })[0];
    if (c) return { tipo: "cotizacion", id: c.id, label: "Cotización — " + c.descripcion };
  }
  if (t.gastoFijoId) {
    var g = (state.config.gastosFijos || []).filter(function (x) { return x.id === t.gastoFijoId; })[0];
    if (g) return { tipo: "gastoFijo", id: g.id, label: "Gasto fijo — " + g.nombre };
  }
  if (t.deudaId) {
    var d = state.deudas.filter(function (x) { return x.id === t.deudaId; })[0] ||
      state.deudasHistorial.filter(function (x) { return x.id === t.deudaId; })[0];
    if (d) return { tipo: "deuda", id: d.id, label: "Deuda — " + d.concepto };
  }
  return null;
}

// Un movimiento GENERADO por una acción de la app (registrar un abono, pagar
// una comisión, marcar un gasto fijo, pagar una cuota, reportar una venta de
// consignación, sincronizar una compra) es el reflejo en Finanzas de un hecho
// que vive en otro lado. Borrarlo desde Finanzas dejaba al pedido diciendo
// que ya cobró, al gasto fijo diciendo que ya lo pagó y a la deuda con una
// cuota menos, mientras la plata desaparecía de la caja: exactamente el
// descuadre que la app existe para evitar.
//
// A diferencia de origenDeTx() —que solo mira si el movimiento APUNTA a algún
// registro, y por eso también da positivo con un movimiento cargado a mano al
// que alguien le eligió un pedido en el desplegable— acá se buscan las marcas
// que la propia app escribe al generarlo. Un movimiento manual nunca las
// tiene, así que se sigue pudiendo borrar como siempre.
//
// Devuelve null si es manual, o { que, donde } describiendo qué representa y
// dónde se revierte de verdad.
var MARCAS_ORIGEN_SISTEMA = [
  { campo: "origenAbonoId", que: "un abono cobrado de un pedido", donde: "Pedidos → tarjeta del pedido → Dinero y documentos → Abonos registrados → Eliminar" },
  { campo: "origenReembolsoId", que: "un reembolso hecho a un cliente", donde: "Pedidos → tarjeta del pedido → Dinero y documentos → Abonos registrados → Eliminar" },
  { campo: "origenComisionPedidoId", que: "la comisión de un vendedor", donde: "Pedidos → tarjeta del pedido → Dinero y documentos → botón \"pagada\" del vendedor (vuelve a dejarla pendiente)" },
  { campo: "origenComisionCotId", que: "la comisión de un vendedor", donde: "Cotizaciones → la cotización → Vendedor → botón \"pagada\" (vuelve a dejarla pendiente)" },
  { campo: "origenVentaConsignacionId", que: "una venta reportada por un punto de consignación", donde: "Pedidos → tarjeta de la consignación → Ventas reportadas → Eliminar" },
  { campo: "origenComisionConsignacionId", que: "la comisión de un punto de consignación", donde: "Pedidos → tarjeta de la consignación → Ventas reportadas → Eliminar (borra la venta y su comisión)" },
  { campo: "origenGastoFijoPeriodo", que: "el pago de un gasto fijo", donde: "Pendientes → Gastos fijos → botón \"pagado\" (vuelve a dejarlo pendiente)" },
  { campo: "origenCompraClave", que: "una compra de la lista de una cotización", donde: "Cotizaciones → la cotización → Producción → desmarca \"Comprado\" y pulsa \"Actualizar movimientos financieros\"" },
  { campo: "deudaId", que: "el pago de una cuota de una deuda", donde: "Pendientes → Deudas (el pago queda en su historial; para deshacerlo hay que editar la deuda)" }
];
export function origenSistemaDeTx(t) {
  if (!t) return null;
  var marca = MARCAS_ORIGEN_SISTEMA.filter(function (m) { return t[m.campo]; })[0];
  return marca ? { que: marca.que, donde: marca.donde } : null;
}
// "Por cobrar": el saldo pendiente de TODOS los pedidos (total - abono, cuando
// es positivo). Ya no se suman "ingresos pendientes sueltos" — un ingreso que
// aún no se recibió no es un movimiento de Finanzas, es saldo de un pedido.
// ---------- pedidos cancelados ----------
// Un pedido CANCELADO no es lo mismo que uno ELIMINADO, y la diferencia es de
// plata, no de etiqueta:
//
//  - ELIMINADO = no debió existir (se cargó por error, se duplicó). Se va a la
//    papelera y se lleva consigo los movimientos que él mismo generó: si el
//    pedido nunca debió estar, esa plata tampoco. Ver "remove-pedido" en
//    modules/pedidos.js.
//  - CANCELADO = sí existió y sí movió plata (el cliente abonó, se le pagó al
//    vendedor, el punto reportó una venta). La venta no se va a completar,
//    pero lo que ya pasó pasó: los movimientos se quedan en Finanzas, y el
//    pedido se queda visible marcado como cancelado. Borrar ese rastro sería
//    hacer desaparecer plata real de la caja.
//
// Lo que sí deja de contar un pedido cancelado es todo lo que mira hacia
// ADELANTE: no es un saldo por cobrar (no se va a cobrar), no es un pedido
// activo, no genera comisión pendiente y no cuenta como venta en los reportes.
export function pedidoCancelado(p) {
  return !!(p && p.cancelado);
}

// Los movimientos de Finanzas que este pedido GENERÓ por sí mismo: abonos,
// reembolsos, la comisión de su vendedor y las ventas/comisiones de su
// consignación. Se reconocen por la marca de origen que la app les puso al
// crearlos (ver origenSistemaDeTx), no por `pedidoId` a secas.
//
// Esa distinción es deliberada: un movimiento cargado A MANO al que alguien le
// eligió este pedido en el desplegable "Pedido relacionado" también tiene
// `pedidoId`, pero representa un gasto propio que existió al margen del pedido
// (la tela que se compró, por ejemplo). Ese no se va con él. Lo mismo con las
// compras sincronizadas desde una cotización, que pertenecen a la cotización.
export function movimientosGeneradosPorPedido(pedidoId) {
  if (!pedidoId) return [];
  return state.tx.filter(function (t) {
    if (t.origenComisionPedidoId === pedidoId) return true;
    if (t.pedidoId !== pedidoId) return false;
    return !!(t.origenAbonoId || t.origenReembolsoId || t.origenVentaConsignacionId || t.origenComisionConsignacionId);
  });
}

export function calcSaldoPedido(p) {
  return num(p.total) - num(p.abono);
}
// Total realmente abonado de un pedido a partir de su lista de abonos. Los
// reembolsos viven en esa misma lista (para que el historial sea uno solo y
// cronológico) pero con `tipo: "reembolso"`, y RESTAN: son plata que se le
// devolvió al cliente. Sumarlos como si fueran abonos —que es lo que pasaba
// al editar un abono en un pedido que ya tenía un reembolso— inflaba el
// abonado y hacía desaparecer un saldo por cobrar que sí existía.
//
// Es la única fórmula del "abonado": cualquier acción que agregue, edite o
// elimine un abono entra por acá, así p.abono nunca puede separarse de la
// lista que lo sustenta.
export function calcAbonadoDeLista(abonos) {
  return (abonos || []).reduce(function (a, x) {
    return x.tipo === "reembolso" ? a - num(x.monto) : a + num(x.monto);
  }, 0);
}
export function calcPorCobrarPedidos() {
  return state.pedidos.reduce(function (a, p) {
    if (pedidoCancelado(p)) return a; // cancelado: ese saldo ya no se va a cobrar
    var saldo = calcSaldoPedido(p);
    return a + (saldo > 0 ? saldo : 0);
  }, 0);
}
export function calcPorCobrar() {
  return calcPorCobrarPedidos();
}
// Lista consolidada de "quién debe": pedidos con saldo. Se usa en el panel Resumen.
export function listaDeudores() {
  var lista = [];
  state.pedidos.forEach(function (p) {
    if (pedidoCancelado(p)) return; // cancelado: el cliente ya no debe eso
    var saldo = calcSaldoPedido(p);
    if (saldo > 0) lista.push({ nombre: p.cliente, monto: saldo, nota: p.descripcion });
  });
  return lista.sort(function (a, b) { return b.monto - a.monto; });
}
// "Por pagar": todo lo que el taller debe — gastos fijos sin pagar en su
// periodo + nómina pendiente + comisiones de vendedor pendientes + deudas
// registradas. Ya no incluye "gastos sueltos pendientes" de Finanzas, porque
// ese estado ya no existe ahí (ver arriba).
export function calcPorPagar() {
  return calcGastosFijosPendientes() + calcNominaPendiente() + calcComisionesPendientes() + calcComisionesPendientesCot() + calcDeudasPendientes() + calcComisionesConsignacionPendientes();
}
// Desglose de "Por pagar" por categoría, con el detalle de cada obligación
// (concepto + monto + fecha si aplica) — para mostrar la lista resumida en
// Pendientes en vez de solo el total.
export function calcPorPagarDesglose() {
  var categorias = [];

  var itemsGastosFijos = (state.config.gastosFijos || [])
    .map(function (g) { return { concepto: g.nombre, monto: calcGastoFijoPendiente(g), fecha: calcFechaVencimientoPeriodo(g.periodo || "mensual", diasPagoDe(g)) }; })
    .filter(function (it) { return it.monto > 0; });
  if (itemsGastosFijos.length) categorias.push({ categoria: "Gastos fijos", monto: itemsGastosFijos.reduce(function (a, it) { return a + it.monto; }, 0), items: itemsGastosFijos });

  var itemsNomina = (state.config.nomina || [])
    .map(function (e) {
      return { concepto: "Nómina — " + e.nombre, monto: calcNominaPendienteEmpleado(e), fecha: calcFechaVencimientoPeriodo(periodoDeEmpleado(e), diasPagoDeEmpleado(e)) };
    })
    .filter(function (it) { return it.monto > 0; });
  if (itemsNomina.length) categorias.push({ categoria: "Nómina", monto: itemsNomina.reduce(function (a, it) { return a + it.monto; }, 0), items: itemsNomina });

  var itemsDeudas = state.deudas
    .map(function (d) {
      var dias = diasPagoDe(d);
      var fecha = dias.length ? calcFechaVencimientoPeriodo(d.periodo || "mensual", dias) : (d.fechaVencimiento ? new Date(d.fechaVencimiento + "T00:00:00") : null);
      var cuotas = num(d.cuotas) || 1;
      var pagadas = Math.min(num(d.cuotasPagadas) || 0, cuotas);
      // "monto" es el valor de la CUOTA que vence, no el saldo total de la
      // deuda: alimenta tanto el subtotal de la categoría "Deudas" como lo
      // que se ve por fila, para no dar la impresión de que toda la deuda
      // vence ya. El saldo total queda aparte, solo para el tooltip.
      return {
        concepto: d.concepto, monto: calcDeudaValorCuota(d), montoTotal: calcDeudaSaldoPendiente(d),
        contador: cuotas > 1 ? (pagadas + 1) + "/" + cuotas : null, fecha: fecha
      };
    })
    .filter(function (it) { return it.monto > 0; });
  if (itemsDeudas.length) categorias.push({ categoria: "Deudas", monto: itemsDeudas.reduce(function (a, it) { return a + it.monto; }, 0), items: itemsDeudas });

  var saldosVendedores = calcSaldosVendedores();
  if (saldosVendedores.length) {
    categorias.push({
      categoria: "Comisiones de vendedores",
      monto: saldosVendedores.reduce(function (a, v) { return a + v.monto; }, 0),
      items: saldosVendedores.map(function (v) {
        // nombreVendedor: marca este item como expandible en Pendientes (ver
        // renderCategoriaComisiones) — permite desplegar el detalle pedido
        // por pedido y saltar directo a verificarlo, en vez de solo ver el
        // total consolidado de este vendedor.
        return { concepto: v.nombre + " (" + v.cantidad + (v.cantidad === 1 ? " pedido" : " pedidos") + ")", monto: v.monto, fecha: v.fechaPago ? new Date(v.fechaPago + "T00:00:00") : null, nombreVendedor: v.nombre };
      })
    });
  }

  var saldosConsignacion = calcSaldosConsignacion();
  if (saldosConsignacion.length) {
    categorias.push({
      categoria: "Comisiones de consignación",
      monto: saldosConsignacion.reduce(function (a, v) { return a + v.monto; }, 0),
      items: saldosConsignacion.map(function (v) {
        return { concepto: v.nombre + " (" + v.cantidad + (v.cantidad === 1 ? " venta" : " ventas") + ")", monto: v.monto, fecha: null };
      })
    });
  }

  return categorias;
}
// Fecha de vencimiento MÁS PRÓXIMA de una obligación periódica (gasto fijo o
// nómina), dado su periodo y uno o VARIOS "días de pago" (ej. nómina el 1 y
// el 15, o arriendo el 1, o "los sábados"). Para mensual/quincenal los días
// son día-del-mes (1-31); para semanal son día-de-la-semana (0=Dom..6=Sáb).
// Busca, entre todos los días configurados, la fecha más cercana que sea hoy
// o en el futuro (mirando este mes/semana y el siguiente); si no hay ningún
// día definido, cae al comportamiento anterior (fin del periodo actual).
export function calcFechaVencimientoPeriodo(periodo, diasPago) {
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  var dias = normalizarDiasPago(diasPago);

  if (!dias.length) {
    // Sin día específico: se usa el fin del periodo actual (comportamiento previo).
    if (periodo === "semanal") {
      var dow0 = hoy.getDay();
      var offsetDom = dow0 === 0 ? 0 : 7 - dow0;
      return new Date(y, m, d + offsetDom);
    }
    if (periodo === "quincenal") return new Date(y, m, d <= 15 ? 15 : new Date(y, m + 1, 0).getDate());
    return new Date(y, m + 1, 0);
  }

  var candidatos = [];
  if (periodo === "semanal") {
    dias.forEach(function (dow) {
      dow = ((dow % 7) + 7) % 7;
      var actual = hoy.getDay();
      var diff = (dow - actual + 7) % 7; // 0 = hoy
      candidatos.push(new Date(y, m, d + diff));
    });
  } else {
    // mensual y quincenal: cada día configurado es un día-del-mes; se busca
    // este mes y el próximo, y se toma el más cercano que ya sea >= hoy.
    dias.forEach(function (diaMes) {
      [0, 1].forEach(function (addMes) {
        var mm = m + addMes;
        var ultimo = new Date(y, mm + 1, 0).getDate();
        var dd = Math.min(diaMes, ultimo);
        var fecha = new Date(y, mm, dd);
        if (fecha.getTime() >= hoy.getTime()) candidatos.push(fecha);
      });
    });
  }
  if (!candidatos.length) return new Date(y, m + 1, 0);
  return candidatos.reduce(function (min, f) { return f.getTime() < min.getTime() ? f : min; }, candidatos[0]);
}

// Acepta el formato nuevo (array) o el legado (un solo número/string en
// "diaPago") y siempre devuelve un array de enteros.
function normalizarDiasPago(diasPago) {
  if (Array.isArray(diasPago)) return diasPago.map(Number).filter(function (n) { return !isNaN(n); });
  if (diasPago !== "" && diasPago != null && !isNaN(Number(diasPago))) return [Number(diasPago)];
  return [];
}

// Indicador inteligente para el KPI "Por pagar": en vez del total acumulado,
// prioriza lo más urgente. Si hay obligaciones VENCIDAS, esas reemplazan todo
// lo demás; si no, muestra el grupo que vence en la fecha más próxima.
// Las comisiones (sin fecha propia, ya devengadas) se tratan como vencidas
// desde ya. Las deudas usan su fecha de vencimiento si la definieron, o
// también se cuentan como vencidas si no la definieron (para no esconderlas).
export function calcResumenPorPagar() {
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var items = [];

  (state.config.gastosFijos || []).forEach(function (g) {
    var pend = calcGastoFijoPendiente(g);
    if (pend > 0) items.push({ monto: pend, fecha: calcFechaVencimientoPeriodo(g.periodo || "mensual", diasPagoDe(g)) });
  });

  (state.config.nomina || []).forEach(function (e) {
    var pend = calcNominaPendienteEmpleado(e);
    if (pend > 0) items.push({ monto: pend, fecha: calcFechaVencimientoPeriodo(periodoDeEmpleado(e), diasPagoDeEmpleado(e)) });
  });

  state.deudas.forEach(function (d) {
    var saldo = calcDeudaSaldoPendiente(d);
    if (saldo <= 0) return;
    var cuota = calcDeudaValorCuota(d); // lo que vence en la próxima fecha, no el saldo total
    var dias = diasPagoDe(d);
    if (dias.length) {
      items.push({ monto: cuota, fecha: calcFechaVencimientoPeriodo(d.periodo || "mensual", dias) });
    } else if (d.fechaVencimiento) {
      items.push({ monto: cuota, fecha: new Date(d.fechaVencimiento + "T00:00:00") });
    } else {
      // Sin fecha definida: se cuenta como urgente/vencida en vez de
      // inventarle la fecha de hoy, que el usuario nunca escribió y que en
      // el KPI "Próximo vencimiento" se veía como si fuera un dato real.
      items.push({ monto: cuota, vencida: true });
    }
  });

  // Comisiones de vendedor: se tratan "como otra nómina" — si no tienen fecha
  // de pago propia definida, se consideran urgentes desde ya (vencidas), sin
  // mostrar una fecha inventada en su lugar.
  state.pedidos.forEach(function (p) {
    if (pedidoCancelado(p)) return;
    if (p.vendedor && p.vendedor.nombre && p.vendedor.estado !== "pagado") {
      if (p.vendedor.fechaPago) items.push({ monto: calcComisionValor(p), fecha: new Date(p.vendedor.fechaPago + "T00:00:00") });
      else items.push({ monto: calcComisionValor(p), vencida: true });
    }
  });
  state.cotizaciones.forEach(function (c) {
    if (c.estado !== "convertida" && c.vendedor && c.vendedor.nombre && c.vendedor.estado !== "pagado") {
      if (c.vendedor.fechaPago) items.push({ monto: calcComisionValorCot(c), fecha: new Date(c.vendedor.fechaPago + "T00:00:00") });
      else items.push({ monto: calcComisionValorCot(c), vencida: true });
    }
  });

  // Comisiones de consignación pendientes: como una venta ya ocurrió (el
  // punto ya vendió la mercancía), se tratan como urgentes desde ya, igual
  // que las comisiones de vendedor sin fecha de pago propia.
  state.pedidos.forEach(function (p) {
    if (!p.consignacion || pedidoCancelado(p)) return;
    (p.consignacion.ventas || []).forEach(function (v) {
      if (!v.comisionPagada) items.push({ monto: num(v.comisionMonto), vencida: true });
    });
  });

  if (!items.length) return { estado: "aldia" };

  var vencidas = items.filter(function (it) { return it.vencida || (it.fecha && it.fecha < hoy); });
  if (vencidas.length) {
    var totalV = vencidas.reduce(function (a, it) { return a + it.monto; }, 0);
    return { estado: "vencidas", monto: totalV, cantidad: vencidas.length };
  }

  var conFecha = items.filter(function (it) { return it.fecha; });
  if (!conFecha.length) return { estado: "aldia" };
  var minTime = conFecha.reduce(function (min, it) { return it.fecha.getTime() < min ? it.fecha.getTime() : min; }, conFecha[0].fecha.getTime());
  var mismaFecha = conFecha.filter(function (it) { return it.fecha.getTime() === minTime; });
  var totalP = mismaFecha.reduce(function (a, it) { return a + it.monto; }, 0);
  return { estado: "proximo", fecha: mismaFecha[0].fecha, monto: totalP, cantidad: mismaFecha.length };
}

// Saldo agrupado por vendedor (comisiones pendientes de TODOS los pedidos y
// cotizaciones aún no convertidas), tratado "como si fuera otra nómina" para
// poder verlo consolidado en Pendientes en vez de tener que revisar pedido
// por pedido.
export function calcSaldosVendedores() {
  var mapa = {};
  function agregar(nombre, monto, fechaPago) {
    if (!mapa[nombre]) mapa[nombre] = { nombre: nombre, monto: 0, cantidad: 0, fechaPago: fechaPago || "" };
    mapa[nombre].monto += monto;
    mapa[nombre].cantidad += 1;
    if (!mapa[nombre].fechaPago && fechaPago) mapa[nombre].fechaPago = fechaPago;
  }
  state.pedidos.forEach(function (p) {
    if (pedidoCancelado(p)) return;
    if (p.vendedor && p.vendedor.nombre && p.vendedor.estado !== "pagado") agregar(p.vendedor.nombre, calcComisionValor(p), p.vendedor.fechaPago);
  });
  state.cotizaciones.forEach(function (c) {
    if (c.estado !== "convertida" && c.vendedor && c.vendedor.nombre && c.vendedor.estado !== "pagado") agregar(c.vendedor.nombre, calcComisionValorCot(c), c.vendedor.fechaPago);
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.monto - a.monto; });
}

// El detalle (pedido por pedido / cotización por cotización) detrás del
// saldo agregado de UN vendedor en calcSaldosVendedores — para poder
// desplegarlo en Pendientes y saltar directo a verificar el pedido de
// origen, en vez de solo ver el total consolidado.
export function calcDetalleComisionesVendedor(nombre) {
  var items = [];
  state.pedidos.forEach(function (p) {
    if (pedidoCancelado(p)) return;
    if (p.vendedor && p.vendedor.nombre === nombre && p.vendedor.estado !== "pagado") {
      items.push({ tipo: "pedido", id: p.id, label: (p.numeroOp || "Pedido") + " — " + p.cliente + " · " + p.descripcion, monto: calcComisionValor(p) });
    }
  });
  state.cotizaciones.forEach(function (c) {
    if (c.estado !== "convertida" && c.vendedor && c.vendedor.nombre === nombre && c.vendedor.estado !== "pagado") {
      items.push({ tipo: "cotizacion", id: c.id, label: "Cotización — " + c.cliente + " · " + c.descripcion, monto: calcComisionValorCot(c) });
    }
  });
  return items;
}


// "¿ya se pagó en ESTE periodo?" sin importar si el periodo es mensual,
// quincenal o semanal.
export function periodoKey(fechaStr, periodo) {
  fechaStr = fechaStr || todayStr();
  var partes = fechaStr.slice(0, 10).split("-");
  var y = partes[0], m = partes[1], d = num(partes[2]);
  if (periodo === "quincenal") return y + "-" + m + "-" + (d <= 15 ? "Q1" : "Q2");
  if (periodo === "semanal") {
    // Semana aproximada (no es la semana ISO-8601 exacta, pero alcanza para
    // agrupar "esta semana" de forma consistente).
    var date = new Date(fechaStr);
    var inicioAno = new Date(date.getFullYear(), 0, 1);
    var dias = Math.floor((date - inicioAno) / 86400000);
    var semana = Math.ceil((dias + inicioAno.getDay() + 1) / 7);
    return y + "-W" + semana;
  }
  return y + "-" + m;
}
// Los salarios en Configuración siempre se definen en valor MENSUAL; este
// factor reparte ese valor mensual entre los periodos de pago del mes.
// También se reutiliza para "mensualizar" cualquier otro monto periódico
// (gastos fijos, metas) y así poder compararlos o sumarlos en un reporte.
export function factorPeriodo(periodo) {
  if (periodo === "quincenal") return 2;
  if (periodo === "semanal") return 4; // aproximación: ~4 semanas por mes
  return 1;
}
// Balance neto (ingresos - gastos - nómina, ya pagados) dentro del periodo
// actual únicamente — a diferencia de calcCaja(), que es el balance acumulado
// desde siempre. Se usa para medir el progreso de la Meta, que ahora puede
// definirse en cualquier periodo (no solo mensual).
export function calcBalancePeriodo(periodo) {
  var miPeriodo = periodoKey(todayStr(), periodo);
  return state.tx
    .filter(function (t) { return periodoKey(t.fecha, periodo) === miPeriodo; })
    .reduce(function (a, t) { return t.tipo === "ingreso" ? a + num(t.monto) : a - num(t.monto); }, 0);
}
// Cada persona puede tener su propio periodo de pago (mensual/quincenal/
// semanal) y su(s) propio(s) día(s) — antes era una sola config global para
// TODO el taller, lo que hacía imposible pagarle a alguien semanal y a otro
// quincenal. Si la persona no trae `periodo`/`diasPago` propios (registros
// viejos), cae al config global — mismo espíritu que diasPagoDe() para no
// requerir una migración destructiva de los que ya existen.
export function periodoDeEmpleado(e) {
  return (e && e.periodo) || state.config.periodoPago || "mensual";
}
export function diasPagoDeEmpleado(e) {
  var propios = diasPagoDe(e);
  if (propios.length) return propios;
  return diasPagoDe({ diasPago: state.config.diasPagoNomina, diaPago: state.config.diaPagoNomina });
}
// Cuánto le falta pagar a UNA persona en su periodo actual (a su propio
// ritmo) — base de calcNominaPendiente() (el pool de todos) y de cada fila
// en Pendientes → Nómina.
export function calcNominaPendienteEmpleado(e) {
  var periodo = periodoDeEmpleado(e);
  var aPagar = calcSalarioPorPeriodo(e, periodo);
  var pagado = calcNominaPagadaEmpleado(e.nombre, periodo);
  return Math.max(0, aPagar - pagado);
}
export function calcNominaPendiente() {
  return (state.config.nomina || []).reduce(function (a, e) { return a + calcNominaPendienteEmpleado(e); }, 0);
}

// ---------- pedidos / equipo ----------
export function calcPedidosActivos() {
  return state.pedidos.filter(function (p) { return p.estado !== "entregado" && !pedidoCancelado(p); }).length;
}
// El salario de cada persona se guarda EN LA BASE que se eligió al cargarlo
// (e.salarioPeriodo: "semanal" | "quincenal" | "mensual"), no siempre
// mensualizado. Antes todo se guardaba como mensual obligatoriamente, lo que
// obligaba a quien paga semanal a multiplicar "x4" a mano un número que en
// realidad no cabe exacto en ningún mes (unos tienen 4 semanas, otros 5).
// Los registros viejos no traen salarioPeriodo: se leen como mensual, que es
// lo que eran, así que ningún dato existente cambia de valor.
export function salarioBaseDe(e) {
  return e.salarioPeriodo || "mensual";
}
// Equivalente MENSUAL del salario de una persona — para sumarlo con otros que
// puedan estar definidos en otra base y para los reportes.
export function calcSalarioMensual(e) {
  return num(e.salario) * factorPeriodo(salarioBaseDe(e));
}
// Lo que se le paga a esa persona en UN periodo de pago del taller (el que
// esté configurado en Configuración → periodoPago). Si su salario ya está
// definido en esa misma base, es el número tal cual, sin conversión.
export function calcSalarioPorPeriodo(e, periodoPago) {
  if (salarioBaseDe(e) === periodoPago) return num(e.salario);
  return calcSalarioMensual(e) / factorPeriodo(periodoPago);
}
// Rango de fechas del periodo de pago que está corriendo AHORA — lo que
// contesta "¿este pago qué días cubre?". Usa los mismos cortes que
// periodoKey() (de donde sale si un pago cuenta como "de este periodo"), para
// que la fecha que se muestra y el cálculo de pendiente nunca discrepen.
export function rangoPeriodoActual(periodo) {
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  if (periodo === "semanal") {
    // Semana de domingo a sábado, igual que el corte de periodoKey().
    var inicio = new Date(y, m, d - hoy.getDay());
    return { desde: inicio, hasta: new Date(y, m, d - hoy.getDay() + 6) };
  }
  if (periodo === "quincenal") {
    return d <= 15
      ? { desde: new Date(y, m, 1), hasta: new Date(y, m, 15) }
      : { desde: new Date(y, m, 16), hasta: new Date(y, m + 1, 0) };
  }
  return { desde: new Date(y, m, 1), hasta: new Date(y, m + 1, 0) };
}
// Cuánto de la nómina de UNA persona ya se registró como pagado (tx tipo
// "nomina" con esa contraparte) dentro del periodo actual — a diferencia de
// calcNominaPendiente (que es el pool agregado de TODOS), esto es para
// mostrar el estado "pagado/pendiente" por fila en Pendientes → Nómina.
export function calcNominaPagadaEmpleado(nombre, periodo) {
  var miPeriodo = periodoKey(todayStr(), periodo);
  return state.tx
    .filter(function (t) { return t.tipo === "nomina" && t.contraparte === nombre && periodoKey(t.fecha, periodo) === miPeriodo; })
    .reduce(function (a, t) { return a + num(t.monto); }, 0);
}
// Cada gasto fijo tiene su propio periodo (mensual/quincenal/semanal) y guarda
// en qué periodo se marcó "pagado" por última vez (pagadoHasta). Si ese periodo
// ya pasó, vuelve a estar pendiente — igual que la nómina.
export function calcGastoFijoPendiente(g) {
  var periodo = g.periodo || "mensual";
  var miPeriodo = periodoKey(todayStr(), periodo);
  return g.pagadoHasta === miPeriodo ? 0 : num(g.monto);
}
export function calcGastosFijosPendientes() {
  return (state.config.gastosFijos || []).reduce(function (a, g) { return a + calcGastoFijoPendiente(g); }, 0);
}
// Total de gastos fijos "mensualizado" (para reportes): normaliza cada gasto a
// su equivalente mensual sin importar en qué periodo esté definido.
export function calcGastosFijosMensuales() {
  return (state.config.gastosFijos || []).reduce(function (a, g) { return a + num(g.monto) * factorPeriodo(g.periodo || "mensual"); }, 0);
}

// ---------- comisiones de vendedor (por pedido y por cotización) ----------
// El vendedor puede definirse por % (sobre el total) o por valor fijo. Los
// pedidos antiguos guardaban solo "porcentaje": se sigue leyendo por
// compatibilidad si no hay "tipo"/"valor" nuevos.
export function calcComisionValor(p) {
  var v = p.vendedor;
  if (!v || !v.nombre) return 0;
  var tipo = v.tipo || "porcentaje";
  if (tipo === "fijo") return num(v.valor);
  var pct = v.porcentaje != null ? num(v.porcentaje) : num(v.valor);
  return num(p.total) * (pct / 100);
}
export function calcComisionesPendientes() {
  return state.pedidos.reduce(function (a, p) {
    // Cancelado: la venta no se completó, así que esa comisión ya no se debe.
    // Si alcanzó a PAGARSE, su movimiento sigue en Finanzas — lo que deja de
    // contar es la obligación futura, no la plata que ya salió.
    if (pedidoCancelado(p)) return a;
    if (p.vendedor && p.vendedor.nombre && p.vendedor.estado !== "pagado") return a + calcComisionValor(p);
    return a;
  }, 0);
}
// Comisión definida directamente en una cotización (antes de convertirse en
// pedido). Se calcula sobre el precio total cotizado.
export function calcComisionValorCot(cot) {
  var v = cot.vendedor;
  if (!v || !v.nombre) return 0;
  var tipo = v.tipo || "porcentaje";
  if (tipo === "fijo") return num(v.valor);
  var totales = calcCotizacionTotales(cot);
  return totales.precioTotal * (num(v.valor) / 100);
}
// Solo cuenta cotizaciones aún NO convertidas: una vez convertida, la comisión
// vive en el pedido resultante (se copia al convertir) y ya se cuenta en
// calcComisionesPendientes, para no duplicarla.
export function calcComisionesPendientesCot() {
  return state.cotizaciones.reduce(function (a, c) {
    if (c.estado === "convertida") return a;
    if (c.vendedor && c.vendedor.nombre && c.vendedor.estado !== "pagado") return a + calcComisionValorCot(c);
    return a;
  }, 0);
}

// Resumen de ventas/comisión de UN vendedor puntual (por nombre), para su
// propio panel "Mis ventas" (ver modules/mis-ventas.js). Mismo criterio que
// calcComisionesPendientes/Cot para no contar dos veces una cotización ya
// convertida en pedido: solo se suman las NO convertidas.
export function calcVentasVendedor(nombre) {
  var totalVendido = 0, comisionPendiente = 0, comisionPagada = 0;
  state.pedidos.forEach(function (p) {
    if (!p.vendedor || p.vendedor.nombre !== nombre) return;
    totalVendido += num(p.total);
    var valor = calcComisionValor(p);
    if (p.vendedor.estado === "pagado") comisionPagada += valor; else comisionPendiente += valor;
  });
  state.cotizaciones.forEach(function (c) {
    if (c.estado === "convertida" || !c.vendedor || c.vendedor.nombre !== nombre) return;
    totalVendido += calcCotizacionTotales(c).precioTotal;
    var valor = calcComisionValorCot(c);
    if (c.vendedor.estado === "pagado") comisionPagada += valor; else comisionPendiente += valor;
  });
  return { totalVendido: totalVendido, comisionPendiente: comisionPendiente, comisionPagada: comisionPagada };
}

// ---------- consignación (puntos de venta externos con comisión) ----------
// Un pedido en consignación no tiene "saldo por cobrar" tradicional: el
// dinero entra recién cuando el punto reporta una venta real (ver
// modules/pedidos.js, acción "registrar-venta-consignacion"). Mientras
// tanto, lo único que importa es cuánto queda disponible en el punto.
export function calcConsignacionVendida(p) {
  if (!p.consignacion) return 0;
  return (p.consignacion.ventas || []).reduce(function (a, v) { return a + num(v.cantidad); }, 0);
}
export function calcConsignacionRetirada(p) {
  if (!p.consignacion) return 0;
  return (p.consignacion.retiros || []).reduce(function (a, r) { return a + num(r.cantidad); }, 0);
}
// Cuánto se ha enviado en total al punto: lo viejo (cantidadEnviada, un solo
// número cargado al crear el pedido) más lo nuevo (remisiones — envíos
// puntuales con soporte en PDF, ver modules/pedidos.js "Agregar remisión").
// Las dos formas conviven: una consignación vieja sigue funcionando igual,
// y cualquier reposición desde ahora en adelante se hace vía remisión.
export function calcConsignacionEnviadoTotal(p) {
  if (!p.consignacion) return 0;
  var deRemisiones = (p.consignacion.remisiones || []).reduce(function (a, r) {
    return a + (r.items || []).reduce(function (s, it) { return s + num(it.cantidad); }, 0);
  }, 0);
  return num(p.consignacion.cantidadEnviada) + deRemisiones;
}
export function calcConsignacionDisponible(p) {
  if (!p.consignacion) return 0;
  return Math.max(0, calcConsignacionEnviadoTotal(p) - calcConsignacionVendida(p) - calcConsignacionRetirada(p));
}
// Desglose por producto+talla de lo que hay en el punto (solo para
// consignaciones que ya usan remisiones — las viejas de un solo número no
// tienen cómo desglosarse por talla, así que no aparecen aquí). Cada venta o
// retiro que se registre indicando a qué línea corresponde (productoId +
// talla) se resta de la línea correspondiente, no del total agregado.
export function calcConsignacionDisponiblePorTalla(p) {
  if (!p.consignacion) return [];
  var mapa = {};
  (p.consignacion.remisiones || []).forEach(function (r) {
    (r.items || []).forEach(function (it) {
      var key = it.productoId + "|" + it.talla;
      if (!mapa[key]) mapa[key] = { productoId: it.productoId, productoNombre: it.productoNombre, talla: it.talla, precioUnitario: num(it.precioUnitario), enviado: 0, vendida: 0, retirada: 0 };
      mapa[key].enviado += num(it.cantidad);
    });
  });
  (p.consignacion.ventas || []).forEach(function (v) {
    var key = v.productoId + "|" + v.talla;
    if (v.productoId && v.talla && mapa[key]) mapa[key].vendida += num(v.cantidad);
  });
  (p.consignacion.retiros || []).forEach(function (r) {
    var key = r.productoId + "|" + r.talla;
    if (r.productoId && r.talla && mapa[key]) mapa[key].retirada += num(r.cantidad);
  });
  return Object.keys(mapa).map(function (k) {
    var m = mapa[k];
    m.disponible = Math.max(0, m.enviado - m.vendida - m.retirada);
    return m;
  });
}
// La comisión se calcula en el momento de CADA venta (no del pedido
// completo): así una comisión por % siempre es sobre lo que de verdad se
// vendió esa vez, no sobre el envío total.
export function calcConsignacionComision(consignacion, cantidad, montoTotal) {
  var tipo = consignacion.comisionTipo || "porcentaje";
  if (tipo === "fijo") return num(consignacion.comisionValor) * cantidad;
  return num(montoTotal) * (num(consignacion.comisionValor) / 100);
}
export function calcComisionesConsignacionPendientes() {
  return state.pedidos.reduce(function (a, p) {
    if (!p.consignacion || pedidoCancelado(p)) return a;
    var pend = (p.consignacion.ventas || []).filter(function (v) { return !v.comisionPagada; }).reduce(function (s, v) { return s + num(v.comisionMonto); }, 0);
    return a + pend;
  }, 0);
}
// Agrupado por punto de consignación, mismo patrón que calcSaldosVendedores.
export function calcSaldosConsignacion() {
  var mapa = {};
  function agregar(nombre, monto) {
    if (!mapa[nombre]) mapa[nombre] = { nombre: nombre, monto: 0, cantidad: 0 };
    mapa[nombre].monto += monto;
    mapa[nombre].cantidad += 1;
  }
  state.pedidos.forEach(function (p) {
    if (!p.consignacion || pedidoCancelado(p)) return;
    (p.consignacion.ventas || []).forEach(function (v) {
      if (!v.comisionPagada) agregar(p.cliente || "Punto de consignación", num(v.comisionMonto));
    });
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.monto - a.monto; });
}

// ---------- campanita de notificaciones ----------
// Lo que hay que mirar HOY, en una sola lista. Son cosas de naturaleza muy
// distinta (una nota, una autorización, una entrega) pero comparten lo único
// que importa acá: si nadie las ve hoy, algo se atrasa o queda sin aplicar.
//
// Función pura y en calc.js (no en el render de la campanita) para que el
// contador del badge y el contenido del panel salgan del MISMO cálculo — un
// "3" en la campanita y dos ítems en la lista sería el clásico número que no
// se puede explicar.
//
// `esAdmin` decide si entran las autorizaciones pendientes: un vendedor no
// aprueba nada, así que verlas ahí solo sería ruido (él ya ve el estado de lo
// suyo dentro de cada pestaña).
export function calcNotificaciones(esAdmin) {
  var hoy = todayStr();
  var items = [];

  // 1. Notas con fecha para hoy (o ya vencidas) que siguen sin marcarse hechas.
  (state.pendientes || []).forEach(function (n) {
    if (n.hecho || !n.fecha || n.fecha > hoy) return;
    var vencida = n.fecha < hoy;
    items.push({
      id: "nota:" + n.id,
      tipo: "nota",
      icono: vencida ? "⏰" : "📝",
      titulo: n.texto || "Nota sin texto",
      detalle: vencida ? ("Era para el " + n.fecha) : ("Para hoy" + (n.hora ? " · " + n.hora : "")),
      urgente: vencida || n.prioridad === "alta",
      tab: "notas"
    });
  });

  // 2. Cambios que un vendedor propuso y no se aplican hasta que el admin los
  //    apruebe: precios/categorías del catálogo de insumos, y precio o
  //    movimiento manual de stock de un producto. Mientras no se aprueben, lo
  //    que el vendedor ve y lo que ve el taller no coinciden.
  if (esAdmin) {
    (state.catalogoPropuestas || []).forEach(function (p) {
      items.push({
        id: "propuesta-cat:" + p.id,
        tipo: "autorizacion",
        icono: "🔐",
        titulo: (p.autor || "Un vendedor") + " propuso cambios en el catálogo de insumos",
        detalle: "Necesita tu autorización para quedar guardado",
        urgente: true,
        tab: "catalogo"
      });
    });
    (state.productoPropuestas || []).forEach(function (p) {
      var que = p.tipo === "movimiento" ? "un movimiento de stock" : "un cambio de precio";
      items.push({
        id: "propuesta-pro:" + p.id,
        tipo: "autorizacion",
        icono: "🔐",
        titulo: (p.autor || "Un vendedor") + " propuso " + que + " en " + (p.productoNombre || "un producto"),
        detalle: "Necesita tu autorización para aplicarse",
        urgente: true,
        tab: "productos"
      });
    });
  }

  // 3. Entregas de hoy o ya vencidas, de pedidos que siguen activos.
  (state.pedidos || []).forEach(function (p) {
    if (p.estado === "entregado" || pedidoCancelado(p) || !p.fechaEntrega || p.fechaEntrega > hoy) return;
    var vencida = p.fechaEntrega < hoy;
    items.push({
      id: "entrega:" + p.id,
      tipo: "entrega",
      icono: vencida ? "🚨" : "📦",
      titulo: (p.numeroOp ? p.numeroOp + " — " : "") + (p.cliente || "Pedido"),
      detalle: (vencida ? "Entrega vencida el " + p.fechaEntrega : "Se entrega hoy") + " · " + (p.descripcion || ""),
      urgente: vencida,
      tab: "pedidos",
      pedidoId: p.id
    });
  });

  // Lo urgente primero; dentro de cada grupo, el orden en que se armó (notas,
  // autorizaciones, entregas), que es el que tiene sentido leer de arriba abajo.
  return items.sort(function (a, b) { return (b.urgente ? 1 : 0) - (a.urgente ? 1 : 0); });
}

// ---------- cliente 360° ----------
// Resumen de relación con UN cliente puntual, para mostrar en su ficha
// (ver modules/clientes.js) sin tener que ir a buscarlo pedido por pedido
// en la pestaña Pedidos. "Última entrega" usa fechaEntrega (no hay una
// fecha de creación guardada en el pedido) — se etiqueta como tal para no
// insinuar que es la fecha en que se hizo el pedido.
export function calcHistorialCliente(clienteId) {
  var pedidosCliente = state.pedidos.filter(function (p) { return p.clienteId === clienteId; });
  var totalComprado = pedidosCliente.reduce(function (a, p) { return a + num(p.total); }, 0);
  var conFecha = pedidosCliente.filter(function (p) { return p.fechaEntrega; }).sort(function (a, b) { return b.fechaEntrega.localeCompare(a.fechaEntrega); });
  return {
    cantidadPedidos: pedidosCliente.length,
    totalComprado: totalComprado,
    ultimaEntrega: conFecha.length ? conFecha[0].fechaEntrega : null,
    esRecurrente: pedidosCliente.length > 1
  };
}

// ---------- deudas del taller ----------
// Valor de cada cuota (monto total repartido entre el número de cuotas, 1 si
// no se definieron varias).
export function calcDeudaValorCuota(d) {
  var cuotas = num(d.cuotas) || 1;
  return num(d.monto) / cuotas;
}
// Saldo restante de una deuda: si se han ido pagando cuotas una por una
// (cuotasPagadas), descuenta esas del monto total en vez de tratarla como
// todo-o-nada. Antes calcDeudasPendientes/calcResumenPorPagar usaban
// siempre el monto completo aunque ya se hubieran pagado varias cuotas.
export function calcDeudaSaldoPendiente(d) {
  var cuotas = num(d.cuotas) || 1;
  var pagadas = Math.min(num(d.cuotasPagadas) || 0, cuotas);
  var valorCuota = calcDeudaValorCuota(d);
  return Math.max(0, num(d.monto) - pagadas * valorCuota);
}
// state.deudas ya solo contiene deudas AÚN pendientes: en cuanto una queda
// pagada por completo se saca de aquí y se mueve entera a
// state.deudasHistorial (ver pendientes.js: acción "pagar-deuda").
// Suma el valor de la PRÓXIMA CUOTA de cada deuda (no el saldo total): es lo
// que realmente hay que pagar pronto, y es lo que alimenta el KPI "Cuentas
// por pagar" — mostrar ahí el saldo completo de cada deuda daba la impresión
// de que todo el préstamo vencía ya.
export function calcDeudasPendientes() {
  return state.deudas.reduce(function (a, d) { return a + calcDeudaValorCuota(d); }, 0);
}

// ---------- clientes ----------
export function clienteById(id) {
  return state.clientes.filter(function (c) { return c.id === id; })[0] || null;
}
// Contactos marcados como proveedor (tipoRelacion === "proveedor") — se usa
// en Catálogo/Productos (elegir quién surte un insumo/producto comprado) y
// en el registro de compras reales (cotización/Finanzas).
export function proveedoresDeContactos() {
  return state.clientes.filter(function (c) { return c.tipoRelacion === "proveedor"; });
}

// ---------- productos (prendas ya hechas, con stock por talla) ----------
export function productoById(id) {
  return (state.productos || []).filter(function (p) { return p.id === id; })[0] || null;
}
export function stockTalla(producto, talla) {
  if (!producto) return 0;
  var v = (producto.variantesTalla || []).filter(function (v) { return v.talla === talla; })[0];
  return v ? num(v.stock) : 0;
}
export function stockTotalProducto(producto) {
  if (!producto) return 0;
  return (producto.variantesTalla || []).reduce(function (a, v) { return a + num(v.stock); }, 0);
}
// Validación ATÓMICA antes de descontar stock de verdad: agrupa varias
// líneas [{productoId, talla, cantidad}] por producto+talla (varias líneas
// de la misma talla en un mismo pedido/remisión suman) y las compara contra
// el stock real disponible AHORA — sin tocar nada. Devuelve la lista de
// déficits (vacía = alcanza para todo). Quien llama debe chequear esto ANTES
// de mutar cualquier cosa, para no crear un pedido/remisión a medias (cobrar
// por unidades que en realidad no había) — es la causa raíz del bug de
// "pedir 2 con 1 de stock": antes cada línea se validaba contra el stock
// SIN restar lo que otras líneas del mismo borrador ya habían apartado.
export function validarStockLineas(lineas) {
  var necesitado = {};
  (lineas || []).forEach(function (l) {
    var key = l.productoId + "|" + l.talla;
    necesitado[key] = (necesitado[key] || 0) + num(l.cantidad);
  });
  var deficits = [];
  Object.keys(necesitado).forEach(function (key) {
    var i = key.indexOf("|");
    var productoId = key.slice(0, i), talla = key.slice(i + 1);
    var producto = productoById(productoId);
    var disponible = producto ? stockTalla(producto, talla) : 0;
    if (necesitado[key] > disponible) {
      deficits.push({ productoId: productoId, talla: talla, productoNombre: producto ? producto.nombre : "(producto eliminado)", solicitado: necesitado[key], disponible: disponible });
    }
  });
  return deficits;
}
export function clientesFiltrados() {
  var q = norm(state.filtroClientes).trim();
  var list = state.clientes.slice().sort(function (a, b) { return norm(a.nombre) < norm(b.nombre) ? -1 : 1; });
  if (!q) return list;
  // La búsqueda ignora la arroba: escribir "@zulma" o "zulma" encuentra lo
  // mismo, porque el usuario se guarda sin ella.
  var qUsuario = q.replace(/^@+/, "");
  return list.filter(function (c) {
    return norm(c.nombre).indexOf(q) >= 0 || norm(c.cedula).indexOf(q) >= 0 ||
      norm(c.ciudad).indexOf(q) >= 0 || norm(c.telefono).indexOf(q) >= 0 ||
      (!!c.usuarioWhatsapp && norm(c.usuarioWhatsapp).indexOf(qUsuario) >= 0);
  });
}
export function buscarClientesCombo(q) {
  q = norm(q).trim();
  if (!q) return [];
  return state.clientes.filter(function (c) {
    return norm(c.nombre).indexOf(q) >= 0 || norm(c.cedula).indexOf(q) >= 0 || norm(c.ciudad).indexOf(q) >= 0;
  }).slice(0, 6);
}

// ---------- costeo de cotizaciones (por referencia) ----------
//
// Cada insumo tiene un `tipo` (ver TIPOS_COSTO en constants.js) que cambia cómo
// se reparte su costo entre las prendas de la referencia:
//   - "tela":        costo × consumo aprox. de la referencia × cantidad (multiplicador)
//   - "fijo_pedido":  costo total ÷ cantidad de prendas del pedido (ej. diseño, domicilio)
//   - "por_prenda":   costo × cantidad indicada (el resto de insumos, por defecto)
export function calcCostoPrenda(insumo, ref) {
  var costo = num(insumo.costo);
  var cantidad = num(insumo.cantidad) || 1;
  if (insumo.tipo === "tela") {
    return costo * (num(ref.consumoAprox) || 0) * cantidad;
  }
  if (insumo.tipo === "fijo_pedido") {
    var cantidadPedida = num(ref.cantidadPedida) || 1;
    return cantidadPedida ? costo / cantidadPedida : 0;
  }
  return costo * cantidad; // por_prenda
}
// Una referencia COMPRADA A PROVEEDOR no se arma con insumos: llega hecha, y
// su costo por unidad ES lo que se paga por ella. Resolverlo acá (y no en
// cada pantalla) es lo que hace que el margen de la referencia, los totales
// de la cotización, el PDF y los reportes no puedan contradecirse — todos
// entran por esta misma puerta. Ver ORIGEN_PRODUCCION en constants.js.
// Un "servicio" se reconoce por su UNIDAD, no por una casilla aparte: si lo
// que compras se mide en "servicio", es que no se compra en ningún lado (no
// es tangible). Se sigue aceptando la casilla vieja `esServicio` para los
// insumos que se guardaron antes de este cambio.
export function esInsumoServicio(ins) {
  if (!ins) return false;
  if (norm(ins.unidad || "") === UNIDAD_SERVICIO) return true;
  return !!ins.esServicio;
}

// Total de prendas del pedido, sumando todas las referencias. Es el divisor
// de un costo global: se reparte parejo entre todo lo que se produce.
export function calcUnidadesCotizacion(cot) {
  return ((cot && cot.referencias) || []).reduce(function (a, r) { return a + (num(r.cantidadPedida) || 0); }, 0);
}

// Cuánto le toca por prenda a un costo global — el promedio sobre todas las
// prendas del pedido. Con 0 prendas devuelve el costo completo (aún no hay
// entre qué repartirlo) en vez de dividir por cero.
export function calcCostoPrendaGlobal(cot, global) {
  var unidades = calcUnidadesCotizacion(cot);
  return unidades > 0 ? num(global.costo) / unidades : num(global.costo);
}

// Lo que le toca a CADA prenda del pedido de TODOS los costos globales juntos.
export function calcCostoGlobalPorPrenda(cot) {
  var unidades = calcUnidadesCotizacion(cot);
  return unidades > 0 ? calcCostosGlobales(cot) / unidades : 0;
}

// Totales de una referencia CON la parte que le toca de los costos globales
// — el costo "cargado", que es el que de verdad tiene esa prenda.
//
// Existe aparte de calcRefTotales (que solo ve la referencia, sin saber de la
// cotización) porque es lo que hay que MOSTRAR: si el domicilio del pedido
// encarece cada prenda, el margen de la referencia tiene que reflejarlo. Antes
// la referencia mostraba solo su costo directo mientras el total del pedido y
// el reporte de productos ya contaban el global — y los tres números no
// coincidían aunque todos estuvieran "bien" por separado.
//
// No hay doble conteo: sumar esto sobre todas las referencias da exactamente
// costo directo + globales, que es lo mismo que calcula calcCotizacionTotales.
export function calcRefTotalesConGlobales(cot, ref) {
  var base = calcRefTotales(ref);
  var globalUnit = calcCostoGlobalPorPrenda(cot);
  var cantidad = num(ref.cantidadPedida) || 0;
  var costoUnit = base.costoUnit + globalUnit;
  var gananciaUnit = base.precioUnit - costoUnit;
  return {
    costoDirectoUnit: base.costoUnit,
    costoGlobalUnit: globalUnit,
    costoUnit: costoUnit,
    precioUnit: base.precioUnit,
    gananciaUnit: gananciaUnit,
    margenPct: base.precioUnit > 0 ? (gananciaUnit / base.precioUnit * 100) : 0,
    costoTotal: costoUnit * cantidad,
    precioTotal: base.precioTotal,
    gananciaTotal: gananciaUnit * cantidad
  };
}

export function calcCostoUnitarioRef(ref) {
  if (ref && ref.origen === "proveedor") return num(ref.costoCompra);
  return (ref.insumos || []).reduce(function (a, i) { return a + calcCostoPrenda(i, ref); }, 0);
}
export function calcRefTotales(ref) {
  var costoUnit = calcCostoUnitarioRef(ref);
  var precioUnit = num(ref.precioVenta);
  var cantidad = num(ref.cantidadPedida) || 0;
  var gananciaUnit = precioUnit - costoUnit;
  var margenPct = precioUnit > 0 ? (gananciaUnit / precioUnit * 100) : 0;
  return {
    costoUnit: costoUnit, precioUnit: precioUnit, gananciaUnit: gananciaUnit, margenPct: margenPct,
    costoTotal: costoUnit * cantidad, precioTotal: precioUnit * cantidad, gananciaTotal: gananciaUnit * cantidad
  };
}
// Costos que se pagan UNA vez por pedido, sin importar cuántas referencias
// tenga ni cuántas prendas lleve cada una: domicilio, diseño, un envío a
// sublimar. No son insumos de ninguna referencia en particular (repartirlos
// entre ellas obligaría a inventar un criterio que nadie pidió), así que
// viven en la cotización y se suman al final, ya sobre el total.
export function calcCostosGlobales(cot) {
  return ((cot && cot.costosGlobales) || []).reduce(function (a, c) { return a + num(c.costo); }, 0);
}
export function calcCotizacionTotales(cot) {
  var acc = { costoTotal: 0, precioTotal: 0, gananciaTotal: 0 };
  (cot.referencias || []).forEach(function (ref) {
    var t = calcRefTotales(ref);
    acc.costoTotal += t.costoTotal; acc.precioTotal += t.precioTotal; acc.gananciaTotal += t.gananciaTotal;
  });
  var globales = calcCostosGlobales(cot);
  acc.costosGlobales = globales;
  acc.costoTotal += globales;
  acc.gananciaTotal -= globales;
  acc.margenPct = acc.precioTotal > 0 ? (acc.gananciaTotal / acc.precioTotal * 100) : 0;
  return acc;
}
// Cada "costo real" registrado (gastosReales) representa lo que en verdad se
// pagó por un insumo puntual o por el costo total — NO es automáticamente la
// diferencia. La diferencia (sobrecosto o ahorro) sale de comparar ese monto
// real contra el estimado correspondiente (el insumo en la lista de compras,
// o el costo total estimado de la cotización, según lo que se haya elegido).
export function calcCotGastoEstimadoBase(cot, gasto) {
  if (gasto.destino === "insumo") {
    var compras = calcListaCompras(cot);
    var match = compras.filter(function (c) { return c.nombre.toLowerCase() === (gasto.destinoNombre || "").toLowerCase(); })[0];
    return match ? match.costoTotal : 0;
  }
  return calcCotizacionTotales(cot).costoTotal;
}
export function calcCotGastoVariacion(cot, gasto) {
  return num(gasto.monto) - calcCotGastoEstimadoBase(cot, gasto);
}
// La compra real registrada sobre UNA línea de la lista de compras (cantidad
// y costo que en verdad se pagaron, más a quién y con qué observación). Vive
// indexada por la `clave` de la línea, no por su posición, para que reordenar
// la lista o agregar insumos nuevos no le cambie el dueño a un dato ya
// registrado. Ver renderListaCompras en modules/cotizaciones.js.
export function compraDeLinea(cot, clave) {
  return ((cot && cot.compras) || []).filter(function (c) { return c.clave === clave; })[0] || null;
}

// Suma de variaciones (real vs. estimado) de lo que ya se compró.
//
// Dos fuentes que NO se pisan: `compras` es el modelo actual (una compra por
// línea de la lista, editable en la misma tabla) y `gastosReales` es el
// anterior (un registro suelto que elegía su destino en un desplegable). Una
// cotización vieja solo tiene el segundo y sigue calculando igual que
// siempre; las nuevas solo usan el primero.
export function calcCotGastosReales(cot) {
  var compras = calcListaCompras(cot);
  var deCompras = ((cot && cot.compras) || []).reduce(function (a, c) {
    if (!c.comprado || !num(c.costoReal)) return a;
    var linea = compras.filter(function (l) { return l.clave === c.clave; })[0];
    return a + (num(c.costoReal) - (linea ? linea.costoTotal : 0));
  }, 0);
  var deGastos = ((cot && cot.gastosReales) || []).reduce(function (a, g) { return a + calcCotGastoVariacion(cot, g); }, 0);
  return deCompras + deGastos;
}

// Resumen de avance de compras: cuántas líneas ya se compraron y cuánto se
// lleva gastado de verdad contra lo estimado.
export function calcResumenCompras(cot) {
  var lineas = calcListaCompras(cot);
  var acc = { total: lineas.length, compradas: 0, estimado: 0, real: 0 };
  lineas.forEach(function (l) {
    acc.estimado += num(l.costoTotal);
    var c = compraDeLinea(cot, l.clave);
    if (c && c.comprado) { acc.compradas++; acc.real += num(c.costoReal); }
  });
  acc.pendientes = acc.total - acc.compradas;
  return acc;
}

// Resultado REAL de la cotización: lo estimado ajustado por la diferencia entre
// los costos reales registrados y lo que se había presupuestado para ellos, y
// descontando la comisión del vendedor (si tiene una definida) — así la
// ganancia refleja lo que en verdad queda, no solo el margen bruto.
export function calcCotResultadoReal(cot) {
  var totales = calcCotizacionTotales(cot);
  var sobrecosto = calcCotGastosReales(cot);
  var comision = calcComisionValorCot(cot);
  var costoTotal = totales.costoTotal + sobrecosto;
  var gananciaTotal = totales.precioTotal - costoTotal - comision;
  var margenPct = totales.precioTotal > 0 ? (gananciaTotal / totales.precioTotal * 100) : 0;
  return { costoTotal: costoTotal, precioTotal: totales.precioTotal, gananciaTotal: gananciaTotal, margenPct: margenPct, sobrecosto: sobrecosto, comision: comision };
}

// Agrega los insumos usados en un conjunto de referencias de UNA cotización
// en un mapa {clave: {...}} — usado por calcListaCompras ("Qué falta
// comprar" de esa cotización).
function agregarInsumosDeReferencias(referencias) {
  var mapa = {};
  (referencias || []).forEach(function (ref) {
    var cantidadPedida = num(ref.cantidadPedida) || 0;
    // Referencia comprada a proveedor: lo que hay que comprar NO son insumos
    // sueltos (no se corta ni se cose nada) sino la prenda entera, y su costo
    // se define por referencia. Por eso emite UNA línea —la referencia misma—
    // en vez de recorrer insumos que no tiene. Esa línea es también la que
    // aparece como destino al registrar un costo real (ver renderTabProduccion
    // en modules/cotizaciones.js), que es justo lo que se pidió: costo real
    // por referencia, no por insumo individual.
    if (ref.origen === "proveedor") {
      var nombreRef = (ref.nombre || "Producto de proveedor").trim();
      var keyRef = "producto|" + nombreRef.toLowerCase();
      if (!mapa[keyRef]) mapa[keyRef] = { clave: keyRef, nombre: nombreRef, unidad: "UND", tipo: "producto_proveedor", esProducto: true, esServicio: false, proveedorId: ref.proveedorId || "", cantidadFisica: 0, costoTotal: 0, refs: [] };
      mapa[keyRef].cantidadFisica += cantidadPedida;
      mapa[keyRef].costoTotal += num(ref.costoCompra) * cantidadPedida;
      if (!mapa[keyRef].proveedorId && ref.proveedorId) mapa[keyRef].proveedorId = ref.proveedorId;
      return;
    }
    (ref.insumos || []).forEach(function (ins) {
      var nombre = (ins.nombre || "Insumo").trim();
      var key = nombre.toLowerCase() + "|" + ins.unidad + "|" + ins.tipo;
      if (!mapa[key]) mapa[key] = { clave: key, nombre: nombre, unidad: ins.unidad, tipo: ins.tipo, esServicio: esInsumoServicio(ins), proveedorId: ins.proveedorId || "", cantidadFisica: 0, costoTotal: 0, refs: [] };
      var cantFisica = 0;
      if (ins.tipo === "tela") cantFisica = (num(ref.consumoAprox) || 0) * (num(ins.cantidad) || 1) * cantidadPedida;
      else if (ins.tipo === "por_prenda") cantFisica = (num(ins.cantidad) || 1) * cantidadPedida;
      mapa[key].cantidadFisica += cantFisica;
      mapa[key].costoTotal += calcCostoPrenda(ins, ref) * cantidadPedida;
      if (esInsumoServicio(ins)) mapa[key].esServicio = true;
      if (!mapa[key].proveedorId && ins.proveedorId) mapa[key].proveedorId = ins.proveedorId;
      if (ref.nombre && mapa[key].refs.indexOf(ref.nombre) === -1) mapa[key].refs.push(ref.nombre);
    });
  });
  return mapa;
}
// Consolida en una sola lista TODO lo que hay que comprar para una cotización:
// los insumos de sus referencias (si dos comparten una tela, acá ya suman
// juntas), las prendas que se compran hechas a un proveedor, y los costos
// globales del pedido. `clave` identifica cada línea de forma estable — es lo
// que permite guardarle al lado su compra real (cantidad, costo, proveedor)
// sin depender de la posición en la lista, que cambia al reordenar.
export function calcListaCompras(cot) {
  var mapa = agregarInsumosDeReferencias((cot && cot.referencias) || []);
  ((cot && cot.costosGlobales) || []).forEach(function (g) {
    var nombre = (g.nombre || "Costo del pedido").trim();
    var key = "global|" + g.id;
    mapa[key] = {
      clave: key, nombre: nombre, unidad: "", tipo: "global", esGlobal: true,
      // Igual que cualquier insumo: es servicio si su unidad lo dice.
      esServicio: esInsumoServicio(g),
      proveedorId: g.proveedorId || "",
      cantidadFisica: num(g.cantidad) || 0, costoTotal: num(g.costo), refs: []
    };
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.costoTotal - a.costoTotal; });
}

// ---------- costeo de productos del catálogo ----------
// Un producto del catálogo se costea con la MISMA fórmula que una referencia
// de cotización, tratándolo como "una referencia de cantidad 1": así un
// producto fabricado suma sus insumos y uno comprado usa su costo de compra
// (ver calcCostoUnitarioRef), sin que ninguna pantalla tenga que rearmar el
// cálculo por su cuenta.
export function calcTotalesProducto(p) {
  if (!p) return calcRefTotales({ insumos: [], cantidadPedida: 1 });
  return calcRefTotales({
    origen: p.origen, costoCompra: p.costoCompra,
    consumoAprox: p.consumoSugerido, cantidadPedida: 1,
    precioVenta: p.precioVenta, insumos: p.insumos || []
  });
}
export function calcCostoUnitarioProducto(p) {
  return calcTotalesProducto(p).costoUnit;
}

// ---------- líneas de un pedido ----------
// Toda línea de pedido (venga del catálogo o escrita a mano) guarda su propio
// precio y costo UNITARIOS. De ahí salen el total y el costo del pedido: no
// se escriben a mano en el formulario, se calculan — así es imposible que el
// total diga una cosa y las líneas otra. Ver renderIndicadoresPedido en
// modules/pedidos.js, que muestra justo estos números.
export function calcTotalesLineasPedido(lineas) {
  var unidades = 0, precioTotal = 0, costoDirecto = 0, costoIndirecto = 0;
  (lineas || []).forEach(function (l) {
    var cant = num(l.cantidad);
    unidades += cant;
    precioTotal += num(l.precioUnitario) * cant;
    costoDirecto += num(l.costoUnitario) * cant;
    // Parte que le toca a esta línea de los costos globales del pedido
    // (domicilio, diseño): se reparte al convertir la cotización, ver
    // lineasDeCotizacion en modules/cotizaciones.js. Sin esto, el costo del
    // pedido y la suma de sus líneas no daban lo mismo.
    costoIndirecto += num(l.costoIndirectoUnitario) * cant;
  });
  var costoTotal = costoDirecto + costoIndirecto;
  var gananciaTotal = precioTotal - costoTotal;
  return {
    unidades: unidades,
    precioTotal: precioTotal,
    costoTotal: costoTotal,
    costoDirecto: costoDirecto,
    costoIndirecto: costoIndirecto,
    gananciaTotal: gananciaTotal,
    margenPct: precioTotal > 0 ? (gananciaTotal / precioTotal * 100) : 0,
    // Promedios por unidad: con líneas distintas (una camiseta y un bordado)
    // el "x unidad" solo tiene sentido como promedio del pedido.
    precioUnit: unidades > 0 ? precioTotal / unidades : 0,
    costoUnit: unidades > 0 ? costoTotal / unidades : 0,
    gananciaUnit: unidades > 0 ? gananciaTotal / unidades : 0
  };
}

// Fecha en que se vendió un pedido. Los pedidos creados desde ahora guardan
// `fechaCreacion`; los que ya existían no la tienen, así que se deduce de lo
// que sí quedó fechado (el primer abono, o la fecha de entrega) para que un
// reporte por rango no los deje afuera en silencio.
export function fechaPedido(p) {
  if (!p) return "";
  if (p.fechaCreacion) return p.fechaCreacion;
  var abonos = (p.abonos || []).slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
  if (abonos.length && abonos[0].fecha) return abonos[0].fecha;
  return p.fechaEntrega || "";
}

// ---------- reporte de productos vendidos ----------
// Filas de "qué productos se vendieron" en un rango, con el detalle que hace
// falta para entender el porqué de la plata: talla, N.º de OP, cliente,
// vendedor, y costo/precio/ganancia unitarios tomados de la propia línea (no
// del catálogo de hoy, que pudo cambiar de precio después de la venta).
//
// Dos fuentes, porque son dos hechos distintos:
//   - venta directa: las líneas del pedido, que ya son la venta.
//   - consignación: solo las ventas REPORTADAS por el punto — lo remitido
//     está en el punto, todavía no vendido, y contarlo aquí inflaría el
//     reporte con plata que nadie ha recibido.
export function calcProductosVendidosRango(desde, hasta) {
  var filas = [];
  function enRango(f) { return f && (!desde || f >= desde) && (!hasta || f <= hasta); }

  (state.pedidos || []).forEach(function (p) {
    // Un pedido cancelado no vendió nada: sacarlo de acá es lo que evita que
    // el reporte cuente como ingreso una venta que no ocurrió. La plata que sí
    // se movió (un abono que no se devolvió) sigue estando en Finanzas, que es
    // donde corresponde.
    if (pedidoCancelado(p)) return;
    var vendedor = (p.vendedor && p.vendedor.nombre) || "";
    if (p.consignacion) {
      (p.consignacion.ventas || []).forEach(function (v) {
        if (!enRango(v.fecha)) return;
        var prod = v.productoId ? productoById(v.productoId) : null;
        var cant = num(v.cantidad) || 0;
        var precioUnit = cant > 0 ? num(v.montoTotal) / cant : 0;
        var costoUnit = calcCostoUnitarioProducto(prod);
        filas.push({
          fecha: v.fecha, tipo: "consignacion",
          productoId: v.productoId || "", concepto: (prod && prod.nombre) || p.descripcion || "—",
          talla: v.talla || "—", cantidad: cant,
          costoUnit: costoUnit, precioUnit: precioUnit,
          costoTotal: costoUnit * cant, precioTotal: num(v.montoTotal),
          // Ganancia BRUTA (precio - costo), igual que en una venta directa.
          // La comisión del punto NO se resta acá aunque salga de esta venta:
          // ya cuenta como gasto propio en Finanzas (tipo "comision"), y
          // restarla también aquí la contaría dos veces contra el mismo peso.
          // Se expone aparte por si algún reporte la quiere mostrar.
          ganancia: num(v.montoTotal) - costoUnit * cant,
          comision: num(v.comisionMonto),
          numeroOp: p.numeroOp || "—", cliente: p.cliente || "—", vendedor: vendedor
        });
      });
      return;
    }
    var fecha = fechaPedido(p);
    if (!enRango(fecha)) return;
    // `lineas` es el detalle completo (precio y costo de cada línea tal como
    // se vendió). Los pedidos anteriores a las líneas solo tienen
    // `stockConsumido`, sin precio propio — se completa con el catálogo.
    var lineas = (p.lineas && p.lineas.length) ? p.lineas : (p.stockConsumido || []);
    lineas.forEach(function (l) {
      var prod = l.productoId ? productoById(l.productoId) : null;
      var cant = num(l.cantidad) || 0;
      var precioUnit = l.precioUnitario !== undefined ? num(l.precioUnitario) : num(prod && prod.precioVenta);
      var costoDirectoUnit = l.costoUnitario !== undefined ? num(l.costoUnitario) : calcCostoUnitarioProducto(prod);
      // El costo real de vender esta línea incluye la parte que le tocó de
      // los costos globales del pedido (domicilio, diseño...). Sin sumarla, el
      // reporte reportaba MENOS costo del que la cotización ya había contado,
      // e inflaba la ganancia por esa misma diferencia.
      var costoUnit = costoDirectoUnit + num(l.costoIndirectoUnitario);
      filas.push({
        fecha: fecha, tipo: "directa",
        productoId: l.productoId || "",
        concepto: l.productoNombre || l.textoDescripcion || (prod && prod.nombre) || "—",
        talla: l.talla || "—", cantidad: cant,
        costoUnit: costoUnit, costoDirectoUnit: costoDirectoUnit, precioUnit: precioUnit,
        costoTotal: costoUnit * cant, precioTotal: precioUnit * cant,
        ganancia: (precioUnit - costoUnit) * cant,
        comision: 0,
        numeroOp: p.numeroOp || "—", cliente: p.cliente || "—", vendedor: vendedor,
        observacion: l.observacion || "",
        campos: l.campos || []
      });
    });
  });

  return filas.sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

// Pedidos cuya venta cae en el rango, con lo que hace falta para leerlos de
// un vistazo: qué se vendió, por cuánto, cuánto se cobró y qué falta cobrar.
// Usa la MISMA fecha que el reporte de productos (fechaPedido), para que un
// pedido no pueda aparecer en un reporte y faltar en el otro.
export function calcPedidosRango(desde, hasta) {
  return (state.pedidos || [])
    .filter(function (p) {
      var f = fechaPedido(p);
      return f && (!desde || f >= desde) && (!hasta || f <= hasta);
    })
    .map(function (p) {
      var total = num(p.total), abonado = num(p.abono);
      return {
        id: p.id, fecha: fechaPedido(p), numeroOp: p.numeroOp || "—",
        cliente: p.cliente || "—", descripcion: p.descripcion || "—",
        cantidad: num(p.cantidad),
        total: total, costo: num(p.costo), ganancia: total - num(p.costo),
        abonado: abonado, saldo: total - abonado,
        // El cancelado SIGUE apareciendo en la lista —es el registro de que
        // existió— pero va marcado, y calcResumenPedidos lo deja fuera de los
        // totales para no contar como vendido algo que no se vendió.
        cancelado: pedidoCancelado(p),
        estado: pedidoCancelado(p) ? "Cancelado" : estadoLabelDe(p),
        tipo: p.consignacion ? "Consignación" : "Venta directa",
        vendedor: (p.vendedor && p.vendedor.nombre) || ""
      };
    })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

// Los totales del reporte cuentan solo lo que de verdad se vendió: un pedido
// cancelado aparece en la lista (para que quede el registro) pero no suma.
// `cancelados` se expone aparte para poder decirlo en pantalla en vez de que
// el usuario note que la suma de la columna no da el total.
export function calcResumenPedidos(filas) {
  var vigentes = (filas || []).filter(function (f) { return !f.cancelado; });
  var acc = { pedidos: vigentes.length, cancelados: (filas || []).length - vigentes.length, unidades: 0, total: 0, costo: 0, ganancia: 0, abonado: 0, saldo: 0 };
  vigentes.forEach(function (f) {
    acc.unidades += num(f.cantidad); acc.total += num(f.total); acc.costo += num(f.costo);
    acc.ganancia += num(f.ganancia); acc.abonado += num(f.abonado); acc.saldo += num(f.saldo);
  });
  return acc;
}

// Ventas por vendedor DENTRO del rango — distinto de calcVentasVendedor(),
// que es el acumulado histórico de una persona para su propio panel. Acá
// interesa el periodo del reporte.
export function calcVentasPorVendedorRango(desde, hasta) {
  var mapa = {};
  calcPedidosRango(desde, hasta).forEach(function (f) {
    if (f.cancelado) return; // no es una venta suya: no se le acredita
    var nombre = f.vendedor || "(sin vendedor)";
    if (!mapa[nombre]) mapa[nombre] = { vendedor: nombre, pedidos: 0, unidades: 0, total: 0, ganancia: 0, comision: 0 };
    mapa[nombre].pedidos++;
    mapa[nombre].unidades += num(f.cantidad);
    mapa[nombre].total += num(f.total);
    mapa[nombre].ganancia += num(f.ganancia);
    var ped = (state.pedidos || []).filter(function (p) { return p.id === f.id; })[0];
    if (ped && ped.vendedor && ped.vendedor.nombre) mapa[nombre].comision += calcComisionValor(ped);
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; })
    .sort(function (a, b) { return b.total - a.total; });
}

export function calcResumenProductosVendidos(filas) {
  var acc = { unidades: 0, costoTotal: 0, precioTotal: 0, ganancia: 0 };
  (filas || []).forEach(function (f) {
    acc.unidades += num(f.cantidad); acc.costoTotal += num(f.costoTotal);
    acc.precioTotal += num(f.precioTotal); acc.ganancia += num(f.ganancia);
  });
  acc.margenPct = acc.precioTotal > 0 ? (acc.ganancia / acc.precioTotal * 100) : 0;
  return acc;
}

// Compras de insumo REALES de un rango (nunca estimaciones): son los
// movimientos marcados `esInsumo`, ya sea desde "Registrar costo real" de una
// cotización o desde el checkbox de Finanzas. `cantidad` y `unidad` son
// opcionales — los movimientos viejos no las tienen y se muestran como "—".
export function calcComprasInsumoRango(movimientos) {
  return (movimientos || [])
    .filter(function (t) { return t.esInsumo; })
    .map(function (t) {
      return {
        fecha: t.fecha || "—", concepto: t.concepto || "—",
        cantidad: t.cantidad !== undefined && t.cantidad !== "" ? num(t.cantidad) : null,
        unidad: t.unidad || "",
        proveedor: t.contraparte || "",
        monto: num(t.monto)
      };
    })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}
