# Panel del Taller — arquitectura modular

Esta es la misma aplicación que tenías en un solo `script.js` de ~900 líneas,
dividida en módulos por área de negocio. El comportamiento es **idéntico al
original** (verificado con un test de humo, ver abajo); lo que cambió es solo
la organización del código. El objetivo: que atacar "Finanzas" o "Cotizaciones"
como proyectos separados no obligue a leer ni tocar el resto de la app.

No se agregó ningún framework ni build step: sigue siendo HTML + CSS + JS
plano, cargado directo por el navegador vía `<script type="module">` (soportado
en todos los navegadores modernos). Simplemente se usa `import`/`export` de
JavaScript para separar archivos en vez de tenerlo todo concatenado.

## Regla de UX: sin texto explicativo duplicado (no revertir esto)

La app usa un ícono "?" (`renderHelp()` en `core/components.js`) para sacar
los párrafos explicativos largos del flujo visual — quedan ocultos hasta que
el usuario pasa el mouse o toca el ícono. **Un panel/sección no debe tener,
además del "?", un párrafo visible por defecto que explique lo mismo.** Si
una sección ya tiene un `renderHelp(...)`, cualquier texto adicional debajo
(`section-sub`, `<small>`, etc.) tiene que ser información nueva y corta
(un dato dinámico, una unidad, un ejemplo de formato) — nunca una repetición
o expansión de lo que ya dice el tooltip. En la entrega de julio 2026 se
habían acumulado varios de estos textos duplicados (`pedidos.js`,
`pendientes.js`) y se recortaron; si en el futuro un panel necesita más
contexto, el lugar es el `renderHelp()` de esa sección, no un párrafo aparte.

## Registro de cambios — julio 2026

Ronda de correcciones reportadas por el usuario:

- **PDF**: los nombres de archivo ya conservan tildes/eñes (`_básica_`, no
  `_b_sica_`) — nuevo helper `slugify()` en `core/utils.js`.
- **PDF de producción**: ya no imprime "ESTADO: COTIZACIÓN" en pedidos que
  aún no avanzan de etapa (se renombró el estado inicial de `"cotizacion"` a
  `"nuevo"` en `constants.js`); en su lugar indica si es producción propia o
  de un tercero.
- **Deudas** (`pendientes.js`): rediseño completo. Concepto, monto, cuotas,
  periodo y día(s) de pago se capturan todos en el formulario inicial (antes
  el periodo solo se podía definir después de crear la deuda). El botón de
  "estado" dejó de ser un toggle libre: ahora hay **Pagar** (registra la
  cuota siguiente o el saldo completo como gasto en Finanzas y lo deja en un
  historial por deuda), **Editar** (modo edición explícito con Guardar/
  Cancelar) y **✕** (eliminar).
- **Cuentas por pagar**: ahora muestra un desglose por categoría (gastos
  fijos, nómina, deudas, comisiones de vendedores) con el detalle de cada
  obligación y su fecha, además del total. El panel aparte de "Comisiones de
  vendedores" se eliminó porque quedó cubierto por este desglose.
- **Finanzas**: se eliminó el campo/columna "Estado" (pagado/pendiente) de
  los movimientos — un movimiento registrado siempre es dinero que ya se
  movió; lo que aún no se paga vive en Pendientes (cuentas por pagar) o en el
  saldo del pedido (cuentas por cobrar), nunca como un `tx` a medias.
- **Modo claro**: agregado (botón de sol/luna en la barra superior), con
  variables CSS completas en `css/variables.css` y persistencia en
  `state.ui.tema`.
- **Notas**: campo de fecha opcional.
- **Pedidos**: cada abono se puede editar directamente desde la tarjeta del
  pedido (antes solo desde Movimientos), sincronizado con el movimiento de
  Finanzas vinculado.
- **Plantillas de prendas**: se puede asociar un flujo de producción (etapas)
  guardado en Cotizaciones a cada tipo de prenda — por ejemplo, una prenda
  que lleva sublimación. Al aplicar la plantilla, el flujo se carga junto con
  los insumos.
