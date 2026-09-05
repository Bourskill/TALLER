// Piezas de HTML reutilizadas por más de un módulo de pestaña.
// Si mañana un tercer módulo necesita buscar/crear un cliente, se reutiliza esto
// en vez de duplicar el combobox.

import { esc, norm } from "./utils.js";
import { clienteById, unidadesConocidas } from "./calc.js";
import { TIPOS_COSTO } from "./constants.js";

// <option> de los 3 tipos de costo (tela / fijo por pedido / fijo por prenda).
// Compartido entre Cotizaciones, Catálogo y Plantillas para que el texto de
// cada tipo salga idéntico en los tres lugares.
// Icono "?" con la explicación larga escondida hasta que el usuario pasa el
// mouse por encima o hace click/tap (accesible también con teclado vía :focus).
// Se usa para sacar párrafos explicativos del flujo visual principal (ver
// cotizaciones.js) sin perder la explicación para quien la necesite.
export function renderHelp(texto, alinear) {
  return '<span class="help-tip' + (alinear === "right" ? " align-right" : "") + '" tabindex="0">' +
    '<span class="help-icon" aria-hidden="true">?</span>' +
    '<span class="help-bubble">' + esc(texto) + "</span>" +
    "</span>";
}

// `enCotizacion` habilita los tipos que solo tienen sentido dentro de una
// cotización (ver `soloCotizacion` en TIPOS_COSTO): en Catálogo, Plantillas o
// Productos no hay a quién cobrarle, así que ahí se esconden. El valor actual
// siempre se incluye aunque esté filtrado — si no, un insumo guardado con ese
// tipo se vería en pantalla como si tuviera otro.
// Encabezado plegable "con bulto" (fondo de acento, borde, texto en negrita)
// para una sección de campos OPCIONALES que no toda fila/tarjeta necesita —a
// diferencia del `.cot-col-title` gris genérico, que se confunde con
// cualquier título de sección normal y es fácil de pasar por alto.
// Nació en Cotizaciones ("Opciones adicionales"), pero Pedidos ("Vendedor a
// comisión") y Productos ("Costeo y producción") son exactamente el mismo
// patrón —un ▸/▾ que revela campos opcionales— solo que sin este estilo: se
// veían tan discretos como cualquier título normal, y el usuario reportó que
// le costaba encontrarlos. Un solo lugar para el estilo evita que un cuarto
// caso futuro vuelva a nacer gris.
export function renderToggleSeccion(o) {
  return '<div class="cot-opciones-toggle"' + (o.margenSuperior ? ' style="margin-top:' + o.margenSuperior + ';"' : "") +
    ' data-action="' + o.action + '"' + (o.attrs || "") + '>' +
    '<button class="cot-collapse-toggle" style="position:static;" tabindex="-1">' + (o.abierta ? "▾" : "▸") + "</button> " + o.titulo +
    (o.ayuda ? renderHelp(o.ayuda) : "") +
    "</div>";
}

// Botón "▾" + panel de sugerencias para un campo "Unidad" (insumo, costo
// global, servicio, movimiento de Finanzas...). Reemplaza al <input
// list="dl-unidades"> nativo: el usuario pidió "un campo con una lista
// desplegable, se puede escribir o escoger" y ya se le había dicho que
// estaba — la MEMORIA (unidadesConocidas(), ver core/calc.js) sí aprende de
// lo que se escribe en cualquier campo, pero el datalist nativo del
// navegador solo ofrece sugerencias mientras se ESCRIBE: con el campo ya
// lleno (el caso normal al editar), un clic no mostraba nada, así que nunca
// se sintió como una lista desplegable de verdad.
//
// Clic en esta flecha SIEMPRE abre el panel completo, sea cual sea el valor
// actual. Elegir una opción escribe sobre el <input> original (por su id,
// vía `target`) y le dispara su evento normal (`input` o `change`, según
// cómo esté enlazado ese campo) — así este componente no necesita saber
// CÓMO se guarda cada campo (set-cat-campo, set-ins-campo, data-form...),
// solo sirve la sugerencia. Ver las acciones "toggle-combo-unidad" y
// "elegir-unidad" en core/dom.js.
//
// El panel se pinta SIEMPRE (no solo cuando está abierto) y se
// muestra/oculta con el atributo nativo `hidden`, en vez de con un
// state.comboUnidadAbierto que forzaba a notify() (redibujar TODA la
// pestaña) solo para abrir o cerrar un panel de tres líneas — el usuario lo
// notó ("se siente poco fluido") y esto es justo lo que causaba el
// tranquito: abrir/cerrar/moverse por las sugerencias ahora es una
// manipulación directa del DOM, cero renders de por medio, igual de
// instantáneo que un <select> nativo.
export function renderComboUnidad(o) {
  return '<button type="button" class="combo-unidad-flecha" tabindex="-1" data-action="toggle-combo-unidad" aria-label="Ver unidades usadas antes" aria-expanded="false">▾</button>' +
    '<div class="combo-suggestions combo-unidad-suggestions" hidden>' +
    unidadesConocidas().map(function (u) {
      return '<div class="combo-item" data-action="elegir-unidad" data-target="' + esc(o.id) + '" data-valor="' + esc(u) + '">' + esc(u) + "</div>";
    }).join("") +
    "</div>";
}

