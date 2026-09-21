# Reglas financieras del taller

Este documento existe para dejar de improvisar cada vez que se toca dinero.
Nació de una pregunta directa del usuario: *"para todo el tema
financiero/económico no hay una guía... siento que me toca adivinar
muchos procesos de flujo de dinero... quiero una garantía... algo
tangible, comparativo, para no estar a la deriva y a prueba y error"*.

**Cómo usarlo:** antes de construir o cambiar cualquier cosa que toque
plata (un KPI nuevo, una acción que cree/edite/borre un `tx`, un reporte),
revisa primero si el concepto ya tiene una regla acá abajo. Si la hay, la
nueva pieza debe seguirla (o el cambio debe actualizar este documento a
propósito, con su porqué). Si no la hay, es una señal de que hace falta
una decisión explícita antes de escribir código — no adivinar.

Este documento se generó con una auditoría real del código (septiembre
2026, ver el registro de cambios de `README.md`) — no es una lista de
buenas prácticas genéricas de internet, es lo que ESTA app realmente hace,
verificado línea por línea, comparado contra principios estándar de
contabilidad de caja para negocio pequeño.

---

## Principios base (el marco que gobierna todo lo demás)

1. **Contabilidad de CAJA, no de devengo.** Un movimiento (`tx`) en
   Finanzas SIEMPRE es dinero que YA se movió — nunca existe un estado
   "pendiente" a nivel de movimiento. Lo que el cliente aún debe vive en
   el saldo del pedido (Por cobrar); lo que el taller aún debe vive en
   Pendientes (gastos fijos, nómina, deudas, comisiones) — nunca como un
   `tx` a medias. (`core/calc.js:123-127`)
2. **El IVA no es plata del taller.** Se cobra al cliente y se entrega al
   Estado; el taller solo lo tiene guardado un rato. Lo que el cliente
   DEBE sí incluye IVA (la cartera va con IVA); lo que el taller GANA no
   lo incluye (margen/reportes se calculan sobre la base). (`calc.js:484-500`)
3. **Una sola fuente por fórmula.** Ningún monto derivado (`p.abono`, el
   "disponible" de un servicio, el saldo de una deuda) se escribe a mano
   ni se recalcula en dos sitios distintos — siempre hay UNA función que
   es la única puerta, y todo lo demás la llama. Ejemplos: `calcAbonadoDeLista`
   para `p.abono`, `recalcularAbonoPedido` como único camino para tocarlo,
   `calcResumenMovimientos` compartida entre el reporte en vivo y el PDF.
4. **Cancelado ≠ Eliminado.** Cancelado = sí existió y sí movió plata real
   (el cliente abonó, se pagó comisión); sus movimientos se QUEDAN en
   Finanzas, solo deja de contar todo lo que mira hacia ADELANTE (saldo
   por cobrar, comisión pendiente, activo). Eliminado = no debió existir;
   se lleva consigo a la papelera los movimientos que él mismo generó.
   (`calc.js:443-458`)
5. **Todo movimiento generado por el sistema lleva una marca de origen**
   (`origenAbonoId`, `origenReembolsoId`, `origenComisionPedidoId`,
   `origenGastoFijoPeriodo`, `deudaId`, etc. — ver `MARCAS_ORIGEN_SISTEMA`,
   `calc.js:321-417`) que bloquea su borrado suelto desde Finanzas MIENTRAS
   su origen (pedido/cotización/gasto fijo/deuda) siga existiendo — evita
   que alguien borre un lado del dinero mientras el otro sigue afirmando
   que pasó. Si el origen ya se borró, el movimiento queda "huérfano" y
   se libera para poder borrarse.
6. **"Servicio" es plata que entró pero nunca salió de la caja** (mano de
   obra propia — corte, confección — cobrada pero no pagada a nadie
   aparte). Se resta de "Ganancia" pero NO de "Balance"/"Caja" (sigue
   disponible para gastar). Un servicio ya pagado de verdad deja de
   restar de Ganancia (se topa a lo "disponible", nunca al bruto —
   restarlo dos veces sería doble conteo).

---

## Reglas por área

### Pedidos: total, IVA, saldo, abonado

| Qué | Regla | Dónde |
|---|---|---|
| IVA de un pedido | `p.total * (iva.porcentaje/100)` si `iva.activo`, si no `0`. Sobre la base, nunca sobre el total con IVA. | `calc.js:501` `calcIvaPedido` |
| Total con IVA (número de la cuenta de cobro) | `p.total + calcIvaPedido(p)` | `calc.js:507` `calcTotalConIvaPedido` |
| Saldo por cobrar de un pedido | `calcTotalConIvaPedido(p) - p.abono` — **incluye IVA siempre** | `calc.js:511` `calcSaldoPedido` |
| Abonado (única fórmula) | suma abonos, RESTA los de `tipo:"reembolso"`. `p.abono` nunca se edita a mano. | `calc.js:541` `calcAbonadoDeLista` |
| IVA ya cobrado de un pedido | `calcIvaPedido(p) * (p.abono / totalConIva)` — proporcional a lo pagado | `calc.js:518` `calcIvaCobrado` |
| IVA cobrado total (KPI) | suma de todos los pedidos, incluidos cancelados (si se cobró, se debe igual) | `calc.js:528` `calcIvaCobradoTotal` |
| Pedido cancelado | no borra nada; excluye al pedido de TODO lo que mira hacia adelante (por cobrar, deudores, comisión pendiente, activo, ventas del reporte) — ver principio 4 | `calc.js:459` `pedidoCancelado`, usado en ~11 funciones distintas |
| Único camino para tocar `p.abono` | `recalcularAbonoPedido` — toda acción (agregar/editar/eliminar abono, reembolso, "cobrar") pasa por acá | `modules/pedidos.js:15-33` |

### Comisiones (vendedor y consignación)

| Qué | Regla | Dónde |
|---|---|---|
| Base de comisión de un pedido | `p.total` MENOS las líneas marcadas "servicio cobrado" (diseño, arreglos — comisionarlas dejaría esa línea en pérdida) | `calc.js:1175` `calcBaseComision` |
| Valor de la comisión | fijo → `v.valor`; porcentaje → `base * pct/100` | `calc.js:1181` `calcComisionValor` |
| Comisión de consignación | se calcula POR CADA VENTA, no sobre el envío total | `calc.js:1305` `calcConsignacionComision` |
| Marcar comisión pagada/despagada | toggle bidireccional real: crea o RETIRA el `tx` por completo (nunca solo cambia una etiqueta) — evita doble movimiento al re-marcar | `modules/pedidos.js:2030` `toggle-comision`, `modules/cotizaciones.js:1987` `toggle-comision-cot` |

### Servicios (mano de obra propia del taller)

