"use client";

import { useState, useEffect, memo } from "react";
import type { Transfer } from "@/lib/types";

/** Limpia el valor inicial del cliente: quita números y la palabra "Voley". */
function cleanClienteInitial(value: string): string {
  return value
    .replace(/\d+/g, "")
    .replace(/\bVoley\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

type EmitInvoiceModalProps = {
  transfer: Transfer;
  clientDni?: string | null;
  clientRuc?: string | null;
  initialDescripcion?: string;
  initialCliente?: string;
  onClose: () => void;
  onEmitInvoice: (
    t: Transfer,
    p: {
      tipo_comprobante: "boleta" | "factura";
      doc_num: string;
      cliente_denominacion?: string;
      descripcion?: string;
      amount?: number;
    }
  ) => void;
  emitting?: boolean;
  attaching?: boolean;
};

export const EmitInvoiceModal = memo(function EmitInvoiceModal({
  transfer,
  clientDni,
  clientRuc,
  initialDescripcion = "",
  initialCliente = "",
  onClose,
  onEmitInvoice,
  emitting = false,
  attaching = false,
}: EmitInvoiceModalProps) {
  const [docType, setDocType] = useState<"boleta" | "factura">("boleta");
  const [docNumber, setDocNumber] = useState("");
  const [clienteEdit, setClienteEdit] = useState(() => cleanClienteInitial(initialCliente));
  const [descripcionEdit, setDescripcionEdit] = useState(initialDescripcion);
  const [serieNum, setSerieNum] = useState<{ serie: string; next_correlativo: number } | null>(null);
  const [fetchingSerie, setFetchingSerie] = useState(false);
  const [amountEdit, setAmountEdit] = useState(String(transfer.amount ?? 0));

  useEffect(() => {
    setDocNumber(docType === "boleta" ? (clientDni || "") : (clientRuc || ""));
  }, [docType, clientDni, clientRuc]);

  useEffect(() => {
    setClienteEdit(cleanClienteInitial(initialCliente));
    setDescripcionEdit(initialDescripcion);
  }, [initialCliente, initialDescripcion]);

  const docValid = docType === "factura" ? docNumber.replace(/\D/g, "").length === 11 : docNumber.replace(/\D/g, "").length === 8;
  const parsedAmount = parseFloat(amountEdit.replace(",", "."));
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;

  useEffect(() => {
    let cancelled = false;
    setFetchingSerie(true);
    fetch(`/api/invoices?next_correlativo=1&tipo=${docType}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.serie != null && data?.next_correlativo != null) {
          setSerieNum({ serie: String(data.serie), next_correlativo: Number(data.next_correlativo) });
        }
      })
      .catch(() => { if (!cancelled) setSerieNum(null); })
      .finally(() => { if (!cancelled) setFetchingSerie(false); });
    return () => { cancelled = true; };
  }, [docType]);

  function handleEmit() {
    if (!docValid || !amountValid) return;
    onEmitInvoice(transfer, {
      tipo_comprobante: docType,
      doc_num: docNumber.replace(/\D/g, ""),
      cliente_denominacion: clienteEdit.trim() || undefined,
      descripcion: descripcionEdit.trim() || undefined,
      amount: parsedAmount,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/55" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h4 className="text-xl font-bold text-gray-900">Vista previa — Emitir comprobante</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b-2 border-gray-200">
          <button
            type="button"
            onClick={() => { setDocType("boleta"); setDocNumber(clientDni || ""); }}
            className={`px-4 py-2 font-semibold border-b-2 -mb-0.5 transition-colors ${docType === "boleta" ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            Boleta (DNI)
          </button>
          <button
            type="button"
            onClick={() => { setDocType("factura"); setDocNumber(clientRuc || ""); }}
            className={`px-4 py-2 font-semibold border-b-2 -mb-0.5 transition-colors ${docType === "factura" ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            Factura (RUC)
          </button>
        </div>

        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-5 space-y-4">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Datos que usará SUNAT</p>
          <div className="space-y-3 text-sm">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
              <span className="text-gray-600 shrink-0">Serie / Número</span>
              <span className="font-mono font-bold text-gray-900 text-base">
                {fetchingSerie ? "Cargando..." : serieNum ? `${serieNum.serie}-${String(serieNum.next_correlativo).padStart(5, "0")}` : (docValid ? "—" : "Ingresa DNI/RUC válido")}
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-600 shrink-0">Tipo:</span>
              <span className="font-semibold">{docType === "boleta" ? "Boleta" : "Factura"}</span>
            </div>
            <div>
              <label className="block text-gray-600 text-xs font-medium mb-1">Doc. cliente</label>
              <input
                type="text"
                value={docNumber}
                onChange={(e) => {
                  const onlyDigits = e.target.value.replace(/\D/g, "");
                  setDocNumber(docType === "factura" ? onlyDigits.slice(0, 11) : onlyDigits.slice(0, 8));
                }}
                placeholder={docType === "factura" ? "RUC 11 dígitos" : "DNI 8 dígitos"}
                className="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-600 text-xs font-medium mb-1">Cliente</label>
              <input
                type="text"
                value={clienteEdit}
                onChange={(e) => setClienteEdit(e.target.value)}
                placeholder="CLIENTE GENERAL si vacío"
                className="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 font-medium focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-600 text-xs font-medium mb-1">Descripción</label>
              <input
                type="text"
                value={descripcionEdit}
                onChange={(e) => setDescripcionEdit(e.target.value)}
                placeholder="Ej: Alquiler cancha 6 vs 6 - 06/02/2025 10am-12pm"
                className="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 font-medium focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-600 text-xs font-medium mb-1">Monto total (IGV incl.)</label>
              <input
                type="text"
                inputMode="decimal"
                value={amountEdit}
                onChange={(e) => setAmountEdit(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0.00"
                className="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 font-mono font-bold text-lg focus:border-blue-500 focus:outline-none"
              />
              {!amountValid && amountEdit !== "" && (
                <p className="text-xs text-red-600 mt-1">Ingresa un monto mayor a 0</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEmit}
            disabled={attaching || emitting || !docValid || !amountValid}
            className="flex-1 py-3 px-4 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60"
          >
            {emitting ? "Emitiendo..." : "Confirmar y emitir"}
          </button>
        </div>
      </div>
    </div>
  );
});
