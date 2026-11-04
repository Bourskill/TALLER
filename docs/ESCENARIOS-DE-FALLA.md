# Escenarios de falla: «¿qué pasa si…?»

**Para qué sirve:** antes de que algo falle de verdad, saber **qué lo causa, qué vería el dueño, qué lo defiende y qué prueba lo cubre**. Si no hay defensa, se dice **SIN DEFENSA** con su severidad.

Cada afirmación cita `archivo:línea`. Los números de línea se verificaron contra el código el día que se escribió este documento; `test/arquitectura.mjs` avisa cuando una cita quedó vieja. Contexto: [`ARQUITECTURA.md`](ARQUITECTURA.md) (cómo viaja un dato) y [`MAPA-DEL-DINERO.md`](MAPA-DEL-DINERO.md). Los riesgos nuevos tienen su Hallazgo (#67) en `CONTABILIDAD.md`; aquí se identifican como **#67-N**.

**Cómo leer el estado:**
- **DEFENDIDO** — hay un mecanismo en el código **y** una prueba automática.
- **PARCIAL** — protege parte del caso; se dice qué queda abierto.
- **SIN DEFENSA** — nada lo vigila. Severidad **alta** = puede perder o falsear plata sin que nadie lo note; **media** = hace falta otra falla o una persona con acceso; **baja** = incómodo o cosmético.
- **SIN PRUEBA** — el código lo defiende pero ninguna prueba automática lo ejerce (si alguien lo rompe, nadie se entera).

## Resumen

| # | Escenario | Estado | Severidad |
|---|---|---|---|
| 1 | Se cae la red a mitad de un guardado | PARCIAL | media |
| 2 | Un mismo hecho de dinero se escribe en dos claves y la segunda falla | PARCIAL | media (#67-4) |
| 3 | Dos computadores editan a la vez | PARCIAL | media |
| 4 | Se abre la app sin red y se sigue trabajando sobre la copia local | PARCIAL | media (#67-3) |
| 5 | Vence el acceso de Google | DEFENDIDO en el código, SIN PRUEBA | baja |
| 6 | La hoja se borra, se mueve o se pierde el acceso | PARCIAL | media |
| 7 | Una pestaña de datos queda vacía o la borran | **SIN DEFENSA** | **alta** (#67-1) |
| 8 | La hoja se llena (celda de 50.000 caracteres, límite de filas) | **SIN DEFENSA** | **alta** (#67-2) |
| 9 | Alguien edita la hoja de Google directamente | PARCIAL (detecta, no previene) | media |
| 10 | El navegador se cierra con un guardado en vuelo | PARCIAL | media (#67-5) |
| 11 | Datos viejos con formas antiguas | DEFENDIDO | baja |
| 12 | Un vendedor intenta tocar un mes cerrado | DEFENDIDO en la app; SIN DEFENSA ante la hoja | media |
| 13 | Una columna nueva (o una insertada en medio) en una hoja | DEFENDIDO en el código; SIN DEFENSA si se inserta a mano en la hoja | media |
| 14 | Doble clic o acción repetida | DEFENDIDO | baja |
| 15 | Un movimiento con fecha vacía o mal escrita | PARCIAL (detecta, no previene) | media-baja (#67-7) |
| 16 | Un vendedor usa la consola o cambia su rol | **SIN DEFENSA** (conocido) | alta si no se confía en el equipo (#67-11) |
| 17 | Una propuesta de catálogo manipulada | **SIN DEFENSA** | media (#67-6) |
| 18 | Falla el respaldo, o nadie abre la app | PARCIAL | media |
| 19 | La bitácora no se puede escribir, o se duplica | DEFENDIDO | baja |
| 20 | Un recibo de compra descuadra o falla a mitad | DEFENDIDO | — |
| 21 | Dos pestañas del mismo navegador | SIN PRUEBA | baja |
| 22 | Un pedido pagado queda con «saldo fantasma» de centavos | DEFENDIDO | — |
| 23 | Dos escrituras de la misma clave al mismo tiempo | **SIN DEFENSA** | baja (#67-10) |

---

## 1. Se cae la red a mitad de un guardado

- **Qué lo causa:** el wifi se cae, o Google no responde, mientras `escribirClave` está escribiendo (`js/core/store.js:1887`).
- **Qué ve el dueño:** sus datos siguen en pantalla (el estado en memoria ya cambió). La barra muestra el chip rojo «Sin guardar» y el mensaje «Sin conexión — se reintenta solo en cuanto vuelva» (`js/core/guardado.js:125-129`).
- **Qué lo defiende:**
  - `espejar` copia el JSON en el navegador **antes** de intentar la red (`js/core/guardado.js:133`, llamada en `:372`).
  - `escribirRonda` deja la clave «pendiente» si falla y programa el reintento (`js/core/guardado.js:336-350`); se reintenta cada 15 s, al volver la red y al volver a la pestaña (`js/core/guardado.js:306`, `:265-303`). Como cada escritura manda la clave completa, **una sola escritura buena arregla todas las anteriores** (`js/core/guardado.js:24-29`).
  - Al cerrar la pestaña, `beforeunload` pregunta (`js/core/guardado.js:270-297`).
- **Qué queda abierto:** en una pestaña propia (Movimientos, Clientes, Cotizaciones, Cierres) guardar es **«borrar todo el rango y escribir de nuevo»** (`js/core/sheetsTabular.js:144-150`). Si el borrado funciona y la escritura falla, **la pestaña queda vacía en la hoja** hasta el siguiente guardado bueno. Mientras tanto la copia local y la cola la reparan; si en ese lapso se abre la app (otro computador, o este tras recargar sin que la cola se haya vaciado), pasa lo del escenario 7.
- **Prueba:** `test/smoke.mjs:3852-3910` (aviso al cerrar con un guardado en vuelo o fallido), `:3371-3383` (la carga cae al espejo). **No verificado:** ninguna prueba simula un fallo **entre** el borrado y la escritura de una pestaña propia.

## 2. Un mismo hecho de dinero se escribe en dos claves y la segunda falla

- **Qué lo causa:** un abono toca `tx` (el movimiento) y `pedidos` (la fila del abono); se guardan con **dos `persist` seguidos, sin transacción** (`js/modules/pedidos.js:2521`). Pasa igual con `cobrar`, `add-reembolso`, comisiones, gastos fijos, deudas, Colchón. El caso máximo es `remove-pedido`: **cuatro** claves (`js/modules/pedidos.js:2706-2708`). `add-pedido` con abono inicial escribe `tx` → `productos` → `pedidos`, en este orden: `js/modules/pedidos.js:1933`, `js/core/stock.js:53` y `js/modules/pedidos.js:1984`.
- **Qué ve el dueño:** si la segunda escritura falla por red, el chip rojo; la cola la reintenta y normalmente las dos terminan en la hoja. Si falla por **conflicto** (escenario 3) o si la pestaña se cierra antes, la hoja queda con **un lado sin el otro**: el movimiento está en Finanzas pero el pedido no lo tiene (o al revés).
- **Qué lo defiende:** la cola reintenta cada clave por separado (`js/core/guardado.js:395-425`); el espejo guarda las dos; al recargar, `detectarRecuperacion` ofrece restaurar (`js/core/store.js:1613`); y **«Salud de los datos» lo detecta después**: «Cada abono y reembolso en Finanzas…» (`js/core/salud.js:129`), orígenes que ya no existen (`:234`).
- **Qué queda abierto:** nada impide el estado a medias ni lo repara solo. Si se vuelve a pulsar el botón antes de enterarse (por ejemplo «pagar comisión»), se crea un **segundo** movimiento: `toggle-comision` decide por el estado del pedido (`js/modules/pedidos.js:2348`) y ese estado no llegó a la hoja.
- **Prueba:** `test/salud.mjs:239` (la verificación de abonos y movimientos). **SIN PRUEBA** de la falla a mitad de una escritura doble.
- **Estado:** **PARCIAL — severidad media.** Riesgo **#67-4**.

## 3. Dos computadores editan a la vez

- **Qué lo causa:** el mismo taller abierto en dos computadores; ambos guardan la misma clave.
- **Qué ve el dueño:** el **segundo** en guardar recibe «Alguien más guardó un cambio distinto en <área> mientras tanto — para no perder ni pisar nada, no se sobrescribió» (`js/core/store.js:117`) y un botón **Recargar ahora** (`js/core/dom.js:947`). El chip no insiste solo: un conflicto **no se reintenta** (`js/core/guardado.js:338-344`, `:396`).
- **Qué lo defiende:** `verificarConflicto` relee la revisión de la clave en caliente y compara con la que recuerda (`js/core/store.js:108-121`); si difiere, **aborta antes de tocar el dato**. `fijarRevNueva` sella la revisión tras cada escritura buena (`js/core/store.js:128`). El cambio del segundo sigue en el espejo y se ofrece recuperar al recargar (`js/core/store.js:1613`).
- **Qué queda abierto:** (a) no es un merge: el segundo debe recargar y **rehacer** su trabajo; (b) hay una ventana angosta entre el chequeo y la escritura (`js/core/store.js:82-88`); (c) con un hecho de dos claves (escenario 2) una puede guardarse y la otra chocar; (d) editar una **celda** de la hoja a mano no cambia la revisión (escenario 9).
- **Prueba:** `test/smoke.mjs:4257-4300` (el guardado se marca conflicto, no se sobrescribe, no se reintenta solo, y recargar lo resuelve).
- **Estado:** DEFENDIDO para una clave; PARCIAL para hechos de varias claves.

## 4. Se abre la app sin red y se sigue trabajando sobre la copia local

- **Qué lo causa:** se recarga la página con sesión vigente (la sesión sobrevive a recargar, `js/core/auth.js:155`) pero sin conexión, o Google no responde al abrir. `loadAll` lee de la copia local lo que no pudo leer de la red (`js/core/store.js:1138-1153`).
- **Qué ve el dueño:** un aviso breve: «📶 Sin conexión: mostrando la última copia guardada en este dispositivo. **Se actualiza sola en cuanto vuelva la señal**» (`js/core/store.js:1465-1467`). Para Movimientos, Clientes y Cotizaciones, además, un aviso fijo con botón recargar (`js/core/store.js:1253-1258`, `js/core/dom.js:969`).
- **Qué lo defiende:** sin lectura completa **no corren** las migraciones ni las reparaciones que reescriben plata (`js/core/store.js:1304`, `:1343-1396`, todas con `!huboFalloDeRed`).
- **Qué queda abierto (dos cosas verificadas):**
  1. **La promesa «se actualiza sola» no se cumple para lo que se lee:** `loadAll` se llama una sola vez, al entrar (`js/app.js:50`); al volver la red solo se reintentan escrituras pendientes (`js/core/guardado.js:269`). Los datos siguen siendo la copia local hasta recargar.
  2. **Esas claves no tienen revisión conocida:** `fijarRevConocida` solo corre para lo que sí se leyó de la red (`js/core/store.js:1266-1267`) y `verificarConflicto` **deja pasar** una clave sin base (`js/core/store.js:109`). Resultado: si otro computador guardó cambios mientras tanto, **el primer guardado de este los sobrescribe sin aviso**.
- **Prueba:** `test/smoke.mjs:3371-3457` (la carga cae al espejo y la migración se salta). `test/smoke.mjs:4265` fija como comportamiento esperado que el primer guardado de la sesión no se marca conflicto: **documenta la brecha, no la cubre**.
- **Estado:** **PARCIAL — severidad media.** Riesgo **#67-3**.

## 5. Vence el acceso de Google

- **Qué lo causa:** el token de Google dura ≈ 1 hora; algunos navegadores bloquean la renovación silenciosa (`js/core/auth.js:1-17`).
- **Qué ve el dueño:** 5 minutos antes, el chip «⏳ Sesión por vencer» (`js/core/dom.js:989`) que se renueva con un clic. Si vence del todo: «Tu sesión de Google venció. Recarga la página e inicia sesión de nuevo» (`js/core/googleRest.js:20`). Lo no guardado queda en la cola y el espejo.
- **Qué lo defiende:** renovación proactiva con reintentos a los 30 y 60 s (`js/core/auth.js:46-139`); el próximo clic real intenta renovar (`js/core/auth.js:89-105`); ante un 401, una renovación y **un solo** reintento de la misma llamada (`js/core/auth.js:282-301`); y al recargar, `detectarRecuperacion` ofrece restaurar lo pendiente.
- **Prueba:** **SIN PRUEBA.** Ninguna prueba ejerce `refrescarToken` ni el reintento ante 401: `test/smoke.mjs` no tiene sesión real (se dice en `:3813`, `:4079`, `:4870`).
- **Estado:** DEFENDIDO en el código, **SIN PRUEBA** — baja.

## 6. La hoja de Google se borra, se mueve o se pierde el acceso

- **Qué lo causa:** ya pasó (2026-09-19): una copia con el mismo nombre se borró por error (`js/core/google-config.js:19-36`).
- **Qué ve el dueño:** «No se encontró la Google Sheet de datos (se borró, se movió, o esta cuenta de Google no tiene acceso)…» con la receta: Papelera de Drive primero (el mismo ID), y si no, la carpeta de respaldos (`js/core/googleRest.js:28-31`).
- **Qué lo defiende:** el respaldo diario, que es una copia completa en el Drive del admin (`js/core/backup.js:87-110`); el espejo local de cada clave.
- **Qué queda abierto:** el respaldo solo se hace **si el admin abre la app** ese día (`js/core/backup.js:7-13`), no hay limpieza de copias viejas (no verificado: no existe código que las borre) y **nadie comprueba que una copia se pueda restaurar**. Restaurar una copia vieja pierde lo posterior.
- **Prueba:** `test/smoke.mjs:4921`, `:4966` (el respaldo se rehace si su carpeta fue borrada). **SIN PRUEBA** del mensaje de la hoja inexistente.
- **Estado:** PARCIAL — media.

## 7. Una pestaña de datos queda vacía o la borran

- **Qué lo causa:** (a) el «borrar y escribir» falló en el medio (escenario 1); (b) alguien borra las filas o la pestaña `Movimientos`, `Clientes` o `Cotizaciones`.
- **Qué pasa en el código:** `asegurarPestana` recrea la pestaña vacía (`js/core/sheetsTabular.js:53-62`). Luego `loadAll` lee 0 filas y, **si la pestaña `kv` todavía trae el texto viejo de esa clave**, lo trata como «primera migración» y **lo copia a la pestaña** (`js/core/store.js:1209-1217`). Ese texto de `kv` **quedó congelado el día que la clave migró** (`js/core/store.js:1112-1126`: desde entonces `persist` ya no lo actualiza). Resultado: la hoja pasa a mostrar la foto de hace meses.
- **Qué ve el dueño:** movimientos viejos, sin los de los últimos meses; la Caja cambia de golpe. En el mismo computador, si había algo en cola, la recuperación ofrece restaurar la copia local (`js/core/store.js:1613`); en otro computador no hay nada que ofrecer.
- **Qué lo defiende:** solo parcialmente: la cola y el espejo del computador que estaba guardando (si sigue abierto, su reintento reescribe lo correcto), «Salud de los datos» (la Caja contra los reportes, `js/core/salud.js:542`) y el respaldo diario. **Nada distingue «pestaña nueva que hay que migrar» de «pestaña que se vació».**
- **Prueba:** **SIN PRUEBA** (no hay ninguna prueba que ejerza una pestaña vacía con `kv` poblado).
- **Estado:** **SIN DEFENSA — severidad alta.** Riesgo **#67-1**. Arreglo propuesto (tarea aparte): guardar una marca «ya migrado» en `kv` la primera vez y, desde ahí, no volver a sembrar jamás desde el blob; si la pestaña está vacía y la marca existe, mostrar un error rojo en vez de seguir.

## 8. La hoja se llena

- **Qué lo causa:** Google Sheets no acepta más de **50.000 caracteres en una celda**. Solo Movimientos, Clientes, Cotizaciones, Cierres y Bitácora tienen una fila por registro; **todo lo demás es un único texto por clave**: `pedidos`, `pedidosPapelera`, **`txPapelera`**, `deudas`, `deudasHistorial`, `config`, `pendientes`, `productos`, catálogo de insumos, plantillas… (`js/core/store.js:35`, `js/core/constants.js:41-64`). Ya ocurrió con Cotizaciones (Hallazgo #42).
- **Qué ve el dueño:** el chip rojo «Sin guardar» **para siempre** y el error de Google «Tu entrada supera el número máximo de 50000 caracteres…». Todo lo que se haga en esa clave se ve en pantalla pero no llega a la hoja: si el pedido ya no se puede guardar, tampoco un abono nuevo en `pedidos`.
- **Qué lo defiende:** nada mide el tamaño de una clave ni avisa antes de llegar (no hay ninguna comprobación de longitud en el código; **no verificado contra los datos reales** cuánto margen queda hoy). La papelera de movimientos crece con cada eliminación y solo se vacía borrando definitivo.
- **Otros límites:** la lectura de `kv` mira solo las filas 2 a 5.000 (`js/core/sheetsStorage.js:19`, `:57`) y los borradores en la nube nunca se borran de la hoja, solo se vacían (`js/core/store.js:1563-1569`); las pestañas propias leen hasta la fila 200.000 (`js/core/sheetsTabular.js:126`).
- **Prueba:** ninguna de tamaño.
- **Estado:** **SIN DEFENSA — severidad alta** (el efecto es que **se deja de guardar** sin perder lo ya guardado, pero hasta recargar el dueño cree que sí guardó). Riesgo **#67-2**.

## 9. Alguien edita la hoja de Google directamente

- **Qué lo causa:** abrir la Sheet y cambiar un monto, borrar una fila, escribir texto en un número, o editar la pestaña `roles`.
- **Qué pasa en el código:** la app solo se entera al **recargar**. Mientras una pestaña de la app está abierta con su copia en memoria, el siguiente guardado **reescribe el rango completo** desde memoria (`js/core/sheetsTabular.js:144-150`) y borra la edición manual, y `verificarConflicto` **no lo nota** porque solo mira la fila `__rev__:<clave>`, no las celdas de datos (`js/core/store.js:108-121`).
- **Qué ve el dueño:** al recargar, los números cambian sin rastro en la bitácora (la bitácora solo anota cambios hechos desde la app, `js/core/bitacora.js:33-35`).
- **Qué lo defiende (detectando, no impidiendo):** «Salud de los datos»: un monto que no es número «la caja lo cuenta como $0» (`js/core/salud.js:397-406`), una fecha inválida (`:436`), la Caja contra los reportes (`:542`) y, si cambió un mes cerrado, «Meses cerrados» compara contra el resumen guardado al cerrar (`js/core/salud.js:748`).
- **Prueba:** `test/bitacora.mjs:526-591` (Salud detecta un mes cerrado que cambió), `test/salud.mjs:294` (monto, fecha y tipo).
- **Estado:** PARCIAL. Es el «punto D» de `CONTINUIDAD.md` (base de datos con permisos por rol): mientras no se haga, **la protección real es a quién se da acceso de edición a la Google Sheet**.

## 10. El navegador se cierra con un guardado en vuelo

- **Qué lo causa:** se cierra la pestaña, se acaba la batería, se cae el navegador mientras una escritura viaja por la red.
- **Qué ve el dueño:** si fue un cierre normal, el navegador pregunta «¿salir del sitio?» (`js/core/guardado.js:270-297`: avisa con un guardado fallido, una edición sin guardar **o una escritura en vuelo**). Si el cierre fue brusco, al reabrir aparece «cambios sin guardar de la sesión anterior: **Restaurar / Descartar**» (`js/core/store.js:1613`, `:1687`, `:1747`): nunca se restaura sola, porque el espejo es de ESTE navegador y podría pisar algo hecho en otro.
- **Qué lo defiende:** el espejo (`js/core/guardado.js:133`) y la marca «en cola» que se anota **en disco** al instante (`js/core/guardado.js:215-223`, `:373-374`); los borradores de cotización y de formularios se espejan 1,5 s después de la última tecla (`js/core/guardado.js:164`) y los de cotización también viajan a la nube cada 4 s (`js/core/store.js:1529`).
- **Qué queda abierto:** al terminar bien una ronda, `escribirRonda` **borra la marca en disco** (`js/core/guardado.js:330`) aunque ya haya un cambio más nuevo esperando su propia ronda (`js/core/guardado.js:376-383`). Si el navegador muere justo durante esa segunda ronda, la sesión siguiente **no sabe que había algo pendiente** y no ofrece recuperar. El cambio queda solo en el espejo.
- **Prueba:** `test/smoke.mjs:3852-3910` (el aviso), `:3939-4073` (restaurar un espejo y un borrador). **SIN PRUEBA** del caso de la marca borrada.
- **Estado:** PARCIAL. Riesgo **#67-5**.

## 11. Datos viejos con formas antiguas

- **Qué lo causa:** meses de historia: columnas que se corrieron (Hallazgos #15–#19), marcas de origen que se perdían al guardar, pedidos sin líneas, movimientos de antes de las cuentas.
- **Qué lo defiende:** una celda vacía de una columna nueva se lee como valor por defecto (`cuenta` vacía = «sin asignar», `js/core/sheetsEsquemas.js:105-110`); al cargar, los movimientos sin cuenta pasan a «Sin asignar» sin tocar la Caja (`js/core/store.js:1245-1251`); doce reparaciones automáticas anotadas (`js/core/store.js:606-619`); y «Salud de los datos» está diseñada para **no dar falsos positivos** con datos viejos (`CONTABILIDAD.md`, #66, «Cómo se evitaron los falsos positivos»).
- **Prueba:** `test/cuentas.mjs:85` (migración a «Sin asignar»), `test/salud.mjs:535-593` (lo corregido al cargar), `test/salud.mjs:211` (datos limpios: cero hallazgos).
- **Qué queda abierto:** las reparaciones **pueden tocar un mes cerrado** (quedan anotadas y señaladas, no frenadas; `CONTINUIDAD.md`, §6). Nada de esto se ha probado con la hoja real del dueño.
- **Estado:** DEFENDIDO — baja.

## 12. Un vendedor intenta tocar un mes cerrado

- **Qué lo causa:** un vendedor registra un abono, edita un movimiento o elimina un pedido con fecha en un mes cerrado.
- **Qué ve:** «No se puede <qué haría>: <mes> está cerrado (lo cerró <nombre> el <fecha>). Pídele al administrador que lo reabra (queda registrado quién y por qué)» (`js/core/cierre.js:63-71`). El admin ve además cómo reabrirlo.
- **Qué lo defiende:** `exigirMesAbierto` en toda acción que escribe movimientos (regla `R1`; `js/core/cierre.js:78`), con la fecha vieja **y** la nueva cuando algo cambia de fecha (por ejemplo `js/modules/pedidos.js:2555`); `ejecutarAccionRecibo` y `llevarComprasAFinanzas` comparan antes y después para lo masivo (`js/modules/cotizaciones.js:3275`, `:3569`); solo el admin cierra o reabre (`js/core/cierre.js:122`, `:156`); la bitácora marca `enMesCerrado` y «Meses cerrados» de Salud lo señala (`js/core/salud.js:748`).
- **Qué queda abierto:** es un candado **de pantalla**. Desde la consola del navegador o editando la hoja se salta; si pasa por la app queda en la bitácora, si pasa por la hoja solo lo señala Salud después. No bloquea pedidos/cotizaciones, conciliaciones ni a un movimiento sin fecha válida (`MAPA-DEL-DINERO.md`, §7).
- **Prueba:** `test/bitacora.mjs:426-468` (un mes cerrado bloquea CADA tipo de escritura), `:387` (solo el admin cierra), `:477` (el mensaje le habla a cada rol), `:489` (reabrir exige motivo).
- **Estado:** DEFENDIDO en la app; **SIN DEFENSA** ante acceso directo a la hoja (conocido).

## 13. Una columna nueva (o una insertada en medio) en una hoja

- **Qué lo causa:** un cambio de código que agrega un campo, o alguien que inserta una columna en la hoja real.
- **Por qué importa:** las pestañas propias se leen **por posición** (`js/core/sheetsEsquemas.js:11-24`). Una columna en medio corre todo lo ya guardado: pasó tres veces (Hallazgos #15, #17, #19) y dejó movimientos sin su servicio asignado y marcas de origen leídas como otra cosa.
- **Qué lo defiende:**
  - **Regla `R5`** y la foto `docs/esquemas.snapshot.json`: la CI falla si una columna existente cambia de lugar, de nombre o de tipo, o se quita; solo se acepta agregar al final. `npm run mapa` se niega a actualizar la foto si no es así.
  - `asegurarPestana` completa los encabezados que falten y **agranda la grilla** (que Google crea de 26 columnas) antes de escribir, para evitar «exceeds grid limits» (`js/core/sheetsTabular.js:47-91`).
- **Prueba:** `test/arquitectura.mjs` (R5, todas las hojas); `test/smoke.mjs:5065` (el orden de Movimientos), `:5024-5036` (la grilla); `test/cuentas.mjs:135-192`; `test/descuentos.mjs:442-494`.
- **Qué queda abierto:** si alguien inserta una columna **en la hoja real**, la app no lo nota (`asegurarPestana` solo completa encabezados que faltan al final, no compara los existentes con el esquema, `js/core/sheetsTabular.js:83-90`). **SIN DEFENSA** para ese caso.
- **Estado:** DEFENDIDO en el código; SIN DEFENSA ante una edición manual de la hoja — media.

## 14. Doble clic o acción repetida

- **Qué lo causa:** doble clic en el celular, un clic mientras una lectura de comprobante sigue en curso, una cola de clics seguidos sobre la misma clave.
- **Qué lo defiende:** un segundo «agregar abono» del mismo pedido se ignora mientras el primero lee su comprobante (`state.abonosProcesando`, `js/modules/pedidos.js:2471`); pagar comisiones, gastos fijos y deudas **pide confirmación** (`js/modules/pedidos.js:2360`, `js/modules/pendientes.js:818`, `:1001`) y las acciones son **bidireccionales** (el mismo botón crea y deshace, sin duplicar: `js/modules/pendientes.js:797-802`); `sincronizarComprasFinanzasDe` es idempotente (adopta el movimiento existente y borra los sobrantes, `js/modules/cotizaciones.js:3146-3157`); y varios clics seguidos sobre la misma clave comparten **una** ronda de red (`js/core/guardado.js:371-389`).
- **Prueba:** `test/smoke.mjs:1617-1628` (el guard de abonos), `:4300-4361` (la coalescencia de rondas).
- **Estado:** DEFENDIDO.

## 15. Un movimiento con fecha vacía o mal escrita

- **Qué lo causa:** `add-tx` no exige fecha (solo concepto y monto, `js/modules/finanzas.js:854`) y un campo de fecha se puede dejar vacío.
- **Qué pasa:** `mesDeFecha` devuelve `""` si la fecha no empieza con `AAAA-MM`, y `periodoCerrado` responde «no hay cierre» (`js/core/calc.js:333-343`). El movimiento **no pertenece a ningún mes**: cuenta en la Caja total pero no en el resumen de ningún cierre, y el candado de mes no lo ve.
- **Qué ve el dueño:** «Salud de los datos» lo marca como **error**: «Un movimiento tiene una fecha inválida» (`js/core/salud.js:436`). La Caja de un mes cerrado frente al resumen del cierre dejaría de coincidir.
- **Prueba:** `test/salud.mjs:294` (se detecta). **SIN PRUEBA** de prevención (no existe).
- **Estado:** PARCIAL (detecta, no previene) — media-baja. Riesgo **#67-7**.

## 16. Un vendedor usa la consola o cambia su rol

- **Qué lo causa:** una persona con conocimientos abre las herramientas del navegador, o edita `sessionStorage` (donde está su rol) y recarga.
- **Qué pasa en el código:** `dispatch` ejecuta cualquier acción registrada sin comprobar el rol (`js/core/dom.js:1246-1249`); `restaurarSesion` confía en el rol guardado en `sessionStorage` sin volver a leer la pestaña de roles (`js/core/auth.js:155-168`); varias pantallas tratan «sin sesión» como admin (`js/core/dom.js:779`, `:1049`). Y el vendedor tiene, por su propio token, acceso de edición a toda la hoja y a todo el Drive (`js/core/google-config.js:57`).
- **Qué lo defiende:** nada en los datos. Es el «punto D» de `CONTINUIDAD.md`. La bitácora anota el correo y el rol de cada cambio hecho desde la app (`js/core/bitacora.js:258-266`), lo que sirve para saber quién fue, no para impedirlo.
- **Prueba:** ninguna (no hay nada que probar: no existe la defensa).
- **Estado:** **SIN DEFENSA (conocido)** — severidad **alta si no se confía en las personas con acceso**. Hoy se mitiga solo con a quién se le da el acceso. Riesgo **#67-11**.

## 17. Una propuesta de catálogo manipulada

- **Qué lo causa:** un vendedor cambia un insumo del catálogo y, en vez de guardarse directo, queda como «propuesta» pendiente de aprobación (`js/core/store.js:1920`). Un vendedor con acceso a la hoja (o con la consola) puede escribir una propuesta con otra clave.
- **Qué pasa en el código:** `aprobarPropuesta` hace `state[propuesta.key] = propuesta.valor` y `persist(propuesta.key)` **sin comprobar que la clave sea una de las dos permitidas** (`js/core/store.js:1947-1953`). Una propuesta con `key: "tx"` reemplazaría **todos los movimientos** al aprobarla. `aprobarPropuestaProducto` aplica cualquier `payload.campo` a un producto (`js/core/stock.js:86-90`).
- **Qué ve el dueño:** una propuesta con un nombre de área raro en la lista de Catálogo; el admin tendría que aprobarla.
- **Qué lo defiende:** nada a nivel de datos; la regla `R7` la reconoce como `persist` con clave calculada y la deja en la lista base como **riesgo real** (`persist(propuesta.key)`).
- **Prueba:** ninguna.
- **Estado:** **SIN DEFENSA — media** (hace falta acceso a la hoja **y** que el admin apruebe). Riesgo **#67-6**.

## 18. Falla el respaldo, o nadie abre la app

- **Qué lo causa:** permisos, cuota de Drive, la carpeta de respaldos borrada, o un día sin que el admin abra la app.
- **Qué ve el dueño:** «Último respaldo» en Configuración; el botón **Respaldar ahora** muestra el error real (`js/modules/config.js:161`). El chequeo automático al abrir **no** muestra errores (`js/app.js:64-66`).
- **Qué lo defiende:** una carpeta de respaldos borrada se recrea y se reintenta una vez (`js/core/backup.js:96-107`).
- **Qué queda abierto:** un respaldo fallido automático pasa en silencio; sin que el admin abra la app no hay copia nueva; las copias no se limpian; y una copia tomada justo en el hueco de «borrar y escribir» (escenario 1) puede traer una pestaña vacía.
- **Prueba:** `test/smoke.mjs:4921`, `:4966`.
- **Estado:** PARCIAL — media.

## 19. La bitácora no se puede escribir, o se duplica

- **Qué lo defiende:** la acción **sigue** y la anotación espera en una cola en disco que se reintenta (`js/core/bitacora.js:436-495`); `agregar` solo suma filas al final y nunca reescribe (`js/core/sheetsTabular.js:165-177`); quien lee descarta los ids repetidos de un append reintentado (`js/core/bitacora.js:539-547`).
- **Prueba:** `test/bitacora.mjs:120-158` (agregar sin reescribir), `:320` (sin red: la acción sigue y la anotación espera).
- **Qué queda abierto:** la bitácora anota la **intención** al guardar: si un guardado falla y se descarta, puede haber una anotación sin cambio. Si alguien **borra filas** de la pestaña `Bitacora` o la pestaña entera, no se nota; una pestaña recreada vuelve a empezar con «La bitácora empieza aquí» (`js/core/bitacora.js:449-458`).
- **Estado:** DEFENDIDO — baja.

## 20. Un recibo de compra descuadra o falla a mitad

- **Qué lo defiende:** `ejecutarAccionRecibo` toma una foto, ejecuta, y **solo guarda si** el recibo cuadra al peso (`verificarRecibo`, `js/core/calc.js:3818`), la caja se movió lo esperado y ningún cambio cae en un mes cerrado; si no, restaura la foto y avisa «No se guardó nada» (`js/modules/cotizaciones.js:3246-3293`).
- **Prueba:** `test/smoke.mjs:5323`, `:5220-5221`.
- **Estado:** DEFENDIDO. Es el modelo de «criterio bancario» (nada descuadrado llega a la hoja) que el resto de la app no tiene.

## 21. Dos pestañas del mismo navegador

- **Qué lo defiende:** cuando una pestaña guarda una clave, las demás la recargan de la hoja (`js/core/store.js:49-60`, `reloadKey` en `:137`) para no guardar encima con una copia vieja.
- **Prueba:** **SIN PRUEBA** (no verificado: ninguna prueba menciona `BroadcastChannel` ni `reloadKey`).
- **Estado:** SIN PRUEBA — baja.

## 22. Un pedido pagado completo queda con «saldo fantasma» de centavos

- **Qué lo causó:** el IVA y la comisión se calculaban con centavos (Hallazgo #62).
- **Qué lo defiende:** una sola fórmula del IVA, `calcIvaDeBase` (`js/core/calc.js:998`), y el saldo a pesos enteros (`calcSaldoPedido`, `js/core/calc.js:1010`); las reglas `R2` y `R3` vigilan que nadie vuelva a calcularlo aparte; Salud avisa montos con centavos (`js/core/salud.js:429`).
- **Prueba:** `test/descuentos.mjs:495-587` (IVA a pesos enteros, pedido pagado = saldo cero, comisión por %, PDF con el mismo IVA).
- **Estado:** DEFENDIDO.

## 23. Dos escrituras de la misma clave al mismo tiempo

- **Qué lo causa:** `reintentarPendientes` (el temporizador de 15 s o el evento de volver la red) lanza su propia escritura de una clave **sin mirar si ya hay una ronda en vuelo** para ella (`js/core/guardado.js:395-418`), mientras que `guardarClave` sí las agrupa (`js/core/guardado.js:371-389`).
- **Qué pasa:** dos escrituras completas de la misma pestaña pueden entrelazarse (borrar–borrar–escribir–escribir). El resultado final es el mismo estado, pero las dos sellan una revisión y la última en terminar puede dejar a esta pestaña con una revisión distinta de la de la hoja: un **falso conflicto** («Alguien más guardó…») que obliga a recargar.
- **Prueba:** ninguna.
- **Estado:** **SIN DEFENSA — baja.** Riesgo **#67-10**.
