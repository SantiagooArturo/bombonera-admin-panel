import { NextRequest, NextResponse } from "next/server";
import { getChatbotApiUrl } from "@/lib/chatbot-api-url";
import { resolveWhatsAppTarget } from "@/lib/waha";

export async function POST(request: NextRequest) {
  try {
    const { chat_id, date } = await request.json();
    if (!chat_id || typeof chat_id !== "string") {
      return NextResponse.json({ error: "chat_id es obligatorio" }, { status: 400 });
    }
    if (!date || typeof date !== "string") {
      return NextResponse.json({ error: "date es obligatorio" }, { status: 400 });
    }
    const chatbotUrl = getChatbotApiUrl();
    if (!chatbotUrl) {
      return NextResponse.json(
        { error: "CHATBOT_API_URL no configurado para enviar imagen de horarios." },
        { status: 500 }
      );
    }

    const target = await resolveWhatsAppTarget(chat_id);
    const botRes = await fetch(`${chatbotUrl}/chatbot/send-schedule-image/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.chatId,
        firebase_id: target.firebaseId,
        date,
      }),
    });

    const responseData = await botRes.json().catch(() => ({}));
    if (!botRes.ok || responseData?.status === "error") {
      const message =
        typeof responseData?.message === "string"
          ? responseData.message
          : "No se pudo enviar la imagen de horarios.";
      return NextResponse.json({ error: message }, { status: botRes.ok ? 500 : botRes.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending availability:", error);
    const errorMessage = error instanceof Error ? error.message : "Error al enviar disponibilidad";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
