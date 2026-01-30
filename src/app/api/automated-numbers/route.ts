import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";

export async function GET() {
  try {
    const snapshot = await db.collection("automated-numbers").get();
    const numbers = snapshot.docs.map((doc) => ({
      chat_id: doc.id,
      phone_number: doc.id.replace("@c.us", "").replace("@lid", ""),
      ...doc.data(),
    }));

    return NextResponse.json(numbers);
  } catch (error) {
    console.error("Error fetching automated numbers:", error);
    return NextResponse.json(
      { error: "Error al obtener números" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { chat_id, isAutomated } = body;

    if (!chat_id || typeof isAutomated !== "boolean") {
      return NextResponse.json(
        { error: "Se requiere chat_id y isAutomated" },
        { status: 400 }
      );
    }

    await db
      .collection("automated-numbers")
      .doc(chat_id)
      .set({ isAutomated }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating automation:", error);
    return NextResponse.json(
      { error: "Error al actualizar automatización" },
      { status: 500 }
    );
  }
}
