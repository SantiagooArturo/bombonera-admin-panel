import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const courtType = searchParams.get("court_type");
    const status = searchParams.get("status");
    const phoneNumber = searchParams.get("phone_number");

    let query: FirebaseFirestore.Query = db.collection("reservations");

    if (phoneNumber) {
      query = query.where("chat_id", "==", phoneNumber);
    }
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
    const { id, status, field, arrived } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Se requiere id" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof status === "string") updateData.status = status;
    if (typeof field === "number" || field === null) updateData.field = field;
    if (typeof arrived === "boolean") updateData.arrived = arrived;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    // Si se marca como pagado, poner amount_paid = total_price
    if (status === "paid") {
      const doc = await db.collection("reservations").doc(id).get();
      if (doc.exists) {
        const data = doc.data();
        const totalPrice = data?.total_price || 0;
        updateData.amount_paid = totalPrice;
        updateData.confirmed = true;
        updateData.confirmed_at = new Date().toISOString();
      }
    }

    await db.collection("reservations").doc(id).update(updateData);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating reservation:", error);
    return NextResponse.json(
      { error: "Error al actualizar reservación" },
      { status: 500 }
    );
  }
}
