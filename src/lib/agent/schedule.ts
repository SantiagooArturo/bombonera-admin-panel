/**
 * Horarios, disponibilidad e imagen de cuadrícula (port de utils/tools/tool_show_schedule.py).
 * La imagen se genera como SVG y se rasteriza a PNG con @resvg/resvg-js usando una
 * tipografía empacada (DejaVuSans.ttf), para que el texto renderice igual en Vercel (Linux),
 * donde no hay fuentes del sistema.
 */
import { getDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { existsSync } from "fs";
import path from "path";
import { isHoliday } from "@/lib/feriados-peru";
import { getCourtConfigByField, normalizeCourtSize } from "@/lib/agent/court-config";

let _fontPath: string | null | undefined;
function fontFilePath(): string | null {
  if (_fontPath !== undefined) return _fontPath;
  const p = path.join(process.cwd(), "src", "lib", "agent", "assets", "DejaVuSans.ttf");
  if (existsSync(p)) {
    _fontPath = p;
  } else {
    console.warn(`No se encontró la tipografía en ${p}; se usará la fuente del sistema.`);
    _fontPath = null;
  }
  return _fontPath;
}

export const ALL_FIELDS = Array.from({ length: 12 }, (_, i) => i + 1);
export const RESPUESTA_OBLIGATORIA_MSG_PREFIX = "RESPUESTA_OBLIGATORIA_MSG: ";

// 8:00 a 22:00, slots de 1 hora. Sin cero a la izquierda (paridad con Python).
export const ALL_TIME_SLOTS = [
  "8:00", "9:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
  "19:00", "20:00", "21:00", "22:00",
];

export const DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const MAX_ADVANCE_DAYS = 13;
export const LIMIT_BOT_ADVANCE_DAYS = 6;
const LIMA_OFFSET_MS = 5 * 3600 * 1000; // UTC-5 fijo (Lima no usa DST)
const PENDING_EXPIRY_SECONDS = 1800;

function envFlagIsTrue(name: string, def = false): boolean {
  const raw = process.env[name];
  if (raw == null) return def;
  return ["1", "true", "yes", "on", "si", "sí"].includes(String(raw).trim().toLowerCase());
}

export function isAfter6pmBlockEnabled(): boolean {
  // Producción Railway lo tenía activo; default ON, configurable por env.
  return envFlagIsTrue("BLOCK_RESERVATIONS_AFTER_6PM", true);
}

export function isSlotBlockedByPolicy(timeSlot: string): boolean {
  if (!isAfter6pmBlockEnabled()) return false;
  const hour = parseInt(String(timeSlot).split(":")[0], 10);
  if (Number.isNaN(hour)) return false;
  return hour >= 18;
}

/** Date con componentes en hora de Lima leídos vía getUTC*. */
export function nowLima(): Date {
  return new Date(Date.now() - LIMA_OFFSET_MS);
}

function parseDateUTC(fullDate: string): Date {
  const [y, m, d] = fullDate.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** weekday estilo Python: lunes=0 ... domingo=6 */
function pythonWeekday(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

export function getDayNameFromDate(fullDate: string): string {
  return DAYS[pythonWeekday(parseDateUTC(fullDate))];
}

export function formatDateForUser(fullDate: string): string {
  const d = parseDateUTC(fullDate);
  return `${DAY_NAMES[pythonWeekday(d)]} ${d.getUTCDate()} de ${MONTH_NAMES[d.getUTCMonth()]}`;
}

export function formatTime12h(time24h: string): string {
  const [h, mRaw] = time24h.split(":");
  const hour = parseInt(h, 10);
  const min = mRaw || "00";
  if (hour === 0) return `12:${min} am`;
  if (hour < 12) return `${hour}:${min} am`;
  if (hour === 12) return `12:${min} pm`;
  return `${hour - 12}:${min} pm`;
}

export function isSlotInPast(fullDate: string, timeSlot: string): boolean {
  const now = nowLima();
  const [y, m, d] = fullDate.split("-").map(Number);
  const hour = parseInt(timeSlot.split(":")[0], 10);
  // slotStart en componentes Lima (UTC getters)
  const slotStart = new Date(Date.UTC(y, (m || 1) - 1, d || 1, hour, 0, 0));
  return now.getTime() > slotStart.getTime();
}

function isPendingStillActive(createdAt: unknown): boolean {
  if (!createdAt) return false;
  let createdMs: number;
  if (createdAt instanceof Timestamp) createdMs = createdAt.toDate().getTime();
  else if (createdAt instanceof Date) createdMs = createdAt.getTime();
  else if (typeof createdAt === "object" && createdAt !== null && "toDate" in createdAt) {
    createdMs = (createdAt as { toDate: () => Date }).toDate().getTime();
  } else {
    const d = new Date(String(createdAt).replace("Z", "+00:00"));
    createdMs = d.getTime();
  }
  if (Number.isNaN(createdMs)) return false;
  return (Date.now() - createdMs) / 1000 < PENDING_EXPIRY_SECONDS;
}

export function reservationBlocksAvailabilitySlot(data: Record<string, unknown>): boolean {
  const status = (data.status as string) || "pending";
  if (status === "confirmed" || status === "paid") return true;
  if (status !== "pending") return false;
  if (data.manual_pending) return true;
  return isPendingStillActive(data.created_at);
}

/** {slotKey: Set<field>} con campos ocupados para una fecha. */
export async function getAvailabilityByFieldForDate(fullDate: string): Promise<Map<string, Set<number>>> {
  const dayName = getDayNameFromDate(fullDate);
  const slotToTaken = new Map<string, Set<number>>();
  const addTaken = (key: string, field: number) => {
    if (!slotToTaken.has(key)) slotToTaken.set(key, new Set());
    slotToTaken.get(key)!.add(field);
  };

  try {
    const db = getDb();
    const [reservations, blocked] = await Promise.all([
      db.collection("reservations").where("date", "==", fullDate).get(),
      db.collection("blocked-slots").where("date", "==", fullDate).get(),
    ]);

    reservations.forEach((res) => {
      const data = res.data() as Record<string, unknown>;
      if (!reservationBlocksAvailabilitySlot(data)) return;
      const fieldNum = Number(data.field);
      const timeSlots = (data.time_slots as unknown[]) || [];
      if (!Number.isInteger(fieldNum) || fieldNum < 1 || fieldNum > 12 || !timeSlots.length) return;
      for (const ts of timeSlots) addTaken(`${dayName}-${String(ts)}`, fieldNum);
    });

    blocked.forEach((block) => {
      const data = block.data() as Record<string, unknown>;
      const fieldNum = Number(data.field);
      const timeSlot = data.time_slot;
      if (!Number.isInteger(fieldNum) || fieldNum < 1 || fieldNum > 12 || timeSlot == null) return;
      addTaken(`${dayName}-${String(timeSlot)}`, fieldNum);
    });

    // Política 6pm: marcar todas las canchas como ocupadas.
    for (const slot of ALL_TIME_SLOTS) {
      if (!isSlotBlockedByPolicy(slot)) continue;
      const key = `${dayName}-${slot}`;
      const taken = slotToTaken.get(key) || new Set<number>();
      for (const f of ALL_FIELDS) taken.add(f);
      slotToTaken.set(key, taken);
    }

    return slotToTaken;
  } catch (e) {
    console.error("Error getAvailabilityByFieldForDate:", e);
    return slotToTaken;
  }
}

const HOLIDAY_NAMES: Record<string, string> = {
  "01-01": "Año Nuevo",
  "05-01": "Día del Trabajo",
  "06-07": "Batalla de Arica y Día de la Bandera",
  "06-29": "San Pedro y San Pablo",
  "07-23": "Día de la Fuerza Aérea",
  "07-28": "Independencia del Perú",
  "07-29": "Fiestas Patrias",
  "08-06": "Batalla de Junín",
  "08-30": "Santa Rosa de Lima",
  "10-08": "Combate de Angamos",
  "11-01": "Día de Todos los Santos",
  "12-08": "Inmaculada Concepción",
  "12-09": "Batalla de Ayacucho",
  "12-25": "Navidad",
};

export function describePeruHoliday(fullDate: string): string {
  const [, m, d] = fullDate.split("-");
  const key = `${(m || "").padStart(2, "0")}-${(d || "").padStart(2, "0")}`;
  return HOLIDAY_NAMES[key] || "Feriado nacional";
}

export function isoFromLimaOffset(daysAhead: number): string {
  const base = nowLima();
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysAhead));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function formatDatetimeLimaSpanish(): string {
  const now = nowLima();
  const wd = DAY_NAMES[pythonWeekday(now)];
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${wd} ${now.getUTCDate()} de ${MONTH_NAMES[now.getUTCMonth()]} de ${now.getUTCFullYear()}, ${hh}:${mm} (Lima, Perú)`;
}

export function buildHolidaysInBookingWindow(): string {
  const rows: string[] = [];
  for (let i = 0; i <= LIMIT_BOT_ADVANCE_DAYS; i++) {
    const iso = isoFromLimaOffset(i);
    if (!isHoliday(iso)) continue;
    const name = describePeruHoliday(iso);
    const d = parseDateUTC(iso);
    const longHuman = `${DAY_NAMES[pythonWeekday(d)]} ${d.getUTCDate()} de ${MONTH_NAMES[d.getUTCMonth()]}`;
    rows.push(
      `- ${longHuman} (${iso}): ${name}. ` +
        "Cotice con la tarifa de FERIADO o fin de semana de INFORMACIÓN DE CANCHAS Y PRECIOS, no como día hábil L-V."
    );
  }
  if (!rows.length) {
    return (
      "En la ventana de fechas que gestiona este chatbot no cae ningún feriado nacional peruano " +
      `(hoy más ${LIMIT_BOT_ADVANCE_DAYS} días hacia adelante).`
    );
  }
  return "Feriados nacionales (Perú) en esa ventana:\n" + rows.join("\n");
}

/** Resumen técnico de disponibilidad (7 días) para el prompt. */
export async function buildAvailabilityGridSummary(): Promise<string> {
  const courtCfg = await getCourtConfigByField();
  const c6 = Object.entries(courtCfg)
    .filter(([, cfg]) => normalizeCourtSize(cfg.court_size) === "6 vs 6")
    .map(([f]) => Number(f));
  const c5 = Object.entries(courtCfg)
    .filter(([, cfg]) => normalizeCourtSize(cfg.court_size) === "5 vs 5")
    .map(([f]) => Number(f));

  const now = nowLima();
  const summary: string[] = ["### CUADRILLA DE DISPONIBILIDAD TÉCNICA (Analiza esto antes de responder)"];
  summary.push(
    `Última actualización: ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}`
  );

  for (let i = 0; i <= LIMIT_BOT_ADVANCE_DAYS; i++) {
    const iso = isoFromLimaOffset(i);
    const d = parseDateUTC(iso);
    const dayNameShort = getDayNameFromDate(iso);
    const dayNameLong = DAY_NAMES[pythonWeekday(d)];
    const monthName = MONTH_NAMES[d.getUTCMonth()];

    let prefix = "";
    if (i === 0) prefix = "Hoy, ";
    else if (i === 1) prefix = "Mañana, ";

    let fullLabel = `\n📅 Fecha: ${prefix}${dayNameLong} ${d.getUTCDate()} de ${monthName} (${iso})`;
    if (isHoliday(iso)) {
      fullLabel += " — FERIADO nacional (Perú): use tarifa feriado/fin de semana en precios, no L-V hábil.";
    }
    summary.push(fullLabel);

    const occupied = await getAvailabilityByFieldForDate(iso);
    const availableLines: string[] = [];
    const occupiedHours: string[] = [];

    for (const slot of ALL_TIME_SLOTS) {
      const hourInt = parseInt(slot.split(":")[0], 10);
      if (i === 0 && now.getUTCHours() >= hourInt) continue;

      const taken = occupied.get(`${dayNameShort}-${slot}`) || new Set<number>();
      const free6 = c6.filter((f) => !taken.has(f)).length;
      const free5 = c5.filter((f) => !taken.has(f)).length;
      const totalFree = free6 + free5;
      const label12h = formatTime12h(slot);
      if (totalFree > 0) {
        availableLines.push(` - ${label12h.padEnd(8)} -> ✅ LIBRES: ${totalFree} (6v6:${free6} | 5v5:${free5})`);
      } else {
        occupiedHours.push(label12h);
      }
    }

    if (availableLines.length) summary.push(...availableLines);
    else summary.push(" (No hay horarios disponibles para este día)");
    if (occupiedHours.length) summary.push(`❌ OCUPADO TOTALMENTE: ${occupiedHours.join(", ")}`);
  }

  return summary.join("\n");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const HEADER_COLORS: Record<string, { bg: string; border: string }> = {
  "6 vs 6": { bg: "#DBEAFE", border: "#93C5FD" },
  "5 vs 5": { bg: "#FEF3C7", border: "#FCD34D" },
  otro: { bg: "#F3F4F6", border: "#D1D5DB" },
};

/** Genera la imagen JPEG (base64) de la cuadrícula de un día. */
export async function generateDaySchedulePng(fullDate: string): Promise<string | null> {
  try {
    const occupied = await getAvailabilityByFieldForDate(fullDate);
    const courtCfg = await getCourtConfigByField();
    const fieldsForGrid = Object.keys(courtCfg).map(Number).sort((a, b) => a - b);
    const dayName = getDayNameFromDate(fullDate);
    const d = parseDateUTC(fullDate);
    const headerText = `${DAY_NAMES[pythonWeekday(d)]} ${d.getUTCDate()} de ${MONTH_NAMES[d.getUTCMonth()]}`;

    const cellW = 70;
    const cellH = 32;
    const colHeaderH = 50;
    const titleH = 70;
    const timeColW = 80;
    const padding = 12;
    const footerH = 18;
    const rowH = ALL_TIME_SLOTS.length * cellH;

    const totalW = timeColW + cellW * fieldsForGrid.length + padding;
    const totalH = titleH + colHeaderH + rowH + footerH + padding;
    const gridTop = titleH + colHeaderH;

    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`
    );
    parts.push(`<rect width="${totalW}" height="${totalH}" fill="#FFFFFF"/>`);
    parts.push(
      `<text x="${totalW / 2}" y="${titleH / 2}" font-family="DejaVu Sans" font-size="22" font-weight="bold" fill="#111827" text-anchor="middle" dominant-baseline="central">${xmlEscape(headerText)}</text>`
    );

    // Headers de columna
    fieldsForGrid.forEach((fieldNum, colIdx) => {
      const x = timeColW + colIdx * cellW;
      const y = titleH;
      const fieldType = normalizeCourtSize((courtCfg[fieldNum] || {}).court_size);
      const colors = HEADER_COLORS[fieldType] || { bg: "#F3F4F6", border: "#E5E7EB" };
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellW}" height="${colHeaderH}" fill="${colors.bg}" stroke="${colors.border}"/>`
      );
      parts.push(
        `<text x="${x + cellW / 2}" y="${y + colHeaderH / 2 - 7}" font-family="DejaVu Sans" font-size="13" fill="#1F2937" text-anchor="middle" dominant-baseline="central">Cancha ${fieldNum}</text>`
      );
      parts.push(
        `<text x="${x + cellW / 2}" y="${y + colHeaderH / 2 + 10}" font-family="DejaVu Sans" font-size="11" fill="#6B7280" text-anchor="middle" dominant-baseline="central">${xmlEscape(fieldType || "?")}</text>`
      );
    });

    // Filas
    ALL_TIME_SLOTS.forEach((slot, rowIdx) => {
      const y = gridTop + rowIdx * cellH;
      const timeText = formatTime12h(slot);
      parts.push(
        `<text x="${(timeColW - 4) / 2}" y="${y + cellH / 2}" font-family="DejaVu Sans" font-size="12" fill="#374151" text-anchor="middle" dominant-baseline="central">${xmlEscape(timeText)}</text>`
      );

      const taken = occupied.get(`${dayName}-${slot}`) || new Set<number>();
      const slotPast = isSlotInPast(fullDate, slot);

      fieldsForGrid.forEach((fieldNum, colIdx) => {
        const x = timeColW + colIdx * cellW;
        const isTaken = taken.has(fieldNum);
        let fill: string, border: string, label: string, labelColor: string;
        if (slotPast) {
          fill = "#F3F4F6"; border = "#D1D5DB"; label = "-"; labelColor = "#9CA3AF";
        } else if (isTaken) {
          fill = "#FEE2E2"; border = "#FCA5A5"; label = "X"; labelColor = "#DC2626";
        } else {
          fill = "#D1FAE5"; border = "#6EE7B7"; label = ""; labelColor = "#059669";
        }
        parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill}" stroke="${border}"/>`);
        if (label) {
          parts.push(
            `<text x="${x + cellW / 2}" y="${y + cellH / 2}" font-family="DejaVu Sans" font-size="13" fill="${labelColor}" text-anchor="middle" dominant-baseline="central">${label}</text>`
          );
        }
      });
    });

    const endLabel = formatTime12h("22:50");
    parts.push(
      `<text x="${(timeColW - 4) / 2}" y="${gridTop + rowH + footerH / 2}" font-family="DejaVu Sans" font-size="12" fill="#374151" text-anchor="middle" dominant-baseline="central">${xmlEscape(endLabel)}</text>`
    );
    parts.push("</svg>");

    const { Resvg } = await import("@resvg/resvg-js");
    const fontPath = fontFilePath();
    const resvg = new Resvg(parts.join(""), {
      font: fontPath
        ? { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" }
        : { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
      fitTo: { mode: "original" },
    });
    const png = resvg.render().asPng();
    return Buffer.from(png).toString("base64");
  } catch (e) {
    console.error("Error generando imagen de horario:", e);
    return null;
  }
}

