import type { Invoice } from "@/lib/types";

/** Lista todos los comprobantes (`GET /api/invoices?list=all`), más recientes primero. */
export async function fetchAllInvoices(): Promise<Invoice[]> {
  const res = await fetch("/api/invoices?list=all");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = typeof err?.error === "string" ? err.error : "No se pudieron cargar los comprobantes.";
    throw new Error(msg);
  }
  return (await res.json()) as Invoice[];
}
