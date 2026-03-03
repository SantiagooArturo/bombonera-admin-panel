import { NextResponse } from "next/server";
import { recordKeepaliveExecution } from "@/features/salud/services/wahaKeepaliveHealth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAILWAY_CHATBOT_URL =
  (process.env.CHATBOT_API_URL || "https://bombonera-booking-agent-production.up.railway.app").replace(/\/$/, "");

/**
 * GET /api/cron/waha-keepalive
 * Endpoint para Vercel Cron.
 * Llama a Railway para ejecutar keepalive de WAHA.
 */
export async function GET() {
  try {
    const response = await fetch(`${RAILWAY_CHATBOT_URL}/chatbot/keepalive/`, {
      method: "GET",
      cache: "no-store",
      headers: { "Cache-Control": "no-store" },
    });
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
        { status: response.status, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    await recordKeepaliveExecution({
      ok: true,
      httpStatus: response.status,
      errorMessage: null,
    }).catch((err) => {
      console.error("No se pudo guardar estado keepalive (ok):", err);
    });

    return NextResponse.json(
      {
        success: true,
        sent: data?.sent === true || data?.status === "success",
        target: data?.target || null,
        railway_status: data?.status || "ok",
        detail: data,
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

