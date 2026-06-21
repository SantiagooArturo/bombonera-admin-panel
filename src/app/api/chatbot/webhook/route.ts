import { NextRequest, NextResponse } from "next/server";
import { getWaha } from "@/lib/waha-client";
import { getMemory } from "@/lib/agent/memory";
import {
  resolveFirebaseId,
  isStickerPayload,
  syncHistoryFromWaha,
  processUserMessage,
  BOT_ENABLED,
  BOT_NEW_CLIENTS_AUTO,
} from "@/lib/agent/webhook-helpers";
import { serializeAdmin, serializeHuman } from "@/lib/agent/history-schema";
import { enqueueMessage, bufferInfraReady, type BufferedMessage } from "@/lib/agent/buffer";
import { maybeRunManualSyncFlows } from "@/lib/agent/manual-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REPLY_TEXT_TO_COURT_TYPE: [string, string][] = [
  ["6 vs 6", "court_6v6"], ["6v6", "court_6v6"], ["la más grande", "court_6v6"],
  ["5 vs 5", "court_5v5"], ["5v5", "court_5v5"], ["compacta", "court_5v5"],
];

function captionToCourtType(text: string): string | undefined {
  const t = (text || "").trim().toLowerCase();
  for (const [frag, ct] of REPLY_TEXT_TO_COURT_TYPE) {
    if (t.includes(frag.toLowerCase())) return ct;
  }
  return undefined;
}

const ok = (message: string) => NextResponse.json({ status: "success", message });

/** POST /api/chatbot/webhook — recibe mensajes de WhatsApp vía WAHA. */
export async function POST(request: NextRequest) {
  const data = await request.json().catch(() => null);
  if (!data) return ok("Payload inválido ignorado");

  if (data.event !== "message") return ok(`Evento ${data.event} ignorado`);
  const payload = (data.payload || {}) as Record<string, unknown>;
  if (!payload.from) return ok("Payload incompleto ignorado");

  const chatId = String(payload.from);
  const fromMe = Boolean(payload.fromMe);

  if (chatId.includes("@g.us")) return ok("Mensaje de grupo ignorado");
  if (chatId === "status@broadcast" || chatId.includes("@broadcast")) return ok("Status broadcast ignorado");

  // Ignorar mensajes antiguos (>30s)
  let messageTimestamp = payload.timestamp as number | undefined;
  if (messageTimestamp) {
    if (messageTimestamp > 1e12) messageTimestamp = messageTimestamp / 1000;
    const ageSeconds = Date.now() / 1000 - messageTimestamp;
    if (ageSeconds > 30) return ok("Mensaje antiguo ignorado");
  }

  const firebaseId = await resolveFirebaseId(chatId);
  if (!firebaseId) return ok("No se pudo resolver número");

  // Media (imágenes)
  const hasMedia = Boolean(payload.hasMedia);
  let receivedMessage = String(payload.body || "");
  let mediaUrl =
    payload.media && typeof payload.media === "object"
      ? String((payload.media as Record<string, unknown>).url || "")
      : "";
  const isSticker = isStickerPayload(payload);

  if (hasMedia && mediaUrl) {
    if (isSticker) {
      receivedMessage = receivedMessage ? `${receivedMessage} [sticker enviado]` : "[sticker enviado]";
      mediaUrl = "";
    } else {
      receivedMessage = receivedMessage
        ? `${receivedMessage} [imagen enviada] media_url:${mediaUrl}`
        : `[imagen enviada] media_url:${mediaUrl}`;
    }
  } else if (!receivedMessage) {
    return ok("Payload sin body ni media ignorado");
  }

  // replyTo
  const replyToRaw = payload.replyTo;
  let replyToContext: { quoted_text?: string; court_type?: string } | null = null;
  if (replyToRaw && typeof replyToRaw === "object") {
    const r = replyToRaw as Record<string, unknown>;
    const text = String(r.caption || r.body || "").trim();
    if (text) {
      replyToContext = { quoted_text: text };
      const ct = captionToCourtType(text);
      if (ct) replyToContext.court_type = ct;
    }
  }

  const memory = getMemory();
  const waha = getWaha();

  // Contacto
  const contactInfo = await waha.getContact(chatId).catch(() => null);

  if (fromMe) {
    await memory.setManualPause(firebaseId, 60);
  }

  // Determinar automatización
  let isAutomated: boolean;
  if (!BOT_ENABLED()) {
    isAutomated = false;
  } else {
    isAutomated = await memory.isChatAutomated(firebaseId, contactInfo);
    if (!BOT_NEW_CLIENTS_AUTO()) {
      const isContact = Boolean(contactInfo?.isMyContact);
      if (!isContact && isAutomated) isAutomated = false;
    }
  }

  // ---- Modo NO automatizado: escucha pasiva + sync + manual flows ----
  if (!isAutomated) {
    try {
      await syncHistoryFromWaha(chatId, firebaseId, messageTimestamp);

      if (fromMe) {
        await memory.appendMessages(firebaseId, [serializeAdmin(receivedMessage)]);
      } else {
        let userContent = receivedMessage;
        if (mediaUrl) {
          userContent = userContent.replace(` [imagen enviada] media_url:${mediaUrl}`, "").trim() || "(imagen)";
        }
        await memory.appendMessages(firebaseId, [serializeHuman(userContent, mediaUrl || null)]);
      }

      const history = await memory.getMessages(firebaseId, 25);
      await maybeRunManualSyncFlows({
        chatId,
        firebaseId,
        history,
        contactNumber: contactInfo?.number ? String(contactInfo.number) : null,
        hasMedia,
        mediaUrl: mediaUrl || null,
        fromMe,
      });
    } catch (e) {
      console.warn("Error en escucha pasiva:", e);
    }
    return ok("Chat no automatizado");
  }

  // ---- Modo automatizado ----
  if (fromMe) {
    if (receivedMessage) {
      await memory.appendMessages(firebaseId, [serializeAdmin(receivedMessage)]).catch(() => {});
    }
    return ok("Mensaje propio guardado e ignorado");
  }

  // Buffer (debounce): primera interacción 8s, conversación activa 10s
  const lastMsgTime = await memory.getLastMessageTime(firebaseId);
  let isFirstMessage = true;
  if (lastMsgTime) {
    const last = new Date(lastMsgTime.replace("Z", "+00:00"));
    const hoursDiff = (Date.now() - last.getTime()) / 3600_000;
    if (hoursDiff <= 6) isFirstMessage = false;
  }
  const waitSeconds = isFirstMessage ? 8 : 10;

  const bufferedMsg: BufferedMessage = {
    body: receivedMessage,
    replyTo: typeof replyToRaw === "string" ? replyToRaw : undefined,
    replyToContext,
    mediaUrl: hasMedia && mediaUrl ? mediaUrl : null,
    wahaTimestamp: messageTimestamp ?? null,
  };

  if (bufferInfraReady()) {
    await enqueueMessage(firebaseId, chatId, bufferedMsg, waitSeconds);
    return ok("Mensaje encolado");
  }

  // Fallback sin QStash/Redis: procesar inline.
  await processUserMessage({
    chatId,
    messagesConcatenated: receivedMessage,
    replyToContext,
    mediaUrl: bufferedMsg.mediaUrl,
    firebaseId,
    currentMsgWahaTs: messageTimestamp ?? null,
  });
  return ok("Mensaje procesado (inline)");
}
