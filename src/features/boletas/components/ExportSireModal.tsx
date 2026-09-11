"use client";

import { useEffect, useMemo, useState } from "react";
import { DocumentArrowDownIcon, XMarkIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import type { Invoice } from "@/lib/types";
import { exportRvieZipFromInvoices, parseInvoiceDateYmd } from "../utils/exportRvieZip";

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
  return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${y}`;
}

export function ExportSireModal({
  open,
  onClose,
  invoices,
}: {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
}) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonthYmdPrefix);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthYmdPrefix());
    for (const inv of invoices) {
      const ymd = parseInvoiceDateYmd(inv);
      if (ymd.length >= 7) {
        months.add(ymd.slice(0, 7));
      }
    }
    return Array.from(months).sort((a, b) => (a > b ? -1 : 1));
  }, [invoices]);

  useEffect(() => {
    if (open) {
      setError(null);
      if (monthOptions.length > 0 && !monthOptions.includes(selectedMonth)) {
        setSelectedMonth(monthOptions[0]!);
      }
    }
  }, [open, monthOptions, selectedMonth]);

  const handleDownloadZip = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await exportRvieZipFromInvoices(invoices, selectedMonth);

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar el archivo");
    } finally {
      setGenerating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Exportar reemplazo SIRE</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
            Periodo contable
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 shadow-sm focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabelEs(m)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          disabled={generating}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-700 py-3 text-sm font-bold text-white shadow-sm hover:bg-purple-800 disabled:opacity-50 transition-colors"
        >
          {generating ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <DocumentArrowDownIcon className="h-4 w-4" />
              Descargar
            </>
          )}
        </button>
      </div>
    </div>
  );
}
