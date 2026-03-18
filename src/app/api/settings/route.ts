import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

const COLLECTION = "config";
const DOC_ID = "app_settings";

/** GET: Obtener configuración de la app */
export async function GET() {
  try {
    const db = getDb();
    const doc = await db.collection(COLLECTION).doc(DOC_ID).get();
    const data = doc.data();
    return NextResponse.json({
      recurrent_reminder_enabled: data?.recurrent_reminder_enabled !== false,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Error al obtener configuración" }, { status: 500 });
  }
}

/** PATCH: Actualizar configuración */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const recurrent_reminder_enabled = body.recurrent_reminder_enabled;

    if (typeof recurrent_reminder_enabled !== "boolean") {
      return NextResponse.json({ error: "recurrent_reminder_enabled debe ser boolean" }, { status: 400 });
    }

    const db = getDb();
    await db.collection(COLLECTION).doc(DOC_ID).set(
      { recurrent_reminder_enabled },
      { merge: true }
    );

    return NextResponse.json({ success: true, recurrent_reminder_enabled });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Error al actualizar configuración" }, { status: 500 });
  }
}
