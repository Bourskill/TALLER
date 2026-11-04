# Mapa del dinero

**Para qué sirve:** responder, sin leer código, tres preguntas sobre cada peso que toca la app: **¿quién lo crea, lo cambia o lo quita?**, **¿qué candados tiene?** y **¿cómo se deshace?**. Las tablas de las secciones 2 a 4 las escribe `tools/mapa.mjs` leyendo el código (`npm run mapa`); la sección 5 (el ciclo de vida de cada tipo de movimiento) está escrita a mano y cada afirmación cita su `archivo:línea`.

Antes de empezar, el contexto: [`ARQUITECTURA.md`](ARQUITECTURA.md) (cómo viaja un dato) y [`ESCENARIOS-DE-FALLA.md`](ESCENARIOS-DE-FALLA.md) (qué pasa si algo sale mal).

## Índice

1. [Las reglas de oro del dinero](#1-las-reglas-de-oro-del-dinero)
2. [Quién escribe movimientos (tabla completa)](#2-quién-escribe-movimientos)
3. [Las marcas de origen](#3-las-marcas-de-origen)
4. [Todas las acciones que guardan dinero](#4-todas-las-acciones-que-guardan-dinero)
5. [El ciclo de vida de cada tipo de movimiento](#5-el-ciclo-de-vida-de-cada-tipo-de-movimiento)
6. [Lo que el análisis no ve: cambios por referencia](#6-lo-que-el-análisis-no-ve-cambios-por-referencia)
7. [Lo que el cierre de mes NO bloquea](#7-lo-que-el-cierre-de-mes-no-bloquea)
8. [Cómo se comprueba que todo cuadra](#8-cómo-se-comprueba-que-todo-cuadra)

## 1. Las reglas de oro del dinero

Salen de `CONTABILIDAD.md` (principios 1 a 8). Las que más pesan para esta revisión, con dónde viven:

1. **Un movimiento (`tx`) es plata que YA se movió.** No existe un movimiento «pendiente»: lo que se debe vive en el saldo del pedido o en Pendientes. La Caja es la suma de todos, ingresos suman y lo demás resta (`js/core/calc.js:140`, signo en `:147`).
2. **Una sola fuente por fórmula.** Todo monto derivado sale de una función de `calc.js` (`redondearPesos`, `js/core/calc.js:993`; `calcIvaDeBase`, `:998`; `calcSaldoPedido`, `:1010`). Las reglas `R2` y `R3` vigilan esto.
3. **Todo movimiento que crea el sistema lleva una marca de origen** (§3) y mientras su origen exista, no se borra suelto desde Finanzas (`remove-tx`, `js/modules/finanzas.js:996`; el bloqueo está en `:1000-1007`).
4. **Un hecho de dinero se escribe en sus dos lados a la vez.** Un abono vive en el pedido (`p.abonos`) **y** en Finanzas (`tx`); `p.abono` solo se toca por `recalcularAbonoPedido` (`js/modules/pedidos.js:31`). Pero «a la vez» es en el estado en memoria: **a la hoja van en escrituras separadas** (ver `ARQUITECTURA.md` §5.1).
5. **Mes cerrado:** toda acción que escribe dinero con fecha llama a `exigirMesAbierto` **antes** de escribir (`js/core/cierre.js:78`). Regla `R1` y `R1b`.
6. **Borrar = papelera.** Un movimiento eliminado va a `txPapelera` y se puede restaurar; solo «eliminar definitivo» lo destruye (`js/modules/finanzas.js:1009-1010`, `:1035`).

## 2. Quién escribe movimientos

<!-- GENERADO:inicio sitios-tx -->

**69 sitios** escriben en `state.tx`, `state.txPapelera` o `state.transferencias`; **19** de ellos crean un movimiento nuevo en la caja (`state.tx`). Los ordena archivo y línea. «Mes cerrado» dice dónde está la guarda `exigirMesAbierto`: en la misma función, o en el camino de la acción que la llama (aproximado: el mapa ve que la guarda existe en el camino, no que cubra todas las ramas).

| Quién | Dónde | Qué hace | Marca de origen | Mes cerrado | Guarda (persist) | La llaman |
| --- | --- | --- | --- | --- | --- | --- |
| función `loadAll` | core/store.js:1250 | reemplaza la lista movimientos | — | no es una acción: corre al abrir la app | cotizaciones, pedidos, plantillasPrendas, productos, tx | carga de la app |
| función `loadAll` | core/store.js:1251 | reemplaza la lista papelera de movimientos | — | no es una acción: corre al abrir la app | cotizaciones, pedidos, plantillasPrendas, productos, tx | carga de la app |
| función `loadAll` | core/store.js:1390 | reemplaza la lista movimientos | — | no es una acción: corre al abrir la app | cotizaciones, pedidos, plantillasPrendas, productos, tx | carga de la app |
| acción `remove-cotizacion` | modules/cotizaciones.js:1673 | quita movimientos | — | sí, en la misma función (línea 1653) | cotizaciones, tx, txPapelera | — |
| acción `remove-cotizacion` | modules/cotizaciones.js:1675 | crea papelera de movimientos | — | sí, en la misma función (línea 1653) | cotizaciones, tx, txPapelera | — |
| acción `remove-cotizacion` | modules/cotizaciones.js:1683 | reemplaza la lista movimientos | — | sí, en la misma función (línea 1653) | cotizaciones, tx, txPapelera | — |
| acción `remove-cot-gasto` | modules/cotizaciones.js:2378 | quita movimientos | — | sí, en la misma función (línea 2372) | tx | — |
| acción `convertir-cotizacion` | modules/cotizaciones.js:2421 | cambia movimientos | `origenComisionPedidoId`, `origenComisionCotId` | en el camino de quien la llama (ejecutarAccionRecibo:3275) | pedidos, tx | — |
| acción `toggle-comision-cot` | modules/cotizaciones.js:2528 | crea movimientos «comision» | `origenComisionCotId` | sí, en la misma función (línea 2523) | tx | — |
| acción `toggle-comision-cot` | modules/cotizaciones.js:2539 | quita movimientos | `origenComisionCotId` | sí, en la misma función (línea 2523) | tx | — |
| acción `add-cot-estimado-movimiento` | modules/cotizaciones.js:2580 | cambia movimientos | — | sí, en la misma función (línea 2569) | tx | — |
| acción `add-cot-estimado-movimiento` | modules/cotizaciones.js:2592 | crea movimientos «gasto» | — | sí, en la misma función (línea 2569) | tx | — |
| acción `aplicar-cotizacion-a-pedido` | modules/cotizaciones.js:2774 | cambia movimientos | `origenComisionPedidoId`, `origenComisionCotId` | en el camino de quien la llama (ejecutarAccionRecibo:3275) | pedidos, tx | — |
| función `sincronizarComprasFinanzasDe` | modules/cotizaciones.js:2995 | quita movimientos | `reciboCompraId` | en el camino de quien la llama (add-cot-estimado-movimiento:2569) | quien la llama | add-cotizacion, guardar-cotizacion, set-cot-compra, sincronizar-compras-finanzas (+5) |
| función `sincronizarComprasFinanzasDe` | modules/cotizaciones.js:3058 | quita movimientos | — | en el camino de quien la llama (add-cot-estimado-movimiento:2569) | quien la llama | add-cotizacion, guardar-cotizacion, set-cot-compra, sincronizar-compras-finanzas (+5) |
| función `sincronizarComprasFinanzasDe` | modules/cotizaciones.js:3154 | crea movimientos «gasto» | `origenCompraClave` | en el camino de quien la llama (add-cot-estimado-movimiento:2569) | quien la llama | add-cotizacion, guardar-cotizacion, set-cot-compra, sincronizar-compras-finanzas (+5) |
| función `sincronizarComprasFinanzasDe` | modules/cotizaciones.js:3205 | crea movimientos «gasto» | `origenCompraExcedenteClave` | en el camino de quien la llama (add-cot-estimado-movimiento:2569) | quien la llama | add-cotizacion, guardar-cotizacion, set-cot-compra, sincronizar-compras-finanzas (+5) |
| función `sincronizarComprasFinanzasDe` | modules/cotizaciones.js:3229 | reemplaza la lista movimientos | — | en el camino de quien la llama (add-cot-estimado-movimiento:2569) | quien la llama | add-cotizacion, guardar-cotizacion, set-cot-compra, sincronizar-compras-finanzas (+5) |
| función `ejecutarAccionRecibo` | modules/cotizaciones.js:3282 | deshace (vuelve a una copia) movimientos | — | sí, en la misma función (línea 3275) | cotizaciones, tx, txPapelera | add-cotizacion, guardar-cotizacion, remove-cotizacion, sincronizar-compras-finanzas (+13) |
| función `ejecutarAccionRecibo` | modules/cotizaciones.js:3284 | deshace (vuelve a una copia) papelera de movimientos | — | sí, en la misma función (línea 3275) | cotizaciones, tx, txPapelera | add-cotizacion, guardar-cotizacion, remove-cotizacion, sincronizar-compras-finanzas (+13) |
| función `devolverRecibosAlEliminarPedido` | modules/cotizaciones.js:3330 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | remove-pedido |
| función `retomarRecibosAlRestaurarPedido` | modules/cotizaciones.js:3345 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | restaurar-pedido, reactivar-pedido |
| función `tomarDeReservaCompraConjunta` | modules/cotizaciones.js:3396 | deshace (vuelve a una copia) movimientos | — | sí, en la misma función (línea 3394) | quien la llama | set-cot-compra |
| función `llevarComprasAFinanzas` | modules/cotizaciones.js:3571 | deshace (vuelve a una copia) movimientos | — | sí, en la misma función (línea 3569) | quien la llama | add-cotizacion, guardar-cotizacion, sincronizar-compras-finanzas, remove-cot-gasto (+4) |
| función `llevarComprasAFinanzas` | modules/cotizaciones.js:3589 | reemplaza la lista movimientos | — | sí, en la misma función (línea 3569) | quien la llama | add-cotizacion, guardar-cotizacion, sincronizar-compras-finanzas, remove-cot-gasto (+4) |
| función `guardarCotizaciones` | modules/cotizaciones.js:3629 | reemplaza la lista movimientos | — | en el camino de quien la llama (add-cot-estimado-movimiento:2569) | cotizaciones, tx | add-cotizacion, guardar-cotizacion, sincronizar-compras-finanzas, remove-cot-gasto (+4) |
| acción `registrar-transferencia` | modules/cuentas.js:330 | reemplaza la lista transferencias | — | sí, en la misma función (línea 325) | transferencias | — |
| acción `toggle-anular-transferencia` | modules/cuentas.js:342 | cambia transferencias | — | sí, en la misma función (línea 340) | transferencias | — |
| acción `toggle-conciliado` | modules/cuentas.js:364 | cambia movimientos | — | **NO** | transferencias, tx | — |
| acción `toggle-conciliado` | modules/cuentas.js:368 | cambia transferencias | — | **NO** | transferencias, tx | — |
| acción `asignar-cuenta-tx` | modules/cuentas.js:401 | cambia movimientos | — | sí, en la misma función (línea 400) | tx | — |
| acción `add-tx` | modules/finanzas.js:871 | crea movimientos | — | sí, en la misma función (línea 866) | tx | — |
| acción `guardar-tx-edit` | modules/finanzas.js:916 | cambia movimientos | — | sí, en la misma función (línea 915) | tx | — |
| acción `remove-tx` | modules/finanzas.js:1009 | quita movimientos | — | sí, en la misma función (línea 1008) | tx, txPapelera | — |
| acción `remove-tx` | modules/finanzas.js:1010 | crea papelera de movimientos | — | sí, en la misma función (línea 1008) | tx, txPapelera | — |
| acción `restaurar-tx` | modules/finanzas.js:1025 | quita papelera de movimientos | — | sí, en la misma función (línea 1024) | tx, txPapelera | — |
| acción `restaurar-tx` | modules/finanzas.js:1032 | crea movimientos | — | sí, en la misma función (línea 1024) | tx, txPapelera | — |
| acción `eliminar-tx-definitivo` | modules/finanzas.js:1040 | quita papelera de movimientos | — | sí, en la misma función (línea 1038) | txPapelera | — |
| acción `registrar-recibo-compra` | modules/finanzas.js:1239 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | — |
| acción `completar-movimientos-recibo` | modules/finanzas.js:1280 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | — |
| acción `devolver-parte-recibo` | modules/finanzas.js:1311 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | — |
| función `diferenciasAlCorregir` | modules/finanzas.js:1471 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | anular-recibo, anular-corregir-recibo |
| función `diferenciasAlCorregir` | modules/finanzas.js:1563 | reemplaza la lista movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | anular-recibo, anular-corregir-recibo |
| función `anularRecibo` | modules/finanzas.js:1590 | quita movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | anular-recibo, anular-corregir-recibo |
| función `anularRecibo` | modules/finanzas.js:1592 | crea papelera de movimientos | — | en el camino de quien la llama (ejecutarAccionRecibo:3275) | quien la llama | anular-recibo, anular-corregir-recibo |
| acción `add-pedido` | modules/pedidos.js:1932 | crea movimientos «ingreso» | `origenAbonoId` | sí, en la misma función (línea 1854) | pedidos, tx | — |
| acción `registrar-venta-consignacion` | modules/pedidos.js:2024 | crea movimientos «ingreso» | `origenVentaConsignacionId` | sí, en la misma función (línea 2003) | pedidos, tx | — |
| acción `pagar-comision-consignacion` | modules/pedidos.js:2173 | crea movimientos «gasto» | `origenComisionConsignacionId` | sí, en la misma función (línea 2171) | pedidos, tx | — |
| acción `toggle-comision` | modules/pedidos.js:2363 | crea movimientos «comision» | `origenComisionPedidoId` | sí, en la misma función (línea 2358) | pedidos, tx | — |
| acción `toggle-comision` | modules/pedidos.js:2371 | quita movimientos | `origenComisionPedidoId` | sí, en la misma función (línea 2358) | pedidos, tx | — |
| acción `cobrar` | modules/pedidos.js:2397 | crea movimientos «ingreso» | `origenAbonoId` | sí, en la misma función (línea 2395) | pedidos, tx | — |
| acción `add-reembolso` | modules/pedidos.js:2439 | crea movimientos «gasto» | `origenReembolsoId` | sí, en la misma función (línea 2431) | pedidos, tx | — |
| acción `add-abono` | modules/pedidos.js:2507 | crea movimientos «ingreso» | `origenAbonoId` | sí, en la misma función (línea 2480) | pedidos, tx | — |
| acción `guardar-abono-edit` | modules/pedidos.js:2588 | cambia movimientos | `origenAbonoId` | sí, en la misma función (línea 2555) | pedidos, tx | — |
| acción `eliminar-abono` | modules/pedidos.js:2619 | quita movimientos | `origenAbonoId`, `origenReembolsoId` | sí, en la misma función (línea 2611) | pedidos, tx | — |
| acción `eliminar-venta-consignacion` | modules/pedidos.js:2641 | quita movimientos | `origenVentaConsignacionId`, `origenComisionConsignacionId` | sí, en la misma función (línea 2633) | pedidos, tx | — |
| acción `remove-pedido` | modules/pedidos.js:2702 | quita movimientos | — | sí, en la misma función (línea 2669) | pedidos, pedidosPapelera, tx, txPapelera | — |
| acción `remove-pedido` | modules/pedidos.js:2704 | crea papelera de movimientos | — | sí, en la misma función (línea 2669) | pedidos, pedidosPapelera, tx, txPapelera | — |
| acción `restaurar-pedido` | modules/pedidos.js:2754 | quita papelera de movimientos | — | sí, en la misma función (línea 2721) | pedidos, pedidosPapelera, tx, txPapelera | — |
| acción `restaurar-pedido` | modules/pedidos.js:2758 | crea movimientos | — | sí, en la misma función (línea 2721) | pedidos, pedidosPapelera, tx, txPapelera | — |
| acción `eliminar-pedido-definitivo` | modules/pedidos.js:2787 | quita papelera de movimientos | — | sí, en la misma función (línea 2778) | pedidosPapelera, txPapelera | — |
| acción `pagar-nomina` | modules/pendientes.js:671 | crea movimientos «nomina» | — | sí, en la misma función (línea 665) | tx | — |
| acción `toggle-gasto-fijo-pagado` | modules/pendientes.js:838 | crea movimientos «gasto» | `origenGastoFijoPeriodo` | sí, en la misma función (línea 811) | config, tx | — |
| acción `toggle-gasto-fijo-pagado` | modules/pendientes.js:840 | quita movimientos | `origenGastoFijoPeriodo` | sí, en la misma función (línea 811) | config, tx | — |
| acción `add-deuda` | modules/pendientes.js:876 | crea movimientos «ingreso» | `origenDeudaIngresoId` | sí, en la misma función (línea 861) | deudas, tx | — |
| acción `pagar-deuda` | modules/pendientes.js:1010 | crea movimientos «gasto» | `deudaId` | sí, en la misma función (línea 1002) | deudas, deudasHistorial, tx | — |
| acción `deshacer-pago-deuda` | modules/pendientes.js:1061 | quita movimientos | — | sí, en la misma función (línea 1054) | deudas, deudasHistorial, tx | — |
| acción `guardar-relleno-colchon` | modules/resumen.js:874 | crea movimientos «ingreso» | `origenColchonId` | sí, en la misma función (línea 867) | config, tx | — |
| acción `quitar-relleno-colchon` | modules/resumen.js:909 | quita movimientos | — | sí, en la misma función (línea 897) | config, tx | — |

<!-- GENERADO:fin sitios-tx -->

**Cómo leer la tabla.**
- Una fila es **un sitio del código** que toca `state.tx`, `state.txPapelera` o `state.transferencias`. Una misma acción puede tener varias filas (por ejemplo `remove-tx` quita de `tx` **y** agrega a la papelera).
- **Crea** = aparece un movimiento nuevo en la caja. **Quita** = desaparece de la caja (a la papelera o del todo). **Cambia** = el mismo movimiento con otros valores. **Reemplaza la lista** = se asigna una lista entera (recibos, copias de seguridad, reparaciones al cargar).
- **Marca de origen**: la que ponen (o buscan) esas líneas. En las filas que no «crean», son las marcas mencionadas en el filtro (por ejemplo `eliminar-abono` quita los movimientos con `origenAbonoId` o `origenReembolsoId` del abono que anula).
- **Mes cerrado**: dónde está la guarda. «En el camino de quien la llama» es aproximado: el mapa ve que la guarda existe en el camino de la acción, no que cubra todas las ramas. Para los **recibos** es exacto: `ejecutarAccionRecibo` compara la lista de movimientos antes y después y rechaza todo si algún cambio cae en un mes cerrado (`js/modules/cotizaciones.js:3273-3276`).
- Las filas de `loadAll` son lo que la app hace **sola al abrir** (migraciones y reparaciones, `js/core/store.js:1250-1251`, `:1343-1396`): no son una acción de una persona.

**Qué muestra esta tabla de un vistazo** (verificado contra el código):
- **19 sitios crean un movimiento nuevo** en la caja, repartidos en cinco archivos: `pedidos.js` (8: `add-pedido`, `registrar-venta-consignacion`, `pagar-comision-consignacion`, `toggle-comision`, `cobrar`, `add-reembolso`, `add-abono`, `restaurar-pedido`), `pendientes.js` (4: nómina, gasto fijo, ingreso de deuda, pago de deuda), `cotizaciones.js` (4: comisión de cotización, estimado y los dos de `sincronizarComprasFinanzasDe`), `finanzas.js` (2: `add-tx`, `restaurar-tx`) y `resumen.js` (1: aporte al Colchón).
- **De todas las acciones que guardan dinero (sección 4), una sola escribe movimientos sin guarda de mes: `toggle-conciliado`** (marca «visto en el extracto»; no cambia monto, fecha, tipo ni cuenta; está en la lista base de `R1` como excepción legítima).

## 3. Las marcas de origen

<!-- GENERADO:inicio marcas -->

| Marca (campo del movimiento) | Dónde se declara | Qué representa | Tiene columna en la hoja | Quién la pone | Cómo se deshace (lo que le dice la app al usuario) |
| --- | --- | --- | --- | --- | --- |
| `reciboCompraId` | js/core/calc.js:662 | un Recibo de compra | sí | (la crea una función auxiliar) | Finanzas → Recibos de compra → el recibo → Anular recibo (para devolver material de un pedido a la reserva, baja su Cant. real en Producción) |
| `origenAbonoId` | js/core/calc.js:667 | un abono cobrado de un pedido | sí | add-abono, add-pedido, cobrar | Pedidos → tarjeta del pedido → Dinero y documentos → Abonos registrados → Eliminar |
| `origenReembolsoId` | js/core/calc.js:675 | un reembolso hecho a un cliente | sí | add-reembolso | Pedidos → tarjeta del pedido → Dinero y documentos → Abonos registrados → Eliminar |
| `origenComisionPedidoId` | js/core/calc.js:683 | la comisión de un vendedor | sí | toggle-comision | Pedidos → tarjeta del pedido → Dinero y documentos → botón "pagada" del vendedor (vuelve a dejarla pendiente) |
| `origenComisionCotId` | js/core/calc.js:691 | la comisión de un vendedor | sí | toggle-comision-cot | Cotizaciones → la cotización → Vendedor → botón "pagada" (vuelve a dejarla pendiente) |
| `origenVentaConsignacionId` | js/core/calc.js:699 | una venta reportada por un punto de consignación | sí | registrar-venta-consignacion | Pedidos → tarjeta de la consignación → Ventas reportadas → Eliminar |
| `origenComisionConsignacionId` | js/core/calc.js:704 | la comisión de un punto de consignación | sí | pagar-comision-consignacion | Pedidos → tarjeta de la consignación → Ventas reportadas → Eliminar (borra la venta y su comisión) |
| `origenGastoFijoPeriodo` | js/core/calc.js:709 | el pago de un gasto fijo de ESTE periodo | sí | toggle-gasto-fijo-pagado | Pendientes → Gastos fijos → botón "pagado" (vuelve a dejarlo pendiente) |
| `origenCompraClave` | js/core/calc.js:727 | una compra de la lista de una cotización | sí | sincronizarComprasFinanzasDe | Cotizaciones → la cotización → Producción → desmarca "Comprado" y pulsa "Actualizar movimientos financieros" |
| `origenCompraExcedenteClave` | js/core/calc.js:735 | el excedente de una compra (compra de insumo aparte) | sí | sincronizarComprasFinanzasDe | Cotizaciones → la cotización → Producción → ajusta o quita la cantidad "Excedente" de esa compra |
| `deudaId` | js/core/calc.js:743 | el pago de una cuota de una deuda | sí | pagar-deuda | Pendientes → Deudas (o su historial, si ya quedó saldada) → botón "↩ Deshacer último pago" |
| `origenDeudaIngresoId` | js/core/calc.js:751 | la plata que entró en efectivo al registrar un préstamo/deuda | sí | add-deuda | Pendientes → Deudas → eliminar la deuda completa (el movimiento queda huérfano y se puede borrar aparte, no se borra junto con ella) |
| `origenColchonId` | js/core/calc.js:759 | un aporte nuevo al Colchón | sí | guardar-relleno-colchon | Resumen → tile "Colchón" → historial → botón ✕ de ese relleno |

<!-- GENERADO:fin marcas -->

Cómo funciona la protección: `origenSistemaDeTx` (`js/core/calc.js:781`) devuelve el origen **solo si ese origen todavía existe** (cada marca trae su comprobación `existe`, `js/core/calc.js:654-766`). Si el pedido, la cotización, el gasto fijo o la deuda ya se borró, el movimiento queda «huérfano» y se puede borrar suelto. **Dos movimientos que crea el sistema no tienen marca registrada** y por eso se pueden borrar sueltos desde Finanzas: el pago de **nómina** (`js/modules/pendientes.js:671`: lleva `empleadoId`, que no es una marca) y el **costo estimado** de una cotización (`js/modules/cotizaciones.js:2592`: la cotización guarda `estimadoTxId`). Ambos están en la lista base de la regla `R4`, con su motivo.

## 4. Todas las acciones que guardan dinero

<!-- GENERADO:inicio acciones-dinero -->

**60 acciones** guardan movimientos, transferencias, cierres, deudas o la parte de dinero de la configuración (nómina, gastos fijos, Colchón, cuentas, conciliaciones).

| Acción | Dónde | Qué hace | Toca | Mes cerrado | Mira el rol |
| --- | --- | --- | --- | --- | --- |
| `add-cotizacion` | modules/cotizaciones.js:1530 | (sin comentario) | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `guardar-cotizacion` | modules/cotizaciones.js:1554 | (sin comentario) | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `remove-cotizacion` | modules/cotizaciones.js:1637 | Eliminar SÍ guarda de una: no tendría sentido dejar "pendiente de | `cotizaciones`, `tx`, `txPapelera` | ✔ | — |
| `set-cot-compra` | modules/cotizaciones.js:2096 | Edita la compra real de UNA línea de la lista. Se guarda indexada por la | `cotizaciones`, `tx` | ✔ | — |
| `sincronizar-compras-finanzas` | modules/cotizaciones.js:2264 | Lleva a Finanzas TODO lo marcado como comprado, de una sola vez. Es | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `remove-cot-gasto` | modules/cotizaciones.js:2370 | (sin comentario) | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `convertir-cotizacion` | modules/cotizaciones.js:2381 | (sin comentario) | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `toggle-comision-cot` | modules/cotizaciones.js:2502 | Igual que toggle-comision en pedidos.js: desmarcar "pagada" revierte de | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `add-cot-estimado-movimiento` | modules/cotizaciones.js:2558 | Registra el costo total ESTIMADO de todo el pedido como un único | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `aplicar-cotizacion-a-pedido` | modules/cotizaciones.js:2716 | Cuando la cotización nace de "escalar" un pedido rápido (ver pedidos.js: | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `registrar-transferencia` | modules/cuentas.js:316 | (sin comentario) | `transferencias` | ✔ | — |
| `toggle-anular-transferencia` | modules/cuentas.js:336 | (sin comentario) | `transferencias` | ✔ | — |
| `toggle-conciliado` | modules/cuentas.js:360 | Marca o desmarca un asiento (un movimiento, o UNA punta de una | `transferencias`, `tx` | ✘ SIN guarda | — |
| `guardar-conciliacion` | modules/cuentas.js:377 | (sin comentario) | `config.conciliaciones` | · (no escribe movimientos) | — |
| `asignar-cuenta-tx` | modules/cuentas.js:395 | Cambiar la cuenta de un movimiento solo mueve plata ENTRE cuentas: el | `tx` | ✔ | — |
| `agregar-cuenta` | modules/cuentas.js:406 | (sin comentario) | `config.cuentas` | · (no escribe movimientos) | — |
| `renombrar-cuenta` | modules/cuentas.js:414 | (sin comentario) | `config.cuentas` | · (no escribe movimientos) | — |
| `quitar-cuenta` | modules/cuentas.js:422 | (sin comentario) | `config.cuentas` | · (no escribe movimientos) | — |
| `set-cuenta-predeterminada` | modules/cuentas.js:434 | (sin comentario) | `config.cuentaPredeterminada` | · (no escribe movimientos) | — |
| `add-tx` | modules/finanzas.js:852 | (sin comentario) | `tx` | ✔ | — |
| `guardar-tx-edit` | modules/finanzas.js:894 | (sin comentario) | `tx` | ✔ | — |
| `remove-tx` | modules/finanzas.js:996 | "Eliminar" ya no borra para siempre: mueve el movimiento a la papelera, | `tx`, `txPapelera` | ✔ | — |
| `restaurar-tx` | modules/finanzas.js:1013 | (sin comentario) | `tx`, `txPapelera` | ✔ | — |
| `eliminar-tx-definitivo` | modules/finanzas.js:1035 | (sin comentario) | `txPapelera` | ✔ | — |
| `registrar-recibo-compra` | modules/finanzas.js:1127 | Registra UN recibo con todas las líneas que tengan algo en "Pagué". | `cotizaciones`, `tx`, `txPapelera` | ✔ | — |
| `anular-recibo` | modules/finanzas.js:1263 | Anula el recibo entero: cada compra pierde su parte (si no le queda | `cotizaciones`, `tx`, `txPapelera` | ✔ | — |
| `anular-corregir-recibo` | modules/finanzas.js:1266 | (sin comentario) | `cotizaciones`, `tx`, `txPapelera` | ✔ | — |
| `completar-movimientos-recibo` | modules/finanzas.js:1272 | Un recibo cuyas filas en Finanzas no coinciden con lo registrado (ej. | `cotizaciones`, `tx`, `txPapelera` | ✔ | — |
| `devolver-parte-recibo` | modules/finanzas.js:1287 | Pedido CANCELADO (sí existió, pero no se va a completar): su parte del | `cotizaciones`, `tx`, `txPapelera` | ✔ | — |
| `add-pedido` | modules/pedidos.js:1845 | (sin comentario) | `pedidos`, `tx` | ✔ | — |
| `registrar-venta-consignacion` | modules/pedidos.js:1993 | Si el pedido ya tiene remisiones (ver "Agregar remisión"), el select | `pedidos`, `tx` | ✔ | — |
| `pagar-comision-consignacion` | modules/pedidos.js:2165 | Confirmación agregada en la auditoría financiera 2026-09-20: es un | `pedidos`, `tx` | ✔ | — |
| `toggle-comision` | modules/pedidos.js:2344 | Toggle bidireccional: marcar pagada crea el movimiento en Finanzas; | `pedidos`, `tx` | ✔ | — |
| `cobrar` | modules/pedidos.js:2384 | (sin comentario) | `pedidos`, `tx` | ✔ | — |
| `add-reembolso` | modules/pedidos.js:2422 | (sin comentario) | `pedidos`, `tx` | ✔ | — |
| `add-abono` | modules/pedidos.js:2462 | El monto, la fecha y el método ya NO viven solo en el DOM: su casa es el | `pedidos`, `tx` | ✔ | — |
| `guardar-abono-edit` | modules/pedidos.js:2546 | (sin comentario) | `pedidos`, `tx` | ✔ | — |
| `eliminar-abono` | modules/pedidos.js:2604 | Anular un abono (o un reembolso) mal cargado. Es la contraparte del | `pedidos`, `tx` | ✔ | — |
| `eliminar-venta-consignacion` | modules/pedidos.js:2626 | Misma idea para una venta de consignación mal reportada: hasta ahora no | `pedidos`, `tx` | ✔ | — |
| `remove-pedido` | modules/pedidos.js:2651 | "Eliminar" pide confirmación (antes borraba al instante, sin aviso) y | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `restaurar-pedido` | modules/pedidos.js:2716 | (sin comentario) | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `eliminar-pedido-definitivo` | modules/pedidos.js:2774 | (sin comentario) | `txPapelera` | ✔ | — |
| `reactivar-pedido` | modules/pedidos.js:2837 | (sin comentario) | `cotizaciones`, `pedidos`, `tx`, `txPapelera` | ✔ | — |
| `add-emp` | modules/pendientes.js:613 | (sin comentario) | `config.nomina` | · (no escribe movimientos) | — |
| `remove-emp` | modules/pendientes.js:631 | (sin comentario) | `config.nomina` | · (no escribe movimientos) | — |
| `pagar-nomina` | modules/pendientes.js:649 | (sin comentario) | `tx` | ✔ | — |
| `guardar-emp-edit` | modules/pendientes.js:705 | (sin comentario) | `config.nomina` | · (no escribe movimientos) | — |
| `add-gasto-fijo` | modules/pendientes.js:752 | (sin comentario) | `config.gastosFijos` | · (no escribe movimientos) | sí |
| `remove-gasto-fijo` | modules/pendientes.js:762 | (sin comentario) | `config.gastosFijos` | · (no escribe movimientos) | — |
| `set-gasto-fijo-periodo` | modules/pendientes.js:771 | (sin comentario) | `config.gastosFijos` | · (no escribe movimientos) | sí |
| `set-gasto-fijo-dia` | modules/pendientes.js:780 | (sin comentario) | `config.gastosFijos` | · (no escribe movimientos) | sí |
| `toggle-gasto-fijo-pagado` | modules/pendientes.js:803 | Al marcar un gasto fijo como pagado, además de actualizar su periodo, | `config.gastosFijos`, `tx` | ✔ | sí |
| `add-deuda` | modules/pendientes.js:858 | (sin comentario) | `deudas`, `tx` | ✔ | sí |
| `guardar-deuda-edit` | modules/pendientes.js:911 | (sin comentario) | `deudas`, `deudasHistorial`, `tx` | ✔ | sí |
| `remove-deuda` | modules/pendientes.js:972 | (sin comentario) | `deudas` | · (no escribe movimientos) | — |
| `pagar-deuda` | modules/pendientes.js:991 | "Pagar": un solo botón que registra el pago de la cuota programada | `deudas`, `deudasHistorial`, `tx` | ✔ | sí |
| `deshacer-pago-deuda` | modules/pendientes.js:1045 | Deshace ÚNICAMENTE el último pago registrado de una deuda (cuota o pago | `deudas`, `deudasHistorial`, `tx` | ✔ | sí |
| `remove-deuda-historial` | modules/pendientes.js:1080 | Quita una deuda del historial de deudas pagadas (solo el registro; los | `deudasHistorial` | · (no escribe movimientos) | — |
| `guardar-relleno-colchon` | modules/resumen.js:861 | Ver el comentario grande de listaEntradasServicio (core/calc.js) para | `config.colchonMovimientos`, `tx` | ✔ | — |
| `quitar-relleno-colchon` | modules/resumen.js:892 | Ningún relleno se puede quitar si eso dejaría el Colchón negativo (lo | `config.colchonMovimientos`, `tx` | ✔ | — |

<details>
<summary>Acciones que solo guardan pedidos o cotizaciones, sin tocar movimientos (15)</summary>

El cierre de mes **no las bloquea** (decisión del Hallazgo #65: pedidos y cotizaciones solo se anotan en la bitácora). Cambian totales, descuentos, comisión o estado, no la caja.

`sincronizar-pedido-cotizacion` (modules/cotizaciones.js:1715) · `guardar-descuento-pedido` (modules/pedidos.js:1632) · `quitar-descuentos-pedido` (modules/pedidos.js:1633) · `registrar-retiro-consignacion` (modules/pedidos.js:2032) · `confirmar-remision` (modules/pedidos.js:2100) · `escalar-a-cotizacion` (modules/pedidos.js:2186) · `duplicar-pedido` (modules/pedidos.js:2261) · `advance` (modules/pedidos.js:2380) · `retreat` (modules/pedidos.js:2381) · `advance-ref` (modules/pedidos.js:2382) · `retreat-ref` (modules/pedidos.js:2383) · `cancelar-pedido` (modules/pedidos.js:2802) · `set-pedido-obs-generales` (modules/pedidos.js:2874) · `set-pedido-fecha-entrega` (modules/pedidos.js:2879) · `set-vendedor-fecha-pago` (modules/pedidos.js:2955)

</details>

<!-- GENERADO:fin acciones-dinero -->

**Notas de lectura:**
- La columna **«Toca»** sigue el camino completo de llamadas de la acción (incluye las funciones que ella llama). Es un techo, no lo que hace cada ejecución: por ejemplo `convertir-cotizacion` aparece tocando `txPapelera` porque su camino llega a `ejecutarAccionRecibo`, que solo restaura la papelera si algo falla.
- **«Mira el rol» = sí** en Pendientes **no es un permiso sobre el dinero**: es la sincronización con Calendar, que solo corre para el admin porque es quien tiene esa agenda (`js/modules/pendientes.js:524`, `:555`). Las únicas acciones de dinero cuyo código comprueba rol de verdad son cerrar y reabrir un mes (`js/core/cierre.js:122`, `:156`).
- `guardar-deuda-edit` aparece con ✔ de mes cerrado aunque el análisis no vea una escritura de movimientos: cambia el ingreso de la deuda **por referencia** (§6) y su guarda es condicional (`js/modules/pendientes.js:921-923`).

## 5. El ciclo de vida de cada tipo de movimiento

Formato de cada ficha: **Nace** (acción) · **Marca** · **Lo toca** · **Se deshace** · **Candados** · **Guarda con**. «Guarda con» lista los `persist` en el orden en que se llaman: **cada uno es una escritura separada a la hoja**.

### 5.1 Abono, abono inicial y cobro del saldo (ingreso)
- **Nace:** `add-abono` (`js/modules/pedidos.js:2462`), `add-pedido` con abono inicial (`:1845`, movimiento en `:1932`) o `cobrar` el saldo completo (`:2384`, movimiento en `:2397`).
- **Marca:** `origenAbonoId` = el id de la fila dentro de `pedido.abonos`. El abono vive en **dos sitios**: la fila del pedido y el movimiento.
- **Lo toca:** `guardar-abono-edit` (`:2546`) cambia monto, fecha y cuenta de **ambos lados** y, si el movimiento estaba conciliado, le quita la marca de conciliado (`:2592`). Un abono mayor al saldo **pregunta** y se guarda como saldo a favor (`:2499-2505`).
- **Se deshace:** `eliminar-abono` (`:2604`) quita los dos lados. Desde Finanzas el movimiento **no** se borra suelto mientras el abono exista (`js/modules/finanzas.js:1000-1007`).
- **Candados:** `exigirMesAbierto` en las cuatro (`:1854`, `:2480`, `:2395`, `:2555`; en la edición, con la fecha vieja y la nueva). `p.abono` se recalcula siempre con `recalcularAbonoPedido` (`:31`). Un segundo clic mientras se lee el comprobante se ignora (`state.abonosProcesando`, `:2471`).
- **Guarda con:** `tx` y luego `pedidos` (en `add-pedido`: `tx` → `productos` si hay stock → `pedidos`, `:1933`, `js/core/stock.js:53`, `js/modules/pedidos.js:1984`).
- **Prueba:** `test/cuentas.mjs`, «registrar un abono» (`:257`), «editar un abono mueve el movimiento de cuenta» (`:290`), «anular un abono» (`:348`); `test/bitacora.mjs`, «un mes cerrado bloquea CADA tipo de escritura» (`:426`).

### 5.2 Reembolso (gasto)
- **Nace:** `add-reembolso` (`js/modules/pedidos.js:2422`). Es una fila de `p.abonos` de tipo «reembolso» que **resta** (`calcAbonadoDeLista`) y un gasto en Finanzas.
- **Marca:** `origenReembolsoId`. **Límite:** no puede superar lo ya abonado (`:2430`).
- **Se deshace:** con `eliminar-abono` (misma acción que un abono). **Candado de mes:** `:2431`. **Guarda con:** `tx`, `pedidos`.

### 5.3 Comisión de vendedor (pedido y cotización)
- **Nace:** `toggle-comision` (`js/modules/pedidos.js:2344`, movimiento en `:2363`) o, si la cotización aún no tiene pedido, `toggle-comision-cot` (`js/modules/cotizaciones.js:2502`, movimiento en `:2528`). Es un tipo «comision», nace con la fecha de hoy.
- **Monto:** `calcComisionValor` (`js/core/calc.js:1891`) sobre `calcBaseComision` (`:1883`: el total menos las líneas de servicio cobrado), a pesos enteros.
- **Marca:** `origenComisionPedidoId` / `origenComisionCotId`. El mismo botón la **deshace** (retira el movimiento, `:2371`, `cotizaciones.js:2539`) y vuelve el estado del vendedor a «pendiente».
- **Candados:** mes cerrado al pagar (fecha de hoy) y al deshacer (la fecha del movimiento que se retira, `pedidos.js:2357`); no se paga la comisión de un pedido cancelado (`:2353`) ni de una cotización sin aceptar (`cotizaciones.js:2516`).
- **Guarda con:** `tx` y luego `pedidos` (`:2373`, `:2378`) / `tx` y luego `cotizaciones`.

### 5.4 Consignación (venta del punto y su comisión)
- **Nace:** `registrar-venta-consignacion` (`js/modules/pedidos.js:1993`, ingreso en `:2024`, marca `origenVentaConsignacionId`); `pagar-comision-consignacion` (`:2165`, gasto en `:2173`, marca `origenComisionConsignacionId`). Una **remisión** (entrega de mercancía al punto) **no mueve dinero**.
- **Se deshace:** `eliminar-venta-consignacion` (`:2626`) quita la venta, su ingreso y la comisión pagada.
- **Candados:** mes cerrado en las tres. **Hueco menor:** el monto de la venta es `cantidad × precio` sin redondear y la cantidad no se valida como entera (`:2018`); ver el riesgo #67-8 en `CONTABILIDAD.md`.

### 5.5 Nómina (tipo «nomina»)
- **Nace:** `pagar-nomina` (`js/modules/pendientes.js:649`). Monto = `redondearPesos(salario del periodo + bono − descuento)` (`:659`); la fecha la elige la persona (`:671`).
- **Marca:** **ninguna registrada**; lleva `empleadoId`, con el que `calcPagosNominaEmpleado` (`js/core/calc.js:1840`) reconoce los pagos de cada persona.
- **Se deshace:** no hay botón propio: se elimina el movimiento en Finanzas (va a la papelera) y Pendientes vuelve a mostrar el pago como pendiente. **Candado:** mes cerrado (`:665`). **Guarda con:** solo `tx`.

### 5.6 Gasto fijo (arriendo, servicios…)
- **Nace:** `toggle-gasto-fijo-pagado` (`js/modules/pendientes.js:803`, movimiento en `:838`), un gasto por **periodo**.
- **Marca:** `origenGastoFijoPeriodo` = `idDelGasto|periodo`. El **mismo botón lo deshace** (`:840`), pero solo el del periodo de hoy; uno de un periodo viejo queda huérfano y se puede borrar suelto (`js/core/calc.js:710-725`).
- **Candado:** mes cerrado (`:811`), con la fecha de hoy al pagar y la fecha del movimiento al deshacer. **Guarda con:** `tx` y luego `config` (marca `pagadoHasta`, `:842-843`).

### 5.7 Deuda: ingreso, cuota y pago
- **Ingreso por préstamo (opcional):** `add-deuda` (`js/modules/pendientes.js:858`) crea un ingreso con `origenDeudaIngresoId` solo si se marcó «trajo dinero» (`:875-882`). Eliminar la deuda **no** retira ese ingreso: queda suelto (`:980`).
- **Cuota:** `pagar-deuda` (`:991`): gasto con marca `deudaId` (`:1010`); la última cuota paga el **saldo** exacto y mueve la deuda entera a `deudasHistorial` (`:1011-1022`). Cuotas en pesos enteros (`calcDeudaValorCuota`, `calcDeudaSaldoPendiente`; `test/descuentos.mjs:627`).
- **Se deshace:** `deshacer-pago-deuda` (`:1045`), **solo el último pago**, por su `txId` (`:1061`). Un pago anterior al `txId` no se puede deshacer (`:1059`).
- **Editar:** `guardar-deuda-edit` (`:911`) reescribe el ingreso de la deuda **por referencia** (`:946-948`) y, si bajar las cuotas la deja saldada, la pasa al historial (`:960-966`).
- **Candado:** mes cerrado en crear (si hay ingreso), pagar y deshacer. **Guarda con:** `pagar-deuda` escribe `deudasHistorial` (si es la última) → `tx` → `deudas`.

### 5.8 Colchón (reserva para cubrir huecos)
- **Dos formas** (`js/modules/resumen.js:861`): «separar» (plata que ya está en caja: **no crea movimiento**) y «aporte» (plata nueva: crea un ingreso con `origenColchonId`, `js/modules/resumen.js:874-879`).
- **Se deshace:** `quitar-relleno-colchon` (`:892`), siempre que el Colchón no quede por debajo de lo ya gastado (`:901`).
- **Candado de mes:** solo en el «aporte» (`:867`, `:897`). «Separar» con fecha de un mes cerrado **no se bloquea** (no crea movimiento) pero sí resta de «Ganancia» de ese periodo: ver §7.
- **Guarda con:** `tx` y luego `config` al crear; `config` y luego `tx` al quitar.

### 5.9 Compras de una cotización, excedente y recibos de compra
- **Compras sueltas.** Cada compra marcada «Sí» genera un gasto con `origenCompraClave`, y lo comprado de más su propio movimiento con `origenCompraExcedenteClave`, **sin pedido** a propósito (`js/modules/cotizaciones.js:3118-3158`, `:3182-3208`). `sincronizarComprasFinanzasDe` (`:2978`) es idempotente: adopta el movimiento que ya existe y borra los sobrantes. Corre solo al **Guardar** la cotización (`guardarCotizaciones`, `:3616`) o con el botón (`sincronizar-compras-finanzas`, `:2264` → `llevarComprasAFinanzas`, `:3561`), que toma una foto y **deshace todo si algo cae en un mes cerrado** (`:3567-3573`).
- **Recibo de compra** (una compra para varios pedidos): `registrar-recibo-compra` (`js/modules/finanzas.js:1127`). Todo ocurre dentro de `ejecutarAccionRecibo` (`js/modules/cotizaciones.js:3246`): toma una foto, ejecuta, y **solo guarda si** cada recibo cuadra al peso (`verificarRecibo`, `js/core/calc.js:3818`), la caja se movió exactamente lo esperado y ningún cambio cae en un mes cerrado; si no, restaura la foto y no guarda nada (`js/modules/cotizaciones.js:3281-3288`).
- **Se deshace:** `anular-recibo` (`js/modules/finanzas.js:1263`) manda sus filas a la papelera, de donde **no se restauran sueltas** (`:1020`); `completar-movimientos-recibo` (`:1272`) y `devolver-parte-recibo` (`:1287`) también pasan por `ejecutarAccionRecibo`.
- **Prueba:** `test/smoke.mjs:5323` (un recibo que deja la caja distinta de lo esperado no se guarda).

### 5.10 Costo estimado completo de una cotización
- `add-cot-estimado-movimiento` (`js/modules/cotizaciones.js:2558`): **un** gasto por cotización (idempotente: el segundo clic actualiza el mismo, `:2578-2585`), referenciado desde la cotización por `estimadoTxId` (`:2597`). **Sin marca de origen.** Avisa el doble conteo si ya hay compras reales (`:2574-2576`); si hay ambos, «Salud de los datos» lo marca como **error** (`estimado-doble`, `js/core/salud.js:1011`).

### 5.11 Movimiento a mano, papelera y restaurar
- `add-tx` (`js/modules/finanzas.js:852`): solo ingreso, gasto o nómina. **Sin marca.** No exige fecha (solo concepto y monto, `:854`).
- `remove-tx` (`:996`) → papelera; `restaurar-tx` (`:1013`); `eliminar-tx-definitivo` (`:1035`) lo destruye. Los tres exigen mes abierto. Un movimiento de recibo anulado no se restaura suelto (`:1020`).

### 5.12 Eliminar, restaurar y cancelar un pedido
- `remove-pedido` (`js/modules/pedidos.js:2651`) es «este pedido no debió existir»: se lleva a la papelera **sus** movimientos (`movimientosGeneradosPorPedido`) y devuelve el stock; escribe **cuatro claves** en este orden: `tx`, `txPapelera`, `pedidos`, `pedidosPapelera` (`:2706-2708`). `restaurar-pedido` (`:2716`) los trae de vuelta; `eliminar-pedido-definitivo` (`:2774`) los destruye.
- `cancelar-pedido` (`:2802`) es «sí existió»: **no toca ningún movimiento**; solo deja de contar hacia adelante (saldo, comisión pendiente). **No tiene candado de mes** (no escribe movimientos).

### 5.13 Transferencias entre cuentas (no son movimientos)
- `registrar-transferencia` (`js/modules/cuentas.js:316`) agrega a `state.transferencias`; **no** crea un `tx`, así ningún reporte la cuenta como ingreso ni gasto y la Caja no se mueve (`js/core/store.js:212-216`). Se «anula» poniéndole fecha (`toggle-anular-transferencia`, `js/modules/cuentas.js:336`); nunca se borra. Exigen mes abierto (`:325`, `:340`). `calcSaldosPorCuenta().cuadra` comprueba que la suma de las cuentas sea la Caja (`js/core/calc.js:295`).

### 5.14 Cambios de cuenta y conciliación
- `asignar-cuenta-tx` (`js/modules/cuentas.js:395`) mueve plata **entre cuentas** (no cambia la Caja); exige mes abierto (`:400`). `toggle-conciliado` (`:360`) y `guardar-conciliacion` (`:377`) solo marcan lo que el dueño vio en su extracto: **sin candado de mes** a propósito.

### 5.15 Lo que la app corrige sola al abrir
- `loadAll` (`js/core/store.js:1040`) corre doce reparaciones sobre datos viejos, entre ellas devolver marcas de origen perdidas (`:1343`), enlazar movimientos al pedido de su cotización (`:1346`), y convertir compras viejas en recibos (`:1386-1396`), que es **la única que reescribe plata** y exige verificar cada grupo al peso. Corren solo con lectura completa de la red; quedan anotadas como «automático» en la bitácora y en Salud. **Pueden tocar un mes cerrado** (anotado, señalado, no frenado: `CONTINUIDAD.md`, §6).

## 6. Lo que el análisis no ve: cambios por referencia

<!-- GENERADO:inicio alias -->

El análisis no puede seguir una variable que apunta a un movimiento. Estos son los sitios donde el código cambia un campo de dinero **por referencia** (no aparecen en la tabla de arriba); hay que mirarlos a mano:

| Dónde | En | Forma |
| --- | --- | --- |
| core/calc.js:253 | `asegurarCuentaEnMovimientos` | `t.cuenta = …` |
| core/calc.js:2691 | `parchearDescuento` | `out.tipo = …` |
| core/dom.js:362 | `set-fila-servicio-monto` | `fila.monto = …` |
| core/sheetsEsquemas.js:107 | `(módulo)` | `item.cuenta = …` |
| modules/cotizaciones.js:31 | `duplicarCotizacionCompleta` | `copia.fecha = …` |
| modules/cotizaciones.js:2170 | `set-cot-compra` | `patch.fecha = …` |
| modules/cotizaciones.js:3037 | `sincronizarComprasFinanzasDe` | `Object.assign(existente, …)` |
| modules/finanzas.js:930 | `guardar-tx-edit` | `editado.conciliadoEn = …` |
| modules/finanzas.js:1447 | `armarFormCorregir` | `Object.assign(d, …)` |
| modules/pedidos.js:1628 | `set-descuento-pedido-orden` | `fd.tipo = …` |
| modules/pedidos.js:2592 | `guardar-abono-edit` | `cambio.conciliadoEn = …` |
| modules/pendientes.js:946 | `guardar-deuda-edit` | `txIngreso.monto = …` |
| modules/pendientes.js:947 | `guardar-deuda-edit` | `txIngreso.concepto = …` |

<!-- GENERADO:fin alias -->

Revisados a mano, ninguno de los de dinero escapa a un candado:
- `core/calc.js:253` (`asegurarCuentaEnMovimientos`): pone la cuenta predeterminada a un movimiento nuevo; la llama `persist` en `js/core/store.js:1904`.
- `modules/cotizaciones.js:3037` (`aplicarAMovimiento`): actualiza el movimiento de una compra; solo corre dentro de `sincronizarComprasFinanzasDe`, cuya llamada deshace todo si toca un mes cerrado.
- `modules/pendientes.js:946-947`: el ingreso de la deuda (candado condicional, `:921-923`).
- `modules/finanzas.js:930` y `modules/pedidos.js:2592`: quitan la marca de conciliado al editar (lo que se compara contra el extracto cambió).
- El resto (`dom.js:362`, `pedidos.js:1628`, `calc.js:2691`, `cotizaciones.js:31`, `:2170`, `finanzas.js:1447`, `sheetsEsquemas.js:107`) son formularios, copias o valores por defecto, no dinero ya guardado.

## 7. Lo que el cierre de mes NO bloquea

Es una decisión del Hallazgo #65, no un olvido; pero hay que saberlo (la lista completa de acciones está en la sección 4, «solo guardan pedidos o cotizaciones»):

- **Pedidos y cotizaciones** (total, descuento, IVA, estado, comisión): se anotan en la bitácora pero no se bloquean.
- **Conciliaciones** y marcas «conciliado».
- **Deudas** (crear sin ingreso, editar, eliminar) y **cuentas** (renombrar, agregar).
- **«Separar» al Colchón** con fecha de un mes cerrado: no crea movimiento, pero sí cambia la «Ganancia» de ese periodo, que el resumen del cierre (ingresos, gastos, Caja, saldo por cuenta) no incluye.
- **Un movimiento sin fecha o con fecha mal escrita** (no empieza con `AAAA-MM`): no pertenece a ningún mes, así que el candado no lo ve (`js/core/calc.js:333-336`).
- **Las reparaciones automáticas al abrir la app.**
- **Cualquiera con acceso directo a la Google Sheet.**

## 8. Cómo se comprueba que todo cuadra

| Mecanismo | Qué compara | Dónde | Limitación |
|---|---|---|---|
| **Recibos de compra** | Cada recibo contra sus pedidos y la caja, al peso, **antes** de guardar | `js/modules/cotizaciones.js:3246` | Solo recibos |
| **Cuentas** | La suma de los saldos de cada cuenta contra la Caja | `js/core/calc.js:295` | Compara la app contra sí misma |
| **Salud de los datos** | 21 verificaciones: abonos vs movimientos, comisiones, nómina, deudas, consignación, papelera, caja, fechas, montos… | `js/core/salud.js:713`, `:1322` | No compara con la hoja ni con el banco; avisa, no impide |
| **Cierre de mes** | Un mes cerrado contra el resumen que tenía al cerrarse | `js/core/salud.js:791` (`meses-cerrados`) | Solo mira ingresos, gastos, Caja y saldo por cuenta |
| **Bitácora** | Antes y después de cada guardado de dinero | `js/core/bitacora.js:300` | Solo cambios hechos desde la app |
| **Conciliación** | El saldo calculado contra el que dice el extracto, escrito a mano | `js/modules/cuentas.js:377` | Manual |
| **Respaldo diario** | Una copia completa de la hoja | `js/core/backup.js:87` | Solo si el admin abre la app |
