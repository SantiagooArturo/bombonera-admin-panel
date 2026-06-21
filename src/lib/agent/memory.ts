/**
 * Capa de memoria sobre Firestore (port de utils/firebase_memory.py + memory_manager.py).
 * Estructura: message_history/{phone}.messages[], users/{phone}.
 * El ID de documento es SIEMPRE el número de WhatsApp (solo dígitos).
 */
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { normalizeChatIdToPhone } from "@/lib/waha-client";
import type { SerializedMessage } from "@/lib/agent/history-schema";
import { randomUUID } from "crypto";

export interface WahaContactLike {
  number?: string;
  name?: string;
  pushName?: string;
  pushname?: string;
  isMyContact?: boolean;
  [k: string]: unknown;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

class Memory {
  /** Sube imagen a Storage y devuelve URL pública con token. */
  async uploadImage(imageBytes: Buffer, contentType = "image/jpeg"): Promise<string | null> {
    try {
      const bucket = getStorageBucket();
      const ext = contentType.includes("jpeg") ? "jpg" : contentType.split("/").pop() || "bin";
      const path = `payments/${randomUUID()}.${ext}`;
      const token = randomUUID();
      const file = bucket.file(path);
      await file.save(imageBytes, {
        contentType,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      return (
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
        `/o/${path.replace(/\//g, "%2F")}?alt=media&token=${token}`
      );
    } catch (e) {
      console.error("Error subiendo imagen a Storage:", e);
      return null;
    }
  }

  /** Añade mensajes serializados al historial (con timestamp). */
  async appendMessages(chatId: string, messages: SerializedMessage[]): Promise<boolean> {
    if (!messages || !messages.length) return false;
    const phone = normalizeChatIdToPhone(chatId);
    try {
      const db = getDb();
      const docRef = db.collection("message_history").doc(phone);
      const doc = await docRef.get();
      const now = new Date().toISOString();
      const payload = messages.map((m) => ({ timestamp: now, ...m }));
      if (doc.exists) {
        await docRef.update({ messages: FieldValue.arrayUnion(...payload) });
      } else {
        await docRef.set({ messages: payload });
      }
      try {
        await db.collection("users").doc(phone).set(
          { last_interaction_at: FieldValue.serverTimestamp() },
          { merge: true }
        );
      } catch (e) {
        console.warn(`No se pudo actualizar last_interaction_at para ${phone}:`, e);
      }
      return true;
    } catch (e) {
      console.error("Error appendMessages:", e);
      return false;
    }
  }

  /** Últimos `limit` mensajes serializados. */
  async getMessages(chatId: string, limit = 25): Promise<SerializedMessage[]> {
    const phone = normalizeChatIdToPhone(chatId);
    try {
      const doc = await getDb().collection("message_history").doc(phone).get();
      if (!doc.exists) return [];
      const messages = (doc.data()?.messages as SerializedMessage[]) || [];
      return messages.length > limit ? messages.slice(-limit) : messages;
    } catch (e) {
      console.error("Error getMessages:", e);
      return [];
    }
  }

  /** Timestamp ISO del último mensaje, o null. */
  async getLastMessageTime(chatId: string): Promise<string | null> {
    const phone = normalizeChatIdToPhone(chatId);
    try {
      const doc = await getDb().collection("message_history").doc(phone).get();
      if (!doc.exists) return null;
      const messages = (doc.data()?.messages as SerializedMessage[]) || [];
      if (!messages.length) return null;
      return (messages[messages.length - 1].timestamp as string) || null;
    } catch (e) {
      console.error("Error getLastMessageTime:", e);
      return null;
    }
  }

  async clearMessages(chatId: string): Promise<boolean> {
    const phone = normalizeChatIdToPhone(chatId);
    try {
      await getDb().collection("message_history").doc(phone).delete();
      return true;
    } catch (e) {
      console.error("Error clearMessages:", e);
      return false;
    }
  }

  /** Crea el usuario si no existe; completa chat_id/phone_number si faltan. */
  async ensureUserExists(phoneNumber: string, chatId?: string): Promise<boolean> {
    const phone = normalizeChatIdToPhone(phoneNumber);
    if (!phone) return false;
    try {
      const db = getDb();
      const docRef = db.collection("users").doc(phone);
      const doc = await docRef.get();
      if (!doc.exists) {
        await docRef.set({
          chat_id: chatId || phone,
          phone_number: phone,
          balance: 0,
          reservation_count: 0,
          client_type: null,
          created_at: FieldValue.serverTimestamp(),
        });
        return true;
      }
      const data = doc.data() || {};
      const updates: Record<string, unknown> = {};
      if (!data.chat_id && chatId) updates.chat_id = chatId;
      if (!data.phone_number) updates.phone_number = phone;
      if (Object.keys(updates).length) await docRef.update(updates);
      return true;
    } catch (e) {
      console.error("Error ensureUserExists:", e);
      return false;
    }
  }

  /** Pausa manual (intervención humana). */
  async setManualPause(firebaseId: string, minutes = 60): Promise<void> {
    const phone = normalizeChatIdToPhone(firebaseId);
    try {
      const pauseUntil = new Date(Date.now() + minutes * 60_000);
      await getDb().collection("users").doc(phone).set(
        { manual_pause_until: Timestamp.fromDate(pauseUntil) },
        { merge: true }
      );
    } catch (e) {
      console.error("Error setManualPause:", e);
    }
  }

  /**
   * Verifica si un chat tiene el agente automatizado.
   * Crea el usuario si no existe. Reglas idénticas al backend Python.
   */
  async isChatAutomated(chatId: string, contactInfo?: WahaContactLike | null): Promise<boolean> {
    const phone = normalizeChatIdToPhone(chatId);
    try {
      const db = getDb();
      const docRef = db.collection("users").doc(phone);
      const doc = await docRef.get();

      if (!doc.exists) {
        const isContact = Boolean(contactInfo?.isMyContact);
        const autoDefault = !isContact;
        const userData: Record<string, unknown> = {
          is_automated: autoDefault,
          created_at: FieldValue.serverTimestamp(),
        };
        if (contactInfo) {
          if (contactInfo.name) userData.contact_name = contactInfo.name;
          const push = contactInfo.pushName || contactInfo.pushname;
          if (push) userData.push_name = push;
          if (contactInfo.number) userData.phone_number = contactInfo.number;
        }
        await docRef.set(userData);
        return autoDefault;
      }

      const data = doc.data() || {};
      if (contactInfo) {
        const updates: Record<string, unknown> = {};
        if (contactInfo.name) updates.contact_name = contactInfo.name;
        const push = contactInfo.pushName || contactInfo.pushname;
        if (push) updates.push_name = push;
        if (contactInfo.number && !data.phone_number) updates.phone_number = contactInfo.number;
        if (Object.keys(updates).length) await docRef.set(updates, { merge: true });
      }

      const isAutomatedFlag = data.is_automated !== false;
      const isContact = Boolean(contactInfo?.isMyContact);

      // 1. Contacto conocido -> siempre manual
      if (isContact) return false;

      // 2. Pausa manual activa -> manual
      const pauseDt = toDate(data.manual_pause_until);
      if (pauseDt && new Date() < pauseDt) return false;

      // 3. Seguir el flag
      return isAutomatedFlag;
    } catch (e) {
      console.error("Error isChatAutomated:", e);
      return false;
    }
  }

  async setChatAutomation(chatId: string, isAutomated: boolean): Promise<boolean> {
    const phone = normalizeChatIdToPhone(chatId);
    try {
      await getDb().collection("users").doc(phone).set({ is_automated: isAutomated }, { merge: true });
      return true;
    } catch (e) {
      console.error("Error setChatAutomation:", e);
      return false;
    }
  }
}

let _memory: Memory | null = null;
export function getMemory(): Memory {
  if (!_memory) _memory = new Memory();
  return _memory;
}
export type { Memory };
