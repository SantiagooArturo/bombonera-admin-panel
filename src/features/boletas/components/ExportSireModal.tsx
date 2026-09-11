"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DocumentArrowDownIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import type { Invoice } from "@/lib/types";
import { getInvoiceUiStatus } from "../utils/invoiceUiStatus";
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

function formatMonto(n: number): string {
  const [intPart, decPart] = n.toFixed(2).split(".");
  const spaced = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F");
  return `S/ ${spaced}.${decPart}`;
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
  const [successInfo, setSuccessInfo] = useState<{ fileName: string; total: number; anuladas: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modo alternativo de ajuste con archivo SIRE
  const [showFileAdjust, setShowFileAdjust] = useState(false);
  const [adjustFile, setAdjustFile] = useState<File | null>(null);
  const [adjusting, setAdjusting] = useState(false);

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
      setSuccessInfo(null);
      setAdjustFile(null);
      if (monthOptions.length > 0 && !monthOptions.includes(selectedMonth)) {
        setSelectedMonth(monthOptions[0]!);
      }
    }
  }, [open, monthOptions, selectedMonth]);

  const monthStats = useMemo(() => {
    const list = invoices.filter((inv) => parseInvoiceDateYmd(inv).startsWith(selectedMonth));
    let activeCount = 0;
    let voidedCount = 0;
    let sumActive = 0;
    let sumVoided = 0;

    for (const inv of list) {
      const isVoided = inv.status === "voided" || getInvoiceUiStatus(inv) === "anulado";
      const amt = Number(inv.amount || 0);
      if (isVoided) {
        voidedCount++;
        sumVoided += amt;
      } else {
        activeCount++;
        sumActive += amt;
      }
    }

    return {
      total: list.length,
      activeCount,
      voidedCount,
      sumActive: Math.round(sumActive * 100) / 100,
      sumVoided: Math.round(sumVoided * 100) / 100,
    };
  }, [invoices, selectedMonth]);

  const handleDownloadZip = async () => {
    setGenerating(true);
    setError(null);
    setSuccessInfo(null);
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

      setSuccessInfo({
        fileName: result.fileName,
        total: result.totalCount,
        anuladas: result.voidedCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar el ZIP de reemplazo SIRE");
    } finally {
      setGenerating(false);
    }
  };

  const handleAdjustSunatFile = async () => {
    if (!adjustFile) return;
    setAdjusting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", adjustFile);
      formData.append("download_rvie_zip", "1");

      const res = await fetch("/api/invoices/compare-sire", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Error al procesar el archivo SIRE");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const contentDisposition = res.headers.get("content-disposition");
      let filename = `reemplazo-propuesta-sire-${selectedMonth}.zip`;
      if (contentDisposition) {
        const m = contentDisposition.match(/filename="?([^"]+)"?/);
        if (m && m[1]) filename = m[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setSuccessInfo({
        fileName: filename,
        total: monthStats.total,
        anuladas: monthStats.voidedCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al procesar el archivo de SUNAT");
    } finally {
      setAdjusting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
              <DocumentArrowDownIcon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Exportar reemplazo SIRE</h3>
              <p className="text-xs text-gray-500">
                Archivo oficial ZIP (Anexo 3 RVIE) para cargar en SUNAT «Reemplazar Propuesta»
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </div>
        ) : null}

        {successInfo ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold">¡Archivo descargado con éxito!</p>
              <p className="text-emerald-700">
                <strong>{successInfo.fileName}</strong> ({successInfo.total} comprobantes, {successInfo.anuladas} anulados en S/ 0.00).
              </p>
            </div>
          </div>
        ) : null}

        {/* Selector de Mes */}
        <div className="mb-5">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-600">
            Periodo contable (Mes)
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

        {/* Resumen del Mes */}
        <div className="mb-5 rounded-xl border border-purple-100 bg-purple-50/70 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-purple-900">
            Comprobantes a incluir en el archivo ({monthLabelEs(selectedMonth)})
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="block text-[11px] text-gray-500">Total</span>
              <span className="font-bold text-gray-900 text-sm">{monthStats.total}</span>
            </div>
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="block text-[11px] text-emerald-600">Vigentes</span>
              <span className="font-bold text-emerald-700 text-sm">{monthStats.activeCount}</span>
              <span className="block text-[10px] text-gray-400 mt-0.5">{formatMonto(monthStats.sumActive)}</span>
            </div>
            <div className="rounded-lg bg-white p-2.5 shadow-sm border border-purple-200">
              <span className="block text-[11px] text-purple-700 font-semibold">Anuladas (0.00)</span>
              <span className="font-bold text-purple-900 text-sm">{monthStats.voidedCount}</span>
              <span className="block text-[10px] text-purple-600 mt-0.5">Est. Comp = 2</span>
            </div>
          </div>
          {monthStats.voidedCount > 0 ? (
            <p className="mt-2.5 text-[11px] text-purple-800 leading-relaxed">
              💡 Las <strong>{monthStats.voidedCount} boleta(s) anulada(s)</strong> se exportan con Base Imponible S/ 0.00, IGV S/ 0.00 y Estado 2, por lo que el SIRE las registrará como anuladas y cuadrará exactamente con contabilidad.
            </p>
          ) : null}
        </div>

        {/* Botón Principal de Descarga Directa */}
        <div className="mb-5">
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={generating || monthStats.total === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-700 py-3 text-sm font-bold text-white shadow-sm hover:bg-purple-800 disabled:opacity-50 transition-colors"
          >
            {generating ? (
              <>
                <ArrowPathIcon className="h-5 w-5 animate-spin" />
                Generando archivo ZIP oficial...
              </>
            ) : (
              <>
                <DocumentArrowDownIcon className="h-5 w-5" />
                Descargar reemplazo SIRE ({monthLabelEs(selectedMonth)})
              </>
            )}
          </button>
        </div>

        {/* Opcion secundaria: Ajustar archivo de SUNAT */}
        <div className="border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={() => setShowFileAdjust(!showFileAdjust)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-purple-700"
          >
            <ArrowUpTrayIcon className="h-3.5 w-3.5" />
            {showFileAdjust
              ? "Ocultar opción de subir archivo de SUNAT"
              : "¿Deseas ajustar directamente el archivo CSV/Excel descargado de SUNAT?"}
          </button>

          {showFileAdjust ? (
            <div className="mt-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-xs">
              <p className="text-gray-600 mb-2">
                Si descargaste el reporte preliminar desde SUNAT SIRE, súbelo aquí para que el sistema le ponga S/ 0.00 a las boletas anuladas respetando exactamente tus filas de SUNAT:
              </p>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setAdjustFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-purple-100 file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-purple-800 hover:file:bg-purple-200"
              />
              {adjustFile ? (
                <button
                  type="button"
                  onClick={handleAdjustSunatFile}
                  disabled={adjusting}
                  className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-purple-700 px-3 py-1.5 font-bold text-white hover:bg-purple-800 disabled:opacity-50"
                >
                  {adjusting ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <DocumentArrowDownIcon className="h-3.5 w-3.5" />}
                  Convertir y descargar ZIP ajustado
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Instrucciones para la contadora */}
        <div className="mt-4 rounded-xl bg-gray-50 p-3.5 text-xs text-gray-600">
          <div className="flex items-start gap-2">
            <InformationCircleIcon className="h-4 w-4 shrink-0 text-purple-700 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-gray-800">¿Cómo subir este archivo en SUNAT SIRE?</p>
              <ol className="list-decimal pl-4 space-y-0.5 text-[11px] text-gray-600">
                <li>En SUNAT SOL entra a <strong>SIRE &gt; Ventas (RVIE)</strong> y selecciona el mes.</li>
                <li>Ve a <strong>Propuesta de RVIE</strong> y haz clic en la pestaña <strong>«Reemplazar Propuesta»</strong>.</li>
                <li>Selecciona y sube el archivo <strong>.zip</strong> descargado. ¡Listo! El SIRE quedará cuadrado al instante.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
