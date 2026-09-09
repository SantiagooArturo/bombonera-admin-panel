import {
  diffPeruCalendarDays,
  getPeruHour,
  getPeruTodayYmd,
} from "./peruTime";

/** Fecha calendario YYYY-MM-DD en zona America/Lima. */
export function getTodayDateStringLima(now?: Date): string {
  return getPeruTodayYmd(now);
}

/** Hora 0–23 en America/Lima. */
export function getHourLima(now?: Date): number {
  return getPeruHour(now);
}

/**
 * Diferencia en días calendario: toIso - fromIso (ej. reserva vs hoy Lima).
 * Ambas cadenas YYYY-MM-DD. Puro calendario (no depende del TZ del runtime).
 */
export function diffCalendarDays(fromIso: string, toIso: string): number {
  return diffPeruCalendarDays(fromIso, toIso);
}
