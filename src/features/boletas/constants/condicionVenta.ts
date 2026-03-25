/** Etiqueta en formularios (más clara que “condición de venta” contable SUNAT). */
export const FORMA_PAGO_EMISION_LABEL = "Forma de pago";

/** Opciones de “Cond. Venta” en el PDF del panel (y metadato en Firestore). apisunat puede ignorar campos no documentados. */
export const CONDICION_VENTA_OPTIONS = [
  "Contado",
  "Transferencia",
  "Yape / Plin",
  "Depósito / otro banco",
  "Crédito",
  "Otros",
] as const;

export type CondicionVentaOption = (typeof CONDICION_VENTA_OPTIONS)[number];

export const CONDICION_VENTA_DEFAULT: CondicionVentaOption = "Contado";

export function normalizeCondicionVentaInput(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return (CONDICION_VENTA_OPTIONS as readonly string[]).includes(s) ? s : CONDICION_VENTA_DEFAULT;
}
