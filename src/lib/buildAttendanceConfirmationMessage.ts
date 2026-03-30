import { diffCalendarDays, getHourLima, getTodayDateStringLima } from "@/lib/limaCalendar";
import { isPeruPublicHoliday } from "@/lib/peruHolidays";

function greetingForLimaHour(now = new Date()): string {
  const h = getHourLima(now);
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

/**
 * Texto para WhatsApp: confirmación de asistencia / alquiler.
 * - Mañana / pasado mañana si aplica (Lima).
 * - Si no: "el Jueves 02/04" (sin "(fin de semana)").
 * - "(feriado)" solo si es feriado (Perú).
 */
export function buildAttendanceConfirmationMessage(reservationDateIso: string, now = new Date()): string {
  const todayLima = getTodayDateStringLima(now);
  const delta = diffCalendarDays(todayLima, reservationDateIso);
  const holiday = isPeruPublicHoliday(reservationDateIso);
  const holidaySuffix = holiday ? " (feriado)" : "";

  let datePhrase: string;
  if (delta === 1) {
    datePhrase = `mañana${holidaySuffix}`;
  } else if (delta === 2) {
    datePhrase = `pasado mañana${holidaySuffix}`;
  } else {
    const d = new Date(`${reservationDateIso}T12:00:00-05:00`);
    const weekday = d
      .toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long" })
      .replace(/^\w/, (c) => c.toUpperCase());
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
    }).formatToParts(d);
    const dd = parts.find((p) => p.type === "day")?.value ?? "";
    const mm = parts.find((p) => p.type === "month")?.value ?? "";
    datePhrase = `el ${weekday} ${dd}/${mm}${holidaySuffix}`;
  }

  return `${greetingForLimaHour(now)}, ${datePhrase} va a alquilar con normalidad?`;
}
