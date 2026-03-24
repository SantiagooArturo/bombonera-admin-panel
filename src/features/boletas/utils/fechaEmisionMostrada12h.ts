/** dd/mm/aaaa desde YYYY-MM-DD */
export function fechaYmdToDdMmYyyy(fechaYmd: string): string {
  const [y, m, d] = fechaYmd.split("-");
  if (!y || !m || !d) return fechaYmd;
  return `${d}/${m}/${y}`;
}

/**
 * Texto para el PDF: "24/03/2026 10:35 p. m." (12 h, locale es-PE).
 * `hora` admite HH:mm o HH:mm:ss.
 */
export function formatEmision12hPe(fechaYmd: string, horaHms: string): string {
  const fechaStr = fechaYmdToDdMmYyyy(fechaYmd);
  let h = String(horaHms || "").trim();
  if (/^\d{2}:\d{2}$/.test(h)) h = `${h}:00`;
  const [hhRaw, mmRaw, ssRaw] = h.split(":").map((x) => parseInt(x, 10) || 0);
  const d = new Date();
  d.setHours(hhRaw, mmRaw, ssRaw || 0, 0);
  const time12 = d.toLocaleTimeString("es-PE", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fechaStr} ${time12}`;
}
