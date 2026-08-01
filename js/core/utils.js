// Funciones puras y reutilizables. No tocan estado ni el DOM (salvo `val`,
// que lee un input dentro de un contenedor ya renderizado).

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Convierte un Date a "YYYY-MM-DD" en hora LOCAL (a diferencia de
// Date#toISOString, que usa UTC y puede correr la fecha un día según la
// zona horaria del navegador). Se usa para mandar fechas de un solo día a
// servicios como Google Calendar, donde el vencimiento calculado con
// calcFechaVencimientoPeriodo() debe llegar como el mismo día que se ve en
// la app.
export function fechaISOLocal(fecha) {
  var y = fecha.getFullYear(), m = String(fecha.getMonth() + 1).padStart(2, "0"), d = String(fecha.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Número de OP: código corto legible (ej. "OP-4821") para identificar un pedido
// de un vistazo (impresión, comunicación con el cliente, búsquedas). `existentes`
// debe incluir TODOS los números ya usados (pedidos activos + papelera) para
// garantizar que nunca se repita, ni siquiera al restaurar uno eliminado.
export function generarNumeroOp(existentes) {
  var usados = {};
  (existentes || []).forEach(function (op) { if (op) usados[op] = true; });
  var intento;
  do {
    intento = "OP-" + Math.floor(1000 + Math.random() * 9000);
  } while (usados[intento]);
  return intento;
}

export function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

export function num(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Nombre de archivo seguro para descargas (PDF/CSV): minúsculas, espacios y
// puntuación pasan a "_", pero SIN perder tildes/eñes — antes usábamos una
// regex que solo dejaba a-z0-9 y por eso "básica" quedaba como "b_sica" (la
// á se borraba en vez de conservarse). Ver README "Registro de cambios".
export function slugify(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü]+/g, "_")
    .replace(/^_+|_+$/g, "") || "archivo";
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
  });
}

export function norm(s) {
  return String(s == null ? "" : s).toLowerCase();
}

export function opt(val, label, current) {
  return '<option value="' + val + '" ' + (val === current ? "selected" : "") + ">" + label + "</option>";
}

// Lee el valor (trim) de un input/select con data-role dentro de un contenedor.
// Se usa para los mini-formularios inline (insumos, detalle de pedido, gastos reales...).
export function val(container, role) {
  if (!container) return "";
  var el = container.querySelector('[data-role="' + role + '"]');
  return el ? el.value.trim() : "";
}

// Convierte "1, 15" o "1,15,30" en [1,15,30] (enteros únicos, ordenados).
// Se usa para permitir MÁS DE UN día de pago (ej. nómina el 1 y el 15).
export function parseDias(str) {
  return String(str || "")
    .split(",")
    .map(function (s) { return parseInt(s.trim(), 10); })
    .filter(function (n) { return !isNaN(n); })
    .filter(function (n, i, arr) { return arr.indexOf(n) === i; })
    .sort(function (a, b) { return a - b; });
}

// Lee "días de pago" de un objeto (gasto fijo, config de nómina...), aceptando
// el formato nuevo (diasPago: array) o el legado (diaPago: un solo valor).
export function diasPagoDe(obj) {
  if (!obj) return [];
  if (Array.isArray(obj.diasPago)) return obj.diasPago;
  if (obj.diaPago !== "" && obj.diaPago != null) return [obj.diaPago];
  return [];
}

// Parser de CSV simple (soporta separador coma o punto y coma, y comillas para
// valores con separadores dentro). Pensado para archivos exportados desde
// Excel/Sheets con columnas: nombre, talla, numero, tipo, observaciones —
// usado para importar tallas/observaciones por referencia en cotizaciones.
export function parseDetalleCSV(text) {
  var lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter(function (l) { return l.trim().length; });
  if (lines.length < 2) return [];
  var delim = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";

  function parseLine(line) {
    var result = [], cur = "", inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; } }
        else cur += ch;
      } else if (ch === '"') { inQuotes = true; }
      else if (ch === delim) { result.push(cur); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur);
    return result.map(function (s) { return s.trim(); });
  }

  function normHead(h) {
    return h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
  var mapaCampos = { nombre: "nombre", talla: "talla", numero: "numero", num: "numero", tipo: "tipo", observaciones: "observaciones", obs: "observaciones", nota: "observaciones", notas: "observaciones" };
  var header = parseLine(lines[0]).map(normHead);

  return lines.slice(1).map(function (line) {
    var cols = parseLine(line);
    var fila = { id: uid(), nombre: "", talla: "", numero: "", tipo: "", observaciones: "" };
    header.forEach(function (h, i) {
      var campo = mapaCampos[h];
      if (campo) fila[campo] = (cols[i] || "").trim();
    });
    return fila;
  }).filter(function (f) { return f.nombre; });
}
