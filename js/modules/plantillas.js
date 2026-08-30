// Pestaña Plantillas — maestro/detalle, el MISMO patrón que ya usa el catálogo
// de Productos (js/modules/productos.js): un índice visual en tarjetas y el
// detalle completo de UNA sola a la vez.
//
// Qué pasaba antes (y por qué se rehízo): esta pestaña dibujaba TODAS las
// plantillas siempre desplegadas, cada una con su tabla de insumos editable, y
// encima de ellas —primero en la página— los "Flujos de producción", que son
// configuración ocasional y no el contenido principal. Sin índice, sin
// buscador, sin categorías y sin forma de duplicar una plantilla, con 40
// plantillas y sus variaciones (que es a donde va esto) la pestaña era una
// sola lista infinita imposible de recorrer.
//
// Ahora son dos entidades separadas por el control segmentado compartido
// (plantillas primero, flujos después), y las plantillas tienen índice con
// foto, buscador, chips por categoría y "duplicar" — que es el gesto natural
// para armar una variación de algo que ya existe.
import { state, persist, notify } from "../core/store.js";
import { esc, fmt, num, uid, val, norm } from "../core/utils.js";
import { renderTipoCostoOptions, renderHelp, renderBuscador, renderTarjetaMini } from "../core/components.js";
import { subirImagenReferencia } from "../core/drive.js";
import { calcCostoUnitarioRef, esInsumoServicio } from "../core/calc.js";

var INS_COLS = "1fr 60px 90px 150px 70px 30px";

var AYUDA_PLANTILLAS = "Define de una vez los insumos típicos de cada tipo de prenda (t-shirt básica, polo, manga ranglán…) y aplícalos a cualquier referencia de una cotización con un clic. Si le asignas un \"Flujo de producción\" (ej. uno que incluya la etapa de sublimación), ese flujo de etapas se carga automáticamente junto con los insumos.";

export function render() {
  var vista = state.plantillasVista === "flujos" ? "flujos" : "plantillas";
  var html = renderTabsPlantillas(vista);
  if (vista === "flujos") return html + renderFlujosEstados();
  var abierta = plantillaAbierta();
  html += abierta ? renderDetallePlantilla(abierta) : renderIndicePlantillas();
  return html;
}

// Las dos vistas llevan su conteo en la propia pestaña: sin él no hay forma de
// saber cuántos flujos hay guardados sin entrar a mirar.
function renderTabsPlantillas(vista) {
  var nPla = (state.plantillasPrendas || []).length;
  var nFlu = (state.plantillasEstados || []).length;
  return '<div class="segmented pla-tabs">' +
    '<button class="segmented-opcion ' + (vista === "plantillas" ? "active" : "") + '" data-action="plantillas-vista" data-val="plantillas">Plantillas de prendas (' + nPla + ")</button>" +
    '<button class="segmented-opcion ' + (vista === "flujos" ? "active" : "") + '" data-action="plantillas-vista" data-val="flujos">Flujos de producción (' + nFlu + ")</button>" +
    "</div>";
}

function plantillaAbierta() {
  var id = state.plantillaEditando;
  if (!id) return null;
  return (state.plantillasPrendas || []).filter(function (p) { return p.id === id; })[0] || null;
}

// ---------------------------------------------------------------------------
// Costo estimado por prenda
// ---------------------------------------------------------------------------
// NO se calcula a mano acá. Se le pide a la misma función que costea una
// referencia de cotización y un producto del catálogo (calcCostoUnitarioRef),
// armando una referencia sintética — exactamente como hace calcTotalesProducto
// en core/calc.js. Una fórmula por concepto: si mañana cambia cómo pesa la
// tela o un insumo fijo, cambia en un solo lugar y estas tarjetas lo heredan.
//
// cantidadPedida: 1 porque una plantilla no tiene cantidad — es el costo de
// UNA prenda. Por eso un insumo de tipo "fijo por pedido" entra completo (se
// divide entre 1); en una cotización real, repartido entre 20 prendas, va a
// pesar mucho menos. Está dicho en el "?" de la cifra para que nadie lea de
// más en este número.
function costoPorPrenda(p) {
  return calcCostoUnitarioRef({
    origen: "taller",
    insumos: p.insumos || [],
    consumoAprox: p.consumoSugerido,
    cantidadPedida: 1
  });
}

// ---------------------------------------------------------------------------
// Vista de índice: tarjetas con vista previa
// ---------------------------------------------------------------------------
function categoriaDe(p) { return (p.categoria || "").trim(); }

