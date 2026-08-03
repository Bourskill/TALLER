// Todo lo que se "calcula" a partir del estado vive aquí, separado del render.
// Ventaja para el futuro: se pueden probar estas funciones de forma aislada
// (son puras salvo por leer `state`) y reutilizarlas en reportes/exportaciones
// sin arrastrar código de HTML.

import { state } from "./store.js";
import { num, norm, todayStr, diasPagoDe } from "./utils.js";
import { ESTADOS_DEFAULT } from "./constants.js";

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
// "Por cobrar": el saldo pendiente de TODOS los pedidos (total - abono, cuando
// es positivo). Ya no se suman "ingresos pendientes sueltos" — un ingreso que
// aún no se recibió no es un movimiento de Finanzas, es saldo de un pedido.
export function calcSaldoPedido(p) {
  return num(p.total) - num(p.abono);
}
export function calcPorCobrarPedidos() {
  return state.pedidos.reduce(function (a, p) {
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

  var nominaPend = calcNominaPendiente();
  if (nominaPend > 0) {
    categorias.push({
      categoria: "Nómina", monto: nominaPend,
      items: [{ concepto: "Nómina del periodo", monto: nominaPend, fecha: calcFechaVencimientoPeriodo(state.config.periodoPago || "mensual", diasPagoDe({ diasPago: state.config.diasPagoNomina, diaPago: state.config.diaPagoNomina })) }]
    });
  }

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
        return { concepto: v.nombre + " (" + v.cantidad + (v.cantidad === 1 ? " pedido" : " pedidos") + ")", monto: v.monto, fecha: v.fechaPago ? new Date(v.fechaPago + "T00:00:00") : null };
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

  var nominaPend = calcNominaPendiente();
  if (nominaPend > 0) {
    items.push({ monto: nominaPend, fecha: calcFechaVencimientoPeriodo(state.config.periodoPago || "mensual", diasPagoDe({ diasPago: state.config.diasPagoNomina, diaPago: state.config.diaPagoNomina })) });
  }

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
    if (!p.consignacion) return;
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
    if (p.vendedor && p.vendedor.nombre && p.vendedor.estado !== "pagado") agregar(p.vendedor.nombre, calcComisionValor(p), p.vendedor.fechaPago);
  });
  state.cotizaciones.forEach(function (c) {
    if (c.estado !== "convertida" && c.vendedor && c.vendedor.nombre && c.vendedor.estado !== "pagado") agregar(c.vendedor.nombre, calcComisionValorCot(c), c.vendedor.fechaPago);
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.monto - a.monto; });
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
export function calcNominaPendiente() {
  // La porción de la nómina fija definida en Configuración correspondiente
  // al periodo de pago actual (mensual/quincenal/semanal), si todavía no se
  // registró como pagada (tx tipo "nomina") en ese periodo. Ya no existe un
  // "pendiente manual" aparte: un pago de nómina que aún no se hizo no es un
  // movimiento de Finanzas, así que no vive ahí.
  var periodo = state.config.periodoPago || "mensual";
  var factor = factorPeriodo(periodo);
  var miPeriodo = periodoKey(todayStr(), periodo);
  var definidaPeriodo = calcNominaMensualDefinida() / factor;
  var pagadaEstePeriodo = state.tx
    .filter(function (t) { return t.tipo === "nomina" && periodoKey(t.fecha, periodo) === miPeriodo; })
    .reduce(function (a, t) { return a + num(t.monto); }, 0);
  return Math.max(0, definidaPeriodo - pagadaEstePeriodo);
}

// ---------- pedidos / equipo ----------
export function calcPedidosActivos() {
  return state.pedidos.filter(function (p) { return p.estado !== "entregado"; }).length;
}
export function calcNominaMensualDefinida() {
  return (state.config.nomina || []).reduce(function (a, e) { return a + num(e.salario); }, 0);
}
export function calcNumPersonas() {
  return (state.config.nomina || []).length + num(state.config.numExtra);
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
export function calcConsignacionDisponible(p) {
  if (!p.consignacion) return 0;
  return Math.max(0, num(p.consignacion.cantidadEnviada) - calcConsignacionVendida(p) - calcConsignacionRetirada(p));
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
    if (!p.consignacion) return a;
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
    if (!p.consignacion) return;
    (p.consignacion.ventas || []).forEach(function (v) {
      if (!v.comisionPagada) agregar(p.cliente || "Punto de consignación", num(v.comisionMonto));
    });
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.monto - a.monto; });
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
export function clientesFiltrados() {
  var q = norm(state.filtroClientes).trim();
  var list = state.clientes.slice().sort(function (a, b) { return norm(a.nombre) < norm(b.nombre) ? -1 : 1; });
  if (!q) return list;
  return list.filter(function (c) {
    return norm(c.nombre).indexOf(q) >= 0 || norm(c.cedula).indexOf(q) >= 0 ||
      norm(c.ciudad).indexOf(q) >= 0 || norm(c.telefono).indexOf(q) >= 0;
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
export function calcCostoUnitarioRef(ref) {
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
export function calcCotizacionTotales(cot) {
  var acc = { costoTotal: 0, precioTotal: 0, gananciaTotal: 0 };
  (cot.referencias || []).forEach(function (ref) {
    var t = calcRefTotales(ref);
    acc.costoTotal += t.costoTotal; acc.precioTotal += t.precioTotal; acc.gananciaTotal += t.gananciaTotal;
  });
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
// Suma de variaciones (real vs. estimado) de todos los costos reales registrados.
// Nota: si se registra más de un costo real para el mismo insumo/total, cada uno
// se compara contra el mismo estimado base — para resultados exactos, registra
// el costo real total de cada insumo en una sola línea.
export function calcCotGastosReales(cot) {
  return (cot.gastosReales || []).reduce(function (a, g) { return a + calcCotGastoVariacion(cot, g); }, 0);
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

// Consolida los insumos de TODAS las referencias de una cotización en una sola
// lista de compras: si dos referencias comparten una tela, aquí ya suman juntas.
export function calcListaCompras(cot) {
  var mapa = {};
  (cot.referencias || []).forEach(function (ref) {
    var cantidadPedida = num(ref.cantidadPedida) || 0;
    (ref.insumos || []).forEach(function (ins) {
      var nombre = (ins.nombre || "Insumo").trim();
      var key = nombre.toLowerCase() + "|" + ins.unidad + "|" + ins.tipo;
      if (!mapa[key]) mapa[key] = { nombre: nombre, unidad: ins.unidad, tipo: ins.tipo, cantidadFisica: 0, costoTotal: 0, refs: [] };
      var cantFisica = 0;
      if (ins.tipo === "tela") cantFisica = (num(ref.consumoAprox) || 0) * (num(ins.cantidad) || 1) * cantidadPedida;
      else if (ins.tipo === "por_prenda") cantFisica = (num(ins.cantidad) || 1) * cantidadPedida;
      mapa[key].cantidadFisica += cantFisica;
      mapa[key].costoTotal += calcCostoPrenda(ins, ref) * cantidadPedida;
      if (ref.nombre && mapa[key].refs.indexOf(ref.nombre) === -1) mapa[key].refs.push(ref.nombre);
    });
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.costoTotal - a.costoTotal; });
}
