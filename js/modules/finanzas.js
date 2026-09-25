import { state, persist, notify, mostrarToast } from "../core/store.js";
import { esc, opt, num, uid, todayStr, fmt, norm, exigirCampos } from "../core/utils.js";
import { clienteById, periodoKey, origenDeTx, origenSistemaDeTx, origenSistemaHuerfano, proveedoresDeContactos, validarServiciosAsignados, pedidoCancelado, calcLineasParaRecibo, calcRepartoLineaRecibo, aplicarReciboACotizaciones, calcRecibo, calcIdsRecibos, esFilaRecibo, reconciliarTxRecibo, verificarRecibo, quitarReciboDeCotizaciones, calcTomaReserva, totalesDesdePartes, estimadoTxDeCot, comprasEnFinanzas, pedidoIdDeCotParaTx } from "../core/calc.js";
import { renderHelp, renderBuscador, renderComboUnidad, renderAsignarServicios, renderHistorialServicio } from "../core/components.js";
import { ejecutarAccionRecibo } from "./cotizaciones.js";

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
    html += renderRecibosCompra();
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
    '<button class="gsheet-tab ' + (vista === "conjuntas" ? "active" : "") + '" data-action="finanzas-vista" data-val="conjuntas">🧾 Recibos de compra</button>' +
    "</div>";
}

// ---------- Recibos de compra ----------
// Una compra REAL (un papel del proveedor) que reparte insumos y plata
// entre 1 o varios pedidos y guarda lo que sobra como reserva para esos
// mismos pedidos — propuesto por el usuario 2026-09-23 ("recibo, porque
// literal es una compra conjunta en la vida real de insumos para varios
// pedidos, o insumos de más para aprovechar la ocasión"). Reemplaza a
// "Compras conjuntas" (que registraba insumo por insumo y no guardaba el
// papel en ningún lado). Modelo y cuentas: ver "Recibo de compra" en
// core/calc.js y CONTABILIDAD.md, Hallazgo #52.
function renderRecibosCompra() {
  var sel = state.formCompraConjunta.seleccion || [];
  var candidatos = state.pedidos.filter(function (p) {
    if (pedidoCancelado(p) || !p.cotizacionId) return false;
    return calcLineasParaRecibo([p.id]).length > 0;
  });

  var html = renderAvisoMigracionRecibos();
  html += '<div class="card">';
  html += '<div class="cot-col-title" style="margin-top:0;">¿Para qué pedidos es esta compra?' +
    renderHelp("Marca el pedido (o los pedidos) para los que compraste con este mismo papel del proveedor. Abajo sale sola la lista de lo que les falta comprar: escribe cuánto compraste y cuánto pagaste por cada cosa, y la app reparte entre los pedidos lo que cada uno necesita. Lo que sobre queda como reserva de ESTOS pedidos — si alguno necesita más después, se toma de ahí.") +
    (sel.length ? ' <span class="tag">' + sel.length + " elegido" + (sel.length === 1 ? "" : "s") + "</span>" : "") +
    "</div>";
  if (!candidatos.length) {
    html += '<div class="empty">No hay pedidos con compras pendientes — en Producción de una cotización, las líneas en "Aún no" son las que aparecen acá.</div>';
  } else {
    html += '<div class="picker-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius-sm);">';
    candidatos.forEach(function (p) {
      var marcado = sel.indexOf(p.id) !== -1;
      html += '<label class="picker-item ' + (marcado ? "sel" : "") + '" style="grid-template-columns:20px 1fr;">' +
        '<input type="checkbox" data-action="toggle-compra-conjunta-pedido" data-id="' + p.id + '" ' + (marcado ? "checked" : "") + " />" +
        '<span class="picker-item-info"><b>' + esc(p.numeroOp || "OP-????") + " · " + esc(p.cliente || "Sin cliente") + "</b><small>" + esc(p.descripcion || "") + "</small></span>" +
        "</label>";
    });
    html += "</div>";
  }
  html += "</div>";

  if (sel.length) html += renderFormRecibo(calcLineasParaRecibo(sel));
  html += renderUltimosRecibos();
  return html;
}

// Resultado de la conversión de compras viejas a recibos (ver loadAll en
// core/store.js): lo convertido se cuenta en una línea; lo que NO se pudo
// convertir se lista con su motivo — sigue funcionando como antes, nada se
// tocó, pero el usuario tiene que saber que está ahí.
function renderAvisoMigracionRecibos() {
  var m = state.migracionRecibos;
  if (!m || (!m.convertidos.length && !m.saltados.length)) return "";
  var html = '<div class="card" style="margin-bottom:12px;">';
  if (m.convertidos.length) {
    html += '<div class="section-sub" style="margin:0;">✓ ' + m.convertidos.length + " compra(s) que ya tenías registradas (compras conjuntas y excedentes) pasaron a ser recibos de compra. La caja no cambió.</div>";
  }
  if (m.saltados.length) {
    html += '<div class="section-sub" style="margin:' + (m.convertidos.length ? "8px" : "0") + ' 0 0;color:var(--warning-ink);">' +
      m.saltados.length + " compra(s) viejas NO se pasaron a recibo — siguen funcionando como antes, no se tocó nada:<br>" +
      m.saltados.map(function (s) { return "• " + esc(s.motivo); }).join("<br>") + "</div>";
  }
  return html + "</div>";
}

