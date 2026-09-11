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
| Ganancia (30 días) | `Balance − serviciosPendientes(rango) − abonosPendientes(rango)` | `modules/resumen.js:232` `renderGraficaResumen` |
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

## Próximos pasos

Esto es un mapa, no una lista de tareas ya aprobadas. Los 9 riesgos de la
auditoría original ya se atendieron. Lo que queda es distinto: las 5
preguntas de negocio no tienen una respuesta "correcta" de código — son
para conversarlas con calma, posiblemente con un contador en el caso del
IVA de compras. Este documento sigue siendo el punto de partida para
cualquier cambio futuro que toque dinero — sigue actualizándolo cada vez
que se agregue o corrija algo de este tipo.
