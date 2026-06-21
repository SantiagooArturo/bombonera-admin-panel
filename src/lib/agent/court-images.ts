/**
 * Detección de tags [ADJUNTAR_IMAGEN: xxx] y envío de imágenes de canchas.
 * Port compacto de los helpers de imagen de app.py.
 */
import { getWaha } from "@/lib/waha-client";
import { getCourtConfigByField, normalizeCourtSize, type CourtConfig } from "@/lib/agent/court-config";

const ATTACH_RE = /\[ADJUNTAR_IMAGEN:\s*(\w+)\]/g;

function priceSignature(c: CourtConfig): string {
  return [
    Number(c.price_day_weekday || 0),
    Number(c.price_day_weekend || 0),
    Number(c.price_day_holiday || 0),
    Number(c.price_night_weekday || 0),
    Number(c.price_night_weekend || 0),
    Number(c.price_night_holiday || 0),
  ].join("|");
}

function representativeFieldsByPriceGroup(
  cfg: Record<number, CourtConfig>,
  sizeFilter?: string
): number[] {
  const groups = new Map<string, number[]>();
  for (const field of Object.keys(cfg).map(Number).sort((a, b) => a - b)) {
    const c = cfg[field] || {};
    if (sizeFilter) {
      const size = normalizeCourtSize(c.court_size);
      const norm = sizeFilter === "6v6" ? "6 vs 6" : sizeFilter === "5v5" ? "5 vs 5" : sizeFilter;
      if (size !== norm) continue;
    }
    const sig = priceSignature(c);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(field);
  }
  const reps: number[] = [];
  for (const fields of Array.from(groups.values())) {
    const withImage = fields.filter((f) => String((cfg[f] || {}).image_url || "").trim());
    reps.push(withImage.length ? withImage[0] : fields[0]);
  }
  return Array.from(new Set(reps)).sort((a, b) => a - b);
}

function imageTagToFields(imageKey: string, cfg: Record<number, CourtConfig>): number[] {
  const key = (imageKey || "").trim().toLowerCase();
  if (key.startsWith("cancha_")) {
    const n = parseInt(key.split("_")[1], 10);
    return !Number.isNaN(n) && cfg[n] ? [n] : [];
  }
  if (["tipos", "tipo", "todos_tipos", "todos_los_tipos", "grupos"].includes(key)) {
    return representativeFieldsByPriceGroup(cfg);
  }
  if (["tipo_6vs6", "tipo_6v6"].includes(key)) return representativeFieldsByPriceGroup(cfg, "6v6");
  if (["tipo_5vs5", "tipo_5v5"].includes(key)) return representativeFieldsByPriceGroup(cfg, "5v5");
  if (key === "campo_9") return cfg[9] ? [9] : [];
  return [];
}

function buildCourtCaption(field: number, c: CourtConfig): string {
  const size = normalizeCourtSize(c.court_size);
  const sizeText = size === "otro" && c.court_size_other ? c.court_size_other : size;
  const lines = [`Cancha ${field} (${sizeText})`];
  if (c.description) lines.push(String(c.description).trim());
  const n = (v: unknown) => Number(v || 0).toFixed(0);
  lines.push(
    `Día L-V: S/${n(c.price_day_weekday)} | S-D: S/${n(c.price_day_weekend)} | Feriado: S/${n(c.price_day_holiday)}`
  );
  lines.push(
    `Noche L-V: S/${n(c.price_night_weekday)} | S-D: S/${n(c.price_night_weekend)} | Feriado: S/${n(c.price_night_holiday)}`
  );
  return lines.join("\n");
}

async function downloadImageBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Detecta tags, envía las imágenes de cancha correspondientes y devuelve el texto sin tags.
 */
export async function parseAndSendCourtImages(chatId: string, text: string): Promise<string> {
  const matches = Array.from(text.matchAll(ATTACH_RE)).map((m) => m[1]);
  if (matches.length) {
    const cfg = await getCourtConfigByField();
    const sent = new Set<number>();
    for (const key of matches) {
      const fields = imageTagToFields(key, cfg);
      for (const field of fields) {
        if (sent.has(field)) continue;
        sent.add(field);
        const court = cfg[field] || {};
        const imageUrl = String(court.image_url || "").trim();
        if (!imageUrl) continue;
        const b64 = await downloadImageBase64(imageUrl);
        if (!b64) continue;
        await getWaha().sendImage(chatId, {
          imageBase64: b64,
          caption: buildCourtCaption(field, court),
          filename: `cancha_${field}.jpg`,
        });
      }
    }
  }
  return text.replace(ATTACH_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}
