import type { Invoice } from "@/lib/types";
import { canRenderFormalPlantillaFromDoc } from "@/features/boletas/pdf/formalPlantillaEligibility";

export function invoiceFormalPdfProxyHref(fileUrl: string): string {
  return `/api/proxy-file?url=${encodeURIComponent(fileUrl)}`;
}

function invAsDoc(inv: Invoice): Record<string, unknown> {
  return inv as unknown as Record<string, unknown>;
}

/** Comprobantes emitidos vía API SUNAT con datos completos en Firestore. */
export function canRenderFormalPlantillaOnTheFly(inv: Invoice): boolean {
  return canRenderFormalPlantillaFromDoc(invAsDoc(inv));
}

/**
 * PDF **personalizado del panel** (misma vista que al emitir): formal-pdf al vuelo o archivo en Storage vía proxy.
 * Usar en vistas previas, descargas y WhatsApp.
 */
export function invoicePlantillaPdfHref(inv: Invoice): string | null {
  if (canRenderFormalPlantillaOnTheFly(inv)) {
    return `/api/invoices/formal-pdf?id=${encodeURIComponent(inv.id)}`;
  }
  if (inv.file_url?.trim()) {
    return invoiceFormalPdfProxyHref(inv.file_url.trim());
  }
  return null;
}

export const invoicePersonalizedPdfHref = invoicePlantillaPdfHref;

/**
 * URL absoluta para `/api/invoices/send` (el bot hace GET). Si la plantilla es ruta interna, antepone `window.location.origin`.
 */
export function invoicePersonalizedPdfAbsoluteUrlForSend(inv: Invoice): string | null {
  const href = invoicePlantillaPdfHref(inv);
  if (!href?.trim()) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (typeof window === "undefined") return null;
  return `${window.location.origin}${href.startsWith("/") ? href : `/${href}`}`;
}

/**
 * PDF ticket **oficial apisunat** — sin uso en UI (marzo 2026); implementación viva para revivir enlaces rápido.
 *
 * Para reactivar: descomentar bloques en `BoletasPage.tsx` y `UserPaymentsDrawer.tsx`.
 */
export function invoiceSunatPdfHref(inv: Invoice): string | null {
  if (inv.file_url_sunat?.trim()) {
    return invoiceFormalPdfProxyHref(inv.file_url_sunat.trim());
  }
  if (inv.sunat_pdf_ticket?.trim()) {
    return `/api/invoices/sunat-pdf?id=${encodeURIComponent(inv.id)}`;
  }
  return null;
}
