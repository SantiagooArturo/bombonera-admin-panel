/**
 * scripts/recurrent-migration-final.ts
 * 
 * EJECUCIÓN REAL DE LA MIGRACIÓN.
 * 1. Identifica patrones recurrentes en las últimas 4 semanas.
 * 2. Marca la reserva más reciente con is_recurrent: true.
 * 3. Crea el registro en la colección 'recurrent_schedules' para control de dueños.
 * 4. Resetea el atributo client_type de todos los usuarios de "recurrente" a "casual".
 */

import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function main() {
  const db = getDb();
  const now = new Date();
  
  // Rango de 28 días hacia atrás desde hoy
  const todayStr = now.toISOString().slice(0, 10);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const dateLimit = fourWeeksAgo.toISOString().slice(0, 10);

  console.log(`\n🚀 INICIANDO MIGRACIÓN REAL`);
  console.log(`📅 Rango de análisis: ${dateLimit} hasta ${todayStr}`);

  const snapshot = await db.collection("reservations")
    .where("date", ">=", dateLimit)
    .where("date", "<=", todayStr)
    .get();

  const patterns: Record<string, any[]> = {};
  
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (!["confirmed", "paid"].includes(data.status)) return;
    
    const dateStr = data.date;
    const dateObj = new Date(dateStr + "T12:00:00");
    const dayOfWeek = dateObj.getDay(); 
    const startTime = data.time_slots?.[0] || "unknown";
    const field = data.field || 0;
    const chatId = data.chat_id || "unknown";
    const name = data.representative_name || "(Sin nombre)";

    const key = `${chatId}|${dayOfWeek}|${startTime}|${field}`;
    
    if (!patterns[key]) patterns[key] = [];
    if (!patterns[key].find(d => d.date === dateStr)) {
      patterns[key].push({ id: doc.id, date: dateStr, name, dayOfWeek, startTime, field, chatId });
    }
  });

  const recurrentPatterns = Object.entries(patterns).filter(([_, docs]) => docs.length >= 3);
  console.log(`✅ Se identificaron ${recurrentPatterns.length} patrones recurrentes para migrar.`);

  const batch = db.batch();
  let operationsCount = 0;

  for (const [key, docs] of recurrentPatterns) {
    // Ordenar por fecha descendente para obtener la más reciente
    docs.sort((a, b) => b.date.localeCompare(a.date));
    const latest = docs[0];
    const [chatId, dayOfWeek, startTime, field] = key.split("|");

    // 1. Marcar reserva específica
    const resRef = db.collection("reservations").doc(latest.id);
    batch.update(resRef, { is_recurrent: true });

    // 2. Crear/Actualizar registro de dueño en recurrent_schedules
    // ID: day_field_time
    const scheduleId = `${dayOfWeek}_${field}_${startTime}`;
    const scheduleRef = db.collection("recurrent_schedules").doc(scheduleId);
    
    batch.set(scheduleRef, {
      id: scheduleId,
      chat_id: latest.chatId,
      representative_name: latest.name,
      field: parseInt(field),
      day_of_week: parseInt(dayOfWeek),
      start_time: startTime,
      last_reservation_id: latest.id,
      created_at: new Date().toISOString()
    });

    operationsCount += 2;
  }

  // 3. Resetear tipos de usuario
  const usersSnap = await db.collection("users").where("client_type", "==", "recurrente").get();
  console.log(`🧹 Reseteando ${usersSnap.size} usuarios de tipo 'recurrente' a 'casual'.`);
  
  usersSnap.docs.forEach(u => {
    batch.update(u.ref, { client_type: "casual" });
    operationsCount++;
  });

  if (operationsCount > 0) {
    await batch.commit();
    console.log(`\n🎉 MIGRACIÓN COMPLETADA EXITOSAMENTE`);
    console.log(`✨ Reservas marcadas: ${recurrentPatterns.length}`);
    console.log(`✨ Horarios registrados: ${recurrentPatterns.length}`);
    console.log(`✨ Usuarios actualizados: ${usersSnap.size}`);
  } else {
    console.log("\n⚠️ No se encontraron cambios para realizar.");
  }

  process.exit(0);
}

main().catch(err => {
  console.error("\n❌ ERROR DURANTE LA MIGRACIÓN:");
  console.error(err);
  process.exit(1);
});
