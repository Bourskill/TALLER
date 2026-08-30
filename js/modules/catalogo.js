import { state, persist, notify, aprobarPropuesta, descartarPropuesta } from "../core/store.js";
import { esc, num, uid } from "../core/utils.js";
import { TIPOS_COSTO } from "../core/constants.js";
import { renderTipoCostoOptions, renderHelp, renderBuscador } from "../core/components.js";
import { getSession } from "../core/auth.js";
import { proveedoresDeContactos, esInsumoServicio } from "../core/calc.js";

// Orden de las columnas por IMPORTANCIA, no por historia: primero el nombre
// (por el que se reconoce la fila), inmediatamente despues el costo (el dato
// por el que se entra a esta pestana), y lo demas detras. Antes la categoria
// iba segunda, ocupando el mejor lugar de la fila para algo que ahora ya se
// ve en el encabezado del grupo.
var COLS = "1.6fr 120px 88px 155px 150px 140px 32px";
var CAMPO_LABEL = { catalogoInsumos: "insumos", catalogoCategorias: "categorías" };

function renderPropuestasPendientes(session) {
  var propuestas = state.catalogoPropuestas || [];
  var esAdmin = !session || session.rol !== "vendedor";
  // El admin ve TODAS las propuestas de todos los vendedores; un vendedor
  // solo ve si la suya propia sigue pendiente (para saber que aún no aplicó).
  var visibles = esAdmin ? propuestas : propuestas.filter(function (p) { return p.autor === (session.vendedorNombre || session.email); });
  if (!visibles.length) return "";

  if (!esAdmin) {
    return '<div class="card" style="border-color:var(--warning);"><div class="section-title small">Cambios pendientes de aprobación</div>' +
      '<div class="section-sub">Ya podés seguir usando tu edición mientras tanto — el admin todavía no aprueba tu cambio de ' +
      visibles.map(function (p) { return CAMPO_LABEL[p.key] || p.key; }).join(" y ") + ".</div></div>";
  }

  var html = '<div class="card" style="border-color:var(--warning);"><div class="section-title small">Cambios pendientes de aprobación' +
    renderHelp("Un vendedor editó el catálogo. Su cambio ya lo puede usar él en el momento, pero no queda guardado para todos hasta que lo apruebes acá — es una medida de seguridad porque el catálogo define el costo de producción del taller.") +
    "</div>";
  visibles.forEach(function (p) {
    html += '<div class="tx-row" style="grid-template-columns:1fr 140px 160px;">' +
      "<span>" + esc(p.autor) + " propuso cambios en " + esc(CAMPO_LABEL[p.key] || p.key) + "</span>" +
      '<span class="tag" style="background:var(--surface-3);">' + esc(new Date(p.fecha).toLocaleString("es-CO")) + "</span>" +
      '<span style="display:flex;gap:6px;justify-content:flex-end;">' +
      '<button class="btn success small" data-action="aprobar-propuesta-catalogo" data-id="' + p.id + '">Aprobar</button>' +
      '<button class="btn danger small" data-action="descartar-propuesta-catalogo" data-id="' + p.id + '">Descartar</button>' +
      "</span></div>";
  });
  html += "</div>";
  return html;
}

