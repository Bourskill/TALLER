# Plan para arreglar los 11 riesgos que encontró el mapa

**Para qué sirve:** es la hoja de ruta para corregir en el código los riesgos del Hallazgo #67 (`CONTABILIDAD.md`). Cada riesgo se identifica como **#67-N**; sus escenarios están en [`ESCENARIOS-DE-FALLA.md`](ESCENARIOS-DE-FALLA.md). Está escrito para que una sesión de trabajo pueda tomar **un paquete** y hacerlo de principio a fin sin volver a preguntar lo que ya se decidió.

**Estado:** ningún riesgo está arreglado. Este plan **no cambia código**.

**Cómo se verificó antes de escribirlo (2026-11-04):** cada riesgo se volvió a comprobar leyendo el código citado; los 11 son reales. Se corrigieron tres imprecisiones del texto del #67 (una prueba mal descrita, los borradores en la nube que se *vacían* y no se borran, y el conteo de entradas de la lista base). Las citas con número de línea de los otros documentos se mueven; **este plan cita funciones por nombre**, que no se mueven.

## Cómo se trabaja cada paquete (aplica a todos)

1. **Rama propia** (`git switch -c <nombre>`), nunca directo en `main`. Un paquete = un commit (o pocos), mensaje en español sin tildes con `(Hallazgo #67-N)` y la línea `Co-Authored-By`.
2. **Releer el riesgo contra el código de hoy antes de tocar nada** (los números de línea envejecen) y confirmar que sigue siendo cierto.
3. **Primero la prueba que falla, después el arreglo.** Cada paquete escribe una prueba que reproduce el defecto y comprueba que el arreglo la pone en verde. Sin jsdom, como `test/descuentos.mjs`; si es un archivo nuevo, se agrega a `.github/workflows/test.yml` **y** al script `test` de `package.json` (regla `R6`, la CI la vigila).
4. **Al terminar:** `npm run mapa` (los documentos generados quedan al día, la CI lo exige); borrar de `docs/reglas-baseline.json` la entrada del riesgo arreglado (si tenía); actualizar el estado del escenario en `ESCENARIOS-DE-FALLA.md` y marcar el riesgo como **ARREGLADO** en la tabla del #67; documentar en `CONTABILIDAD.md` (hallazgo nuevo, el siguiente libre es el #68) y en el registro de cambios del `README.md`.
5. **Antes de publicar** cualquier paquete que toque `js/core/store.js`, `js/core/guardado.js` o `js/core/sheetsTabular.js` (paquetes 1, 2, 3, 6, 7): confirmar que existe el **respaldo del día** (se hace al abrir la app como admin) y publicar en un momento tranquilo. Lo que se prueba con datos de ejemplo **no** se ha probado con la hoja real del dueño.
6. **Si algo se ve raro después de publicar:** no tocar nada, revertir el commit (`git revert`) y, si hiciera falta, restaurar desde el respaldo.

## Resumen: los paquetes

| # | Paquete | Riesgos | Tamaño | Decide el dueño | Orden |
|---|---|---|---|---|---|
| 1 | Que no se pierda la marca de «guardando» y que dos escrituras no se pisen | #67-5, #67-10 | **S** | no | 1.º |
| 2 | Que una pestaña vacía no se vuelva a llenar con datos viejos | #67-1 | **M** | sí (qué mostrar) | 2.º |
| 3 | Vigilar el tamaño de lo que se guarda en la hoja | #67-2 (paso 1) | **S–M** | sí (el umbral) | 3.º |
| 4 | Validar lo que entra: propuestas, fechas, consignación | #67-6, #67-7, #67-8 | **S** (cada uno) | sí (#67-7) | 4.º |
| 5 | Una sola fórmula de la comisión | #67-9 | **S** | no | 5.º |
| 6 | Arrancar sin red sin pisar el trabajo de otro computador | #67-3 | **M** | no | 6.º |
| 7 | Hechos de dinero que se escriben en varias claves | #67-4 | **M–L** | sí (diseño) | 7.º |
| 8 | Mover las claves grandes a su propia pestaña | #67-2 (paso 2) | **L** | sí | según medición del paquete 3 |
| 9 | Permisos reales | #67-11 | **XL** (proyecto aparte) | sí | cuando el taller lo necesite |

