"use client";

import { useCallback, useEffect, useState } from "react";
import type { BotHealthStatus } from "@/lib/types";
import { fetchBotHealthStatus } from "@/features/salud/services/fetchBotHealthStatus";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FALLBACK_STATUS: BotHealthStatus = {
  indicator: "red",
  status: "unknown",
  title: "Estado no disponible",
  detail: "Aún no se pudo cargar la salud del bot.",
  is_stale: true,
  last_run_at: null,
  last_success_at: null,
  last_error_at: null,
  last_error_message: null,
  consecutive_failures: 0,
  cron_schedule: "0 */4 * * *",
};

export function BotHealthPanel() {
  const [status, setStatus] = useState<BotHealthStatus>(FALLBACK_STATUS);
  const [loading, setLoading] = useState(true);
  const [probingNow, setProbingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await fetchBotHealthStatus();
      setStatus(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error consultando salud del bot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const isGreen = status.indicator === "green";

  const probeNow = useCallback(async () => {
    setProbingNow(true);
    setError(null);
    setProbeMessage(null);
    try {
      const response = await fetch("/api/cron/waha-keepalive", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data?.error || "Falló la prueba inmediata de conexión.");
      }
      setProbeMessage("Prueba completada. Se actualizó el estado con la señal más reciente.");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en prueba inmediata");
      await loadStatus();
    } finally {
      setProbingNow(false);
    }
  }, [loadStatus]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 ">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Salud del bot</h2>
          <p className="text-sm text-gray-500 mt-1 ">
            Esta vista es para mantenimiento del software, no para operación diaria de administradores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={probeNow}
            disabled={probingNow}
            className="px-3 py-2 w-36 rounded-lg bg-bombonera-600 text-white text-sm font-semibold hover:bg-bombonera-700 disabled:opacity-60"
          >
            {probingNow ? "Probando..." : "Probar salud ahora"}
          </button>
          <button
            onClick={loadStatus}
            disabled={loading || probingNow}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-4 mt-4">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-4 w-4 rounded-full ${isGreen ? "bg-emerald-500" : "bg-red-500"}`}
            aria-label={isGreen ? "Estado saludable" : "Estado con error"}
          />
          <p className={`text-sm font-semibold ${isGreen ? "text-emerald-700" : "text-red-700"}`}>{status.title}</p>
        </div>
        <p className="mt-2 text-sm text-gray-700">{status.detail}</p>
        {probeMessage && <p className="mt-2 text-sm text-emerald-700">{probeMessage}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <InfoRow label="Última señal del bot" value={formatDateTime(status.last_run_at)} />
        <InfoRow label="Última señal OK" value={formatDateTime(status.last_success_at)} />
        <InfoRow label="Última señal con error" value={formatDateTime(status.last_error_at)} />
        <InfoRow
          label="Fallos consecutivos"
          value={String(status.consecutive_failures)}
          danger={status.consecutive_failures > 0}
        />
        <InfoRow label="Estado estancado" value={status.is_stale ? "Sí" : "No"} danger={status.is_stale} />
      </div>

      {status.last_error_message && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Último detalle de error</p>
          <p className="text-sm text-red-700 mt-1">{status.last_error_message}</p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${danger ? "text-red-700" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}
