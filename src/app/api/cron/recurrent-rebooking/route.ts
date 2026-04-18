import { NextRequest, NextResponse } from "next/server";
import { executeRecurrentRebooking } from "@/lib/cron/recurrent-rebooking-executor";

/**
 * GET /api/cron/recurrent-rebooking
 * Cron que se ejecuta 1 vez al día (preferiblemente de noche).
 *
 * Para cada reserva de HOY y MAÑANA (pending/confirmada/pagada) que coincida con un horario maestro recurrente:
 * 1. Crea automáticamente una reserva para la próxima semana (mismo horario, misma cancha).
 * 2. La reserva se crea siempre en estado "pending".
 * 3. NO se envía mensaje de confirmación por WhatsApp.
 * 4. Verifica solapamientos antes de crear para evitar duplicidad de canchas.
 *
 * El dueño se identifica por teléfono (`phone_number` del maestro o de la reserva, últimos 9 dígitos), no por `chat_id` literal.
 * Marca la reserva original con `rebooking_sent: true` para no repetir.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await executeRecurrentRebooking();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in recurrent-rebooking cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
