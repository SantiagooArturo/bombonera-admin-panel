/**
 * Helpers server-side para court config.
 * Solo importar en API routes (usa firebase-admin).
 */
import { getDb } from "@/lib/firebase-admin";
import type { CourtSize } from "./court-config";

const COLLECTION = "court_config";

/** Fallback cuando court_type no tiene field o no hay config. */
const COURT_TYPE_TO_SIZE: Record<string, string> = {
  voley_6v6: "6 vs 6",
  voley_basket_6v6: "6 vs 6",
  voley_5v5: "5 vs 5",
  voley_basket_5v5: "5 vs 5",
  court_6v6: "6 vs 6",
  court_5v5: "5 vs 5",
};

/**
 * Obtiene la etiqueta de cancha (5 vs 5, 6 vs 6, u otro) para un field desde Firestore.
 * Usar en API routes que envían mensajes WhatsApp, etc.
 */
export async function getCourtSizeLabelForField(field: number): Promise<string> {
  try {
    const db = getDb();
    const doc = await db.collection(COLLECTION).doc(`field_${field}`).get();
    const data = doc.data();
    const court_size = (data?.court_size as CourtSize) ?? (field === 9 ? "5 vs 5" : "6 vs 6");
    const court_size_other = (data?.court_size_other as string) ?? "";
    if (court_size === "otro" && court_size_other?.trim()) return court_size_other.trim();
    return court_size;
  } catch {
    return field === 9 ? "5 vs 5" : "6 vs 6";
  }
}

/**
 * Obtiene la etiqueta para mostrar en mensajes.
 * Si hay field, usa la config de Firestore. Si no, usa fallback por court_type.
 */
export async function getCourtLabelForReservation(
  field: number | null | undefined,
  courtType: string | null | undefined
): Promise<string> {
  if (field != null && field >= 1 && field <= 12) {
    return getCourtSizeLabelForField(field);
  }
  return COURT_TYPE_TO_SIZE[courtType ?? ""] ?? courtType ?? "Cancha";
}
