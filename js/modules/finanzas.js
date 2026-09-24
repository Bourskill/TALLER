import { state, persist, notify, mostrarToast } from "../core/store.js";
import { esc, opt, num, uid, todayStr, fmt, norm, exigirCampos } from "../core/utils.js";
import { clienteById, periodoKey, origenDeTx, origenSistemaDeTx, origenSistemaHuerfano, proveedoresDeContactos, validarServiciosAsignados, calcListaCompras, estadoLineaCompra, calcGruposCompraCompartida, calcGruposCostoCompartido, repartirProporcional, pedidoCancelado } from "../core/calc.js";
import { renderHelp, renderBuscador, renderComboUnidad, renderAsignarServicios, renderHistorialServicio } from "../core/components.js";
import { sincronizarComprasFinanzasDe } from "./cotizaciones.js";

var PERIODOS_TX = { todos: "Todo el histórico", mensual: "Este mes", quincenal: "Esta quincena", semanal: "Esta semana" };
var TIPOS_TX = { ingreso: "Ingreso", gasto: "Gasto", nomina: "Nómina", comision: "Comisión" };
// Los tres tipos que se pueden CREAR a mano. "comision" no está: esas las
// genera la app al marcar pagada la comisión de un vendedor, y crearlas
// sueltas duplicaría el pago (ver origenSistemaDeTx en core/calc.js).
var TIPOS_NUEVO_TX = [["ingreso", "↓ Ingreso"], ["gasto", "↑ Gasto"], ["nomina", "👤 Nómina"]];
var TIPO_SUSTANTIVO = { ingreso: "ingreso", gasto: "gasto", nomina: "pago de nómina" };

// Dos pestañas (mismo patrón "gsheet-tabs" que Cotizaciones/Pedidos/
// Clientes/Deudas): "Registrar movimiento" es solo el formulario de alta, y
// "Historial" es la lista agrupada con filtros/búsqueda — antes vivían
// siempre juntos, apilados, así que el formulario ocupaba espacio arriba de
// todo aunque lo único que quisieras hacer fuera revisar movimientos viejos.
export function render() {
  var vista = state.finanzasVista || "nuevo";
  var html = renderTabsFinanzas(vista);
  if (vista === "historial") {
    html += state.filtroTxVista === "papelera" ? renderPapelera() : renderHistorial();
  } else if (vista === "conjuntas") {
    html += renderComprasConjuntas();
  } else {
    html += renderFormMovimiento();
  }
  html += renderHistorialServicio(state.historialServicioAbierto);
  return html;
}

function renderTabsFinanzas(vista) {
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nuevo" ? "active" : "") + '" data-action="finanzas-vista" data-val="nuevo">+ Registrar movimiento</button>' +
    '<button class="gsheet-tab ' + (vista === "historial" ? "active" : "") + '" data-action="finanzas-vista" data-val="historial">Historial' + (state.tx.length ? " (" + state.tx.length + ")" : "") + "</button>" +
    '<button class="gsheet-tab ' + (vista === "conjuntas" ? "active" : "") + '" data-action="finanzas-vista" data-val="conjuntas">Compras conjuntas</button>' +
    "</div>";
}

// ---------- Compras conjuntas: varios pedidos que comparten insumo ----------
// Cuando se produce varios pedidos a la vez y comparten un insumo (la misma
// tela, por ejemplo), esto deja elegir cuáles y arma una fila por cada
// insumo que se repita entre ellos — igual que las referencias de UNA
// cotización ya se juntan solas en su lista de compras (ver
// agregarInsumosDeReferencias en core/calc.js), pero a través de varios
// pedidos. Lo comprado en total se reparte a PRORRATA de lo que cada uno
// necesitaba (ver repartirProporcional): si se compra de más o de menos
// frente a la suma de lo estimado, esa diferencia también se reparte
// proporcional, no parejo entre todos. Reportado por el usuario 2026-09-20.
function renderComprasConjuntas() {
  var sel = state.formCompraConjunta.seleccion || [];
  var candidatos = state.pedidos.filter(function (p) {
    if (pedidoCancelado(p) || !p.cotizacionId) return false;
    var cot = state.cotizaciones.filter(function (c) { return c.id === p.cotizacionId; })[0];
    if (!cot) return false;
    // Un costo global (domicilio, diseño) también cuenta, aunque su
    // esServicio sea inerte en true (ver calcGruposCostoCompartido) — si
    // no, un pedido cuyo único pendiente en común fuera "Domicilio" nunca
    // aparecería para elegir.
    return calcListaCompras(cot).some(function (l) { return (l.esGlobal || !l.esServicio) && estadoLineaCompra(cot, l) === "no"; });
  });

  var html = '<div class="card">';
  html += '<div class="cot-col-title" style="margin-top:0;">Elige los pedidos que vas a comprar juntos' +
    renderHelp("Marca dos o más pedidos que compartan un mismo insumo (la misma tela, por ejemplo). Abajo se arma una fila por cada insumo que se repita entre los que elijas, para repartir la compra real entre ellos a prorrata de lo que cada uno necesitaba.") +
    (sel.length ? ' <span class="tag">' + sel.length + " elegido" + (sel.length === 1 ? "" : "s") + "</span>" : "") +
    "</div>";

  if (!candidatos.length) {
    html += '<div class="empty">No hay pedidos con compras pendientes todavía — marca algún insumo en "No" en la pestaña Producción de una cotización.</div></div>';
    return html;
  }

  html += '<div class="picker-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius-sm);">';
  candidatos.forEach(function (p) {
    var marcado = sel.indexOf(p.id) !== -1;
    html += '<label class="picker-item ' + (marcado ? "sel" : "") + '" style="grid-template-columns:20px 1fr;">' +
      '<input type="checkbox" data-action="toggle-compra-conjunta-pedido" data-id="' + p.id + '" ' + (marcado ? "checked" : "") + " />" +
      '<span class="picker-item-info"><b>' + esc(p.numeroOp || "OP-????") + " · " + esc(p.cliente || "Sin cliente") + "</b><small>" + esc(p.descripcion || "") + "</small></span>" +
      "</label>";
  });
  html += "</div></div>";

  if (sel.length > 1) {
    html += renderGruposCompraConjunta(calcGruposCompraCompartida(sel));
    html += renderGruposCostoCompartido(calcGruposCostoCompartido(sel));
  } else if (sel.length === 1) {
    html += '<div class="empty" style="margin-top:12px;">Elige al menos un segundo pedido para ver qué insumos comparten.</div>';
  }
  return html;
}

function renderGruposCompraConjunta(grupos) {
  if (!grupos.length) {
    return '<div class="empty" style="margin-top:12px;">Estos pedidos no tienen ningún insumo pendiente en común.</div>';
  }
  var draft = state.formCompraConjunta.porClave || {};
  var html = '<div class="cot-col-title" style="margin-top:16px;">Insumos que se repiten' +
    renderHelp('Cada fila es un insumo pendiente ("No") en 2 o más de los pedidos elegidos. Escribe cuánto compraste EN TOTAL y cuánto costó — se reparte solo entre esos pedidos a prorrata de lo que cada uno necesitaba, y deja cada compra marcada "Sí" (con su movimiento en Finanzas incluido, igual que "Actualizar movimientos financieros").') +
    "</div>";
  grupos.forEach(function (g) { html += renderFilaGrupoCompraConjunta(g, draft[g.clave] || {}); });
  return html;
}

// Un costo FIJO del pedido (domicilio, diseño...) pagado de una sola vez
// para varios pedidos a la vez — reportado por el usuario 2026-09-21: "no
// me sale domicilio y los pedidos compartidos si lo tienen en comun".
// Distinto de "Insumos que se repiten" (arriba): no hay cantidad que
// repartir, solo un monto — ver calcGruposCostoCompartido en core/calc.js.
function renderGruposCostoCompartido(grupos) {
  if (!grupos.length) {
    return '<div class="empty" style="margin-top:12px;">Estos pedidos no tienen ningún costo (domicilio, diseño...) pendiente en común.</div>';
  }
  var draft = state.formCompraConjunta.porClave || {};
  var html = '<div class="cot-col-title" style="margin-top:16px;">Costos compartidos del pedido (domicilio, diseño...)' +
    renderHelp('Para cuando un solo pago (ej. un domicilio) en realidad cubrió varios pedidos a la vez. Cada fila es un costo del mismo nombre, pendiente ("No"), en 2 o más de los pedidos elegidos. Escribe cuánto pagaste EN TOTAL — se reparte entre esos pedidos y deja cada uno con su propio costo marcado "Sí".') +
    "</div>";
  grupos.forEach(function (g) { html += renderFilaGrupoCostoCompartido(g, draft[g.clave] || {}); });
  return html;
}

