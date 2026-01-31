import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const courtType = searchParams.get("court_type");
    const status = searchParams.get("status");

    let query: FirebaseFirestore.Query = db.collection("reservations");

    if (date) {
      query = query.where("date", "==", date);
    }
    if (courtType) {
      query = query.where("court_type", "==", courtType);
    }
    if (status) {
      query = query.where("status", "==", status);
    }

    const snapshot = await query.get();
    const reservations = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      created_at: doc.data().created_at?.toDate?.()
        ? doc.data().created_at.toDate().toISOString()
        : doc.data().created_at,
    }));

    return NextResponse.json(reservations);
  } catch (error) {
    console.error("Error fetching reservations:", error);
    return NextResponse.json(
      { error: "Error al obtener reservaciones" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "Se requiere id y status" },
        { status: 400 }
      );
    }

    await db.collection("reservations").doc(id).update({ status });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating reservation:", error);
    return NextResponse.json(
      { error: "Error al actualizar reservación" },
      { status: 500 }
    );
  }
}
