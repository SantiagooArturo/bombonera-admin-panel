import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const courtType = searchParams.get("court_type");

    let query: FirebaseFirestore.Query = db.collection("blocked-slots");

    if (date) {
      query = query.where("date", "==", date);
    }
    if (courtType) {
      query = query.where("court_type", "==", courtType);
    }

    const snapshot = await query.get();
    const slots = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json(slots);
  } catch (error) {
    console.error("Error fetching blocked slots:", error);
    return NextResponse.json(
      { error: "Error al obtener horarios bloqueados" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { court_type, field, date, time_slot, reason } = body;

    if (!court_type || !field || !date || !time_slot) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      );
    }

    const docRef = await db.collection("blocked-slots").add({
      court_type,
      field,
      date,
      time_slot,
      reason: reason || "Bloqueado manual",
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ id: docRef.id, success: true });
  } catch (error) {
    console.error("Error blocking slot:", error);
    return NextResponse.json(
      { error: "Error al bloquear horario" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Se requiere id" },
        { status: 400 }
      );
    }

    await db.collection("blocked-slots").doc(id).delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unblocking slot:", error);
    return NextResponse.json(
      { error: "Error al desbloquear horario" },
      { status: 500 }
    );
  }
}
