"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Transfer, Invoice, Reservation, PaymentMethod, ClientType, CLIENT_TYPE_LABELS } from "@/lib/types";
import { renderPdfToDataUrl } from "@/lib/pdf-preview";
import { calculateReservationPrice } from "@/features/operaciones/utils";

// ─── WhatsApp icon (reutilizado) ─────────────────────────────────────────────

const WSP_ICON_PATH =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

// ─── PDF Preview ────────────────────────────────────────────────────────────

function PdfPreview({ url, onClickImage }: { url: string; onClickImage: (src: string) => void }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    renderPdfToDataUrl(url).then((dataUrl) => {
      if (!cancelled) {
        setImgSrc(dataUrl);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [url]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 aspect-[3/4] bg-gray-100 animate-pulse flex items-center justify-center">
        <svg className="w-8 h-8 text-gray-300 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!imgSrc) {
    return (
      <div
        className="relative group cursor-pointer overflow-hidden rounded-xl border border-gray-200 aspect-[3/4] bg-gray-50 flex flex-col items-center justify-center"
        onClick={() => window.open(url, "_blank")}
      >
        <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
        <span className="text-sm font-semibold text-gray-400">Error al cargar</span>
      </div>
    );
  }

  return (
    <div
      className="relative group cursor-pointer overflow-hidden rounded-xl border border-gray-200 aspect-[3/4] bg-gray-100"
      onClick={() => onClickImage(imgSrc)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imgSrc} alt="Boleta" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
        <span className="text-sm font-bold text-white bg-black/60 px-4 py-2 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">Ver boleta</span>
      </div>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface PaymentSidebarProps {
  reservation: Reservation;
  transfers: Transfer[];
  invoices: Invoice[];
  loading: boolean;
  emittingInvoiceId: string | null;
  paymentLoading: boolean;
  onVerifyTransfer: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (
    transfer: Transfer,
    params: { tipo_comprobante: "boleta" | "factura"; doc_num: string }
  ) => void;
  onAttachInvoice: (transfer: Transfer, file: File) => void;
  onDetachInvoice: (invoiceId: string) => Promise<boolean>;
  onUpdateDni: (dni: string) => Promise<boolean>;
  onCancelReservation: () => Promise<boolean>;
  onRevokeManualPayment: (transferId: string) => void;
  onRegisterPayment: (amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  clientType: ClientType;
  clientTypeLoading?: boolean;
  clientTypeUpdating?: boolean;
  onUpdateClientType: (clientType: ClientType) => Promise<boolean>;
  cancellingReservation?: boolean;
  onClose: () => void;
  onToggleArrived?: (resId: string, arrived: boolean) => void;
  onExtendReservation?: () => void;
  extendingReservation?: boolean;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

function formatHour12(hourStr: string): string {
  const h = parseInt(hourStr.split(":")[0]);
  if (h === 0) return "12:00 am";
  if (h < 12) return `${h}:00 am`;
  if (h === 12) return "12:00 pm";
  return `${h - 12}:00 pm`;
}

function formatReservationTime(reservation: Reservation) {
  if (!reservation.time_slots?.length) return "—";
  const start = reservation.time_slots[0];
  const lastHour = parseInt(reservation.time_slots[reservation.time_slots.length - 1].split(":")[0]) + 1;
  return `${formatHour12(start)} – ${formatHour12(`${lastHour}:00`)}`;
}

function formatPhoneDisplay(phone: string) {
  return phone.startsWith("51") ? phone.slice(2) : phone;
}

function wspLink(phone: string) {
  return `https://wa.me/${phone.startsWith("51") ? phone : `51${phone}`}?text=.`;
}

// ─── Register Payment Form ───────────────────────────────────────────────────

function RegisterPaymentForm({
  remaining,
  loading,
  onSubmit,
  isCancelled = false,
}: {
  remaining: number;
  loading: boolean;
  onSubmit: (amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  isCancelled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedAmount = parseFloat(amount);
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0;
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
    setAmount((remaining > 0 ? remaining : 1).toFixed(2));
    setMethod("efectivo");
    clearFile();
  }

  if (isCancelled) return null;

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setAmount((remaining > 0 ? remaining : 1).toFixed(2)); }}
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

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">Método de pago</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setMethod("efectivo"); clearFile(); }}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${method === "efectivo"
              ? "border-green-500 bg-green-50 text-green-700"
              : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
          >
            Efectivo
          </button>
          <button
            type="button"
            onClick={() => setMethod("digital")}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${method === "digital"
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
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
        <label className="block text-sm font-medium text-gray-600 mb-2">Monto a cobrar (S/)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-4 py-3 text-lg font-bold rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none bg-gray-50"
        />
        <p className="text-xs text-gray-400 mt-1">
          Deuda actual sugerida: S/ {Math.max(remaining, 0).toFixed(2)}. Puedes cobrar un monto mayor si necesitas ajustar deudas previas.
        </p>
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
          {uploading ? "Subiendo..." : loading ? "Procesando..." : "Cobrar"}
        </button>
      </div>
    </div>
  );
}

// ─── Transfer Card ───────────────────────────────────────────────────────────

function TransferCard({
  transfer, invoice, emittingInvoiceId, onVerify, onEmitInvoice, onAttachInvoice, onDetachInvoice, onRevoke, onViewImage, onHover, chatId, clientDni,
}: {
  transfer: Transfer;
  invoice: Invoice | undefined;
  emittingInvoiceId: string | null;
  onVerify: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (
    transfer: Transfer,
    params: { tipo_comprobante: "boleta" | "factura"; doc_num: string }
  ) => void;
  onAttachInvoice: (transfer: Transfer, file: File) => void;
  onDetachInvoice: (invoiceId: string) => Promise<boolean>;
  onRevoke: (transferId: string) => void;
  onViewImage: (url: string) => void;
  onHover: (hovering: boolean) => void;
  chatId: string;
  clientDni?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showEmitModal, setShowEmitModal] = useState(false);
  const [docType, setDocType] = useState<"boleta" | "factura">("boleta");
  const [docNumber, setDocNumber] = useState("");
  const [wspStatus, setWspStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [wspError, setWspError] = useState<string | null>(null);
  const [detachingInvoice, setDetachingInvoice] = useState(false);
  const isValidated = transfer.verified || transfer.source === "manual";
  const canAttach = isValidated && !invoice;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canAttach) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onAttachInvoice(transfer, file);
  }, [canAttach, onAttachInvoice, transfer]);

  return (
    <div
      className={`rounded-2xl border-2 transition-all ${dragOver && canAttach ? "border-blue-400 bg-blue-50/30 ring-2 ring-blue-200" : transfer.verified ? "border-green-400 bg-green-50/30" : "border-gray-200 bg-white"}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onDragOver={(e) => { if (canAttach) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className={`grid grid-cols-2 border-b-2 rounded-t-2xl ${transfer.verified ? "border-green-400 bg-green-50/50" : "border-gray-200 bg-gray-50/50"}`}>
        <div className="px-5 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">Pago</div>
        <div className={`px-5 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider border-l-2 ${transfer.verified ? "border-green-400" : "border-gray-200"}`}>Boleta asociada</div>
      </div>

      <div className="grid grid-cols-2">
        {/* COLUMNA IZQUIERDA: PAGO */}
        <div className="p-4 space-y-3">
          <div className="w-full">
            {transfer.media_url ? (
              <div
                className="relative group cursor-pointer overflow-hidden rounded-xl border border-gray-200 aspect-[3/4] bg-gray-100"
                onClick={() => onViewImage(transfer.media_url!)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={transfer.media_url} alt="Voucher" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                  <span className="text-sm font-bold text-white bg-black/60 px-4 py-2 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">Ver imagen</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-6 text-center aspect-[3/4]">
                {transfer.source === "manual" ? (
                  <>
                    <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    <span className="text-sm font-semibold text-gray-400">Pago en Caja</span>
                  </>
                ) : (
                  <>
                    <svg className="w-10 h-10 text-amber-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <span className="text-sm font-semibold text-gray-400">Sin imagen</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="text-lg font-bold text-gray-900">S/ {transfer.amount?.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatTransferDate(transfer.created_at)} · {formatTransferTime(transfer.created_at)}
              <span className="text-gray-300 mx-1">·</span>
              {transfer.source === "manual" ? "en caja" : "digital"}
            </p>
            <p className={`text-xs font-semibold mt-1 ${transfer.verified ? "text-green-600" : "text-amber-600"}`}>
              {transfer.verified ? "Validado" : transfer.source === "manual" ? "Cobro manual" : "Pendiente validación"}
            </p>
          </div>

          {transfer.source !== "manual" && (
            <button
              onClick={() => onVerify(transfer.id, !!transfer.verified)}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${transfer.verified
                ? "bg-white border-2 border-gray-200 text-gray-600 hover:border-red-200 hover:text-red-500"
                : "bg-green-600 text-white hover:bg-green-700 shadow-sm"
                }`}
            >
              {transfer.verified ? (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>Deshacer</>
              ) : (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Validar Pago</>
              )}
            </button>
          )}
          <button
            onClick={() => onRevoke(transfer.id)}
            className="w-full py-2.5 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 bg-white border-2 border-red-100 text-red-600 hover:bg-red-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14L21 3m0 0h-7m7 0v7M14 10L3 21m0 0h7m-7 0v-7" /></svg>
            Desvincular pago
          </button>
        </div>

        {/* COLUMNA DERECHA: BOLETA */}
        <div className={`p-4 border-l-2 flex flex-col justify-center ${transfer.verified ? "border-green-400" : "border-gray-200"}`}>
          {!isValidated ? (
            <div className="text-center py-8">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="text-sm font-semibold text-gray-400">Valida el pago primero</p>
            </div>
          ) : invoice ? (
            <div className="space-y-3">
              <div className="w-full relative">
                <PdfPreview url={invoice.file_url} onClickImage={onViewImage} />
                {invoice.status === "attached" && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (detachingInvoice) return;
                      setDetachingInvoice(true);
                      await onDetachInvoice(invoice.id);
                      setDetachingInvoice(false);
                    }}
                    disabled={detachingInvoice}
                    title="Desvincular boleta adjuntada"
                    className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-gray-900/65 text-white text-sm font-bold hover:bg-gray-900/80 transition-colors disabled:opacity-50"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">S/ {invoice.amount.toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{new Date(invoice.created_at).toLocaleDateString("es-PE")}</p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/proxy-file?url=${encodeURIComponent(invoice.file_url)}`}
                  download={`boleta_${invoice.id}.pdf`}
                  className="flex-1 py-2.5 px-3 rounded-xl font-bold text-sm bg-blue-50 border-2 border-blue-100 text-blue-700 hover:bg-blue-100 flex items-center justify-center gap-2 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Descargar
                </a>
                <button
                  onClick={async () => {
                    if (wspStatus === "sending" || wspStatus === "sent") return;
                    setWspStatus("sending");
                    setWspError(null);
                    try {
                      const res = await fetch("/api/invoices/send", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: chatId, file_url: invoice.file_url }),
                      });
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo enviar la boleta.");
                      }
                      setWspStatus("sent");
                    } catch (error) {
                      setWspStatus("error");
                      setWspError(error instanceof Error ? error.message : "No se pudo enviar la boleta.");
                    }
                  }}
                  disabled={wspStatus === "sending" || wspStatus === "sent"}
                  className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${wspStatus === "sent"
                    ? "bg-green-50 border-2 border-green-200 text-green-700"
                    : wspStatus === "error"
                    ? "bg-red-50 border-2 border-red-200 text-red-700"
                    : "bg-green-600 text-white hover:bg-green-700 border-2 border-green-600 hover:border-green-700"
                    } disabled:opacity-80`}
                >
                  {wspStatus === "sending" ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Enviando</>
                  ) : wspStatus === "sent" ? (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Enviado</>
                  ) : wspStatus === "error" ? (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v4m0 8v4m8-8h-4M8 12H4" /></svg>Reintentar envío</>
                  ) : (
                    <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d={WSP_ICON_PATH} /></svg>Enviar</>
                  )}
                </button>
              </div>
              {wspError && (
                <p className="text-xs text-red-600 font-medium">{wspError}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-6 text-center aspect-[3/4]">
                <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span className="text-sm font-semibold text-gray-400">Sin boleta</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAttachInvoice(transfer, f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={emittingInvoiceId === transfer.id}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-gray-900 text-white hover:bg-gray-800 flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
              >
                {emittingInvoiceId === transfer.id ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Subiendo...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>Adjuntar Boleta</>
                )}
              </button>

              <button
                onClick={() => {
                  setDocType("boleta");
                  setDocNumber(clientDni || "");
                  setShowEmitModal(true);
                }}
                disabled={emittingInvoiceId === transfer.id}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2 border border-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Emitir Boleta
              </button>
            </div>
          )}
        </div>
      </div>

      {showEmitModal && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-bold text-gray-900">Emitir comprobante</h4>
              <button onClick={() => setShowEmitModal(false)} className="p-1 text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  if (docType !== "boleta") {
                    setDocType("boleta");
                    setDocNumber(clientDni || "");
                  }
                }}
                className={`py-2 rounded-lg border-2 font-semibold ${docType === "boleta" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"
                  }`}
              >
                Con DNI
              </button>
              <button
                onClick={() => {
                  if (docType !== "factura") {
                    setDocType("factura");
                    setDocNumber("");
                  }
                }}
                className={`py-2 rounded-lg border-2 font-semibold ${docType === "factura" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"
                  }`}
              >
                Con RUC
              </button>
            </div>

            <input
              type="text"
              value={docNumber}
              onChange={(e) => {
                const onlyDigits = e.target.value.replace(/\D/g, "");
                setDocNumber(docType === "factura" ? onlyDigits.slice(0, 11) : onlyDigits.slice(0, 8));
              }}
              placeholder={docType === "factura" ? "RUC (11 dígitos)" : "DNI (8 dígitos)"}
              className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowEmitModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const isValid = docType === "factura" ? docNumber.length === 11 : docNumber.length === 8;
                  if (!isValid) return;
                  onEmitInvoice(transfer, {
                    tipo_comprobante: docType,
                    doc_num: docNumber,
                  });
                  setShowEmitModal(false);
                }}
                disabled={emittingInvoiceId === transfer.id || (docType === "factura" ? docNumber.length !== 11 : docNumber.length !== 8)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60"
              >
                {emittingInvoiceId === transfer.id ? "Emitiendo..." : "Emitir"}
              </button>
            </div>
          </div>
        </div>
      )}
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

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PaymentSidebar({
  reservation,
  transfers,
  invoices,
  loading,
  emittingInvoiceId,
  paymentLoading,
  onVerifyTransfer,
  onEmitInvoice,
  onAttachInvoice,
  onDetachInvoice,
  onUpdateDni,
  onCancelReservation,
  onRevokeManualPayment,
  onRegisterPayment,
  clientType,
  clientTypeLoading = false,
  clientTypeUpdating = false,
  onUpdateClientType,
  cancellingReservation = false,
  onClose,
  onToggleArrived,
  onExtendReservation,
  extendingReservation = false,
}: PaymentSidebarProps) {
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [hoveredTransferId, setHoveredTransferId] = useState<string | null>(null);
  const [editingDni, setEditingDni] = useState(false);
  const [dniValue, setDniValue] = useState(reservation.dni || "");

  // Ctrl+V / paste: adjuntar boleta desde clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files || []).find(
        (f) => f.type === "application/pdf"
      );
      if (!file) return;

      const eligibleTransfers = transfers.filter(
        (t) => (t.verified || t.source === "manual") && !invoices.find((inv) => inv.transfer_id === t.id)
      );
      if (eligibleTransfers.length === 0) return;

      let target: Transfer | undefined;
      if (eligibleTransfers.length === 1) {
        target = eligibleTransfers[0];
      } else if (hoveredTransferId) {
        target = eligibleTransfers.find((t) => t.id === hoveredTransferId);
      }

      if (target) {
        e.preventDefault();
        onAttachInvoice(target, file);
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [transfers, invoices, hoveredTransferId, onAttachInvoice]);
  useEffect(() => {
    setDniValue(reservation.dni || "");
    setEditingDni(false);
  }, [reservation.id, reservation.dni]);
  const [arrivedLoading, setArrivedLoading] = useState(false);

  const calculatedPrice = reservation.field && reservation.time_slots
    ? calculateReservationPrice(reservation.field, reservation.date, reservation.time_slots)
    : 0;
  const totalPrice = calculatedPrice || reservation.total_price || 0;
  const amountPaid = reservation.amount_paid || 0;
  const remaining = Math.max(0, totalPrice - amountPaid);
  const fullyPaid = remaining <= 0;
  const arrived = reservation.arrived ?? false;
  const isCancelled = reservation.status === "cancelled";

  async function handleArrivedToggle() {
    if (!onToggleArrived) return;
    setArrivedLoading(true);
    await onToggleArrived(reservation.id, !arrived);
    setArrivedLoading(false);
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sidebar */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Detalle de reserva</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-500">
                <span className="font-semibold text-gray-700">
                  {reservation.field ? `Cancha ${reservation.field}` : "Sin cancha"}
                </span>
                <span className="text-gray-300">·</span>
                <span>{formatReservationTime(reservation)}</span>
                <span className="text-gray-300">·</span>
                <span>
                  {new Date(reservation.date + "T12:00:00").toLocaleDateString("es-PE", {
                    weekday: "short", day: "numeric", month: "short",
                  })}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors shrink-0"
              aria-label="Cerrar sidebar"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Client Info */}
        <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <div className="flex items-stretch justify-between gap-4">
            <div className="flex flex-col justify-center space-y-1">
              <p className="text-lg font-bold text-gray-900">
                {reservation.representative_name || "Sin nombre"}
              </p>
              {reservation.phone_number && (
                <a
                  href={wspLink(reservation.phone_number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:bg-green-50 px-2 py-1 rounded-lg transition-colors group"
                  title="Abrir chat de WhatsApp"
                >
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d={WSP_ICON_PATH} />
                  </svg>
                  <span className="text-gray-500 text-base font-mono group-hover:text-green-700 group-hover:underline">
                    {formatPhoneDisplay(reservation.phone_number)}
                  </span>
                </a>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-gray-500">DNI:</span>
                {editingDni ? (
                  <>
                    <input
                      type="text"
                      value={dniValue}
                      onChange={(e) => setDniValue(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="(opcional)"
                      className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-700 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={async () => {
                        const ok = await onUpdateDni(dniValue);
                        if (ok) setEditingDni(false);
                      }}
                      className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Guardar
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`text-sm font-semibold ${reservation.dni ? "text-gray-800" : "text-gray-400"}`}>
                      {reservation.dni || "(vacío)"}
                    </span>
                    <button
                      onClick={() => setEditingDni(true)}
                      className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                      title="Editar DNI"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-4 shrink-0 min-w-[260px]">
              <div className="w-full flex flex-wrap items-center gap-2">
                {onToggleArrived && !isCancelled && !arrived && (
                  <button
                    onClick={handleArrivedToggle}
                    disabled={arrivedLoading}
                    className="px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                  >
                    {arrivedLoading ? "..." : "Marcar llegada"}
                  </button>
                )}
                {onExtendReservation && !isCancelled && (
                  <button
                    onClick={onExtendReservation}
                    disabled={extendingReservation}
                    className="px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
                  >
                    {extendingReservation ? "Extender..." : "Extender +1h"}
                  </button>
                )}
                {!isCancelled && (
                  <button
                    onClick={onCancelReservation}
                    disabled={cancellingReservation}
                    className="ml-auto px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 bg-red-600 text-white shadow-sm hover:bg-red-700"
                  >
                    {cancellingReservation ? "Cancelando..." : "Cancelar reserva"}
                  </button>
                )}
                {onToggleArrived && !isCancelled && arrived && (
                  <button
                    onClick={handleArrivedToggle}
                    disabled={arrivedLoading}
                    className="ml-auto px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 bg-green-500 text-white shadow-md hover:bg-green-600"
                  >
                    {arrivedLoading ? "..." : "Cancelar llegada"}
                  </button>
                )}
              </div>

              <div className="w-full mt-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Tipo de cliente
                </label>
                {clientTypeLoading ? (
                  <div className="h-[42px] w-full rounded-xl border-2 border-gray-200 bg-gray-100 animate-pulse" />
                ) : (
                  <select
                    value={clientType}
                    disabled={clientTypeUpdating}
                    onChange={(e) => {
                      const next = e.target.value as ClientType;
                      if (next === clientType) return;
                      void onUpdateClientType(next);
                    }}
                    className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                  >
                    <option value="casual">{CLIENT_TYPE_LABELS.casual}</option>
                    <option value="recurrente">{CLIENT_TYPE_LABELS.recurrente}</option>
                    <option value="sospechoso_fraude">{CLIENT_TYPE_LABELS.sospechoso_fraude}</option>
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Resumen financiero */}
          <div className="mt-7 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4">
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
          <RegisterPaymentForm
            remaining={remaining}
            loading={paymentLoading}
            onSubmit={onRegisterPayment}
            isCancelled={isCancelled}
          />

          {loading && transfers.length === 0 ? (
            <><SkeletonCard /><SkeletonCard /></>
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
                  onAttachInvoice={onAttachInvoice}
                  onDetachInvoice={onDetachInvoice}
                  onRevoke={onRevokeManualPayment}
                  onViewImage={setViewingImage}
                  onHover={(h) => setHoveredTransferId(h ? transfer.id : null)}
                  chatId={reservation.chat_id}
                  clientDni={reservation.dni}
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

      {viewingImage && <ImageViewer src={viewingImage} onClose={() => setViewingImage(null)} />}
    </>
  );
}
