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

## Regla: reutilizar antes de crear (no revertir esto)

Antes de escribir un componente, un botón, una barra de búsqueda, un
explorador, una tarjeta o un formulario: **buscar si ya existe uno equivalente
y reutilizarlo**. Si hace falta que se comporte distinto en un caso puntual,
se parametriza la pieza compartida — no se duplica.

El lugar de las piezas compartidas es `js/core/components.js` (HTML) y
`css/forms.css` / `css/layout.css` / `css/tables.css` (estilo). Un cálculo
compartido va a `core/calc.js`, una fórmula por concepto.

**Por qué es una regla y no una preferencia:** los estados de producción de un
pedido estaban implementados dos veces (el camino "pedido rápido" y el camino
"desde cotización"). Se actualizó uno, el otro quedó viejo, y la misma cosa se
veía distinta según por dónde hubiera entrado el pedido. La duplicación no
falla el día que se escribe: falla meses después, cuando alguien arregla una
sola copia.

Piezas compartidas que ya existen y **hay que usar** en vez de escribir otra:

| Pieza | Dónde | Qué reemplazó |
| --- | --- | --- |
| `renderBuscador()` | `core/components.js` + `.buscador` en `forms.css` | Tres barras de búsqueda distintas (`.search-bar` de Contactos, un `.field` con estilos inline en Finanzas/Pedidos, y el `<input>` suelto de los tres exploradores) |
| `renderTarjetaMini()` | `core/components.js` + `.tarjeta-grid`/`.tarjeta-mini` en `layout.css` | `.producto-card-mini`, que era la única pantalla con índice visual |
| `renderHelp()` | `core/components.js` | Párrafos explicativos sueltos en la UI |
| `etapasDe()` | `core/calc.js` | Siete resoluciones distintas de "cuáles son las etapas de esto" |
| `.chip` + `.chip-n`/`.chip-aviso`/`.chip-accion` | `forms.css` | Chips de filtro con contador, antes cada pestaña se lo inventaba |
| `.tx-row` + modificador | `tables.css` | Filas de tabla; una pestaña que necesite otra jerarquía agrega un modificador (ej. `.tx-row.insumo`), no una fila nueva |

## Regla: la facilidad manda (UI/UX)

Esta app se usa **en hora pico, llenando muchos formularios**. El criterio al
diseñar cualquier pantalla es cuánto esfuerzo le cuesta a quien la usa, no
cuánta información cabe:

- Jerarquía explícita: lo importante grande y arriba; lo accesorio detrás de un
  separador, un plegado o un `?`. **Que todo pese lo mismo es el error**, no que
  falte información.
- Mostrar un campo solo cuando aplica, en vez de dejarlo vacío ahí siempre.
- Un aviso permanente y grande solo se justifica si hay plata en riesgo. Lo
  demás va discreto (ver el dock de "sin guardar" más abajo).
- Toda lista que pueda crecer necesita buscador y contador de resultados.
- Toda alta ("+ Nuevo X") debe dejar el cursor listo para escribir, no un
  registro en blanco perdido al final de una lista.

## Regla: documentar el porqué de cada falla

Cuando se corrige un error, se deja escrito **qué fallaba, por qué fallaba y
por qué la solución es esa** — en un comentario junto al código y en el README.
Un arreglo sin su porqué es indistinguible de una preferencia arbitraria: el
siguiente que pase por ahí lo "simplifica" y reintroduce el bug. Y se suma una
prueba en `test/smoke.mjs`, que es la documentación que no se puede ignorar.

## Modo sin conexión + app instalable (PWA)

La app se puede "instalar" (el navegador ofrece un botón, queda como un ícono
propio, sin barra de direcciones — igual que Facebook o Gmail en el celular),
y sigue funcionando si se corta la conexión a mitad de una sesión: lo que se
haga se guarda en el dispositivo y se sube solo a la Sheet en cuanto vuelva la
señal. Esto tiene DOS partes bien separadas, y conviene no confundirlas:

**1. Que la app ABRA sin internet** (`manifest.json` + `sw.js`, nuevos). Un
service worker cachea el "cascarón" — el HTML/CSS/JS de la app en sí — la
primera vez que se usa con conexión, y lo sirve desde ahí si no hay red. Sin
esto, estar sin conexión significaba ni siquiera poder abrir la página: el
navegador muestra su propio error antes de que cualquier línea de JS de la
app llegue a ejecutarse.

Estrategia: red primero, con reserva en caché — se intenta SIEMPRE la red
primero (coherente con el `Cache-Control: no-cache` que `_headers` ya manda
para todo), y solo si falla se responde con la última copia guardada. No hay
una lista de archivos que mantener a mano (sería ~60 entre `css/` y
`js/modules/`, y crecería con cada pestaña nueva — justo el tipo de
redundancia que hay que evitar): el caché se llena SOLO, con cada archivo que
la app pide la primera vez que hay conexión. Verificado apagando el servidor
por completo y recargando: la app abre completa, navega entre pestañas, y
todo sigue interactivo — el único límite real es que Google Sheets (los
datos) sigue necesitando red, que es exactamente lo que resuelve la parte 2.

**2. Que los DATOS sigan funcionando sin internet** (`core/guardado.js` +
`core/store.js`). Acá NO hubo que construir un sistema nuevo — ya existía uno
bueno (la "red de seguridad del guardado": espejo local + cola de reintento,
ver el comentario al inicio de `core/guardado.js`) que resolvía la mitad del
problema: si un guardado fallaba, quedaba en una copia local y se reintentaba
solo. Lo que faltaba era la mitad de LECTURA — si se recarga la página estando
sin conexión, `loadAll()` no tenía de dónde traer los datos y la app se veía
como recién instalada, vacía, así hubiera pedidos y cotizaciones reales
esperando en la Sheet.

