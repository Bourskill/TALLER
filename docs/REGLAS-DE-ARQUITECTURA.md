# Reglas de arquitectura

**Para qué sirven:** son comprobaciones que corre solo la CI (`test/arquitectura.mjs`) leyendo el código **sin ejecutarlo**. Cada regla vigila una promesa del proyecto que antes dependía de que alguien se acordara. Están escritas en `tools/reglas.mjs`.

**Cómo funcionan (decisión del dueño):**

1. **Primero AVISAN** con una **lista base** (`docs/reglas-baseline.json`): lo que ya incumple una regla hoy, cada caso con su motivo. Esos casos salen como aviso en cada corrida y **no** hacen fallar la CI.
2. **Desde ahí BLOQUEAN solo lo nuevo:** cualquier caso que no esté en la lista base hace fallar la CI, con el archivo, la línea y qué hacer.
3. Cada entrada de la lista base se clasifica: **excepción legítima** (a propósito; el motivo lo explica) o **riesgo real** (hay que arreglarlo; lleva su hallazgo en `CONTABILIDAD.md` y su severidad). Al arreglar un riesgo real se borra su entrada.
4. Si una entrada de la lista ya no corresponde a nada (se arregló o se renombró), la prueba lo avisa para que se borre.

Además de las reglas, la misma prueba comprueba que **los documentos generados estén al día** (los regenera en memoria y los compara; falla si están viejos) y que las citas `archivo:línea` de los documentos escritos a mano apunten a la línea que el autor verificó (la foto está en `docs/citas.snapshot.json`; si el código se movió, `npm run mapa` las reancla solas, y las que cambiaron de verdad quedan como aviso para revisarlas a mano).

## Estado de hoy

<!-- GENERADO:inicio estado -->

