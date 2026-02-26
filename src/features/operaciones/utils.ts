import { TIME_SLOTS, type Reservation, type User } from "@/lib/types";

export const MAX_DAY_OFFSET = 7;

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

export function getUserName(u: User): string {
  return (u.custom_name || u.contact_name || u.last_representative_name || "Sin nombre").trim();
}

export function calculateReservationPrice(field: number, dateStr: string, time_slots: string[]): number {
  if (!time_slots || time_slots.length === 0) return 0;

  const date = new Date(dateStr + "T12:00:00");
  const day = date.getDay(); // 0 = Domingo, 6 = Sábado
  const isWeekend = day === 0 || day === 6;

  let total = 0;
  for (const slot of time_slots) {
    const hour = parseInt(slot.split(":")[0], 10);
    const isNight = hour >= 18;

    if (field === 9) {
      total += isNight ? 60 : 40;
    } else {
      if (isNight) {
        total += 100;
      } else {
        total += isWeekend ? 80 : 70;
      }
    }
  }
  return total;
}
