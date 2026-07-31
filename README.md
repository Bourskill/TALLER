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


## Estructura

```
index.html
css/
  variables.css      tokens de color/radios — cambia el tema completo
  base.css            reset + contenedor
  layout.css           header, tabs, kpis, cards, títulos de sección
  forms.css             inputs, botones, chips, filtros (compartido)
  tables.css             filas de transacciones (tx-row), tags, montos
  pedidos.css              solo pestaña Pedidos
  cotizaciones.css         solo pestaña Cotizaciones
  clientes.css             solo pestaña Clientes
  pendientes.css           solo pestaña Pendientes
  config.css               solo pestaña Configuración
  responsive.css       media queries transversales
js/
  app.js              punto de entrada: carga datos y pinta la primera vez
  core/
    constants.js       ESTADOS, KEYS de storage, config por defecto
    utils.js            funciones puras: fmt, esc, uid, num...
    store.js             *el* estado global + persistencia + notify()
    calc.js               todo lo derivado del estado (caja, márgenes...)
    components.js          piezas de HTML compartidas (combobox de cliente)
    dom.js                 orquestador: layout fijo + registro de acciones
  modules/
    resumen.js, finanzas.js, pedidos.js, cotizaciones.js,
    clientes.js, pendientes.js, config.js
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

## Persistencia

Cada área de negocio vive en su propia clave de `window.storage`
(`finanzas:transacciones`, `pedidos:lista`, etc. — ver `core/constants.js`).
Esto ya estaba así en el original y se mantuvo: significa que una escritura
en Pedidos nunca puede corromper los datos de Finanzas.

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
- **Multiusuario/roles**: si en algún punto más de una persona usa el panel a
  la vez, conviene revisar el patrón "last-write-wins" de `window.storage`
  para evitar que dos personas se pisen guardando el mismo pedido.

Ninguno de estos se implementó en esta entrega — la prioridad pedida fue
dividir primero. Dime por cuál área empezamos y la llevamos a fondo.
