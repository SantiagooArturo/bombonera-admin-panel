import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function syncFutureRecurrentFlags() {
  const db = getDb();
  console.log("🔄 Iniciando sincronización de flags recurrentes para el futuro...");

  // 1. Obtener todos los dueños registrados
  const schedulesSnap = await db.collection("recurrent_schedules").get();
  const schedules = schedulesSnap.docs.map(d => d.data());
  console.log(`📌 Encontrados ${schedules.length} horarios maestros.`);

  // 2. Obtener reservas futuras (desde hoy en adelante)
  const todayStr = new Date().toISOString().slice(0, 10);
  const reservationsSnap = await db.collection("reservations")
    .where("date", ">=", todayStr)
    .where("status", "==", "confirmed")
    .get();

  console.log(`🔍 Analizando ${reservationsSnap.docs.length} reservas futuras confirmadas...`);

  let updatedCount = 0;

  for (const doc of reservationsSnap.docs) {
    const data = doc.data();
    if (data.is_recurrent) continue; // Ya lo tiene

    const dayOfWeek = new Date(data.date + "T12:00:00").getDay();
    const startTime = data.time_slots?.[0] || "";
    const field = data.field;

    // Buscar si hay un dueño para este slot
    const owner = schedules.find(s => 
      s.day_of_week === dayOfWeek && 
      s.field === field && 
      s.start_time === startTime
    );

    if (owner && owner.chat_id === data.chat_id) {
      await doc.ref.update({ is_recurrent: true });
      updatedCount++;
      console.log(`✅ Marcada como recurrente: ${data.representative_name} - ${data.date} ${startTime} (Cancha ${field})`);
    }
  }

  console.log(`\n✨ Sincronización terminada. Se actualizaron ${updatedCount} reservas futuras.`);
  process.exit(0);
}

syncFutureRecurrentFlags().catch(err => {
  console.error(err);
  process.exit(1);
});
