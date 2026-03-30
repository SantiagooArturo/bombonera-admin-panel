/** Fecha calendario YYYY-MM-DD en zona America/Lima. */
export function getTodayDateStringLima(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

/** Hora 0–23 en America/Lima. */
export function getHourLima(now = new Date()): number {
  const h = now.toLocaleString("en-GB", { timeZone: "America/Lima", hour: "numeric", hour12: false });
  return Number.parseInt(h, 10);
}

/**
 * Diferencia en días calendario: toIso - fromIso (ej. reserva vs hoy Lima).
 * Ambas cadenas YYYY-MM-DD. Puro calendario (no depende del TZ del runtime).
 */
export function diffCalendarDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map((x) => Number.parseInt(x, 10));
  const [ty, tm, td] = toIso.split("-").map((x) => Number.parseInt(x, 10));
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}
