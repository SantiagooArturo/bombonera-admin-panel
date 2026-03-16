import { NextRequest, NextResponse } from "next/server";
import { resolveWhatsAppTarget } from "@/lib/waha";

/**
 * Vercel API route → delega al bot (Railway) CHATBOT_API_URL/chatbot/send-file/
 * Mismo patrón que send-availability → send-schedule-image
 */
let rawUrl = process.env.CHATBOT_API_URL || "";
if (rawUrl && !rawUrl.startsWith("http")) rawUrl = `https://${rawUrl}`;
const CHATBOT_API_URL = rawUrl;

export async function POST(request: NextRequest) {
  try {
    const { chat_id, file_url } = await request.json();

    if (!chat_id || !file_url) {
      return NextResponse.json({ error: "Faltan chat_id o file_url" }, { status: 400 });
    }

    if (!CHATBOT_API_URL) {
      return NextResponse.json(
        { error: "CHATBOT_API_URL no configurado para enviar boleta por WhatsApp." },
        { status: 500 }
      );
    }

    const target = await resolveWhatsAppTarget(chat_id);

    const botRes = await fetch(`${CHATBOT_API_URL}/chatbot/send-file/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.chatId,
        file_url,
        caption: "Aquí tienes tu boleta de pago 🧾",
        filename: "boleta.pdf",
      }),
    });

    const responseData = await botRes.json().catch(() => ({}));
    if (!botRes.ok || responseData?.status === "error") {
      const message =
        typeof responseData?.message === "string"
          ? responseData.message
          : "No se pudo enviar la boleta.";
      return NextResponse.json(
        { error: message },
        { status: botRes.ok ? 500 : botRes.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending invoice via WhatsApp:", error);
    const errorMessage = error instanceof Error ? error.message : "Error al enviar boleta";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
