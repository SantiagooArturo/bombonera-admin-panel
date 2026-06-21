/**
 * Flujos de integración para chats NO automatizados (port de manual_sync_listener.py).
 * - Creación de reserva desde contexto admin: DESACTIVADO (igual que en producción).
 * - Pago pasivo: registra el comprobante (Storage + transfers) si el cliente envía imagen.
 *   Port de ToolPayReservation.registrar_pago_modo_pasivo y sus helpers.
 */
import OpenAI from "openai";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getMemory } from "@/lib/agent/memory";
import { getWahaUrl, getWahaApiKey } from "@/lib/waha-server-config";
import { normalizeChatIdToPhone } from "@/lib/waha-client";
import type { SerializedMessage } from "@/lib/agent/history-schema";

const VISION_MODEL = process.env.PAYMENT_VISION_MODEL || "gpt-4o-mini";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

function fixMediaUrl(mediaUrl: string): string {
  try {
    const parsed = new URL(mediaUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      const waha = new URL(getWahaUrl());
      return mediaUrl.replace(`${parsed.protocol}//${parsed.host}`, `${waha.protocol}//${waha.host}`);
    }
  } catch {
    /* noop */
  }
  return mediaUrl;
}

async function downloadImage(mediaUrl: string): Promise<{ base64: string; mimetype: string; bytes: Buffer } | null> {
  try {
    const url = fixMediaUrl(mediaUrl);
    const headers: Record<string, string> = {};
    const key = getWahaApiKey();
    if (key) headers["X-Api-Key"] = key;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const mimetype = res.headers.get("Content-Type") || "image/jpeg";
    return { base64: bytes.toString("base64"), mimetype, bytes };
  } catch (e) {
    console.error("Error descargando imagen:", e);
    return null;
  }
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    const rows = t.split("\n");
    t = rows.slice(1, -1).join("\n").trim();
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function classifyImage(base64: string, mimetype: string): Promise<{ description: string; isPaymentProof: boolean }> {
  try {
    const dataUrl = `data:${mimetype};base64,${base64}`;
    const resp = await client().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Eres un clasificador de imágenes. Tu tarea es:\n" +
            "1. Describir brevemente qué es la imagen (en español, informal, ej: 'veo que me has enviado una foto de...')\n" +
            "2. Determinar si es un comprobante de pago (transferencia bancaria, voucher, Yape, Plin, depósito, recibo)\n\n" +
            'Responde SOLO con JSON:\n{"description": "veo que me has enviado...", "is_payment_proof": true/false}',
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            { type: "text", text: "¿Qué es esta imagen? ¿Es un comprobante de pago?" },
          ],
        },
      ],
    });
    const text = (resp.choices[0].message.content || "").trim();
    const parsed = parseJsonLoose(text);
    if (parsed) {
      return {
        description: String(parsed.description || "veo que me has enviado una imagen"),
        isPaymentProof: Boolean(parsed.is_payment_proof),
      };
    }
    const isPayment = ["comprobante", "pago", "transferencia", "yape", "plin", "voucher"].some((w) =>
      text.toLowerCase().includes(w)
    );
    return { description: text, isPaymentProof: isPayment };
  } catch (e) {
    console.error("Error clasificando imagen:", e);
    return { description: "no pude analizar la imagen", isPaymentProof: false };
  }
}

interface PaymentData {
  recipientName: string | null;
  amount: number | null;
  transactionDate: string | null;
  operationId: string | null;
}

async function extractPaymentData(base64: string, mimetype: string): Promise<PaymentData> {
  try {
    const dataUrl = `data:${mimetype};base64,${base64}`;
    const resp = await client().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "Extrae los siguientes datos del comprobante de pago. Si un dato no está visible o no existe, usa null.\n\n" +
            'Responde SOLO con JSON:\n{\n  "recipient_name": "nombre del destinatario o null",\n' +
            '  "amount": 50.00 (número, el monto transferido) o null,\n' +
            '  "transaction_date": "YYYY-MM-DD" o null,\n' +
            '  "operation_id": "número de operación como string" o null\n}\n\n' +
            "IMPORTANTE: amount debe ser un número (sin S/, sin comas). operation_id es el código único de la transacción.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "text", text: "Extrae los datos de este comprobante de pago." },
          ],
        },
      ],
    });
    const parsed = parseJsonLoose((resp.choices[0].message.content || "").trim());
    if (!parsed) return { recipientName: null, amount: null, transactionDate: null, operationId: null };
    let amount: number | null = null;
    const rawAmount = parsed.amount;
    if (typeof rawAmount === "number") amount = rawAmount;
    else if (typeof rawAmount === "string") {
      const n = parseFloat(rawAmount.replace(/,/g, "").replace(/S\//g, "").trim());
      amount = Number.isNaN(n) ? null : n;
    }
    return {
      recipientName: parsed.recipient_name ? String(parsed.recipient_name) : null,
      amount,
      transactionDate: parsed.transaction_date ? String(parsed.transaction_date) : null,
      operationId: parsed.operation_id ? String(parsed.operation_id) : null,
    };
  } catch (e) {
    console.error("Error extrayendo datos:", e);
    return { recipientName: null, amount: null, transactionDate: null, operationId: null };
  }
}

