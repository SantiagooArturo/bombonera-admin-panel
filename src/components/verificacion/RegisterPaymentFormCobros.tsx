"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { compressImageForUpload } from "@/lib/compress-image";
import type { Reservation, PaymentMethod } from "@/lib/types";

export function RegisterPaymentFormCobros({
  reservationsForPayment,
  totalRemaining,
  loading,
  reservationsLoading = false,
  onSubmit,
  open: openControlled,
  onOpenChange,
  hideButton = false,
  buttonLabel = "Anotar pago recibido",
  buttonSubtext = "",
}: {
  /** Reservas donde se puede registrar un cobro (incluye saldo en cero si aplica). */
  reservationsForPayment: Reservation[];
  totalRemaining: number;
  loading: boolean;
  /** Mientras es true y aún no hay reservas en memoria, el botón se muestra deshabilitado (evita parpadeo). */
  reservationsLoading?: boolean;
  onSubmit: (reservationId: string, amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideButton?: boolean;
  buttonLabel?: string;
  buttonSubtext?: string | null;
}) {
  const defaultTarget = useMemo(
    () =>
      reservationsForPayment.reduce(
        (best: Reservation, r: Reservation) => {
          const debt = Math.max(0, (r.total_price ?? 0) - (r.amount_paid ?? 0));
          const bestDebt = Math.max(0, (best.total_price ?? 0) - (best.amount_paid ?? 0));
          return debt >= bestDebt ? r : best;
        },
        reservationsForPayment[0]
      ),
    [reservationsForPayment]
  );
  const [openInternal, setOpenInternal] = useState(false);
  const open = openControlled ?? openInternal;
  const setOpen = onOpenChange ? (v: boolean) => onOpenChange(v) : setOpenInternal;
  const targetId = defaultTarget?.id ?? "";
  const [amount, setAmount] = useState((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setAmount((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
  }, [open, totalRemaining]);

  const parsedAmount = parseFloat(amount);
  const canPickReservation = reservationsForPayment.length > 0 && !reservationsLoading;
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0 && targetId && canPickReservation;
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
    if (!isValid || busy || !targetId) return;

    let mediaUrl: string | undefined;
    if (method === "digital" && file) {
      setUploading(true);
      try {
        const blob = await compressImageForUpload(file);
        const form = new FormData();
        form.append("file", blob, "image.jpg");
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

    onSubmit(targetId, parsedAmount, method, mediaUrl);
    setOpen(false);
    setAmount((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
    setMethod("efectivo");
    clearFile();
  }

  if (!open) {
    if (hideButton) return null;
    const blocked = !canPickReservation;
    return (
      <div className="space-y-1">
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            if (blocked) return;
            setOpen(true);
            setAmount((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
          }}
          className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
        >
          {reservationsLoading ? (
            <svg className="w-5 h-5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          )}
          {buttonLabel}
        </button>
        {blocked && !reservationsLoading && (
          <p className="text-xs text-amber-700 text-center bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
            No hay reservas activas para vincular este cobro (canceladas o vencidas no aplican). Si solo necesitas un comprobante, usa{" "}
            <span className="font-semibold">Emitir boleta manual</span>.
          </p>
        )}
        {buttonSubtext != null && <p className="text-xs text-gray-500 text-center">{buttonSubtext}</p>}
      </div>
    );
  }

  if (!canPickReservation) {
    return (
      <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-600">
        {reservationsLoading ? "Cargando reservas…" : "No hay reservas disponibles para registrar el cobro."}
        <button
          type="button"
          onClick={() => { setOpen(false); clearFile(); }}
          className="mt-3 w-full py-2 text-sm font-semibold text-blue-600 hover:underline"
        >
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-blue-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-bold text-gray-900">{buttonLabel}</h4>
          <p className="text-xs text-gray-500 mt-0.5">Se aplica al saldo total del cliente</p>
        </div>
        <button onClick={() => { setOpen(false); clearFile(); }} className="text-gray-400 hover:text-gray-600 p-1">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">Método de pago</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setMethod("efectivo"); clearFile(); }}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${method === "efectivo" ? "border-green-500 bg-green-50 text-green-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
          >
            Efectivo
          </button>
          <button
            type="button"
            onClick={() => setMethod("digital")}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${method === "digital" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
          >
            Digital
          </button>
        </div>
      </div>

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
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">Monto (S/)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-4 py-3 text-lg font-bold rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none bg-gray-50"
        />
        <p className="text-xs text-gray-400 mt-1">Saldo total del cliente: S/ {totalRemaining.toFixed(2)}</p>
      </div>

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
          {uploading ? "Subiendo..." : loading ? "Procesando..." : "Registrar"}
        </button>
      </div>
    </div>
  );
}
