// Catálogo de prendas YA HECHAS (no personalizadas — a lo mucho cambia la
// talla) que sí conviene tener en stock, a diferencia de una cotización a la
// medida. Un producto es "casi lo mismo que una plantilla de prenda" (mismos
// insumos/flujo de producción/consumo, para documentar el costeo real) pero
// con precio de venta y stock por talla — se puede vender directo en un
// pedido, entregar en consignación, o aplicar en una cotización igual que una
// plantilla. Ver js/core/stock.js (ajustarStockProducto) para cómo se
// descuenta/repone el stock desde cualquiera de esos flujos.
//
// Mismo patrón de pestañas que Cotizaciones: "+ Nuevo producto" es un
// formulario chico (lo esencial para vender) que, al crear, deja abierto el
// detalle completo del producto recién creado — ahí (y solo ahí) se editan
// tallas/stock/insumos. La pestaña "Catálogo" es SIEMPRE un índice visual en
// cards (foto, nombre, categoría, precio, stock) — clic en cualquiera abre su
// detalle completo en la otra pestaña. Nunca las dos cosas a la vez.
import { state, persist, notify } from "../core/store.js";
import { esc, num, uid, val, opt, norm, exigirCampos } from "../core/utils.js";
import { renderTipoCostoOptions, renderHelp } from "../core/components.js";
import { subirImagenReferencia } from "../core/drive.js";
import { ajustarStockProducto, proponerCambioProducto, aprobarPropuestaProducto, descartarPropuestaProducto } from "../core/stock.js";
import { calcTotalesProducto, stockTotalProducto, proveedoresDeContactos } from "../core/calc.js";
import { getSession } from "../core/auth.js";
import { ORIGEN_PRODUCCION, TIPOS_COSTO } from "../core/constants.js";

var INS_COLS = "1fr 60px 90px 150px 70px 30px";
var TALLA_COLS = "1fr 90px 30px";
var MOV_COLS = "90px 90px 70px 70px 1fr";

export function render() {
  var session = getSession();
  var html = renderPropuestasPendientesProducto(session);
  var vista = state.productosVista || "nueva";
  html += renderTabsProductos(vista);
  html += vista === "catalogo" ? renderCatalogoGrid() : renderEditorProducto();
  html += renderInsumoPickerProducto();
  return html;
}

// El admin ve TODAS las propuestas (precio o movimiento de stock) de
// cualquier vendedor y puede aprobarlas/descartarlas; un vendedor solo ve si
// las suyas siguen pendientes (para saber que aún no se aplicaron). Mismo
// espíritu que renderPropuestasPendientes en catalogo.js, pero con el detalle
// propio de cada tipo de propuesta (precio vs. movimiento de stock).
function renderPropuestasPendientesProducto(session) {
  var propuestas = state.productoPropuestas || [];
  var esAdmin = !session || session.rol !== "vendedor";
  var visibles = esAdmin ? propuestas : propuestas.filter(function (p) { return p.autor === (session.vendedorNombre || session.email); });
  if (!visibles.length) return "";

  if (!esAdmin) {
    return '<div class="card" style="border-color:var(--warning);"><div class="section-title small">Cambios pendientes de aprobación</div>' +
      '<div class="section-sub">El precio de venta y los movimientos manuales de stock los aprueba el admin — mientras tanto, el producto sigue mostrando el valor anterior. Pendiente' + (visibles.length === 1 ? "" : "s") + ": " +
      visibles.map(function (p) { return esc(p.productoNombre) + " (" + (p.tipo === "campo" ? "precio" : "movimiento de stock") + ")"; }).join(", ") + "</div></div>";
  }

  var html = '<div class="card" style="border-color:var(--warning);"><div class="section-title small">Cambios pendientes de aprobación' +
    renderHelp("Un vendedor propuso un cambio de precio o un movimiento manual de stock. Su cambio NO se aplica hasta que lo apruebes — las bajas de stock por una venta o remisión real nunca pasan por acá, se aplican de inmediato.") +
    "</div>";
  visibles.forEach(function (p) {
    var detalle = p.tipo === "campo"
      ? ("Precio de venta: " + fmtMoney(p.payload.valorAnterior) + " → " + fmtMoney(p.payload.valorNuevo))
      : ((p.payload.tipoMov === "salida" ? "Salida" : "Entrada") + " de " + p.payload.cantidad + " — talla " + esc(p.payload.talla) + (p.payload.nota ? " (" + esc(p.payload.nota) + ")" : ""));
    html += '<div class="tx-row" style="grid-template-columns:1fr 1fr 140px 160px;">' +
      '<span class="mobile-th">Producto</span><span><b>' + esc(p.productoNombre) + "</b></span>" +
      '<span class="mobile-th">Cambio</span><span>' + detalle + "</span>" +
      '<span class="mobile-th">Propuesto por</span><span class="tag" style="background:var(--surface-3);">' + esc(p.autor) + " · " + esc(new Date(p.fecha).toLocaleString("es-CO")) + "</span>" +
      '<span style="display:flex;gap:6px;justify-content:flex-end;">' +
      '<button class="btn success small" data-action="aprobar-propuesta-producto" data-id="' + p.id + '">Aprobar</button>' +
      '<button class="btn danger small" data-action="descartar-propuesta-producto" data-id="' + p.id + '">Descartar</button>' +
      "</span></div>";
  });
  html += "</div>";
  return html;
}

function renderTabsProductos(vista) {
  var total = (state.productos || []).length;
  var labelNueva = state.productoEditando ? "✎ Editando producto" : "+ Nuevo producto";
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nueva" ? "active" : "") + '" data-action="producto-vista" data-val="nueva">' + labelNueva + "</button>" +
    '<button class="gsheet-tab ' + (vista === "catalogo" ? "active" : "") + '" data-action="producto-vista" data-val="catalogo">Catálogo' + (total ? " (" + total + ")" : "") + "</button>" +
    "</div>";
}

