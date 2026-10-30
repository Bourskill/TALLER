# Continuidad del trabajo — Panel del Taller

**Para quien retome esto en otra sesión: lee este archivo primero.** Dice dónde
quedó todo, qué sigue, cómo se trabaja en este proyecto y qué NO está
comprobado. Al terminar tu parte, actualiza la sección "Dónde quedó todo" y la
fecha de abajo (es el único sitio que envejece).

> Última actualización: **2026-10-30**, `main` en `2cb236e`, pruebas de GitHub en verde.

---

## 1. Dónde quedó todo

**Objetivo del dueño** (palabras suyas): que la herramienta que le ahorra trabajo
no le cause más, que sea rigurosa con el dinero y que **todo lo que se vea sea
verdad, para que cuadre al peso con sus cuentas bancarias**. Todo lo de abajo
nació de un análisis de Finanzas pedido por él (2026-10-29).

Todo está integrado en `main`, publicado en GitHub y con la CI en verde (los 5
archivos de prueba, `smoke.mjs` incluido). No hay ninguna sesión ni PR en curso.

| Hallazgo | Qué es | Dónde se ve en la app | Prueba |
|---|---|---|---|
| **#61** | Descuentos por ítem y a toda la orden, en cotización, pedido rápido y pedido ya creado. `p.total` es SIEMPRE el valor ya rebajado. | Línea del pedido, "Descuento al total", tarjeta del pedido (🏷), editor de cotización; columna DESCUENTO en los PDF | `test/descuentos.mjs` |
| **#62** | Todo monto que la app calcula va en **pesos enteros** (IVA, comisión, saldo, nómina convertida de base, cuotas de deuda). Una sola fórmula del IVA. | Invisible: ya no hay "saldo fantasma" de centavos | `test/descuentos.mjs` (secciones 5 y 6) |
| **#63** | Cuentas (Efectivo, Banco, Nequi), saldo por cuenta, transferencias entre cuentas, conciliación contra el extracto. | Finanzas → 🏦 Cuentas, Configuración → Cuentas, saldo en Resumen | `test/cuentas.mjs` |
| **#64** | Panel «Salud de los datos»: verifica y REPORTA (no repara) 13 cosas, y dice lo que la app corrigió sola al cargar. | Arriba de todo en Configuración (solo admin), insignia roja en el menú | `test/salud.mjs` |
| **#65** | Bitácora de cambios del dinero y cierre de mes. | Finanzas → 📒 Bitácora y 🔒 Cierre de mes (solo admin) | `test/bitacora.mjs` |

Detalle, decisiones y límites de cada uno: **`CONTABILIDAD.md`** (hallazgos #61–#65) y
el registro de cambios de **`README.md`** (rondas 109–114).

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

### B. Limpiar ramas (pide permiso al dueño: toca el repositorio compartido)
Todas estas ya están dentro de `main` y no hacen falta:
`bitacora-y-cierre-de-mes`, `salud-de-los-datos`, `claude/dreamy-lalande-419844`,
`claude/elastic-leavitt-ae29c7` (también en GitHub) y, solo locales,
`descuentos-por-item-y-orden`, `redondeo-pesos-enteros`, `redondeo-nomina-y-cuotas`,
`integracion`. Comprobar con `git branch --merged main` y borrar con
`git branch -d <rama>` / `git push origin --delete <rama>`.

### C. Mejoras pequeñas ya identificadas (ninguna empezada)
- **Ampliar «Salud de los datos»** con lo que hoy NO revisa (lista completa en
  `CONTABILIDAD.md`, #64, "Qué NO verifica todavía"): pagos de nómina y deudas
  (`cuotasPagadas` contra sus movimientos), ventas de consignación, compras marcadas
  «Sí» contra su movimiento, la fecha de un abono contra la de su movimiento, y lo que
  está en la papelera. Se suma con `registrarVerificacion` en `js/core/salud.js`.
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
  el #66)** y en el registro de cambios de `README.md` (**la siguiente ronda es la 115**).
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
- Cuatro archivos corren **sin jsdom** y se pueden correr aquí (conteos al 2026-10-30):
  `test/descuentos.mjs` (250), `test/cuentas.mjs` (270), `test/salud.mjs` (148),
  `test/bitacora.mjs` (236). Úsalos como modelo para pruebas nuevas.
- **`test/smoke.mjs`** (≈9.000 líneas, necesita jsdom) **solo corre en GitHub Actions**
  (pestaña Actions → «Pruebas»). Verifica con la CI, no localmente. Los mensajes
  «No se pudo guardar … sin red (prueba)» al correr `bitacora.mjs` son esperados.
- Git Bash convierte rutas: para `git show rama:ruta` usa `MSYS_NO_PATHCONV=1`.
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
