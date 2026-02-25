import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * GET /api/dashboard
 * Conteos globales para el dashboard: transferencias sin validar y boletas por emitir.
 */
export async function GET() {
  try {
    const db = getDb();

    const [transfersSnap, invoicesSnap, reservationsSnap] = await Promise.all([
      db.collection("transfers").where("status", "in", ["applied", "partial"]).get(),
      db.collection("invoices").get(),
      db.collection("reservations").where("status", "in", ["pending", "paid"]).get(),
    ]);

    const invoicedTransferIds = new Set(
      invoicesSnap.docs.map((d) => d.data().transfer_id).filter(Boolean)
    );

    let unverifiedTransfers = 0;
    let pendingInvoices = 0;
    const unverifiedReservationIds = new Set<string>();
    const activeReservationIds = new Set(reservationsSnap.docs.map((d) => d.id));

    for (const doc of transfersSnap.docs) {
      const data = doc.data();
      const reservationId = data.reservation_id as string | undefined;
      const hasActiveReservation = !!reservationId && activeReservationIds.has(reservationId);

      // Ignorar transferencias huérfanas de pruebas (sin reserva activa)
      if (!hasActiveReservation) continue;

      if (!data.verified) {
        unverifiedTransfers++;
        unverifiedReservationIds.add(reservationId!);
      } else if (!invoicedTransferIds.has(doc.id)) {
        pendingInvoices++;
      }
    }

    return NextResponse.json({
      unverifiedTransfers,
      pendingInvoices,
      unverifiedReservationIds: Array.from(unverifiedReservationIds),
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json({ unverifiedTransfers: 0, pendingInvoices: 0, unverifiedReservationIds: [] });
  }
}
