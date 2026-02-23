import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage } from "@/lib/waha";

export async function POST(request: NextRequest) {
  try {
    const { chat_id, file_url } = await request.json();

    if (!chat_id || !file_url) {
      return NextResponse.json({ error: "Faltan chat_id o file_url" }, { status: 400 });
    }

    await sendWhatsAppMessage(
      chat_id,
      `hola! aquí tienes tu boleta de pago 🧾\n\n${file_url}\n\ngracias por tu preferencia!`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending invoice via WhatsApp:", error);
    return NextResponse.json({ error: "Error al enviar boleta" }, { status: 500 });
  }
}
