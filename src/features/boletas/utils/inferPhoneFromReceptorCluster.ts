/**
 * Infiere `phone_number` al recuperar boletas SUNAT: SUNAT no trae WhatsApp, pero si el receptor
 * coincide (exacto o por palabras significativas) con otra boleta de la misma serie que sí tiene
 * teléfono, reutilizamos ese número. Si hay varios números distintos posibles, no adivinamos.
 */

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeReceptorForMatch(raw: string): string {
  return stripDiacritics(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras con las que hacemos subsecuencia (evita ruido tipo "R" suelto salvo que sea lo único). */
export function significantTokens(normalizedLine: string): string[] {
  const parts = normalizedLine.split(" ").filter(Boolean);
  const longOnes = parts.filter((w) => w.length >= 3);
  if (longOnes.length > 0) return longOnes;
  return parts.filter((w) => w.length >= 2);
}

function tokenSubsequenceWordMatch(hayWords: string[], candTokens: string[]): boolean {
  if (candTokens.length === 0) return false;
  let ci = 0;
  for (const hw of hayWords) {
    if (ci < candTokens.length && hw === candTokens[ci]) ci++;
  }
  return ci === candTokens.length;
}

export type InvoiceRowForPhoneMatch = {
  phone_number?: unknown;
  cliente_denominacion?: unknown;
  representative_name_snapshot?: unknown;
};

function rowHayWords(row: InvoiceRowForPhoneMatch): string[] {
  const cli = String(row.cliente_denominacion || "").trim();
  const snap = String(row.representative_name_snapshot || "").trim();
  const line = normalizeReceptorForMatch(`${cli} ${snap}`);
  return line.split(" ").filter(Boolean);
}

export type ReceptorPhoneMatchKind = "exact" | "fuzzy";

/**
 * `exact`: mismo nombre normalizado en `cliente_denominacion` o en `representative_name_snapshot` solo.
 * `fuzzy`: las palabras significativas del receptor recuperado aparecen en orden en la unión
 * (cliente + snapshot), p. ej. PEDRO + RAMIREZ en "DIANA LANEGRA PEDRO RAMIREZ".
 */
export function receptorPhoneMatchKind(
  candidateCliente: string,
  row: InvoiceRowForPhoneMatch
): ReceptorPhoneMatchKind | null {
  const cand = normalizeReceptorForMatch(candidateCliente);
  if (!cand) return null;
  const clin = normalizeReceptorForMatch(String(row.cliente_denominacion || "").trim());
  const sn = normalizeReceptorForMatch(String(row.representative_name_snapshot || "").trim());
  if (clin && cand === clin) return "exact";
  if (sn && cand === sn) return "exact";
  const hayWords = rowHayWords(row);
  const candTokens = significantTokens(cand);
  if (candTokens.length >= 2 && tokenSubsequenceWordMatch(hayWords, candTokens)) return "fuzzy";
  if (candTokens.length === 1 && candTokens[0]!.length >= 8 && hayWords.includes(candTokens[0]!)) {
    return "fuzzy";
  }
  return null;
}

function normalizeStoredPhone(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\D/g, "");
}

type Hit = { norm: string; display: string; exact: boolean };

/**
 * @param existingDocs documentos ya en Firestore para la misma serie (p. ej. resultado del snapshot de `invoices`).
 */
export function inferPhoneFromInvoiceDocsForRecovery(
  existingDocs: Array<{ data: () => Record<string, unknown> }>,
  candidateClienteName: string
): { phone: string; fromExact: boolean } | null {
  const cand = candidateClienteName.trim();
  if (cand.length < 2) return null;

  const hits: Hit[] = [];
  for (const d of existingDocs) {
    const row = d.data() as InvoiceRowForPhoneMatch;
    const display = String(row.phone_number ?? "").trim();
    const norm = normalizeStoredPhone(row.phone_number);
    if (norm.length < 8) continue;

    const kind = receptorPhoneMatchKind(cand, row);
    if (kind === "exact") hits.push({ norm, display, exact: true });
    else if (kind === "fuzzy") hits.push({ norm, display, exact: false });
  }

  const exactHits = hits.filter((h) => h.exact);
  const exactNorms = new Set(exactHits.map((h) => h.norm));
  if (exactNorms.size === 1) {
    return { phone: exactHits[0]!.display, fromExact: true };
  }
  if (exactNorms.size > 1) return null;

  const fuzzyHits = hits.filter((h) => !h.exact);
  const fuzzyNorms = new Set(fuzzyHits.map((h) => h.norm));
  if (fuzzyNorms.size === 1) {
    return { phone: fuzzyHits[0]!.display, fromExact: false };
  }
  return null;
}
