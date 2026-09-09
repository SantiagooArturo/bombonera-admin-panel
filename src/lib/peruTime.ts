/**
 * Módulo central y única fuente de la verdad para fecha y hora en todo el sistema.
 * El complejo deportivo está ubicado en Lima, Perú (America/Lima, UTC-5).
 * NUNCA se debe depender del reloj físico o zona horaria de la laptop o dispositivo del usuario.
 */

let serverClockOffsetMs: number | null = null;
let syncStarted = false;

/**
 * Calibra el reloj del cliente contra el reloj oficial del servidor.
 */
export function syncServerTime(serverTimestampMs: number): void {
  serverClockOffsetMs = serverTimestampMs - Date.now();
}

/**
 * Inicia la sincronización automática en el navegador si aún no se ha hecho.
 */
export function ensureServerTimeSync(): void {
  if (typeof window === "undefined" || syncStarted) return;
  syncStarted = true;
  fetch("/api/time", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      if (typeof data?.serverTime === "number") {
        syncServerTime(data.serverTime);
      }
    })
    .catch(() => {
      syncStarted = false;
    });
}

// En el navegador, sincronizar en segundo plano al cargar el módulo
if (typeof window !== "undefined") {
  ensureServerTimeSync();
}

/**
 * Retorna un objeto Date corregido según la hora oficial del servidor.
 */
export function getPeruNow(): Date {
  if (serverClockOffsetMs !== null) {
    return new Date(Date.now() + serverClockOffsetMs);
  }
  return new Date();
}

/**
 * Retorna la fecha de hoy en Perú en formato YYYY-MM-DD (America/Lima).
 */
export function getPeruTodayYmd(now = getPeruNow()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

/**
 * Retorna la hora actual en Perú en formato HH:mm (24 horas).
 */
export function getPeruTimeHm(now = getPeruNow()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(now);
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const m = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/**
 * Retorna la hora actual en Perú en formato HH:mm:ss (24 horas).
 */
export function getPeruTimeHms(now = getPeruNow()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(now);
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const m = p.find((x) => x.type === "minute")?.value ?? "00";
  const s = p.find((x) => x.type === "second")?.value ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
}

/**
 * Retorna la hora entera (0 a 23) en hora oficial de Lima, Perú.
 */
export function getPeruHour(now = getPeruNow()): number {
  const h = now.toLocaleString("en-GB", {
    timeZone: "America/Lima",
    hour: "numeric",
    hour12: false,
  });
  return Number.parseInt(h, 10);
}

/**
 * Convierte un objeto Date a YYYY-MM-DD usando exclusivamente la zona horaria de Lima, Perú.
 */
export function formatPeruDateISO(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

/**
 * Diferencia en días calendario: toIso - fromIso (ej. reserva vs hoy Lima).
 * Ambas cadenas YYYY-MM-DD.
 */
export function diffPeruCalendarDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map((x) => Number.parseInt(x, 10));
  const [ty, tm, td] = toIso.split("-").map((x) => Number.parseInt(x, 10));
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}
