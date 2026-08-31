// Configuración COMPARTIDA de las gráficas del panel (Chart.js, cargado por
// CDN como window.Chart — ver index.html).
//
// Por qué existe este archivo: las gráficas de Resumen tenían su
// configuración COPIADA carácter por carácter una dentro de otra (la de
// "Ingresos y gastos" y la del reporte eran idénticas salvo el nombre de la
// variable y una línea), y cada una decidía por su cuenta si llevaba leyenda o
// cuántas marcas mostraba en el eje X — dos gráficas vecinas terminaban
// leyéndose con criterios distintos. Acá vive UNA sola definición de cómo se
// ve una gráfica de este panel; los módulos solo aportan los datos.
//
// Nada de esto se ejecuta si Chart.js no cargó: cada constructor sale
// devolviendo null y el resto del panel sigue funcionando igual.

// La app escribe el texto en Inter y las CIFRAS en IBM Plex Mono (ver
// css/base.css y .amount en css/tables.css). Chart.js, si no se le dice nada,
// pinta todo en Helvetica/Arial de fábrica: los ejes y los tooltips eran el
// único lugar de la app con otra tipografía.
var FUENTE_TEXTO = "'Inter', system-ui, sans-serif";
var FUENTE_CIFRAS = "'IBM Plex Mono', monospace";

// Lee los tokens del tema VIGENTE. A propósito NO se cachea en una constante
// de módulo: el tema claro/oscuro se cambia en caliente (data-theme en <html>,
// ver core/dom.js) y cada re-render vuelve a pasar por acá — una paleta
// cacheada dejaría las gráficas con los colores del tema anterior hasta que
// alguien recargara la página.
// Paleta para la gráfica que se va a IMPRIMIR. No depende del tema.
//
// POR QUÉ EXISTE: el canvas se captura con toDataURL SIN fondo (PNG con alfa)
// y jsPDF lo compone sobre papel blanco. Con el tema oscuro —que es el de
// fábrica— los ejes y la leyenda salían en --ink-soft (#b3b7ca): alrededor de
// 2:1 de contraste sobre blanco, o sea prácticamente invisibles en el
// documento impreso. Las barras sí se veían, pero sin poder leer de qué eran.
function paletaImpresion() {
  return {
    ink: "#1b1d27", inkSoft: "#3f4351", inkFaint: "#6b7080",
    rejilla: "#dfe2ea", borde: "#c5c9d4", superficie: "#ffffff",
    exito: "#0e9f63", peligro: "#e0334f", info: "#2f6fe0", acento: "#6a59f0"
  };
}

export function paletaGrafica(paraImpresion) {
  if (paraImpresion) return paletaImpresion();
  var cs = getComputedStyle(document.documentElement);
  function v(nombre) { return String(cs.getPropertyValue(nombre) || "").trim(); }
  return {
    ink: v("--ink"),
    inkSoft: v("--ink-soft"),
    inkFaint: v("--ink-faint"),
    // Rejilla: lo más tenue de la escala, tiene que insinuarse, no competir.
    rejilla: v("--border-soft"),
    borde: v("--border-strong"),
    superficie: v("--surface-3"),
    exito: v("--success"),
    peligro: v("--danger"),
    info: v("--info"),
    acento: v("--accent")
  };
}

// Todo lo que Chart.js pinta "por su cuenta" (tipografías, color base del
// texto, el tooltip entero) quedaba de fábrica y no respetaba el tema. Esto se
// llama en cada dibujo, no una vez al arrancar, por la misma razón que la
// paleta no se cachea: el tema cambia en caliente.
export function configurarDefaults() {
  var C = window.Chart;
  if (!C) return;
  var p = paletaGrafica();

  C.defaults.font.family = FUENTE_TEXTO;
  C.defaults.font.size = 11.5;
  C.defaults.font.weight = "500";
  // Texto que hay que LEER (leyenda, ticks): --ink-soft. Antes usaban
  // --ink-faint, el nivel MÁS tenue de la escala — ese nivel es para la
  // rejilla, no para las palabras.
  C.defaults.color = p.inkSoft;
  C.defaults.borderColor = p.rejilla;

  var tt = C.defaults.plugins.tooltip;
  tt.backgroundColor = p.superficie;
  tt.titleColor = p.ink;
  tt.bodyColor = p.ink;
  tt.borderColor = p.borde;
  tt.borderWidth = 1;
  tt.cornerRadius = 8;
  tt.padding = 10;
  tt.caretSize = 5;
  tt.displayColors = true;
  tt.boxWidth = 8;
  tt.boxHeight = 8;
  tt.boxPadding = 5;
  tt.usePointStyle = true;
  tt.titleFont = { family: FUENTE_TEXTO, size: 11.5, weight: "600" };
  // El cuerpo del tooltip es siempre una cifra: mismo mono que el resto de la
  // app, con dígitos de ancho fijo.
  tt.bodyFont = { family: FUENTE_CIFRAS, size: 12.5, weight: "500" };
  tt.footerFont = { family: FUENTE_CIFRAS, size: 11.5, weight: "600" };
  tt.footerColor = p.inkSoft;
  tt.footerMarginTop = 7;

  var lg = C.defaults.plugins.legend;
  lg.labels.usePointStyle = true;
  lg.labels.pointStyle = "circle";
  lg.labels.boxWidth = 7;
  lg.labels.boxHeight = 7;
  lg.labels.padding = 14;
  lg.labels.color = p.inkSoft;
}

