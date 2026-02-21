"use client";

import { useState, useRef } from "react";
import { Transfer, Invoice, Reservation, PaymentMethod } from "@/lib/types";

interface PaymentSidebarProps {
  reservation: Reservation;
  transfers: Transfer[];
  invoices: Invoice[];
  loading: boolean;
  emittingInvoiceId: string | null;
  paymentLoading: boolean;
  onVerifyTransfer: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (transfer: Transfer) => void;
  onRevokeManualPayment: (transferId: string) => void;
  onRegisterPayment: (amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  onClose: () => void;
}

function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        aria-label="Cerrar imagen"
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Comprobante"
        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function formatTransferDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "numeric", year: "numeric" });
}

function formatTransferTime(dateStr: string) {
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const isPm = h >= 12;
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${isPm ? "pm" : "am"}`;
}

function RegisterPaymentForm({
  remaining,
  loading,
  onSubmit,
}: {
  remaining: number;
  loading: boolean;
  onSubmit: (amount: number, method: PaymentMethod, mediaUrl?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedAmount = parseFloat(amount);
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining + 0.01;
  const busy = loading || uploading;

  function clearFile() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  async function handleConfirm() {
    if (!isValid || busy) return;

    let mediaUrl: string | undefined;
    if (method === "digital" && file) {
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        mediaUrl = data.url;
      } catch {
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    onSubmit(parsedAmount, method, mediaUrl);
    setOpen(false);
    setAmount(remaining.toFixed(2));
    setMethod("efectivo");
    clearFile();
  }

  if (remaining <= 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setAmount(remaining.toFixed(2)); }}
        className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Registrar cobro
      </button>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-blue-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-gray-900">Registrar cobro</h4>
        <button onClick={() => { setOpen(false); clearFile(); }} className="text-gray-400 hover:text-gray-600 p-1">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Método */}
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">Método de pago</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setMethod("efectivo"); clearFile(); }}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${
              method === "efectivo"
                ? "border-green-500 bg-green-50 text-green-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            Efectivo
          </button>
          <button
            type="button"
            onClick={() => setMethod("digital")}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${
              method === "digital"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            Digital
          </button>
        </div>
      </div>

      {/* Upload foto (solo digital) */}
      {method === "digital" && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-2">
            Comprobante <span className="text-gray-400">(opcional)</span>
          </label>
          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Preview" className="w-full max-h-48 object-contain bg-gray-50" />
              <button
                type="button"
                onClick={clearFile}
                className="absolute top-2 right-2 bg-white/90 rounded-full p-1.5 shadow hover:bg-red-50 transition-colors"
              >
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Adjuntar foto
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Monto */}
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">Monto a cobrar (S/)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={remaining}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-4 py-3 text-lg font-bold rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none bg-gray-50"
        />
      </div>

      {/* Acciones */}
      <div className="flex gap-3">
        <button
          onClick={() => { setOpen(false); clearFile(); }}
          disabled={busy}
          className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={!isValid || busy}
          className="flex-1 py-3 px-4 font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
        >
          {uploading ? "Subiendo..." : loading ? "Procesando..." : "Cobrar"}
        </button>
      </div>
    </div>
  );
}

function TransferCard({
  transfer,
  invoice,
  emittingInvoiceId,
  onVerify,
  onEmitInvoice,
  onRevoke,
  onViewImage,
}: {
  transfer: Transfer;
  invoice: Invoice | undefined;
  emittingInvoiceId: string | null;
  onVerify: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (transfer: Transfer) => void;
  onRevoke: (transferId: string) => void;
  onViewImage: (url: string) => void;
}) {
  const isValidated = transfer.verified || transfer.source === "manual";

  return (
    <div className={`rounded-2xl border-2 transition-all ${transfer.verified ? "border-green-400 bg-green-50/30" : "border-gray-200 bg-white"}`}>
      {/* Header con columnas */}
      <div className={`grid grid-cols-2 border-b-2 rounded-t-2xl ${transfer.verified ? "border-green-400 bg-green-50/50" : "border-gray-200 bg-gray-50/50"}`}>
        <div className="px-5 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Pago</div>
        <div className={`px-5 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider border-l-2 ${transfer.verified ? "border-green-400" : "border-gray-200"}`}>Boleta asociada</div>
      </div>

      <div className="grid grid-cols-2">
        {/* COLUMNA IZQUIERDA: PAGO */}
        <div className="p-5 space-y-4">
          {/* Voucher */}
          <div className="w-full">
            {transfer.media_url ? (
              <div
                className="relative group cursor-pointer overflow-hidden rounded-xl border border-gray-200 aspect-[4/3] bg-gray-100"
                onClick={() => onViewImage(transfer.media_url!)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={transfer.media_url}
                  alt="Voucher"
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                  <span className="text-sm font-bold text-white bg-black/60 px-4 py-2 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    Ver imagen
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-6 text-center aspect-[4/3]">
                {transfer.source === "manual" ? (
                  <>
                    <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-400">Pago en Caja</span>
                    <span className="text-xs text-gray-300 mt-1">Sin voucher digital</span>
                  </>
                ) : (
                  <>
                    <svg className="w-10 h-10 text-amber-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-400">Sin imagen</span>
                    <span className="text-xs text-gray-300 mt-1">No adjuntó captura</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-1.5">
            <p className="text-2xl font-bold text-gray-900">S/ {transfer.amount?.toFixed(2)}</p>
            <p className="text-base text-gray-600">{formatTransferDate(transfer.created_at)}</p>
            <p className="text-base text-gray-600">{formatTransferTime(transfer.created_at)}</p>
            <p className="text-base text-gray-600">
              {transfer.source === "manual" ? "Pagado: en caja" : "Pagado: vía digital"}
            </p>
            <p className={`text-base font-semibold ${transfer.verified ? "text-green-600" : "text-amber-600"}`}>
              {transfer.verified ? "Validado" : transfer.source === "manual" ? "Cobro manual" : "Pendiente validación"}
            </p>
          </div>

          {/* Action */}
          <div>
            {transfer.source !== "manual" ? (
              <button
                onClick={() => onVerify(transfer.id, !!transfer.verified)}
                className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                  transfer.verified
                    ? "bg-white border-2 border-gray-200 text-gray-600 hover:border-red-200 hover:text-red-500"
                    : "bg-green-600 text-white hover:bg-green-700 shadow-sm"
                }`}
              >
                {transfer.verified ? (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    Deshacer
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    Validar Pago
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => onRevoke(transfer.id)}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 bg-white border-2 border-red-100 text-red-600 hover:bg-red-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Eliminar pago
              </button>
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA: BOLETA */}
        <div className={`p-5 border-l-2 flex flex-col justify-center ${transfer.verified ? "border-green-400" : "border-gray-200"}`}>
          {!isValidated ? (
            <div className="text-center py-8">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="text-sm font-semibold text-gray-400">Valida el pago primero</p>
              <p className="text-xs text-gray-300 mt-1">para poder emitir una boleta</p>
            </div>
          ) : invoice ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <div>
                  <p className="font-bold text-gray-900">Boleta de Venta</p>
                  <p className="text-sm text-gray-500">Emitida el {new Date(invoice.created_at).toLocaleDateString("es-PE")}</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900">S/ {invoice.amount.toFixed(2)}</p>
              <button
                onClick={() => window.open(invoice.file_url, "_blank")}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-blue-50 border-2 border-blue-100 text-blue-700 hover:bg-blue-100 flex items-center justify-center gap-2 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Descargar PDF
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-4">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <p className="text-sm font-semibold text-gray-400">Sin boleta emitida</p>
              </div>
              <button
                onClick={() => onEmitInvoice(transfer)}
                disabled={emittingInvoiceId === transfer.id}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gray-900 text-white hover:bg-gray-800 flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
              >
                {emittingInvoiceId === transfer.id ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Emitiendo...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    Emitir Boleta
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border-2 border-gray-200 bg-white animate-pulse">
      <div className="grid grid-cols-2 border-b-2 border-gray-200 bg-gray-50/50 rounded-t-2xl">
        <div className="px-5 py-2.5"><div className="h-3 w-12 bg-gray-200 rounded" /></div>
        <div className="px-5 py-2.5 border-l-2 border-gray-200"><div className="h-3 w-24 bg-gray-200 rounded" /></div>
      </div>
      <div className="grid grid-cols-2">
        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-gray-200 aspect-[4/3]" />
          <div className="space-y-2">
            <div className="h-7 w-28 bg-gray-200 rounded" />
            <div className="h-5 w-24 bg-gray-200 rounded" />
            <div className="h-5 w-20 bg-gray-200 rounded" />
          </div>
          <div className="h-11 w-full bg-gray-200 rounded-xl" />
        </div>
        <div className="p-5 border-l-2 border-gray-200 flex items-center justify-center">
          <div className="h-11 w-32 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function formatHour12(hourStr: string) {
  const h = parseInt(hourStr.split(":")[0]);
  const isPm = h >= 12;
  const hour12 = h % 12 || 12;
  return `${hour12}:00 ${isPm ? "pm" : "am"}`;
}

function formatReservationTime(reservation: Reservation) {
  if (!reservation.time_slots?.length) return "—";
  const start = reservation.time_slots[0];
  const lastHour = parseInt(reservation.time_slots[reservation.time_slots.length - 1].split(":")[0]) + 1;
  return `${formatHour12(start)} – ${formatHour12(`${lastHour}:00`)}`;
}

export default function PaymentSidebar({
  reservation,
  transfers,
  invoices,
  loading,
  emittingInvoiceId,
  paymentLoading,
  onVerifyTransfer,
  onEmitInvoice,
  onRevokeManualPayment,
  onRegisterPayment,
  onClose,
}: PaymentSidebarProps) {
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  const totalPrice = reservation.total_price || 0;
  const amountPaid = reservation.amount_paid || 0;
  const remaining = Math.max(0, totalPrice - amountPaid);
  const fullyPaid = remaining <= 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sidebar */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
          <h3 className="text-xl font-bold text-gray-900">Pagos y Boletas</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="Cerrar sidebar"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Reservation Info */}
        <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-lg font-bold text-gray-900">
                {reservation.representative_name || "Sin nombre"}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                <span className="font-semibold text-gray-700">
                  {reservation.field ? `Cancha ${reservation.field}` : "Sin cancha"}
                </span>
                <span>{formatReservationTime(reservation)}</span>
                <span>
                  {new Date(reservation.date + "T12:00:00").toLocaleDateString("es-PE", {
                    weekday: "short", day: "numeric", month: "short",
                  })}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className={`inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ${
                fullyPaid
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}>
                {fullyPaid ? "Pagado" : "Pendiente"}
              </span>
            </div>
          </div>

          {/* Resumen financiero */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
              <p className="text-xs font-medium text-gray-400 uppercase">Total</p>
              <p className="text-lg font-bold text-gray-900">S/ {totalPrice.toFixed(2)}</p>
            </div>
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-center">
              <p className="text-xs font-medium text-blue-400 uppercase">Pagado</p>
              <p className="text-lg font-bold text-blue-700">S/ {amountPaid.toFixed(2)}</p>
            </div>
            <div className={`rounded-xl px-4 py-3 text-center ${fullyPaid ? "bg-green-50" : "bg-red-50"}`}>
              <p className={`text-xs font-medium uppercase ${fullyPaid ? "text-green-400" : "text-red-400"}`}>Deuda</p>
              <p className={`text-lg font-bold ${fullyPaid ? "text-green-700" : "text-red-600"}`}>S/ {remaining.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-gray-50">
          {/* Registrar cobro */}
          <RegisterPaymentForm
            remaining={remaining}
            loading={paymentLoading}
            onSubmit={onRegisterPayment}
          />

          {loading && transfers.length === 0 ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : transfers.length > 0 ? (
            transfers.map((transfer) => {
              const invoice = invoices.find((inv) => inv.transfer_id === transfer.id);
              return (
                <TransferCard
                  key={transfer.id}
                  transfer={transfer}
                  invoice={invoice}
                  emittingInvoiceId={emittingInvoiceId}
                  onVerify={onVerifyTransfer}
                  onEmitInvoice={onEmitInvoice}
                  onRevoke={onRevokeManualPayment}
                  onViewImage={setViewingImage}
                />
              );
            })
          ) : (
            <div className="p-12 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-white">
              <p className="text-gray-500 font-medium text-lg">No hay pagos registrados</p>
              <p className="text-sm text-gray-400 mt-1">El cliente aún no ha enviado comprobantes.</p>
            </div>
          )}
        </div>
      </div>

      {/* Image Viewer Popup */}
      {viewingImage && <ImageViewer src={viewingImage} onClose={() => setViewingImage(null)} />}
    </>
  );
}
