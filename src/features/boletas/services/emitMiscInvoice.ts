export type EmitMiscInvoiceParams = {
  tipo_comprobante: "boleta" | "factura";
  cliente_denominacion: string;
  descripcion: string;
  amount: number;
  /** Factura: RUC 11 dígitos. Boleta: DNI 8 dígitos si el cliente lo indica (opcional si monto ≤ tope). */
  doc_num?: string;
  /** AAAA-MM-DD (Lima) */
  fecha_de_emision?: string;
  /** HH:mm (Lima) */
  hora_de_emision?: string;
};

export type EmitMiscInvoiceResult = {
  success: boolean;
  invoice_id?: string;
  file_url?: string;
  serie_correlativo?: string;
  error?: string;
};

/**
 * Emisión desde panel (ventas del día, misc.) sin cliente/reserva.
 * Boleta: DNI opcional si monto ≤ tope legal; si supera, API exige DNI u otra vía. Factura: RUC obligatorio.
 */
export async function emitMiscInvoice(params: EmitMiscInvoiceParams): Promise<EmitMiscInvoiceResult> {
  const body: Record<string, unknown> = {
    manual: true,
    misc_emission: true,
    tipo_comprobante: params.tipo_comprobante,
    amount: params.amount,
    cliente_denominacion: params.cliente_denominacion.trim(),
    descripcion: params.descripcion.trim(),
    representative_name: params.cliente_denominacion.trim(),
    court_type: "",
    field: null,
    date: "",
    time_slots: [],
    transfer_id: null,
  };
  const cleanDoc = String(params.doc_num || "").replace(/\D/g, "");
  if (params.tipo_comprobante === "factura") {
    body.doc_num = cleanDoc;
  } else if (cleanDoc.length > 0) {
    body.doc_num = cleanDoc;
  }
  if (params.fecha_de_emision?.trim()) body.fecha_de_emision = params.fecha_de_emision.trim();
  if (params.hora_de_emision?.trim()) body.hora_de_emision = params.hora_de_emision.trim();

  const res = await fetch("/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as EmitMiscInvoiceResult & { error?: string };
  if (!res.ok) {
    return { success: false, error: typeof data?.error === "string" ? data.error : "Error al emitir" };
  }
  return {
    success: true,
    invoice_id: typeof data.invoice_id === "string" ? data.invoice_id : undefined,
    file_url: typeof data.file_url === "string" ? data.file_url : undefined,
    serie_correlativo: typeof data.serie_correlativo === "string" ? data.serie_correlativo : undefined,
  };
}
