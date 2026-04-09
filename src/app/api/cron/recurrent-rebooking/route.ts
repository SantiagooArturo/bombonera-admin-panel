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

    // 1. Obtener todos los horarios maestros (fuente única de verdad)
    const schedulesSnap = await db.collection("recurrent_schedules").get();
    const schedules = schedulesSnap.docs.map(d => d.data());
    
    console.log(`[Cron] Encontrados ${schedules.length} horarios recurrentes maestros.`);

    for (const dateStr of targetDates) {
      console.log(`[Cron] Procesando fecha: ${dateStr}`);
      
      for (const schedule of schedules) {
        // Verificar si este horario maestro corresponde al día de la semana que estamos procesando
        const dayOfWeek = new Date(dateStr + "T12:00:00").getDay();
        if (schedule.day_of_week !== dayOfWeek) continue;

        const { chat_id, field, start_time, representative_name } = schedule;

        // 2. Buscar si ya existe una reserva BASE confirmada para este dueño en este slot
        const baseResSnap = await db.collection("reservations")
          .where("date", "==", dateStr)
          .where("chat_id", "==", chat_id)
          .where("field", "==", field)
          .get();

        const baseResDoc = baseResSnap.docs.find(d => {
          const slots: string[] = d.data().time_slots || [];
          return slots[0] === start_time && d.data().status === "confirmed";
        });

        if (!baseResDoc) {
          // Si no hay reserva base confirmada hoy, no autogeneramos la siguiente
          // (Pudo haber sido cancelada o no pagada)
          continue;
        }

        const baseResData = baseResDoc.data();
        if (baseResData.rebooking_sent) continue;

        // Fecha destino: misma fecha de la próxima semana
        const nextWeek = new Date(new Date(dateStr + "T12:00:00").getTime() + 7 * 24 * 60 * 60 * 1000);
        const nextWeekStr = nextWeek.toISOString().slice(0, 10);

        // 3. Verificar solapamiento en el destino
        const existingOverlapSnap = await db.collection("reservations")
          .where("date", "==", nextWeekStr)
          .where("field", "==", field)
          .where("status", "in", ["pending", "confirmed"])
          .get();

        const isOverlapping = existingOverlapSnap.docs.some(d => {
          const slots: string[] = d.data().time_slots || [];
          return slots.includes(start_time);
        });

        if (isOverlapping) {
          console.log(`[Cron] Solapamiento en ${nextWeekStr} ${start_time} Cancha ${field}. Saltando.`);
          skippedOverlapCount++;
          await baseResDoc.ref.update({ rebooking_sent: true });
          continue;
        }

        // 4. Crear la nueva reserva (clon)
        const newReservation = {
          chat_id,
          field,
          date: nextWeekStr,
          time_slots: baseResData.time_slots,
          time_ranges: baseResData.time_ranges || [],
          slot_keys: baseResData.slot_keys || [],
          created_at: new Date().toISOString(),
          status: "pending",
          total_price: baseResData.total_price || 0,
          reservation_price: baseResData.reservation_price || 0,
          phone_number: baseResData.phone_number || "",
          amount_paid: 0,
          representative_name: representative_name || baseResData.representative_name || "",
          auto_confirmed: false,
          confirmed: false,
          manual_pending: true,
          source: "recurrent_rebooking_v4_ssot",
        };

        await db.collection("reservations").add(newReservation);
        createdCount++;

        // Marcar la base para no repetir
        await baseResDoc.ref.update({ rebooking_sent: true });
        console.log(`[Cron] Generada reserva para ${representative_name} el ${nextWeekStr}`);
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
