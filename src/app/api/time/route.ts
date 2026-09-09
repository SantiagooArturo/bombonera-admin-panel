import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Endpoint ligero para sincronizar el reloj de los clientes con el reloj oficial
 * del servidor (UTC-5 / America/Lima), sin depender del reloj del dispositivo local.
 */
export async function GET() {
  const now = Date.now();
  return NextResponse.json(
    {
      serverTime: now,
      timezone: "America/Lima",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
