import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendWhatsAppMessage } from "@/lib/waha";

/**
 * GET /api/cron/recurrent-rebooking
 * Cron que se ejecuta 1 vez al día a las 11pm Lima.
 * Busca reservas confirmadas (paid) de HOY de usuarios recurrentes
 * y les envía un mensaje preguntando si quieren reservar el mismo horario la próxima semana.
 * Marca la reserva con `rebooking_sent: true` para no repetir.
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

    // Buscar reservas de hoy confirmadas
    const snapshot = await db
      .collection("reservations")
      .where("date", "==", todayStr)
      .where("status", "==", "paid")
      .get();

    let sent = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.rebooking_sent) continue;

      const chatId = data.chat_id;
      if (!chatId) continue;

      // Verificar que el usuario sea recurrente
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

      // Calcular fecha de la próxima semana (mismo día)
      const nextWeek = new Date(limaTime);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekDay = nextWeek.toLocaleDateString("es-PE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      const message =
        `hola! espero que la hayas pasado bien hoy 🏐\n\n` +
        `¿quieres reservar ${field} el ${nextWeekDay} de ${startTime} a ${endHour}:00 igual que hoy?\n\n` +
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

    return NextResponse.json({ success: true, rebookings_sent: sent });
  } catch (error) {
    console.error("Error in recurrent-rebooking cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
