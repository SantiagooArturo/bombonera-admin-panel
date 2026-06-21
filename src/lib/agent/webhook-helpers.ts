/**
 * Helpers del webhook (port de app.py): resolución de número, sync de historial,
 * sanitización, envío dividido y el orquestador processUserMessage.
 */
import { getWaha, type WahaMessage } from "@/lib/waha-client";
import { getMemory } from "@/lib/agent/memory";
import { processMessage, shouldRespondRealtime } from "@/lib/agent/agent";
import { parseAndSendCourtImages } from "@/lib/agent/court-images";
import { RESPUESTA_OBLIGATORIA_MSG_PREFIX } from "@/lib/agent/schedule";
import { serializeHuman, serializeAdmin, type SerializedMessage } from "@/lib/agent/history-schema";

function envFlag(name: string, def = false): boolean {
  const raw = process.env[name];
  if (raw == null) return def;
  return ["1", "true", "yes", "on", "si", "sí"].includes(String(raw).trim().toLowerCase());
}

// Por defecto replican el estado de producción (bot apagado / clientes nuevos manual).
export const BOT_ENABLED = () => envFlag("BOT_ENABLED", false);
export const BOT_NEW_CLIENTS_AUTO = () => envFlag("BOT_NEW_CLIENTS_AUTO", false);

export async function resolveFirebaseId(chatId: string): Promise<string | null> {
  if (!chatId || typeof chatId !== "string") return null;
  const id = chatId.trim();
  if (id.includes("@c.us")) return id.replace(/\D/g, "");
  if (id.includes("@lid")) {
    const waha = getWaha();
    const contact = await waha.getContact(id);
    if (contact?.number) return String(contact.number).replace(/\D/g, "");
    const pn = await waha.getPhoneByLid(id);
    if (pn) return String(pn).replace(/\D/g, "");
    return null;
  }
  return id.replace(/\D/g, "");
}

export function isStickerPayload(payload: Record<string, unknown>): boolean {
  const media = (payload.media && typeof payload.media === "object" ? payload.media : {}) as Record<string, unknown>;
  const mime = String(media.mimetype || media.mimeType || payload.mimetype || payload.mimeType || "").trim().toLowerCase();
  const filename = String(media.filename || media.fileName || payload.filename || payload.fileName || "").trim().toLowerCase();
  const msgType = String(payload.type || payload.messageType || "").trim().toLowerCase();
  return msgType.includes("sticker") || mime.includes("webp") || filename.endsWith(".webp");
}

export function normalizeWahaHistoryContent(wm: WahaMessage): string {
  const body = (wm.body || wm.caption || "").trim();
  const media = (wm.media && typeof wm.media === "object" ? wm.media : {}) as Record<string, unknown>;
  const hasMedia = Boolean(wm.hasMedia) || Boolean(wm.media);
  if (!hasMedia) return body;

  const mime = String(media.mimetype || media.mimeType || wm.mimetype || wm.mimeType || "").trim().toLowerCase();
  const filename = String(media.filename || media.fileName || wm.filename || wm.fileName || "").trim();
  const msgType = String(wm.type || wm.messageType || "").trim().toLowerCase();

  let marker: string;
  if (msgType.includes("sticker") || mime.includes("webp") || filename.toLowerCase().endsWith(".webp")) marker = "[sticker adjunto]";
  else if (mime.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) marker = `[archivo PDF adjunto: ${filename || "documento.pdf"}]`;
  else if (mime.includes("image/")) marker = "[imagen adjunta]";
  else if (mime.includes("video/")) marker = "[video adjunto]";
  else if (mime.includes("audio/")) marker = "[audio adjunto]";
  else if (mime || filename) marker = `[archivo adjunto: ${filename || "archivo"}${mime ? ` (${mime})` : ""}]`;
  else marker = "[archivo adjunto]";

  return body ? `${body} ${marker}`.trim() : marker;
}

/** Sincroniza mensajes faltantes desde WAHA hacia Firebase. */
export async function syncHistoryFromWaha(
  chatId: string,
  firebaseId: string,
  excludeFromTs?: number | null
): Promise<void> {
  try {
    const memory = getMemory();
    const waha = getWaha();
    const lastTsStr = await memory.getLastMessageTime(firebaseId);

    let lastUnix = 0;
    let wahaMessages: WahaMessage[];
    if (lastTsStr) {
      const lastDt = new Date(lastTsStr.replace("Z", "+00:00"));
      lastUnix = Math.floor(lastDt.getTime() / 1000);
      wahaMessages = await waha.getHistoryMessages(chatId, 50, lastUnix);
    } else {
      wahaMessages = await waha.getHistoryMessages(chatId, 50);
    }
    if (!wahaMessages.length) return;

    const newMsgs: SerializedMessage[] = [];
    for (const wm of wahaMessages) {
      const wmTs = wm.timestamp || 0;
      if (wmTs <= lastUnix) continue;
      if (excludeFromTs && wmTs >= excludeFromTs) continue;
      const body = normalizeWahaHistoryContent(wm);
      if (!body) continue;
      newMsgs.push(wm.fromMe ? serializeAdmin(body) : serializeHuman(body));
    }
    if (newMsgs.length) await memory.appendMessages(firebaseId, newMsgs);
  } catch (e) {
    console.warn("Error en syncHistoryFromWaha:", e);
  }
}

const SANITIZE_PHRASES = [
  "remember ", "remember follow", "let's ", "let's await", "we should ", "we asked ",
  "must await", "after user confirms", "only one question per message", "now user will confirm",
];