- **Configuración → Reporte financiero**: ahora se puede generar un PDF del
  periodo (con atajos de "Hoy / Esta semana / Este mes / Este año" o fechas
  de corte personalizadas), con el detalle de movimientos y totales por tipo.
- **KPI "Pedidos activos"**: se corrigió el texto que decía "En cotización o
  producción" (mezclaba conceptualmente pedidos con cotizaciones) por "Solo
  pedidos (no cuenta cotizaciones)" — el cálculo en sí ya solo contaba
  pedidos, nunca sumó cotizaciones.
- **Clientes**: se agregó el campo "Correo".

## Login con Google + roles + Google Sheets como base de datos

`window.storage` (de donde la app leía/guardaba todo) **nunca existió en el
sitio publicado** — solo funcionaba dentro del entorno donde se escribió el
código originalmente. En Netlify, nada se guardaba entre recargas. Esto ya
se resolvió: ahora la app pide login con Google y usa una Google Sheet
compartida como base de datos real (ver `js/core/sheetsStorage.js`), y de
paso controla quién ve qué (panel completo para admin, una vista acotada de
ventas para vendedores — ver `js/modules/mis-ventas.js` y el filtrado de
menú en `js/core/dom.js`).

Para dejarlo funcionando hace falta un setup de una sola vez en Google
Cloud, fuera del código:

1. **Google Cloud Console** → crear un proyecto → habilitar la **Google
   Sheets API**, la **Google Drive API**, la **Gmail API** y la **Google
   Calendar API**.
2. **Pantalla de consentimiento OAuth** → tipo Externo, modo **Testing**
   (evita el proceso de verificación de Google) → agregar como *test users*
   tu correo y el de cada vendedor que vaya a entrar.
3. **Credenciales** → crear un **OAuth Client ID** de tipo "Web application"
   → en "Authorized JavaScript origins" agregar `https://criyeak.netlify.app`
   y `http://localhost:8080` (o el origen que uses en desarrollo).
4. **Google Sheets** → crear una hoja nueva (ej. "Panel del Taller — datos")
   → compartirla como **Editor** con tu cuenta y con la de cada vendedor →
   crear dos pestañas dentro:
   - `kv` con encabezados `key` | `value` (queda vacía; la app la llena sola).
   - `roles` con encabezados `correo` | `rol` | `vendedor_nombre`. Agrega ahí
     tu propio correo con `rol = admin`, y uno por vendedor con
     `rol = vendedor` y el mismo nombre que uses en el campo "Vendedor" de
     Pedidos/Cotizaciones (así "Mis ventas" cruza sus datos correctamente).
5. Copiar el **Client ID** (paso 3) y el **ID de la spreadsheet** (se ve en
   su URL, entre `/d/` y `/edit`) en `js/core/google-config.js`. Ninguno de
   los dos es secreto — el acceso real lo controla a quién compartiste la
   hoja, no quién conoce estos valores.

Con eso completo, recargar la app: debe pedir "Continuar con Google", un
solo consentimiento (Sheets + Drive + tu correo), y entrar según lo que diga
tu fila en `roles`. Un correo que no esté en esa pestaña ve "Acceso no
autorizado".

### Imágenes de referencia → Google Drive (carpeta del admin)

En Cotizaciones, la miniatura de cada referencia ("+ imagen") ahora sube un
archivo desde el dispositivo (antes solo se podía pegar un link externo).
Ver `js/core/drive.js`. Detalles a tener en cuenta:

- Todas las imágenes (las subas vos o un vendedor) caen en **una sola
  carpeta "Panel del Taller — imágenes" dentro de tu Drive** (el del admin),
  no en el Drive personal de cada vendedor. La crea automáticamente la
  primera vez que **vos** (admin) subís una imagen — si un vendedor la sube
  antes de que exista, ve un aviso pidiéndole que esperes a que la crees.
