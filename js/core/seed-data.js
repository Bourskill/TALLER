// Datos de ejemplo con los que arrancan el Catálogo de insumos y las Plantillas
// de prendas la primera vez (si no hay nada guardado todavía en storage). Son un
// punto de partida editable, no valores fijos del sistema.

import { uid } from "./utils.js";

export function catalogoInsumosDefault() {
  return [
    { id: uid(), nombre: "Tela lisa", unidad: "MT", costo: 8000, tipo: "tela" },
    { id: uid(), nombre: "Sublimación", unidad: "MT", costo: 6500, tipo: "tela" },
    { id: uid(), nombre: "Corte", unidad: "MT", costo: 3500, tipo: "tela" },
    { id: uid(), nombre: "Confección", unidad: "UND", costo: 3000, tipo: "por_prenda" },
    { id: uid(), nombre: "Hilo e hilaza", unidad: "UND", costo: 500, tipo: "por_prenda" },
    { id: uid(), nombre: "Empaque", unidad: "UND", costo: 500, tipo: "por_prenda" },
    { id: uid(), nombre: "Diseño", unidad: "UND", costo: 20000, tipo: "fijo_pedido" },
    { id: uid(), nombre: "Domicilio", unidad: "UND", costo: 10000, tipo: "fijo_pedido" }
  ];
}

// Las plantillas de ejemplo nacen CON categoría: sin ella caían todas bajo el
// chip "Sin categoría" y, en el primer arranque, los filtros por categoría de
// la pestaña no se entendían (un solo chip, sin nada que comparar).
function plantillaInsumo(nombre, unidad, costo, tipo, cantidad) {
  return { id: uid(), nombre: nombre, unidad: unidad, costo: costo, tipo: tipo, cantidad: cantidad || 1 };
}

export function plantillasPrendasDefault() {
  return [
    {
      id: uid(), nombre: "T-shirt básica", categoria: "Camisetas", consumoSugerido: 1.1, insumos: [
        plantillaInsumo("Tela lisa", "MT", 8000, "tela"),
        plantillaInsumo("Confección", "UND", 3000, "por_prenda"),
        plantillaInsumo("Hilo e hilaza", "UND", 500, "por_prenda"),
        plantillaInsumo("Empaque", "UND", 500, "por_prenda")
      ]
    },
    {
      id: uid(), nombre: "Manga ranglán", categoria: "Camisetas", consumoSugerido: 1.3, insumos: [
        plantillaInsumo("Tela lisa", "MT", 8000, "tela"),
        plantillaInsumo("Confección", "UND", 3500, "por_prenda"),
        plantillaInsumo("Hilo e hilaza", "UND", 600, "por_prenda"),
        plantillaInsumo("Empaque", "UND", 500, "por_prenda")
      ]
    },
    {
      id: uid(), nombre: "Polo", categoria: "Polos", consumoSugerido: 1.4, insumos: [
        plantillaInsumo("Tela lisa", "MT", 8000, "tela"),
        plantillaInsumo("Confección", "UND", 4500, "por_prenda"),
        plantillaInsumo("Hilo e hilaza", "UND", 600, "por_prenda"),
        plantillaInsumo("Empaque", "UND", 500, "por_prenda")
      ]
    }
  ];
}
