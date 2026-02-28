import { getDb } from "@/lib/firebase-admin";
import type { BotHealthStatus } from "@/lib/types";

type KeepaliveResult = {
  ok: boolean;
  httpStatus: number | null;
  errorMessage: string | null;
};

const COLLECTION = "system_health";
const DOC_ID = "waha_keepalive";
const CRON_SCHEDULE = "0 */4 * * *";
const STALE_AFTER_MS = 10 * 60 * 60 * 1000;

function toIsoNow() {
  return new Date().toISOString();
}

function parseDate(input: unknown): Date | null {
  if (typeof input !== "string" || !input) return null;
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? null : value;
}

export async function recordKeepaliveExecution(result: KeepaliveResult): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const nowIso = toIsoNow();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data() || {}) as Record<string, unknown>;
    const previousFailures = Number(current.consecutive_failures || 0);
    const nextFailures = result.ok ? 0 : previousFailures + 1;

    const payload: Record<string, unknown> = {
      updated_at: nowIso,
      last_run_at: nowIso,
      last_result: result.ok ? "ok" : "error",
      last_http_status: result.httpStatus,
      consecutive_failures: nextFailures,
    };

    if (result.ok) {
      payload.last_success_at = nowIso;
      payload.last_error_message = null;
    } else {
      payload.last_error_at = nowIso;
      payload.last_error_message = result.errorMessage || "Error desconocido en keepalive";
    }

    tx.set(ref, payload, { merge: true });
  });
}

export async function getBotHealthStatus(): Promise<BotHealthStatus> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    return {
      indicator: "red",
      status: "unknown",
      title: "Sin datos de keepalive",
      detail: "Aún no hay ejecuciones registradas del cron de WAHA.",
      is_stale: true,
      last_run_at: null,
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      consecutive_failures: 0,
      cron_schedule: CRON_SCHEDULE,
    };
  }

  const data = (snap.data() || {}) as Record<string, unknown>;
  const lastRunAt = typeof data.last_run_at === "string" ? data.last_run_at : null;
  const lastSuccessAt = typeof data.last_success_at === "string" ? data.last_success_at : null;
  const lastErrorAt = typeof data.last_error_at === "string" ? data.last_error_at : null;
  const lastErrorMessage = typeof data.last_error_message === "string" ? data.last_error_message : null;
  const consecutiveFailures = Number(data.consecutive_failures || 0);
  const lastResult = typeof data.last_result === "string" ? data.last_result : "unknown";

  const lastRunDate = parseDate(lastRunAt);
  const isStale = !lastRunDate || Date.now() - lastRunDate.getTime() > STALE_AFTER_MS;
  const hasRecentFailure = consecutiveFailures > 0 || lastResult === "error";
  const isHealthy = !isStale && !hasRecentFailure;

  if (isHealthy) {
    return {
      indicator: "green",
      status: "ok",
      title: "Bot operativo",
      detail: "El último keepalive fue exitoso y está dentro del rango esperado.",
      is_stale: false,
      last_run_at: lastRunAt,
      last_success_at: lastSuccessAt,
      last_error_at: lastErrorAt,
      last_error_message: lastErrorMessage,
      consecutive_failures: consecutiveFailures,
      cron_schedule: CRON_SCHEDULE,
    };
  }

  const staleReason = isStale ? "No hay señal reciente del cron." : "";
  const failReason = hasRecentFailure
    ? `Se detectaron ${consecutiveFailures} fallo(s) consecutivo(s).`
    : "";
  const detail = [staleReason, failReason].filter(Boolean).join(" ");

  return {
    indicator: "red",
    status: "error",
    title: "Bot con riesgo operativo",
    detail: detail || "El estado de keepalive no es saludable.",
    is_stale: isStale,
    last_run_at: lastRunAt,
    last_success_at: lastSuccessAt,
    last_error_at: lastErrorAt,
    last_error_message: lastErrorMessage,
    consecutive_failures: consecutiveFailures,
    cron_schedule: CRON_SCHEDULE,
  };
}
