import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendWhatsAppMessage } from "@/lib/waha";
import { getCourtLabelForReservation } from "@/lib/court-config-server";
import { formatHour12, normalizePeruPhone } from "@/features/operaciones/utils";

/**
 * GET /api/cron/recurrent-confirmation
 * Cron: lunes 7am Lima (12:00 UTC).
 *
 * Envía un único recordatorio semanal a recurrentes con reservas en la semana (lun-dom).
 * Solo a usuarios con is_automated: true.
 * Agrupa por usuario: un mensaje por persona con todas sus reservas de la semana.
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
      return NextResponse.json({ success: true, confirmations_sent: 0, skipped: "Recordatorio a recurrentes desactivado" });
    }

    const now = new Date();
    const limaOffset = -5 * 60;
    const limaTime = new Date(now.getTime() + (limaOffset - now.getTimezoneOffset()) * 60000);

    const dayOfWeek = limaTime.getDay();
    if (dayOfWeek !== 1) {
      return NextResponse.json({ success: true, confirmations_sent: 0, skipped: "Solo corre los lunes" });
    }

    const todayStr = limaTime.toISOString().slice(0, 10);
    const weekEnd = new Date(limaTime);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const snapshot = await db
      .collection("reservations")
      .where("date", ">=", todayStr)
      .where("date", "<=", weekEndStr)
      .where("status", "in", ["pending", "confirmed"])
      .get();

    const byUser = new Map<string, { chatId: string; docs: FirebaseFirestore.QueryDocumentSnapshot[] }>();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.confirmation_reminder_sent) continue;

      const rawChatId = data.chat_id;
      if (!rawChatId) continue;

      const chatId = normalizePeruPhone(String(rawChatId));
      const userDoc = await db.collection("users").doc(chatId).get();
      if (!userDoc.exists) continue;

      const userData = userDoc.data();
      if (userData?.client_type !== "recurrente") continue;
      if (userData?.is_automated === false) continue;

      if (!byUser.has(chatId)) {
        byUser.set(chatId, { chatId, docs: [] });
      }
      byUser.get(chatId)!.docs.push(doc);
    }

    let sent = 0;

    for (const { chatId, docs } of Array.from(byUser.values())) {
      if (docs.length === 0) continue;

      const lines: string[] = [];
      const docIdsToMark: string[] = [];

      for (const doc of docs) {
        const data = doc.data();
        const timeSlots: string[] = data.time_slots || [];
        if (timeSlots.length === 0) continue;

        const field = data.field;
        const courtLabel = await getCourtLabelForReservation(field, data.court_type);
        const fieldText = field ? `Cancha ${field} · ${courtLabel}` : "tu cancha";
        const startSlot = timeSlots[0];
        const lastSlot = timeSlots[timeSlots.length - 1];
        const endHour = parseInt(lastSlot) + 1;
        const timeRange = `${formatHour12(startSlot)} a ${formatHour12(String(endHour))}`;

        const dateObj = new Date(data.date + "T12:00:00");
        const dayName = dateObj.toLocaleDateString("es-PE", { weekday: "long" });
        const dateFormatted = dateObj.toLocaleDateString("es-PE", { day: "numeric", month: "long" });

        lines.push(`• ${dayName} ${dateFormatted}: ${fieldText} ${timeRange}`);
        docIdsToMark.push(doc.id);
      }

      if (lines.length === 0) continue;

      const intro = lines.length === 1
        ? "hola buenos días. tengo marcada esta reserva para ti:"
        : "hola buenos días. tengo marcadas estas reservas para ti:";

      const message =
        `${intro}\n\n` +
        lines.join("\n") +
        `\n\n¿son correctas?\n\n` +
        `(Este es un mensaje automático. Si cree que ha habido un error, disculpe las molestias, estamos mejorando.)`;

      try {
        await sendWhatsAppMessage(chatId, message);
        for (const id of docIdsToMark) {
          await db.collection("reservations").doc(id).update({ confirmation_reminder_sent: true });
        }
        sent++;
        console.log(`✅ Confirmation reminder enviado a ${chatId} (${docIdsToMark.length} reservas)`);
      } catch (err) {
        console.error(`Error enviando confirmation reminder a ${chatId}:`, err);
      }
    }

    return NextResponse.json({ success: true, confirmations_sent: sent });
  } catch (error) {
    console.error("Error in recurrent-confirmation cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