// ---------- "+ Nuevo producto": formulario chico, o el detalle completo del
// que se acaba de crear / se abrió desde el Catálogo ----------
function renderEditorProducto() {
  var id = state.productoEditando;
  var producto = id ? (state.productos || []).filter(function (p) { return p.id === id; })[0] : null;
  if (!producto) return renderFormNuevoProducto();
  // "Eliminar" existía como acción pero ningún botón la llamaba: no había
  // forma de sacar un producto del catálogo desde la interfaz.
  var html = '<div class="pedido-actions" style="margin-bottom:10px;">' +
    '<button class="btn ghost small" data-action="cerrar-producto-editor">← Nuevo producto en blanco</button>' +
    '<span class="accion-peligro" style="margin-left:auto;"><button class="btn danger small" data-action="remove-producto" data-id="' + producto.id + '">Eliminar producto</button></span>' +
    "</div>";
  html += renderProductoCard(producto);
  return html;
}

// Solo lo esencial para identificar y vender el producto — el costeo
// (insumos, consumo, flujo) y las tallas/stock se completan después, ya en
// el detalle completo, para no recibir un formulario largo de una vez.
//
// El ORIGEN se decide acá, de entrada, porque no es un campo más: define qué
// clase de producto se está creando. Uno fabricado en el taller se costea con
// insumos y pasa por fases de producción; uno comprado a proveedor solo
// necesita saber a quién se le compra y a cuánto. Elegirlo al final (como
// antes, ya dentro del detalle) obligaba a llenar campos que no aplicaban.
function renderFormNuevoProducto() {
  var f = state.formProducto;
  var esProveedor = f.origen === "proveedor";
  var plantillas = state.plantillasPrendas || [];
  var html = '<div class="card"><div class="section-title small">Nuevo producto' +
    renderHelp("Prendas ya hechas o repetibles (no personalizadas — a lo mucho cambia la talla) que sí conviene tener en stock. Arranca con lo esencial; las tallas con su stock se completan después, ya con el producto creado.") +
    "</div>";

  html += '<div class="cot-col-title" style="margin-top:2px;">¿De dónde sale este producto?' +
    renderHelp("Fabricado en el taller: lo armas tú, se costea con insumos y pasa por fases de producción. Comprado a proveedor: llega hecho, no tiene insumos ni fases — solo su costo de compra, que es de donde sale la ganancia.") +
    "</div>" +
    '<div class="segmented">' +
    '<button class="segmented-opcion ' + (esProveedor ? "" : "active") + '" data-action="set-form-producto-origen" data-val="taller">🧵 Fabricado en el taller</button>' +
    '<button class="segmented-opcion ' + (esProveedor ? "active" : "") + '" data-action="set-form-producto-origen" data-val="proveedor">📦 Comprado a proveedor</button>' +
    "</div>";

  html += '<div class="form-grid" style="margin-top:14px;">' +
    '<div class="field wide"><label>Nombre</label><input data-form="producto" data-field="nombre" value="' + esc(f.nombre) + '" placeholder="Ej. Camiseta básica algodón" /></div>' +
    '<div class="field"><label>Categoría</label><input data-form="producto" data-field="categoria" value="' + esc(f.categoria) + '" placeholder="Ej. Camisetas" /></div>' +
    '<div class="field"><label>Referencia / SKU</label><input data-form="producto" data-field="referencia" value="' + esc(f.referencia) + '" placeholder="Ej. CAM-001" /></div>' +
    '<div class="field"><label>Precio de venta</label><input type="number" data-form="producto" data-field="precioVenta" value="' + esc(f.precioVenta) + '" placeholder="0" /></div>' +
    (esProveedor
      ? ('<div class="field"><label>Costo de compra (por unidad)' + renderHelp("Lo que te cuesta a ti cada unidad. Con el precio de venta de al lado, la ganancia del producto se calcula sola.") + '</label><input type="number" data-form="producto" data-field="costoCompra" value="' + esc(f.costoCompra) + '" placeholder="0" /></div>' +
        renderSelectorProveedorFormulario(f))
      : "") +
    '<button class="btn" data-action="add-producto">Crear producto</button>' +
    "</div>";

  // Las plantillas copian insumos y flujo de producción: no tienen nada que
  // aportarle a un producto que llega hecho del proveedor.
  if (plantillas.length && !esProveedor) {
    html += '<div class="inline-form" style="margin-top:4px;">' +
      '<span class="mini-label">o arrancar copiando los insumos de una plantilla:</span>' +
      '<select class="mini-input" style="max-width:220px" data-action-change="add-producto-desde-plantilla">' +
      '<option value="">Elegir plantilla…</option>' +
      plantillas.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") +
      "</select></div>";
  }
  html += "</div>";
  return html;
}

// Selector de proveedor del formulario de creación (el del detalle ya
// existente es renderSelectorProveedorProducto, que escribe sobre un producto
// que ya existe — este escribe sobre el borrador).
function renderSelectorProveedorFormulario(f) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<div class="field"><label>Proveedor</label><div class="section-sub" style="margin:0;">Sin proveedores registrados — agrégalos en <b>Contactos</b>. Puedes crear el producto igual y asignarlo después.</div></div>';
  }
  return '<div class="field"><label>Proveedor</label><select data-form="producto" data-field="proveedorId">' +
    '<option value="">Elegir proveedor…</option>' +
    proveedores.map(function (pr) { return '<option value="' + pr.id + '" ' + (f.proveedorId === pr.id ? "selected" : "") + ">" + esc(pr.nombre) + "</option>"; }).join("") +
    "</select></div>";
}

