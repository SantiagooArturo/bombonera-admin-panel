/**
 * Transfer sintético: emisión SUNAT sin `transfer_id`; el cobro manual se crea después con el monto del comprobante.
 * No debe persistirse en Firestore ni enviarse tal cual a POST /api/invoices (el cliente lo omite como transfer_id).
 */
export const TRANSFER_ID_EMIT_THEN_REGISTER_PAYMENT = "__emit_then_register_payment__";
