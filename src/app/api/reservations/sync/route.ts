
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * POST /api/reservations/sync-payments
 * Actualiza el amount_paid de una reserva sumando todas sus transferencias y ajusta su estado.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { reservation_id } = body;

        if (!reservation_id) {
            return NextResponse.json({ error: "Missing reservation_id" }, { status: 400 });
        }

        const db = getDb();
        const resRef = db.collection("reservations").doc(reservation_id);

        // Transacción para asegurar consistencia
        await db.runTransaction(async (t) => {
            // 1. Obtener la reserva
            const resDoc = await t.get(resRef);
            if (!resDoc.exists) {
                throw new Error("Reservation not found");
            }
            const resData = resDoc.data()!;
            const totalPrice = resData.total_price || 0;

            // 2. Obtener todas las transferencias de esta reserva
            // Nota: en transacción no podemos hacer queries si no son por índice o muy específicas, 
            // pero firestore permite queries en transacciones. 
            // Idealmente, deberíamos leerlas antes de la transacción si son muchas, 
            // pero para evitar race conditions, las leemos dentro (o usamos las rules correctas).
            // En Admin SDK, podemos consultar dentro de la transacción.
            const transfersQuery = db.collection("transfers").where("reservation_id", "==", reservation_id);
            const transfersSnapshot = await t.get(transfersQuery);

            // 3. Sumar montos de transferencias VÁLIDAS (verified o manual)
            // Ojo: ¿Sólo verified? Si es manual, se asume verified implícito. Si es 'chatbot' y no verified, ¿suma?
            // Usualmente 'pending' transfers NO deberían sumar al amount_paid hasta ser verificadas.
            // Pero el sistema actual parece sumar apenas llegan? 
            // Revisando `route.ts` de manual payment: suma al crear.
            // Revisando webhook de chatbot: suma al crear o al validar? 
            // Asumamos: Sumo todo lo que tenga status 'applied' o manual, o verified === true.

            let calculatedPaid = 0;
            transfersSnapshot.forEach(doc => {
                const data = doc.data();
                // Si es manual, suma.
                // Si es chatbot, tiene que estar verificado para sumar al "Verified Amount".
                // Pero el usuario quiere "Sincerar". 
                // Si el sistema actual suma todo (incluso no verificado), entonces sumamos todo. 
                // Pero la alerta dice "suma de pagos registrados es X".

                // Criterio Seguro: Sumar todo lo que sea (source='manual') OR (verified=true).
                const isManual = data.source === 'manual';
                const isVerified = !!data.verified;

                if (isManual || isVerified) {
                    calculatedPaid += (data.amount || 0);
                }
            });

            // 4. Actualizar la reserva
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const update: Record<string, any> = {
                amount_paid: calculatedPaid
            };

            if (calculatedPaid >= totalPrice) {
                update.status = "paid";
                if (!resData.confirmed) {
                    update.confirmed = true;
                    update.confirmed_at = new Date().toISOString();
                }
            } else if (calculatedPaid > 0) {
                update.status = "pending"; // Parcial
                update.confirmed = true; // Confirmada si hay algún pago (seña)
                if (!resData.confirmed_at) {
                    update.confirmed_at = new Date().toISOString();
                }
            } else {
                // 0 pagado
                update.status = "pending";
                update.confirmed = false;
                update.amount_paid = 0;
                // update.confirmed_at = FieldValue.delete(); // No borrar si ya estaba
            }

            t.update(resRef, update);
        });

        return NextResponse.json({ success: true, message: "Pagos sincronizados correctamente" });

    } catch (error) {
        console.error("Error syncing payments:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
