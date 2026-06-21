import { NextRequest, NextResponse } from "next/server";
import { getWaha } from "@/lib/waha-client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/chatbot/recordatorio
 * Recibe recordatorios de reuniones (desde n8n) y los envía por WhatsApp.
 * Body: { chat_id, evento: { id, summary, start: { dateTime } | dateTime } }
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) {
      return NextResponse.json({ status: "error", message: "No se recibieron datos" }, { status: 400 });
    }
    const chatId: string = data.chat_id;
    const evento = data.evento || {};
    const eventId = evento.id;
    const eventSummary: string = evento.summary || "Reunión sin título";
    const eventStart = evento.start;
    const eventStartTime =
      eventStart && typeof eventStart === "object" ? eventStart.dateTime : eventStart;

    if (!chatId || !eventId || !eventStartTime) {
      return NextResponse.json({ status: "error", message: "Datos incompletos" }, { status: 400 });
    }

    let horaFormateada = "próximamente";
    try {
      const dt = new Date(String(eventStartTime).replace("Z", "+00:00"));
      if (!Number.isNaN(dt.getTime())) {
        horaFormateada = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Lima",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }).format(dt);
      }
    } catch {
      /* fallback */
    }

    const mensaje = `⏰ Recordatorio: Tienes una reunión en 30 minutos\n\n📅 ${eventSummary}\n🕐 ${horaFormateada}`;
    await getWaha().sendMessage(chatId, mensaje, true);

    return NextResponse.json({ status: "success", message: "Recordatorio enviado correctamente" });
  } catch (error) {
    console.error("Error en recordatorio:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
