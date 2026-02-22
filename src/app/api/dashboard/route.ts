import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * GET /api/dashboard
 * Conteos globales para el dashboard: transferencias sin validar y boletas por emitir.
 */
export async function GET() {
  try {
    const db = getDb();

    const [transfersSnap, invoicesSnap] = await Promise.all([
      db.collection("transfers").where("status", "in", ["applied", "partial"]).get(),
      db.collection("invoices").get(),
    ]);

    const invoicedTransferIds = new Set(
      invoicesSnap.docs.map((d) => d.data().transfer_id).filter(Boolean)
    );

    let unverifiedTransfers = 0;
    let pendingInvoices = 0;
    const unverifiedReservationIds = new Set<string>();

    for (const doc of transfersSnap.docs) {
      const data = doc.data();
      if (!data.verified) {
        unverifiedTransfers++;
        if (data.reservation_id) unverifiedReservationIds.add(data.reservation_id);
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
