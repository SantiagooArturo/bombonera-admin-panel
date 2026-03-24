"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import ReactDOM from "react-dom";
import { Transfer, Invoice, Reservation, PaymentMethod, ClientType, CLIENT_TYPE_LABELS, STATUS_LABELS, getPendingExpiryTimeFormatted, type ReservationStatus, type EmitComprobanteParams } from "@/lib/types";
import { PdfPreviewThumbnail } from "@/components/PdfPreviewThumbnail";
import type { CourtFieldConfig } from "@/lib/court-config";
import { getCourtSizeLabel } from "@/lib/court-config";
import { calculateReservationPrice, courtConfigsToMap, formatDisplayPhone, wspLink } from "@/features/operaciones/utils";
import { WHATSAPP_ICON_PATH as WSP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { EmitInvoiceModal } from "./EmitInvoiceModal";
import { RegisterPaymentFormCobros } from "./RegisterPaymentFormCobros";
import {
  invoicePersonalizedPdfAbsoluteUrlForSend,
  invoicePlantillaPdfHref,
} from "@/features/boletas/utils/invoicePdfLinks";

// ─── Props ───────────────────────────────────────────────────────────────────

interface PaymentSidebarProps {
  reservation: Reservation;
  transfers: Transfer[];
  invoices: Invoice[];
  loading: boolean;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  paymentLoading: boolean;
  onVerifyTransfer: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (transfer: Transfer, params: EmitComprobanteParams) => void;
  onAttachInvoice: (transfer: Transfer, file: File) => void;
  onDetachInvoice: (invoiceId: string) => Promise<boolean>;
  /** Anular boleta/factura emitida ante SUNAT (apisunat). */
  onVoidSunatInvoice?: (invoiceId: string) => Promise<boolean>;
  onUpdateDni: (dni: string) => Promise<boolean>;
  onUpdateRuc?: (ruc: string) => Promise<boolean>;
  onUpdateName?: (name: string) => Promise<boolean>;
  /** RUC del cliente (desde user) para prellenar facturas. */
  clientRuc?: string | null;
  onCancelReservation: () => Promise<boolean>;
  /** Nombre a mostrar: custom_name || contact_name || push_name || representative_name */
  displayName?: string;
  /** Para inicializar el input al editar: usamos custom_name (solo eso se edita) */
  userCustomName?: string;
  onRevokeManualPayment: (transferId: string) => void;
  onRegisterPayment: (reservationId: string | null, amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  onToggleApplied?: (transferId: string, applied: boolean) => void;
  onUpdatePrice?: (totalPrice: number, reservationId?: string) => Promise<boolean>;
  onUpdateAmountPaid?: (amountPaid: number, reservationId?: string) => Promise<boolean>;
  clientType: ClientType;
  clientTypeLoading?: boolean;
  clientTypeUpdating?: boolean;
  onUpdateClientType: (clientType: ClientType) => Promise<boolean>;
  onUpdateStatus?: (status: "pending" | "confirmed") => Promise<boolean>;
  statusUpdating?: boolean;
  cancellingReservation?: boolean;
  onClose: () => void;
  /** Config de canchas para mostrar tamaño (5 vs 5, 6 vs 6) y calcular precio. */
  courtConfigs?: CourtFieldConfig[] | null;
  /** Todas las reservas del cliente esta semana (incl. actual), ordenadas por fecha. */
  allReservationsThisWeek?: Reservation[];
  /** Todas las reservas del cliente (pasadas, esta semana, futuras) para el tab Cobros. */
  allClientReservations?: Reservation[];
  /** Al hacer click en una reserva de la lista: navegar a ella (ej. cambiar día en operaciones). */
  onSelectReservationFromList?: (reservation: Reservation) => void;
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

// ─── Vista simplificada (1 reserva) ───────────────────────────────────────────
// Sin tabs. Layout directo: cliente, controles, resumen financiero, RegisterPaymentForm,
// lista de TransferCard (PAGO | BOLETA ASOCIADA). Soporta paste de boleta con hover.

interface SimplifiedPaymentClientData {
  userCustomName?: string;
  effectiveDisplayName: string;
  editingName: boolean;
  nameValue: string;
  setNameValue: (v: string) => void;
  setEditingName: (v: boolean) => void;
  onUpdateName?: (name: string) => Promise<boolean>;
  editingDni: boolean;
  dniValue: string;
  setDniValue: (v: string) => void;
  setEditingDni: (v: boolean) => void;
  onUpdateDni: (dni: string) => Promise<boolean>;
  editingRuc: boolean;
  rucValue: string;
  setRucValue: (v: string) => void;
  setEditingRuc: (v: boolean) => void;
  onUpdateRuc?: (ruc: string) => Promise<boolean>;
  clientType: ClientType;
  clientTypeLoading?: boolean;
  clientTypeUpdating?: boolean;
  statusUpdating?: boolean;
  cancellingReservation?: boolean;
}

interface SimplifiedPaymentTransferHandlers {
  transfers: Transfer[];
  invoices: Invoice[];
  loading: boolean;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  paymentLoading: boolean;
  onVerifyTransfer: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (t: Transfer, p: EmitComprobanteParams) => void;
  onAttachInvoice: (t: Transfer, f: File) => void;
  onDetachInvoice: (id: string) => Promise<boolean>;
  onVoidSunatInvoice?: (invoiceId: string) => Promise<boolean>;
  onRevokeManualPayment: (id: string) => void;
  onRegisterPayment: (reservationId: string | null, amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  onViewImage: (url: string) => void;
  onHoverTransferChanged: (transferId: string | null) => void;
  chatId: string;
  clientDni?: string | null;
  clientRuc?: string | null;
}

interface ReservationDetailContentProps {
  reservation: Reservation;
  courtConfigs?: CourtFieldConfig[] | null;
  clientData: SimplifiedPaymentClientData;
  onUpdatePrice?: (totalPrice: number, reservationId?: string) => Promise<boolean>;
  onUpdateAmountPaid?: (amountPaid: number, reservationId?: string) => Promise<boolean>;
  onUpdateStatus?: (status: "pending" | "confirmed") => Promise<boolean>;
  onUpdateClientType: (clientType: ClientType) => Promise<boolean>;
  onCancelReservation: () => Promise<boolean>;
  transferHandlers: SimplifiedPaymentTransferHandlers;
  /** Chips para cambiar de reserva cuando el cliente tiene 2+ reservas esta semana. */
  reservationsForChips?: Reservation[];
  onSelectReservationFromChips?: (r: Reservation) => void;
  /** Oculta botón Registrar cobro y lista de pagos (para probar UI simplificada). */
  hidePaymentsSection?: boolean;
}

function ReservationDetailContent({
  reservation,
  courtConfigs,
  clientData,
  onUpdatePrice,
  onUpdateAmountPaid,
  onUpdateStatus,
  onUpdateClientType,
  onCancelReservation,
  transferHandlers,
  reservationsForChips,
  onSelectReservationFromChips,
  hidePaymentsSection = false,
}: ReservationDetailContentProps) {
  const {
    effectiveDisplayName,
    userCustomName,
    editingName,
    nameValue,
    setNameValue,
    setEditingName,
    onUpdateName,
    editingDni,
    dniValue,
    setDniValue,
    setEditingDni,
    onUpdateDni,
    editingRuc,
    rucValue,
    setRucValue,
    setEditingRuc,
    onUpdateRuc,
    clientType,
    clientTypeLoading,
    clientTypeUpdating,
    statusUpdating,
    cancellingReservation,
  } = clientData;
  const {
    transfers,
    invoices,
    loading,
    emittingInvoiceId,
    attachingInvoiceId,
    paymentLoading,
    onVerifyTransfer,
    onEmitInvoice,
    onAttachInvoice,
    onDetachInvoice,
    onVoidSunatInvoice,
    onRevokeManualPayment,
    onRegisterPayment,
    onViewImage,
    onHoverTransferChanged,
    chatId,
    clientDni,
    clientRuc,
  } = transferHandlers;
  const configMap = useMemo(() => courtConfigsToMap(courtConfigs), [courtConfigs]);
  const transfersForRes = useMemo(
    () => transfers.filter((t) => t.reservation_id === reservation.id),
    [transfers, reservation.id]
  );
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(reservation.total_price ?? 0));
  const [priceUpdating, setPriceUpdating] = useState(false);
  const [editingAmountPaid, setEditingAmountPaid] = useState(false);
  const [amountPaidInput, setAmountPaidInput] = useState(String(reservation.amount_paid ?? 0));
  const [amountPaidUpdating, setAmountPaidUpdating] = useState(false);

  const calculatedPrice = reservation.field && reservation.time_slots
    ? calculateReservationPrice(reservation.field, reservation.date, reservation.time_slots, configMap)
    : 0;
  /** Priorizar precio guardado en la reserva; si no hay, usar precio estándar calculado. */
  const totalPrice = (reservation.total_price != null && reservation.total_price >= 0)
    ? reservation.total_price
    : (calculatedPrice || 0);
  const amountPaid = reservation.amount_paid ?? 0;
  const remaining = Math.max(0, totalPrice - amountPaid);
  const fullyPaid = remaining <= 0;
  const isCancelled = reservation.status === "cancelled";

  useEffect(() => {
    setPriceInput(String(reservation.total_price ?? 0));
  }, [reservation.id, reservation.total_price]);
  useEffect(() => {
    setAmountPaidInput(String(reservation.amount_paid ?? 0));
  }, [reservation.id, reservation.amount_paid]);

  async function handleSavePrice() {
    if (!onUpdatePrice) return;
    const parsed = parseFloat(priceInput.replace(",", "."));
    if (isNaN(parsed) || parsed < 0) return;
    setPriceUpdating(true);
    const ok = await onUpdatePrice(parsed);
    setPriceUpdating(false);
    if (ok) setEditingPrice(false);
  }

  async function handleSaveAmountPaid() {
    if (!onUpdateAmountPaid) return;
    const parsed = parseFloat(amountPaidInput.replace(",", "."));
    if (isNaN(parsed) || parsed < 0) return;
    setAmountPaidUpdating(true);
    const ok = await onUpdateAmountPaid(parsed);
    setAmountPaidUpdating(false);
    if (ok) setEditingAmountPaid(false);
  }

  const showChips = reservationsForChips && reservationsForChips.length > 1 && onSelectReservationFromChips;

  const pendingChipRef = useRef<Reservation | null>(null);
  const chipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChipClick = useCallback(
    (r: Reservation) => {
      if (r.id === reservation.id) return;
      pendingChipRef.current = r;
      if (chipTimeoutRef.current) clearTimeout(chipTimeoutRef.current);
      chipTimeoutRef.current = setTimeout(() => {
        const target = pendingChipRef.current;
        pendingChipRef.current = null;
        chipTimeoutRef.current = null;
        if (target) onSelectReservationFromChips?.(target);
      }, 180);
    },
    [reservation.id, onSelectReservationFromChips]
  );
  useEffect(() => () => { if (chipTimeoutRef.current) clearTimeout(chipTimeoutRef.current); }, []);

  return (
    <div className="flex flex-col h-full">
      {showChips && (
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
            {reservationsForChips!.length} reservas esta semana
          </p>
          <div className="flex flex-wrap gap-1.5">
            {reservationsForChips!.map((r) => {
              const dateObj = new Date(r.date + "T12:00:00");
              const dayName = dateObj.toLocaleDateString("es-PE", { weekday: "long" });
              const dayNum = dateObj.getDate();
              const start = r.time_slots?.[0] || "";
              const lastH = r.time_slots?.length ? parseInt(r.time_slots[r.time_slots.length - 1].split(":")[0]) + 1 : 0;
              const end = `${lastH}:00`;
              const timeShort = `${formatHour12(start).replace(/:00\s?/g, "").replace(/\s/g, "")}-${formatHour12(end).replace(/:00\s?/g, "").replace(/\s/g, "")}`;
              const fieldShort = r.field ? `C${r.field}` : "—";
              const isCurrent = r.id === reservation.id;
              const label = `${dayName} ${dayNum} · ${timeShort} · ${fieldShort}`;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleChipClick(r)}
                  className={`min-w-[10rem] px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                    isCurrent
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-white text-amber-800 hover:bg-amber-100 border border-amber-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Datos del cliente */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0 space-y-4">
        <div className="flex flex-col space-y-1">
            {onUpdateName && editingName ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    placeholder="Nombre personalizado"
                    className="flex-1 min-w-0 rounded-lg border-2 border-blue-500 px-2 py-1.5 text-lg font-bold text-gray-900 focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={async () => {
                      const ok = await onUpdateName(nameValue.trim());
                      if (ok) setEditingName(false);
                    }}
                    disabled={!nameValue.trim()}
                    className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => {
                      setEditingName(false);
                      setNameValue(userCustomName ?? effectiveDisplayName);
                    }}
                    className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700"
                    title="Cancelar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <p className="text-lg font-bold text-gray-900">
                  {effectiveDisplayName || "Sin nombre"}
                </p>
                {onUpdateName && (
                  <button
                    onClick={() => setEditingName(true)}
                    className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                    title="Editar nombre"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
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
                  {formatDisplayPhone(reservation.phone_number)}
                </span>
              </a>
            )}
            <div className="flex items-center gap-2">
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
            {onUpdateRuc != null && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">RUC:</span>
                {editingRuc ? (
                  <>
                    <input
                      type="text"
                      value={rucValue}
                      onChange={(e) => setRucValue(e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder="(opcional)"
                      className="w-36 rounded-lg border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-700 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={async () => {
                        const ok = await onUpdateRuc(rucValue);
                        if (ok) setEditingRuc(false);
                      }}
                      className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Guardar
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`text-sm font-semibold ${rucValue ? "text-gray-800" : "text-gray-400"}`}>
                      {rucValue || "(vacío)"}
                    </span>
                    <button
                      onClick={() => setEditingRuc(true)}
                      className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                      title="Editar RUC"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

        {/* Controles: fila horizontal */}
        <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-gray-100">
          <div className="min-w-[140px] flex-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Estado de Reserva</label>
            {onUpdateStatus && (reservation.status === "pending" || reservation.status === "confirmed") ? (
              statusUpdating ? (
                <div className="h-[42px] w-full rounded-xl border-2 border-gray-200 bg-gray-100 animate-pulse" />
              ) : (
                <select
                  value={reservation.status}
                  disabled={statusUpdating}
                  onChange={(e) => {
                    const next = e.target.value as "pending" | "confirmed";
                    if (next === reservation.status) return;
                    void onUpdateStatus(next);
                  }}
                  className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                >
                  <option value="pending">{STATUS_LABELS.pending}</option>
                  <option value="confirmed">{STATUS_LABELS.confirmed}</option>
                </select>
              )
            ) : (
              <div className="rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-800">
                {STATUS_LABELS[reservation.status as ReservationStatus] ?? reservation.status}
              </div>
            )}
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tipo de cliente</label>
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
          {!isCancelled && (
            <button
              onClick={onCancelReservation}
              disabled={cancellingReservation}
              className="px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 bg-red-600 text-white shadow-sm hover:bg-red-700 shrink-0"
            >
              {cancellingReservation ? "Cancelando..." : "Cancelar reserva"}
            </button>
          )}
        </div>

        {/* Resumen financiero: Total, Pagado, Deuda */}
        <div className="mt-6 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
            <p className="text-xs font-medium text-gray-400 uppercase">Total</p>
            {onUpdatePrice && !isCancelled && editingPrice ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center justify-center gap-1">
                  <span className="text-lg font-bold text-gray-900">S/</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value.replace(/[^\d.,]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSavePrice();
                      if (e.key === "Escape") { setEditingPrice(false); setPriceInput(String(reservation.total_price ?? 0)); }
                    }}
                    className="w-20 text-lg font-bold text-gray-900 border-b-2 border-blue-500 bg-transparent focus:outline-none text-center"
                    autoFocus
                  />
                  <button onClick={() => void handleSavePrice()} disabled={priceUpdating} className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {priceUpdating ? "..." : "Guardar"}
                  </button>
                  <button onClick={() => { setEditingPrice(false); setPriceInput(String(reservation.total_price ?? 0)); }} disabled={priceUpdating} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700 disabled:opacity-50" title="Cancelar">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1">
                <p className="text-lg font-bold text-gray-900">S/ {totalPrice.toFixed(2)}</p>
                {onUpdatePrice && !isCancelled && (
                  <button onClick={() => setEditingPrice(true)} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="Editar precio (clientes con trato especial)">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {calculatedPrice > 0 && (
              <p className="text-xs text-gray-500 mt-1">Precio estándar: S/ {calculatedPrice.toFixed(2)}</p>
            )}
          </div>
          <div className="bg-blue-50 rounded-xl px-4 py-3 text-center">
            <p className="text-xs font-medium text-blue-400 uppercase">Pagado</p>
            {onUpdateAmountPaid && !isCancelled && editingAmountPaid ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center justify-center gap-1">
                  <span className="text-lg font-bold text-blue-700">S/</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountPaidInput}
                    onChange={(e) => setAmountPaidInput(e.target.value.replace(/[^\d.,]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveAmountPaid();
                      if (e.key === "Escape") { setEditingAmountPaid(false); setAmountPaidInput(String(amountPaid)); }
                    }}
                    className="w-20 text-lg font-bold text-blue-700 border-b-2 border-blue-500 bg-transparent focus:outline-none text-center"
                    autoFocus
                  />
                  <button onClick={() => void handleSaveAmountPaid()} disabled={amountPaidUpdating} className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {amountPaidUpdating ? "..." : "Guardar"}
                  </button>
                  <button onClick={() => { setEditingAmountPaid(false); setAmountPaidInput(String(amountPaid)); }} disabled={amountPaidUpdating} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700 disabled:opacity-50" title="Cancelar">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <p className="text-xs text-blue-400">La deuda se recalcula automáticamente</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1">
                <p className="text-lg font-bold text-blue-700">S/ {amountPaid.toFixed(2)}</p>
                {onUpdateAmountPaid && !isCancelled && (
                  <button onClick={() => setEditingAmountPaid(true)} className="p-1 rounded-md hover:bg-blue-100 text-blue-600 hover:text-blue-800" title="Editar monto pagado (pago anticipado, varias reservas juntas, etc.)">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className={`rounded-xl px-4 py-3 text-center ${fullyPaid ? "bg-green-50" : "bg-red-50"}`}>
            <p className={`text-xs font-medium uppercase ${fullyPaid ? "text-green-400" : "text-red-400"}`}>Deuda</p>
            <p className={`text-lg font-bold ${fullyPaid ? "text-green-700" : "text-red-600"}`}>S/ {remaining.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Content: RegisterPaymentForm + TransferCard (ocultado cuando hidePaymentsSection) */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-gray-50">
        {!hidePaymentsSection && !isCancelled && (
          <RegisterPaymentFormCobros
            reservationsForPayment={[reservation]}
            totalRemaining={remaining}
            loading={paymentLoading}
            onSubmit={onRegisterPayment}
            buttonLabel="Registrar cobro"
            buttonSubtext={null}
          />
        )}
        {!hidePaymentsSection && (loading && transfersForRes.length === 0 ? (
          <><SkeletonCard /><SkeletonCard /></>
        ) : transfersForRes.length > 0 ? (
          <div className="space-y-4">
            {transfersForRes.map((transfer) => {
              const invoice = invoices.find((inv) => inv.transfer_id === transfer.id);
              return (
                <TransferCard
                  key={transfer.id}
                  transfer={transfer}
                  invoice={invoice}
                  reservation={reservation}
                  courtConfigs={courtConfigs}
                  emittingInvoiceId={emittingInvoiceId}
                  attachingInvoiceId={attachingInvoiceId}
                  onVerify={onVerifyTransfer}
                  onEmitInvoice={onEmitInvoice}
                  onAttachInvoice={onAttachInvoice}
                  onDetachInvoice={onDetachInvoice}
                  onVoidSunatInvoice={onVoidSunatInvoice}
                  onRevoke={onRevokeManualPayment}
                  onViewImage={onViewImage}
                  onHover={(hovering) => onHoverTransferChanged(hovering ? transfer.id : null)}
                  chatId={chatId}
                  clientDni={clientDni}
                  clientRuc={clientRuc}
                />
              );
            })}
          </div>
        ) : null)}
      </div>
    </div>
  );
}

// ─── PENCIL_ICON (usado en varios lugares) ────────────────────────────────────

const PENCIL_ICON = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

// ─── Payment Accordion (compacto → expande TransferCard completo) ─────────────

const PaymentAccordionList = memo(function PaymentAccordionList({
  transfers,
  invoices,
  allClientReservations,
  courtConfigs,
  emittingInvoiceId,
  attachingInvoiceId,
  onVerifyTransfer,
  onEmitInvoice,
  onAttachInvoice,
  onDetachInvoice,
  onVoidSunatInvoice,
  onRevokeManualPayment,
  onToggleApplied,
  onViewImage,
  onHover,
  chatId,
  clientDni,
  clientRuc,
}: {
  transfers: Transfer[];
  invoices: Invoice[];
  allClientReservations: Reservation[];
  courtConfigs: CourtFieldConfig[] | null | undefined;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  onVerifyTransfer: (id: string, verified: boolean) => void;
  onEmitInvoice: (t: Transfer, p: EmitComprobanteParams) => void;
  onAttachInvoice: (t: Transfer, f: File) => void;
  onDetachInvoice: (id: string) => Promise<boolean>;
  onVoidSunatInvoice?: (invoiceId: string) => Promise<boolean>;
  onRevokeManualPayment: (id: string) => void;
  onToggleApplied: (transferId: string, applied: boolean) => void;
  onViewImage: (url: string) => void;
  onHover: (id: string | null) => void;
  chatId: string;
  clientDni?: string | null;
  clientRuc?: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {transfers.map((t) => {
        const dateStr = formatTransferDate(t.created_at);
        const isApplied = t.applied ?? (t.status === "applied" || t.status === "partial");
        const inv = invoices.find((i) => i.transfer_id === t.id);
        const isExpanded = expandedId === t.id;

        return (
          <div
            key={t.id}
            className={`rounded-xl border-2 overflow-hidden transition-all ${isExpanded ? "border-blue-300" : "border-gray-200 bg-white"}`}
          >
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : t.id)}
              className="w-full flex items-center justify-between gap-3 py-2.5 px-4 hover:bg-gray-50 transition-colors text-left"
              onMouseEnter={() => onHover(t.id)}
              onMouseLeave={() => onHover(null)}
            >
              <div className="flex items-center gap-3 min-w-0">
                {t.media_url ? (
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.media_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                )}
                <span className="text-sm font-medium text-gray-700">{dateStr}</span>
                <span className="text-sm font-bold text-gray-900">S/ {(t.amount ?? 0).toFixed(2)}</span>
              </div>
              <label
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 cursor-pointer shrink-0"
              >
                <input
                  type="checkbox"
                  checked={!!isApplied}
                  onChange={(e) => onToggleApplied(t.id, e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-5 h-5 cursor-pointer"
                />
                <span className="text-xs font-medium text-gray-600">Aplicado</span>
              </label>
              <svg
                className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isExpanded && (
              <div className="p-2 border-t border-gray-200 bg-gray-50/50">
                <TransferCard
                  transfer={t}
                  invoice={inv}
                  reservation={allClientReservations.find((r) => r.id === t.reservation_id)}
                  courtConfigs={courtConfigs}
                  emittingInvoiceId={emittingInvoiceId}
                  attachingInvoiceId={attachingInvoiceId}
                  onVerify={onVerifyTransfer}
                  onEmitInvoice={onEmitInvoice}
                  onAttachInvoice={onAttachInvoice}
                  onDetachInvoice={onDetachInvoice}
                  onVoidSunatInvoice={onVoidSunatInvoice}
                  onRevoke={onRevokeManualPayment}
                  onViewImage={onViewImage}
                  onHover={(h) => onHover(h ? t.id : null)}
                  chatId={chatId}
                  clientDni={clientDni}
                  clientRuc={clientRuc}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ─── Transfer Card ───────────────────────────────────────────────────────────

/** Construye la descripción que usará SUNAT (formato 12h: 10am-12pm). */
function buildInvoiceDescription(reservation: Reservation | undefined, courtConfigs: CourtFieldConfig[] | null | undefined): string {
  if (!reservation) return "Alquiler cancha — datos de reserva no disponibles";
  const cfg = reservation.field && courtConfigs?.length ? courtConfigs.find((c) => c.field === reservation.field) : null;
  const courtLabel = cfg ? getCourtSizeLabel(cfg) : (reservation.field === 9 ? "5 vs 5" : "6 vs 6");
  let desc = `Alquiler cancha ${courtLabel}`;
  if (reservation.date) {
    const d = new Date(reservation.date + "T12:00:00");
    desc += ` - ${d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
  }
  if (reservation.time_slots?.length) {
    const start = reservation.time_slots[0];
    const lastH = parseInt(reservation.time_slots[reservation.time_slots.length - 1].split(":")[0]) + 1;
    const startStr = formatHour12(start).replace(/:00\s?/g, "").replace(/\s/g, "");
    const endStr = formatHour12(`${lastH}:00`).replace(/:00\s?/g, "").replace(/\s/g, "");
    desc += ` ${startStr}-${endStr}`;
  }
  return desc;
}

const TransferCard = memo(function TransferCard({
  transfer, invoice, reservation, courtConfigs, emittingInvoiceId, attachingInvoiceId, onVerify, onEmitInvoice, onAttachInvoice, onDetachInvoice, onVoidSunatInvoice, onRevoke, onViewImage, onHover, chatId, clientDni, clientRuc,
}: {
  transfer: Transfer;
  invoice: Invoice | undefined;
  reservation?: Reservation | undefined;
  courtConfigs?: CourtFieldConfig[] | null;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  onVerify: (transferId: string, currentStatus: boolean) => void;
  onEmitInvoice: (transfer: Transfer, params: EmitComprobanteParams) => void;
  onAttachInvoice: (transfer: Transfer, file: File) => void;
  onDetachInvoice: (invoiceId: string) => Promise<boolean>;
  onVoidSunatInvoice?: (invoiceId: string) => Promise<boolean>;
  onRevoke: (transferId: string) => void;
  onViewImage: (url: string) => void;
  onHover: (hovering: boolean) => void;
  chatId: string;
  clientDni?: string | null;
  clientRuc?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showEmitModal, setShowEmitModal] = useState(false);
  const [wspStatus, setWspStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [wspError, setWspError] = useState<string | null>(null);
  const [detachingInvoice, setDetachingInvoice] = useState(false);
  const [voidingInvoice, setVoidingInvoice] = useState(false);
  const isManualLike = transfer.source === "manual" || transfer.source === "manual_adjustment";
  const isValidated = transfer.verified || isManualLike;
  const canAttach = isValidated && !invoice;
  const invoiceStatusNorm = invoice?.status ?? (invoice?.serie_correlativo ? "emitted" : "");
  const isInvoiceVoided = invoiceStatusNorm === "voided";
  const canVoidSunat =
    !!onVoidSunatInvoice &&
    !!invoice &&
    invoiceStatusNorm === "emitted" &&
    Boolean(String(invoice.serie_correlativo || "").trim());

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
                ) : transfer.source === "manual_adjustment" ? (
                  <>
                    <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    <span className="text-sm font-semibold text-gray-400">Ajuste manual</span>
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
              {transfer.source === "manual" ? "en caja" : transfer.source === "manual_adjustment" ? "ajuste" : "digital"}
            </p>
            <p className={`text-xs font-semibold mt-1 ${transfer.verified ? "text-green-600" : "text-amber-600"}`}>
              {transfer.verified ? "Validado" : isManualLike ? (transfer.source === "manual_adjustment" ? "Ajuste manual" : "Cobro manual") : "Pendiente validación"}
            </p>
          </div>

          {!isManualLike && (
            <button
              onClick={() => onVerify(transfer.id, !!transfer.verified)}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${transfer.verified
                ? "bg-white border-2 border-gray-200 text-gray-600 hover:border-red-200 hover:text-red-500"
                : "bg-field-dark text-white hover:opacity-95 shadow-sm"
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
                <PdfPreviewThumbnail
                  url={invoicePlantillaPdfHref(invoice) ?? invoice.file_url}
                  onClickPreview={onViewImage}
                />
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
                  href={invoicePlantillaPdfHref(invoice) ?? `/api/proxy-file?url=${encodeURIComponent(invoice.file_url)}`}
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
                      const fileUrlForBot =
                        invoicePersonalizedPdfAbsoluteUrlForSend(invoice) ?? invoice.file_url;
                      const res = await fetch("/api/invoices/send", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: chatId, file_url: fileUrlForBot }),
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
              {isInvoiceVoided ? (
                <p className="rounded-xl border-2 border-gray-200 bg-gray-100 py-2.5 px-3 text-center text-sm font-bold text-gray-600">
                  Anulado
                </p>
              ) : canVoidSunat ? (
                <button
                  type="button"
                  disabled={voidingInvoice}
                  onClick={async () => {
                    const label = invoice.tipo_comprobante === "factura" ? "factura" : "boleta";
                    if (
                      !confirm(
                        `¿Anular esta ${label} (${invoice.serie_correlativo})?\n\nNo se puede deshacer desde el panel.`
                      )
                    ) {
                      return;
                    }
                    setVoidingInvoice(true);
                    try {
                      await onVoidSunatInvoice!(invoice.id);
                    } finally {
                      setVoidingInvoice(false);
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-xl text-sm font-bold border-2 border-red-300 bg-red-50 text-red-800 hover:bg-red-100 transition-colors disabled:opacity-60"
                >
                  {voidingInvoice
                    ? "Anulando…"
                    : invoice.tipo_comprobante === "factura"
                      ? "Anular"
                      : "Anular"}
                </button>
              ) : invoiceStatusNorm === "emitted" && !invoice.serie_correlativo ? (
                <p className="text-xs text-amber-800">
                  No se puede anular: falta número de comprobante en el registro.
                </p>
              ) : null}
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
                disabled={attachingInvoiceId === transfer.id || emittingInvoiceId === transfer.id || !canAttach}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-gray-900 text-white hover:bg-gray-800 flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
              >
                {attachingInvoiceId === transfer.id ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Subiendo...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>Adjuntar Boleta</>
                )}
              </button>

              <button
                onClick={() => setShowEmitModal(true)}
                disabled={attachingInvoiceId === transfer.id || emittingInvoiceId === transfer.id}
                className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-field-dark bg-field-dark px-4 py-2.5 text-sm font-bold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {emittingInvoiceId === transfer.id ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Emitiendo...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Emitir Boleta</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {showEmitModal && typeof document !== "undefined" && ReactDOM.createPortal(
        <EmitInvoiceModal
          transfer={transfer}
          clientDni={clientDni}
          clientRuc={clientRuc}
          initialDescripcion={buildInvoiceDescription(reservation, courtConfigs)}
          initialCliente={reservation?.representative_name?.trim() ?? ""}
          onClose={() => setShowEmitModal(false)}
          onEmitInvoice={onEmitInvoice}
          emitting={emittingInvoiceId === transfer.id}
          attaching={attachingInvoiceId === transfer.id}
        />,
        document.body
      )}
    </div>
  );
});

// ─── Reservation Row (memoizado para evitar re-renders en tabla) ─────────────

const ReservationRow = memo(function ReservationRow({
  r,
  onUpdatePrice,
  onUpdateAmountPaid,
  onMarkedInSession,
  paymentLoading,
}: {
  r: Reservation;
  onUpdatePrice?: (totalPrice: number, reservationId?: string) => Promise<boolean>;
  onUpdateAmountPaid?: (amountPaid: number, reservationId?: string) => Promise<boolean>;
  onMarkedInSession?: (reservationId: string) => void;
  paymentLoading: boolean;
}) {
  const price = r.total_price ?? 0;
  const paid = r.amount_paid ?? 0;
  const dateObj = new Date(r.date + "T12:00:00");
  const dayName = dateObj.toLocaleDateString("es-PE", { weekday: "short" });
  const dayNum = dateObj.getDate();
  const start = r.time_slots?.[0] || "";
  const lastH = r.time_slots?.length ? parseInt(r.time_slots[r.time_slots.length - 1].split(":")[0]) + 1 : 0;
  const timeStr = `${formatHour12(start).replace(/:00\s?/g, "").replace(/\s/g, "")}-${formatHour12(`${lastH}:00`).replace(/:00\s?/g, "").replace(/\s/g, "")}`;
  const fieldShort = r.field ? `C${r.field}` : "—";

  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(price));
  const [updating, setUpdating] = useState(false);
  const lastAmountBeforeFull = useRef<number>(0);
  const isTogglingPaidRef = useRef(false);
  useEffect(() => {
    if (!editingPrice) setPriceInput(String(r.total_price ?? 0));
  }, [r.id, r.total_price, editingPrice]);

  const handleSavePrice = useCallback(async () => {
    const parsed = parseFloat(priceInput.replace(",", "."));
    if (isNaN(parsed) || parsed < 0 || !onUpdatePrice) return;
    setUpdating(true);
    const ok = await onUpdatePrice(parsed, r.id);
    setUpdating(false);
    if (ok) setEditingPrice(false);
  }, [priceInput, onUpdatePrice, r.id]);

  const handleTogglePaid = useCallback(async (checked: boolean) => {
    if (!onUpdateAmountPaid || isTogglingPaidRef.current) return;
    isTogglingPaidRef.current = true;
    setUpdating(true);
    try {
      if (checked) {
        lastAmountBeforeFull.current = paid;
        await onUpdateAmountPaid(price, r.id);
        onMarkedInSession?.(r.id);
      } else {
        await onUpdateAmountPaid(lastAmountBeforeFull.current, r.id);
      }
    } finally {
      isTogglingPaidRef.current = false;
      setUpdating(false);
    }
  }, [onUpdateAmountPaid, paid, price, r.id, onMarkedInSession]);

  return (
    <tr className="border-b border-gray-100 bg-white">
      <td className="py-2.5 px-3 text-sm font-medium text-gray-900">
        {dayName} {dayNum} · {timeStr} · {fieldShort}
      </td>
      <td className="py-2.5 px-3 text-sm text-gray-600 font-medium">
        {editingPrice && onUpdatePrice ? (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">S/</span>
            <input
              type="text"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value.replace(/[^\d.,]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSavePrice();
                if (e.key === "Escape") { setEditingPrice(false); setPriceInput(String(price)); }
              }}
              className="w-16 px-1.5 py-0.5 rounded border border-blue-300 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <button onClick={() => void handleSavePrice()} disabled={updating} className="p-1 text-blue-600 hover:bg-blue-50 rounded" title="Guardar">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onUpdatePrice && setEditingPrice(true)}
            className="flex items-center gap-1 group hover:bg-gray-50 rounded px-1 -mx-1 py-0.5"
          >
            S/ {price.toFixed(2)}
            {onUpdatePrice && <span className="text-gray-400">{PENCIL_ICON}</span>}
          </button>
        )}
      </td>
      <td className="py-2.5 px-3 text-center">
        {onUpdateAmountPaid && (
          <label className="inline-flex items-center justify-center cursor-pointer" title={paid >= price ? "Quitar pago" : "Marcar como pagado"}>
            <input
              type="checkbox"
              checked={paid >= price && price > 0}
              onChange={(e) => void handleTogglePaid(e.target.checked)}
              disabled={updating || paymentLoading}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500 w-5 h-5 cursor-pointer"
            />
          </label>
        )}
      </td>
    </tr>
  );
});

// ─── Cobros Tab Content ─────────────────────────────────────────────────────

const CobrosTabContent = memo(function CobrosTabContent({
  allClientReservations,
  reservation,
  courtConfigs,
  transfers,
  invoices,
  loading,
  emittingInvoiceId,
  attachingInvoiceId,
  onVerifyTransfer,
  onEmitInvoice,
  onAttachInvoice,
  onDetachInvoice,
  onVoidSunatInvoice,
  onRevokeManualPayment,
  onRegisterPayment,
  onToggleApplied,
  onUpdatePrice,
  onUpdateAmountPaid,
  paymentLoading,
  chatId,
  clientDni,
  clientRuc,
  setViewingImage,
  setHoveredTransferId,
}: {
  allClientReservations: Reservation[];
  reservation: Reservation;
  courtConfigs?: CourtFieldConfig[] | null;
  transfers: Transfer[];
  invoices: Invoice[];
  loading: boolean;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  onVerifyTransfer: (id: string, verified: boolean) => void;
  onEmitInvoice: (t: Transfer, p: EmitComprobanteParams) => void;
  onAttachInvoice: (t: Transfer, f: File) => void;
  onDetachInvoice: (id: string) => Promise<boolean>;
  onVoidSunatInvoice?: (invoiceId: string) => Promise<boolean>;
  onRevokeManualPayment: (id: string) => void;
  onRegisterPayment: (reservationId: string | null, amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  onToggleApplied: (transferId: string, applied: boolean) => void;
  onUpdatePrice?: (totalPrice: number, reservationId?: string) => Promise<boolean>;
  onUpdateAmountPaid?: (amountPaid: number, reservationId?: string) => Promise<boolean>;
  paymentLoading: boolean;
  chatId: string;
  clientDni?: string | null;
  clientRuc?: string | null;
  setViewingImage: (src: string) => void;
  setHoveredTransferId: (id: string | null) => void;
}) {
  const resDate = new Date(reservation.date + "T12:00:00");
  const day = resDate.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(resDate);
  mon.setDate(mon.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const weekStart = mon.toISOString().slice(0, 10);
  const weekEnd = sun.toISOString().slice(0, 10);

  const [modifiedInSessionReservationIds, setModifiedInSessionReservationIds] = useState<Set<string>>(new Set());
  const [modifiedInSessionTransferIds, setModifiedInSessionTransferIds] = useState<Set<string>>(new Set());

  const visibleReservations = useMemo(() => {
    const isPaid = (r: Reservation) => (r.amount_paid ?? 0) >= (r.total_price ?? 0) && (r.total_price ?? 0) > 0;
    const isThisWeek = (d: string) => d >= weekStart && d <= weekEnd;
    return allClientReservations.filter(
      (r) => !isPaid(r) || isThisWeek(r.date) || modifiedInSessionReservationIds.has(r.id)
    );
  }, [allClientReservations, weekStart, weekEnd, modifiedInSessionReservationIds]);

  const allOrdered = useMemo(() => {
    const past = visibleReservations.filter((r) => r.date < weekStart);
    const thisWeekRes = visibleReservations.filter((r) => r.date >= weekStart && r.date <= weekEnd);
    const future = visibleReservations.filter((r) => r.date > weekEnd);
    return [...past, ...thisWeekRes, ...future];
  }, [visibleReservations, weekStart, weekEnd]);

  const totalCost = useMemo(() => allClientReservations.reduce((s, r) => s + (r.total_price ?? 0), 0), [allClientReservations]);
  const totalPaid = useMemo(() => allClientReservations.reduce((s, r) => s + (r.amount_paid ?? 0), 0), [allClientReservations]);
  const totalRemaining = Math.max(0, totalCost - totalPaid);
  const reservationsWithDebt = useMemo(
    () => allClientReservations.filter((r) => (r.total_price ?? 0) - (r.amount_paid ?? 0) > 0),
    [allClientReservations]
  );
  const reservationsForPayment = useMemo(
    () =>
      allClientReservations.filter(
        (r) => r.status !== "cancelled" && r.status !== "expired"
      ),
    [allClientReservations]
  );

  const pendingByPeriod = useMemo(() => {
    const addDays = (dateStr: string, days: number) => {
      const d = new Date(dateStr + "T12:00:00");
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const lastWeekStart = addDays(weekStart, -7);
    const lastWeekEnd = addDays(weekEnd, -7);
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;
    const getPeriodLabel = (dateStr: string): string => {
      if (dateStr >= weekStart && dateStr <= weekEnd) return "Esta semana";
      if (dateStr >= lastWeekStart && dateStr <= lastWeekEnd) return "Semana pasada";
      const d = new Date(dateStr + "T12:00:00");
      return monthNames[d.getMonth()] + " " + d.getFullYear();
    };
    return reservationsWithDebt.reduce((acc, r) => {
      const pending = Math.max(0, (r.total_price ?? 0) - (r.amount_paid ?? 0));
      const label = getPeriodLabel(r.date);
      acc[label] = (acc[label] ?? 0) + pending;
      return acc;
    }, {} as Record<string, number>);
  }, [reservationsWithDebt, weekStart, weekEnd]);

  const clientSearch = String(reservation.phone_number || reservation.chat_id || "").replace(/\D/g, "").slice(-9);
  const historicoUrl = `/verificacion?search=${encodeURIComponent(clientSearch)}`;

  /** Ventana de fechas para pagos: 1 semana atrás y 1 semana adelante desde hoy (no la semana de la reserva). */
  const { transferWindowStart, transferWindowEnd } = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    return {
      transferWindowStart: start.toISOString().slice(0, 10),
      transferWindowEnd: end.toISOString().slice(0, 10),
    };
  }, []);

  const filteredTransfers = useMemo(() => transfers.filter((t) => {
    const isApplied = t.applied ?? (t.status === "applied" || t.status === "partial");
    const transferDate = t.created_at?.split?.("T")?.[0] ?? "";
    const isInWindow = transferDate >= transferWindowStart && transferDate <= transferWindowEnd;
    const hasInvoice = invoices.some((inv) => inv.transfer_id === t.id);
    const canEmitBoleta = (t.amount ?? 0) > 0 && !hasInvoice;
    return !isApplied || isInWindow || modifiedInSessionTransferIds.has(t.id) || canEmitBoleta;
  }), [transfers, transferWindowStart, transferWindowEnd, modifiedInSessionTransferIds, invoices]);

  const handleMarkedInSession = useCallback((id: string) => {
    setModifiedInSessionReservationIds((prev) => new Set(prev).add(id));
  }, []);

  const handleToggleAppliedWithSession = useCallback((id: string, applied: boolean) => {
    onToggleApplied(id, applied);
    if (applied) setModifiedInSessionTransferIds((prev) => new Set(prev).add(id));
  }, [onToggleApplied]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Resumen: enfoque en lo que falta por cobrar */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
        <div className={`rounded-xl px-4 py-4 text-center border-2 min-h-[7.5rem] flex flex-col justify-center ${totalRemaining <= 0 ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}`}>
          <p className={`text-xs font-bold uppercase tracking-wide ${totalRemaining <= 0 ? "text-green-600" : "text-orange-600"}`}>Por cobrar</p>
          <p className={`text-2xl font-bold mt-1 ${totalRemaining <= 0 ? "text-green-700" : "text-orange-600"}`}>S/ {totalRemaining.toFixed(2)}</p>
          {Object.keys(pendingByPeriod).length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 text-xs font-medium text-gray-600">
              {Object.entries(pendingByPeriod)
                .sort(([a], [b]) => {
                  const order = ["Esta semana", "Semana pasada"];
                  const ai = order.indexOf(a);
                  const bi = order.indexOf(b);
                  if (ai >= 0 && bi >= 0) return ai - bi;
                  if (ai >= 0) return -1;
                  if (bi >= 0) return 1;
                  return a.localeCompare(b);
                })
                .map(([label, amt]) => (
                  <span key={label}>{label}: S/ {amt.toFixed(2)}</span>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabla de reservas con headers */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50">
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Reservas del cliente</h4>
            <a
              href={historicoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Ver histórico
            </a>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  <th className="py-2.5 px-3 text-xs font-bold text-gray-500 uppercase">Reserva</th>
                  <th className="py-2.5 px-3 text-xs font-bold text-gray-500 uppercase">Precio</th>
                  <th className="py-2.5 px-3 text-xs font-bold text-gray-500 uppercase text-center w-14">Pagado</th>
                </tr>
              </thead>
              <tbody>
                {allOrdered.map((r) => (
                  <ReservationRow
                    key={r.id}
                    r={r}
                    onUpdatePrice={onUpdatePrice}
                    onUpdateAmountPaid={onUpdateAmountPaid}
                    onMarkedInSession={handleMarkedInSession}
                    paymentLoading={paymentLoading}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Registrar pago + Últimos pagos */}
        <section className="space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Últimos pagos</h4>
          <div className="flex flex-col gap-4">
            <RegisterPaymentFormCobros
              reservationsForPayment={reservationsForPayment}
              totalRemaining={totalRemaining}
              loading={paymentLoading}
              onSubmit={onRegisterPayment}
            />
          {loading && transfers.length === 0 ? (
            <><SkeletonCard /><SkeletonCard /></>
          ) : transfers.length > 0 ? (
            <PaymentAccordionList
              transfers={filteredTransfers}
              invoices={invoices}
              allClientReservations={allClientReservations}
              courtConfigs={courtConfigs ?? null}
              emittingInvoiceId={emittingInvoiceId}
              attachingInvoiceId={attachingInvoiceId}
              onVerifyTransfer={onVerifyTransfer}
              onEmitInvoice={onEmitInvoice}
              onAttachInvoice={onAttachInvoice}
              onDetachInvoice={onDetachInvoice}
              onVoidSunatInvoice={onVoidSunatInvoice}
              onRevokeManualPayment={onRevokeManualPayment}
              onToggleApplied={handleToggleAppliedWithSession}
              onViewImage={setViewingImage}
              onHover={setHoveredTransferId}
              chatId={chatId}
              clientDni={clientDni}
              clientRuc={clientRuc}
            />
          ) : (
            <div className="p-8 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-white">
              <p className="text-gray-500 font-medium">No hay pagos registrados</p>
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
});

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

const PaymentSidebar = memo(function PaymentSidebar({
  reservation,
  transfers,
  invoices,
  loading,
  emittingInvoiceId,
  attachingInvoiceId,
  paymentLoading,
  onVerifyTransfer,
  onEmitInvoice,
  onAttachInvoice,
  onDetachInvoice,
  onVoidSunatInvoice,
  onUpdateDni,
  onUpdateRuc,
  onUpdateName,
  clientRuc,
  onCancelReservation,
  displayName,
  userCustomName,
  onRevokeManualPayment,
  onRegisterPayment,
  onToggleApplied,
  onUpdatePrice,
  onUpdateAmountPaid,
  clientType,
  clientTypeLoading = false,
  clientTypeUpdating = false,
  onUpdateClientType,
  onUpdateStatus,
  statusUpdating = false,
  cancellingReservation = false,
  onClose,
  courtConfigs,
  allReservationsThisWeek = [],
  allClientReservations = [],
  onSelectReservationFromList,
}: PaymentSidebarProps) {
  const [activeTab, setActiveTab] = useState<"detalles" | "cobros">("detalles");
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const fieldConfig = useMemo(
    () => (reservation.field && courtConfigs?.length ? courtConfigs.find((c) => c.field === reservation.field) : null),
    [reservation.field, courtConfigs]
  );
  const courtSizeLabel = useMemo(() => (fieldConfig ? getCourtSizeLabel(fieldConfig) : null), [fieldConfig]);
  const [hoveredTransferId, setHoveredTransferId] = useState<string | null>(null);
  const [editingDni, setEditingDni] = useState(false);
  const [dniValue, setDniValue] = useState(reservation.dni || "");
  const [editingRuc, setEditingRuc] = useState(false);
  const [rucValue, setRucValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const effectiveDisplayName = displayName ?? reservation.representative_name ?? "";
  const initialNameForEdit = userCustomName ?? effectiveDisplayName;
  const [nameValue, setNameValue] = useState(initialNameForEdit);
  const [, setTick] = useState(0);

  // Refrescar aviso de tiempo de gracia cada 30s cuando la reserva es pendiente
  useEffect(() => {
    if (reservation.status !== "pending") return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [reservation.status, reservation.id]);

  // Ctrl+V / paste: adjuntar boleta desde clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files || []).find(
        (f) => f.type === "application/pdf"
      );
      if (!file) return;

      const eligibleTransfers = transfers.filter(
        (t) => (t.verified || t.source === "manual" || t.source === "manual_adjustment") && (t.amount ?? 0) > 0 && !invoices.find((inv) => inv.transfer_id === t.id)
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
  useEffect(() => {
    setRucValue(clientRuc || "");
    setEditingRuc(false);
  }, [reservation.id, clientRuc]);
  useEffect(() => {
    setNameValue(userCustomName ?? displayName ?? reservation.representative_name ?? "");
    setEditingName(false);
  }, [reservation.id, userCustomName, displayName, reservation.representative_name]);

  const hasMultipleReservations = allReservationsThisWeek.length > 1;

  return (
    <>
      {/* Backdrop (sin blur para mejor rendimiento) */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Sidebar (contain para aislar repaints) */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl bg-white shadow-2xl flex flex-col animate-slide-in-right" style={{ contain: "layout paint" }}>
        {/* Aviso tiempo de gracia (solo pendientes) */}
        {reservation.status === "pending" && (() => {
          if (reservation.manual_pending) {
            return (
              <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
                <p className="text-sm font-semibold text-amber-900">
                  Esta reserva no ha sido confirmada. Se liberará solo cuando la canceles manualmente.
                </p>
              </div>
            );
          }
          const expiryTime = getPendingExpiryTimeFormatted(reservation);
          if (!expiryTime) {
            return (
              <div className="px-6 py-3 bg-red-50 border-b border-red-200">
                <p className="text-sm font-semibold text-red-800">
                  ⚠️ Esta reserva ya expiró. Será liberada por el sistema.
                </p>
              </div>
            );
          }
          return (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
              <p className="text-sm font-semibold text-amber-900">
                ⏱️ El cliente tiene hasta las <span className="font-bold">{expiryTime}</span> para confirmar; si no, esta reserva será liberada.
              </p>
            </div>
          );
        })()}

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-gray-900">
                {activeTab === "detalles" ? "Detalle de reserva" : "Gestionar cobros"}
              </h3>
              {activeTab === "detalles" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-500">
                  <span className="font-semibold text-gray-700">
                    {reservation.field
                      ? courtSizeLabel
                        ? `Cancha ${reservation.field} · ${courtSizeLabel}`
                        : `Cancha ${reservation.field}`
                      : "Sin cancha"}
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
              )}
              {activeTab === "cobros" && (
                <p className="mt-1 text-sm text-gray-500">{effectiveDisplayName || "Cliente"}</p>
              )}
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
          {/* Tabs: siempre visibles para acceder al histórico de cobros */}
          <div className="flex gap-1 mt-4 p-1 bg-gray-200 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab("detalles")}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === "detalles" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Detalles
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cobros")}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === "cobros" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Cobros
            </button>
          </div>
        </div>

        {activeTab === "detalles" ? (
          <ReservationDetailContent
            reservation={reservation}
            courtConfigs={courtConfigs}
            clientData={{
              userCustomName,
              effectiveDisplayName,
              editingName,
              nameValue,
              setNameValue,
              setEditingName,
              onUpdateName,
              editingDni,
              dniValue,
              setDniValue,
              setEditingDni,
              onUpdateDni,
              editingRuc,
              rucValue,
              setRucValue,
              setEditingRuc,
              onUpdateRuc,
              clientType,
              clientTypeLoading,
              clientTypeUpdating,
              statusUpdating,
              cancellingReservation,
            }}
            onUpdatePrice={onUpdatePrice}
            onUpdateAmountPaid={onUpdateAmountPaid}
            onUpdateStatus={onUpdateStatus}
            onUpdateClientType={onUpdateClientType}
            onCancelReservation={onCancelReservation}
            transferHandlers={{
              transfers,
              invoices,
              loading,
              emittingInvoiceId,
              attachingInvoiceId,
              paymentLoading,
              onVerifyTransfer,
              onEmitInvoice,
              onAttachInvoice,
              onDetachInvoice,
              onVoidSunatInvoice,
              onRevokeManualPayment,
              onRegisterPayment,
              onViewImage: (url) => setViewingImage(url),
              onHoverTransferChanged: setHoveredTransferId,
              chatId: reservation.chat_id || reservation.phone_number || "",
              clientDni: reservation.dni,
              clientRuc: clientRuc ?? undefined,
            }}
            reservationsForChips={hasMultipleReservations ? allReservationsThisWeek : undefined}
            onSelectReservationFromChips={hasMultipleReservations ? onSelectReservationFromList : undefined}
            hidePaymentsSection
          />
        ) : null}
        {activeTab === "cobros" && (
          <CobrosTabContent
            allClientReservations={allClientReservations}
            reservation={reservation}
            courtConfigs={courtConfigs}
            transfers={transfers}
            invoices={invoices}
            loading={loading}
            emittingInvoiceId={emittingInvoiceId}
            attachingInvoiceId={attachingInvoiceId}
            onVerifyTransfer={onVerifyTransfer}
            onEmitInvoice={onEmitInvoice}
            onAttachInvoice={onAttachInvoice}
            onDetachInvoice={onDetachInvoice}
            onVoidSunatInvoice={onVoidSunatInvoice}
            onRevokeManualPayment={onRevokeManualPayment}
            onRegisterPayment={onRegisterPayment}
            onToggleApplied={onToggleApplied ?? (() => {})}
            onUpdatePrice={onUpdatePrice}
            onUpdateAmountPaid={onUpdateAmountPaid}
            paymentLoading={paymentLoading}
            chatId={reservation.chat_id || reservation.phone_number || ""}
            clientDni={reservation.dni}
            clientRuc={clientRuc ?? undefined}
            setViewingImage={setViewingImage}
            setHoveredTransferId={setHoveredTransferId}
          />
        )}
      </div>

      {viewingImage && <ImageViewer src={viewingImage} onClose={() => setViewingImage(null)} />}
    </>
  );
});

export default PaymentSidebar;
