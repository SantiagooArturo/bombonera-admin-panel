import type { Invoice } from "@/lib/types";

export type InvoiceUiStatus = "aprobado" | "pendiente" | "anulado" | "rechazado";

export function getInvoiceUiStatus(inv: Invoice): InvoiceUiStatus {
  const invStatus = String(inv.status || "").trim().toLowerCase();
  if (invStatus === "voided") return "anulado";
  const st = String(inv.sunat_estado || "").trim().toUpperCase();
  if (st === "ACEPTADO") return "aprobado";
  if (st === "PENDIENTE" || st === "ANULANDO") return "pendiente";
  return "rechazado";
}

export function invoiceIsVigenteForExport(inv: Invoice): boolean {
  const s = getInvoiceUiStatus(inv);
  return s === "aprobado" || s === "pendiente" || s === "anulado";
}