- Al crearla, la comparte automáticamente (permiso de Editor, sin mandar
  correo de aviso) con cada correo que figure como `rol = vendedor` en la
  pestaña `roles` — así sus subidas también van a esa misma carpeta sin que
  tengas que compartir nada a mano.
- Cada imagen queda además con permiso "cualquiera con el link puede ver" —
  así la miniatura y los PDF la pueden mostrar sin pedir login, igual que
  antes con un link externo cualquiera.
- Por esto necesita el scope amplio `drive` (no `drive.file`): un vendedor
  tiene que poder escribir dentro de una carpeta que no creó él. Es un scope
  "sensible" de Google — no pide verificación mientras seas de las cuentas
  agregadas como *test user* (paso 2 de arriba), pero si algún día publicás
  la app "en producción" con más de 100 usuarios, Google sí la va a pedir.
- **Matiz honesto**: Google no deja transferir por API la propiedad de un
  archivo a otra cuenta personal (@gmail.com) sin que esa cuenta la acepte a
  mano — no existe forma de automatizar eso sin un backend propio. En la
  práctica esto no importa (todo queda organizado y visible desde tu cuenta,
  en esa carpeta), pero si te fijás en el "propietario" de un archivo que
  subió un vendedor, va a decir su cuenta, no la tuya — y ese archivo cuenta
  contra el almacenamiento de esa cuenta, no el tuyo.

### Enviar PDFs al cliente por Gmail

En Cotizaciones ("✉ Enviar por correo") y en Pedidos ("✉ Enviar factura" /
✉ junto a cada recibo) hay un botón para mandarle el PDF al cliente por
correo en vez de solo descargarlo. Ver `js/core/gmail.js`.

- Usa el correo del **cliente registrado** (el campo "Correo" que se agregó
  en Clientes) — si la cotización/pedido no tiene un cliente vinculado con
  correo, el botón avisa y no manda nada.
- El correo sale de la cuenta de Gmail de quien esté logueado (admin o
  vendedor) usando el scope `gmail.send` — que solo permite ENVIAR, no leer
  la bandeja de entrada de nadie.
- El PDF se arma en el momento (igual que "Descargar PDF") y se adjunta
  directo al mensaje — no pasa por Drive ni se sube a ningún lado intermedio.

### Vencimientos de Pendientes → Google Calendar

En Pendientes, cada deuda y cada gasto fijo se sincroniza automáticamente
(sin ningún botón que apretar) con el Calendar de quien esté logueado como
admin — es el único rol que ve esta pestaña, así que siempre es el Calendar
del admin, nunca el de un vendedor. Ver `js/core/calendar.js` (envoltorio
genérico de la API) y los helpers `sincronizarEventoDeuda`/
`sincronizarEventoGastoFijo` en `js/modules/pendientes.js`.

- **No es una serie recurrente**: cada obligación tiene, como mucho, UN
  evento de un solo día con su PRÓXIMO vencimiento (el mismo que ya calcula
  `calcFechaVencimientoPeriodo()` para el KPI "Por pagar"). Ese evento se
  mueve hacia adelante, se actualiza o se borra solo cada vez que agregas,
  editas, pagas o eliminas la deuda/el gasto fijo — no hace falta un cron ni
  un backend para "adivinar" cuándo crear el siguiente, porque cada acción
  del usuario ya dispara el recálculo. La contrapartida honesta: si nadie
  toca Pendientes durante varios periodos seguidos, el evento no avanza
  solo con el paso del tiempo (recién se actualiza la próxima vez que
  interactúes con esa obligación).
- Una deuda con cuotas muestra el contador en el título del evento (ej.
  "cuota 2/6"); al pagar la última cuota, el evento se borra (la deuda se
  mueve entera al historial, donde ya no hace falta recordatorio).
- Un gasto fijo marcado como "pagado este periodo" borra su evento (no tiene
  sentido seguir recordando algo que ya se pagó); en cuanto vuelve a estar
  pendiente (nuevo periodo), se vuelve a crear con la fecha del siguiente
  vencimiento.
