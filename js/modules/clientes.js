import { state, persist, notify } from "../core/store.js";
import { esc, uid, val, num, fmt, opt, norm, todayStr, exigirCampos } from "../core/utils.js";
import { clientesFiltrados, calcHistorialCliente } from "../core/calc.js";
import { sincronizarContacto, eliminarContacto } from "../core/contacts.js";
import { getSession } from "../core/auth.js";
import { renderHelp, renderBuscador } from "../core/components.js";
import { TIPOS_RELACION_CONTACTO } from "../core/constants.js";

// Mismo patrón que Cotizaciones y Pedidos: "+ Nuevo contacto" es solo el
// formulario de alta. La lista se parte en DOS pestañas —quien te compra y
// quien te vende— porque son dos trabajos distintos: se buscan en momentos
// distintos, se ordenan distinto (un proveedor se busca por qué vende) y
// mezclarlos obligaba a leer toda la lista para encontrar cualquiera de los
// dos. Los puntos de consignación van con los contactos: también son gente a
// la que le sale mercancía tuya, no gente a la que le compras.
export function render() {
  var vista = vistaClientes();
  var html = renderTabsClientes(vista);
  if (vista === "nueva") return html + renderFormNuevoCliente();
  return html + renderListaContactos(vista);
}

// "historial" es el nombre viejo de la pestaña única: se mapea a "contactos"
// para que una sesión guardada de antes no quede apuntando a una vista que ya
// no existe.
function vistaClientes() {
  var v = state.clientesVista || "nueva";
  if (v === "historial") return "contactos";
  return v;
}

function renderTabsClientes(vista) {
  var esProv = function (c) { return c.tipoRelacion === "proveedor"; };
  var proveedores = state.clientes.filter(esProv).length;
  var contactos = state.clientes.length - proveedores;
  return '<div class="gsheet-tabs">' +
    '<button class="gsheet-tab ' + (vista === "nueva" ? "active" : "") + '" data-action="cliente-vista" data-val="nueva">+ Nuevo contacto</button>' +
    '<button class="gsheet-tab ' + (vista === "contactos" ? "active" : "") + '" data-action="cliente-vista" data-val="contactos">Contactos' + (contactos ? " (" + contactos + ")" : "") + "</button>" +
    '<button class="gsheet-tab ' + (vista === "proveedores" ? "active" : "") + '" data-action="cliente-vista" data-val="proveedores">🧵 Proveedores' + (proveedores ? " (" + proveedores + ")" : "") + "</button>" +
    "</div>";
}

// Etiqueta del botón "Agregar ___" según el tipo elegido — "cliente"/
// "proveedor"/"punto" en vez de un genérico "contacto" sin contexto.
var ETIQ_TIPO_BOTON = { cliente: "cliente", proveedor: "proveedor", punto_consignacion: "punto" };

// ---------- Usuario de WhatsApp ----------
// El nombre de usuario de WhatsApp (el que empieza por @) permite escribirle
// a alguien sin tener su número. Se guarda SIN la arroba y en minúsculas —
// una sola forma canónica, para que "@Zulma", "Zulma" y "@zulma" no queden
// como tres contactos distintos al buscar. La arroba se pone al mostrarlo.
function normalizarUsuarioWhatsapp(valor) {
  return String(valor || "").trim().replace(/^@+/, "").toLowerCase();
}
function usuarioWhatsappTexto(c) {
  var u = normalizarUsuarioWhatsapp(c && c.usuarioWhatsapp);
  return u ? "@" + u : "";
}

function renderChipsCategoriaInsumo(seleccionadas, action) {
  var categorias = state.catalogoCategorias || [];
  if (!categorias.length) return '<div class="section-sub" style="margin:0;">Aún no tienes categorías de insumo — créalas en Catálogo.</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
    categorias.map(function (cat) {
      var marcada = (seleccionadas || []).indexOf(cat.id) !== -1;
      return '<button type="button" class="chip ' + (marcada ? "active" : "") + '" data-action="' + action + '" data-val="' + cat.id + '">' + esc(cat.nombre) + "</button>";
    }).join("") + "</div>";
}
function opcionesPuntuacion(actual) {
  return '<option value="0"' + (!actual ? " selected" : "") + ">Sin calificar</option>" +
    [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '" ' + (Number(actual) === n ? "selected" : "") + '>' + "⭐".repeat(n) + "</option>"; }).join("");
}
// Campos exclusivos de un proveedor, en el formulario "+ Nuevo contacto"
// (borrador reactivo en state.formCliente).
function renderCamposProveedorForm(f) {
  return '<div class="field wide"><label>Qué insumos vende' + renderHelp("Marca las categorías de tu Catálogo de insumos que este proveedor te surte — sirve para filtrar rápido a quién pedirle cada cosa.") + '</label>' +
    renderChipsCategoriaInsumo(f.categoriasInsumo, "toggle-categoria-insumo-form") + "</div>" +
    '<div class="field wide"><label>Descripción / notas</label><textarea class="mini-input" style="width:100%;min-height:56px;resize:vertical;" data-form="cliente" data-field="descripcion" placeholder="Ej. buena calidad de licra, entrega en 3 días...">' + esc(f.descripcion || "") + "</textarea></div>" +
    '<div class="field"><label>Puntuación' + renderHelp("Qué tan buena experiencia ha sido comprarle — puramente para tu referencia.") + '</label><select data-form="cliente" data-field="puntuacion">' + opcionesPuntuacion(f.puntuacion) + "</select></div>";
}
// Mismos campos, pero en modo edición de un contacto ya guardado (data-role,
// se leen al Guardar — igual que el resto de renderClienteEdit). Las
// categorías sí necesitan un pequeño borrador reactivo aparte
// (state.clienteEditCategorias) porque alternar chips no es un valor único
// que "val()" pueda leer de un solo input al guardar.
function renderCamposProveedorEdit(c) {
  var seleccionadas = state.clienteEditCategorias || c.categoriasInsumo || [];
  return '<div class="field wide"><label>Qué insumos vende</label>' +
    renderChipsCategoriaInsumo(seleccionadas, "toggle-categoria-insumo-edit") + "</div>" +
    '<div class="field wide"><label>Descripción / notas</label><textarea class="mini-input" style="width:100%;min-height:56px;resize:vertical;" data-role="edit-descripcion">' + esc(c.descripcion || "") + "</textarea></div>" +
    '<div class="field"><label>Puntuación</label><select class="mini-input" data-role="edit-puntuacion">' + opcionesPuntuacion(c.puntuacion) + "</select></div>";
}

