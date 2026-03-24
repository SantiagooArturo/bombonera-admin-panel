export type VoidSunatInvoiceResult =
  | { success: true; sunat_estado?: string | null; message?: string }
  | { success: false; error: string };

export async function voidSunatInvoice(
  invoiceId: string,
  motivo = "ANULACIÓN DE OPERACIÓN"
): Promise<VoidSunatInvoiceResult> {
  const res = await fetch("/api/invoices/void", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoice_id: invoiceId, motivo }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    sunat_estado?: string | null;
    message?: string;
  };
  if (!res.ok) {
    return { success: false, error: typeof data?.error === "string" ? data.error : "No se pudo anular el comprobante" };
  }
  return {
    success: true,
    sunat_estado: data.sunat_estado,
    message: typeof data?.message === "string" ? data.message : undefined,
  };
}