async function checkDuplicateTransfer(operationId: string): Promise<boolean> {
  if (!operationId) return false;
  try {
    const snap = await getDb().collection("transfers").where("operation_id", "==", operationId).limit(1).get();
    return !snap.empty;
  } catch {
    return false;
  }
}

async function checkDuplicateMediaForPhone(phone: string, sourceMediaUrl: string): Promise<boolean> {
  if (!phone || !sourceMediaUrl) return false;
  try {
    const snap = await getDb().collection("transfers").where("phone_number", "==", phone).limit(80).get();
    return snap.docs.some((d) => (d.data() as Record<string, unknown>).source_media_url === sourceMediaUrl);
  } catch {
    return false;
  }
}

async function saveTransfer(data: {
  phoneNumber: string;
  chatId: string;
  recipientName: string | null;
  amount: number | null;
  transactionDate: string | null;
  operationId: string | null;
  status: string;
  mediaUrl: string;
  sourceMediaUrl: string;
  passiveUnassigned?: boolean;
}): Promise<string | null> {
  try {
    const docRef = getDb().collection("transfers").doc();
    const payload: Record<string, unknown> = {
      phone_number: data.phoneNumber,
      chat_id: data.chatId,
      recipient_name: data.recipientName,
      amount: data.amount,
      transaction_date: data.transactionDate,
      operation_id: data.operationId,
      reservation_id: null,
      status: data.status,
      source: "passive_listen",
      payment_method: "digital",
      media_url: data.mediaUrl,
      source_media_url: data.sourceMediaUrl,
      created_at: FieldValue.serverTimestamp(),
    };
    if (data.passiveUnassigned) payload.passive_unassigned = true;
    await docRef.set(payload);
    return docRef.id;
  } catch (e) {
    console.error("Error guardando transferencia:", e);
    return null;
  }
}

/** Registra el comprobante de pago en modo pasivo (sin reserva ligada). */
export async function registrarPagoModoPasivo(chatId: string, mediaUrl: string, firebaseId: string): Promise<string> {
  const phone = normalizeChatIdToPhone(firebaseId);
  const memory = getMemory();

  if (await checkDuplicateMediaForPhone(phone, mediaUrl)) {
    return "TRANSFERENCIA_YA_PROCESADA: Esta misma imagen ya fue registrada para este usuario.";
  }

  const img = await downloadImage(mediaUrl);
  if (!img) return "NO_SE_PUDO_DESCARGAR: No se pudo descargar la imagen.";

  const { description, isPaymentProof } = await classifyImage(img.base64, img.mimetype);
  if (!isPaymentProof) {
    return `IMAGEN_NO_ES_PAGO: ${description}. No se registró como pago (modo pasivo solo guarda comprobantes).`;
  }

  const storageUrl = await memory.uploadImage(img.bytes, img.mimetype);
  if (!storageUrl) return "ERROR_SUBIDA_IMAGEN: No se pudo guardar la imagen del comprobante.";

  const { recipientName, amount, transactionDate, operationId } = await extractPaymentData(img.base64, img.mimetype);

  if (operationId && (await checkDuplicateTransfer(operationId))) {
    await getDb().collection("users").doc(phone).set({ client_type: "sospechoso_fraude" }, { merge: true });
    await memory.setChatAutomation(phone, false);
    await saveTransfer({
      phoneNumber: phone, chatId: phone, recipientName, amount, transactionDate, operationId,
      status: "rejected_duplicate", mediaUrl: storageUrl, sourceMediaUrl: mediaUrl, passiveUnassigned: true,
    });
    return `TRANSFERENCIA_DUPLICADA: La operación ${operationId} ya consta en el sistema.`;
  }

  const status = amount != null ? "registered_passive" : "registered_passive_amount_unknown";
  const docId = await saveTransfer({
    phoneNumber: phone, chatId: phone, recipientName, amount, transactionDate, operationId,
    status, mediaUrl: storageUrl, sourceMediaUrl: mediaUrl, passiveUnassigned: true,
  });

  const suffix = docId ? ` doc=${docId}` : "";
  if (amount == null) {
    return `PAGO_REGISTRADO_PASIVO: Comprobante guardado (monto no legible). Operación: ${operationId || "sin código"}${suffix}`;
  }
  return `PAGO_REGISTRADO_PASIVO: Comprobante guardado por S/ ${amount.toFixed(2)}. Operación: ${operationId || "sin código"}${suffix}`;
}

export interface ManualSyncParams {
  chatId: string;
  firebaseId: string;
  history: SerializedMessage[];
  contactNumber: string | null;
  hasMedia: boolean;
  mediaUrl: string | null;
  fromMe: boolean;
}

/** Ejecuta los flujos pasivos para un chat no automatizado. */
export async function maybeRunManualSyncFlows(params: ManualSyncParams): Promise<void> {
  // Flujo 1 (crear reserva desde admin): DESACTIVADO por seguridad (igual que producción).

  // Flujo 2: pago del cliente (imagen).
  if (params.hasMedia && params.mediaUrl && !params.fromMe) {
    try {
      await registrarPagoModoPasivo(params.chatId, params.mediaUrl, params.firebaseId);
    } catch (e) {
      console.warn("Error en pago pasivo:", e);
    }
  }
}