// Objeto de opciones COMPLETO, parametrizado. Es el único lugar donde se
// decide cómo se comporta una gráfica de este panel:
//   formatoY       fn(valor) -> texto del eje Y (ej. fmtCorto)
//   formatoTooltip fn(valor) -> texto del tooltip (ej. fmt, ya con $)
//   maxTicksX      cuántas marcas como máximo en el eje X
//   precisionY     decimales del eje Y (0 = solo enteros, para conteos)
//   formatoFooter  fn(items) -> línea de cierre del tooltip (ej. el balance
//                  del día, que solo tiene sentido viendo las dos series)
//   leyenda        true si la gráfica tiene más de una serie que distinguir
//   animar         false para la del PDF (ver abajo)
//   paraImpresion  true para la que se captura y va al PDF: usa una paleta de
//                  tinta oscura fija, porque el papel siempre es blanco
//   paleta         para no releer los tokens dos veces en el mismo dibujo
export function opcionesBase(opc) {
  opc = opc || {};
  var p = opc.paleta || paletaGrafica(opc.paraImpresion);
  var animar = opc.animar !== false;
  var callbacks = {
    label: function (ctx) {
      var valor = opc.formatoTooltip ? opc.formatoTooltip(ctx.parsed.y, ctx) : String(ctx.parsed.y);
      return (ctx.dataset.label ? ctx.dataset.label + ": " : "") + valor;
    }
  };
  // Solo se agrega la clave si hay algo que poner: Chart.js llama a
  // callbacks.footer sin comprobar que exista, así que dejarla en undefined
  // reventaría al abrir el primer tooltip.
  if (opc.formatoFooter) callbacks.footer = opc.formatoFooter;
  return {
    responsive: true,
    maintainAspectRatio: false,
    // "index": pasar el mouse por un día muestra ingresos Y gastos de ESE día
    // a la vez, que es la comparación que se viene a hacer. Sin intersect, no
    // hace falta apuntarle exacto a la barra (importa en móvil).
    interaction: { mode: "index", intersect: false },
    // Animación corta. La de ~1s de fábrica se notaba en cada notify(), y esta
    // app re-renderiza TODO en cada cambio de estado: la gráfica se rearmaba
    // entera a la vista del usuario todo el tiempo. Con `animar:false` no
    // anima nada — es lo que necesita la que va al PDF (ver resumen.js).
    animation: animar ? { duration: 260, easing: "easeOutQuart" } : false,
    layout: { padding: { top: 2, right: 2, bottom: 0, left: 0 } },
    plugins: {
      legend: opc.leyenda
        ? { display: true, position: "top", align: "end", labels: { color: p.inkSoft } }
        : { display: false },
      tooltip: { callbacks: callbacks }
    },
    scales: {
      x: {
        // Sin rejilla vertical y sin borde de eje: las líneas verticales no
        // aportan nada acá y ensuciaban una tarjeta de 200px de alto.
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: p.inkSoft,
          autoSkip: true,
          maxTicksLimit: opc.maxTicksX || 8,
          maxRotation: 0,
          padding: 6
        }
      },
      y: {
        beginAtZero: true,
        // Rejilla horizontal de 1px muy tenue: es la única referencia que sí
        // ayuda a leer una altura.
        grid: { color: p.rejilla, lineWidth: 1, drawTicks: false },
        border: { display: false },
        ticks: {
          color: p.inkSoft,
          maxTicksLimit: 5,
          padding: 8,
          precision: opc.precisionY,
          font: { family: FUENTE_CIFRAS, size: 11 },
          callback: function (v) { return opc.formatoY ? opc.formatoY(v) : v; }
        }
      }
    }
  };
}

// Barras de ingresos vs. gastos. Es LA gráfica de dinero del panel: la usan
// tanto el vistazo de los últimos 30 días como el reporte del periodo elegido,
// que antes tenían dos copias idénticas de esta misma configuración.
export function crearBarrasIngresosGastos(canvas, cfg) {
  var C = window.Chart;
  if (!C || !canvas) return null;
  // La paleta se resuelve con la config: si esta grafica va al PDF necesita
  // tinta oscura fija (papel blanco), no la del tema — ver paletaImpresion.
  var p = paletaGrafica(cfg && cfg.paraImpresion);
  return new C(canvas, {
    type: "bar",
    data: {
      labels: cfg.labels,
      datasets: [
        serieBarra("Ingresos", cfg.ingresos, p.exito),
        serieBarra("Gastos", cfg.gastos, p.peligro)
      ]
    },
    options: opcionesBase(Object.assign({ paleta: p, leyenda: true }, cfg))
  });
}

