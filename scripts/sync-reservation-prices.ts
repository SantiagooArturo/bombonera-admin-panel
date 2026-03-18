/**
 * Script one-off: ajusta reservas cuyo total_price > precio estándar.
 * Solo cuando estándar < reserva → actualiza al estándar.
 * No toca reservas con precio menor (ofertas/descuentos).
 *
 * Ejecutar: npm run sync-prices
 * Borrar este archivo después de usarlo.
 */
import { config } from "dotenv";
import { resolve } from "path";
[".env", ".env.local", ".env.development"].forEach((f) => config({ path: resolve(process.cwd(), f) }));
import { getDb } from "../src/lib/firebase-admin";
import { courtConfigDocId } from "../src/lib/court-config";
import {
  calculateReservationPrice,
  type CourtConfigMap,
} from "../src/features/operaciones/utils";

async function getCourtConfigMap(db: FirebaseFirestore.Firestore): Promise<CourtConfigMap> {
  const snap = await db.collection("court_config").get();
  const map: CourtConfigMap = {} as CourtConfigMap;
  const defaults: Record<number, CourtConfigMap[number]> = {
    9: {
      price_day_weekday: 40,
      price_day_weekend: 40,
      price_day_holiday: 40,
      price_night_weekday: 60,
      price_night_weekend: 60,
      price_night_holiday: 60,
    },
  };
  const std = {
    price_day_weekday: 70,
    price_day_weekend: 80,
    price_day_holiday: 80,
    price_night_weekday: 100,
    price_night_weekend: 100,
    price_night_holiday: 100,
  };
  for (let f = 1; f <= 12; f++) {
    const doc = snap.docs.find((d) => d.id === courtConfigDocId(f));
    const data = doc?.data();
    const base = defaults[f] ?? std;
    map[f] = {
      price_day_weekday: (typeof data?.price_day_weekday === "number" ? data.price_day_weekday : base.price_day_weekday),
      price_day_weekend: (typeof data?.price_day_weekend === "number" ? data.price_day_weekend : base.price_day_weekend),
      price_day_holiday: (typeof data?.price_day_holiday === "number" ? data.price_day_holiday : base.price_day_holiday),
      price_night_weekday: (typeof data?.price_night_weekday === "number" ? data.price_night_weekday : base.price_night_weekday),
      price_night_weekend: (typeof data?.price_night_weekend === "number" ? data.price_night_weekend : base.price_night_weekend),
      price_night_holiday: (typeof data?.price_night_holiday === "number" ? data.price_night_holiday : base.price_night_holiday),
    };
  }
  return map;
}

async function main() {
  const db = getDb();
  const dateFrom = new Date().toISOString().slice(0, 10);

  const configMap = await getCourtConfigMap(db);

  const [pending, confirmed] = await Promise.all([
    db.collection("reservations").where("status", "==", "pending").get(),
    db.collection("reservations").where("status", "==", "confirmed").get(),
  ]);

  const toUpdate: { id: string; current: number; standard: number }[] = [];

  for (const doc of [...pending.docs, ...confirmed.docs]) {
    const data = doc.data();
    const field = data.field;
    const date = data.date;
    const timeSlots: string[] = data.time_slots || [];
    const currentPrice = data.total_price ?? 0;

    if (!field || !date || !timeSlots.length) continue;
    if (date < dateFrom) continue;

    const standardPrice = calculateReservationPrice(field, date, timeSlots, configMap);
    if (standardPrice > 0 && standardPrice < currentPrice) {
      toUpdate.push({ id: doc.id, current: currentPrice, standard: standardPrice });
    }
  }

  console.log(`Reservas a actualizar (precio reserva > estándar): ${toUpdate.length}`);
  if (toUpdate.length === 0) {
    console.log("Nada que hacer.");
    process.exit(0);
  }

  for (const { id, current, standard } of toUpdate) {
    console.log(`  ${id}: S/ ${current} → S/ ${standard}`);
  }

  for (const { id, standard } of toUpdate) {
    await db.collection("reservations").doc(id).update({
      total_price: standard,
      reservation_price: standard,
    });
  }

  console.log(`\n✅ Actualizadas ${toUpdate.length} reservas.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