// ---------- "Catálogo": índice visual en cards (nunca el detalle completo) ----------
function categoriasUsadas(lista) {
  var vistos = {}; var out = [];
  lista.forEach(function (p) {
    var c = (p.categoria || "").trim();
    if (c && !vistos[c]) { vistos[c] = true; out.push(c); }
  });
  return out.sort(function (a, b) { return a.localeCompare(b); });
}

function renderCatalogoGrid() {
  var lista = state.productos || [];
  if (!lista.length) {
    return '<div class="empty">Aún no tienes productos — creá el primero en la pestaña "+ Nuevo producto".</div>';
  }
  var categorias = categoriasUsadas(lista);
  var activa = state.filtroProductosCategoria || "todos";
  var html = "";
  if (categorias.length) {
    html += '<div class="filters">' +
      '<button class="chip ' + (activa === "todos" ? "active" : "") + '" data-action="filtro-producto-categoria" data-val="todos">Todas</button>' +
      categorias.map(function (c) { return '<button class="chip ' + (activa === c ? "active" : "") + '" data-action="filtro-producto-categoria" data-val="' + esc(c) + '">' + esc(c) + "</button>"; }).join("") +
      '<button class="chip ' + (activa === "sin" ? "active" : "") + '" data-action="filtro-producto-categoria" data-val="sin">Sin categoría</button>' +
      "</div>";
  }
  var filtrados = lista;
  if (activa === "sin") filtrados = lista.filter(function (p) { return !(p.categoria || "").trim(); });
  else if (activa !== "todos") filtrados = lista.filter(function (p) { return (p.categoria || "").trim() === activa; });

  if (!filtrados.length) { html += '<div class="empty">Sin productos en esta categoría.</div>'; return html; }
  html += '<div class="producto-grid">' + filtrados.map(renderProductoCardMini).join("") + "</div>";
  return html;
}

function renderProductoCardMini(p) {
  var stockTotal = stockTotalProducto(p);
  var imgHtml = p.imagenUrl
    ? '<img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />'
    : '<span class="producto-card-mini-noimg">Sin foto</span>';
  var meta = [p.categoria, p.referencia].filter(Boolean).map(esc).join(" · ");
  return '<div class="producto-card-mini" data-action="abrir-producto-editor" data-id="' + p.id + '" title="Clic para abrir y editar">' +
    '<div class="producto-card-mini-img">' + imgHtml + "</div>" +
    '<div class="producto-card-mini-body">' +
    '<div class="producto-card-mini-nombre">' + esc(p.nombre || "Sin nombre") + "</div>" +
    (meta ? '<div class="producto-card-mini-meta">' + meta + "</div>" : "") +
    '<div class="producto-card-mini-footer">' +
    '<span class="amount">' + fmtMoney(p.precioVenta) + "</span>" +
    '<span class="badge ' + (stockTotal > 0 ? "success" : "danger") + '">' + stockTotal + " en stock</span>" +
    "</div></div></div>";
}

// ---------- Detalle completo de un producto puntual ----------
function renderProductoThumb(p) {
  if (state.productoImagenSubiendo[p.id]) {
    return '<span class="ref-thumb ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</span>';
  }
  if (p.imagenUrl) {
    return '<span class="ref-thumb" style="width:64px;height:64px;" data-action="set-pro-imagen" data-id="' + p.id + '" title="Clic para subir otra foto desde tu dispositivo">' +
      '<img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-zoom" data-action="abrir-imagen-preview" data-url="' + esc(p.imagenUrl) + '" title="Ver en grande">🔍</button>' +
      '<button class="ref-thumb-remove" data-action="quitar-pro-imagen" data-id="' + p.id + '" title="Quitar foto">✕</button>' +
      "</span>";
  }
  return '<span class="ref-thumb ref-thumb-empty" style="width:64px;height:64px;" data-action="set-pro-imagen" data-id="' + p.id + '" title="Subir una foto desde tu dispositivo (se guarda en tu Google Drive)">+ foto</span>';
}

