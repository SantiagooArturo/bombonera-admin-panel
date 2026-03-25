import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizePeruPhone } from "@/features/operaciones/utils";

/**
 * POST /api/payments/manual
 * Registra un pago presencial (manual).
 * Si no hay reservation_id, solo se crea la transferencia vinculada al cliente (chat_id).
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const {
      reservation_id,
      amount,
      phone_number,
      payment_method,
      media_url,
      chat_id,
      recipient_name,
      transaction_date: transactionDateIn,
      transaction_time: transactionTimeIn,
      client_dni,
    } = body;

    if (!amount || !phone_number || !payment_method) {
      return NextResponse.json(
        { error: "Se requiere amount, phone_number y payment_method" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const nameTrim =
      typeof recipient_name === "string" && recipient_name.trim().length > 0
        ? recipient_name.trim()
        : null;
    const dateTrim = typeof transactionDateIn === "string" ? transactionDateIn.trim() : "";
    const ymdOk = /^\d{4}-\d{2}-\d{2}$/.test(dateTrim);
    const transactionDateFinal = ymdOk ? dateTrim : now.split("T")[0];
    const timeRaw = typeof transactionTimeIn === "string" ? transactionTimeIn.trim() : "";
    const timeHm = /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : null;
    const dniClean =
      typeof client_dni === "string" ? client_dni.replace(/\D/g, "").slice(0, 8) : "";
    const dniOk = dniClean.length === 0 || dniClean.length === 8;

    if (!dniOk) {
      return NextResponse.json({ error: "El DNI debe tener 8 dígitos o dejarse vacío" }, { status: 400 });
    }

    /** Cobro sin reserva: transferencia aplicada al cliente (mismo criterio de dígitos que GET /api/transfers). */
    if (!reservation_id || String(reservation_id).trim() === "") {
      const effectiveChatId =
        String(chat_id ?? "").replace(/\D/g, "") ||
        String(phone_number).replace(/\D/g, "") ||
        "";
      if (effectiveChatId.length < 9) {
        return NextResponse.json(
          { error: "Sin reserva se requiere chat_id o teléfono válido (mín. 9 dígitos) para vincular el pago al cliente" },
          { status: 400 }
        );
      }

      const transferData: Record<string, unknown> = {
        phone_number,
        recipient_name: nameTrim,
        amount,
        transaction_date: transactionDateFinal,
        operation_id: null,
        reservation_id: null,
        chat_id: effectiveChatId,
        status: "applied",
        source: "manual",
        payment_method: payment_method as string,
        created_at: FieldValue.serverTimestamp(),
      };
      if (timeHm) {
        transferData.transaction_time = timeHm;
      }
      if (media_url) {
        transferData.media_url = media_url;
      }

      const transferRef = await db.collection("transfers").add(transferData);

      const userDocId = normalizePeruPhone(effectiveChatId);
      if (userDocId) {
        const userRef = db.collection("users").doc(userDocId);
        const userSnap = await userRef.get();
        const userPatch: Record<string, unknown> = {};
        if (nameTrim && nameTrim.length >= 2) {
          userPatch.custom_name = nameTrim;
        }
        if (dniClean.length === 8) {
          userPatch.last_dni = dniClean;
        }
        if (Object.keys(userPatch).length > 0 && userSnap.exists) {
          await userRef.set(userPatch, { merge: true });
        }
      }

      return NextResponse.json({
        success: true,
        transfer_id: transferRef.id,
        orphan: true,
      });
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

    const reservationUpdate: Record<string, unknown> = {
      amount_paid: newAmountPaid,
      confirmed: true,
      confirmed_at: resData.confirmed_at ?? now,
    };

    reservationUpdate.status = "confirmed";

    await resRef.update(reservationUpdate);

    const chatId = resData.chat_id || resData.phone_number || phone_number;
    const transferData: Record<string, unknown> = {
      phone_number,
      recipient_name: nameTrim,
      amount,
      transaction_date: transactionDateFinal,
      operation_id: null,
      reservation_id,
      chat_id: chatId,
      status: isFullyPaid ? "applied" : "partial",
      source: "manual",
      payment_method: payment_method as string,
      created_at: FieldValue.serverTimestamp(),
    };
    if (timeHm) {
      transferData.transaction_time = timeHm;
    }
    if (media_url) {
      transferData.media_url = media_url;
    }

    const transferRef = await db.collection("transfers").add(transferData);

    const rawForUser = String(chatId ?? "").replace(/\D/g, "");
    const userDocId = rawForUser.length >= 9 ? normalizePeruPhone(rawForUser) : "";
    if (userDocId) {
      const userRef = db.collection("users").doc(userDocId);
      const userSnap = await userRef.get();
      const userPatch: Record<string, unknown> = {};
      if (nameTrim && nameTrim.length >= 2) {
        userPatch.custom_name = nameTrim;
      }
      if (dniClean.length === 8) {
        userPatch.last_dni = dniClean;
      }
      if (Object.keys(userPatch).length > 0 && userSnap.exists) {
        await userRef.set(userPatch, { merge: true });
      }
    }

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

    if (!transfer_id) {
      return NextResponse.json({ error: "Missing transfer_id" }, { status: 400 });
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

    // Sin reserva vinculada: solo eliminar la transferencia
    if (!reservation_id || String(reservation_id).trim() === "") {
      return NextResponse.json({ success: true, refunded: 0 });
    }

    // 3. Update reservation
    const resRef = db.collection("reservations").doc(reservation_id);

    // Use transaction to ensure safe balance update
    await db.runTransaction(async (t) => {
      const resDoc = await t.get(resRef);
      if (!resDoc.exists) return; // Should handle error better but acceptable for now

      const resData = resDoc.data()!;
      const currentAmountPaid = resData.amount_paid || 0;
      const newAmountPaid = Math.max(0, currentAmountPaid - amountToRefund);

      const update: Record<string, unknown> = {
        amount_paid: newAmountPaid,
      };

      // El estado operativo confirmado es independiente del monto pagado.
      if (resData.status === "pending" && newAmountPaid > 0) {
        update.status = "confirmed";
      }
      // If amount becomes 0
      if (newAmountPaid === 0) {
        update.confirmed = resData.status === "confirmed";
        if (resData.status !== "confirmed") {
          update.confirmed_at = FieldValue.delete();
        }
      }

      t.update(resRef, update);
    });

    return NextResponse.json({ success: true, refunded: amountToRefund });

  } catch (error) {
    console.error("Error revoking payment:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
