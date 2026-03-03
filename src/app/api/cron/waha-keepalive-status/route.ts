import { NextResponse } from "next/server";
import { getBotHealthStatus } from "@/features/salud/services/wahaKeepaliveHealth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const status = await getBotHealthStatus();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error obteniendo estado de keepalive:", error);
    return NextResponse.json(
      {
        indicator: "red",
        status: "error",
        title: "No se pudo leer salud del bot",
        detail: "Falló la lectura del estado técnico del keepalive.",
        is_stale: true,
        last_run_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error_message: error instanceof Error ? error.message : "Error interno",
        consecutive_failures: 0,
        cron_schedule: "0 */4 * * *",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
