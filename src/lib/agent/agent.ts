/**
 * Agente de reservas (port de agent_3_completo.py).
 * Usa la Responses API de OpenAI con razonamiento y un loop de tools (máx 5 iteraciones).
 * Solo 2 tools cableadas: show_schedule y request_human (paridad con producción).
 */
import OpenAI from "openai";
import { getDb } from "@/lib/firebase-admin";
import { normalizeChatIdToPhone } from "@/lib/waha-client";
import { serializeAi, deserializeToOpenAI, type SerializedMessage } from "@/lib/agent/history-schema";
import { buildInfoCanchasYPrecios } from "@/lib/agent/court-config";
import { FEW_SHOT_EXAMPLES } from "@/lib/agent/few-shot-examples";
import {
  nowLima,
  formatDatetimeLimaSpanish,
  buildHolidaysInBookingWindow,
  buildAvailabilityGridSummary,
  formatDateForUser,
  isoFromLimaOffset,
  isAfter6pmBlockEnabled,
  LIMIT_BOT_ADVANCE_DAYS,
} from "@/lib/agent/schedule";
import { executeShowSchedule, executeRequestHuman } from "@/lib/agent/tools";

const AGENT_MODEL = process.env.AGENT_MODEL || "gpt-5.4-mini";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export interface IntermediateStep {
  action: { tool: string; tool_input: Record<string, unknown> };
  observation: string;
}

export interface AgentResult {
  output: string;
  intermediateSteps: IntermediateStep[];
}

interface UserContext {
  pending: number;
  confirmed: number;
  completed: number;
  balance: number;
}

async function getUserContext(firebaseId: string): Promise<UserContext> {
  try {
    const phone = normalizeChatIdToPhone(firebaseId);
    const db = getDb();
    const userDoc = await db.collection("users").doc(phone).get();
    const balance = userDoc.exists ? Number(userDoc.data()?.balance ?? 0) : 0;

    const snap = await db.collection("reservations").where("chat_id", "==", phone).limit(10).get();
    let pending = 0;
    let confirmed = 0;
    let completed = 0;
    const today = isoFromLimaOffset(0);
    snap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const status = (data.status as string) || "pending";
      const rDate = (data.date as string) || "";
      if (status === "confirmed") {
        if (rDate < today) completed += 1;
        else confirmed += 1;
      } else if (status === "pending") {
        pending += 1;
      }
    });
    return { pending, confirmed, completed, balance };
  } catch (e) {
    console.warn("Error getUserContext:", e);
    return { pending: 0, confirmed: 0, completed: 0, balance: 0 };
  }
}

function formatUserContextForPrompt(firebaseId: string, ctx: UserContext): string {
  return [
    `- Teléfono: ${firebaseId}`,
    `- Saldo: S/ ${ctx.balance.toFixed(2)}`,
    `- Reservas pendientes de pago: ${ctx.pending}`,
    `- Reservas confirmadas: ${ctx.confirmed}`,
  ].join("\n");
}