function categoriasUsadas(lista) {
  var vistos = {}; var out = [];
  lista.forEach(function (p) {
    var c = categoriaDe(p);
    if (c && !vistos[c]) { vistos[c] = true; out.push(c); }
  });
  return out.sort(function (a, b) { return a.localeCompare(b); });
}

function coincidePlantilla(p, q) {
  if (!q) return true;
  return norm(p.nombre || "").indexOf(q) >= 0 || norm(categoriaDe(p)).indexOf(q) >= 0;
}

function enCategoria(p, cat) {
  if (cat === "todos") return true;
  if (cat === "sin") return !categoriaDe(p);
  return categoriaDe(p) === cat;
}

function renderIndicePlantillas() {
  var lista = state.plantillasPrendas || [];
  var q = norm(state.buscarPlantillas || "").trim();
  var buscadas = lista.filter(function (p) { return coincidePlantilla(p, q); });
  var categorias = categoriasUsadas(lista);
  // Un filtro guardado de antes puede apuntar a una categoría que ya no existe
  // (se renombró, o se borró la última plantilla que la usaba). Sin esta
  // comprobación el índice se veía vacío sin ningún chip encendido que
  // explicara por qué.
  // Se corrige EN EL ESTADO, no solo en una variable local: como acá las
  // categorías son texto libre y se comparan por nombre, dejar el valor muerto
  // guardado hacía que el filtro resucitara solo — bastaba con que alguien
  // volviera a escribir ese nombre en otra plantilla para que el índice se
  // colapsara sin que nadie hubiera tocado ningún filtro.
  var activa = state.filtroPlantillaCategoria || "todos";
  if (!categorias.length || (activa !== "todos" && activa !== "sin" && categorias.indexOf(activa) === -1)) {
    activa = "todos";
  }
  if (state.filtroPlantillaCategoria !== activa) state.filtroPlantillaCategoria = activa;
  var visibles = buscadas.filter(function (p) { return enCategoria(p, activa); });

  var html = '<div class="card"><div class="section-title small">Plantillas de prendas' + renderHelp(AYUDA_PLANTILLAS) + "</div>" +
    '<div class="pla-barra">' +
    '<div class="pla-barra-buscar">' +
    renderBuscador({
      id: "inp-buscar-plantillas",
      filtro: "buscarPlantillas",
      valor: state.buscarPlantillas,
      placeholder: "Buscar plantilla por nombre o categoría…",
      ancho: "full",
      // `total` es lo que el chip de categoría deja pasar, no el catálogo
      // entero: si no, el conteo prometía plantillas que el chip ya descartó.
      conteo: { visibles: visibles.length, total: lista.filter(function (p) { return enCategoria(p, activa); }).length, singular: "plantilla", plural: "plantillas" }
    }) +
    "</div>" +
    '<button class="btn" data-action="add-plantilla">+ Nueva plantilla</button>' +
    "</div>" +
    renderChipsCategorias(categorias, buscadas, activa) +
    "</div>";

  if (!lista.length) {
    html += '<div class="empty">Todavía no tienes plantillas. Crea la primera con "+ Nueva plantilla" — se abre lista para ponerle nombre.</div>';
    return html;
  }
  if (!visibles.length) {
    html += '<div class="empty">Ninguna plantilla coincide' + (q ? ' con "' + esc(state.buscarPlantillas) + '"' : "") + (activa !== "todos" ? " en este filtro" : "") + ".</div>";
    return html;
  }
  html += '<div class="tarjeta-grid">' + visibles.map(renderPlantillaMini).join("") + "</div>";
  return html;
}

// Cada chip dice cuántas plantillas tiene (mismo patrón que el Catálogo de
// insumos): sin ese número hay que entrar a cada categoría para descubrir que
// está vacía. El conteo respeta la búsqueda activa, para que no prometa
// resultados que el buscador ya descartó.
function renderChipsCategorias(categorias, buscadas, activa) {
  if (!categorias.length) return "";
  var html = '<div class="filters pla-filtros">' + chipCategoria("todos", "Todas", buscadas.length, activa);
  categorias.forEach(function (c) {
    var n = buscadas.filter(function (p) { return categoriaDe(p) === c; }).length;
    html += chipCategoria(c, c, n, activa);
  });
  var sinN = buscadas.filter(function (p) { return !categoriaDe(p); }).length;
  // El chip "Sin categoría" solo estorba cuando todas tienen una — salvo que
  // sea justo el filtro activo: esconderlo ahí dejaría el índice en cero sin
  // ningún chip encendido que dijera por qué.
  if (sinN || activa === "sin") html += chipCategoria("sin", "Sin categoría", sinN, activa);
  return html + "</div>";
}