function renderProductoCard(p) {
  var stockTotal = stockTotalProducto(p);
  var tallas = p.variantesTalla || [];
  // Costo/ganancia salen del mismo cálculo que usa toda la app (ver
  // calcTotalesProducto en core/calc.js): un producto fabricado suma sus
  // insumos, uno comprado usa su costo de compra — acá no se decide nada.
  var calc = calcTotalesProducto(p);

  var html = '<div class="card" data-producto-id="' + p.id + '">' +
    '<div class="pedido-top" style="align-items:flex-start;">' + renderProductoThumb(p) +
    '<div class="form-grid" style="flex:1;grid-template-columns:2fr 1fr 1fr 1fr 1fr;">' +
    '<div class="field"><label>Nombre</label><input class="mini-input" style="width:100%;font-weight:700;" value="' + esc(p.nombre) + '" placeholder="Ej. Camiseta básica algodón" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="nombre" /></div>' +
    '<div class="field"><label>Categoría</label><input class="mini-input" style="width:100%" value="' + esc(p.categoria || "") + '" placeholder="Ej. Camisetas" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="categoria" /></div>' +
    '<div class="field"><label>Referencia / SKU</label><input class="mini-input" style="width:100%" value="' + esc(p.referencia || "") + '" placeholder="Ej. CAM-001" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="referencia" /></div>' +
    '<div class="field"><label>Precio de venta</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.precioVenta) + '" placeholder="0" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="precioVenta" /></div>' +
    '<div class="field"><label>Origen' + renderHelp("Si es comprado a proveedor, la sección de abajo cambia: en vez de insumos y flujo de producción, solo pide el costo de compra y a quién se le compra.") + '</label><select class="mini-input" style="width:100%" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="origen">' +
    Object.keys(ORIGEN_PRODUCCION).map(function (k) { return opt(k, ORIGEN_PRODUCCION[k], p.origen || "taller"); }).join("") +
    "</select></div>" +
    "</div><button class=\"btn danger small\" data-action=\"remove-producto\" data-id=\"" + p.id + "\">Eliminar producto</button></div>";

  html += '<div class="ref-summary" style="margin-top:14px;">' +
    '<div class="rs-item"><div class="rl">Stock total</div><div class="rv">' + stockTotal + "</div></div>" +
    '<div class="rs-item"><div class="rl">Costo x unidad</div><div class="rv">' + esc(fmtMoney(calc.costoUnit)) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Ganancia x unidad</div><div class="rv" style="color:' + (calc.gananciaUnit >= 0 ? "var(--success)" : "var(--danger)") + ';">' + esc(fmtMoney(calc.gananciaUnit)) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Margen</div><div class="rv"><span class="margen-badge ' + (calc.margenPct >= 0 ? "pos" : "neg") + '">' + calc.margenPct.toFixed(1) + "%</span></div></div>" +
    "</div>";

  html += '<div class="cot-col-title" style="margin-top:18px;">Tallas y stock' +
    renderHelp("El stock de cada talla solo se ajusta desde acá (\"Registrar movimiento\") o automáticamente cuando el producto sale del taller de verdad — al venderlo en un pedido o al entregarlo en una remisión de consignación. Nunca baja solo por cotizarlo.") +
    "</div>";
  if (tallas.length) {
    html += '<div class="detalle-table"><div class="det-row head" style="grid-template-columns:' + TALLA_COLS + ';"><span>Talla</span><span>Stock</span><span></span></div>';
    tallas.forEach(function (t) {
      html += '<div class="det-row" style="grid-template-columns:' + TALLA_COLS + ';">' +
        '<span class="mobile-th">Talla</span><input class="mini-input" value="' + esc(t.talla) + '" data-action-change="set-pro-talla-campo" data-pro="' + p.id + '" data-talla="' + t.id + '" />' +
        '<span class="mobile-th">Stock</span><span class="amount">' + num(t.stock) + "</span>" +
        '<button class="btn danger small" data-action="remove-pro-talla" data-pro="' + p.id + '" data-talla="' + t.id + '">✕</button>' +
        "</div>";
    });
    html += "</div>";
  } else {
    html += '<div class="empty" style="padding:8px 0;">Sin tallas aún — agrega la primera abajo.</div>';
  }
  html += '<div class="inline-form">' +
    '<input class="mini-input" data-role="nueva-talla-' + p.id + '" placeholder="Talla (ej. S, M, Única)" style="width:140px" />' +
    '<button class="btn ghost small" data-action="add-pro-talla" data-id="' + p.id + '">+ Agregar talla</button>' +
    "</div>";

  if (tallas.length) {
    html += '<div class="inline-form" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);flex-wrap:wrap;">' +
      '<select class="mini-input" data-role="stock-talla-' + p.id + '" style="width:110px">' +
      tallas.map(function (t) { return '<option value="' + esc(t.talla) + '">' + esc(t.talla) + "</option>"; }).join("") +
      "</select>" +
      '<select class="mini-input" data-role="stock-tipo-' + p.id + '" style="width:130px">' +
      '<option value="entrada">Entrada (+)</option><option value="salida">Salida / merma (-)</option>' +
      "</select>" +
      '<input type="number" class="mini-input" data-role="stock-cantidad-' + p.id + '" placeholder="Cantidad" style="width:100px" />' +
      '<input class="mini-input" data-role="stock-nota-' + p.id + '" placeholder="Nota (ej. nuevo lote, dañada...)" style="width:220px" />' +
      '<button class="btn ghost small" data-action="add-pro-stock" data-id="' + p.id + '">Registrar movimiento</button>' +
      "</div>";
  }

  html += renderMovimientosStock(p);
  html += '<hr class="stitch" />';
  html += renderCosteoProduccion(p);

  html += "</div>"; // .card
  return html;
}

// Solo cuando el producto es "comprado a proveedor": a cuál Contacto (tipo
// Proveedor) se le compra.
function renderSelectorProveedorProducto(p) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<div class="field"><label>Proveedor</label><div class="section-sub" style="margin:0;">Sin proveedores registrados — agrégalos en Contactos.</div></div>';
  }
  return '<div class="field"><label>Proveedor</label><select class="mini-input" style="width:100%" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="proveedorId">' +
    '<option value="">Elegir proveedor…</option>' +
    proveedores.map(function (pr) { return '<option value="' + pr.id + '" ' + (p.proveedorId === pr.id ? "selected" : "") + '>' + esc(pr.nombre) + "</option>"; }).join("") +
    "</select></div>";
}

// Un producto "comprado a proveedor" no se arma con insumos ni consumo de
// tela (nadie va a cortar y coser algo que ya llega hecho) — lo único que
// hace falta para saber la ganancia es cuánto costó comprarlo. Todo lo demás
// (flujo de producción, insumos, "Insumos predeterminados") es exclusivo de
// un producto fabricado en el taller.
function renderCosteoCompraProveedor(p) {
  var html = '<div class="cot-col-title" style="margin-top:0;">Costeo de compra' +
    renderHelp("De acá sale la ganancia de arriba: precio de venta menos lo que te costó comprarlo. No hay insumos ni flujo de producción porque el producto ya llega hecho del proveedor.") +
    "</div>";
  html += '<div class="form-grid" style="margin-top:10px;">' +
    '<div class="field"><label>Costo de compra (por unidad)</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.costoCompra || "") + '" placeholder="0" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="costoCompra" /></div>' +
    renderSelectorProveedorProducto(p) +
    "</div>";
  return html;
}

