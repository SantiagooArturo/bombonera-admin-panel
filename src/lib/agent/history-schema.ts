/**
 * Esquema de serialización del historial de conversación para Firebase.
 * Port de utils/history_schema.py. Mantiene el MISMO formato en Firestore
 * para compatibilidad con datos existentes.
 *
 * Para el agente usamos la API de chat de OpenAI, por lo que el historial se
 * reconstruye como mensajes user/assistant de texto (los tool_calls del turno
 * actual se manejan en vivo dentro del loop del agente).
 */

export const TYPE_HUMAN = "human";
export const TYPE_AI = "ai";
export const TYPE_TOOL = "tool";
export const TYPE_ADMIN = "admin";

export interface SerializedToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

export interface SerializedMessage {
  type?: string;
  content?: string;
  image_url?: string;
  tool_calls?: SerializedToolCall[];
  tool_call_id?: string;
  name?: string;
  timestamp?: string;
  // legacy
  sender?: string;
  body?: string;
  isUser?: boolean;
  [k: string]: unknown;
}

export function serializeHuman(content: string, imageUrl?: string | null): SerializedMessage {
  const msg: SerializedMessage = { type: TYPE_HUMAN, content: content || "" };
  if (imageUrl) msg.image_url = imageUrl;
  return msg;
}

export function serializeAi(content: string, toolCalls?: SerializedToolCall[] | null): SerializedMessage {
  const msg: SerializedMessage = { type: TYPE_AI, content: content || "" };
  if (toolCalls && toolCalls.length) msg.tool_calls = toolCalls;
  return msg;
}

export function serializeTool(toolCallId: string, name: string, content: string): SerializedMessage {
  return { type: TYPE_TOOL, tool_call_id: toolCallId, name, content: content || "" };
}

export function serializeAdmin(content: string): SerializedMessage {
  return { type: TYPE_ADMIN, content: content || "" };
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

/**
 * Convierte mensajes serializados (Firebase) a mensajes de chat OpenAI (solo texto).
 * Soporta formato nuevo (type/content) y legacy (sender/body/isUser).
 * Los tool_calls y tool messages se omiten del historial para evitar
 * errores de emparejamiento estricto de la API de OpenAI.
 */
export function deserializeToOpenAI(messages: SerializedMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;

    if (m.type === TYPE_HUMAN) {
      let content = m.content || "";
      if (m.image_url) content = `${content} [usuario envió imagen]`.trim();
      out.push({ role: "user", content });
      continue;
    }
    if (m.type === TYPE_ADMIN) {
      out.push({ role: "assistant", content: `[Mensaje del administrador]: ${m.content || ""}` });
      continue;
    }
    if (m.type === TYPE_AI) {
      const content = (m.content || "").trim();
      if (content) out.push({ role: "assistant", content });
      continue;
    }
    if (m.type === TYPE_TOOL) {
      continue;
    }
    // Legacy
    const sender = m.sender;
    const body = m.body || "";
    if (sender === "user" || m.isUser) {
      out.push({ role: "user", content: body });
    } else if (sender === "bot" || (sender == null && m.isUser === false)) {
      out.push({ role: "assistant", content: body });
    }
  }
  return out;
}