export function sanitizeAgentOutput(text: string): string {
  if (!text || typeof text !== "string") return (text || "").trim();
  let t = text.trim();
  const lower = t.toLowerCase();
  let cut = t.length;
  for (const phrase of SANITIZE_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  t = t.slice(0, cut).trim();
  const keep: string[] = [];
  for (const line of t.split("\n")) {
    const s = line.trim().toLowerCase();
    if (!s) {
      keep.push(line);
      continue;
    }
    if (SANITIZE_PHRASES.some((p) => s.startsWith(p) || s.includes(p))) break;
    keep.push(line);
  }
  return keep.join("\n").trim();
}

/** Divide por "|||" y envía cada parte por separado (sin guardar; el turno se persiste aparte). */
export async function enviarMensajeDividido(chatId: string, mensaje: string): Promise<void> {
  for (const parteRaw of mensaje.split("|||")) {
    const parte = parteRaw.trim();
    if (!parte) continue;
    await getWaha().sendMessage(chatId, parte, false);
  }
}

function isTransientError(e: unknown): boolean {
  const msg = String(e instanceof Error ? e.message : e).toLowerCase();
  return ["connection reset", "connection aborted", "connection refused", "temporarily unavailable",
    "timeout", "timed out", "503", "502", "504"].some((s) => msg.includes(s));
}

export interface ProcessUserMessageParams {
  chatId: string;
  messagesConcatenated: string;
  replyToContext?: { quoted_text?: string; court_type?: string } | null;
  mediaUrl?: string | null;
  firebaseId?: string | null;
  currentMsgWahaTs?: number | null;
  isProactive?: boolean;
}

/** Orquesta el procesamiento de un mensaje del usuario (port de process_user_message). */
export async function processUserMessage(params: ProcessUserMessageParams): Promise<void> {
  const waha = getWaha();
  const memory = getMemory();
  let { firebaseId } = params;
  const { chatId, messagesConcatenated, replyToContext, mediaUrl, currentMsgWahaTs, isProactive } = params;

  if (!firebaseId) firebaseId = await resolveFirebaseId(chatId);
  if (!firebaseId) {
    await waha.sendMessage(chatId, "Hubo un problema temporal. Por favor, intenta de nuevo en unos segundos.", false);
    return;
  }

  await memory.ensureUserExists(firebaseId, chatId);

  if (!BOT_ENABLED()) return;

  if (!BOT_NEW_CLIENTS_AUTO()) {
    try {
      const contact = await waha.getContact(chatId);
      if (!contact?.isMyContact) return;
    } catch {
      return;
    }
  }

  let msgForAgent = messagesConcatenated;
  if (replyToContext?.quoted_text) {
    let prefix = `[El usuario está respondiendo a: «${replyToContext.quoted_text}»`;
    if (replyToContext.court_type) prefix += ` (tipo de cancha: ${replyToContext.court_type})`;
    msgForAgent = `${prefix}]. Mensaje del usuario: ${messagesConcatenated}`;
  }

  try {
    await waha.startTyping(chatId);

    await syncHistoryFromWaha(chatId, firebaseId, currentMsgWahaTs);

    const historial = await memory.getMessages(firebaseId, 25);

    if (!isProactive && !(await shouldRespondRealtime(messagesConcatenated, historial))) {
      await waha.stopTyping(chatId);
      return;
    }

    let agentOut: Awaited<ReturnType<typeof processMessage>> | null = null;
    let agentError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        agentOut = await processMessage({ msg: msgForAgent, firebaseId, chatId, historyMessages: historial });
        agentError = null;
        break;
      } catch (e) {
        agentError = e;
        if (isTransientError(e) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    }

    if (agentError || !agentOut) {
      console.error("Respuesta omitida por error del agente:", agentError);
      await waha.stopTyping(chatId);
      return;
    }

    // Persistir turno completo (human + ai)
    let userContent = msgForAgent;
    if (mediaUrl) {
      userContent = (userContent || "").replace(` [imagen enviada] media_url:${mediaUrl}`, "").trim() || "(imagen)";
    }
    const turn: SerializedMessage[] = [serializeHuman(userContent, mediaUrl || null), ...agentOut.newMessages];
    await memory.appendMessages(firebaseId, turn);

    // Procesar intermediate steps
    let mandatoryScheduleMessage: string | null = null;
    let stopDueToHuman = false;
    for (const step of agentOut.result.intermediateSteps) {
      const obs = step.observation || "";
      if (obs === "STOP_COMMUNICATION_HUMAN_REQUESTED") {
        stopDueToHuman = true;
        break;
      }
      if (step.action.tool === "show_schedule" && obs.includes(RESPUESTA_OBLIGATORIA_MSG_PREFIX)) {
        const idx = obs.indexOf(RESPUESTA_OBLIGATORIA_MSG_PREFIX);
        mandatoryScheduleMessage = obs.slice(idx + RESPUESTA_OBLIGATORIA_MSG_PREFIX.length).trim();
      }
    }

    if (!stopDueToHuman) {
      if (mandatoryScheduleMessage) {
        const clean = await parseAndSendCourtImages(chatId, mandatoryScheduleMessage);
        if (clean) await enviarMensajeDividido(chatId, clean);
      } else {
        const responseMessage = sanitizeAgentOutput(agentOut.result.output || "");
        if (responseMessage) {
          const clean = await parseAndSendCourtImages(chatId, responseMessage);
          if (clean) await enviarMensajeDividido(chatId, clean);
        }
      }
    }

    await waha.stopTyping(chatId);
  } catch (e) {
    console.error("Error CRÍTICO en processUserMessage:", e);
    try {
      await waha.stopTyping(chatId);
    } catch {
      /* noop */
    }
  }
}