// Insumos + consumo + flujo de producción quedan agrupados y colapsados por
// defecto (a menos que ya tenga insumos cargados) — es el detalle "de cómo se
// hace/cuesta", no lo primero que hace falta para poder vender el producto.
function renderCosteoProduccion(p) {
  if (p.origen === "proveedor") return renderCosteoCompraProveedor(p);

  var flujos = state.plantillasEstados || [];
  var insumos = p.insumos || [];
  var abierta = p.seccionCosteoAbierta !== undefined ? !!p.seccionCosteoAbierta : insumos.length > 0;
  var titulo = "Costeo y producción" + (insumos.length ? " · " + insumos.length + (insumos.length === 1 ? " insumo" : " insumos") : "");
  var html = '<div class="cot-col-title" style="cursor:pointer;" data-action="toggle-producto-costeo" data-id="' + p.id + '">' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (abierta ? "▾" : "▸") + "</button> " + titulo +
    renderHelp("Insumos, consumo de tela y flujo de producción — de acá sale el costo/ganancia de arriba. No hace falta llenarlo para poder vender el producto ya mismo.") +
    "</div>";
  if (!abierta) return html;

  html += '<div class="form-grid" style="margin-top:10px;">' +
    '<div class="field"><label>Consumo de tela sugerido (MT)</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.consumoSugerido || "") + '" placeholder="Ej. 1.2" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="consumoSugerido" /></div>' +
    '<div class="field"><label>Flujo de producción</label><select class="mini-input" style="width:100%" data-action-change="set-pro-campo" data-id="' + p.id + '" data-campo="flujoEstadosId">' +
    '<option value="">Estándar</option>' +
    flujos.map(function (f) { return '<option value="' + f.id + '" ' + (p.flujoEstadosId === f.id ? "selected" : "") + '>' + esc(f.nombre) + " (" + f.estados.length + " etapas)</option>"; }).join("") +
    "</select></div>" +
    "</div>";

  html += '<div class="ins-table" style="margin-top:10px;"><div class="ins-row head" style="grid-template-columns:' + INS_COLS + ';"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant./mult.</span><span></span></div>';
  insumos.forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:' + INS_COLS + ';">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" value="' + esc(i.unidad) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<span class="mobile-th">Cant./mult.</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-pro-ins-campo" data-pro="' + p.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<button class="btn danger small" data-action="remove-pro-insumo" data-pro="' + p.id + '" data-ins="' + i.id + '">✕</button>' +
      "</div>";
  });
  if (!insumos.length) { html += '<div class="empty" style="padding:12px 0;">Sin insumos en este producto.</div>'; }
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
    '<button class="btn ghost small" data-action="abrir-insumo-picker-producto" data-pro="' + p.id + '">📂 Insumos predeterminados…</button>' +
    '<button class="btn ghost small" data-action="add-pro-insumo-custom" data-pro="' + p.id + '">+ Insumo personalizado</button>' +
    "</div>";
  return html;
}

// Mismo patrón de "ventana tipo explorador" que el selector de insumos en
// Cotizaciones (categorías a la izquierda, búsqueda arriba, selección
// múltiple con checkbox) — antes acá era un <select> plano que, con decenas
// de insumos, obligaba a leer una lista larga sin poder filtrar ni ver el
// costo antes de elegir.
function renderInsumoPickerProducto() {
  var proId = state.productoInsumoPickerAbierto;
  if (!proId) return "";
  var categorias = state.catalogoCategorias || [];
  var lista = state.catalogoInsumos || [];
  var catActiva = state.productoInsumoPickerCategoria || "todos";
  var q = norm(state.productoInsumoPickerBusqueda || "").trim();
  var seleccion = state.productoInsumoPickerSeleccion || [];

  function enCategoria(i, catId) {
    if (catId === "todos") return true;
    if (catId === "sin") return !i.categoriaId || !categorias.some(function (c) { return c.id === i.categoriaId; });
    return i.categoriaId === catId;
  }
  function cuenta(catId) {
    return lista.filter(function (i) { return enCategoria(i, catId) && (!q || norm(i.nombre).indexOf(q) >= 0); }).length;
  }
  var visibles = lista.filter(function (i) {
    return enCategoria(i, catActiva) && (!q || norm(i.nombre).indexOf(q) >= 0 || norm(i.unidad || "").indexOf(q) >= 0);
  });

  var itemsCat = [{ id: "todos", nombre: "Todos los insumos" }]
    .concat(categorias.map(function (c) { return { id: c.id, nombre: c.nombre }; }))
    .concat([{ id: "sin", nombre: "Sin categoría" }]);

  var html = '<div class="picker-overlay" data-action="cerrar-insumo-picker-producto">' +
    '<div class="picker-modal" data-action="picker-stop">' +
    '<div class="picker-head">' +
    '<div class="section-title small" style="margin:0;">Insumos predeterminados</div>' +
    '<button class="imgprev-close" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="cerrar-insumo-picker-producto" aria-label="Cerrar">✕</button>' +
    "</div>" +
    '<div class="picker-search"><input id="inp-insumo-picker-producto-buscar" class="mini-input" style="width:100%" placeholder="Buscar insumo por nombre o unidad…" value="' + esc(state.productoInsumoPickerBusqueda || "") + '" data-live-filter="productoInsumoPickerBusqueda" /></div>' +
    '<div class="picker-body">' +
    '<div class="picker-side">' +
    itemsCat.map(function (c) {
      var n = cuenta(c.id);
      return '<button class="picker-cat ' + (catActiva === c.id ? "active" : "") + '" data-action="set-insumo-picker-producto-categoria" data-val="' + esc(c.id) + '">' +
        "<span>" + esc(c.nombre) + '</span><span class="picker-cat-n">' + n + "</span></button>";
    }).join("") +
    "</div>" +
    '<div class="picker-list">';

  if (!lista.length) {
    html += '<div class="empty">Tu catálogo de insumos está vacío. Agrégalos en la pestaña <b>Catálogo</b> para poder reutilizarlos acá.</div>';
  } else if (!visibles.length) {
    html += '<div class="empty">Sin coincidencias' + (q ? ' para "' + esc(state.productoInsumoPickerBusqueda) + '"' : "") + ".</div>";
  } else {
    visibles.forEach(function (i) {
      var marcado = seleccion.indexOf(i.id) !== -1;
      html += '<label class="picker-item ' + (marcado ? "sel" : "") + '">' +
        '<input type="checkbox" data-action="toggle-insumo-picker-producto-item" data-id="' + i.id + '" ' + (marcado ? "checked" : "") + " />" +
        '<span class="picker-item-info"><b>' + esc(i.nombre) + "</b><small>" + esc(i.unidad || "UND") + " · " + esc((TIPOS_COSTO[i.tipo] || {}).label || i.tipo || "") + "</small></span>" +
        '<span class="amount">' + fmtMoney(i.costo) + "</span>" +
        "</label>";
    });
  }

  html += "</div></div>" +
    '<div class="picker-foot">' +
    '<span class="section-sub" style="margin:0;">' + (seleccion.length ? seleccion.length + (seleccion.length === 1 ? " insumo seleccionado" : " insumos seleccionados") : "Marca los insumos que quieras agregar") + "</span>" +
    '<span style="display:flex;gap:8px;">' +
    '<button class="btn ghost small" data-action="cerrar-insumo-picker-producto">Cancelar</button>' +
    '<button class="btn" ' + (seleccion.length ? "" : "disabled") + ' data-action="confirmar-insumo-picker-producto" data-pro="' + proId + '">Agregar' + (seleccion.length ? " (" + seleccion.length + ")" : "") + "</button>" +
    "</span></div>" +
    "</div></div>";
  return html;
}

