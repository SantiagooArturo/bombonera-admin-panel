/**
 * Rellena en Firestore `cliente_denominacion`, `cliente_numero_de_documento`,
 * `cliente_tipo_documento` y `representative_name_snapshot` en invoices donde falten,
 * usando la reserva vinculada (reservation_id o transfer → reservation).
 *
 * No sobrescribe campos que ya tengan texto (solo completa vacíos).
 *
 * Simulación (default):
 *   npx tsx scripts/backfill-invoice-receptor.ts
 *
 * Aplicar:
 *   MIGRATE_INVOICE_RECEPTOR_APPLY=1 npx tsx scripts/backfill-invoice-receptor.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getDb } from "../src/lib/firebase-admin";
import {
  receptorNombreParaSunat,
  receptorNombreSnapshot,
} from "../src/features/boletas/utils/sanitizeReceptorNombre";

const APPLY =
  process.env.MIGRATE_INVOICE_RECEPTOR_APPLY === "1" ||
  process.env.MIGRATE_INVOICE_RECEPTOR_APPLY === "true";

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanDocNum(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** DNI/RUC razonable (no placeholders tipo 00000000). */
function isPlausiblePeruDoc(d: string): boolean {
  if (d.length !== 8 && d.length !== 11) return false;
  if (/^0+$/.test(d)) return false;
  return true;
}

async function resolveReservationId(db: Firestore, data: DocumentData): Promise<string | null> {
  const rid = trimStr(data.reservation_id);
  if (rid && rid !== "manual") return rid;
  const tid = trimStr(data.transfer_id);
  if (!tid) return null;
  const tDoc = await db.collection("transfers").doc(tid).get();
  if (!tDoc.exists) return null;
  const tr = trimStr(tDoc.data()?.reservation_id);
  return tr || null;
}

function buildUpdates(
  data: DocumentData,
  rd: DocumentData
): Record<string, string> {
  const updates: Record<string, string> = {};
  const repName = trimStr(rd.representative_name);
  const dni = cleanDocNum(rd.dni);

  const hasDenom = trimStr(data.cliente_denominacion).length > 0;
  const hasSnap = trimStr(data.representative_name_snapshot).length > 0;
  const hasNum = trimStr(data.cliente_numero_de_documento).length > 0;
  const hasTipo = trimStr(data.cliente_tipo_documento).length > 0;

  if (!hasDenom && repName) {
    updates.cliente_denominacion =
      repName.length >= 3
        ? receptorNombreParaSunat(repName) || "CLIENTE GENERAL"
        : repName.toUpperCase();
  }
  if (!hasSnap && repName) {
    updates.representative_name_snapshot = receptorNombreSnapshot(repName);
  }
  if (!hasNum && isPlausiblePeruDoc(dni)) {
    updates.cliente_numero_de_documento = dni;
    if (!hasTipo) {
      updates.cliente_tipo_documento = dni.length === 11 ? "6" : "1";
    }
  }

  return updates;
}

async function main() {
  const db = getDb();
  console.log(
    `Modo: ${APPLY ? "APLICAR en Firestore" : "SIMULACIÓN. Usa MIGRATE_INVOICE_RECEPTOR_APPLY=1 para escribir."}\n`
  );

  const snap = await db.collection("invoices").get();
  let examined = 0;
  let skippedHasAll = 0;
  let noReservation = 0;
  let reservationMissing = 0;
  let nothingToAdd = 0;
  const pending: Array<{ id: string; updates: Record<string, string>; reason: string }> = [];

  for (const doc of snap.docs) {
    examined++;
    const data = doc.data();

    const resId = await resolveReservationId(db, data);
    if (!resId) {
      noReservation++;
      continue;
    }

    const rDoc = await db.collection("reservations").doc(resId).get();
    if (!rDoc.exists) {
      reservationMissing++;
      continue;
    }

    const updates = buildUpdates(data, rDoc.data()!);
    if (Object.keys(updates).length === 0) {
      const hasAnyReceptor =
        trimStr(data.cliente_denominacion) ||
        trimStr(data.cliente_numero_de_documento) ||
        trimStr(data.representative_name_snapshot);
      if (hasAnyReceptor) skippedHasAll++;
      else nothingToAdd++;
      continue;
    }

    pending.push({
      id: doc.id,
      updates,
      reason: `reserva ${resId}`,
    });
  }

  for (const p of pending) {
    console.log(`[${p.id}] + ${JSON.stringify(p.updates)} (${p.reason})`);
  }

  console.log("\n--- Resumen ---");
  console.log(`Invoices examinados:     ${examined}`);
  console.log(`Sin reserva inferible:   ${noReservation}`);
  console.log(`Reserva doc inexistente: ${reservationMissing}`);
  console.log(`Ya tenían receptor:      ${skippedHasAll}`);
  console.log(`Reserva sin nombre/DNI:  ${nothingToAdd}`);
  console.log(`A actualizar:            ${pending.length}`);

  if (!APPLY || pending.length === 0) {
    if (!APPLY && pending.length > 0) {
      console.log(
        `\nPara aplicar: MIGRATE_INVOICE_RECEPTOR_APPLY=1 npm run migrate:invoice-receptor`
      );
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
