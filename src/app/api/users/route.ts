import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { User, ClientType } from "@/lib/types";

/**
 * GET /api/users
 * Lista usuarios desde la colección `users`.
 * Atributos denormalizados: reservation_count, saldo (balance), client_type.
 * Una sola query a users, sin queries anidadas.
 */
export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection("users").get();

    const list: User[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      const id = doc.id;
      const saldo = data.saldo;
      const reservationCount = data.reservation_count;
      const clientType = data.client_type;

      return {
        id,
        chat_id: data.chat_id ?? id,
        phone_number: data.phone_number ?? undefined,
        reservation_count: typeof reservationCount === "number" ? reservationCount : 0,
        balance: typeof saldo === "number" ? saldo : 0,
        client_type: (clientType === "indeciso" || clientType === "buen_cliente" || clientType === "cliente_problematico"
          ? clientType
          : null) as ClientType,
      };
    });

    return NextResponse.json(list);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Error al obtener usuarios" },
      { status: 500 }
    );
  }
}
