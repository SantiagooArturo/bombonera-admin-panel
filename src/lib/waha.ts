const CHATBOT_API_URL = process.env.CHATBOT_API_URL || "";

const WAHA_URL = "https://waha-live-wahaa.dmncie.easypanel.host";
const WAHA_API_KEY = "MiClaveSegura123";
const WAHA_SESSION = "session_01kgx7mr4058d2hc98m62jx2cy";

/**
 * Envía un mensaje de WhatsApp y lo guarda en el historial de Firebase.
 * Si CHATBOT_API_URL está configurado, delega al servidor Python (centralizado).
 * Si no, llama a WAHA directamente (fallback).
 */
export async function sendWhatsAppMessage(chatId: string, text: string) {
  if (CHATBOT_API_URL) {
    const res = await fetch(`${CHATBOT_API_URL}/chatbot/send-bot-message/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message: text,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Chatbot API error: ${res.status} - ${error}`);
    }

    return res.json();
  }

  // Fallback: llamar a WAHA directamente (sin guardar en historial)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (WAHA_API_KEY) {
    headers["X-Api-Key"] = WAHA_API_KEY;
  }

  const res = await fetch(`${WAHA_URL}/api/sendText`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session: WAHA_SESSION,
      chatId,
      text,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`WAHA error: ${res.status} - ${error}`);
  }

  return res.json();
}
