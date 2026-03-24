/** URL base del agente (Railway). Lectura en runtime para que .env se aplique bien en dev. */
export function getChatbotApiUrl(): string {
  let raw = process.env.CHATBOT_API_URL || "";
  if (raw && !raw.startsWith("http")) raw = `https://${raw}`;
  return raw.trim().replace(/\/+$/, "");
}
