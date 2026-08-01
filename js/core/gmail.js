// Envía un correo con un PDF adjunto usando la cuenta de Gmail de quien esté
// logueado (Cotizaciones/Pedidos → "Enviar por correo"). El PDF nunca se
// sube a ningún lado: se arma en el momento con jsPDF (ver core/pdf.js,
// opts.enviarPorCorreo) y se adjunta directo al mensaje.

import { getAccessToken } from "./auth.js";

// Trucos estándar para meter texto UTF-8 (tildes/eñes) dentro de un mensaje
// de correo, que solo puede llevar bytes ASCII: primero se pasa a UTF-8
// "escapado" y de ahí a base64 normal.
function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function rfc2047(str) {
  return "=?UTF-8?B?" + utf8ToBase64(str) + "?=";
}
function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// opts: { to, subject, body, filename, bytes (ArrayBuffer del PDF) }
export async function enviarCorreoConAdjunto(opts) {
  var boundary = "panel_taller_mail_" + Date.now();
  var mensaje =
    "To: " + opts.to + "\r\n" +
    "Subject: " + rfc2047(opts.subject) + "\r\n" +
    "MIME-Version: 1.0\r\n" +
    "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: text/plain; charset=\"UTF-8\"\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    utf8ToBase64(opts.body) + "\r\n\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: application/pdf; name=\"" + opts.filename + "\"\r\n" +
    "Content-Disposition: attachment; filename=\"" + opts.filename + "\"\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    arrayBufferToBase64(opts.bytes) + "\r\n" +
    "--" + boundary + "--";

  var raw = btoa(mensaje).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  var res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + getAccessToken(), "Content-Type": "application/json" },
    body: JSON.stringify({ raw: raw })
  });
  if (!res.ok) {
    var errText = await res.text().catch(function () { return ""; });
    throw new Error("Gmail API " + res.status + ": " + errText);
  }
  return res.json();
}
