// Íconos de línea, minimalistas, en SVG inline (sin dependencias externas).
// Todos comparten viewBox 24x24 y usan currentColor para heredar el color
// del elemento padre (así el ícono se colorea solo al activar/hover el ítem).

var S = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

export var ICONS = {
  resumen: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 21V10.5L12 4l8 6.5V21"/><path d="M9.5 21v-7h5v7"/></svg>',
  finanzas: '<svg viewBox="0 0 24 24" ' + S + '><rect x="3" y="6.5" width="18" height="12" rx="2.2"/><path d="M3 10.2h18"/><circle cx="16.7" cy="14.7" r="1.15" fill="currentColor" stroke="none"/></svg>',
  pedidos: '<svg viewBox="0 0 24 24" ' + S + '><path d="M12 3.3 20.5 8 12 12.7 3.5 8 12 3.3Z"/><path d="M3.5 8v8.2L12 20.9l8.5-4.7V8"/><path d="M12 12.7V20.9"/></svg>',
  cotizaciones: '<svg viewBox="0 0 24 24" ' + S + '><path d="M13.5 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V8.1L13.5 3Z"/><path d="M13.3 3v4.6a1 1 0 0 0 1 1H18.6"/><path d="M8.4 13h7.2M8.4 16.2h7.2M8.4 9.8h3"/></svg>',
  catalogo: '<svg viewBox="0 0 24 24" ' + S + '><rect x="3.3" y="3.3" width="7.2" height="7.2" rx="1.3"/><rect x="13.5" y="3.3" width="7.2" height="7.2" rx="1.3"/><rect x="3.3" y="13.5" width="7.2" height="7.2" rx="1.3"/><rect x="13.5" y="13.5" width="7.2" height="7.2" rx="1.3"/></svg>',
  plantillas: '<svg viewBox="0 0 24 24" ' + S + '><rect x="7.5" y="7.5" width="13.2" height="13.2" rx="1.8"/><path d="M16.7 7.5V5.3A1.8 1.8 0 0 0 14.9 3.5H4.9A1.8 1.8 0 0 0 3.1 5.3v10a1.8 1.8 0 0 0 1.8 1.8h2.6"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="9.2" cy="8.4" r="3.4"/><path d="M2.8 20c0-3.4 2.9-6 6.4-6s6.4 2.6 6.4 6"/><circle cx="17.3" cy="9.3" r="2.6"/><path d="M15 14.4c2.7 0 5.6 1.7 5.9 5.6"/></svg>',
  pendientes: '<svg viewBox="0 0 24 24" ' + S + '><rect x="3.5" y="4" width="17" height="17" rx="2.2"/><path d="M7.5 12.2l2.7 2.7 6-6.4"/></svg>',
  notas: '<svg viewBox="0 0 24 24" ' + S + '><path d="M6 3.6h9.4L18.4 7v13.4H6z"/><path d="M15 3.6V7.4h3.4"/><path d="M8.6 12h6.8M8.6 15.4h6.8M8.6 8.6h3"/></svg>',
  config: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="3"/><path d="M12 3.6v2.3M12 18.1v2.3M20.4 12h-2.3M5.9 12H3.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6M17.5 17.5l-1.6-1.6M8.1 8.1 6.5 6.5"/></svg>'
};
