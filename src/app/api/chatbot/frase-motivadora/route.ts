import { NextRequest, NextResponse } from "next/server";
import { getWaha } from "@/lib/waha-client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/chatbot/frase-motivadora
 * Recibe y envía frases motivadoras (desde n8n).
 * Body: { chat_id, frase }
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) {
      return NextResponse.json({ status: "error", message: "No se recibieron datos" }, { status: 400 });
    }
    const chatId: string = data.chat_id;
    const frase: string = data.frase;
    if (!chatId || !frase) {
      return NextResponse.json(
        { status: "error", message: "chat_id y frase son requeridos" },
        { status: 400 }
      );
    }
    await getWaha().sendMessage(chatId, frase, true);
    return NextResponse.json({ status: "success", message: "Frase motivadora enviada correctamente" });
  } catch (error) {
    console.error("Error en frase-motivadora:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
