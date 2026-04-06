import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import { buildAttendanceConfirmationMessage } from "@/lib/buildAttendanceConfirmationMessage";
import { sendWhatsAppMessage } from "@/lib/waha";

const COLLECTION = "attendance-reminders";

function toJsDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Una sola línea para el panel (relativa si es reciente; si no, día + hora Lima). */
function formatAttendanceReminderDisplayLabel(sentAt: Date): string {
  const now = Date.now();
  const diffMs = now - sentAt.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Último recordatorio enviado hace un momento";
  if (mins < 60) return `Último recordatorio enviado hace ${mins} minuto${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Último recordatorio enviado hace ${hours} hora${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Último recordatorio enviado hace ${days} día${days === 1 ? "" : "s"}`;
  const wd = sentAt
    .toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long" })
    .replace(/^\w/, (c) => c.toUpperCase());
  const timeStr = sentAt.toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `Último recordatorio enviado el ${wd} a las ${timeStr}`;
}

export async function GET(request: NextRequest) {
  try {
    const reservationId = request.nextUrl.searchParams.get("reservation_id")?.trim();
    if (!reservationId) {
      return NextResponse.json({ error: "reservation_id es obligatorio" }, { status: 400 });
    }
    const db = getDb();
    const snap = await db
      .collection(COLLECTION)
      .where("reservation_id", "==", reservationId)
      .orderBy("sent_at", "desc")
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ last: null });
    }

    const doc = snap.docs[0];
    const data = doc.data();
    const sentAt = toJsDate(data.sent_at);
    if (!sentAt) {
      return NextResponse.json({ last: null });
    }

    return NextResponse.json({
      last: {
        id: doc.id,
        sent_at: sentAt.toISOString(),
        display_label: formatAttendanceReminderDisplayLabel(sentAt),
        message: typeof data.message === "string" ? data.message : undefined,
      },
    });
  } catch (e) {
    console.error("GET attendance-reminders:", e);
    return NextResponse.json({ error: "Error al leer recordatorios" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const reservationId = typeof body?.reservation_id === "string" ? body.reservation_id.trim() : "";
    if (!reservationId) {
      return NextResponse.json({ error: "reservation_id es obligatorio" }, { status: 400 });
    }

    const db = getDb();
    const resRef = db.collection("reservations").doc(reservationId);
    const resSnap = await resRef.get();
    if (!resSnap.exists) {
      return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
    }

    const r = resSnap.data() as Record<string, unknown>;
    const status = String(r.status || "");
    if (status === "cancelled") {
      return NextResponse.json({ error: "No se puede enviar: reserva cancelada" }, { status: 400 });
    }

    const date = typeof r.date === "string" ? r.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Reserva sin fecha válida" }, { status: 400 });
    }

    const phoneRaw =
      (typeof r.phone_number === "string" && r.phone_number.trim()) ||
      (typeof r.chat_id === "string" && r.chat_id.trim()) ||
      "";
    if (!phoneRaw) {
      return NextResponse.json({ error: "La reserva no tiene teléfono/chat para WhatsApp" }, { status: 400 });
    }

    const message = typeof body?.message === "string" ? body.message.trim() : buildAttendanceConfirmationMessage(date);

    await sendWhatsAppMessage(phoneRaw, message);

    await db.collection(COLLECTION).add({
      reservation_id: reservationId,
      reservation_date: date,
      message,
      sent_at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, message });
  } catch (e) {
    console.error("POST attendance-reminders:", e);
    const msg = e instanceof Error ? e.message : "Error al enviar recordatorio";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