// ---------------------------------------------------------------------------
// El catálogo de insumos es donde vive el COSTO DE PRODUCCIÓN de todo el
// taller: cada cotización lo lee de acá. Por eso la pantalla se organiza
// alrededor de dos preguntas, en ese orden — "¿dónde está el insumo que
// busco?" y "¿cuánto cuesta?" — y no alrededor de la tabla.
//
// POR QUÉ CAMBIÓ: antes era una sola tabla de siete columnas del mismo peso
// visual (nombre, categoría, unidad, costo, tipo, proveedor, ✕), sin
// buscador, sin orden y sin forma de renombrar una categoría. Con veinte
// insumos ya obligaba a recorrer la lista con los ojos, y el costo —el dato
// por el que se entra— se veía igual que la unidad. Era además la única
// lista grande de la app sin barra de búsqueda.
export function render() {
  var session = getSession();
  var categorias = state.catalogoCategorias || [];
  var todos = state.catalogoInsumos || [];
  // Un filtro que apunta a una categoría que YA NO EXISTE dejaba la lista
  // completamente vacía, sin ningún chip encendido que lo explicara y con un
  // mensaje que hablaba de una búsqueda que el usuario nunca hizo. Pasa por
  // dos vías reales: el admin aprueba una propuesta del vendedor que borró esa
  // categoría, o el mismo taller abierto en dos pestañas (BroadcastChannel).
  // Se sanea EN EL ESTADO, no solo en la vista, para que no resucite.
  if (state.filtroCatalogoCategoria !== "todos" && state.filtroCatalogoCategoria !== "sin" &&
      !categorias.some(function (c) { return c.id === state.filtroCatalogoCategoria; })) {
    state.filtroCatalogoCategoria = "todos";
  }
  var visibles = insumosFiltrados(todos, categorias);

  var html = renderPropuestasPendientes(session);
  html += '<div class="card">';
  html += renderCabecera(todos, categorias);
  html += renderBarraFiltros(todos, visibles, categorias);
  html += renderAdminCategorias(categorias, todos);
  html += renderGrupos(visibles, categorias, todos);
  html += "</div>";
  return html;
}

// Buscar por nombre, unidad o proveedor: son las tres formas en que uno
// recuerda un insumo ("la tela azul", "lo que se mide en metros", "lo de
// Textiles Pérez").
// Los insumos que deja pasar el chip de categoría activo, SIN aplicar todavía
// el texto del buscador. Es el universo contra el que se cuenta "X de Y".
function enCategoriaActiva(lista, categorias) {
  var cat = state.filtroCatalogoCategoria;
  if (cat === "todos") return lista;
  return lista.filter(function (i) {
    var tiene = i.categoriaId && categorias.some(function (c) { return c.id === i.categoriaId; });
    return cat === "sin" ? !tiene : i.categoriaId === cat;
  });
}

function insumosFiltrados(lista, categorias) {
  var q = (state.buscarCatalogo || "").trim().toLowerCase();
  var cat = state.filtroCatalogoCategoria;
  var proveedores = proveedoresDeContactos();
  var out = lista.filter(function (i) {
    if (cat === "sin") {
      if (i.categoriaId && categorias.some(function (c) { return c.id === i.categoriaId; })) return false;
    } else if (cat !== "todos" && i.categoriaId !== cat) {
      return false;
    }
    if (!q) return true;
    var prov = proveedores.filter(function (p) { return p.id === i.proveedorId; })[0];
    return [i.nombre, i.unidad, prov && prov.nombre].some(function (t) {
      return String(t || "").toLowerCase().indexOf(q) >= 0;
    });
  });
  return ordenarInsumos(out);
}