function renderFormNuevoCliente() {
  var f = state.formCliente;
  var tipo = f.tipoRelacion || "cliente";
  var esPunto = tipo === "punto_consignacion";
  var esProveedor = tipo === "proveedor";
  var html = '<div class="card"><div class="section-title small">Nuevo contacto' +
    renderHelp("Un mismo directorio para todos: clientes que te compran, proveedores que te venden insumos, y puntos de consignación (locales donde exhibís mercancía sin cobrarla de una vez — se quedan con una comisión solo por lo que vendan).") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input data-form="cliente" data-field="nombre" value="' + esc(f.nombre) + '" placeholder="Nombre completo" /></div>' +
    '<div class="field"><label>Tipo</label><select data-action-change="set-cliente-tipo-relacion">' +
    Object.keys(TIPOS_RELACION_CONTACTO).map(function (k) { return opt(k, TIPOS_RELACION_CONTACTO[k], tipo); }).join("") +
    "</select></div>" +
    '<div class="field"><label>Cédula / RUT / NIT</label><input data-form="cliente" data-field="cedula" value="' + esc(f.cedula) + '" placeholder="Documento" /></div>' +
    '<div class="field"><label>Teléfono</label><input data-form="cliente" data-field="telefono" value="' + esc(f.telefono) + '" placeholder="Opcional" /></div>' +
    '<div class="field"><label>Usuario de WhatsApp' + renderHelp("El nombre de usuario de WhatsApp, ese que empieza por @ y sirve para encontrar a alguien sin tener su número. Se guarda tal cual y viaja en las notas del contacto de Google, así lo tienes también en el celular.") + '</label><input data-form="cliente" data-field="usuarioWhatsapp" value="' + esc(f.usuarioWhatsapp || "") + '" placeholder="@usuario" /></div>' +
    '<div class="field"><label>Correo</label><input type="email" data-form="cliente" data-field="correo" value="' + esc(f.correo) + '" placeholder="Opcional" /></div>' +
    '<div class="field wide"><label>Dirección</label><input data-form="cliente" data-field="direccion" value="' + esc(f.direccion) + '" placeholder="Para envíos" /></div>' +
    '<div class="field"><label>Ciudad</label><input data-form="cliente" data-field="ciudad" value="' + esc(f.ciudad) + '" /></div>' +
    '<div class="field"><label>Código postal</label><input data-form="cliente" data-field="cp" value="' + esc(f.cp) + '" /></div>' +
    '<div class="field"><label>Cuenta bancaria</label><input data-form="cliente" data-field="cuenta" value="' + esc(f.cuenta) + '" placeholder="Nº de cuenta" /></div>' +
    '<div class="field"><label>Entidad</label><input data-form="cliente" data-field="entidad" value="' + esc(f.entidad) + '" placeholder="Banco" /></div>' +
    (esPunto ?
      '<div class="field"><label>Comisión por defecto</label><select data-form="cliente" data-field="comisionDefaultTipo">' +
      '<option value="porcentaje"' + (f.comisionDefaultTipo !== "fijo" ? " selected" : "") + '>% de cada venta</option>' +
      '<option value="fijo"' + (f.comisionDefaultTipo === "fijo" ? " selected" : "") + '>$ fijo por unidad</option>' +
      "</select></div>" +
      '<div class="field"><label>Valor</label><input type="number" data-form="cliente" data-field="comisionDefaultValor" value="' + esc(f.comisionDefaultValor) + '" placeholder="Ej. 20" /></div>'
      : "") +
    (esProveedor ? renderCamposProveedorForm(f) : "") +
    '<button class="btn" data-action="add-cliente">Agregar ' + (ETIQ_TIPO_BOTON[tipo] || "contacto") + "</button>" +
    "</div></div>";
  return html;
}

// Las dos pestañas de lista comparten todo salvo qué contactos muestran y
// qué criterios de orden ofrecen — "por categoría" solo tiene sentido para
// proveedores, que son los únicos que declaran qué insumos venden.
function renderListaContactos(vista) {
  var esProveedores = vista === "proveedores";
  var lista = clientesFiltrados().filter(function (c) {
    return esProveedores ? c.tipoRelacion === "proveedor" : c.tipoRelacion !== "proveedor";
  });
  var orden = ordenActivo(esProveedores);

  // Barra de búsqueda compartida con el resto de la app (ver renderBuscador
  // en core/components.js) — antes esta pestaña tenía la suya propia,
  // `.search-bar`, distinta de las de Finanzas y Pedidos sin ninguna razón.
  var totalContactos = (state.clientes || []).filter(function (c) {
    return esProveedores ? c.tipoRelacion === "proveedor" : c.tipoRelacion !== "proveedor";
  }).length;
  var html = '<div style="margin-bottom:14px;">' + renderBuscador({
    id: "inp-filtro-clientes",
    filtro: "filtroClientes",
    valor: state.filtroClientes,
    placeholder: esProveedores ? "Buscar proveedor por nombre, ciudad o teléfono…" : "Buscar por nombre, cédula, ciudad o teléfono…",
    conteo: { visibles: lista.length, total: totalContactos, singular: esProveedores ? "proveedor" : "contacto", plural: esProveedores ? "proveedores" : "contactos" }
  }) + "</div>";

  html += renderSyncGoogle(lista);

  var criterios = [["abc", "A–Z"], ["recientes", "Recientes"]];
  if (esProveedores) criterios.push(["categoria", "Por categoría"]);
  html += '<div class="filters" style="margin-bottom:12px;"><span class="mini-label" style="align-self:center;margin-right:2px;">Ordenar:</span>' +
    criterios.map(function (c) {
      return '<button class="chip ' + (orden === c[0] ? "active" : "") + '" data-action="set-clientes-orden" data-val="' + c[0] + '">' + c[1] + "</button>";
    }).join("") + "</div>";

  if (lista.length === 0) {
    html += '<div class="empty">' + (state.filtroClientes
      ? "Sin resultados para tu búsqueda."
      : (esProveedores ? 'Aún no tienes proveedores. Créalos en "+ Nuevo contacto" eligiendo el tipo <b>Proveedor</b>.' : "Aún no tienes contactos registrados.")) + "</div>";
    return html;
  }

  if (orden === "categoria") return html + renderProveedoresPorCategoria(lista);
  return html + ordenarContactos(lista, orden).map(renderClienteCard).join("");
}