async function buildSystemPrompt(firebaseId: string): Promise<string> {
  const fechaActualStr = formatDatetimeLimaSpanish();
  const holidaysBlock = buildHolidaysInBookingWindow();
  const fechaLimiteStr = formatDateForUser(isoFromLimaOffset(LIMIT_BOT_ADVANCE_DAYS));
  const [infoCanchas, gridSummary, userCtx] = await Promise.all([
    buildInfoCanchasYPrecios(),
    buildAvailabilityGridSummary(),
    getUserContext(firebaseId),
  ]);
  const userDataSection = formatUserContextForPrompt(firebaseId, userCtx);

  let policyAfter6pm = "";
  if (isAfter6pmBlockEnabled()) {
    policyAfter6pm =
      "\nPOLÍTICA ACTIVA (6:00 pm): Si el cliente pregunta o pide cualquier horario desde las 6:00 pm en adelante, " +
      "dígale siempre que está ocupado o agotado; no busque día por día disponibilidad nocturna ni ofrezca reservar a esa hora.\n";
  }

  return `Eres parte del equipo de atención de La Bombonera (Surquillo, Lima). Mantén un trato de amabilidad excepcional y respeto absoluto. Usa siempre la conjugación de 'usted' para dirigirte al cliente, pero mantén la identidad humana en todo momento.

PROTOCOLO DE IDENTIDAD:
- EXCLUSIVIDAD DE VOLEY: Es fundamental que el cliente sepa que alquilamos canchas de VOLEY. Muchos nos confunden con fútbol. Mencione que el servicio es de voley de forma natural en sus primeras intervenciones.
- Prohibido mencionar que eres un chatbot, IA o asistente virtual.
- Jamás digas que vas a "derivar con un humano". Lo haces en secreto.

PROTOCOLO DE ACADEMIAS:
- Si el cliente pregunta por clases, profesores, academias o entrenamientos, aclare primero que La Bombonera solo alquila canchas de voley, pero comparta amablemente la información de los profesores que entrenan en el local:

  Academias Mayores mixto:
  - Prof. Lucho Gonzáles: 920658166 — Domingos de 8 a 10 am
  - Prof. Marcelo Sparrow: 955465965 — Todos los días
  - Prof. Richard Tristán (Cuba): 955437554 — Miércoles y viernes (noche), domingos de 8 a 10 am
  - Prof. Marcelo Gonzales: 980634582 — Entrenamiento personalizado y grupos de señoras


PROTOCOLO DE ESTILO:
- TONO CON EL CLIENTE: Use la conjugación de 'usted' para la formalidad, pero evite repetir la palabra 'Usted'.
- BREVEDAD MÁXIMA: Responda de forma directa y concisa. No use 3 palabras si puede usar 1.
- TEXTO PLANO: Prohibido Markdown (sin ** o _).
- FORMATO DE HORA (12h): Use am/pm (ej: 7:00 pm).

PROTOCOLO DE INFORMACIÓN:
${policyAfter6pm}- GUÍA DE RAZONAMIENTO (REGLA DE ORO): Antes de afirmar que un horario está disponible, razona muy bien, detenidamente, y de forma crítica, si realmente lo está o no según la CUADRILLA DE DISPONIBILIDAD TÉCNICA. Por nada del mundo nos podemos permitir confundirnos y decir que un horario está disponible cuando no lo está. La precisión es su máxima prioridad.
- REGLA DE HORARIO: Solo se reserva en horas exactas (ej: 6:00 pm, 4:00 pm, 10:00 am). Queda terminantemente PROHIBIDO reservar para horas fraccionadas o medias horas (ej: NO se reserva a las 6:30 pm o 7:45 pm). Siempre redondee al inicio de la hora consultada si es necesario, pero aclare esta política al cliente.
- Sea PRECISO con los precios (montos correctos según la sección INFORMACIÓN DE CANCHAS Y PRECIOS). Si varía en fin de semana, menciónelo.
- FERIADOS (Perú): Si el día que cotiza aparece en la lista de feriados del prompt, no use precio de día hábil L-V para ese día; use la tarifa de feriado o fin de semana según la tabla.
- ORDEN (disponibilidad antes que precio): Si el cliente busca cancha, día u horario (no una consulta general de precios), primero alinee con la CUADRILLA qué hay libre y para qué tipo de cancha. No adelante montos de un producto que no tiene hueco para lo que pide (confunde y parece confirmación de espacio). El precio concreto va después de tener opción real, salvo que pregunte solo por precios.
- CONSULTA GENERAL DE PRECIOS (p. ej. solo dice precios o cuánto cuesta, sin elegir cancha): use el mismo esquema breve del Escenario 3 de los ejemplos (tres tipos comerciales y notas de noche L-V). No agrupe ni enumere números de cancha (1, 2, 3…) salvo que el cliente pida precio por cancha o por número.
- Analice el Grid de Disponibilidad adjunto ANTES de responder. 
- PERSISTENCIA DE FECHA: Si el usuario mencionó una fecha anterior, asuma que sigue hablando de ella.
- PROGRAMACIÓN MÁXIMA: Solo gestionas hasta el ${fechaLimiteStr}.

DETALLES TÉCNICOS:
- Fecha y hora actual (Lima): ${fechaActualStr}
- Feriados en Perú:
${holidaysBlock}
- PROGRAMACIÓN MÁXIMA: ${fechaLimiteStr}
- INFORMACIÓN DE CANCHAS Y PRECIOS:
${infoCanchas}

GRID DE DISPONIBILIDAD REAL:
${gridSummary}

EJEMPLOS DE CONVERSACIÓN:
${FEW_SHOT_EXAMPLES}

CONTEXTO DEL USUARIO:
${userDataSection}`;
}

