/**
 * Buffer de mensajes para serverless (reemplaza el daemon thread del backend Python).
 * Acumula mensajes en Upstash Redis y programa el procesamiento (debounce) con QStash.
 *
 * Debounce: cada mensaje nuevo regenera un token y reprograma un callback QStash.
 * Solo el callback cuyo token coincide con el último guardado procesa el batch;
 * los callbacks antiguos hacen no-op.
 */
import { Redis } from "@upstash/redis";
import { Client as QStashClient } from "@upstash/qstash";
import { randomUUID } from "crypto";

export interface BufferedMessage {
  body: string;
  replyTo?: unknown;
  replyToContext?: { quoted_text?: string; court_type?: string } | null;
  mediaUrl?: string | null;
  wahaTimestamp?: number | null;
}

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  _redis = Redis.fromEnv();
  return _redis;
}

let _qstash: QStashClient | null = null;
function qstash(): QStashClient | null {
  if (_qstash) return _qstash;
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  _qstash = new QStashClient({ token });
  return _qstash;
}

function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

const BUFFER_TTL_SECONDS = 600;
const bufKey = (id: string) => `chatbuffer:${id}`;
const tokKey = (id: string) => `chatbuffer:token:${id}`;

/**
 * Encola un mensaje y programa (o reprograma) el procesamiento del batch.
 * Devuelve true si se programó vía QStash; false si no hay infra (se procesa inline el caller).
 */
export async function enqueueMessage(
  firebaseId: string,
  chatId: string,
  message: BufferedMessage,
  waitSeconds: number
): Promise<boolean> {
  const r = redis();
  const q = qstash();
  if (!r || !q) return false;

  const token = randomUUID();
  await r.rpush(bufKey(firebaseId), JSON.stringify(message));
  await r.expire(bufKey(firebaseId), BUFFER_TTL_SECONDS);
  await r.set(tokKey(firebaseId), token, { ex: BUFFER_TTL_SECONDS });

  await q.publishJSON({
    url: `${appBaseUrl()}/api/chatbot/process-buffer`,
    body: { firebaseId, chatId, token },
    delay: waitSeconds,
  });
  return true;
}

/**
 * Recupera y limpia el batch si el token sigue siendo el último.
 * Devuelve null si el token está obsoleto (un mensaje posterior reprogramó).
 */
export async function claimBatch(
  firebaseId: string,
  token: string
): Promise<BufferedMessage[] | null> {
  const r = redis();
  if (!r) return null;
  const currentToken = await r.get<string>(tokKey(firebaseId));
  if (currentToken !== token) return null;

  const raw = await r.lrange(bufKey(firebaseId), 0, -1);
  await r.del(bufKey(firebaseId));
  await r.del(tokKey(firebaseId));

  const out: BufferedMessage[] = [];
  for (const item of raw) {
    try {
      out.push(typeof item === "string" ? (JSON.parse(item) as BufferedMessage) : (item as BufferedMessage));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function bufferInfraReady(): boolean {
  return Boolean(redis() && qstash());
}