function renderFilaGrupoCostoCompartido(g, d) {
  var costoTotal = num(d.costoTotal);
  var listo = costoTotal > 0;
  var html = '<div class="card cc-grupo' + (listo ? " cc-grupo-listo" : "") + '">';
  html += '<div class="cc-grupo-head">' +
    '<div class="cc-grupo-titulo"><b>' + esc(g.nombre) + '</b><span class="tag">' + g.participantes.length + " pedidos</span></div>" +
    '<span class="section-sub" style="margin:0;">Estimado ' + fmt(g.totalCostoEstimado) + "</span>" +
    "</div>";
  html += '<div class="cc-grupo-participantes">' +
    g.participantes.map(function (p) { return '<span class="cc-chip">' + esc(p.etiqueta) + " · " + fmt(p.costoEstimado) + "</span>"; }).join("") +
    "</div>";

  html += '<div class="form-grid" style="margin-top:var(--sp-3);">' +
    '<div class="field"><label>Costo total pagado</label><input type="number" class="mini-input" placeholder="' + Math.round(g.totalCostoEstimado) + '" value="' + esc(d.costoTotal || "") + '" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.clave) + '" data-campo="costoTotal" /></div>' +
    "</div>";

  if (listo) {
    var pesos = g.participantes.map(function (p) { return p.costoEstimado; });
    var costos = repartirProporcional(costoTotal, pesos, 0);
    var overridesCosto = d.costosPorPedido || {};
    var costosFinal = g.participantes.map(function (p, i) {
      var ov = overridesCosto[p.cotId];
      return (ov !== undefined && ov !== "") ? num(ov) : costos[i];
    });
    var repartidoTotal = costosFinal.reduce(function (a, v) { return a + v; }, 0);
    var cuadra = Math.abs(repartidoTotal - costoTotal) <= 1;

    html += '<div class="cc-reparto">';
    html += '<div class="cot-col-title" style="margin-top:var(--sp-3);">Se reparte así' +
      renderHelp("El costo de cada pedido viene calculado a prorrata de su propio estimado (parejo si nadie tenía un estimado escrito), pero se puede corregir a mano en cualquier fila — mientras la suma coincida con el total pagado, se guarda tal cual la dejes.") +
      "</div>";
    html += '<div class="tx-row head" style="grid-template-columns:1fr 120px;">' +
      '<span>Pedido</span><span class="ins-th-num">Costo</span></div>';
    g.participantes.forEach(function (p, i) {
      var valorCosto = overridesCosto[p.cotId] !== undefined ? overridesCosto[p.cotId] : Math.round(costos[i]);
      html += '<div class="tx-row" style="grid-template-columns:1fr 120px;">' +
        '<span class="mobile-th">Pedido</span><span>' + esc(p.etiqueta) + "</span>" +
        '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="text-align:right;width:100%;" value="' + esc(valorCosto) + '" data-action-change="set-costo-compartido-monto" data-clave="' + esc(g.clave) + '" data-cot="' + esc(p.cotId) + '" />' +
        "</div>";
    });
    html += '<div class="section-sub" style="margin-top:6px;text-align:right;">Repartido: <b style="color:' + (cuadra ? "var(--ink)" : "var(--danger-ink)") + ';">' + fmt(repartidoTotal) + "</b> / " + fmt(costoTotal) + "</div>";
    html += "</div>";
    html += '<div class="row-actions" style="margin-top:var(--sp-3);"><button class="btn" data-action="registrar-costo-compartido" data-clave="' + esc(g.clave) + '">Registrar este costo</button></div>';
  }
  html += "</div>";
  return html;
}

function renderFilaGrupoCompraConjunta(g, d) {
  var cantidadTotal = num(d.cantidadTotal), costoTotal = num(d.costoTotal);
  var listo = cantidadTotal > 0 && costoTotal > 0;
  // Una prenda comprada entera (`esProducto`, ver calcGruposCompraCompartida
  // en core/calc.js — insumo tipo "producto_comprado", siempre en "UND") no
  // se puede repartir en fracciones: "1.34 camisetas" no existe. El resto de
  // insumos (tela por metro, hilo, etc.) sí son cantidades continuas y
  // siguen repartiéndose con 2 decimales, como siempre.
  var decCant = g.esProducto ? 0 : 2;
  var html = '<div class="card cc-grupo' + (listo ? " cc-grupo-listo" : "") + '">';
  html += '<div class="cc-grupo-head">' +
    '<div class="cc-grupo-titulo"><b>' + esc(g.nombre) + '</b><span class="tag">' + g.participantes.length + " pedidos</span></div>" +
    '<span class="section-sub" style="margin:0;">Necesitan en total ' + num(g.totalCantidadEstimada).toFixed(decCant) + " " + esc(g.unidad || "") + " · estimado " + fmt(g.totalCostoEstimado) + "</span>" +
    "</div>";
  html += '<div class="cc-grupo-participantes">' +
    g.participantes.map(function (p) { return '<span class="cc-chip">' + esc(p.etiqueta) + " · " + num(p.cantidadEstimada).toFixed(decCant) + " " + esc(g.unidad || "") + "</span>"; }).join("") +
    "</div>";

  html += '<div class="form-grid" style="margin-top:var(--sp-3);">' +
    '<div class="field"><label>Cantidad total comprada</label><input type="number" class="mini-input" ' + (g.esProducto ? 'step="1" ' : "") + 'placeholder="' + num(g.totalCantidadEstimada).toFixed(decCant) + '" value="' + esc(d.cantidadTotal || "") + '" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.clave) + '" data-campo="cantidadTotal" /></div>' +
    '<div class="field"><label>Costo total pagado</label><input type="number" class="mini-input" placeholder="' + Math.round(g.totalCostoEstimado) + '" value="' + esc(d.costoTotal || "") + '" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.clave) + '" data-campo="costoTotal" /></div>' +
    '<div class="field"><label>Cantidad para compra de insumo (excedente)' +
    renderHelp("Cuánto de lo comprado sobra (mínimo del proveedor, conviene comprar de más) — queda como una RESERVA compartida entre estos mismos pedidos, no como costo ni sobrecosto de ninguno. Su parte del costo también se separa del total pagado (no se reparte entre los pedidos, no lo regalaron). Si más adelante uno de ellos necesita más de lo estimado (ej. una reposición), se descuenta solo de acá en vez de contar como una compra nueva.") +
    '</label><input type="number" class="mini-input" ' + (g.esProducto ? 'step="1" ' : "") + 'placeholder="0" value="' + esc(d.cantidadExcedente || "") + '" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.clave) + '" data-campo="cantidadExcedente" /></div>' +
    '<div class="field">' + renderSelectProveedorConjunta(g, d) + "</div>" +
    "</div>";

  if (listo) {
    var pesos = g.participantes.map(function (p) { return p.cantidadEstimada; });
    var cantidades = repartirProporcional(cantidadTotal, pesos, decCant);
    var cantidadExcedenteTotal = num(d.cantidadExcedente);
    var excedentes = cantidadExcedenteTotal > 0 ? repartirProporcional(cantidadExcedenteTotal, pesos, decCant) : null;
    // El costo total pagado cubre TANTO lo que necesitaban los pedidos COMO
    // el excedente que se llevó de más — si no se descuenta su porción antes
    // de repartir, los pedidos terminan pagando ellos solos una compra que
    // no fue solo suya (reportado por el usuario 2026-09-21, ver Hallazgo
    // #45). Se reparte con el MISMO método, agregando el excedente como un
    // participante más (pesado por su propia cantidad) — la suma sigue
    // dando exacto el total pagado, cero descuadre.
    var pesosCosto = cantidadExcedenteTotal > 0 ? pesos.concat([cantidadExcedenteTotal]) : pesos;
    var costosConExcedente = repartirProporcional(costoTotal, pesosCosto, 0);
    var costos = costosConExcedente.slice(0, pesos.length);
    var costoExcedenteTotal = cantidadExcedenteTotal > 0 ? costosConExcedente[pesos.length] : 0;
    // La cantidad de cada pedido se puede escribir a mano en vez de confiar
    // solo en el reparto proporcional — reportado por el usuario
    // 2026-09-21: "no todos los insumos se pueden dividir así... más bien
    // un campo para definir que cantidad va en cada pedido, no lo hago
    // individual porque muchas veces las cosas se compran al por mayor,
    // entonces para evitar dividir pues que lo haga la app". Si no se
    // toca, sigue siendo 100% automático (el valor por defecto es el
    // proporcional de siempre) — esto es una posibilidad, no un paso
    // obligatorio nuevo.
    var overridesCantidad = d.cantidadesPorPedido || {};
    var cantidadesFinal = g.participantes.map(function (p, i) {
      var ov = overridesCantidad[p.cotId];
      return (ov !== undefined && ov !== "") ? num(ov) : cantidades[i];
    });
    var repartidoTotal = cantidadesFinal.reduce(function (a, v) { return a + v; }, 0);
    var toleranciaCantidad = g.esProducto ? 0.001 : 0.01;
    var cuadra = Math.abs(repartidoTotal - cantidadTotal) <= toleranciaCantidad;

    // Igual que en "Registrar gasto/nómina": el costo de esta compra
    // compartida también se puede cubrir, total o parcialmente, con plata ya
    // acumulada en un servicio — ver renderAsignarServicios y
    // "registrar-compra-conjunta" (donde se valida y se reparte entre los
    // pedidos participantes igual que cantidad/costo/excedente).
    html += '<hr class="stitch" />';
    html += renderAsignarServicios({ formKey: "formCompraConjunta.porClave." + g.clave, filas: d.servicios || [], monto: costoTotal });

    html += '<div class="cc-reparto">';
    html += '<div class="cot-col-title" style="margin-top:var(--sp-3);">Se reparte así' +
      renderHelp("La cantidad de cada pedido viene calculada a prorrata, pero se puede corregir a mano en cualquier fila — mientras la suma coincida con el total comprado, se guarda tal cual la dejes.") +
      "</div>";
    html += '<div class="tx-row head" style="grid-template-columns:1fr 90px 100px;">' +
      '<span>Pedido</span><span class="ins-th-num">Cantidad</span><span class="ins-th-num">Costo</span></div>';
    g.participantes.forEach(function (p, i) {
      var valorCantidad = overridesCantidad[p.cotId] !== undefined ? overridesCantidad[p.cotId] : cantidades[i].toFixed(decCant);
      html += '<div class="tx-row" style="grid-template-columns:1fr 90px 100px;">' +
        '<span class="mobile-th">Pedido</span><span>' + esc(p.etiqueta) + "</span>" +
        '<span class="mobile-th">Cantidad</span><span style="display:flex;align-items:center;gap:4px;justify-content:flex-end;"><input type="number" class="mini-input" style="text-align:right;width:100%;" ' + (g.esProducto ? 'step="1" ' : "") + 'value="' + esc(valorCantidad) + '" data-action-change="set-compra-conjunta-cantidad-pedido" data-clave="' + esc(g.clave) + '" data-cot="' + esc(p.cotId) + '" /><span class="section-sub" style="margin:0;white-space:nowrap;">' + esc(g.unidad || "") + "</span></span>" +
        '<span class="mobile-th">Costo</span><span class="amount">' + fmt(costos[i]) + "</span>" +
        "</div>";
    });
    html += '<div class="section-sub" style="margin-top:6px;text-align:right;">Repartido: <b style="color:' + (cuadra ? "var(--ink)" : "var(--danger-ink)") + ';">' + repartidoTotal.toFixed(decCant) + "</b> / " + cantidadTotal.toFixed(decCant) + " " + esc(g.unidad || "") + "</div>";
    // Antes esto era una columna más por fila ("Excedente"), lo que hacía
    // parecer que el excedente le pertenecía SOLO a la fila donde cayó el
    // residuo del reparto (el método del mayor residuo lo deja entero en un
    // único pedido, ver repartirProporcional) — confuso, porque en realidad
    // es una reserva de LOS 3, no de ese pedido puntual. Reportado por el
    // usuario 2026-09-21 ("no solo se está vinculando a 1 pedido, cierto?...
    // en vez de una columna, 1 fila tal vez"). Ahora es una sola línea
    // debajo de la tabla, fuera de cualquier fila de pedido.
    if (excedentes) {
      html += '<div class="section-sub" style="margin-top:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span class="tag">↺ Reserva compartida</span>' +
        "<span>" + cantidadExcedenteTotal.toFixed(decCant) + " " + esc(g.unidad || "") + " · " + fmt(costoExcedenteTotal) +
        " — disponible para cualquiera de estos " + g.participantes.length + " pedidos si más adelante necesitan más de lo estimado.</span>" +
        "</div>";
    }
    html += "</div>";
    html += '<div class="row-actions" style="margin-top:var(--sp-3);"><button class="btn" data-action="registrar-compra-conjunta" data-clave="' + esc(g.clave) + '">Registrar esta compra</button></div>';
  }
  html += "</div>";
  return html;
}