| Qué | Regla | Dónde |
|---|---|---|
| Qué es un "servicio" | cualquier línea de "Compras del pedido" marcada `estado:"servicio"` — editable a mano en CUALQUIER línea, no atado a categorías del catálogo | `calc.js:590-621` `listaEntradasServicio` |
| Acumulado bruto | agrupado por NOMBRE, filtrado por fecha de la COTIZACIÓN (un servicio nunca genera `tx`, no tiene fecha propia). Solo cuenta si la cotización está `convertida` o tiene `pedidoOrigenId` (escalada desde un pedido rápido real) — una cotización que nunca fue ni una cosa ni la otra no tiene ningún cobro real detrás. | `calc.js:623` `calcServiciosPorCategoriaRango`/`listaEntradasServicio` |
| Disponible | acumulado histórico MENOS lo ya asignado a un gasto/nómina (`tx.serviciosDescuento`) | `calc.js:675` `calcServiciosDisponibles` |
| Lo que resta de Ganancia | topado a lo "disponible" ACTUAL, no al bruto — evita doble conteo cuando el servicio ya se pagó de verdad. Un servicio en $0 sigue en la lista (no desaparece). | `calc.js:700` `calcServiciosPendientesPorCategoriaRango` |
| Validación al asignar un gasto/nómina a un servicio | (1) nunca deja un servicio negativo, (2) lo asignado no puede superar el monto del propio pago | `calc.js:751` `validarServiciosAsignados` |
| "Colchón" (2026-09) | un servicio MÁS, con nombre fijo "Colchón" — mismo acumulado/disponible/asignación de arriba, sin ningún cambio en esas fórmulas. Su entrada no nace de una cotización: se rellena a mano desde Resumen, de dos formas (`state.config.colchonMovimientos[].origen`): `"separar"` (plata que ya estaba en caja, sin `tx` nuevo — pura reserva) o `"aporte"` (plata nueva, SÍ genera un `tx` de ingreso real, marcado `origenColchonId`). En los dos casos resta de Ganancia igual que cualquier servicio — es la plata "prestada" para cubrir el hueco cuando un abono supera el margen real. | `calc.js` `listaEntradasServicio` (bloque Colchón) / `modules/resumen.js` `renderColchon` |

### Consignación

| Qué | Regla | Dónde |
|---|---|---|
| No tiene saldo por cobrar tradicional | el dinero entra recién cuando el punto reporta una venta real; mientras tanto solo importa cuánto queda disponible | `calc.js:1244-1301` |
| Remisión (envío al punto) | NO genera gasto/COGS — el costo ya se registró al producir la mercancía, antes de entrar al catálogo | `modules/pedidos.js` `confirmar-remision` |
| Venta reportada | crea el `tx` ingreso; NO descuenta stock (ya salió al remitir), solo mueve unidades de "disponible" a "vendida" | `modules/pedidos.js:1705` `registrar-venta-consignacion` |

### KPIs del panel Resumen

| KPI | Fórmula | Dónde |
|---|---|---|
| Caja actual | acumulado histórico COMPLETO de `state.tx` (ingresos suman, todo lo demás resta) | `calc.js:128` `calcCaja` |
| Por cobrar | suma de `calcSaldoPedido(p)` (con IVA) SOLO cuando es positivo, de pedidos no cancelados | `calc.js:546` `calcPorCobrarPedidos` |
| Por pagar | `gastos fijos + nómina + comisiones (pedido y cotización) + deudas (valor de la cuota) + comisiones de consignación` pendientes | `calc.js:570` `calcPorPagar` |
| Balance (30 días) | ingresos − gastos del rango, vía `calcSerieMovimientos` (misma función que CUALQUIER otro reporte) | `modules/resumen.js:321` |
| Ganancia (30 días) | `Balance − serviciosPendientes(rango) − abonosPendientes(rango) − ivaCobrado − saldosAFavorClientes` (las dos últimas NO están filtradas por rango: son una deuda/obligación VIGENTE, igual que en "Por pagar" — actualizado en la auditoría estricta 2026-09-20, antes faltaban) | `modules/resumen.js` `renderGraficaResumen` |
| Abonado que "todavía no es Ganancia" | abonos de pedidos NO cancelados con saldo `> 0` (aún no pagados por completo); mira el estado ACTUAL del pedido, no la fecha del abono | `calc.js:732` `calcAbonosPendientesPorPedido` |
| IVA cobrado (KPI) | proporcional a lo pagado, sobre todos los pedidos incluidos cancelados; solo se muestra si el taller factura IVA | `calc.js:515-530`, `modules/resumen.js:145` |

### Ciclo de vida de un movimiento en Finanzas

- Un `tx` creado a mano solo puede ser `ingreso`, `gasto` o `nómina`
  (`comisión` existe como tipo pero no es creable a mano — nace solo de
  las acciones de comisión). (`finanzas.js:8-11`)
- "Asignar a servicio(s)" solo aplica a `gasto`/`nómina` manuales y a
  pagar nómina — **NO** a marcar un gasto fijo pagado ni a pagar una
  deuda (ver hallazgo de "duda de negocio" más abajo).
- Borrar = mover a papelera, nunca destruir. Solo "eliminar definitivo"
  (desde la Papelera, con confirmación) borra para siempre.
- Un `tx` con marca de origen vigente no se puede borrar suelto — el
  botón de borrar sigue visible pero como 🔒, con un mensaje que dice
  dónde deshacerlo de verdad (en el pedido/cotización/gasto fijo/deuda
  que lo generó).

### Mutaciones de dinero en Pedidos y Cotizaciones

- **Registrar abono:** si el monto supera el saldo, pide confirmación
  explícita (puede quedar "saldo a favor" a propósito, no se recorta en
  silencio).
- **Reembolso:** vive en la misma lista de abonos pero resta; no puede
  exceder lo ya abonado.
- **Duplicar pedido/cotización:** todo id que apunte HACIA AFUERA
  (`compras`, `estimadoTxId`, `clienteId`, `pedidoId`) se limpia, nunca
  se copia — evita que un duplicado herede el historial financiero del
  original.
- **Cancelar:** no toca ningún `tx` (los abonos y comisiones ya cobrados
  quedan intactos); solo deja de contar hacia adelante.
- **Eliminar:** se lleva consigo (a la papelera) los movimientos que el
  pedido/cotización generó — nunca los deja huérfanos.
- **Compras del pedido — estado de una línea:** "No" = nada; "Sí" = se
  pagó aparte → genera `tx` de gasto; "Servicio" = mano de obra propia,
  cuenta como costo pero NO genera `tx`.

### Pagos en Pendientes (nómina, gastos fijos, deudas)

- **Nómina:** `salario del periodo de esa persona + bono − descuento`;
  antes de confirmar corre la misma `validarServiciosAsignados`.
- **Gasto fijo:** toggle por periodo puntual (clave `id+periodo`); al
  desmarcar solo borra el `tx` de ESE periodo, nunca los anteriores. No
  pasa por "asignar a servicio".
- **Deuda:** "Pagar" registra la cuota siguiente o el saldo completo si
  es la última; al saldar la última cuota, la deuda se muda entera a
  `deudasHistorial`. No pasa por "asignar a servicio".
- **Comisión de vendedor:** en Pendientes es de solo lectura (se paga
  desde el pedido/cotización de origen, no desde acá).

---

## Auditoría de septiembre 2026 — hallazgos

Auditoría hecha con 9 agentes: 6 extrajeron cada regla de dinero del
código (146 reglas, consolidadas arriba), 3 las compararon contra
principios contables desde ángulos distintos (completitud vs.
contabilidad de caja estándar, consistencia interna/doble conteo,
casos borde de uso real). 23 hallazgos en total.

### 🟢 Verificado correcto (9) — para tener confianza en lo que ya está bien

1. El saldo por cobrar SÍ incluye el IVA (cartera con IVA, ganancia sin IVA).
2. `calcAbonadoDeLista` es la única fuente del abonado; los reembolsos restan, nunca suman.
3. `movimientosGeneradosPorPedido` distingue un gasto vinculado a mano de uno que el pedido generó por sí mismo (no se lo lleva la papelera por error).
4. La remisión a consignación no duplica el costo (ya se contó al producir).
5. `recalcularAbonoPedido` es la única puerta para tocar `p.abono` — verificado sin excepciones en el código real.
6. Duplicar cotización/pedido limpia correctamente los ids que apuntan hacia afuera.
7. El IVA sobre un reembolso se recalcula solo (no hace falta lógica aparte).
8. Cancelar un pedido abonado en varias partes no descuadra nada.
9. Las fechas de abonos/movimientos usan hora LOCAL, no UTC (ya corregido un bug histórico de "se pasa al día siguiente de noche").

### ✅ Riesgos atendidos (9 de 9, septiembre 2026)

