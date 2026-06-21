import { NextRequest, NextResponse } from "next/server";
import { normalizeChatId } from "@/lib/waha-client";
import { executeShowSchedule } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/chatbot/send-schedule-image
 * Genera y envía la imagen de horarios de un día.
 * Body: { chat_id, date, firebase_id? }
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) {
      return NextResponse.json({ status: "error", message: "No se recibieron datos" }, { status: 400 });
    }
    let chatId = String(data.chat_id || "").trim();
    const date = String(data.date || "").trim();
    if (!chatId || !date) {
      return NextResponse.json({ status: "error", message: "chat_id y date son requeridos" }, { status: 400 });
    }
    chatId = normalizeChatId(chatId);

    const result = await executeShowSchedule(chatId, date, null, { bypassBotLimit: true });
    if (!result.startsWith("✅")) {
      const isInternal = result.startsWith("Error") || result.startsWith("❌");
      return NextResponse.json(
        { status: "error", message: result || "No se pudo enviar la imagen" },
        { status: isInternal ? 500 : 400 }
      );
    }
    return NextResponse.json({ status: "success", message: result });
  } catch (error) {
    console.error("Error en send-schedule-image:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
