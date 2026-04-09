/**
 * scripts/dry-run-recurrent-migration-v2.ts
 * 
 * Versión corregida:
 * 1. Limita el rango estrictamente a los últimos 28 días (no incluye el futuro lejano).
 * 2. Agrupa por Cliente + Día + Hora + Cancha.
 * 3. Evita contar duplicados en el mismo día.
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

  console.log(`\n🔍 Análisis de historial (últimos 28 días): ${dateLimit} hasta ${todayStr}`);

  // Obtener reservas en el rango de fechas
  const snapshot = await db.collection("reservations")
    .where("date", ">=", dateLimit)
    .where("date", "<=", todayStr)
    .get();

  console.log(`📊 Se encontraron ${snapshot.size} reservas en el rango de fechas.`);

  const patterns: Record<string, any[]> = {};
  let validCount = 0;

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    
    // Solo consideramos reservas que realmente se jugaron/pagaron
    if (!["confirmed", "paid"].includes(data.status)) return;
    
    const dateStr = data.date;
    const dateObj = new Date(dateStr + "T12:00:00");
    const dayOfWeek = dateObj.getDay(); 
    const startTime = data.time_slots?.[0] || "unknown";
    const field = data.field || 0;
    const chatId = data.chat_id || "unknown";
    const name = data.representative_name || "(Sin nombre)";

    // CLAVE ÚNICA: Cliente + Día de la Semana + Hora + Cancha
    const key = `${chatId}|${dayOfWeek}|${startTime}|${field}`;
    
    if (!patterns[key]) {
      patterns[key] = [];
    }

    // Evitar contar dos reservas el mismo día para el mismo patrón (consistencia)
    if (!patterns[key].find(d => d.date === dateStr)) {
      patterns[key].push({ 
        id: doc.id, 
        date: dateStr, 
        name,
        day: dateObj.toLocaleDateString("es-ES", { weekday: "long" })
      });
      validCount++;
    }
  });

  const daysLabels = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  
  const recurrentPatterns = Object.entries(patterns)
    .filter(([_, docs]) => docs.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`\n================================================================`);
  console.log(`✅ RESULTADOS: PATRONES CON 3 O MÁS REPETICIONES`);
  console.log(`================================================================\n`);

  if (recurrentPatterns.length === 0) {
    console.log("No se encontraron patrones recurrentes en este periodo.");
  }

  recurrentPatterns.forEach(([key, docs]) => {
    const [chatId, dayOfWeek, startTime, field] = key.split("|");
    const dayName = daysLabels[parseInt(dayOfWeek)];

    console.log(`📌 CLIENTE: ${docs[0].name} (${chatId})`);
    console.log(`   HORARIO: ${dayName} a las ${startTime} en Cancha ${field}`);
    console.log(`   REPETICIONES: ${docs.length} de 4 posibles semanas`);
    console.log(`   FECHAS: ${docs.map(d => d.date).sort().join(", ")}`);
    console.log(`   --------------------------------------------------------------`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error("\n❌ Error:");
  console.error(err);
  process.exit(1);
});
