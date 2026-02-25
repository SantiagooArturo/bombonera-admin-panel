import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { COURT_FIELDS, PENDING_EXPIRY_MS, TIME_SLOTS, type ReservationStatus } from "@/lib/types";
import { sendWhatsAppMessage } from "@/lib/waha";

const ALL_FIELDS = Object.values(COURT_FIELDS).flat().sort((a, b) => a - b);
const ACTIVE_STATUSES: ReservationStatus[] = ["pending", "paid"];

function formatHour12(slot: string) {
  const h = parseInt(slot.split(":")[0], 10);
  if (h === 0) return "12 am";
  if (h < 12) return `${h}:00 am`;
  if (h === 12) return "12:00 pm";
  return `${h - 12}:00 pm`;
}

function getNextHourSlot(slot: string) {
  const h = parseInt(slot.split(":")[0], 10);
  return `${h + 1}:00`;
}

function isReservationActiveForAvailability(data: {
  status?: ReservationStatus;
  created_at?: string;
}) {
  if (data.status === "paid") return true;
  if (data.status !== "pending") return false;
  const createdAtMs = data.created_at ? new Date(data.created_at).getTime() : NaN;
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs < PENDING_EXPIRY_MS;
}

function chunkConsecutiveSlots(slots: string[]) {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => TIME_SLOTS.indexOf(a) - TIME_SLOTS.indexOf(b));
  const ranges: Array<{ start: string; endExclusive: string }> = [];

  let start = sorted[0];
  let prevIndex = TIME_SLOTS.indexOf(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const currentIndex = TIME_SLOTS.indexOf(current);
    if (currentIndex !== prevIndex + 1) {
      const endExclusive = TIME_SLOTS[prevIndex + 1] || getNextHourSlot(sorted[i - 1]);
      ranges.push({ start, endExclusive });
      start = current;
    }
    prevIndex = currentIndex;
  }
  ranges.push({ start, endExclusive: TIME_SLOTS[prevIndex + 1] || getNextHourSlot(sorted[sorted.length - 1]) });
  return ranges;
}

function buildAvailabilityMessage(params: {
  date: string;
  contactName?: string;
  freeByField: Record<number, string[]>;
}) {
  const humanDate = new Date(`${params.date}T12:00:00`).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const greeting = params.contactName
    ? `Hola ${params.contactName}, te comparto disponibilidad para ${humanDate}:`
    : `Hola, te comparto disponibilidad para ${humanDate}:`;

  const lines = ALL_FIELDS.map((field) => {
    const freeSlots = params.freeByField[field] || [];
    if (freeSlots.length === 0) return `Cancha ${field}: sin cupos.`;
    const ranges = chunkConsecutiveSlots(freeSlots).map((r) => `${formatHour12(r.start)} - ${formatHour12(r.endExclusive)}`);
    return `Cancha ${field}: ${ranges.join(", ")}.`;
  });

  return `${greeting}\n\n${lines.join("\n")}\n\nSi quieres, te la reservo al toque.`;
}

export async function POST(request: NextRequest) {
  try {
    const { chat_id, date, contact_name } = await request.json();
    if (!chat_id || typeof chat_id !== "string") {
      return NextResponse.json({ error: "chat_id es obligatorio" }, { status: 400 });
    }
    if (!date || typeof date !== "string") {
      return NextResponse.json({ error: "date es obligatorio" }, { status: 400 });
    }

    const db = getDb();
    const [reservationSnap, blockedSnap] = await Promise.all([
      db.collection("reservations").where("date", "==", date).where("status", "in", ACTIVE_STATUSES).get(),
      db.collection("blocked-slots").where("date", "==", date).get(),
    ]);

    const occupied = new Map<number, Set<string>>();
    const ensure = (field: number) => {
      if (!occupied.has(field)) occupied.set(field, new Set());
      return occupied.get(field)!;
    };

    reservationSnap.docs.forEach((doc) => {
      const data = doc.data() as { field?: number; time_slots?: string[]; status?: ReservationStatus; created_at?: string };
      if (!data.field || !Array.isArray(data.time_slots)) return;
      if (!isReservationActiveForAvailability({ status: data.status, created_at: data.created_at })) return;
      const set = ensure(data.field);
      data.time_slots.forEach((slot) => set.add(slot));
    });

    blockedSnap.docs.forEach((doc) => {
      const data = doc.data() as { field?: number; time_slot?: string };
      if (!data.field || !data.time_slot) return;
      ensure(data.field).add(data.time_slot);
    });

    const freeByField: Record<number, string[]> = {};
    ALL_FIELDS.forEach((field) => {
      const taken = occupied.get(field) || new Set<string>();
      freeByField[field] = TIME_SLOTS.filter((slot) => !taken.has(slot));
    });

    const text = buildAvailabilityMessage({
      date,
      contactName: typeof contact_name === "string" && contact_name.trim() ? contact_name.trim() : undefined,
      freeByField,
    });

    await sendWhatsAppMessage(chat_id, text);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending availability:", error);
    return NextResponse.json({ error: "Error al enviar disponibilidad" }, { status: 500 });
  }
}
