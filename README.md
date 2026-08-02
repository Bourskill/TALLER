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
   Sheets API**, la **Google Drive API**, la **Gmail API**, la **Google
   Calendar API** y la **People API** (para Google Contacts).
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

### Enviar PDFs al cliente por Gmail (correo HTML)

En Cotizaciones ("✉ Enviar por correo") y en Pedidos ("✉ Enviar factura" /
✉ junto a cada recibo) hay un botón para mandarle el PDF al cliente por
correo en vez de solo descargarlo. Ver `js/core/gmail.js`.

- Usa el correo del **cliente registrado** (el campo "Correo" que se agregó
  en Clientes) — si la cotización/pedido no tiene un cliente vinculado con
  correo, el botón avisa y no manda nada.
- El correo sale de la cuenta de Gmail de quien esté logueado (admin o
  vendedor) usando el scope `gmail.send` — que solo permite ENVIAR, no leer
  la bandeja de entrada de nadie. **Funciona con cualquier destinatario**
  (Outlook, Yahoo, un correo corporativo, lo que sea) — el scope solo
  controla desde qué cuenta *sale* el correo, no a dónde puede llegar.
- El cuerpo del correo es HTML (`plantillaCorreoHtml()` en `gmail.js`), no
  texto plano: encabezado con el nombre del taller y tu color de acento
  (configurable, ver "Personalización de PDF y correos" más abajo), saludo,
  mensaje y un aviso del PDF adjunto — en vez del "Hola cliente, adjuntamos
  tu cotización" de antes.
- El PDF se arma en el momento (igual que "Descargar PDF") y se adjunta
  directo al mensaje — no pasa por Drive ni se sube a ningún lado intermedio.

### PDF: código público en vez de N.º secuencial

Cotización, factura y recibo (los 3 documentos que le llegan al cliente) ya
no muestran el N.º de PDF secuencial ni el N.º de OP interno — en su lugar
muestran un **código corto no secuencial** (ej. `#FA326468`), para que nadie
pueda deducir cuántos documentos generás. Ver `codigoPublico()` en
`core/utils.js` y `asegurarCodigoPublico()` en `core/pdf.js`.

- Se genera UNA sola vez (al crear el pedido/cotización) y queda guardado en
  el propio registro — el mismo código se ve siempre que regeneres ese PDF,
  no cambia en cada descarga. Los pedidos/cotizaciones que ya existían antes
  de este cambio reciben su código la primera vez que generás su PDF (y
  queda guardado desde ahí).
- El nombre del archivo descargado/adjunto también usa este código en vez
  del número secuencial (ej. `FA326468-factura-camisetas.pdf`).
- El recibo de abono, que antes mostraba "OP: OP-4821" al cliente, ya no
  muestra ningún N.º de OP.
- **Internamente seguís viendo el N.º de OP secuencial de siempre** (tarjeta
  del pedido, búsquedas, orden de producción) — esto solo cambia lo que
  aparece en los 3 PDF que salen del taller. Los documentos internos
  (reportes, orden de producción, cotización de uso interno) siguen usando
  el contador secuencial de PDF como antes.

### Personalización de PDF y correos (Configuración)

En Configuración → "Personalización de PDF y correos": una **imagen de pie
de página** (logo, sello, firma — se sube igual que las imágenes de
referencia de Cotizaciones, a la carpeta compartida de Drive del admin, ver
`subirImagenReferencia()` en `core/drive.js`), un **texto de pie de página**
(libre) y un **color de acento** (se usa en el encabezado de los correos
HTML de arriba). La imagen se imprime centrada arriba del texto, al final de
cotización/factura/recibo/orden de producción (ver `drawPiePagina()` en
`core/pdf.js`) — ninguna de las dos es obligatoria, podés usar solo una, las
dos, o ninguna.

### Respaldo diario de la Sheet a Drive