| Regla | Qué exige | Casos hoy | En la lista base | Nuevos (hacen fallar la CI) |
| --- | --- | --- | --- | --- |
| `R1-mes-cerrado` | Toda acción que crea, cambia o quita un movimiento (o una transferencia) llama a exigirMesAbierto | 1 | 1 | 0 |
| `R1b-guarda-primero` | La guarda del mes cerrado va ANTES de la primera escritura de la acción | 0 | 0 | 0 |
| `R2-porcentaje-redondeado` | Todo cálculo con porcentaje de dinero pasa por redondearPesos / calcIvaDeBase | 8 | 8 | 0 |
| `R3-iva-una-fuente` | El IVA solo sale de calcIvaDeBase | 0 | 0 | 0 |
| `R4-marca-de-origen` | Todo movimiento que crea el sistema lleva una marca de origen registrada | 5 | 5 | 0 |
| `R5-esquemas-solo-crecen` | Las columnas de las hojas solo crecen AL FINAL (foto en docs/esquemas.snapshot.json) | 0 | 0 | 0 |
| `R6-pruebas-en-ci` | Todo test/*.mjs está en el workflow de la CI y en el script test de package.json | 0 | 0 | 0 |
| `R7-persist-clave-valida` | Todo persist("x") usa una clave que existe en KEYS | 3 | 3 | 0 |
| `R8-acciones-unicas` | Ninguna acción de la interfaz está definida dos veces | 0 | 0 | 0 |

<!-- GENERADO:fin estado -->

## Qué vigila cada regla y por qué

| Regla | Qué exige | Por qué existe | Cómo lo detecta |
|---|---|---|---|
| `R1-mes-cerrado` | Toda acción que **crea, cambia o quita** un movimiento (o una transferencia) llama a `exigirMesAbierto` en su camino de llamadas | Si no, esa acción se salta el cierre de mes (Hallazgo #65). `CONTINUIDAD.md` ya lo pide como regla del proyecto | Para cada acción de la interfaz sigue las funciones que llama y busca escrituras a `state.tx`, `txPapelera`, `transferencias` o un `persist` de esas claves; si hay y no hay guarda, falla |
| `R1b-guarda-primero` | La guarda va **antes** de la primera escritura de la propia acción | Una guarda después de escribir no protege nada | Compara las posiciones de la guarda y de la primera escritura dentro de la acción |
| `R2-porcentaje-redondeado` | Toda división entre 100 (un porcentaje de dinero) tiene `redondearPesos` o `calcIvaDeBase` en su línea o en la vecina | «Todo monto que la app calcula va en pesos enteros» (Hallazgo #62): un monto con centavos no cuadra con el banco | Busca `/ 100` en el código (sin comentarios ni textos) y mira la línea anterior, la propia y la siguiente |
| `R3-iva-una-fuente` | El IVA solo sale de `calcIvaDeBase` | Antes se calculaba en tres sitios y salía distinto (Hallazgo #62) | Busca aritmética con el porcentaje del IVA o con la tasa escrita a mano (`1.19`, `0.19`) fuera de esa función |
| `R4-marca-de-origen` | Todo movimiento que crea el sistema lleva algún campo de `MARCAS_ORIGEN_SISTEMA` | Sin marca, el movimiento se puede borrar suelto y deja un lado del dinero diciendo algo que el otro no (principio 5 de `CONTABILIDAD.md`) | Lee el objeto que se agrega a `state.tx` (también el que se arma antes y se pasa a `Object.assign`) y busca un campo de la lista |
| `R5-esquemas-solo-crecen` | Las columnas de las hojas solo se agregan **al final** | Las hojas se leen por posición: una columna en medio corre todo lo guardado (Hallazgos #15–#19) | Compara las columnas de hoy con la foto `docs/esquemas.snapshot.json` |
| `R6-pruebas-en-ci` | Todo `test/*.mjs` está en `.github/workflows/test.yml` **y** en el script `test` de `package.json` | Una prueba que no está en la lista no corre en la CI y nadie se entera (`CONTINUIDAD.md`, §3) | Compara los archivos de `test/` con los dos listados |
| `R7-persist-clave-valida` | Todo `persist("x")` usa una clave que existe en `KEYS` | Una clave inventada escribiría en `kv` con un nombre que nadie lee (comentario de `js/core/store.js:1650-1654`) | Lee el texto de cada `persist(...)`; los que usan una variable se listan para revisión |
| `R8-acciones-unicas` | Ninguna acción de la interfaz está definida dos veces | Si dos módulos usan el mismo nombre, gana la última sin avisar | Compara los nombres de todas las acciones |

**Lo que las reglas NO pueden ver** (dicho para no dar por cubierto lo que no lo está): una función llamada por un nombre armado en tiempo de ejecución; un cambio hecho a través de una variable que apunta a un movimiento (`MAPA-DEL-DINERO.md`, §6); que la guarda cubra **todas** las ramas de una acción (solo que exista en su camino); que un cálculo con porcentaje esté bien hecho. Son un cinturón, no una garantía.

## Cuando la CI falla, qué hacer

1. **Lee el mensaje:** dice la regla, el archivo y la línea.
2. **Si es un error real,** corrígelo en el código (por ejemplo, agrega `exigirMesAbierto([fecha], "…")` antes de escribir) y vuelve a correr `node test/arquitectura.mjs`.
3. **Si es una excepción a propósito,** agrégala a `docs/reglas-baseline.json` con `"clasificacion": "excepcion-legitima"` y un `"motivo"` que lo explique a alguien que no estuvo. `node test/arquitectura.mjs --candidatas` imprime las entradas ya armadas para copiar.
4. **Si es un riesgo conocido que se va a arreglar después,** agrégala con `"clasificacion": "riesgo-real"`, su `"severidad"` y su `"hallazgo"` (y documéntalo en `CONTABILIDAD.md`).
5. **Si los documentos están viejos,** corre `npm run mapa` y súbelos junto con el cambio de código.
6. **Si una columna cambió de lugar,** NO actualices la foto a la fuerza: arregla el esquema (la columna nueva va al final). `npm run mapa` se niega a actualizar la foto en ese caso.

## La lista base

<!-- GENERADO:inicio lista-base -->

**17 entradas**: 14 excepciones legítimas y 3 riesgos reales (cada riesgo real tiene su Hallazgo en `CONTABILIDAD.md`).

| Regla | Caso (clave) | Qué es | Hallazgo | Por qué está en la lista |
| --- | --- | --- | --- | --- |
| `R1-mes-cerrado` | `js/modules/cuentas.js::accion:toggle-conciliado` | excepción legítima | — | Solo marca o desmarca «lo vi en el extracto del banco» (conciliadoEn / conciliadoDe / conciliadoA). No cambia monto, fecha, tipo ni cuenta, así que no mueve plata de ningún mes. Decisión del Hallazgo #65: las conciliaciones no se bloquean. |
| `R2-porcentaje-redondeado` | `js/core/bitacora.js::n::function n(v) { return Math.round(num(v) * 100) / 100; }` | excepción legítima | — | Normaliza a 2 decimales para comparar el antes y el después de la bitácora; no calcula un monto que se cobre ni se pague. |
| `R2-porcentaje-redondeado` | `js/core/calc.js::calcMontoDescuento::var bruto = d.tipo === "fijo" ? num(d.valor) : base * Math.min(100, num(d.valor)) / 100;` | excepción legítima | — | Es la única fórmula del descuento y redondea en la línea siguiente con Math.round (el mismo redondeo que redondearPesos: el medio peso sube). Podría llamar a redondearPesos por claridad. |
| `R2-porcentaje-redondeado` | `js/core/pdf.js::generarPDFInternoCotizacion::(hayCantReal ? numFmt(Math.round((cantidadRealPedido(compra) - despCant) * 100) / 100) + (c.unidad ? " " + c.u` | excepción legítima | — | Redondea a 2 decimales una CANTIDAD de material (metros, unidades), no dinero. |
| `R2-porcentaje-redondeado` | `js/core/salud.js::verificarCaja::var independiente = centavos / 100;` | excepción legítima | — | La verificación de la Caja suma en centavos enteros a propósito, por un camino distinto al de calcCaja, para poder compararlos. |
| `R2-porcentaje-redondeado` | `js/core/utils.js::redondear2::return Math.round((num(n) + Number.EPSILON) * 100) / 100;` | excepción legítima | — | Redondeo a 2 decimales para cantidades enlazadas y para la conciliación, donde el extracto del banco sí puede traer centavos (calcConciliacion). |
| `R2-porcentaje-redondeado` | `js/modules/cotizaciones.js::renderFilaCompraRecibo::var usado = Math.round((num(compra.cantidadReal) - desperdicio + faltante) * 100) / 100;` | excepción legítima | — | Redondea a 2 decimales una cantidad de material que se muestra en la fila del recibo. |
| `R2-porcentaje-redondeado` | `js/modules/pedidos.js::renderCondicionesConsignacion::: precioPublico * (num(f.consignacionComisionValor) / 100);` | **riesgo real** (baja) | #67-9 | La vista previa de la comisión del punto de consignación calcula el porcentaje por su cuenta, sin redondearPesos ni calcComisionValor (una sola fuente por fórmula). Solo es pantalla, pero puede mostrar $1 distinto al valor real. |
| `R2-porcentaje-redondeado` | `js/modules/pedidos.js::renderVendedorPedido::var comision = f.vendedorTipo === "fijo" ? num(f.vendedorValor) : totales.precioTotal * (num(f.vendedorValor)` | **riesgo real** (baja) | #67-9 | La vista previa de la comisión del vendedor en «Nuevo pedido» calcula el porcentaje por su cuenta (sin redondear); el monto real sale de calcComisionValor. Solo pantalla, puede diferir en $1 en medios pesos. |
| `R4-marca-de-origen` | `js/modules/cotizaciones.js::accion:add-cot-estimado-movimiento` | excepción legítima | — | El costo estimado se referencia desde la cotización (estimadoTxId), no desde una marca del movimiento. Que se pueda borrar suelto en Finanzas es a propósito: la propia pantalla recomienda borrarlo para quedarse con las compras reales (cotizaciones.js:2271-2274). |
| `R4-marca-de-origen` | `js/modules/finanzas.js::accion:add-tx` | excepción legítima | — | Es el movimiento que una persona escribe a mano en Finanzas: no tiene otro registro de origen. |
| `R4-marca-de-origen` | `js/modules/finanzas.js::accion:restaurar-tx` | excepción legítima | — | Devuelve una copia que estaba en la papelera; conserva las marcas que ya tenía. |
| `R4-marca-de-origen` | `js/modules/pedidos.js::accion:restaurar-pedido` | excepción legítima | — | Devuelve a Finanzas las copias de los movimientos del pedido que estaban en la papelera; conservan sus marcas. |
| `R4-marca-de-origen` | `js/modules/pendientes.js::accion:pagar-nomina` | excepción legítima | — | El movimiento de nómina ES el registro del pago (no hay otro lado que descuadrar); se reconoce por empleadoId. Se puede borrar suelto desde Finanzas y Pendientes vuelve a mostrarlo pendiente. Si algún día se quiere protegerlo, se agrega empleadoId a MARCAS_ORIGEN_SISTEMA. |
| `R7-persist-clave-valida` | `js/core/pdf.js::asegurarCodigoPublico::dinamico:persistKey` | excepción legítima | — | La clave la pasan sus tres llamadas con un texto fijo: «cotizaciones» o «pedidos» (pdf.js:318, :1383, :1430). |
| `R7-persist-clave-valida` | `js/core/store.js::aprobarPropuesta::dinamico:propuesta.key` | **riesgo real** (media) | #67-6 | La clave sale de la propuesta guardada en la hoja y no se comprueba contra APPROVAL_REQUIRED_KEYS: una propuesta manipulada con key «tx» reemplazaría todos los movimientos al aprobarla. |
| `R7-persist-clave-valida` | `js/core/store.js::recuperarDelEspejo::dinamico:clave` | excepción legítima | — | Solo se persiste si la clave está en CLAVES_PERSISTIBLES (store.js:1725); un borrador sin fila propia (formPedido…) se restaura en pantalla y no se guarda. |

<!-- GENERADO:fin lista-base -->
