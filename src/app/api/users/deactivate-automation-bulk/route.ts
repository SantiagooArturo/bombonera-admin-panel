import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/** Máximo de operaciones por batch de Firestore (límite 500; margen). */
const BATCH_MAX = 400;

/**
 * POST /api/users/deactivate-automation-bulk
 * Pone is_automated: false en todos los usuarios donde el bot está activo
 * (is_automated === true o campo ausente, que en la app se interpreta como activo).
 */
export async function POST() {
  try {
    const db = getDb();
    const snap = await db.collection("users").get();
    const targets = snap.docs.filter((d) => d.data().is_automated !== false);

    let batch = db.batch();
    let inBatch = 0;
    let updated = 0;

    for (const doc of targets) {
      batch.update(doc.ref, { is_automated: false });
      inBatch++;
      updated++;
      if (inBatch >= BATCH_MAX) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) {
      await batch.commit();
    }

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("deactivate-automation-bulk:", error);
    return NextResponse.json({ error: "Error al actualizar usuarios" }, { status: 500 });
  }
}
