export type SyncPendingInvoiceStatusesResult = {
  success: boolean;
  total_pending: number;
  checked: number;
  updated: number;
  skipped: number;
  failed: number;
};

export async function syncPendingInvoiceStatuses(): Promise<SyncPendingInvoiceStatusesResult> {
  const res = await fetch("/api/invoices/sync-pending-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as Partial<SyncPendingInvoiceStatusesResult> & { error?: string };
  if (!res.ok || data.success !== true) {
    throw new Error(data.error || "No se pudo sincronizar estados pendientes.");
  }
  return {
    success: true,
    total_pending: Number(data.total_pending || 0),
    checked: Number(data.checked || 0),
    updated: Number(data.updated || 0),
    skipped: Number(data.skipped || 0),
    failed: Number(data.failed || 0),
  };
}

