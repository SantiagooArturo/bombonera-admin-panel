import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage } from "@/lib/waha";

export async function POST(request: NextRequest) {
  try {
    const { chat_id, message } = await request.json();

    if (!chat_id || !message) {
      return NextResponse.json({ error: "Faltan chat_id o message" }, { status: 400 });
    }

    const result = await sendWhatsAppMessage(chat_id, message);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Error al enviar mensaje" },
      { status: 500 }
    );
  }
}
