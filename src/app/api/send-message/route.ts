import { NextRequest, NextResponse } from "next/server";
import {
  WAHA_ENV_MISSING,
  getWahaApiKey,
  getWahaSession,
  getWahaUrl,
  isWahaConfigured,
} from "@/lib/waha-server-config";

export async function POST(request: NextRequest) {
  try {
    const { chat_id, message } = await request.json();

    if (!chat_id || !message) {
      return NextResponse.json(
        { error: "Faltan chat_id o message" },
        { status: 400 }
      );
    }

    if (!isWahaConfigured()) {
      return NextResponse.json({ error: WAHA_ENV_MISSING }, { status: 503 });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Key": getWahaApiKey(),
    };

    const res = await fetch(`${getWahaUrl()}/api/sendText`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session: getWahaSession(),
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
