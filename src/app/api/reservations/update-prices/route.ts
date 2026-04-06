import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { courtConfigDocId, getFullFieldConfig } from "@/lib/court-config";
import { calculateReservationPrice, type CourtConfigMap } from "@/features/operaciones/utils";

/**
 * Obtiene el mapa de configuración de canchas.
 */
async function getCourtConfigMap(db: any): Promise<CourtConfigMap> {
  const snap = await db.collection("court_config").get();
  const map: CourtConfigMap = {} as CourtConfigMap;
  for (let f = 1; f <= 12; f++) {
    const doc = snap.docs.find((d: any) => d.id === courtConfigDocId(f));
    const data = doc?.data();
    map[f] = getFullFieldConfig(f, data);
  }
  return map;
}

/**
 * POST /api/reservations/update-prices
 * Actualiza el precio de todas las reservas futuras (date >= hoy) 
 * según la configuración actual de /precios.
 */
export async function POST() {
  try {
    const db = getDb();
    const configMap = await getCourtConfigMap(db);
    
    // Obtener fecha actual en formato YYYY-MM-DD (Lima)
    const now = new Date();
    now.setHours(now.getHours() - 5); // Ajuste manual a Lima (UTC-5) simplificado
    const todayStr = now.toISOString().split("T")[0];

    // Traer reservas desde hoy en adelante que no estén canceladas/expiradas
    const snapshot = await db.collection("reservations")
      .where("date", ">=", todayStr)
      .get();

    let updatedCount = 0;
    let skippedCount = 0;
    const batch = db.batch();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const { field, date, time_slots, total_price, status } = data;

      if (status === "cancelled" || status === "expired") {
        skippedCount++;
        continue;
      }

      if (!field || !date || !time_slots) {
        skippedCount++;
        continue;
      }

      const newPrice = calculateReservationPrice(field, date, time_slots, configMap);

      if (newPrice !== total_price) {
        batch.update(doc.ref, { 
          total_price: newPrice,
          reservation_price: newPrice,
          updated_at_bulk: new Date().toISOString()
        });
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      message: `Proceso completado. Actualizadas ${updatedCount} reservas de un total de ${snapshot.size} revisadas.`,
      updated: updatedCount,
      skipped: skippedCount,
      total_checked: snapshot.size
    });
  } catch (error: any) {
    console.error("Error updating reservation prices:", error);
    return NextResponse.json(
      { error: "Error al actualizar precios", detail: error.message },
      { status: 500 }
    );
  }
}
