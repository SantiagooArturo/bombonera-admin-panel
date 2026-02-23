import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { COURT_FIELDS, TIME_SLOTS } from "@/lib/types";

const FIELD_COURT_TYPE: Record<number, string> = {};
for (const [ct, fields] of Object.entries(COURT_FIELDS)) {
  for (const f of fields) FIELD_COURT_TYPE[f] = ct;
}

function getTimeSlotsInRange(from: string, to: string): string[] {
  const startIdx = TIME_SLOTS.indexOf(from);
  const endIdx = TIME_SLOTS.indexOf(to);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return [];
  return TIME_SLOTS.slice(startIdx, endIdx);
}

/**
 * GET /api/block-rules?cleanup=1
 * Lista todas las reglas de bloqueo.
 * Con ?cleanup=1 también limpia slots huérfanos (sin rule_id) del sistema antiguo.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const doCleanup = new URL(request.url).searchParams.get("cleanup") === "1";

    const snapshot = await db.collection("block-rules").orderBy("created_at", "desc").get();

    if (doCleanup) {
      const allSlots = await db.collection("blocked-slots").get();
      const orphans = allSlots.docs.filter((doc) => !doc.data().rule_id);
      if (orphans.length > 0) {
        const batch = db.batch();
        for (const doc of orphans) batch.delete(doc.ref);
        await batch.commit();
        console.log(`Cleaned ${orphans.length} orphan blocked slots`);
      }
    }

    const rules = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json(rules);
  } catch (error) {
    console.error("Error fetching block rules:", error);
    return NextResponse.json([], { status: 500 });
  }
}

/**
 * POST /api/block-rules
 * Crea una regla de bloqueo y materializa los blocked-slots individuales.
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { fields, time_from, time_to, mode, dates, reason } = body;

    if (!fields?.length || !time_from || !time_to || !dates?.length) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const slots = getTimeSlotsInRange(time_from, time_to);
    if (slots.length === 0) {
      return NextResponse.json({ error: "Rango horario inválido" }, { status: 400 });
    }

    const ruleData = {
      fields,
      time_from,
      time_to,
      mode: mode || "single",
      dates,
      reason: reason || "Bloqueado manual",
      created_at: new Date().toISOString(),
    };

    const ruleRef = await db.collection("block-rules").add(ruleData);
    const ruleId = ruleRef.id;

    const batch = db.batch();
    let count = 0;

    for (const date of dates) {
      for (const field of fields) {
        for (const slot of slots) {
          const ref = db.collection("blocked-slots").doc();
          batch.set(ref, {
            court_type: FIELD_COURT_TYPE[field] || "voley_6v6",
            field,
            date,
            time_slot: slot,
            reason: reason || "Bloqueado manual",
            rule_id: ruleId,
            created_at: new Date().toISOString(),
          });
          count++;
        }
      }
    }

    await batch.commit();

    return NextResponse.json({ success: true, rule_id: ruleId, slots_created: count });
  } catch (error) {
    console.error("Error creating block rule:", error);
    return NextResponse.json({ error: "Error al crear regla" }, { status: 500 });
  }
}

/**
 * DELETE /api/block-rules?id=xxx
 * Elimina una regla y todos sus blocked-slots asociados.
 */
export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Se requiere id" }, { status: 400 });
    }

    const slotsSnap = await db.collection("blocked-slots").where("rule_id", "==", id).get();

    const batch = db.batch();
    batch.delete(db.collection("block-rules").doc(id));
    for (const doc of slotsSnap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    return NextResponse.json({ success: true, slots_deleted: slotsSnap.size });
  } catch (error) {
    console.error("Error deleting block rule:", error);
    return NextResponse.json({ error: "Error al eliminar regla" }, { status: 500 });
  }
}
