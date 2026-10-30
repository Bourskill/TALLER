// Cierre de mes del dinero (Hallazgo #65). El admin cierra un mes que ya
// terminó: la app guarda quién, cuándo y un resumen de lo que ese mes valía
// (ingresos, gastos, Caja al final del mes, saldo de cada cuenta), y desde ese
// momento no deja crear, editar, borrar ni restaurar nada de dinero con fecha en
// él. Reabrirlo exige un motivo y queda en la bitácora.
//
// UNA sola pregunta ("¿este mes está cerrado?") vive en periodoCerrado
// (core/calc.js) y UN solo helper la hace a las acciones: exigirMesAbierto. Quien
// agregue una acción que escriba dinero con fecha llama a ese helper ANTES de
// escribir; si se le olvida, la bitácora igual anota el cambio como hecho en un
// mes cerrado y «Salud de los datos» lo señala (ver la verificación «Meses
// cerrados» en core/salud.js).
//
// QUÉ NO ES: un candado de seguridad. Los permisos de la app son de pantalla; un
// vendedor con acceso directo a la Google Sheet puede editar sus celdas.

import { state, persist, notify } from "./store.js";
import { getSession } from "./auth.js";
import { periodoCerrado, mesDeFecha, calcResumenMes, calcDiferenciasCierre } from "./calc.js";
import { anotarEvento } from "./bitacora.js";
import { todayStr, fmt } from "./utils.js";

var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function nombreMes(mes) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(mes || ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return String(mes || "");
  return MESES[+m[2] - 1] + " " + m[1];
}

export function esAdmin() {
  var s = getSession();
  return !!s && s.rol === "admin";
}

function cuandoTexto(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "");
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
}

// Los cierres vigentes que tocan estas fechas (sin repetir mes). Vacío = todas
// están en meses abiertos.
export function mesesCerradosEn(fechas) {
  var lista = Array.isArray(fechas) ? fechas : [fechas];
  var vistos = {}, res = [];
  lista.forEach(function (f) {
    var c = periodoCerrado(f);
    if (c && !vistos[c.mes]) { vistos[c.mes] = true; res.push(c); }
  });
  return res;
}

// El mensaje de un mes cerrado: cuál es y quién lo cerró.
export function textoMesCerrado(cierre) {
  var quien = cierre.cerradoPorNombre || cierre.cerradoPor || "alguien";
  return nombreMes(cierre.mes) + " está cerrado (lo cerró " + quien + (cierre.cerradoEn ? " el " + cuandoTexto(cierre.cerradoEn) : "") + ")";
}

// El texto de por qué no se puede ("" si todas las fechas están en meses
// abiertos). Aparte de exigirMesAbierto para las acciones que no pueden avisar
// con un alert suelto sino que primero deshacen lo que ya mutaron (los recibos
// de compra y la sincronización de compras de una cotización).
export function bloqueoMesCerrado(fechas, queHaria) {
  var cerrados = mesesCerradosEn(fechas);
  if (!cerrados.length) return "";
  var que = queHaria || "hacer este cambio";
  return "No se puede " + que + ": " + cerrados.map(textoMesCerrado).join(" y ") + ".\n\n" +
    (esAdmin()
      ? "Para cambiarlo, reabre el mes en Finanzas → 🔒 Cierre de mes (te pide el motivo) y vuelve a cerrarlo cuando termines."
      : "Pídele al administrador que lo reabra (queda registrado quién y por qué).");
}

// EL helper que llaman las acciones antes de escribir dinero: `fechas` son las
// fechas de TODO lo que la acción va a crear, cambiar o quitar (la de antes y
// la de después si cambia), y `queHaria` completa la frase «No se puede …».
// Devuelve true si se puede seguir; si no, avisa (quién cerró qué mes y cómo
// reabrirlo) y devuelve false: quien llama debe hacer `return`.
export function exigirMesAbierto(fechas, queHaria) {
  var texto = bloqueoMesCerrado(fechas, queHaria);
  if (!texto) return true;
  window.alert(texto);
  return false;
}

// Las fechas de los registros que NO son iguales entre una foto (el JSON de la
// lista de antes) y la lista de ahora: la fecha de antes y la de después de cada
// registro creado, cambiado o quitado. Es para las acciones que mutan muchos
// movimientos de una vez y no conocen sus fechas de antemano.
export function fechasCambiadas(antesJson, ahora) {
  var antes = {};
  try { JSON.parse(antesJson || "[]").forEach(function (t) { if (t && t.id != null) antes[t.id] = t; }); } catch (e) { antes = {}; }
  var fechas = [];
  var vistos = {};
  // "Cambió" = cambió algo que mueve plata de un mes (fecha, tipo, monto,
  // cuenta); un campo que solo se reacomoda (una marca, un puntero) no cuenta.
  function huella(t) { return [t.fecha, t.tipo, Number(t.monto) || 0, t.cuenta || ""].join("|"); }
  (ahora || []).forEach(function (t) {
    if (!t || t.id == null) return;
    vistos[t.id] = true;
    var previo = antes[t.id];
    if (!previo) { fechas.push(t.fecha); return; }
    if (huella(previo) !== huella(t)) { fechas.push(previo.fecha); fechas.push(t.fecha); }
  });
  Object.keys(antes).forEach(function (id) { if (!vistos[id]) fechas.push(antes[id].fecha); });
  return fechas;
}

