/**
 * Normaliza `cliente_denominacion` y `representative_name_snapshot` en todos los invoices:
 * quita la palabra voley/volley (variantes) y todos los dígitos del nombre.
 *
 *   npx tsx scripts/sanitize-invoice-receptor-names.ts
 *   SANITIZE_INVOICE_NAMES_APPLY=1 npx tsx scripts/sanitize-invoice-receptor-names.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import { getDb } from "../src/lib/firebase-admin";
import {
  receptorNombreParaSunat,
  receptorNombreSnapshot,
} from "../src/features/boletas/utils/sanitizeReceptorNombre";

const APPLY =
  process.env.SANITIZE_INVOICE_NAMES_APPLY === "1" ||
  process.env.SANITIZE_INVOICE_NAMES_APPLY === "true";

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

async function main() {
  const db = getDb();
  console.log(
    APPLY
      ? "APLICAR: saneando nombres de receptor en invoices\n"
      : "SIMULACIÓN. SANITIZE_INVOICE_NAMES_APPLY=1 para escribir\n"
  );

  const snap = await db.collection("invoices").get();
  const pending: Array<{ id: string; updates: Record<string, string> }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const updates: Record<string, string> = {};

    const cd = trimStr(data.cliente_denominacion);
    if (cd) {
      const next = receptorNombreParaSunat(cd);
      const finalDenom = next || "CLIENTE GENERAL";
      if (finalDenom !== cd) {
        updates.cliente_denominacion = finalDenom;
      }
    }

    const rs = trimStr(data.representative_name_snapshot);
    if (rs) {
      const next = receptorNombreSnapshot(rs);
      if (next !== rs) {
        updates.representative_name_snapshot = next;
      }
    }

    if (Object.keys(updates).length > 0) {
      pending.push({ id: doc.id, updates });
    }
  }

  for (const p of pending.slice(0, 50)) {
    console.log(`[${p.id}]`, JSON.stringify(p.updates));
  }
  if (pending.length > 50) console.log(`... y ${pending.length - 50} más`);

  console.log("\n--- Resumen ---");
  console.log(`Invoices totales: ${snap.size}`);
  console.log(`A actualizar:     ${pending.length}`);

  if (!APPLY || pending.length === 0) {
    if (!APPLY && pending.length > 0) {
      console.log("\nPara aplicar: SANITIZE_INVOICE_NAMES_APPLY=1 npm run migrate:invoice-receptor-names");
    }
    process.exit(0);
  }

  const BATCH = 400;
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const batch = db.batch();
    for (const p of chunk) {
      batch.update(db.collection("invoices").doc(p.id), p.updates);
    }
    await batch.commit();
    done += chunk.length;
    console.log(`  Commit… ${done}/${pending.length}`);
  }

  console.log(`\n✅ Actualizados ${done} invoices.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