function chipCategoria(valor, label, n, activa) {
  return '<button class="chip ' + (activa === valor ? "active" : "") + '" data-action="filtro-plantilla-categoria" data-val="' + esc(valor) + '">' +
    esc(label) + ' <span class="chip-n">' + n + "</span></button>";
}

function renderPlantillaMini(p) {
  var n = (p.insumos || []).length;
  var consumo = num(p.consumoSugerido);
  return renderTarjetaMini({
    id: p.id,
    accion: "abrir-plantilla",
    imagenUrl: p.imagenUrl,
    nombre: p.nombre,
    meta: [categoriaDe(p) || "Sin categoría", consumo ? consumo + " MT de tela" : ""].filter(Boolean).join(" · "),
    activa: state.plantillaEditando === p.id,
    titulo: "Clic para abrir esta plantilla",
    pie: [
      '<span class="amount">' + esc(fmt(costoPorPrenda(p))) + "</span>",
      n ? '<span class="badge info">' + n + (n === 1 ? " insumo" : " insumos") + "</span>"
        : '<span class="badge warning">sin insumos</span>'
    ]
  });
}

// ---------------------------------------------------------------------------
// Detalle: UNA plantilla, con todo su formulario
// ---------------------------------------------------------------------------
function renderDetallePlantilla(p) {
  var html = '<div class="pla-detalle-top">' +
    '<button class="btn ghost small" data-action="cerrar-plantilla-detalle">← Volver al índice</button>' +
    '<button class="btn ghost small" data-action="duplicar-plantilla" data-id="' + p.id + '" title="Crear una variación: copia insumos, flujo, foto y consumo">⧉ Duplicar</button>' +
    '<span class="pla-peligro"><button class="btn danger small" data-action="remove-plantilla" data-id="' + p.id + '">Eliminar plantilla</button></span>' +
    "</div>";
  html += renderPlantillaCard(p);
  return html;
}

