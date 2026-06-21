import { NextResponse } from "next/server";
import { getWaha } from "@/lib/waha-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEEPALIVE_PHONE = "51982242312@c.us";
const KEEPALIVE_MESSAGE = "ping keepalive waha";

/**
 * GET /api/chatbot/keepalive
 * Mantiene viva la sesión WAHA enviando un mensaje fijo.
 */
export async function GET() {
  try {
    const providerResponse = await getWaha().sendMessage(KEEPALIVE_PHONE, KEEPALIVE_MESSAGE, false);
    return NextResponse.json({
      status: "success",
      sent: true,
      target: KEEPALIVE_PHONE,
      provider_response: providerResponse,
    });
  } catch (error) {
    console.error("Error en keepalive:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
