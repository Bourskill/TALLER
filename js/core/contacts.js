// Sincroniza los Clientes registrados con los Contactos de Google de quien
// esté logueado (People API, scope "contacts") — igual que Calendar con
// Pedidos: cada quien (admin o vendedor) ve en SU propio celular/Contactos
// los clientes que él mismo gestiona, no hay una lista "compartida" (Google
// People API no tiene equivalente a una carpeta de Drive compartida entre
// cuentas distintas).
//
// A diferencia de Drive/Calendar, la People API exige mandar el `etag`
// vigente del contacto en cada actualización (control de concurrencia
// optimista) — por eso actualizar SIEMPRE pide primero el contacto actual
// (para tener su etag fresco) antes de mandar el cambio.

import { fetchGoogleConReintento } from "./auth.js";

var CAMPOS = "names,phoneNumbers,emailAddresses,addresses,biographies";

async function peopleFetch(path, options) {
  var res = await fetchGoogleConReintento("https://people.googleapis.com/v1/" + path, options);
  if (res.status === 404) return null; // el contacto ya no existe (lo borraron a mano, etc.)
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    if (res.status === 401) throw new Error("Tu sesión de Google venció. Recarga la página e inicia sesión de nuevo.");
    throw new Error("Google Contacts API " + res.status + ": " + body);
  }
  return res.status === 204 ? null : res.json();
}

function personaDesdeCliente(cliente) {
  var persona = { names: [{ givenName: cliente.nombre || "Cliente" }] };
  if (cliente.telefono) persona.phoneNumbers = [{ value: cliente.telefono, type: "mobile" }];
  if (cliente.correo) persona.emailAddresses = [{ value: cliente.correo, type: "home" }];
  if (cliente.direccion || cliente.ciudad) {
    persona.addresses = [{ streetAddress: cliente.direccion || "", city: cliente.ciudad || "", postalCode: cliente.cp || "", type: "home" }];
  }
  // El usuario de WhatsApp va en las notas porque Google Contacts no tiene un
  // campo propio para él. Así igual llega al celular y queda a mano en la
  // ficha del contacto, que es donde se busca a la hora de escribirle.
  var usuarioWpp = String(cliente.usuarioWhatsapp || "").trim().replace(/^@+/, "");
  var nota = [
    usuarioWpp ? "WhatsApp: @" + usuarioWpp : "",
    cliente.cedula ? "Cédula/RUT: " + cliente.cedula : "",
    (cliente.cuenta || cliente.entidad) ? "Cuenta: " + (cliente.cuenta || "—") + (cliente.entidad ? " (" + cliente.entidad + ")" : "") : ""
  ].filter(Boolean).join("\n");
  if (nota) persona.biographies = [{ value: "Panel del Taller\n" + nota, contentType: "TEXT_PLAIN" }];
  return persona;
}

// Crea (o actualiza, si el cliente ya tenía un resourceName guardado) el
// contacto correspondiente. Devuelve el resourceName para guardarlo en el
// propio cliente y poder actualizarlo/borrarlo la próxima vez.
//
// `resourceNamePrevio` es el identificador que ESTA cuenta tenía guardado
// para este cliente, no el de otra. Un resourceName de la People API solo
// existe dentro de la cuenta que lo creó: cuando había un único campo
// compartido entre todos los usuarios del taller, el de cada quien pisaba al
// del anterior y, al no encontrarlo, se creaba un contacto nuevo — así que
// cada persona terminaba acumulando duplicados en su agenda. Por eso quien
// llama guarda un identificador POR CUENTA (ver contactResourceNames en
// modules/clientes.js) y pasa acá el que corresponde.
export async function sincronizarContacto(cliente, resourceNamePrevio) {
  var persona = personaDesdeCliente(cliente);
  var previo = resourceNamePrevio || "";
  if (previo) {
    // Se pide el contacto actual para tener su etag vigente — la People API
    // rechaza el update si el etag no coincide con el que tiene guardado.
    var actual = await peopleFetch(previo + "?personFields=" + CAMPOS, { method: "GET" });
    if (actual) {
      persona.etag = actual.etag;
      var actualizado = await peopleFetch(previo + ":updateContact?updatePersonFields=" + CAMPOS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persona)
      });
      if (actualizado) return actualizado.resourceName;
      // Si updateContact tampoco devolvió nada (raro, pero por si acaso),
      // se sigue de largo y se crea uno nuevo abajo.
    }
  }
  // Sin esto, la People API crea el contacto igual pero NO lo asigna al
  // grupo "Mis contactos" — queda "invisible" en Google Contacts (web,
  // celular) salvo que se busque por API directamente. Solo hace falta al
  // CREAR: la membresía queda guardada, no hay que reenviarla en cada update.
  persona.memberships = [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } }];
  var creado = await peopleFetch("people:createContact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(persona)
  });
  return creado ? creado.resourceName : "";
}

export async function eliminarContacto(resourceName) {
  if (!resourceName) return;
  await peopleFetch(resourceName + ":deleteContact", { method: "DELETE" });
}
