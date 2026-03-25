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
  condicion_venta?: string;
  /** Si el comprobante va dirigido a un usuario del panel: id doc `users` y WhatsApp normalizado (validado en API). */
  panel_link_user_id?: string;
  panel_link_phone?: string;
  /** Factura: dirección fiscal del receptor (SUNAT / PDF). */
  cliente_direccion?: string;
  forma_pago_banco?: string;
  forma_pago_cuenta?: string;
};

export type EmitMiscInvoiceResult = {
  success: boolean;
  invoice_id?: string;
  file_url?: string;
  file_url_sunat?: string;
  file_url_xml?: string;
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
  if (params.condicion_venta?.trim()) body.condicion_venta = params.condicion_venta.trim();
  if (params.panel_link_user_id?.trim() && params.panel_link_phone?.trim()) {
    body.panel_link_user_id = params.panel_link_user_id.trim();
    body.panel_link_phone = params.panel_link_phone.trim();
  }
  if (params.tipo_comprobante === "factura" && params.cliente_direccion?.trim()) {
    body.cliente_direccion = params.cliente_direccion.trim();
  }
  if (params.forma_pago_banco?.trim()) body.forma_pago_banco = params.forma_pago_banco.trim();
  if (params.forma_pago_cuenta?.trim()) body.forma_pago_cuenta = params.forma_pago_cuenta.trim();

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
    file_url_xml: typeof data.file_url_xml === "string" ? data.file_url_xml : undefined,
    serie_correlativo: typeof data.serie_correlativo === "string" ? data.serie_correlativo : undefined,
  };
}
