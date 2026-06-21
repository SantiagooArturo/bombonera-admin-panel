import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { getWaha } from "@/lib/waha-client";
import { claimBatch, type BufferedMessage } from "@/lib/agent/buffer";
import { processUserMessage } from "@/lib/agent/webhook-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

let _receiver: Receiver | null = null;
function receiver(): Receiver | null {
  if (_receiver) return _receiver;
  const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!cur || !next) return null;
  _receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: next });
  return _receiver;
}

function captionOrBodyToCourtType(text: string): string | undefined {
  const t = (text || "").trim().toLowerCase();
  const map: [string, string][] = [
    ["6 vs 6", "court_6v6"], ["6v6", "court_6v6"], ["la más grande", "court_6v6"],
    ["5 vs 5", "court_5v5"], ["5v5", "court_5v5"], ["compacta", "court_5v5"],
  ];
  for (const [frag, ct] of map) if (t.includes(frag)) return ct;
  return undefined;
}

export async function POST(request: NextRequest) {
  const bodyText = await request.text();

  const rec = receiver();
  if (rec) {
    const signature = request.headers.get("upstash-signature") || "";
    const valid = await rec.verify({ signature, body: bodyText }).catch(() => false);
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let data: { firebaseId?: string; chatId?: string; token?: string };
  try {
    data = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { firebaseId, chatId, token } = data;
  if (!firebaseId || !chatId || !token) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const batch = await claimBatch(firebaseId, token);
  if (batch === null) {
    // Token obsoleto: un mensaje posterior reprogramó el procesamiento.
    return NextResponse.json({ status: "stale" });
  }
  if (!batch.length) return NextResponse.json({ status: "empty" });

  const concatenated = batch.map((m) => m.body).join(" ");

  // replyTo: tomar el último contexto disponible o resolver id por API.
  let replyToContext = lastDefined(batch, (m) => m.replyToContext) || null;
  const replyToId = lastDefined(batch, (m) => (typeof m.replyTo === "string" ? m.replyTo : undefined));
  if (replyToId && !replyToContext?.quoted_text) {
    try {
      const ref = await getWaha().getMessageById(chatId, replyToId);
      const text = (ref?.caption || ref?.body || "").trim();
      if (text) {
        replyToContext = { quoted_text: text };
        const ct = captionOrBodyToCourtType(text);
        if (ct) replyToContext.court_type = ct;
      }
    } catch {
      /* noop */
    }
  }

  const mediaUrl = lastDefined(batch, (m) => m.mediaUrl || undefined) || null;
  const firstWahaTs = firstDefined(batch, (m) => m.wahaTimestamp ?? undefined) ?? null;

  await processUserMessage({
    chatId,
    messagesConcatenated: concatenated,
    replyToContext,
    mediaUrl,
    firebaseId,
    currentMsgWahaTs: firstWahaTs,
  });

  return NextResponse.json({ status: "processed" });
}

function lastDefined<T>(arr: BufferedMessage[], pick: (m: BufferedMessage) => T | undefined): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = pick(arr[i]);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function firstDefined<T>(arr: BufferedMessage[], pick: (m: BufferedMessage) => T | undefined): T | undefined {
  for (const m of arr) {
    const v = pick(m);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}
