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

/** Forma de pago para la que el panel permite detallar banco y cuenta en el PDF formal. */
export const CONDICION_VENTA_DEPOSITO_CUENTA: CondicionVentaOption = "Depósito / otro banco";

const MAX_FORMA_PAGO_BANCO = 120;
const MAX_FORMA_PAGO_CUENTA = 100;

/**
 * Solo persiste banco/cuenta emisor si la condición normalizada es depósito (evita datos huérfanos en otros pagos).
 */
export function normalizeFormaPagoDepositoFields(
  condicionVentaNormalizada: string,
  bancoRaw: unknown,
  cuentaRaw: unknown
): { banco: string; cuenta: string } {
  if (condicionVentaNormalizada !== CONDICION_VENTA_DEPOSITO_CUENTA) {
    return { banco: "", cuenta: "" };
  }
  const banco = typeof bancoRaw === "string" ? bancoRaw.trim().slice(0, MAX_FORMA_PAGO_BANCO) : "";
  const cuenta = typeof cuentaRaw === "string" ? cuentaRaw.trim().slice(0, MAX_FORMA_PAGO_CUENTA) : "";
  return { banco, cuenta };
}

export function normalizeCondicionVentaInput(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return (CONDICION_VENTA_OPTIONS as readonly string[]).includes(s) ? s : CONDICION_VENTA_DEFAULT;
}
