"use client";

import { useEffect, useMemo, useState } from "react";
import type { Invoice } from "@/lib/types";
import {
  exportInvoicesExcel,
  type ExportInvoiceKind,
  type ExportInvoicePeriod,
} from "@/features/boletas/utils/exportInvoicesExcel";

function currentMonthYmdPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabelEs(month: string): string {
  const [y, m] = month.split("-");
  const d = new Date(`${month}-01T12:00:00`);
  const monthName = d.toLocaleDateString("es-PE", { month: "long" });
  return `${monthName} ${y}`;
}

export function ExportExcelModal({
  open,
  onClose,
  invoices,
  defaultKind,
  onSuccess,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
  defaultKind: ExportInvoiceKind;
  onSuccess?: (count: number, fileName: string) => void;
  onError?: (message: string) => void;
}) {
  const [kind, setKind] = useState<ExportInvoiceKind>(defaultKind);
  const [periodMode, setPeriodMode] = useState<"mes" | "historico">("mes");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthYmdPrefix);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) setKind(defaultKind);
  }, [open, defaultKind]);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthYmdPrefix());
    for (const inv of invoices) {
      const ymd = String(inv.fecha_emision_ymd || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        months.add(ymd.slice(0, 7));
        continue;
      }
      const c = String(inv.created_at || "").trim();
      if (!c) continue;
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        months.add(`${y}-${m}`);
      }
    }
    return [...months].sort((a, b) => (a > b ? -1 : 1));
  }, [invoices]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Exportar Excel</h3>
            <p className="mt-1 text-sm text-gray-500">
              Descarga para contabilidad, separado por tipo y periodo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Tipo</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind("boleta")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
                kind === "boleta"
                  ? "border-field-dark bg-field-dark/10 text-field-dark"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Boletas
            </button>
            <button
              type="button"
              onClick={() => setKind("factura")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
                kind === "factura"
                  ? "border-field-dark bg-field-dark/10 text-field-dark"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Facturas
            </button>
          </div>
        </div>

        <div className="mb-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Periodo</p>
          <select
            value={periodMode}
            onChange={(e) => setPeriodMode(e.target.value === "historico" ? "historico" : "mes")}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/25"
          >
            <option value="mes">Mes específico</option>
            <option value="historico">Histórico completo</option>
          </select>
          {periodMode === "mes" ? (
            <div className="mt-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Mes</p>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/25"
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {monthLabelEs(m)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                const period: ExportInvoicePeriod =
                  periodMode === "historico"
                    ? { mode: "historico" }
                    : { mode: "mes", month: selectedMonth };
                const result = await exportInvoicesExcel({ invoices, kind, period });
                onSuccess?.(result.count, result.fileName);
                onClose();
              } catch (e) {
                onError?.(e instanceof Error ? e.message : "No se pudo exportar el Excel.");
              } finally {
                setExporting(false);
              }
            }}
            className="rounded-xl bg-field-dark px-4 py-2.5 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50"
          >
            {exporting ? "Exportando..." : "Descargar Excel"}
          </button>
        </div>
      </div>
    </div>
  );
}

