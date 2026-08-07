// Esquemas de columnas para las entidades ya migradas a hojas propias con
// columnas reales (ver core/sheetsTabular.js) — hoy: Movimientos (tx) y
// Clientes. El resto de `state` (pedidos, cotizaciones, config, deudas...)
// sigue viviendo en la pestaña "kv" (ver core/sheetsStorage.js) hasta que se
// migre con el mismo patrón: agregar su esquema acá y sumarlo en store.js
// (TABLAS_SHEET + la migración de loadAll()).

import { crearTablaSheet } from "./sheetsTabular.js";

export var tablaMovimientos = crearTablaSheet("Movimientos", [
  { key: "id", header: "id" },
  { key: "fecha", header: "fecha" },
  { key: "tipo", header: "tipo" },
  { key: "concepto", header: "concepto" },
  { key: "monto", header: "monto", numero: true },
  { key: "contraparte", header: "contraparte" },
  { key: "pedidoId", header: "pedido_id" },
  { key: "cotizacionId", header: "cotizacion_id" },
  { key: "gastoFijoId", header: "gasto_fijo_id" },
  { key: "deudaId", header: "deuda_id" },
  { key: "origenAbonoId", header: "origen_abono_id" },
  { key: "origenGastoFijoPeriodo", header: "origen_gasto_fijo_periodo" },
  { key: "origenComisionCotId", header: "origen_comision_cotizacion_id" },
  { key: "origenComisionPedidoId", header: "origen_comision_pedido_id" },
  { key: "origenGastoId", header: "origen_gasto_real_id" },
  { key: "esInsumo", header: "es_compra_insumo" },
  { key: "proveedorId", header: "proveedor_id" },
  { key: "insumoNombre", header: "insumo_nombre" }
]);

export var tablaClientes = crearTablaSheet("Clientes", [
  { key: "id", header: "id" },
  { key: "nombre", header: "nombre" },
  { key: "cedula", header: "cedula" },
  { key: "direccion", header: "direccion" },
  { key: "ciudad", header: "ciudad" },
  { key: "cp", header: "codigo_postal" },
  { key: "cuenta", header: "cuenta_bancaria" },
  { key: "entidad", header: "entidad_bancaria" },
  { key: "telefono", header: "telefono" },
  { key: "correo", header: "correo" },
  { key: "contactResourceName", header: "google_contacts_id" },
  { key: "tipoRelacion", header: "tipo_relacion" },
  { key: "comisionDefaultTipo", header: "comision_tipo" },
  { key: "comisionDefaultValor", header: "comision_valor", numero: true },
  { key: "roster", header: "roster_json", json: true, jsonDefault: function () { return []; } },
  { key: "categoriasInsumo", header: "categorias_insumo_json", json: true, jsonDefault: function () { return []; } },
  { key: "descripcion", header: "descripcion" },
  { key: "puntuacion", header: "puntuacion", numero: true },
  { key: "preciosPorInsumo", header: "precios_por_insumo_json", json: true, jsonDefault: function () { return []; } }
], {
  // El estado usa comisionDefault:{tipo,valor}|null (solo aplica a puntos de
  // consignación) — se aplana a dos columnas planas para la Sheet y se
  // reconstruye al leer, en vez de forzar una columna JSON para dos campos
  // simples.
  pre: function (c) {
    return Object.assign({}, c, {
      comisionDefaultTipo: c.comisionDefault ? c.comisionDefault.tipo : "",
      comisionDefaultValor: c.comisionDefault ? c.comisionDefault.valor : ""
    });
  },
  post: function (c) {
    var out = Object.assign({}, c);
    out.comisionDefault = (c.tipoRelacion === "punto_consignacion" && c.comisionDefaultTipo)
      ? { tipo: c.comisionDefaultTipo, valor: c.comisionDefaultValor }
      : null;
    delete out.comisionDefaultTipo;
    delete out.comisionDefaultValor;
    return out;
  }
});
