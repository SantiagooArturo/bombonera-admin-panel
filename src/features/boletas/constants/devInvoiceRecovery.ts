/**
 * El panel de recuperación SUNAT solo se muestra con `localStorage.devMode === "true"`.
 * Esas peticiones llevan esta cabecera; la API la exige (no sustituye auth del panel).
 */
export const INVOICE_RECOVERY_DEV_MODE_HEADER = "x-bombonera-invoice-devmode";
export const INVOICE_RECOVERY_DEV_MODE_VALUE = "1";