// Bitácora de entradas/salidas de stock — colapsada por defecto (puede
// crecer bastante con el tiempo), un clic la despliega completa.
function renderMovimientosStock(p) {
  var movimientos = p.movimientosStock || [];
  var abierto = state.productoMovimientosAbierto === p.id;
  var html = '<div class="section-sub" style="margin:10px 0 0;cursor:pointer;" data-action="toggle-pro-movimientos" data-id="' + p.id + '">' +
    (abierto ? "▾" : "▸") + " Movimientos de stock (" + movimientos.length + ")" +
    "</div>";
  if (!abierto || !movimientos.length) return html;
  html += '<div class="tx-row head" style="grid-template-columns:' + MOV_COLS + ';"><span>Fecha</span><span>Tipo</span><span>Talla</span><span>Cantidad</span><span>Nota</span></div>';
  movimientos.forEach(function (m) {
    html += '<div class="tx-row" style="grid-template-columns:' + MOV_COLS + ';">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(m.fecha) + "</span>" +
      '<span class="mobile-th">Tipo</span><span class="amount ' + (m.tipo === "entrada" ? "pos" : "neg") + '">' + (m.tipo === "entrada" ? "+" : "-") + "</span>" +
      '<span class="mobile-th">Talla</span><span>' + esc(m.talla) + "</span>" +
      '<span class="mobile-th">Cantidad</span><span>' + esc(m.cantidad) + "</span>" +
      '<span class="mobile-th">Nota</span><span style="color:var(--ink-soft);">' + esc(m.nota || (m.origen ? "Automático — " + m.origen : "—")) + "</span>" +
      "</div>";
  });
  return html;
}

function fmtMoney(n) { return "$" + Math.round(num(n)).toLocaleString("es-CO"); }

