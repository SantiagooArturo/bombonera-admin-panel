import { NextRequest, NextResponse } from "next/server";
import { getWaha } from "@/lib/waha-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/chatbot/send-bot-message
 * Envía un mensaje por WhatsApp y lo guarda en el historial.
 * Body: { chat_id, message, firebase_id? }
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) {
      return NextResponse.json({ status: "error", message: "No se recibieron datos" }, { status: 400 });
    }
    const chatId: string = data.chat_id;
    const message: string = data.message;
    if (!chatId || !message) {
      return NextResponse.json(
        { status: "error", message: "chat_id y message son requeridos" },
        { status: 400 }
      );
    }
    const providerResponse = await getWaha().sendMessage(chatId, message, true);
    return NextResponse.json({ status: "success", provider_response: providerResponse });
  } catch (error) {
    console.error("Error en send-bot-message:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