export function renderTipoCostoOptions(current, enCotizacion) {
  return Object.keys(TIPOS_COSTO).filter(function (k) {
    return enCotizacion || k === current || !TIPOS_COSTO[k].soloCotizacion;
  }).map(function (k) {
    return '<option value="' + k + '" ' + (k === current ? "selected" : "") + '>' + esc(TIPOS_COSTO[k].label) + "</option>";
  }).join("");
}

// ---------------------------------------------------------------------------
// Barra de búsqueda — ÚNICA para toda la app.
// ---------------------------------------------------------------------------
// Antes había tres implementaciones distintas de lo mismo, y ninguna en las
// pestañas donde más falta hacía:
//   1. `.search-bar` con CSS propio en clientes.css (solo Contactos),
//   2. un `.field > .mini-input` con estilos inline (Finanzas, Pedidos),
//   3. `.picker-search` dentro de los tres exploradores modales.
// Se veían distintas entre sí sin ninguna razón, y ninguna tenía botón de
// limpiar ni decía cuántos resultados quedaban. Esta función es la base
// compartida: un solo markup, un solo CSS (`.buscador` en forms.css) y un
// solo comportamiento. Si un caso necesita algo distinto, se parametriza
// acá — no se escribe una cuarta barra.
//
// Se apoya en el patrón `data-live-filter` que ya conoce core/dom.js: escribe
// directo en state[filtro] y re-renderiza con debounce. Y como el input lleva
// id, la tecla "/" y Ctrl+K lo encuentran (ver core/teclado.js).
//
// o = {
//   id:        id del <input> (obligatorio: sin él se pierde el foco en cada render)
//   filtro:    clave de `state` donde vive el texto (data-live-filter)
//   valor:     texto actual
//   placeholder
//   conteo:    { visibles, total, singular, plural } — opcional
//   ancho:     ancho máximo en px (por defecto 340)
//   compacto:  true dentro de un modal (sin margen inferior)
// }
export function renderBuscador(o) {
  var valor = o.valor == null ? "" : String(o.valor);
  var hayTexto = valor.trim().length > 0;
  var html = '<div class="buscador' + (o.compacto ? " compacto" : "") + '"' +
    (o.ancho === "full" ? "" : ' style="max-width:' + (o.ancho || 340) + 'px;"') + ">" +
    '<span class="buscador-icono" aria-hidden="true">' + iconoLupa() + "</span>" +
    '<input id="' + o.id + '" class="buscador-input" type="search" autocomplete="off"' +
    ' data-live-filter="' + o.filtro + '" value="' + esc(valor) + '"' +
    ' placeholder="' + esc(o.placeholder || "Buscar…") + '" />' +
    // El botón de limpiar solo existe cuando hay algo que limpiar: un ✕ que
    // no hace nada es ruido, y en una fila apretada resta espacio real.
    (hayTexto
      ? '<button class="buscador-limpiar" data-action="limpiar-buscador" data-filtro="' + o.filtro +
        '" data-input="' + o.id + '" title="Limpiar la búsqueda (Esc)" aria-label="Limpiar la búsqueda">✕</button>'
      : "") +
    "</div>";
  if (o.conteo) html += renderConteoResultados(o.conteo);
  return html;
}

