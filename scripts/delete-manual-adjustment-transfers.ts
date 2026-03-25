/**
 * Elimina transferencias sintéticas de ajuste (`source: manual_adjustment`, típicamente `payment_method: ajuste`).
 * Eran la contrapartida en `transfers` al editar el monto pagado sin `amount_paid_direct`.
 *
 * Importante: no toca `amount_paid` ni otras colecciones. Si hace falta reconciliar reservas, hazlo aparte.
 *
 * Simulación (solo lista y cuenta):
 *   npm run delete:adjustment-transfers
 * Borrado real:
 *   npm run delete:adjustment-transfers -- --execute
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import { getDb } from "../src/lib/firebase-admin";

const BATCH_SIZE = 400;

async function main() {
  const execute = process.argv.includes("--execute");

  const db = getDb();
  const snap = await db.collection("transfers").where("source", "==", "manual_adjustment").get();

  if (snap.empty) {
    console.log("No hay transfers con source === \"manual_adjustment\".");
    process.exit(0);
  }

  console.log(`Encontrados: ${snap.size} documento(s).`);
  const sample = snap.docs.slice(0, 15).map((d) => {
    const x = d.data();
    return {
      id: d.id,
      reservation_id: x.reservation_id ?? null,
      amount: x.amount,
      payment_method: x.payment_method,
    };
  });
  console.log("Muestra (hasta 15):", JSON.stringify(sample, null, 2));

  if (!execute) {
    console.log(
      "\nModo simulación. Para borrar de verdad ejecuta:\n  npm run delete:adjustment-transfers -- --execute"
    );
    process.exit(0);
  }

  const refs = snap.docs.map((d) => d.ref);
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = refs.slice(i, i + BATCH_SIZE);
    for (const ref of chunk) {
      batch.delete(ref);
    }
    await batch.commit();
    deleted += chunk.length;
    console.log(`  Borrados ${deleted}/${refs.length}...`);
  }

  console.log(`\nListo: eliminados ${deleted} transfers de tipo ajuste (manual_adjustment).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
