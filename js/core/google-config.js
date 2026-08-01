// Configuración de la integración con Google (login + Sheets como base de
// datos). Ninguno de estos dos valores es secreto: el Client ID de una app
// web siempre queda visible en el navegador, y el ID de la spreadsheet no
// da acceso por sí solo (lo controla a quién se le compartió la hoja en
// Google Drive). Completa ambos después de hacer el setup en Google Cloud
// Console + crear la Google Sheet (ver README para los pasos exactos).

// OAuth Client ID (tipo "Web application"), desde Google Cloud Console →
// APIs & Services → Credentials. Orígenes autorizados: este dominio de
// Netlify + tu servidor local de desarrollo.
export const GOOGLE_CLIENT_ID = "934965200548-8ft5rk4lu06m45g5k5pgu31n9n408uq1.apps.googleusercontent.com";

// ID de la Google Sheet que actúa como base de datos compartida (se ve en su
// URL: https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit). Debe
// tener dos pestañas: "kv" (columnas key, value) y "roles" (columnas correo,
// rol, vendedor_nombre).
export const SPREADSHEET_ID = "1piZGAqi3F0YP5becUPT0mX_yMyAkXFnX4v8wfiXv9DY";

// Scopes pedidos en un solo consentimiento. El scope de Drive es el amplio
// ("drive", no "drive.file"): un vendedor necesita poder escribir dentro de
// la carpeta compartida del admin, que él no creó — "drive.file" no permite
// eso, solo ve archivos que el propio usuario creó/abrió con esta app (ver
// core/drive.js para el porqué). Gmail/Calendar/Contacts se agregan acá
// cuando se aborden esas fases (cada scope nuevo pide un nuevo
// consentimiento la próxima vez que el usuario inicie sesión).
//
// "drive" es un scope "sensible" de Google: mientras la pantalla de
// consentimiento OAuth siga en modo Testing (ver README) no hace falta
// verificación, pero si en algún momento pasan a modo "En producción" con
// más de 100 usuarios, Google va a pedir verificar la app para este scope.
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive email profile";
