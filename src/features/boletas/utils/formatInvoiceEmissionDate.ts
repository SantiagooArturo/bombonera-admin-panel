import type { Invoice } from "@/lib/types";

/** Fecha de emisión legible (Lima) desde ISO `created_at`. */
export function formatInvoiceEmissionDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Lima",
  });
}

/** Fecha de emisión para mostrar en tabla. Usa fecha_emision_ymd (SUNAT) primero, igual que el Excel. */
export function invoiceEmissionDateDisplay(inv: Invoice): string {
  const ymd = String(inv.fecha_emision_ymd || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  }
  return formatInvoiceEmissionDate(inv.created_at);
}