const OPENAI_TOOLS = [
  {
    type: "function" as const,
    name: "show_schedule",
    description: "Muestra la cuadrícula de horarios de un día concreto. Retorna la URL de una imagen.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha en YYYY-MM-DD" },
        time_slot: { type: "string", description: "Opcional. Hora en HH:MM" },
      },
      required: ["date"],
    },
  },
  {
    type: "function" as const,
    name: "request_human",
    description: "Solicita ayuda humana para cerrar el caso o por errores.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Razón del traspaso" },
      },
      required: ["reason"],
    },
  },
];

/** Procesa un mensaje del usuario y devuelve la respuesta del agente + mensajes a persistir. */
export async function processMessage(params: {
  msg: string;
  firebaseId: string;
  chatId: string;
  historyMessages: SerializedMessage[];
}): Promise<{ result: AgentResult; newMessages: SerializedMessage[] }> {
  const { msg, firebaseId, chatId, historyMessages } = params;

  const systemPrompt = await buildSystemPrompt(firebaseId);

  const input: OpenAI.Responses.ResponseInputItem[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of deserializeToOpenAI(historyMessages || [])) {
    const role = m.role === "user" ? "user" : "assistant";
    input.push({ role, content: m.content });
  }
  input.push({ role: "user", content: msg || "" });

  const intermediateSteps: IntermediateStep[] = [];
  const newMessages: SerializedMessage[] = [];
  let finalText = "";

  for (let iteration = 0; iteration < 5; iteration++) {
    const response = await client().responses.create({
      model: AGENT_MODEL,
      input,
      tools: OPENAI_TOOLS as unknown as OpenAI.Responses.Tool[],
      reasoning: { effort: "medium", summary: "auto" },
    });

    const functionCalls: OpenAI.Responses.ResponseFunctionToolCall[] = [];
    for (const item of response.output) {
      if (item.type === "message") {
        const textPart = item.content?.find((c) => c.type === "output_text");
        if (textPart && "text" in textPart) {
          finalText = textPart.text;
          newMessages.push(serializeAi(finalText));
        }
      } else if (item.type === "function_call") {
        functionCalls.push(item);
      }
    }

    input.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));

    if (!functionCalls.length) break;

    for (const fc of functionCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(fc.arguments || "{}");
      } catch {
        args = {};
      }

      let observation: string;
      if (fc.name === "show_schedule") {
        observation = await executeShowSchedule(
          chatId,
          String(args.date || ""),
          args.time_slot ? String(args.time_slot) : null
        );
      } else if (fc.name === "request_human") {
        observation = await executeRequestHuman(chatId, String(args.reason || ""), firebaseId);
      } else {
        observation = `Herramienta ${fc.name} no encontrada.`;
      }

      input.push({
        type: "function_call_output",
        call_id: fc.call_id,
        output: String(observation),
      });
      intermediateSteps.push({ action: { tool: fc.name, tool_input: args }, observation });
    }
  }

  return { result: { output: finalText, intermediateSteps }, newMessages };
}

