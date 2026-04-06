import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { courtConfigDocId, type CourtFieldConfig, getFullFieldConfig } from "@/lib/court-config";

const COLLECTION = "court_config";

/** GET: Listar configuración de todos los campos */
export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection(COLLECTION).get();

    const configs: CourtFieldConfig[] = [];
    for (let f = 1; f <= 12; f++) {
      const doc = snapshot.docs.find((d) => d.id === courtConfigDocId(f));
      const data = doc?.data();
      configs.push(getFullFieldConfig(f, data));
    }
    return NextResponse.json(configs);
  } catch (error) {
    console.error("Error fetching court config:", error);
    return NextResponse.json(
      { error: "Error al obtener configuración" },
      { status: 500 }
    );
  }
}

/** PATCH: Actualizar un campo */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { field, ...updates } = body;

    if (typeof field !== "number" || field < 1 || field > 12) {
      return NextResponse.json({ error: "Campo inválido (1-12)" }, { status: 400 });
    }

    const allowed: (keyof CourtFieldConfig)[] = [
      "image_url",
      "price_day_weekday",
      "price_day_weekend",
      "price_day_holiday",
      "price_night_weekday",
      "price_night_weekend",
      "price_night_holiday",
      "description",
      "court_size",
      "court_size_other",
      "block_booking",
    ];

    const toSet: Record<string, unknown> = { field };
    for (const key of allowed) {
      const val = updates[key];
      if (val !== undefined) {
        if (key.startsWith("price_") && typeof val === "number" && val >= 0) {
          toSet[key] = val;
        } else if (key === "image_url" && typeof val === "string") {
          toSet[key] = val;
        } else if (key === "court_size" && ["5 vs 5", "6 vs 6", "otro"].includes(val)) {
          toSet[key] = val;
        } else if (key === "court_size_other" && typeof val === "string") {
          toSet[key] = val;
        } else if (key === "description" && typeof val === "string") {
          toSet[key] = val;
        } else if (key === "block_booking" && typeof val === "boolean") {
          toSet[key] = val;
        }
      }
    }

    const ref = db.collection(COLLECTION).doc(courtConfigDocId(field));
    await ref.set(toSet, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating court config:", error);
    return NextResponse.json(
      { error: "Error al actualizar configuración" },
      { status: 500 }
    );
  }
}
