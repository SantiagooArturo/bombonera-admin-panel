"use client";

import { useCallback, useRef, useState } from "react";
import { DocumentArrowDownIcon, XMarkIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

type CompareSummary = {
  periodo: string;
  totalSire: number;
  totalPlataforma: number;
  coinciden: number;
  soloSire: number;
  soloPlataforma: number;
  diferencias: number;
  corregidas: number;
  sumSire: number;
  sumPlataforma: number;
  sumDiferencia: number;
};

type CompareRow = {
  codigo: number;
  fecha: string;
  serie: string;
  clienteSire: string;
  clientePlataforma: string;
  valorSire: number | null;
  valorPlataforma: number | null;
  diferencia: number | null;
  estado: string;
};

function formatMonto(n: number | null): string {
  if (n == null) return "\u2014";
  const [intPart, decPart] = n.toFixed(2).split(".");
  const spaced = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F");
  return `S/ ${spaced}.${decPart}`;
}

const ESTADO_COLORS: Record<string, string> = {
  "✅ OK": "bg-emerald-100 text-emerald-800",
  "⚠️ Solo plataforma": "bg-amber-100 text-amber-800",
  "📋 Solo SIRE": "bg-blue-100 text-blue-800",
  "❌ Diferencia": "bg-red-100 text-red-800",
};

function estadoBadge(estado: string) {
  const base = ESTADO_COLORS[estado] || "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${base}`}>
      {estado}
    </span>
  );
}

export function SireCompareModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setRows([]);
    setCurrentFile(file);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/invoices/compare-sire", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error al procesar");

      setSummary(data.summary);
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadExcel = useCallback(async () => {
    if (!currentFile || !summary) return;
    setDownloading(true);
    try {
      const formData = new FormData();
      formData.append("file", currentFile);
      formData.append("download", "1");

      const res = await fetch("/api/invoices/compare-sire", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Error al descargar");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = summary.periodo.toLowerCase().replace(/\s+/g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      a.download = `${slug}-sire-vs-plataforma.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al descargar");
    } finally {
      setDownloading(false);
    }
  }, [currentFile, summary]);

  const reset = useCallback(() => {
    setSummary(null);
    setRows([]);
    setError(null);
    setCurrentFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (loading) return;
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [loading, processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && !loading) processFile(file);
    },
    [loading, processFile]
  );

  if (!open) return null;

  const mismatchedRows = rows.filter((r) => r.estado !== "✅ OK");

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Comparar con SIRE</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-gray-50 py-16">
              <ArrowPathIcon className="mb-4 h-10 w-10 animate-spin text-indigo-500" />
              <p className="text-base font-semibold text-gray-700">Procesando el archivo…</p>
              <p className="mt-1 text-sm text-gray-500">Esto puede tardar unos segundos</p>
            </div>
          )}

          {/* Error without summary */}
          {!loading && !summary && error && (
            <div className="flex flex-col items-center justify-center rounded-xl bg-red-50 py-10">
              <p className="text-base font-semibold text-red-700">Error al procesar</p>
              <p className="mt-1 text-sm text-red-600">{error}</p>
              <button
                onClick={() => { setError(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                Intentar de nuevo
              </button>
            </div>
          )}

          {/* Upload zone — only when no results and not loading */}
          {!loading && !summary && !error && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors ${
                dragging ? "border-indigo-400 bg-indigo-50" : "border-gray-300 bg-gray-50"
              }`}
            >
              <DocumentArrowDownIcon className="mb-3 h-10 w-10 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Arrastrá el Excel del SIRE acá</p>
              <p className="mt-1 text-xs text-gray-500">o</p>
              <label className="mt-2 cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                Seleccionar archivo
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" />
              </label>
            </div>
          )}

          {/* Results */}
          {summary && (
            <>
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{summary.periodo}</h3>
                  <p className="text-sm text-gray-500">
                    {summary.totalSire} boletas en el SIRE, {summary.totalPlataforma} emitidas por la plataforma
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={reset} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                    Probar otro archivo
                  </button>
                  <button
                    onClick={downloadExcel}
                    disabled={downloading}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {downloading ? (
                      <>
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                        Descargando…
                      </>
                    ) : (
                      <>
                        <DocumentArrowDownIcon className="h-4 w-4" />
                        Descargar Excel
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Sums */}
              <div className="mb-5 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-gray-50 p-4 text-center ring-1 ring-gray-200">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Suma SIRE</p>
                  <p className="mt-1 text-xl font-bold tracking-tight text-gray-900">{formatMonto(summary.sumSire)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4 text-center ring-1 ring-gray-200">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Suma Plataforma</p>
                  <p className="mt-1 text-xl font-bold tracking-tight text-gray-900">{formatMonto(summary.sumPlataforma)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4 text-center ring-1 ring-gray-200">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Diferencia</p>
                  <p className={`mt-1 text-xl font-bold tracking-tight ${summary.sumDiferencia === 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {formatMonto(summary.sumDiferencia)}
                  </p>
                </div>
              </div>

              {/* Mini stats — only non-zero */}
              {(summary.soloSire > 0 || summary.soloPlataforma > 0 || summary.diferencias > 0 || summary.corregidas > 0) && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {summary.soloSire > 0 && <MiniStat label="Solo SIRE" value={summary.soloSire} color="blue" />}
                  {summary.soloPlataforma > 0 && <MiniStat label="Solo Plataforma" value={summary.soloPlataforma} color="amber" />}
                  {summary.diferencias > 0 && <MiniStat label="Diferencias" value={summary.diferencias} color="red" />}
                  {summary.corregidas > 0 && <MiniStat label="Columnas corregidas" value={summary.corregidas} color="violet" />}
                </div>
              )}

              {/* Table — only mismatches */}
              {mismatchedRows.length > 0 && (
                <div className="max-h-[40vh] overflow-auto rounded-lg border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Código</th>
                        <th className="px-3 py-2 font-semibold">SIRE</th>
                        <th className="px-3 py-2 font-semibold">Plataforma</th>
                        <th className="px-3 py-2 font-semibold text-right">Valor SIRE</th>
                        <th className="px-3 py-2 font-semibold text-right">Valor Plataforma</th>
                        <th className="px-3 py-2 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {mismatchedRows.map((r) => (
                        <tr key={r.codigo} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 font-mono">B001-{r.codigo}</td>
                          <td className="px-3 py-1.5 max-w-[160px] truncate text-gray-600">{r.clienteSire || "\u2014"}</td>
                          <td className="px-3 py-1.5 max-w-[160px] truncate text-gray-600">{r.clientePlataforma || "\u2014"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.valorSire != null ? formatMonto(r.valorSire) : "\u2014"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.valorPlataforma != null ? formatMonto(r.valorPlataforma) : "\u2014"}</td>
                          <td className="px-3 py-1.5">{estadoBadge(r.estado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {mismatchedRows.length === 0 && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-6 text-center">
                  <p className="text-lg font-bold text-emerald-800">Todas las boletas coinciden</p>
                  <p className="mt-1 text-sm text-emerald-700">Ninguna diferencia entre el SIRE y la plataforma.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  const c: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    violet: "bg-violet-100 text-violet-800",
  };
  return (
    <div className={`rounded-lg px-3 py-1.5 text-center ${c[color] || ""}`}>
      <span className="text-sm font-bold">{value}</span>
      <span className="ml-1 text-xs">{label}</span>
    </div>
  );
}
