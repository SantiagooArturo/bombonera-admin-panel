import { NextRequest, NextResponse } from "next/server";

const WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";
const WAHA_API_KEY = "MiClaveSegura123";
const WAHA_SESSION = "session_01kgx7mr4058d2hc98m62jx2cy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chat_id, file_url } = body;

    if (!chat_id || !file_url) {
      return NextResponse.json(
        { error: "Faltan chat_id o file_url" },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (WAHA_API_KEY) {
      headers["X-Api-Key"] = WAHA_API_KEY;
    }

    // Mensaje con el link de la boleta
    const res = await fetch(`${WAHA_URL}/api/sendText`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId: chat_id,
        text: `Hola, aquí tienes tu boleta de pago:\n\n${file_url}\n\nGracias por tu preferencia.`,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`WAHA error: ${res.status} - ${error}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending invoice via WhatsApp:", error);
    return NextResponse.json(
      { error: "Error al enviar boleta por WhatsApp" },
      { status: 500 }
    );
  }
}
