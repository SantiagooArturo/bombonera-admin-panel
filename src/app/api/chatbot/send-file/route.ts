import { NextRequest, NextResponse } from "next/server";
import { getWaha, normalizeChatId } from "@/lib/waha-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/chatbot/send-file
 * Envía un archivo (ej. boleta PDF) por WhatsApp.
 * Body: { chat_id, file_base64 | file_url, caption?, filename? }
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) {
      return NextResponse.json({ status: "error", message: "No se recibieron datos" }, { status: 400 });
    }
    let chatId = String(data.chat_id || "").trim();
    const fileUrl = String(data.file_url || "").trim();
    const fileBase64 = typeof data.file_base64 === "string" ? data.file_base64.trim() : "";
    const caption = String(data.caption || "").trim() || undefined;
    const filename = String(data.filename || "document.pdf").trim();

    if (!chatId) {
      return NextResponse.json({ status: "error", message: "chat_id es requerido" }, { status: 400 });
    }
    if (!fileBase64 && !fileUrl) {
      return NextResponse.json(
        { status: "error", message: "file_base64 o file_url es requerido" },
        { status: 400 }
      );
    }
    if (chatId.includes("@") && !chatId.includes("@c.us") && !chatId.includes("@lid")) {
      chatId = normalizeChatId(chatId);
    } else if (!chatId.includes("@")) {
      chatId = normalizeChatId(chatId);
      if (!chatId.replace(/\D/g, "")) {
        return NextResponse.json({ status: "error", message: "chat_id inválido" }, { status: 400 });
      }
    }

    const [success, errMsg] = await getWaha().sendFile(chatId, {
      fileBase64: fileBase64 || undefined,
      fileUrl: fileUrl || undefined,
      mimetype: "application/pdf",
      filename,
      caption,
    });
    if (success) {
      return NextResponse.json({ status: "success", message: "Archivo enviado" });
    }
    return NextResponse.json(
      { status: "error", message: errMsg || "No se pudo enviar el archivo" },
      { status: 500 }
    );
  } catch (error) {
    console.error("Error en send-file:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
