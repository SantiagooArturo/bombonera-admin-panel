import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import {
  calculateReservationPrice,
  type CourtConfigMap,
} from "@/features/operaciones/utils";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const courtType = searchParams.get("court_type");
    const status = searchParams.get("status");
    const phoneNumber = searchParams.get("phone_number");
    const id = searchParams.get("id");

    if (id) {
      const doc = await db.collection("reservations").doc(id).get();
      if (!doc.exists) {
        return NextResponse.json({ error: "No encontrada" }, { status: 404 });
      }
      return NextResponse.json([{
        id: doc.id,
        ...doc.data(),
        created_at: doc.data()?.created_at?.toDate?.()
          ? doc.data()?.created_at.toDate().toISOString()
          : doc.data()?.created_at,
      }]);
    }

    let query: FirebaseFirestore.Query = db.collection("reservations");

    if (phoneNumber) {
      query = query.where("chat_id", "==", phoneNumber);
    }
    if (date) {
      query = query.where("date", "==", date);
    }
    if (courtType) {
      query = query.where("court_type", "==", courtType);
    }
    if (status) {
      query = query.where("status", "==", status);
    }

    const snapshot = await query.get();
    const reservations = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      created_at: doc.data().created_at?.toDate?.()
        ? doc.data().created_at.toDate().toISOString()
        : doc.data().created_at,
    }));

    return NextResponse.json(reservations);
  } catch (error) {
    console.error("Error fetching reservations:", error);
    return NextResponse.json(
      { error: "Error al obtener reservaciones" },
      { status: 500 }
    );
  }
}

function dayIdFromDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const map = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  return map[d.getDay()] || "lun";
}

