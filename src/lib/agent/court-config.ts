/**
 * Configuración de canchas (port de utils/court_config.py).
 * Lee la colección court_config y construye textos para el prompt.
 */
import { getDb } from "@/lib/firebase-admin";

export interface CourtConfig {
  field?: number;
  court_size?: string;
  court_size_other?: string;
  description?: string;
  block_booking?: boolean;
  price_day_weekday?: number;
  price_day_weekend?: number;
  price_day_holiday?: number;
  price_night_weekday?: number;
  price_night_weekend?: number;
  price_night_holiday?: number;
  image_url?: string;
  [k: string]: unknown;
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; byField: Record<number, CourtConfig> | null } = { at: 0, byField: null };

export function normalizeCourtSize(raw: string | undefined): string {
  const v = (raw || "").trim().toLowerCase();
  if (v.includes("6")) return "6 vs 6";
  if (v.includes("5")) return "5 vs 5";
  return "otro";
}

export function courtTypeFromSize(size: string | undefined): string {
  const s = normalizeCourtSize(size);
  if (s === "6 vs 6") return "court_6v6";
  if (s === "5 vs 5") return "court_5v5";
  return "court_other";
}

const DEFAULT_BASE: CourtConfig = {
  court_size: "6 vs 6",
  price_day_weekday: 70,
  price_day_weekend: 80,
  price_day_holiday: 80,
  price_night_weekday: 100,
  price_night_weekend: 100,
  price_night_holiday: 100,
};

const FIELD_9_DEFAULTS: CourtConfig = {
  court_size: "5 vs 5",
  price_day_weekday: 40,
  price_day_weekend: 40,
  price_day_holiday: 40,
  price_night_weekday: 60,
  price_night_weekend: 60,
  price_night_holiday: 60,
};

export async function getCourtConfigByField(forceRefresh = false): Promise<Record<number, CourtConfig>> {
  if (!forceRefresh && cache.byField && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.byField;
  }

  const out: Record<number, CourtConfig> = {};
  try {
    const snap = await getDb().collection("court_config").get();
    snap.forEach((doc) => {
      const data = (doc.data() || {}) as CourtConfig;
      const field = Number(data.field || 0);
      if (field >= 1 && field <= 12) {
        const base = field === 9 ? FIELD_9_DEFAULTS : DEFAULT_BASE;
        out[field] = { ...base, ...data };
      }
    });
  } catch (e) {
    console.warn("Error leyendo court_config:", e);
  }

  for (let f = 1; f <= 12; f++) {
    if (!out[f]) {
      const base = f === 9 ? FIELD_9_DEFAULTS : DEFAULT_BASE;
      out[f] = { ...base, field: f };
    }
  }

  if (Object.keys(out).length) cache = { at: Date.now(), byField: out };
  return out;
}

export async function getFieldsForCourtType(courtType: string): Promise<number[]> {
  const cfg = await getCourtConfigByField();
  const wanted = (courtType || "").trim().toLowerCase();
  const fields: number[] = [];
  for (const [field, data] of Object.entries(cfg)) {
    if (courtTypeFromSize(data.court_size) === wanted) fields.push(Number(field));
  }
  return fields.sort((a, b) => a - b);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Texto de referencia de canchas y precios para el system prompt. */
export async function buildInfoCanchasYPrecios(): Promise<string> {
  const cfg = await getCourtConfigByField();
  if (!Object.keys(cfg).length) {
    return (
      "No se pudo cargar la configuración de canchas en este momento.\n" +
      "Si falta claridad en precios o características, deriva con request_human."
    );
  }

  const lines: string[] = ["Alquiler de campos de voley 🏐", "", "PRECIOS POR HORA:", ""];
  const sortedFields = Object.keys(cfg)
    .map(Number)
    .sort((a, b) => a - b);

  for (const field of sortedFields) {
    const c = cfg[field];
    const size = normalizeCourtSize(c.court_size);
    const sizeLabel = size === "otro" && c.court_size_other ? c.court_size_other : size;

    const dWd = num(c.price_day_weekday);
    const dWe = num(c.price_day_weekend);
    const dH = num(c.price_day_holiday);
    const nWd = num(c.price_night_weekday);
    const nWe = num(c.price_night_weekend);
    const nH = num(c.price_night_holiday);
    const desc = String(c.description || "").trim();

    lines.push(`### Cancha ${field} (${sizeLabel})`);
    if (desc) lines.push(`Nota: ${desc}`);

    lines.push(`- Día (antes 6pm): S/ ${dWd.toFixed(2)} (L-V)`);
    if (dWe === dH) lines.push(`  S/ ${dWe.toFixed(2)} (Sáb, Dom y Feriados)`);
    else lines.push(`  S/ ${dWe.toFixed(2)} (Sáb y Dom) | S/ ${dH.toFixed(2)} (Feriados)`);

    lines.push(`- Noche (desde 6pm): S/ ${nWd.toFixed(2)} (L-V)`);
    if (nWe === nH) lines.push(`  S/ ${nWe.toFixed(2)} (Sáb, Dom y Feriados)`);
    else lines.push(`  S/ ${nWe.toFixed(2)} (Sáb y Dom) | S/ ${nH.toFixed(2)} (Feriados)`);

    if (c.block_booking) lines.push("  *Reserva solo por bloques establecidos.");
    lines.push("");
  }

  return lines.join("\n").trim();
}