- Usa el scope `calendar.events` (solo crear/editar/borrar eventos, no ver
  la lista de calendarios de nadie).
- Requiere habilitar la **Google Calendar API** en el mismo proyecto de
  Google Cloud Console (paso 1 de arriba) — si no está habilitada, la
  sincronización falla en silencio (queda solo en la consola del navegador,
  con `console.error`) sin bloquear el guardado real de la deuda/gasto fijo.
  Si el admin ya tenía sesión iniciada antes de este cambio, necesita
  cerrar sesión y volver a entrar una vez para que Google le pida el nuevo
  permiso de Calendar.

Contacts (sync de Clientes) queda para cuando se aborde esa fase — suma su
propio scope en `google-config.js` sin tocar lo ya armado acá.

## Estructura

```
index.html
css/
  variables.css      tokens de color/radios — cambia el tema completo
  base.css            reset + contenedor
  layout.css           header, tabs, kpis, cards, títulos de sección
  forms.css             inputs, botones, chips, filtros (compartido)
  tables.css             filas de transacciones (tx-row), tags, montos
  pedidos.css              solo pestaña Pedidos
  cotizaciones.css         solo pestaña Cotizaciones
  clientes.css             solo pestaña Clientes
  pendientes.css           solo pestaña Pendientes
  config.css               solo pestaña Configuración
  responsive.css       media queries transversales
js/
  app.js              punto de entrada: login con Google, luego carga datos y pinta
  core/
    constants.js       ESTADOS, KEYS de storage, config por defecto
    utils.js            funciones puras: fmt, esc, uid, num...
    google-config.js      Client ID + ID de la Sheet (completar tras el setup, ver abajo)
    auth.js                login/logout con Google + resuelve el rol contra la pestaña "roles"
    googleRest.js           fetch genérico contra la API de Google Sheets
    sheetsStorage.js          adaptador get/set contra la pestaña "kv" (reemplaza window.storage)
    drive.js                   sube imágenes de referencia a la carpeta compartida del admin
    gmail.js                    envía PDFs (cotización/factura/recibo) al correo del cliente
    calendar.js                   crea/actualiza/borra eventos de vencimiento en el Calendar del admin
    store.js             *el* estado global + persistencia + notify()
    calc.js               todo lo derivado del estado (caja, márgenes, ventas por vendedor...)
    components.js          piezas de HTML compartidas (combobox de cliente)
    dom.js                 orquestador: layout fijo + registro de acciones + filtro por rol
  modules/
    resumen.js, finanzas.js, pedidos.js, cotizaciones.js,
    clientes.js, pendientes.js, config.js, mis-ventas.js (solo rol vendedor)
                         una pestaña = un archivo = su render() + sus actions
test/
  smoke.mjs            recorre la app simulando clicks reales (Node + jsdom)
```

## Cómo trabajar sobre un área sin romper las demás

Cada módulo de pestaña exporta dos cosas:

```js
export function render() { /* devuelve el HTML de la pestaña */ }
export var actions = { "add-tx": function(el){ ... }, ... };
```

`actions` es un mapa `nombre-de-acción → función`. El HTML solo necesita
`data-action="add-tx"` en un botón, o `data-action-change="set-ref-precio"`
en un input, y el orquestador (`core/dom.js`) lo conecta solo — el módulo
nunca tiene que llamar a `addEventListener` ni saber cómo se disparó.

Cuando una acción cambia el estado, termina con:

```js
persist("tx");  // opcional: solo si hay que guardar esa área en storage
notify();       // pide un re-render a quien esté escuchando
```

`notify()` es la única forma en que un módulo "avisa" que algo cambió. Ningún
módulo de pestaña importa `core/dom.js`, así que se puede editar o incluso
borrar un módulo entero sin arriesgar un import circular en el resto.

Patrones genéricos ya disponibles para cualquier pestaña nueva:
- `data-form="X" data-field="Y"` → escribe en vivo en `state.formX.y`.
- `data-live-filter="clave"` → escribe en vivo en `state.clave` (búsquedas).
- `data-action="nombre"` / `data-action-change="nombre"` → dispara `actions.nombre`.

