import { NextRequest, NextResponse } from "next/server";
import { resolveWhatsAppTarget } from "@/lib/waha";
import { executeShowSchedule } from "@/lib/agent/tools";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { chat_id, date } = await request.json();
    if (!chat_id || typeof chat_id !== "string") {
      return NextResponse.json({ error: "chat_id es obligatorio" }, { status: 400 });
    }
    if (!date || typeof date !== "string") {
      return NextResponse.json({ error: "date es obligatorio" }, { status: 400 });
    }

    const target = await resolveWhatsAppTarget(chat_id);
    const result = await executeShowSchedule(target.chatId, date, null, { bypassBotLimit: true });

    if (!result.startsWith("✅")) {
      const isInternal = result.startsWith("Error") || result.startsWith("❌");
      return NextResponse.json(
        { error: result || "No se pudo enviar la imagen de horarios." },
        { status: isInternal ? 500 : 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending availability:", error);
    const errorMessage = error instanceof Error ? error.message : "Error al enviar disponibilidad";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
