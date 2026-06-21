import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { getMemory } from "@/lib/agent/memory";
import { getWaha } from "@/lib/waha-client";
import {
  syncHistoryFromWaha,
  processUserMessage,
  BOT_ENABLED,
  BOT_NEW_CLIENTS_AUTO,
} from "@/lib/agent/webhook-helpers";
import { shouldRespondProactive } from "@/lib/agent/agent";
import type { SerializedMessage } from "@/lib/agent/history-schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 800;

function pauseActive(value: unknown): boolean {
  let dt: Date | null = null;
  if (value instanceof Timestamp) dt = value.toDate();
  else if (value instanceof Date) dt = value;
  else if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      dt = (value as { toDate: () => Date }).toDate();
    } catch {
      dt = null;
    }
  }
  return Boolean(dt && new Date() < dt);
}

/** GET /api/cron/backlog-cleaner — responde proactivamente a chats pendientes (no automatizados). */
export async function GET() {
  if (!BOT_ENABLED()) {
    return NextResponse.json({ status: "skipped", reason: "BOT_ENABLED=false" });
  }

  const db = getDb();
  const memory = getMemory();
  const waha = getWaha();
  let processed = 0;
  let scanned = 0;

  try {
    const snap = await db.collection("users").orderBy("last_interaction_at", "desc").limit(20).get();

    for (const userDoc of snap.docs) {
      if (processed >= 5) break;
      scanned += 1;
      const firebaseId = userDoc.id;
      const data = userDoc.data() as Record<string, unknown>;

      if (pauseActive(data.manual_pause_until)) continue;

      const chatId = (data.chat_id as string) || `${firebaseId}@c.us`;
      const contact = await waha.getContact(chatId);
      const isContact = Boolean(contact?.isMyContact);
      if (!BOT_NEW_CLIENTS_AUTO() && !isContact) continue;
      if (isContact) continue;

      await syncHistoryFromWaha(chatId, firebaseId);
      const history = await memory.getMessages(firebaseId, 10);
      if (!history.length) continue;

      const last = history[history.length - 1] as SerializedMessage & { role?: string };
      const type = last.type || last.role;
      const sender = last.sender;
      if (type === "ai" || type === "admin" || type === "assistant" || sender === "bot") continue;

      const isHumanPending =
        type === "human" || type === "tool" || sender === "user" || last.isUser === true;
      if (!isHumanPending) continue;

      let userText = "";
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.type === "human" || m.sender === "user" || m.isUser === true) {
          userText = (m.content || m.body || "").trim();
          if (userText) break;
        }
      }
      if (!userText) continue;

      if (!(await shouldRespondProactive(history))) continue;

      await processUserMessage({
        chatId,
        messagesConcatenated: userText,
        firebaseId,
        isProactive: true,
      });
      processed += 1;
    }

    return NextResponse.json({ status: "ok", scanned, processed });
  } catch (error) {
    console.error("Error en backlog-cleaner:", error);
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Error interno", scanned, processed },
      { status: 500 }
    );
  }
}
