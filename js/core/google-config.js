// Configuración de la integración con Google (login + Sheets como base de
// datos). Ninguno de estos dos valores es secreto: el Client ID de una app
// web siempre queda visible en el navegador, y el ID de la spreadsheet no
// da acceso por sí solo (lo controla a quién se le compartió la hoja en
// Google Drive). Completa ambos después de hacer el setup en Google Cloud
// Console + crear la Google Sheet (ver README para los pasos exactos).

// OAuth Client ID (tipo "Web application"), desde Google Cloud Console →
// APIs & Services → Credentials. Orígenes autorizados: este dominio de
// Netlify + tu servidor local de desarrollo.
export const GOOGLE_CLIENT_ID = "947994612739-6q7pmf5eup74fn5hs0vleo8g4jbdptv7.apps.googleusercontent.com";

// ID de la Google Sheet que actúa como base de datos compartida (se ve en su
// URL: https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit). Debe
// tener dos pestañas: "kv" (columnas key, value) y "roles" (columnas correo,
// rol, vendedor_nombre).
export const SPREADSHEET_ID = "1SSBqFwsCQJ_TiGxMq7bB0hEV8k_aoj6CKQFByq_wYpk";

// Scopes pedidos en un solo consentimiento. Fase 1 solo necesita Sheets +
// identificar el correo de quien entra; Drive/Gmail/Calendar/Contacts se
// agregan acá cuando se aborden esas fases (cada scope nuevo pide un nuevo
// consentimiento la próxima vez que el usuario inicie sesión).
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/spreadsheets email profile";
