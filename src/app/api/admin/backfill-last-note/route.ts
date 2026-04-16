import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * POST /api/admin/backfill-last-note
 *
 * Migración: usa collectionGroup para encontrar TODAS las notas en toda la
 * base de datos (incluyendo subcolecciones de documentos que no existen como
 * documentos de usuario). Por cada usuario con notas, si el documento padre
 * no tiene `last_note`, lo actualiza con el contenido de la nota más reciente.
 *
 * Protección básica: requiere el header `x-admin-secret`.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_SECRET || "backfill-2026";
  if (request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const db = getDb();

  // Traer todas las notas sin orderBy (evita requerir índice compuesto)
  const allNotesSnap = await db.collectionGroup("notes").get();

  // Mapa: userId → { content, created_at } de la nota más reciente
  const latestByUser = new Map<string, string>();
  const latestDateByUser = new Map<string, string>();

  for (const noteDoc of allNotesSnap.docs) {
    const userId = noteDoc.ref.parent.parent?.id;
    if (!userId) continue;
    const content: string = noteDoc.data().content || "";
    const createdAt: string = noteDoc.data().created_at || "";
    if (!content.trim()) continue;

    const prev = latestDateByUser.get(userId) || "";
    if (createdAt > prev) {
      latestByUser.set(userId, content.trim());
      latestDateByUser.set(userId, createdAt);
    }
  }

  let checked = latestByUser.size;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [userId, latestContent] of latestByUser) {
    try {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      const existingNote = userDoc.exists
        ? userDoc.data()?.last_note
        : undefined;

      // Si ya tiene last_note válido, no tocar
      if (typeof existingNote === "string" && existingNote.trim()) {
        skipped++;
        continue;
      }

      const preview =
        latestContent.length > 2000
          ? latestContent.slice(0, 1997) + "..."
          : latestContent;

      if (userDoc.exists) {
        await userRef.update({ last_note: preview });
      } else {
        // Documento padre no existe: crearlo con datos mínimos + last_note
        await userRef.set({
          chat_id: userId,
          phone_number: userId,
          last_note: preview,
          reservation_count: 0,
          balance: 0,
          client_type: "casual",
          is_automated: true,
          needs_help: false,
        });
      }
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${userId}: ${msg}`);
    }
  }

  return NextResponse.json({ checked, updated, skipped, errors });
}
