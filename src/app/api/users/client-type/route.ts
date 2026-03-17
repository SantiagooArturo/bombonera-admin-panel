import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { ClientType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeChatId(value: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

const DEFAULT_CLIENT_TYPE: ClientType = "casual";

/**
 * GET /api/users/client-type?chat_id=51XXXXXXXXX
 * Devuelve el tipo de cliente para un usuario específico.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const chatId = normalizeChatId(searchParams.get("chat_id"));

    if (!chatId) {
      return NextResponse.json({ error: "chat_id es requerido" }, { status: 400 });
    }

    const doc = await db.collection("users").doc(chatId).get();
    if (!doc.exists) {
      return NextResponse.json({ client_type: DEFAULT_CLIENT_TYPE });
    }

    const data = doc.data() || {};
    const value = data.client_type;
    const valid =
      value === "casual" || value === "recurrente" || value === "sospechoso_fraude";

    return NextResponse.json({
      client_type: (valid ? value : DEFAULT_CLIENT_TYPE) as ClientType,
      custom_name: typeof data.custom_name === "string" ? data.custom_name : undefined,
      contact_name: typeof data.contact_name === "string" ? data.contact_name : undefined,
      push_name: typeof data.push_name === "string" ? data.push_name : undefined,
    });
  } catch (error) {
    console.error("Error fetching user client_type:", error);
    return NextResponse.json({ error: "Error al obtener tipo de cliente" }, { status: 500 });
  }
}
