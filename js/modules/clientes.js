import { state, persist, notify } from "../core/store.js";
import { esc, uid } from "../core/utils.js";
import { clientesFiltrados } from "../core/calc.js";

export function render() {
  var f = state.formCliente;
  var html = '<div class="card"><div class="section-title small">Nuevo cliente</div><div class="form-grid">' +
    '<div class="field"><label>Nombre</label><input data-form="cliente" data-field="nombre" value="' + esc(f.nombre) + '" placeholder="Nombre completo" /></div>' +
    '<div class="field"><label>Cédula / RUT</label><input data-form="cliente" data-field="cedula" value="' + esc(f.cedula) + '" placeholder="Documento" /></div>' +
    '<div class="field"><label>Teléfono</label><input data-form="cliente" data-field="telefono" value="' + esc(f.telefono) + '" placeholder="Opcional" /></div>' +
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
    html += '<div class="cliente-card">' +
      '<div class="cliente-top"><span class="cliente-nombre">' + esc(c.nombre) + "</span>" +
      '<button class="btn danger small" data-action="remove-cliente" data-id="' + c.id + '">Eliminar</button></div>' +
      '<div class="cliente-grid">' +
      "<div><b>Cédula/RUT:</b> " + esc(c.cedula || "—") + "</div>" +
      "<div><b>Teléfono:</b> " + esc(c.telefono || "—") + "</div>" +
      "<div><b>Dirección:</b> " + esc(c.direccion || "—") + "</div>" +
      "<div><b>Ciudad / CP:</b> " + esc(c.ciudad || "—") + (c.cp ? " / " + esc(c.cp) : "") + "</div>" +
      "<div><b>Cuenta:</b> " + esc(c.cuenta || "—") + "</div>" +
      "<div><b>Entidad:</b> " + esc(c.entidad || "—") + "</div>" +
      "</div>" +
      "</div>";
  });
  return html;
}

export var actions = {
  "add-cliente": function () {
    var fcli = state.formCliente;
    if (!fcli.nombre) return;
    state.clientes.unshift({ id: uid(), nombre: fcli.nombre, cedula: fcli.cedula, direccion: fcli.direccion, ciudad: fcli.ciudad, cp: fcli.cp, cuenta: fcli.cuenta, entidad: fcli.entidad, telefono: fcli.telefono });
    state.formCliente = { nombre: "", cedula: "", direccion: "", ciudad: "", cp: "", cuenta: "", entidad: "", telefono: "" };
    persist("clientes"); notify();
  },
  "remove-cliente": function (el) {
    var id = el.getAttribute("data-id");
    var c = state.clientes.filter(function (c) { return c.id === id; })[0];
    if (!c) return;
    if (!window.confirm('¿Eliminar a "' + c.nombre + '"?\n\nSe pierden sus datos de contacto y cuenta bancaria (cédula, dirección, teléfono, etc.) y no se puede deshacer. Sus pedidos y cotizaciones anteriores no se eliminan, solo quedan sin cliente vinculado.')) return;
    state.clientes = state.clientes.filter(function (c) { return c.id !== id; });
    persist("clientes"); notify();
  }
};
