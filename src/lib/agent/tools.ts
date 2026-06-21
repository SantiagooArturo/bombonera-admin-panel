/**
 * Tools del agente (las 2 cableadas en producción): show_schedule y request_human.
 * Port de tool_show_schedule.py (ejecutar) y tool_request_human.py.
 */
import { getDb } from "@/lib/firebase-admin";
import { getWaha, normalizeChatIdToPhone } from "@/lib/waha-client";
import {
  RESPUESTA_OBLIGATORIA_MSG_PREFIX,
  LIMIT_BOT_ADVANCE_DAYS,
  isoFromLimaOffset,
  formatDateForUser,
  generateDaySchedulePng,
  buildSlotCheckUserMessage,
} from "@/lib/agent/schedule";

function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** show_schedule: genera y envía la cuadrícula del día. */
export async function executeShowSchedule(
  chatId: string,
  date: string,
  timeSlot?: string | null
): Promise<string> {
  try {
    const cleanDate = (date || "").trim();
    if (!isValidIsoDate(cleanDate)) {
      return "Formato de fecha inválido. Usa YYYY-MM-DD (ej: 2024-12-25)";
    }

    const today = isoFromLimaOffset(0);
    const maxDate = isoFromLimaOffset(LIMIT_BOT_ADVANCE_DAYS);
    if (cleanDate < today) return "No se pueden ver horarios de fechas pasadas.";
    if (cleanDate > maxDate) {
      return `ERROR: El chatbot solo puede dar disponibilidad hasta el ${formatDateForUser(maxDate)}.`;
    }

    const imgBase64 = await generateDaySchedulePng(cleanDate);
    if (!imgBase64) return "Error al generar la imagen de horarios.";

    const caption = `📅 Horarios disponibles - ${formatDateForUser(cleanDate)}`;
    const ok = await getWaha().sendImage(chatId, { imageBase64: imgBase64, caption });
    if (!ok) return "Error al enviar la imagen.";

    if (timeSlot) {
      const ts = timeSlot.trim();
      if (!ts.endsWith(":00")) {
        return `❌ Error: El horario '${ts}' no es válido. Solo trabajamos con horas exactas (ej: 18:00, 19:00). Indique al cliente que elija una hora en punto.`;
      }
      const userMessage = await buildSlotCheckUserMessage(cleanDate, ts);
      return `✅ Cuadrícula enviada. ${RESPUESTA_OBLIGATORIA_MSG_PREFIX}${userMessage}`;
    }

    return (
      `✅ Cuadrícula enviada. ${RESPUESTA_OBLIGATORIA_MSG_PREFIX}` +
      "Con mucho gusto le adjunto los horarios solicitados para que pueda revisarlos."
    );
  } catch (e) {
    console.error("Error ejecutando show_schedule:", e);
    return `Error al mostrar horarios: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** request_human: desactiva el bot y marca needs_help. */
export async function executeRequestHuman(
  chatId: string,
  reason: string,
  firebaseId?: string | null
): Promise<string> {
  const phone = normalizeChatIdToPhone(firebaseId || chatId);
  try {
    await getDb().collection("users").doc(phone).set(
      { is_automated: false, needs_help: true, help_reason: reason },
      { merge: true }
    );
    return "STOP_COMMUNICATION_HUMAN_REQUESTED";
  } catch (e) {
    console.error("Error solicitando ayuda humana:", e);
    return "Hubo un error al solicitar ayuda. Por favor, contacta directamente al administrador.";
  }
}
