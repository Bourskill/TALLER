// Sincroniza el ícono DE VERDAD (la pestaña del navegador y el que queda al
// "Instalar app"/"Agregar a inicio") con lo que el usuario ya configuró como
// "Icono del taller" en Configuración → Marca — o directo desde el logo de
// la barra lateral (ver renderSidebar/"edit-logo" en este mismo archivo).
// Antes esos dos íconos vivían totalmente separados: subir un logo o poner
// un emoji ahí adentro no movía un pelo al favicon.png/manifest.json
// estáticos, que se quedaban con lo que fuera que trajera el archivo.
//
// Si el usuario NO ha configurado nada todavía (logoUrl vacío), esta función
// no toca nada: se deja el favicon/manifest estático de fábrica (ver
// index.html y manifest.json) — un ícono de marca por defecto, no unas
// iniciales genéricas armadas al vuelo.
import { state } from "./store.js";
import { esUrlImagen } from "./utils.js";

var ultimaFirmaAplicada = null;
var manifestBlobUrlPrevia = "";
var original = null; // hrefs de fábrica, capturados la primera vez que se llama

// Guarda cómo estaban los 4 links ANTES de tocar nada, para poder devolverlos
// tal cual si el usuario quita el logo/emoji después de haberlo puesto (ver
// "quitar-logo" en modules/config.js) — sin esto, quitarlo dejaba pegado el
// último ícono aplicado en vez de volver al de fábrica.
function capturarOriginalesSiHaceFalta() {
  if (original) return;
  original = {};
  ["link-favicon-32", "link-favicon-16", "link-apple-touch-icon", "link-manifest"].forEach(function (id) {
    var el = document.getElementById(id);
    original[id] = el ? el.getAttribute("href") : "";
  });
}

// Emoji/iniciales no tienen un archivo de imagen — se dibujan una vez sobre
// un <canvas> (mismo degradado morado de marca que el ícono por defecto) y
// se exportan como PNG en memoria (data URL). No se guarda en Drive ni en la
// Sheet: es puramente un dibujo para el navegador, se recalcula si hace falta.
function renderCanvasIcono(texto, size) {
  var canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  var ctx = canvas.getContext("2d");
  // Puede dar null en navegadores sin soporte real de <canvas> (o, en las
  // pruebas de humo, en jsdom sin el paquete opcional "canvas" instalado) —
  // se deja como si no hubiera nada que aplicar en vez de romper el render.
  if (!ctx) return null;
  var grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#7c6cff");
  grad.addColorStop(1, "#6353e8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold " + Math.round(size * 0.52) + "px -apple-system, 'Segoe UI', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, size / 2, size * 0.54);
  return canvas.toDataURL("image/png");
}

function setHref(id, href) {
  var el = document.getElementById(id);
  if (el && href) el.setAttribute("href", href);
}

export function actualizarIconoApp() {
  capturarOriginalesSiHaceFalta();
  var logo = (state.config.logoUrl || "").trim();
  var firma = logo ? (esUrlImagen(logo) ? "img:" : "emoji:") + logo + "|" + (state.config.nombre || "") : "__fabrica__";
  if (firma === ultimaFirmaAplicada) return; // ya aplicado, no repetir el trabajo
  ultimaFirmaAplicada = firma;

  if (!logo) {
    // Se quitó el logo/emoji (ver "quitar-logo"): vuelve al ícono de fábrica
    // en vez de dejar pegado el último que se había aplicado.
    Object.keys(original).forEach(function (id) { if (original[id]) setHref(id, original[id]); });
    return;
  }

  var esImagen = esUrlImagen(logo);

  var favicon32 = esImagen ? logo : renderCanvasIcono(logo, 64);
  var favicon16 = esImagen ? logo : renderCanvasIcono(logo, 32);
  var appleTouch = esImagen ? logo : renderCanvasIcono(logo, 180);
  // Si es emoji/iniciales y el navegador no puede dibujar en <canvas>, no hay
  // nada que aplicar — se deja el ícono de fábrica tal cual (ver arriba).
  if (favicon32) setHref("link-favicon-32", favicon32);
  if (favicon16) setHref("link-favicon-16", favicon16);
  if (appleTouch) setHref("link-apple-touch-icon", appleTouch);

  // Sin soporte de Blob URL no hay forma de armar un manifest en caliente —
  // el favicon ya quedó aplicado arriba, así que no es un fallo, solo el
  // límite de lo que se puede hacer en este navegador.
  if (typeof URL.createObjectURL !== "function") return;

  var icon192 = esImagen ? logo : renderCanvasIcono(logo, 192);
  var icon512 = esImagen ? logo : renderCanvasIcono(logo, 512);
  if (!icon192 || !icon512) return;

  // El manifest.json que sirve el archivo estático no puede saber cuál es EL
  // logo de este taller — cada cuenta ve la app con el suyo. Se arma uno en
  // memoria con esos mismos íconos y se cambia el <link rel="manifest"> a un
  // Blob URL apuntando a ese objeto. Esto alcanza a los navegadores basados
  // en Chromium para la PRÓXIMA vez que alguien instale la app desde este
  // dispositivo (Safari/iOS ignora el manifest para "Agregar a inicio" y usa
  // solo el apple-touch-icon de arriba, que ya quedó cubierto). Lo que esto
  // NO puede hacer es actualizar el ícono de un acceso directo QUE YA EXISTE
  // instalado: eso lo cachea el sistema operativo al momento de instalar, y
  // solo se refresca quitando el acceso directo y volviéndolo a instalar.
  var manifestObj = {
    name: "Panel del Taller",
    short_name: (state.config.nombre || "Mi Taller").trim().slice(0, 30) || "Mi Taller",
    description: "Gestión de pedidos, cotizaciones, catálogo y finanzas del taller.",
    start_url: "./index.html",
    scope: "./",
    display: "standalone",
    orientation: "any",
    background_color: "#0e1015",
    theme_color: "#0e1015",
    lang: "es",
    icons: [
      { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" }
    ]
  };
  var blob = new Blob([JSON.stringify(manifestObj)], { type: "application/manifest+json" });
  var url = URL.createObjectURL(blob);
  setHref("link-manifest", url);
  if (manifestBlobUrlPrevia) URL.revokeObjectURL(manifestBlobUrlPrevia);
  manifestBlobUrlPrevia = url;
}