function ordenarInsumos(lista) {
  var copia = lista.slice();
  if (state.ordenCatalogo === "caro") return copia.sort(function (a, b) { return num(b.costo) - num(a.costo); });
  // "nuevos": los últimos agregados primero. No hay fecha de creación en el
  // insumo, pero el orden del array YA es cronológico (siempre se agrega al
  // final), así que invertirlo es exactamente eso, sin inventar un campo.
  if (state.ordenCatalogo === "nuevos") return copia.reverse();
  return copia.sort(function (a, b) { return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"); });
}

// Cabecera: qué es esto, cuánto hay, y la única acción primaria. El botón de
// agregar vive arriba (no perdido al final de la lista) porque agregar es lo
// que más se hace, y el insumo nuevo aparece justo debajo, ya enfocado.
function renderCabecera(todos, categorias) {
  var ayudaTipos = Object.keys(TIPOS_COSTO).filter(function (k) { return !TIPOS_COSTO[k].soloCotizacion; })
    .map(function (k) { return TIPOS_COSTO[k].label + ": " + TIPOS_COSTO[k].ayuda; }).join(" · ");
  // Solo cuentan los insumos que YA tienen nombre: una fila recién creada
  // todavía no es un insumo sin clasificar, es un insumo a medio escribir, y
  // encender un aviso naranja por ella acusa al usuario de algo que está
  // haciendo en ese instante.
  var sinCategoria = todos.filter(function (i) {
    return (i.nombre || "").trim() && (!i.categoriaId || !categorias.some(function (c) { return c.id === i.categoriaId; }));
  }).length;

  return '<div class="cat-head">' +
    "<div>" +
    '<div class="section-title small" style="margin:0;">Catálogo de insumos' +
    renderHelp("Acá vive el costo de producción del taller: cada insumo que guardes se agrega después a cualquier referencia de una cotización con un clic, en vez de escribir el costo cada vez. Tipos de costo — " + ayudaTipos) +
    "</div>" +
    '<div class="section-sub" style="margin:4px 0 0;">' +
    todos.length + (todos.length === 1 ? " insumo" : " insumos") +
    " · " + categorias.length + (categorias.length === 1 ? " categoría" : " categorías") +
    (sinCategoria ? ' · <b class="cat-sin-clasificar">' + sinCategoria + " sin clasificar</b>" : "") +
    "</div>" +
    "</div>" +
    '<button class="btn" data-action="add-cat-item">+ Nuevo insumo</button>' +
    "</div>";
}

// Buscador + orden + categorías, en una sola franja. Las categorías siguen
// siendo `.chip` (la misma pieza que usan Finanzas y Pedidos para filtrar),
// pero ahora cada una dice cuántos insumos tiene: sin ese número había que
// entrar a cada categoría para descubrir que estaba vacía.
function renderBarraFiltros(todos, visibles, categorias) {
  var html = '<div class="cat-toolbar">' +
    renderBuscador({
      id: "inp-buscar-catalogo",
      filtro: "buscarCatalogo",
      valor: state.buscarCatalogo,
      placeholder: "Buscar insumo por nombre, unidad o proveedor…",
      // `total` es lo que el chip de categoría deja pasar, no el catálogo
      // entero: si no, el conteo prometía insumos que el chip ya descartó
      // ("2 insumos" con una sola fila en pantalla).
      conteo: { visibles: visibles.length, total: enCategoriaActiva(todos, categorias).length, singular: "insumo", plural: "insumos" }
    }) +
    '<div class="cat-orden">' +
    [["abc", "A–Z"], ["caro", "Más caro"], ["nuevos", "Recientes"]].map(function (o) {
      return '<button class="chip ' + (state.ordenCatalogo === o[0] ? "active" : "") + '" data-action="orden-catalogo" data-val="' + o[0] + '">' + o[1] + "</button>";
    }).join("") +
    "</div></div>";

  function cuenta(id) {
    if (id === "todos") return todos.length;
    if (id === "sin") {
      return todos.filter(function (i) { return !i.categoriaId || !categorias.some(function (c) { return c.id === i.categoriaId; }); }).length;
    }
    return todos.filter(function (i) { return i.categoriaId === id; }).length;
  }

  html += '<div class="filters cat-filters">' +
    '<button class="chip ' + (state.filtroCatalogoCategoria === "todos" ? "active" : "") + '" data-action="filtro-cat-categoria" data-val="todos">Todas <span class="chip-n">' + cuenta("todos") + "</span></button>";
  categorias.forEach(function (cat) {
    html += '<button class="chip ' + (state.filtroCatalogoCategoria === cat.id ? "active" : "") + '" data-action="filtro-cat-categoria" data-val="' + cat.id + '">' +
      esc(cat.nombre) + ' <span class="chip-n">' + cuenta(cat.id) + "</span></button>";
  });
  var sinN = cuenta("sin");
  html += '<button class="chip ' + (state.filtroCatalogoCategoria === "sin" ? "active" : "") + (sinN ? " chip-aviso" : "") + '" data-action="filtro-cat-categoria" data-val="sin">Sin categoría <span class="chip-n">' + sinN + "</span></button>";
  html += '<button class="chip chip-accion' + (state.catalogoCategoriasAbierto ? " active" : "") + '" data-action="toggle-admin-categorias" title="Crear, renombrar o eliminar categorías">⚙ Categorías</button>';
  html += "</div>";
  return html;
}

// Administrar categorías: plegado por defecto porque se hace de vez en
// cuando, no todos los días. Acá está lo que antes NO se podía hacer:
// renombrar una categoría. Antes solo se podía crearla o borrarla, así que un
// nombre mal escrito obligaba a borrar (dejando todos sus insumos sueltos) y
// volver a clasificarlos uno por uno.
function renderAdminCategorias(categorias, todos) {
  if (!state.catalogoCategoriasAbierto) return "";
  var html = '<div class="cat-admin">' +
    '<div class="cat-admin-titulo">Categorías' +
    renderHelp("Eliminar una categoría NO borra sus insumos: quedan como “sin categoría” y se pueden reclasificar. Renombrar es seguro, los insumos siguen apuntando a la misma categoría.") +
    "</div>";
  if (!categorias.length) {
    html += '<div class="empty" style="padding:6px 0;">Todavía no hay categorías. Crea la primera abajo (ej. Telas, Hilos, Empaques).</div>';
  }
  categorias.forEach(function (cat) {
    var n = todos.filter(function (i) { return i.categoriaId === cat.id; }).length;
    html += '<div class="cat-admin-fila">' +
      '<input class="mini-input" style="flex:1;min-width:0;" value="' + esc(cat.nombre) + '" data-action-change="set-cat-categoria-nombre" data-id="' + cat.id + '" aria-label="Nombre de la categoría" />' +
      '<span class="cat-admin-n">' + n + (n === 1 ? " insumo" : " insumos") + "</span>" +
      '<button class="btn danger small" data-action="remove-cat-categoria" data-id="' + cat.id + '" title="Eliminar la categoría (sus insumos quedan sin categoría, no se borran)">✕</button>' +
      "</div>";
  });
  html += '<div class="inline-form" style="margin-top:10px;">' +
    '<input class="mini-input" id="inp-nueva-categoria" data-enter-action="add-cat-categoria" placeholder="Nueva categoría (ej. Telas)" style="width:220px" />' +
    '<button class="btn ghost small" data-action="add-cat-categoria">+ Agregar categoría</button>' +
    "</div></div>";
  return html;
}

// Los insumos, agrupados por categoría. Al filtrar por una categoría o al
// buscar, se muestra una sola lista sin encabezados de grupo: repetir el
// nombre de la categoría por la que se acaba de filtrar no aporta nada.
function renderGrupos(visibles, categorias, todos) {
  if (!todos.length) {
    return '<div class="empty" style="padding:26px 10px;">Aún no tienes insumos.<br><b>Agrega el primero</b> con el botón de arriba — por ejemplo una tela, con su costo por metro.</div>';
  }
  if (!visibles.length) {
    return '<div class="empty" style="padding:26px 10px;">Ningún insumo coincide con lo que buscas.' +
      (state.buscarCatalogo ? ' <button class="btn ghost small" data-action="limpiar-buscador" data-filtro="buscarCatalogo" data-input="inp-buscar-catalogo">Limpiar búsqueda</button>' : "") +
      "</div>";
  }

  var agrupar = state.filtroCatalogoCategoria === "todos" && !(state.buscarCatalogo || "").trim();
  if (!agrupar) return renderTablaInsumos(visibles, categorias);

  var html = "";
  var grupos = categorias.map(function (cat) {
    return { nombre: cat.nombre, categoriaId: cat.id, items: visibles.filter(function (i) { return i.categoriaId === cat.id; }) };
  });
  grupos.push({
    nombre: "Sin categoría",
    categoriaId: "",
    items: visibles.filter(function (i) { return !i.categoriaId || !categorias.some(function (c) { return c.id === i.categoriaId; }); })
  });
  grupos.forEach(function (g) {
    if (!g.items.length) return; // un grupo vacío en la vista "Todas" es solo ruido
    html += '<div class="cat-grupo">' +
      '<div class="cat-grupo-head"><span class="cat-grupo-nombre">' + esc(g.nombre) + "</span>" +
      '<span class="cat-grupo-head-right"><span class="cat-grupo-meta">' + g.items.length + (g.items.length === 1 ? " insumo" : " insumos") + "</span>" +
      // Botón "+" propio de la sección: crea el insumo YA CLASIFICADO en esta
      // categoría, sin pasar por el botón general de arriba (que solo sabe
      // heredar la categoría del chip activo) ni tener que elegirla después.
      // Más rápido cuando se están cargando varios insumos seguidos de la
      // misma categoría, que es el caso más común.
      '<button class="btn ghost small cat-grupo-add" data-action="add-cat-item" data-categoria="' + esc(g.categoriaId) + '" title="Agregar un insumo en ' + esc(g.nombre) + '" aria-label="Agregar insumo en ' + esc(g.nombre) + '">+</button>' +
      "</span></div>" +
      renderTablaInsumos(g.items, categorias) +
      "</div>";
  });
  return html;
}

// Fila de insumo. Se apoya en `.tx-row` —la misma fila de grilla que usan
// Finanzas y el resto de las tablas, con su manejo de min-width y sus
// etiquetas `.mobile-th`— y le agrega el modificador `.insumo` para la
// jerarquía propia: el nombre se lee como un nombre y el costo como dinero,
// en vez de seis campos idénticos.
function renderTablaInsumos(items, categorias) {
  var html = '<div class="tx-row head insumo" style="grid-template-columns:' + COLS + ';">' +
    "<span>Insumo</span><span>Costo</span><span>Unidad</span><span>Tipo de costo</span><span>Proveedor</span><span>Categoría</span><span></span></div>";
  items.forEach(function (c) { html += renderFilaInsumo(c, categorias); });
  return html;
}

function renderFilaInsumo(c, categorias) {
  var esServicio = esInsumoServicio(c);
  var attrs = ' data-action-change="set-cat-campo" data-id="' + c.id + '"';
  return '<div class="tx-row insumo" style="grid-template-columns:' + COLS + ';">' +
    // El nombre es el dato por el que se reconoce la fila: se escribe con más
    // peso y sin caja, como texto, hasta que se hace clic para editarlo.
    '<span class="mobile-th">Insumo</span>' +
    '<span class="insumo-nombre-cell">' +
    '<input class="mini-input insumo-nombre" id="ins-nombre-' + c.id + '" style="width:100%" value="' + esc(c.nombre) + '" placeholder="Nombre del insumo"' + attrs + ' data-campo="nombre" />' +
    (esServicio ? '<span class="tag insumo-tag-servicio" title="Se paga pero no se compra en ningún lado: no aparece pidiendo cantidades en la lista de compras.">servicio</span>' : "") +
    "</span>" +

    // El costo es la otra mitad de la pregunta: monospace, alineado a la
    // derecha y con la unidad como sufijo, para poder comparar de un vistazo
    // una columna de precios (antes se veía igual que cualquier otro campo).
    '<span class="mobile-th">Costo</span>' +
    '<span class="insumo-costo-cell">' +
    '<input type="number" class="mini-input insumo-costo" style="width:100%" value="' + esc(c.costo) + '"' + attrs + ' data-campo="costo" />' +
    (c.unidad ? '<span class="insumo-costo-unidad">/' + esc(c.unidad) + "</span>" : "") +
    "</span>" +

    // La unidad es también lo que marca un intangible: si dice "servicio", la
    // lista de compras deja de pedir N unidades de algo que no se compra.
    //
    // La flechita es a propósito, no decorativa: el campo sigue siendo de
    // texto libre (se puede escribir cualquier cosa), pero el "list=" que lo
    // conecta al <datalist> compartido (ver renderDatalists en core/dom.js,
    // ahora alimentado por unidadesConocidas() en core/calc.js) es invisible
    // en algunos navegadores sin este indicador — sin él, nada avisaba que
    // ese campo tenía sugerencias para reutilizar.
    '<span class="mobile-th">Unidad</span>' +
    '<span class="insumo-unidad-cell">' +
    '<input class="mini-input insumo-unidad" list="dl-unidades" value="' + esc(c.unidad) + '" title="Escribe &quot;servicio&quot; si es algo que se paga pero no se compra en ningún lado (diseño, confección, sublimado)."' + attrs + ' data-campo="unidad" />' +
    '<span class="insumo-unidad-flecha" aria-hidden="true">▾</span>' +
    "</span>" +

    '<span class="mobile-th">Tipo de costo</span><select class="mini-input tipo-sel" style="width:100%"' + attrs + ' data-campo="tipo">' + renderTipoCostoOptions(c.tipo) + "</select>" +

    '<span class="mobile-th">Proveedor</span>' + renderSelectorProveedorInsumo(c) +

    '<span class="mobile-th">Categoría</span><select class="mini-input insumo-categoria" style="width:100%"' + attrs + ' data-campo="categoriaId">' +
    '<option value="">Sin categoría</option>' +
    categorias.map(function (cat) { return '<option value="' + cat.id + '" ' + (c.categoriaId === cat.id ? "selected" : "") + ">" + esc(cat.nombre) + "</option>"; }).join("") +
    "</select>" +

    '<button class="btn danger small" data-action="remove-cat-item" data-id="' + c.id + '" title="Eliminar del catálogo" aria-label="Eliminar insumo">✕</button>' +
    "</div>";
}

// Un insumo (tela, hilo, etc.) siempre se compra — a diferencia de un
// producto del catálogo, que sí puede fabricarse en el taller o comprarse ya
// hecho, un insumo no tiene esa disyuntiva: por eso acá no hay selector de
// "origen", solo a cuál de los Contactos (tipo Proveedor) se le compra.
function renderSelectorProveedorInsumo(c) {
  var proveedores = proveedoresDeContactos();
  if (!proveedores.length) {
    return '<span class="insumo-sin-proveedores" title="Los proveedores salen de la pestaña Contactos.">Sin proveedores</span>';
  }
  return '<select class="mini-input" style="width:100%" data-action-change="set-cat-campo" data-id="' + c.id + '" data-campo="proveedorId">' +
    '<option value="">Elegir proveedor…</option>' +
    proveedores.map(function (p) { return '<option value="' + p.id + '" ' + (c.proveedorId === p.id ? "selected" : "") + '>' + esc(p.nombre) + "</option>"; }).join("") +
    "</select>";
}

export var actions = {
  // Agregar deja el insumo nuevo LISTO PARA ESCRIBIR: nace vacío (no con el
  // texto "Nuevo insumo", que había que borrar a mano) y el cursor queda en su
  // campo de nombre. Antes el insumo aparecía al final de la lista, fuera de
  // pantalla si el catálogo era largo, y había que ir a buscarlo.
  //
  // Dos entradas al mismo botón, mismo cuerpo: el "+" de arriba (general, usa
  // la categoría del chip activo) y el "+" de cada sección en la vista "Todas"
  // (ver renderGrupos) — este último trae `data-categoria` con el id exacto
  // de SU grupo, así que el insumo cae directo ahí sin tener que elegirle la
  // categoría después. `hasAttribute` y no `getAttribute` porque el botón de
  // "Sin categoría" pasa `data-categoria=""` a propósito — un atributo vacío
  // sigue siendo "sé exactamente dónde va", distinto de "no sé, usa el filtro".
  "add-cat-item": function (el) {
    var categoriaId = el && el.hasAttribute("data-categoria")
      ? el.getAttribute("data-categoria")
      : (state.filtroCatalogoCategoria !== "todos" && state.filtroCatalogoCategoria !== "sin" ? state.filtroCatalogoCategoria : "");
    var nuevo = { id: uid(), nombre: "", unidad: "UND", costo: 0, tipo: "por_prenda", categoriaId: categoriaId, proveedorId: "" };
    state.catalogoInsumos = (state.catalogoInsumos || []).concat([nuevo]);
    // "Recientes" lo pone primero DENTRO de su lista (o de su grupo, en la
    // vista "Todas"); como ya se sabe con certeza en qué categoría cae —ya
    // sea la del botón de sección o la del chip activo—, no hace falta saltar
    // de filtro para que sea visible: siempre aparece dentro de lo que ya se
    // está viendo.
    state.ordenCatalogo = "nuevos";
    // Un insumo a medio escribir no debería quedar escondido detrás de una
    // búsqueda vieja.
    state.buscarCatalogo = "";
    persist("catalogoInsumos");
    notify();
    var input = document.getElementById("ins-nombre-" + nuevo.id);
    // scrollIntoView no existe en jsdom (test/smoke.mjs), así que se pregunta
    // antes de llamarlo en vez de dejar que reviente la acción entera.
    if (input) {
      input.focus();
      if (typeof input.scrollIntoView === "function") input.scrollIntoView({ block: "center" });
    }
  },
  "orden-catalogo": function (el) {
    state.ordenCatalogo = el.getAttribute("data-val");
    notify();
  },
  "toggle-admin-categorias": function () {
    state.catalogoCategoriasAbierto = !state.catalogoCategoriasAbierto;
    notify();
  },
  // Renombrar una categoria: antes no se podia. Un nombre mal escrito
  // obligaba a borrar la categoria (dejando todos sus insumos sueltos) y
  // volver a clasificarlos uno por uno. Los insumos guardan el ID, no el
  // nombre, asi que renombrar no toca ninguno.
  "set-cat-categoria-nombre": function (el) {
    var id = el.getAttribute("data-id");
    var nombre = (el.value || "").trim();
    if (!nombre) { notify(); return; } // una categoria sin nombre no se puede volver a encontrar
    state.catalogoCategorias = (state.catalogoCategorias || []).map(function (c) {
      return c.id === id ? Object.assign({}, c, { nombre: nombre }) : c;
    });
    persist("catalogoCategorias"); notify();
  },
  "remove-cat-item": function (el) {
    var id = el.getAttribute("data-id");
    var item = (state.catalogoInsumos || []).filter(function (c) { return c.id === id; })[0];
    if (!item) return;
    if (!window.confirm('¿Eliminar "' + item.nombre + '" del catálogo?\n\nLas cotizaciones y plantillas que ya lo usan no se ven afectadas (guardan su propia copia del costo); solo deja de estar disponible para agregarlo a nuevas.')) return;
    state.catalogoInsumos = (state.catalogoInsumos || []).filter(function (c) { return c.id !== id; });
    persist("catalogoInsumos"); notify();
  },
  "set-cat-campo": function (el) {
    var id = el.getAttribute("data-id"), campo = el.getAttribute("data-campo");
    var valor = campo === "costo" ? num(el.value) : el.value;
    state.catalogoInsumos = (state.catalogoInsumos || []).map(function (c) {
      if (c.id !== id) return c;
      var patch = {}; patch[campo] = valor;
      return Object.assign({}, c, patch);
    });
    persist("catalogoInsumos"); notify();
  },
  "filtro-cat-categoria": function (el) {
    state.filtroCatalogoCategoria = el.getAttribute("data-val");
    notify();
  },
  "add-cat-categoria": function () {
    var input = document.getElementById("inp-nueva-categoria");
    var nombre = input ? input.value.trim() : "";
    if (!nombre) return;
    state.catalogoCategorias = (state.catalogoCategorias || []).concat([{ id: uid(), nombre: nombre }]);
    if (input) input.value = "";
    persist("catalogoCategorias"); notify();
  },
  // No borra los insumos que tenía esa categoría — solo los deja "sin
  // categoría" (evitar que borrar por error una categoría se lleve insumos
  // de verdad, ya que aquí vive el costo de producción de todo el taller).
  "remove-cat-categoria": function (el) {
    var id = el.getAttribute("data-id");
    if (!window.confirm("¿Eliminar esta categoría? Los insumos que tenía quedan sin categoría (no se eliminan).")) return;
    state.catalogoCategorias = (state.catalogoCategorias || []).filter(function (c) { return c.id !== id; });
    if (state.filtroCatalogoCategoria === id) state.filtroCatalogoCategoria = "todos";
    persist("catalogoCategorias"); persist("catalogoInsumos"); notify();
  },
  "aprobar-propuesta-catalogo": async function (el) {
    await aprobarPropuesta(el.getAttribute("data-id"));
    notify();
  },
  "descartar-propuesta-catalogo": async function (el) {
    if (!window.confirm("¿Descartar esta propuesta? El catálogo real no cambia.")) return;
    await descartarPropuesta(el.getAttribute("data-id"));
    notify();
  }
};
