import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendWhatsAppMessage } from "@/lib/waha";
import { getCourtLabelForReservation } from "@/lib/court-config-server";

/**
 * GET /api/cron/payment-reminder
 * Cron que se ejecuta 1 vez al día (mañana, ~10am Lima).
 * Busca reservas pendientes (sin pagar) creadas hace más de 1 hora
 * cuya fecha es mañana o hoy, y envía recordatorio de pago por WhatsApp.
 * Igual que el "Recordar pago" manual pero automático.
 * Marca la reserva con `auto_reminder_sent: true` para no repetir.
 */

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const now = new Date();

    // Hora actual en Lima (UTC-5)
    const limaOffset = -5 * 60;
    const limaTime = new Date(now.getTime() + (limaOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = limaTime.toISOString().slice(0, 10);

    const tomorrow = new Date(limaTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // Buscar reservas pendientes de hoy o mañana
    const snapshot = await db
      .collection("reservations")
      .where("status", "==", "pending")
      .get();

    let sent = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.auto_reminder_sent) continue;

      const reservationDate = data.date;
      if (reservationDate !== todayStr && reservationDate !== tomorrowStr) continue;

      // No enviar si fue creada hace menos de 1 hora
      const createdAt = data.created_at?.toDate?.();
      if (createdAt) {
        const ageMs = now.getTime() - createdAt.getTime();
        if (ageMs < 60 * 60 * 1000) continue;
      }

      const chatId = data.chat_id;
      if (!chatId) continue;

      const field = data.field;
      const courtLabel = await getCourtLabelForReservation(field, data.court_type);
      const timeSlots: string[] = data.time_slots || [];
      const totalPrice = data.total_price || 0;
      const amountPaid = data.amount_paid || 0;
      const pending = totalPrice - amountPaid;
      const reservationPrice = data.reservation_price || totalPrice / 2;
      const amountToCharge = Math.min(reservationPrice - amountPaid, pending);

      if (amountToCharge <= 0) continue;

      const dateFormatted = new Date(reservationDate + "T12:00:00").toLocaleDateString("es-PE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      const startTime = timeSlots[0] || "?";
      const endHour = timeSlots.length > 0 ? parseInt(timeSlots[timeSlots.length - 1]) + 1 : "?";

      try {
        await sendWhatsAppMessage(
          chatId,
          "hola! tienes una reserva pendiente de pago, ¿la confirmas aún?"
        );

        await new Promise((r) => setTimeout(r, 1500));

        const detalles = [
          `📋 *Detalles de tu reserva:*`,
          `🏟️ Cancha: ${courtLabel}${field ? ` - Campo ${field}` : ""}`,
          `📅 Fecha: ${dateFormatted}`,
          `🕐 Horario: ${startTime} a ${endHour}:00`,
          `💰 Total: S/ ${totalPrice.toFixed(2)} | Pagado: S/ ${amountPaid.toFixed(2)} | Pendiente: S/ ${pending.toFixed(2)}`,
        ].join("\n");

        await sendWhatsAppMessage(chatId, detalles);

        await new Promise((r) => setTimeout(r, 1500));

        await sendWhatsAppMessage(
          chatId,
          `para confirmar transfiere S/ ${amountToCharge.toFixed(2)} a BCP 194-1517117-0-13 (ALIFAD EIRL) y envíame la captura por aquí 🙌`
        );

        await doc.ref.update({ auto_reminder_sent: true });
        sent++;
        console.log(`💳 Payment reminder enviado a ${chatId} (reserva ${doc.id})`);
      } catch (err) {
        console.error(`Error enviando payment reminder a ${chatId}:`, err);
      }
    }

    return NextResponse.json({ success: true, reminders_sent: sent });
  } catch (error) {
    console.error("Error in payment-reminder cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
