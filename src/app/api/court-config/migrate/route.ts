import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { courtConfigDocId } from "@/lib/court-config";

const COLLECTION = "court_config";

/**
 * POST /api/court-config/migrate
 * Migra documentos field_1..field_12 a court_1..court_12 en Firestore.
 * Copia el contenido y elimina los documentos legacy.
 * Ejecutar una sola vez después del deploy del cambio de nomenclatura.
 */
export async function POST() {
  try {
    const db = getDb();
    const snapshot = await db.collection(COLLECTION).get();

    let migrated = 0;
    const batch = db.batch();

    for (let f = 1; f <= 12; f++) {
      const legacyId = `field_${f}`;
      const newId = courtConfigDocId(f);

      const legacyDoc = snapshot.docs.find((d) => d.id === legacyId);
      const newDoc = snapshot.docs.find((d) => d.id === newId);

      if (legacyDoc && !newDoc) {
        const data = legacyDoc.data();
        const newRef = db.collection(COLLECTION).doc(newId);
        batch.set(newRef, data);
        batch.delete(legacyDoc.ref);
        migrated++;
      }
    }

    if (migrated > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      message:
        migrated > 0
          ? `Migrados ${migrated} documentos de field_X a court_X`
          : "No había documentos field_X para migrar (o ya existen court_X)",
      migrated,
    });
  } catch (error) {
    console.error("Error migrating court config:", error);
    return NextResponse.json(
      { error: "Error al migrar configuración" },
      { status: 500 }
    );
  }
}
