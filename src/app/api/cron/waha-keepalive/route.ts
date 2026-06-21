import { NextResponse } from "next/server";
import { recordKeepaliveExecution } from "@/features/salud/services/wahaKeepaliveHealth";
import { getWaha } from "@/lib/waha-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEEPALIVE_PHONE = "51982242312@c.us";
const KEEPALIVE_MESSAGE = "ping keepalive waha";

/**
 * GET /api/cron/waha-keepalive
 * Endpoint para Vercel Cron. Mantiene viva la sesión WAHA (envío directo, ya sin Railway).
 */
export async function GET() {
  try {
    await getWaha().sendMessage(KEEPALIVE_PHONE, KEEPALIVE_MESSAGE, false);

    await recordKeepaliveExecution({
      ok: true,
      httpStatus: 200,
      errorMessage: null,
    }).catch((err) => {
      console.error("No se pudo guardar estado keepalive (ok):", err);
    });

    return NextResponse.json(
      {
        success: true,
        sent: true,
        target: KEEPALIVE_PHONE,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("Error in waha keepalive cron:", error);
    await recordKeepaliveExecution({
      ok: false,
      httpStatus: null,
      errorMessage: error instanceof Error ? error.message : "Error interno",
    }).catch((err) => {
      console.error("No se pudo guardar estado keepalive (exception):", err);
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}

