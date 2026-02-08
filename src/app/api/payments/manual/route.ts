import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/payments/manual
 * Registra un pago presencial (manual) hecho en la bombonera.
 *
 * Body:
 *  - reservation_id: ID de la reserva
 *  - amount: monto cobrado
 *  - phone_number: número del usuario
 *
 * Acciones:
 *  1. Actualiza la reserva: amount_paid, confirmed, confirmed_at, status
 *  2. Crea un documento en transfers con source: "manual"
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

    // 1. Obtener la reserva actual
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

    // 2. Actualizar la reserva
    const reservationUpdate: Record<string, unknown> = {
      amount_paid: newAmountPaid,
      confirmed: true,
      confirmed_at: resData.confirmed_at ?? now,
    };

    if (isFullyPaid) {
      reservationUpdate.status = "paid";
    }

    await resRef.update(reservationUpdate);

    // 3. Crear registro de transferencia (pago manual)
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
