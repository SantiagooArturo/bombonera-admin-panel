import { NextRequest, NextResponse } from "next/server";
import { FieldPath, type DocumentData } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import { normalizePeruPhone } from "@/features/operaciones/utils";

type TransferDocRow = Record<string, unknown> & { id: string };

async function enrichTransfersWithUserHints(
  db: ReturnType<typeof getDb>,
  transfers: TransferDocRow[]
): Promise<TransferDocRow[]> {
  const ids = new Set<string>();
  for (const t of transfers) {
    const rawChat = String(t.chat_id ?? "").replace(/\D/g, "");
    const rawPhone = String(t.phone_number ?? "").replace(/\D/g, "");
    const candidate = rawChat.length >= 9 ? rawChat : rawPhone;
    if (candidate.length >= 9) {
      ids.add(normalizePeruPhone(candidate));
    }
  }
  const idArr = Array.from(ids);
  const userById = new Map<string, DocumentData>();
  const CHUNK = 30;
  for (let i = 0; i < idArr.length; i += CHUNK) {
    const chunk = idArr.slice(i, i + CHUNK);
    const snap = await db.collection("users").where(FieldPath.documentId(), "in", chunk).get();
    snap.forEach((doc) => {
      userById.set(doc.id, doc.data());
    });
  }

  return transfers.map((t) => {
    const rawChat = String(t.chat_id ?? "").replace(/\D/g, "");
    const rawPhone = String(t.phone_number ?? "").replace(/\D/g, "");
    const candidate = rawChat.length >= 9 ? rawChat : rawPhone;
    const uid = candidate.length >= 9 ? normalizePeruPhone(candidate) : "";
    const u = uid ? userById.get(uid) : undefined;
    if (!u) return t;
    const display =
      (typeof u.custom_name === "string" && u.custom_name.trim()) ||
      (typeof u.contact_name === "string" && u.contact_name.trim()) ||
      (typeof u.push_name === "string" && u.push_name.trim()) ||
      (typeof u.last_representative_name === "string" && u.last_representative_name.trim()) ||
      "";
    const lastDni = typeof u.last_dni === "string" ? u.last_dni.trim() : "";
    if (!display && !lastDni) return t;
    return {
      ...t,
      ...(display ? { client_display_name: display } : {}),
      ...(lastDni ? { client_last_dni: lastDni } : {}),
    };
  });
}

/**
 * GET /api/transfers?reservation_id=xxx | ?chat_id=xxx | ?list=all
 * Lista por reserva, por cliente, o todas (panel Pagos recibidos).
 */
export async function GET(request: NextRequest) {
  const reservationId = request.nextUrl.searchParams.get("reservation_id");
  const chatId = request.nextUrl.searchParams.get("chat_id");
  const listAll = request.nextUrl.searchParams.get("list") === "all";

  if (!listAll && !reservationId && !chatId) {
    return NextResponse.json(
      { error: "Se requiere reservation_id, chat_id o list=all" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();

    if (listAll) {
      const snapshot = await db.collection("transfers").orderBy("created_at", "desc").get();
      const transfers: TransferDocRow[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        created_at:
          doc.data().created_at?.toDate?.()?.toISOString() ??
          doc.data().created_at ??
          null,
      }));
      const enriched = await enrichTransfersWithUserHints(db, transfers);
      const withoutAdjustments = enriched.filter((row) => row.source !== "manual_adjustment");
      return NextResponse.json(withoutAdjustments);
    }

    const field = reservationId ? "reservation_id" : "chat_id";
    const value = reservationId ?? chatId;

    const snapshot = await db
      .collection("transfers")
      .where(field, "==", value)
      .orderBy("created_at", "desc")
      .get();

    const transfers = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      created_at:
        doc.data().created_at?.toDate?.()?.toISOString() ??
        doc.data().created_at ??
        null,
    }));

    return NextResponse.json(transfers);
  } catch (error) {
    console.error("Error fetching transfers:", error);
    return NextResponse.json(
      { error: "Error al obtener transferencias" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/transfers
 * Actualiza una transferencia: verified y/o applied.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, verified, applied } = body;
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = getDb();
    const update: Record<string, unknown> = {};
    if (typeof verified === "boolean") {
      update.verified = verified;
      update.verified_at = verified ? new Date().toISOString() : null;
    }
    if (typeof applied === "boolean") {
      update.applied = applied;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: true });
    }
    await db.collection("transfers").doc(id).update(update);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating transfer:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