**S** = un archivo y una prueba, rápido y de bajo riesgo. **M** = varios archivos o una decisión de diseño pequeña. **L** = migración de datos o rediseño. **XL** = proyecto aparte.

**Recomendación:** hacer **1 a 5 ya** (son pequeños, independientes y quitan casi todo el riesgo que depende solo del código), **6 y 7** después, **8** solo si la medición del paquete 3 lo pide, y **9** como proyecto planeado. Los paquetes 1 a 5 se pueden hacer en cualquier orden; el orden de la tabla es por beneficio sobre esfuerzo.

---

## Paquete 1 — Que no se pierda la marca de «guardando» y que dos escrituras no se pisen
**Riesgos:** #67-5 (media) y #67-10 (baja). **Archivo:** `js/core/guardado.js`. **Tamaño:** S.

**Qué pasa hoy**
- **#67-5:** cuando una escritura termina bien, `escribirRonda` borra la marca «esta clave está en cola» del disco aunque ya haya un cambio más nuevo esperando su propia ronda (`proximaRonda`). Si el navegador muere durante esa segunda ronda, al reabrir no se ofrece recuperar y el cambio queda solo en el espejo.
- **#67-10:** `reintentarPendientes` (el temporizador de 15 s y el evento «volvió la red») lanza su propia escritura sin mirar si ya hay una ronda en vuelo para esa clave (`enVueloClave`), mientras que `guardarClave` sí las agrupa. Dos escrituras completas de la misma pestaña pueden entrelazarse y dejar un falso conflicto.

**Qué hacer**
1. **#67-5:** en `escribirRonda`, después de `escritor(clave)`, borrar `enCola[clave]` **solo si no hay** `proximaRonda[clave]`. Si la hay, la marca se queda (la siguiente ronda la borrará al terminar). Confirmar que en ese punto `proximaRonda[clave]` todavía existe: se borra en el `.then` que corre **después** de que `escribirRonda` termina.
2. **#67-10:** hacer que el reintento pase por la **misma coalescencia** que `guardarClave`: si hay una ronda en vuelo para la clave, esperar a esa ronda (o encadenarse como `proximaRonda`) en vez de lanzar otra escritura. Una función interna única (por ejemplo `escribirCoalescido(clave)`) usada por las dos entradas evita que vuelvan a divergir.

**Pruebas nuevas** (en `test/` sin jsdom, simulando `escritor`): (a) un guardado con otro cambio en cola deja la marca en disco hasta que termina la segunda ronda; (b) un reintento con una ronda en vuelo no lanza una segunda escritura simultánea de la misma clave; (c) con un `escritor` que falla, el comportamiento actual de la cola y del reintento no cambia.

**Terminado =** las tres pruebas pasan y el mapa/escenarios 10 y 23 quedan **DEFENDIDO**.

---

## Paquete 2 — Que una pestaña vacía no se vuelva a llenar con datos viejos
**Riesgo:** #67-1 (**alta**). **Archivos:** `js/core/store.js` (`loadAll`), quizá `js/core/sheetsStorage.js`. **Tamaño:** M.

**Qué pasa hoy:** al cargar, si `Movimientos`, `Clientes` o `Cotizaciones` vienen con **0 filas** y la pestaña `kv` aún trae el texto de esa clave, `loadAll` lo toma por «primera migración» y lo copia a la pestaña. Ese texto de `kv` **quedó congelado el día que la clave migró**: la hoja pasa a mostrar una foto de hace meses. Puede ocurrir si «borrar y escribir» falla entre sus dos pasos (escenario 1) o si alguien vacía la pestaña. Nada distingue «pestaña nueva que hay que migrar» de «pestaña que se vació».

