import { getDb } from "@/lib/firebase-admin";

const CHATBOT_API_URL = process.env.CHATBOT_API_URL || "";

const WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";
const WAHA_API_KEY = "MiClaveSegura123";
const WAHA_SESSION = "session_01kgx7mr4058d2hc98m62jx2cy";

function normalizeChatId(chatId: string): string {
  const raw = (chatId || "").trim();
  if (!raw) return raw;
  if (raw.endsWith("@s.whatsapp.net")) return raw.replace("@s.whatsapp.net", "@c.us");
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  return `${digits}@c.us`;
}

function buildPhoneCandidates(value: string): string[] {
  const digits = value.replace(/\D/g, "");
  if (!digits) return [];
  const candidates = new Set<string>();
  candidates.add(digits);
  if (digits.startsWith("51") && digits.length > 9) {
    candidates.add(digits.slice(2));
  } else if (digits.length <= 9) {
    candidates.add(`51${digits}`);
  }
  return Array.from(candidates);
}

export async function resolveWhatsAppTarget(input: string): Promise<{ chatId: string; firebaseId: string }> {
  const normalizedInput = normalizeChatId(input);
  if (normalizedInput.includes("@")) {
    return { chatId: normalizedInput, firebaseId: normalizedInput.replace(/\D/g, "") };
  }

  const phoneCandidates = buildPhoneCandidates(normalizedInput);
  const db = getDb();

  for (const candidate of phoneCandidates) {
    const directDoc = await db.collection("users").doc(candidate).get();
    if (directDoc.exists) {
      const data = directDoc.data() as { chat_id?: string } | undefined;
      const candidateChatId = typeof data?.chat_id === "string" && data.chat_id.trim()
        ? normalizeChatId(data.chat_id)
        : normalizeChatId(candidate);
      return { chatId: candidateChatId, firebaseId: candidate };
    }
  }

  for (const candidate of phoneCandidates) {
    const snapshot = await db.collection("users").where("phone_number", "==", candidate).limit(1).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data() as { chat_id?: string } | undefined;
      const candidateChatId = typeof data?.chat_id === "string" && data.chat_id.trim()
        ? normalizeChatId(data.chat_id)
        : normalizeChatId(doc.id);
      const firebaseId = doc.id.replace(/\D/g, "") || candidate;
      return { chatId: candidateChatId, firebaseId };
    }
  }

  const fallbackChatId = normalizeChatId(normalizedInput);
  return { chatId: fallbackChatId, firebaseId: fallbackChatId.replace(/\D/g, "") };
}

/**
 * Envía un mensaje de WhatsApp y lo guarda en el historial de Firebase.
 * Si CHATBOT_API_URL está configurado, delega al servidor Python (centralizado).
 * Si no, llama a WAHA directamente (fallback).
 */
export async function sendWhatsAppMessage(chatId: string, text: string) {
  const resolved = await resolveWhatsAppTarget(chatId);
  const normalizedChatId = resolved.chatId;
  const firebaseId = resolved.firebaseId;

  if (CHATBOT_API_URL) {
    const res = await fetch(`${CHATBOT_API_URL}/chatbot/send-bot-message/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: normalizedChatId,
        firebase_id: firebaseId,
        message: text,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Chatbot API error: ${res.status} - ${error}`);
    }

    const data = await res.json().catch(() => ({}));
    if (data?.status && data.status !== "success") {
      throw new Error(`Chatbot API error: ${JSON.stringify(data)}`);
    }
    return data;
  }

  // Fallback: llamar a WAHA directamente (sin guardar en historial)
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
      session: WAHA_SESSION,
      chatId: normalizedChatId,
      text,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`WAHA error: ${res.status} - ${error}`);
  }

  return res.json();
}
