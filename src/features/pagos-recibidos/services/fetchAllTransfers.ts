import type { Transfer } from "@/lib/types";

/** Lista todos los pagos (`GET /api/transfers?list=all`), más recientes primero. */
export async function fetchAllTransfers(): Promise<Transfer[]> {
  const res = await fetch("/api/transfers?list=all");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = typeof err?.error === "string" ? err.error : "No se pudieron cargar los pagos.";
    throw new Error(msg);
  }
  return (await res.json()) as Transfer[];
}
