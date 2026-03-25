"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import { PdfPreviewThumbnail } from "@/components/PdfPreviewThumbnail";
import { invoicePlantillaPdfHref } from "@/features/boletas/utils/invoicePdfLinks";
import { invoiceComprobantePdfDownloadFilename } from "@/features/boletas/utils/comprobantePdfFilename";
import { EmitInvoiceModal } from "./EmitInvoiceModal";
import { Transfer, Invoice, Reservation, PaymentMethod, ClientType, CLIENT_TYPE_LABELS, STATUS_LABELS, getPendingExpiryTimeFormatted, type ReservationStatus, type EmitComprobanteParams } from "@/lib/types";
import type { CourtFieldConfig } from "@/lib/court-config";
import { getCourtSizeLabel } from "@/lib/court-config";
import {
  calculateReservationPrice,
  courtConfigsToMap,
  formatDisplayPhone,
  isValidPeruPhone,
  normalizePeruPhone,
  wspLink,
} from "@/features/operaciones/utils";
import { WHATSAPP_ICON_PATH as WSP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { RegisterPaymentFormCobros } from "./RegisterPaymentFormCobros";

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
  /** DNI guardado en el perfil del usuario (mismo WhatsApp), si la reserva no trae DNI. */
  clientLastDni?: string | null;
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

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes–domingo (ISO local) de la semana calendario que contiene la fecha de la reserva. */
function reservationWeekMonSun(reservationDateYmd: string): { weekStart: string; weekEnd: string } {
  const resDate = new Date(reservationDateYmd + "T12:00:00");
  const day = resDate.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(resDate);
  mon.setDate(mon.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return { weekStart: mon.toISOString().slice(0, 10), weekEnd: sun.toISOString().slice(0, 10) };
}

function transferDateYmd(t: Transfer): string {
  const iso = typeof t.created_at === "string" ? t.created_at.split("T")[0] : "";
  return iso.length >= 10 ? iso.slice(0, 10) : "";
}

// ─── Vista simplificada (1 reserva) ───────────────────────────────────────────
// Tab Detalles: cliente, controles, resumen financiero. Registrar pago vive en tab Cobros.

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

interface ReservationDetailContentProps {
  reservation: Reservation;
  courtConfigs?: CourtFieldConfig[] | null;
  clientData: SimplifiedPaymentClientData;
  onUpdatePrice?: (totalPrice: number, reservationId?: string) => Promise<boolean>;
  onUpdateAmountPaid?: (amountPaid: number, reservationId?: string) => Promise<boolean>;
  onUpdateStatus?: (status: "pending" | "confirmed") => Promise<boolean>;
  onUpdateClientType: (clientType: ClientType) => Promise<boolean>;
  onCancelReservation: () => Promise<boolean>;
  /** Chips para cambiar de reserva cuando el cliente tiene 2+ reservas esta semana. */
  reservationsForChips?: Reservation[];
  onSelectReservationFromChips?: (r: Reservation) => void;
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
  reservationsForChips,
  onSelectReservationFromChips,
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
  const configMap = useMemo(() => courtConfigsToMap(courtConfigs), [courtConfigs]);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(reservation.total_price ?? 0));
  const [priceUpdating, setPriceUpdating] = useState(false);
  const [editingAmountPaid, setEditingAmountPaid] = useState(false);
  const [amountPaidInput, setAmountPaidInput] = useState(String(reservation.amount_paid ?? 0));
  const [amountPaidUpdating, setAmountPaidUpdating] = useState(false);
  const [editingDebt, setEditingDebt] = useState(false);
  const [debtInput, setDebtInput] = useState("");
  const [debtUpdating, setDebtUpdating] = useState(false);

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

  useEffect(() => {
    if (editingDebt) return;
    setDebtInput(remaining.toFixed(2));
  }, [reservation.id, reservation.total_price, reservation.amount_paid, remaining, editingDebt]);

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

  async function handleSaveDebt() {
    if (!onUpdateAmountPaid) return;
    const parsedDebt = parseFloat(debtInput.replace(",", "."));
    if (isNaN(parsedDebt) || parsedDebt < 0) return;
    const newPaid = Math.max(0, totalPrice - parsedDebt);
    setDebtUpdating(true);
    const ok = await onUpdateAmountPaid(newPaid);
    setDebtUpdating(false);
    if (ok) setEditingDebt(false);
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
                <p className="text-xs text-blue-600/90">
                  Valor manual: no se infiere desde cobros ni crea pagos nuevos.
                </p>
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
            {onUpdateAmountPaid && !isCancelled && editingDebt ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center justify-center gap-1">
                  <span className={`text-lg font-bold ${fullyPaid ? "text-green-700" : "text-red-600"}`}>S/</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={debtInput}
                    onChange={(e) => setDebtInput(e.target.value.replace(/[^\d.,]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveDebt();
                      if (e.key === "Escape") {
                        setEditingDebt(false);
                        setDebtInput(remaining.toFixed(2));
                      }
                    }}
                    className={`w-20 text-lg font-bold border-b-2 bg-transparent focus:outline-none text-center ${
                      fullyPaid ? "text-green-700 border-green-500" : "text-red-600 border-red-500"
                    }`}
                    autoFocus
                  />
                  <button
                    onClick={() => void handleSaveDebt()}
                    disabled={debtUpdating}
                    className="text-xs px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {debtUpdating ? "..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => {
                      setEditingDebt(false);
                      setDebtInput(remaining.toFixed(2));
                    }}
                    disabled={debtUpdating}
                    className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700 disabled:opacity-50"
                    title="Cancelar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Al guardar, Pagado = Total − Deuda (ej. deuda 0 → pagado completo).
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1">
                <p className={`text-lg font-bold ${fullyPaid ? "text-green-700" : "text-red-600"}`}>
                  S/ {remaining.toFixed(2)}
                </p>
                {onUpdateAmountPaid && !isCancelled && (
                  <button
                    onClick={() => setEditingDebt(true)}
                    className={`p-1 rounded-md hover:opacity-90 ${fullyPaid ? "text-green-600 hover:bg-green-100" : "text-red-600 hover:bg-red-100"}`}
                    title="Editar deuda"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {showChips && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
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
                    className={`min-w-[10rem] rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                      isCurrent
                        ? "bg-amber-500 text-white shadow-sm"
                        : "border border-amber-200 bg-white text-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function cobrosTransferVerifiedLike(t: Transfer): boolean {
  return !!(t.verified || t.source === "manual" || t.source === "manual_adjustment");
}

function cobrosCanEmitOrAttachComprobante(t: Transfer, invoice?: Invoice): boolean {
  if (invoice) return false;
  return cobrosTransferVerifiedLike(t) && (t.amount ?? 0) > 0;
}

// ─── Fila Cobros: preview pago + columna boleta (misma rejilla que el skeleton) ─

const CobrosNearbyPaymentRow = memo(function CobrosNearbyPaymentRow({
  transfer,
  invoice,
  emittingInvoiceId,
  attachingInvoiceId,
  onVerify,
  onToggleApplied,
  onRevoke,
  onViewImage,
  onRequestEmit,
  onAttachInvoice,
  onDetachInvoice,
}: {
  transfer: Transfer;
  invoice?: Invoice;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  onVerify: (id: string, verified: boolean) => void;
  onToggleApplied: (id: string, applied: boolean) => void;
  onRevoke: (id: string) => void;
  onViewImage: (url: string) => void;
  onRequestEmit: (t: Transfer) => void;
  onAttachInvoice: (t: Transfer, file: File) => void;
  onDetachInvoice: (id: string) => Promise<boolean>;
}) {
  const isManualLike = transfer.source === "manual" || transfer.source === "manual_adjustment";
  void onToggleApplied;
  void onRevoke;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const proxy = transfer.media_url
    ? `/api/proxy-file?url=${encodeURIComponent(transfer.media_url)}`
    : null;
  const pdfHref = invoice ? invoicePlantillaPdfHref(invoice) : null;
  const canComprobante = cobrosCanEmitOrAttachComprobante(transfer, invoice);
  const emitting = emittingInvoiceId === transfer.id;
  const attaching = attachingInvoiceId === transfer.id;

  const [wspStatus, setWspStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [wspError, setWspError] = useState<string | null>(null);
  const wspInFlightRef = useRef(false);

  useEffect(() => {
    setWspStatus("idle");
    setWspError(null);
  }, [invoice?.id]);

  const hasWspPdf = Boolean(
    invoice && (pdfHref || String(invoice.file_url || "").trim())
  );
  const wspChatId = invoice
    ? String(invoice.phone_number || transfer.phone_number || "").trim()
    : "";

  const sendInvoiceWsp = useCallback(async () => {
    if (!invoice || !hasWspPdf) return;
    const chatId = wspChatId;
    if (!chatId) {
      setWspStatus("error");
      setWspError("Falta teléfono para WhatsApp.");
      return;
    }
    if (wspInFlightRef.current) return;
    wspInFlightRef.current = true;
    setWspStatus("sending");
    setWspError(null);
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          invoice_id: invoice.id,
          filename: invoiceComprobantePdfDownloadFilename(invoice),
        }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo enviar.");
      }
      setWspStatus("sent");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === "TimeoutError" || err.message.includes("aborted")
            ? "Tiempo de espera agotado al enviar."
            : err.message
          : "No se pudo enviar.";
      setWspStatus("error");
      setWspError(msg);
    } finally {
      wspInFlightRef.current = false;
    }
  }, [invoice, hasWspPdf, wspChatId]);

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200 bg-white">
      <div className="grid grid-cols-2 border-b-2 border-gray-200 bg-gray-50/50">
        <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-600">Pago</div>
        <div className="border-l-2 border-gray-200 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-600">
          Boleta emitida
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="space-y-3 border-b-2 border-gray-200 p-4 sm:border-b-0 sm:border-r-2 sm:p-5">
          {proxy ? (
            <button
              type="button"
              onClick={() => onViewImage(proxy)}
              className="group relative block w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-gray-100 focus:outline-none focus:ring-2 focus:ring-field-dark/30"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proxy}
                alt=""
                className="aspect-[4/3] w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]"
              />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/0 transition-colors duration-200 group-hover:bg-black/50">
                <span className="max-w-[90%] rounded-lg bg-black/75 px-3 py-2 text-center text-xs font-bold leading-snug text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 sm:text-sm">
                  Clic para ampliar la captura
                </span>
              </div>
            </button>
          ) : (
            <div className="flex aspect-[4/3] w-full max-w-md items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400">
              Sin captura
            </div>
          )}
          <div>
            <p className="text-xl font-bold tabular-nums text-gray-900">S/ {(transfer.amount ?? 0).toFixed(2)}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {formatTransferDate(transfer.created_at)} · {formatTransferTime(transfer.created_at)}
              <span className="mx-1 text-gray-300">·</span>
              {transfer.source === "manual"
                ? "caja"
                : transfer.source === "manual_adjustment"
                  ? "ajuste"
                  : "digital"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Checkbox «Aplicado» oculto en Cobros (al restaurar: const isApplied = transfer.applied ?? …)
            …
            */}
            {!isManualLike && (
              <button
                type="button"
                onClick={() => onVerify(transfer.id, !!transfer.verified)}
                className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold sm:flex-none ${
                  transfer.verified
                    ? "border-2 border-gray-200 text-gray-700 hover:bg-gray-50"
                    : "bg-field-dark text-white hover:opacity-95"
                }`}
              >
                {transfer.verified ? (
                  "Quitar validación"
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Validar pago
                  </>
                )}
              </button>
            )}
            {/* Botón «Desvincular» oculto en Cobros … */}
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-3 p-4 sm:p-5">
          {invoice ? (
            <>
              {pdfHref ? (
                <div className="mx-auto w-full max-w-[220px]">
                  <PdfPreviewThumbnail url={pdfHref} onClickPreview={onViewImage} variant="full" />
                </div>
              ) : (
                <div className="flex min-h-[160px] w-full items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-3 text-center text-sm text-amber-900">
                  Hay comprobante registrado, pero no hay PDF para previsualizar.
                </div>
              )}
              <div className="text-center">
                {invoice.serie_correlativo ? (
                  <p className="font-mono text-sm font-semibold text-indigo-900">{invoice.serie_correlativo}</p>
                ) : null}
                {pdfHref ? (
                  <a
                    href={pdfHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Abrir PDF
                  </a>
                ) : null}
              </div>
              {hasWspPdf ? (
                <div className="flex flex-col items-stretch gap-1">
                  <button
                    type="button"
                    title={!wspChatId ? "Falta teléfono" : "Enviar por WhatsApp"}
                    disabled={!wspChatId || wspStatus === "sending" || wspStatus === "sent"}
                    onClick={() => void sendInvoiceWsp()}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
                      wspStatus === "sent"
                        ? "border-green-200 bg-green-50 text-green-800"
                        : wspStatus === "error"
                          ? "border-red-200 bg-red-50 text-red-800"
                          : "border-green-600 bg-green-600 text-white hover:bg-green-700"
                    } disabled:opacity-70`}
                  >
                    {wspStatus === "sending" ? (
                      "Enviando…"
                    ) : wspStatus === "sent" ? (
                      "Enviado"
                    ) : wspStatus === "error" ? (
                      <>
                        <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path d={WSP_ICON_PATH} />
                        </svg>
                        Reintentar
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path d={WSP_ICON_PATH} />
                        </svg>
                        Enviar
                      </>
                    )}
                  </button>
                  {wspError ? <p className="text-center text-[10px] leading-tight text-red-600">{wspError}</p> : null}
                </div>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm("¿Quitar este comprobante vinculado a este pago?")) return;
                  await onDetachInvoice(invoice.id);
                }}
                className="mt-auto text-center text-xs font-semibold text-red-600 hover:underline"
              >
                Quitar comprobante
              </button>
            </>
          ) : (
            <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-slate-50/80 px-4 py-6 text-center">
              <svg className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {!canComprobante ? (
                <>
                  <p className="mt-3 text-sm font-semibold text-gray-700">Valida el pago primero</p>
                  <p className="mt-1 text-xs text-gray-500">Después podrás emitir o adjuntar la boleta para este cobro.</p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm font-semibold text-gray-700">Sin boleta en este pago</p>
                  <p className="mt-1 text-xs text-gray-500">Emite desde el panel o adjunta un PDF.</p>
                  <div className="mt-4 flex w-full max-w-xs flex-col gap-2">
                    <button
                      type="button"
                      disabled={emitting}
                      onClick={() => onRequestEmit(transfer)}
                      className="rounded-xl border-2 border-field-dark bg-field-dark px-4 py-2.5 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50"
                    >
                      {emitting ? "Emitiendo…" : "Emitir boleta o factura"}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) onAttachInvoice(transfer, f);
                      }}
                    />
                    <button
                      type="button"
                      disabled={attaching}
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-xl border-2 border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {attaching ? "Adjuntando…" : "Adjuntar PDF"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

type CobrosNearbyAccordionTheme = {
  cardBorder: string;
  header: string;
  headerText: string;
  chevron: string;
  panel: string;
  emptyBox: string;
  emptyText: string;
};

/** Gris: periodo sin pagos en el rango. Ámbar: al menos un pago en ese rango. */
const COBROS_NEARBY_THEME_EMPTY: CobrosNearbyAccordionTheme = {
  cardBorder: "border-gray-300/90",
  header: "bg-gray-300/80 hover:bg-gray-300",
  headerText: "text-gray-900",
  chevron: "text-gray-600",
  panel: "border-t border-gray-200/90 bg-gray-50",
  emptyBox: "rounded-lg border border-dashed border-gray-400/45 bg-gray-200/35",
  emptyText: "text-sm font-medium text-gray-600",
};

const COBROS_NEARBY_THEME_WITH_PAYMENTS: CobrosNearbyAccordionTheme = {
  cardBorder: "border-amber-200/90",
  header: "bg-amber-200/80 hover:bg-amber-200",
  headerText: "text-amber-950",
  chevron: "text-amber-800/85",
  panel: "border-t border-amber-200/85 bg-amber-50",
  emptyBox: "rounded-lg border border-dashed border-amber-400/50 bg-amber-100/55",
  emptyText: "text-sm font-medium text-amber-900/75",
};

// ─── Cobros Tab Content ─────────────────────────────────────────────────────

const CobrosTabContent = memo(function CobrosTabContent({
  allClientReservations,
  reservation,
  transfers,
  invoices,
  loading,
  emittingInvoiceId,
  attachingInvoiceId,
  onVerifyTransfer,
  onRevokeManualPayment,
  onToggleApplied,
  onRequestEmit,
  onAttachInvoice,
  onDetachInvoice,
  chatId,
  setViewingImage,
  paymentLoading,
  onRegisterPayment,
  registerPaymentRemaining,
  registerPaymentClientSummary,
}: {
  allClientReservations: Reservation[];
  reservation: Reservation;
  transfers: Transfer[];
  invoices: Invoice[];
  loading: boolean;
  emittingInvoiceId: string | null;
  attachingInvoiceId: string | null;
  onVerifyTransfer: (id: string, verified: boolean) => void;
  onRevokeManualPayment: (id: string) => void;
  onToggleApplied: (transferId: string, applied: boolean) => void;
  onRequestEmit: (t: Transfer) => void;
  onAttachInvoice: (t: Transfer, file: File) => void;
  onDetachInvoice: (id: string) => Promise<boolean>;
  chatId: string;
  setViewingImage: (src: string) => void;
  paymentLoading: boolean;
  onRegisterPayment: (reservationId: string | null, amount: number, method: PaymentMethod, mediaUrl?: string) => void;
  registerPaymentRemaining: number;
  registerPaymentClientSummary: string;
}) {
  const { weekStart, weekEnd } = useMemo(
    () => reservationWeekMonSun(reservation.date || ""),
    [reservation.date]
  );

  const transfersByPeriod = useMemo(() => {
    const inRange = (start: string, end: string) =>
      transfers
        .filter((t) => {
          const ymd = transferDateYmd(t);
          return ymd >= start && ymd <= end;
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return {
      prev: inRange(addDaysYmd(weekStart, -7), addDaysYmd(weekEnd, -7)),
      same: inRange(weekStart, weekEnd),
      next: inRange(addDaysYmd(weekStart, 7), addDaysYmd(weekEnd, 7)),
    };
  }, [transfers, weekStart, weekEnd]);

  const [openNearby, setOpenNearby] = useState({ prev: true, same: true, next: true });

  const nearbySections = useMemo(
    () =>
      [
        { key: "prev" as const, title: "Pagos recibidos la semana anterior a la reserva", list: transfersByPeriod.prev },
        { key: "same" as const, title: "Pagos recibidos la misma semana de la reserva", list: transfersByPeriod.same },
        { key: "next" as const, title: "Pagos recibidos la semana siguiente a la reserva", list: transfersByPeriod.next },
      ],
    [transfersByPeriod]
  );

  const totalCost = useMemo(
    () => allClientReservations.reduce((s, r) => s + (r.total_price ?? 0), 0),
    [allClientReservations]
  );
  const totalPaid = useMemo(
    () => allClientReservations.reduce((s, r) => s + (r.amount_paid ?? 0), 0),
    [allClientReservations]
  );
  /* eslint-disable @typescript-eslint/no-unused-vars -- UI «Por cobrar» comentada arriba */
  const totalRemaining = Math.max(0, totalCost - totalPaid);
  const reservationsWithDebt = useMemo(
    () => allClientReservations.filter((r) => (r.total_price ?? 0) - (r.amount_paid ?? 0) > 0),
    [allClientReservations]
  );

  const pendingByPeriod = useMemo(() => {
    const lastWeekStart = addDaysYmd(weekStart, -7);
    const lastWeekEnd = addDaysYmd(weekEnd, -7);
    const monthNames = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
      "Noviembre", "Diciembre",
    ] as const;
    const getPeriodLabel = (dateStr: string): string => {
      if (dateStr >= weekStart && dateStr <= weekEnd) return "Esta semana";
      if (dateStr >= lastWeekStart && dateStr <= lastWeekEnd) return "Semana pasada";
      const d = new Date(dateStr + "T12:00:00");
      return monthNames[d.getMonth()] + " " + d.getFullYear();
    };
    return reservationsWithDebt.reduce(
      (acc, r) => {
        const pending = Math.max(0, (r.total_price ?? 0) - (r.amount_paid ?? 0));
        const label = getPeriodLabel(r.date);
        acc[label] = (acc[label] ?? 0) + pending;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [reservationsWithDebt, weekStart, weekEnd]);
  /* eslint-enable @typescript-eslint/no-unused-vars */

  const digits = String(reservation.phone_number || reservation.chat_id || chatId || "").replace(/\D/g, "");
  const phoneForSearch =
    digits.length >= 9 ? normalizePeruPhone(digits) : digits.length > 0 ? digits : chatId.replace(/\D/g, "");

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Por cobrar (cliente): oculto para probar layout sin monto agregado
      <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div
          className={`flex min-h-[7.5rem] flex-col justify-center rounded-xl border-2 px-4 py-4 text-center ${
            totalRemaining <= 0 ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"
          }`}
        >
          <p
            className={`text-xs font-bold uppercase tracking-wide ${
              totalRemaining <= 0 ? "text-green-600" : "text-orange-600"
            }`}
          >
            Por cobrar
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              totalRemaining <= 0 ? "text-green-700" : "text-orange-600"
            }`}
          >
            S/ {totalRemaining.toFixed(2)}
          </p>
          {Object.keys(pendingByPeriod).length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs font-medium text-gray-600">
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
                  <span key={label}>
                    {label}: S/ {amt.toFixed(2)}
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>
      */}

      <div className="flex-1 space-y-6 overflow-y-auto bg-gray-50 p-6">
        <section className="rounded-xl border-2 border-blue-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Registrar pago</p>
          <RegisterPaymentFormCobros
            reservationsForPayment={[reservation]}
            totalRemaining={registerPaymentRemaining}
            loading={paymentLoading}
            onSubmit={onRegisterPayment}
            buttonLabel="Registrar pago"
            presentation="viewportModal"
            assumeClientFromContext
            clientSummaryLine={registerPaymentClientSummary || undefined}
            amountHelperText={`Pendiente en esta reserva: S/ ${registerPaymentRemaining.toFixed(2)}`}
            allowWithoutReservation={false}
          />
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500">
              Pagos cerca de la fecha de la reserva
            </h4>
            <Link
              href={`/pagos-recibidos?search=${encodeURIComponent(phoneForSearch)}`}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Ver histórico
            </Link>
          </div>

          <div className="space-y-2">
            {nearbySections.map(({ key, title, list }) => {
              const open = openNearby[key];
              const th = list.length > 0 ? COBROS_NEARBY_THEME_WITH_PAYMENTS : COBROS_NEARBY_THEME_EMPTY;
              return (
                <div
                  key={key}
                  className={`overflow-hidden rounded-xl border shadow-sm ${th.cardBorder}`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenNearby((o) => ({ ...o, [key]: !o[key] }))}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-bold transition-colors ${th.header} ${th.headerText} ${
                      open ? "rounded-t-xl" : "rounded-xl"
                    }`}
                  >
                    <span>{title}</span>
                    <svg
                      className={`h-5 w-5 shrink-0 transition-transform ${th.chevron} ${open ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {open && (
                    <div className={`space-y-2 rounded-b-xl px-3 py-4 sm:px-4 ${th.panel}`}>
                      {loading && list.length === 0 ? (
                        <>
                          <CobrosPaymentRowSkeleton />
                          <CobrosPaymentRowSkeleton />
                        </>
                      ) : list.length > 0 ? (
                        list.map((t) => {
                          const inv = invoices.find((i) => i.transfer_id === t.id);
                          return (
                            <CobrosNearbyPaymentRow
                              key={t.id}
                              transfer={t}
                              invoice={inv}
                              emittingInvoiceId={emittingInvoiceId}
                              attachingInvoiceId={attachingInvoiceId}
                              onVerify={onVerifyTransfer}
                              onToggleApplied={onToggleApplied}
                              onRevoke={onRevokeManualPayment}
                              onViewImage={setViewingImage}
                              onRequestEmit={onRequestEmit}
                              onAttachInvoice={onAttachInvoice}
                              onDetachInvoice={onDetachInvoice}
                            />
                          );
                        })
                      ) : (
                        <div className={`px-4 py-6 text-center ${th.emptyBox}`}>
                          <p className={th.emptyText}>Ningún pago en este rango</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
});

/** Misma rejilla que `CobrosNearbyPaymentRow` (pago | boleta). */
function CobrosPaymentRowSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200 bg-white animate-pulse">
      <div className="grid grid-cols-2 border-b-2 border-gray-200 bg-gray-50/50">
        <div className="px-4 py-2.5 sm:px-5">
          <div className="h-3 w-10 rounded bg-gray-200" />
        </div>
        <div className="border-l-2 border-gray-200 px-4 py-2.5 sm:px-5">
          <div className="h-3 w-28 rounded bg-gray-200" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="space-y-4 border-b-2 border-gray-200 p-4 sm:border-b-0 sm:border-r-2 sm:p-5">
          <div className="aspect-[4/3] max-w-md rounded-xl bg-gray-200" />
          <div className="space-y-2">
            <div className="h-8 w-32 rounded bg-gray-200" />
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-5 w-36 rounded bg-gray-200" />
          </div>
          <div className="h-11 max-w-md rounded-xl bg-gray-200" />
        </div>
        <div className="flex flex-col items-center justify-center gap-3 p-4 sm:p-5">
          <div className="aspect-[3/4] w-full max-w-[200px] rounded-xl bg-gray-200" />
          <div className="h-9 w-36 rounded-xl bg-gray-200" />
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
  onUpdateDni,
  onUpdateRuc,
  onUpdateName,
  clientRuc,
  clientLastDni,
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
  /** DNI para boleta: reserva con 8 dígitos válidos, si no perfil usuario (last_dni). */
  const clientDniForEmit = useMemo(() => {
    const r = String(reservation.dni ?? "").replace(/\D/g, "").slice(0, 8);
    const p = String(clientLastDni ?? "").replace(/\D/g, "").slice(0, 8);
    if (r.length === 8) return r;
    if (p.length === 8) return p;
    return r || p || "";
  }, [reservation.dni, clientLastDni]);

  const [activeTab, setActiveTab] = useState<"detalles" | "cobros">("detalles");
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [emitModalTransfer, setEmitModalTransfer] = useState<Transfer | null>(null);
  const fieldConfig = useMemo(
    () => (reservation.field && courtConfigs?.length ? courtConfigs.find((c) => c.field === reservation.field) : null),
    [reservation.field, courtConfigs]
  );
  const courtSizeLabel = useMemo(() => (fieldConfig ? getCourtSizeLabel(fieldConfig) : null), [fieldConfig]);
  const [editingDni, setEditingDni] = useState(false);
  const [dniValue, setDniValue] = useState(reservation.dni || "");
  const [editingRuc, setEditingRuc] = useState(false);
  const [rucValue, setRucValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const effectiveDisplayName = displayName ?? reservation.representative_name ?? "";

  const registerPaymentRemaining = useMemo(() => {
    const configMap = courtConfigsToMap(courtConfigs ?? null);
    const calculatedPrice =
      reservation.field && reservation.time_slots
        ? calculateReservationPrice(reservation.field, reservation.date, reservation.time_slots, configMap)
        : 0;
    const totalPrice =
      reservation.total_price != null && reservation.total_price >= 0
        ? reservation.total_price
        : calculatedPrice || 0;
    const amountPaid = reservation.amount_paid ?? 0;
    return Math.max(0, totalPrice - amountPaid);
  }, [reservation, courtConfigs]);

  const registerPaymentClientSummary = useMemo(() => {
    const raw =
      reservation.phone_number ||
      String(reservation.chat_id || "")
        .replace(/@.*$/, "")
        .replace(/\D/g, "");
    const norm = raw ? normalizePeruPhone(raw) : "";
    const phone = norm && isValidPeruPhone(norm) ? formatDisplayPhone(norm) : "";
    const name = effectiveDisplayName.trim();
    return [name, phone].filter(Boolean).join(" · ");
  }, [reservation.phone_number, reservation.chat_id, effectiveDisplayName]);

  const initialNameForEdit = userCustomName ?? effectiveDisplayName;
  const [nameValue, setNameValue] = useState(initialNameForEdit);
  const [, setTick] = useState(0);

  // Refrescar aviso de tiempo de gracia cada 30s cuando la reserva es pendiente
  useEffect(() => {
    if (reservation.status !== "pending") return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [reservation.status, reservation.id]);

  // Ctrl+V / paste: adjuntar PDF solo si hay un único pago elegible (sin hover en lista).
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files || []).find((f) => f.type === "application/pdf");
      if (!file) return;

      const eligibleTransfers = transfers.filter(
        (t) =>
          (t.verified || t.source === "manual" || t.source === "manual_adjustment") &&
          (t.amount ?? 0) > 0 &&
          !invoices.find((inv) => inv.transfer_id === t.id)
      );
      if (eligibleTransfers.length !== 1) return;

      e.preventDefault();
      onAttachInvoice(eligibleTransfers[0]!, file);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [transfers, invoices, onAttachInvoice]);
  useEffect(() => {
    const r = String(reservation.dni ?? "").replace(/\D/g, "").slice(0, 8);
    const p = String(clientLastDni ?? "").replace(/\D/g, "").slice(0, 8);
    if (r.length === 8) setDniValue(r);
    else if (p.length === 8) setDniValue(p);
    else setDniValue(String(reservation.dni ?? "").replace(/\D/g, "").slice(0, 8) || p || "");
    setEditingDni(false);
  }, [reservation.id, reservation.dni, clientLastDni]);
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
            reservationsForChips={hasMultipleReservations ? allReservationsThisWeek : undefined}
            onSelectReservationFromChips={hasMultipleReservations ? onSelectReservationFromList : undefined}
          />
        ) : null}
        {activeTab === "cobros" && (
          <CobrosTabContent
            allClientReservations={allClientReservations}
            reservation={reservation}
            transfers={transfers}
            invoices={invoices}
            loading={loading}
            emittingInvoiceId={emittingInvoiceId}
            attachingInvoiceId={attachingInvoiceId}
            onVerifyTransfer={onVerifyTransfer}
            onRevokeManualPayment={onRevokeManualPayment}
            onToggleApplied={onToggleApplied ?? (() => {})}
            onRequestEmit={(t) => setEmitModalTransfer(t)}
            onAttachInvoice={onAttachInvoice}
            onDetachInvoice={onDetachInvoice}
            chatId={reservation.chat_id || reservation.phone_number || ""}
            setViewingImage={setViewingImage}
            paymentLoading={paymentLoading}
            onRegisterPayment={onRegisterPayment}
            registerPaymentRemaining={registerPaymentRemaining}
            registerPaymentClientSummary={registerPaymentClientSummary}
          />
        )}
      </div>

      {emitModalTransfer ? (
        <EmitInvoiceModal
          transfer={emitModalTransfer}
          clientDni={clientDniForEmit || undefined}
          clientRuc={clientRuc ?? undefined}
          initialDescripcion={
            reservation.field
              ? `Alquiler cancha ${reservation.field} · ${reservation.date}`
              : `Reserva · ${reservation.date}`
          }
          initialCliente={displayName ?? reservation.representative_name ?? ""}
          onClose={() => setEmitModalTransfer(null)}
          onEmitInvoice={onEmitInvoice}
          emitting={emittingInvoiceId === emitModalTransfer.id}
          attaching={attachingInvoiceId === emitModalTransfer.id}
        />
      ) : null}

      {viewingImage && <ImageViewer src={viewingImage} onClose={() => setViewingImage(null)} />}
    </>
  );
});

export default PaymentSidebar;
