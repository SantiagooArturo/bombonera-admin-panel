import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function promoteRecurrentUsers() {
  const db = getDb();
  console.log("🚀 Iniciando promoción de usuarios a 'frecuente'...");

  // 1. Obtener todos los dueños de horarios recurrentes
  const schedulesSnap = await db.collection("recurrent_schedules").get();
  const chatIds = new Set<string>();
  
  schedulesSnap.docs.forEach(doc => {
    const data = doc.data();
    if (data.chat_id) {
      chatIds.add(data.chat_id);
    }
  });

  console.log(`📌 Encontrados ${chatIds.size} clientes con horarios recurrentes.`);

  let updatedCount = 0;

  for (const chatId of chatIds) {
    const userRef = db.collection("users").doc(chatId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
        const userData = userDoc.data()!;
        // Solo actualizamos si era casual o recurrente (viejo)
        // No queremos tocar "sospechoso_fraude" o si ya es "academia"
        if (userData.client_type === "casual" || userData.client_type === "recurrente") {
            await userRef.update({ client_type: "frecuente" });
            updatedCount++;
            console.log(`✅ Usuario ${chatId} (${userData.custom_name || userData.push_name || 'Sin nombre'}) marcado como Frecuente.`);
        }
    } else {
        console.warn(`⚠️ Usuario con ID ${chatId} no encontrado en la colección 'users'.`);
    }
  }

  console.log(`\n✨ Proceso terminado. Se actualizaron ${updatedCount} usuarios.`);
  process.exit(0);
}

promoteRecurrentUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
