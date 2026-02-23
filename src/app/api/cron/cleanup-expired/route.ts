import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

const EXPIRATION_SECONDS = 1800; // 30 minutos

/**
 * GET /api/cron/cleanup-expired
 * Cron cada hora. Cancela reservas pending cuyo created_at supera los 30 minutos.
 * Cambia status a "expired" para que dejen de aparecer en operaciones y schedule.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const now = Date.now() / 1000;

    const snapshot = await db
      .collection("reservations")
      .where("status", "==", "pending")
      .get();

    const toExpire: FirebaseFirestore.DocumentReference[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const createdAt = data.created_at;
      if (!createdAt) continue;

      const createdUnix = typeof createdAt.toDate === "function"
        ? createdAt.toDate().getTime() / 1000
        : new Date(createdAt).getTime() / 1000;

      if (now - createdUnix > EXPIRATION_SECONDS) {
        toExpire.push(doc.ref);
      }
    }

    const BATCH_LIMIT = 500;
    for (let i = 0; i < toExpire.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = toExpire.slice(i, i + BATCH_LIMIT);
      for (const ref of chunk) {
        batch.update(ref, { status: "expired" });
      }
      await batch.commit();
    }

    const expired = toExpire.length;
    if (expired > 0) {
      console.log(`🧹 Cleanup: ${expired} reservas pending → expired`);
    }

    return NextResponse.json({ success: true, expired });
  } catch (error) {
    console.error("Error in cleanup-expired cron:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
