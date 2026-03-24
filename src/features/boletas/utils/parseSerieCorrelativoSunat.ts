/** Parsea "B001-00012" o "F001-192" → serie + correlativo sin ceros a la izquierda (como espera apisunat). */
export function parseSerieCorrelativoSunat(raw: string | undefined | null): { serie: string; numero: string } | null {
  const s = String(raw || "").trim();
  const m = s.match(/^(.+)-(\d+)$/);
  if (!m) return null;
  const serie = m[1]?.trim();
  const numRaw = m[2];
  if (!serie || numRaw === undefined) return null;
  return { serie, numero: String(parseInt(numRaw, 10)) };
}
