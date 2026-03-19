import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * GET /api/transfers?reservation_id=xxx | ?chat_id=xxx
 * Obtiene transferencias por reserva o por cliente (chat_id).
 */
export async function GET(request: NextRequest) {
  const reservationId = request.nextUrl.searchParams.get("reservation_id");
  const chatId = request.nextUrl.searchParams.get("chat_id");

  if (!reservationId && !chatId) {
    return NextResponse.json(
      { error: "Se requiere reservation_id o chat_id" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const field = reservationId ? "reservation_id" : "chat_id";
    const value = reservationId ?? chatId;

    const snapshot = await db
      .collection("transfers")
      .where(field, "==", value)
      .orderBy("created_at", "desc")
      .get();

    const transfers = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      created_at:
        doc.data().created_at?.toDate?.()?.toISOString() ??
        doc.data().created_at ??
        null,
    }));

    return NextResponse.json(transfers);
  } catch (error) {
    console.error("Error fetching transfers:", error);
    return NextResponse.json(
      { error: "Error al obtener transferencias" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/transfers
 * Actualiza una transferencia: verified y/o applied.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, verified, applied } = body;
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = getDb();
    const update: Record<string, unknown> = {};
    if (typeof verified === "boolean") {
      update.verified = verified;
      update.verified_at = verified ? new Date().toISOString() : null;
    }
    if (typeof applied === "boolean") {
      update.applied = applied;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: true });
    }
    await db.collection("transfers").doc(id).update(update);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating transfer:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
