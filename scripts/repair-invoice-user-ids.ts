/**
 * Repara invoices con user_id faltante o inconsistente (boletas/facturas "huérfanas" a nivel de cliente).
 *
 * Orden de inferencia:
 * 1) transfer_id → transfer.chat_id, o transfer.reservation_id → reserva → chat_id | phone_number
 * 2) reservation_id (si no es "manual") → reserva → chat_id | phone_number
 * 3) phone_number guardado en el propio invoice (último recurso)
 *
 * Ejecutar en modo simulación (no escribe):
 *   npx tsx scripts/repair-invoice-user-ids.ts
 *
 * Aplicar cambios:
 *   REPAIR_INVOICES_APPLY=1 npx tsx scripts/repair-invoice-user-ids.ts
 *
 * Requiere las mismas variables de entorno que el panel (FIREBASE_SERVICE_ACCOUNT / GOOGLE_APPLICATION_CREDENTIALS).
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore";
import { getDb } from "../src/lib/firebase-admin";

const APPLY = process.env.REPAIR_INVOICES_APPLY === "1" || process.env.REPAIR_INVOICES_APPLY === "true";

function digits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Igual criterio que en emisión: priorizar chat_id de la reserva. */
function userIdFromReservationData(rd: DocumentData): string | null {
  const chat = rd.chat_id != null ? String(rd.chat_id).trim() : "";
  if (chat) return chat;
  const phone = rd.phone_number != null ? String(rd.phone_number).trim() : "";
  const d = digits(phone);
  if (d.length >= 9) return d.length <= 11 ? d : d.slice(-11);
  if (phone) return phone;
  return null;
}

function userIdFromTransferData(td: DocumentData): string | null {
  const cid = td.chat_id != null ? String(td.chat_id).trim() : "";
  if (cid) return cid;
  return null;
}

function sameClient(a: string | null | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const tailA = da.slice(-9);
  const tailB = db.slice(-9);
  return tailA.length === 9 && tailA === tailB;
}

async function inferUserId(
  db: Firestore,
  data: DocumentData
): Promise<{ userId: string | null; source: string }> {
  const transferId = data.transfer_id as string | null | undefined;
  if (transferId) {
    const tDoc = await db.collection("transfers").doc(transferId).get();
    if (tDoc.exists) {
      const td = tDoc.data()!;
      const fromT = userIdFromTransferData(td);
      if (fromT) return { userId: fromT, source: "transfer.chat_id" };
      const rid = td.reservation_id as string | undefined;
      if (rid) {
        const rDoc = await db.collection("reservations").doc(rid).get();
        if (rDoc.exists) {
          const uid = userIdFromReservationData(rDoc.data()!);
          if (uid) return { userId: uid, source: "transfer→reservation" };
        }
      }
    }
  }

  const reservationId = data.reservation_id as string | undefined;
  if (reservationId && reservationId !== "manual" && reservationId !== "") {
    const rDoc = await db.collection("reservations").doc(reservationId).get();
    if (rDoc.exists) {
      const uid = userIdFromReservationData(rDoc.data()!);
      if (uid) return { userId: uid, source: "reservation_id" };
    }
  }

  const phone = data.phone_number as string | undefined;
  const d = digits(phone);
  if (d.length >= 9) {
    return { userId: d.length <= 11 ? d : d.slice(-11), source: "invoice.phone_number" };
  }

  return { userId: null, source: "none" };
}

async function main() {
  const db = getDb();
  console.log(`Modo: ${APPLY ? "APLICAR cambios en Firestore" : "SIMULACIÓN (solo lectura). Usa REPAIR_INVOICES_APPLY=1 para escribir."}\n`);

  const snap = await db.collection("invoices").get();
  let ok = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let unrepaired: { id: string; reason: string }[] = [];
  const batchWrites: Array<{ ref: DocumentReference; user_id: string }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const current = data.user_id as string | undefined;
    const { userId: inferred, source } = await inferUserId(db, data);

    if (!inferred) {
      unrepaired.push({
        id: doc.id,
        reason: `Sin inferencia (${source}; reserva=${data.reservation_id ?? "—"} transfer=${data.transfer_id ?? "—"})`,
      });
      continue;
    }

    if (sameClient(current, inferred)) {
      ok++;
      continue;
    }

    if (!current) {
      console.log(`[FALTA user_id] ${doc.id} → "${inferred}" (${source})`);
    } else {
      console.log(`[CORREGIR] ${doc.id}: "${current}" → "${inferred}" (${source})`);
    }

    wouldUpdate++;
    batchWrites.push({ ref: doc.ref, user_id: inferred });
  }

  console.log("\n--- Resumen ---");
  console.log(`Invoices totales:     ${snap.size}`);
  console.log(`user_id coherente:    ${ok}`);
  console.log(`A corregir:           ${wouldUpdate}`);
  console.log(`Sin poder inferir:    ${unrepaired.length}`);

  if (unrepaired.length > 0) {
    console.log("\n⚠️  Documentos sin user_id inferible (revisar a mano):");
    for (const u of unrepaired.slice(0, 40)) {
      console.log(`  - ${u.id}: ${u.reason}`);
    }
    if (unrepaired.length > 40) console.log(`  ... y ${unrepaired.length - 40} más`);
  }

  if (!APPLY || batchWrites.length === 0) {
    if (!APPLY && wouldUpdate > 0) {
      console.log(`\nPara aplicar ${wouldUpdate} actualizaciones: REPAIR_INVOICES_APPLY=1 npm run repair:invoice-user-ids`);
    }
    if (!APPLY && unrepaired.length > 0) {
      console.log("\n(Revisa la lista anterior; en simulación el proceso termina con código 0.)");
    }
    process.exit(0);
  }

  const BATCH = 400;
  for (let i = 0; i < batchWrites.length; i += BATCH) {
    const chunk = batchWrites.slice(i, i + BATCH);
    const batch = db.batch();
    for (const { ref, user_id } of chunk) {
      batch.update(ref, { user_id });
    }
    await batch.commit();
    updated += chunk.length;
    console.log(`  Commit batch… ${updated}/${batchWrites.length}`);
  }

  console.log(`\n✅ Actualizados ${updated} invoices con user_id inferido.`);
  if (unrepaired.length > 0) {
    console.log(`⚠️  Quedan ${unrepaired.length} sin reparar automáticamente.`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
