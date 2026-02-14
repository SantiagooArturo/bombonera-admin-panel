import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * GET /api/transfers?reservation_id=xxx
 * Obtiene las transferencias asociadas a una reserva.
 */
export async function GET(request: NextRequest) {
  const reservationId = request.nextUrl.searchParams.get("reservation_id");

  if (!reservationId) {
    return NextResponse.json(
      { error: "Se requiere reservation_id" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const snapshot = await db
      .collection("transfers")
      .where("reservation_id", "==", reservationId)
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
 * Verifica una transferencia.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { id, verified } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = getDb();
    await db.collection("transfers").doc(id).update({
      verified: verified,
      verified_at: verified ? new Date().toISOString() : null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error verifying transfer:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