function soloOp(etiqueta) { return String(etiqueta || "").split(" · ")[0]; }

// El borrador puede venir de antes del recibo (un borrador guardado de
// Compras conjuntas, o un reset con solo {seleccion, porClave}): sin
// `recibo`, "Asignar a servicio(s)" no tendría dónde escribir (su
// data-form-destino es "formCompraConjunta.recibo", ver
// resolverFormDestino en core/dom.js).
function formReciboCompleto() {
  var f = state.formCompraConjunta || {};
  return Object.assign({ seleccion: [], porClave: {}, ajustar: {} }, f, {
    recibo: Object.assign({ fecha: "", proveedorId: "", numero: "", servicios: [] }, f.recibo || {})
  });
}
function fmtCant(x, dec) { return num(x).toFixed(dec); }

function renderFormRecibo(lineas) {
  var f = state.formCompraConjunta;
  var rec = f.recibo || {};
  var draft = f.porClave || {};
  var proveedores = proveedoresDeContactos();
  var html = '<div class="card" style="margin-top:12px;">';
  html += '<div class="cot-col-title" style="margin-top:0;">Datos del recibo</div>';
  html += '<div class="form-grid">' +
    '<div class="field"><label>Fecha</label><input type="date" class="mini-input" value="' + esc(rec.fecha || todayStr()) + '" data-action-change="set-recibo-campo" data-campo="fecha" /></div>' +
    '<div class="field"><label>Proveedor (opcional)</label>' +
    (proveedores.length
      ? '<select class="mini-input" data-action-change="set-recibo-campo" data-campo="proveedorId"><option value="">Sin especificar</option>' +
        proveedores.map(function (p) { return '<option value="' + p.id + '" ' + (rec.proveedorId === p.id ? "selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select>"
      : '<span class="section-sub" style="margin:0;">Sin proveedores en Contactos.</span>') +
    "</div>" +
    '<div class="field"><label>N.º de factura (opcional)</label><input class="mini-input" value="' + esc(rec.numero || "") + '" placeholder="Ej. 4411" data-action-change="set-recibo-campo" data-campo="numero" /></div>' +
    "</div></div>";

  if (!lineas.length) {
    return html + '<div class="empty" style="margin-top:12px;">Estos pedidos no tienen nada pendiente por comprar.</div>';
  }
  html += '<div class="cot-col-title" style="margin-top:16px;">¿Qué compraste?' +
    renderHelp('Escribe lo que dice el papel del proveedor: cuánto compraste y cuánto pagaste. Solo entran al recibo las líneas con algo en "Pagué"; las demás se quedan pendientes. Cada pedido recibe lo que necesita y lo que sobre queda como reserva — con "Ajustar reparto" puedes cambiar cuánto le toca a cada uno.') +
    "</div>";
  var total = 0, enRecibo = 0;
  lineas.forEach(function (g) {
    var d = draft[g.linea] || {};
    html += renderLineaRecibo(g, d);
    if (num(d.costoPagado) > 0) { total += Math.round(num(d.costoPagado)); enRecibo++; }
  });

  html += '<div class="card cc-grupo" style="margin-top:12px;">';
  html += '<div class="cc-grupo-head"><div class="cc-grupo-titulo"><b>Total del recibo</b>' +
    (enRecibo ? '<span class="tag">' + enRecibo + " línea" + (enRecibo === 1 ? "" : "s") + "</span>" : "") + "</div>" +
    '<span class="amount neg">' + fmt(total) + "</span></div>";
  if (total > 0) {
    html += renderAsignarServicios({ formKey: "formCompraConjunta.recibo", filas: rec.servicios || [], monto: total });
  }
  html += '<div class="row-actions" style="margin-top:var(--sp-3);"><button class="btn" data-action="registrar-recibo-compra">Registrar recibo' + (total > 0 ? " (" + fmt(total) + ")" : "") + "</button></div>";
  html += "</div>";
  return html;
}

function renderLineaRecibo(g, d) {
  var dec = g.esProducto ? 0 : 2;
  var r = num(d.costoPagado) > 0 ? calcRepartoLineaRecibo(g, d) : null;
  var abierta = !!((state.formCompraConjunta.ajustar || {})[g.linea]);
  var reposicion = g.participantes.some(function (p) { return p.esReposicion; });
  var html = '<div class="card cc-grupo' + (r && r.ok ? " cc-grupo-listo" : "") + '">';
  html += '<div class="cc-grupo-head">' +
    '<div class="cc-grupo-titulo"><b>' + esc(g.nombre) + "</b>" +
    '<span class="tag">' + g.participantes.length + " pedido" + (g.participantes.length === 1 ? "" : "s") + "</span>" +
    (reposicion ? '<span class="tag" title="Un pedido que ya está en otro recibo necesita más de lo que quedaba en su reserva.">reposición</span>' : "") +
    "</div>" +
    '<span class="section-sub" style="margin:0;">' +
    (g.esGlobal ? "Estimado " + fmt(g.totalCostoEstimado) : "Necesitan " + fmtCant(g.totalNecesita, dec) + " " + esc(g.unidad)) +
    "</span></div>";
  html += '<div class="cc-grupo-participantes">' +
    g.participantes.map(function (p) {
      return '<span class="cc-chip">' + esc(p.etiqueta) + " · " + (g.esGlobal ? fmt(p.costoEstimado) : fmtCant(p.necesita, dec) + " " + esc(g.unidad)) + "</span>";
    }).join("") + "</div>";
  html += '<div class="form-grid" style="margin-top:var(--sp-3);">' +
    (g.esGlobal ? "" :
      '<div class="field"><label>Compré (' + esc(g.unidad || "cantidad") + ')</label><input type="number" class="mini-input" ' + (g.esProducto ? 'step="1" ' : "") + 'placeholder="' + fmtCant(g.totalNecesita, dec) + '" value="' + esc(d.cantidadComprada || "") + '" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.linea) + '" data-campo="cantidadComprada" /></div>') +
    '<div class="field"><label>Pagué</label><input type="number" class="mini-input" placeholder="' + Math.round(g.totalCostoEstimado) + '" value="' + esc(d.costoPagado || "") + '" data-action-change="set-compra-conjunta-campo" data-clave="' + esc(g.linea) + '" data-campo="costoPagado" /></div>' +
    "</div>";

  if (r) {
    if (!r.ok) {
      html += '<div class="section-sub" style="margin-top:8px;color:var(--danger-ink);">' + esc(r.error) + "</div>";
    } else {
      var partesTxt = r.partes.map(function (p, i) {
        var op = soloOp(g.participantes[i].etiqueta);
        return esc(op) + " " + (g.esGlobal ? "" : fmtCant(p.cantidad, dec) + " " + esc(g.unidad) + " ") + fmt(p.costo);
      });
      if (r.reserva.cantidad > 0 || r.reserva.costo > 0) {
        partesTxt.push("↺ sobran " + fmtCant(r.reserva.cantidad, dec) + " " + esc(g.unidad) + " " + fmt(r.reserva.costo) + " (reserva)");
      }
      html += '<div class="section-sub" style="margin-top:8px;">' + partesTxt.join(" · ") + "</div>";
    }
    if (r.faltan > 0) {
      html += '<div class="section-sub" style="margin-top:4px;color:var(--warning-ink);">Compraste menos de lo que necesitan: faltan ' + fmtCant(r.faltan, dec) + " " + esc(g.unidad) + ". Se reparte a prorrata y lo que falta queda pendiente como reposición de cada pedido.</div>";
    }
    html += '<button class="btn ghost small" style="margin-top:6px;" data-action="toggle-ajustar-recibo" data-clave="' + esc(g.linea) + '">' + (abierta ? "▾" : "▸") + " Ajustar reparto</button>";
    if (abierta) html += renderAjusteRecibo(g, d, r, dec);
  }
  html += "</div>";
  return html;
}

// Tabla "Se reparte así" editable — la misma idea de Compras conjuntas: el
// reparto automático es el valor por defecto, cada fila se puede corregir.
function renderAjusteRecibo(g, d, r, dec) {
  var ovCant = d.cantidadesPorPedido || {}, ovCosto = d.costosPorPedido || {};
  var html = '<div class="cc-reparto">';
  html += '<div class="tx-row head" style="grid-template-columns:1fr 110px 110px;"><span>Pedido</span><span class="ins-th-num">' + (g.esGlobal ? "" : "Cantidad") + '</span><span class="ins-th-num">Costo</span></div>';
  g.participantes.forEach(function (p, i) {
    var parte = r.partes[i] || { cantidad: 0, costo: 0 };
    html += '<div class="tx-row" style="grid-template-columns:1fr 110px 110px;">' +
      '<span class="mobile-th">Pedido</span><span>' + esc(p.etiqueta) + "</span>" +
      '<span class="mobile-th">Cantidad</span>' +
      (g.esGlobal ? "<span></span>" :
        '<input type="number" class="mini-input" style="text-align:right;width:100%;" ' + (g.esProducto ? 'step="1" ' : "") + 'value="' + esc(ovCant[p.cotId] !== undefined ? ovCant[p.cotId] : fmtCant(parte.cantidad, dec)) + '" data-action-change="set-compra-conjunta-cantidad-pedido" data-clave="' + esc(g.linea) + '" data-cot="' + esc(p.cotId) + '" />') +
      '<span class="mobile-th">Costo</span>' +
      (g.esGlobal
        ? '<input type="number" class="mini-input" style="text-align:right;width:100%;" value="' + esc(ovCosto[p.cotId] !== undefined ? ovCosto[p.cotId] : parte.costo) + '" data-action-change="set-costo-compartido-monto" data-clave="' + esc(g.linea) + '" data-cot="' + esc(p.cotId) + '" />'
        : '<span class="amount">' + fmt(parte.costo) + "</span>") +
      "</div>";
  });
  html += "</div>";
  return html;
}

function renderUltimosRecibos() {
  var ids = calcIdsRecibos(state.cotizaciones, state.tx);
  if (!ids.length) return "";
  var recibos = ids.map(function (id) { return calcRecibo(id, state.cotizaciones, state.tx); })
    .sort(function (a, b) { return String((b.cabecera || {}).fecha).localeCompare(String((a.cabecera || {}).fecha)); })
    .slice(0, 5);
  var html = '<div class="card" style="margin-top:12px;"><div class="cot-col-title" style="margin-top:0;">Últimos recibos</div>';
  recibos.forEach(function (r) {
    html += '<div class="tx-row" style="grid-template-columns:1fr auto auto;">' +
      "<span>🧾 " + esc((r.cabecera && r.cabecera.fecha) || "") + " · " + esc(nombreProveedorRecibo(r)) + " · " + r.pedidoIds.length + " pedido" + (r.pedidoIds.length === 1 ? "" : "s") + "</span>" +
      '<span class="amount neg">' + fmt(r.total) + "</span>" +
      '<button class="btn ghost small" data-action="ver-recibo" data-recibo-id="' + esc(r.id) + '">Ver</button>' +
      "</div>";
  });
  return html + "</div>";
}

function nombreProveedorRecibo(r) {
  var cab = r.cabecera || {};
  var prov = cab.proveedorId ? clienteById(cab.proveedorId) : null;
  return prov ? prov.nombre : (cab.contraparte || "Sin proveedor");
}

function pedidoPorId(id) {
  return state.pedidos.filter(function (p) { return p.id === id; })[0] ||
    (state.pedidosPapelera || []).filter(function (p) { return p.id === id; })[0] || null;
}

// La tarjeta de un recibo en Finanzas → Historial (decisión del usuario
// 2026-09-23): el total pagado, y al desplegarla la parte de cada pedido y
// la reserva. "Pagado" (no "Neto") suma TODAS sus filas, no solo las que
// pasen el filtro — es lo que dice el papel. Las partes de cada pedido se
// muestran acá solo de referencia (ya cuentan en la tarjeta de su pedido):
// ningún número de esta tarjeta vuelve a sumarse en ningún otro lado.
function renderTarjetaRecibo(reciboId) {
  var r = calcRecibo(reciboId, state.cotizaciones, state.tx);
  var filas = state.tx.filter(function (t) { return esFilaRecibo(t) && t.reciboCompraId === reciboId; });
  var pagado = filas.reduce(function (a, t) { return a + num(t.monto); }, 0);
  var problemas = verificarRecibo(reciboId, state.cotizaciones, state.tx);
  var abierto = !!(state.reciboExpandido || {})[reciboId];
  var cab = r.cabecera || {};
  var chips = r.pedidoIds.map(function (pid) {
    var p = pedidoPorId(pid);
    return '<span class="cc-chip">' + esc(p ? (p.numeroOp || "OP-????") : "Pedido eliminado") + (p && pedidoCancelado(p) ? " (cancelado)" : "") + "</span>";
  }).join("");

  var html = '<div class="card cc-grupo" style="margin-bottom:14px;" data-recibo-id="' + esc(reciboId) + '">';
  html += '<div class="cot-col-title" style="margin-top:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
    '<button class="btn ghost small" data-action="toggle-recibo" data-recibo-id="' + esc(reciboId) + '" aria-label="Ver detalle">' + (abierto ? "▾" : "▸") + "</button>" +
    "<span>🧾 <b>Recibo de compra</b> · " + esc(nombreProveedorRecibo(r)) + " · " + esc(cab.fecha || "") + (cab.numero ? " · N.º " + esc(cab.numero) : "") + "</span>" +
    (problemas.length ? '<span class="tag" style="background:var(--danger-soft);color:var(--danger-ink);" title="' + esc(problemas.join(" ")) + '">⚠ descuadre</span>' : "") +
    '<span class="amount neg" style="margin-left:auto;">Pagado: -' + fmt(pagado) + "</span>" +
    "</div>";
  html += '<div class="cc-grupo-participantes">' + chips + "</div>";

  // Resumen de una línea: cuánto le tocó a cada pedido y cuánto quedó libre.
  var porPedido = {};
  r.lineas.forEach(function (L) {
    L.partes.forEach(function (p) { porPedido[p.pedidoId] = (porPedido[p.pedidoId] || 0) + p.costo; });
  });
  var resumen = Object.keys(porPedido).filter(function (pid) { return porPedido[pid] > 0; }).map(function (pid) {
    var p = pedidoPorId(pid);
    return esc(p ? (p.numeroOp || "OP-????") : "Pedido eliminado") + " " + fmt(porPedido[pid]);
  });
  var enReserva = 0;
  r.lineas.forEach(function (L) {
    if (L.reserva.cantidad > 0 || L.reserva.costo > 0) {
      enReserva += Math.max(0, L.reserva.costo);
      resumen.push((L.esGlobal ? "Sin asignar " + esc(L.nombre) : "↺ " + esc(L.nombre) + " " + fmtCant(L.reserva.cantidad, L.esProducto ? 0 : 2) + " " + esc(L.unidad)) + " " + fmt(L.reserva.costo));
    }
  });
  html += '<div class="section-sub" style="margin-top:6px;">' + resumen.join(" · ") + "</div>";

  if (abierto) {
    r.lineas.forEach(function (L) {
      var dec = L.esProducto ? 0 : 2;
      html += '<div style="margin-top:10px;"><b>' + esc(L.nombre) + "</b> · " + (L.esGlobal ? "" : fmtCant(L.cantidadTotal, dec) + " " + esc(L.unidad) + " · ") + fmt(L.costoTotal) + (L.congelada ? ' <span class="tag" title="Ya no queda ningún pedido vivo en esta línea: lo pagado quedó como reserva.">sin pedidos</span>' : "") + "</div>";
      L.partes.forEach(function (p) {
        var ped = pedidoPorId(p.pedidoId);
        var cancelado = ped && pedidoCancelado(ped);
        html += '<div class="section-sub" style="margin:2px 0 0 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          "<span>" + esc(ped ? (ped.numeroOp || "OP-????") : "Pedido eliminado") + (L.esGlobal ? "" : " · " + fmtCant(p.cantidad, dec) + " " + esc(L.unidad)) + " · " + fmt(p.costo) + " <i>(va en su pedido)</i></span>" +
          (cancelado && (p.cantidad > 0 || p.costo > 0)
            ? '<button class="btn ghost small" data-action="devolver-parte-recibo" data-recibo-id="' + esc(reciboId) + '" data-cot="' + esc(p.cotId) + '" data-clave="' + esc(p.compraClave) + '" title="El pedido se canceló: su parte vuelve a la reserva del recibo (la plata ya se pagó, no sale de la caja).">↩ Devolver a la reserva</button>'
            : "") +
          "</div>";
      });
      if (L.reserva.cantidad > 0 || L.reserva.costo > 0) {
        html += '<div class="section-sub" style="margin:2px 0 0 12px;">' + (L.esGlobal ? "Sin asignar" : "↺ Reserva " + fmtCant(L.reserva.cantidad, dec) + " " + esc(L.unidad)) + " · " + fmt(L.reserva.costo) + "</div>";
      }
    });
    if ((cab.servicios || []).length) {
      html += '<div class="section-sub" style="margin-top:8px;">📋 Pagado con: ' + cab.servicios.map(function (s) { return esc(s.nombre) + " " + fmt(s.monto); }).join(", ") + "</div>";
    }
    html += '<div class="section-sub" style="margin-top:8px;">' + fmt(pagado - enReserva) + " en pedidos + " + fmt(enReserva) + " en reserva = <b>" + fmt(pagado) + " pagados</b></div>";
    if (problemas.length) {
      html += '<div class="section-sub" style="margin-top:8px;color:var(--danger-ink);">' + problemas.map(esc).join("<br>") + "</div>";
    }
    html += '<div class="row-actions" style="margin-top:10px;flex-wrap:wrap;">' +
      (problemas.length ? '<button class="btn small" data-action="completar-movimientos-recibo" data-recibo-id="' + esc(reciboId) + '">Completar movimientos</button>' : "") +
      '<button class="btn ghost small" data-action="anular-corregir-recibo" data-recibo-id="' + esc(reciboId) + '" title="Anula este recibo y deja el formulario lleno con sus datos para registrarlo de nuevo, corregido.">Anular y corregir…</button>' +
      '<button class="btn danger small" data-action="anular-recibo" data-recibo-id="' + esc(reciboId) + '">Anular recibo</button>' +
      "</div>";
  }
  html += "</div>";
  return html;
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

  // Una fila de un Recibo de compra va a la tarjeta de su recibo; si
  // además es la parte de un pedido, TAMBIÉN sigue en la tarjeta de ese
  // pedido (decisión del usuario 2026-09-23: cada pedido sigue viendo su
  // parte en su Neto). La reserva ya no cae en "Movimientos sueltos": es
  // del recibo, no de nadie más.
  var conPedido = {}, sinPedido = [], porRecibo = {};
  filtered.forEach(function (t) {
    if (esFilaRecibo(t)) (porRecibo[t.reciboCompraId] = porRecibo[t.reciboCompraId] || []).push(t);
    if (t.pedidoId) { (conPedido[t.pedidoId] = conPedido[t.pedidoId] || []).push(t); }
    else if (!esFilaRecibo(t)) sinPedido.push(t);
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
  }).concat(Object.keys(porRecibo).map(function (rid) {
    var txs = porRecibo[rid].slice().sort(compararTxRecienteFirst);
    return { reciboId: rid, txs: txs, fechaTope: txs[0] ? txs[0].fecha : "" };
  })).sort(function (a, b) {
    return String(b.fechaTope).localeCompare(String(a.fechaTope));
  });
  sinPedido.sort(compararTxRecienteFirst);

  // Cada grupo agrupa TODOS los movimientos de un mismo pedido (abonos,
  // sobrecostos, comisiones, estimados...) en un solo panel, con el total
  // neto de ese pedido a la vista.
  gruposOrdenados.forEach(function (g) {
    if (g.reciboId) { html += renderTarjetaRecibo(g.reciboId); return; }
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
    // Una fila de un recibo se encuentra también por los pedidos de TODO su
    // recibo y por su proveedor/N.º (así "OP-102" encuentra la tarjeta del
    // recibo aunque la fila sea la reserva, que no tiene pedido).
    var textoRecibo = {};
    function textoDeRecibo(rid) {
      if (textoRecibo[rid] !== undefined) return textoRecibo[rid];
      var r = calcRecibo(rid, state.cotizaciones, state.tx);
      var partes = [nombreProveedorRecibo(r), (r.cabecera || {}).numero || ""];
      r.pedidoIds.forEach(function (pid) { var p = pedidoPorId(pid); if (p) partes.push(p.numeroOp, p.cliente, p.descripcion); });
      textoRecibo[rid] = partes.map(norm).join(" | ");
      return textoRecibo[rid];
    }
    list = list.filter(function (t) {
      var pedido = t.pedidoId ? state.pedidos.filter(function (p) { return p.id === t.pedidoId; })[0] : null;
      var cliente = pedido && pedido.clienteId ? clienteById(pedido.clienteId) : null;
      var cedula = cliente ? cliente.cedula : "";
      var haystack = [t.concepto, t.contraparte, t.fecha, pedido ? pedido.numeroOp : "", pedido ? pedido.cliente : "", pedido ? pedido.descripcion : "", cedula]
        .map(norm).join(" | ") + (esFilaRecibo(t) ? " | " + textoDeRecibo(t.reciboCompraId) : "");
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
    (esFilaRecibo(t) ? ' <button class="tag" style="cursor:pointer;border:none;" data-action="ver-recibo" data-recibo-id="' + esc(t.reciboCompraId) + '" title="Parte de un recibo de compra — ver el recibo completo">🧾 Recibo</button>' : "") +
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
    // Una fila de recibo no se edita suelta: su concepto/fecha los arma el
    // recibo y se reescribirían en la próxima reconciliación.
    (esFilaRecibo(t) ? "" : '<button class="btn ghost small" data-action="editar-tx" data-id="' + t.id + '">Editar</button>') +
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
    if (origen.tipo === "recibo") { irARecibo(origen.id); return; }
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
    state.formCompraConjunta = Object.assign({}, formReciboCompleto(), { seleccion: sel });
    notify();
  },
  "set-compra-conjunta-campo": function (el) {
    var clave = el.getAttribute("data-clave"), campo = el.getAttribute("data-campo");
    var porClave = Object.assign({}, state.formCompraConjunta.porClave || {});
    var fila = Object.assign({}, porClave[clave] || {});
    fila[campo] = el.value;
    porClave[clave] = fila;
    state.formCompraConjunta = Object.assign({}, formReciboCompleto(), { porClave: porClave });
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
  "set-recibo-campo": function (el) {
    var campo = el.getAttribute("data-campo");
    var recibo = Object.assign({}, state.formCompraConjunta.recibo || {});
    recibo[campo] = el.value;
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { recibo: recibo });
    notify();
  },
  "toggle-ajustar-recibo": function (el) {
    var clave = el.getAttribute("data-clave");
    var ajustar = Object.assign({}, state.formCompraConjunta.ajustar || {});
    if (ajustar[clave]) delete ajustar[clave]; else ajustar[clave] = true;
    state.formCompraConjunta = Object.assign({}, state.formCompraConjunta, { ajustar: ajustar });
    notify();
  },
  // Registra UN recibo con todas las líneas que tengan algo en "Pagué".
  // Cada línea se reparte con calcRepartoLineaRecibo — la MISMA función que
  // arma la vista previa, así lo que se guarda es exactamente lo que se vio.
  // Todo pasa dentro de ejecutarAccionRecibo: si algo no cuadra al peso, no
  // se guarda nada.
  "registrar-recibo-compra": function () {
    var f = state.formCompraConjunta;
    var sel = f.seleccion || [];
    var draft = f.porClave || {};
    var lineas = calcLineasParaRecibo(sel).filter(function (g) { return num((draft[g.linea] || {}).costoPagado) > 0; });
    if (!lineas.length) { window.alert("Escribe cuánto pagaste en al menos una línea antes de registrar."); return; }
    var repartos = [];
    for (var i = 0; i < lineas.length; i++) {
      var reparto = calcRepartoLineaRecibo(lineas[i], draft[lineas[i].linea] || {});
      if (!reparto.ok) { window.alert(lineas[i].nombre + ": " + reparto.error); return; }
      repartos.push({ grupo: lineas[i], reparto: reparto });
    }
    var total = repartos.reduce(function (a, x) { return a + x.reparto.totales.costoTotal; }, 0);
    var rec = f.recibo || {};
    var validacion = validarServiciosAsignados(rec.servicios, total);
    if (!validacion.ok) { window.alert(validacion.error); return; }
    // Una compra que todavía tiene un movimiento viejo propio en Finanzas
    // (ej. se pasó a "Aún no" sin pulsar "Actualizar movimientos") contaría
    // esa plata dos veces si entra a un recibo — mejor pedir que se ponga al
    // día primero que adivinar cuál de las dos es la real.
    var cotIds = [];
    repartos.forEach(function (x) { x.reparto.partes.forEach(function (p) { if (cotIds.indexOf(p.cotId) === -1) cotIds.push(p.cotId); }); });
    var conMovimientoViejo = [];
    repartos.forEach(function (x) {
      x.grupo.participantes.forEach(function (p) {
        var cot = state.cotizaciones.filter(function (c) { return c.id === p.cotId; })[0];
        var compra = cot && (cot.compras || []).filter(function (c) { return c.clave === p.compraClave; })[0];
        if (!compra) return;
        // Solo cuenta un movimiento suelto que sea de ESTA cotización (ver
        // comprasEnFinanzas): un id heredado de un duplicado viejo apunta al
        // del original, y pedir "Actualizar movimientos" por eso terminaba
        // borrando un movimiento ajeno (Hallazgo #53).
        var viejo = comprasEnFinanzas(cot, state.tx, compra.clave).sueltas.length > 0;
        if (viejo) conMovimientoViejo.push(soloOp(p.etiqueta) + " (" + x.grupo.nombre + ")");
      });
    });
    if (conMovimientoViejo.length) {
      window.alert("Antes de registrar este recibo, pulsa \"Actualizar movimientos financieros\" en la cotización de: " + conMovimientoViejo.join(", ") + ". Esa compra todavía tiene un movimiento viejo en Finanzas y se contaría dos veces.");
      return;
    }
    // Mismo aviso que "Actualizar movimientos financieros": si un pedido ya
    // tiene su costo ESTIMADO completo registrado, sumarle compras reales
    // contaría su costo dos veces.
    var conEstimado = state.cotizaciones.filter(function (c) {
      return cotIds.indexOf(c.id) !== -1 && !!estimadoTxDeCot(c, state.tx);
    });
    if (conEstimado.length && !window.confirm("Estos pedidos ya tienen su costo ESTIMADO completo registrado en Finanzas: " +
      conEstimado.map(function (c) { return c.descripcion || c.cliente; }).join(", ") +
      ".\n\nSi además registras este recibo, su costo se contará DOS veces. Lo recomendable es borrar ese estimado en Finanzas.\n\n¿Continuar de todos modos?")) return;

    var etiquetas = [];
    repartos.forEach(function (x) { x.grupo.participantes.forEach(function (p) { if (etiquetas.indexOf(p.etiqueta) === -1) etiquetas.push(p.etiqueta); }); });
    var cabecera = { fecha: rec.fecha || todayStr(), proveedorId: rec.proveedorId || "", numero: String(rec.numero || "").trim(), servicios: validacion.limpias, etiquetas: etiquetas };
    var reciboId = uid();
    var ok = ejecutarAccionRecibo({ recibos: [reciboId], deltaCaja: -total }, function () {
      state.cotizaciones = aplicarReciboACotizaciones(state.cotizaciones, reciboId, cabecera, repartos);
      state.tx = reconciliarTxRecibo(state.tx, reciboId, state.cotizaciones).tx;
    });
    if (!ok) return;
    var porClave = Object.assign({}, draft);
    repartos.forEach(function (x) { delete porClave[x.grupo.linea]; });
    state.formCompraConjunta = Object.assign({}, f, { porClave: porClave, ajustar: {}, recibo: { fecha: "", proveedorId: "", numero: "", servicios: [] } });
    var reserva = repartos.reduce(function (a, x) { return a + x.reparto.reserva.costo; }, 0);
    mostrarToast("✓ Recibo registrado: " + fmt(total) + (reserva > 0 ? " (" + fmt(reserva) + " quedan en reserva)" : "") + ".");
    irARecibo(reciboId);
  },
  "toggle-recibo": function (el) {
    var id = el.getAttribute("data-recibo-id");
    var abiertos = Object.assign({}, state.reciboExpandido || {});
    if (abiertos[id]) delete abiertos[id]; else abiertos[id] = true;
    state.reciboExpandido = abiertos;
    notify();
  },
  "ver-recibo": function (el) {
    irARecibo(el.getAttribute("data-recibo-id"));
  },
  // Anula el recibo entero: cada compra pierde su parte (si no le queda
  // otra, vuelve a "Aún no"), y todas sus filas se van a la papelera — de
  // donde NO se pueden restaurar sueltas (ver "restaurar-tx"): para
  // tenerlas de nuevo hay que volver a registrar el recibo.
  "anular-recibo": function (el) {
    anularRecibo(el.getAttribute("data-recibo-id"), false);
  },
  "anular-corregir-recibo": function (el) {
    anularRecibo(el.getAttribute("data-recibo-id"), true);
  },
  // Un recibo cuyas filas en Finanzas no coinciden con lo registrado (ej.
  // se guardaron las compras pero no los movimientos) se completa acá, con
  // un clic y avisando — nunca solo al cargar la app (ver Hallazgo #52).
  "completar-movimientos-recibo": function (el) {
    var id = el.getAttribute("data-recibo-id");
    var antes = state.tx.filter(function (t) { return esFilaRecibo(t) && t.reciboCompraId === id; }).reduce(function (a, t) { return a + num(t.monto); }, 0);
    var despues = reconciliarTxRecibo(state.tx, id, state.cotizaciones).tx.filter(function (t) { return esFilaRecibo(t) && t.reciboCompraId === id; }).reduce(function (a, t) { return a + num(t.monto); }, 0);
    var diferencia = despues - antes;
    if (!window.confirm("Se van a dejar los movimientos de este recibo igual a lo registrado en sus pedidos." +
      (diferencia ? "\n\nLa caja cambia " + (diferencia > 0 ? "-" : "+") + fmt(Math.abs(diferencia)) + "." : "\n\nLa caja no cambia.") + "\n\n¿Continuar?")) return;
    var ok = ejecutarAccionRecibo({ recibos: [id], deltaCaja: -diferencia }, function () {
      state.tx = reconciliarTxRecibo(state.tx, id, state.cotizaciones).tx;
    });
    if (ok) { notify(); mostrarToast("✓ Movimientos del recibo al día."); }
  },
  // Pedido CANCELADO (sí existió, pero no se va a completar): su parte del
  // recibo se puede devolver a la reserva a mano — no se hace sola porque a
  // veces el material ya se usó o se perdió.
  "devolver-parte-recibo": function (el) {
    var reciboId = el.getAttribute("data-recibo-id"), cotId = el.getAttribute("data-cot"), clave = el.getAttribute("data-clave");
    if (!window.confirm("¿Devolver a la reserva del recibo la parte de este pedido cancelado?\n\nLa plata ya se pagó: no sale de la caja, solo deja de contar como costo de este pedido.")) return;
    var ok = ejecutarAccionRecibo({ recibos: [reciboId], deltaCaja: 0 }, function () {
      state.cotizaciones = state.cotizaciones.map(function (c) {
        if (c.id !== cotId) return c;
        var pedidoId = pedidoIdDeCotParaTx(c);
        return Object.assign({}, c, {
          compras: (c.compras || []).map(function (compra) {
            if (compra.clave !== clave) return compra;
            // Lo devuelto queda anotado (la misma marca que al eliminar el
            // pedido) para que "Reactivar" lo vuelva a tomar. Antes se ponía
            // en 0 sin más: cancelar → devolver → reactivar dejaba al pedido
            // sin su material ni su faltante, y su costo real en $0
            // (revisión del Hallazgo #54).
            var partes = (compra.partesRecibo || []).map(function (p) {
              if (p.reciboId !== reciboId || !(num(p.cantidad) > 0 || num(p.costo) > 0)) return p;
              return Object.assign({}, p, { cantidad: 0, costo: 0, devueltaPorEliminar: { pedidoId: pedidoId, cantidad: num(p.cantidad), costo: Math.round(num(p.costo)) } });
            });
            var devuelta = Object.assign({}, compra, { partesRecibo: partes, faltante: 0 });
            if (num(compra.faltante) > 0) devuelta.faltanteAntesDeEliminar = { pedidoId: pedidoId, cantidad: num(compra.faltante) };
            return totalesDesdePartes(devuelta);
          })
        });
      });
      state.tx = reconciliarTxRecibo(state.tx, reciboId, state.cotizaciones).tx;
    });
    if (ok) { notify(); mostrarToast("↩ La parte volvió a la reserva del recibo."); }
  }

};

// Lleva a Finanzas → Historial con la tarjeta del recibo abierta y a la
// vista (limpia filtros para que no quede escondida detrás de uno).
function irARecibo(reciboId) {
  if (!reciboId) return;
  state.tab = "finanzas";
  state.sidebarMobileOpen = false;
  state.finanzasVista = "historial";
  state.filtroTxVista = "activos";
  state.filtroTx = "todos";
  state.filtroTxPeriodo = "todos";
  state.buscarTx = "";
  var abiertos = Object.assign({}, state.reciboExpandido || {});
  abiertos[reciboId] = true;
  state.reciboExpandido = abiertos;
  notify();
  setTimeout(function () {
    var card = document.querySelector('.cc-grupo[data-recibo-id="' + reciboId + '"]');
    if (!card) return;
    if (card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("destello");
  }, 60);
}

function anularRecibo(reciboId, corregir) {
  var r = calcRecibo(reciboId, state.cotizaciones, state.tx);
  var filas = state.tx.filter(function (t) { return esFilaRecibo(t) && t.reciboCompraId === reciboId; });
  var pagado = filas.reduce(function (a, t) { return a + num(t.monto); }, 0);
  var cab = r.cabecera || {};
  if (!window.confirm("¿Anular este recibo de compra (" + fmt(pagado) + ")?\n\n" +
    "Sus " + filas.length + " movimiento(s) salen de Finanzas (quedan en la papelera) y la caja vuelve a subir " + fmt(pagado) + ". Las compras de sus pedidos vuelven a quedar pendientes." +
    ((cab.servicios || []).length ? "\n\nLa plata que se había tomado de servicios vuelve a quedar disponible." : "") +
    (corregir ? "\n\nEl formulario queda lleno con sus datos para registrarlo de nuevo, corregido." : ""))) return;
  var ok = ejecutarAccionRecibo({ recibos: [reciboId], deltaCaja: pagado }, function () {
    state.cotizaciones = quitarReciboDeCotizaciones(state.cotizaciones, reciboId);
    var ids = filas.map(function (t) { return t.id; });
    state.tx = state.tx.filter(function (t) { return ids.indexOf(t.id) === -1; });
    filas.forEach(function (t) {
      state.txPapelera.unshift(Object.assign({}, t, { eliminadoEl: todayStr(), eliminadoConRecibo: reciboId }));
    });
  });
  if (!ok) return;
  if (corregir) {
    // Nunca se copian ids que apunten hacia afuera (el del recibo anulado,
    // los de sus movimientos): el recibo corregido es uno nuevo.
    var porClave = {};
    r.lineas.forEach(function (L) {
      if (!L.partes.length) return;
      var d = { costoPagado: String(L.costoTotal) };
      if (L.esGlobal) {
        d.costosPorPedido = {};
        L.partes.forEach(function (p) { d.costosPorPedido[p.cotId] = String(p.costo); });
      } else {
        d.cantidadComprada = String(L.cantidadTotal);
        d.cantidadesPorPedido = {};
        L.partes.forEach(function (p) { d.cantidadesPorPedido[p.cotId] = String(p.cantidad); });
      }
      porClave[L.linea] = d;
    });
    state.formCompraConjunta = {
      seleccion: r.pedidoIds.filter(function (pid) { return state.pedidos.some(function (p) { return p.id === pid; }); }),
      porClave: porClave, ajustar: {},
      recibo: { fecha: cab.fecha || "", proveedorId: cab.proveedorId || "", numero: cab.numero || "", servicios: (cab.servicios || []).map(function (s) { return { nombre: s.nombre, monto: String(s.monto) }; }) }
    };
    state.finanzasVista = "conjuntas";
  }
  notify();
  mostrarToast(corregir ? "Recibo anulado — corrígelo abajo y vuelve a registrarlo." : "Recibo anulado: " + fmt(pagado) + " de vuelta en la caja.");
}