export var actions = {
  "producto-vista": function (el) {
    state.productosVista = el.getAttribute("data-val");
    notify();
  },
  "abrir-producto-editor": function (el) {
    state.productoEditando = el.getAttribute("data-id");
    state.productosVista = "nueva";
    notify();
  },
  "cerrar-producto-editor": function () {
    state.productoEditando = "";
    notify();
  },
  "filtro-producto-categoria": function (el) {
    state.filtroProductosCategoria = el.getAttribute("data-val");
    notify();
  },
  // El origen decide qué clase de producto se crea, así que se elige antes
  // que nada — cambiarlo reescribe los campos del formulario (ver
  // renderFormNuevoProducto).
  "set-form-producto-origen": function (el) {
    state.formProducto.origen = el.getAttribute("data-val") === "proveedor" ? "proveedor" : "taller";
    if (state.formProducto.origen === "taller") { state.formProducto.proveedorId = ""; state.formProducto.costoCompra = ""; }
    notify();
  },
  "add-producto": function () {
    var f = state.formProducto;
    if (!exigirCampos([["Nombre", f.nombre]])) return;
    var nuevo = Object.assign(nuevoProducto(), {
      nombre: f.nombre, categoria: f.categoria, referencia: f.referencia, precioVenta: num(f.precioVenta),
      origen: f.origen === "proveedor" ? "proveedor" : "taller",
      proveedorId: f.origen === "proveedor" ? (f.proveedorId || "") : "",
      costoCompra: f.origen === "proveedor" ? num(f.costoCompra) : 0
    });
    state.productos = (state.productos || []).concat([nuevo]);
    state.productoEditando = nuevo.id;
    state.formProducto = { nombre: "", categoria: "", referencia: "", precioVenta: "", origen: "taller", proveedorId: "", costoCompra: "" };
    persist("productos"); notify();
  },
  "add-producto-desde-plantilla": function (el) {
    if (!el.value) return;
    var pla = (state.plantillasPrendas || []).filter(function (pl) { return pl.id === el.value; })[0];
    if (!pla) return;
    var nuevo = Object.assign(nuevoProducto(), {
      nombre: pla.nombre, imagenUrl: pla.imagenUrl || "", consumoSugerido: pla.consumoSugerido || "",
      flujoEstadosId: pla.flujoEstadosId || "",
      insumos: (pla.insumos || []).map(function (i) { return Object.assign({}, i, { id: uid() }); })
    });
    state.productos = (state.productos || []).concat([nuevo]);
    state.productoEditando = nuevo.id;
    persist("productos"); notify();
  },
  "remove-producto": function (el) {
    var id = el.getAttribute("data-id");
    var p = (state.productos || []).filter(function (p) { return p.id === id; })[0];
    if (!p) return;
    var stockTotal = stockTotalProducto(p);
    if (!window.confirm('¿Eliminar "' + p.nombre + '"?' + (stockTotal > 0 ? "\n\nTodavía tiene " + stockTotal + " unidades en stock — se pierde ese registro." : "") + "\n\nNo afecta pedidos o cotizaciones donde ya se haya aplicado.")) return;
    state.productos = (state.productos || []).filter(function (p) { return p.id !== id; });
    if (state.productoEditando === id) state.productoEditando = "";
    persist("productos"); notify();
  },
  // El precio de venta es el único campo del producto que un vendedor no
  // puede cambiar directo — igual que el precio de un insumo, queda como
  // propuesta a la espera de que el admin la apruebe (ver core/stock.js).
  // El resto de los campos (nombre, categoría, referencia, consumo, flujo)
  // se quedan editables directo: no son tan sensibles para la plata del taller.
  "set-pro-campo": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    var numerico = campo === "consumoSugerido" || campo === "precioVenta" || campo === "costoCompra";
    var valor = numerico ? num(el.value) : el.value;
    var session = getSession();
    if (campo === "precioVenta" && session && session.rol === "vendedor") {
      var producto = (state.productos || []).filter(function (p) { return p.id === id; })[0];
      if (!producto || num(producto.precioVenta) === valor) { notify(); return; }
      proponerCambioProducto(producto, "campo", { campo: "precioVenta", valorAnterior: num(producto.precioVenta), valorNuevo: valor }, session);
      window.alert("El cambio de precio queda pendiente de aprobación del admin — no se aplica todavía.");
      notify();
      return;
    }
    mapPro(id, function (p) {
      var patch = {}; patch[campo] = valor;
      return Object.assign({}, p, patch);
    });
  },
  "set-pro-imagen": function (el) {
    var id = el.getAttribute("data-id");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.productoImagenSubiendo = Object.assign({}, state.productoImagenSubiendo, { [id]: true });
      notify();
      try {
        var url = await subirImagenReferencia(file);
        state.productoImagenSubiendo = Object.assign({}, state.productoImagenSubiendo); delete state.productoImagenSubiendo[id];
        mapPro(id, function (p) { return Object.assign({}, p, { imagenUrl: url }); });
      } catch (e) {
        state.productoImagenSubiendo = Object.assign({}, state.productoImagenSubiendo); delete state.productoImagenSubiendo[id];
        window.alert("No se pudo subir la imagen a Drive: " + (e && e.message ? e.message : e));
        notify();
      }
    });
    input.click();
  },
  "quitar-pro-imagen": function (el) {
    var id = el.getAttribute("data-id");
    mapPro(id, function (p) { return Object.assign({}, p, { imagenUrl: "" }); });
  },
  "toggle-producto-costeo": function (el) {
    var id = el.getAttribute("data-id");
    mapPro(id, function (p) {
      var abierta = p.seccionCosteoAbierta !== undefined ? !!p.seccionCosteoAbierta : (p.insumos || []).length > 0;
      return Object.assign({}, p, { seccionCosteoAbierta: !abierta });
    });
  },
  "add-pro-insumo-custom": function (el) {
    var id = el.getAttribute("data-pro");
    mapPro(id, function (p) {
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: "Nuevo insumo", unidad: "UND", costo: 0, tipo: "por_prenda", cantidad: 1 }]) });
    });
  },
  "abrir-insumo-picker-producto": function (el) {
    state.productoInsumoPickerAbierto = el.getAttribute("data-pro");
    state.productoInsumoPickerCategoria = "todos";
    state.productoInsumoPickerBusqueda = "";
    state.productoInsumoPickerSeleccion = [];
    notify();
  },
  "cerrar-insumo-picker-producto": function () {
    state.productoInsumoPickerAbierto = "";
    notify();
  },
  "set-insumo-picker-producto-categoria": function (el) {
    state.productoInsumoPickerCategoria = el.getAttribute("data-val");
    notify();
  },
  "toggle-insumo-picker-producto-item": function (el) {
    var id = el.getAttribute("data-id");
    var seleccion = state.productoInsumoPickerSeleccion || [];
    state.productoInsumoPickerSeleccion = seleccion.indexOf(id) === -1 ? seleccion.concat([id]) : seleccion.filter(function (s) { return s !== id; });
    notify();
  },
  "confirmar-insumo-picker-producto": function (el) {
    var id = el.getAttribute("data-pro");
    var seleccion = state.productoInsumoPickerSeleccion || [];
    var items = (state.catalogoInsumos || []).filter(function (i) { return seleccion.indexOf(i.id) !== -1; });
    if (items.length) {
      mapPro(id, function (p) {
        var nuevos = items.map(function (item) { return { id: uid(), nombre: item.nombre, unidad: item.unidad, costo: num(item.costo), tipo: item.tipo, cantidad: 1 }; });
        return Object.assign({}, p, { insumos: (p.insumos || []).concat(nuevos) });
      });
    }
    state.productoInsumoPickerAbierto = "";
    notify();
  },
  "remove-pro-insumo": function (el) {
    var id = el.getAttribute("data-pro"), insId = el.getAttribute("data-ins");
    mapPro(id, function (p) { return Object.assign({}, p, { insumos: (p.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  "set-pro-ins-campo": function (el) {
    var id = el.getAttribute("data-pro"), insId = el.getAttribute("data-ins"), campo = el.getAttribute("data-campo");
    var numerico = campo === "costo" || campo === "cantidad";
    mapPro(id, function (p) {
      var insumos = (p.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, p, { insumos: insumos });
    });
  },
  "add-pro-talla": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest("[data-producto-id]");
    var nombre = val(card, "nueva-talla-" + id);
    if (!nombre) return;
    mapPro(id, function (p) {
      if ((p.variantesTalla || []).some(function (t) { return t.talla.toLowerCase() === nombre.toLowerCase(); })) {
        window.alert('Ya existe la talla "' + nombre + '".'); return p;
      }
      return Object.assign({}, p, { variantesTalla: (p.variantesTalla || []).concat([{ id: uid(), talla: nombre, stock: 0 }]) });
    });
  },
  "remove-pro-talla": function (el) {
    var id = el.getAttribute("data-pro"), tallaId = el.getAttribute("data-talla");
    var producto = (state.productos || []).filter(function (p) { return p.id === id; })[0];
    var t = producto ? (producto.variantesTalla || []).filter(function (t) { return t.id === tallaId; })[0] : null;
    if (t && num(t.stock) > 0 && !window.confirm('La talla "' + t.talla + '" todavía tiene ' + t.stock + ' en stock. ¿Eliminarla igual?')) return;
    mapPro(id, function (p) { return Object.assign({}, p, { variantesTalla: (p.variantesTalla || []).filter(function (t) { return t.id !== tallaId; }) }); });
  },
  // Renombrar una talla no es un cambio cosmético: los pedidos, remisiones y
  // consignaciones guardan la talla por su NOMBRE, y por ahí es que se
  // devuelve el stock si un pedido se elimina o se restaura. Con el nombre
  // cambiado esa devolución no encuentra a dónde volver y se pierde en
  // silencio. Se avisa cuando ya hay historial detrás de esa talla; con una
  // talla recién creada (sin stock ni movimientos) no molesta.
  "set-pro-talla-campo": function (el) {
    var id = el.getAttribute("data-pro"), tallaId = el.getAttribute("data-talla");
    var producto = (state.productos || []).filter(function (p) { return p.id === id; })[0];
    var variante = producto ? (producto.variantesTalla || []).filter(function (t) { return t.id === tallaId; })[0] : null;
    if (!variante) return;
    var nombreNuevo = el.value;
    var tieneHistorial = num(variante.stock) > 0 ||
      (producto.movimientosStock || []).some(function (m) { return m.talla === variante.talla; });
    if (tieneHistorial && nombreNuevo !== variante.talla) {
      if (!window.confirm('¿Renombrar la talla "' + variante.talla + '" a "' + nombreNuevo + '"?\n\n' +
        "Los pedidos y remisiones que ya salieron con la talla \"" + variante.talla + "\" la tienen guardada con ese nombre: si alguno se elimina o se restaura, su stock ya no va a saber a qué talla volver.\n\n" +
        "Si lo que quieres es una talla distinta, es más seguro crearla aparte.")) {
        notify(); // repinta para que el input vuelva a mostrar el nombre real
        return;
      }
    }
    mapPro(id, function (p) {
      var variantes = (p.variantesTalla || []).map(function (t) { return t.id === tallaId ? Object.assign({}, t, { talla: nombreNuevo }) : t; });
      return Object.assign({}, p, { variantesTalla: variantes });
    });
  },
  // Un movimiento MANUAL de stock (esta acción) hecho por un vendedor queda
  // pendiente de aprobación — a diferencia de una baja automática por una
  // venta o remisión real (esas se aplican siempre de inmediato, en
  // add-pedido/confirmar-remision/descontarStockPorTallas: no pasan por acá).
  "add-pro-stock": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest("[data-producto-id]");
    var talla = val(card, "stock-talla-" + id);
    var tipo = val(card, "stock-tipo-" + id) || "entrada";
    var cantidad = num(val(card, "stock-cantidad-" + id));
    var nota = val(card, "stock-nota-" + id);
    if (!talla || cantidad <= 0) return;
    var session = getSession();
    if (session && session.rol === "vendedor") {
      var producto = (state.productos || []).filter(function (p) { return p.id === id; })[0];
      if (!producto) return;
      proponerCambioProducto(producto, "movimiento", { talla: talla, cantidad: cantidad, tipoMov: tipo, nota: nota }, session);
      window.alert("El movimiento de stock queda pendiente de aprobación del admin — el stock no cambia todavía.");
      notify();
      return;
    }
    var delta = tipo === "salida" ? -cantidad : cantidad;
    var aplicado = ajustarStockProducto(id, talla, delta, nota, "");
    // ajustarStockProducto nunca deja bajar de 0: si se pidió una salida
    // mayor a lo disponible, avisa cuánto quedó realmente registrado en vez
    // de fallar en silencio (para que la bitácora nunca mienta).
    if (tipo === "salida" && Math.abs(aplicado) < cantidad) {
      window.alert("Solo había " + Math.abs(aplicado) + " en stock de la talla " + talla + " — se registró esa salida, no las " + cantidad + " pedidas.");
    }
    notify();
  },
  "toggle-pro-movimientos": function (el) {
    var id = el.getAttribute("data-id");
    state.productoMovimientosAbierto = state.productoMovimientosAbierto === id ? "" : id;
    notify();
  },
  "aprobar-propuesta-producto": function (el) {
    aprobarPropuestaProducto(el.getAttribute("data-id"));
    notify();
  },
  "descartar-propuesta-producto": function (el) {
    if (!window.confirm("¿Descartar esta propuesta? El producto no cambia.")) return;
    descartarPropuestaProducto(el.getAttribute("data-id"));
    notify();
  }
};

function nuevoProducto() {
  return { id: uid(), nombre: "Nuevo producto", categoria: "", referencia: "", imagenUrl: "", consumoSugerido: "", flujoEstadosId: "", insumos: [], precioVenta: 0, variantesTalla: [], movimientosStock: [], origen: "taller", proveedorId: "", costoCompra: 0 };
}

function mapPro(id, transform) {
  state.productos = (state.productos || []).map(function (p) { return p.id === id ? transform(p) : p; });
  persist("productos"); notify();
}
