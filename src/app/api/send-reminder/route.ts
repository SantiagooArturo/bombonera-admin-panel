import { NextRequest, NextResponse } from "next/server";

const WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";
const WAHA_API_KEY = "MiClaveSegura123";

const COURT_LABELS: Record<string, string> = {
  voley_6v6: "Campo 6 vs 6 voley",
  voley_basket_6v6: "Campo 6 vs 6 voley-basket",
  voley_5v5: "Campo 5 vs 5 voley maple",
  voley_basket_5v5: "Campo 5 vs 5 voley-basket",
};

async function sendWhatsAppMessage(chatId: string, text: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (WAHA_API_KEY) {
    headers["X-Api-Key"] = WAHA_API_KEY;
  }

  const res = await fetch(`${WAHA_URL}/api/sendText`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session: "session_01kgx7mr4058d2hc98m62jx2cy",
      chatId,
      text,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`WAHA error: ${res.status} - ${error}`);
  }

  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chat_id, court_type, field, date, time_slots, total_price, amount_paid, amount_to_charge } = body;

    if (!chat_id || !court_type || !date || !time_slots) {
      return NextResponse.json(
        { error: "Faltan datos de la reserva" },
        { status: 400 }
      );
    }

    const courtName = COURT_LABELS[court_type] || court_type;
    const dateFormatted = new Date(date + "T12:00:00").toLocaleDateString(
      "es-PE",
      { weekday: "long", day: "numeric", month: "long" }
    );
    const startTime = time_slots[0];
    const endHour = parseInt(time_slots[time_slots.length - 1]) + 1;
    const endTime = `${endHour}:00`;

    // Mensaje 1: Saludo
    await sendWhatsAppMessage(
      chat_id,
      "Holaaaa amigo, tienes una reserva pendiente, ¿la confirmas aún?"
    );

    // Pequeña pausa entre mensajes
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Mensaje 2: Detalles de la reserva
    const detalles = [
      `📋 *Detalles de tu reserva:*`,
      `⚽ Cancha: ${courtName}${field ? ` - Campo ${field}` : ""}`,
      `📅 Fecha: ${dateFormatted}`,
      `🕐 Horario: ${startTime} a ${endTime}`,
      `💰 Total: S/ ${(total_price || 0).toFixed(2)} | Pagado: S/ ${(amount_paid || 0).toFixed(2)} | Pendiente: S/ ${((total_price || 0) - (amount_paid || 0)).toFixed(2)}`,
    ].join("\n");

    await sendWhatsAppMessage(chat_id, detalles);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Mensaje 3: Pedido de pago con monto a cobrar
    await sendWhatsAppMessage(
      chat_id,
      `Debes transferir S/ ${(amount_to_charge || 0).toFixed(2)} a BCP 194-1517117-0-13 (ALIFAD EIRL) y enviarme la captura para confirmarlo 🙌`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending reminder:", error);
    return NextResponse.json(
      { error: "Error al enviar recordatorio" },
      { status: 500 }
    );
  }
}