// ---------------------------------------------------------------------------
// Cerrar y reabrir
// ---------------------------------------------------------------------------
function cierreDe(mes) {
  return (state.cierres || []).filter(function (c) { return c.mes === mes; })[0] || null;
}

// "abierto" (nunca se cerró), "cerrado" o "reabierto" (se cerró y se volvió a abrir).
export function estadoMes(mes) {
  var c = cierreDe(mes);
  return c ? c.estado : "abierto";
}

export function puedeCerrarMes(mes) {
  if (!esAdmin()) return { ok: false, error: "Solo el administrador puede cerrar un mes." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ""))) return { ok: false, error: "Ese no es un mes válido." };
  if (mes >= todayStr().slice(0, 7)) return { ok: false, error: "Solo se puede cerrar un mes que ya terminó: " + nombreMes(mes) + " todavía está en curso." };
  if (estadoMes(mes) === "cerrado") return { ok: false, error: nombreMes(mes) + " ya está cerrado." };
  return { ok: true };
}

export function cerrarMes(mes) {
  var puede = puedeCerrarMes(mes);
  if (!puede.ok) return puede;
  var ses = getSession();
  var ahora = new Date().toISOString();
  var resumen = calcResumenMes(mes);
  var previo = cierreDe(mes);
  var entrada = { accion: "cerrado", por: ses.email || "", nombre: ses.vendedorNombre || ses.email || "", en: ahora, resumen: resumen };
  var nuevo = {
    mes: mes, estado: "cerrado", cerradoPor: ses.email || "", cerradoPorNombre: ses.vendedorNombre || ses.email || "", cerradoEn: ahora,
    resumen: resumen, historial: ((previo && previo.historial) || []).concat([entrada])
  };
  state.cierres = (state.cierres || []).filter(function (c) { return c.mes !== mes; }).concat([nuevo])
    .sort(function (a, b) { return String(a.mes).localeCompare(String(b.mes)); });
  persist("cierres");
  anotarEvento({
    accion: "cerrar-mes", mes: mes, registroId: mes, etiqueta: "Cierre de " + nombreMes(mes),
    cambios: "Ingresos " + fmt(resumen.ingresos) + ", gastos " + fmt(resumen.gastos) + ", Caja al final del mes " + fmt(resumen.caja) + ", " + resumen.movimientos + " movimientos.",
    despues: { ingresos: resumen.ingresos, gastos: resumen.gastos, caja: resumen.caja, movimientos: resumen.movimientos }
  });
  notify();
  return { ok: true, cierre: nuevo };
}

export var MOTIVO_MINIMO = 5;

export function reabrirMes(mes, motivo) {
  if (!esAdmin()) return { ok: false, error: "Solo el administrador puede reabrir un mes." };
  var c = cierreDe(mes);
  if (!c || c.estado !== "cerrado") return { ok: false, error: nombreMes(mes) + " no está cerrado." };
  var texto = String(motivo == null ? "" : motivo).trim();
  if (texto.length < MOTIVO_MINIMO) return { ok: false, error: "Escribe el motivo para reabrir " + nombreMes(mes) + " (queda en la bitácora)." };
  var ses = getSession();
  var ahora = new Date().toISOString();
  var entrada = { accion: "reabierto", por: ses.email || "", nombre: ses.vendedorNombre || ses.email || "", en: ahora, motivo: texto };
  state.cierres = state.cierres.map(function (x) {
    return x.mes === mes ? Object.assign({}, x, { estado: "reabierto", historial: (x.historial || []).concat([entrada]) }) : x;
  });
  persist("cierres");
  anotarEvento({
    accion: "reabrir-mes", mes: mes, registroId: mes, etiqueta: "Reapertura de " + nombreMes(mes),
    cambios: "Motivo: " + texto
  });
  notify();
  return { ok: true };
}

// Los meses que la pantalla de cierre muestra, del más nuevo al más viejo: todos
// los que tienen movimientos o ya tienen un cierre, menos el mes en curso y los
// futuros (un mes que no ha terminado no se puede cerrar).
export function listaMesesCierre() {
  var actual = todayStr().slice(0, 7);
  var meses = {};
  (state.tx || []).forEach(function (t) { var m = mesDeFecha(t.fecha); if (m) meses[m] = true; });
  (state.transferencias || []).forEach(function (t) { var m = mesDeFecha(t.fecha); if (m) meses[m] = true; });
  (state.cierres || []).forEach(function (c) { if (c.mes) meses[c.mes] = true; });
  return Object.keys(meses).filter(function (m) { return m < actual; }).sort().reverse().map(function (mes) {
    var cierre = cierreDe(mes);
    return {
      mes: mes, nombre: nombreMes(mes), estado: cierre ? cierre.estado : "abierto", cierre: cierre,
      hoy: calcResumenMes(mes),
      diferencias: cierre && cierre.estado === "cerrado" ? calcDiferenciasCierre(cierre) : []
    };
  });
}