// "8 de 24 insumos" cuando algo quedó fuera, "24 insumos" cuando se ve todo.
// Decir siempre el total es lo que evita la duda de "¿no hay más, o es que
// estoy filtrando?".
//
// POR QUÉ NO MIRA SI HAY TEXTO ESCRITO: antes solo decía "X de Y" cuando el
// buscador tenía texto, pero quien llama pasa un `visibles` que YA viene
// filtrado también por los chips. Con un chip activo y el buscador vacío el
// conteo prometía "2 insumos" mientras en pantalla había 1. Ahora la
// comparación es la única fuente: si se ve menos de lo que hay, se dice.
// `total` debe ser el universo del que salen los visibles (ver los llamadores).
function renderConteoResultados(c) {
  var plural = c.plural || (c.singular + "s");
  var nombre = c.total === 1 ? c.singular : plural;
  var texto = c.visibles !== c.total
    ? c.visibles + " de " + c.total + " " + nombre
    : c.total + " " + nombre;
  return '<div class="buscador-conteo">' + esc(texto) + "</div>";
}

// ---------------------------------------------------------------------------
// Tarjeta de índice visual — ÚNICA para toda la app.
// ---------------------------------------------------------------------------
// Nació en el catálogo de Productos (`.producto-card-mini`) y era la única
// pantalla de la app que dejaba reconocer sus cosas por la foto en vez de
// leer una lista. Plantillas necesitaba exactamente lo mismo, así que la
// pieza subió acá en vez de copiarse: una tarjeta con foto, nombre, una
// línea de contexto y un pie de dos datos.
//
// o = {
//   id, accion:    data-id y data-action del clic (abrir el detalle)
//   imagenUrl:     foto de vista previa (opcional)
//   sinImagen:     qué decir cuando no hay foto ("Sin foto")
//   nombre, meta:  título y línea de contexto
//   pie:           [izquierda, derecha] en HTML ya formado (opcional)
//   activa:        true si su detalle es el que está abierto
//   titulo:        tooltip
// }
export function renderTarjetaMini(o) {
  var img = o.imagenUrl
    ? '<img src="' + esc(o.imagenUrl) + '" alt="" onerror="this.style.opacity=0.15" />'
    : '<span class="tarjeta-mini-noimg">' + esc(o.sinImagen || "Sin foto") + "</span>";
  var pie = o.pie && o.pie.length
    ? '<div class="tarjeta-mini-pie">' + o.pie.join("") + "</div>"
    : "";
  return '<div class="tarjeta-mini' + (o.activa ? " activa" : "") + '"' +
    (o.accion ? ' data-action="' + o.accion + '" data-id="' + o.id + '"' : "") +
    ' title="' + esc(o.titulo || "Clic para abrir") + '">' +
    '<div class="tarjeta-mini-img">' + img + "</div>" +
    '<div class="tarjeta-mini-body">' +
    '<div class="tarjeta-mini-nombre">' + esc(o.nombre || "Sin nombre") + "</div>" +
    (o.meta ? '<div class="tarjeta-mini-meta">' + esc(o.meta) + "</div>" : "") +
    pie +
    "</div></div>";
}

// ---------------------------------------------------------------------------
// Progreso de producción — ÚNICO para los dos caminos de un pedido.
// ---------------------------------------------------------------------------
// ESTE ES EL COMPONENTE QUE ORIGINÓ LA REGLA DE REUTILIZAR. El progreso de
// producción estaba pintado dos veces en modules/pedidos.js:
//   - renderProgresoTape        para un "pedido rápido" (barra + etapas + botones con texto)
//   - renderProgresoPorReferencia para un pedido venido de cotización (fila compacta + flechas)
// Eran la misma información con markup, CSS y afordancias distintas, así que
// cuando se arregló una la otra se quedó vieja — literalmente lo que reportó
// el usuario: "en una parte se actualizó y en la otra se quedó viejo".
//
// Primera unificación: una sola pieza con una bandera `conBarra` que, para un
// pedido rápido, dibujaba ADEMÁS la barra vieja con todas las etiquetas
// visibles encima de la fila compacta. El usuario volvió a reportarlo: seguía
// viendo las dos versiones MEZCLADAS en el mismo pedido — la barra vieja no
// se había ido, solo se le había pegado la fila nueva al lado. La barra no
// vuelve a existir: acá solo hay UNA forma de mostrar esto, sin excepciones
// por camino.
//
// o = {
//   etapas:  [{id,label}]  el flujo, resuelto SIEMPRE con etapasDe() de core/calc.js
//   estado:  id de la etapa actual
//   nombre:  qué avanza ("Producción", o el nombre de la referencia)
//   accionAvanzar / accionRetroceder: nombres de acción
//   datos:   { atributo: valor } que se emiten como data-* en los dos botones
// }
export function renderProgresoEtapas(o) {
  var etapas = (o.etapas && o.etapas.length) ? o.etapas : [];
  if (!etapas.length) return "";
  var idx = etapas.map(function (e) { return e.id; }).indexOf(o.estado);
  if (idx < 0) idx = 0; // el estado guardado ya no existe en la lista
  var datos = "";
  Object.keys(o.datos || {}).forEach(function (k) { datos += ' data-' + k + '="' + esc(o.datos[k]) + '"'; });

  var html = '<div class="pedido-ref-progreso">' +
    '<span class="pedido-ref-nombre">' + esc(o.nombre || "Producción") + "</span>" +
    '<span class="pedido-ref-etapa">' + esc(etapas[idx].label) + "</span>" +
    '<span class="pedido-ref-frac" title="Etapa ' + (idx + 1) + " de " + etapas.length + '">' + (idx + 1) + "/" + etapas.length + "</span>" +
    '<span class="pedido-ref-btns">' +
    '<button class="btn ghost small"' + (idx === 0 ? " disabled" : "") + ' data-action="' + o.accionRetroceder + '"' + datos +
    ' title="Retroceder' + (idx > 0 ? " a " + esc(etapas[idx - 1].label) : "") + '" aria-label="Retroceder una etapa">←</button>' +
    '<button class="btn ghost small"' + (idx === etapas.length - 1 ? " disabled" : "") + ' data-action="' + o.accionAvanzar + '"' + datos +
    ' title="Avanzar' + (idx < etapas.length - 1 ? " a " + esc(etapas[idx + 1].label) : "") + '" aria-label="Avanzar una etapa">→</button>' +
    "</span></div>";
  return html;
}

