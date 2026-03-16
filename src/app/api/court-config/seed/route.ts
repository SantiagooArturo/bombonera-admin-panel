import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { DEFAULT_FIELD_CONFIG, FIELD_9_DEFAULTS } from "@/lib/court-config";

const COLLECTION = "court_config";

function docId(field: number) {
  return `field_${field}`;
}

/**
 * POST /api/court-config/seed
 * Inserta la configuración inicial de canchas en Firestore (datos base que teníamos hardcodeados).
 * Solo crea documentos que no existen; no sobrescribe los que ya tienen data.
 */
export async function POST() {
  try {
    const db = getDb();
    const snapshot = await db.collection(COLLECTION).get();

    const baseConfig = {
      ...DEFAULT_FIELD_CONFIG,
      court_size: "6 vs 6" as const,
      court_size_other: "",
    };

    const field9Config = {
      ...baseConfig,
      ...FIELD_9_DEFAULTS,
    };

    let created = 0;
    for (let f = 1; f <= 12; f++) {
      const doc = snapshot.docs.find((d) => d.id === docId(f));
      if (doc) continue;

      const data = f === 9 ? field9Config : baseConfig;
      const toWrite = {
        field: f,
        image_url: data.image_url,
        court_size: data.court_size,
        court_size_other: data.court_size_other,
        price_day_weekday: data.price_day_weekday,
        price_day_weekend: data.price_day_weekend,
        price_day_holiday: data.price_day_holiday,
        price_night_weekday: data.price_night_weekday,
        price_night_weekend: data.price_night_weekend,
        price_night_holiday: data.price_night_holiday,
        description: data.description,
        block_booking: data.block_booking,
      };

      await db.collection(COLLECTION).doc(docId(f)).set(toWrite);
      created++;
    }

    return NextResponse.json({
      success: true,
      message: created > 0
        ? `Se crearon ${created} configuraciones de cancha en Firestore`
        : "Ya existían las 12 configuraciones. No se sobrescribió nada.",
      created,
    });
  } catch (error) {
    console.error("Error seeding court config:", error);
    return NextResponse.json(
      { error: "Error al cargar datos iniciales" },
      { status: 500 }
    );
  }
}
