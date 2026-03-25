import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/payment-reminder
 *
 * DESHABILITADO (2025): Los saldos/pagos quedaron ligados al usuario, no a la reserva.
 * La lógica anterior (amount_paid / reservation_price en el doc de reserva) pedía pago
 * aunque el usuario ya hubiera cubierto el monto a nivel cuenta.
 *
 * Si en el futuro se reactiva, hay que calcular pendiente desde el usuario (o fuente única
 * de verdad de pagos), no desde campos desactualizados en `reservations`.
 *
 * La ruta sigue existiendo para que un cron antiguo en Vercel no devuelva 404; responde 200
 * sin enviar mensajes. El job programado se eliminó de `vercel.json`.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    reminders_sent: 0,
    disabled: true,
    reason: "Recordatorio de pago deshabilitado: pagos ligados al usuario, no a la reserva",
  });
}
