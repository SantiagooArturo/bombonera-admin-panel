import { NextRequest, NextResponse } from "next/server";
import { resolveWhatsAppTarget } from "@/lib/waha";

const WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";
const WAHA_API_KEY = "MiClaveSegura123";
const WAHA_SESSION = process.env.WAHA_SESSION || "default";

export async function POST(request: NextRequest) {
  try {
    const { chat_id, file_url } = await request.json();

    if (!chat_id || !file_url) {
      return NextResponse.json({ error: "Faltan chat_id o file_url" }, { status: 400 });
    }

    const target = await resolveWhatsAppTarget(chat_id);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (WAHA_API_KEY) {
      headers["X-Api-Key"] = WAHA_API_KEY;
    }

    const response = await fetch(`${WAHA_URL}/api/sendFile`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId: target.chatId,
        caption: "Aquí tienes tu boleta de pago 🧾",
        file: {
          mimetype: "application/pdf",
          filename: "boleta.pdf",
          url: file_url,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WAHA sendFile error: ${response.status} - ${errorText}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending invoice via WhatsApp:", error);
    const errorMessage = error instanceof Error ? error.message : "Error al enviar boleta";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
