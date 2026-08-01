// Constantes globales de la aplicación.
// Cambiar aquí (ej. agregar un nuevo estado de producción) se refleja en toda la app.

// Lista de estados de producción por defecto, como pares {id,label}. Es la
// base de la que parte cualquier cotización/pedido nuevo — pero ahora es
// editable por cotización (ver cotizaciones.js: c.estadosDef) y se puede
// guardar como plantilla reutilizable (state.plantillasEstados), porque no
// todas las prendas pasan por las mismas etapas.
export const ESTADOS_DEFAULT = [
  { id: "nuevo", label: "Nuevo" },
  { id: "cortado", label: "Cortado" },
  { id: "confeccion", label: "Confección" },
  { id: "acabados", label: "Acabados" },
  { id: "entregado", label: "Entregado" }
];

export const ESTADOS = ESTADOS_DEFAULT.map(function (e) { return e.id; });

export const ESTADO_LABEL = ESTADOS_DEFAULT.reduce(function (acc, e) { acc[e.id] = e.label; return acc; }, {});

// Claves usadas en window.storage. Un JSON por área de negocio: así una escritura
// en "pedidos" nunca reescribe (ni arriesga corromper) los datos de "finanzas".
export const PERIODOS_PAGO = {
  mensual: "Mensual",
  quincenal: "Quincenal",
  semanal: "Semanal"
};

// Días de la semana para elegir "día de pago" cuando el periodo es semanal
// (ej. la nómina se paga los sábados). Usa el mismo índice que Date#getDay().
export const DIAS_SEMANA = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 0: "Domingo" };

export const KEYS = {
  config: "config:datos",
  configNombreLegacy: "config:nombre",
  tx: "finanzas:transacciones",
  txPapelera: "finanzas:papelera",
  pedidos: "pedidos:lista",
  pedidosPapelera: "pedidos:papelera",
  clientes: "clientes:lista",
  cotizaciones: "cotizaciones:lista",
  pendientes: "pendientes:lista", // notas (tareas / mejoras del negocio)
  deudas: "pendientes:deudas", // deudas del taller (apartado "Pendientes"), solo las AÚN pendientes
  deudasHistorial: "pendientes:deudas-historial", // deudas que ya se pagaron por completo (se mueven aquí, no quedan en "deudas")
  catalogoInsumos: "cotizaciones:catalogo",
  catalogoCategorias: "cotizaciones:catalogo-categorias",
  plantillasPrendas: "cotizaciones:plantillas",
  plantillasEstados: "cotizaciones:plantillas-estados",
  pdfContador: "cotizaciones:pdf-contador",
  ui: "ui:preferencias",
  catalogoPropuestas: "cotizaciones:catalogo-propuestas" // cambios de catálogo hechos por un vendedor, a la espera de aprobación del admin
};

// Claves de `state` que, si las edita alguien con rol "vendedor", no se
// guardan directo — quedan como propuesta pendiente de aprobación del admin
// (ver proponerCambio() en store.js). El catálogo define el costo de
// producción de todo el taller, por eso un cambio ahí no se toma a la
// ligera aunque el vendedor sí pueda seguir usando su edición en el momento.
export const APPROVAL_REQUIRED_KEYS = ["catalogoInsumos", "catalogoCategorias"];

// Preferencias de interfaz (menú lateral): colapsado sí/no y qué categorías
// del menú quedan abiertas. Se persiste igual que cualquier otra área de datos.
export const DEFAULT_UI = {
  sidebarCollapsed: false,
  tema: "oscuro", // "oscuro" | "claro"
  navGroups: { general: true, ventas: true, produccion: true, gestion: true, sistema: true }
};

export const DEFAULT_CONFIG = {
  nombre: "Mi Taller",
  // Ícono del taller: emoji/texto corto, o un link a imagen (empieza con http/data:).
  // Se ve en el sidebar y, si está definido, también en el PDF de cotización.
  logoUrl: "",
  nomina: [],
  numExtra: 0,
  // Cada cuánto pagas la nómina: cambia cómo se calcula el KPI "Nómina pendiente"
  // (los salarios se definen siempre en valor MENSUAL en el listado de nómina).
  periodoPago: "mensual", // "mensual" | "quincenal" | "semanal"
  // Día(s) de pago dentro del periodo (ej. nómina "los sábados", o "el 1 y el
  // 15"). Vacío = sin día específico (se usa el fin del periodo como antes).
  diasPagoNomina: [],
  diaPagoNomina: "", // legado (un solo día) — se sigue leyendo si diasPagoNomina está vacío
  // Gastos fijos recurrentes del taller (arriendo, servicios, internet, etc.),
  // separados de los movimientos puntuales que se registran en Finanzas. Cada
  // gasto define su propio periodo (ya no todo es mensual) y guarda en qué
  // periodo se marcó pagado por última vez (ver periodoKey en core/calc.js).
  gastosFijos: [], // { id, nombre, monto, periodo, pagadoHasta }
  // Meta con periodo graduable (antes solo existía "Meta de fin de mes").
  meta: { label: "Meta de balance neto", monto: 0, periodo: "mensual" },
  // Datos de facturación/PDF (aparecen como "DE" en la cotización para el cliente).
  nit: "",
  direccion: "",
  ciudad: "",
  telefono: "",
  // Carpeta de Drive (en la cuenta del admin) donde caen las imágenes de
  // referencia que suba cualquiera (admin o vendedor) — ver core/drive.js.
  // Vacío hasta que el admin sube la primera imagen (ahí se crea).
  driveFolderId: ""
};

// Formas de calcular el costo por prenda de un insumo dentro de una referencia.
// "ayuda" se muestra tal cual en la pestaña Catálogo para que quede claro qué hace cada tipo.
export const TIPOS_COSTO = {
  tela: { label: "Tela (según consumo)", ayuda: "costo = costo × consumo aprox. de la referencia × cantidad" },
  fijo_pedido: { label: "Fijo por pedido", ayuda: "costo = costo total ÷ cantidad de prendas del pedido" },
  por_prenda: { label: "Fijo por prenda", ayuda: "costo = costo × cantidad indicada" }
};
