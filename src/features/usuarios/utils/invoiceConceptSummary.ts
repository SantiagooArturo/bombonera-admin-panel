import { COURT_LABELS, type CourtType, type Invoice } from "@/lib/types";

/** Texto de concepto / descripción legible para UI (no siempre hay `descripcion` en Firestore). */
export function invoiceConceptSummary(inv: Invoice): string {
  if (inv.descripcion?.trim()) return inv.descripcion.trim();
  if (inv.reservation_id === "manual") return "Emisión manual · servicios diversos";
  const parts: string[] = [];
  if (inv.date) {
    try {
      const d = new Date(inv.date + "T12:00:00");
      parts.push(
        d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      );
    } catch {
      parts.push(inv.date);
    }
  }
  const ct = inv.court_type as CourtType | undefined;
  if (ct && COURT_LABELS[ct]) parts.push(COURT_LABELS[ct]);
  if (parts.length) return parts.join(" · ");
  return "Comprobante SUNAT";
}
