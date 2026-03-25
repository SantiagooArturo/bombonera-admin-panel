/** Fecha local Lima en formato AAAA-MM-DD (para <input type="date">). */
export function getLimaTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

/** Hora Lima HH:mm para <input type="time">. */
export function getLimaNowTimeHm(): string {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(d);
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const m = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

function getLimaNowHms(): string {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(d);
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const m = p.find((x) => x.type === "minute")?.value ?? "00";
  const s = p.find((x) => x.type === "second")?.value ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
}

function timeToSec(t: string): number {
  const [h, m, s] = t.split(":").map((x) => parseInt(x, 10) || 0);
  return h * 3600 + m * 60 + s;
}

/**
 * Valida fecha/hora de emisión para SUNAT (huso Lima).
 * Si no vienen, usa ahora en Lima.
 * No limitamos cuán antigua puede ser la fecha: SUNAT/apisunat decidirán si la rechazan.
 */
export function validateEmissionDateTimeForApi(
  fechaInput: string | undefined,
  horaInput: string | undefined
): { fechaEmision: string; horaEmision: string } | { error: string } {
  const todayLima = getLimaTodayYmd();

  const fRaw = typeof fechaInput === "string" ? fechaInput.trim() : "";
  const hRaw = typeof horaInput === "string" ? horaInput.trim() : "";

  if (!fRaw && !hRaw) {
    return { fechaEmision: todayLima, horaEmision: getLimaNowHms() };
  }

  const fecha = fRaw || todayLima;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "Fecha inválida. Use el calendario (formato AAAA-MM-DD)." };
  }

  const [y, mo, da] = fecha.split("-").map(Number);
  const check = new Date(Date.UTC(y, mo - 1, da));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) {
    return { error: "Fecha inválida." };
  }

  if (fecha > todayLima) {
    return { error: "La fecha de emisión no puede ser después de hoy (hora de Lima)." };
  }

  let hora: string;
  if (hRaw) {
    let hnorm = hRaw;
    if (hnorm.length === 5 && /^\d{2}:\d{2}$/.test(hnorm)) {
      hnorm = `${hnorm}:00`;
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(hnorm)) {
      return { error: "Hora inválida (use 24 horas, ej. 15:30)." };
    }
    const [hh, mm, ss] = hnorm.split(":").map((x) => parseInt(x, 10));
    if (hh > 23 || mm > 59 || ss > 59) {
      return { error: "Hora inválida." };
    }
    hora = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  } else {
    hora = getLimaNowHms();
  }

  if (fecha === todayLima && timeToSec(hora) > timeToSec(getLimaNowHms())) {
    return { error: "Para hoy no puede indicar una hora futura (Lima)." };
  }

  return { fechaEmision: fecha, horaEmision: hora };
}
