import { NextRequest, NextResponse } from "next/server";

const WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";
const WAHA_API_KEY = "MiClaveSegura123";
const WAHA_SESSION = process.env.WAHA_SESSION || "default";

export async function POST(request: NextRequest) {
  try {
    const { chat_id, message } = await request.json();

    if (!chat_id || !message) {
      return NextResponse.json(
        { error: "Faltan chat_id o message" },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (WAHA_API_KEY) {
      headers["X-Api-Key"] = WAHA_API_KEY;
    }

    const res = await fetch(`${WAHA_URL}/api/sendText`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session: WAHA_SESSION,
        chatId: chat_id,
        text: message,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`WAHA error: ${res.status} - ${error}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Error al enviar mensaje" },
      { status: 500 }
    );
  }
}
