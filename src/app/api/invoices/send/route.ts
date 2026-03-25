import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import {
  getInvoicePdfBufferForSend,
  getInvoiceXmlBufferForSend,
} from "@/features/boletas/services/invoicePdfBufferForSend";
import { getChatbotApiUrl } from "@/lib/chatbot-api-url";
import { resolveWhatsAppTarget, sendWhatsAppMessage } from "@/lib/waha";

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

function xmlFilenameFromPdfFilename(pdfName: string): string {
  const lower = pdfName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return `${pdfName.slice(0, -4)}.xml`;
  }
  return "comprobante.xml";
}

const BOT_TIMEOUT_MS = 120_000;

async function postSendFileToBot(params: {
  chatbotUrl: string;
  chatId: string;
  fileBase64: string;
  filename: string;
  caption: string;
}): Promise<{ ok: boolean; message?: string; status: number }> {
  const botRes = await fetch(`${params.chatbotUrl}/chatbot/send-file/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: params.chatId,
      file_base64: params.fileBase64,
      caption: params.caption,
      filename: params.filename,
    }),
    signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
  });

  const responseData = await botRes.json().catch(() => ({}));
  const errMsg =
    typeof (responseData as { message?: string })?.message === "string"
      ? (responseData as { message: string }).message
      : undefined;
  if (!botRes.ok || (responseData as { status?: string })?.status === "error") {
    return {
      ok: false,
      message: errMsg || "No se pudo enviar el archivo.",
      status: botRes.ok ? 500 : botRes.status,
    };
  }
  return { ok: true, status: botRes.status };
}

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

    const pdfFilename = sanitizeSendPdfFilename(filenameOpt);

    /** Factura con `file_url_xml` en Firestore: PDF → XML → mensaje de texto (archivos sin caption). */
    let facturaConXmlEnStorage = false;
    if (invoice_id) {
      const snap = await getDb().collection("invoices").doc(invoice_id).get();
      const inv = snap.exists ? (snap.data() as Record<string, unknown>) : null;
      facturaConXmlEnStorage =
        inv?.tipo_comprobante === "factura" &&
        typeof inv.file_url_xml === "string" &&
        inv.file_url_xml.trim().length > 0;
    }

    if (facturaConXmlEnStorage && invoice_id) {
      const xmlBuf = await getInvoiceXmlBufferForSend(invoice_id, { selfOrigin: origin });
      if (xmlBuf?.length) {
        const xmlFilename = xmlFilenameFromPdfFilename(pdfFilename);

        const pdfSend = await postSendFileToBot({
          chatbotUrl,
          chatId: target.chatId,
          fileBase64: pdfBase64,
          filename: pdfFilename,
          caption: "",
        });
        if (!pdfSend.ok) {
          return NextResponse.json(
            { error: pdfSend.message || "No se pudo enviar el PDF." },
            { status: pdfSend.status }
          );
        }

        const xmlSend = await postSendFileToBot({
          chatbotUrl,
          chatId: target.chatId,
          fileBase64: xmlBuf.toString("base64"),
          filename: xmlFilename,
          caption: "",
        });
        if (!xmlSend.ok) {
          return NextResponse.json(
            { error: xmlSend.message || "Se envió el PDF pero no el XML." },
            { status: xmlSend.status }
          );
        }

        try {
          await sendWhatsAppMessage(chat_id, "Muchas Gracias!");
        } catch (textErr) {
          const msg = textErr instanceof Error ? textErr.message : "Error al enviar el mensaje final.";
          return NextResponse.json(
            { error: `Se enviaron PDF y XML, pero falló el mensaje de texto: ${msg}` },
            { status: 502 }
          );
        }

        return NextResponse.json({ success: true });
      }
    }

    const botRes = await postSendFileToBot({
      chatbotUrl,
      chatId: target.chatId,
      fileBase64: pdfBase64,
      filename: pdfFilename,
      caption: "Muchas Gracias!",
    });

    if (!botRes.ok) {
      return NextResponse.json(
        { error: botRes.message || "No se pudo enviar la boleta." },
        { status: botRes.status }
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
