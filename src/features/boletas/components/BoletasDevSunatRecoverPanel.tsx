"use client";

import { useCallback, useEffect, useState } from "react";

const LS_KEY = "devMode";

function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

type PreviewRow = {
  correlativo: number;
  serie_correlativo: string;
  cliente_denominacion: string;
  amount: number;
  fecha_emision_ymd: string;
  sunat_estado: string;
  dataSource: "api" | "pdf";
};

type ScanJson = {
  error?: string;
  skippedNoFirestoreCluster?: boolean;
  message?: string;
  gapsScanned?: number;
  recoverableCount?: number;
  previewRows?: PreviewRow[];
  errors?: Array<{ correlativo: number; reason: string }>;
  notInSunatCount?: number;
  notInSunatSample?: number[];
};

type ApplyJson = {
  error?: string;
  written?: number;
  skipped?: number;
  message?: string;
  errors?: Array<{ correlativo: number; reason: string }>;
};

/**
 * Solo si `localStorage.devMode === "true"`. El servidor exige desarrollo o ALLOW_DEV_SUNAT_INVOICE_RECOVERY=1.
 */
export function BoletasDevSunatRecoverPanel(props: { onRestored?: () => void }) {
  const { onRestored } = props;
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanJson | null>(null);

  useEffect(() => {
    setEnabled(readDevMode());
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY || e.key === null) setEnabled(readDevMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setMsg(null);
    setScan(null);
    try {
      const res = await fetch("/api/invoices/dev-recover-sunat-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      const data = (await res.json().catch(() => ({}))) as ScanJson;
      if (!res.ok) {
        setMsg(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
        return;
      }
      if (data.skippedNoFirestoreCluster) {
        setMsg(data.message ?? "Sin cluster en Firestore.");
        return;
      }
      setScan(data);
      setMsg(
        data.recoverableCount === 0
          ? "No hay boletas recuperables (SUNAT sin doc o ya en Firestore)."
          : `Listas para restaurar: ${data.recoverableCount} (huecos/cola revisados: ${data.gapsScanned ?? "—"}).`
      );
    } catch {
      setMsg("Error de red al escanear.");
    } finally {
      setScanning(false);
    }
  }, []);

  const runApply = useCallback(async () => {
    if (!scan?.previewRows?.length) return;
    if (
      !confirm(
        `¿Crear ${scan.recoverableCount} documento(s) en Firestore? Esta acción no se puede deshacer desde el panel.`
      )
    ) {
      return;
    }
    setApplying(true);
    setMsg(null);
    try {
      const res = await fetch("/api/invoices/dev-recover-sunat-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const data = (await res.json().catch(() => ({}))) as ApplyJson;
      if (!res.ok) {
        setMsg(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
        return;
      }
      setMsg(
        `Hecho: escritos ${data.written ?? 0}, omitidos (ya existían) ${data.skipped ?? 0}.` +
          (data.errors?.length ? ` Avisos: ${data.errors.length}.` : "")
      );
      setScan(null);
      onRestored?.();
    } catch {
      setMsg("Error de red al restaurar.");
    } finally {
      setApplying(false);
    }
  }, [scan, onRestored]);

  if (!enabled) return null;

  return (
    <div className="mb-4 rounded-xl border border-violet-300/80 bg-violet-50/90 px-3 py-2 text-sm text-violet-950 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 font-bold text-violet-900"
      >
        <span>🔧 Dev: recuperar boletas SUNAT ausentes en Firestore</span>
        <span className="tabular-nums text-xs opacity-80">{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-violet-200/80 pt-3">
          <p className="text-xs text-violet-900/90">
            Compara huecos y cola respecto a la serie{" "}
            <code className="rounded bg-violet-100/80 px-1">APISUNAT_SERIE_BOLETA</code> con apisunat{" "}
            <code className="rounded bg-violet-100/80 px-1">/status</code> + PDF si hace falta. En producción el POST
            solo responde con{" "}
            <code className="rounded bg-violet-100/80 px-1">ALLOW_DEV_SUNAT_INVOICE_RECOVERY=1</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={scanning || applying}
              className="rounded-lg border border-violet-400 bg-white px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
            >
              {scanning ? "Escaneando…" : "Buscar ausentes"}
            </button>
            {scan?.previewRows && scan.previewRows.length > 0 ? (
              <button
                type="button"
                onClick={() => void runApply()}
                disabled={applying || scanning}
                className="rounded-lg bg-violet-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-900 disabled:opacity-50"
              >
                {applying ? "Restaurando…" : `Restaurar en Firestore (${scan.recoverableCount})`}
              </button>
            ) : null}
          </div>

          {scan?.previewRows && scan.previewRows.length > 0 ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-violet-200 bg-white/90">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="sticky top-0 bg-violet-100/95 font-semibold text-violet-950">
                  <tr>
                    <th className="px-2 py-1.5">Comprobante</th>
                    <th className="px-2 py-1.5">Cliente</th>
                    <th className="px-2 py-1.5">Monto</th>
                    <th className="px-2 py-1.5">Emisión</th>
                    <th className="px-2 py-1.5">SUNAT</th>
                    <th className="px-2 py-1.5">Fuente</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.previewRows.map((r) => (
                    <tr key={r.serie_correlativo} className="border-t border-violet-100">
                      <td className="px-2 py-1 font-mono">{r.serie_correlativo}</td>
                      <td className="max-w-[180px] truncate px-2 py-1" title={r.cliente_denominacion}>
                        {r.cliente_denominacion || "—"}
                      </td>
                      <td className="px-2 py-1 tabular-nums">S/ {Number(r.amount).toFixed(2)}</td>
                      <td className="px-2 py-1 font-mono">{r.fecha_emision_ymd || "—"}</td>
                      <td className="px-2 py-1">{r.sunat_estado}</td>
                      <td className="px-2 py-1 uppercase">{r.dataSource}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {scan?.errors && scan.errors.length > 0 ? (
            <div className="rounded border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-xs text-amber-950">
              <p className="font-semibold">Errores / omitidos en el escaneo</p>
              <ul className="mt-1 list-inside list-disc">
                {scan.errors.slice(0, 15).map((e) => (
                  <li key={e.correlativo}>
                    {e.correlativo}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {msg ? <p className="text-xs font-medium text-violet-900">{msg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
