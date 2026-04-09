import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function finalFixAndLog() {
  const db = getDb();
  console.log("🔍 INICIANDO AUDITORÍA DE USUARIOS FRECUENTES");
  
  const schedulesSnap = await db.collection("recurrent_schedules").get();
  const schedules = schedulesSnap.docs.map(d => d.data());
  
  console.log(`📊 Total de horarios recurrentes maestros: ${schedules.length}`);

  let stats = {
    total_schedules: schedules.length,
    valid_chat_ids: 0,
    found_in_users: 0,
    not_found_in_users: 0,
    already_frequent: 0,
    updated_to_frequent: 0,
    phone_matches: 0
  };

  const processedChatIds = new Set<string>();

  for (const schedule of schedules) {
    const rawId = schedule.chat_id;
    if (!rawId) continue;
    
    const chatId = String(rawId);
    if (processedChatIds.has(chatId)) continue;
    processedChatIds.add(chatId);
    
    stats.valid_chat_ids++;

    // 1. Intentar encontrar por ID exacto
    const userRef = db.collection("users").doc(chatId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      stats.found_in_users++;
      const userData = userDoc.data()!;
      
      if (userData.client_type === "frecuente" || userData.client_type === "academia") {
        stats.already_frequent++;
      } else {
        await userRef.update({ client_type: "frecuente" });
        stats.updated_to_frequent++;
        console.log(`✅ [UPDATED] ${chatId} (${userData.custom_name || 'Sin nombre'}) -> Frecuente`);
      }
    } else {
      // 2. Intentar buscar por phone_number (por si el ID es diferente)
      const phoneMatch = await db.collection("users").where("phone_number", "==", chatId).get();
      
      if (!phoneMatch.empty) {
        stats.found_in_users++;
        stats.phone_matches++;
        const doc = phoneMatch.docs[0];
        const userData = doc.data();

        if (userData.client_type === "frecuente" || userData.client_type === "academia") {
          stats.already_frequent++;
        } else {
          await doc.ref.update({ client_type: "frecuente" });
          stats.updated_to_frequent++;
          console.log(`✅ [UPDATED-BY-PHONE] ${chatId} (${userData.custom_name || 'Sin nombre'}) -> Frecuente`);
        }
      } else {
        stats.not_found_in_users++;
        console.log(`❌ [NOT FOUND] El dueño ${chatId} (${schedule.representative_name}) no existe en la colección de UNUARIOS.`);
      }
    }
  }

  console.log("\n--- RESULTADOS FINALES ---");
  console.log(`✅ Usuarios que ya estaban bien: ${stats.already_frequent}`);
  console.log(`🆙 Usuarios corregidos a Frecuente: ${stats.updated_to_frequent}`);
  console.log(`🔎 Encontrados por Phone Number: ${stats.phone_matches}`);
  console.log(`❌ Usuarios NO ENCONTRADOS en la DB: ${stats.not_found_in_users}`);
  console.log(`--------------------------`);
  
  if (stats.not_found_in_users > 0) {
    console.log("💡 Nota: Los usuarios no encontrados pueden ser registros de WhatsApp que nunca han interactuado con el sistema de perfiles o fueron eliminados.");
  }

  process.exit(0);
}

finalFixAndLog().catch(err => {
  console.error(err);
  process.exit(1);
});
