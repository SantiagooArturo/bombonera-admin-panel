import { NextRequest, NextResponse } from "next/server";
import { getInvoicePdfBufferForSend } from "@/features/boletas/services/invoicePdfBufferForSend";
import { getChatbotApiUrl } from "@/lib/chatbot-api-url";
import { resolveWhatsAppTarget } from "@/lib/waha";

/**
 * Panel genera el PDF en servidor y lo manda al bot en base64 (mismo patrón que disponibilidad:
 * el agente no debe descargar URLs del admin que WAHA no alcanza).
 */
const SEND_FILENAME_INVALID = /[<>:"/\\|?*\u0000-\u001f]/;

function sanitizeSendPdfFilename(raw: unknown): string {
  if (typeof raw !== "string") return "comprobante.pdf";
  const t = raw.trim().slice(0, 120);
  if (!/\.pdf$/i.test(t)) return "comprobante.pdf";
  if (SEND_FILENAME_INVALID.test(t) || t.length < 5) return "comprobante.pdf";
  return t.toLowerCase();
}

const BOT_TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const chat_id = body.chat_id as string | undefined;
    const filenameOpt = body.filename;
    const invoice_id = typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
    const file_url_legacy = typeof body.file_url === "string" ? body.file_url.trim() : "";

    if (!chat_id) {
      return NextResponse.json({ error: "Faltan chat_id" }, { status: 400 });
    }

    const chatbotUrl = getChatbotApiUrl();
    if (!chatbotUrl) {
      return NextResponse.json(
        { error: "CHATBOT_API_URL no configurado para enviar boleta por WhatsApp." },
        { status: 500 }
      );
    }

    const target = await resolveWhatsAppTarget(chat_id);
    const origin = request.nextUrl.origin;

    let pdfBase64: string;
    if (invoice_id) {
      const buf = await getInvoicePdfBufferForSend(invoice_id, { selfOrigin: origin });
      if (!buf?.length) {
        return NextResponse.json(
          { error: "No se pudo generar o descargar el PDF del comprobante." },
          { status: 400 }
        );
      }
      pdfBase64 = buf.toString("base64");
    } else if (file_url_legacy) {
      const res = await fetch(file_url_legacy, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        return NextResponse.json({ error: "No se pudo descargar file_url del PDF." }, { status: 400 });
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength < 64) {
        return NextResponse.json({ error: "El PDF descargado está vacío o es inválido." }, { status: 400 });
      }
      pdfBase64 = Buffer.from(ab).toString("base64");
    } else {
      return NextResponse.json(
        { error: "Indica invoice_id (recomendado) o file_url." },
        { status: 400 }
      );
    }

    const botRes = await fetch(`${chatbotUrl}/chatbot/send-file/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.chatId,
        file_base64: pdfBase64,
        caption: "Muchas Gracias!",
        filename: sanitizeSendPdfFilename(filenameOpt),
      }),
      signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
    });

    const responseData = await botRes.json().catch(() => ({}));
    if (!botRes.ok || responseData?.status === "error") {
      const message =
        typeof responseData?.message === "string"
          ? responseData.message
          : "No se pudo enviar la boleta.";
      return NextResponse.json(
        { error: message },
        { status: botRes.ok ? 500 : botRes.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending invoice via WhatsApp:", error);
    const errorMessage =
      error instanceof Error
        ? error.name === "TimeoutError" || error.message.includes("aborted")
          ? "Tiempo de espera agotado al contactar el agente o descargar el PDF."
          : error.message
        : "Error al enviar boleta";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