// El sync con Google Contacts es lo que hace que estos contactos terminen en
// la agenda del celular y, de ahí, en WhatsApp. Hasta ahora solo ocurría al
// crear o editar un contacto: los que ya existían —o los que registró otra
// persona del taller— nunca llegaban a tu cuenta. Este botón los empuja
// todos de una vez, a la cuenta con la que estés dentro ahora mismo.
function renderSyncGoogle(lista) {
  var session = getSession();
  if (!session || !session.email) return "";
  var email = session.email;
  var pendientes = lista.filter(function (c) { return !resourceNameDe(c, email); }).length;
  var sincronizando = !!state.sincronizandoContactos;
  return '<div class="section-sub" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;">' +
    '<button class="btn ghost small" ' + (sincronizando ? "disabled" : "") + ' data-action="sincronizar-contactos-google">' +
    (sincronizando ? "Sincronizando…" : "🔄 Enviar a mis Contactos de Google") + "</button>" +
    "<span>" +
    (pendientes
      ? "<b>" + pendientes + "</b> de esta lista todavía no están en la agenda de " + esc(email) + "."
      : "Todos los de esta lista ya están en la agenda de " + esc(email) + ".") +
    " Una vez en Google, aparecen solos en el celular y en WhatsApp.</span>" +
    "</div>";
}

// Atajo para escribirle sin pasar por la agenda: wa.me abre el chat directo,
// exista o no el contacto guardado en el celular. Complementa al sync con
// Google (que es lo que hace que aparezca con nombre en WhatsApp), no lo
// reemplaza. Se asume Colombia (+57) cuando el número va sin indicativo,
// que es como se escriben los teléfonos en el resto de la app.
function renderBotonWhatsapp(c) {
  var digitos = String(c.telefono || "").replace(/\D/g, "");
  if (digitos.length < 7) return "";
  var numero = digitos.length === 10 ? "57" + digitos : digitos;
  return '<a class="btn ghost small" href="https://wa.me/' + numero + '" target="_blank" rel="noopener noreferrer" title="Abrir chat de WhatsApp con ' + esc(c.nombre) + '">💬</a>';
}

function ordenActivo(esProveedores) {
  var orden = state.clientesOrden || "abc";
  // "categoría" no aplica a la pestaña de contactos: si quedó elegido desde
  // Proveedores, se cae a A–Z en vez de mostrar una vista vacía.
  if (orden === "categoria" && !esProveedores) return "abc";
  return orden;
}

// "Recientes" usa la fecha de alta; los contactos creados antes de que se
// guardara esa fecha no la tienen, así que se ordenan por su posición en la
// lista (que ya refleja el orden en que se fueron agregando).
function ordenarContactos(lista, orden) {
  var indice = {};
  state.clientes.forEach(function (c, i) { indice[c.id] = i; });
  var copia = lista.slice();
  if (orden === "recientes") {
    return copia.sort(function (a, b) {
      var fa = a.fechaCreacion || "", fb = b.fechaCreacion || "";
      if (fa && fb && fa !== fb) return fb.localeCompare(fa);
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return indice[b.id] - indice[a.id];
    });
  }
  return copia.sort(function (a, b) { return norm(a.nombre).localeCompare(norm(b.nombre)); });
}

// Un proveedor que vende varias categorías aparece bajo cada una: la pregunta
// que resuelve esta vista es "¿a quién le pido licra?", y esconderlo en una
// sola categoría arbitraria la dejaría sin responder.
function renderProveedoresPorCategoria(lista) {
  var categorias = state.catalogoCategorias || [];
  var html = "";
  var usados = {};
  categorias.forEach(function (cat) {
    var enCat = lista.filter(function (c) { return (c.categoriasInsumo || []).indexOf(cat.id) !== -1; });
    if (!enCat.length) return;
    enCat.forEach(function (c) { usados[c.id] = true; });
    html += '<div class="cot-col-title" style="margin-top:18px;">' + esc(cat.nombre) + " (" + enCat.length + ")</div>" +
      ordenarContactos(enCat, "abc").map(renderClienteCard).join("");
  });
  var sinCategoria = lista.filter(function (c) { return !usados[c.id]; });
  if (sinCategoria.length) {
    html += '<div class="cot-col-title" style="margin-top:18px;">Sin categoría (' + sinCategoria.length + ")" +
      renderHelp("Estos proveedores todavía no tienen marcado qué insumos venden. Edítalos y marca sus categorías para que aparezcan agrupados.") + "</div>" +
      ordenarContactos(sinCategoria, "abc").map(renderClienteCard).join("");
  }
  if (!html) html += '<div class="empty">Ningún proveedor tiene categorías marcadas todavía.</div>';
  return html;
}

