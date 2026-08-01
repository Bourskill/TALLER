// Envoltorio genérico contra la Google Calendar API (scope
// "calendar.events"), usado por modules/pendientes.js para sincronizar los
// vencimientos de deudas y gastos fijos con el Calendar de quien esté
// logueado (en la práctica, siempre el admin: es el único rol que ve la
// pestaña Pendientes). Este archivo no sabe nada de deudas/gastos fijos —
// solo sabe crear, actualizar y borrar eventos de un día en el calendario
// "primary" a partir del payload que le pasen.

import { getAccessToken } from "./auth.js";
import { fechaISOLocal } from "./utils.js";

async function calendarFetch(path, options) {
  var res = await fetch("https://www.googleapis.com/calendar/v3/" + path, Object.assign({}, options, {
    headers: Object.assign({ Authorization: "Bearer " + getAccessToken() }, (options && options.headers) || {})
  }));
  // 404/410: el evento ya no existe (lo borraron a mano desde Calendar, o el
  // id quedó desactualizado) — se trata como "no hay nada que actualizar/
  // borrar", no como error.
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    throw new Error("Google Calendar API " + res.status + ": " + body);
  }
  return res.status === 204 ? null : res.json();
}

// Crea (o actualiza, si ya existía eventId) un evento en el calendario
// principal de quien esté logueado. Devuelve el id del evento resultante
// (guárdalo para poder actualizarlo/borrarlo la próxima vez); si el eventId
// pasado ya no existe en Calendar, se crea uno nuevo en su lugar.
export async function sincronizarEvento(eventId, payload) {
  if (eventId) {
    var actualizado = await calendarFetch("calendars/primary/events/" + eventId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (actualizado) return actualizado.id;
  }
  var creado = await calendarFetch("calendars/primary/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return creado ? creado.id : "";
}

export async function eliminarEvento(eventId) {
  if (!eventId) return;
  await calendarFetch("calendars/primary/events/" + eventId, { method: "DELETE" });
}

// Arma el payload de un evento de UN día (recordatorio de vencimiento/
// entrega) a partir de un Date en hora local. Compartido por
// modules/pendientes.js, modules/notas.js y modules/pedidos.js — cada uno
// decide cuándo llamar a sincronizarEvento()/eliminarEvento() con esto.
export function eventoUnDia(titulo, descripcion, fecha) {
  var fin = new Date(fecha);
  fin.setDate(fin.getDate() + 1);
  return { summary: titulo, description: descripcion, start: { date: fechaISOLocal(fecha) }, end: { date: fechaISOLocal(fin) } };
}
