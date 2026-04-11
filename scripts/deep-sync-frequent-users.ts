import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function deepSyncFrequentUsers() {
  const db = getDb();
  console.log("🚀 Iniciando Super-Sincronización de usuarios 'frecuente'...");

  const frequentChatIds = new Set<string>();

  // 1. De los horarios maestros
  const schedulesSnap = await db.collection("recurrent_schedules").get();
  schedulesSnap.docs.forEach(doc => {
    const cid = doc.data().chat_id;
    if (cid) frequentChatIds.add(String(cid));
  });

  // 2. De cualquier reserva marcada como recurrente (por si hay slots que no migraron al maestro)
  const resSnap = await db.collection("reservations")
    .where("is_recurrent", "==", true)
    .get();
  resSnap.docs.forEach(doc => {
    const cid = doc.data().chat_id;
    if (cid) frequentChatIds.add(String(cid));
  });

  console.log(`📌 Encontrados ${frequentChatIds.size} Identificadores únicos de clientes recurrentes.`);

  let updatedCount = 0;
  let notFoundCount = 0;

  Array.from(frequentChatIds).forEach(async (chatId) => {
    const userRef = db.collection("users").doc(chatId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const userData = userDoc.data()!;
      if (userData.client_type !== "frecuente" && userData.client_type !== "academia" && userData.client_type !== "sospechoso_fraude") {
        await userRef.update({ client_type: "frecuente" });
        updatedCount++;
        console.log(`✅ [SYNC] ${chatId} (${userData.custom_name || 'Sin nombre'}) -> Frecuente`);
      }
    } else {
      // Intentar buscar por teléfono si el ID no coincide exactamente
      const phoneMatch = await db.collection("users").where("phone_number", "==", chatId).get();
      if (!phoneMatch.empty) {
        const doc = phoneMatch.docs[0];
        if (doc.data().client_type !== "frecuente") {
          await doc.ref.update({ client_type: "frecuente" });
          updatedCount++;
          console.log(`✅ [SYNC-PHONE] ${chatId} -> Frecuente`);
        }
      } else {
        notFoundCount++;
        console.warn(`⚠️ [NOT FOUND] ${chatId} no existe en la colección 'users'.`);
      }
    }
  });

  console.log(`\n✨ Sincronización terminada.`);
  console.log(`📈 Usuarios actualizados: ${updatedCount}`);
  console.log(`❓ Usuarios no encontrados: ${notFoundCount}`);
  process.exit(0);
}

deepSyncFrequentUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
