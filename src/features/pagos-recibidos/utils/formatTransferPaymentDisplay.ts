import type { Transfer } from "@/lib/types";

/**
 * Fecha/hora mostrada: si el admin indicó día y hora del abono, se usa eso (Lima, 12 h);
 * si no, la fecha/hora de registro en el sistema (`created_at`).
 */
export function formatTransferPaymentDisplay(t: Transfer): string {
  const date = t.transaction_date?.trim();
  const time = t.transaction_time?.trim();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && time && /^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) {
    const [hh, mm] = time.split(":");
    const d = new Date(`${date}T${String(hh).padStart(2, "0")}:${mm}:00-05:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }
  const iso = t.created_at;
  if (!iso) return "—";
  const cr = new Date(iso);
  if (Number.isNaN(cr.getTime())) return "—";
  return cr.toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
