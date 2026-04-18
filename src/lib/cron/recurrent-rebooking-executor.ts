import { getDb } from "@/lib/firebase-admin";
import type { RecurrentSchedule } from "@/lib/types";
import { normalizePeruPhone, normalizePhoneKey } from "@/features/operaciones/utils";

/** Estados de la reserva “base” que disparan la creación de la semana siguiente. */
const BASE_STATUSES_FOR_REBOOKING = ["pending", "confirmed", "paid"];

export type RecurrentRebookingRunResult = {
  success: true;
  reservations_created: number;
  skipped_by_overlap: number;
};

/**
 * Lógica compartida por el cron HTTP y por scripts locales (`tsx scripts/...`).
 */
export async function executeRecurrentRebooking(): Promise<RecurrentRebookingRunResult> {
  const db = getDb();

  const now = new Date();
  const limaOffset = -5 * 60;
  const limaTime = new Date(now.getTime() + (limaOffset - now.getTimezoneOffset()) * 60000);

  const todayStr = limaTime.toISOString().slice(0, 10);
  const tomorrow = new Date(limaTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const targetDates = [todayStr, tomorrowStr];
  console.log(`[Cron] Ejecutando re-rebooking para fechas: ${targetDates.join(", ")}`);

  let createdCount = 0;
  let skippedOverlapCount = 0;

  const schedulesSnap = await db.collection("recurrent_schedules").get();
  const schedules = schedulesSnap.docs.map((d) => d.data() as RecurrentSchedule);

  console.log(`[Cron] Encontrados ${schedules.length} horarios recurrentes maestros.`);

  for (const dateStr of targetDates) {
    console.log(`[Cron] Procesando fecha: ${dateStr}`);

    for (const schedule of schedules) {
      const dayOfWeek = new Date(dateStr + "T12:00:00").getDay();
      if (schedule.day_of_week !== dayOfWeek) continue;

      const { field, start_time, representative_name } = schedule;
      const schedulePhoneRaw = String(schedule.phone_number || schedule.chat_id || "");
      const schedulePhoneKey = normalizePhoneKey(schedulePhoneRaw);
      if (!schedulePhoneKey) continue;

      const baseResSnap = await db.collection("reservations")
        .where("date", "==", dateStr)
        .where("field", "==", field)
        .get();

      const baseResDoc = baseResSnap.docs.find((d) => {
        const data = d.data();
        const slots: string[] = data.time_slots || [];
        if (slots[0] !== start_time) return false;
        if (!BASE_STATUSES_FOR_REBOOKING.includes(String(data.status))) return false;
        const resKey = normalizePhoneKey(data.phone_number || data.chat_id);
        return Boolean(resKey) && resKey === schedulePhoneKey;
      });

      if (!baseResDoc) continue;

      const baseResData = baseResDoc.data();
      if (baseResData.rebooking_sent) continue;

      const nextWeek = new Date(new Date(dateStr + "T12:00:00").getTime() + 7 * 24 * 60 * 60 * 1000);
      const nextWeekStr = nextWeek.toISOString().slice(0, 10);

      const existingOverlapSnap = await db.collection("reservations")
        .where("date", "==", nextWeekStr)
        .where("field", "==", field)
        .get();

      const isOverlapping = existingOverlapSnap.docs.some((d) => {
        const slots: string[] = d.data().time_slots || [];
        return slots.includes(start_time);
      });

      if (isOverlapping) {
        console.log(`[Cron] Solapamiento en ${nextWeekStr} ${start_time} Cancha ${field}. Saltando.`);
        skippedOverlapCount++;
        await baseResDoc.ref.update({ rebooking_sent: true });
        continue;
      }

      const basePhone =
        normalizePeruPhone(String(baseResData.phone_number || baseResData.chat_id || "").replace(/\D/g, "")) ||
        String(baseResData.phone_number || "").replace(/\D/g, "");
      const newReservation = {
        chat_id: baseResData.chat_id || baseResData.phone_number || basePhone,
        field,
        date: nextWeekStr,
        time_slots: baseResData.time_slots,
        time_ranges: baseResData.time_ranges || [],
        slot_keys: baseResData.slot_keys || [],
        created_at: new Date().toISOString(),
        status: "pending",
        total_price: baseResData.total_price || 0,
        reservation_price: baseResData.reservation_price || 0,
        phone_number: basePhone,
        amount_paid: 0,
        representative_name: representative_name || baseResData.representative_name || "",
        auto_confirmed: false,
        confirmed: false,
        manual_pending: true,
        source: "recurrent_rebooking_v4_ssot",
      };

      await db.collection("reservations").add(newReservation);
      createdCount++;

      await baseResDoc.ref.update({ rebooking_sent: true });
      console.log(`[Cron] Generada reserva para ${representative_name} el ${nextWeekStr}`);
    }
  }

  return {
    success: true,
    reservations_created: createdCount,
    skipped_by_overlap: skippedOverlapCount,
  };
}
