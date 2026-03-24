import type { Invoice } from "@/lib/types";

const WIN_INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Primer “token” del receptor, solo ASCII seguro para nombre de archivo. */
function slugPrimeroNombre(raw: string | undefined | null, maxLen: number): string {
  const token = (raw ?? "").trim().split(/\s+/)[0] ?? "";
  const deaccent = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ascii = deaccent.replace(/[^a-zA-Z0-9]/g, "").slice(0, maxLen).toLowerCase();
  return ascii || "comprobante";
}

function slugCodigo(serieCorrelativo: string | undefined | null, fallbackId: string, maxLen: number): string {
  const sc = (serieCorrelativo ?? "").trim();
  const base = sc
    ? sc.replace(WIN_INVALID, "_").replace(/\s+/g, "_")
    : fallbackId.replace(WIN_INVALID, "_").replace(/\s+/g, "_").slice(0, 12);
  const trimmed = base.slice(0, maxLen).replace(/_+$/g, "") || "sin-codigo";
  return trimmed.toLowerCase();
}

export type ComprobantePdfFilenameParams = {
  receptorNombre: string;
  tipo: "boleta" | "factura";
  serieCorrelativo: string;
  fallbackId: string;
};

/**
 * Ej.: `juan_boleta_b001-00012.pdf` — corto, sin caracteres raros, apto para Windows/macOS.
 */
export function buildComprobantePdfFilename(params: ComprobantePdfFilenameParams): string {
  const nombre = slugPrimeroNombre(params.receptorNombre, 18);
  const codigo = slugCodigo(params.serieCorrelativo, params.fallbackId, 26);
  return `${nombre}_${params.tipo}_${codigo}.pdf`;
}

export function buildComprobantePdfFilenameFromFirestoreDoc(
  invoiceId: string,
  doc: Record<string, unknown>
): string {
  const tipo: "boleta" | "factura" = doc.tipo_comprobante === "factura" ? "factura" : "boleta";
  const den =
    (typeof doc.cliente_denominacion === "string" && doc.cliente_denominacion.trim()) ||
    (typeof doc.representative_name_snapshot === "string" && doc.representative_name_snapshot.trim()) ||
    "";
  const serie = typeof doc.serie_correlativo === "string" ? doc.serie_correlativo.trim() : "";
  return buildComprobantePdfFilename({
    receptorNombre: den,
    tipo,
    serieCorrelativo: serie,
    fallbackId: invoiceId,
  });
}

/** Para atributo `download` en enlaces y coherencia con el PDF generado. */
export function invoiceComprobantePdfDownloadFilename(inv: Invoice): string {
  return buildComprobantePdfFilename({
    receptorNombre:
      inv.cliente_denominacion?.trim() || inv.representative_name_snapshot?.trim() || "",
    tipo: inv.tipo_comprobante === "factura" ? "factura" : "boleta",
    serieCorrelativo: inv.serie_correlativo?.trim() || "",
    fallbackId: inv.id,
  });
}
