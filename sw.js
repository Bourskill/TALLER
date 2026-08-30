// Service worker: hace que la app se pueda "instalar" (aparezca el botón del
// navegador y quede como un ícono propio, sin barra de direcciones) y que
// ABRA sin internet en vez de mostrar el error del navegador.
//
// LO QUE ESTO NO HACE: no guarda pedidos/cotizaciones/etc. sin conexión —
// esos datos viven en Google Sheets y necesitan red para leerse/escribirse.
// Eso lo resuelve la app misma (ver core/guardado.js: cola de reintento +
// copia local de lo último guardado, y core/store.js: si loadAll() no puede
// leer de la Sheet, cae a esa misma copia local en vez de mostrar la app
// vacía). Este archivo SOLO se encarga de que el HTML/CSS/JS de la app en sí
// (el "cascarón") esté disponible sin red — sin él, estar sin conexión
// significa no poder ni abrir la página.
//
// ESTRATEGIA: red primero, con reserva en caché.
//   - Se intenta SIEMPRE la red primero (así con conexión se sirve lo más
//     reciente — coherente con el `Cache-Control: no-cache` que el propio
//     hosting ya manda para todo, ver _headers).
//   - Si la red falla (sin conexión, DNS, etc.) se responde con la última
//     copia que se guardó en caché la vez anterior que sí hubo red. No hay
//     carrera contra un timeout: una red presente pero muy lenta espera a la
//     respuesta completa en vez de usar la copia rápida en caché.
//   - Nunca se toca nada que no sea de este sitio o de los CDN whitelisted
//     abajo: las llamadas a la API de Google Sheets/OAuth pasan de largo,
//     sin intervención — su manejo de fallas ya vive en la app (arriba).
//
// No hay una lista fija de archivos para mantener al día a mano (serían ~60
// entre css/ y js/modules/ y crecería con cada pestaña nueva, justo el tipo
// de redundancia que hay que evitar): el caché se llena SOLO con cada
// archivo que la app pide mientras hay conexión, la primera vez que se abre.
// Lo único precargado a mano es lo mínimo para que la página exista.

var CACHE_NAME = "taller-shell-v1";

var PRECARGA = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

var ORIGENES_CACHEABLES = [
  self.location.origin,
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECARGA); })
      // Si algo de la precarga falla (ej. sin conexión justo al instalar), no
      // se tumba la instalación entera: el resto se va a ir cacheando solo,
      // archivo por archivo, en cuanto haya red.
      .catch(function (e) { console.error("Precarga del service worker incompleta", e); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  // Solo GET: una escritura a Sheets (PUT/POST) nunca debe pasar por acá —
  // ese manejo de fallas (cola, reintento, espejo local) ya es de la app.
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (ORIGENES_CACHEABLES.indexOf(url.origin) === -1) return; // deja pasar todo lo demás tal cual (Google Sheets, OAuth...)

  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copia = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copia); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cacheado) {
        if (cacheado) return cacheado;
        // Navegación (recargar la página) sin red y sin caché todavía: al
        // menos ofrecer el cascarón si se llegó a guardar, en vez de dejar
        // que el navegador muestre su propio error genérico.
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
