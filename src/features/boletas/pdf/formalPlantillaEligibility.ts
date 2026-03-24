/** Solo heurísticas (sin react-pdf / qrcode) — seguro importar desde componentes cliente. */

export function parseSerieCorrelativoFromDoc(doc: Record<string, unknown>): { serie: string; correlativo: number } | null {
  const serie = typeof doc.serie === "string" ? doc.serie.trim() : "";
  const cor = doc.correlativo;
  if (serie && typeof cor === "number" && Number.isFinite(cor) && cor >= 1) {
    return { serie, correlativo: cor };
  }
  const raw = typeof doc.serie_correlativo === "string" ? doc.serie_correlativo.trim() : "";
  if (!raw) return null;
  const idx = raw.lastIndexOf("-");
  if (idx <= 0) return null;
  const s = raw.slice(0, idx).trim();
  const n = parseInt(raw.slice(idx + 1).replace(/\D/g, "") || "0", 10);
  if (!s || !Number.isFinite(n) || n < 1) return null;
  return { serie: s, correlativo: n };
}

/** Comprobantes SUNAT emitidos desde el panel (no PDF adjunto manual). */
export function canRenderFormalPlantillaFromDoc(doc: Record<string, unknown>): boolean {
  const status = String(doc.status || "");
  if (status === "attached") return false;
  const amount = typeof doc.amount === "number" ? doc.amount : Number(doc.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return parseSerieCorrelativoFromDoc(doc) != null;
}
