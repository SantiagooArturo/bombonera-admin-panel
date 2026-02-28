import { NextResponse } from "next/server";
import { recordKeepaliveExecution } from "@/features/salud/services/wahaKeepaliveHealth";

const RAILWAY_CHATBOT_URL = "https://bombonera-booking-agent-production.up.railway.app";

/**
 * GET /api/cron/waha-keepalive
 * Endpoint para Vercel Cron.
 * Llama a Railway para ejecutar keepalive de WAHA.
 */
export async function GET() {
  try {
    const response = await fetch(`${RAILWAY_CHATBOT_URL}/chatbot/keepalive/`, { method: "GET" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await recordKeepaliveExecution({
        ok: false,
        httpStatus: response.status,
        errorMessage: data?.message || "Railway keepalive failed",
      }).catch((err) => {
        console.error("No se pudo guardar estado keepalive (error):", err);
      });
      return NextResponse.json(
        { success: false, error: data?.message || "Railway keepalive failed" },
        { status: response.status }
      );
    }

    await recordKeepaliveExecution({
      ok: true,
      httpStatus: response.status,
      errorMessage: null,
    }).catch((err) => {
      console.error("No se pudo guardar estado keepalive (ok):", err);
    });

    return NextResponse.json({
      success: true,
      railway_status: data?.status || "ok",
      detail: data,
    });
  } catch (error) {
    console.error("Error in waha keepalive cron:", error);
    await recordKeepaliveExecution({
      ok: false,
      httpStatus: null,
      errorMessage: error instanceof Error ? error.message : "Error interno",
    }).catch((err) => {
      console.error("No se pudo guardar estado keepalive (exception):", err);
    });
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