**Qué hacer**
1. Una **marca «ya migrado»** por clave, guardada en `kv` (por ejemplo `__migrado__:tx`), que se escribe la primera vez que la pestaña propia se lee **con datos** (o cuando se completa la siembra inicial).
2. En `loadAll`: si la pestaña viene vacía **y existe la marca**, **no sembrar** desde el blob; dejar la clave como está en memoria/espejo y mostrar un **aviso rojo fijo** (hay un mecanismo parecido: `state.avisoTablaSheetFallo`) que diga que la pestaña de esa clave apareció vacía y que **no se tocó nada**, con la receta de restaurar desde el respaldo.
3. **Datos de hoy:** las tres pestañas ya migraron y tienen filas, así que no hay marca todavía. La marca se escribe en **la primera carga normal tras publicar** (pestaña con filas y sin marca → se escribe la marca). Hasta esa primera carga el riesgo es el de hoy; conviene que el dueño abra la app como admin apenas se publique.
4. Caso límite a decidir y probar: pestaña vacía **sin marca** y `kv` con datos. Es la primera migración legítima (o una instalación vieja que nunca cargó tras el cambio). Se mantiene el comportamiento actual, pero **se anota en el aviso de Salud** («sembrada desde `kv`»).

**Decisión del dueño (en palabras simples):** cuando una pestaña de datos aparezca vacía, ¿prefieres (a) que la app **avise en rojo y no toque nada** (recomendado) o (b) que **restaure sola** desde el espejo de este computador? La (b) es más cómoda pero decide por ti qué copia es la buena.

**Pruebas nuevas:** (a) pestaña vacía + `kv` poblado + marca → **no** se siembra y hay aviso; (b) pestaña vacía + `kv` poblado + sin marca → se siembra una vez y queda marca; (c) pestaña con filas → se escribe la marca y no cambia nada más; (d) una carga normal no se altera.

**Terminado =** pruebas en verde, escenario 7 pasa de **SIN DEFENSA** a **DEFENDIDO**, y se comprobó con el respaldo del día disponible.

---

## Paquete 3 — Vigilar el tamaño de lo que se guarda en la hoja
**Riesgo:** #67-2, **paso 1** (**alta**). **Archivos:** `js/core/store.js`, `js/core/guardado.js`, `js/core/salud.js`. **Tamaño:** S–M.

