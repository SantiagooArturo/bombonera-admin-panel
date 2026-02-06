import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * Normaliza un chat_id a solo dígitos (phone_number).
 */
function normalizeToPhoneNumber(chatId: string): string {
  return chatId.replace(/\D/g, "");
}

export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection("automated-numbers").get();
    const numbers = snapshot.docs.map((doc) => {
      const data = doc.data();
      // phone_number puede venir del campo o del doc.id (legacy)
      const phoneNumber = data.phone_number || normalizeToPhoneNumber(doc.id);
      return {
        chat_id: doc.id,
        phone_number: phoneNumber,
        isAutomated: data.isAutomated ?? true,
        name: data.name,
      };
    });

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
    const db = getDb();
    const body = await request.json();
    const { chat_id, isAutomated } = body;

    if (!chat_id || typeof isAutomated !== "boolean") {
      return NextResponse.json(
        { error: "Se requiere chat_id y isAutomated" },
        { status: 400 }
      );
    }

    const phoneNumber = normalizeToPhoneNumber(chat_id);

    // Buscar documento existente por phone_number
    const querySnapshot = await db
      .collection("automated-numbers")
      .where("phone_number", "==", phoneNumber)
      .limit(1)
      .get();

    if (!querySnapshot.empty) {
      // Actualizar documento existente
      await querySnapshot.docs[0].ref.update({ isAutomated });
    } else {
      // Crear nuevo documento con phone_number como campo
      await db.collection("automated-numbers").add({
        phone_number: phoneNumber,
        isAutomated,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating automation:", error);
    return NextResponse.json(
      { error: "Error al actualizar automatización" },
      { status: 500 }
    );
  }
}
