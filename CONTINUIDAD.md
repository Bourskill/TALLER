# Continuidad del trabajo — Panel del Taller

**Para quien retome esto en otra sesión: lee este archivo primero.** Dice dónde
quedó todo, qué sigue, cómo se trabaja en este proyecto y qué NO está
comprobado. Al terminar tu parte, actualiza la sección "Dónde quedó todo" y la
fecha de abajo (es el único sitio que envejece).

> Última actualización: **2026-11-04**. Todo está integrado en `main` y publicado en GitHub
> (consulta la pestaña Actions para el resultado de la CI sobre el último commit).
> **Mapa técnico (Hallazgo #67, ronda 116):** carpeta `docs/` (arquitectura, mapa del código y del
> dinero, escenarios de falla, reglas), la herramienta `tools/mapa.mjs` (`npm run mapa`) y la prueba
> `test/arquitectura.mjs`. No cambia la app.
> **Al integrar cualquier rama que toque `js/`, corre `npm run mapa` y sube los documentos**: la CI
> falla si quedaron viejos. Los 11 riesgos que encontró están en la sección C2 (el #67-5 y el
> #67-10 ya están arreglados: Hallazgo #68; el #67-1: Hallazgo #69; el #67-2 a medias: Hallazgo #70).

---

## 1. Dónde quedó todo

**Objetivo del dueño** (palabras suyas): que la herramienta que le ahorra trabajo
no le cause más, que sea rigurosa con el dinero y que **todo lo que se vea sea
verdad, para que cuadre al peso con sus cuentas bancarias**. Todo lo de abajo
nació de un análisis de Finanzas pedido por él (2026-10-29).

Todo lo de la tabla hasta el #69 está integrado en `main` y publicado en GitHub; el #70 está en su
rama (`medir-tamano-claves`) hasta que se integre. La CI corre los 9 archivos de prueba (`smoke.mjs` incluido). No hay ningún PR en curso.

| Hallazgo | Qué es | Dónde se ve en la app | Prueba |
|---|---|---|---|
| **#61** | Descuentos por ítem y a toda la orden, en cotización, pedido rápido y pedido ya creado. `p.total` es SIEMPRE el valor ya rebajado. | Línea del pedido, "Descuento al total", tarjeta del pedido (🏷), editor de cotización; columna DESCUENTO en los PDF | `test/descuentos.mjs` |
| **#62** | Todo monto que la app calcula va en **pesos enteros** (IVA, comisión, saldo, nómina convertida de base, cuotas de deuda). Una sola fórmula del IVA. | Invisible: ya no hay "saldo fantasma" de centavos | `test/descuentos.mjs` (secciones 5 y 6) |
| **#63** | Cuentas (Efectivo, Banco, Nequi), saldo por cuenta, transferencias entre cuentas, conciliación contra el extracto. | Finanzas → 🏦 Cuentas, Configuración → Cuentas, saldo en Resumen | `test/cuentas.mjs` |
| **#64** | Panel «Salud de los datos»: verifica y REPORTA (no repara) 13 cosas, y dice lo que la app corrigió sola al cargar. | Arriba de todo en Configuración (solo admin), insignia roja en el menú | `test/salud.mjs` |
| **#65** | Bitácora de cambios del dinero y cierre de mes. | Finanzas → 📒 Bitácora y 🔒 Cierre de mes (solo admin) | `test/bitacora.mjs` |
| **#66** | «Salud de los datos» revisa 8 cosas más (21 en total): nómina del periodo, deudas (`cuotasPagadas` contra sus movimientos), compras «Sí», estimado + compras reales, consignación, total del pedido contra su cotización, papelera, comisión pagada contra la fórmula de hoy; y la fecha de cada abono. | El mismo panel; botones «↗» nuevos a Deuda, Nómina y Papelera | `test/salud.mjs` |
| **#67** | **Mapa técnico** del código y del dinero, 23 escenarios de falla, 9 reglas de arquitectura que vigila la CI y **11 riesgos encontrados**. No cambia la app. | Carpeta `docs/` (empieza por `docs/ARQUITECTURA.md`); se regenera con `npm run mapa` | `test/arquitectura.mjs` |
| **#68** | **Cola de guardado** (paquete 1 del plan de corrección): arregla **#67-5** (la marca «pendiente» de disco ya no se borra con un cambio esperando) y **#67-10** (el reintento ya no escribe a la vez que otro guardado de la misma clave). | Invisible cuando todo va bien | `test/guardado.mjs` |
| **#69** | **Pestaña propia vacía** (paquete 2): arregla **#67-1**. Una pestaña de movimientos, contactos, cotizaciones o cierres que aparece vacía habiendo tenido datos ya NO se rellena con la foto vieja de «kv»; marca «ya migrado» + copia local + barra roja con botón «Está bien así». | Barra roja arriba solo si pasa | `test/pestanas.mjs` (+ la barra en `test/smoke.mjs`) |
| **#70** | **Espacio en la hoja** (paquete 3, paso 1 de **#67-2**): la app mide cuánto ocupa cada área en su celda de 50.000 caracteres y cuántas filas usa `kv` (de 5.000), y avisa desde el 70 % (error desde el 90 %). Solo mide y avisa, no mueve datos. Salud de los datos pasa de 21 a **22** verificaciones. | Chip «▲ Hoja al N %» arriba; Configuración → Salud de los datos → «Espacio en la hoja» (siempre visible) | `test/espacio.mjs` (+ el chip y el panel en `test/smoke.mjs`) |

Detalle, decisiones y límites de cada uno: **`CONTABILIDAD.md`** (hallazgos #61–#70) y
el registro de cambios de **`README.md`** (rondas 109–119). **Plan para arreglar los 11
riesgos del #67: [`docs/PLAN-DE-CORRECCION.md`](docs/PLAN-DE-CORRECCION.md)** (9 paquetes; el 1, el
2 y el 3 ya están hechos).

### Decisiones del dueño que NO hay que volver a preguntar
- Descuento: lo puede dar **cualquiera** (admin o vendedor); el cliente lo **ve** en
  los PDF; la **comisión del vendedor se calcula sobre el precio ya con descuento**;
  un duplicado de pedido/cotización nace **a precio de lista**.
- Cuentas: **Efectivo, un banco y Nequi**; los abonos preguntan en qué cuenta entró
  la plata (llega una mezcla de efectivo y transferencia); quiere el saldo por cuenta
  en Resumen y en Finanzas.
- Un mes cerrado se corrige **reabriéndolo con un motivo** (solo admin), no con un
  movimiento de ajuste. Un vendedor **no** puede tocar nada con fecha en un mes
  cerrado. Si la bitácora no se puede escribir (sin red), **la acción sigue** y la
  anotación se reintenta.
- Redondeo: **al peso más cercano**; el medio peso sube.

---

## 2. Lo que sigue (en este orden)

### A. Validar con la hoja REAL del dueño — NADA de esto se ha probado en producción
Todo se verificó con pruebas y datos de ejemplo, **no con su Google Sheet real ni con
el login real de Google**. La primera vez que alguien abra la app tras publicar:
- Se **migran los movimientos** existentes a la cuenta «Sin asignar» (no cambia la
  Caja ni ningún reporte) y se agregan **dos columnas al final** de la pestaña
  `Movimientos` (`cuenta`, `conciliado_en`); `Cotizaciones` gana `descuento_json`.
- Se **crean solas dos pestañas nuevas**: `Bitacora` y `Cierres`.
- No queda nada cerrado y la bitácora arranca con una primera entrada que dice que
  lo anterior no tiene historial.

Pasos que le propuse al dueño (pendientes de que los haga y reporte):
1. Abrir como admin y confirmar que el **respaldo de hoy** aparece en la carpeta
   «Panel del Taller — respaldos» (la hace `core/backup.js`, una vez cada 24 h).
2. Configuración → Cuentas: elegir la cuenta **predeterminada**; Finanzas → 🏦 Cuentas:
   **«Repartir ahora»** los movimientos viejos.
3. **Conciliar** una cuenta con su extracto del banco; **solo si cuadra**, cerrar un mes.
4. Mirar el panel «Salud de los datos»: lo que salga ahí es lo primero que hay que arreglar.

Si algo se ve raro: **no tocar nada**, restaurar desde el respaldo es la salida
(`README.md`, sección "🆘 Si el login da error de Google Sheets").

### B. Limpiar ramas — HECHO el 2026-11-03
Se borraron, ya integradas en `main`, las 7 ramas locales y las 4 de GitHub. Solo quedan
`main` y, como copias de trabajo que administra la aplicación (no borrar a mano con
`git branch -d`: están abiertas en `.claude/worktrees/`), las ramas locales
`claude/dreamy-lalande-419844` y `claude/elastic-leavitt-ae29c7`. Para limpiar esas dos hay
que quitar primero su copia de trabajo desde la aplicación. Si hiciera falta recuperar una
rama borrada de GitHub: `git push origin <sha>:refs/heads/<nombre>` (bitacora-y-cierre-de-mes
`0e1f3eb`, salud-de-los-datos `ec67e54`, claude/dreamy-lalande-419844 `a85313a`,
claude/elastic-leavitt-ae29c7 `851e4de`).

### C. Mejoras pequeñas ya identificadas
- **Ampliar «Salud de los datos» — HECHO e integrado (Hallazgo #66, ronda 115).** Ahora revisa también nómina del periodo, deudas, compras
  «Sí», estimado + compras reales, consignación, total del pedido contra su cotización,
  papelera y la comisión pagada contra la fórmula de hoy (informativa), y compara la fecha de
  cada abono. Reglas que el dueño ya decidió (no volver a preguntar): nómina solo del periodo
  en curso y solo si es de MÁS; comisión contra la fórmula = aviso informativo; estimado +
  compras reales = error; fecha del abono y la de su movimiento siempre iguales. Lo que
  quedó fuera a propósito está en `CONTABILIDAD.md`, #66, «Qué NO verifica todavía».
  **Antes de integrar:** correr `smoke.mjs` en la CI (no se pudo local). **Al abrir el
  panel con la hoja REAL**, mirar si salen avisos de más (sobre todo consignación de antes
  de septiembre, que perdía sus marcas, y deudas sin `txId`): es información, no ruido,
  para afinar las reglas de datos viejos.
  *Corregido de paso (#64):* `verificarAbonosYMovimientos` daba ERROR a un reembolso cuyo
  gasto había perdido la marca `origenReembolsoId` (los reembolsos anteriores a septiembre
  de 2026 la perdían en cada recarga, Hallazgo #19). Ahora busca un gasto SIN marca del mismo
  pedido y monto, igual que `verificarConsignacion`. Los **abonos** no lo necesitan (su marca
  siempre tuvo columna).
- **Convertir las 12 reparaciones silenciosas de `loadAll()`** (`js/core/store.js`,
  `REPARACIONES_AL_CARGAR`) en verificaciones que avisen, cuando se sepa que ya no
  hacen falta. Hoy solo anotan cuántas cosas corrigieron.
- **Las 5 decisiones de negocio pendientes** de `CONTABILIDAD.md` (sección "Decisiones
  de negocio pendientes"): comisión de un pedido sin cobrar, crédito fiscal del IVA,
  ganancia reconocida de un pedido prepagado, servicios de un pedido cancelado, y pagar
  gastos fijos/deudas desde un servicio. Al empezar a **facturar con IVA** (piensa usar
  Siigo) hay además dos defectos conocidos: no se puede registrar el pago a la DIAN y la
  Ganancia resta el IVA cobrado de siempre.
- **Backlog del propio dueño**, en el archivo `-mejorar apariencia y metodo de cat.txt`
  (nombre raro, empieza con guion: leerlo con `cat -- "<archivo>"`): estimación de
  tiempos de producción; más lógica en los campos de pedido; gráficas de Resumen con
  más estilo; un campo "distintivo" en contactos (ej. equipo al que pertenece); lector
  de facturas.

### C2. Tareas que salen del mapa técnico (Hallazgo #67) — cada una es una tarea aparte
El mapa **no arregló nada**: documentó 11 riesgos con su gravedad (`CONTABILIDAD.md`, #67, tabla
«Los riesgos que encontró el mapa»; dónde se defiende cada uno: `docs/ESCENARIOS-DE-FALLA.md`).
Orden sugerido (de mayor a menor daño posible, y de más barato a más caro):
1. ~~**#67-1 (alta)** — que una pestaña vacía NO se vuelva a llenar con la copia congelada de `kv`~~ —
   **HECHO** (Hallazgo #69: marca «ya migrado» + barra roja + «Está bien así», `js/core/store.js`
   `decidirLecturaTabla`, `test/pestanas.mjs`). **Al publicarlo, abrir la app como admin** para que
   se escriban las marcas.
2. **#67-2 (alta)** — **paso 1 HECHO** (Hallazgo #70: se mide el tamaño de cada área de una celda y las
   filas de `kv`, y se avisa desde el 70 %; `calcEspacioHoja` en `js/core/salud.js`,
   `test/espacio.mjs`). **Pendiente:** que el dueño mire Configuración → Salud de los datos →
   «Espacio en la hoja» con la hoja real, y, si algo pasa del 70 %, el **paso 2**: mover `pedidos`
   y `txPapelera` (paquete 8) a pestaña propia.
3. ~~**#67-5** (marca «pendiente» de disco)~~ y ~~**#67-10** (reintento en paralelo)~~ — **HECHOS**
   (Hallazgo #68, `js/core/guardado.js`, `test/guardado.mjs`).
4. **#67-6 (media)** — lista blanca de claves/campos al aprobar una propuesta.
5. **#67-3 (media)** — al volver la red, releer las claves que vinieron del espejo antes del primer guardado.
6. **#67-7, #67-8, #67-9 (baja/media-baja)** — fecha obligatoria y válida; consignación en pesos
   enteros; vistas previas con `calcComisionValor`.
7. **#67-4 (media, grande)** — escrituras de varias claves sin transacción: empezar por detectar y
   marcar el hecho «a medias». **#67-11** es el punto D de abajo.
Al arreglar uno: borrar su entrada de `docs/reglas-baseline.json` (si la tiene), correr
`npm run mapa` y actualizar su escenario en `docs/ESCENARIOS-DE-FALLA.md`. También pendiente del
mapa: pasar las citas de los documentos de «avisa» a «bloquea» cuando se estabilicen, y la pantalla
dentro de la app (decisión del dueño: queda para después).

### D. El #6 original: base de datos real y permisos reales — proyecto GRANDE, solo cuando haga falta
Por qué existe: (1) los permisos de rol son **solo de pantalla**; el acceso de Google de
un vendedor cubre toda la hoja y todo el Drive, así que cualquiera con conocimientos
puede leer o editar todo, y también la bitácora y los cierres; (2) cada guardado
**reescribe la hoja completa** (borra y escribe), hay detección de conflictos entre
dispositivos pero el segundo en guardar pierde su cambio y debe recargar; (3) el límite
de 50.000 caracteres por celda ya rompió el guardado una vez (Hallazgo #42). Con pocos
usuarios aguanta; el techo es este. Una base de datos con reglas por rol y transacciones
(p. ej. Firebase o Supabase) resuelve las tres, pero implica migrar los datos y rehacer
`core/sheetsStorage.js`/`core/sheetsTabular.js`. **Mientras no se haga, la protección
real es a quién se le da acceso de edición a la Google Sheet.**

---

## 3. Cómo se trabaja en este proyecto (reglas que ya están en el código)

- **Antes de tocar dinero, lee `CONTABILIDAD.md`** (principios y reglas por área). Todo
  cambio financiero se documenta ahí como un **Hallazgo nuevo (el siguiente libre es
  el #71)** y en el registro de cambios de `README.md` (**la siguiente ronda es la 120**).
  (Ya usados: #66 y ronda 115 = salud de los datos ampliada; #67 y ronda 116 = mapa técnico;
  #68 y ronda 117 = cola de guardado; #69 y ronda 118 = pestaña propia vacía; #70 y ronda 119 =
  espacio en la hoja.)
- **Pregunta al dueño ANTES de escribir código** cuando haya decisiones de negocio:
  él lo pidió así desde el principio. Habla español, no es técnico: explica en
  palabras simples, con ejemplos en pesos.
- **Una sola fuente por fórmula** (`js/core/calc.js`). No copies un cálculo en una
  pantalla o un PDF. Pesos enteros con `redondearPesos`; IVA con `calcIvaDeBase`;
  signo de un movimiento con `montoConSigno`; total de un pedido con descuento con
  `calcDesglosePedido`.
- **Columnas nuevas de Google Sheets: SIEMPRE al final** del esquema
  (`js/core/sheetsEsquemas.js`). Una columna en medio corre todo lo ya guardado
  (Hallazgos #15–#19).
- **Toda acción nueva que escriba dinero con fecha debe llamar a `exigirMesAbierto`**
  (`js/core/cierre.js`); si no, se salta el cierre de mes.
- **Reutiliza antes de crear** (`js/core/components.js`, ver reglas de UX en `README.md`).
- **Si cambias código de `js/`, corre `npm run mapa`** y sube los documentos de `docs/` junto con el
  cambio; `test/arquitectura.mjs` (CI) falla si quedaron viejos y también si una acción nueva
  escribe movimientos sin `exigirMesAbierto`, un porcentaje sin `redondearPesos`, etc. (ver
  `docs/REGLAS-DE-ARQUITECTURA.md`: qué hacer cuando la CI falla por una regla).
- **Una prueba nueva en `test/` se agrega EN DOS SITIOS**: `.github/workflows/test.yml`
  y el script `test` de `package.json` (listan cada archivo a mano; si no, la CI no la
  corre).
- **Git:** no se commitea directo en `main`: rama propia, un commit por tarea, luego
  fast-forward a `main`. Mensaje en español **sin tildes**, con `(Hallazgo #N)` y la
  línea `Co-Authored-By`. **Pregunta antes de subir a `origin`.** La CI corre solo en
  push a `main` y en PR hacia `main` (no al subir una rama suelta). **No hay `gh`
  instalado**: un PR se abre desde el enlace de GitHub
  (`https://github.com/Bourskill/TALLER/pull/new/<rama>`).
- **Publicación:** la app vive en Netlify (`criyeak.netlify.app`); es probable que
  publique desde `main` (no verificado), así que subir a `main` puede llegar a la app
  real: antes, respaldo reciente.

---

## 4. Entorno y pruebas

- Windows 11. **No hay `node` ni `npm` en el PATH y no existe `node_modules`.**
  Para correr pruebas se usó el Node que trae Adobe Photoshop
  (`C:\Program Files\Adobe\Adobe Photoshop 2026\node.exe`, v22) o, alternativamente, el
  ejecutable de VS Code como Node (`C:\Users\usuario\AppData\Local\Programs\Microsoft VS Code\Code.exe`
  con la variable `ELECTRON_RUN_AS_NODE=1`; su salida se pierde si no se redirige con
  `Start-Process -RedirectStandardOutput`, y los scripts deben terminar con `process.exit`).
- Cuatro archivos corren **sin jsdom** y se pueden correr aquí (conteos al 2026-11-03):
  `test/descuentos.mjs` (250), `test/cuentas.mjs` (270), `test/salud.mjs` (255, con el #66),
  `test/bitacora.mjs` (236). Úsalos como modelo para pruebas nuevas.
- **`test/smoke.mjs`** (≈9.000 líneas, necesita jsdom) **solo corre en GitHub Actions**
  (pestaña Actions → «Pruebas»). Verifica con la CI, no localmente. Los mensajes
  «No se pudo guardar … sin red (prueba)» al correr `bitacora.mjs` son esperados.
- Git Bash convierte rutas: para `git show rama:ruta` usa `MSYS_NO_PATHCONV=1`.
- `test/arquitectura.mjs` (reglas y documentos al día; 77 comprobaciones al 2026-11-04) también corre
  **sin jsdom** y sin npm, con el mismo Node de Photoshop; `npm run mapa` es `node tools/mapa.mjs`
  (con ese Node: `"C:\Program Files\Adobe\Adobe Photoshop 2026\node.exe" tools/mapa.mjs`).
- Para ver pantallas sin el login de Google se armó, en una carpeta temporal, un
  servidor estático mínimo y una página que importa los módulos con datos de ejemplo.
  No existe en el repositorio; `.claude/launch.json` (config "panel", `npx http-server`)
  sí está versionado: no lo pises.

---

## 5. Mapa rápido del código del dinero

| Qué | Dónde |
|---|---|
| Todas las fórmulas (caja, IVA, saldo, comisión, descuentos, cuentas, nómina, deudas) | `js/core/calc.js` |
| Estado y guardado (conflictos, espejo local, reparaciones al cargar, bitácora por `persist`) | `js/core/store.js`, `js/core/guardado.js` |
| Esquemas de las hojas de Google | `js/core/sheetsEsquemas.js`, `js/core/sheetsTabular.js` |
| Salud de los datos (registro de verificaciones) | `js/core/salud.js`, `js/modules/salud.js` |
| Bitácora y cierre de mes | `js/core/bitacora.js`, `js/core/cierre.js`, `js/modules/bitacora.js`, `js/modules/cierres.js` |
| Cuentas y conciliación | `js/modules/cuentas.js` (+ saldos en `calc.js`) |
| PDF (cotización, cuenta de cobro, recibo, reportes) | `js/core/pdf.js` |
| Pedidos / cotizaciones / finanzas / pendientes (nómina, deudas, gastos fijos) | `js/modules/pedidos.js`, `cotizaciones.js`, `finanzas.js`, `pendientes.js` |
| Respaldo diario de la hoja | `js/core/backup.js` |
| **Mapa técnico** (arquitectura, mapa del código y del dinero, escenarios de falla, reglas) | `docs/` — se regenera con `npm run mapa` (`tools/mapa.mjs`, `tools/analisis.mjs`, `tools/reglas.mjs`); lo vigila `test/arquitectura.mjs` |

---

## 6. Límites conocidos (no los des por resueltos)

- **La bitácora y el cierre de mes no son un candado**: quien abra la Google Sheet
  directamente puede editar movimientos, filas de `Cierres` o borrar filas de
  `Bitacora`. Lo que sí pasa: «Meses cerrados» (en Salud) señala un mes cuyos números
  cambiaron. Ver "Qué NO cubre" en `CONTABILIDAD.md`, #65.
- **La conciliación con el banco es manual**: el dueño escribe el saldo de su extracto;
  la app no lee el banco. Ningún chequeo automático compara contra el banco real.
- La cuenta de cobro de un pedido que viene de una cotización lista las referencias,
  no los servicios cobrados (ya era así; el SUBTOTAL de abajo sí los incluye).
- No hay historial de **quién** dio cada descuento antes de la bitácora.
- El mes en curso no se puede cerrar; las reparaciones automáticas de `loadAll()` pueden
  tocar un mes cerrado (quedan anotadas y señaladas, pero no se frenan).