function renderClienteCard(c) {
  var html = "";
  {
    if (state.clienteEditando === c.id) { return renderClienteEdit(c); }
    var esPuntoC = c.tipoRelacion === "punto_consignacion";
    var esProveedorC = c.tipoRelacion === "proveedor";
    var roster = c.roster || [];
    var rosterAbierto = state.clienteRosterAbierto === c.id;
    var historial = calcHistorialCliente(c.id);
    html += '<div class="cliente-card">' +
      '<div class="cliente-top"><span class="cliente-nombre">' + esc(c.nombre) +
      (esPuntoC ? ' <span class="badge info" title="Punto de consignación">🏬 Consignación</span>' : "") +
      (esProveedorC ? ' <span class="badge" title="Proveedor">🧵 Proveedor' + (c.puntuacion ? " " + "⭐".repeat(Number(c.puntuacion)) : "") + "</span>" : "") +
      (historial.esRecurrente ? ' <span class="badge success" title="Más de un pedido registrado">↻ Recurrente</span>' : "") +
      "</span>" +
      '<span style="display:flex;gap:6px;">' +
      (esProveedorC
        ? '<button class="btn ghost small" data-action="toggle-cliente-precios" data-id="' + c.id + '">💲 Precios y compras' + ((c.preciosPorInsumo || []).length ? " (" + c.preciosPorInsumo.length + ")" : "") + "</button>"
        : '<button class="btn ghost small" data-action="toggle-cliente-roster" data-id="' + c.id + '">🎽 Roster' + (roster.length ? " (" + roster.length + ")" : "") + "</button>") +
      renderBotonWhatsapp(c) +
      '<button class="btn ghost small" data-action="editar-cliente" data-id="' + c.id + '">Editar</button>' +
      '<button class="btn danger small" data-action="remove-cliente" data-id="' + c.id + '">Eliminar</button>' +
      "</span></div>" +
      (esProveedorC && (c.categoriasInsumo || []).length ? '<div class="section-sub" style="margin:2px 0 8px;">Vende: ' + esc((c.categoriasInsumo || []).map(function (catId) { var cat = (state.catalogoCategorias || []).filter(function (x) { return x.id === catId; })[0]; return cat ? cat.nombre : ""; }).filter(Boolean).join(", ")) + "</div>" : "") +
      (esProveedorC && c.descripcion ? '<div class="section-sub" style="margin:2px 0 8px;">' + esc(c.descripcion) + "</div>" : "") +
      // Resumen comercial primero (es lo que se busca al abrir un cliente:
      // cuánto ha comprado, cuándo fue la última vez) y recién después la
      // ficha de datos — antes el historial quedaba enterrado como una celda
      // más entre la cuenta bancaria y el código postal.
      (historial.cantidadPedidos > 0
        ? '<div class="cliente-resumen">' +
          '<span><b>' + historial.cantidadPedidos + "</b> " + (historial.cantidadPedidos === 1 ? "pedido" : "pedidos") + "</span>" +
          '<span><b>' + fmt(historial.totalComprado) + "</b> comprado</span>" +
          (historial.ultimaEntrega ? "<span>última entrega <b>" + esc(historial.ultimaEntrega) + "</b></span>" : "") +
          (esPuntoC ? "<span>comisión <b>" + (c.comisionDefault && c.comisionDefault.tipo === "fijo" ? fmt(c.comisionDefault.valor) + " por unidad" : esc((c.comisionDefault && c.comisionDefault.valor) || 0) + "% por venta") + "</b></span>" : "") +
          "</div>"
        : (esPuntoC ? '<div class="cliente-resumen"><span>comisión <b>' + (c.comisionDefault && c.comisionDefault.tipo === "fijo" ? fmt(c.comisionDefault.valor) + " por unidad" : esc((c.comisionDefault && c.comisionDefault.valor) || 0) + "% por venta") + "</b></span></div>" : "")) +
      '<div class="cliente-grid">' +
      campoCliente("Cédula/RUT", c.cedula) +
      campoCliente("Teléfono", c.telefono) +
      campoCliente("WhatsApp", usuarioWhatsappTexto(c)) +
      campoCliente("Correo", c.correo) +
      campoCliente("Dirección", c.direccion) +
      campoCliente("Ciudad / CP", c.ciudad ? (c.ciudad + (c.cp ? " / " + c.cp : "")) : "") +
      campoCliente("Cuenta", c.cuenta ? (c.cuenta + (c.entidad ? " · " + c.entidad : "")) : "") +
      "</div>" +
      (rosterAbierto ? renderRoster(c, roster) : "") +
      (state.clientePreciosAbierto === c.id ? renderPreciosProveedor(c) : "") +
      "</div>";
  }
  return html;
}

// Una celda de la ficha: etiqueta arriba (chica) y valor abajo, en vez de
// "Etiqueta: valor" en una sola línea corrida. Un correo largo ahora tiene la
// fila entera para él (y se corta con "…" si aun así no cabe, con el valor
// completo disponible en el tooltip) en lugar de empujar la columna vecina
// hasta dejarla ilegible. Un campo vacío no se dibuja: media ficha llena de
// guiones era ruido, no información.
function campoCliente(label, valor) {
  var v = (valor || "").toString().trim();
  if (!v) return "";
  return '<div class="cliente-campo"><span class="cliente-campo-label">' + esc(label) + "</span>" +
    '<span class="cliente-campo-valor" title="' + esc(v) + '">' + esc(v) + "</span></div>";
}

// Roster de equipo: lista nombre+número+talla guardada en el propio cliente
// (club/equipo), para reusarla temporada tras temporada en vez de tipear de
// nuevo la misma lista cada vez. Se consume desde Cotizaciones con el botón
// "Cargar roster" en la sección de tallas de una referencia.
function renderRoster(c, roster) {
  var html = '<div class="card nested" style="margin-top:12px;"><div class="section-title small" style="font-size:12.5px;">Roster de equipo' +
    renderHelp("Guarda aquí la lista de jugadores (nombre, número, talla) de este cliente/equipo. Desde Cotizaciones, en la sección \"Tallas y observaciones\" de una referencia, el botón \"Cargar roster\" trae esta lista completa de una vez — útil para clientes que repiten pedido cada temporada.") +
    "</div>";
  if (roster.length) {
    html += '<div class="det-row head" style="grid-template-columns:1fr 70px 70px 30px;"><span>Nombre</span><span>Número</span><span>Talla</span><span></span></div>';
    roster.forEach(function (j) {
      html += '<div class="det-row" style="grid-template-columns:1fr 70px 70px 30px;">' +
        '<span class="mobile-th">Nombre</span><input class="mini-input" value="' + esc(j.nombre) + '" data-action-change="set-roster-campo" data-id="' + c.id + '" data-jug="' + j.id + '" data-campo="nombre" />' +
        '<span class="mobile-th">Número</span><input class="mini-input" value="' + esc(j.numero || "") + '" data-action-change="set-roster-campo" data-id="' + c.id + '" data-jug="' + j.id + '" data-campo="numero" />' +
        '<span class="mobile-th">Talla</span><input class="mini-input" value="' + esc(j.talla || "") + '" data-action-change="set-roster-campo" data-id="' + c.id + '" data-jug="' + j.id + '" data-campo="talla" />' +
        '<button class="btn danger small" data-action="remove-roster-jugador" data-id="' + c.id + '" data-jug="' + j.id + '">✕</button>' +
        "</div>";
    });
  } else {
    html += '<div class="empty" style="padding:8px 0;">Sin jugadores todavía.</div>';
  }
  html += '<div class="pedido-actions" style="margin-top:10px;"><button class="btn ghost small" data-action="add-roster-jugador" data-id="' + c.id + '">+ Agregar jugador</button></div>';
  html += "</div>";
  return html;
}