### Agregar una pestaña nueva
1. Crear `js/modules/mi-area.js` con `render()` y (si aplica) `actions`.
2. Importarlo y sumarlo al array `TABS` en `js/core/dom.js`.
3. Si necesita estilos propios, crear `css/mi-area.css` y enlazarlo en `index.html`.

Nada más se toca. Los otros módulos ni se enteran.

## Persistencia

Cada área de negocio vive en su propia clave de `window.storage`
(`finanzas:transacciones`, `pedidos:lista`, etc. — ver `core/constants.js`).
Esto ya estaba así en el original y se mantuvo: significa que una escritura
en Pedidos nunca puede corromper los datos de Finanzas.

## Test de humo

`test/smoke.mjs` levanta la app completa en un DOM simulado (jsdom) y hace
clicks reales: crea una transacción, un cliente, un pedido con abono
automático, una cotización con referencia + insumo y la convierte en pedido,
un pendiente, una persona en nómina — y verifica el estado resultante. Sirve
como red de seguridad al refactorizar cualquier módulo.

Para correrlo:
```bash
npm install jsdom
node test/smoke.mjs
```
(`jsdom` es solo una dependencia de desarrollo para el test; la app en sí no
la necesita — no hay `package.json` en el proyecto porque no hace falta un
build step para producción.)

## Ideas para la fase 2 (por si quieres atacar cada área a fondo)

Esto es una reorganización, no un rediseño — cada área sigue teniendo el
mismo nivel de funcionalidad que antes. Algunas oportunidades reales que veo
para cuando entremos módulo por módulo:

- **Render con string-concatenation → una librería de templates ligera**
  (ej. `lit-html` vía CDN, ~5kB) eliminaría la clase de bugs de HTML mal
  escapado/mal cerrado y permitiría actualizar solo el nodo que cambió en vez
  de reescribir `innerHTML` completo en cada acción — hoy cada click reconstruye
  toda la pestaña. Lo dejaría para cuando ataquemos Cotizaciones, que es la
  vista con más HTML anidado y más fácil de romper a mano.
- **Cotizaciones → Pedidos**: ya comparten `clienteId`; el siguiente paso
  natural es que un pedido pueda referenciar los insumos/costos reales de su
  cotización de origen, para comparar rentabilidad real vs. cotizada por
  pedido individual y no solo por cotización completa.
- **Inventario y proveedores** (mencionados en el contexto del negocio) no
  existen todavía como pestaña — hoy los insumos se cargan "a mano" en cada
  cotización sin relacionarse con un catálogo. Cuando lo abordemos, conviene
  que Insumos sea su propia entidad (con costo y stock) para que Cotizaciones
  y Pedidos solo la referencien, en vez de reescribir el costo cada vez.
- **Reportes**: hoy solo hay un CSV de movimientos. Con los datos ya separados
  por área, un módulo `reportes.js` que cruce pedidos + cotizaciones + finanzas
  (ej. rentabilidad real por cliente, tiempo promedio de producción por estado)
  es agregar un archivo nuevo, no tocar los existentes.
- **Multiusuario/roles**: ya implementado (login con Google + Sheets como
  base de datos, ver la sección de arriba). Sigue pendiente el patrón
  "last-write-wins" si dos personas guardan el mismo pedido a la vez — no es
  un problema nuevo de esta fase, pero ahora es más real al haber varios
  vendedores conectados a la misma hoja simultáneamente.
- **Drive / Gmail / Calendar**: ya implementados (fotos de referencia en
  Cotizaciones, enviar PDFs por correo, vencimientos de Pendientes como
  eventos — ver las secciones de arriba).
- **Contacts**: siguiente fase de la integración con Google (sync de
  Clientes con los Contactos del admin) — aditiva sobre el login que ya
  existe, igual que las anteriores.

Ninguno de estos se implementó en esta entrega — la prioridad pedida fue
dividir primero. Dime por cuál área empezamos y la llevamos a fondo.
