// Login con Google (Google Identity Services, cargado como script clásico
// en index.html) + resolución de rol contra la pestaña "roles" de la Google
// Sheet configurada en google-config.js.
//
// Un solo consentimiento pide todos los scopes de GOOGLE_SCOPES a la vez.
// El access token de Google dura ~1h (lo dice `expires_in` en la respuesta):
// mientras no venza, la sesión se guarda en sessionStorage para que
// recargar la página (o volver a abrir la pestaña) entre directo, sin
// pasar por la pantalla de login ni abrir ningún popup de Google — ver
// restaurarSesion(), llamada desde app.js antes de mostrar el login. Pasada
// esa hora, si o cuando la cuenta ya lo tenía concedido, Google igual
// resuelve el siguiente login rápido y sin pantalla de permisos, pero sí
// necesita el clic en "Continuar con Google" (los navegadores bloquean el
// popup de OAuth si no lo dispara un clic real).
// sessionStorage (no localStorage): sobrevive a recargar la pestaña, pero
// se borra sola al cerrar el navegador/pestaña — más prudente para no dejar
// un token de acceso guardado indefinidamente en el disco.

import { GOOGLE_CLIENT_ID, SPREADSHEET_ID, GOOGLE_SCOPES } from "./google-config.js";
import { sheetsValuesGet, sheetsValuesAppend } from "./googleRest.js";

var SESSION_STORAGE_KEY = "taller_sesion_v1";
// Margen de seguridad: se considera vencido 2 minutos antes de la hora real,
// para no arrancar a usar un token que expira a mitad de la carga inicial.
var MARGEN_EXPIRACION_MS = 2 * 60 * 1000;

var session = null; // { email, rol: "admin"|"vendedor", vendedorNombre } | { email, rol: null } | null
var accessToken = null;
var tokenClient = null;

export function getSession() { return session; }
export function getAccessToken() { return accessToken; }

function guardarSesion(expiraEn) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      session: session, accessToken: accessToken, expiraEl: Date.now() + (Number(expiraEn) || 3600) * 1000
    }));
  } catch (e) { /* almacenamiento no disponible (modo privado, etc.) — no es crítico */ }
}

// Se llama al arrancar la app, ANTES de mostrar la pantalla de login: si hay
// una sesión guardada y su token todavía no vence, la restaura en memoria y
// la devuelve (sin ningún llamado a Google) — si no, devuelve null y sigue
// el flujo normal de login.
export function restaurarSesion() {
  try {
    var raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    var datos = JSON.parse(raw);
    if (!datos || !datos.session || !datos.accessToken || !datos.expiraEl) return null;
    if (Date.now() + MARGEN_EXPIRACION_MS >= datos.expiraEl) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    session = datos.session;
    accessToken = datos.accessToken;
    return session;
  } catch (e) {
    return null;
  }
}

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
        guardarSesion(resp.expires_in);
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
  try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch (e) { /* nada que limpiar */ }
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

// Correos de TODOS los demás con acceso a la app (admin o vendedor, salvo
// uno mismo) en la pestaña "roles" — lo usa core/drive.js para compartir la
// carpeta de imágenes del admin con todo el equipo, no solo vendedores (un
// segundo admin también necesita permiso de escritura ahí, es una cuenta de
// Google distinta con su propio acceso a Drive).
export async function listarEquipoEmail() {
  var filas = await leerFilasRoles(accessToken);
  var propio = (session && session.email) || "";
  return filas
    .map(function (f) { return (f[0] || "").trim(); })
    .filter(function (email) { return email && email.toLowerCase() !== propio.toLowerCase(); });
}

// Agrega un correo a la pestaña "roles" — antes esto se hacía a mano editando
// la Sheet directamente. Junto con core/drive.js: compartirRecursosConNuevoMiembro()
// (llamados los dos desde Configuración → "Equipo"), esto reduce "agregar a
// alguien" a un solo paso dentro de la app en vez de tres manuales — el único
// paso que sigue quedando afuera es agregarlo como *test user* en Google
// Cloud Console → OAuth consent screen, que no tiene ninguna API pública:
// es pura política de la pantalla de consentimiento mientras la app esté en
// modo Testing.
export async function agregarMiembroEquipo(correo, rol, vendedorNombre) {
  var correoNorm = (correo || "").trim().toLowerCase();
  if (!correoNorm) throw new Error("Falta el correo.");
  var filas = await leerFilasRoles(accessToken);
  var yaExiste = filas.some(function (f) { return (f[0] || "").trim().toLowerCase() === correoNorm; });
  if (yaExiste) throw new Error("Ese correo ya está en el equipo (pestaña \"roles\").");
  await sheetsValuesAppend(accessToken, SPREADSHEET_ID, "roles!A:C", [[correoNorm, rol === "admin" ? "admin" : "vendedor", vendedorNombre || ""]]);
}
