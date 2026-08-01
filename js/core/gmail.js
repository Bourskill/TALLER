// Envía un correo con un PDF adjunto usando la cuenta de Gmail de quien esté
// logueado (Cotizaciones/Pedidos → "Enviar por correo"). El PDF nunca se
// sube a ningún lado: se arma en el momento con jsPDF (ver core/pdf.js,
// opts.enviarPorCorreo) y se adjunta directo al mensaje.

import { getAccessToken } from "./auth.js";
import { esc } from "./utils.js";

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

// opts: { to, subject, bodyHtml, filename, bytes (ArrayBuffer del PDF) }
export async function enviarCorreoConAdjunto(opts) {
  var boundary = "panel_taller_mail_" + Date.now();
  var mensaje =
    "To: " + opts.to + "\r\n" +
    "Subject: " + rfc2047(opts.subject) + "\r\n" +
    "MIME-Version: 1.0\r\n" +
    "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: text/html; charset=\"UTF-8\"\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    utf8ToBase64(opts.bodyHtml) + "\r\n\r\n" +
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

// Arma un correo HTML "de empresa" (encabezado con el nombre/color del
// taller, saludo, mensaje corto y un aviso del PDF adjunto) en vez del texto
// plano de antes — los clientes de correo modernos (Gmail, Outlook, Apple
// Mail) renderizan HTML simple con estilos inline sin ningún problema.
// opts: { cfg (state.config), saludo, mensaje, docTitulo }
export function plantillaCorreoHtml(opts) {
  var cfg = opts.cfg || {};
  var color = cfg.colorAcento || "#6a59f0";
  var nombre = cfg.nombre || "Mi Taller";
  var logo = (cfg.logoUrl || "").trim();
  var logoEsImagen = /^(https?:|data:)/.test(logo);
  var pieContacto = [cfg.direccion, cfg.ciudad, cfg.telefono].filter(Boolean).join(" · ");
  var parrafos = String(opts.mensaje || "").split("\n").map(function (l) {
    return l.trim() ? '<p style="margin:0 0 10px;">' + esc(l) + "</p>" : "";
  }).join("");
  return '<!doctype html><html><body style="margin:0;padding:24px;background:#f2f2f5;font-family:Segoe UI,Helvetica,Arial,sans-serif;">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6ec;">' +
    '<div style="background:' + esc(color) + ';padding:22px 28px;">' +
    '<div style="color:#ffffff;font-size:19px;font-weight:700;">' + (logo && !logoEsImagen ? esc(logo) + " " : "") + esc(nombre) + "</div>" +
    "</div>" +
    '<div style="padding:28px;color:#26262e;">' +
    '<div style="font-size:15px;margin-bottom:14px;">' + esc(opts.saludo || "Hola,") + "</div>" +
    '<div style="font-size:14.5px;line-height:1.55;color:#3c3c46;">' + parrafos + "</div>" +
    (opts.docTitulo ? '<div style="margin-top:18px;padding:14px 16px;background:#f7f7fb;border-left:3px solid ' + esc(color) + ';border-radius:6px;font-size:13.5px;color:#3c3c46;">📎 ' + esc(opts.docTitulo) + " adjunto en este correo (PDF)</div>" : "") +
    "</div>" +
    '<div style="padding:16px 28px;background:#faf9fc;border-top:1px solid #eeeef3;font-size:11.5px;color:#9a9aa6;">' +
    esc(nombre) + (pieContacto ? " · " + esc(pieContacto) : "") +
    "</div></div></body></html>";
}
