import type { Invoice } from "@/lib/types";

const VOID_MOTIVO = "ANULACIÓN DE OPERACIÓN";

/** Copia del comprobante con campos de anulación (ya guardados en Firestore por la API). */
export function mergeInvoiceVoided(inv: Invoice, sunat_estado?: string | null): Invoice {
  return {
    ...inv,
    status: "voided",
    voided_at: new Date().toISOString(),
    void_motivo: VOID_MOTIVO,
    sunat_estado: sunat_estado !== undefined ? sunat_estado : inv.sunat_estado ?? null,
  };
}
