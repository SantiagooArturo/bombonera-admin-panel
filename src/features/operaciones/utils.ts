import { TIME_SLOTS, type Reservation, type User } from "@/lib/types";
import { isHoliday } from "@/lib/feriados-peru";
import { type CourtFieldConfig, getFullFieldConfig } from "@/lib/court-config";

export const MAX_DAY_OFFSET = 14;

export const BLOCK_REASONS = [
  "Mantenimiento",
  "Evento privado",
  "Clima / lluvia",
  "Otro",
] as const;

export const FIELD_TO_COURT_TYPE: Record<number, Reservation["court_type"]> = {
  1: "voley_6v6",
  2: "voley_6v6",
  3: "voley_6v6",
  4: "voley_basket_6v6",
  5: "voley_5v5",
  6: "voley_5v5",
  7: "voley_5v5",
  8: "voley_6v6",
  9: "voley_basket_5v5",
  10: "voley_6v6",
  11: "voley_6v6",
  12: "voley_6v6",
};

export function getCurrentSlot(): string {
  const hour = new Date().getHours();
  const slot = `${hour}:00`;
  return TIME_SLOTS.includes(slot) ? slot : TIME_SLOTS[0];
}

export function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getDateWithOffset(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

export function formatHour12(slot: string) {
  const h = parseInt(slot.split(":")[0], 10);
  if (h === 0) return "12 am";
  if (h < 12) return `${h} am`;
  if (h === 12) return "12 pm";
  return `${h - 12} pm`;
}

export function getEndSlotOptions(startSlot: string): string[] {
  const startIdx = TIME_SLOTS.indexOf(startSlot);
  if (startIdx === -1) return [];
  const options = TIME_SLOTS.slice(startIdx + 1);
  options.push("23:00");
  return options;
}

export function getSlotsInRange(startSlot: string, endSlot: string): string[] {
  const startIdx = TIME_SLOTS.indexOf(startSlot);
  const endIdx = endSlot === "23:00" ? TIME_SLOTS.length : TIME_SLOTS.indexOf(endSlot);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return [];
  return TIME_SLOTS.slice(startIdx, endIdx);
}

export function getUserPhone(u: User): string {
  return (u.phone_number || u.chat_id || "").replace(/\D/g, "");
}

/** Normaliza a formato Perú (51 + 9 dígitos) para comparación consistente. */
export function normalizePeruPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.startsWith("51")) return digits;
  return `51${digits}`.slice(0, 11);
}

/** Indica si es un número válido para WAHA (9 dígitos Perú o 11 con 51). */
export function isValidPeruPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 9 || (digits.startsWith("51") && digits.length === 11);
}

/** Para mostrar en UI: siempre sin 51. Nunca mostrar el prefijo al usuario. */
export function formatDisplayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("51")) return digits.slice(2);
  return digits;
}

/** URL de WhatsApp para abrir chat (siempre con prefijo 51 para Perú). */
export function wspLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const forWa = digits.startsWith("51") ? digits : `51${digits}`;
  return `https://wa.me/${forWa}?text=.`;
}

/**
 * Número Perú normalizado (51 + 9 dígitos) solo si es válido.
 * Prioriza `phone_number` guardado; evita usar id/chat_id de WAHA que no sean un móvil peruano.
 */
export function userWhatsAppPhone(u: {
  phone_number?: string;
  chat_id?: string;
  id?: string;
}): string | null {
  if (u.phone_number) {
    const n = normalizePeruPhone(u.phone_number);
    if (isValidPeruPhone(n)) return n;
  }
  for (const raw of [u.chat_id, u.id]) {
    if (raw == null || raw === "") continue;
    const digitsOnly = String(raw).replace(/@.*$/, "").replace(/\D/g, "");
    const n = normalizePeruPhone(digitsOnly);
    if (isValidPeruPhone(n)) return n;
  }
  return null;
}

export function getUserName(u: User): string {
  return (
    u.custom_name ||
    u.contact_name ||
    u.push_name ||
    u.last_representative_name ||
    "Sin nombre"
  ).trim();
}

/** Etiqueta en listas / buscador de clientes (sin dígitos en el nombre mostrado; sin “Voley”). */
export function sanitizeDirectoryClientLabel(raw: string): string {
  const t = raw
    .replace(/\d+/g, "")
    .replace(/\bvoley\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 0 ? t : "Cliente";
}

export type CourtConfigMap = Record<
  number,
  {
    price_day_weekday: number;
    price_day_weekend: number;
    price_day_holiday: number;
    price_night_weekday: number;
    price_night_weekend: number;
    price_night_holiday: number;
  }
>;

/** Convierte CourtFieldConfig[] a CourtConfigMap para calculateReservationPrice. */
export function courtConfigsToMap(configs: CourtFieldConfig[] | null | undefined): CourtConfigMap | undefined {
  if (!configs?.length) return undefined;
  const map: CourtConfigMap = {};
  for (const c of configs) {
    map[c.field] = {
      price_day_weekday: c.price_day_weekday,
      price_day_weekend: c.price_day_weekend,
      price_day_holiday: c.price_day_holiday,
      price_night_weekday: c.price_night_weekday,
      price_night_weekend: c.price_night_weekend,
      price_night_holiday: c.price_night_holiday,
    };
  }
  return map;
}

export function calculateReservationPrice(
  field: number,
  dateStr: string,
  time_slots: string[],
  configMap?: CourtConfigMap
): number {
  if (!time_slots || time_slots.length === 0) return 0;

  const date = new Date(dateStr + "T12:00:00");
  const day = date.getDay(); // 0 = Domingo, 6 = Sábado
  const isWeekend = day === 0 || day === 6;
  const isHolidayDate = isHoliday(dateStr);

  const cfg = configMap?.[field] ?? getFullFieldConfig(field);
  let total = 0;
  for (const slot of time_slots) {
    const hour = parseInt(slot.split(":")[0], 10);
    const isNight = hour >= 18;

    if (isNight) {
      total += isHolidayDate ? cfg.price_night_holiday : isWeekend ? cfg.price_night_weekend : cfg.price_night_weekday;
    } else {
      total += isHolidayDate ? cfg.price_day_holiday : isWeekend ? cfg.price_day_weekend : cfg.price_day_weekday;
    }
  }
  return total;
}
