/**
 * Recuperar boletas/facturas emitidas en SUNAT pero ausentes en Firestore.
 * La lógica vive en `src/features/boletas/services/sunatFirestoreRecovery.ts`.
 *
 * Por defecto SOLO SIMULA. Para escribir:
 *   RECOVER_MISSING_APPLY=1 npx tsx scripts/recover-missing-invoices.ts
 *
 * Env opcionales:
 *   RECOVER_SERIE          → default B001
 *   RECOVER_MIN_CORRELATIVO → ignorar correlativos anteriores (default: heurística en código)
 *   RECOVER_MAX_CORRELATIVO → ignorar correlativos posteriores (default: máximo en Firestore)
 *   RECOVER_DELAY_MS        → delay entre requests a apisunat (default 200)
 *   RECOVER_TAIL_PROBE=0  → desactivar sonda de cola tras el máximo en Firestore
 *   RECOVER_TAIL_CONSECUTIVE_MISS  RECOVER_TAIL_MAX_STEPS
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { getDb } from "../src/lib/firebase-admin";
import { getEmisorSunatFromEnv } from "../src/features/boletas/pdf/emisorSunatEnv";
import {
  scanMissingSunatInvoicesForFirestore,
  commitRecoveredInvoiceDocs,
} from "../src/features/boletas/services/sunatFirestoreRecovery";

const APPLY =
  process.env.RECOVER_MISSING_APPLY === "1" || process.env.RECOVER_MISSING_APPLY === "true";

const SERIE = process.env.RECOVER_SERIE?.trim() || "B001";
const DELAY_MS = Number(process.env.RECOVER_DELAY_MS) || 200;

function envInt(key: string): number | undefined {
  const v = process.env[key];
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

async function main() {
  console.log("\n=== recover-missing-invoices ===\n");
  console.log(`Modo: ${APPLY ? "APLICAR (escribe en Firestore)" : "SIMULACIÓN (solo muestra)"}`);
  console.log(`Serie: ${SERIE}\n`);

  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    console.error("Faltan APISUNAT_URL o APISUNAT_TOKEN en .env");
    process.exit(1);
  }

  const emisor = getEmisorSunatFromEnv();
  const rucEmisor = emisor.ruc.replace(/\D/g, "");
  const db = getDb();

  const tailProbe = process.env.RECOVER_TAIL_PROBE !== "0";
  const tailMiss = Math.max(1, Number(process.env.RECOVER_TAIL_CONSECUTIVE_MISS) || 20);
  const tailCap = Math.max(1, Number(process.env.RECOVER_TAIL_MAX_STEPS) || 500);

  const scan = await scanMissingSunatInvoicesForFirestore(db, {
    serie: SERIE,
    apisunatUrl: APISUNAT_URL,
    apisunatToken: APISUNAT_TOKEN,
    rucEmisor,
    delayMs: DELAY_MS,
    minCorrelativo: envInt("RECOVER_MIN_CORRELATIVO"),
    maxCorrelativo: envInt("RECOVER_MAX_CORRELATIVO"),
    tailProbe,
    tailConsecutiveMiss: tailMiss,
    tailMaxSteps: tailCap,
    recoverySourceForDocs: "script_recover-missing-invoices-batch",
  });

  if (scan.skippedNoFirestoreCluster) {
    console.log(`No se encontraron invoices con serie=${SERIE} en Firestore.`);
    process.exit(0);
  }

  console.log(`  Gaps + cola (correlativos revisados): ${scan.gapsScanned}`);
  console.log(`  Recuperables (SUNAT OK + datos):     ${scan.toCreate.length}`);
  console.log(`  No existen en SUNAT (hueco real):    ${scan.notInSunat.length}`);
  console.log(`  Errores de consulta:                 ${scan.errors.length}`);

  if (scan.notInSunat.length > 0) {
    console.log(`\n  Muestra no-SUNAT: ${scan.notInSunat.slice(0, 30).map((c) => `${SERIE}-${c}`).join(", ")}`);
  }
  if (scan.errors.length > 0) {
    console.log("\n  Errores:");
    for (const e of scan.errors) {
      console.log(`    ${SERIE}-${e.correlativo}: ${e.reason}`);
    }
  }

  if (scan.toCreate.length === 0) {
    console.log("\nNada que crear en Firestore.");
    process.exit(0);
  }

  if (!APPLY) {
    console.log(`\nSimulación: se crearían ${scan.toCreate.length} documentos. Primeros 5:`);
    for (const item of scan.toCreate.slice(0, 5)) {
      console.log(`\n  ${SERIE}-${item.correlativo}:`);
      console.log(`    cliente: ${item.doc.cliente_denominacion}`);
      console.log(`    monto:   ${item.doc.amount}`);
      console.log(`    fecha:   ${item.doc.fecha_emision_ymd}`);
      console.log(`    estado:  ${item.doc.sunat_estado}`);
    }
    console.log(
      `\nPara aplicar: RECOVER_MISSING_APPLY=1 npx tsx scripts/recover-missing-invoices.ts\n`
    );
    process.exit(0);
  }

  console.log(`\nEscribiendo ${scan.toCreate.length} documentos en Firestore...`);
  const { written, skipped } = await commitRecoveredInvoiceDocs(db, SERIE, scan.toCreate);
  console.log(`\n✅ Escritos: ${written}, omitidos (ya existían): ${skipped}.`);
  if (scan.errors.length > 0) {
    console.log(`⚠️  ${scan.errors.length} correlativos con error en el escaneo.`);
  }
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
