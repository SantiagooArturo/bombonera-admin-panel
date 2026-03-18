import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendWhatsAppMessage } from "@/lib/waha";
import { getCourtLabelForReservation } from "@/lib/court-config-server";
import { formatHour12, normalizePeruPhone } from "@/features/operaciones/utils";

/**
 * GET /api/cron/recurrent-rebooking
 * Cron que se ejecuta 1 vez al día a las 11pm Lima.
 *
 * Para cada reserva confirmada de HOY de un usuario recurrente:
 * 1. Crea automáticamente una reserva para la próxima semana (mismo horario, misma cancha).
 * 2. Envía un mensaje preguntando si vendrá la próxima semana a la misma hora.
 *    - Si dice que no → el chatbot cancela la reserva creada.
 *    - Si dice que sí o "te confirmo luego" → la reserva se mantiene.
 *
 * Marca la reserva original con `rebooking_sent: true` para no repetir.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();

    const settingsDoc = await db.collection("config").doc("app_settings").get();
    const recurrentReminderEnabled = settingsDoc.data()?.recurrent_reminder_enabled !== false;
    if (!recurrentReminderEnabled) {
      return NextResponse.json({ success: true, reservations_created: 0, messages_sent: 0, skipped: "Recordatorios a recurrentes desactivados" });
    }

    const now = new Date();

    const limaOffset = -5 * 60;
    const limaTime = new Date(now.getTime() + (limaOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = limaTime.toISOString().slice(0, 10);

    const snapshot = await db
      .collection("reservations")
      .where("date", "==", todayStr)
      .where("status", "==", "confirmed")
      .get();

    let sent = 0;
    let created = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.rebooking_sent) continue;

      const rawChatId = data.chat_id;
      if (!rawChatId) continue;

      const chatId = normalizePeruPhone(String(rawChatId));
      const userDoc = await db.collection("users").doc(chatId).get();
      if (!userDoc.exists) continue;

      const userData = userDoc.data();
      if (userData?.client_type !== "recurrente") continue;

      const timeSlots: string[] = data.time_slots || [];
      if (timeSlots.length === 0) continue;

      const field = data.field;
      const startTime = timeSlots[0];
      const lastSlot = timeSlots[timeSlots.length - 1];
      const endHour = parseInt(lastSlot) + 1;

      const nextWeek = new Date(limaTime);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().slice(0, 10);
      const nextWeekDay = nextWeek.toLocaleDateString("es-PE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      // Verificar que no exista ya una reserva para ese usuario en esa fecha/horario
      const existingSnap = await db
        .collection("reservations")
        .where("chat_id", "==", chatId)
        .where("date", "==", nextWeekStr)
        .where("status", "in", ["pending", "confirmed"])
        .get();

      const alreadyExists = existingSnap.docs.some((d) => {
        const slots: string[] = d.data().time_slots || [];
        return slots[0] === timeSlots[0];
      });

      if (!alreadyExists) {
        const newReservation = {
          chat_id: chatId,
          court_type: data.court_type,
          field: field || null,
          date: nextWeekStr,
          time_slots: timeSlots,
          time_ranges: data.time_ranges || [],
          slot_keys: data.slot_keys || [],
          created_at: new Date().toISOString(),
          status: "pending",
          total_price: data.total_price || 0,
          reservation_price: data.reservation_price || 0,
          phone_number: data.phone_number || "",
          amount_paid: 0,
          representative_name: data.representative_name || "",
          auto_confirmed: true,
          confirmed: true,
          source: "recurrent_rebooking",
        };

        await db.collection("reservations").add(newReservation);
        created++;
      }

      const courtLabel = await getCourtLabelForReservation(field, data.court_type);
      const fieldLabel = field ? `Cancha ${field} · ${courtLabel}` : "tu cancha";
      const timeRange = `${formatHour12(startTime)} a ${formatHour12(String(endHour))}`;
      const message =
        `hola! espero que la hayas pasado bien hoy 🏐\n\n` +
        `¿quieres reservar ${fieldLabel} el ${nextWeekDay} de ${timeRange} igual que hoy?\n\n` +
        `respóndeme y te lo reservo al toque`;

      try {
        await sendWhatsAppMessage(chatId, message);
        await doc.ref.update({ rebooking_sent: true });
        sent++;
        console.log(`🔄 Rebooking enviado a ${chatId} (reserva ${doc.id})`);
      } catch (err) {
        console.error(`Error enviando rebooking a ${chatId}:`, err);
      }
    }

    return NextResponse.json({ success: true, reservations_created: created, messages_sent: sent });
  } catch (error) {
    console.error("Error in recurrent-rebooking cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
