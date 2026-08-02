import { state, persist, notify } from "../core/store.js";
import { esc, uid, val, num } from "../core/utils.js";
import { clientesFiltrados } from "../core/calc.js";
import { sincronizarContacto, eliminarContacto } from "../core/contacts.js";
import { getSession } from "../core/auth.js";
import { renderHelp } from "../core/components.js";

export function render() {
  var f = state.formCliente;
  var esPunto = f.tipoRelacion === "punto_consignacion";
  var html = '<div class="card"><div class="section-title small">Nuevo cliente' +
    renderHelp("Un \"Punto de consignación\" es un local externo donde exhibís mercancía sin cobrarla de una vez — el local se queda con una comisión solo por lo que efectivamente venda. Se gestiona igual que un cliente normal, pero con una comisión por defecto que se precarga al enviarle un pedido en consignación (ver Pedidos).") +
    '</div><div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input data-form="cliente" data-field="nombre" value="' + esc(f.nombre) + '" placeholder="Nombre completo" /></div>' +
    '<div class="field"><label>Tipo</label><select data-action-change="set-cliente-tipo-relacion">' +
    '<option value="cliente"' + (esPunto ? "" : " selected") + '>Cliente</option>' +
    '<option value="punto_consignacion"' + (esPunto ? " selected" : "") + '>🏬 Punto de consignación</option>' +
    "</select></div>" +
    '<div class="field"><label>Cédula / RUT</label><input data-form="cliente" data-field="cedula" value="' + esc(f.cedula) + '" placeholder="Documento" /></div>' +
    '<div class="field"><label>Teléfono</label><input data-form="cliente" data-field="telefono" value="' + esc(f.telefono) + '" placeholder="Opcional" /></div>' +
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
    '<button class="btn" data-action="add-cliente">Agregar ' + (esPunto ? "punto" : "cliente") + "</button>" +
    "</div></div>";

  var totalClientes = state.clientes.length;
  html += '<div class="search-bar"><input id="inp-filtro-clientes" data-live-filter="filtroClientes" value="' + esc(state.filtroClientes) + '" placeholder="Buscar por nombre, cédula, ciudad o teléfono..." />' +
    '<div class="client-count">' + totalClientes + " cliente" + (totalClientes === 1 ? "" : "s") + " registrado" + (totalClientes === 1 ? "" : "s") + "</div></div>";

  var lista = clientesFiltrados();
  if (lista.length === 0) {
    html += '<div class="empty">' + (state.filtroClientes ? "Sin resultados para tu búsqueda." : "Aún no tienes clientes registrados.") + "</div>";
    return html;
  }

  lista.forEach(function (c) {
    if (state.clienteEditando === c.id) { html += renderClienteEdit(c); return; }
    var esPuntoC = c.tipoRelacion === "punto_consignacion";
    var roster = c.roster || [];
    var rosterAbierto = state.clienteRosterAbierto === c.id;
    html += '<div class="cliente-card">' +
      '<div class="cliente-top"><span class="cliente-nombre">' + esc(c.nombre) + (esPuntoC ? ' <span class="badge" title="Punto de consignación">🏬 Consignación</span>' : "") + "</span>" +
      '<span style="display:flex;gap:6px;">' +
      '<button class="btn ghost small" data-action="toggle-cliente-roster" data-id="' + c.id + '">🎽 Roster' + (roster.length ? " (" + roster.length + ")" : "") + "</button>" +
      '<button class="btn ghost small" data-action="editar-cliente" data-id="' + c.id + '">Editar</button>' +
      '<button class="btn danger small" data-action="remove-cliente" data-id="' + c.id + '">Eliminar</button>' +
      "</span></div>" +
      '<div class="cliente-grid">' +
      "<div><b>Cédula/RUT:</b> " + esc(c.cedula || "—") + "</div>" +
      "<div><b>Teléfono:</b> " + esc(c.telefono || "—") + "</div>" +
      "<div><b>Correo:</b> " + esc(c.correo || "—") + "</div>" +
      "<div><b>Dirección:</b> " + esc(c.direccion || "—") + "</div>" +
      "<div><b>Ciudad / CP:</b> " + esc(c.ciudad || "—") + (c.cp ? " / " + esc(c.cp) : "") + "</div>" +
      "<div><b>Cuenta:</b> " + esc(c.cuenta || "—") + "</div>" +
      "<div><b>Entidad:</b> " + esc(c.entidad || "—") + "</div>" +
      (esPuntoC ? "<div><b>Comisión:</b> " + (c.comisionDefault && c.comisionDefault.tipo === "fijo" ? "$" + esc(c.comisionDefault.valor) + " por unidad" : (esc((c.comisionDefault && c.comisionDefault.valor) || 0) + "% por venta")) + "</div>" : "") +
      "</div>" +
      (rosterAbierto ? renderRoster(c, roster) : "") +
      "</div>";
  });
  return html;
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
        '<input class="mini-input" value="' + esc(j.nombre) + '" data-action-change="set-roster-campo" data-id="' + c.id + '" data-jug="' + j.id + '" data-campo="nombre" />' +
        '<input class="mini-input" value="' + esc(j.numero || "") + '" data-action-change="set-roster-campo" data-id="' + c.id + '" data-jug="' + j.id + '" data-campo="numero" />' +
        '<input class="mini-input" value="' + esc(j.talla || "") + '" data-action-change="set-roster-campo" data-id="' + c.id + '" data-jug="' + j.id + '" data-campo="talla" />' +
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

// Modo edición explícito (Guardar/Cancelar), mismo patrón que la edición de
// deudas en pendientes.js: todos los campos quedan editables a la vez en
// vez de inputs sueltos siempre activos en la tarjeta.
function renderClienteEdit(c) {
  var esPuntoC = c.tipoRelacion === "punto_consignacion";
  var comDefault = c.comisionDefault || { tipo: "porcentaje", valor: "" };
  return '<div class="cliente-card" data-cliente-edit-row="' + c.id + '">' +
    '<div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input class="mini-input" data-role="edit-nombre" value="' + esc(c.nombre) + '" /></div>' +
    '<div class="field"><label>Tipo</label><select class="mini-input" data-role="edit-tipo-relacion">' +
    '<option value="cliente"' + (esPuntoC ? "" : " selected") + '>Cliente</option>' +
    '<option value="punto_consignacion"' + (esPuntoC ? " selected" : "") + '>🏬 Punto de consignación</option>' +
    "</select></div>" +
    '<div class="field"><label>Cédula / RUT</label><input class="mini-input" data-role="edit-cedula" value="' + esc(c.cedula || "") + '" /></div>' +
    '<div class="field"><label>Teléfono</label><input class="mini-input" data-role="edit-telefono" value="' + esc(c.telefono || "") + '" /></div>' +
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
function sincronizarClienteContacto(cliente) {
  var session = getSession();
  if (!session) { console.warn("[Contacts] Se omite el sync de \"" + cliente.nombre + "\": no hay sesión activa (getSession() devolvió null)."); return; }
  console.info("[Contacts] Sincronizando \"" + cliente.nombre + "\" como " + session.email + "…");
  sincronizarContacto(cliente).then(function (resourceName) {
    console.info("[Contacts] Listo: \"" + cliente.nombre + "\" → " + (resourceName || "(sin resourceName, revisa la respuesta de Google)"));
    if (!resourceName || cliente.contactResourceName === resourceName) return;
    var idx = state.clientes.findIndex(function (c) { return c.id === cliente.id; });
    if (idx === -1) return;
    state.clientes = state.clientes.map(function (c) { return c.id === cliente.id ? Object.assign({}, c, { contactResourceName: resourceName }) : c; });
    persist("clientes");
  }).catch(function (e) { console.error("[Contacts] No se pudo sincronizar \"" + cliente.nombre + "\":", e); });
}

export var actions = {
  "set-cliente-tipo-relacion": function (el) {
    state.formCliente.tipoRelacion = el.value;
    notify();
  },
  "add-cliente": function () {
    var fcli = state.formCliente;
    if (!fcli.nombre) return;
    var esPunto = fcli.tipoRelacion === "punto_consignacion";
    var nuevo = {
      id: uid(), nombre: fcli.nombre, cedula: fcli.cedula, direccion: fcli.direccion, ciudad: fcli.ciudad, cp: fcli.cp, cuenta: fcli.cuenta, entidad: fcli.entidad, telefono: fcli.telefono, correo: fcli.correo, contactResourceName: "",
      tipoRelacion: fcli.tipoRelacion || "cliente",
      comisionDefault: esPunto ? { tipo: fcli.comisionDefaultTipo || "porcentaje", valor: num(fcli.comisionDefaultValor) } : null,
      roster: []
    };
    state.clientes.unshift(nuevo);
    state.formCliente = { nombre: "", cedula: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", telefono: "", correo: "", tipoRelacion: "cliente", comisionDefaultTipo: "porcentaje", comisionDefaultValor: "" };
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
    state.clienteEditando = el.getAttribute("data-id");
    notify();
  },
  "cancelar-edicion-cliente": function () {
    state.clienteEditando = "";
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
    state.clientes = state.clientes.map(function (c) {
      if (c.id !== id) return c;
      return Object.assign({}, c, {
        nombre: nombre,
        cedula: val(fila, "edit-cedula"),
        telefono: val(fila, "edit-telefono"),
        correo: val(fila, "edit-correo"),
        direccion: val(fila, "edit-direccion"),
        ciudad: val(fila, "edit-ciudad"),
        cp: val(fila, "edit-cp"),
        cuenta: val(fila, "edit-cuenta"),
        entidad: val(fila, "edit-entidad"),
        tipoRelacion: tipoRelacion,
        comisionDefault: tipoRelacion === "punto_consignacion" ? { tipo: comTipoEl ? comTipoEl.value : "porcentaje", valor: num(val(fila, "edit-comision-valor")) } : null
      });
    });
    state.clienteEditando = "";
    persist("clientes"); notify();
    var actualizado = state.clientes.filter(function (c) { return c.id === id; })[0];
    if (actualizado) sincronizarClienteContacto(actualizado);
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
