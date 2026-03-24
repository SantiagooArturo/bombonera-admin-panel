"use client";

import { useState, useEffect, memo } from "react";
import type { EmitComprobanteParams, Transfer } from "@/lib/types";
import { BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES } from "@/features/boletas/constants/sunat";
import { getLimaNowTimeHm, getLimaTodayYmd } from "@/features/boletas/utils/limaEmissionDatetime";

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
  onEmitInvoice: (t: Transfer, p: EmitComprobanteParams) => void;
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
  const [fechaEmision, setFechaEmision] = useState(getLimaTodayYmd);
  const [horaEmision, setHoraEmision] = useState(getLimaNowTimeHm);

  useEffect(() => {
    setDocNumber(docType === "boleta" ? (clientDni || "") : (clientRuc || ""));
  }, [docType, clientDni, clientRuc]);

  useEffect(() => {
    setClienteEdit(cleanClienteInitial(initialCliente));
    setDescripcionEdit(initialDescripcion);
  }, [initialCliente, initialDescripcion]);

  const parsedAmount = parseFloat(amountEdit.replace(",", "."));
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const digitsDoc = docNumber.replace(/\D/g, "");

  const docValidFactura = digitsDoc.length === 11;
  const boletaSinDocOk =
    docType === "boleta" && digitsDoc.length === 0 && amountValid && parsedAmount <= BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES;
  const boletaConDniOk = docType === "boleta" && digitsDoc.length === 8;
  const docValidBoleta = boletaSinDocOk || boletaConDniOk;
  const docValid = docType === "factura" ? docValidFactura : docValidBoleta;

  /** DNI a medias (evitar emitir con 3 dígitos) */
  const boletaDocIncomplete =
    docType === "boleta" && digitsDoc.length > 0 && digitsDoc.length < 8;

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
      .catch(() => {
        if (!cancelled) setSerieNum(null);
      })
      .finally(() => {
        if (!cancelled) setFetchingSerie(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docType]);

  function handleEmit() {
    if (!docValid || !amountValid || boletaDocIncomplete) return;
    onEmitInvoice(transfer, {
      tipo_comprobante: docType,
      doc_num: digitsDoc,
      cliente_denominacion: clienteEdit.trim() || undefined,
      descripcion: descripcionEdit.trim() || undefined,
      amount: parsedAmount,
      fecha_de_emision: fechaEmision.trim() || undefined,
      hora_de_emision: horaEmision.trim() || undefined,
    });
    onClose();
  }

  const fechaHoraValida = Boolean(fechaEmision.trim()) && Boolean(horaEmision.trim());

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[min(42rem,calc(100vw-2rem))] max-h-[min(90vh,calc(100vh-2rem))] shrink-0 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h4 className="text-xl font-bold text-gray-900">Emitir comprobante SUNAT</h4>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="rounded-xl border-2 border-blue-100 bg-blue-50/80 p-4 space-y-3">
          <p className="text-sm font-bold text-gray-900">¿Cuándo sale en el comprobante?</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            Por defecto es <strong>hoy</strong> y la <strong>hora actual en Lima</strong>. Si el papel lo emiten otro día,
            cambie solo la fecha o la hora aquí (no puede ser futuro).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="emit-fecha" className="block text-sm font-bold text-gray-800 mb-1">
                Fecha de emisión
              </label>
              <input
                id="emit-fecha"
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-base font-semibold text-gray-900"
              />
            </div>
            <div>
              <label htmlFor="emit-hora" className="block text-sm font-bold text-gray-800 mb-1">
                Hora (Lima, 24 h)
              </label>
              <input
                id="emit-hora"
                type="time"
                value={horaEmision}
                onChange={(e) => setHoraEmision(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-base font-semibold text-gray-900"
              />
            </div>
          </div>
        </div>

        <div className="flex border-b-2 border-gray-200">
          <button
            type="button"
            onClick={() => {
              setDocType("boleta");
              setDocNumber(clientDni || "");
            }}
            className={`flex-1 px-3 py-3 text-base font-bold border-b-2 -mb-0.5 transition-colors ${docType === "boleta" ? "border-blue-500 text-blue-600 bg-blue-50/50" : "border-transparent text-gray-500"}`}
          >
            Boleta
          </button>
          <button
            type="button"
            onClick={() => {
              setDocType("factura");
              setDocNumber(clientRuc || "");
            }}
            className={`flex-1 px-3 py-3 text-base font-bold border-b-2 -mb-0.5 transition-colors ${docType === "factura" ? "border-blue-500 text-blue-600 bg-blue-50/50" : "border-transparent text-gray-500"}`}
          >
            Factura (RUC)
          </button>
        </div>

        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-5 space-y-4">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Datos para SUNAT</p>
          <div className="space-y-3 text-sm">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
              <span className="text-gray-600 shrink-0 text-base">Serie / Número</span>
              <span className="font-mono font-bold text-gray-900 text-lg">
                {fetchingSerie ? "Cargando…" : serieNum ? `${serieNum.serie}-${String(serieNum.next_correlativo).padStart(5, "0")}` : "—"}
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-600 shrink-0">Tipo</span>
              <span className="font-semibold text-base">{docType === "boleta" ? "Boleta" : "Factura"}</span>
            </div>
            <div>
              <label className="block text-gray-800 text-sm font-bold mb-1">
                {docType === "factura" ? "RUC (11 dígitos)" : "DNI (opcional)"}
              </label>
              {docType === "boleta" ? (
                <p className="text-xs text-gray-600 mb-2 leading-relaxed">
                  Puede dejarlo <strong>vacío</strong> si el total es como máximo S/{" "}
                  {BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}. Si es más alto, debe poner los 8 dígitos del DNI o usar
                  factura.
                </p>
              ) : null}
              <input
                type="text"
                inputMode="numeric"
                value={docNumber}
                onChange={(e) => {
                  const onlyDigits = e.target.value.replace(/\D/g, "");
                  setDocNumber(docType === "factura" ? onlyDigits.slice(0, 11) : onlyDigits.slice(0, 8));
                }}
                placeholder={docType === "factura" ? "Ej: 20123456789" : "Vacío o 8 dígitos"}
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-lg font-mono focus:border-blue-500 focus:outline-none"
              />
              {boletaDocIncomplete ? (
                <p className="text-sm text-red-600 mt-1">Complete los 8 dígitos del DNI o borre el campo.</p>
              ) : null}
            </div>
            <div>
              <label className="block text-gray-800 text-sm font-bold mb-1">Nombre en el comprobante</label>
              <input
                type="text"
                value={clienteEdit}
                onChange={(e) => setClienteEdit(e.target.value)}
                placeholder="Se usa si lo escribe"
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-base font-medium focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-800 text-sm font-bold mb-1">Descripción del servicio</label>
              <input
                type="text"
                value={descripcionEdit}
                onChange={(e) => setDescripcionEdit(e.target.value)}
                placeholder="Ej: Alquiler cancha…"
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-base focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-800 text-sm font-bold mb-1">Monto total (IGV incluido)</label>
              <input
                type="text"
                inputMode="decimal"
                value={amountEdit}
                onChange={(e) => setAmountEdit(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0.00"
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-200 bg-white px-3 py-2 font-mono font-bold text-xl focus:border-blue-500 focus:outline-none"
              />
              {!amountValid && amountEdit !== "" ? (
                <p className="text-sm text-red-600 mt-1">Ingrese un monto mayor a 0</p>
              ) : null}
              {docType === "boleta" && amountValid && parsedAmount > BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES && digitsDoc.length === 0 ? (
                <p className="text-sm text-amber-800 mt-1 font-medium">
                  Monto mayor a S/ {BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}: indique DNI o cambie a factura.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border-2 border-gray-300 text-gray-700 font-bold text-base hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEmit}
            disabled={
              attaching ||
              emitting ||
              !docValid ||
              !amountValid ||
              boletaDocIncomplete ||
              !fechaHoraValida
            }
            className="flex-1 py-3 px-4 rounded-xl bg-green-600 text-white font-bold text-base hover:bg-green-700 disabled:opacity-60"
          >
            {emitting ? "Emitiendo…" : "Confirmar y emitir"}
          </button>
        </div>
      </div>
    </div>
  );
});
