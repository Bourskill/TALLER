// Login con Google (Google Identity Services, cargado como script clásico
// en index.html) + resolución de rol contra la pestaña "roles" de la Google
// Sheet configurada en google-config.js.
//
// Un solo consentimiento pide todos los scopes de GOOGLE_SCOPES a la vez —
// hoy solo Sheets + identificar el correo. La sesión vive en memoria: al
// recargar la página hay que volver a entrar (Google lo resuelve rápido,
// sin pantalla de permisos de nuevo, si la cuenta ya los concedió antes).

import { GOOGLE_CLIENT_ID, SPREADSHEET_ID, GOOGLE_SCOPES } from "./google-config.js";
import { sheetsValuesGet } from "./googleRest.js";

var session = null; // { email, rol: "admin"|"vendedor", vendedorNombre } | { email, rol: null } | null
var accessToken = null;
var tokenClient = null;

export function getSession() { return session; }
export function getAccessToken() { return accessToken; }

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error("No se pudo cargar el script de Google (revisa tu conexión a internet o que accounts.google.com no esté bloqueado).");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: function () {} // se reemplaza en cada login() con el callback de esa llamada puntual
  });
  return tokenClient;
}

// Pide el consentimiento (o lo renueva en silencio si ya fue otorgado antes)
// y resuelve el correo + rol. Devuelve la sesión resultante.
export function login() {
  return new Promise(function (resolve, reject) {
    var client = ensureTokenClient();
    client.callback = async function (resp) {
      if (resp.error) { reject(new Error(resp.error)); return; }
      accessToken = resp.access_token;
      try {
        session = await resolverSesion(accessToken);
        resolve(session);
      } catch (e) {
        reject(e);
      }
    };
    client.requestAccessToken({ prompt: "" });
  });
}

export function logout() {
  if (accessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, function () {});
  }
  session = null;
  accessToken = null;
}

function leerFilasRoles(token) {
  return sheetsValuesGet(token, SPREADSHEET_ID, "roles!A2:C1000");
}

async function resolverSesion(token) {
  var userInfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + token }
  }).then(function (r) { return r.json(); });

  var email = (userInfo.email || "").toLowerCase();
  var filas = await leerFilasRoles(token);
  var fila = filas.find(function (f) { return (f[0] || "").trim().toLowerCase() === email; });

  if (!fila) return { email: email, rol: null };
  var rol = (fila[1] || "").trim().toLowerCase();
  return { email: email, rol: rol === "admin" ? "admin" : "vendedor", vendedorNombre: (fila[2] || "").trim() };
}

// Correos de todos los vendedores en la pestaña "roles" — lo usa
// core/drive.js para compartir automáticamente la carpeta de imágenes del
// admin con cada uno la primera vez que se crea.
export async function listarVendedoresEmail() {
  var filas = await leerFilasRoles(accessToken);
  return filas
    .filter(function (f) { return (f[1] || "").trim().toLowerCase() === "vendedor"; })
    .map(function (f) { return (f[0] || "").trim(); })
    .filter(Boolean);
}
