"use client";

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { compressImageForUpload } from "@/lib/compress-image";
import type { Reservation, PaymentMethod } from "@/lib/types";

function ViewportPaymentModal({
  children,
  onBackdropClick,
}: {
  children: ReactNode;
  onBackdropClick: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-md sm:py-12"
      role="dialog"
      aria-modal="true"
      onClick={onBackdropClick}
    >
      <div className="relative my-auto w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function RegisterPaymentFormCobros({
  reservationsForPayment,
  totalRemaining,
  loading,
  reservationsLoading = false,
  allowWithoutReservation = true,
  onSubmit,
  open: openControlled,
  onOpenChange,
  hideButton = false,
  buttonLabel = "Anotar pago recibido",
  buttonSubtext = "",
  presentation = "inline",
  clientSummaryLine,
  amountHelperText,
  /** En drawer de cobros con reserva ya elegida: no pedir confirmar cliente; ir directo a método y monto. */
  assumeClientFromContext = false,
}: {
  /** Reservas donde se puede registrar un cobro (incluye saldo en cero si aplica). */
  reservationsForPayment: Reservation[];
  totalRemaining: number;
  loading: boolean;
  /** Mientras es true y aún no hay reservas en memoria, el botón se muestra deshabilitado (evita parpadeo). */
  reservationsLoading?: boolean;
  /** Si no hay reservas activas, igual se puede registrar el cobro vinculado solo al cliente (reservationId null). */
  allowWithoutReservation?: boolean;
  onSubmit: (reservationId: string | null, amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideButton?: boolean;
  buttonLabel?: string;
  buttonSubtext?: string | null;
  /** `viewportModal`: overlay a pantalla completa (portal a `document.body`, blur + oscurecido). */
  presentation?: "inline" | "viewportModal";
  /** Si viene definido, sustituye el subtítulo genérico (p. ej. cliente ya fijado por la reserva). */
  clientSummaryLine?: string;
  /** Texto bajo el input de monto (por defecto: saldo total del cliente). */
  amountHelperText?: string;
  assumeClientFromContext?: boolean;
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
  /** 1 = confirmar cliente; 2 = método, monto y registro. */
  const [flowStep, setFlowStep] = useState<1 | 2>(assumeClientFromContext ? 2 : 1);
  const [amount, setAmount] = useState((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFlowStep(assumeClientFromContext ? 2 : 1);
      setAmount((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
    }
  }, [open, totalRemaining, assumeClientFromContext]);

  const derivedClientLine = useMemo(() => {
    if (reservationsForPayment.length === 0) {
      return allowWithoutReservation
        ? "Pago asociado al cliente de esta vista (sin reserva concreta en la lista)."
        : "";
    }
    const r = defaultTarget;
    if (!r) return "";
    const nm = (r.representative_name || "").trim() || "Reserva";
    const ph = (r.phone_number || "").trim();
    const fieldBit = r.field != null ? `Cancha ${r.field}` : "";
    const dateBit = (r.date || "").trim();
    return [nm, ph, fieldBit, dateBit].filter(Boolean).join(" · ");
  }, [reservationsForPayment, defaultTarget, allowWithoutReservation]);

  const clienteDisplayLine = (clientSummaryLine?.trim() || derivedClientLine).trim();

  const parsedAmount = parseFloat(amount);
  const canSubmit =
    !reservationsLoading &&
    (reservationsForPayment.length > 0 || allowWithoutReservation);
  const hasTargetReservation = reservationsForPayment.length > 0 && !!targetId;
  const orphanOk =
    allowWithoutReservation && reservationsForPayment.length === 0 && !reservationsLoading;
  const isValid =
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    canSubmit &&
    (hasTargetReservation || orphanOk);
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
    const reservationId: string | null =
      reservationsForPayment.length > 0 ? targetId || null : null;
    if (reservationsForPayment.length > 0 && !reservationId) return;

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

    onSubmit(reservationId, parsedAmount, method, mediaUrl);
    setOpen(false);
    setFlowStep(assumeClientFromContext ? 2 : 1);
    setAmount((totalRemaining > 0 ? totalRemaining : 1).toFixed(2));
    setMethod("efectivo");
    clearFile();
  }

  if (!open) {
    if (hideButton) return null;
    const blocked = !canSubmit;
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
        {buttonSubtext != null && <p className="text-xs text-gray-500 text-center">{buttonSubtext}</p>}
      </div>
    );
  }

  const closePanel = () => {
    setOpen(false);
    setFlowStep(1);
    clearFile();
  };

  const step1CanContinue =
    !reservationsLoading && (reservationsForPayment.length > 0 || allowWithoutReservation);

  if (!canSubmit) {
    const inner = (
      <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-600">
        Cargando reservas…
        <button
          type="button"
          onClick={closePanel}
          className="mt-3 w-full py-2 text-sm font-semibold text-blue-600 hover:underline"
        >
          Cerrar
        </button>
      </div>
    );
    return presentation === "viewportModal" ? (
      <ViewportPaymentModal onBackdropClick={closePanel}>{inner}</ViewportPaymentModal>
    ) : (
      inner
    );
  }

  const selectMethodClass =
    "w-full px-4 py-3 text-sm font-semibold rounded-xl border-2 border-gray-200 bg-white text-gray-900 focus:border-blue-500 focus:outline-none";

  const formCard = (
    <div className="rounded-2xl border-2 border-blue-200 bg-white p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-bold text-gray-900">{buttonLabel}</h4>
          {assumeClientFromContext || flowStep === 2 ? (
            <p className="mt-0.5 text-xs font-medium text-gray-500">Monto y forma de pago</p>
          ) : null}
        </div>
        <button type="button" onClick={closePanel} className="text-gray-400 hover:text-gray-600 p-1 shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!assumeClientFromContext && flowStep === 1 ? (
        <>
          <div>
            <p className="mb-2 block text-sm font-medium text-gray-600">Cliente</p>
            <div className="rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-base font-bold leading-snug text-gray-900 break-words">
                {clienteDisplayLine || "—"}
              </p>
              {!clientSummaryLine && reservationsForPayment.length > 0 ? (
                <p className="mt-2 text-xs text-gray-500">Se aplicará el cobro al saldo de esta reserva.</p>
              ) : null}
              {!clientSummaryLine && reservationsForPayment.length === 0 && allowWithoutReservation ? (
                <p className="mt-2 text-xs text-gray-500">Queda registrado al cliente (sin reserva concreta).</p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={closePanel}
              className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => step1CanContinue && setFlowStep(2)}
              disabled={!step1CanContinue}
              className="flex-1 py-3 px-4 font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
            >
              Continuar
            </button>
          </div>
        </>
      ) : (
        <>
          {assumeClientFromContext && clienteDisplayLine ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Cliente</p>
              <p className="mt-0.5 text-sm font-semibold leading-snug text-gray-900 break-words">
                {clienteDisplayLine}
              </p>
            </div>
          ) : null}
          <div>
            <label htmlFor="reg-cobros-metodo" className="block text-sm font-medium text-gray-600 mb-2">
              Método de pago
            </label>
            <select
              id="reg-cobros-metodo"
              value={method}
              onChange={(e) => {
                const m = e.target.value as PaymentMethod;
                setMethod(m);
                if (m === "efectivo") clearFile();
              }}
              className={selectMethodClass}
            >
              <option value="efectivo">Efectivo</option>
              <option value="digital">Digital (Yape, Plin, transferencia…)</option>
            </select>
            <p className="mt-1.5 text-xs text-gray-500">
              En efectivo no se pide foto de comprobante; en digital puedes adjuntarla si quieres.
            </p>
          </div>

          {method === "digital" ? (
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
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
          ) : null}

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
            <p className="text-xs text-gray-400 mt-1">
              {amountHelperText ?? `Saldo total del cliente: S/ ${totalRemaining.toFixed(2)}`}
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            {assumeClientFromContext ? (
              <button
                type="button"
                onClick={closePanel}
                disabled={busy}
                className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 text-sm"
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setFlowStep(1)}
                disabled={busy}
                className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 text-sm"
              >
                Atrás
              </button>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isValid || busy}
              className="flex-1 py-3 px-4 font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
            >
              {uploading ? "Subiendo..." : loading ? "Procesando..." : "Registrar"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return presentation === "viewportModal" ? (
    <ViewportPaymentModal onBackdropClick={closePanel}>{formCard}</ViewportPaymentModal>
  ) : (
    formCard
  );
}