// Lista de precios del proveedor: qué le compras y a cuánto, con tramos por
// cantidad (ej. 1-49 a $500, 50+ a $450) — puramente informativo, NO
// recalcula el costo del Catálogo solo (ver decisión: "manual, con acceso
// rápido" en vez de promedio ponderado automático, porque el taller no
// maneja inventario de insumos). Debajo va el historial de compras reales,
// que sí se arma solo a partir de los movimientos ya registrados.
function renderPreciosProveedor(c) {
  var precios = c.preciosPorInsumo || [];
  var insumosDisponibles = (state.catalogoInsumos || []).filter(function (i) {
    return !precios.some(function (p) { return p.insumoId === i.id; });
  });
  var COLS_TRAMO = "1fr 1fr 30px";
  var html = '<div class="card nested" style="margin-top:12px;"><div class="section-title small" style="font-size:12.5px;">Lista de precios' +
    renderHelp("Cuánto te cobra este proveedor por cada insumo, con tramos según la cantidad (ej. 1-49 unidades a $500, 50+ a $450). Es solo información de referencia para negociar/comparar — no cambia el costo del Catálogo por sí sola.") +
    "</div>";
  if (!precios.length) {
    html += '<div class="empty" style="padding:8px 0;">Sin insumos con precio registrado todavía.</div>';
  } else {
    precios.forEach(function (p) {
      html += '<div style="margin:10px 0;padding:10px 12px;background:var(--surface-2);border-radius:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><b style="font-size:13px;">' + esc(p.insumoNombre) + "</b>" +
        '<button class="btn danger small" data-action="remove-proveedor-insumo-precio" data-id="' + c.id + '" data-precio="' + p.id + '">✕ Quitar</button></div>' +
        '<div class="det-row head" style="grid-template-columns:' + COLS_TRAMO + ';"><span>Cantidad mínima</span><span>Precio</span><span></span></div>';
      (p.tramos || []).forEach(function (t) {
        html += '<div class="det-row" style="grid-template-columns:' + COLS_TRAMO + ';">' +
          '<input type="number" class="mini-input" value="' + esc(t.cantidadMinima) + '" placeholder="Ej. 1" data-action-change="set-proveedor-tramo-campo" data-id="' + c.id + '" data-precio="' + p.id + '" data-tramo="' + t.id + '" data-campo="cantidadMinima" />' +
          '<input type="number" class="mini-input" value="' + esc(t.precio) + '" placeholder="0" data-action-change="set-proveedor-tramo-campo" data-id="' + c.id + '" data-precio="' + p.id + '" data-tramo="' + t.id + '" data-campo="precio" />' +
          '<button class="btn danger small" data-action="remove-proveedor-tramo" data-id="' + c.id + '" data-precio="' + p.id + '" data-tramo="' + t.id + '">✕</button>' +
          "</div>";
      });
      if (!(p.tramos || []).length) html += '<div class="empty" style="padding:6px 0;">Sin tramos — agrega al menos uno.</div>';
      html += '<button class="btn ghost small" style="margin-top:6px;" data-action="add-proveedor-tramo" data-id="' + c.id + '" data-precio="' + p.id + '">+ Agregar tramo de cantidad</button>' +
        "</div>";
    });
  }
  html += '<div class="row-actions" style="margin-top:8px;">' +
    (insumosDisponibles.length
      ? '<select class="mini-input" style="max-width:240px" data-action-change="add-proveedor-insumo-precio" data-id="' + c.id + '">' +
        '<option value="">+ Agregar insumo con precio…</option>' +
        insumosDisponibles.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + "</option>"; }).join("") +
        "</select>"
      : '<span class="section-sub" style="margin:0;">Todos tus insumos del catálogo ya tienen precio de este proveedor.</span>') +
    "</div>";
  html += renderHistorialComprasProveedor(c);
  html += "</div>";
  return html;
}

// Se arma SOLO a partir de state.tx (nunca un registro aparte que se pueda
// desincronizar): cualquier movimiento marcado con este proveedor —desde
// "Registrar costo real" en una cotización o "Es compra de insumo" en
// Finanzas— aparece aquí. Si el concepto coincide con un insumo del
// catálogo, se ofrece un atajo de un clic para actualizar su costo de
// referencia (nunca automático: siempre pide confirmar el valor).
function renderHistorialComprasProveedor(c) {
  var compras = (state.tx || []).filter(function (t) { return t.proveedorId === c.id; });
  var html = '<hr class="stitch" style="margin:14px 0;" /><div class="section-title small" style="font-size:12.5px;">Historial de compras reales' +
    renderHelp("Se arma solo a partir de los movimientos de Finanzas marcados con este proveedor — no es un registro aparte. \"Usar como costo de referencia\" actualiza el costo del insumo en Catálogo (te pide confirmar el valor, nunca lo cambia solo).") +
    "</div>";
  if (!compras.length) {
    html += '<div class="empty" style="padding:8px 0;">Sin compras registradas a este proveedor todavía.</div>';
    return html + "</div>";
  }
  html += '<div class="tx-row head" style="grid-template-columns:85px 1fr 90px 1fr;"><span>Fecha</span><span>Concepto</span><span>Monto</span><span></span></div>';
  compras.forEach(function (t) {
    var matchInsumo = t.insumoNombre ? (state.catalogoInsumos || []).filter(function (i) { return norm(i.nombre) === norm(t.insumoNombre); })[0] : null;
    html += '<div class="tx-row" style="grid-template-columns:85px 1fr 90px 1fr;">' +
      '<span class="mobile-th">Fecha</span><span>' + esc(t.fecha) + "</span>" +
      '<span class="mobile-th">Concepto</span><span>' + esc(t.concepto) + "</span>" +
      '<span class="mobile-th">Monto</span><span class="amount">' + fmt(t.monto) + "</span>" +
      (matchInsumo ? '<button class="btn ghost small" data-action="usar-precio-como-costo" data-tx="' + t.id + '" data-insumo="' + matchInsumo.id + '">Usar como costo de referencia</button>' : "<span></span>") +
      "</div>";
  });
  return html;
}