function renderSelectProveedorConjunta(g, d) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<label>Proveedor</label><span class="section-sub" style="margin:0;">Sin proveedores en Contactos.</span>';
  }
  var actual = d.proveedorId || "";
  return '<label>Proveedor (opcional)</label><select class="mini-input" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.clave) + '" data-campo="proveedorId">' +
    '<option value="">Sin especificar</option>' +
    proveedores.map(function (p) { return '<option value="' + p.id + '" ' + (actual === p.id ? "selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") +
    "</select>";
}

// El formulario de un movimiento, en TRES bloques con jerarquía propia en vez
// de una grilla plana de diez campos iguales. Antes todos pesaban lo mismo —el
// monto y "unidad (opcional)" se veían idénticos— y los cuatro campos de
// compra de insumo estaban siempre ahí aunque casi nunca aplicaran, que era la
// mitad del ruido.
//
//  1. QUÉ PASÓ: el tipo como control segmentado (se ven las tres opciones de
//     una, como el tipo de pedido) + concepto, monto y fecha. El monto es el
//     campo grande: es el dato del que se trata todo esto.
//  2. CON QUIÉN Y POR QUÉ: contraparte y a qué pedido/cotización se asocia.
//  3. COMPRA DE INSUMO: recogido detrás de una casilla. Solo al marcarla
//     aparecen insumo, proveedor, cantidad y unidad.
function renderFormMovimiento() {
  var f = state.formTx;
  var datalist = '<datalist id="dl-personas">' +
    (state.config.nomina || []).map(function (e) { return '<option value="' + esc(e.nombre) + '">'; }).join("") +
    "</datalist>";

  var html = datalist + '<div class="card tx-form">';

  // ---- 1. Qué pasó ----
  html += '<div class="section-title small" style="margin-top:0;">Registrar movimiento' +
    renderHelp("Un movimiento registrado acá es dinero que YA se movió. Lo que todavía no se ha pagado vive en Pendientes; lo que falta por cobrar, en el saldo del pedido.") +
    "</div>";

  html += '<div class="tx-form-tipo">' +
    TIPOS_NUEVO_TX.map(function (t) {
      return '<button class="segmented-opcion ' + (f.tipo === t[0] ? "active" : "") + '" data-action="set-tx-tipo" data-val="' + t[0] + '">' + t[1] + "</button>";
    }).join("") +
    "</div>";

  html += '<div class="tx-form-principal">' +
    '<div class="field tx-form-monto"><label>Monto</label>' +
    '<input type="number" inputmode="numeric" data-form="tx" data-field="monto" value="' + esc(f.monto) + '" placeholder="0" /></div>' +
    '<div class="field"><label>Concepto</label>' +
    '<input data-form="tx" data-field="concepto" value="' + esc(f.concepto) + '" placeholder="Ej. Tela para el pedido de San Jorge" /></div>' +
    '<div class="field"><label>Fecha</label><input type="date" data-form="tx" data-field="fecha" value="' + esc(f.fecha) + '" /></div>' +
    "</div>";

  // ---- 2. Con quién y a qué se asocia ----
  html += '<hr class="stitch" />';
  html += '<div class="cot-col-title" style="margin-top:0;">Con quién y a qué se asocia</div>';
  html += '<div class="form-grid">' +
    '<div class="field"><label>Persona / contraparte' +
    renderHelp("Quién está del otro lado del movimiento — no siempre es un cliente: puede ser un vendedor (comisión), un proveedor, un empleado (nómina) o quien sea que recibió/entregó ese dinero.") +
    '</label><input list="dl-personas" data-form="tx" data-field="contraparte" value="' + esc(f.contraparte) + '" placeholder="Opcional" /></div>' +
    '<div class="field"><label>Pedido relacionado' +
    renderHelp("Vincula este movimiento a un pedido para agruparlo y encontrarlo luego buscando por N.º de OP, cédula, cliente o fecha.") +
    '</label><select data-form="tx" data-field="pedidoId">' +
    '<option value="">Sin pedido (movimiento suelto)</option>' +
    state.pedidos.map(function (p) { return '<option value="' + p.id + '" ' + (f.pedidoId === p.id ? "selected" : "") + ">" + esc(p.numeroOp || "OP-????") + " · " + esc(p.cliente) + "</option>"; }).join("") +
    "</select></div>" +
    '<div class="field"><label>Cotización relacionada</label><select data-form="tx" data-field="cotizacionId">' +
    '<option value="">Sin cotización</option>' +
    state.cotizaciones.map(function (c) { return '<option value="' + c.id + '" ' + (f.cotizacionId === c.id ? "selected" : "") + ">" + esc(c.descripcion) + " — " + esc(c.cliente) + "</option>"; }).join("") +
    "</select></div>" +
    "</div>";

  // ---- 3. Compra de insumo (recogido) ----
  html += '<hr class="stitch" />';
  html += '<label class="toggle-card">' +
    '<input type="checkbox" ' + (f.esInsumo ? "checked" : "") + ' data-action-change="toggle-tx-insumo" /> ' +
    "<span><b>📦 Es una compra de insumo</b>" +
    '<small>Márcalo si este gasto es material real (tela, hilo, botones). Así cuenta aparte en "Gasto en insumos" del reporte.</small></span>' +
    "</label>";
  if (f.esInsumo) {
    html += '<div class="form-grid" style="margin-top:var(--sp-3);">' +
      '<div class="field"><label>Insumo</label><select data-form="tx" data-field="insumoNombre">' +
      '<option value="">Sin especificar</option>' +
      (state.catalogoInsumos || []).map(function (i) { return '<option value="' + esc(i.nombre) + '" ' + (f.insumoNombre === i.nombre ? "selected" : "") + ">" + esc(i.nombre) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field"><label>Proveedor</label><select data-form="tx" data-field="proveedorId">' +
      '<option value="">Sin especificar</option>' +
      proveedoresDeContactos().map(function (p) { return '<option value="' + p.id + '" ' + (f.proveedorId === p.id ? "selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field"><label>Cantidad comprada</label><input type="number" data-form="tx" data-field="cantidad" value="' + esc(f.cantidad) + '" placeholder="Ej. 12" /></div>' +
      '<div class="field"><label>Unidad</label><span class="insumo-unidad-cell"><input class="insumo-unidad" id="tx-unidad" data-form="tx" data-field="unidad" value="' + esc(f.unidad) + '" placeholder="MT, UND…" />' +
      renderComboUnidad({ id: "tx-unidad" }) + "</span></div>" +
      "</div>";
  }

  // ---- 4. Asignar a servicio(s) (solo tiene sentido para plata que SALE) ----
  if (f.tipo === "gasto" || f.tipo === "nomina") {
    html += '<hr class="stitch" />';
    html += renderAsignarServicios({ formKey: "formTx", filas: f.servicios || [], monto: num(f.monto) });
  }

  html += '<div class="pedido-actions" style="margin-top:var(--sp-4);">' +
    '<button class="btn" data-action="add-tx">Registrar ' + (TIPO_SUSTANTIVO[f.tipo] || "movimiento") + "</button></div>";
  html += "</div>";
  return html;
}

function renderHistorial() {
  var html = '<div style="margin-bottom:10px;">' + renderBuscador({
    id: "inp-buscar-tx",
    filtro: "buscarTx",
    valor: state.buscarTx,
    ancho: 360,
    placeholder: "Buscar por N.º OP, cédula, cliente, producción o fecha…"
  }) + "</div>";

  html += '<div class="filters">';
  [["todos", "Todos"], ["ingreso", "Ingresos"], ["gasto", "Gastos"], ["nomina", "Nómina"], ["comision", "Comisiones"]].forEach(function (c) {
    html += '<button class="chip ' + (state.filtroTx === c[0] ? "active" : "") + '" data-action="filtro-tx" data-val="' + c[0] + '">' + c[1] + "</button>";
  });
  // Atajo para encontrar los movimientos que quedaron sueltos porque se borró
  // el pedido o la cotización que los generó. Solo aparece si hay alguno: no
  // tiene sentido ofrecer un filtro que siempre daría vacío.
  var sueltos = state.tx.filter(function (t) { return !!origenSistemaHuerfano(t); }).length;
  if (sueltos) {
    html += '<button class="chip ' + (state.filtroTx === "huerfanos" ? "active" : "") + '" data-action="filtro-tx" data-val="huerfanos" ' +
      'title="Movimientos que generó un pedido o una cotización que ya se eliminó. Quedaron sueltos: revísalos y borra los que no correspondan.">' +
      "⚠ Sueltos (" + sueltos + ")</button>";
  }
  html += '<select class="mini-input" style="width:auto;" data-action-change="set-tx-periodo">' +
    Object.keys(PERIODOS_TX).map(function (k) { return '<option value="' + k + '" ' + (state.filtroTxPeriodo === k ? "selected" : "") + '>' + PERIODOS_TX[k] + "</option>"; }).join("") +
    "</select>" +
    renderHelp("Filtra los movimientos que caen dentro del periodo actual (según el periodo de pago configurado), igual que el cálculo de nómina pendiente.") +
    '<button class="btn ghost small" style="margin-left:auto;" data-action="ver-papelera">🗑 Papelera' + (state.txPapelera.length ? " (" + state.txPapelera.length + ")" : "") + "</button>" +
    "</div>";

  var filtered = filtrarTx();

  var conPedido = {}, sinPedido = [];
  filtered.forEach(function (t) {
    if (t.pedidoId) { (conPedido[t.pedidoId] = conPedido[t.pedidoId] || []).push(t); }
    else sinPedido.push(t);
  });

  if (filtered.length === 0) {
    html += '<div class="card"><div class="empty">Aún no hay movimientos <b>que coincidan con estos filtros</b>.</div></div>';
    return html;
  }

  // Los grupos se ordenan por su movimiento MÁS RECIENTE (no por el primero
  // de la lista): un pedido viejo al que hoy se le registró un abono sube al
  // tope, que es donde uno lo busca. Antes se miraba txs[0], que solo era el
  // más reciente por casualidad —porque state.tx guarda lo último agregado
  // primero— y dejaba de serlo apenas alguien registraba un movimiento con
  // fecha atrasada.
  var gruposOrdenados = Object.keys(conPedido).map(function (pid) {
    var pedido = state.pedidos.filter(function (p) { return p.id === pid; })[0];
    var txs = conPedido[pid].slice().sort(compararTxRecienteFirst);
    return { pedido: pedido, pid: pid, txs: txs, fechaTope: txs[0] ? txs[0].fecha : "" };
  }).sort(function (a, b) {
    return String(b.fechaTope).localeCompare(String(a.fechaTope));
  });
  sinPedido.sort(compararTxRecienteFirst);

  // Cada grupo agrupa TODOS los movimientos de un mismo pedido (abonos,
  // sobrecostos, comisiones, estimados...) en un solo panel, con el total
  // neto de ese pedido a la vista.
  gruposOrdenados.forEach(function (g) {
    var cliente = g.pedido && g.pedido.clienteId ? clienteById(g.pedido.clienteId) : null;
    var neto = g.txs.reduce(function (a, t) { return t.tipo === "ingreso" ? a + num(t.monto) : a - num(t.monto); }, 0);
    html += '<div class="card" style="margin-bottom:14px;">';
    html += '<div class="cot-col-title" style="margin-top:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<span class="badge" style="font-family:\'IBM Plex Mono\',monospace;">' + esc(g.pedido ? g.pedido.numeroOp : "OP-????") + '</span>' +
      '<span>' + esc(g.pedido ? g.pedido.cliente : "Pedido eliminado") + (g.pedido ? " — " + esc(g.pedido.descripcion) : "") + "</span>" +
      (cliente && cliente.cedula ? '<span class="tag" style="background:var(--surface-3);">CC/NIT ' + esc(cliente.cedula) + "</span>" : "") +
      '<span class="amount ' + (neto >= 0 ? "pos" : "neg") + '" style="margin-left:auto;">Neto: ' + (neto >= 0 ? "+" : "-") + fmt(Math.abs(neto)) + "</span>" +
      "</div>";
    html += renderTablaTx(g.txs);
    html += "</div>";
  });

  if (sinPedido.length > 0) {
    html += '<div class="card"><div class="cot-col-title" style="margin-top:0;">Movimientos sueltos (sin pedido)</div>' + renderTablaTx(sinPedido) + "</div>";
  }

  return html;
}

// Orden por defecto de CUALQUIER lista de movimientos: del más reciente al
// más viejo por fecha. El desempate usa la posición en state.tx (que guarda
// lo último registrado primero), así dos movimientos del mismo día quedan con
// el recién cargado arriba en vez de en un orden arbitrario que cambia entre
// renders.
function compararTxRecienteFirst(a, b) {
  var porFecha = String(b.fecha || "").localeCompare(String(a.fecha || ""));
  if (porFecha !== 0) return porFecha;
  return state.tx.indexOf(a) - state.tx.indexOf(b);
}

function filtrarTx() {
  var list = state.filtroTx === "todos" ? state.tx
    : state.filtroTx === "huerfanos" ? state.tx.filter(function (t) { return !!origenSistemaHuerfano(t); })
      : state.tx.filter(function (t) { return t.tipo === state.filtroTx; });

  var periodo = state.filtroTxPeriodo || "todos";
  if (periodo !== "todos") {
    var miPeriodo = periodoKey(todayStr(), periodo);
    list = list.filter(function (t) { return periodoKey(t.fecha, periodo) === miPeriodo; });
  }

  var q = norm(state.buscarTx || "").trim();
  if (q) {
    list = list.filter(function (t) {
      var pedido = t.pedidoId ? state.pedidos.filter(function (p) { return p.id === t.pedidoId; })[0] : null;
      var cliente = pedido && pedido.clienteId ? clienteById(pedido.clienteId) : null;
      var cedula = cliente ? cliente.cedula : "";
      var haystack = [t.concepto, t.contraparte, t.fecha, pedido ? pedido.numeroOp : "", pedido ? pedido.cliente : "", pedido ? pedido.descripcion : "", cedula]
        .map(norm).join(" | ");
      return haystack.indexOf(q) >= 0;
    });
  }
  return list;
}

function renderTablaTx(lista) {
  var html = '<div class="tx-row head"><span>Fecha</span><span>Concepto</span><span>Persona</span><span>Tipo</span><span>Monto</span><span></span></div>';
  lista.forEach(function (t) {
    html += t.id === state.txEditando ? renderFilaEdicion(t) : renderFila(t);
  });
  return html;
}

function renderFila(t) {
  var origen = origenDeTx(t);
  // Movimiento generado por la app: el botón de borrar queda igual de visible
  // (nada se esconde) pero se anuncia desde el título que hay que deshacerlo
  // en su origen — al pulsarlo se explica dónde (ver "remove-tx").
  var sistema = origenSistemaDeTx(t);
  // Generado por la app pero su origen ya no existe (se borró el pedido o la
  // cotización). Se puede borrar —no hay nada con qué descuadrar— y se avisa
  // por qué quedó suelto, para que no parezca basura inexplicable.
  var huerfano = sistema ? null : origenSistemaHuerfano(t);
  var tituloBorrar = sistema
    ? "Este movimiento lo generó la app (" + sistema.que + ") — se deshace en su origen, no acá"
    : (huerfano
      ? "El registro que lo generó (" + huerfano.que + ") ya no existe: este movimiento quedó suelto y sí se puede borrar"
      : "Se mueve a la papelera, no se borra para siempre");
  return '<div class="tx-row">' +
    "<span class=\"mobile-th\">Fecha</span><span style=\"font-family:'IBM Plex Mono',monospace;font-size:12px;\">" + esc(t.fecha) + "</span>" +
    '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) +
    (huerfano ? ' <span class="tag" style="background:var(--warning-soft);color:var(--warning-ink);" title="Se generó desde ' + esc(huerfano.que) + ', pero ese registro ya se eliminó. Este movimiento quedó suelto: revísalo y bórralo si no corresponde. (' + esc(huerfano.campo) + ": " + esc(huerfano.valor) + ')">origen eliminado</span>' : "") +
    ((t.serviciosDescuento || []).length
      ? ' <span class="tag" title="Descontado de: ' + (t.serviciosDescuento || []).map(function (d) { return esc(d.nombre) + " " + fmt(d.monto); }).join(", ") + '">📋 ' + (t.serviciosDescuento.length === 1 ? esc(t.serviciosDescuento[0].nombre) : t.serviciosDescuento.length + " servicios") + "</span>"
      : "") +
    "</span>" +
    '<span class="mobile-th">Persona</span><span style="color:var(--ink-soft);">' + esc(t.contraparte || "—") + "</span>" +
    '<span class="mobile-th">Tipo</span><span><span class="tag ' + t.tipo + '">' + t.tipo + "</span></span>" +
    '<span class="mobile-th">Monto</span><span class="amount ' + (t.tipo === "ingreso" ? "pos" : "neg") + '">' + (t.tipo === "ingreso" ? "+" : "-") + fmt(t.monto) + "</span>" +
    '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    // El origen "servicio" (ver origenDeTx) no tiene ningún lugar propio al
    // que navegar — ya se ve con el tag 📋 de arriba — así que no ofrece el
    // botón "↗ Origen", solo bloquea la edición de tipo/monto.
    (origen && origen.tipo !== "servicio" ? '<button class="btn ghost small" data-action="ver-origen-tx" data-id="' + t.id + '" title="Ir a ' + esc(origen.label) + '">↗ Origen</button>' : "") +
    '<button class="btn ghost small" data-action="editar-tx" data-id="' + t.id + '">Editar</button>' +
    '<button class="btn ' + (sistema ? "ghost" : "danger") + ' small" data-action="remove-tx" data-id="' + t.id + '" title="' + esc(tituloBorrar) + '">' + (sistema ? "🔒" : "🗑") + "</button>" +
    "</span>" +
    "</div>";
}

// Fila en modo edición: reemplaza cada celda por un input/select editable.
// Se guarda con "guardar-tx-edit" (lee estos mismos campos por data-role) o
// se cancela con "cancelar-edicion-tx", sin perder los demás movimientos.
//
// Si el movimiento tiene un origen real (abono, comisión, pago de gasto
// fijo/deuda...), el tipo y el monto quedan de solo lectura: cambiarlos a
// mano desincroniza la plata del taller de lo que ese registro dice que
// pasó de verdad (ej. "cambiar una comisión a ingreso" invertiría su signo
// en la caja sin que el pedido se entere). Solo fecha/concepto/persona
// siguen editables ahí — para un movimiento cargado a mano (sin origen)
// todo sigue editable como siempre.
function renderFilaEdicion(t) {
  var origen = origenDeTx(t);
  var tipoCell = '<span class="mobile-th">Tipo</span>' + (origen
    ? '<span><span class="tag ' + t.tipo + '" title="No editable: vinculado a ' + esc(origen.label) + '">' + TIPOS_TX[t.tipo] + "</span></span>"
    : '<span><select class="mini-input" style="width:100%" data-role="edit-tipo">' +
      Object.keys(TIPOS_TX).map(function (k) { return opt(k, TIPOS_TX[k], t.tipo); }).join("") +
      "</select></span>");
  var montoCell = '<span class="mobile-th">Monto</span>' + (origen
    ? '<span class="amount" title="No editable: vinculado a ' + esc(origen.label) + '">' + fmt(t.monto) + "</span>"
    : '<span><input type="number" class="mini-input" style="width:100%" data-role="edit-monto" value="' + esc(t.monto) + '" /></span>');
  return '<div class="tx-row" style="background:var(--surface-2);" data-tx-edit-row="' + t.id + '">' +
    '<span class="mobile-th">Fecha</span><span><input type="date" class="mini-input" style="width:100%" data-role="edit-fecha" value="' + esc(t.fecha) + '" /></span>' +
    '<span class="mobile-th">Concepto</span><span><input class="mini-input" style="width:100%" data-role="edit-concepto" value="' + esc(t.concepto) + '" /></span>' +
    '<span class="mobile-th">Persona</span><span><input class="mini-input" style="width:100%" data-role="edit-contraparte" value="' + esc(t.contraparte || "") + '" /></span>' +
    tipoCell + montoCell +
    '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    '<button class="btn small" data-action="guardar-tx-edit" data-id="' + t.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-tx">Cancelar</button>' +
    "</span>" +
    "</div>";
}

function renderPapelera() {
  var html = '<div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
    '<div class="section-title small" style="margin:0;">Papelera de movimientos' + renderHelp("Los movimientos eliminados quedan aquí (no se borran para siempre) para poder restaurarlos si fue un error.") + "</div>" +
    '<button class="btn ghost small" data-action="ver-papelera">← Volver a movimientos</button>' +
    "</div>";

  if (!state.txPapelera.length) {
    html += '<div class="card"><div class="empty">La papelera está vacía.</div></div>';
    return html;
  }

  html += '<div class="card">';
  html += '<div class="tx-row head"><span>Fecha</span><span>Concepto</span><span>Persona</span><span>Tipo</span><span>Monto</span><span></span></div>';
  // Mismo orden que el historial (más reciente arriba); acá el desempate es
  // por fecha de eliminación, que es lo último que pasó con ese movimiento.
  state.txPapelera.slice().sort(function (a, b) {
    var porFecha = String(b.fecha || "").localeCompare(String(a.fecha || ""));
    return porFecha !== 0 ? porFecha : String(b.eliminadoEl || "").localeCompare(String(a.eliminadoEl || ""));
  }).forEach(function (t) {
    html += '<div class="tx-row">' +
      "<span class=\"mobile-th\">Fecha</span><span style=\"font-family:'IBM Plex Mono',monospace;font-size:12px;\">" + esc(t.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) + "</span>" +
      '<span class="mobile-th">Persona</span><span style="color:var(--ink-soft);">' + esc(t.contraparte || "—") + "</span>" +
      '<span class="mobile-th">Tipo</span><span><span class="tag ' + t.tipo + '">' + t.tipo + "</span></span>" +
      '<span class="mobile-th">Monto</span><span class="amount ' + (t.tipo === "ingreso" ? "pos" : "neg") + '">' + (t.tipo === "ingreso" ? "+" : "-") + fmt(t.monto) + "</span>" +
      '<span style="display:flex;align-items:center;gap:6px;">' +
      '<button class="btn ghost small" data-action="restaurar-tx" data-id="' + t.id + '">Restaurar</button>' +
      '<button class="btn danger small" data-action="eliminar-tx-definitivo" data-id="' + t.id + '">Eliminar definitivo</button>' +
      "</span>" +
      "</div>";
  });
  html += "</div>";
  return html;
}

export var actions = {
  "filtro-tx": function (el) {
    state.filtroTx = el.getAttribute("data-val");
    notify();
  },
  "set-tx-periodo": function (el) {
    state.filtroTxPeriodo = el.value;
    notify();
  },
  "ver-papelera": function () {
    state.filtroTxVista = state.filtroTxVista === "papelera" ? "activos" : "papelera";
    notify();
  },
  "finanzas-vista": function (el) {
    state.finanzasVista = el.getAttribute("data-val");
    notify();
  },
  // El tipo redibuja el formulario (cambia el texto del botón y el sentido de
  // lo que se está registrando), por eso es una acción y no un data-form.
  "set-tx-tipo": function (el) {
    state.formTx.tipo = el.getAttribute("data-val");
    notify();
  },
  "toggle-tx-insumo": function (el) {
    state.formTx.esInsumo = !!el.checked;
    notify();
  },
  "add-tx": function () {
    var f = state.formTx;
    if (!exigirCampos([["Concepto", f.concepto], ["Monto", f.monto]])) return;
    // Solo gasto/nómina asignan servicios — el resto de tipos ni muestra el
    // bloque, así que ni vale la pena revisarlo (ver validarServiciosAsignados
    // en core/calc.js: ningún servicio puede quedar negativo, el sobrante sin
    // cubrir sale de Ganancia sin necesitar su propio registro acá).
    var serviciosDescuento = [];
    if (f.tipo === "gasto" || f.tipo === "nomina") {
      var validacion = validarServiciosAsignados(f.servicios, num(f.monto));
      if (!validacion.ok) { window.alert(validacion.error); return; }
      serviciosDescuento = validacion.limpias;
    }
    // Todo sale del borrador (state.formTx), no de leer el DOM: es lo que
    // permite que los campos de insumo existan solo cuando la casilla está
    // marcada sin que el guardado dependa de que estén en pantalla.
    state.tx.unshift({
      id: uid(), tipo: f.tipo, concepto: f.concepto, monto: num(f.monto), contraparte: f.contraparte, fecha: f.fecha,
      pedidoId: f.pedidoId || "", cotizacionId: f.cotizacionId || "",
      esInsumo: f.esInsumo ? "1" : "",
      insumoNombre: f.esInsumo ? (f.insumoNombre || "") : "",
      proveedorId: f.esInsumo ? (f.proveedorId || "") : "",
      cantidad: f.esInsumo ? (f.cantidad || "") : "",
      unidad: f.esInsumo ? (f.unidad || "") : "",
      serviciosDescuento: serviciosDescuento
    });
    state.formTx = { tipo: f.tipo, concepto: "", monto: "", contraparte: "", fecha: todayStr(), pedidoId: "", cotizacionId: "", esInsumo: false, insumoNombre: "", proveedorId: "", cantidad: "", unidad: "", servicios: [] };
    state.finanzasVista = "historial"; // aterriza viendo el movimiento recién creado, no el formulario en blanco
    persist("tx"); notify();
  },
  "editar-tx": function (el) {
    state.txEditando = el.getAttribute("data-id");
    notify();
  },
  "cancelar-edicion-tx": function () {
    state.txEditando = "";
    notify();
  },
  "guardar-tx-edit": function (el) {
    var id = el.getAttribute("data-id");
    var fila = el.closest('[data-tx-edit-row]');
    if (!fila) return;
    var original = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!original) return;
    // null (no "") cuando el campo no existe en el DOM — pasa con tipo/monto
    // en movimientos con origen, que quedan de solo lectura (ver
    // renderFilaEdicion). Sin este null, num("") = 0 tumbaba el guardado
    // completo (incluida la fecha/concepto, que sí eran editables) apenas
    // se ocultaba el input de monto.
    var g = function (role) { var i = fila.querySelector('[data-role="' + role + '"]'); return i ? i.value : null; };
    var concepto = g("edit-concepto");
    if (concepto === null) concepto = original.concepto;
    if (!concepto) return;
    var montoRaw = g("edit-monto");
    var monto = montoRaw === null ? num(original.monto) : num(montoRaw);
    if (monto <= 0) return;
    var contraparteRaw = g("edit-contraparte");
    state.tx = state.tx.map(function (t) {
      if (t.id !== id) return t;
      return Object.assign({}, t, {
        fecha: g("edit-fecha") || t.fecha,
        concepto: concepto,
        contraparte: contraparteRaw === null ? t.contraparte : contraparteRaw,
        tipo: g("edit-tipo") || t.tipo,
        monto: monto
      });
    });
    state.txEditando = "";
    persist("tx"); notify();
  },
  // Lleva a la pestaña del registro real detrás de un movimiento (pedido,
  // cotización, gasto fijo o deuda) y, si tiene un anchor identificable en
  // el DOM, hace scroll hasta ahí — mismo patrón que
  // "ver-cotizacion-relacionada" en pedidos.js.
  "ver-origen-tx": function (el) {
    var id = el.getAttribute("data-id");
    var t = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!t) return;
    var origen = origenDeTx(t);
    if (!origen) return;
    var TAB_POR_ORIGEN = { pedido: "pedidos", cotizacion: "cotizaciones", gastoFijo: "pendientes", deuda: "pendientes" };
    var ATTR_POR_ORIGEN = { pedido: "data-pedido-id", gastoFijo: "data-gasto-fijo-id", deuda: "data-deuda-id" };
    state.tab = TAB_POR_ORIGEN[origen.tipo] || state.tab;
    state.sidebarMobileOpen = false;
    // Si el pedido de origen está en la vista normal pero la papelera de
    // Pedidos había quedado activa, sin esto quedaría "escondido" detrás de
    // esa vista al llegar — mismo reset que ya hace la acción "tab" genérica.
    state.filtroPedidosVista = "activos";
    // BUG: sin esto, un pedido de origen aterrizaba en la pestaña "+ Nuevo
    // pedido" (formulario en blanco) en vez de "Historial", que es donde
    // vive la tarjeta real — el botón "parecía" no llevar a ningún lado.
    // pedidosVista por defecto es "nueva" (ver DEFAULT en store.js), así que
    // hay que forzarlo a "historial" para que la tarjeta exista en el DOM.
    if (origen.tipo === "pedido") state.pedidosVista = "historial";
    // Cotizaciones no tiene un anchor para hacer scroll (Historial ya no
    // muestra más que tarjetas chicas) — en su lugar, abre el detalle
    // completo directo, igual que "Ver cotización relacionada" en Pedidos.
    if (origen.tipo === "cotizacion") {
      state.cotizacionEditando = origen.id;
      state.cotizacionesVista = "nueva";
    }
    notify();
    var attr = ATTR_POR_ORIGEN[origen.tipo];
    if (attr) {
      setTimeout(function () {
        var card = document.querySelector('[' + attr + '="' + origen.id + '"]');
        if (!card) return;
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        // Destello (2 titileos) para identificar la tarjeta entre varias —
        // ver @keyframes destello-pedido en css/pedidos.css.
        card.classList.add("destello");
      }, 60);
    }
  },
  // "Eliminar" ya no borra para siempre: mueve el movimiento a la papelera,
  // de donde se puede restaurar si fue un error.
  //
  // Los movimientos que GENERÓ la app (un abono, una comisión, una cuota de
  // deuda, un gasto fijo, una venta de consignación, una compra) no se pueden
  // borrar desde acá: son el reflejo de un hecho que vive en otra pantalla, y
  // borrar solo este lado dejaba al pedido diciendo que ya cobró mientras la
  // plata desaparecía de la caja. Por el mismo motivo su tipo y monto ya eran
  // de solo lectura al editar (ver renderFilaEdicion) — esto cierra el mismo
  // hueco por el lado del borrado, y dice exactamente dónde revertirlo bien.
  "remove-tx": function (el) {
    var id = el.getAttribute("data-id");
    var item = state.tx.filter(function (t) { return t.id === id; })[0];
    if (!item) return;
    var sistema = origenSistemaDeTx(item);
    if (sistema) {
      window.alert("Este movimiento no se borra desde Finanzas: es " + sistema.que + ", y ese registro todavía existe.\n\n" +
        "Si lo borraras solo acá, la plata saldría de la caja pero el registro de origen seguiría diciendo que se pagó (o se cobró) — y las dos pantallas quedarían diciendo cosas distintas.\n\n" +
        "Para deshacerlo de verdad:\n" + sistema.donde + "\n\n" +
        "Al hacerlo, este movimiento se retira solo.");
      return;
    }
    state.tx = state.tx.filter(function (t) { return t.id !== id; });
    state.txPapelera.unshift(Object.assign({}, item, { eliminadoEl: todayStr() }));
    persist("tx"); persist("txPapelera"); notify();
  },
  "restaurar-tx": function (el) {
    var id = el.getAttribute("data-id");
    var item = state.txPapelera.filter(function (t) { return t.id === id; })[0];
    if (!item) return;
    // Una fila de un Recibo de compra anulado no se puede traer de vuelta
    // suelta: el recibo ya no la respalda, y volver a ponerla en la caja
    // sin sus compras contaría esa plata de nuevo (o a medias).
    if (item.reciboCompraId || item.eliminadoConRecibo) {
      window.alert("Este movimiento era parte de un recibo de compra anulado. Para volver a tenerlo, registra el recibo de nuevo.");
      return;
    }
    state.txPapelera = state.txPapelera.filter(function (t) { return t.id !== id; });
    var restaurado = Object.assign({}, item);
    delete restaurado.eliminadoEl;
    // Estas marcas solo sirven para devolverlo junto al pedido/cotización que
    // se lo llevó; restaurado a mano, ya no aplican.
    delete restaurado.eliminadoConPedido;
    delete restaurado.eliminadoConCotizacion;
    state.tx.unshift(restaurado);
    persist("tx"); persist("txPapelera"); notify();
  },
  "eliminar-tx-definitivo": function (el) {
    var id = el.getAttribute("data-id");
    if (!window.confirm("Esto elimina el movimiento para siempre y no se puede deshacer. ¿Continuar?")) return;
    state.txPapelera = state.txPapelera.filter(function (t) { return t.id !== id; });
    persist("txPapelera"); notify();
  },
  "toggle-compra-conjunta-pedido": function (el) {
    var id = el.getAttribute("data-id");
    var sel = (state.formCompraConjunta.seleccion || []).slice();
    var idx = sel.indexOf(id);
    if (idx === -1) sel.push(id); else sel.splice(idx, 1);
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { seleccion: sel });
    notify();
  },
  "set-compra-conjunta-campo": function (el) {
    var clave = el.getAttribute("data-clave"), campo = el.getAttribute("data-campo");
    var porClave = Object.assign({}, state.formCompraConjunta.porClave || {});
    var fila = Object.assign({}, porClave[clave] || {});
    fila[campo] = el.value;
    porClave[clave] = fila;
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { porClave: porClave });
    notify();
  },
  // Cantidad de UN pedido participante escrita a mano, en vez de dejar que
  // el reparto proporcional decida sola — ver renderFilaGrupoCompraConjunta.
  // No toca "registrar-compra-conjunta" cuando queda vacía: sin nada
  // escrito, ese pedido sigue usando el valor proporcional de siempre.
  "set-compra-conjunta-cantidad-pedido": function (el) {
    var clave = el.getAttribute("data-clave"), cotId = el.getAttribute("data-cot");
    var porClave = Object.assign({}, state.formCompraConjunta.porClave || {});
    var fila = Object.assign({}, porClave[clave] || {});
    var cantidadesPorPedido = Object.assign({}, fila.cantidadesPorPedido || {});
    cantidadesPorPedido[cotId] = el.value;
    fila.cantidadesPorPedido = cantidadesPorPedido;
    porClave[clave] = fila;
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { porClave: porClave });
    notify();
  },
  // Lo mismo que "set-compra-conjunta-cantidad-pedido" pero para un costo
  // compartido (domicilio, diseño) — acá se corrige el MONTO de cada
  // pedido, no una cantidad (un costo fijo no tiene unidad que repartir).
  "set-costo-compartido-monto": function (el) {
    var clave = el.getAttribute("data-clave"), cotId = el.getAttribute("data-cot");
    var porClave = Object.assign({}, state.formCompraConjunta.porClave || {});
    var fila = Object.assign({}, porClave[clave] || {});
    var costosPorPedido = Object.assign({}, fila.costosPorPedido || {});
    costosPorPedido[cotId] = el.value;
    fila.costosPorPedido = costosPorPedido;
    porClave[clave] = fila;
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { porClave: porClave });
    notify();
  },
  // El corazón de "Compras conjuntas": reparte lo comprado de verdad entre
  // los pedidos que compartían ese insumo (a prorrata de lo que cada uno
  // necesitaba, ver repartirProporcional en core/calc.js), deja cada compra
  // marcada "Sí" con su cantidad/costo real, y usa la MISMA sincronización
  // que "Actualizar movimientos financieros" (ver sincronizarComprasFinanzasDe
  // en modules/cotizaciones.js) para que cada pedido quede con su propio
  // movimiento en Finanzas — nunca uno solo repartido a mano entre todos.
  "registrar-compra-conjunta": function (el) {
    var clave = el.getAttribute("data-clave");
    var sel = state.formCompraConjunta.seleccion || [];
    var grupo = calcGruposCompraCompartida(sel).filter(function (g) { return g.clave === clave; })[0];
    if (!grupo) return;
    var draft = (state.formCompraConjunta.porClave || {})[clave] || {};
    var cantidadTotal = num(draft.cantidadTotal), costoTotal = num(draft.costoTotal);
    if (cantidadTotal <= 0 || costoTotal <= 0) {
      window.alert("Escribe cuánto se compró en total y cuánto costó antes de registrar.");
      return;
    }
    // Igual que "Registrar gasto/nómina": cada servicio asignado se topa a lo
    // disponible y a que la suma no pase del costo total de esta compra — ver
    // validarServiciosAsignados en core/calc.js. Lo que no se cubra acá sale
    // de Ganancia como siempre, sin bloquear nada.
    var validacionServicios = validarServiciosAsignados(draft.servicios, costoTotal);
    if (!validacionServicios.ok) { window.alert(validacionServicios.error); return; }
    var serviciosLimpios = validacionServicios.limpias;

    var pesos = grupo.participantes.map(function (p) { return p.cantidadEstimada; });
    // Una prenda comprada entera (`esProducto`) no se puede repartir en
    // fracciones — "1.34 camisetas" no existe — así que se reparte en
    // enteros (mismo repartirProporcional, solo sin decimales). El resto de
    // insumos (cantidades continuas: metros, kilos...) sigue con 2
    // decimales, como siempre. Ver el mismo criterio en
    // renderFilaGrupoCompraConjunta (el preview tiene que coincidir con lo
    // que esto termina guardando).
    var decCant = grupo.esProducto ? 0 : 2;
    var cantidades = repartirProporcional(cantidadTotal, pesos, decCant);
    // La cantidad de cada pedido admite corrección manual (ver
    // renderFilaGrupoCompraConjunta / "set-compra-conjunta-cantidad-pedido")
    // — sin nada escrito, usa la proporcional de siempre. Mismo criterio de
    // "cero descuadre" que ya exige validarServiciosAsignados: si lo escrito
    // a mano no suma exacto el total comprado, se bloquea el registro
    // ANTES de tocar nada (nunca se guarda una cantidad que no cuadre).
    var overridesCantidad = draft.cantidadesPorPedido || {};
    var cantidadesFinal = grupo.participantes.map(function (p, i) {
      var ov = overridesCantidad[p.cotId];
      return (ov !== undefined && ov !== "") ? num(ov) : cantidades[i];
    });
    var sumaCantidadesFinal = cantidadesFinal.reduce(function (a, v) { return a + v; }, 0);
    var toleranciaCantidad = grupo.esProducto ? 0.001 : 0.01;
    if (Math.abs(sumaCantidadesFinal - cantidadTotal) > toleranciaCantidad) {
      window.alert("Lo repartido entre los pedidos (" + sumaCantidadesFinal.toFixed(decCant) + ") no coincide con el total comprado (" + cantidadTotal.toFixed(decCant) + "). Ajusta las cantidades para que sumen exacto.");
      return;
    }
    // Excedente (compra de insumo aparte): se reparte con el MISMO criterio
    // que el resto — a prorrata de lo que cada pedido necesitaba — pero cada
    // parte queda marcada aparte (cantidadExcedente) para que no cuente
    // como costo/sobrecosto de ese pedido. Mismo mecanismo exacto que una
    // compra individual (ver sincronizarComprasFinanzasDe), nada especial
    // por tratarse de varios pedidos a la vez.
    var cantidadExcedenteTotal = num(draft.cantidadExcedente);
    var excedentes = cantidadExcedenteTotal > 0 ? repartirProporcional(cantidadExcedenteTotal, pesos, decCant) : null;
    // El costo total pagado cubre TANTO lo que necesitaban los pedidos COMO
    // el excedente que se llevó de más — si no se descuenta su porción antes
    // de repartir, los pedidos terminan pagando ellos solos una compra que
    // no fue solo suya (reportado por el usuario 2026-09-21, ver Hallazgo
    // #45). Se reparte con el MISMO método, agregando el excedente como un
    // participante más (pesado por su propia cantidad) — la suma sigue
    // dando exacto el total pagado, cero descuadre. El preview
    // (renderFilaGrupoCompraConjunta) tiene que coincidir con esto.
    var pesosCosto = cantidadExcedenteTotal > 0 ? pesos.concat([cantidadExcedenteTotal]) : pesos;
    var costosConExcedente = repartirProporcional(costoTotal, pesosCosto, 0);
    var costos = costosConExcedente.slice(0, pesos.length);
    var costoExcedenteTotal = cantidadExcedenteTotal > 0 ? costosConExcedente[pesos.length] : 0;
    // La porción de ese costo de excedente que le toca a CADA tenedor (puede
    // caer entera en uno solo, por el método del mayor residuo) se reparte a
    // prorrata de cuánta cantidad de excedente le tocó — así costoReal/
    // cantidadReal de esa compra sigue siendo un precio unitario uniforme,
    // sin importar cómo haya caído el reparto de cantidad.
    var costosExcedente = excedentes ? repartirProporcional(costoExcedenteTotal, excedentes, 0) : null;
    // Cada servicio asignado se reparte con el MISMO criterio que cantidad/
    // costo/excedente — a prorrata — para que la suma de lo descontado en
    // los movimientos de cada pedido participante siga cuadrando exacto
    // contra lo que se asignó acá arriba (repartirProporcional ya garantiza
    // cero descuadre por redondeo, ver core/calc.js).
    var repartosServicios = serviciosLimpios.map(function (s) {
      return { nombre: s.nombre, partes: repartirProporcional(s.monto, pesos, 0) };
    });
    var grupoId = uid(), fecha = todayStr();
    var etiquetas = grupo.participantes.map(function (p) { return p.etiqueta; });
    var proveedorId = draft.proveedorId || "";
    var reparto = {};
    grupo.participantes.forEach(function (p, i) {
      var serviciosDescuento = repartosServicios
        .map(function (r) { return { nombre: r.nombre, monto: r.partes[i] }; })
        .filter(function (s) { return s.monto > 0; });
      // cantidadExcedenteCompra/costoExcedenteCompra (core/calc.js) asumen
      // que el excedente de una compra es SIEMPRE una porción de su propia
      // cantidadReal/costoReal (nunca algo aparte) — así que cantidadReal y
      // costoReal de cada compra tienen que incluir lo que le tocó de
      // excedente a ESE tenedor, no solo lo que ese pedido necesitaba. Si no,
      // costoRealPedido/cantidadRealPedido (la única puerta de lectura, ver
      // Hallazgo #29) restan el excedente completo de una cantidadReal que
      // nunca lo incluyó, dejando en $0 el costo propio de quien tiene la
      // reserva.
      var cantidadExcedentePedido = excedentes ? excedentes[i] : 0;
      var costoExcedentePedido = costosExcedente ? costosExcedente[i] : 0;
      reparto[p.cotId] = {
        cantidadReal: cantidadesFinal[i] + cantidadExcedentePedido,
        costoReal: costos[i] + costoExcedentePedido,
        cantidadExcedente: cantidadExcedentePedido,
        serviciosDescuento: serviciosDescuento
      };
    });

    var afectadas = 0;
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (!reparto[c.id]) return c;
      afectadas++;
      var compras = (c.compras || []).slice();
      var idx = -1;
      compras.forEach(function (x, j) { if (x.clave === clave) idx = j; });
      var base = idx >= 0 ? compras[idx] : { clave: clave, observaciones: "", txId: "", excedenteTxId: "" };
      var actualizada = Object.assign({}, base, {
        clave: clave, estado: "si",
        cantidadReal: reparto[c.id].cantidadReal, costoReal: reparto[c.id].costoReal,
        cantidadExcedente: reparto[c.id].cantidadExcedente,
        proveedorId: proveedorId || base.proveedorId || "",
        fecha: base.fecha || fecha,
        compartida: { grupoId: grupoId, fecha: fecha, etiquetas: etiquetas }
      });
      if (idx >= 0) compras[idx] = actualizada; else compras.push(actualizada);
      var sinc = sincronizarComprasFinanzasDe(Object.assign({}, c, { compras: compras }));
      // El descuento de servicio no vive dentro de sincronizarComprasFinanzasDe
      // (la usan otros caminos, ej. "Actualizar movimientos financieros" de
      // una compra individual, que no conocen este concepto) — se cuelga acá,
      // directo sobre el tx ya creado/actualizado para ESTE pedido, una vez
      // resuelto su txId.
      if (reparto[c.id].serviciosDescuento.length) {
        var compraSinc = sinc.compras.filter(function (x) { return x.clave === clave; })[0];
        var txServ = compraSinc && compraSinc.txId ? state.tx.filter(function (t) { return t.id === compraSinc.txId; })[0] : null;
        if (txServ) txServ.serviciosDescuento = reparto[c.id].serviciosDescuento;
      }
      return Object.assign({}, c, { compras: sinc.compras });
    });

    var porClaveNuevo = Object.assign({}, state.formCompraConjunta.porClave || {});
    delete porClaveNuevo[clave];
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { porClave: porClaveNuevo });
    persist("cotizaciones"); persist("tx"); notify();
    mostrarToast("✓ Compra compartida registrada entre " + afectadas + " pedidos.");
  },
  // Espejo de "registrar-compra-conjunta" pero para un costo FIJO del
  // pedido (domicilio, diseño) — sin cantidad ni excedente, solo un monto
  // que se reparte entre los pedidos. A diferencia de una compra
  // compartida, cada participante ya tiene su PROPIA compra (su propio
  // `claveGlobal`, "global|"+id) — nunca se fusionan registros de
  // cotizaciones distintas en uno solo, cada uno se busca y actualiza por
  // separado dentro de su propia cotización.
  "registrar-costo-compartido": function (el) {
    var clave = el.getAttribute("data-clave");
    var sel = state.formCompraConjunta.seleccion || [];
    var grupo = calcGruposCostoCompartido(sel).filter(function (g) { return g.clave === clave; })[0];
    if (!grupo) return;
    var draft = (state.formCompraConjunta.porClave || {})[clave] || {};
    var costoTotal = num(draft.costoTotal);
    if (costoTotal <= 0) {
      window.alert("Escribe cuánto pagaste en total antes de registrar.");
      return;
    }
    var pesos = grupo.participantes.map(function (p) { return p.costoEstimado; });
    var costos = repartirProporcional(costoTotal, pesos, 0);
    // El monto de cada pedido admite corrección manual (ver
    // "set-costo-compartido-monto") — sin nada escrito, usa el
    // proporcional de siempre. Mismo criterio de "cero descuadre" que
    // "registrar-compra-conjunta": si lo escrito a mano no suma exacto el
    // total pagado, se bloquea el registro ANTES de tocar nada.
    var overridesCosto = draft.costosPorPedido || {};
    var costosFinal = grupo.participantes.map(function (p, i) {
      var ov = overridesCosto[p.cotId];
      return (ov !== undefined && ov !== "") ? num(ov) : costos[i];
    });
    var sumaCostosFinal = costosFinal.reduce(function (a, v) { return a + v; }, 0);
    // Tolerancia CERO, no de "un peso" — a diferencia de una cantidad física
    // (metros, que pueden arrastrar coma flotante), un monto acá siempre es
    // un peso entero exacto (repartirProporcional con decimales:0), así que
    // no hay ningún redondeo legítimo que perdonar. Un peso de descuadre
    // silencioso rompería el mismo criterio bancario que el resto de la app
    // exige en todos lados — ver rigor_matematico_dinero.
    if (Math.abs(sumaCostosFinal - costoTotal) > 0) {
      window.alert("Lo repartido entre los pedidos (" + fmt(sumaCostosFinal) + ") no coincide con el total pagado (" + fmt(costoTotal) + "). Ajusta los montos para que sumen exacto.");
      return;
    }
    var grupoId = uid(), fecha = todayStr();
    var etiquetas = grupo.participantes.map(function (p) { return p.etiqueta; });
    var montoPorCot = {};
    grupo.participantes.forEach(function (p, i) { montoPorCot[p.cotId] = { monto: costosFinal[i], claveGlobal: p.claveGlobal }; });

    var afectadas = 0;
    state.cotizaciones = state.cotizaciones.map(function (c) {
      if (!montoPorCot[c.id]) return c;
      afectadas++;
      var claveGlobal = montoPorCot[c.id].claveGlobal;
      var compras = (c.compras || []).slice();
      var idx = -1;
      compras.forEach(function (x, j) { if (x.clave === claveGlobal) idx = j; });
      var base = idx >= 0 ? compras[idx] : { clave: claveGlobal, observaciones: "", txId: "", excedenteTxId: "" };
      var actualizada = Object.assign({}, base, {
        clave: claveGlobal, estado: "si", costoReal: montoPorCot[c.id].monto,
        fecha: base.fecha || fecha,
        compartida: { grupoId: grupoId, fecha: fecha, etiquetas: etiquetas }
      });
      if (idx >= 0) compras[idx] = actualizada; else compras.push(actualizada);
      var sinc = sincronizarComprasFinanzasDe(Object.assign({}, c, { compras: compras }));
      return Object.assign({}, c, { compras: sinc.compras });
    });

    var porClaveNuevo = Object.assign({}, state.formCompraConjunta.porClave || {});
    delete porClaveNuevo[clave];
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { porClave: porClaveNuevo });
    persist("cotizaciones"); persist("tx"); notify();
    mostrarToast("✓ Costo compartido registrado entre " + afectadas + " pedidos.");
  }
};