async function getCourtConfigMap(db: FirebaseFirestore.Firestore): Promise<CourtConfigMap> {
  const snap = await db.collection("court_config").get();
  const map: CourtConfigMap = {} as CourtConfigMap;
  const defaults: Record<number, CourtConfigMap[number]> = {
    9: {
      price_day_weekday: 40,
      price_day_weekend: 40,
      price_day_holiday: 40,
      price_night_weekday: 60,
      price_night_weekend: 60,
      price_night_holiday: 60,
    },
  };
  const std = {
    price_day_weekday: 70,
    price_day_weekend: 80,
    price_day_holiday: 80,
    price_night_weekday: 100,
    price_night_weekend: 100,
    price_night_holiday: 100,
  };
  for (let f = 1; f <= 12; f++) {
    const doc = snap.docs.find((d) => d.id === `field_${f}`);
    const data = doc?.data();
    const base = defaults[f] ?? std;
    map[f] = {
      price_day_weekday: (typeof data?.price_day_weekday === "number" ? data.price_day_weekday : base.price_day_weekday),
      price_day_weekend: (typeof data?.price_day_weekend === "number" ? data.price_day_weekend : base.price_day_weekend),
      price_day_holiday: (typeof data?.price_day_holiday === "number" ? data.price_day_holiday : base.price_day_holiday),
      price_night_weekday: (typeof data?.price_night_weekday === "number" ? data.price_night_weekday : base.price_night_weekday),
      price_night_weekend: (typeof data?.price_night_weekend === "number" ? data.price_night_weekend : base.price_night_weekend),
      price_night_holiday: (typeof data?.price_night_holiday === "number" ? data.price_night_holiday : base.price_night_holiday),
    };
  }
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const {
      chat_id,
      court_type,
      field,
      date,
      time_slots,
      representative_name,
      phone_number,
      dni,
    } = body;

    if (!chat_id || !court_type || !field || !date || !Array.isArray(time_slots) || time_slots.length === 0) {
      return NextResponse.json({ error: "Faltan datos para crear la reserva" }, { status: 400 });
    }

    const cleanPhone = String(phone_number || "").replace(/\D/g, "");
    const cleanChatId = String(chat_id).replace(/\D/g, "");
    const cleanDni = String(dni || "").replace(/\D/g, "");

    if (!cleanPhone) {
      return NextResponse.json({ error: "phone_number es obligatorio" }, { status: 400 });
    }

    const blocksSnap = await db
      .collection("blocked-slots")
      .where("date", "==", date)
      .where("field", "==", field)
      .get();
    const blockedSet = new Set(blocksSnap.docs.map((doc) => doc.data().time_slot));
    if (time_slots.some((slot: string) => blockedSet.has(slot))) {
      return NextResponse.json({ error: "El horario está bloqueado" }, { status: 409 });
    }

    const reservationsSnap = await db
      .collection("reservations")
      .where("date", "==", date)
      .where("field", "==", field)
      .where("status", "in", ["pending", "confirmed"])
      .get();
    const hasConflict = reservationsSnap.docs.some((doc) => {
      const data = doc.data();
      const existing: string[] = data.time_slots || [];
      return existing.some((slot) => time_slots.includes(slot));
    });
    if (hasConflict) {
      return NextResponse.json({ error: "El horario ya está reservado" }, { status: 409 });
    }

    const dayId = dayIdFromDate(date);
    const lastSlot = String(time_slots[time_slots.length - 1]);
    const endHour = parseInt(lastSlot.split(":")[0], 10) + 1;

    const configMap = await getCourtConfigMap(db);
    const calculatedPrice = calculateReservationPrice(field, date, time_slots, configMap);

    const payload = {
      chat_id: cleanChatId,
      court_type,
      field,
      date,
      time_slots,
      time_ranges: [{ start: time_slots[0], end: `${endHour}:00`, slot: `${dayId}-${time_slots[0]}` }],
      slot_keys: time_slots.map((slot: string) => `${dayId}-${slot}`),
      created_at: new Date().toISOString(),
      status: "confirmed",
      total_price: calculatedPrice,
      reservation_price: calculatedPrice,
      phone_number: cleanPhone,
      amount_paid: 0,
      representative_name: representative_name || "",
      confirmed: true,
      confirmed_at: new Date().toISOString(),
      auto_confirmed: true,
      dni: cleanDni,
      source: "manual_operaciones",
    };

    const userDocId = cleanChatId.startsWith("51") ? cleanChatId : `51${cleanChatId}`;
    const userRef = db.collection("users").doc(userDocId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      await userRef.set({
        chat_id: userDocId,
        phone_number: userDocId,
        custom_name: (representative_name || "").trim() || null,
        last_dni: cleanDni || null,
        client_type: "casual",
        reservation_count: 0,
        balance: 0,
        is_automated: true,
        needs_help: false,
        help_reason: null,
      });
    } else {
      const userData = userDoc.data() || {};
      const updates: Record<string, unknown> = {};
      if (!userData.last_representative_name && representative_name?.trim()) {
        updates.last_representative_name = representative_name.trim();
      }
      if (!userData.last_dni && cleanDni) {
        updates.last_dni = cleanDni;
      }
      if (Object.keys(updates).length > 0) {
        await userRef.update(updates);
      }
    }

    const docRef = await db.collection("reservations").add(payload);
    return NextResponse.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error("Error creating reservation:", error);
    return NextResponse.json({ error: "Error al crear reservación" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { id, status, field, arrived, time_slots, dni, total_price, representative_name } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Se requiere id" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof status === "string") updateData.status = status;
    if (typeof field === "number" || field === null) updateData.field = field;
    if (typeof arrived === "boolean") updateData.arrived = arrived;
    if (typeof dni === "string") updateData.dni = dni.replace(/\D/g, "").slice(0, 8);
    if (typeof representative_name === "string") {
      updateData.representative_name = representative_name.trim();
    }
    if (typeof total_price === "number" && total_price >= 0) {
      updateData.total_price = total_price;
      updateData.reservation_price = total_price;
    }

    if (Array.isArray(time_slots) && time_slots.length > 0) {
      const currentDoc = await db.collection("reservations").doc(id).get();
      if (!currentDoc.exists) {
        return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
      }
      const currentData = currentDoc.data() || {};
      const date = currentData.date;
      const targetField = (typeof field === "number" ? field : currentData.field) as number;

      const blocksSnap = await db
        .collection("blocked-slots")
        .where("date", "==", date)
        .where("field", "==", targetField)
        .get();
      const blockedSet = new Set(blocksSnap.docs.map((doc) => doc.data().time_slot));
      if (time_slots.some((slot: string) => blockedSet.has(slot))) {
        return NextResponse.json({ error: "Conflicto con horario bloqueado" }, { status: 409 });
      }

      const reservationsSnap = await db
        .collection("reservations")
        .where("date", "==", date)
        .where("field", "==", targetField)
        .where("status", "in", ["pending", "confirmed"])
        .get();
      const overlap = reservationsSnap.docs.some((doc) => {
        if (doc.id === id) return false;
        const other = doc.data().time_slots || [];
        return other.some((slot: string) => time_slots.includes(slot));
      });
      if (overlap) {
        return NextResponse.json({ error: "Conflicto con otra reserva" }, { status: 409 });
      }

      const dayId = dayIdFromDate(date);
      const lastSlot = String(time_slots[time_slots.length - 1]);
      const endHour = parseInt(lastSlot.split(":")[0], 10) + 1;
      updateData.time_slots = time_slots;
      updateData.slot_keys = time_slots.map((slot: string) => `${dayId}-${slot}`);
      updateData.time_ranges = [{ start: time_slots[0], end: `${endHour}:00`, slot: `${dayId}-${time_slots[0]}` }];

      const configMap = await getCourtConfigMap(db);
      const newPrice = calculateReservationPrice(targetField, date, time_slots, configMap);
      updateData.total_price = newPrice;
      updateData.reservation_price = newPrice;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    // Si se marca como confirmada, reflejar confirmación operativa
    if (status === "confirmed") {
      const doc = await db.collection("reservations").doc(id).get();
      if (doc.exists) {
        updateData.confirmed = true;
        updateData.confirmed_at = new Date().toISOString();
      }
      updateData.manual_pending = false;
    }
    // Si se marca como pendiente manualmente, no expirará automáticamente
    if (status === "pending") {
      updateData.manual_pending = true;
    }

    await db.collection("reservations").doc(id).update(updateData);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating reservation:", error);
    return NextResponse.json(
      { error: "Error al actualizar reservación" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Se requiere id" }, { status: 400 });
    }

    const transfersSnap = await db.collection("transfers").where("reservation_id", "==", id).get();
    const invoicesSnap = await db.collection("invoices").where("reservation_id", "==", id).get();

    const batch = db.batch();
    batch.delete(db.collection("reservations").doc(id));
    transfersSnap.docs.forEach((doc) => batch.delete(doc.ref));
    invoicesSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting reservation:", error);
    return NextResponse.json({ error: "Error al eliminar reservación" }, { status: 500 });
  }
}