/** Frase exacta para el usuario al consultar un horario concreto. */
export async function buildSlotCheckUserMessage(fullDate: string, timeSlot: string): Promise<string> {
  if (!timeSlot || !timeSlot.trim().endsWith(":00")) {
    return (
      `ERROR: No se permiten reservas para el horario '${timeSlot || "N/A"}'. ` +
      "La Bombonera solo reserva en horas exactas (ej: 6:00, 7:00, 19:00). " +
      "Por favor, ofrezca al cliente únicamente los horarios en punto que vea libres en la cuadrícula."
    );
  }
  if (isSlotBlockedByPolicy(timeSlot)) {
    return (
      `Mil disculpas, ese horario está agotado por política de atención ` +
      `(${formatDateForUser(fullDate)} a las ${formatTime12h(timeSlot)}). ` +
      "En la imagen podrá revisar qué otros espacios tenemos libres para Usted."
    );
  }
  if (isSlotInPast(fullDate, timeSlot)) {
    return (
      `El horario que Usted consulta (${formatDateForUser(fullDate)} a las ${formatTime12h(timeSlot)}) ya ha pasado. ` +
      "¿Desea consultar algún otro día u hora?"
    );
  }
  const occupied = await getAvailabilityByFieldForDate(fullDate);
  const taken = occupied.get(`${getDayNameFromDate(fullDate)}-${timeSlot}`) || new Set<number>();
  const free = ALL_FIELDS.filter((f) => !taken.has(f));
  if (free.length) {
    return (
      `Le confirmo que el horario del ${formatDateForUser(fullDate)} a las ${formatTime12h(timeSlot)} se encuentra disponible. ` +
      "Le adjunto la imagen detallada para que pueda ver las canchas libres."
    );
  }
  return (
    "Mil disculpas, ese horario no se encuentra disponible. " +
    "En la imagen podrá revisar qué otros espacios tenemos libres para Usted."
  );
}
