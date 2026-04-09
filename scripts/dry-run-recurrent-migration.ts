/**
 * scripts/dry-run-recurrent-migration.ts
 * 
 * Simula la migración de reservas recurrentes identificando patrones en las últimas 4 semanas.
 * NO realiza cambios en la base de datos.
 */

import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function main() {
  const db = getDb();
  const now = new Date();
  
  // Lima time adjustment (simplified for grouping)
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const dateLimit = fourWeeksAgo.toISOString().slice(0, 10);

  console.log(`\n🔍 Análisis de reservas desde: ${dateLimit} (últimos 28 días)`);

  // Obtener reservas por fecha únicamente para evitar requerir índices compuestos
  const snapshot = await db.collection("reservations")
    .where("date", ">=", dateLimit)
    .get();

  console.log(`📊 Se encontraron ${snapshot.size} reservas totales en el periodo.`);

  // Mapa para agrupar patrones: chat_id | day_of_week | start_time | field
  const patterns: Record<string, any[]> = {};
  let validReservationCount = 0;

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    
    // Filtrado de estado en memoria
    if (!["confirmed", "paid"].includes(data.status)) return;
    validReservationCount++;
    // Parseamos la fecha. Usamos T12:00:00 para evitar problemas de zona horaria al obtener el día de la semana.
    const dateObj = new Date(data.date + "T12:00:00");
    const dayOfWeek = dateObj.getDay(); 
    const startTime = data.time_slots?.[0] || "unknown";
    const field = data.field || 0;
    const chatId = data.chat_id || "unknown";
    const name = data.representative_name || "(Sin nombre)";

    const key = `${chatId}|${dayOfWeek}|${startTime}|${field}`;
    
    if (!patterns[key]) {
      patterns[key] = [];
    }
    patterns[key].push({ 
      id: doc.id, 
      date: data.date, 
      name,
      day: dateObj.toLocaleDateString("es-ES", { weekday: "long" })
    });
  });

  console.log(`📊 Se procesaron ${validReservationCount} reservas confirmadas/pagadas.`);

  const daysLabels = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  
  const recurrentPatterns = Object.entries(patterns)
    .filter(([_, docs]) => docs.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`\n================================================================`);
  console.log(`✅ SE IDENTIFICARON ${recurrentPatterns.length} POSIBLES HORARIOS RECURRENTES`);
  console.log(`================================================================\n`);

  if (recurrentPatterns.length === 0) {
    console.log("No se encontraron patrones que se repitan 3 o más veces.");
  }

  recurrentPatterns.forEach(([key, docs]) => {
    const [chatId, dayOfWeek, startTime, field] = key.split("|");
    const representativeName = docs[0].name;
    const dayName = daysLabels[parseInt(dayOfWeek)];

    console.log(`📌 CLIENTE: ${representativeName} (${chatId})`);
    console.log(`   HORARIO: ${dayName} a las ${startTime} en Cancha ${field}`);
    console.log(`   REPETICIONES: ${docs.length} veces en las últimas 4 semanas`);
    console.log(`   FECHAS: ${docs.map(d => d.date).sort().join(", ")}`);
    console.log(`   --------------------------------------------------------------`);
  });

  console.log(`\n[DRY RUN] No se realizó ningún cambio en Firestore.`);
  process.exit(0);
}

main().catch(err => {
  console.error("\n❌ Error ejecutando el script:");
  console.error(err);
  process.exit(1);
});