8 se corrigieron con código de punta a punta. El 9° ("Compras del pedido
de una cotización sin convertir") tenía dos partes: una SÍ era un bug real
y se corrigió; la otra, al investigarla, resultó ser un comportamiento
intencional y correcto — se explica en su propia entrada más abajo.

- **Registrar una deuda (préstamo) no generaba el ingreso de caja
  correspondiente.** Ahora el formulario de "Agregar deuda" tiene un
  checkbox explícito ("¿esta deuda trajo dinero en efectivo a la caja?")
  — se preguntó al usuario en vez de adivinar, porque "deuda" también
  cubre crédito de proveedor (mercancía fiada, sin plata real de por
  medio) y automatizarlo siempre habría sido igual de incorrecto que no
  hacer nada. Con el checkbox marcado, se crea el `tx` de ingreso
  (marcado `origenDeudaIngresoId`, protegido contra borrado suelto,
  sincronizado si se edita el monto de la deuda después). De paso se
  encontraron y corrigieron 4 campos de marca de origen
  (`origenReembolsoId`, `origenVentaConsignacionId`,
  `origenComisionConsignacionId`, `origenCompraClave`) que faltaban en
  el esquema de la hoja de Movimientos — se perdían en silencio en cada
  guardado/recarga, dejando esos movimientos sin protección de borrado
  después de recargar la página. (`pendientes.js`, `calc.js`,
  `sheetsEsquemas.js`)
- **`calcPedidosRango` calculaba su propio saldo SIN IVA**, reproduciendo
  el mismo bug ya corregido una vez en `calcSaldoPedido`. Ahora usa
  `calcSaldoPedido(p)` directamente — un pedido pagado por completo con
  IVA activo da saldo $0, no un negativo del monto exacto del IVA.
  (`calc.js:2147`)
- **Editar un abono viejo no validaba contra el saldo del pedido.**
  Registrar un abono nuevo ya preguntaba si superaba el saldo; ahora
  `guardar-abono-edit` hace la misma pregunta, comparando el monto nuevo
  contra el saldo que tendría el pedido SIN este abono (para no contarlo
  dos veces). Mismo mensaje, mismo criterio que el alta. (`pedidos.js`)
- **Doble clic al registrar un abono CON comprobante adjunto podía
  duplicarlo.** La lectura del archivo es asíncrona; ahora
  `state.abonosProcesando` bloquea un segundo "Registrar abono" del mismo
  pedido mientras el primero sigue leyendo su comprobante. (`pedidos.js`,
  `store.js`)
- **`toggle-gasto-fijo-pagado` no pedía confirmación**, a diferencia de
  `toggle-comision` que ya se había corregido por el mismo motivo
  (pastilla que parece solo una etiqueta de estado). Ahora pregunta en
  los dos sentidos (marcar pagado / deshacer), con el nombre y el monto
  en el aviso, igual que la comisión. (`pendientes.js`)
- **El bloqueo de borrado de un gasto fijo pagado no distinguía el
  periodo.** Protegía el `tx` mientras el gasto fijo existiera, sin
  mirar si era del periodo vigente — uno de hace 3 meses quedaba
  "protegido" para siempre aunque no hubiera botón real que lo deshaga.
  Ahora la protección compara contra `pagadoHasta` del gasto fijo: solo
  el `tx` del periodo ACTUAL sigue protegido; uno de un periodo que ya
  quedó atrás pasa a "huérfano" y se puede borrar directo desde
  Finanzas, igual que cualquier otro movimiento sin origen vigente.
  (`calc.js`)
- **Pagar la cuota de una deuda no tenía ruta real de reversión.** El
  mensaje de bloqueo prometía un botón en "Pendientes → Deudas" que no
  existía. Se agregó de verdad: "↩ Deshacer último pago" (en Activas e
  Historial) retira el `tx` correspondiente y resta una cuota pagada; si
  la deuda ya estaba saldada, vuelve a Activas. Solo deshace la ÚLTIMA
  línea del historial (una más vieja no tiene botón, a propósito — no
  hay forma segura de saber si algo posterior ya "contó con" ese pago).
  Un pago registrado ANTES de este fix no guardó el id de su `tx`
  (campo `txId`, nuevo en cada línea de `historial`) — para esos casos
  el botón avisa en vez de adivinar cuál movimiento le corresponde.
  (`pendientes.js`)
- **"Por pagar" no incluía los saldos a favor del cliente (sobrepagos).**
  Un abono mal digitado o mercancía devuelta deja
  `calcSaldoPedido(p)` negativo — esa plata es una obligación real del
  taller (hay que devolverla) pero no se sumaba en ningún KPI. Ahora
  `calcSaldosAFavorClientes()`/`listaSaldosAFavorClientes()` la suman
  aparte: entra en `calcPorPagar`, tiene su propia categoría en el
  desglose de Pendientes, y se trata como "vencida" (urgente) en el
  indicador compacto, igual que una comisión sin fecha propia — no tiene
  un vencimiento natural que esperar. (`calc.js`)
- **"Servicio" disponible sin que hubiera pedido real detrás.** Marcar
  una línea de "Compras del pedido" como "Servicio" en una cotización
  que nunca fue ni convertida ni escalada desde un pedido rápido real
  la dejaba contar como plata "disponible" para pagar nómina — sin que
  el cliente hubiera aceptado ni pagado nada. Ahora `listaEntradasServicio`
  exige que la cotización esté `convertida` O tenga `pedidoOrigenId` (una
  escalada desde un pedido rápido YA real, aunque siga en "borrador"
  hasta "Aplicar a pedido"). (`calc.js`)
  **Importante — lo que NO se tocó, a propósito:** la auditoría original
  también señaló que marcar una compra "Sí" y pulsar "Actualizar
  movimientos financieros" (`sincronizar-compras-finanzas`) crea un gasto
  real sin exigir que la cotización esté convertida. Al investigarlo se
  confirmó que esto es INTENCIONAL y correcto, no un bug: a diferencia de
  "Servicio" (una promesa de plata disponible que depende de que la venta
  se concrete), "Sí" representa dinero que YA salió de la caja de verdad
  (el texto de ayuda del propio campo lo dice: "se pagó de verdad y
  aparte") — cerrar o no la venta no deshace esa compra real. Hay una
  prueba existente (`test/smoke.mjs`, cotización "Prueba de servicio en
  producción") que depende explícitamente de este comportamiento sin
  restricción, y el flujo de "cotización escalada desde un pedido rápido"
  (que sigue en "borrador" hasta aplicarse) también lo necesita así. Se
  intentó primero bloquearlo igual que el estimado completo y se revirtió
  al descubrir que rompía ambos casos reales.

### 🟡 Decisiones de negocio pendientes (5) — no son bugs, son preguntas para el dueño

1. **¿Se puede pagar la comisión de un vendedor aunque el pedido no haya
   cobrado nada todavía?** Hoy sí se permite (solo exige que el pedido
   tenga vendedor asignado) — puede ser la política correcta (comisionar
   al cerrar la venta, no al cobrarla), pero el aviso al confirmar no
   menciona que ESE pedido en particular no ha aportado nada a la caja.
2. **¿El taller tiene derecho a descontar el IVA que él mismo paga al
   comprar insumos (crédito fiscal)?** Hoy el KPI "IVA cobrado" muestra
   el IVA cobrado BRUTO como si fuera el pasivo completo a girar a la
   DIAN. Si el régimen tributario del taller permite descontar el IVA de
   sus propias compras, lo que realmente hay que girar es menor. Esto es
   estrictamente una pregunta para un contador, no algo que se deba
   decidir en código.
3. **Un pedido pagado 100% de contado reconoce toda la "Ganancia" el
   mismo día**, aunque la tela se compre y la confección se pague
   semanas después — es el comportamiento normal de un sistema 100% de
   caja (sin costo diferido), y ya hay un mecanismo parecido para
   "servicios" — pero vale la pena que el dueño sepa que un mes con
   pedidos grandes prepagados puede verse más rentable de lo que en
   realidad es, y el mes en que se pagan los insumos, menos.
4. **¿El acumulado de un "servicio" cotizado en un pedido que luego se
   CANCELÓ debería seguir contando como plata disponible para pagar
   nómina?** Hoy sí sigue contando (es la única categoría de "adelante"
   que no se filtra por cancelado) — puede ser intencional (el corte ya
   se hizo, cuesta igual), pero no está confirmado.
5. **¿Debería poder asignarse el pago de un gasto fijo o de una deuda a
   un "servicio" acumulado**, igual que ya se puede con nómina y gastos
   manuales? Hoy no está disponible ahí — probablemente porque nadie lo
   ha necesitado (un arriendo rara vez sale de un servicio), pero no hay
   una decisión explícita que lo excluya a propósito.

---

## Auditoría estricta de septiembre 2026 (segunda pasada) — hallazgos

El usuario pidió una revisión "súper estricta" de TODA la lógica de
dinero, con dudas explícitas, después del incidente de la Sheet borrada y
de agregar "Colchón". Se hizo con 6 agentes en paralelo (Pedidos,
Cotizaciones, Finanzas, Servicios, Pendientes, KPIs) leyendo el código
ACTUAL desde cero — sin confiar en este documento — y cada hallazgo pasó
por un segundo agente que intentó refutarlo antes de contarlo como real.

**Lo bueno primero:** gran parte de lo ya corregido en la auditoría
original (sección de arriba) se revisó de nuevo y sigue sólido — IVA
separado de "Por cobrar"/"Por pagar", flujo de deudas, checkbox de
efectivo, cancelar vs. eliminar pedido, Colchón bien encadenado con el
resto del sistema de servicios. Pero esta pasada, más agresiva, encontró
bastante más que la vez anterior — 14 riesgos reales confirmados, la
mayoría nuevos, algunos con doble o triple confirmación independiente
(varios agentes distintos llegaron al mismo hallazgo por su cuenta, sin
verse entre sí).

### 🔴 Riesgos reales confirmados (14)

**Comisión de vendedor — el bloque más serio, 4 hallazgos relacionados.
✅ CORREGIDOS los 4 (ver "Registro de cambios" del README):**
1. **Se puede pagar la comisión de un vendedor DOS VECES**: una desde el
   pedido, otra desde la cotización que lo originó — `toggle-comision`
   (pedidos.js) y `toggle-comision-cot` (cotizaciones.js) crean/borran
   tx marcados con campos DISTINTOS (`origenComisionPedidoId` vs.
   `origenComisionCotId`) que nunca se cruzan entre sí. Encontrado de
   forma independiente por 3 de los 6 agentes. **Fix:** al convertir o
   aplicar una cotización con la comisión ya pagada, el tx real se
   re-etiqueta como del pedido; y una vez `cot.pedidoId` existe, la
   cotización deja de poder tocar esa comisión por su cuenta (botón
   reemplazado por una insignia de solo lectura + guardia en la acción).
2. **Duplicar un pedido/cotización con la comisión ya pagada la copia
   "pagada" sin ningún tx real detrás** — `duplicarCotizacionCompleta`
   limpia `compras`/`estimadoTxId` a propósito pero se olvida de
   `vendedor.estado`. La comisión de la venta nueva queda invisible en
   "Comisiones pendientes" para siempre. Encontrado 3 veces. **Fix:**
   la copia resetea `vendedor.estado`/`fechaPago` — mismo arreglo en
   `escalar-a-cotizacion` (mismo patrón, mismo riesgo).
3. **`toggle-comision-cot` mueve plata real sin pedir confirmación** —
   a diferencia de su gemela en Pedidos (que sí pregunta con el monto),
   la pastilla de Cotizaciones crea/borra el gasto al primer toque.
   **Fix:** mismo `window.confirm()` con el monto exacto que ya tenía
   `toggle-comision`.
4. **Botón "Pagar comisión" de consignación**: mismo problema, sin
   `confirm()` (de menor severidad — es un botón explícito, no una
   pastilla ambigua). **Fix:** mismo `window.confirm()`.

**Servicios (Confección, Corte, Colchón — 4 hallazgos). ✅ CORREGIDOS los 4:**
5. **Se puede dejar un servicio en negativo repitiendo el mismo nombre
   en dos filas** de "Asignar a servicio(s)" — `validarServiciosAsignados`
   valida cada fila contra un `disponible` congelado, sin sumar entre
   filas del mismo formulario. **Fix:** ahora acumula lo comprometido
   por nombre fila a fila, dentro de la misma llamada.
6. **Un servicio de una cotización "escalada" sigue contando como plata
   disponible aunque el pedido rápido que la originó ya se haya
   eliminado** — mismo patrón "truthy pero obsoleto" que el bug hermano
   ya documentado (`desincronizacion_movimientos_pedido_escalado`).
   **Fix:** `listaEntradasServicio` ahora confirma que ese pedido siga
   existiendo de verdad, no solo que el id no esté vacío.
7. **Eliminar la cotización de origen de un servicio ya gastado** deja
   `disponible` negativo en silencio (el aviso de borrado no lo
   menciona). **Fix:** se bloquea (no solo se avisa) si borrarla dejaría
   algún servicio en negativo — misma severidad que el resto de esa regla
   (`serviciosQueQuedanNegativosSiSeBorra`, nueva función en calc.js).
8. **Editar el Monto de un gasto/nómina que ya tenía "Asignar a
   servicio(s)" no revalida ni ajusta esa asignación** — plata que en
   la práctica dejó de salir de caja se queda contada como "gastada" de
   un servicio para siempre. Encontrado por 3 de los 6 agentes. **Fix:**
   `origenDeTx` ahora también bloquea Monto/Tipo cuando el movimiento
   tiene `serviciosDescuento` (mismo candado que ya protegía a
   pedido/cotización/gasto fijo/deuda).

**Compras/insumos de una cotización. ✅ CORREGIDO:**
9. **Borrar un insumo/referencia/costo global ya marcado "Sí" (comprado)
   deja una "compra fantasma"**: sigue generando/actualizando su
   movimiento en Finanzas cada vez que se pulsa "Actualizar movimientos
   financieros", y sigue inflando el costo real de la cotización — sin
   ningún botón visible para encontrarla ni borrarla. **Fix:**
   `calcCotGastosReales` ya no cuenta una compra huérfana como
   sobrecosto, y "Actualizar movimientos financieros" ahora la detecta,
   retira su movimiento (si tenía) y la limpia de la cotización —
   convierte el botón en una reconciliación de verdad, no solo un "agregar".

**Pendientes. ✅ CORREGIDOS los 3:**
10. **Bajar el número de "Cuotas" de una deuda por debajo de las ya
    pagadas** la deja saldada (saldo $0) pero nunca se mueve a
    Historial — queda fantasma en "Por pagar" y el botón "Pagar" deja
    de hacer nada, en silencio. **Fix:** `guardar-deuda-edit` ahora
    revisa si la edición la deja saldada y la mueve al historial, igual
    que `pagar-deuda`.
11. **Los pagos de nómina se identifican por el NOMBRE del empleado, no
    por un id** — renombrar a alguien (o tener dos personas con el
    mismo nombre) desconecta sus pagos históricos: la app puede volver
    a pedir un pago ya hecho. **Fix:** el tx de nómina ahora guarda
    `empleadoId`; `calcNominaPagadaEmpleado` lo usa como fuente
    principal (con el nombre como respaldo, para tx viejos).
12. **Bug de huso horario en `periodoKey()` para periodo "semanal"** —
    `calcGastoFijoPendiente`/`calcNominaPendienteEmpleado` calculan la
    semana actual con un método, y `toggle-gasto-fijo-pagado` la
    calcula con OTRO — **verificado yo mismo ejecutando el código real
    hoy, domingo 2026-09-20: los dos métodos dan semanas distintas**
    (`2026-W38` vs. `2026-W39`). Un gasto fijo semanal marcado "pagado"
    un domingo puede volver a mostrarse "pendiente" ese mismo día, y si
    alguien lo vuelve a marcar, se duplica el gasto en Finanzas.
    **Fix:** `periodoKey` construye la fecha con año/mes/día explícitos
    (hora local) en vez de parsear el string (que caía en UTC); y
    `toggle-gasto-fijo-pagado` dejó de reimplementar la lógica a mano —
    ahora llama a `periodoKey()`, una sola fuente para las dos.

**Ganancia (Resumen) — 3 hallazgos, el patrón "falta restar una
categoría más" que ya se repitió con servicios, abonos pendientes y
Colchón. ✅ CORREGIDOS los 3:**
13. **El IVA cobrado nunca se resta de "Ganancia"** — la misma pantalla
    de Resumen tiene un tile que dice "esos $X no son tuyos" (IVA
    cobrado) y, dos tarjetas más abajo, "Ganancia" los cuenta como
    utilidad. **Fix:** se resta `calcIvaCobradoTotal()`.
14. **Un pedido con servicio pendiente Y abono sin terminar de pagar
    resta la misma plata DOS VECES** de Ganancia (una vez como
    "servicio pendiente", otra como "abono pendiente" — ninguna de las
    dos funciones se excluye contra la otra). **Fix:** nueva
    `calcServiciosPorCategoriaRangoSinPedidosPendientes` — el servicio
    de un pedido que TODAVÍA no termina de pagarse ya no se resta
    aparte (su abono, que ya lo incluye, se resta una sola vez).
15. **El excedente de un sobrepago (saldo a favor del cliente) cuenta
    como Ganancia Y como obligación de "Por pagar" al mismo tiempo** —
    `calcAbonosPendientesPorPedido` descarta los pedidos sobrepagados en
    vez de restar el excedente. **Fix:** se resta
    `calcSaldosAFavorClientes()`.

Con esto, la fórmula completa de Ganancia queda:
`Balance − servicios pendientes − abonos pendientes − IVA cobrado − saldos a favor de clientes`.

*(Sí, son 15 puntos con 14 numerados arriba por agrupación temática — el
conteo real de hallazgos "riesgo_real" distintos es 14. Los 14 quedaron
corregidos en 5 rondas — ver "Registro de cambios" del README.)*

### 🟡 Dudas a confirmar y deuda técnica (no son bugs de dinero, o de bajo impacto)

- **"Colchón" y una línea real con el mismo nombre** se mezclarían en el
  mismo acumulado (requiere coincidencia exacta del nombre, poco
  probable, pero sin ninguna protección).
- **"Separar" al Colchón no tiene tope contra el Balance real** — se
  puede escribir cualquier número sin validar que esa plata exista de
  verdad en caja (a diferencia de "gastar" un servicio, que sí topa).
- **Un servicio puede mostrar "disponible" negativo** si se corrige
  `costoReal` hacia abajo después de haber gastado parte de él — no
  descuadra Balance/Ganancia (esos ya están protegidos), es solo un
  número negativo confuso en pantalla.
- **La regla de "comisión pendiente" está copiada a mano en 3-4 lugares
  distintos** de `core/calc.js` en vez de una sola función compartida —
  hoy dan el mismo resultado, pero es el mismo riesgo estructural que
  "una sola fuente por fórmula" (arriba) pide evitar.
- **`origenGastoId`** (modelo viejo de "costo real", reemplazado por
  `compras`) no tiene protección de borrado ni se limpia al eliminar su
  cotización — solo importa si todavía queda algún dato viejo de antes
  de la migración; no se pudo confirmar desde el código si existe.
- **Eliminar una cotización ya convertida en pedido** no avisa de que
  deja un pedido huérfano (`cotizacionId` apuntando a nada).
- **Pagar la comisión de un vendedor sobre un pedido casi sin cobrar** ya
  estaba identificado como pregunta de negocio (ver 🟡 de arriba) — se
  confirmó que sigue sin bloquearse, a propósito.
- **`factorPeriodo` (4 semanas/mes)** para sugerir el salario al cambiar
  el periodo de pago de alguien: aproximación ya documentada como
  intencional en el código, el usuario puede ajustar el número sugerido.

### 🔴 Hallazgo #15 — post-mortem 2026-09-20: columna insertada en medio del esquema de Movimientos. ✅ CORREGIDO

El usuario reportó, el mismo día que se cerró esta auditoría, que la
gráfica de "Ingresos y gastos" y los tiles de servicios habían
desaparecido de Resumen. Al revisar el propio arreglo `tablaMovimientos`
que el hallazgo de nómina de esta auditoría (bloque "Pendientes" arriba)
había tocado, se encontró que `empleadoId` se había agregado **en medio**
del arreglo de columnas (entre `origenColchonId` y `esInsumo`), no al
final.

**Por qué esto es grave:** `core/sheetsTabular.js` lee cada fila de la
Sheet real por POSICIÓN (`columnas[i]` ↔ `fila[i]`), nunca por el nombre
del encabezado — es la única forma de que agregar encabezados nuevos a una
pestaña vieja no obligue a reescribir toda la fila 1 a mano (ver
`asegurarPestana`). Insertar una columna en medio corre TODO lo que sigue
un puesto a la izquierda: cada movimiento YA GUARDADO en la Sheet quedaba
leyendo el dato de su columna vecina — `esInsumo` tomaba el viejo
`proveedorId`, `proveedorId` el viejo `insumoNombre`, `insumoNombre` el
viejo `cantidad`, `cantidad` el viejo `unidad` (`Number("metros")` → `0`),
`unidad` el JSON de `serviciosDescuento` como texto plano, y
`serviciosDescuento` quedaba **vacío** (columna fuera de rango) — todo
movimiento existente perdía en silencio su "asignado a servicio(s)".

**Fix:** `empleadoId` se movió al final del arreglo (única posición segura
para una columna nueva). Se agregó un test que fija el ORDEN exacto de
`COLUMNAS_MOVIMIENTOS` (`test/smoke.mjs`) — no puede detectar el bug en sí
(no hay red real en las pruebas), pero congela el contrato que lo evita: si
alguien vuelve a insertar una columna en medio, el test falla antes de
llegar a producción.

**Duda abierta para el usuario:** si esto llegó a persistir de verdad en la
Sheet (cualquier guardado — un gasto nuevo, un pago de nómina, etc. —
mientras el bug estuvo activo), los movimientos guardados en ese lapso
pueden tener `es_compra_insumo`/`proveedor_id`/`insumo_nombre`/`cantidad`/
`unidad`/`servicios_descuento` con el valor de su columna vecina. Revisar
la pestaña "Movimientos" de la Sheet real por ese periodo si algo se ve
raro en el desglose de insumos o en qué servicio quedó "gastado".

**Corrección sobre este mismo hallazgo:** el reporte original del usuario
("no veo la gráfica ni los KPI de servicios") NO lo causaba esto —
`fecha`/`tipo`/`monto` (de los que depende esa gráfica) están ANTES de la
columna insertada, sin correrse. La causa real de esa parte era otra —
ver Hallazgo #16 abajo.

### 🔴 Hallazgo #16 — post-mortem 2026-09-20: fallo silencioso al leer "Movimientos"/"Clientes" de su propia pestaña. ✅ CORREGIDO

Siguiendo el Hallazgo #15, el usuario confirmó que el fix no cambió nada
("SIGUE IGUAL") y compartió una captura de Finanzas → Historial: solo 4
movimientos, todos de agosto, con nombres de prueba ("q", "asdas",
"dasdasd", "212312") y la insignia "ORIGEN ELIMINADO"/"PEDIDO ELIMINADO".
La suma exacta de esos 4 (-$12.000 + $1.212 + $11.000 + $111) daba
**$323 — exactamente lo que mostraba el KPI "Caja actual"**. El usuario
confirmó después que la pestaña "Movimientos" de la Sheet real SÍ tiene
muchas filas de datos reales — la app simplemente no las estaba leyendo.

**Causa:** `core/store.js` (`loadAll`) lee "tx"/"clientes" en dos
niveles: primero el blob VIEJO de la pestaña "kv" (`datos.tx`, de antes
de que existiera la pestaña propia "Movimientos" — Fase 1 de la
reorganización), y DESPUÉS intenta leer su pestaña tabular real
(`TABLAS_SHEET.tx.leer()`), que si tiene éxito sobreescribe lo anterior.
Si esa segunda lectura falla (red, permisos, lo que sea) y tampoco hay un
"espejo" local (copia en este navegador de una lectura anterior exitosa
de esa pestaña puntual), el código simplemente hacía `return;` en
silencio — dejando a `state.tx` con el blob viejo de "kv", que en este
caso databa de antes de que el taller tuviera movimientos reales
registrados. Ningún aviso, ni siquiera el toast genérico de "sin
conexión" (`huboFalloDeRed` solo se marcaba cuando el espejo SÍ tenía
algo que usar).

**Fix:** ahora CUALQUIER fallo al leer "tx"/"clientes" de su pestaña
propia (con o sin espejo de respaldo) se guarda en
`state.avisoTablaSheetFallo` con el error real, y `core/dom.js` lo
muestra como una **barra fija** (no un toast de 3 segundos, a propósito
— esto puede significar que Caja/Balance están mal) con un botón
"Recargar ahora". La próxima vez que esto pase, se va a VER, con el
motivo exacto, en vez de mostrar números incompletos con total
confianza.

**Nota:** los 4 movimientos de prueba (huérfanos, con su pedido ya
eliminado) siguen contando en Caja mientras no se borren a mano con el
🗑️ de Finanzas → Historial — es el comportamiento correcto (dinero que sí
se registró no desaparece solo porque se borró el pedido, ver
`MARCAS_ORIGEN_SISTEMA` en `core/calc.js`), pero como son datos de
prueba, no reales, conviene borrarlos ahí apenas se confirme que la
lectura real ya funciona.

### 🔴 Hallazgo #17 — post-mortem 2026-09-20: la pestaña "Movimientos" se quedó corta de columnas ("exceeds grid limits"). ✅ CORREGIDO — la causa raíz real de #16

La barra fija del Hallazgo #16 reveló el error real la primera vez que se
usó: `Google Sheets API 400: Range (Movimientos!AA1:AB1) exceeds grid
limits. Max rows: 1000, max columns: 26`. Esta es la causa raíz
verdadera detrás de todo lo reportado ese día (Caja en $323, gráfica y
KPI de servicios vacíos): la pestaña "Movimientos" se creó con el tamaño
de fábrica de Google (26 columnas, A-Z), y el esquema (ver
`COLUMNAS_MOVIMIENTOS`) creció con el tiempo hasta 28. Escribir el
encabezado en la columna 27/28 (AA/AB) — algo que `asegurarPestana` hace
en CADA `leer()`/`escribir()` mientras falten encabezados por completar —
se salía de la grilla real de esa pestaña y tiraba un 400. Como esto
pasaba ANTES de siquiera pedir los datos, `leer()` fallaba entera: ni
_llegaba_ a intentar traer las filas reales, entraba directo al fallback
silencioso del Hallazgo #16 (blob viejo de "kv").

**Por qué no se vio antes:** `values.get` (lectura) es tolerante con un
rango que se sale de la grilla — devuelve lo que hay, sin error. Solo
`values.update`/`values.clear` (escritura) lo rechazan. Por eso las
LECTURAS de otras columnas parecían andar bien y el problema quedaba
escondido específicamente en el paso de "completar encabezados
faltantes", una escritura.

**Fix:** `asegurarPestana` ahora agranda la grilla de columnas (nunca las
filas — no hay evidencia de que ese límite se haya tocado, y agrandarlo
sin necesidad acerca la Sheet al límite de 10 millones de celdas de
Google sin ningún beneficio) ANTES de escribir cualquier encabezado que
se salga de su tamaño actual, vía `updateSheetProperties` (nuevo
`sheetsAgrandarColumnas` en `core/googleRest.js`). Una pestaña nueva
también nace directo con el tamaño que el esquema necesita ese día, para
no volver a repetir esto. Test que reproduce el límite REAL de Google
(un mock de fetch que rechaza cualquier escritura más allá de
`gridColumnCount` con el mismo 400 exacto) y confirma que la grilla se
agranda antes de escribir.

### 🔴 Hallazgo #18 — post-mortem 2026-09-20: corregir el nombre de un insumo lo dejaba con la insignia "Origen eliminado" sin que nada se hubiera borrado. ✅ CORREGIDO

El usuario reportó un pedido real (OP-6416) con 3 movimientos de compra
("Bordado bolsillero", "Sublimación", "Riquelme") marcados "ORIGEN
ELIMINADO" en Finanzas, insistiendo en que nada se había borrado. Tenía
razón: era un falso positivo, causado por el mismo Hallazgo #2 de esta
auditoría (filas repetidas/`sincronizar-compras-finanzas`, corregido en
la ronda de Servicios) — al agregar ahí la limpieza de compras huérfanas,
se asumió que "no hay línea con esta clave EXACTA en
`calcListaCompras`" siempre significa "se borró". Cierto para un costo
global (`clave = "global|" + su id`, estable), FALSO para un insumo o una
referencia de proveedor: su clave se arma con `nombre + unidad + tipo`
(para poder sumar el mismo insumo repetido en varias referencias, ver
`agregarInsumosDeReferencias`) — corregir el NOMBRE de un insumo ya
marcado "Sí" (una edición normal, nada se borró) cambia esa clave. Al
pulsar "Actualizar movimientos financieros", la compra real se
desconectaba de la cotización (aunque el movimiento en Finanzas seguía
vivo, ver por qué en el propio código) y `MARCAS_ORIGEN_SISTEMA` ya no
encontraba con qué respaldarla.

**Fix:** `sincronizar-compras-finanzas` solo limpia automáticamente una
compra sin línea actual cuando su clave es de un costo global
(`"global|"` — identidad estable por id). Para insumos/productos de
proveedor (clave inestable ante una edición), si no hay línea que
coincida, la compra se deja intacta — vuelve al comportamiento de antes
de esta auditoría para ese caso puntual (invisible en la tabla mientras
no se re-sincronice del todo, pero sin desconectar nada real).

**Si esto ya te pasó:** los movimientos con "Origen eliminado" que NO
hayas borrado con el 🗑️ siguen contando bien en Caja/Balance — la
insignia es solo de navegación (no se puede volver a la cotización desde
ahí), no una señal de que la plata esté mal contada. No hace falta
recrearlos.

### 🔴 Hallazgo #19 — post-mortem 2026-09-20, la causa raíz de casi todos los "Origen eliminado" viejos: 3 corrimientos de columna en la historia de "Movimientos", no solo el de hoy. ✅ CORREGIDO (lo que se puede corregir)

El usuario siguió reportando la insignia "Origen eliminado" en pedidos
reales (OP-3902 y otros) — incluida una COMISIÓN y un pago de NÓMINA, que
no tienen nada que ver con compras/insumos (Hallazgo #18). Pidió el
tooltip exacto: una compra real decía *"se generó desde la comisión de un
vendedor"*, un pago de nómina real decía *"se generó desde un aporte
nuevo al Colchón"*. Ninguno de los dos es posible por construcción — ahí
quedó claro que no era un caso más del Hallazgo #18, sino algo estructural.

**Investigación:** se reconstruyó el historial COMPLETO de
`COLUMNAS_MOVIMIENTOS` (`git log -p` sobre `core/sheetsEsquemas.js`) y
apareció el patrón — el mismo error del Hallazgo #15 (columna insertada
en medio, no al final) había pasado **dos veces más, sin detectarse**:
- **2026-09-10** (commit `7f48362`): se insertaron 5 columnas nuevas
  (`origenReembolsoId`, `origenVentaConsignacionId`,
  `origenComisionConsignacionId`, `origenCompraClave`,
  `origenDeudaIngresoId`) ANTES de columnas ya existentes
  (`origenGastoFijoPeriodo`, `origenComisionCotId`,
  `origenComisionPedidoId`, `origenGastoId`, `esInsumo`...). Todo
  movimiento escrito antes de esa fecha y no vuelto a guardar desde
  entonces quedó con sus columnas corridas — específicamente,
  `proveedorId`/`insumoNombre` de una compra real terminaron leyéndose
  como `origenComisionCotId`/`origenComisionPedidoId`.
- **2026-09-19** (commit `db6e61d`, el mismo día que se agregó
  "Colchón"): se insertó `origenColchonId` ANTES de `esInsumo` (columna
  ya existente). Todo movimiento anterior a esa fecha quedó con SUS
  columnas corridas una posición más.
- **2026-09-20** (commit `443927e`, hoy): `empleadoId` insertado igual —
  esta YA se había detectado y corregido (Hallazgo #15, commit `a8aead7`).

Osea: **tres incidentes idénticos, en fechas distintas, cada uno
corriendo las columnas para cualquier movimiento más viejo que él**. Solo
el de hoy se había detectado porque fue el que rompió la lectura
completa (Hallazgo #17). Los otros dos llevaban corrompiendo
silenciosamente `origenComisionCotId`/`origenComisionPedidoId`/
`origenColchonId` (entre otros) en movimientos viejos desde hace 10 y 1
día respectivamente, sin que nada avisara — cada uno mostraba, al azar,
una insignia "Origen eliminado" con un motivo que no tenía ningún sentido
para ese movimiento.

**Fix:** no es posible reconstruir el valor ORIGINAL perdido en esas
columnas (no hay forma de saber qué decía una celda antes del corrimiento
sin la fila cruda de ese momento exacto) — pero SÍ se puede detectar con
certeza cuándo un campo de marca es IMPOSIBLE para el `tipo` de ese
movimiento (una comisión SIEMPRE nace con `tipo: "comision"`, nunca
`"gasto"`/`"nomina"`; un aporte al Colchón SIEMPRE nace con
`tipo: "ingreso"` — ver cada punto del código donde se crean, uno por
uno). Nueva reparación automática al cargar,
`repararMarcasOrigenInconsistentes` (`core/store.js`, mismo patrón que
`repararTxHuerfanosDeCotEscalada`/`repararVendedorPerdido`): limpia
cualquier campo de marca que sea estructuralmente imposible para el tipo
de su movimiento. El movimiento no se borra ni se toca en nada más — solo
deja de mostrar una insignia falsa, y vuelve a ser un movimiento normal
(editable/borrable como cualquiera sin origen del sistema).

**Lo que este fix NO puede prometer:** si un movimiento tenía una marca
de origen LEGÍTIMA para su tipo (ej. una comisión real con
`origenComisionPedidoId`) pero el VALOR de esa columna específicamente se
corrompió con el corrimiento (apuntando a un id que ya no existe), este
fix no lo detecta — la combinación tipo/campo sigue siendo posible, solo
el dato está mal. Si después de esta ronda sigue apareciendo "Origen
eliminado" en una COMISIÓN real (no en una compra/gasto/nómina), es ese
caso — avisar para investigar aparte, con el pedido/id específico.

### 🔴 Hallazgo #20 — el pedazo que faltaba del Hallazgo #18: reconectar (no solo evitar) una compra que perdió su seguimiento. ✅ CORREGIDO

El usuario, tras la ronda de #19, dio una pista clave: **"solo pasa con
las salidas de dinero, con los ingresos no sale ese avisito"**. Correcto
— y apuntaba de vuelta al Hallazgo #18, no a un bug nuevo. El fix de #18
evita que sincronizar-compras-finanzas vuelva a desconectar una compra
por corregir el nombre de un insumo, pero **no repara las que ya se
habían desconectado antes de ese fix** — el daño de #18 ya estaba hecho
en varios pedidos reales (varias líneas por pedido: "Rib Sublimable",
"Elastico", "Domicilio", "Sublimación", "Alabama"...).

**Por qué el usuario no podía arreglarlo solo:** volver a marcar "Sí" en
la cotización no reconecta el movimiento existente — crea uno NUEVO
(`compra.txId` nace vacío), contando el mismo gasto dos veces mientras el
viejo sigue ahí "eliminado".

**Fix:** nueva reparación automática al cargar,
`repararComprasSinSeguimiento` (`core/calc.js`, junto a
`calcListaCompras` — usa esa misma función, por eso vive ahí y no en
`core/store.js` con las demás auto-reparaciones): para cada tx con
`origenCompraClave` cuyo `cot.compras` ya no tiene esa clave, revisa si
`calcListaCompras(cot)` confirma que la línea SIGUE viva de verdad. Si
sí, reconstruye la entrada de `cot.compras` apuntando al MISMO tx (mismo
id, mismo monto) — ningún movimiento nuevo. Si la línea genuinamente ya
no existe, no toca nada: se deja huérfana, que es el comportamiento
correcto.

### 🟡 Hallazgo #21 — costo global/servicio cobrado duplicado conserva el id del original (posible explicación de más casos de "Origen eliminado"). ✅ CORREGIDO EL BUG DE ORIGEN, sin confirmar aún que sea la causa del caso puntual reportado

Confirmando el Hallazgo #20 en otro pedido ("Bandera del equipo x1"), el
usuario mostró un argumento sólido: el botón "↗ Origen" SÍ funciona (el
pedido/cotización existen), la línea sigue en la lista de compras con
Estado "Sí" — y aun así la insignia "Origen eliminado" seguía apareciendo
en varios GASTOS. Se confirmó que "↗ Origen" (`origenDeTx`, chequeo
LENIENTE: solo pregunta si el pedido/cotización existen) y "Origen
eliminado" (`origenSistemaHuerfano`/`MARCAS_ORIGEN_SISTEMA`, chequeo
ESTRICTO: pregunta si `cot.compras` tiene la clave EXACTA) son dos
preguntas distintas — no es una contradicción del código, pero deja
abierta la pregunta de por qué la clave exacta no coincide si la línea
"sigue ahí".

**Bug real encontrado (no confirmado aún como la causa de este caso
puntual):** `duplicarCotizacionCompleta` (modules/cotizaciones.js) regenera
ids nuevos para `referencias`/`insumos` al duplicar una cotización (para
que la copia sea independiente del original), pero **nunca hacía lo mismo
para `costosGlobales`/`serviciosCobrados`** — un "Domicilio" o
"Sublimación" duplicado nace con el MISMO id que el original, así que su
clave en `calcListaCompras` (`"global|"` + id) es IDÉNTICA entre las dos
cotizaciones. Hoy `compras` nace vacío en la copia (ya protegido desde
antes) así que no hay contaminación cruzada inmediata, pero dos registros
que deberían ser independientes quedan compartiendo identidad — el mismo
tipo de riesgo que ya se había tapado para referencias/insumos.

**Fix:** `costosGlobales`/`serviciosCobrados` ahora también reciben un id
propio al duplicar, igual que referencias/insumos.

**Pendiente de confirmar:** no se pudo verificar todavía si "Bandera del
equipo x1" (o los pedidos anteriores con el mismo síntoma) pasaron
alguna vez por "Duplicar" — si el usuario confirma que sí, esto explica
el patrón completo; si no, sigue habiendo una causa sin identificar para
este caso puntual y hay que seguir investigando con más datos concretos
(ideal: comparar el id interno del costo global actual contra el
`origenCompraClave` guardado en el tx, algo que hoy no es visible desde
la UI).

### 🔴 Hallazgo #22 — la causa universal ("afecta a TODOS los pedidos"): el "1" de `esInsumo` leído como `origenGastoFijoPeriodo`. ✅ CORREGIDO

Con el campo/valor exacto ahora visible en el tooltip (ver el cambio de
arriba), el usuario reportó: `origenGastoFijoPeriodo: 1`. Eso lo explica
todo: `esInsumo: "1"` es un campo que escribe TODA compra de insumo real
(`sincronizar-compras-finanzas`), sin excepción — con el corrimiento de
columnas del 2026-09-10 (ver Hallazgo #19), ese "1" quedó leyéndose
exactamente en la posición de `origenGastoFijoPeriodo`. El Hallazgo #19
no lo detectaba porque su chequeo es por `tipo` de tx, y "gasto" SÍ es un
tipo válido para `origenGastoFijoPeriodo` (un gasto fijo real también es
"gasto") — la combinación tipo/campo es posible, solo el VALOR es
imposible.

**Fix:** chequeo adicional, más preciso que por tipo:
`origenGastoFijoPeriodo` SIEMPRE se escribe como
`"<id del gasto fijo>|<periodo>"` (ver `toggle-gasto-fijo-pagado`,
modules/pendientes.js) — cualquier valor sin `"|"` es estructuralmente
imposible sea cual sea el tipo del tx, así que se limpia igual.
`repararMarcasOrigenInconsistentes` (core/store.js) ahora hace las dos
pasadas: por tipo (Hallazgo #19) y por forma (esta).

**Por qué "afecta a todos los pedidos":** exactamente porque `esInsumo`
es el campo MÁS UNIVERSAL de todos los que se corrieron — toda compra
real lo escribe, a diferencia de un insumo renombrado (Hallazgo #18, caso
puntual) o una cotización duplicada (Hallazgo #21, caso puntual). Esta es
la explicación que faltaba para el alcance total del problema.

### ✅ Confirmado que "quitar relleno" del Colchón SÍ es intencional

Un hallazgo dudaba de que borrar un relleno "aporte" no pase por la
Papelera de movimientos (a diferencia de "Eliminar" en Finanzas). Se
verificó que es el MISMO patrón que ya usan 10+ acciones de "deshacer en
el origen" (deshacer pago de deuda, comisión, gasto fijo aplicado...) —
el tx del Colchón está protegido en `MARCAS_ORIGEN_SISTEMA` justo para
forzar que se deshaga desde ahí. No hace falta ningún cambio.

### 🔴 Hallazgo #23 — un costo real de $0 escrito a propósito no contaba como ahorro (0 es falsy). ✅ CORREGIDO

Reportado en producción 2026-09-21: el usuario marcó "Domicilio" ($10.000
estimado) y "Rib Sublimable" ($1.500 estimado) como pagados ("Sí") con
costo real **$0** — de verdad no costaron nada esta vez — y preguntó por
qué la Ganancia real no reflejaba ese ahorro. Con otras dos líneas de la
misma cotización con costo real positivo (una variación de solo +$160 en
total), la app mostraba Costo total real $44.580 (ahorro de apenas $160)
en vez de los $33.080 que le tocaban (ahorro de $11.660: los $11.500 de
Domicilio+Rib que de verdad no se gastaron, más la variación de $160 de
las demás).

**Causa:** `calcCotGastosReales` (core/calc.js) excluía una línea de la
variación con `!num(c.costoReal)` — como `0` es *falsy* en JavaScript, un
costo real escrito a propósito en $0 se trataba EXACTAMENTE igual que un
costo real que nunca se escribió (dato viejo, de antes de que "Sí"
autorellenara con el estimado). El primer caso es un ahorro real de 100%
de esa línea; el segundo no es dato y debe ignorarse — la comparación
falsy no podía distinguirlos. Mismo patrón (0 vs. "nunca se escribió") ya
identificado y corregido en `calcResumenCompras`, en el mismo archivo,
pero que se había quedado sin aplicar acá.

**Fix:** cambiar el chequeo a explícito —
`c.costoReal !== "" && c.costoReal !== undefined && c.costoReal !== null`
— igual que ya hace `calcResumenCompras`. Una compra vieja sin `costoReal`
en absoluto (legado `comprado: true`, sin el campo) sigue ignorándose
correctamente; una con `costoReal: 0` escrito ahora sí cuenta como el
ahorro completo frente al estimado.

**Por qué importa tanto:** esta es la MISMA clase de bug que ya generó
varias rondas de esta auditoría (un valor legítimo tratado como "vacío"
por accidente de JavaScript) — pero acá, a diferencia de los hallazgos de
"Origen eliminado", el efecto es que la Ganancia real se queda CORTA, no
que aparezca un aviso falso. Un usuario que confía en la cifra de Ganancia
real para decidir precios o comisiones estaba viendo un número
sistemáticamente más bajo de lo real cada vez que algo terminaba costando
$0 de lo presupuestado.

### 🟡 Hallazgo #24 — el reporte de Pedidos mostraba costo/ganancia ESTIMADOS para siempre, nunca reales. ✅ CORREGIDO (decisión de diseño, no un bug de cálculo)

Al investigar el Hallazgo #23, se le preguntó al usuario si le preocupaba
que casos así afectaran "los montos finales de los KPI de ganancia y
demás" — la respuesta reveló algo más grande. `calcCotResultadoReal`
(el panel "Estimado vs. Real") solo se usa DENTRO de una cotización — el
reporte de Pedidos (Resumen → Reportes → tabla de pedidos, y el PDF que la
reutiliza) leía `pedido.costo`, un número que se congela al convertir la
cotización en pedido (`datosPedidoDesdeCot`) y **nunca se vuelve a tocar**,
así que el reporte mostraba para siempre el costo ESTIMADO original, sin
importar cuántas compras reales se registraran después en Producción.
Esto NO es un error de cálculo (el número que mostraba era correcto para
lo que representaba) sino un desfase de alcance: "el reporte" y "el panel
de la cotización" respondían preguntas distintas sin que nadie lo hubiera
decidido así a propósito.

**Fix:** `calcPedidosRango` (core/calc.js) ahora usa
`calcCotResultadoReal(cot).costoTotal` en vez de `pedido.costo` cuando el
pedido viene de una cotización — mismo criterio (sin comisión, sin IVA)
que ya tenía `pedido.costo`, así que es un reemplazo directo, no un nuevo
concepto. Un pedido rápido (sin cotización, sin insumos que comprar por
separado) no tiene "estimado vs. real" que comparar — se queda con su
único costo tal cual. Efecto en cascada correcto: `calcResumenPedidos`
(totales del reporte) y `calcVentasPorVendedorRango` (ganancia por
vendedor) ya suman por el campo `costo`/`ganancia` de estas mismas filas,
así que heredan el cambio sin tocarlos.

---

## Próximos pasos

Esto es un mapa, no una lista de tareas ya aprobadas. Los 9 riesgos de la
auditoría original ya se atendieron. Lo que queda es distinto: las 5
preguntas de negocio no tienen una respuesta "correcta" de código — son
para conversarlas con calma, posiblemente con un contador en el caso del
IVA de compras. Este documento sigue siendo el punto de partida para
cualquier cambio futuro que toque dinero — sigue actualizándolo cada vez
que se agregue o corrija algo de este tipo.
