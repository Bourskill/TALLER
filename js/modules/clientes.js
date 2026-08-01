import { state, persist, notify } from "../core/store.js";
import { esc, uid, val } from "../core/utils.js";
import { clientesFiltrados } from "../core/calc.js";
import { sincronizarContacto, eliminarContacto } from "../core/contacts.js";
import { getSession } from "../core/auth.js";

export function render() {
  var f = state.formCliente;
  var html = '<div class="card"><div class="section-title small">Nuevo cliente</div><div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input data-form="cliente" data-field="nombre" value="' + esc(f.nombre) + '" placeholder="Nombre completo" /></div>' +
    '<div class="field"><label>Cédula / RUT</label><input data-form="cliente" data-field="cedula" value="' + esc(f.cedula) + '" placeholder="Documento" /></div>' +
    '<div class="field"><label>Teléfono</label><input data-form="cliente" data-field="telefono" value="' + esc(f.telefono) + '" placeholder="Opcional" /></div>' +
    '<div class="field"><label>Correo</label><input type="email" data-form="cliente" data-field="correo" value="' + esc(f.correo) + '" placeholder="Opcional" /></div>' +
    '<div class="field wide"><label>Dirección</label><input data-form="cliente" data-field="direccion" value="' + esc(f.direccion) + '" placeholder="Para envíos" /></div>' +
    '<div class="field"><label>Ciudad</label><input data-form="cliente" data-field="ciudad" value="' + esc(f.ciudad) + '" /></div>' +
    '<div class="field"><label>Código postal</label><input data-form="cliente" data-field="cp" value="' + esc(f.cp) + '" /></div>' +
    '<div class="field"><label>Cuenta bancaria</label><input data-form="cliente" data-field="cuenta" value="' + esc(f.cuenta) + '" placeholder="Nº de cuenta" /></div>' +
    '<div class="field"><label>Entidad</label><input data-form="cliente" data-field="entidad" value="' + esc(f.entidad) + '" placeholder="Banco" /></div>' +
    '<button class="btn" data-action="add-cliente">Agregar cliente</button>' +
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
    html += '<div class="cliente-card">' +
      '<div class="cliente-top"><span class="cliente-nombre">' + esc(c.nombre) + "</span>" +
      '<span style="display:flex;gap:6px;">' +
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
      "</div>" +
      "</div>";
  });
  return html;
}

// Modo edición explícito (Guardar/Cancelar), mismo patrón que la edición de
// deudas en pendientes.js: todos los campos quedan editables a la vez en
// vez de inputs sueltos siempre activos en la tarjeta.
function renderClienteEdit(c) {
  return '<div class="cliente-card" data-cliente-edit-row="' + c.id + '">' +
    '<div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input class="mini-input" data-role="edit-nombre" value="' + esc(c.nombre) + '" /></div>' +
    '<div class="field"><label>Cédula / RUT</label><input class="mini-input" data-role="edit-cedula" value="' + esc(c.cedula || "") + '" /></div>' +
    '<div class="field"><label>Teléfono</label><input class="mini-input" data-role="edit-telefono" value="' + esc(c.telefono || "") + '" /></div>' +
    '<div class="field"><label>Correo</label><input type="email" class="mini-input" data-role="edit-correo" value="' + esc(c.correo || "") + '" /></div>' +
    '<div class="field wide"><label>Dirección</label><input class="mini-input" data-role="edit-direccion" value="' + esc(c.direccion || "") + '" /></div>' +
    '<div class="field"><label>Ciudad</label><input class="mini-input" data-role="edit-ciudad" value="' + esc(c.ciudad || "") + '" /></div>' +
    '<div class="field"><label>Código postal</label><input class="mini-input" data-role="edit-cp" value="' + esc(c.cp || "") + '" /></div>' +
    '<div class="field"><label>Cuenta bancaria</label><input class="mini-input" data-role="edit-cuenta" value="' + esc(c.cuenta || "") + '" /></div>' +
    '<div class="field"><label>Entidad</label><input class="mini-input" data-role="edit-entidad" value="' + esc(c.entidad || "") + '" /></div>' +
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
  if (!getSession()) return;
  sincronizarContacto(cliente).then(function (resourceName) {
    if (!resourceName || cliente.contactResourceName === resourceName) return;
    var idx = state.clientes.findIndex(function (c) { return c.id === cliente.id; });
    if (idx === -1) return;
    state.clientes = state.clientes.map(function (c) { return c.id === cliente.id ? Object.assign({}, c, { contactResourceName: resourceName }) : c; });
    persist("clientes");
  }).catch(function (e) { console.error("No se pudo sincronizar el cliente con Contactos", e); });
}

export var actions = {
  "add-cliente": function () {
    var fcli = state.formCliente;
    if (!fcli.nombre) return;
    var nuevo = { id: uid(), nombre: fcli.nombre, cedula: fcli.cedula, direccion: fcli.direccion, ciudad: fcli.ciudad, cp: fcli.cp, cuenta: fcli.cuenta, entidad: fcli.entidad, telefono: fcli.telefono, correo: fcli.correo, contactResourceName: "" };
    state.clientes.unshift(nuevo);
    state.formCliente = { nombre: "", cedula: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", telefono: "", correo: "" };
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
        entidad: val(fila, "edit-entidad")
      });
    });
    state.clienteEditando = "";
    persist("clientes"); notify();
    var actualizado = state.clientes.filter(function (c) { return c.id === id; })[0];
    if (actualizado) sincronizarClienteContacto(actualizado);
  }
};
