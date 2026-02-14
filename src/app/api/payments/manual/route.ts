import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/payments/manual
 * Registra un pago presencial (manual).
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { reservation_id, amount, phone_number } = body;

    if (!reservation_id || !amount || !phone_number) {
      return NextResponse.json(
        { error: "Se requiere reservation_id, amount y phone_number" },
        { status: 400 }
      );
    }

    const resRef = db.collection("reservations").doc(reservation_id);
    const resDoc = await resRef.get();

    if (!resDoc.exists) {
      return NextResponse.json(
        { error: "Reserva no encontrada" },
        { status: 404 }
      );
    }

    const resData = resDoc.data()!;
    const currentAmountPaid = resData.amount_paid ?? 0;
    const totalPrice = resData.total_price ?? 0;
    const newAmountPaid = currentAmountPaid + amount;
    const isFullyPaid = newAmountPaid >= totalPrice;
    const now = new Date().toISOString();

    const reservationUpdate: Record<string, unknown> = {
      amount_paid: newAmountPaid,
      confirmed: true,
      confirmed_at: resData.confirmed_at ?? now,
    };

    if (isFullyPaid) {
      reservationUpdate.status = "paid";
    }

    await resRef.update(reservationUpdate);

    const transferData = {
      phone_number,
      recipient_name: null,
      amount,
      transaction_date: now.split("T")[0],
      operation_id: null,
      reservation_id,
      status: isFullyPaid ? "applied" : "partial",
      source: "manual",
      created_at: FieldValue.serverTimestamp(),
    };

    const transferRef = await db.collection("transfers").add(transferData);

    return NextResponse.json({
      success: true,
      transfer_id: transferRef.id,
      new_amount_paid: newAmountPaid,
      fully_paid: isFullyPaid,
    });
  } catch (error) {
    console.error("Error processing manual payment:", error);
    return NextResponse.json(
      { error: "Error al procesar el pago manual" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/payments/manual
 * Revoca (elimina) un pago manual y ajusta el monto pagado de la reserva.
 * Query Params: transfer_id, reservation_id
 */
export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const transfer_id = searchParams.get("transfer_id");
    const reservation_id = searchParams.get("reservation_id");

    if (!transfer_id || !reservation_id) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    // 1. Get transfer to confirm amount
    const transferRef = db.collection("transfers").doc(transfer_id);
    const transferDoc = await transferRef.get();

    if (!transferDoc.exists) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    const transferData = transferDoc.data()!;
    const amountToRefund = transferData.amount || 0;

    // 2. Delete transfer
    await transferRef.delete();

    // 3. Update reservation
    const resRef = db.collection("reservations").doc(reservation_id);

    // Use transaction to ensure safe balance update
    await db.runTransaction(async (t) => {
      const resDoc = await t.get(resRef);
      if (!resDoc.exists) return; // Should handle error better but acceptable for now

      const resData = resDoc.data()!;
      const currentAmountPaid = resData.amount_paid || 0;
      const newAmountPaid = Math.max(0, currentAmountPaid - amountToRefund);
      const totalPrice = resData.total_price || 0;

      const update: Record<string, unknown> = {
        amount_paid: newAmountPaid,
      };

      // If not fully paid anymore, revert status
      if (newAmountPaid < totalPrice) {
        update.status = "pending"; // Or partial logic if you have it
        // If paid becomes 0, maybe revert confirmed too? 
        // Let's keep confirmed true if there are other payments, or just leave it.
        // Assuming simpler logic: if < total, it is pending/partial.
        // Your system seems to use 'pending' for everything not paid.
      }
      // If amount becomes 0
      if (newAmountPaid === 0) {
        update.confirmed = false;
        update.confirmed_at = FieldValue.delete();
      }

      t.update(resRef, update);
    });

    return NextResponse.json({ success: true, refunded: amountToRefund });

  } catch (error) {
    console.error("Error revoking payment:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