- **`store.js`: `loadAll()` ahora cae al mismo espejo local** cuando la
  lectura de una clave falla — antes solo lo usaba `guardarClave()` (para
  reintentar una escritura), ahora también lo alimenta y lo consulta la
  LECTURA. Cada clave que se lee con éxito refresca su copia local (así una
  clave que solo se MIRA, nunca se edita, igual queda disponible para el
  próximo arranque sin conexión); cada clave que falla al leer usa la copia
  más reciente en vez de quedar en su valor de fábrica. Con eso, recargar la
  app sin conexión muestra la última foto real de los datos, no una pantalla
  vacía. Se avisa con un toast breve y no bloqueante ("mostrando la última
  copia guardada…") — no hace falta ninguna acción, solo es bueno saberlo.
- **`sheetsStorage.js`: se corrigió un bug real, no cosmético.** La primera
  lectura de la Sheet ("kv", donde vive la mayoría de las claves) cacheaba la
  PROMESA de esa lectura para no repetirla en cada `get()`/`set()`. El
  problema: si esa primera lectura fallaba (exactamente el caso de abrir la
  app sin conexión), la promesa quedaba cacheada EN RECHAZADO para siempre —
  y como todo `get()`/`set()` futuro espera esa misma promesa, TODO el
  guardado basado en "kv" (pedidos, cotizaciones, config, casi todo salvo
  movimientos/contactos) quedaba roto por el resto de la sesión, aunque la
  conexión volviera. El reintento automático habría llamado a `set()` una y
  otra vez sin que ninguno pudiera funcionar jamás — hasta recargar la página
  a mano. Se corrigió para que un fallo resetee la promesa cacheada, así el
  siguiente intento (típicamente el reintento automático al recuperar señal)
  arranca de cero en vez de repetir el mismo rechazo. Sin este arreglo, todo
  lo demás de este apartado quedaba con un hueco serio en el caso de uso más
  probable — abrir la app justo sin conexión.
- **Mensajes de error más calmados.** Un fallo de red decía literalmente
  "Failed to fetch" en el chip de guardado — jerga de navegador, no algo que
  el usuario del taller tenga que interpretar. Cuando la causa es
  específicamente estar sin conexión (`navigator.onLine === false`), el
  mensaje pasa a ser "Sin conexión — se reintenta solo en cuanto vuelva".
- **Un chip nuevo en la barra superior** (`renderIndicadorConexion` en
  `core/dom.js`) avisa PROACTIVAMENTE al perder la señal, antes de que
  cualquier guardado llegue a fallar — así no hay que descubrirlo por
  sorpresa a mitad de un formulario. Tono informativo, no de alerta: estar
  sin conexión acá es un estado normal y previsto, no un error. Aparece y
  desaparece solo (escucha `online`/`offline` del navegador).

**Lo que esto sigue sin resolver, a propósito** (mismo límite que ya tenía el
guardado): no es sincronización entre dispositivos. Si el mismo taller se usa
sin conexión desde dos equipos a la vez, cada uno sube su propia versión al
reconectar y gana la última escritura que llegue — para más que eso haría
falta versionado por fila en la Sheet, otro proyecto. Tampoco se puede iniciar
sesión por primera vez sin conexión (el login con Google es, por naturaleza,
un ida y vuelta con los servidores de Google) — lo que sí funciona sin red es
RESTAURAR una sesión ya iniciada (`restaurarSesion()` solo mira un token
guardado localmente, sin llamar a ningún servidor) y seguir trabajando desde
ahí.

**Cinco fallas encontradas en revisión adversarial (tres revisores
independientes) sobre la primera versión de este apartado, ya corregidas:**

- **[ROMPE] La migración de "detalle de tallas" podía escribirle a la Sheet
  real un dato viejo del espejo local, encima de lo que otro dispositivo ya
  hubiera guardado.** `loadAll()` tiene, desde antes de este apartado, una
  migración de una sola vez que traslada `pedido.detalle` a
  `cotizacion.referencias[0].detalle`, y si migra algo, guarda (`persist`) esas
  dos claves. El problema: con el fallback nuevo al espejo, esa migración
  podía correr sobre una copia de pedidos/cotizaciones que cayó al espejo por
  estar offline — una copia que puede ser más VIEJA que lo que ya está en la
  Sheet real (ej. otro dispositivo ya hizo esa misma migración y guardó). Si
  eso pasaba, `persist()` quedaba en la cola de reintento y, al volver la
  señal, escribía ese dato desactualizado ENCIMA de lo real — justo lo que la
  cabecera de `core/guardado.js` dice que nunca debe pasar ("restaurar el
  espejo a ciegas podría pisar algo hecho después desde otro dispositivo").
  Se corrigió marcando en `loadAll()` qué claves cayeron al espejo
  (`clavesDeEspejo`) y saltando la migración por completo si pedidos o
  cotizaciones vinieron de ahí — se repite sola, sin problema, la próxima vez
  que ese dispositivo cargue con conexión real. Antes de que existiera el
  fallback al espejo esto era estructuralmente imposible (sin datos, el guard
  de arrays vacíos bloqueaba la migración), así que era un riesgo nuevo,
  introducido por este mismo apartado. Ver los tests nuevos en
  `test/smoke.mjs` (buscar "la migración de tallas NO corre").
- **[REGRESIÓN] Los scripts de CDN y la tipografía de Google Fonts nunca se
  llegaban a cachear, pese a estar en la whitelist de `sw.js`.** Causa: los
  `<script>`/`<link>` de `index.html` los cargaban SIN el atributo
  `crossorigin`, así que la respuesta le llegaba al service worker "opaca"
  (`type:'opaque'`, `status:0`, `ok:false` — así responde el navegador a un
  fetch cross-origin sin modo CORS), y el guard `if (res && res.ok)` de
  `sw.js` nunca la guardaba. En la práctica: jsPDF, XLSX, ExcelJS, Chart.js y
  la fuente Inter/IBM Plex Mono no sobrevivían un reinicio en frío sin
  conexión, así que "Generar PDF", importar/exportar Excel y las gráficas de
  Resumen fallaban offline aunque el resto de la app sí abriera. Se agregó
  `crossorigin="anonymous"` a esos `<script>`/`<link>` (NO al script de login
  de Google, que no está en la whitelist de `sw.js` y no necesita cachearse).
  Verificado en el navegador: tras el fix, esas seis respuestas quedan en
  Cache Storage con `type:'cors'`, `status:200`.
- **[menor] El comentario de cabecera de `sw.js` prometía reserva en caché "si
  la red falla... o tarda"**, pero el `fetch` handler nunca implementó ningún
  timeout — solo un fallo real de red dispara el fallback. Se corrigió el
  comentario para que describa lo que el código realmente hace (no se agregó
  la carrera contra un timeout: es una mejora aparte, no algo que este
  apartado haya prometido).
- **[REGRESIÓN, móvil] El chip nuevo "Sin conexión" no tenía la versión
  compacta que sus hermanos `.ok`/`.guardando` sí tienen**, y al coexistir en
  pantalla angosta con el chip "Sin guardar (N)" desbordaba la topbar lo
  suficiente como para empujar fuera de la pantalla (sin scroll disponible) la
  campanita, el botón de tema y el de CERRAR SESIÓN — verificado midiendo el
  DOM real a 375px de ancho. Se agregó la misma compactación en
  `css/responsive.css` (se queda solo con el ícono 📶 bajo 880px de ancho).
- **[menor] `loadAll()` trataba "la Sheet respondió bien pero esa clave no
  tiene fila" igual que un fallo de red real**, así que si el espejo local
  todavía tenía una copia vieja de esa clave (una que el usuario borró, o que
  nunca se guardó en ESE navegador), la resucitaba como si fuera el dato
  vigente — y de paso disparaba el toast de "Sin conexión" estando en línea.
  Se corrigió distinguiendo `r.status === "rejected"` (fallo real: sí usa el
  espejo) de `r.status === "fulfilled" && r.value === null` (no hay fila, no
  es un error: se deja vacío, no se toca el espejo).

## Registro de cambios — agosto 2026 (undécima ronda: se perdía trabajo sin guardar)

**El problema:** una cotización en modo "guardado explícito" (los cambios se
aplican en memoria de inmediato, pero solo se escriben a la Sheet cuando se
pulsa "Guardar") y el formulario de "Nuevo pedido rápido" vivían SOLO en
memoria hasta ese clic final. La red de seguridad de guardado
(`core/guardado.js`: espejo local + cola de reintento + aviso al cerrar la
pestaña) existe desde antes, pero está enganchada a que se haya INTENTADO
guardar al menos una vez — una edición que nunca llegó a ese punto le era
invisible por completo. Si la pestaña se cerraba sola en el medio (se
actualizó el navegador, se recargó por accidente, se cayó), esas horas de
trabajo desaparecían sin ningún aviso previo ni forma de recuperarlas después.

**La solución: un sistema paralelo de "borradores" que reutiliza toda la
infraestructura de recuperación que ya existía**, en vez de construir un
aviso o una pantalla nuevos:

- `core/guardado.js` gana `marcarBorrador`/`olvidarBorrador`: además del
  espejo que ya se escribía en cada intento de guardado, ahora también se
  espeja (con medio segundo de debounce) cualquier edición en modo
  "guardado explícito" mientras se está editando, sin esperar a que alguien
  pulse Guardar. El aviso de "¿seguro que sales?" al cerrar la pestaña ahora
  mira tanto los guardados fallidos de siempre como estos borradores nuevos.
- `core/store.js` gana `revisarBorradoresSinGuardar()`, que se llama una vez
  por cada `render()` (no en cada sitio que edita una cotización o el
  formulario — son decenas, y fácil olvidar alguno) y marca o desmarca el
  borrador mirando el estado mismo (`state.cotSucia`, si el formulario de
  pedido tiene contenido). Si algo nuevo empieza a usar "guardado explícito"
  en el futuro, basta con sumarlo ahí una vez.
- La detección y el aviso de recuperación al reabrir la app (que ya existían
  para guardados fallidos) ahora también consideran estos borradores — la
  misma barra, el mismo botón "Restaurar", sin pantalla nueva.

**El descuadre que casi pasa desapercibido:** al escribir las pruebas se
encontró que la recuperación, tal como quedó armada al principio, JAMÁS se
iba a ofrecer con la conexión funcionando — que es el caso más común (abrir
la app al otro día con wifi bien), no el raro. La razón: `loadAll()`, al leer
cada clave de la Sheet con éxito, reescribe el espejo local con lo recién
leído (para tener algo reciente si la PRÓXIMA carga falla) — y esa reescritura
corría ANTES de que la detección de recuperación alcanzara a comparar,
borrando la evidencia del borrador en el propio proceso de buscarla. Con la
red caída nunca se notaba (esa reescritura no llega a correr), pero con red
sí — que es la inmensa mayoría de las veces — la recuperación se apagaba
sola. Se corrigió tomando una foto del espejo ANTES de tocar la red y
comparando (y, al restaurar, restaurando) contra esa foto, no contra el
espejo en vivo — así ninguna lectura posterior puede pisar la evidencia
mientras el aviso sigue en pantalla.

**El resguardo contra corromper la Sheet:** `formPedido` (el borrador de
"Nuevo pedido rápido") nunca tuvo una fila propia en la hoja "kv" — es
puramente un formulario en memoria hasta que se pulsa "Crear pedido". Si
`recuperarDelEspejo()` intentara guardarlo igual que cualquier otra clave
recuperada, escribiría con una clave `undefined` en esa pestaña. Se agregó
`CLAVES_PERSISTIBLES` (la lista de claves que sí tienen fila real, tomada de
`KEYS`) como filtro explícito antes de cualquier `persist()` en ese flujo:
un borrador de `formPedido` se restaura en pantalla, nunca se manda a
guardar.

Cubierto en `test/smoke.mjs`: el aviso de cierre se dispara con un borrador
sin guardar de por medio, el espejo se actualiza solo mientras se edita, la
recuperación se ofrece de verdad al "reabrir" con la red funcionando (el caso
que se estuvo a punto de dejar roto), restaurar trae de vuelta la edición
perdida, y — el más delicado — restaurar un borrador de `formPedido` nunca
dispara una escritura a la Sheet.

### Extensión: borrador también en la nube (recuperar desde OTRO dispositivo)

El sistema de arriba resuelve "se me cerró la pestaña sola" — pero el espejo
vive en `localStorage`, así que abrir desde otro computador, otro navegador,
o después de borrar datos de navegación no tenía nada local de dónde
recuperar. El usuario preguntó explícitamente si esto quedaba cubierto en
*cualquier* situación (dispositivo distinto incluido) y pidió que sí.

**La solución:** la misma edición que ya se espeja localmente también se
manda —mejor esfuerzo, como mucho cada 4 segundos, sin cola de reintento— a
su propia fila en la pestaña "kv" de la Sheet, con una clave dinámica
separada por correo Y por cotización (`borrador:cotizaciones:<email>:<id>`,
`borrador:formPedido:<email>`) para que dos pestañas o dos dispositivos de
la misma persona, editando cotizaciones distintas a la vez, no se pisen el
borrador entre sí. Si esta escritura falla (sin red, token vencido) no pasa
nada grave: el espejo local sigue siendo la red de seguridad principal, y el
siguiente cambio programa otro intento en unos segundos igual.

Piezas nuevas en `core/store.js`: `programarBorradorNube` es a propósito un
TOPE ("como mucho cada 4s"), no un debounce — un debounce se reprogramaría
en cada tecla y, con alguien escribiendo sin parar, nunca llegaría a mandar
nada. Lee el estado más reciente al disparar (no el de cuando se programó),
así que siempre manda la última versión aunque se haya seguido editando
mientras la cuenta regresiva corría. `detectarRecuperacion()` ahora también
revisa estos borradores de la nube (puede haber más de uno a la vez — una
cotización distinta por pestaña/dispositivo, ver `sheetsStorage.keysConPrefijo`
para listarlos sin gastar una lectura de red aparte), pero SOLO para un área
que el espejo LOCAL no cubra ya (el local es más fresco — 1.5s contra 4s —
así que gana cuando hay de los dos). Para `cotizaciones` compara y restaura
por id, cada referencia dentro del arreglo completo, nunca el arreglo entero.

**El descuadre que encontró una revisión adversarial antes de darlo por
cerrado:** un borrador en la nube no llevaba ninguna marca de versión, así
que un fallo silencioso en su limpieza (la misma clase de fallo que motivó
todo este sistema: red caída justo en ese instante) lo dejaba viviendo para
siempre — y en la próxima carga, `detectarRecuperacion()` lo comparaba contra
lo que hay guardado HOY, no contra qué tan viejo era el borrador en sí. Un
borrador de hace semanas, ya completamente superado por ediciones reales
posteriores, se ofrecía igual como "recuperación" — y restaurarlo habría
**regresado una cotización ya guardada a una versión vieja**, el tipo de daño
que este sistema entero existe para evitar. Se corrigió agregando `basadaEn`
al borrador: una foto de la cotización TAL COMO ESTABA GUARDADA cuando ese
borrador arrancó (el mismo dato que ya guarda `state.cotSnapshot`). Si lo que
hay guardado de verdad hoy ya no es eso, el borrador quedó viejo y se
descarta sin ofrecerlo, sin importar qué tan distinto sea su contenido.

La misma revisión encontró que la clave original (`borrador:cotizaciones:<email>`,
sin el id) hacía que dos pestañas o dispositivos de la MISMA persona editando
cotizaciones DISTINTAS se pisaran el borrador — el último en escribir se
comía al otro. Se corrigió agregando el id de la cotización a la clave, lo
que a su vez obligó a poder LISTAR borradores por prefijo (no se sabe de
antemano cuál cotización tiene uno pendiente en otro dispositivo) —
`sheetsStorage.js` ganó `keysConPrefijo`, que no cuesta ninguna lectura de
red aparte porque la pestaña "kv" completa ya vive en caché para cualquier
`get`/`set` normal.

**Por qué esto sigue sin ser un "100% garantizado" absoluto, y se le dijo así
al usuario:** ningún borrador —local o en la nube— puede salvar los
segundos justo antes de un corte de luz o un cierre forzado del navegador
(el tope de la nube es de 4s; el debounce local, 1.5s). Tampoco sustituye una
sincronización real entre dispositivos: si el mismo usuario edita la misma
cotización desde dos sitios a la vez sin guardar, gana el último borrador que
llegue a la nube, igual que ya aceptaba el espejo local (ver la nota grande
al principio de `core/guardado.js`). Lo que sí queda cerrado es la brecha que
más importaba: cambiar de computador, de navegador, o perder los datos
locales del navegador ya no significa perder la edición.

Otro límite, menor, que quedó documentado en vez de resuelto: si una
cotización se crea y se edita ENTERAMENTE sin conexión (ni su guardado
inicial llegó nunca a la Sheet), ningún otro dispositivo puede ofrecer
recuperarla — la comparación necesita que la cotización ya exista en lo que
la Sheet real reporta como guardado. Ventana angosta (hace falta que la red
alcance para el borrador pero no para el guardado real) y sin riesgo de
corrupción, solo de una recuperación que no se puede ofrecer.

Cubierto en `test/smoke.mjs`: el borrador se manda a la nube mientras se
edita (respetando el tope de 4s, con la versión más reciente, con `basadaEn`
incluido), y —la prueba real de "otro dispositivo"— recuperar funciona con
CERO rastro local, tanto para una cotización (fusionada por id, sin tocar las
demás) como para un pedido rápido a medio llenar. Además: un borrador cuya
`basadaEn` ya no coincide con lo guardado de verdad NO se ofrece (la prueba
que hubiera fallado con el diseño original, antes de la revisión
adversarial), y dos borradores de cotizaciones distintas en la nube a la vez
se ofrecen y restauran los dos, sin pisarse.

## Registro de cambios — agosto 2026 (décima ronda: estética de los PDF)

**El problema:** los 10 documentos que genera la app (cotización, factura,
recibo, remisión, orden de producción, cotización interna, y los reportes)
eran funcionales pero visualmente genéricos — texto suelto sobre una hoja en
blanco, sin nada que los distinguiera de cualquier PDF hecho a las carreras.
El usuario compartió una factura de referencia (bandas de color de borde a
borde, panel de datos, columna de totales resaltada, caja de TOTAL, franja de
cierre) y dos órdenes de producción de referencia (tabla completamente
recuadrada, casilla amarilla para la fecha de entrega, encabezado con
metadatos) para guiar el rediseño.

**La solución: tres piezas reutilizables en `core/pdf.js`, no un rediseño
suelto por cada función.** Igual que la cotización ya tenía su color de
acento (Configuración → color de marca), estas piezas lo usan también — no se
copió el negro de la referencia, porque ese negro es SU marca, no una regla
general:

- `drawHeaderBasic` — ahora pinta una franja de color de borde a borde (antes
  era solo texto en el color de acento), con el logo del taller a la
  izquierda si hay uno configurado. La usan los 10 documentos.
- `drawTotalBox` — una caja rellena de acento con la cifra que de verdad
  importa (TOTAL, VALOR RECIBIDO, VALOR DE REFERENCIA TOTAL), en vez de una
  línea de texto más entre otras.
- `drawFooterBand` — la misma franja del encabezado, angosta, cerrando el
  documento ("Gracias por su confianza", o el aviso de uso interno según el
  documento).

Además: la columna de "total de línea" de las tablas de cliente (cotización,
factura, remisión) lleva un tinte gris parejo — no la fila entera — igual que
la factura de referencia, para que el ojo pueda seguir bajando esa columna
sin que compita con el resto de la tabla. Las tablas de compras/reportes que
resumen con una fila de "TOTAL" ahora la resaltan con el acento oscuro y
texto blanco, en vez de dejarla mezclada con las demás filas. La orden de
producción (`generarPDFPedido`) ganó una casilla amarilla para la fecha de
entrega — mismo criterio que la orden de producción de referencia: es el dato
que más le importa a quien está cosiendo, y no debe perderse en el resto de
metadatos — y sus tablas pasaron a `theme: "grid"` (recuadro en cada celda),
más cerca de cómo se lee un formulario de taller que una hoja de cálculo.
Factura, recibo y remisión, que antes no llevaban logo (solo la cotización lo
tenía), ahora también lo muestran — mismo criterio para los cuatro documentos
que le llegan al cliente.

## Registro de cambios — agosto 2026 (novena ronda: "servicio" en Producción)

**El problema de fondo:** corte y confección casi siempre se hacen en el
taller y se pagan vía nómina —un sueldo fijo, no un pago por prenda—, pero el
catálogo también tiene un precio de mercado para cuando SÍ hay que
tercerizarlos. Antes de esto, la única forma de que ese costo contara en la
ganancia era marcarlo "Comprado" en la pestaña Producción de la cotización —
pero eso también generaba un movimiento de gasto en Finanzas, como si se
hubiera pagado al instante y aparte. En el taller real ese pago no existe: se
paga vía nómina, después, junto con el resto del sueldo. Dejarlo sin marcar
evitaba el gasto falso, pero entonces esa línea quedaba "pendiente" para
siempre y no había forma de saber cuánto había que apartar para cuando
llegara la nómina.

**La solución: un tercer estado, "Servicio".** La casilla "Comprado" de cada
línea de "Compras del pedido" pasó a ser una lista de tres opciones:

- **No** — nada registrado todavía (como antes, sin marcar).
- **Sí** — se pagó de verdad y aparte (tercerizado): crea el movimiento de
  gasto en Finanzas, igual que antes.
- **Servicio** — mano de obra propia (corte, confección): cuenta como costo
  real para la ganancia (no se infla el margen por no haberla "pagado"), pero
  **no** genera ningún movimiento en Finanzas — no hubo un pago instantáneo
  que registrar. El resumen de la cotización ahora distingue "pagado" de "en
  servicio (para apartar)", así queda claro cuánto hay que reservar para la
  próxima nómina sin fingir una transacción que no ocurrió.

**Quién decide qué es "servicio": una categoría del catálogo, no el código.**
Antes lo único que marcaba un insumo como servicio era escribir la palabra
"servicio" en su campo Unidad — una convención del código, no algo que el
usuario pudiera controlar directamente. Ahora cualquier CATEGORÍA de Insumos
se puede marcar con una casilla "Servicio" (en "⚙ Categorías"): todo insumo
que viva ahí (corte, confección, lo que sea) cuenta como servicio
automáticamente, sin tocar su Unidad. Una línea de "Compras del pedido" cuyo
insumo es de servicio nace directo en el estado "Servicio" — no hay que
tocarla a mano en cada pedido, que es el caso normal.

Ese resultado ("es servicio") se resuelve UNA sola vez, al copiar el insumo
del catálogo a una plantilla, un producto o una referencia de cotización —
igual que ya se hacía con el costo, para que una cotización ya armada no
cambie de número sola si después se edita la categoría en el catálogo. Los
cuatro lugares donde un insumo se copia desde el catálogo (referencia directa,
plantilla de prenda, producto del catálogo, y de ahí a una referencia) quedan
así cubiertos por el mismo criterio, cada uno con su propia prueba en
`test/smoke.mjs` (antes solo el primero tenía una prueba real).

**Dos fallas encontradas en revisión adversarial sobre la primera versión de
esta ronda, ya corregidas:**

- **[REGRESIÓN] Un costo global del pedido (domicilio) o un servicio cobrado
  al cliente (diseño facturado aparte) nacían en "Servicio" por defecto, sin
  que nadie lo pidiera.** La causa: esos dos SIEMPRE traen `esServicio: true`,
  pero ahí ese campo significa otra cosa — "no se compra por cantidad", no
  "es mano de obra de nómina" (ver `UNIDAD_SERVICIO` en `constants.js`). Un
  domicilio casi siempre SÍ es un pago instantáneo real al mensajero. Se
  corrigió para que el default nuevo solo aplique a insumos de una
  referencia, nunca a costos globales ni servicios cobrados — esos siguen
  naciendo neutrales ("No"), como antes de esta ronda.
- **[REGRESIÓN] Cambiar el "Tipo de costo" de un insumo hacia/desde "Costo
  global" o "Se cobra aparte al cliente", dentro de la misma cotización,
  perdía la marca de servicio en silencio** (si venía de una categoría, no de
  la Unidad) — las cinco funciones que mueven un insumo entre esas tres
  formas no copiaban `esServicio`. Se corrigió en las cinco.
- **[menor]** Un `costoReal` de exactamente `0` escrito a propósito en una
  línea de servicio se sustituía por el estimado en el resumen (`0` es
  falsy) — se corrigió para distinguir "no se escribió nada" de "se escribió
  cero". El mismo ajuste se aplicó al PDF interno de "Compras del pedido",
  que además ahora muestra el estimado (marcado "(servicio, estimado)") en
  vez de "—" para una línea de servicio que nadie tocó todavía, coherente con
  lo que ya mostraba el resumen en pantalla.

## Registro de cambios — agosto 2026 (octava ronda: dos ajustes puntuales)

**No hay un botón general de "+ Nuevo insumo".** Hubo dos pasos intermedios
antes de llegar acá (uno en la cabecera arriba a la derecha, otro grande al
final de toda la lista) y ninguno era lo que hacía falta: un botón grande y
genérico, lejos de casi todas las secciones excepto la que estuviera al lado.
La versión final vuelve a lo que ya existía —un "+" chico, sin color de
acento, dentro de cada sección— y lo corrige de posición: vive al final de la
tabla de SU sección (antes estaba en el encabezado, arriba). Ahí es donde en
verdad se está mirando después de recorrerla, y queda alineado con la columna
del nombre — el primer campo que hay que llenar en la fila que va a aparecer.
Se reutiliza el MISMO "+" (`renderAgregarInsumoMini` en `modules/catalogo.js`)
en las cuatro situaciones donde hace falta agregar: cada sección de la vista
"Todas", la lista plana de un chip filtrado o una búsqueda, el catálogo vacío,
y una búsqueda sin resultados — nunca un botón aparte inventado para el caso.

De paso se pudo quitar el forzado de orden "Recientes" que la acción hacía
antes (saltaba el insumo al principio de la lista para que quedara visible):
con el "+" ya dentro de cada sección, no hace falta — se respeta el orden que
el usuario ya tenía elegido. Y como el nombre nace vacío, el orden A–Z (el
que viene por defecto) necesitó un ajuste aparte: antes un nombre en blanco
comparaba como "menor que cualquier letra" y saltaba al PRINCIPIO de la
lista; ahora un nombre vacío se ordena al final, no al frente (ver
`ordenarInsumos` en `modules/catalogo.js`) — importa para cuando el "+" cae en
una vista plana (no agrupada), donde también hay que quedar cerca de él.

**Un pedido rápido puede marcarse "sin flujo de producción".** No todo pedido
pasa por cortado/confección/etc.: algo ya hecho, un servicio, una reventa. El
formulario de "Nuevo pedido rápido" tiene ahora una casilla —marcada por
defecto, para no cambiarle el comportamiento a nadie que no la toque— justo
después de elegir "Venta directa / Consignación" (no se ofrece en
consignación: ese tipo de pedido ya nace sin flujo por su cuenta, mismo
mecanismo). Al desmarcarla, el pedido nace directo con `estado: "entregado"`
—el mismo truco que ya usaba consignación— y con la bandera explícita
`sinFlujoProduccion: true`, que es lo que además le apaga el widget de
progreso en la tarjeta. La bandera existe aparte del `estado` a propósito: sin
ella, un pedido "ya entregado" seguiría mostrando la fila de progreso en su
última etapa con la flecha de retroceder activa, como si sí llevara
seguimiento y solo estuviera terminado — que no es lo mismo que "nunca hubo
etapas que seguir".

De paso, el checkbox-con-descripción de Finanzas ("¿Es una compra de
insumo?") se generalizó: era `.tx-form-insumo-toggle`, solo suyo; ahora es
`.toggle-card` en `base.css`, y la casilla nueva de Pedidos la reutiliza tal
cual — la misma pieza, no una copiada con otro nombre.

## Registro de cambios — agosto 2026 (séptima ronda: ajustes sobre la sexta ronda)

Correcciones puntuales sobre lo que se acababa de construir, a partir de usar
la app de verdad — algunas son pulido, una es una regresión real.

**Insumos, cuatro ajustes:**

- **Contraste entre el título de la categoría y el nombre del insumo.** Los
  dos usaban casi el mismo tamaño, peso y color (`--ink`, negrita, ~13px), así
  que a simple vista costaba saber cuál era el encabezado y cuál una fila más
  — la fatiga de escanear la lista que se reportó. La corrección es de TIPO,
  no de opacidad: el título de la categoría pasa a leerse como una etiqueta de
  sección (mayúsculas, espaciado, `--ink-faint`) — el mismo idioma que ya usa
  el resto de la app para esto (`.nav-group-title` en la barra lateral,
  `.cat-admin-titulo` en el mismo Insumos), no un tercer estilo inventado. El
  nombre del insumo se queda igual de prominente: sigue siendo el dato
  principal de la fila.
- **Botón "+" por categoría.** Antes solo existía el botón general de arriba,
  que heredaba la categoría del chip activo (o ninguna, si se estaba viendo
  "Todas"). Ahora cada sección de la vista agrupada tiene su propio "+" que
  agrega el insumo YA CLASIFICADO ahí, sin tener que elegirle la categoría
  después — más directo cuando se cargan varios insumos seguidos de la misma
  categoría. De paso se pudo quitar el salto de filtro que la acción hacía
  antes para que el insumo nuevo quedara visible (ver `add-cat-item` en
  `modules/catalogo.js`): con la categoría conocida de antemano, el insumo
  siempre aparece dentro de lo que ya se está viendo.
- **La lista de unidades ("UND", "MT"…) ahora tiene memoria.** El campo ya
  tenía un `<datalist>` con sugerencias, pero era una lista FIJA de 9 valores
  que nunca aprendía nada de lo que el usuario escribía — la intención estaba,
  la implementación no. `unidadesConocidas()` (`core/calc.js`) recorre todo
  insumo/costo/servicio de la app y arma la lista con lo que de verdad se ha
  escrito, así que una unidad rara escrita una sola vez queda disponible en
  cualquier otro campo de unidad de la app. Se agregó también una flechita
  visible sobre el campo (mismo truco que `.buscador-icono`): el indicador
  nativo del navegador para un `<input list>` no se ve igual —o no se ve— en
  todos los navegadores.
- **Aviso cuando un insumo cambió en el catálogo.** Un insumo agregado desde
  "Insumos predeterminados" copia el costo del catálogo al momento de
  agregarlo — a propósito, para que una cotización no cambie de precio sola si
  el catálogo se repone más caro después. El problema era que esa copia podía
  quedar vieja sin que nadie se enterara. Ahora `insumoCambioDeCatalogo()`
  (`core/calc.js`) compara la copia contra el catálogo vigente, y si
  divergieron, la fila se marca (borde de advertencia) y aparece una franja
  angosta debajo con los dos números y dos salidas: **Actualizar** (trae el
  costo vigente) o **Mantener** (decisión consciente de seguir con el viejo —
  útil en una cotización que no tiene sentido repretinar). "Mantener" no
  apaga el aviso para siempre: si el catálogo vuelve a cambiar después, avisa
  de nuevo. No es un banner ni bloquea nada — la cotización sigue funcionando
  con su propio número hasta que alguien decida qué hacer. Solo compara el
  costo (el número que mueve la plata); un insumo escrito a mano en la
  cotización, sin pasar por el catálogo, no tiene con qué compararse y nunca
  avisa.

**Estados de producción: la regresión.** La unificación de la ronda anterior
tenía una bandera `conBarra` que, para un pedido rápido, dibujaba ADEMÁS la
barra vieja con todas las etapas escritas — la versión que se suponía
reemplazada. El resultado: un pedido rápido mostraba la barra vieja y la fila
compacta nueva AL MISMO TIEMPO, mezcladas. Se reportó dos veces porque son la
misma causa vista desde dos ángulos ("veo la versión pasada" / "aparece en un
pedido rápido sin que nadie la haya pedido"). La bandera `conBarra` se quitó
por completo — `renderProgresoEtapas` (`core/components.js`) ya no tiene dos
formas de mostrar esto, tiene una sola, sin excepción por camino. `.tape-labels`
(el CSS de la barra vieja) se eliminó; `.tape-track`/`.tape-fill` se quedan,
porque los sigue usando la barra de "% cobrado" del panel de dinero.

## Registro de cambios — agosto 2026 (sexta ronda: jerarquía, reutilización y teclado)

**Navegación por teclado en toda la app** — ver la sección "Navegación por
teclado" más abajo. Nuevo `core/teclado.js`.

**Insumos, rehecho** (`modules/catalogo.js` + `css/catalogo.css`, que estaba
vacío). Era la única lista grande de la app **sin buscador**: con veinte
insumos había que recorrerla con los ojos. Y era una tabla de siete columnas
del mismo peso visual, donde el costo —el dato por el que se entra— se leía
igual que la unidad. Ahora:

- Buscador compartido (nombre, unidad o proveedor) con contador de resultados.
- Orden por A–Z / más caro / recientes.
- Cada chip de categoría dice cuántos insumos tiene; "Sin categoría" se marca
  en ámbar cuando hay insumos sin clasificar.
- Panel ⚙ Categorías, plegado, donde por fin **se puede renombrar** una
  categoría. Antes solo se podía crear o borrar: un nombre mal escrito obligaba
  a borrar la categoría (dejando sus insumos sueltos) y reclasificarlos uno por
  uno. Los insumos guardan el id, no el nombre, así que renombrar no toca nada.
- La fila usa `.tx-row` con el modificador `.insumo`: el nombre se lee como
  texto (sin caja hasta el clic) y el costo como dinero (monospace, a la
  derecha, con la unidad de sufijo). Lo accesorio se atenúa.
- "+ Nuevo insumo" nace **vacío y enfocado**, hereda la categoría que se esté
  viendo y cambia el orden a "Recientes" para que quede a la vista. Antes
  aparecía como "Nuevo insumo" al final de la lista, fuera de pantalla.

**El aviso de "cambios sin guardar" de una cotización dejó de ser invasivo.**
Era una barra sticky a lo ancho, con fondo de alerta, clavada arriba del
documento mientras se editaba: robaba la parte superior de la pantalla justo
donde están los datos del cliente, empujaba el contenido al aparecer, y
gritaba "problema" cuando editar sin guardar es el estado **normal** de
trabajo. Ahora es un dock flotante abajo a la derecha (`.guardado-dock`):
imposible de perder de vista, sin ocupar espacio del documento y sin el color
de alerta — que queda reservado para lo que sí es un problema. Y se guarda con
**Ctrl+S**.

**Bug de posicionamiento encontrado al hacer lo anterior** (vale para cualquier
pieza flotante futura): `.tab-panel` animaba `transform`, y un elemento que
anima `transform` se convierte en el bloque contenedor de cualquier
`position:fixed` que tenga dentro. Como todo el contenido de cada pestaña vive
dentro de `.tab-panel`, el dock aparecía 282px por debajo del borde inferior de
la pantalla, invisible. La animación de entrada ahora es solo de opacidad. **No
volver a meter `transform` ahí.**

**Estados de producción: una sola resolución.** Es el defecto que originó la
regla de reutilizar. La pregunta "¿cuáles son las etapas de esto?" estaba
respondida en siete lugares: `estadosDefDe(pedido)` y `estadosDefDeRef(ref)` en
`calc.js` (la segunda conocía el caso "comprado a proveedor", la primera no) y
cinco copias inline en `cotizaciones.js`. Consecuencias reales que se
arreglaron:

- El editor de etapas de una referencia **de proveedor** ofrecía las 5 etapas
  del taller mientras la tarjeta del pedido mostraba las 2 del proveedor.
- `estadoAgregadoDeCot` devolvía el `estado` sacado de un flujo y la lista de
  etapas de **otro**, así que la etiqueta no se podía resolver y se mostraba el
  id crudo.
- "Pedido terminado" se preguntaba comparando contra el id literal
  `"entregado"`, pero las etapas de un flujo creado desde Plantillas nacen con
  ids `uid()`: un pedido con flujo propio **nunca** se daba por terminado —
  seguía contando como activo y avisando de entrega vencida para siempre.

Ahora todo entra por `etapasDe(entidad)`, `estadoIdx()`, `pedidoTerminado()` y
`siguienteEtapa()` en `core/calc.js`. `estadosDefDe`/`estadosDefDeRef` quedan
como alias del mismo cuerpo — **no agregarles lógica**.

Y el progreso lo **pinta una sola pieza**, `renderProgresoEtapas()` en
`core/components.js`, para los dos caminos. Antes eran `renderProgresoTape`
(barra + etapas + botones con texto) y `renderProgresoPorReferencia` (fila
compacta + flechas): la misma información con markup, CSS y afordancias
distintas. Lo único que las diferencia ahora es la bandera `conBarra` — un
pedido rápido es una cosa que avanza y merece verse completa; una cotización
con seis referencias usa el mismo componente seis veces en su forma compacta.
Su CSS se mudó de `pedidos.css` a `layout.css` justamente porque dejó de ser
de una sola pestaña.

**El bug reproducible que salió de ahí:** un pedido rápido que iba en
"Acabados" volvía visualmente a la primera etapa apenas se pulsaba "📈 Cotizar
este pedido" — las referencias nuevas nacían sin `estado`, así que la tarjeta
(que pasa a leer el progreso por referencia) mostraba una cosa y el KPI y los
filtros (que siguen leyendo el `estado` del pedido) otra. Ahora cada
referencia se siembra con el progreso que el pedido ya llevaba. Hay prueba de
humo que lo fija.

**Plantillas: índice de tarjetas en vez de una lista infinita.** Se dibujaban
TODAS desplegadas a la vez, con su tabla de insumos editable incluida — con
cuarenta plantillas era inusable, y no había búsqueda ni categorías. Ahora es
maestro/detalle, el mismo patrón que ya usaba Catálogo: dos vistas
(Plantillas / Flujos de producción, con los flujos abajo porque son
configuración ocasional, no el contenido principal), un grid de tarjetas con
foto, categoría, **costo estimado por prenda** y número de insumos, buscador,
chips por categoría, y el detalle completo de UNA a la vez. Se agregó
**"Duplicar plantilla"**, que era el gesto que faltaba para trabajar con
variaciones. El costo estimado no se calcula ahí: entra por
`calcCostoUnitarioRef` de `core/calc.js`, la misma fórmula que costea una
referencia de cotización.

**Gráficas del Resumen.** Dos de las tres tenían la configuración duplicada
carácter por carácter. Ahora hay `core/graficas.js` con la paleta del tema,
los `Chart.defaults` y las opciones base compartidas — la tipografía de las
gráficas es la de la app (antes era la Helvetica de fábrica de Chart.js) y el
tooltip usa los tokens del tema. Se corrigió además que **el eje X saltaba los
días sin movimiento**: no era una línea de tiempo, era una lista de fechas con
datos, así que dos días separados por una semana se veían pegados. Y se añadió
`beforeUnmount()` al contrato de los módulos (`core/dom.js`): al salir de
Resumen las instancias de Chart.js se destruyen, en vez de quedar vivas
apuntando a un `<canvas>` ya desechado con sus listeners de resize colgando.

**Panel de dinero de un pedido.** La tabla de abonos pedía ~566px dentro de
una columna de ~512px, así que **se desbordaba sobre la columna de PDF**; el
panel no mostraba ningún monto agregado (ni total, ni abonado, ni cuánto
falta); el número más grande de la tarjeta era el que nunca se toca (el total,
sin etiqueta) mientras el que decide la acción (el saldo) iba a 12px debajo; y
el saldo pendiente se pintaba en rojo de peligro mientras el mismo concepto en
el Resumen iba en ámbar. Ahora: la cabecera dice **"Falta por cobrar"** en
grande con "de $TOTAL · abonado $X" debajo, el panel abre con las tres cifras
y una barra de cuánto se lleva cobrado, y la tabla de movimientos pasó a ancho
completo con columnas flexibles definidas una sola vez en CSS. Dos arreglos de
fondo más: **el borrador del abono vive en `state.formAbono`** (antes solo en
el DOM, así que cualquier re-render borraba el monto ya tecleado — y es
plata), y la comisión del vendedor dejó de pagarse con un clic en lo que
parecía una etiqueta pasiva: ahora es un botón explícito que confirma el monto
y avisa que creará un gasto en Finanzas.

**Arreglos transversales que salieron de revisar lo anterior:**

- `.muted` se usaba en tres módulos y **no estaba definida en ningún CSS**: las
  rayas de "acá no hay nada" se veían exactamente igual que un dato real. Ahora
  vive en `tables.css`, junto a `.amount`.
- `.ref-summary` (el bloque de cifras) vivía en `cotizaciones.css` pero lo usa
  también Pedidos — y `cotizaciones.css` se carga **después** de `pedidos.css`,
  así que cualquier modificador de Pedidos perdía por orden y no se aplicaba.
  Subió a `layout.css`, por el mismo motivo que `.tape-*`.
- En el panel de consignación, "pagada" era un `.status-pill`, que trae
  `cursor:pointer`: un texto que no hace nada parecía pulsable. Pasó a `.badge`.
- Las plantillas de ejemplo nacían sin categoría, así que en el primer arranque
  caían todas bajo "Sin categoría" y los chips no se entendían.
- `state.formAbono` era un borrador **global** mientras pueden estar abiertos
  varios paneles de pedido: lo tecleado en uno aparecía escrito dentro del
  formulario del otro. Ahora lleva `pedidoId` y solo se muestra en el suyo.
- `calcSerieMovimientos` devuelve la serie **ya continua**. El relleno de días
  vacíos estaba hecho en `resumen.js`, lo que obligaba a mantener allí una
  segunda copia del formato de claves de agrupación (día / lunes de la semana /
  mes); en cuanto las dos se separaran, el relleno habría duplicado puntos en
  vez de completarlos. Vive junto a `clave()`, que es lo único que garantiza
  que no se separen. Hay prueba de que los totales siguen exactos.
- Las cifras bajo el título de una gráfica tenían estilos inline; pasaron a
  `.grafica-cifras` en `layout.css`, porque las usan las dos gráficas del panel.

**Lo que encontró la revisión adversarial** (tres revisores independientes
sobre el código ya escrito). Dos de los hallazgos eran regresiones introducidas
en esta misma ronda, y quedan con prueba de humo para que no vuelvan:

- **`estadoAgregadoDeCot` comparaba índices entre flujos de largo distinto.**
  Una referencia comprada a proveedor (2 etapas) ya recibida —índice 1 de 2, o
  sea terminada— salía "menos avanzada" que una del taller en Confección
  —índice 2 de 5, o sea a la mitad—, y el pedido entero quedaba estampado con
  el flujo del proveedor en su última etapa: `pedidoTerminado()` lo daba por
  entregado con la prenda todavía en la máquina. Ahora se compara la **fracción
  de avance**, no el índice crudo.
- **El estado vacío de la gráfica quedó inalcanzable** al volverse continua la
  serie: `puntos.length` ya nunca es 0, así que en vez del aviso se dibujaban
  30 barras en cero con "Entró $0 · Salió $0". Se pregunta si hubo movimientos,
  no si hay puntos.
- **La cantidad de puntos pasó a fijarla el rango, no los datos.** Un año mal
  tecleado en "Desde" ("1900" por "2020") le pasaba miles de etiquetas a
  Chart.js con un solo movimiento en todo el rango. Se agregó la granularidad
  **"año"** para rangos de más de cinco años y un tope duro de 600 periodos que
  conserva los más recientes — el eje sigue mostrando fechas reales, así que se
  ve que la serie arranca después de lo pedido; no es una truncada silenciosa.
- **Insumos: un filtro apuntando a una categoría borrada** dejaba la lista
  vacía, sin ningún chip encendido y con un mensaje que hablaba de una búsqueda
  que el usuario nunca hizo. Pasa por dos vías reales (aprobar una propuesta de
  vendedor que borró la categoría, o el mismo taller abierto en dos pestañas).
  Se sanea **en el estado**, no solo en la vista — si no, resucita.
- **El conteo del buscador ignoraba los chips**: decía "2 insumos" con una sola
  fila en pantalla. Ahora `total` es lo que el chip deja pasar.
- **La factura en PDF se contradecía a sí misma** delante del cliente. Con IVA
  activo imprimía "TOTAL $1.190.000 / Abonado $0 / SALDO PENDIENTE $1.000.000",
  porque el saldo salía de `calcSaldoPedido` (sin IVA) y el total sí lo llevaba.
  Y un pedido cobrado de más imprimía "PAGADO COMPLETO" seguido de un monto
  negativo. **Ojo:** con IVA activo el saldo de la factura ya no coincide con el
  "Falta por cobrar" de la app, porque internamente el IVA no cuenta como
  cartera. Si el IVA debe contar, es una decisión del negocio y hay que
  aplicarla en `calcPorCobrarPedidos`, no solo en el PDF.
- **La gráfica que va al PDF era ilegible en tema oscuro**: se captura sin fondo
  y jsPDF la compone sobre papel blanco, así que ejes y leyenda salían en
  `--ink-soft` (~2:1 de contraste). Ahora esa gráfica usa una paleta de tinta
  oscura fija (`paletaImpresion`).
- **Registrar un abono borraba el borrador tecleado en otro pedido abierto.**
  Solo se limpia el del pedido en el que se registró.
- **El porcentaje cobrado contradecía al "Falta por cobrar"** de tres líneas
  más arriba: `Math.round` mostraba "Cobrado el 100%" con $2.000 pendientes.
- **Un pedido cancelado ofrecía cobrar** lo que la propia tarjeta declara
  perdido, y etiquetaba el mismo saldo "Quedó sin cobrar" arriba y "Falta por
  cobrar" abajo. Y al revés: un pedido **ya cobrado no dejaba registrar otro
  abono** (el formulario solo salía con saldo > 0), así que todo el aviso de
  "este pedido ya no tiene saldo pendiente" era código muerto.
- **La fórmula del saldo seguía escrita a mano en seis sitios** pese al
  comentario que decía haberla unificado. Ahora todos entran por
  `calcSaldoPedido`.
- `beforeUnmount()` corría **después** del `afterRender()` de la pestaña nueva:
  la que se va limpiaba cuando la que entra ya se había montado. Con Chart.js
  funcionaba de casualidad; en cuanto dos pestañas tocaran el mismo recurso
  global, la saliente le habría borrado la configuración a la entrante.
- Detalles: el input "Nombre de la nueva etapa" no tenía `id`, así que perdía
  lo tecleado en cada redibujo y soltaba el foco tras cada Enter; "+ Nuevo
  insumo" caía al final de la página (el grupo "Sin categoría" se pinta de
  último) contradiciendo su propio comentario; el aviso "N sin clasificar" se
  encendía por la fila que el usuario estaba escribiendo en ese instante; y el
  filtro por categoría de Plantillas revivía solo al reaparecer el nombre.

## Registro de cambios — agosto 2026 (quinta ronda: movimientos atrapados)

**Bug propio, reportado por el usuario.** El bloqueo de borrado que se agregó
en la primera ronda (un movimiento generado por la app no se borra suelto desde
Finanzas, hay que deshacerlo en su origen) tenía un agujero: **nunca comprobaba
que el origen siguiera existiendo**. Si el pedido o la cotización que lo generó
ya se había borrado, el mensaje mandaba al usuario a un lugar que ya no existe
y el movimiento quedaba **atrapado para siempre** — ni desde la app, ni
editando la Sheet a mano (eso tampoco funciona: la app reescribe el bloque
completo desde memoria en el siguiente guardado, así que el cambio manual se
pierde).

El bloqueo existe para impedir un DESCUADRE: borrar un lado mientras el otro
sigue afirmando que pasó. Si el otro lado ya no existe, no hay descuadre
posible. Ahora cada marca de origen trae su propia comprobación de existencia
(`MARCAS_ORIGEN_SISTEMA[].existe` en `core/calc.js`):

- **Origen vivo** → sigue bloqueado, con el candado 🔒 y el mensaje de dónde
  deshacerlo de verdad.
- **Origen eliminado** → el movimiento quedó huérfano y **sí se puede borrar**,
  con la papelera de siempre. En el historial sale con una etiqueta
  *"origen eliminado"* para que se entienda por qué quedó suelto, y hay un
  filtro **⚠ Sueltos (N)** que los aísla — aparece solo si hay alguno.

**Y se cierra la fuente del problema.** Eliminar una cotización no pedía
confirmación (era un clic al lado del de convertir) y dejaba sueltos todos sus
movimientos: la comisión de su vendedor, las compras que había llevado a
Finanzas y el registro del estimado completo. Ahora pregunta, dice cuántos
movimientos se lleva y con qué efecto neto en la caja, y los manda a la
papelera de movimientos — no los borra de una, por si alguno correspondía a un
gasto que sí ocurrió (`movimientosGeneradosPorCotizacion`). Es el mismo trato
que ya recibían los pedidos en la ronda anterior.

Verificado en pantalla con el caso reportado (movimientos de un pedido y de una
cotización ya borrados): el filtro los encuentra, salen marcados, se borran y
van a la papelera; el movimiento de un pedido que sí existe sigue con candado y
Finanzas se niega a borrarlo.

## Registro de cambios — agosto 2026 (cuarta ronda: eliminar vs. cancelar un pedido)

Un pedido puede terminar de dos formas muy distintas, y la app solo conocía
una. La diferencia no es de etiqueta, es de plata:

- **ELIMINAR** = el pedido **no debió existir** (se cargó por error, se
  duplicó). Ahora se lleva consigo los movimientos que él mismo generó: si el
  pedido nunca debió estar, esa plata tampoco tiene por qué figurar en la caja.
  Antes quedaban huérfanos en Finanzas — se borraba el pedido y la caja seguía
  mostrando sus ingresos. Los dos lados van a su papelera (el pedido a la de
  pedidos, sus movimientos a la de movimientos, marcados con
  `eliminadoConPedido`), así que **restaurar el pedido devuelve también su
  plata** y la caja queda exactamente como estaba. Eliminarlo definitivamente
  purga las dos cosas.
- **CANCELAR** (nuevo) = el pedido **sí existió y sí movió plata**, pero no se
  va a completar. Acá **no se toca ni un movimiento**: el abono que el cliente
  hizo entró de verdad y la comisión que se alcanzó a pagar salió de verdad. El
  pedido se queda visible, marcado como cancelado con su fecha — ese es el
  registro de que ocurrió. Se puede reactivar.

Qué deja de contar un pedido cancelado (todo lo que mira hacia **adelante**,
ver `pedidoCancelado` en `core/calc.js`): su saldo sale de "por cobrar" y de
"Quién debe", deja de ser un pedido activo, su comisión pendiente deja de
deberse, sale de "Próximas entregas" y de los avisos de la campanita, y no
cuenta como venta en el reporte de productos ni en el de ventas por vendedor.
En el reporte de pedidos **sí aparece** —marcado y atenuado, porque es el
registro— pero fuera de los totales, y el pie dice cuántos cancelados hay para
que no parezca que la suma no cuadra.

Qué NO se lleva el borrado: un movimiento cargado **a mano** al que alguien le
eligió ese pedido en el desplegable "Pedido relacionado" también tiene
`pedidoId`, pero representa un gasto propio que existió al margen (la tela que
se compró). Solo se van los que la app generó, reconocidos por su marca de
origen — abonos, reembolsos, comisión del vendedor y ventas/comisiones de
consignación (`movimientosGeneradosPorPedido`).

Verificado con números en la prueba de humo: al cancelar, la caja no cambia y
el saldo sale de "por cobrar"; al eliminar, los movimientos salen de la caja y
vuelven intactos al restaurar. En pantalla, con un pedido cancelado de $800.000
con $150.000 abonados junto a uno vivo: **Caja $350.000** (incluye el abono del
cancelado), **Por cobrar $400.000** (solo el vivo), **Pedidos activos: 1**.

## Registro de cambios — agosto 2026 (tercera ronda: detalles reportados)

- **El aviso de guardado ya no parpadea en cada cambio.** La causa no era el
  tiempo que duraba: la clave se marcaba como "pendiente" ANTES de intentar
  escribir, así que en cada tecla y cada clic el chip rojo *"Sin guardar"* y la
  barra de error aparecían y desaparecían en milisegundos. Un aviso de
  emergencia parpadeando todo el tiempo deja de leerse como una emergencia.
  Ahora hay **dos listas** en `core/guardado.js`: `enCola` (se anota en disco
  de inmediato, para poder recuperar si la pestaña muere a mitad, pero NO se
  muestra) y `pendientes` (ya falló: eso sí se muestra y se reintenta). Además,
  *"Guardando…"* solo aparece si el guardado pasa de 900ms. Medido: 6 guardados
  seguidos → 0 avisos en pantalla; forzando un fallo real → el chip rojo, la
  barra y el espejo local siguen funcionando igual.
- **El ícono del taller ya se sube como cualquier otra imagen.** Era el único
  punto de la app que seguía pidiendo por `prompt` que pegaras el LINK de una
  imagen alojada en otro lado — quedó de antes de que existiera la subida a
  Drive. Ahora, tanto desde el logo del panel como desde Configuración → Marca,
  se elige un archivo y se sube a la misma carpeta de Drive que las fotos de
  referencia, con su miniatura, su "ver en grande" y su ✕ para quitarlo. El
  emoji sigue disponible como alternativa, ahora en su propio campo: antes un
  solo campo servía para las dos cosas, así que guardar con el campo vacío te
  borraba el ícono sin haberlo pedido.
- **El formulario de Finanzas tenía diez campos con el mismo peso visual.** El
  monto se veía igual que "unidad (opcional)". Ahora son tres bloques con
  jerarquía propia: *qué pasó* (el tipo como control segmentado con las tres
  opciones a la vista, y el monto como campo grande en mono de 26px), *con
  quién y a qué se asocia*, y *compra de insumo* recogida detrás de una casilla
  — sus cuatro campos solo aparecen al marcarla. Al entrar se ven 7 campos en
  vez de 11, y el botón dice qué vas a registrar ("Registrar pago de nómina").
  Los campos de insumo pasaron a vivir en el borrador (`state.formTx`) en vez
  de leerse del DOM, que es lo que permite ocultarlos sin romper el guardado.
- **La campanita se apaga al mirarla.** El punto rojo contaba el total de
  avisos, así que seguía encendido después de abrir el panel y leerlo entero.
  Ahora cuenta solo los NO vistos (`state.ui.avisosVistos`, persistido y podado
  a lo que sigue existiendo): abrir el panel apaga el punto, y un aviso nuevo
  vuelve a encenderlo. El panel sigue mostrando todo, visto o no — lo que se
  apaga es la alerta, no la información.

## Registro de cambios — agosto 2026 (segunda ronda: guardado, avisos y aire)

**El guardado ya no puede perder un día de trabajo.** Era el único fallo que
quedaba bloqueante: `persist()` atrapaba los errores y solo los escribía en la
consola, así que si el token de Google no se podía renovar (pasa con cookies de
terceros restringidas: Brave, Safari, incógnito), se seguía trabajando toda la
tarde viendo todo bien en pantalla y al cerrar la pestaña se perdía. Se atacó
de raíz, no con un aviso, en `js/core/guardado.js`:

1. **Espejo local** en `localStorage` (no `sessionStorage`: tiene que
   sobrevivir a cerrar el navegador). El disco del usuario es una segunda copia
   real, así que "no se pudo guardar" deja de significar "se perdió".
2. **Cola con reintento automático**: lo que falló se reintenta solo al volver
   la conexión, al volver a la pestaña y cada 15s. Es seguro porque cada
   escritura manda el blob COMPLETO de esa clave — una escritura exitosa repara
   todas las que fallaron antes, sin necesidad de ningún merge.
3. **Visibilidad**: un chip en la barra superior (Guardado / Guardando… /
   Sin guardar (N)), una barra roja que estorba mientras algo no esté a salvo,
   y el navegador pregunta antes de cerrar. Al volver a entrar, si quedó algo
   pendiente, se ofrece **recuperarlo** — nunca se restaura solo, porque el
   espejo es de ese navegador y podría pisar algo hecho desde otro dispositivo.

**Bug de fechas encontrado al correr la app de verdad en el navegador.**
`todayStr()` usaba `toISOString()`, que da la fecha en **UTC**: en Colombia
(UTC-5), a partir de las 7 de la noche la app ya creía que era el día
siguiente. Un abono recibido a las 8pm quedaba fechado mañana y no salía en el
reporte de "Hoy"; peor, el último día del mes el corte de periodo (del que
dependen la nómina y los gastos fijos) saltaba al mes siguiente, dejando el
pago en el periodo equivocado y el gasto otra vez como pendiente. En un taller
que cierra de noche, eso pasaba todos los días. Ahora usa la fecha local, con
la misma función que ya existía para Calendar.

**Campanita de avisos** (barra superior, con contador): reúne lo que hay que
mirar hoy — las notas con fecha de hoy o vencidas, los cambios que un vendedor
propuso y siguen sin autorizar (precio de insumo, precio de producto,
movimiento manual de stock) y las entregas de hoy o vencidas. Cada aviso lleva
a donde se resuelve. El cálculo vive en `calcNotificaciones` (core/calc.js)
para que el número del contador y la lista salgan del mismo lado. Un vendedor
no ve las autorizaciones: no aprueba nada.

**Aire y jerarquía**: escala de espaciado en `variables.css` (`--sp-1`…`--sp-6`)
en vez de que cada archivo eligiera sus propios números, aplicada a tarjetas,
secciones, filas y sub-títulos. El aviso de **sobrecosto** de Cotizaciones →
Producción, que quedaba como un pie de foto pegado a la tabla, ahora es un
bloque propio con la cifra grande y una segunda línea que dice contra qué se
compara (medido: de 33px a 76px de alto, con 22px de aire arriba en vez de 10).

**Móvil**: las filas de tabla ahora son **etiqueta a la izquierda, valor a la
derecha**, cada fila con su propia tarjeta. Antes se apilaban etiqueta sobre
valor separadas por 1px y varias filas seguidas se leían como un bloque de
texto corrido. Medido en Finanzas: **de 327px a 199px por fila** (-39%), sin
desborde horizontal en ninguna pestaña. El reparto de columnas es explícito
(etiqueta a la 1, todo lo demás a la 2), no por orden de aparición: así las
celdas sin etiqueta —la tira de botones del final— no descolocan la fila.
También: formularios a una columna, campos de referencia apilados, panel de la
campanita anclado a la pantalla y el correo de la sesión oculto para que quepan
la campanita y el estado del guardado.

> Para revisar la interfaz sin tocar datos reales hay una configuración de
> servidor local en `.claude/launch.json` (`npx http-server . -p 4173`).

## Registro de cambios — agosto 2026 (revisión previa a empezar a usarla)

Repaso completo buscando lo que pudiera romperse, confundir o descuadrar las
cuentas. Lo que se encontró y se corrigió:

**Plata (lo grave):**

- **Una cotización escalada ya no pisa el pedido original sin permiso.** Al
  "escalar" un pedido rápido, la cotización nace apuntando a ese pedido
  (`pedidoOrigenId`), pero todavía es un borrador. La sincronización
  automática lo tomaba como si ya fuera ese pedido: **guardar el borrador
  reescribía en silencio el total, el costo y las líneas de un pedido real**, y
  el botón "Aplicar a pedido" —con su confirmación— dejaba de significar nada.
  Ahora la propagación mira solo `pedidoId` (la cotización que YA es ese
  pedido). Ver `calcDesfaseCotizacionPedido` y `propagarFechaEntrega`.
- **Los reembolsos ya no suman al abonado.** Un reembolso vive en la lista de
  abonos del pedido pero con signo negativo. Al editar cualquier abono, el
  total abonado se recalculaba sumando TODAS las filas: el reembolso se
  contaba como si fuera un abono más, inflaba lo cobrado y **borraba saldo por
  cobrar que sí existía**. La suma ahora vive en un solo lugar
  (`calcAbonadoDeLista` en `core/calc.js`, con `recalcularAbonoPedido` en
  `modules/pedidos.js` para respetar los pedidos viejos sin lista de abonos).
- **No se pueden borrar sueltos los movimientos que generó la app.** Borrar en
  Finanzas el movimiento de un abono, una comisión, una cuota de deuda o un
  gasto fijo sacaba la plata de la caja pero dejaba al pedido diciendo que ya
  cobró y a la obligación diciendo que ya se pagó. Ahora esos movimientos
  están marcados en su origen (`origenSistemaDeTx`) y, al intentar borrarlos,
  la app dice exactamente en qué pantalla se revierten de verdad. Es el mismo
  criterio que ya bloqueaba editarles el tipo y el monto.
- **Se agregaron los caminos de vuelta que faltaban**: "Eliminar" en cada
  abono/reembolso de un pedido y en cada venta reportada de una consignación.
  Los dos revierten los dos lados a la vez (el registro y su movimiento en
  Finanzas). Una venta de consignación mal digitada antes no se podía corregir
  de ninguna forma.
- **Un abono mayor al saldo ya no se recorta en silencio.** Escribir 150.000
  sobre un saldo de 100.000 registraba 100.000 sin avisar. Ahora se pregunta y
  se registra el monto que el usuario vio.
- **"Registrar estimado completo" dejó de duplicar el gasto.** Cada clic creaba
  un movimiento nuevo por el mismo costo (tres clics, tres veces el costo del
  pedido en la caja). Ahora actualiza el que ya creó, y avisa del doble conteo
  si ese pedido también lleva sus compras reales a Finanzas (y al revés).

**Se rompía:**

- **La pestaña Pedidos se caía entera** con un pedido que tuviera costo pero
  todavía sin precio de venta (algo normal: se costea la prenda antes de
  ponerle precio). El porcentaje de ganancia no existe sin precio, y al
  formatearlo reventaba el render de toda la pestaña.
- **Barra de progreso con un flujo de una sola etapa**: dividía por cero.

**Confundía:**

- El explorador de productos dejaba agregar una línea que el borrador ya no
  podía cubrir; el error salía recién al pulsar "Crear pedido". Ahora se avisa
  al momento de elegirlo.
- El reporte con el rango de fechas al revés mostraba ceros en todo, que se
  leía como "este periodo no tuvo movimientos". Ahora lo dice.
- Eliminar una consignación no devolvía al Catálogo lo entregado al punto (la
  mercancía sigue físicamente allá) — pero tampoco lo decía, y en venta directa
  sí se restituye. Ahora se advierte antes de confirmar.
- Renombrar una talla del Catálogo rompía la devolución de stock de los pedidos
  que ya habían salido con ese nombre. Ahora se advierte cuando esa talla ya
  tiene stock o movimientos.
- La factura de una venta directa imprimía UNA sola línea con toda la
  descripción amontonada y un "valor unitario" que era el total dividido entre
  las unidades — un precio promedio que no se le cobró a nadie. Ahora imprime
  una línea por cada línea del pedido, con su precio real.

**Prueba de humo** (`test/smoke.mjs`): estaba desactualizada y no llegaba ni a
la mitad (esperaba campos de "total" en el formulario de pedido y un buscador
de productos que ya no existen). Se puso al día con la app actual y se le
agregaron los checks de las correcciones de arriba — incluida la igualdad
exacta entre lo que dice el pedido y lo que dice Finanzas. Son 173 checks y
ahora termina sola en vez de quedarse colgada.

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
   tu correo y el de cada persona del equipo que vaya a entrar. Este paso es
   **el único que queda fuera de la app** (ver más abajo, "Agregar a alguien
   al equipo") — Google no expone ninguna API para la lista de test users,
   es pura configuración de la pantalla de consentimiento.
3. **Credenciales** → crear un **OAuth Client ID** de tipo "Web application"
   → en "Authorized JavaScript origins" agregar `https://criyeak.netlify.app`
   y `http://localhost:8080` (o el origen que uses en desarrollo).
4. **Google Sheets** → crear una hoja nueva (ej. "Panel del Taller — datos")
   → compartirla como **Editor** con tu propia cuenta (la del primer admin —
   los siguientes se agregan desde la app, ver abajo) → crear dos pestañas
   dentro:
   - `kv` con encabezados `key` | `value` (queda vacía; la app la llena sola).
   - `roles` con encabezados `correo` | `rol` | `vendedor_nombre`. Agrega ahí
     tu propio correo con `rol = admin` (el resto del equipo se agrega desde
     Configuración → "Equipo" una vez que la app ya esté andando, no hace
     falta editar la Sheet a mano de nuevo).
5. Copiar el **Client ID** (paso 3) y el **ID de la spreadsheet** (se ve en
   su URL, entre `/d/` y `/edit`) en `js/core/google-config.js`. Ninguno de
   los dos es secreto — el acceso real lo controla a quién compartiste la
   hoja, no quién conoce estos valores.

Con eso completo, recargar la app: debe pedir "Continuar con Google", un
solo consentimiento (Sheets + Drive + tu correo), y entrar según lo que diga
tu fila en `roles`. Un correo que no esté en esa pestaña ve "Acceso no
autorizado".

### Agregar a alguien al equipo (admin o vendedor)

Configuración → tarjeta "Equipo": correo + rol (+ nombre, si es vendedor) →
"Agregar al equipo". Un solo paso hace lo que antes eran tres manuales: (1)
agrega la fila en la pestaña `roles`, y (2) comparte automáticamente la
Google Sheet y la carpeta de imágenes de Drive (si ya existe) con ese
correo — ver `agregarMiembroEquipo()` en `core/auth.js` y
`compartirRecursosConNuevoMiembro()` en `core/drive.js`.

- **Sigue quedando un paso manual, fuera de la app, inevitable**: agregar el
  correo como *test user* en Google Cloud Console → OAuth consent screen
  (paso 2 de arriba). No hay forma de saltárselo por API — es la política de
  Google mientras la app esté en modo Testing (permite hasta 100 test users
  sin pedir verificación, de sobra para un taller). El diálogo de "Agregar
  al equipo" te lo recuerda al terminar.
- Si el correo ya está en `roles`, no lo duplica — avisa que ya está.
- Un correo agregado como `admin` puede, a su vez, agregar a más gente —
  no hace falta que sea siempre el mismo admin quien gestione el equipo.

### Imágenes de referencia → Google Drive (carpeta del admin)

En Cotizaciones, la miniatura de cada referencia ("+ imagen") ahora sube un
archivo desde el dispositivo (antes solo se podía pegar un link externo).
Ver `js/core/drive.js`. Detalles a tener en cuenta:

- Todas las imágenes (las subas vos o cualquiera del equipo) caen en **una
  sola carpeta "Panel del Taller — imágenes" dentro del Drive de quien la
  creó** (el primer admin que suba una imagen), no en el Drive personal de
  cada quien. Se crea automáticamente la primera vez que un admin sube una
  imagen — si alguien más llega antes de que exista, ve un aviso pidiéndole
  que espere a que un admin la cree.
- Al crearla, se comparte automáticamente con todo el equipo que ya estaba
  en `roles` en ese momento. A partir de ahí, cada persona nueva que se
  agrega vía "Equipo" (arriba) queda compartida en el mismo paso — ya no
  hace falta un botón aparte de "actualizar accesos".
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

## Cliente 360°

Cada ficha de Clientes muestra ahora un resumen de la relación con ese
cliente (`calcHistorialCliente()` en `core/calc.js`): cantidad de pedidos,
total comprado, y la fecha de la última entrega registrada — sin tener que
ir a buscarlo pedido por pedido en la pestaña Pedidos. Con más de un pedido,
el nombre lleva una insignia "↻ Recurrente".

- Se calcula solo sobre **Pedidos** (no cotizaciones sin convertir): es lo
  que de verdad se vendió, no lo que se cotizó.
- "Última entrega" usa `fechaEntrega` porque el pedido no guarda una fecha
  de creación propia — está etiquetado como tal a propósito, para no
  insinuar que es la fecha en que se hizo el pedido.

## Finanzas: origen de cada movimiento + protección contra desincronizar la plata

Primer paso de una ronda de rediseño de UX pedida por el usuario (ver
"Ideas para la fase 2" al final). Reportó dos problemas reales: (1) un
movimiento de tipo "comisión" se podía editar a "ingreso" desde Finanzas,
invirtiendo su signo en la caja sin que el pedido/comisión real se enterara,
y (2) no había forma de saber de un vistazo de dónde salió un movimiento.

- **`origenDeTx(t)`** (`core/calc.js`): dado un movimiento, encuentra el
  registro real que lo generó — pedido, cotización, gasto fijo o deuda —
  usando los IDs que cada acción del sistema ya deja en el propio tx
  (`pedidoId`, `cotizacionId`, `gastoFijoId`, `deudaId`). Un movimiento
  cargado a mano desde "Registrar movimiento" no tiene ninguno de esos IDs,
  así que `origenDeTx` devuelve `null` para él.
- **Botón "↗ Origen"** en cada fila de Finanzas que sí tiene uno: cambia de
  pestaña y hace scroll hasta el pedido/cotización/gasto fijo/deuda real
  (mismo patrón que ya usaba "Ver cotización relacionada" en Pedidos).
- **Edición bloqueada donde importa**: si el movimiento tiene un origen, su
  `tipo` y `monto` quedan de solo lectura al editar (solo fecha/concepto/
  persona siguen editables) — cambiarlos a mano es exactamente lo que
  causaba el bug reportado. Un movimiento sin origen (cargado a mano) sigue
  totalmente editable, sin restricciones, como siempre.
- Motivo de "las matemáticas tienen que ser perfectas": esto que reportó el
  usuario podía **invertir el signo de un movimiento en `calcCaja()`** sin
  tocar el pedido real — la fila de edición ya no ofrece esa posibilidad
  para movimientos con origen conocido.

## El IVA: qué es del taller y qué no (no revertir esto)

**La regla, en una frase: el IVA no es plata del taller.** Se le cobra al
cliente y se le gira al Estado; el taller solo lo tiene guardado un rato. De
ahí salen dos consecuencias que la app trata **por separado**:

| | ¿Lleva IVA? | Por qué |
| --- | --- | --- |
| Lo que el cliente **debe** (cartera, saldo, "Por cobrar") | **Sí** | Se lo facturaste: si la factura dice $1.190.000, eso te debe |
| Lo que el taller **gana** (margen, ganancia, reportes) | **No** | Esos $190.000 nunca fueron suyos; contarlos infla la ganancia un 19% |
| La **caja** | Sí, el dinero está ahí | Pero una parte tiene dueño: ver el KPI "IVA cobrado" |

**Qué estaba mal.** `calcSaldoPedido` era `total − abono` con el total **sin**
IVA, mientras la factura cobraba **con** IVA. Un cliente que pagaba su factura
completa dejaba el pedido en saldo **negativo**, y la app anunciaba un "saldo a
favor del cliente" de exactamente el IVA — plata que en realidad hay que
girarle a la DIAN. El KPI "Por cobrar" también quedaba corto por ese 19%, y la
factura en PDF se contradecía a sí misma delante del cliente ("TOTAL
$1.190.000 / Abonado $0 / SALDO PENDIENTE $1.000.000").

**Cómo quedó.** Todo entra por `core/calc.js`:

- `calcIvaPedido(p)` — el IVA del pedido (0 si no aplica).
- `calcTotalConIvaPedido(p)` — lo que dice la factura.
- `calcSaldoPedido(p)` = total con IVA − abonado. **Una sola fórmula**, y de
  ella cuelgan el panel, la cabecera de la tarjeta, el KPI "Por cobrar", el
  filtro "con saldo pendiente", "Marcar saldo cobrado" y la factura en PDF.
- `calcIvaCobrado(p)` — del dinero ya cobrado, cuánto es IVA (proporcional: si
  pagaron la mitad de la factura, se cobró la mitad del IVA).
- `calcIvaCobradoTotal()` — alimenta el KPI **"IVA cobrado"** del Resumen, que
  solo aparece si hay algo. En un taller que no factura IVA, esa tarjeta no
  existe y no estorba.

En pantalla el panel de dinero desglosa **Valor del pedido → IVA 19% → Total a
cobrar → Abonado → Falta por cobrar**, así que las cinco cifras suman a la
vista; y bajo la barra de cobro avisa cuánto de lo ya cobrado le pertenece al
Estado. Un pedido sin IVA (o guardado antes de que existiera el campo) da
exactamente el número de siempre.

**Lo que NO se tocó a propósito:** la ganancia, el margen y el reporte de
productos vendidos siguen midiéndose sobre la base sin IVA — que es lo
correcto. Si algún día hay que llevar el IVA como una obligación formal (con su
fecha de declaración), el lugar natural es Pendientes, junto a las demás
cuentas por pagar; hoy el KPI cumple el papel de recordarlo sin obligar a
mantener nada.

## Tres formas de costear, y una de cobrar: costo global vs. servicio cobrado

Un pedido tiene costos que no son de ninguna prenda en particular. Hasta acá
había una sola forma de manejarlos —el **costo global del pedido**— y desde
que el diseño se empezó a cobrar aparte hay dos, que no se deben confundir:

| | Costo global del pedido | Se cobra aparte al cliente |
| --- | --- | --- |
| Ejemplos | Domicilio, envío a sublimar | Diseño, un arreglo, un bordado suelto |
| Dónde vive | `cot.costosGlobales` | `cot.serviciosCobrados` |
| Tiene precio propio | No | Sí (`precio`) |
| Se reparte entre las prendas | Sí, entre todas | **No** |
| Sale en la cotización del cliente | No | Sí, como su propia línea |
| Cuenta como prenda | No | No |

La regla que separa a los dos: **un costo global no se puede atribuir a nada,
así que se reparte y se recupera dentro del precio de las prendas; un servicio
cobrado sí se atribuye —a sí mismo—, tiene precio propio y por eso NO se
reparte.** Repartirlo además de cobrarlo sería cobrarlo dos veces, y dejaría el
margen de cada prenda peor de lo que realmente es.

Un insumo se convierte en cualquiera de los dos eligiéndole su **tipo de
costo** (mismo gesto de siempre), y se puede devolver por el mismo camino. Al
volverse servicio cobrado conserva su costo y nace con precio 0: cuánto cobrar
es una decisión aparte y no se hereda de lo que cuesta.

**La comisión del vendedor se calcula sobre las prendas, no sobre el total
facturado** (`precioPrendas` en `calcCotizacionTotales`, `calcBaseComision` en
el pedido). Un servicio cobrado es en buena parte un costo que solo pasa de
largo —hay que pagarle a quien lo hace—, así que comisionarlo puede dejar esa
línea en pérdida; es el mismo criterio que nadie aplica a un domicilio. Una
cotización sin servicios da exactamente el mismo número de siempre.

El IVA sí aplica sobre todo lo facturado, servicios incluidos: se calcula
sobre el subtotal, que ya los trae.

Lo que hay que respetar al tocar esto (ver el test de humo, que lo afirma con
igualdad exacta): el total y el costo de la cotización, la suma de las líneas
del pedido, y lo que reporta "productos vendidos" tienen que dar **el mismo
número**, antes y después de convertir.

## Cotizaciones: modo demo + la cantidad sigue al listado de tallas

Dos ajustes chicos, pero que tocan dinero, así que van documentados aparte:

- **Modo demo** (botón "🧪 Marcar como prueba" / "✓ Hacer real" en cada
  cotización, campo `esDemo`): una cotización de prueba queda excluida de
  TODO cálculo financiero real — comisiones pendientes (`calcComisionesPendientesCot`,
  `calcSaldosVendedores`, `calcResumenPorPagar`), "Mis ventas"
  (`calcVentasVendedor`, y su listado propio en `mis-ventas.js`) y el
  listado de "Cotizaciones sin convertir" en Resumen. **Es reversible en
  los dos sentidos** (demo → real y real → demo) en cualquier momento, sin
  perder nada de lo cargado. Convertir una cotización en pedido (con
  "Convertir en pedido" o "Aplicar a pedido") siempre la vuelve real de
  paso — no existe el concepto de "pedido de prueba".
- **La cantidad cotizada nunca puede ser menor que el listado de tallas**:
  agregar filas a "Tallas y observaciones" (a mano, por CSV, por curva de
  tallas o cargando un roster) sube `cantidadPedida` si el listado resultante
  la supera — nunca al revés (borrar filas no baja la cantidad sola). Ver
  `conDetalleAgregado()` en `modules/cotizaciones.js`, usado por las 4
  acciones que agregan filas para que ninguna se quede desincronizada.

## Cotizaciones: rediseño (pestañas Nueva/Historial, referencias en pestañas, flujo progresivo)

Reportado como "muy complejo, muchas opciones, difícil de entender para
alguien nuevo". Tres cambios de estructura, sin tocar ninguna función de
negocio existente (todo lo de arriba sigue funcionando igual):

- **Dos pestañas arriba, estilo hoja de cálculo** (`state.cotizacionesVista`:
  `"nueva" | "historial"`, siempre a la derecha): "+ Nueva cotización" (el
  formulario en blanco, protagonista) e "Historial" (todo lo ya creado,
  donde se sigue editando). Crear una cotización salta directo a Historial
  para seguir trabajándola. La primera vez que se entra a Cotizaciones en
  una sesión recibe con "Nueva" (default en `store.js`); entrar y salir por
  el menú lateral después de eso **no** resetea la vista — solo saltan a
  Historial explícitamente las acciones que apuntan a una cotización
  puntual ("Ver cotización relacionada" desde Pedidos, "Ver origen" desde
  Finanzas, "escalar a cotización", el botón "Ver cotizaciones" de Resumen).
  Este matiz salió de un test de humo que falló: resetear en cada clic de
  pestaña rompía ir a Pedidos y volver a seguir editando algo en Historial.
- **Referencias en pestañas, no apiladas con scroll** (`state.refActiva`:
  `{ [cotId]: refId }`): con más de una referencia, solo se ve la activa;
  el resto queda como pestañas cortas (nombre + precio total) arriba. Se ve
  la primera vez que la cotización tiene 2+ referencias — con solo una, no
  hay pestañas que mostrar. Agregar una referencia nueva la deja activa de
  una vez.
- **"Tallas y observaciones" es progresiva**: colapsada por defecto en una
  referencia nueva (no todas las prendas necesitan tallas por unidad) — se
  abre sola en cuanto tiene datos, o en cuanto una plantilla le sugiere una
  curva de tallas (si no, el botón para generarla quedaría escondido). El
  resto de las secciones opcionales (costos reales, estados de producción,
  PDF interno) ya eran colapsables desde antes (`renderSeccionColapsable`) —
  no hizo falta tocarlas, ya cumplían con "no saturar la vista de una".

## Configuración: KPIs consolidados + reporte unificado con gráfica + gasto en insumos

Antes los KPIs (caja, por cobrar, por pagar, pedidos activos) se repetían
arriba de TODAS las pestañas del admin — reportado como ruido. Y había dos
tarjetas de "reporte financiero" que no hablaban entre sí: una con números
de TODO el histórico, otra con un selector de fechas que solo servía para
el PDF. Se resolvieron juntas porque el arreglo es el mismo: un solo lugar,
una sola fuente de verdad.

- **KPIs solo en Configuración** (`renderKpis()` en `modules/config.js`,
  movido tal cual desde `core/dom.js`, que ya no los dibuja en ningún lado).
  El test de humo ahora verifica lo contrario de antes: que `.kpis` NO
  aparezca fuera de Configuración.
- **Un solo panel de reporte**: el rango de fechas (con los mismos atajos de
  siempre — hoy/semana/mes/año) alimenta a la vez los números en pantalla y
  el botón de PDF. Los dos usan **`calcResumenMovimientos()`** (nueva, en
  `core/calc.js`) — la misma función que antes solo vivía duplicada dentro
  de `generarPDFReporteFinanciero()` en `core/pdf.js`, así que ya no pueden
  mostrar números distintos para el mismo rango.
- **La gráfica en vivo vive en Resumen, no en Configuración** (ajustado
  luego de la entrega inicial de esta fase — se probó primero acá y se
  pidió moverla): sin selector de fechas, un rango fijo de últimos 30 días,
  para que Resumen siga siendo "un vistazo al entrar" y no otro panel de
  controles. Mismo cálculo (`calcSerieMovimientos()`, granularidad por día/
  semana/mes según el tamaño del rango) y mismo dibujo SVG plano (sin
  Chart.js — ver `renderGraficaBarras()` en `modules/resumen.js`) que se
  había armado para acá.
- **"Gasto en insumos por mes"** (`calcGastoInsumosMensual()`): NO es
  inventario de lo que hay guardado (el usuario no maneja stock — compra lo
  que cada pedido requiere, ver README arriba). Es cuánto se gastó en
  insumos cada mes, sumado desde las cotizaciones reales de ese mes (las
  demo no cuentan) — para decidir cuándo conviene empezar a comprar al por
  mayor. Reutiliza el mismo cálculo de costo por insumo que ya usaba
  "Lista de compras" (`agregarInsumosDeReferencias()`, factorizada de
  `calcListaCompras()` para no calcular el costo de un insumo de dos formas
  distintas en dos lugares).
- **Meta queda aparte**, con su propio card chico: es un progreso contra SU
  PROPIO periodo (configurado en Pendientes), no contra el rango de fechas
  que el admin elija en el reporte — mezclarlos habría sido confuso, son
  conceptos independientes.

## Cotizaciones: Historial siempre resumido + editor único

Ajuste sobre el rediseño de pestañas de la sección anterior: "Historial"
mostraba tarjetas completas (con un botón aparte para contraerlas) —
reportado como que seguía siendo demasiado para un simple índice. Ahora la
separación es más tajante:

- **Historial es SIEMPRE una tarjeta chica por cotización** (cliente,
  descripción, fecha, total, badges) — nunca el detalle completo de
  referencias/insumos/tallas. `renderCotResumen()`.
- **"+ Nueva cotización" es el ÚNICO lugar con el detalle completo**, tanto
  para crear una cotización desde cero como para editar cualquiera ya
  existente — `state.cotizacionEditando` guarda cuál. Al abrir una desde
  Historial (clic en su tarjeta chica), la pestaña salta ahí, se renombra a
  "✎ Editando cotización" y muestra `renderCotCard()` completo — el mismo
  componente que antes vivía apilado en Historial, solo que ahora aparece
  UNA cotización a la vez. Botón "← Nueva cotización en blanco" para
  soltarla y empezar una de cero sin perder la que se estaba viendo.
- Se eliminó el campo `colapsada` y el botón de contraer/expandir por
  tarjeta — quedaron reemplazados por completo por esta separación de
  pestañas, no hacía falta mantener las dos formas de "resumir" una
  cotización a la vez.
- **"Ver origen" (Finanzas) y "Ver cotización relacionada" (Pedidos) abren
  el detalle completo directo** (`cotizacionEditando` + pestaña "nueva"),
  en vez de navegar a Historial y hacer scroll hasta una tarjeta que ahora
  solo mostraría el resumen — no tendría sentido llevar a alguien a ver
  algo que no puede ver ahí.

## Indicadores: un solo lenguaje visual

Reportado: los indicadores chicos de estado (badge, tag, status-pill)
tenían cada uno su propio tamaño/radio, sutilmente distintos entre sí sin
ninguna razón — y varios se coloreaban con `style=""` inline repetido en
vez de una clase, cada vez que hacía falta un color nuevo.

- **Una sola receta de forma** para `.badge`, `.tag` y `.status-pill`
  (tamaño de letra, padding, radio — ahora los tres son "pill" redondeados
  del todo) en `css/tables.css`, con los mismos 4 colores semánticos
  (`success`/`warning`/`danger`/`info`) ya definidos en `variables.css`.
  `.badge` ganó las clases `.warning`/`.success`/`.danger`/`.info` — los
  usos que antes coloreaban con `style="background:...` inline (🧪 Prueba,
  ↻ Recurrente, 🏬 Consignación) ahora usan esas clases.
- **KPIs con más profundidad**: sombra sutil siempre, y los clickeables se
  levantan un poco al pasar el mouse (además del cambio de borde/fondo que
  ya tenían) — la misma afordancia "esto se puede tocar" de cualquier
  tarjeta interactiva conocida.
- Montos y valores de KPI usan `font-variant-numeric: tabular-nums`, para
  que los dígitos siempre midan lo mismo (un detalle chico, pero se nota
  cuando hay números cambiando de valor en la misma posición).
- **Botones**: el primario (sólido, acento) suma sombra + se levanta un
  poco al pasar el mouse — reservado para LA acción principal de cada
  pantalla. Ghost/danger se quedan planos a propósito: son la mayoría de
  los botones (tablas densas, acciones secundarias) y darles el mismo
  efecto habría sentido "todo se mueve" en vez de señalar qué es lo
  importante. Todos ganaron un `:active` sutil (que se sienta el clic al
  soltar el mouse) y un anillo de foco igual al que ya usaban los inputs
  (`css/forms.css`), para poder navegar la app con teclado.

## Lenguaje: dos campos renombrados

Del pedido original ("hay campos que se repiten o cumplen la misma función
y se llaman distinto") — un barrido completo de cada etiqueta de la app es
un trabajo aparte y más largo, pero estos dos eran el caso concreto que
generaba confusión real:

- **Finanzas → "Persona / cliente" pasó a "Persona / contraparte"** (con un
  ayuda "?" que lo explica): ese campo (`contraparte`) no siempre es un
  cliente — es quien sea que esté del otro lado del movimiento (un
  vendedor cuando es una comisión, un proveedor, un empleado en nómina).
  Llamarlo "cliente" siempre fue impreciso, y es parte de lo que generaba
  la confusión original de "¿por qué el vendedor me da un ingreso?".
- **Cotizaciones → "Descripción general" pasó a "Descripción"**, para que
  diga lo mismo que el campo equivalente en Pedidos (que nunca tuvo el
  "general") — mismo concepto, mismo nombre en las dos pestañas.

## Estructura

```
index.html
manifest.json        PWA: nombre, ícono, colores — lo que hace aparecer "Instalar app"
sw.js                 service worker: cachea el cascarón (html/css/js) para abrir sin internet
icons/                iconos de la PWA (192/512/512-maskable/apple-touch/favicon)
_headers              cabeceras del hosting (Cache-Control: no-cache en todo)
css/
  variables.css      tokens de color/radios — cambia el tema completo
  base.css            reset + contenedor
  layout.css           header, tabs, kpis, cards, títulos de sección
  forms.css             inputs, botones, chips, filtros (compartido)
  tables.css             filas de transacciones (tx-row), tags, montos
  pedidos.css              solo pestaña Pedidos
  cotizaciones.css         solo pestaña Cotizaciones
  catalogo.css             solo pestaña Insumos (categorías + jerarquía de la fila)
  plantillas.css           solo pestaña Plantillas (índice de tarjetas + detalle)
  clientes.css             solo pestaña Clientes
  pendientes.css           solo pestaña Pendientes
  config.css               solo pestaña Configuración
  atajos.css           panel de atajos de teclado (tecla "?")
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
    components.js          piezas de HTML COMPARTIDAS: buscador, tarjeta de índice,
                             combobox de cliente, burbuja de ayuda, tipos de costo.
                             Antes de escribir un componente nuevo, mirar acá.
    graficas.js             configuración compartida de Chart.js (paleta del tema, defaults, opciones)
    dom.js                 orquestador: layout fijo + registro de acciones + filtro por rol
    teclado.js              navegación por teclado de toda la app (atajos, Esc, flechas)
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

## Navegación por teclado

Toda la app se puede usar sin mouse. La lógica está en `core/teclado.js`, en
un solo archivo, y el panel de ayuda que se abre con `?` (o con el botón del
teclado en la barra superior) lista exactamente los atajos que ese archivo
implementa — si se agrega uno, se agrega en las dos partes o queda invisible.

| Tecla | Qué hace |
| --- | --- |
| `Tab` / `Mayús+Tab` | Elemento siguiente / anterior |
| `Enter` | Estando en un campo, salta al campo siguiente |
| `Esc` | Cierra la capa de más arriba: panel de atajos → imagen ampliada → ventana de insumos/productos → avisos → cajón del menú en móvil. Si no hay ninguna, suelta el foco del campo |
| `Alt` + `1…9`, `0` | Va a esa sección del menú, en el orden en que se ve |
| `Alt` + `↓` / `↑` | Sección siguiente / anterior |
| `Alt` + `M` | Pone el foco en el menú lateral |
| `↑` `↓` `Inicio` `Fin` | Dentro del menú: mover el foco entre secciones |
| `←` `→` | Dentro del menú: cerrar / abrir la categoría |
| `/` o `Ctrl+K` | Va al buscador de la sección, si tiene |
| `Alt` + `B` | Colapsa/expande el menú lateral |
| `Alt` + `T` | Cambia entre tema claro y oscuro |
| `?` | Muestra u oculta el panel de atajos |

Tres decisiones que conviene no revertir sin querer:

- **El menú usa *roving tabindex***: solo la sección activa es tabulable
  (`tabindex="0"`), las demás se alcanzan con las flechas. Sin esto, pasar del
  menú al contenido costaba doce `Tab`. Se complementa con el enlace "Saltar
  al contenido", que es el primer elemento tabulable de la página y solo se ve
  cuando tiene el foco.
- **Cada botón del menú tiene un `id` estable** (`nav-tab-<clave>`): `render()`
  reemplaza el DOM entero y solo sabe devolver el foco a elementos con `id`
  (ver `activeId` allá). Sin el `id`, cada cambio de sección con el teclado
  perdía el foco y las flechas dejaban de encadenar.
- **Esc resuelve las capas por selector CSS, no por clave de estado**: cada
  overlay ya lleva en su `data-action` la acción que lo cierra bien (limpiando
  su selección, su búsqueda…), así que una ventana nueva que siga el mismo
  patrón `picker-overlay` queda cubierta sin tocar `core/teclado.js`.

Los atajos con `Alt` funcionan también mientras se escribe en un campo (`Alt`
no produce texto); las teclas sueltas `/` y `?` no, para que se puedan
escribir. Nota de navegador: en Firefox para Windows, `Alt`+número está
tomado por el propio navegador para cambiar de pestaña y no llega a la página
— ahí sirven `Alt`+`↓`/`↑`, que no chocan con nada.

## Persistencia

Cada área de negocio vive en su propia clave de `window.storage`
(`finanzas:transacciones`, `pedidos:lista`, etc. — ver `core/constants.js`).
Esto ya estaba así en el original y se mantuvo: significa que una escritura
en Pedidos nunca puede corromper los datos de Finanzas.

### Instalar la app

En Chrome/Edge (computador): ícono "Instalar" en la barra de direcciones, o
menú ⋮ → "Instalar Panel del Taller". En Android: menú ⋮ → "Instalar app" (o
el banner que Chrome ofrece solo). En iPhone/iPad: Safari → botón compartir →
"Agregar a inicio" (iOS no ofrece un botón de instalar como tal para sitios
web; este camino hace lo mismo — un ícono propio, sin barra de Safari).

Nada de esto depende de tener SPREADSHEET_ID/GOOGLE_CLIENT_ID configurados —
`manifest.json` y `sw.js` son independientes del resto del setup, así que se
puede instalar la app incluso antes de terminar de configurarla.

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
