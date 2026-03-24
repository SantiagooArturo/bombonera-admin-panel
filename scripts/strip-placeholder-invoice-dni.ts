/**
 * Quita `cliente_numero_de_documento` y `cliente_tipo_documento` cuando el DNI es placeholder (ej. 00000000).
 *
 *   STRIP_PLACEHOLDER_DNI_APPLY=1 npx tsx scripts/strip-placeholder-invoice-dni.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { FieldValue } from "firebase-admin/firestore";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import { getDb } from "../src/lib/firebase-admin";

const APPLY =
  process.env.STRIP_PLACEHOLDER_DNI_APPLY === "1" ||
  process.env.STRIP_PLACEHOLDER_DNI_APPLY === "true";

function isPlaceholderDoc(d: string): boolean {
  const x = d.replace(/\D/g, "");
  if (x.length !== 8 && x.length !== 11) return false;
  return /^0+$/.test(x);
}

async function main() {
  const db = getDb();
  console.log(
    APPLY ? "APLICAR: borrando DNI placeholder en invoices\n" : "SIMULACIÓN. STRIP_PLACEHOLDER_DNI_APPLY=1 para escribir\n"
  );

  const snap = await db.collection("invoices").get();
  const toFix: string[] = [];
  for (const doc of snap.docs) {
    const num = String(doc.data().cliente_numero_de_documento ?? "").replace(/\D/g, "");
    if (isPlaceholderDoc(num)) toFix.push(doc.id);
  }

  console.log(`Invoices con DNI placeholder: ${toFix.length}`);
  for (const id of toFix.slice(0, 30)) console.log(`  - ${id}`);
  if (toFix.length > 30) console.log(`  ... +${toFix.length - 30}`);

  if (!APPLY || toFix.length === 0) {
    process.exit(0);
  }

  const BATCH = 400;
  for (let i = 0; i < toFix.length; i += BATCH) {
    const chunk = toFix.slice(i, i + BATCH);
    const batch = db.batch();
    for (const id of chunk) {
      batch.update(db.collection("invoices").doc(id), {
        cliente_numero_de_documento: FieldValue.delete(),
        cliente_tipo_documento: FieldValue.delete(),
      });
    }
    await batch.commit();
  }
  console.log(`\n✅ Limpiados ${toFix.length} invoices.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
