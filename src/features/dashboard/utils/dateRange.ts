/** Formato YYYY-MM-DD */
export function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function getToday(): string {
  return toDateStr(new Date());
}

export type DateRangePreset = "hoy" | "ayer" | "7dias" | "mes" | "personalizado";

export interface DateRange {
  start: string;
  end: string;
  preset: DateRangePreset;
}

export function getDateRangeForPreset(preset: DateRangePreset): { start: string; end: string } {
  const now = new Date();
  const today = toDateStr(now);

  switch (preset) {
    case "hoy":
      return { start: today, end: today };
    case "ayer": {
      const ayer = new Date(now);
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = toDateStr(ayer);
      return { start: ayerStr, end: ayerStr };
    }
    case "7dias": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { start: toDateStr(start), end: today };
    }
    case "mes": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: toDateStr(start), end: today };
    }
    default:
      return { start: today, end: today };
  }
}

export function isDateInRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}

export function isTodayRange(start: string, end: string): boolean {
  const today = getToday();
  return start === today && end === today;
}