// Modo edición explícito (Guardar/Cancelar), mismo patrón que la edición de
// deudas en pendientes.js: todos los campos quedan editables a la vez en
// vez de inputs sueltos siempre activos en la tarjeta.
function renderClienteEdit(c) {
  var comDefault = c.comisionDefault || { tipo: "porcentaje", valor: "" };
  return '<div class="cliente-card" data-cliente-edit-row="' + c.id + '">' +
    '<div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input class="mini-input" data-role="edit-nombre" value="' + esc(c.nombre) + '" /></div>' +
    '<div class="field"><label>Tipo</label><select class="mini-input" data-role="edit-tipo-relacion">' +
    Object.keys(TIPOS_RELACION_CONTACTO).map(function (k) { return opt(k, TIPOS_RELACION_CONTACTO[k], c.tipoRelacion || "cliente"); }).join("") +
    "</select></div>" +
    '<div class="field"><label>Cédula / RUT / NIT</label><input class="mini-input" data-role="edit-cedula" value="' + esc(c.cedula || "") + '" /></div>' +
    '<div class="field"><label>Teléfono</label><input class="mini-input" data-role="edit-telefono" value="' + esc(c.telefono || "") + '" /></div>' +
    '<div class="field"><label>Usuario de WhatsApp</label><input class="mini-input" data-role="edit-usuario-whatsapp" value="' + esc(usuarioWhatsappTexto(c)) + '" placeholder="@usuario" /></div>' +
    '<div class="field"><label>Correo</label><input type="email" class="mini-input" data-role="edit-correo" value="' + esc(c.correo || "") + '" /></div>' +
    '<div class="field wide"><label>Dirección</label><input class="mini-input" data-role="edit-direccion" value="' + esc(c.direccion || "") + '" /></div>' +
    '<div class="field"><label>Ciudad</label><input class="mini-input" data-role="edit-ciudad" value="' + esc(c.ciudad || "") + '" /></div>' +
    '<div class="field"><label>Código postal</label><input class="mini-input" data-role="edit-cp" value="' + esc(c.cp || "") + '" /></div>' +
    '<div class="field"><label>Cuenta bancaria</label><input class="mini-input" data-role="edit-cuenta" value="' + esc(c.cuenta || "") + '" /></div>' +
    '<div class="field"><label>Entidad</label><input class="mini-input" data-role="edit-entidad" value="' + esc(c.entidad || "") + '" /></div>' +
    '<div class="field"><label>Comisión por defecto (si es punto)</label><select class="mini-input" data-role="edit-comision-tipo">' +
    '<option value="porcentaje"' + (comDefault.tipo !== "fijo" ? " selected" : "") + '>% de cada venta</option>' +
    '<option value="fijo"' + (comDefault.tipo === "fijo" ? " selected" : "") + '>$ fijo por unidad</option>' +
    "</select></div>" +
    '<div class="field"><label>Valor comisión</label><input type="number" class="mini-input" data-role="edit-comision-valor" value="' + esc(comDefault.valor || "") + '" /></div>' +
    renderCamposProveedorEdit(c) +
    "</div>" +
    '<div class="pedido-actions" style="margin-top:10px;">' +
    '<button class="btn small" data-action="guardar-cliente-edit" data-id="' + c.id + '">Guardar</button>' +
    '<button class="btn ghost small" data-action="cancelar-edicion-cliente">Cancelar</button>' +
    "</div></div>";
}

// Cada cliente tiene, como mucho, UN contacto en los Contactos de Google de
// quien esté logueado en ese momento (admin o vendedor) — se crea/actualiza
// al agregar o editar, y se borra al eliminar el cliente. Los fallos (sin
// conexión, scope todavía no otorgado, etc.) solo quedan en consola: nunca
// deben bloquear el guardado real del cliente.
// Un contacto de Google vive dentro de UNA cuenta: su identificador no
// significa nada en la cuenta de otra persona del taller. Por eso cada
// cliente guarda un identificador por correo (contactResourceNames), no uno
// solo compartido — con el campo único, el sync de cada quien pisaba el del
// anterior y, al no encontrar ese identificador en su propia agenda, creaba
// un contacto nuevo: duplicados que se multiplicaban con cada edición.
function resourceNameDe(cliente, email) {
  var mapa = cliente.contactResourceNames || {};
  if (mapa[email]) return mapa[email];
  // Compatibilidad: los clientes de antes de este cambio tienen el campo
  // viejo. Se toma como el de la cuenta actual (que es la que muy
  // probablemente lo creó) y al primer sync queda guardado en el mapa.
  return cliente.contactResourceName || "";
}

function guardarResourceName(clienteId, email, resourceName) {
  state.clientes = state.clientes.map(function (c) {
    if (c.id !== clienteId) return c;
    var mapa = Object.assign({}, c.contactResourceNames || {});
    mapa[email] = resourceName;
    return Object.assign({}, c, { contactResourceNames: mapa, contactResourceName: resourceName });
  });
  persist("clientes");
}

function sincronizarClienteContacto(cliente) {
  var session = getSession();
  if (!session) { console.warn("[Contacts] Se omite el sync de \"" + cliente.nombre + "\": no hay sesión activa (getSession() devolvió null)."); return; }
  var email = session.email || "";
  console.info("[Contacts] Sincronizando \"" + cliente.nombre + "\" como " + email + "…");
  sincronizarContacto(cliente, resourceNameDe(cliente, email)).then(function (resourceName) {
    console.info("[Contacts] Listo: \"" + cliente.nombre + "\" → " + (resourceName || "(sin resourceName, revisa la respuesta de Google)"));
    if (!resourceName || resourceNameDe(cliente, email) === resourceName) return;
    if (!state.clientes.some(function (c) { return c.id === cliente.id; })) return;
    guardarResourceName(cliente.id, email, resourceName);
  }).catch(function (e) { console.error("[Contacts] No se pudo sincronizar \"" + cliente.nombre + "\":", e); });
}

