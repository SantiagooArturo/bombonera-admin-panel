"use client";

import { useEffect, useMemo, useState } from "react";
import type { Invoice } from "@/lib/types";
import {
  EXPORT_INCLUSIVE_MIN_YMD,
  exportInvoicesExcel,
  exportMinDateAllowsCalendarMonth,
  type ExportInvoiceKind,
  type ExportInvoicePeriod,
} from "@/features/boletas/utils/exportInvoicesExcel";
import { invoiceIsVigenteForExport } from "@/features/boletas/utils/invoiceUiStatus";

function currentMonthYmdPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabelEs(month: string): string {
  const [y] = month.split("-");
  const d = new Date(`${month}-01T12:00:00`);
  const monthName = d.toLocaleDateString("es-PE", { month: "long" });
  return `${monthName} ${y}`;
}

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRangeToYmd(): string {
  const t = todayYmdLocal();
  return t < EXPORT_INCLUSIVE_MIN_YMD ? EXPORT_INCLUSIVE_MIN_YMD : t;
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
  const [periodMode, setPeriodMode] = useState<"mes" | "historico" | "rango">("mes");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthYmdPrefix);
  const [rangeFrom, setRangeFrom] = useState<string>(EXPORT_INCLUSIVE_MIN_YMD);
  const [rangeTo, setRangeTo] = useState<string>(defaultRangeToYmd);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) setKind(defaultKind);
  }, [open, defaultKind]);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthYmdPrefix());
    for (const inv of invoices.filter(invoiceIsVigenteForExport)) {
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
    return Array.from(months).sort((a, b) => (a > b ? -1 : 1));
  }, [invoices]);

  const monthOptionsEligible = useMemo(() => {
    const base = monthOptions.filter(exportMinDateAllowsCalendarMonth);
    if (base.length > 0) return base;
    const minYm = EXPORT_INCLUSIVE_MIN_YMD.slice(0, 7);
    return exportMinDateAllowsCalendarMonth(minYm) ? [minYm] : [];
  }, [monthOptions]);

  useEffect(() => {
    if (!open || monthOptionsEligible.length === 0) return;
    if (!monthOptionsEligible.includes(selectedMonth)) {
      setSelectedMonth(monthOptionsEligible[0]!);
    }
  }, [open, monthOptionsEligible, selectedMonth]);

  const rangoInvalid = periodMode === "rango" && rangeFrom > rangeTo;

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
            onChange={(e) => {
              const v = e.target.value;
              setPeriodMode(v === "historico" ? "historico" : v === "rango" ? "rango" : "mes");
            }}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/25"
          >
            <option value="mes">Mes específico</option>
            <option value="rango">Rango específico</option>
            <option value="historico">Histórico completo</option>
          </select>
          {periodMode === "mes" ? (
            <div className="mt-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Mes</p>
              <select
                value={
                  monthOptionsEligible.includes(selectedMonth)
                    ? selectedMonth
                    : (monthOptionsEligible[0] ?? selectedMonth)
                }
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/25"
              >
                {monthOptionsEligible.map((m) => (
                  <option key={m} value={m}>
                    {monthLabelEs(m)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {periodMode === "rango" ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Desde</span>
                <input
                  type="date"
                  value={rangeFrom}
                  min={EXPORT_INCLUSIVE_MIN_YMD}
                  max={rangeTo}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/25"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Hasta</span>
                <input
                  type="date"
                  value={rangeTo}
                  min={rangeFrom < EXPORT_INCLUSIVE_MIN_YMD ? EXPORT_INCLUSIVE_MIN_YMD : rangeFrom}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/25"
                />
              </label>
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
            disabled={exporting || rangoInvalid || (periodMode === "mes" && monthOptionsEligible.length === 0)}
            onClick={async () => {
              setExporting(true);
              try {
                let period: ExportInvoicePeriod;
                if (periodMode === "historico") {
                  period = { mode: "historico" };
                } else if (periodMode === "rango") {
                  period = { mode: "rango", desde: rangeFrom, hasta: rangeTo };
                } else {
                  period = {
                    mode: "mes",
                    month: monthOptionsEligible.includes(selectedMonth)
                      ? selectedMonth
                      : (monthOptionsEligible[0] ?? selectedMonth),
                  };
                }
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

