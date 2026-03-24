/**
 * Configuración del servidor WAHA (solo servidor / API routes).
 * Requiere en entorno: WAHA_URL, WAHA_API_KEY.
 * Opcional: WAHA_SESSION (nombre de sesión; por defecto "default").
 *
 * QR (documentación WAHA): GET {WAHA_URL}/api/{WAHA_SESSION}/auth/qr
 */
function normalizeWahaBaseUrl(raw: string | undefined): string {
  let u = (raw ?? "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

export const WAHA_URL = normalizeWahaBaseUrl(process.env.WAHA_URL);
export const WAHA_API_KEY = (process.env.WAHA_API_KEY ?? "").trim();
export const WAHA_SESSION = (process.env.WAHA_SESSION ?? "default").trim() || "default";

export function isWahaConfigured(): boolean {
  return Boolean(WAHA_URL && WAHA_API_KEY);
}

/** Mensaje para respuestas API cuando faltan variables de entorno. */
export const WAHA_ENV_MISSING =
  "Faltan WAHA_URL o WAHA_API_KEY en el entorno (p. ej. .env local o Vercel → Environment Variables).";
