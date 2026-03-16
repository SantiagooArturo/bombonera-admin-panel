import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendWhatsAppMessage } from "@/lib/waha";
import { getCourtLabelForReservation } from "@/lib/court-config-server";

/**
 * GET /api/cron/reservation-reminder
 * Cron que se ejecuta cada 5 minutos.
 * Busca reservas confirmadas (status=confirmed) cuyo primer time_slot empieza en ~15 min
 * y envía un recordatorio por WhatsApp.
 * Marca la reserva con `reminder_sent: true` para no repetir.
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
    const currentHour = limaTime.getHours();
    const currentMinute = limaTime.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    // Buscar reservas confirmadas de hoy sin recordatorio enviado
    const snapshot = await db
      .collection("reservations")
      .where("date", "==", todayStr)
      .where("status", "==", "confirmed")
      .get();

    let sent = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.reminder_sent) continue;

      const timeSlots: string[] = data.time_slots || [];
      if (timeSlots.length === 0) continue;

      // Primer slot = hora de inicio
      const firstSlot = timeSlots[0];
      const [h, m] = firstSlot.split(":").map(Number);
      const slotTotalMinutes = h * 60 + (m || 0);

      const diff = slotTotalMinutes - currentTotalMinutes;

      // Enviar si faltan entre 10 y 20 minutos (ventana para el cron de cada 5 min)
      if (diff >= 10 && diff <= 20) {
        const chatId = data.chat_id;
        if (!chatId) continue;

        const field = data.field;
        const courtLabel = await getCourtLabelForReservation(field, data.court_type);
        const fieldText = field ? `Cancha ${field} · ${courtLabel}` : "";
        const startTime = firstSlot;
        const lastSlot = timeSlots[timeSlots.length - 1];
        const endHour = parseInt(lastSlot) + 1;

        const message =
          `hey! te recuerdo que tu reserva es en 15 minutos 🏐\n\n` +
          `${fieldText || "Tu cancha"} · ${startTime} a ${endHour}:00\n\n` +
          `te esperamos en la Bombonera!`;

        try {
          await sendWhatsAppMessage(chatId, message);
          await doc.ref.update({ reminder_sent: true });
          sent++;
          console.log(`⏰ Recordatorio enviado a ${chatId} (reserva ${doc.id})`);
        } catch (err) {
          console.error(`Error enviando recordatorio a ${chatId}:`, err);
        }
      }
    }

    return NextResponse.json({ success: true, reminders_sent: sent });
  } catch (error) {
    console.error("Error in reservation-reminder cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
