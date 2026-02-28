import type { BotHealthStatus } from "@/lib/types";

export async function fetchBotHealthStatus(): Promise<BotHealthStatus> {
  const response = await fetch("/api/cron/waha-keepalive-status", {
    method: "GET",
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as Partial<BotHealthStatus>;
  if (!response.ok) {
    throw new Error(data.detail || "No se pudo consultar la salud del bot.");
  }

  return data as BotHealthStatus;
}
