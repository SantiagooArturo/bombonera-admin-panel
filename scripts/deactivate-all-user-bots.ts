/**
 * Desactiva el bot (is_automated: false) para todos los usuarios que lo tienen activo
 * o sin campo (misma regla que el panel: ausente = activo).
 *
 * Simulación (solo cuenta):
 *   npm run deactivate:user-bots
 * Ejecutar:
 *   npm run deactivate:user-bots -- --execute
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import { getDb } from "../src/lib/firebase-admin";

const BATCH_MAX = 400;

async function main() {
  const execute = process.argv.includes("--execute");
  const db = getDb();
  const snap = await db.collection("users").get();
  const targets = snap.docs.filter((d) => d.data().is_automated !== false);

  console.log(`Usuarios en colección: ${snap.size}`);
  console.log(`Con bot activo (true o sin campo): ${targets.length}`);

  if (targets.length === 0) {
    console.log("Nada que actualizar.");
    process.exit(0);
  }

  if (!execute) {
    console.log("\nSimulación. Para aplicar:\n  npm run deactivate:user-bots -- --execute");
    process.exit(0);
  }

  let batch = db.batch();
  let inBatch = 0;
  let updated = 0;
  for (const doc of targets) {
    batch.update(doc.ref, { is_automated: false });
    inBatch++;
    updated++;
    if (inBatch >= BATCH_MAX) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      console.log(`  … ${updated} actualizados`);
    }
  }
  if (inBatch > 0) {
    await batch.commit();
  }

  console.log(`\nListo: is_automated=false en ${updated} documento(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
