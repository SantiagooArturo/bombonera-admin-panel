import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendWhatsAppMessage } from "@/lib/waha";

/**
 * GET /api/cron/recurrent-confirmation
 * Cron diario (~10am Lima).
 *
 * Busca reservas futuras (en 4 días) de usuarios recurrentes
 * y les envía un mensaje de confirmación final.
 *
 * Lógica: la reserva se crea automáticamente al terminar la anterior (7 días antes).
 * 3 días después (= 4 días antes de la reserva), se pide confirmación.
 * Si no confirma, el chatbot se encarga de cancelar.
 *
 * Marca la reserva con `confirmation_reminder_sent: true` para no repetir.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const now = new Date();

    const limaOffset = -5 * 60;
    const limaTime = new Date(now.getTime() + (limaOffset - now.getTimezoneOffset()) * 60000);

    const targetDate = new Date(limaTime);
    targetDate.setDate(targetDate.getDate() + 4);
    const targetDateStr = targetDate.toISOString().slice(0, 10);

    const targetFormatted = targetDate.toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const snapshot = await db
      .collection("reservations")
      .where("date", "==", targetDateStr)
      .where("status", "in", ["pending", "confirmed"])
      .get();

    let sent = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.confirmation_reminder_sent) continue;

      const chatId = data.chat_id;
      if (!chatId) continue;

      const userDoc = await db.collection("users").doc(chatId).get();
      if (!userDoc.exists) continue;

      const userData = userDoc.data();
      if (userData?.client_type !== "recurrente") continue;

      const timeSlots: string[] = data.time_slots || [];
      if (timeSlots.length === 0) continue;

      const field = data.field ? `cancha ${data.field}` : "tu cancha";
      const startTime = timeSlots[0];
      const lastSlot = timeSlots[timeSlots.length - 1];
      const endHour = parseInt(lastSlot) + 1;

      const message =
        `hola! te escribo para confirmar por última vez tu reserva del ${targetFormatted} 🏐\n\n` +
        `${field} de ${startTime} a ${endHour}:00\n\n` +
        `¿confirmas? sino para liberar la cancha`;

      try {
        await sendWhatsAppMessage(chatId, message);
        await doc.ref.update({ confirmation_reminder_sent: true });
        sent++;
        console.log(`✅ Confirmation reminder enviado a ${chatId} (reserva ${doc.id})`);
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
