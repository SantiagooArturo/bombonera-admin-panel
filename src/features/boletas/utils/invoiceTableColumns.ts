import type { Invoice } from "@/lib/types";
import { formatDisplayPhone } from "@/features/operaciones/utils";
import { sanitizeReceptorNombre } from "./sanitizeReceptorNombre";

/**
 * Texto para columna **Receptor**: primero datos SUNAT guardados al emitir;
 * si faltan (histórico), solo entonces el snapshot del nombre en la reserva (misma persona, no es WhatsApp ni concepto).
 * Aplica limpieza de “Voley” y dígitos en nombres (histórico sin migrar).
 */
export function invoiceReceptorOnly(inv: Invoice): string {
  const nameRaw = inv.cliente_denominacion?.trim() ?? "";
  const name = nameRaw ? sanitizeReceptorNombre(nameRaw) || nameRaw : "";
  const doc = inv.cliente_numero_de_documento?.trim() ?? "";
  if (name && doc) return `${name} · ${doc}`;
  if (name) return name;
  if (doc) return doc;
  const snapRaw = inv.representative_name_snapshot?.trim() ?? "";
  const snap = snapRaw ? sanitizeReceptorNombre(snapRaw) || snapRaw : "";
  if (snap) return snap;
  return "";
}

/** Concepto / ítems tal como en el comprobante (`descripcion` en Firestore). */
export function invoiceDescripcionOnly(inv: Invoice): string {
  return inv.descripcion?.trim() ?? "";
}

/** Teléfono guardado en el comprobante (contacto para envío WSP, no es el receptor SUNAT). */
export function invoiceTelefonoDisplay(inv: Invoice): string {
  const raw = inv.phone_number?.trim() ?? "";
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 9) return formatDisplayPhone(raw);
  return raw;
}