function iconoLupa() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
}

// form: "pedido" | "cotizacion" — debe existir state.form<Form> con {cliente, clienteId}.
// Campo "Cliente": un botón que abre el buscador de Contactos (ver
// renderClientePicker más abajo), no un texto libre. Reemplazó al combo de
// autocompletado ("escribe para buscar o crear") que usaban Pedidos y
// Cotizaciones por igual — el usuario aclaró que las dos pestañas necesitan
// cosas distintas: una cotización SIEMPRE es de un contacto real (sus datos
// van al PDF), así que ahí no se ofrece crear uno al vuelo; un pedido rápido
// SÍ puede ser una venta informal a alguien que todavía no está registrado,
// así que ahí el buscador (ver `permitirNuevo` en renderClientePicker) deja
// esa puerta abierta. `nombreLibre` es el nombre tecleado (sin clienteId)
// cuando SÍ se usó esa puerta — solo aplica a Pedidos.
// `opts.dataId` va en el botón como `data-id`: para el picker de una
// cotización/pedido ya EXISTENTE (no un formulario en borrador), es lo único
// que le dice a la acción "abrir" CUÁL registro está editando (ver
// abrir-cliente-picker-cotizacion-editar en modules/cotizaciones.js).
// `opts.prominente` quita el envoltorio `.field`/`<label>` — para usarlo
// donde el nombre del cliente YA es el elemento más prominente del bloque
// (ver renderCotHead), no un campo más de un formulario.
export function renderClienteSeleccionCampo(opts) {
  var cliente = opts.clienteId ? clienteById(opts.clienteId) : null;
  var texto;
  if (opts.prominente) {
    // Cabecera de una cotización: el usuario pidió "solo basta con el
    // nombre, no tan exagerado" — nada de ✓/✎/ciudad/"— cambiar": el propio
    // hover del botón (ver .cliente-picker-btn-prominente en
    // css/cotizaciones.css) ya avisa que es clickeable, igual que hacía el
    // <input> de texto libre que reemplaza.
    if (cliente) texto = esc(cliente.nombre);
    else if (opts.nombreLibre) texto = esc(opts.nombreLibre);
    else texto = "Elegir cliente…";
  } else {
    if (cliente) texto = "✓ " + esc(cliente.nombre) + (cliente.ciudad ? " · " + esc(cliente.ciudad) : "") + " — cambiar";
    else if (opts.nombreLibre) texto = "✎ " + esc(opts.nombreLibre) + " (nuevo) — cambiar";
    else texto = opts.permitirNuevo ? "🔍 Buscar o crear cliente…" : "🔍 Buscar cliente…";
  }
  var boton = '<button type="button" class="btn ghost cliente-picker-btn' + (opts.prominente ? " cliente-picker-btn-prominente" : "") +
    '" data-action="' + opts.accionAbrir + '"' + (opts.dataId ? ' data-id="' + esc(opts.dataId) + '"' : "") + '>' + texto + "</button>";
  if (opts.prominente) return boton;
  return '<div class="field"><label>Cliente</label>' + boton + "</div>";
}

