/**
 * Configuración del servidor WAHA (solo servidor / API routes).
 * Requiere: WAHA_URL, WAHA_API_KEY. Opcional: WAHA_SESSION (default "default").
 *
 * Importante: leer `process.env` con getters en cada uso, no en constantes de módulo;
 * si no, en Next.js a veces quedan vacías en dev/build al inlining.
 *
 * QR: GET {getWahaUrl()}/api/{getWahaSession()}/auth/qr
 */
function normalizeWahaBaseUrl(raw: string | undefined): string {
  let u = (raw ?? "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

export function getWahaUrl(): string {
  return normalizeWahaBaseUrl(process.env.WAHA_URL);
}

export function getWahaApiKey(): string {
  return (process.env.WAHA_API_KEY ?? "").trim();
}

export function getWahaSession(): string {
  const s = (process.env.WAHA_SESSION ?? "default").trim();
  return s || "default";
}

export function isWahaConfigured(): boolean {
  return Boolean(getWahaUrl() && getWahaApiKey());
}

/** Mensaje para respuestas API cuando faltan variables de entorno. */
export const WAHA_ENV_MISSING =
  "Faltan WAHA_URL o WAHA_API_KEY en el entorno (p. ej. .env local o Vercel → Environment Variables).";
