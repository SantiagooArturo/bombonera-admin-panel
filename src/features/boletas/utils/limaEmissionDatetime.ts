import {
  getPeruNow,
  getPeruTimeHm,
  getPeruTimeHms,
  getPeruTodayYmd,
} from "@/lib/peruTime";

/** Fecha local Lima en formato AAAA-MM-DD (para <input type="date">). */
export function getLimaTodayYmd(): string {
  return getPeruTodayYmd();
}

/** Hora Lima HH:mm para <input type="time">. */
export function getLimaNowTimeHm(): string {
  return getPeruTimeHm();
}

export function getLimaNowHms(): string {
  return getPeruTimeHms();
}

/**
 * Valida fecha/hora de emisión para SUNAT (huso Lima, Perú).
 *
 * REGLA ESTRICTA:
 * - Para emisiones de hoy (o si no se indica fecha), la hora de emisión SIEMPRE es la
 *   hora oficial actual de Lima generada en el servidor (getPeruTimeHms).
 *   Bajo ningún concepto se utiliza la hora del dispositivo o laptop del cliente para hoy.
 * - Para fechas anteriores (retroactivas permitidas por SUNAT), se puede admitir la hora indicada o por defecto la actual.
 * - Fechas futuras para hoy o después de hoy quedan prohibidas por normativa SUNAT.
 */
export function validateEmissionDateTimeForApi(
  fechaInput: string | undefined,
  horaInput: string | undefined
): { fechaEmision: string; horaEmision: string } | { error: string } {
  const todayLima = getPeruTodayYmd();
  const nowHms = getPeruTimeHms();

  const fRaw = typeof fechaInput === "string" ? fechaInput.trim() : "";
  const fecha = fRaw || todayLima;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "Fecha inválida. Use el formato AAAA-MM-DD." };
  }

  const [y, mo, da] = fecha.split("-").map(Number);
  const check = new Date(Date.UTC(y, mo - 1, da));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) {
    return { error: "Fecha inválida." };
  }

  if (fecha > todayLima) {
    return { error: "La fecha de emisión no puede ser después de hoy (hora de Lima)." };
  }

  // Si la fecha es hoy: SIEMPRE la hora oficial actual de Lima en el servidor.
  // Esto garantiza que SUNAT jamás rechace el comprobante por desfase de reloj del cliente.
  if (fecha === todayLima) {
    return { fechaEmision: todayLima, horaEmision: nowHms };
  }

  // Emisión con fecha anterior (permitida por SUNAT para regularizaciones):
  const hRaw = typeof horaInput === "string" ? horaInput.trim() : "";
  let hora: string;
  if (hRaw) {
    let hnorm = hRaw;
    if (hnorm.length === 5 && /^\d{2}:\d{2}$/.test(hnorm)) {
      hnorm = `${hnorm}:00`;
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(hnorm)) {
      hora = nowHms;
    } else {
      const [hh, mm, ss] = hnorm.split(":").map((x) => parseInt(x, 10));
      if (hh > 23 || mm > 59 || ss > 59) {
        hora = nowHms;
      } else {
        hora = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
    }
  } else {
    hora = nowHms;
  }

  return { fechaEmision: fecha, horaEmision: hora };
}
