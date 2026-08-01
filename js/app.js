// Punto de entrada. A diferencia de antes, ya no carga los datos de una vez:
// primero exige login con Google y resuelve el rol (ver core/auth.js) contra
// la pestaña "roles" de la Google Sheet configurada en core/google-config.js.
//
// Importante: core/store.js decide UNA sola vez, al cargarse, si hay storage
// disponible (`STORAGE_OK`, evaluado al leer `window.storage` en ese
// instante). Por eso store.js (y todo lo que lo importa: core/dom.js,
// core/calc.js, los módulos de pestaña) se importa acá con `import()`
// dinámico DESPUÉS de asignar `window.storage = sheetsStorage` — si se
// importara con un `import` estático arriba de este archivo, se evaluaría
// antes del login y STORAGE_OK quedaría en `false` para siempre.

import { login, restaurarSesion } from "./core/auth.js";
import { sheetsStorage } from "./core/sheetsStorage.js";
import { esc } from "./core/utils.js";
import { GOOGLE_CLIENT_ID, SPREADSHEET_ID } from "./core/google-config.js";

var app = document.getElementById("app");

function renderConfigPendiente() {
  return '<div class="login-screen"><div class="login-card">' +
    '<div class="login-title">Falta terminar la configuración de Google</div>' +
    '<div class="login-sub">Completa <code>GOOGLE_CLIENT_ID</code> y <code>SPREADSHEET_ID</code> en ' +
    '<code>js/core/google-config.js</code> (ver README) antes de poder iniciar sesión.</div>' +
    "</div></div>";
}

function renderLogin(error) {
  return '<div class="login-screen"><div class="login-card">' +
    '<div class="login-title">Panel del Taller</div>' +
    '<div class="login-sub">Inicia sesión con tu cuenta de Google para entrar. Lo que veas adentro depende del correo con el que entres.</div>' +
    (error ? '<div class="error-box">' + esc(error) + "</div>" : "") +
    '<button class="btn" id="btn-login">Continuar con Google</button>' +
    "</div></div>";
}

function renderAccesoDenegado(email) {
  return '<div class="login-screen"><div class="login-card">' +
    '<div class="login-title">Acceso no autorizado</div>' +
    '<div class="login-sub">El correo <b>' + esc(email) + "</b> no está habilitado para entrar a este panel. Pídele al administrador que lo agregue en la pestaña \"roles\" de la hoja de datos.</div>" +
    '<button class="btn ghost" id="btn-reintentar">Probar con otra cuenta</button>' +
    "</div></div>";
}

async function entrarConSesion(session) {
  window.storage = sheetsStorage;
  var store = await import("./core/store.js");
  var domMod = await import("./core/dom.js");
  if (session.rol === "vendedor") store.state.tab = "mis-ventas";
  await store.loadAll();
  domMod.render();
  // Chequeo oportunista del respaldo diario (ver core/backup.js): no bloquea
  // el primer render, y no hace nada si ya se corrió en las últimas 24h o si
  // quien entra no es admin.
  var backup = await import("./core/backup.js");
  backup.respaldarSiCorresponde();
}

async function intentarLogin() {
  app.innerHTML = renderLogin();
  document.getElementById("btn-login").addEventListener("click", async function () {
    try {
      var session = await login();
      if (!session.rol) { mostrarAccesoDenegado(session.email); return; }
      await entrarConSesion(session);
    } catch (e) {
      console.error(e);
      app.innerHTML = renderLogin(e && e.message ? e.message : "No se pudo iniciar sesión.");
      document.getElementById("btn-login").addEventListener("click", intentarLogin);
    }
  });
}

function mostrarAccesoDenegado(email) {
  app.innerHTML = renderAccesoDenegado(email);
  document.getElementById("btn-reintentar").addEventListener("click", intentarLogin);
}

if (GOOGLE_CLIENT_ID.indexOf("PENDIENTE") === 0 || SPREADSHEET_ID.indexOf("PENDIENTE") === 0) {
  app.innerHTML = renderConfigPendiente();
} else {
  // Si hay una sesión guardada (sessionStorage) con un token que todavía no
  // vence, entra directo — sin pantalla de login, sin popup de Google. Ver
  // el comentario de restaurarSesion() en core/auth.js.
  var restaurada = restaurarSesion();
  if (restaurada && restaurada.rol) {
    entrarConSesion(restaurada);
  } else {
    intentarLogin();
  }
}
