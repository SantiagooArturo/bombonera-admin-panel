import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));

import { getDb } from "../src/lib/firebase-admin";

async function inspectData() {
  const db = getDb();
  const schedulesSnap = await db.collection("recurrent_schedules").limit(5).get();
  console.log("--- RECURRENT SCHEDULES ---");
  for (const doc of schedulesSnap.docs) {
    const data = doc.data();
    console.log(`ID: ${doc.id}, ChatID: ${data.chat_id}, Name: ${data.representative_name}`);
    
    // Buscar este chat_id en la colección users
    if (data.chat_id) {
        const userDoc = await db.collection("users").doc(String(data.chat_id)).get();
        if (userDoc.exists) {
            console.log(`   ✅ Encontrado en users: ${userDoc.data()?.client_type}`);
        } else {
            console.log(`   ❌ NO encontrado en users con ID EXACTO: ${data.chat_id}`);
            // Probar sin el 51
            const shortId = String(data.chat_id).replace(/^51/, "");
            const userDoc2 = await db.collection("users").doc(shortId).get();
            if (userDoc2.exists) {
                console.log(`   🔍 Encontrado en users con ID CORTO: ${shortId}`);
            }
        }
    }
  }
  process.exit(0);
}

inspectData().catch(err => {
  console.error(err);
  process.exit(1);
});