La Google Sheet que usás como base de datos (`js/core/sheetsStorage.js`) ya
es persistente y compartida — esto agrega, ADEMÁS, una **copia de seguridad
completa** del archivo a una carpeta aparte de tu Drive ("Panel del Taller —
respaldos"), por si algún día la Sheet en uso se corrompe o se borra por
error. Ver `js/core/backup.js`.

- **No es un cron real**: la app no tiene backend, así que "cada 24h" es un
  chequeo oportunista — cada vez que vos (admin) abrís la app, si ya pasaron
  24h desde el último respaldo, se dispara uno nuevo en segundo plano (no
  bloquea el primer render). Si un día no abrís la app, ese día no hay
  respaldo nuevo — la Sheet real no corre ningún riesgo, solo se atrasa la
  copia. Un respaldo verdaderamente diario sin depender de que alguien entre
  necesitaría un Google Apps Script con disparador de tiempo, que queda
  fuera de este código si en algún momento lo querés agregar.
- Usa `files.copy` de la Drive API (ya tenías el scope `drive` por las
  imágenes de referencia — no hizo falta pedir uno nuevo): cada copia es un
  archivo de Sheets independiente, con fecha en el nombre, que nunca se
  borra solo (no hay política de limpieza automática — si con el tiempo se
  acumulan muchas copias y querés borrar las viejas, se hace a mano desde
  Drive).
- En Configuración se ve la fecha del último respaldo y hay un botón
  "Respaldar ahora" para forzarlo sin esperar las 24h.
- Solo corre para el admin (es quien tiene la Sheet real en su Drive) — un
  vendedor logueado no dispara ningún respaldo.

### Vencimientos y fechas → Google Calendar

Todo lo que maneja una fecha relevante se sincroniza automáticamente (sin
ningún botón que apretar) con Google Calendar: deudas y gastos fijos en
Pendientes, notas con fecha, y la fecha de entrega de un pedido. Ver
`js/core/calendar.js` (envoltorio genérico de la API + `eventoUnDia()`,
compartido) y los helpers `sincronizarEvento*` en cada módulo
(`pendientes.js`, `notas.js`, `pedidos.js`).

- **No son series recurrentes**: cada obligación/nota/pedido tiene, como
  mucho, UN evento de un solo día con su próxima fecha relevante. Ese
  evento se mueve hacia adelante, se actualiza o se borra solo cada vez que
  agregas, editas o eliminas el registro — no hace falta un cron para
  "adivinar" cuándo crear el siguiente, porque cada acción del usuario ya
  dispara el recálculo. La contrapartida honesta: si nadie toca la app
  durante un tiempo, el evento no avanza solo con el paso del tiempo.
- **Pendientes** (deudas, gastos fijos): solo lo ve el admin, así que
  siempre corre contra SU Calendar. Una deuda con cuotas muestra el
  contador en el título (ej. "cuota 2/6"); al pagarla por completo o
  marcar un gasto fijo como pagado este periodo, el evento se borra.
- **Notas**: solo lo ve el admin (igual que Pendientes). Una nota sin fecha,
  o ya marcada como hecha, no tiene evento.
- **Pedidos**: a diferencia de los dos anteriores, lo gestionan tanto el
  admin como un vendedor — el evento se crea en el Calendar de **quien esté
  logueado en ese momento**, igual que ya hace Gmail con el envío de PDFs
  (cada quien ve en su propia agenda lo que él mismo está gestionando). Se
  sincroniza al crear/eliminar/restaurar un pedido con fecha de entrega.
- Usa el scope `calendar.events` (solo crear/editar/borrar eventos, no ver
  la lista de calendarios de nadie).
- Requiere habilitar la **Google Calendar API** en el mismo proyecto de
  Google Cloud Console (paso 1 de arriba) — si no está habilitada, la
  sincronización falla en silencio (queda solo en la consola del navegador,
  con `console.error`) sin bloquear el guardado real del registro. Si el
  admin/vendedor ya tenía sesión iniciada antes de este cambio, necesita
  cerrar sesión y volver a entrar una vez para que Google le pida el nuevo
  permiso de Calendar.

### Clientes → Google Contacts

Cada cliente registrado se sincroniza automáticamente con los Contactos de
Google de quien esté logueado — igual que Pedidos con Calendar: **no hay una
lista compartida** (la People API de Google no tiene un equivalente a la
carpeta de Drive compartida entre cuentas distintas), así que cada quien
(admin o vendedor) ve en sus propios Contactos/celular a los clientes que él
mismo gestiona. Ver `js/core/contacts.js` y los hooks en
`js/modules/clientes.js`.

- Se sincronizan nombre, teléfono, correo y dirección; la cédula/RUT y los
  datos de cuenta bancaria quedan en la nota del contacto (campo
  "biography"), no como campos estructurados (Google Contacts no tiene un
  campo nativo para eso).
- Se crea al agregar el cliente, se actualiza al editarlo (ver más abajo) y
  se borra al eliminarlo.
- A diferencia de Drive/Calendar, la People API exige mandar el `etag`
  vigente del contacto en cada actualización — por eso actualizar un
  contacto primero pide el contacto actual (para tener su etag fresco)
  antes de mandar el cambio.
- Al crearlo, se asigna explícitamente al grupo **"Mis contactos"**
  (`memberships: [{ contactGroupMembership: { contactGroupResourceName:
  "contactGroups/myContacts" } }]`) — sin esto, la API crea el contacto
  igual pero no lo muestra en el listado normal de Google Contacts (web ni
  celular), queda "invisible" salvo que se busque por API. Costó un ida y
  vuelta descubrirlo, documentado acá para no repetirlo.
- Usa el scope `contacts` (lectura/escritura completa de Contactos — no hay
  un scope más acotado tipo "solo los contactos creados por esta app").
- Es **unidireccional** (la app manda cambios a Contacts, no al revés): si
  editás el contacto directamente desde Google Contacts, ese cambio no
  vuelve a la app.

### Clientes: editar después de agregado

Antes solo se podía agregar o eliminar un cliente — ahora hay un botón
"Editar" en cada tarjeta que abre un modo de edición explícito (todos los
campos editables a la vez, con Guardar/Cancelar), mismo patrón que ya usaba
la edición de deudas en Pendientes. Guardar también dispara la
sincronización con Contacts de arriba.

### Sesión: no volver a loguearse en cada recarga

El access token de Google dura ~1 hora (la sesión antes vivía solo en
memoria: recargar la página SIEMPRE pedía volver a entrar, incluso a los
2 segundos). Ahora, mientras el token no venza, la sesión se guarda en
`sessionStorage` — recargar la pestaña (o volver a abrirla) entra directo,
sin pantalla de login ni popup de Google. Ver `restaurarSesion()` en
`js/core/auth.js`, llamada desde `app.js` antes de mostrar el login.

- `sessionStorage`, no `localStorage`: sobrevive a recargar la pestaña, pero
  se borra sola al cerrar el navegador — más prudente que dejar un token de
  acceso guardado indefinidamente en el disco.
- **Límite honesto**: pasada la hora, si necesitás volver a entrar, Google
  igual resuelve el login rápido y sin pantalla de permisos (la cuenta ya
  los concedió antes) — pero sí hace falta el clic en "Continuar con
  Google", porque los navegadores bloquean el popup de OAuth de Google si no
  lo dispara un clic real del usuario. No hay forma de saltarse eso sin
  romper la seguridad del flujo (sería justamente el tipo de cosa que un
  sitio malicioso querría hacer).

## Consignación: vender a través de un punto externo

Modelo de venta en depósito: le entregás mercancía a un local que no es tuyo
(un punto de venta), ese local no te paga por adelantado — solo cuando algo
se vende de verdad, momento en el que le corresponde una comisión (fija o un
%). Lo que no se vende, se retira y vuelve a tu inventario sin que se haya
movido plata. Se implementó reusando piezas que ya existían, sin pestaña
nueva ni concepto ajeno al resto de la app:

- **Un punto de consignación es un Cliente** con `tipoRelacion:
  "punto_consignacion"` (Clientes → campo "Tipo") y una comisión por defecto
  (`comisionDefault: { tipo, valor }`) que se precarga al enviarle mercancía.
- **Enviar mercancía es un Pedido** con la casilla "🏬 Es consignación"
  marcada (Pedidos → Nuevo pedido rápido). No pasa por el tape de etapas de
  producción (cortado/confección/…) — nace directo como "entregado" porque
  ya está producido; en su lugar, la tarjeta muestra cuánto queda disponible
  en el punto (enviado − vendido − retirado) y dos acciones: **Registrar
  venta** y **Registrar retiro**.
- **Cada venta registrada** crea un ingreso en Finanzas por lo vendido y
  calcula la comisión de esa venta puntual (no del envío completo) —
  `calcConsignacionComision()` en `core/calc.js`. La comisión pendiente
  aparece en "Por pagar" bajo su propia categoría ("Comisiones de
  consignación"), con el mismo patrón que ya usan las comisiones de
  vendedor (`calcSaldosVendedores` → `calcSaldosConsignacion`).
- **Pagar la comisión** de una venta puntual crea el gasto correspondiente en
  Finanzas y la marca como pagada — no hay un pago único por todo el pedido,
  porque un envío en consignación se vende de a poco, no todo junto.
- Un pedido en consignación no tiene "saldo por cobrar" tradicional
  (`total`/`abono` quedan en 0): el dinero entra recién con cada venta
  reportada, nunca de una vez al crear el envío.

## Plantillas de prendas: foto + curva de tallas

Reutilizando la entidad que ya existía (`state.plantillasPrendas` — insumos +
flujo de producción por tipo de prenda), sin crear un catálogo visual
aparte:

- Cada plantilla ahora puede tener una **foto** (se sube a la misma carpeta
  compartida de Drive que las imágenes de referencia de Cotizaciones — mismo
  botón, mismo `subirImagenReferencia()`). Al "Aplicar plantilla" a una
  referencia de cotización que todavía no tiene foto propia, se copia la de
  la plantilla — así una prenda que ya fotografiaste una vez no hay que
  volver a fotografiarla en cada cotización nueva.
- Cada plantilla puede definir una **curva de tallas típica** (ej. "S:2,
  M:4, L:3, XL:1"). Al aplicar la plantilla, esa curva queda sugerida en la
  referencia; el botón "Generar filas por talla" (sección "Tallas y
  observaciones") crea de una vez una fila de detalle por cada unidad de la
  curva, con la talla ya puesta — nombre/número quedan en blanco para
  completar a mano (útil en uniformes, donde el nombre/número se define
  después). Ver `parseCurvaTallas()` en `core/utils.js`.

## Roster de equipo (uniformes)

Un cliente/equipo puede guardar su **roster** (lista de jugadores: nombre,
número, talla) directamente en su ficha de Clientes — botón "🎽 Roster" en la
tarjeta. Pensado para clientes que repiten pedido cada temporada (típico en
uniformes deportivos): en vez de tipear la misma lista de 15-20 jugadores de
nuevo cada vez, se guarda una sola vez y se reutiliza.

- Se consume desde Cotizaciones: en la sección "Tallas y observaciones" de
  cualquier referencia, si la cotización tiene un cliente vinculado con
  roster, aparece "🎽 Cargar roster de [nombre]" — trae toda la lista de una
  vez como filas de detalle (tipo/observaciones quedan en blanco para esa
  referencia puntual).
- Es **unidireccional** (roster → cotización): editar el detalle de una
  cotización no actualiza el roster guardado en el cliente. El roster se
  mantiene deliberadamente en Clientes como la fuente de verdad — si el
  plantel cambia de una temporada a otra, se actualiza ahí.

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
    gmail.js                    envía PDFs por correo (HTML) al correo del cliente
    calendar.js                   crea/actualiza/borra eventos de vencimiento/entrega en Calendar
    contacts.js                    sincroniza Clientes con los Contactos de Google de quien esté logueado
    backup.js                     copia de seguridad diaria de la Sheet a una carpeta de Drive
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
- **Drive / Gmail / Calendar / Contacts**: ya implementados (fotos de
  referencia en Cotizaciones, enviar PDFs por correo HTML, vencimientos y
  fechas como eventos, Clientes sincronizados con Contactos — ver las
  secciones de arriba). Con esto se completó el roadmap original de
  integraciones "familiares" de Google (login, Sheets, Drive, Gmail,
  Calendar, Contacts).

Ninguno de estos se implementó en esta entrega — la prioridad pedida fue
dividir primero. Dime por cuál área empezamos y la llevamos a fondo.
