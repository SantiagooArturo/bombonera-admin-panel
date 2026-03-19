/**
 * Script one-off: añade chat_id a todos los transfers que tienen reservation_id.
 * Obtiene el chat_id de la reserva asociada (chat_id o phone_number).
 *
 * Ejecutar: npm run migrate:chat-id-transfers
 * Borrar o archivar después de usarlo.
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);
import { getDb } from "../src/lib/firebase-admin";

async function main() {
  const db = getDb();
  const transfersSnap = await db.collection("transfers").get();

  const toUpdate: { id: string; chat_id: string }[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const doc of transfersSnap.docs) {
    const data = doc.data();
    const reservationId = data.reservation_id as string | undefined;

    if (data.chat_id) {
      skipped.push(doc.id);
      continue;
    }

    if (!reservationId) {
      skipped.push(doc.id);
      continue;
    }

    const resDoc = await db.collection("reservations").doc(reservationId).get();
    if (!resDoc.exists) {
      missing.push(reservationId);
      continue;
    }

    const resData = resDoc.data()!;
    const raw = resData.chat_id || resData.phone_number || "";
    const chatId = String(raw).replace(/\D/g, "");
    if (!chatId) {
      missing.push(reservationId);
      continue;
    }

    toUpdate.push({ id: doc.id, chat_id: chatId });
  }

  console.log(`Transfers totales: ${transfersSnap.size}`);
  console.log(`Ya tienen chat_id o sin reservation_id: ${skipped.length}`);
  console.log(`Reservas no encontradas o sin chat_id: ${missing.length}`);
  console.log(`A actualizar: ${toUpdate.length}`);

  if (missing.length > 0) {
    console.log("\nReservas faltantes o sin chat_id:", Array.from(new Set(missing)).slice(0, 10));
    if (missing.length > 10) console.log("... y más");
  }

  if (toUpdate.length === 0) {
    console.log("\nNada que actualizar.");
    process.exit(0);
  }

  let updated = 0;
  for (const { id, chat_id } of toUpdate) {
    await db.collection("transfers").doc(id).update({ chat_id });
    updated++;
    if (updated % 50 === 0) console.log(`  ${updated}/${toUpdate.length}...`);
  }

  console.log(`\n✅ Actualizados ${updated} transfers con chat_id.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
