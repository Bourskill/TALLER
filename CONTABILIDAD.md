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

### 🟡 Hallazgo #25 — nuevo estado "Ahorro" en Compras del pedido: decidir a propósito no comprar/hacer algo, sin la rareza de "Sí" + "0". ✅ IMPLEMENTADO (mejora de UX, sobre la base ya correcta del Hallazgo #23)

Al arreglar el Hallazgo #23 (un `costoReal: 0` escrito a propósito ya
cuenta como ahorro completo), el usuario notó la incomodidad que quedaba
en el camino: para registrar "esto no se compró y fue un ahorro" había
que elegir el estado **"Sí"** (que suena a "sí se compró") y escribir
**"0"** a mano en el costo real — una combinación que se lee como una
contradicción. Propuso que "No" representara directamente "no se compró,
fue un ahorro".

**Por qué NO se le cambió el significado a "No":** "No" es el estado por
DEFECTO de toda línea, desde el momento en que se crea la cotización,
antes de que nadie decida nada — significa "todavía no sé", no "decidí no
comprarlo". Si "No" pasara a significar "ahorro confirmado", **cualquier
cotización con compras aún sin resolver empezaría a mostrar esas líneas
como ahorro ya confirmado**, inflando la Ganancia real de pedidos a medio
producir — exactamente lo opuesto al rigor que pide el usuario. Se le
preguntó explícitamente con `AskUserQuestion` y confirmó: agregar una
opción NUEVA, dejando "No" con su significado de siempre.

**Fix (decisión final del usuario: "cambia 'no' a 'aún no' (como
predeterminado) y a la nueva opcion 'ahorro'"):**
- La etiqueta visible de "No" cambia a **"Aún no"** (mismo valor interno
  `estado: "no"`, cero migración de datos — solo texto).
- Nueva opción **"Ahorro"** (`estado: "ahorro"`): al elegirla,
  `set-cot-compra` (modules/cotizaciones.js) fija `costoReal`/`cantidadReal`
  en **0 explícito** de una vez — no hace falta que el usuario escriba
  nada. La fila deja de pedir esos dos campos (se ve "—", igual que ya
  hacía "Servicio" con la cantidad).
- `calcCotGastosReales` (core/calc.js) trata "ahorro" como un caso
  aparte, ANTES del chequeo de "¿se escribió costoReal?": resta el
  estimado completo de la línea sin depender de ningún valor guardado —
  así es imposible que quede corto por cómo esté guardado `costoReal`.
- `calcResumenCompras` suma un bucket `ahorro`/`ahorrado` nuevo, separado
  de `pendientes` (una línea en "Ahorro" ya está resuelta, no pendiente).
- `sincronizarComprasFinanzasDe` no necesitó ningún cambio: ya ignoraba
  cualquier estado distinto de "si" al crear movimientos, así que "Ahorro"
  (como "Servicio") nunca genera un gasto en Finanzas — correcto, no hubo
  plata de por medio.

### 🔴 Hallazgo #26 — el aviso de "el catálogo cambió" no revisaba costos globales ni servicios cobrados. ✅ CORREGIDO

Reportado en producción 2026-09-21: "actualicé el valor de un insumo y no
se vio reflejado en cotización... guardado o no, no se actualiza el
insumo". Se descartaron una por una las explicaciones normales (insumo
escrito a mano, insumo borrado del catálogo, aviso ya descartado antes) —
el usuario confirmó que ninguna aplicaba. Se reprodujo el caso completo
con un script de prueba aislado (agregar el insumo desde el catálogo,
guardar, editar el catálogo, reabrir) y el mecanismo SÍ funcionó — hasta
que se probó la variante real: el insumo se había reclasificado como
**"Costo global del pedido"** (el ejemplo típico, "Domicilio") o **"Se
cobra aparte al cliente"**.

**Causa:** `insumoCambioDeCatalogo` (core/calc.js) es una función pura que
compara cualquier línea con `origenCatalogoId` contra el catálogo vigente
— y SÍ detecta la diferencia correctamente sea cual sea la línea. El
problema es que solo `renderRefCard` (la tabla de insumos DENTRO de una
referencia) la llamaba. `renderFilasGlobales` y `renderFilasServicios`
— las otras dos listas donde un insumo agregado del catálogo puede
terminar, sin perder su `origenCatalogoId` (ver `moverInsumoAGlobal`/
`moverInsumoAServicio`) — nunca la llamaban. El vínculo con el catálogo
seguía intacto y la comparación seguía siendo correcta; simplemente nadie
la pedía ahí.

**Fix:** `renderFilasGlobales`/`renderFilasServicios` ahora también llaman
`insumoCambioDeCatalogo` por cada línea y muestran el mismo aviso
(`renderAvisoInsumoCambio`, reutilizado tal cual). Las acciones
"actualizar-insumo-catalogo"/"descartar-aviso-insumo-cambio" se
generalizaron: sin `refId` (el caso de un costo global o servicio
cobrado), buscan la línea en `costosGlobales`/`serviciosCobrados` en vez
de en una referencia (`aplicarCambioCatalogoFueraDeReferencia`, nueva,
comparte la búsqueda entre las dos acciones).

**Lección:** el mismo patrón de "protección en un solo lugar, no en
todos los lugares equivalentes" que ya generó el incidente de
borradores (ver `[[incidente_perdida_borrador_2026-08]]` en memoria) —
esta vez con un insumo que puede vivir en 3 listas distintas de una
cotización (insumo de referencia, costo global, servicio cobrado) pero
solo UNA de ellas tenía la comparación contra el catálogo.

### 🔴 Hallazgo #27 — la causa REAL: "Aplicar plantilla"/"Aplicar producto" nunca copiaban `origenCatalogoId`. ✅ CORREGIDO

El Hallazgo #26 (arriba) fue una conclusión apresurada: se presentó como
si fuera EL caso del usuario sin que él lo hubiera confirmado — asumido
solo porque "Domicilio" (un costo global) apareció en un screenshot
anterior de esta misma conversación. El usuario corrigió esto de
inmediato ("de donde sacaste que me molestaba solo 'Domicilio'?") y no
era esa la causa.

**El hallazgo real, encontrado al buscar sistemáticamente TODOS los
sitios del código que copian un insumo desde el catálogo** (no solo el
que ya se había corregido): "Aplicar plantilla" y "Aplicar producto" —
el camino MÁS COMÚN para armar una referencia rápido, mucho más que
agregar insumos uno por uno — nunca guardaban `origenCatalogoId`. Ni
siquiera al agregar un insumo DIRECTO desde el catálogo a una plantilla o
a un producto (`confirmar-insumo-picker-plantilla`/
`confirmar-insumo-picker-producto`): el vínculo se perdía desde ahí, dos
pasos antes de llegar a la cotización.

**Fix, en los 4 sitios:**
- `confirmar-insumo-picker-plantilla` (modules/plantillas.js) y
  `confirmar-insumo-picker-producto` (modules/productos.js): ahora
  guardan `origenCatalogoId: item.id` al agregar un insumo del catálogo.
- `aplicar-plantilla`/`aplicar-producto` (modules/cotizaciones.js): ahora
  propagan `origenCatalogoId: ins.origenCatalogoId || ""` al copiar el
  insumo a la referencia.

**Reparación retroactiva:** `repararOrigenCatalogoInsumos` (core/store.js,
corre en `loadAll()`) reconstruye el vínculo perdido en TODO lo ya
guardado (plantillas, productos, y referencias de cotizaciones) — por
NOMBRE, y solo cuando ese nombre coincide con EXACTAMENTE un insumo del
catálogo. Un nombre ambiguo (dos insumos del catálogo con el mismo
nombre) se deja sin reparar a propósito: mejor no avisar que vincular al
insumo equivocado. Sin esto, el fix de código de arriba solo habría
servido para insumos agregados DE AQUÍ EN ADELANTE — todas las
plantillas/productos/cotizaciones ya creadas habrían seguido rotas para
siempre.

