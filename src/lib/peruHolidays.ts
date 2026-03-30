/**
 * Feriados no laborables comunes a nivel nacional (recurrentes por mes-día).
 * No incluye feriados locales ni días decretados puntualmente.
 */
const FIXED_HOLIDAY_MD = new Set([
  "01-01",
  "05-01",
  "06-29",
  "07-28",
  "07-29",
  "08-30",
  "10-08",
  "11-01",
  "12-08",
  "12-25",
]);

/** Jueves y Viernes Santo (fechas ISO explícitas por año). */
const EASTER_LONG_WEEKEND_ISO = new Set([
  "2024-03-28",
  "2024-03-29",
  "2025-04-17",
  "2025-04-18",
  "2026-04-02",
  "2026-04-03",
  "2027-03-25",
  "2027-03-26",
  "2028-04-13",
  "2028-04-14",
]);

/** true si la fecha YYYY-MM-DD es feriado relevante para el copy "(feriado)". */
export function isPeruPublicHoliday(isoDate: string): boolean {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return false;
  const m = parts[1]?.padStart(2, "0");
  const d = parts[2]?.padStart(2, "0");
  if (!m || !d) return false;
  const md = `${m}-${d}`;
  if (FIXED_HOLIDAY_MD.has(md)) return true;
  if (EASTER_LONG_WEEKEND_ISO.has(isoDate)) return true;
  return false;
}