/** Juez en tiempo real: decide si el bot debe responder al último mensaje (sesgo positivo). */
export async function shouldRespondRealtime(msg: string, history: SerializedMessage[]): Promise<boolean> {
  try {
    const lines: string[] = [];
    for (const m of history.slice(-6)) {
      const type = m.type || (m as { role?: string }).role;
      const content = (m.content || m.body || "").trim();
      if (!content) continue;
      if (type === "human" || type === "user") lines.push(`Cliente: ${content}`);
      else if (type === "ai" || type === "assistant" || type === "admin") lines.push(`Bot: ${content}`);
    }
    lines.push(`Cliente: ${msg}`);
    const chatContext = lines.join("\n");

    const judgeModel = process.env.AGENT_JUDGE_MODEL || "gpt-5.4-mini";
    const response = await client().responses.create({
      model: judgeModel,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: `Eres un supervisor de un chatbot de alquiler de canchas de voley.
Analiza la conversación y decide si el chatbot debe responder al último mensaje del cliente.

REGLAS (SESGO POSITIVO — en caso de duda, SÍ responder):
- Responde SI a cualquier pregunta sobre precios, disponibilidad, horarios, reservas, canchas o servicios.
- Responde SI si el cliente quiere reservar, pagar o saber más sobre el servicio.
- Responde SI si el mensaje es ambiguo o podría contener una consulta implícita.
- Responde NO únicamente si el mensaje es un acuse de recibo puro sin ninguna pregunta implícita (ej: "ok", "ya", "entendido", "gracias", "chau", "dale", "listo", emojis solos) Y el bot ya dio una respuesta completa o cerró la conversación justo antes.
- Responde NO si el cliente se despide claramente y la conversación ya concluyó.
- EN CASO DE DUDA, RESPONDE SIEMPRE: SI.

CONVERSACIÓN:
${chatContext}

Razona brevemente y luego responde con una sola palabra: SI o NO.`,
        },
      ],
    });

    let finalText = "";
    for (const item of response.output) {
      if (item.type === "message") {
        const textPart = item.content?.find((c) => c.type === "output_text");
        if (textPart && "text" in textPart) finalText = textPart.text.trim().toUpperCase();
      }
    }
    return !finalText.includes("NO");
  } catch (e) {
    console.warn("Error en juez real-time:", e);
    return true;
  }
}

export { nowLima };

/** Juez proactivo (backlog cleaner): sesgo NEGATIVO; solo responde si hay duda pendiente clara. */
export async function shouldRespondProactive(history: SerializedMessage[]): Promise<boolean> {
  try {
    const lines: string[] = [];
    for (const m of history) {
      const isUser = m.type === "human" || (m as { sender?: string }).sender === "user" || m.isUser;
      const role = isUser ? "Cliente" : "Bot";
      const text = m.content || m.body || "";
      lines.push(`${role}: ${text}`);
    }
    const chatContext = lines.join("\n");
    const model = process.env.AGENT_PROACTIVE_JUDGE_MODEL || "gpt-4o-mini";

    const resp = await client().chat.completions.create({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Eres un supervisor de un chatbot de alquiler de canchas de voley. 
Tu trabajo es decidir si el chatbot debe intervenir proactivamente para responder al último mensaje del cliente.

REGLAS DE DECISIÓN (SESGO NEGATIVO):
- Responde SI solo si el cliente tiene una duda pendiente, pide precios, consulta disponibilidad o hace preguntas directas sobre el servicio.
- Responde NO si se está hablando de pagos (Yape, Plin, transferencia, cuentas bancarias, enviar captura).
- Responde NO si el cliente está intentando separar, reservar o ya confirmó que quiere una cancha (esa fase la maneja un humano).
- Responde NO si el cliente envía un comprobante o pregunta "¿a qué cuenta?" / "¿por qué medio pago?".
- Responde NO si el cliente se está despidiendo (ej: "gracias", "chau", "entendido").
- Responde NO si el cliente indica que NO puede o NO quiere reservar ahora.
- Responde NO si el mensaje es ambiguo, emojis o stickers.
- EN CASO DE DUDA, RESPONDE SIEMPRE: NO.

CONVERSACIÓN:
${chatContext}

¿Debe el bot responder al último mensaje? Responde únicamente con la palabra SI o NO.`,
        },
      ],
    });
    const decision = (resp.choices[0].message.content || "").trim().toUpperCase();
    return decision.includes("SI");
  } catch (e) {
    console.warn("Error en juez proactivo:", e);
    return false;
  }
}