**Qué pasa hoy:** Google no acepta más de **50.000 caracteres por celda**. Solo `Movimientos`, `Clientes`, `Cotizaciones`, `Cierres` y `Bitacora` tienen una fila por registro; **todo lo demás es un único texto por clave** (`pedidos`, `pedidosPapelera`, `txPapelera`, `deudas`, `deudasHistorial`, `config`, `pendientes`, `productos`, catálogo, plantillas…). Cuando una crece de más, **todo guardado de esa clave falla** (ya pasó con Cotizaciones, #42). Nada mide el tamaño ni avisa antes. Además `kv` solo se lee hasta la fila 5.000 y los borradores en la nube se **vacían** pero su fila nunca se elimina.

**Qué hacer (paso 1: medir y avisar, sin mover datos)**
1. **Medir** el largo del JSON de cada clave de `kv` al guardarla (ya se calcula en `persist`/`guardarClave`) y guardarlo en un registro de sesión (`state.tamanosClaves`, no persistido).
2. **Avisar** al pasar del **70 %** (35.000 caracteres): un chip discreto con la clave y el porcentaje; y desde el **90 %**, aviso rojo. Una verificación nueva en «Salud de los datos» («Tamaño de lo guardado») con la misma regla, para que se vea aunque nadie guarde.
3. **Medir hoy:** una acción de admin (o una verificación de Salud) que lea las claves de `kv` y muestre cuánto ocupa cada una **con los datos reales**. Es lo que dirá si el paso 2 (paquete 8) hace falta ya. **No está verificado cuánto margen queda**.
4. Contar las filas ocupadas de `kv` y avisar al pasar de **4.000** de las 5.000 que se leen.

**Decisión del dueño:** ¿el umbral de aviso en el 70 %? (recomendado, se puede subir o bajar).

**Pruebas nuevas:** una clave de 36.000 caracteres da aviso amarillo, una de 46.000 aviso rojo, una de 10.000 nada; Salud lo reporta; el conteo de filas de `kv`.

**Terminado =** el dueño puede ver cuánto ocupa cada clave; escenario 8 pasa de **SIN DEFENSA** a **PARCIAL** (avisa, no previene). El paso 2 es el paquete 8.

---

## Paquete 4 — Validar lo que entra: propuestas, fechas, consignación
**Riesgos:** #67-6 (media), #67-7 (media-baja), #67-8 (baja). **Archivos:** `js/core/store.js`, `js/core/stock.js`, `js/modules/finanzas.js`, `js/modules/pedidos.js`, `js/core/calc.js`. **Tamaño:** S cada uno.

### #67-6 — Aprobar una propuesta sin validar su clave ni su campo
- **Hoy:** `aprobarPropuesta` hace `state[propuesta.key] = propuesta.valor; persist(propuesta.key)` **sin comprobar** que la clave sea una de las permitidas (`APPROVAL_REQUIRED_KEYS`: el catálogo de insumos y sus categorías). Una propuesta manipulada con `key: "tx"` reemplazaría todos los movimientos al aprobarla. `aprobarPropuestaProducto` aplica cualquier `payload.campo` a un producto. Hace falta acceso a la hoja **y** que el admin apruebe.
- **Hacer:** (1) en `aprobarPropuesta`, si `APPROVAL_REQUIRED_KEYS.indexOf(propuesta.key) === -1`, **no aplicar**: avisar, quitar la propuesta de la lista y no escribir nada. (2) En `aprobarPropuestaProducto`, lista blanca de los campos que la pantalla puede proponer (hoy, el precio de venta; confirmar buscando dónde se crean las propuestas de tipo `campo`) y validación de `tipoMov`, talla existente y cantidad numérica en las de `movimiento`.
- **Pruebas:** una propuesta con `key: "tx"` no cambia `state.tx` ni llama a `persist("tx")`; una con campo no permitido no toca el producto; una legítima sigue funcionando.
- **Al cerrarlo:** borrar de `docs/reglas-baseline.json` la entrada `js/core/store.js::aprobarPropuesta::dinamico:propuesta.key`.

### #67-7 — Un movimiento con fecha vacía escapa al cierre de mes
- **Hoy:** `add-tx` solo exige concepto y monto; un campo de fecha se puede dejar vacío. `mesDeFecha("")` devuelve `""`, así que `periodoCerrado` responde «no hay cierre»: el movimiento cuenta en la Caja pero en ningún mes. Salud lo marca como error **después**.
- **Hacer:** validar `AAAA-MM-DD` **real** (fecha de calendario existente) en los puntos de entrada de dinero con fecha: `add-tx`, `guardar-tx-edit`, abonos y reembolsos, transferencias y la fecha de pago de comisiones/nómina/deudas. **No** cambiar `exigirMesAbierto` para que rechace fechas vacías: algunos llamadores le pasan listas con fechas de registros viejos sin fecha y se bloquearían operaciones legítimas. Antes de tocarlo, listar con `MAPA-DEL-DINERO.md` qué fechas recibe cada llamador.
- **Decisión del dueño:** si la fecha queda vacía, ¿la app (a) **la rellena con hoy** (recomendado: nunca bloquea al usuario en hora pico) o (b) **no deja guardar** y pide la fecha?
- **Pruebas:** `add-tx` con fecha vacía → hoy (o error, según la decisión); con `2026-02-30` → rechazado; con fecha válida igual que antes; con una fecha en mes cerrado sigue bloqueando.

### #67-8 — Consignación: el monto de la venta no se redondea ni valida la cantidad
- **Hoy:** en la acción que registra la venta de consignación, `montoTotal = cantidad × precioUnitario` sin redondear, y la cantidad solo se valida contra `> 0` y contra lo disponible (puede ser `2,5`). La comisión **fija** (`calcConsignacionComision`) tampoco se redondea. Rompe «todo monto calculado en pesos enteros» (#62).
- **Hacer:** `redondearPesos(cantidad * precioUnitario)`, exigir cantidad **entera** (`Number.isInteger`) con un aviso claro, y `redondearPesos` también en la comisión fija.
- **Pruebas:** cantidad `2,5` rechazada; precio con decimales da un monto entero; comisión fija entera.

**Terminado (paquete 4) =** las pruebas pasan; escenarios 15 y 17 mejoran de estado (15: ahora **previene**; 17: **DEFENDIDO**); `docs/reglas-baseline.json` ya no tiene la entrada de #67-6.

---

## Paquete 5 — Una sola fórmula de la comisión
**Riesgo:** #67-9 (baja). **Archivos:** `js/core/calc.js`, `js/modules/pedidos.js`. **Tamaño:** S.

**Qué pasa hoy:** las vistas previas de la comisión en «Nuevo pedido» (la del vendedor y la del punto de consignación) calculan el porcentaje **por su cuenta**, sin `redondearPesos`, en vez de usar la fórmula real. Pueden mostrar $1 de diferencia con lo que luego se paga. Solo es pantalla, pero rompe «una sola fuente por fórmula».

**Qué hacer:** extraer en `calc.js` **una** función pura `calcComisionDeBase(base, tipo, valor)` que haga el cálculo (porcentaje redondeado o valor fijo) y que usen **todas**: `calcComisionValor`, `calcComisionValorCot`, `calcConsignacionComision` y las dos vistas previas. Cuidado con la base: la vista previa del vendedor usa el total del borrador; la real resta los servicios cobrados (no aplican a un pedido rápido).

**Pruebas:** la vista previa y el valor real coinciden en varios casos (incluido un porcentaje con decimales y un total que deja medio peso); las pruebas de comisión existentes siguen igual.

**Al cerrarlo:** borrar de la lista base las **dos** entradas de `R2` con hallazgo #67-9.

---

## Paquete 6 — Arrancar sin red sin pisar el trabajo de otro computador
**Riesgo:** #67-3 (media). **Archivos:** `js/core/store.js` (`loadAll`, `verificarConflicto`, `espejar`/`leerEspejo` en `guardado.js`). **Tamaño:** M.

**Qué pasa hoy:** si la app abre sin red, lo que no se pudo leer sale de la copia local (espejo) y esas claves **no tienen «revisión conocida»**; `verificarConflicto` deja pasar una clave sin base. Al volver la red, **el primer guardado sobrescribe sin aviso** lo que otro computador guardó mientras tanto. Además el aviso dice «se actualiza sola en cuanto vuelva la señal», pero `loadAll` se llama una sola vez (al arrancar): lo leído no se actualiza hasta recargar. **Ninguna prueba ejerce este caso.**

**Qué hacer (propuesta; el implementador debe validarla leyendo el código)**
1. **Guardar con el espejo la revisión en la que se basa.** Cuando se espeja una clave, anotar también la revisión de la hoja que este computador conocía en ese momento. Al arrancar sin red, restaurar `revConocida[clave]` desde ahí. Así `verificarConflicto` sí compara: si otro computador guardó mientras tanto, la revisión de la hoja será distinta y el guardado se marca **conflicto** (no sobrescribe). Un espejo viejo sin revisión anotada mantiene el comportamiento de hoy.
2. **Corregir el aviso:** que no prometa «se actualiza sola». O, mejor, al volver la red **releer** las claves que vinieron del espejo y avisar «ya hay conexión: recarga para ver lo último» (sin recargar solo: podría pisar lo que la persona está escribiendo).
3. Opción más simple y estricta si lo anterior resulta frágil: **bloquear guardar** una clave sin revisión conocida hasta que se haya podido leer de la red, con un aviso claro.

**Pruebas nuevas:** simular arranque sin red + otro computador que guarda + primer guardado de este → debe marcarse conflicto (hoy sobrescribe); el espejo sin revisión anotada se comporta como hoy; una carga normal no se altera.

**Terminado =** escenario 4 pasa de **PARCIAL** a **DEFENDIDO** y tiene prueba.

---

## Paquete 7 — Hechos de dinero que se escriben en varias claves
**Riesgo:** #67-4 (media). **Archivos:** `js/modules/pedidos.js`, `js/modules/pendientes.js`, `js/modules/finanzas.js`, `js/core/guardado.js`. **Tamaño:** M–L. **Requiere diseño con el dueño.**

**Qué pasa hoy:** un abono escribe `tx` y después `pedidos` con dos `persist` seguidos y **sin transacción**; eliminar un pedido escribe **cuatro** claves (`tx`, `txPapelera`, `pedidos`, `pedidosPapelera`); crear un pedido con abono inicial, `tx`, `productos` y `pedidos`. Si la segunda falla por conflicto o se cierra la pestaña, queda **un lado sin el otro** (y volver a pulsar «pagar comisión» crea un segundo movimiento). Salud lo detecta **después** (`abonado-pedido`, `abono-movimiento`).

**Opciones (de menor a mayor)**
- **A. Un helper `persistirJuntas([clave, clave, …])`** que anota el grupo como una **unidad** en la cola en disco (si la pestaña muere, al reabrir se ofrece recuperar **el grupo completo**) y que no marca el hecho como «guardado» hasta que todas terminen. Es lo más barato y cubre el cierre de pestaña y la caída de red.
- **B. Orden y tolerancia:** escribir siempre primero el lado que **no se puede duplicar** y hacer idempotentes los botones («pagar comisión» decide por el movimiento existente y no por el estado del pedido).
- **C. Un registro único por hecho** (una fila que describe el hecho completo y de la que se derivan los dos lados). Es el arreglo de fondo, pero es un rediseño de datos: pertenece al paquete 9.

**Recomendación:** A para las acciones de dinero (abonos, reembolsos, cobros, comisiones, eliminar y restaurar pedido), B donde sea barato; C solo dentro del proyecto de base de datos. **El conflicto entre dispositivos (la segunda clave choca)** sigue siendo «el segundo debe recargar y rehacer»: no hay arreglo barato sin transacciones reales.

**Decisión del dueño:** nada de negocio; sí conviene mostrarle la opción A antes de empezar y acordar el aviso («Se guardó a medias: reintentando…» frente a un chip rojo único).

**Pruebas nuevas:** con un `escritor` que falla en la segunda clave: el grupo queda marcado como pendiente completo, el reintento termina las dos, y no hay dos movimientos tras pulsar de nuevo.

**Terminado =** escenario 2 pasa de **PARCIAL** a **DEFENDIDO** para las acciones cubiertas, y la lista de acciones que escriben varias claves (`MAPA-DEL-DINERO.md`) dice cuáles pasan por el helper. Candidata a una regla nueva de la CI («toda acción de dinero con más de un `persist` usa el helper»).

---

## Paquete 8 — Mover las claves grandes a su propia pestaña
**Riesgo:** #67-2, **paso 2** (**alta**, pero **solo si la medición del paquete 3 lo pide**). **Tamaño:** L.

**Cuándo:** si con los datos reales alguna clave de `kv` pasa del 70 % (típicamente `pedidos`, `pedidosPapelera` o `txPapelera`, que crecen con el uso). Hoy **no se sabe**.

**Qué hacer:** pasar la clave a una pestaña con una fila por registro con el **mismo patrón del Hallazgo #42** (`crearTablaSheet` está en `js/core/sheetsTabular.js` y los esquemas de cada pestaña en `js/core/sheetsEsquemas.js`: una columna por campo, lo anidado en columnas JSON, **columnas siempre al final**, regla `R5`). Una clave por vez. Pasos de cada una: (1) esquema y su foto (`docs/esquemas.snapshot.json`), (2) migración de una sola vez desde `kv` **con la marca «ya migrado» del paquete 2**, (3) lectura/escritura por pestaña en `TABLAS_SHEET`, (4) pruebas de ida y vuelta (como la sección de Sheets de `test/descuentos.mjs`), (5) **respaldo antes de publicar**.

**Orden sugerido de las claves:** `txPapelera` (crece con cada eliminación y casi nadie la mira), `pedidosPapelera`, luego `pedidos`.

**Decisión del dueño:** ninguna de negocio; sí fijar un momento tranquilo para publicar cada migración y revisar el respaldo.

**Terminado =** la clave migrada vive en su pestaña, el escenario 8 baja de severidad y `R5` fotografía la pestaña nueva.

---

## Paquete 9 — Permisos reales
**Riesgo:** #67-11 (conocido; **alta si no se confía en las personas con acceso**). **Tamaño:** XL, proyecto aparte.

**Qué pasa hoy:** los permisos de rol (admin/vendedor) **solo existen en pantalla**: `dispatch` ejecuta cualquier acción sin mirar el rol; `restaurarSesion` confía en el rol guardado en el navegador; varias pantallas tratan «sin sesión» como admin; y el acceso de Google de un vendedor cubre **toda la hoja y todo el Drive**. La bitácora y el cierre de mes **ayudan a ver**, no impiden.

**Mientras no exista (medidas sin código, ya hoy)**
- Dar acceso de **edición** a la Google Sheet solo a quien de verdad lo necesite; revisar la lista de compartidos periódicamente.
- **Verificación en dos pasos** en las cuentas de Google con acceso (sobre todo las de admin).
- Mantener el repositorio de GitHub **privado** y no compartir el enlace de la hoja.
- Revisar la pestaña `roles` y la bitácora de vez en cuando.

**El proyecto, en etapas** (cada una se decide antes de empezar la siguiente)
1. **Inventario y decisión de plataforma** (base de datos con reglas por rol y transacciones, por ejemplo Firebase o Supabase): usar `MAPA-DEL-CODIGO.md` y `MAPA-DEL-DINERO.md` para listar qué datos hay, quién los lee y escribe, y qué reglas de rol se necesitan. Entregable: un documento corto de decisión.
2. **Modelo de datos y reglas de acceso** (qué puede ver y escribir cada rol; los movimientos con fecha en mes cerrado no se editan **desde el servidor**).
3. **Migración con doble escritura** durante un periodo (la Sheet sigue siendo la fuente hasta validar), con la bitácora y el cierre de mes pasando a ser del servidor.
4. **Retiro de la Sheet como base de datos**; se conserva como exportación y respaldo.

Este paquete también resuelve de raíz los #67-3 y #67-4 (transacciones reales) y el límite de 50.000 caracteres. **No empezarlo sin que el dueño decida plataforma y presupuesto.**

---

## Pequeña limpieza que apareció al verificar
- `js/modules/cotizaciones.js` importa `calcDesglosePedido` y **ya no lo usa** (el cálculo del desfase cotización↔pedido se movió). Es una importación sobrante, sin efecto; quitarla en el próximo paquete que toque ese archivo. El mapa la cuenta como «uso» porque «Lo usan» incluye a quien importa el nombre (límite dicho en `MAPA-DEL-CODIGO.md`).

## Lo que este plan NO cubre
- **Riesgos que el mapa no puede ver**: lo que no se deja leer como texto (nombres armados en ejecución, cambios por referencia a un movimiento; límites en `MAPA-DEL-CODIGO.md` y `REGLAS-DE-ARQUITECTURA.md`).
- **Nada de esto se ha probado con la hoja real del dueño**: cada paquete se prueba con datos de ejemplo y se valida después con la hoja real.
- Las **decisiones de negocio pendientes** de `CONTABILIDAD.md` (IVA, comisiones sin cobro, ganancia de pedidos prepagados…) no son riesgos de este plan.