**Lección de proceso (la más importante de esta ronda):** al investigar
"por qué algo no pasa", no basta con encontrar UN sitio con el bug y
darlo por resuelto — hay que buscar sistemáticamente TODOS los caminos
que llegan al mismo resultado final antes de anunciar una causa. Presentar
una hipótesis razonable (pero no confirmada por el usuario) como si fuera
el diagnóstico final generó una ronda completa de trabajo real (#26)
sobre un caso que nunca se confirmó, mientras la causa de mayor impacto
—la que afecta el camino MÁS usado para construir una cotización—
seguía sin tocarse.

### 🟡 Hallazgo #28 — dos telas distintas en la misma referencia "consumían" la misma cantidad. ✅ CORREGIDO

Reportado en producción 2026-09-21: "cuando hay más de 1 tela sublimada,
la cotización está hecha para 1 tela". El campo "Consumo tela (MT)" vivía
en la REFERENCIA, no en cada insumo — `calcCostoPrenda` (core/calc.js)
usaba `ref.consumoAprox` para CUALQUIER insumo tipo "tela" de esa
referencia. Con una sola tela (el caso de siempre) esto es invisible; con
2+ telas distintas (ej. dos sublimados, cada uno con su propio diseño y
costo por metro), las dos se calculaban como si consumieran el MISMO
total completo (ej. 0.8m delantero + 0.4m mangas se calculaba como 1.2m +
1.2m, no 0.8m + 0.4m) — inflando tanto el costo real de la referencia
como la lista de compras.

**Por qué el campo quedó así originalmente:** una auditoría anterior
(memoria `ronda_seis_pedidos_2026-09`) ya había señalado la inconsistencia
de que "Cant." mostrara `insumo.cantidad` (siempre 1, sin usar) mientras
"Costo x prenda" ya usaba `consumoAprox` — el fix de ese momento fue
DESHABILITAR "Cant." y mostrar ahí mismo el consumo de la referencia, sin
prever el caso de una segunda tela distinta.

**Fix:** el consumo (metros) pasa a ser del INSUMO, no de la referencia —
`insumo.cantidad` ahora SÍ se usa para tipo "tela" (en `calcCostoPrenda` y
en `agregarInsumosDeReferencias`, que alimenta `calcListaCompras`), igual
que ya funcionaba para insumos "por prenda". El campo "Consumo tela (MT)"
de la referencia pasa a ser solo el valor de ARRANQUE para cualquier tela
nueva que se agregue (una sola tela sigue sin pedir nada extra); cada tela
queda editable por separado en su propia fila.

**Migración retroactiva (`repararConsumoTelaPorInsumo`, core/store.js):**
copia, una sola vez, el `consumoAprox`/`consumoSugerido` que esa tela YA
estaba usando hacia su propio campo — no cambia ni un peso de lo que ya
se había cotizado, solo lo hace editable por separado de ahí en adelante.
Marca cada insumo migrado (`consumoPropio: true`) para que la reparación
nunca vuelva a pisar un consumo que el usuario ya personalizó a mano.
Corre también sobre plantillas y productos del catálogo (mismo `bug`,
mismo `calcCostoUnitarioRef` compartido — ver `costoPorPrenda` en
plantillas.js y `calcTotalesProducto` en core/calc.js).

---

### 🟡 Hallazgo #29 — comprar más insumo del que un pedido necesita (mínimo del proveedor, conviene comprar de más) se contaba TODO como costo/sobrecosto del pedido. ✅ IMPLEMENTADO (feature nueva, sobre una idea del usuario)

Planteado por el usuario 2026-09-21, no como un bug sino como una
situación sin modelar: "muchas veces compro más insumos de los
necesarios... porque el proveedor vende en cantidades mínimas, porque
quiero dejar inventario disponible... o simplemente porque conviene
comprar un poco de más". Antes de este cambio, `compra.cantidadReal`/
`costoReal` (Compras del pedido) se leían tal cual como "el costo real de
ESTE pedido" en todos lados (`calcCotGastosReales`,
`calcResumenCompras`, el movimiento de Finanzas que genera
`sincronizarComprasFinanzasDe`) — comprar 15 necesitando 10 inflaba el
costo real, el sobrecosto y el gasto en Finanzas del pedido con plata que
en realidad era material disponible para otro pedido, no un sobrecosto
de este.

**Por qué NO se modeló como inventario:** la primera propuesta fue un
sistema de inventario/saldo de sobrantes por insumo — el usuario lo
rechazó explícito: "en vez de que pase a un inventario como tal que pase
a una simple compra de insumo". La app ya tiene, desde antes, un
mecanismo para exactamente esto: el checkbox "Es insumo" del formulario
de Gasto en Finanzas (`esInsumo`, con `insumoNombre`/`cantidad`/
`proveedorId`), que registra una compra de insumo suelta, sin pedido —
lo que el usuario ya usa a mano cuando compra algo sin un pedido
puntual en mente. El fix reusa ESE mecanismo en vez de crear un concepto
nuevo de inventario (ver [[reutilizar-antes-de-crear]] en memoria).

**Vínculo con el costo real, no una foto fija:** la segunda vuelta del
diseño fue del usuario también — pidió que si más tarde se corrige
cuánto se usó de verdad en el pedido (ej. por daño/desperdicio: se
creía que sobraban 5, pero 2 se dañaron y tocó usarlos), el excedente ya
registrado se AJUSTE solo, no que haya que editar dos sitios sueltos.
Por eso el excedente no es un número fijo calculado una sola vez, sino
un campo editable (`compra.cantidadExcedente`) que se vuelve a aplicar
cada vez que se sincroniza — y el movimiento de Finanzas del excedente
se ACTUALIZA (mismo id vía `excedenteTxId`), nunca se duplica.

**Fix — nuevos campos en `compra` (`cot.compras[]`):**
- `cantidadExcedente`: cuánto de lo comprado (`cantidadReal`) se separa
  como "compra de insumo" aparte. Se sugiere solo al escribir la
  cantidad total (`cantidadReal − linea.cantidadFisica`, si es
  positivo), pero es editable — nunca pisa un valor que el usuario ya
  haya escrito a mano, ni siquiera un 0 explícito (todo se usó en el
  pedido).
- `excedenteTxId`: el movimiento de Finanzas que representa ese
  excedente — mismo patrón que `txId`, pero un movimiento aparte,
  independiente del costo del pedido.

**Nuevos helpers (core/calc.js), la única puerta de ahora en adelante
para leer "cuánto le corresponde al pedido" de una compra:**
`cantidadExcedenteCompra`, `costoExcedenteCompra` (al mismo costo
unitario real de la factura, costoReal ÷ cantidadReal — nunca al
estimado), `costoRealPedido` y `cantidadRealPedido` (el neto,
descontado el excedente). `calcCotGastosReales`, `calcResumenCompras` y
`sincronizarComprasFinanzasDe` (cotizaciones.js) se migraron a usar
estos helpers en vez de leer `compra.costoReal`/`cantidadReal`
directo — el mismo criterio de "una sola fuente por fórmula" de
siempre (ver [[rigor_matematico_dinero]]).

**Dos movimientos independientes en Finanzas, no uno solo:**
`sincronizarComprasFinanzasDe` ahora gestiona el `txId` de siempre (el
costo NETO del pedido) y, aparte, el `excedenteTxId` (el excedente,
`esInsumo: "1"`, sin contar como costo de ningún pedido). Se evalúan
por separado a propósito: si TODO lo comprado resultó excedente (el
neto del pedido cae a $0), igual se registra el excedente completo — no
uno gatea al otro.