// Explorador de Contactos para elegir un cliente — mismo "chrome" de modal
// que el picker de insumos (overlay/cabecera/buscador/pie), pero de una sola
// columna (se busca por nombre, no se navega por categoría) y selección
// única. Filtra fuera a los proveedores (el cliente de un pedido/cotización
// es a quien se le vende, nunca a quien se le compra) y busca también por
// distintivo, no solo nombre/cédula/ciudad.
//
// `permitirNuevo` (solo Pedidos) agrega, cuando hay texto buscado y no
// calzó con nadie, un botón para seguir usando ese texto como un cliente
// nuevo — sin eso (Cotizaciones), no calzar con nadie solo invita a
// registrar el contacto primero en la pestaña Contactos.
export function renderClientePicker(opts) {
  if (!opts.abierto) return "";
  var q = norm(opts.busqueda || "").trim();
  var lista = (opts.clientes || []).filter(function (c) { return c.tipoRelacion !== "proveedor"; });
  var filtrados = q ? lista.filter(function (c) {
    return norm(c.nombre).indexOf(q) >= 0 || norm(c.cedula || "").indexOf(q) >= 0 ||
      norm(c.ciudad || "").indexOf(q) >= 0 || norm(c.distintivo || "").indexOf(q) >= 0;
  }) : lista;

  var html = '<div class="picker-overlay" data-action="' + opts.accionCerrar + '">' +
    '<div class="picker-modal" style="max-width:520px;" data-action="picker-stop">' +
    '<div class="picker-head">' +
    '<div class="section-title small" style="margin:0;">Elegir cliente</div>' +
    '<button class="imgprev-close" style="position:static;width:32px;height:32px;background:var(--surface-3);color:var(--ink-soft);" data-action="' + opts.accionCerrar + '" aria-label="Cerrar">✕</button>' +
    "</div>" +
    '<div class="picker-search">' + renderBuscador({
      id: opts.inputId, filtro: opts.filtroBusqueda, valor: opts.busqueda,
      placeholder: "Buscar por nombre, cédula, ciudad o distintivo…", ancho: "full", compacto: true
    }) + "</div>" +
    '<div class="cliente-picker-lista">';

  var sugerenciaContactos = opts.permitirNuevo ? "" : ' Si es alguien nuevo, regístralo primero en la pestaña <b>Contactos</b>.';
  if (!lista.length) {
    html += '<div class="empty">Aún no tienes contactos registrados.' + sugerenciaContactos + "</div>";
  } else if (!filtrados.length) {
    html += '<div class="empty">Sin coincidencias' + (q ? ' para "' + esc(opts.busqueda) + '"' : "") + "." + sugerenciaContactos + "</div>";
  } else {
    filtrados.forEach(function (c) {
      html += '<div class="cliente-picker-item" data-action="' + opts.accionSeleccionar + '" data-id="' + c.id + '">' +
        '<div class="cliente-picker-item-info"><b>' + esc(c.nombre) + (c.distintivo ? ' <span class="cliente-distintivo">— ' + esc(c.distintivo) + "</span>" : "") + "</b>" +
        "<small>" + ([c.cedula, c.ciudad].filter(Boolean).map(esc).join(" · ") || "sin más datos") + "</small></div>" +
        "</div>";
    });
  }
  html += "</div>";

  // Solo se ofrece cuando la búsqueda no encontró a nadie: si ya hay un
  // contacto que coincide, mostrar igual el botón invitaría a crear un
  // duplicado por accidente (el mismo cliente con dos ids distintos, con su
  // historial de pedidos partido entre los dos).
  if (opts.permitirNuevo && q && !filtrados.length) {
    html += '<div class="cliente-picker-nuevo">' +
      '<button class="btn ghost small" data-action="' + opts.accionUsarNuevo + '" data-nombre="' + esc(opts.busqueda) + '">+ Usar "' + esc(opts.busqueda) + '" como cliente nuevo</button>' +
      "</div>";
  }

  html += '<div class="picker-foot">' +
    '<span class="section-sub" style="margin:0;">' + filtrados.length + (filtrados.length === 1 ? " contacto" : " contactos") + "</span>" +
    '<button class="btn ghost small" data-action="' + opts.accionCerrar + '">Cancelar</button>' +
    "</div></div></div>";
  return html;
}
