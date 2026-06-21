import { getDb } from "@/lib/firebase-admin";
import { getWaha } from "@/lib/waha-client";

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

  const digits = normalizedInput.replace(/\D/g, "");
  const fallbackDigits = digits.startsWith("51") && digits.length === 11
    ? digits
    : digits.length === 9
      ? `51${digits}`
      : digits;
  const fallbackChatId = normalizeChatId(fallbackDigits);
  return { chatId: fallbackChatId, firebaseId: fallbackDigits };
}

/**
 * Envía un mensaje de WhatsApp y lo guarda en el historial de Firebase.
 * Usa el cliente WAHA en proceso (ya no delega al backend Python).
 */
export async function sendWhatsAppMessage(chatId: string, text: string) {
  const resolved = await resolveWhatsAppTarget(chatId);
  return getWaha().sendMessage(resolved.chatId, text, true);
}