**"Deberían borrarse juntos":** corrección explícita del usuario sobre
mi primera propuesta (que dejaba el excedente huérfano si se borraba la
compra). Al desmarcar una compra o borrar su cotización, el
`excedenteTxId` se retira exactamente igual que el `txId` —
`movimientosGeneradosPorCotizacion` (la función que usa "eliminar
cotización" para no dejar movimientos sueltos) reconoce los dos ids.
También se agregó `origenCompraExcedenteClave` a `MARCAS_ORIGEN_SISTEMA`
para que ese movimiento tampoco se pueda borrar suelto desde Finanzas
sin pasar por la compra que lo originó.

**Compras conjuntas (Finanzas):** el usuario fue explícito en que el
mecanismo no debía cambiar por tratarse de varios pedidos: "tienes que
vincularlo a los 2 pedidos, ya que manejan el mismo insumo, no cambia
nada, solo se agrega otro pedido, pero el funcionamiento es el mismo".
El formulario de grupo ganó un campo "Cantidad para compra de insumo
(excedente)" que se reparte con el MISMO `repartirProporcional` que ya
reparte cantidad y costo — cada pedido participante termina con su
PROPIO `cantidadExcedente`/`excedenteTxId`, vinculado a su propia
cotización, nunca un movimiento suelto sin dueño.

Verificado end-to-end (sugerencia automática del excedente; costo/
cantidad neta correctos sin variación de precio; sobrecosto real
correcto cuando el excedente se corrige a la baja; el movimiento de
excedente se actualiza, nunca se duplica; los dos movimientos se
reconocen juntos para borrarse con la cotización; desmarcar una compra
retira los dos; el reparto proporcional en Compras conjuntas) antes de
avisarle al usuario.

---

### 🟡 Hallazgo #30 — una referencia comprada a proveedor no podía llevar insumos ni mano de obra adicionales sobre la compra. ✅ IMPLEMENTADO (feature nueva)

Planteado por el usuario 2026-09-21: "cuando en la cotización necesito
agregar 2 productos de distinta marca y de distinta operación (1
producto se hace en el taller y el otro es de proveedor)... si compro la
camiseta hecha a un proveedor pero de todas maneras necesito agregar un
insumo como lo es el DTF me gustaría la posibilidad de poder
agregárselo, también la mano de obra como lo son las planchadas". Antes,
una referencia con `origen: "proveedor"` no tenía NINGUNA tabla de
insumos: `agregarInsumosDeReferencias` (alimenta la lista de compras) y
`calcCostoUnitarioRef` (el costo/margen de la referencia) ignoraban
`ref.insumos` por completo para ese origen — el formulario ni siquiera
la mostraba. Cualquier insumo o mano de obra extra sobre una prenda
comprada hecha (DTF, planchada, bordado) no tenía dónde registrarse: se
perdía del costo real sin que nadie se diera cuenta.

**Fix — se reusa, no se duplica, la tabla de insumos que ya existe para
"se fabrica en el taller":** se extrajo a `renderTablaInsumosRef(cotId,
ref, permitirRecetas)` (modules/cotizaciones.js) — misma tabla, mismos
pickers ("Insumos predeterminados…", "+ Insumo personalizado"), ahora
compartida entre los dos orígenes. La única diferencia real entre
"taller" y "proveedor" son los DOS atajos que no tienen sentido sobre
algo ya comprado hecho: "Aplicar plantilla"/"Aplicar producto"
(`permitirRecetas=false` para proveedor) reemplazan la RECETA COMPLETA
de una prenda fabricada desde cero, y el campo "Consumo tela (MT)" de
la referencia (ya condicionado a `!esProveedor` desde antes) no aplica
porque no hay nada que cortar.

**`calcCostoUnitarioRef`:** para `origen === "proveedor"` ahora es
`costoCompra + suma(insumos)`, no solo `costoCompra` — el insumo/mano
de obra extra se SUMA al precio de compra, nunca lo reemplaza.
`agregarInsumosDeReferencias` (core/calc.js) ya no corta con un
`return` temprano para proveedor: sigue emitiendo la línea de la
compra al proveedor (`producto_proveedor`, como siempre) Y ADEMÁS
recorre `ref.insumos` igual que para "taller" — un insumo de tipo
normal (ej. DTF) aparece como su propia línea en "Compras del pedido",
y uno marcado como mano de obra (unidad "servicio", ej. Planchada)
entra por el mismo camino que corte/confección de siempre (cuenta como
costo real, no genera movimiento instantáneo en Finanzas, se paga vía
nómina).

Verificado end-to-end (la tabla de insumos aparece para una referencia
de proveedor; "Aplicar plantilla"/"Aplicar producto" NO aparecen;
"Consumo tela (MT)" tampoco; agregar un insumo normal y uno de mano de
obra suma correctamente al costo unitario/total de la referencia; la
lista de compras trae las TRES líneas por separado — la compra al
proveedor, el insumo y la mano de obra) antes de avisarle al usuario.

**Seguimiento (mismo día):** al ver el fix en producción, el usuario
reportó dos cosas más:
1. El resumen "📦 Se compra hecha..." seguía diciendo literalmente "sin
   insumos ni fases de producción" — texto desactualizado que se quedó
   sin tocar al agregar la tabla de insumos justo debajo, contradiciendo
   lo que el usuario veía en pantalla. Corregido.
2. Dos campos redundantes en el formulario de una referencia de
   proveedor: **"Entrega esperada"** por referencia duplicaba la "Fecha
   de entrega" general de la cotización (`cot.fechaEntrega`, la que usa
   Resumen para "próximas entregas" y el PDF) — se QUITÓ del todo (con
   el usuario confirmando la contrapartida: se pierde poder tener fechas
   distintas por proveedor si algún día se compra a varios a la vez, y
   aceptó ese costo). Y **"Costo x prenda"** (el indicador de abajo)
   podía leerse como si repitiera "Costo de compra x1" (el campo de
   arriba) — no es que sean redundantes (uno es lo que escribes, el otro
   es compra + insumos extra), sino que sin insumos extra SÍ son el
   mismo número y no se explicaba la diferencia; ahora "Costo x prenda"
   muestra un desglose ("$20.000 de la compra + $5.000 de insumos/mano
   de obra extra sobre ella") cuando hay algo que sumar, en vez de lucir
   como un duplicado sin contexto.

---

### 🟡 Hallazgo #31 — se eliminó el interruptor "se fabrica en el taller / se compra a proveedor": una prenda comprada hecha ahora es un insumo más. ✅ IMPLEMENTADO (simplificación de fondo, sobre la base del Hallazgo #30)

El mismo día del Hallazgo #30, el usuario fue un paso más allá: "creo que
es mejor eliminar la pestaña 'se compra a proveedor' y dejar... la
camiseta como insumo y ahí decidir si se le agregan más cosas o no
(insumos o procesos), para simplificar el proceso — y quitar 'consumo de
tela (mt)', dejarlo en el insumo así como ya se está haciendo". En vez de
seguir tratando "prenda comprada a proveedor" como un modo entero de la
referencia (con su propio formulario, su propio campo de costo, su propio
selector de proveedor y su propio flujo de progreso), pasa a ser un TIPO
de insumo más — "Prenda comprada a proveedor" — en la misma tabla que
tela/por prenda/fijo por referencia.

**Por qué esto es más que estética:** el interruptor `ref.origen` tocaba
CINCO sistemas distintos por separado (el formulario, el costeo, la lista
de compras, el flujo de progreso, y "Aplicar producto") — cada uno con su
propia rama `if (origen === "proveedor")`. Cada rama nueva es un lugar
más donde un caso se puede tratar distinto sin que nadie se dé cuenta
(exactamente el patrón que ya causó los Hallazgos #20/#22 con
`origenGastoFijoPeriodo`/`esInsumo`). Convertirlo en un insumo colapsa
las cinco ramas en UNA sola pregunta ("¿qué insumos tiene esta
referencia?"), resuelta por las fórmulas que YA existían para insumos.

**Fix por sistema:**
- **Formulario** (`renderRefCard`/`renderTablaInsumosRef`,
  modules/cotizaciones.js): se quitó el segmented control taller/
  proveedor, el campo "Costo de compra x1", el selector de proveedor a
  nivel de referencia y el campo "Consumo tela (MT)" — este último por
  pedido explícito del usuario ("dejarlo en el insumo así como ya se
  está haciendo": cada tela ya guarda su propio consumo desde el
  Hallazgo #28, el valor de arranque a nivel de referencia dejó de
  tener trabajo que hacer). "Aplicar plantilla"/"Aplicar producto" pasan
  a estar SIEMPRE disponibles (antes se ocultaban para "proveedor").
- **Costeo** (`calcCostoUnitarioRef`, core/calc.js): sin cambios en su
  cuerpo — sigue sumando insumos, y la rama que sumaba `costoCompra` se
  deja intacta pero ya nunca se activa para una referencia real (sigue
  viva SOLO por `calcTotalesProducto`, que costea un PRODUCTO del
  catálogo con su propio origen — un concepto aparte que no cambió, ver
  modules/productos.js).
- **Lista de compras** (`agregarInsumosDeReferencias`, core/calc.js): ya
  no tiene una rama aparte para "producto_proveedor" — un insumo tipo
  "producto_comprado" entra por el MISMO bucle que cualquier otro,
  agrupado por nombre con la clave `"producto|"+nombre` (la MISMA que ya
  usaba la referencia de proveedor vieja, a propósito — ver más abajo).
- **Flujo de progreso** (`etapasDe`, core/calc.js): decisión tomada con
  el usuario (preguntada explícitamente, con ejemplo simple): si TODOS
  los insumos de la referencia son "producto_comprado", usa el flujo
  corto Pendiente/Recibido; en cuanto tiene cualquier otro insumo (ej.
  una planchada), pasa sola al flujo normal de 5 etapas. Automático, sin
  que el usuario tenga que elegir nada.
- **"Aplicar producto"** (modules/cotizaciones.js): para un producto del
  catálogo `origen: "proveedor"`, ya NO reescribe la referencia entera
  (antes: `insumos: [], costoCompra, proveedorId, estadosDef: []`) —
  inyecta UN insumo "producto_comprado" con ese costo/proveedor y lo
  SUMA a los insumos que ya hubiera, igual que "Aplicar plantilla".

**Migración retroactiva** (`repararReferenciasProveedorAInsumo`,
core/store.js, en `loadAll()`): cada referencia que todavía tenga
`origen: "proveedor"` gana un insumo "producto_comprado" con el mismo
costo/proveedor que ya tenía, antepuesto a cualquier insumo que ya
hubiera agregado (ej. el DTF del Hallazgo #30) — no pierde nada. La
clave que genera esa línea en la lista de compras es DELIBERADAMENTE la
misma que ya usaba (`"producto|"+nombre`, no la clave normal por
nombre+unidad+tipo) para que una compra YA REGISTRADA (cantidad/costo
real, movimiento en Finanzas vinculado) siga encontrando su línea
después de migrar — sin esto, cualquier compra proveedor ya pagada en
producción habría quedado con "Origen eliminado" el día del deploy, el
mismo bug de fondo que el Hallazgo #22. Idempotente por construcción: la
migración limpia `origen` al terminar, así que nunca se repite sobre una
referencia ya convertida.

Verificado end-to-end (formulario sin interruptor ni campos viejos;
sumar camiseta comprada + DTF + mano de obra da el costo/total
correctos; la lista de compras trae las tres líneas separadas con la
clave correcta; el flujo de progreso cambia solo según los insumos;
"Aplicar producto" de un producto de proveedor SUMA en vez de
reemplazar; y — el caso más delicado — una compra YA PAGADA sobre una
referencia de proveedor vieja sigue vinculada a su movimiento real en
Finanzas después de migrar) antes de avisarle al usuario.

---

### 🟡 Hallazgo #32 — nueva funcionalidad: enlazar la cantidad de un insumo a la suma de otros (ej. "Sublimación" enlazada a "Tela"). ✅ IMPLEMENTADO

Efecto secundario real del Hallazgo #28 (consumo de tela independiente
por insumo): antes, UN solo "Consumo tela (MT)" a nivel de referencia
alimentaba sin querer todo lo que dependía de él — al independizar cada
tela, cualquier insumo relacionado (sublimación, corte) que antes se
actualizaba solo pasó a tener que corregirse a mano cada vez. El usuario
lo señaló directo: "como ya no todo depende de 1 único consumo de tela,
entonces ahora todos los valores pasan a ponerse de manera manual,
contradictorio con lo que se intenta lograr" — y pidió la funcionalidad
opuesta: poder enlazar la cantidad de un insumo a la de otros, con un
ejemplo exacto ("si tengo 1 metro de una tela y otros 2 metros de otra,
a la final voy a sublimar 3 metros").

**Mecanismo elegido — enlazar por TIPO, no insumo por insumo:** en vez
de elegir a mano cuáles insumos sumar (se rompe solo en cuanto se agrega
un tercero y se olvida marcarlo), la regla es "suma la cantidad de TODOS
los insumos de un tipo elegido, en esta misma referencia/plantilla/
producto". Así un insumo nuevo del mismo tipo se suma solo, sin volver a
configurar nada. Confirmado con el usuario antes de construir.

**`insumo.enlaceTipo`** (nuevo campo, "" = sin enlazar): guarda el tipo
elegido (`tela`, `por_prenda` o `producto_comprado` — ver
`TIPOS_ENLAZABLES`, `core/constants.js`; `fijo_pedido` queda afuera
porque su costo no depende de ninguna cantidad propia, y `global`/
`servicio_cobrado` ni viven en los insumos de una referencia).

**`cantidadEfectivaInsumo(insumo, contenedor)`** (core/calc.js): la
ÚNICA fuente de "cuánto vale de verdad la cantidad de este insumo" de
aquí en adelante — la manual, o la suma de sus insumos de origen si está
enlazado. NUNCA se guarda el resultado: se recalcula siempre a partir de
los insumos actuales del contenedor (`.insumos`, sirve igual para una
referencia, una plantilla o un producto), así que nunca puede quedar
desincronizado — mismo criterio de "una sola fuente por fórmula" de
siempre (ver [[rigor_matematico_dinero]]). `calcCostoPrenda` y la
`cantidadFisica` de `agregarInsumosDeReferencias` (lista de compras) se
migraron a usarla en vez de leer `insumo.cantidad` directo. A propósito
NO resuelve el enlace de los insumos de origen de forma recursiva (suma
su cantidad cruda) — evita cualquier riesgo de ciclo sin necesitar
detección de ciclos; el alcance de v1 es un solo nivel, que cubre los
casos reales pedidos.

**Predefinición (Catálogo → Insumos) + aplicación (Cotizaciones,
Plantillas, Productos):** el usuario pidió expresamente que "Sublimación
pudiera detectar la categoría 'tela' del insumo y automáticamente hacer
el enlace" y que la columna "Enlace" existiera en los cuatro lugares
donde vive un insumo (confirmado explícitamente que también en
Plantillas y Productos, no solo Insumos/Cotización). Un insumo del
catálogo con `enlaceTipo` predefinido lo trae puesto al copiarse a
cualquiera de los tres (mismo patrón que `esServicio`/
`origenCatalogoId`) — no hay que configurarlo cada vez que se usa.

**UX del campo "Cant.":** un insumo enlazado deja de ser editable — se
ve como un valor calculado (🔗 + el total), con un tooltip que explica
de dónde sale la suma, para que enlazar no se sienta como una caja
negra. Al DESenlazar, se congela la última cantidad calculada en el
campo manual (en vez de saltar al valor viejo que tenía guardado desde
antes de enlazarse, que nunca se actualizó mientras estuvo enlazado) —
así la corrección no cambia el costo de golpe sin que nadie lo pida.

Verificado end-to-end (el cálculo puro suma correctamente y excluye al
insumo de sí mismo; el flujo completo en una cotización, incluyendo que
corregir una tela actualiza SOLA el costo del insumo enlazado sin tocar
su fila, que la lista de compras usa la cantidad enlazada y que
desenlazar congela el valor en vez de saltar a uno viejo; la
predefinición desde el Catálogo se hereda al agregar el insumo; y que
Plantillas y Productos también soportan enlazar y su costeo lo refleja)
antes de avisarle al usuario.

**Corrección el mismo día — el mecanismo de arriba (enlazar por TIPO de
costo) era el equivocado:** el usuario lo señaló directo apenas lo vio
en producción: "el desplegable de enlace está mal, porque me salen
'tipos de costos'... lo que quiero enlazar son cantidades". Confundí
`insumo.tipo` (tela/por_prenda/producto_comprado — la fórmula de
costeo) con lo que el usuario había pedido desde el principio: la
CATEGORÍA del catálogo (ej. "Telas", con sus subcategorías) o un
insumo PUNTUAL elegido a mano, con buscador — un desplegable de un
solo valor tampoco alcanzaba, pidió poder "agregarle o quitarle
enlaces" (varios a la vez).

**Rediseño:** `insumo.enlaceTipo` (string) se reemplazó por
`insumo.enlace = { categorias: [...], insumos: [...] }` — una LISTA de
categorías del catálogo (con subcategorías incluidas, mismo criterio
que `idsConSubcategorias`) y una lista de insumos específicos
(identificados por NOMBRE normalizado, no por id — es la única forma
estable de referirse a "ese insumo puntual" a través de catálogo→
plantilla/producto→cotización, donde los ids se regeneran en cada
copia). Las dos listas se COMBINAN (unión, no modos exclusivos).
`cantidadEfectivaInsumo` se actualizó para matchear por `categoriaId`
(nuevo campo que ahora SÍ se propaga a los insumos de una referencia/
plantilla/producto, cosa que antes se evitaba a propósito) o por
nombre normalizado.

**UI:** el desplegable se reemplazó por un panel desplegable
(`renderEnlacePanel`, core/components.js) — un botón resumen ("🔗 N" /
"Sin enlace") que al abrirse muestra checkboxes de categorías
(indentadas por subcategoría) y un buscador con checkboxes de insumos
específicos. Marcar/desmarcar un checkbox ES la forma de "agregar o
quitar" un enlace — sin necesitar una lista de chips aparte. En
Catálogo/Plantillas/Productos el buscador filtra OTROS insumos del
catálogo (predefiniendo una regla que se resuelve por nombre más
adelante); en Cotización filtra los insumos que YA están en esa misma
referencia — son los únicos que de verdad tienen una cantidad que
sumar ahí. Estado de UI (panel abierto, texto del buscador) vive en
`state.enlacePanelAbierto`/`enlaceBusqueda`, transversal a los 4
módulos (acciones genéricas en `coreActions`, core/dom.js) porque no
depende de dónde vive el insumo.

Reverificado end-to-end con el nuevo mecanismo (categoría + subcategoría
se combinan correctamente; categoría + insumo específico se combinan
entre sí, no son modos exclusivos; el panel se abre/cierra, filtra por
buscador y los checkboxes reflejan el estado guardado; congelar al
desenlazar sigue funcionando, ahora quitando el ÚLTIMO checkbox
marcado) antes de avisarle al usuario por segunda vez.

---

### 🟡 Hallazgo #33 — el Enlace por categoría no sumaba en referencias viejas, y dos ajustes de UX. ✅ IMPLEMENTADO

El mismo día que se corrigió el Hallazgo #32, el usuario reportó: "en
cotización, seleccioné el insumo 'sublimación' que previamente estaba
enlazado a la categoría 'telas' y 1, no se veía esa actualización y 2,
aunque se la coloqué manualmente esta no se enlazó con los insumos que
había ahí que pertenecen a la categoría telas... no sumó las cantidades
de las telas en sublimación" — más dos pedidos de UX en el mismo
mensaje: acortar la lista de categorías del panel en Cotización, y
contraer el panel al hacer clic afuera.

**Causa raíz del bug:** `insumo.categoriaId` (el campo que
`cantidadEfectivaInsumo` usa para reconocer "estos insumos son de la
categoría Telas") solo se PROPAGA al copiar un insumo — en
`nuevoInsumo` (modules/cotizaciones.js) y las copias equivalentes de
plantillas.js/productos.js, todas del mismo día (Hallazgo #32). Un
insumo copiado ANTES de esa propagación (cualquier tela o insumo ya
agregado a una referencia en un día anterior) se quedó sin
`categoriaId` para siempre — exactamente el mismo hueco que ya se
había encontrado y corregido para `origenCatalogoId`
(`repararOrigenCatalogoInsumos`, ver el aviso de "el catálogo cambió"
más arriba), pero sin su reparación retroactiva equivalente. Con la
Tela sin `categoriaId`, un enlace por categoría armado sobre ella
—aunque el usuario lo marcara a mano, correctamente— nunca encontraba
con qué sumar: la suma daba 0 en silencio.

**Corrección — `repararCategoriaIdInsumos` (core/store.js):** mismo
patrón que `repararOrigenCatalogoInsumos`, corriendo justo después en
`loadAll()` porque se apoya en `origenCatalogoId` (ya reconstruido por
la reparación anterior si hacía falta): para cada insumo de
plantillas/productos/cotizaciones sin `categoriaId` pero con
`origenCatalogoId`, busca el insumo real del catálogo y copia su
categoría. Un insumo escrito a mano (sin `origenCatalogoId`) no se
toca — no hay con qué adivinar su categoría, mejor no reparar que
adivinar mal. Idempotente (una vez reparado, no vuelve a tocarlo).

**Ajuste de UX #1 — la lista de categorías del panel se acorta en
Cotización:** "las opciones disponibles seleccionables son los
insumos que ya hay agregados o su respectiva categoría, esto para
disminuir los elementos de la lista". Nueva función
`categoriasUsadasPorInsumos` (core/calc.js): de todo el árbol de
categorías del catálogo, deja solo las que YA usa algún insumo de la
referencia (más la categoría MADRE de cualquier subcategoría en uso,
aunque ningún insumo caiga directo en la madre — si no, el árbol, que
se arma recorriendo madres primero, la dejaría invisible). Solo se
aplica en Cotización, donde el conjunto de insumos ya es real y fijo;
Catálogo/Plantillas/Productos siguen mostrando el árbol completo
porque ahí se predefine un enlace sin saber todavía qué insumos
terminarán compartiendo referencia.

**Ajuste de UX #2 — clic afuera contrae el panel:** "que esta lista se
contraiga cuando haga click fuera de ella". Un listener de clic en
fase de CAPTURA, registrado una sola vez en core/dom.js (mismo patrón
que `listenerClicRenovacion` en core/auth.js), revisa en cada clic si
hay algún panel de Enlace abierto (`state.enlacePanelAbierto`) cuya
celda (`.enlace-celda[data-ins-celda]`) no contenga el clic — de ser
así, lo cierra. Corre en captura para enterarse ANTES de que el
`stopPropagation()` del patrón genérico de `data-action` (bindEvents)
detenga el clic; un clic DENTRO del panel (un checkbox, el buscador)
queda contenido en su celda y no lo cierra.

Verificado con una reproducción end-to-end de la causa raíz (una tela
"vieja" sin `categoriaId`, una Sublimación ya enlazada a mano —igual
que hizo el usuario— con la suma dando 0 antes de la reparación y el
valor correcto después, visible en pantalla como "🔗 N"), la lista de
categorías acortada en un panel real de Cotización, y el cierre por
clic afuera (adentro no cierra, afuera sí) — ver test/smoke.mjs.

---

### 🟡 Hallazgo #34 — el Enlace seguía sin sumar automáticamente: faltaba una forma de asignarle categoría a un insumo escrito directo en la cotización. ✅ IMPLEMENTADO

El mismo día, tras el Hallazgo #33, el usuario probó de nuevo y reportó
dos cosas más: "en el desplegable de cotización faltan las categorías"
y "sigue pasando la misma situación, pero ahora ya funciona cuando
selecciono los insumos manualmente, pero debería de funcionar
automáticamente, si sublimación ya viene enlazado a la categoría
'telas', entonces las cantidades de telas que hayan ya deberían
sumarse, a menos que manualmente yo deseleccione la categoría y
seleccione manualmente qué telas se sublimen y cuáles no". De paso,
una tercera observación: "en vez de mostrar '2' (número de insumos)
mostrar '23' (las cantidades de insumos, metros o unidades etc)".

**Causa raíz, la de fondo esta vez:** el Hallazgo #33 reparó
`categoriaId` en insumos que en algún momento SÍ vinieron del
catálogo (por `origenCatalogoId`). Pero un insumo escrito DIRECTO en
una referencia, plantilla o producto — el camino más común para una
tela que no vale la pena pre-registrar en el catálogo de Insumos — no
tiene NINGÚN campo para asignarle una categoría: a diferencia de
Catálogo (que sí tiene su columna "Categoría"), la tabla de insumos de
una referencia nunca la mostró. Sin `categoriaId`, ese insumo nunca
podía ser el DESTINO de un enlace por categoría de otro insumo, sin
importar que ese enlace ya viniera predefinido correctamente — de ahí
que "funcionara manual" (por nombre específico, que no depende de
`categoriaId`) pero no "automático" (por categoría). Y como el panel
de Cotización, desde el Hallazgo #33, solo muestra las categorías que
YA usa algún insumo de la referencia, con ningún insumo categorizado
esa lista queda vacía — el síntoma "faltan las categorías" es el mismo
problema visto desde el otro lado.

**Corrección:** nuevo selector "Este insumo pertenece a…" dentro del
propio panel de Enlace (`renderEnlacePanel`, core/components.js,
detrás de `o.propiaCategoriaAction`) — escribe directo el
`categoriaId` del insumo (`set-ins-categoria-propia` en
cotizaciones.js, `set-pla-ins-categoria-propia` en plantillas.js,
`set-pro-ins-categoria-propia` en productos.js; no se agrega en
Catálogo, que ya tiene su propia columna). Como `cantidadEfectivaInsumo`
siempre recalcula en vivo y el `enlace.categorias` de "Sublimación" no
cambia con esto, el efecto es automático en el sentido exacto que pidió
el usuario: asignarle la categoría a la tela hace que CUALQUIER insumo
ya enlazado a esa categoría la sume sola, sin tocar ese otro insumo
para nada — y si el usuario prefiere elegir a mano qué telas entran,
sigue pudiendo desmarcar la categoría en el panel de "Sublimación" y
marcar insumos específicos, sin perder esa opción.

Extraído `renderCategoriaSelectOptions` (core/components.js) del
selector de Categoría que ya existía en Catálogo/Insumos, para no
repetir el mismo árbol madre/subcategoría con `<optgroup>` dos veces
(ver [[reutilizar-antes-de-crear]]).

**Ajuste #3 — el botón de Enlace mostraba cuántas reglas había, no
cuánto sumaban:** el botón resumen (`"🔗 " + N`) usaba
`categorias.length + insumos.length` (ej. "🔗 2" por una categoría más
un insumo específico) mientras la celda "Cant." de al lado, para el
MISMO insumo, ya mostraba la suma real (ej. "🔗 7") — dos números
distintos con el mismo ícono en la misma fila. Se agregó `o.contenedor`
a `renderEnlacePanel`: cuando se pasa (Cotización/Plantillas/
Productos, donde sí hay insumos reales que sumar), el botón muestra
`cantidadEfectivaInsumo(insumo, contenedor)`, igual que la celda
"Cant.". En Catálogo (sin `contenedor`, un insumo del catálogo no tiene
hermanos con cantidad real) se sigue mostrando la cuenta de reglas,
ahora con la palabra "regla(s)" para no confundirse con una cantidad.

Verificado reproduciendo la causa raíz exacta (Sublimación ya enlazada
a "Telas", una Tela escrita directo sin categoría, suma en 0 y
categoría ausente del panel) y confirmando que asignar la categoría
SOLO desde el panel de la Tela —sin tocar Sublimación— hace aparecer
la categoría en su panel YA marcada y corrige la suma en pantalla; y
que el botón de Enlace muestra la suma real, distinta del número de
reglas, en un caso donde ambos números difieren (7 vs. 2) — ver
test/smoke.mjs.

---

### 🟡 Hallazgo #35 — el Enlace por categoría seguía sin ser automático: cada tela había que etiquetarla individualmente. ✅ IMPLEMENTADO

El mismo día, tercera vuelta sobre el Hallazgo #34, con un screenshot
real: en una referencia con Sublimación, Confección, Corte, Hilo e
hilaza, Empaque, Elástico, Montreal, Medias y Tela perforada, el
usuario abrió el panel de Sublimación, marcó "Telas" en "Este insumo
pertenece a" y también la categoría "Telas" en el panel de enlace —
pero la suma seguía en 0. Reportó: "está seleccionada la categoria
telas, pero no lee las telas que ya estan agregadas, no se si es que
no me has entendido".

**Causa raíz:** el Hallazgo #34 dio una forma de asignar categoría a
UN insumo (el selector "Este insumo pertenece a…"), pero seguía
exigiendo repetir esa asignación EN CADA insumo que se quisiera sumar
— en el ejemplo real, Corte, Elástico y Montreal (las otras 3 telas de
la referencia, ninguna categorizada) seguían invisibles para el enlace
de Sublimación aunque "Telas" ya estuviera marcada ahí. El usuario
esperaba, desde su primer mensaje de todo este hallazgo ("sublimación
poder detectar la categoría 'tela' del insumo y automáticamente hacer
el enlace"), que el reconocimiento fuera automático sin etiquetar cada
tela una por una.

**Corrección — `insumo.enlace.mismoTipo` (booleano):** una casilla
NUEVA, "Todos los insumos «Tela (según consumo)» de aquí" (el nombre
del tipo de costo se arma con `TIPOS_COSTO[insumo.tipo].label`), que
suma automáticamente CUALQUIER insumo hermano con el MISMO `tipo` que
el insumo enlazado — sin necesitar `categoriaId` en NINGÚN insumo.
Importante: esto NO revive el primer intento rechazado (un desplegable
que REEMPLAZABA categoría/insumo específico por un tipo de costo) —
acá es una casilla ADICIONAL que se COMBINA (unión) con categorías e
insumos específicos, que siguen existiendo para el caso más fino de
sumar solo ALGUNAS telas. El match es por `tipo`, no por nombre: un
insumo llamado "Tela perforada" pero con tipo "Fijo por prenda" NO se
suma, aunque su nombre sugiera lo contrario.

Se propaga igual que categorías/insumo específico: predefinible en
Catálogo, se hereda al copiar a Plantillas/Productos/Cotizaciones
(`nuevoInsumo`, `aplicar-plantilla`, `aplicar-producto`,
`confirmar-insumo-picker-plantilla/producto`); al desmarcarla (sola,
sin categorías ni insumos específicos activos) congela la última
cantidad calculada, mismo criterio que las otras dos.

Verificado reproduciendo el screenshot exacto (4 insumos tipo "tela"
en la misma referencia, un quinto cuyo NOMBRE sugiere tela pero es de
otro tipo) y confirmando que marcar la casilla en Sublimación suma las
otras 3 SIN etiquetar ninguna, que se combina con insumo
específico/categoría, que se congela al desmarcar, y que se propaga al
copiar desde el catálogo — ver test/smoke.mjs.

---

### 🟡 Hallazgo #36 — el aviso de "recuperar cambios sin guardar" salía sin fundamento al abrir una línea vacía de pedido rápido. ✅ IMPLEMENTADO

Reportado en producción 2026-09-21: "me sale mucho esto incluso sin
fundamento", con el aviso de recuperación mostrando "un pedido rápido
a medio llenar" cuando en realidad no había nada que recuperar.

**Causa raíz:** `revisarBorradoresSinGuardar()` (core/store.js) decide
si "Nuevo pedido rápido" tiene contenido que proteger con
`fpTieneContenido = !!(fp.cliente.trim() || fp.lineas.length)` — contar
`lineas.length` a secas es el error: "+ Línea libre" (ver
`add-pedido-linea-libre` en modules/pedidos.js) agrega una línea que
NACE VACÍA (sin nombre, cantidad 1 de relleno) para llenarse ahí
mismo, no es trabajo hecho todavía. Con solo abrir esa línea y no
escribir nada más, `lineas.length` ya era 1 y el formulario quedaba
marcado como "borrador sin guardar" — ese marcador se anota de
inmediato en disco (`anotarBorradoresEnDisco`, core/guardado.js), así
que sobrevivía a cambiar de pestaña o cerrar la app y disparaba el
aviso de recuperación en la siguiente visita, sin que hubiera nada
real que recuperar.

El resto de `FORMULARIOS_CON_BORRADOR` (formTx, formCliente, formGasto­Fijo…)
ya evitaba este error — todos miran contenido ESCRITO (un nombre, un
monto, trimeados), nunca si un array simplemente tiene algo adentro.
`formPedido` era el único que se salía de ese criterio.

**Corrección:** `fpTieneContenido` ahora exige que al menos una línea
tenga contenido real — un producto del catálogo elegido
(`l.productoId`), un nombre escrito a mano (`l.productoNombre`), o una
observación (`l.observacion`) — no basta con que la línea exista.
Elegir un producto del catálogo (que sí trae `productoId` desde
`select-producto-pedido-picker`) sigue contando como contenido real de
inmediato, como debe ser.

Verificado que abrir "+ Línea libre" y no escribir nada NO marca
ningún borrador (antes sí), y que escribir un nombre en esa misma
línea SÍ lo marca de inmediato — ver test/smoke.mjs.

---

### 🟢 Hallazgo #37 — pulido: redondeo de la suma de insumos enlazados y proporciones de columnas. ✅ IMPLEMENTADO

Pedido de pulido, no un bug de dinero: "en la suma de los insumos
redondearlos un poquito para que no se hagan más de 2 decimales" +
ajustar el ancho de las columnas de la tabla de insumos ("und, enlace
y cant" angostas, "costo y costo x prenda" medianas, "insumo" con
mayor protagonismo, "enlace" casi un ícono).

- `cantidadEfectivaInsumo` (core/calc.js) ahora redondea su resultado
  a 2 decimales (`redondear2`, nuevo helper en core/utils.js) — evita
  el residuo típico de sumar decimales en JS (`0.1 + 0.2 !==
  0.3`) y limita la cifra mostrada ("🔗 N") a 2 decimales aunque los
  insumos de origen tengan más. Se redondea en la ÚNICA fuente de este
  valor (no en cada sitio que lo muestra), así el número que se ve es
  EXACTAMENTE el que entra a `calcCostoPrenda` — mismo criterio de "una
  sola fuente por fórmula" de siempre.
- Columnas de la tabla de insumos reproporcionadas en los 4 módulos
  (Cotizaciones, Plantillas, Productos, Catálogo): Unidad/Enlace/Cant.
  angostas (Enlace casi solo el ícono "🔗"), Costo/Costo x prenda
  medianas, Insumo (que ya crecía con `1fr`) gana el espacio que las
  demás sueltan. De paso, en Cotizaciones se eliminó una duplicación:
  la fila de cabecera y cada fila de insumo tenían el ancho de columnas
  escrito DOS VECES a mano (una ligeramente distinta de `INS_COLS_REF`,
  sin `minmax`) — ahora las tres referencian la misma variable, para
  que no puedan volver a desalinearse entre sí.

Verificado con sumas que en JS puro dan residuo de coma flotante
(0.1 + 0.2, y una suma de 3 decimales) confirmando que el resultado
queda en exactamente 2 — ver test/smoke.mjs. Los anchos de columna son
puramente visuales (CSS), sin una prueba dedicada — no hay lógica que
verificar ahí.

---

### 🟢 Hallazgo #38 — corrección del pulido anterior: el botón de Enlace conservaba texto largo y envolvía en varias líneas. ✅ IMPLEMENTADO

El mismo día, tras el Hallazgo #37: "está horrible porque hay espacios
entre filas, debido a que la columna de enlace conservo los textos, en
vez de solo el icono+numero" — con un screenshot mostrando filas de
distinta altura porque el botón seguía diciendo "Sin enlace" (o, en
Catálogo, "N regla(s)"), y ese texto envolvía en 3-4 líneas dentro de
la columna ya angosta (46px) del Hallazgo #37.

**Causa raíz doble:** (1) el contenido del botón nunca se simplificó
al achicar la columna — seguía mostrando el texto completo ("Sin
enlace", "N regla(s)") más la flecha ▾/▸, que a esa columna nunca le
iba a caber; y (2) el botón (`.btn.small`, forms.css) usa
`padding:6px 11px` sin `white-space:nowrap`, así que CUALQUIER
contenido que no cupiera envolvía verticalmente en vez de desbordar u
opacar — y como todas las filas comparten el mismo grid, una sola fila
con texto envuelto estiraba la altura de ESA fila nada más, dejando la
tabla dispareja.

**Corrección:**
- El botón resumen (`renderEnlacePanel`, core/components.js) ahora
  muestra SOLO ícono + número: "—" cuando no hay enlace (mismo símbolo
  de "no aplica" que ya usan las celdas vecinas), "🔗 N" cuando sí —
  sin la palabra "Sin enlace", sin "regla(s)", sin la flecha ▾/▸ (el
  estado abierto/cerrado se indica con un `title` al pasar el mouse en
  vez de texto en el botón).
- Nueva clase `.enlace-toggle` (css/cotizaciones.css) con padding
  recortado, `white-space:nowrap` y `text-overflow:ellipsis` como red
  de seguridad — si una suma con muchos dígitos no cabe, trunca con
  "…" en vez de volver a envolver.
- La columna Enlace pasa de 46px a 58px (Cotizaciones, Plantillas,
  Productos, Catálogo) — margen suficiente para "🔗 108.5" con el
  padding recortado, sin dejar de ser angosta frente a las demás.

Verificado que el botón sin enlace muestra exactamente "—" y que, en
Catálogo, el botón con reglas marcadas muestra exactamente "🔗 N" (sin
la palabra "regla(s)") — ver test/smoke.mjs.

---

### 🟢 Hallazgo #39 — rediseño visual de la tabla de insumos: armonía, jerarquía y mejor uso del espacio. ✅ IMPLEMENTADO

Pedido explícito de estilo, no un bug: "no me gusta mucho la estética
de esa tabla, mejorala, metele estilo, que haya armonia, ten en cuenta
el poco espacio, una buena distribucion".

**Diagnóstico:** la tabla de insumos de Cotización/Plantillas/Productos
(`.ins-row`, css/cotizaciones.css) era la ÚNICA tabla de la app sin el
"chrome" que ya tienen las demás (comparar con `.tx-row` en
tables.css: padding lateral, esquinas redondeadas, resalte al pasar el
mouse) — borde a borde, sin aire, sin feedback de hover. De paso, el
catálogo de Insumos (`.tx-row.insumo`, catalogo.css) YA tenía un
tratamiento más refinado (nombre y costo se leen como texto plano
hasta que se interactúa, costo alineado a la derecha en monospace) que
nunca se replicó en las otras 3 tablas — la falta de "armonía" era
literal: dos estilos de tabla de insumos conviviendo en la misma app.

**Corrección — reutilizar el lenguaje visual YA probado, no inventar
uno nuevo** (ver [[reutilizar-antes-de-crear]]):
- `.ins-row` gana padding propio, esquinas redondeadas y fondo al
  pasar el mouse — MANTENIENDO el alto compacto (7px, no los 13px de
  `.tx-row`) porque acá caben muchas filas seguidas y el espacio es
  limitado (pedido explícito).
- Insumo (columna protagonista) y Costo se leen como TEXTO hasta que
  se interactúa con ellos — mismo criterio ya probado en
  `.tx-row.insumo`/`.insumo-nombre`/`.insumo-costo` de Catálogo: con
  6-8 columnas por fila, tenerlas TODAS con el mismo borde sólido se
  sentía como una pared de cajas idénticas. Insumo suma
  `font-weight:600` (se lee como el "título" de la fila); Costo queda
  monospace y alineado a la derecha.
- Cantidad y Costo x prenda (las otras dos columnas numéricas) también
  quedan alineadas a la derecha, con sus encabezados alineados igual
  (clase `ins-th-num`) — se lee como una columna de cifras comparables
  de un vistazo, no texto disperso.
- El botón de Enlace pasa de "botón fantasma" a una PASTILLA (misma
  familia visual que `.tag`/`.status-pill`/`.badge`, ver tables.css:
  "deberían leerse como una sola familia, no tres") — apagada cuando
  no hay enlace (el caso más común, no debe llamar la atención), teñida
  de acento cuando sí lo hay (clase `enlace-activo`, calculada en
  `renderEnlacePanel`), para que salte a la vista por la tabla igual
  que cualquier otro indicador de estado de la app.
- El botón "✕" de quitar una fila pasa de `.btn.danger.small` (pensado
  para acciones de página completa, con su padding normal) a
  `.ins-remove-btn`: un círculo chico, sin relleno hasta el hover — se
  siente "de bajo perfil" (quitar UNA fila) dentro de una tabla ya
  densa, en vez de competir visualmente con "Eliminar referencia".

Aplicado a los 4 módulos: Cotizaciones (`INS_COLS_REF`), Plantillas y
Productos (`INS_COLS`, misma CSS compartida vía `.ins-row`) heredan
todo automáticamente; Catálogo (`.tx-row.insumo`, con su propio CSS ya
refinado) solo suma la pastilla de Enlace y el botón "✕" circular,
que son componentes compartidos entre los 4.

Verificado que el chip de Enlace lleva la clase `enlace-activo` en
cuanto hay algo enlazado y la pierde al desenlazar — ver
test/smoke.mjs. El resto (padding, colores, alineación) es CSS puro
sin lógica que probar; no se pudo verificar visualmente en el
navegador esta ronda porque una ventana emergente de inicio de sesión
de Google, disparada por la propia app al montar la vista previa,
bloqueó la ejecución de JavaScript en el resto de la pestaña — se
revisó en su lugar reutilizando exactamente los mismos tokens/clases
ya probados visualmente en Catálogo y en el resto de la app.

**Ajuste el mismo día:** "insumo tiene mucho espacio... los textos no
llegan ni a la mitad del campo". La columna Insumo crece con `1fr`
(absorbe el espacio que las demás columnas sueltan, ver
`INS_COLS_REF`) para que la fila siga llenando el ancho completo de la
tarjeta en cualquier pantalla — en una pantalla grande eso dejaba el
campo mucho más ancho de lo que un nombre de insumo típico necesita.
Se le puso un tope al INPUT mismo (`max-width:230px`), no a la columna
del grid: así se sigue evitando el hueco al final de la fila (la
columna sigue siendo flexible) mientras el campo visible queda de un
tamaño cómodo. Cambio puramente visual, sin prueba dedicada.

### 🟢 Hallazgo #40 — cambiar de etapa de producción varias veces seguido se sentía pesado (parpadeos) y a veces mostraba "no se pudo guardar" de forma temporal. ✅ IMPLEMENTADO

El usuario reportó: "cambiar los estados de produccion parece ser una
función muy pesada, porque cuando los cambio la app se actualiza y se
pone ligeramente lenta por unos parpadeos incluso cuando hago varios
cambios a la vez me salen errores, y el botón de guardado me dice que
no se han podido guardar los cambios, aunque la notificación es
temporal porque después se pueden guardar" (2026-09-21).

**Causa raíz:** `moveEstado`/`moveEstadoRef` (modules/pedidos.js, los
manejadores de las flechas ◀ ▶ de la barra de progreso — ver
`renderProgresoEtapas` en core/components.js) llaman a `persist()` en
CADA clic sin esperar a que termine el anterior, y `guardarClave()`
(core/guardado.js) no tenía ninguna coordinación entre llamadas
concurrentes para la MISMA clave: cada clic lanzaba su propia ronda de
peticiones a la Sheet (releer revisión + escribir + sellar revisión
nueva) EN PARALELO contra la misma fila — `moveEstadoRef`, al mover
una referencia dentro de una cotización, persiste DOS claves por clic
("cotizaciones" y "pedidos"), así que un solo clic ya dispara hasta 6
peticiones de red. Encima, cada ronda dispara su propio `notificar()`
→ render completo de la app AL TERMINAR, de forma asíncrona, mucho
después del clic que la originó — con varios clics seguidos, esos
renders se apilaban y seguían llegando incluso después de que el
usuario dejara de tocar nada, lo que se sentía como parpadeos.

La causa del aviso "no se pudo guardar" temporal: con varias rondas de
red concurrentes contra la misma fila, cualquier tropiezo pasajero
(límite de tasa, una petición lenta en medio de la ráfaga) caía en el
manejo de error genérico de `guardarClave` y mostraba el aviso — que
`guardado.js` ya reintenta solo a los 15s (ver `programarReintento`),
por eso se curaba sin que el usuario hiciera nada. No era un error de
verdad: era la ráfaga de peticiones concurrentes tropezando consigo
misma.

**Corrección — agrupar (coalesce) rondas concurrentes de la misma
clave, en vez de tocar cada sitio que llama a `persist()`:**
`guardarClave()` ahora distingue dos cosas que antes iban juntas: el
espejo local (localStorage) y el aviso de "hay algo sin guardar" se
siguen anotando de inmediato en CADA llamada, sin ningún retraso — es
la red de seguridad contra un cierre a mitad de camino y no se debía
tocar. Lo que se agrupa es solo la escritura DE RED: si ya hay una
ronda en curso para esa clave, una llamada nueva no lanza la suya en
paralelo — se une a la ronda que ya está agendada justo después (o
agenda una si no la había). Como cada escritura manda el estado
COMPLETO de la clave, no un delta (ver la nota de diseño al principio
de core/guardado.js), un burst de N clics termina en, como mucho, 2
rondas de red (la que ya iba en vuelo + una más con el resultado
final), nunca N — y esa ronda final siempre lleva el estado MÁS
RECIENTE, así que ningún clic se pierde pese a agruparse.

Arreglo general en `core/guardado.js` (una sola clave a coordinar,
`guardarClave`), no en cada manejador de acción — cualquier otro sitio
de la app con el mismo patrón (varias mutaciones rápidas + `persist()`
sin esperar) queda protegido igual, sin tener que tocarlo.

Probado con una escritura de red simulada deliberadamente lenta para
forzar el solape: 3 llamadas a `persist("pedidos")` seguidas mientras
la primera seguía en curso terminan en solo 2 escrituras reales, la
última con el valor más reciente, y las 3 promesas devueltas por
`persist()` sí resuelven (nadie que haga `await persist(...)` se queda
esperando para siempre) — ver test/smoke.mjs.

### 🟢 Hallazgo #41 — Compras conjuntas ganó "Asignar a servicio(s)" + rediseño visual. ✅ IMPLEMENTADO

Pedido: "en finanzas/compras conjuntas tambien aplica la logica de
descontar de los montos de servicios" + "mejora la estetica metele
estilo, con prioridad de que sea facil de usar" (2026-09-21).

**Descontar de un servicio, en Compras conjuntas.** Ya existía en
"Registrar gasto/nómina" y en "Pagar nómina" (ver
[[asignar_servicios_gasto_nomina_2026-09]]): cubrir, total o
parcialmente, un pago con plata ya acumulada en un "servicio" (una
línea marcada así en Compras del pedido), en vez de que salga entero
de Ganancia. Compras conjuntas tenía un obstáculo estructural que los
otros dos formularios no tienen: una compra compartida no genera UN
movimiento, genera N (uno por cada pedido participante, vía
`sincronizarComprasFinanzasDe` — ver Hallazgo de "Compras conjuntas"
original), así que no hay "un solo monto" al que colgarle
`serviciosDescuento`.

**Solución — repartir el descuento con el MISMO criterio que ya reparte
todo lo demás.** `renderAsignarServicios` (componente ya existente,
`core/components.js`) se reutiliza sin cambios, validado con
`validarServiciosAsignados` contra el costo total de la compra
compartida; el resultado (`limpias`) se reparte entre los pedidos
participantes con `repartirProporcional` — la MISMA función y los
MISMOS pesos que ya reparten cantidad/costo/excedente — así que la
suma de lo descontado en los N movimientos vuelve a dar exacto el
monto asignado, sin perder ni ganar nada por el redondeo (criterio
bancario, igual que el resto de "Compras conjuntas").

`sincronizarComprasFinanzasDe` (la función compartida que crea los
movimientos) NO se tocó: sigue sin saber nada de "servicio", porque
otros caminos la usan (ej. "Actualizar movimientos financieros" de una
compra individual) sin ese concepto. En vez de eso,
`registrar-compra-conjunta` cuelga `serviciosDescuento` directo sobre
cada `tx` recién creado/actualizado, una vez resuelto su `txId` — el
descuento vive en el `tx`, igual que en gasto/nómina, no en la
sincronización.

**Único obstáculo técnico real: el borrador de esta pestaña vive
indexado por insumo** (`state.formCompraConjunta.porClave[clave]`), no
es un objeto plano como `formTx`/`formNominaPago` — y las 4 acciones
genéricas de "Asignar a servicio(s)" (`core/dom.js`) solo sabían leer
`state[formKey]` de un nivel. Se generalizó `resolverFormDestino`
(antes, acceso directo) para aceptar también un path punteado
("formCompraConjunta.porClave.<clave>"), sin cambiar nada para
`formTx`/`formNominaPago` (una sola clave sigue comportándose
idéntico) — una sola implementación sirve para los 3 formularios, no
una copia por cada uno.

**Limitación conocida, documentada a propósito:** si después de
registrar una compra conjunta con servicio asignado alguien edita el
`costoReal` de esa línea desde Cotizaciones → Producción → Compras del
pedido (posible hoy, sin relación con este cambio), el monto del `tx`
se actualiza pero `serviciosDescuento` (fijado una sola vez, al
registrar) NO se reajusta solo — mismo tipo de riesgo por el que un
gasto/nómina YA asignado a servicio no deja editar su Monto (ver
[[asignar_servicios_gasto_nomina_2026-09]]). No se extendió ese mismo
bloqueo a la edición de una compra (toca un camino de edición
compartido por TODAS las compras, no solo las conjuntas, y no fue lo
que se pidió) — queda anotado acá por si se reporta como un
descuadre real en el futuro.

**Rediseño visual de "Compras conjuntas".** Era la pestaña con menos
estética dedicada de toda la app (0 clases propias, solo genéricas +
estilos inline sueltos — confirmado por búsqueda). Nuevo
`css/finanzas.css`, reutilizando el lenguaje visual ya probado (no uno
nuevo, ver [[reutilizar-antes-de-crear]]):
- Los participantes de cada insumo compartido, antes una frase
  corrida ("OP-X (10.00 m) · OP-Y (20.00 m)"), ahora son pastillas
  sueltas (`.cc-chip`) — se leen de un vistazo cuántos y cuáles son.
- "Se reparte: OP-X → 11.00 m · $33.000 (2.00 m excedente) · OP-Y →
  ..." (una sola oración corrida, difícil de comparar) pasa a ser una
  mini-tabla (reutiliza `.tx-row`, misma grilla/hover/responsive-móvil
  que el resto de la app) con las cifras alineadas a la derecha —
  mismo criterio de la tabla de insumos rediseñada (Hallazgo #39).
- Cada tarjeta de insumo muestra cuántos pedidos participan
  (`<span class="tag">N pedidos</span>`) y gana un acento de borde
  (`.cc-grupo-listo`) en cuanto ya tiene cantidad y costo escritos —
  "esta ya está lista para registrar" sin tener que leer el resto.
- El picker de pedidos candidatos muestra cuántos van elegidos.

**Pruebas:** flujo completo en test/smoke.mjs — un segundo insumo
compartido con pesos 10/20 (mismo patrón que el insumo original), un
servicio de prueba con 50.000 acumulados, un intento de asignar más de
lo disponible (bloqueado, con el mismo aviso que gasto/nómina, sin
tocar nada) y un monto que sí cabe (30.000): confirma que el costo se
reparte 1/3-2/3 como siempre, que CADA movimiento generado lleva su
propio `serviciosDescuento` con la parte que le tocó (10.000 y
20.000, exacto el total asignado), y que `calcServiciosDisponibles()`
refleja el descuento después. La verificación visual del rediseño
(CSS puro) no se pudo completar en navegador esta ronda — la misma
ventana emergente de inicio de sesión de Google de rondas anteriores
seguía bloqueando la ejecución de JavaScript del panel; se revisó en
su lugar reutilizando clases ya probadas visualmente en otras tablas
de la app.

### 🔴 Hallazgo #42 — "cotizaciones" tocó el límite de 50.000 caracteres por celda de Google Sheets: TODO guardado de cotizaciones dejó de funcionar. ✅ IMPLEMENTADO

Reportado por el usuario 2026-09-21 con una captura del aviso real de
la app: *"No se pudieron guardar 1 cambio en la hoja de datos... Google
Sheets API 400: Tu entrada supera el número máximo de 50000 caracteres
en una misma celda."* Nada se perdió (la red de seguridad de
[[incidente_perdida_borrador_2026-08]] ya cubre esto: quedó copiado en
el espejo local y reintentándose solo) pero NINGÚN guardado de
cotizaciones podía completarse — ni crear una, ni avanzar una etapa, ni
registrar una compra — porque el tamaño que cuenta para Sheets es el
del blob COMPLETO, no el de lo que de verdad cambió.

**Causa raíz:** `state.cotizaciones` (TODAS las cotizaciones del
taller) se guardaba como UN SOLO blob JSON en UNA celda de la pestaña
"kv" — tras meses de uso real, ese blob superó el límite duro de
Google Sheets. Primera sospecha (comprobantes de pago adjuntos como
imagen incrustada en `pedidos`) descartada al confirmar con el usuario,
vía la consola del navegador, que la clave que fallaba era
"cotizaciones", no "pedidos" — ver
[[no-presentar-suposiciones-como-confirmadas]]: la sospecha inicial
tenía sentido en abstracto pero no era el caso real.

**La solución YA existía para este MISMO problema, a medias:**
`tx`/`clientes` habían pasado por exactamente esta migración antes
(ver [[auditoria_financiera_estricta_2026-09-20]]) — de un blob único a
una fila real por registro, en su propia pestaña, con columnas propias
(`core/sheetsTabular.js`/`sheetsEsquemas.js`, `TABLAS_SHEET` en
`core/store.js`). "cotizaciones" se sumó al mismo mecanismo: nuevo
`COLUMNAS_COTIZACIONES` (19 columnas — escalares como `id`/`cliente`/
`estado` como columnas planas, y lo anidado —`referencias`,
`costosGlobales`, `serviciosCobrados`, `gastosReales`, `compras`,
`iva`, `vendedor`— como columnas `{json:true}`) y `cotizaciones:
tablaCotizaciones` en `TABLAS_SHEET`. Con esto, cada cotización tiene
su PROPIO presupuesto de 50.000 caracteres, no uno compartido entre
todas — el problema confirmado (el agregado de todas) queda resuelto;
sigue existiendo la posibilidad remota de que UNA cotización sola
(cientos de tallas importadas de Excel) toque el límite ella sola, pero
eso es un caso mucho más raro que el ya ocurrido.

**El esquema de columnas se armó con una investigación exhaustiva
aparte** (un subagente dedicado a enumerar CADA campo que una
cotización puede llevar, cruzando factories de creación, sitios de
`Object.assign({}, cot, {...})`, y lecturas en calc.js/pdf.js) —
justificado porque un campo olvidado en el esquema se pierde EN
SILENCIO en cada guardado desde ese momento, el peor tipo de bug para
esta app. Confirmó, entre otras cosas, que `compras` vive en la
COTIZACIÓN (no en la referencia) y que `compra.compartida` (rastro de
"Compras conjuntas") es un campo anidado un nivel más adentro, dentro
de `compras[]` — no hace falta una columna propia para eso, ya viaja
dentro del JSON de `compras`.

Como el mecanismo de migración de `TABLAS_SHEET` YA es genérico
(`loadAll()` copia una sola vez lo que había en el blob viejo de "kv"
hacia la pestaña nueva, la primera vez que la encuentra vacía), sumar
"cotizaciones" no necesitó ningún código de migración a mano —
funcionó con el mismo mecanismo que ya movió tx/clientes.

**Dos bugs REALES (no solo de prueba) que esta migración destapó en el
mecanismo compartido, y que YA afectaban a tx/clientes en silencio
desde que se migraron (nadie los había ejercitado todavía):**

1. **El blob viejo de "kv" seguía "espejando" (sobrescribiendo la copia
   local) con datos CONGELADOS desde el momento de la migración.**
   `loadAll()` sigue leyendo el blob viejo de "kv" para cada clave de
   `TABLAS_SHEET` (como respaldo de fábrica si la pestaña propia nunca
   tuvo nada) — pero antes de este fix, también copiaba ese valor VIEJO
   al espejo local (`core/guardado.js`) en cada carga, así hubiera
   pasado tiempo desde la migración. Si la lectura de la pestaña PROPIA
   fallaba esa vez (sin red — algo que ya pasa normalmente, con
   reintento automático), el mecanismo de respaldo restauraba esa copia
   CONGELADA en vez de la más reciente de verdad — silenciosamente
   mostrando datos de antes de la migración. Fix: una clave que ya vive
   en `TABLAS_SHEET` deja de espejarse desde el blob de "kv" (`if (n
   !== "configNombreLegacy" && !TABLAS_SHEET[n]) espejar(...)`) — el
   espejo de esas claves lo mantiene SOLO su propio camino (lectura
   exitosa de su pestaña, o cualquier `persist()` exitoso o fallido).

2. **La migración de "detalle de tallas" (pedido → referencia) solo
   miraba la señal VIEJA de staleness.** El chequeo que evita migrar
   sobre una copia potencialmente vieja (`!clavesDeEspejo.cotizaciones`)
   seguía existiendo pero ya no reflejaba la fuente real de
   "cotizaciones" (que ahora es su propia pestaña, no el blob de "kv").
   Fix: se sumó `&& !tablaFallo.cotizaciones` a la condición — la señal
   de si la pestaña PROPIA de cotizaciones falló esta carga.

**Pruebas:** además de extender el esquema de columnas (con su propia
protección de orden, mismo patrón que `COLUMNAS_MOVIMIENTOS` — ver el
incidente de la columna insertada en medio, 2026-09-20), se escribió un
mock puntual y mínimo de la API de Sheets SOLO para la pestaña
"Cotizaciones" (el resto de la suite deliberadamente no mockea `fetch`
— las pruebas con sesión simulada fallan solas contra la red real, y
eso ya alcanza para probar los caminos de respaldo) para poder simular,
de verdad, "la Sheet real tiene esto guardado" en vez de depender del
blob de "kv" — necesario porque las pruebas existentes de recuperación
de borradores ("¿qué había guardado de verdad?") dejaron de poder
simularse con el truco viejo apenas cotizaciones se volvió tabular.
Ese mismo trabajo destapó los dos bugs de arriba: las pruebas de
recuperación entre dispositivos empezaron a fallar de formas que no
tenían que ver con lo que decían probar, hasta rastrear la causa hasta
el espejo clobbereado y la señal de staleness vieja.

### 🟢 Hallazgo #43 — Compras conjuntas repartía una prenda comprada entera en fracciones ("1.34 camisetas"). ✅ IMPLEMENTADO

Reportado con un caso real (2026-09-21, screenshot): 3 pedidos
necesitando 1 "Camiseta Oversize 200gr" cada uno, comprar 4 en total —
el reparto daba 1.34 / 1.33 / 1.33 unidades por pedido. "1 camiseta no
se puede dividir en decimales, corrige eso".

**Causa:** `repartirProporcional` (método del mayor residuo, cero
descuadre) recibía siempre `decimales: 2` para la cantidad, sin
importar el tipo de insumo — correcto para cantidades CONTINUAS (metros
de tela, kilos de hilo) pero sin sentido para una prenda comprada
ENTERA (`insumo.tipo === "producto_comprado"`, siempre en unidad
"UND" — ver [[referencia_sin_origen_2026-09]]), donde cada unidad es un
objeto físico indivisible.

**Fix:** `calcGruposCompraCompartida` YA devuelve `esProducto` (booleano)
en cada grupo — la señal exacta de "esto es una prenda entera, no una
cantidad continua". `renderFilaGrupoCompraConjunta` y
`registrar-compra-conjunta` (`modules/finanzas.js`) ahora calculan
`decCant = g.esProducto ? 0 : 2` y lo usan tanto para
`repartirProporcional` (cantidad Y excedente — el mismo problema
aplica a las dos) como para el `.toFixed()` de la vista previa — el
número que se ve en pantalla ANTES de registrar tiene que coincidir
exacto con lo que termina guardado. Con `decimales: 0`,
`repartirProporcional` ya reparte en ENTEROS por el mismo método de
mayor residuo (sin perder ni sobrar ninguna unidad) — no hizo falta
ninguna lógica nueva, solo dejar de forzar 2 decimales siempre.

Los campos "Cantidad total comprada"/"...(excedente)" también ganan
`step="1"` cuando el insumo es una prenda entera, como pista visual
adicional.

**Pruebas:** 3 pedidos con un insumo `producto_comprado` compartido
(1 UND cada uno), comprar 4 + 1 de excedente: confirma que el grupo
queda marcado `esProducto:true`, que la vista previa ya NO muestra
fracciones ("1.34"/"1.33"/"0.34"/"0.33"), y que tras registrar, la
cantidad Y el excedente de cada pedido son números ENTEROS
(`Number.isInteger`) que suman exacto el total comprado — el costo en
pesos, que ya funcionaba bien, se verificó sin cambios.

---

## Próximos pasos

Esto es un mapa, no una lista de tareas ya aprobadas. Los 9 riesgos de la
auditoría original ya se atendieron. Lo que queda es distinto: las 5
preguntas de negocio no tienen una respuesta "correcta" de código — son
para conversarlas con calma, posiblemente con un contador en el caso del
IVA de compras. Este documento sigue siendo el punto de partida para
cualquier cambio futuro que toque dinero — sigue actualizándolo cada vez
que se agregue o corrija algo de este tipo.
