import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

/**
 * GET /api/users/recurrent
 * Devuelve solo chat_ids de clientes recurrentes.
 * Query liviana para pintar badge en /operaciones sin traer todos los tipos.
 */
export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection("users").where("client_type", "==", "recurrente").get();

    const chatIds = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return normalizeDigits(data.chat_id || data.phone_number || doc.id);
      })
      .filter((id) => id.length > 0);

    return NextResponse.json({ chat_ids: chatIds });
  } catch (error) {
    console.error("Error fetching recurrent users:", error);
    return NextResponse.json({ error: "Error al obtener recurrentes" }, { status: 500 });
  }
}
