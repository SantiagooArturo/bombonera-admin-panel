"use client";

import { useState, useRef } from "react";
import type { Reservation, PaymentMethod } from "@/lib/types";
import { COURT_TYPE_TO_SIZE } from "@/lib/types";

interface PaymentModalProps {
  reservation: Reservation;
  onConfirm: (amount: number, paymentMethod: PaymentMethod, mediaUrl?: string) => void;
  onCancel: () => void;
  loading: boolean;
}

export default function PaymentModal({ reservation, onConfirm, onCancel, loading }: PaymentModalProps) {
  const remaining = (reservation.total_price || 0) - (reservation.amount_paid || 0);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedAmount = parseFloat(amount);
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining + 0.01;
  const busy = loading || uploading;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  function clearFile() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

    onConfirm(parsedAmount, method, mediaUrl);
  }

  const sizeLabel = COURT_TYPE_TO_SIZE[reservation.court_type] ?? reservation.court_type;
  const courtLabel = reservation.field ? `Cancha ${reservation.field} · ${sizeLabel}` : sizeLabel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-1">Cobrar pago</h3>
        <p className="text-base text-gray-500 mb-6">
          {reservation.representative_name || "Sin nombre"} — {courtLabel}
        </p>

        {/* Resumen */}
        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-base">
            <span className="text-gray-500">Total</span>
            <span className="font-bold">S/ {(reservation.total_price || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base">
            <span className="text-gray-500">Ya pagado</span>
            <span className="font-semibold text-blue-700">S/ {(reservation.amount_paid || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base border-t pt-3">
            <span className="font-semibold">Restante</span>
            <span className="font-bold text-red-600">S/ {remaining.toFixed(2)}</span>
          </div>
        </div>

        {/* Método de pago */}
        <label className="block text-sm font-medium text-gray-700 mb-2">Método de pago</label>
        <div className="flex gap-3 mb-5">
          <button
            type="button"
            onClick={() => { setMethod("efectivo"); clearFile(); }}
            className={`flex-1 py-3 rounded-xl font-semibold text-base border-2 transition-all ${
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
            className={`flex-1 py-3 rounded-xl font-semibold text-base border-2 transition-all ${
              method === "digital"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            Digital
          </button>
        </div>

        {/* Upload foto (solo digital) */}
        {method === "digital" && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
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
        <label className="block text-sm font-medium text-gray-700 mb-2">Monto a cobrar (S/)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={remaining}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-5 py-4 text-lg font-bold rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none bg-gray-50 mb-6"
        />

        {/* Acciones */}
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-6 py-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || busy}
            className="flex-1 px-6 py-4 font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {uploading ? "Subiendo..." : loading ? "Procesando..." : "Cobrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