function serieBarra(label, datos, color) {
  return {
    label: label,
    data: datos,
    backgroundColor: color,
    hoverBackgroundColor: color,
    // Punta redondeada arriba y grosor tope: con 30 días en pantalla las
    // barras se afinan solas, y con 3 no se convierten en bloques enormes.
    // (Chart.js recorta solo el radio para que nunca supere la mitad de la
    // barra, así que una barra chica no se vuelve una pastilla.)
    borderRadius: 4,
    borderSkipped: false,
    maxBarThickness: 18,
    categoryPercentage: 0.72,
    barPercentage: 0.9
  };
}

// Dona: de qué está hecho UN total, en partes — a diferencia de barras/línea
// (que comparan series a lo largo del tiempo), esta compara PARTES de un
// mismo todo en un instante, así que no lleva ejes ni serie por nombre. Se
// usa para "de la caja actual, cuánto es ganancia y cuánto ya tiene dueño"
// (ver renderGraficaCaja en modules/resumen.js). configurarDefaults() ya deja
// listos el color y la tipografía del tooltip/leyenda a nivel global —
// llamarla antes de crear esta gráfica, igual que las demás.
export function crearDona(canvas, cfg) {
  var C = window.Chart;
  if (!C || !canvas) return null;
  var p = paletaGrafica(cfg && cfg.paraImpresion);
  return new C(canvas, {
    type: "doughnut",
    data: {
      labels: cfg.labels,
      datasets: [{
        data: cfg.valores,
        backgroundColor: cfg.colores,
        borderColor: p.superficie,
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: cfg.animar === false ? false : { duration: 260, easing: "easeOutQuart" },
      cutout: "66%",
      plugins: {
        legend: { display: true, position: "bottom" },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var valor = cfg.formatoTooltip ? cfg.formatoTooltip(ctx.parsed) : String(ctx.parsed);
              return ctx.label + ": " + valor;
            }
          }
        }
      }
    }
  });
}

// Línea con relleno degradado. Se usa para conteos en el tiempo (prendas
// producidas por día); acepta color propio por si algún día se grafica otra
// cosa con la misma forma.
export function crearLinea(canvas, cfg) {
  var C = window.Chart;
  if (!C || !canvas) return null;
  // La paleta se resuelve con la config: si esta grafica va al PDF necesita
  // tinta oscura fija (papel blanco), no la del tema — ver paletaImpresion.
  var p = paletaGrafica(cfg && cfg.paraImpresion);
  var color = cfg.color || p.info;
  return new C(canvas, {
    type: "line",
    data: {
      labels: cfg.labels,
      datasets: [{
        label: cfg.label || "",
        data: cfg.valores,
        borderColor: color,
        borderWidth: 2,
        tension: 0.35,
        fill: true,
        backgroundColor: degradadoVertical(color),
        // Sin puntos dibujados: con 30 días la línea quedaba como un collar de
        // cuentas. El punto aparece grande SOLO donde está el mouse, que es
        // cuando sirve para leer un valor puntual.
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: p.superficie,
        pointHoverBorderWidth: 3,
        // Área sensible generosa: no hay que apuntarle al pixel exacto.
        pointHitRadius: 14
      }]
    },
    options: opcionesBase(Object.assign({ paleta: p, leyenda: false }, cfg))
  });
}

// Relleno degradado bajo la línea: del color con algo de alpha arriba hasta
// transparente abajo. Va como FUNCIÓN (opción "scriptable" de Chart.js) y no
// como un gradiente ya creado porque createLinearGradient necesita las
// coordenadas del área de dibujo, y Chart.js recién las conoce después de
// medir el canvas — en el primer pase chartArea todavía no existe.
function degradadoVertical(color) {
  return function (ctx) {
    var chart = ctx.chart;
    var area = chart.chartArea;
    if (!area) return "transparent";
    var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, conAlpha(color, 0.32));
    g.addColorStop(1, conAlpha(color, 0));
    return g;
  };
}

// Los tokens del tema son hex (#5b9dff). Chart.js necesita un color con alpha
// para el degradado, así que se convierte acá; si algún día un token pasa a
// ser rgb()/rgba(), también se contempla.
export function conAlpha(color, alpha) {
  var c = String(color || "").trim();
  if (c.charAt(0) === "#") {
    var h = c.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length >= 6) {
      return "rgba(" + parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16) + "," + alpha + ")";
    }
  }
  var m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    var partes = m[1].split(",");
    return "rgba(" + partes[0].trim() + "," + partes[1].trim() + "," + partes[2].trim() + "," + alpha + ")";
  }
  return c; // formato desconocido: mejor el color tal cual que ningún relleno
}

// Destruir una instancia sin repetir el mismo `if (x) { x.destroy(); x = null; }`
// en cada dibujante. Devuelve null para poder escribir `g = destruirGrafica(g)`.
export function destruirGrafica(instancia) {
  if (instancia) {
    try { instancia.destroy(); } catch (e) { /* el canvas ya no existe: nada que soltar */ }
  }
  return null;
}