export var actions = {
  "cliente-vista": function (el) {
    state.clientesVista = el.getAttribute("data-val");
    // La búsqueda es de la lista que se está viendo: arrastrarla al cambiar
    // de pestaña hacía parecer que la otra estaba vacía.
    state.filtroClientes = "";
    notify();
  },
  "set-clientes-orden": function (el) {
    state.clientesOrden = el.getAttribute("data-val");
    notify();
  },
  // Empuja TODOS los contactos de la pestaña actual a la agenda de Google de
  // quien esté dentro. Se hace de a uno y en serie (no en paralelo) para no
  // pasarse de las cuotas de la People API con una lista larga, y cada
  // resultado se guarda apenas llega: si algo falla a mitad de camino, lo ya
  // sincronizado no se pierde ni se repite en el siguiente intento.
  "sincronizar-contactos-google": async function () {
    var session = getSession();
    if (!session || !session.email) { window.alert("Inicia sesión con Google para poder sincronizar."); return; }
    var email = session.email;
    var esProveedores = vistaClientes() === "proveedores";
    var lista = state.clientes.filter(function (c) {
      return esProveedores ? c.tipoRelacion === "proveedor" : c.tipoRelacion !== "proveedor";
    });
    if (!lista.length) { window.alert("No hay contactos en esta pestaña."); return; }
    if (!window.confirm("Se van a enviar " + lista.length + " contacto(s) a la agenda de Google de " + email + ".\n\nLos que ya estén se actualizan, no se duplican.\n\n¿Seguir?")) return;

    state.sincronizandoContactos = true;
    notify();
    var okCount = 0, errores = [];
    for (var i = 0; i < lista.length; i++) {
      var c = lista[i];
      try {
        var resourceName = await sincronizarContacto(c, resourceNameDe(c, email));
        if (resourceName) { guardarResourceName(c.id, email, resourceName); okCount++; }
      } catch (e) {
        errores.push(c.nombre + ": " + (e && e.message ? e.message : e));
      }
    }
    state.sincronizandoContactos = false;
    notify();
    window.alert(okCount + " contacto(s) en la agenda de " + email + "." +
      (errores.length ? "\n\nNo se pudieron sincronizar " + errores.length + ":\n" + errores.slice(0, 5).join("\n") : "") +
      "\n\nEn el celular pueden tardar unos minutos en aparecer (Google los baja solo).");
  },
  "set-cliente-tipo-relacion": function (el) {
    state.formCliente.tipoRelacion = el.value;
    notify();
  },
  "toggle-categoria-insumo-form": function (el) {
    var val = el.getAttribute("data-val");
    var actuales = state.formCliente.categoriasInsumo || [];
    state.formCliente.categoriasInsumo = actuales.indexOf(val) === -1 ? actuales.concat([val]) : actuales.filter(function (v) { return v !== val; });
    notify();
  },
  "add-cliente": function () {
    var fcli = state.formCliente;
    if (!exigirCampos([["Nombre", fcli.nombre]])) return;
    var tipo = fcli.tipoRelacion || "cliente";
    var esPunto = tipo === "punto_consignacion";
    var esProveedor = tipo === "proveedor";
    var nuevo = {
      id: uid(), nombre: fcli.nombre, cedula: fcli.cedula, direccion: fcli.direccion, ciudad: fcli.ciudad, cp: fcli.cp, cuenta: fcli.cuenta, entidad: fcli.entidad, telefono: fcli.telefono, correo: fcli.correo,
      usuarioWhatsapp: normalizarUsuarioWhatsapp(fcli.usuarioWhatsapp),
      contactResourceName: "", contactResourceNames: {},
      tipoRelacion: tipo,
      comisionDefault: esPunto ? { tipo: fcli.comisionDefaultTipo || "porcentaje", valor: num(fcli.comisionDefaultValor) } : null,
      categoriasInsumo: esProveedor ? (fcli.categoriasInsumo || []) : [],
      descripcion: esProveedor ? fcli.descripcion : "",
      puntuacion: esProveedor ? num(fcli.puntuacion) : 0,
      preciosPorInsumo: [],
      // Fecha de alta: es lo que hace posible ordenar por "Recientes".
      fechaCreacion: todayStr(),
      roster: []
    };
    state.clientes.unshift(nuevo);
    state.formCliente = { nombre: "", cedula: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", telefono: "", correo: "", usuarioWhatsapp: "", tipoRelacion: "cliente", comisionDefaultTipo: "porcentaje", comisionDefaultValor: "", categoriasInsumo: [], descripcion: "", puntuacion: "" };
    // Aterriza en la pestaña donde acaba de quedar registrado, no en una
    // lista donde habría que buscarlo entre los de otro tipo.
    state.clientesVista = esProveedor ? "proveedores" : "contactos";
    persist("clientes"); notify();
    sincronizarClienteContacto(nuevo);
  },
  "remove-cliente": function (el) {
    var id = el.getAttribute("data-id");
    var c = state.clientes.filter(function (c) { return c.id === id; })[0];
    if (!c) return;
    if (!window.confirm('¿Eliminar a "' + c.nombre + '"?\n\nSe pierden sus datos de contacto y cuenta bancaria (cédula, dirección, teléfono, etc.) y no se puede deshacer. Sus pedidos y cotizaciones anteriores no se eliminan, solo quedan sin cliente vinculado.')) return;
    state.clientes = state.clientes.filter(function (c) { return c.id !== id; });
    persist("clientes"); notify();
    if (c.contactResourceName) eliminarContacto(c.contactResourceName).catch(function (e) { console.error("No se pudo borrar el contacto en Google Contacts", e); });
  },
  "editar-cliente": function (el) {
    var id = el.getAttribute("data-id");
    var c = state.clientes.filter(function (c) { return c.id === id; })[0];
    state.clienteEditando = id;
    state.clienteEditCategorias = c ? (c.categoriasInsumo || []).slice() : [];
    notify();
  },
  "cancelar-edicion-cliente": function () {
    state.clienteEditando = "";
    state.clienteEditCategorias = [];
    notify();
  },
  "toggle-categoria-insumo-edit": function (el) {
    var val = el.getAttribute("data-val");
    var actuales = state.clienteEditCategorias || [];
    state.clienteEditCategorias = actuales.indexOf(val) === -1 ? actuales.concat([val]) : actuales.filter(function (v) { return v !== val; });
    notify();
  },
  "guardar-cliente-edit": function (el) {
    var id = el.getAttribute("data-id");
    var fila = el.closest("[data-cliente-edit-row]");
    if (!fila) return;
    var nombre = val(fila, "edit-nombre");
    if (!nombre) return;
    var tipoRelacionEl = fila.querySelector('[data-role="edit-tipo-relacion"]');
    var tipoRelacion = tipoRelacionEl ? tipoRelacionEl.value : "cliente";
    var comTipoEl = fila.querySelector('[data-role="edit-comision-tipo"]');
    var categoriasInsumo = (state.clienteEditCategorias || []).slice();
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, {
        nombre: nombre,
        cedula: val(fila, "edit-cedula"),
        telefono: val(fila, "edit-telefono"),
        usuarioWhatsapp: normalizarUsuarioWhatsapp(val(fila, "edit-usuario-whatsapp")),
        correo: val(fila, "edit-correo"),
        direccion: val(fila, "edit-direccion"),
        ciudad: val(fila, "edit-ciudad"),
        cp: val(fila, "edit-cp"),
        cuenta: val(fila, "edit-cuenta"),
        entidad: val(fila, "edit-entidad"),
        tipoRelacion: tipoRelacion,
        comisionDefault: tipoRelacion === "punto_consignacion" ? { tipo: comTipoEl ? comTipoEl.value : "porcentaje", valor: num(val(fila, "edit-comision-valor")) } : null,
        categoriasInsumo: tipoRelacion === "proveedor" ? categoriasInsumo : (c.categoriasInsumo || []),
        descripcion: val(fila, "edit-descripcion"),
        puntuacion: num(val(fila, "edit-puntuacion"))
      });
    });
    state.clienteEditando = "";
    state.clienteEditCategorias = [];
    persist("clientes"); notify();
    var actualizado = state.clientes.filter(function (c) { return c.id === id; })[0];
    if (actualizado) sincronizarClienteContacto(actualizado);
  },
  // ---------- Precios y compras del proveedor ----------
  "toggle-cliente-precios": function (el) {
    var id = el.getAttribute("data-id");
    state.clientePreciosAbierto = state.clientePreciosAbierto === id ? "" : id;
    notify();
  },
  "add-proveedor-insumo-precio": function (el) {
    if (!el.value) return;
    var id = el.getAttribute("data-id");
    var insumo = (state.catalogoInsumos || []).filter(function (i) { return i.id === el.value; })[0];
    if (!insumo) return;
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      var precios = (c.preciosPorInsumo || []).concat([{ id: uid(), insumoId: insumo.id, insumoNombre: insumo.nombre, tramos: [{ id: uid(), cantidadMinima: 1, precio: insumo.costo || 0 }] }]);
      return Object.assign({}, c, { preciosPorInsumo: precios });
    });
    persist("clientes"); notify();
  },
  "remove-proveedor-insumo-precio": function (el) {
    var id = el.getAttribute("data-id"), precioId = el.getAttribute("data-precio");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, { preciosPorInsumo: (c.preciosPorInsumo || []).filter(function (p) { return p.id !== precioId; }) });
    });
    persist("clientes"); notify();
  },
  "add-proveedor-tramo": function (el) {
    var id = el.getAttribute("data-id"), precioId = el.getAttribute("data-precio");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      var precios = (c.preciosPorInsumo || []).map(function (p) {
        if (p.id !== precioId) return p;
        return Object.assign({}, p, { tramos: (p.tramos || []).concat([{ id: uid(), cantidadMinima: 1, precio: 0 }]) });
      });
      return Object.assign({}, c, { preciosPorInsumo: precios });
    });
    persist("clientes"); notify();
  },
  "remove-proveedor-tramo": function (el) {
    var id = el.getAttribute("data-id"), precioId = el.getAttribute("data-precio"), tramoId = el.getAttribute("data-tramo");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      var precios = (c.preciosPorInsumo || []).map(function (p) {
        if (p.id !== precioId) return p;
        return Object.assign({}, p, { tramos: (p.tramos || []).filter(function (t) { return t.id !== tramoId; }) });
      });
      return Object.assign({}, c, { preciosPorInsumo: precios });
    });
    persist("clientes"); notify();
  },
  "set-proveedor-tramo-campo": function (el) {
    var id = el.getAttribute("data-id"), precioId = el.getAttribute("data-precio"), tramoId = el.getAttribute("data-tramo"), campo = el.getAttribute("data-campo");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      var precios = (c.preciosPorInsumo || []).map(function (p) {
        if (p.id !== precioId) return p;
        var tramos = (p.tramos || []).map(function (t) {
          if (t.id !== tramoId) return t;
          var patch = {}; patch[campo] = num(el.value);
          return Object.assign({}, t, patch);
        });
        return Object.assign({}, p, { tramos: tramos });
      });
      return Object.assign({}, c, { preciosPorInsumo: precios });
    });
    persist("clientes"); notify();
  },
  // Atajo de un clic para llevar el precio de una compra real al costo de
  // referencia del insumo en Catálogo — SIEMPRE pide confirmar el valor (no
  // asume que el monto total de la compra es el costo por unidad, y nunca
  // promedia con compras anteriores: decisión explícita de no automatizar
  // el costeo mientras el taller no maneje inventario real de insumos).
  "usar-precio-como-costo": function (el) {
    var insumoId = el.getAttribute("data-insumo");
    var txId = el.getAttribute("data-tx");
    var insumo = (state.catalogoInsumos || []).filter(function (i) { return i.id === insumoId; })[0];
    if (!insumo) return;
    var tx = (state.tx || []).filter(function (t) { return t.id === txId; })[0];
    var sugerido = window.prompt('Nuevo costo de referencia para "' + insumo.nombre + '" (por ' + (insumo.unidad || "UND") + '):', tx ? tx.monto : insumo.costo);
    if (sugerido === null) return;
    var valor = num(sugerido);
    if (valor <= 0) return;
    state.catalogoInsumos = (state.catalogoInsumos || []).map(function (i) { return i.id === insumoId ? Object.assign({}, i, { costo: valor }) : i; });
    persist("catalogoInsumos"); notify();
  },
  "toggle-cliente-roster": function (el) {
    var id = el.getAttribute("data-id");
    state.clienteRosterAbierto = state.clienteRosterAbierto === id ? "" : id;
    notify();
  },
  "add-roster-jugador": function (el) {
    var id = el.getAttribute("data-id");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, { roster: (c.roster || []).concat([{ id: uid(), nombre: "", numero: "", talla: "" }]) });
    });
    persist("clientes"); notify();
  },
  "remove-roster-jugador": function (el) {
    var id = el.getAttribute("data-id"), jugId = el.getAttribute("data-jug");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, { roster: (c.roster || []).filter(function (j) { return j.id !== jugId; }) });
    });
    persist("clientes"); notify();
  },
  "set-roster-campo": function (el) {
    var id = el.getAttribute("data-id"), jugId = el.getAttribute("data-jug"), campo = el.getAttribute("data-campo");
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      var roster = (c.roster || []).map(function (j) {
        if (j.id !== jugId) return j;
        var patch = {}; patch[campo] = el.value;
        return Object.assign({}, j, patch);
      });
      return Object.assign({}, c, { roster: roster });
    });
    persist("clientes"); notify();
  }
};
