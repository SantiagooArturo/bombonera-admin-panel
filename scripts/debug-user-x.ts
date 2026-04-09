import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function debugSpecificUser(targetPhone: string) {
  const db = getDb();
  const cleanPhone = targetPhone.replace(/\D/g, "");
  console.log(`🔎 INVESTIGANDO: ${cleanPhone}`);

  // 1. Buscar en USERS
  console.log("\n--- [Colección USERS] ---");
  const userDoc = await db.collection("users").doc(cleanPhone).get();
  if (userDoc.exists) {
    console.log(`✅ Usuario encontrado (ID: ${cleanPhone})`);
    console.log(`   Nombre: ${userDoc.data()?.custom_name || userDoc.data()?.push_name}`);
    console.log(`   Tipo: ${userDoc.data()?.client_type}`);
  } else {
    console.log(`❌ No existe documento con ID ${cleanPhone} en users.`);
    const phoneMatch = await db.collection("users").where("phone_number", "==", cleanPhone).get();
    if (!phoneMatch.empty) {
      console.log(`🔍 PERO se encontró por phone_number en documento ${phoneMatch.docs[0].id}`);
      console.log(`   Tipo: ${phoneMatch.docs[0].data().client_type}`);
    } else {
        console.log("❌ Definitivamente no existe en la colección users por ID ni por phone_number.");
    }
  }

  // 2. Buscar en RECURRENT_SCHEDULES
  console.log("\n--- [Colección RECURRENT_SCHEDULES] ---");
  const schedSnap = await db.collection("recurrent_schedules").where("chat_id", "==", cleanPhone).get();
  if (!schedSnap.empty) {
    console.log(`✅ Es dueño de ${schedSnap.size} horario(s) fijo(s).`);
    schedSnap.forEach(d => {
        const dd = d.data();
        console.log(`   Slot: Campp ${dd.field}, Día ${dd.day_of_week}, Hora ${dd.start_time}`);
    });
  } else {
    console.log("❌ No figura en el registro maestro de dueños.");
  }

  // 3. Buscar en RESERVATIONS
  console.log("\n--- [Colección RESERVATIONS] ---");
  const resSnap = await db.collection("reservations")
    .where("chat_id", "==", cleanPhone)
    .where("is_recurrent", "==", true)
    .get();
  if (!resSnap.empty) {
    console.log(`✅ Tiene ${resSnap.size} reservas marcadas con is_recurrent: true.`);
  } else {
    console.log("❌ No tiene reservas marcadas como recurrentes.");
  }

  process.exit(0);
}

debugSpecificUser("51999069723").catch(err => {
  console.error(err);
  process.exit(1);
});
