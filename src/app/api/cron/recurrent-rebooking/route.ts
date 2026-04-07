import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { normalizePeruPhone } from "@/features/operaciones/utils";

/**
 * GET /api/cron/recurrent-rebooking
 * Cron que se ejecuta 1 vez al día (preferiblemente de noche).
 *
 * Para cada reserva confirmada de HOY y MAÑANA de un usuario recurrente:
 * 1. Crea automáticamente una reserva para la próxima semana (mismo horario, misma cancha).
 * 2. La reserva se crea siempre en estado "pending".
 * 3. NO se envía mensaje de confirmación por WhatsApp.
 * 4. Verifica solapamientos antes de crear para evitar duplicidad de canchas.
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
    
    const now = new Date();
    const limaOffset = -5 * 60;
    const limaTime = new Date(now.getTime() + (limaOffset - now.getTimezoneOffset()) * 60000);
    
    // Calcular hoy y mañana
    const todayStr = limaTime.toISOString().slice(0, 10);
    const tomorrow = new Date(limaTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const targetDates = [todayStr, tomorrowStr];
    console.log(`[Cron] Ejecutando re-rebooking para fechas: ${targetDates.join(", ")}`);

    let createdCount = 0;
    let skippedOverlapCount = 0;

    for (const dateStr of targetDates) {
      const snapshot = await db
        .collection("reservations")
        .where("date", "==", dateStr)
        .where("status", "==", "confirmed")
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Evitar procesar dos veces
        if (data.rebooking_sent) continue;

        const rawChatId = data.chat_id;
        if (!rawChatId) continue;

        const chatId = normalizePeruPhone(String(rawChatId));
        const userDoc = await db.collection("users").doc(chatId).get();
        if (!userDoc.exists) continue;

        const userData = userDoc.data();
        // Solo clientes recurrentes
        if (userData?.client_type !== "recurrente") continue;

        const timeSlots: string[] = data.time_slots || [];
        if (timeSlots.length === 0) continue;

        const field = data.field;
        
        // Fecha destino: misma fecha de la próxima semana
        const originalDate = new Date(dateStr + "T12:00:00");
        const nextWeek = new Date(originalDate);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().slice(0, 10);

        // 1. Verificar si ya existe CUALQUIER reserva que solape en esa cancha/hora
        const existingOverlapSnap = await db
          .collection("reservations")
          .where("date", "==", nextWeekStr)
          .where("field", "==", field)
          .where("status", "in", ["pending", "confirmed"])
          .get();

        const isOverlapping = existingOverlapSnap.docs.some((d) => {
          const slots: string[] = d.data().time_slots || [];
          return slots.some(s => timeSlots.includes(s));
        });

        if (isOverlapping) {
          console.log(`[Cron] Solapamiento detectado para ${nextWeekStr} en cancha ${field}. Saltando.`);
          skippedOverlapCount++;
          // Marcamos como enviado de todos modos para no reintentar algo que no se puede
          await doc.ref.update({ rebooking_sent: true });
          continue;
        }

        // Crear la nueva reserva
        const newReservation = {
          chat_id: chatId,
          court_type: data.court_type,
          field: field || null,
          date: nextWeekStr,
          time_slots: timeSlots,
          time_ranges: data.time_ranges || [],
          slot_keys: data.slot_keys || [],
          created_at: new Date().toISOString(),
          status: "pending", // Siempre pendiente como solicitó el usuario
          total_price: data.total_price || 0,
          reservation_price: data.reservation_price || 0,
          phone_number: data.phone_number || "",
          amount_paid: 0,
          representative_name: data.representative_name || "",
          auto_confirmed: false,
          confirmed: false,
          manual_pending: true,
          source: "recurrent_rebooking_v2",
        };

        await db.collection("reservations").add(newReservation);
        createdCount++;

        // Marcar la original para no repetir
        await doc.ref.update({ rebooking_sent: true });
        console.log(`[Cron] Reserva creada para ${chatId} el ${nextWeekStr} (Cancha ${field})`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      reservations_created: createdCount, 
      skipped_by_overlap: skippedOverlapCount 
    });
  } catch (error) {
    console.error("Error in recurrent-rebooking cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
