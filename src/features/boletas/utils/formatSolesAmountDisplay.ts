/**
 * Importe para UI: sin decimales si son .00 (ej. 80); con coma decimal en es-PE si hay centavos.
 */
export function formatSolesAmountDisplay(amount: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "0";
  const cents = Math.round(n * 100);
  if (cents % 100 === 0) {
    return String(cents / 100);
  }
  return (cents / 100).toLocaleString("es-PE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