function renderPlantillaThumb(p) {
  if (state.plantillaImagenSubiendo[p.id]) {
    return '<span class="ref-thumb ref-thumb-empty" title="Subiendo a Drive…">Subiendo…</span>';
  }
  if (p.imagenUrl) {
    return '<span class="ref-thumb" style="width:64px;height:64px;" data-action="set-pla-imagen" data-id="' + p.id + '" title="Clic para subir otra foto desde tu dispositivo">' +
      '<img src="' + esc(p.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />' +
      '<button class="ref-thumb-zoom" data-action="abrir-imagen-preview" data-url="' + esc(p.imagenUrl) + '" title="Ver en grande">🔍</button>' +
      '<button class="ref-thumb-remove" data-action="quitar-pla-imagen" data-id="' + p.id + '" title="Quitar foto">✕</button>' +
      "</span>";
  }
  return '<span class="ref-thumb ref-thumb-empty" style="width:64px;height:64px;" data-action="set-pla-imagen" data-id="' + p.id + '" title="Subir una foto desde tu dispositivo (se guarda en tu Google Drive)">+ foto</span>';
}

function renderPlantillaCard(p) {
  var insumos = p.insumos || [];
  // El input del nombre lleva id estable a propósito: el render reemplaza el
  // innerHTML entero y el foco solo se restaura a elementos CON id — es lo que
  // permite que "+ Nueva plantilla" y "Duplicar" dejen el cursor acá listo
  // para escribir (ver enfocarNombrePlantilla).
  var html = '<div class="card" data-plantilla-id="' + p.id + '">' +
    '<div class="pedido-top" style="align-items:flex-start;">' + renderPlantillaThumb(p) +
    '<div class="form-grid" style="flex:1;grid-template-columns:2fr 1fr 1fr;">' +
    '<div class="field"><label>Nombre de la plantilla</label><input id="pla-nombre-' + p.id + '" class="mini-input" style="width:100%;font-weight:700;" value="' + esc(p.nombre) + '" placeholder="Ej. T-shirt básica" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="nombre" /></div>' +
    '<div class="field"><label>Categoría' + renderHelp("Texto libre (ej. Camisetas, Polos, Deportivo). Sirve para agrupar y filtrar el índice cuando ya tengas muchas plantillas y sus variaciones. Puedes dejarla vacía.") + '</label><input class="mini-input" style="width:100%" value="' + esc(p.categoria || "") + '" placeholder="Ej. Camisetas" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="categoria" /></div>' +
    '<div class="field"><label>Consumo de tela sugerido (MT)</label><input type="number" class="mini-input" style="width:100%" value="' + esc(p.consumoSugerido || "") + '" placeholder="Ej. 1.2" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="consumoSugerido" /></div>' +
    "</div></div>";

  html += '<div class="ref-summary">' +
    '<div class="rs-item"><div class="rl">Costo estimado x prenda' +
    renderHelp("Sale del mismo cálculo que usa una referencia de cotización: los insumos por prenda, más la tela por el consumo de arriba. Ojo: se calcula sobre UNA prenda, así que un insumo de tipo \"fijo por pedido\" entra completo — en un pedido real se reparte entre todas las prendas y pesa mucho menos.") +
    '</div><div class="rv">' + esc(fmt(costoPorPrenda(p))) + "</div></div>" +
    '<div class="rs-item"><div class="rl">Insumos</div><div class="rv">' + insumos.length + "</div></div>" +
    "</div>";

  html += renderFlujoDePlantilla(p);

  html += '<hr class="stitch" />';
  html += '<div class="cot-col-title">Insumos de la plantilla</div>';
  html += '<div class="ins-table"><div class="ins-row head" style="grid-template-columns:' + INS_COLS + ';"><span>Insumo</span><span>Unidad</span><span>Costo</span><span>Tipo de costo</span><span>Cant./mult.</span><span></span></div>';
  insumos.forEach(function (i) {
    html += '<div class="ins-row" style="grid-template-columns:' + INS_COLS + ';">' +
      '<span class="mobile-th">Insumo</span><input class="mini-input" style="width:100%" value="' + esc(i.nombre) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="nombre" />' +
      '<span class="mobile-th">Unidad</span><input class="mini-input" style="width:100%" value="' + esc(i.unidad) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="unidad" />' +
      '<span class="mobile-th">Costo</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.costo) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="costo" />' +
      '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="tipo">' + renderTipoCostoOptions(i.tipo) + "</select>" +
      '<span class="mobile-th">Cant./mult.</span><input type="number" class="mini-input" style="width:100%" value="' + esc(i.cantidad) + '" data-action-change="set-pla-ins-campo" data-pla="' + p.id + '" data-ins="' + i.id + '" data-campo="cantidad" ' + (i.tipo === "fijo_pedido" ? "disabled" : "") + " />" +
      '<button class="btn danger small" data-action="remove-pla-insumo" data-pla="' + p.id + '" data-ins="' + i.id + '">✕</button>' +
      "</div>";
  });
  if (!insumos.length) { html += '<div class="empty" style="padding:12px 0;">Sin insumos en esta plantilla.</div>'; }
  html += "</div>";

  html += '<div class="row-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
    '<select class="mini-input" style="max-width:240px" data-action-change="add-pla-insumo-catalogo" data-pla="' + p.id + '">' +
    '<option value="">+ Insumos predeterminados…</option>' +
    (state.catalogoInsumos || []).map(function (item) { return '<option value="' + item.id + '">' + esc(item.nombre) + "</option>"; }).join("") +
    "</select>" +
    '<button class="btn ghost small" data-action="add-pla-insumo-custom" data-pla="' + p.id + '">+ Insumo personalizado</button>' +
    "</div>";

  html += "</div>"; // .card
  return html;
}

// El flujo se elige acá, pero también se puede CREAR y editar sin salir del
// detalle: si una prenda necesita un proceso propio (la que lleva sublimación),
// mandar al usuario a la otra pestaña y hacerlo volver era un viaje de ida y
// vuelta por un dato que pertenece a esta prenda. Se reutiliza la misma tarjeta
// de la vista de flujos (renderFlujoEstadosCard), no una versión aparte.
function renderFlujoDePlantilla(p) {
  var flujos = state.plantillasEstados || [];
  var asignado = flujos.filter(function (f) { return f.id === p.flujoEstadosId; })[0];
  var html = '<div class="cot-col-title">Flujo de producción' +
    renderHelp("Las etapas por las que pasa esta prenda (ej. Cortado → Confección → Sublimado → Acabados). Al aplicar la plantilla en una cotización, la referencia nace con estas etapas. Si la dejas en \"Estándar\", usa el flujo de siempre de la app.") +
    "</div>";
  html += '<div class="inline-form pla-flujo-fila">' +
    '<select class="mini-input" style="max-width:280px" data-action-change="set-pla-campo" data-id="' + p.id + '" data-campo="flujoEstadosId">' +
    '<option value="">Estándar</option>' +
    flujos.map(function (f) { return '<option value="' + f.id + '" ' + (p.flujoEstadosId === f.id ? "selected" : "") + ">" + esc(f.nombre) + " (" + (f.estados || []).length + " etapas)</option>"; }).join("") +
    "</select>" +
    (asignado
      ? '<button class="btn ghost small" data-action="toggle-flujo-estados" data-id="' + asignado.id + '">' + (state.flujoEstadosAbierto === asignado.id ? "Ocultar etapas" : "Editar etapas (" + (asignado.estados || []).length + ")") + "</button>"
      : "") +
    '<button class="btn ghost small" data-action="add-flujo-estados" data-pla="' + p.id + '" title="Crea un flujo nuevo y se lo asigna a esta prenda">+ Crear flujo para esta prenda</button>' +
    "</div>";
  // Solo se incrusta el flujo que ESTA prenda tiene asignado: mostrar acá
  // cualquier flujo abierto en la otra pestaña haría creer que se está
  // editando el de la prenda.
  if (asignado && state.flujoEstadosAbierto === asignado.id) {
    html += '<div class="pla-flujo-inline">' + renderFlujoEstadosCard(asignado) + "</div>";
  }
  return html;
}

// ---------------------------------------------------------------------------
// Vista de flujos de producción (etapas reutilizables)
// ---------------------------------------------------------------------------
// Es configuración ocasional, no el contenido principal: por eso vive en su
// propia vista y ya no se dibuja ARRIBA de las plantillas.
//
// (Antes el "?" de acá prometía que también se podía guardar un flujo nuevo
// desde una cotización en curso. No existe tal cosa en ninguna parte de la app
// —no hay ninguna acción que lo haga en cotizaciones.js—, así que la frase se
// borró en vez de dejar prometiendo un camino inexistente.)
function renderFlujosEstados() {
  var flujos = state.plantillasEstados || [];
  var html = '<div class="card"><div class="section-title small">Flujos de producción' +
    renderHelp("Etapas reutilizables (ej. Cortado → Confección → Sublimado → Acabados) que luego se asignan a cualquier plantilla de prenda — así una prenda con un proceso distinto (como la que lleva sublimación) no tiene que compartir las mismas etapas que las demás.") +
    '</div><div class="pedido-actions"><button class="btn ghost small" data-action="add-flujo-estados">+ Nuevo flujo</button></div>';
  if (!flujos.length) {
    html += '<div class="empty">Aún no tienes flujos de producción guardados. Se usará el flujo estándar en las plantillas que no tengan uno asignado.</div>';
  } else {
    html += '<div class="pla-flujos-lista">';
    flujos.forEach(function (f) { html += renderFlujoEstadosCard(f); });
    html += "</div>";
  }
  html += "</div>";
  return html;
}

function renderFlujoEstadosCard(f) {
  var abierto = state.flujoEstadosAbierto === f.id;
  var estados = f.estados || [];
  var html = '<div class="card nested" data-flujo-id="' + f.id + '">' +
    '<div class="pedido-top"><div class="field wide" style="flex:1;max-width:320px;">' +
    '<input class="mini-input" style="width:100%;font-weight:700;" value="' + esc(f.nombre) + '" placeholder="Nombre del flujo (ej. Con sublimación)" data-action-change="set-flujo-estados-nombre" data-id="' + f.id + '" />' +
    "</div>" +
    '<button class="btn ghost small" data-action="toggle-flujo-estados" data-id="' + f.id + '">' + (abierto ? "Ocultar etapas" : "Editar etapas (" + estados.length + ")") + "</button>" +
    '<button class="btn danger small" data-action="remove-flujo-estados" data-id="' + f.id + '">Eliminar</button>' +
    "</div>";
  if (abierto) {
    var COLS_E = "30px 1fr 36px 36px 30px";
    html += '<div class="det-row head" style="grid-template-columns:' + COLS_E + ';"><span>#</span><span>Etapa</span><span></span><span></span><span></span></div>';
    estados.forEach(function (e, i) {
      html += '<div class="det-row" style="grid-template-columns:' + COLS_E + ';">' +
        '<span class="mobile-th">#</span><span>' + (i + 1) + "</span>" +
        '<span class="mobile-th">Etapa</span><input class="mini-input" value="' + esc(e.label) + '" data-action-change="set-etapa-flujo-label" data-id="' + f.id + '" data-idx="' + i + '" />' +
        '<button class="btn ghost small" ' + (i === 0 ? "disabled" : "") + ' data-action="mover-etapa-flujo" data-dir="-1" data-id="' + f.id + '" data-idx="' + i + '" title="Subir">↑</button>' +
        '<button class="btn ghost small" ' + (i === estados.length - 1 ? "disabled" : "") + ' data-action="mover-etapa-flujo" data-dir="1" data-id="' + f.id + '" data-idx="' + i + '" title="Bajar">↓</button>' +
        '<button class="btn danger small" data-action="remove-etapa-flujo" data-id="' + f.id + '" data-idx="' + i + '">✕</button>' +
        "</div>";
    });
    if (!estados.length) { html += '<div class="empty" style="padding:10px 0;">Sin etapas todavía — agrega la primera abajo.</div>'; }
    html += '<div class="inline-form" style="margin-top:8px;">' +
      // id estable: el render reemplaza el HTML entero y SOLO devuelve el foco
      // a elementos con id. Sin él, cualquier redibujo borraba lo tecleado, y
      // al crear una etapa con Enter el foco caía al body — cargar las seis
      // etapas de un flujo obligaba a volver a hacer clic en el campo cada vez.
      '<input class="mini-input" id="nueva-etapa-flujo-' + f.id + '" data-role="nueva-etapa-flujo-' + f.id + '" data-enter-action="add-etapa-flujo" data-id="' + f.id + '" placeholder="Nombre de la nueva etapa" style="width:180px" />' +
      '<button class="btn ghost small" data-action="add-etapa-flujo" data-id="' + f.id + '">+ Agregar etapa</button>' +
      "</div>";
  }
  html += "</div>";
  return html;
}

// El render reemplaza el innerHTML entero y solo devuelve el foco al elemento
// que YA lo tenía (por id). Una plantilla recién creada no existía cuando se
// guardó ese foco, así que hay que pedirlo explícitamente después del render
// —notify() repinta de forma síncrona, por eso no hace falta esperar—.
function enfocarNombrePlantilla(id) {
  var input = document.getElementById("pla-nombre-" + id);
  if (!input) return;
  input.focus();
  if (input.select) input.select(); // el nombre por defecto queda seleccionado: se escribe encima
  // scrollIntoView NO existe en jsdom (el entorno de la prueba de humo), así
  // que se comprueba antes de llamarlo o la prueba revienta.
  if (typeof input.scrollIntoView === "function") input.scrollIntoView({ behavior: "smooth", block: "center" });
}

export var actions = {
  "plantillas-vista": function (el) {
    state.plantillasVista = el.getAttribute("data-val") === "flujos" ? "flujos" : "plantillas";
    notify();
  },
  "abrir-plantilla": function (el) {
    state.plantillaEditando = el.getAttribute("data-id");
    state.plantillasVista = "plantillas";
    notify();
  },
  "cerrar-plantilla-detalle": function () {
    state.plantillaEditando = "";
    notify();
  },
  "filtro-plantilla-categoria": function (el) {
    state.filtroPlantillaCategoria = el.getAttribute("data-val");
    notify();
  },
  // Antes agregaba al FINAL de la lista y no abría, ni enfocaba, ni llevaba a
  // ninguna parte: había que buscar a mano la tarjeta "Nueva plantilla" al
  // fondo de la página. Ahora deja el detalle abierto con el cursor en el
  // nombre — crear y nombrar son el mismo gesto.
  "add-plantilla": function () {
    var nueva = { id: uid(), nombre: "Nueva plantilla", categoria: "", consumoSugerido: "", flujoEstadosId: "", imagenUrl: "", insumos: [] };
    state.plantillasPrendas = (state.plantillasPrendas || []).concat([nueva]);
    state.plantillaEditando = nueva.id;
    state.plantillasVista = "plantillas";
    persist("plantillasPrendas"); notify();
    enfocarNombrePlantilla(nueva.id);
  },
  // El gesto natural para "muchas plantillas y variaciones": partir de una que
  // ya funciona en vez de rehacer la lista de insumos. La copia queda JUNTO a
  // la original (no al final, donde no se encontraría) y abierta para
  // renombrarla de una.
  "duplicar-plantilla": function (el) {
    var id = el.getAttribute("data-id");
    var lista = state.plantillasPrendas || [];
    var p = lista.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var copia = {
      id: uid(),
      nombre: (p.nombre || "Plantilla") + " (copia)",
      categoria: p.categoria || "",
      consumoSugerido: p.consumoSugerido || "",
      flujoEstadosId: p.flujoEstadosId || "",
      imagenUrl: p.imagenUrl || "",
      // uid() NUEVO por insumo: si la copia compartiera los ids del original,
      // dos plantillas distintas tendrían filas con la misma identidad — y
      // cualquier cosa que cruce insumos entre plantillas (o un futuro
      // "aplicar" que los busque por id) las confundiría entre sí.
      insumos: (p.insumos || []).map(function (i) { return Object.assign({}, i, { id: uid() }); })
    };
    var idx = lista.indexOf(p);
    state.plantillasPrendas = lista.slice(0, idx + 1).concat([copia]).concat(lista.slice(idx + 1));
    state.plantillaEditando = copia.id;
    state.plantillasVista = "plantillas";
    persist("plantillasPrendas"); notify();
    enfocarNombrePlantilla(copia.id);
  },
  "set-pla-imagen": function (el) {
    var id = el.getAttribute("data-id");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      state.plantillaImagenSubiendo = Object.assign({}, state.plantillaImagenSubiendo, { [id]: true });
      notify();
      try {
        var url = await subirImagenReferencia(file);
        state.plantillaImagenSubiendo = Object.assign({}, state.plantillaImagenSubiendo); delete state.plantillaImagenSubiendo[id];
        mapPla(id, function (p) { return Object.assign({}, p, { imagenUrl: url }); });
      } catch (e) {
        state.plantillaImagenSubiendo = Object.assign({}, state.plantillaImagenSubiendo); delete state.plantillaImagenSubiendo[id];
        window.alert("No se pudo subir la imagen a Drive: " + (e && e.message ? e.message : e));
        notify();
      }
    });
    input.click();
  },
  "quitar-pla-imagen": function (el) {
    var id = el.getAttribute("data-id");
    mapPla(id, function (p) { return Object.assign({}, p, { imagenUrl: "" }); });
  },
  "remove-plantilla": function (el) {
    var id = el.getAttribute("data-id");
    var p = (state.plantillasPrendas || []).filter(function (p) { return p.id === id; })[0];
    if (!p) return;
    var nIns = (p.insumos || []).length;
    if (!window.confirm('¿Eliminar la plantilla "' + p.nombre + '"?\n\nSe pierde' + (nIns ? " su lista de " + nIns + (nIns === 1 ? " insumo" : " insumos") + " y" : "") + ' su flujo de producción asociado. No afecta cotizaciones donde ya se aplicó.')) return;
    state.plantillasPrendas = (state.plantillasPrendas || []).filter(function (p) { return p.id !== id; });
    // Sin esto el detalle quedaba apuntando a una plantilla que ya no existe.
    if (state.plantillaEditando === id) state.plantillaEditando = "";
    persist("plantillasPrendas"); notify();
  },
  "set-pla-campo": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    var numerico = campo === "consumoSugerido";
    mapPla(id, function (p) {
      var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
      return Object.assign({}, p, patch);
    });
  },
  "add-pla-insumo-custom": function (el) {
    var id = el.getAttribute("data-pla");
    mapPla(id, function (p) {
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: "Nuevo insumo", unidad: "UND", costo: 0, tipo: "por_prenda", cantidad: 1 }]) });
    });
  },
  "add-pla-insumo-catalogo": function (el) {
    if (!el.value) return;
    var id = el.getAttribute("data-pla");
    var item = (state.catalogoInsumos || []).filter(function (c) { return c.id === el.value; })[0];
    if (!item) return;
    mapPla(id, function (p) {
      // Igual que al copiar del catálogo a una referencia (ver nuevoInsumo en
      // modules/cotizaciones.js): "servicio" se resuelve UNA vez, acá, porque
      // el insumo de la plantilla no guarda categoriaId — sin esto, un
      // insumo marcado servicio por su CATEGORÍA (no por su Unidad) llegaba a
      // la plantilla sin ninguna forma de saberlo.
      return Object.assign({}, p, { insumos: (p.insumos || []).concat([{ id: uid(), nombre: item.nombre, unidad: item.unidad, costo: num(item.costo), tipo: item.tipo, cantidad: 1, esServicio: esInsumoServicio(item) }]) });
    });
  },
  "remove-pla-insumo": function (el) {
    var id = el.getAttribute("data-pla"), insId = el.getAttribute("data-ins");
    mapPla(id, function (p) { return Object.assign({}, p, { insumos: (p.insumos || []).filter(function (i) { return i.id !== insId; }) }); });
  },
  "set-pla-ins-campo": function (el) {
    var id = el.getAttribute("data-pla"), insId = el.getAttribute("data-ins"), campo = el.getAttribute("data-campo");
    var numerico = campo === "costo" || campo === "cantidad";
    mapPla(id, function (p) {
      var insumos = (p.insumos || []).map(function (i) {
        if (i.id !== insId) return i;
        var patch = {}; patch[campo] = numerico ? num(el.value) : el.value;
        return Object.assign({}, i, patch);
      });
      return Object.assign({}, p, { insumos: insumos });
    });
  },

  // ---------- Flujos de producción ----------
  // Con data-pla (desde el detalle de una plantilla) el flujo nuevo nace ya
  // asignado a esa prenda: es lo que se estaba pidiendo al crearlo ahí, y
  // ahorra tener que volver al desplegable a elegirlo.
  "add-flujo-estados": function (el) {
    var plaId = el ? el.getAttribute("data-pla") : "";
    var nuevo = { id: uid(), nombre: "Nuevo flujo", estados: [{ id: uid(), label: "Nuevo" }] };
    state.plantillasEstados = (state.plantillasEstados || []).concat([nuevo]);
    state.flujoEstadosAbierto = nuevo.id; // se abre listo para editar
    if (plaId) {
      state.plantillasPrendas = (state.plantillasPrendas || []).map(function (p) {
        return p.id === plaId ? Object.assign({}, p, { flujoEstadosId: nuevo.id }) : p;
      });
      persist("plantillasPrendas");
    }
    persist("plantillasEstados"); notify();
  },
  "remove-flujo-estados": function (el) {
    var id = el.getAttribute("data-id");
    var f = (state.plantillasEstados || []).filter(function (f) { return f.id === id; })[0];
    if (!f) return;
    var enUso = (state.plantillasPrendas || []).filter(function (p) { return p.flujoEstadosId === id; }).length;
    var msg = '¿Eliminar el flujo "' + f.nombre + '"?\n\n' +
      (enUso ? enUso + (enUso === 1 ? " plantilla de prenda lo tiene asignado y volverá" : " plantillas de prenda lo tienen asignado y volverán") + " al flujo estándar. " : "") +
      "No afecta cotizaciones donde ya se haya aplicado.";
    if (!window.confirm(msg)) return;
    state.plantillasPrendas = (state.plantillasPrendas || []).map(function (p) { return p.flujoEstadosId === id ? Object.assign({}, p, { flujoEstadosId: "" }) : p; });
    state.plantillasEstados = (state.plantillasEstados || []).filter(function (f) { return f.id !== id; });
    if (state.flujoEstadosAbierto === id) state.flujoEstadosAbierto = "";
    persist("plantillasEstados"); persist("plantillasPrendas"); notify();
  },
  "toggle-flujo-estados": function (el) {
    var id = el.getAttribute("data-id");
    state.flujoEstadosAbierto = state.flujoEstadosAbierto === id ? "" : id;
    notify();
  },
  "set-flujo-estados-nombre": function (el) {
    var id = el.getAttribute("data-id");
    mapFlujo(id, function (f) { return Object.assign({}, f, { nombre: el.value }); });
  },
  "add-etapa-flujo": function (el) {
    var id = el.getAttribute("data-id");
    var card = el.closest("[data-flujo-id]");
    var nombre = val(card, "nueva-etapa-flujo-" + id);
    if (!nombre) return;
    mapFlujo(id, function (f) { return Object.assign({}, f, { estados: (f.estados || []).concat([{ id: uid(), label: nombre }]) }); });
    // El cursor vuelve al campo, ya vacío: cargar las etapas de un flujo es
    // escribir seis nombres seguidos, y tener que hacer clic entre cada uno
    // convierte una tarea de diez segundos en una de un minuto.
    var input = document.getElementById("nueva-etapa-flujo-" + id);
    if (input) { input.value = ""; input.focus(); }
  },
  "remove-etapa-flujo": function (el) {
    var id = el.getAttribute("data-id"), idx = num(el.getAttribute("data-idx"));
    mapFlujo(id, function (f) {
      var estados = (f.estados || []).slice();
      if (estados.length <= 1) { window.alert("Debe quedar al menos una etapa en el flujo."); return f; }
      estados.splice(idx, 1);
      return Object.assign({}, f, { estados: estados });
    });
  },
  "mover-etapa-flujo": function (el) {
    var id = el.getAttribute("data-id"), idx = num(el.getAttribute("data-idx")), dir = num(el.getAttribute("data-dir"));
    mapFlujo(id, function (f) {
      var estados = (f.estados || []).slice();
      var j = idx + dir;
      if (j < 0 || j >= estados.length) return f;
      var tmp = estados[idx]; estados[idx] = estados[j]; estados[j] = tmp;
      return Object.assign({}, f, { estados: estados });
    });
  },
  "set-etapa-flujo-label": function (el) {
    var id = el.getAttribute("data-id"), idx = num(el.getAttribute("data-idx"));
    mapFlujo(id, function (f) {
      var estados = (f.estados || []).map(function (e, i) { return i === idx ? Object.assign({}, e, { label: el.value }) : e; });
      return Object.assign({}, f, { estados: estados });
    });
  }
};

function mapPla(id, transform) {
  state.plantillasPrendas = (state.plantillasPrendas || []).map(function (p) { return p.id === id ? transform(p) : p; });
  persist("plantillasPrendas"); notify();
}

function mapFlujo(id, transform) {
  state.plantillasEstados = (state.plantillasEstados || []).map(function (f) { return f.id === id ? transform(f) : f; });
  persist("plantillasEstados"); notify();
}
