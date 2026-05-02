/**
 * Comprueba si un comprobante existe en Firestore (misma credencial Admin que producción/local).
 *
 * Uso:
 *   LOOKUP_SERIE_CORRELATIVO=B001-58374 npx tsx scripts/lookup-invoice-firestore.ts
 *
 * O:
 *   LOOKUP_SERIE=B001 LOOKUP_CORRELATIVO=58374 npx tsx scripts/lookup-invoice-firestore.ts
 *
 * Opcional (segunda búsqueda independiente, útil si el correlativo está mal tipado):
 *   LOOKUP_SUNAT_HASH="<digest del PDF/SUNAT>" npx tsx scripts/lookup-invoice-firestore.ts
 *
 * Carga .env / .env.local como el resto de scripts.
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import type { QuerySnapshot } from "firebase-admin/firestore";
import { getDb } from "../src/lib/firebase-admin";

function printSnapshot(label: string, snap: QuerySnapshot): void {
  console.log(`\n--- ${label} (matches: ${snap.size}) ---`);
  if (snap.empty) {
    console.log("  (ningún documento)");
    return;
  }
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const created =
      typeof x.created_at !== "undefined" && x.created_at !== null && "toDate" in (x.created_at as object)
        ? String((x.created_at as { toDate: () => Date }).toDate().toISOString())
        : String(x.created_at ?? "");
    console.log(
      JSON.stringify(
        {
          doc_id: d.id,
          serie_correlativo: x.serie_correlativo,
          serie: x.serie,
          correlativo: x.correlativo,
          created_at: created,
          fecha_emision_ymd: x.fecha_emision_ymd,
          sunat_hash: x.sunat_hash,
          reservation_id: x.reservation_id,
          transfer_id: x.transfer_id,
          phone_number: x.phone_number,
          recovery_source: x.recovery_source,
          status: x.status,
        },
        null,
        2
      )
    );
  }
}

async function main(): Promise<void> {
  const serieCorr = process.env.LOOKUP_SERIE_CORRELATIVO?.trim();
  const serie = process.env.LOOKUP_SERIE?.trim().toUpperCase();
  const corRaw = process.env.LOOKUP_CORRELATIVO?.trim();
  const correlativo = corRaw ? parseInt(corRaw.replace(/\D/g, ""), 10) : NaN;
  const hash =
    typeof process.env.LOOKUP_SUNAT_HASH === "string"
      ? process.env.LOOKUP_SUNAT_HASH.trim()
      : "";

  if (!serieCorr && !(serie && Number.isFinite(correlativo)) && !hash) {
    console.error(
      "Define al menos uno:\n" +
        "  LOOKUP_SERIE_CORRELATIVO=B001-12345\n" +
        "  o LOOKUP_SERIE=B001 y LOOKUP_CORRELATIVO=12345\n" +
        "  o LOOKUP_SUNAT_HASH=..."
    );
    process.exit(1);
  }

  const db = getDb();
  console.log("\n=== lookup-invoice-firestore ===\n");

  if (serieCorr) {
    const snap = await db.collection("invoices").where("serie_correlativo", "==", serieCorr).get();
    printSnapshot(`serie_correlativo == "${serieCorr}"`, snap);
  }

  if (serie && Number.isFinite(correlativo) && correlativo > 0) {
    const snap = await db
      .collection("invoices")
      .where("serie", "==", serie)
      .where("correlativo", "==", correlativo)
      .get();
    printSnapshot(`serie "${serie}" + correlativo ${correlativo}`, snap);
  }

  if (hash) {
    const snap = await db.collection("invoices").where("sunat_hash", "==", hash).get();
    printSnapshot(`sunat_hash (exacto)`, snap);
  }

  console.log("\nFin.\n");
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
