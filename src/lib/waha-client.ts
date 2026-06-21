/**
 * Cliente WAHA server-side (port de services/waha.py).
 * Solo usar en API routes / código de servidor (usa firebase-admin).
 */
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  getWahaApiKey,
  getWahaSession,
  getWahaUrl,
} from "@/lib/waha-server-config";

export function normalizeChatIdToPhone(chatId: string): string {
  return (chatId || "").replace(/\D/g, "");
}

export function normalizeChatId(chatId: string): string {
  const raw = (chatId || "").trim();
  if (!raw) return raw;
  if (raw.endsWith("@s.whatsapp.net")) return raw.replace("@s.whatsapp.net", "@c.us");
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  return `${digits}@c.us`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = getWahaApiKey();
  if (key) h["X-Api-Key"] = key;
  return h;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { retries = 3, backoffMs = 500, timeoutMs = 10000 }: { retries?: number; backoffMs?: number; timeoutMs?: number } = {}
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if ([502, 503, 504].includes(res.status) && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface WahaContact {
  number?: string;
  name?: string;
  pushname?: string;
  isMyContact?: boolean;
  [k: string]: unknown;
}

export interface WahaMessage {
  id?: string;
  body?: string;
  caption?: string;
  fromMe?: boolean;
  timestamp?: number;
  hasMedia?: boolean;
  type?: string;
  messageType?: string;
  mimetype?: string;
  mimeType?: string;
  filename?: string;
  fileName?: string;
  media?: { url?: string; mimetype?: string; mimeType?: string; filename?: string; fileName?: string } | null;
  replyTo?: unknown;
  [k: string]: unknown;
}

class WahaClient {
  private base() {
    return getWahaUrl();
  }
  private session() {
    return getWahaSession();
  }

  /** Envía texto. Si saveToHistory, persiste en message_history de Firebase. */
  async sendMessage(chatId: string, message: string, saveToHistory = false): Promise<unknown> {
    const url = `${this.base()}/api/sendText`;
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ session: this.session(), chatId, text: message }),
    });
    if (![200, 201].includes(res.status)) {
      const text = await res.text().catch(() => "");
      throw new Error(`WAHA sendText failed: ${res.status} - ${text.slice(0, 300) || "empty body"}`);
    }
    if (saveToHistory) {
      await this.saveToHistory(chatId, message);
    }
    return res.json().catch(() => ({ status: "ok" }));
  }

  /** Guarda un mensaje del bot (type=ai) en message_history/{phone}. */
  async saveToHistory(chatId: string, message: string): Promise<void> {
    try {
      const phone = normalizeChatIdToPhone(chatId);
      if (!phone) return;
      const db = getDb();
      const entry = { type: "ai", content: message, timestamp: new Date().toISOString() };
      const docRef = db.collection("message_history").doc(phone);
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.update({ messages: FieldValue.arrayUnion(entry) });
      } else {
        await docRef.set({ messages: [entry] });
      }
      try {
        await db.collection("users").doc(phone).set(
          { last_interaction_at: new Date().toISOString() },
          { merge: true }
        );
      } catch (e) {
        console.warn(`No se pudo actualizar last_interaction_at para ${phone}:`, e);
      }
    } catch (e) {
      console.error("Error guardando mensaje en historial:", e);
    }
  }

  async getHistoryMessages(chatId: string, limit = 50, timestampGte?: number): Promise<WahaMessage[]> {
    const params = new URLSearchParams({ limit: String(limit), downloadMedia: "false" });
    if (timestampGte != null) params.set("filter.timestamp.gte", String(Math.floor(timestampGte)));
    const url = `${this.base()}/api/${this.session()}/chats/${encodeURIComponent(chatId)}/messages?${params}`;
    try {
      const res = await fetchWithRetry(url, { method: "GET", headers: headers() });
      if (res.status === 200) return (await res.json()) as WahaMessage[];
      return [];
    } catch (e) {
      console.error("Error get_history_messages:", e);
      return [];
    }
  }

  async getMessageById(chatId: string, messageId: string): Promise<WahaMessage | null> {
    const url = `${this.base()}/api/${this.session()}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
    try {
      const res = await fetchWithRetry(url, { method: "GET", headers: headers() });
      if (res.status === 200) return (await res.json()) as WahaMessage;
      return null;
    } catch {
      return null;
    }
  }

  async startTyping(chatId: string): Promise<void> {
    try {
      await fetchWithRetry(
        `${this.base()}/api/startTyping`,
        { method: "POST", headers: headers(), body: JSON.stringify({ session: this.session(), chatId }) },
        { timeoutMs: 5000, retries: 0 }
      );
    } catch {
      /* noop */
    }
  }

  async stopTyping(chatId: string): Promise<void> {
    try {
      await fetchWithRetry(
        `${this.base()}/api/stopTyping`,
        { method: "POST", headers: headers(), body: JSON.stringify({ session: this.session(), chatId }) },
        { timeoutMs: 5000, retries: 0 }
      );
    } catch {
      /* noop */
    }
  }

  async getContact(contactId: string): Promise<WahaContact | null> {
    const params = new URLSearchParams({ contactId, session: this.session() });
    const url = `${this.base()}/api/contacts?${params}`;
    try {
      const res = await fetchWithRetry(url, { method: "GET", headers: headers() }, { timeoutMs: 8000 });
      if (res.status === 200) return (await res.json()) as WahaContact;
      return null;
    } catch {
      return null;
    }
  }

  async getChatPicture(chatId: string, refresh = false): Promise<string | null> {
    const params = new URLSearchParams({ refresh: refresh ? "true" : "false" });
    const url = `${this.base()}/api/${this.session()}/chats/${encodeURIComponent(chatId)}/picture?${params}`;
    try {
      const res = await fetchWithRetry(url, { method: "GET", headers: headers() }, { timeoutMs: 8000 });
      if (res.status === 200) {
        const data = (await res.json()) as { url?: string };
        let pic = data.url ?? null;
        if (pic && pic.startsWith("/")) pic = `${this.base()}${pic}`;
        return pic;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getPhoneByLid(lid: string): Promise<string | null> {
    const lidNumber = lid.includes("@lid") ? lid.split("@")[0] : lid;
    const url = `${this.base()}/api/${this.session()}/lids/${encodeURIComponent(lidNumber)}`;
    try {
      const res = await fetchWithRetry(url, { method: "GET", headers: headers() }, { timeoutMs: 8000 });
      if (res.status === 200) {
        const data = (await res.json()) as { pn?: string };
        return data.pn ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Envía imagen (base64). Devuelve true/false. */
  async sendImage(
    chatId: string,
    { imageBase64, caption, filename = "schedule.jpg", mimetype = "image/jpeg" }: { imageBase64: string; caption?: string; filename?: string; mimetype?: string }
  ): Promise<boolean> {
    let data = imageBase64;
    if (data.includes(",")) data = data.split(",")[1];
    const payload: Record<string, unknown> = {
      session: this.session(),
      chatId,
      file: { mimetype, data, filename },
    };
    if (caption) payload.caption = caption;
    try {
      const res = await fetchWithRetry(
        `${this.base()}/api/sendImage`,
        { method: "POST", headers: headers(), body: JSON.stringify(payload) },
        { timeoutMs: 15000 }
      );
      return [200, 201].includes(res.status);
    } catch (e) {
      console.error("Excepción enviando imagen:", e);
      return false;
    }
  }

  /** Envía archivo (PDF). Devuelve [success, errorMsg]. */
  async sendFile(
    chatId: string,
    {
      fileUrl,
      fileBase64,
      mimetype = "application/pdf",
      filename = "document.pdf",
      caption,
    }: { fileUrl?: string; fileBase64?: string; mimetype?: string; filename?: string; caption?: string }
  ): Promise<[boolean, string | null]> {
    const payload: Record<string, unknown> = { session: this.session(), chatId };
    if (caption) payload.caption = caption;
    if (fileUrl) {
      payload.file = { mimetype, filename, url: fileUrl };
    } else if (fileBase64) {
      let data = fileBase64;
      if (data.includes(",")) data = data.split(",")[1];
      payload.file = { mimetype, filename, data };
    } else {
      return [false, "Se debe proporcionar file_url o file_base64"];
    }
    try {
      const res = await fetchWithRetry(
        `${this.base()}/api/sendFile`,
        { method: "POST", headers: headers(), body: JSON.stringify(payload) },
        { timeoutMs: 30000 }
      );
      if ([200, 201].includes(res.status)) return [true, null];
      const err = await res.text().catch(() => "");
      return [false, err.slice(0, 500) || `HTTP ${res.status}`];
    } catch (e) {
      return [false, e instanceof Error ? e.message : String(e)];
    }
  }
}

let _client: WahaClient | null = null;
export function getWaha(): WahaClient {
  if (!_client) _client = new WahaClient();
  return _client;
}
export type { WahaClient };
