/** Configuración del servidor WAHA (solo uso en servidor / API routes). */
const DEFAULT_WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";

export const WAHA_URL = process.env.WAHA_URL || DEFAULT_WAHA_URL;
export const WAHA_API_KEY = process.env.WAHA_API_KEY || "MiClaveSegura123";
export const WAHA_SESSION = process.env.WAHA_SESSION || "default";
