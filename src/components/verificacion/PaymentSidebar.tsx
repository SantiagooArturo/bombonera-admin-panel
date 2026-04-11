"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import { PdfPreviewThumbnail } from "@/components/PdfPreviewThumbnail";
import { invoicePlantillaPdfHref } from "@/features/boletas/utils/invoicePdfLinks";
import { invoiceComprobantePdfDownloadFilename } from "@/features/boletas/utils/comprobantePdfFilename";
import { EmitInvoiceModal } from "./EmitInvoiceModal";
import { Transfer, Invoice, Reservation, PaymentMethod, ClientType, Note, CLIENT_TYPE_LABELS, STATUS_LABELS, getPendingExpiryTimeFormatted, type ReservationStatus, type EmitComprobanteParams } from "@/lib/types";
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
import { anchorPropsForHref } from "@/lib/internal-href";
import { RegisterPaymentFormCobros } from "./RegisterPaymentFormCobros";
import type { AmountPaidDeltaPrompt } from "./usePaymentSidebar";
import { useToastContext } from "@/components/ClientLayout";
import { buildAttendanceConfirmationMessage } from "@/lib/buildAttendanceConfirmationMessage";

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
  onEmitInvoice: (transfer: Transfer, params: EmitComprobanteParams) => Promise<Invoice | null>;
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
  onToggleRecurrence?: (isRecurrent: boolean, force?: boolean) => Promise<boolean>;
  recurrenceConflict?: {
    ownerName: string;
    ownerId: string;
    slotId: string;
  } | null;
  setRecurrenceConflict?: (val: null) => void;
  recurrenceUpdating?: boolean;
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
  /** Al hacer click en una reserva de la lista: navegar a ella (ej. cambiar día en operaciones). */
  onSelectReservationFromList?: (reservation: Reservation) => void;
  /** Tras «Pagado» + registrar cobro: abrir emisor vinculado al transfer creado. */
  pendingEmitFromAmountEdit?: Transfer | null;
  onClearPendingEmitFromAmountEdit?: () => void;
  /** Subida de «Pagado» con delta > 0: modal en app (no confirm del navegador). */
  amountPaidDeltaPrompt?: AmountPaidDeltaPrompt | null;
  onResolveAmountPaidDeltaPrompt?: (choice: "direct" | "emit") => Promise<boolean>;
  /** Apuntes del cliente. */
  notes?: Note[];
  loadingNotes?: boolean;
  onAddNote?: (content: string) => Promise<void>;
  onEditNote?: (noteId: string, content: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
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

// ─── Modal Recordatorio Asistencia ───────────────────────────────────────────

function AttendanceReminderModal({
  message,
  onMessageChange,
  onSend,
  onClose,
  sending,
}: {
  message: string;
  onMessageChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
  sending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 text-center">Confirmar Recordatorio</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <p className="mb-3 text-sm font-medium text-gray-500">
          Mensaje sugerido (se puede editar):
        </p>
        
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          className="w-full min-h-[120px] rounded-xl border-2 border-gray-100 bg-gray-50 p-4 text-sm font-medium text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all resize-none"
          placeholder="Escribe el mensaje aquí..."
          autoFocus
        />

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onSend}
            disabled={sending || !message.trim()}
            className="inline-flex h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {sending ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Enviando recordatorio...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d={WSP_ICON_PATH} />
                </svg>
                Enviar por WhatsApp
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={sending}
            className="h-[44px] w-full text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function RecurrenceConflictModal({
  conflict,
  onForce,
  onClose,
  loading,
}: {
  conflict: { ownerName: string; ownerId: string; slotId: string };
  onForce: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-xl font-bold">Conflicto de Recurrencia</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-red-50 border border-red-100">
            <p className="text-sm text-red-900 leading-relaxed">
              Este horario ya tiene un dueño recurrente:
            </p>
            <p className="mt-2 text-base font-bold text-red-900">
              {conflict.ownerName} ({conflict.ownerId})
            </p>
          </div>

          <p className="text-sm font-semibold text-gray-700 italic border-l-4 border-amber-400 pl-3 py-1">
            &quot;No puede haber dos personas recurrentes para el mismo horario.&quot;
          </p>

          <div className="pt-2 flex flex-col gap-3">
            <button
              onClick={onForce}
              disabled={loading}
              className="w-full min-h-[56px] px-4 py-2 rounded-xl bg-red-600 font-bold text-white shadow-lg shadow-red-200 hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center text-center"
            >
              {loading ? "Procesando..." : `Quitar recurrencia a ${conflict.ownerName} y asignármela`}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="w-full h-12 rounded-xl bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 transition-all"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
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
  if (h === 23) return "10:50 pm";
  return `${h - 12}:00 pm`;
}

function formatReservationTime(reservation: Reservation) {
  if (!reservation.time_slots?.length) return "—";
  const start = reservation.time_slots[0];
  const lastHour = parseInt(reservation.time_slots[reservation.time_slots.length - 1].split(":")[0]) + 1;
  return `${formatHour12(start)} – ${formatHour12(`${lastHour}:00`)}`;
}

function formatHour12CompactFromHour(hour24: number): string {
  if (hour24 === 23) return "10:50 pm";
  const isPm = hour24 >= 12;
  const hour12 = hour24 % 12 || 12;
  return `${hour12} ${isPm ? "pm" : "am"}`;
}

function formatReservationRangeCompact(reservation: Reservation): string {
  if (!reservation.time_slots?.length) return "—";
  const startHour = Number.parseInt(String(reservation.time_slots[0]).split(":")[0] || "0", 10);
  const lastHourRaw = Number.parseInt(
    String(reservation.time_slots[reservation.time_slots.length - 1]).split(":")[0] || "0",
    10
  );
  const endHour = lastHourRaw + 1;
  return `${formatHour12CompactFromHour(startHour)} a ${formatHour12CompactFromHour(endHour)}`;
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
  /** Incrementar tras guardar «Pagado»/deuda desde el modal de delta para cerrar modo edición. */
  amountPaidEditCloseSignal?: number;
  onUpdatePrice?: (totalPrice: number, reservationId?: string) => Promise<boolean>;
  onUpdateAmountPaid?: (amountPaid: number, reservationId?: string) => Promise<boolean>;
  onUpdateStatus?: (status: "pending" | "confirmed") => Promise<boolean>;
  onUpdateClientType: (clientType: ClientType) => Promise<boolean>;
  onToggleRecurrence?: (isRecurrent: boolean) => Promise<boolean>;
  recurrenceUpdating?: boolean;
  loading: boolean;
  onCancelReservation: () => Promise<boolean>;
  /** Chips para cambiar de reserva cuando el cliente tiene 2+ reservas esta semana. */
  reservationsForChips?: Reservation[];
  onSelectReservationFromChips?: (r: Reservation) => void;
  attendanceReminderLabel: string | null;
  attendanceReminderFetching: boolean;
  attendanceReminderSending: boolean;
  canSendAttendanceReminder: boolean;
  onSendAttendanceReminder: () => void;
}

function ReservationDetailContent({
  reservation,
  courtConfigs,
  clientData,
  amountPaidEditCloseSignal = 0,
  onUpdatePrice,
  onUpdateAmountPaid,
  onUpdateStatus,
  onUpdateClientType,
  onToggleRecurrence,
  recurrenceUpdating = false,
  loading,
  onCancelReservation,
  reservationsForChips,
  onSelectReservationFromChips,
  attendanceReminderLabel,
  attendanceReminderFetching,
  attendanceReminderSending,
  canSendAttendanceReminder,
  onSendAttendanceReminder,
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

  useEffect(() => {
    if (amountPaidEditCloseSignal <= 0) return;
    setEditingAmountPaid(false);
    setEditingDebt(false);
  }, [amountPaidEditCloseSignal]);

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

  const reservationWspHref = reservation.phone_number ? wspLink(reservation.phone_number) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Datos del cliente (pt-10: mismo ritmo visual que la separación hacia Total/Pagado). */}
      <div className="px-6 border-b border-gray-200 bg-white shrink-0 space-y-4 pt-6 pb-4">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] md:items-start md:gap-x-6">
          <div className="flex min-w-0 flex-col space-y-1">
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
            {reservationWspHref ? (
              <a
                href={reservationWspHref}
                {...anchorPropsForHref(reservationWspHref)}
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
            ) : null}
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

          <div className="flex min-w-0 w-full flex-col md:w-auto">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo de cliente</label>
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
                <option value="frecuente">{CLIENT_TYPE_LABELS.frecuente}</option>
                <option value="academia">{CLIENT_TYPE_LABELS.academia}</option>
                <option value="sospechoso_fraude">{CLIENT_TYPE_LABELS.sospechoso_fraude}</option>
              </select>
            )}
          </div>

          <div className="flex min-w-0 w-full flex-col md:w-auto">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-600">¿Horario Recurrente?</label>
            <div className="flex items-center gap-2 h-[42px]">
              <button
                type="button"
                onClick={() => {
                  if (!(recurrenceUpdating || loading)) {
                    onToggleRecurrence?.(!reservation.is_recurrent);
                  }
                }}
                disabled={recurrenceUpdating || loading}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
                  reservation.is_recurrent ? "bg-blue-600" : "bg-gray-200"
                } ${(recurrenceUpdating || loading) ? "opacity-50 cursor-wait" : ""}`}
                role="switch"
                aria-checked={reservation.is_recurrent}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    reservation.is_recurrent ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <span className={`text-sm font-bold ${reservation.is_recurrent ? "text-blue-700" : "text-gray-500"}`}>
                {(recurrenceUpdating || loading) ? "Cargando..." : (reservation.is_recurrent ? "RECURRENTE" : "No")}
              </span>
            </div>
          </div>
        </div>

        {/* Móvil: filas 1–2 estado, 3–4 recordatorio, 5 cancelar. md: 2 filas × 3 col; col3 fila1 vacía para alinear botón rojo. */}
        <div
          className={`grid grid-cols-1 gap-y-4 border-t border-gray-100 pt-2 md:gap-x-6 md:gap-y-2 ${isCancelled ? "md:grid-cols-2" : "md:grid-cols-3"}`}
        >
          <label className="col-start-1 row-start-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 md:col-start-1 md:row-start-1">
            Estado de Reserva
          </label>
          <label className="col-start-1 row-start-3 block text-xs font-semibold uppercase tracking-wide leading-snug text-gray-500 md:col-start-2 md:row-start-1">
            Pedir confirmación de asistencia
          </label>
          {!isCancelled ? (
            <div className="hidden min-h-0 md:col-start-3 md:row-start-1 md:block" aria-hidden />
          ) : null}

          <div className="col-start-1 row-start-2 min-w-0 md:col-start-1 md:row-start-2">
            {onUpdateStatus && (reservation.status === "pending" || reservation.status === "confirmed") ? (
              statusUpdating ? (
                <div className="h-[42px] w-full shrink-0 rounded-xl border-2 border-gray-200 bg-gray-100 animate-pulse" />
              ) : (
                <select
                  value={reservation.status}
                  disabled={statusUpdating}
                  onChange={(e) => {
                    const next = e.target.value as "pending" | "confirmed";
                    if (next === reservation.status) return;
                    void onUpdateStatus(next);
                  }}
                  className="h-[42px] w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                >
                  <option value="pending">{STATUS_LABELS.pending}</option>
                  <option value="confirmed">{STATUS_LABELS.confirmed}</option>
                </select>
              )
            ) : (
              <div className="flex min-h-[42px] items-center rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-800">
                {STATUS_LABELS[reservation.status as ReservationStatus] ?? reservation.status}
              </div>
            )}
          </div>
          <div className="col-start-1 row-start-4 flex min-w-0 flex-col gap-1 md:col-start-2 md:row-start-2">
            <button
              type="button"
              onClick={onSendAttendanceReminder}
              disabled={isCancelled || !canSendAttendanceReminder || attendanceReminderSending}
              title="Pedir confirmación de asistencia"
              className="inline-flex h-[42px] w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d={WSP_ICON_PATH} />
              </svg>
              {attendanceReminderSending ? "Enviando…" : "Enviar recordatorio"}
            </button>
            {!attendanceReminderFetching && attendanceReminderLabel ? (
              <p className="text-[11px] leading-snug text-gray-500">{attendanceReminderLabel}</p>
            ) : null}
          </div>
          {!isCancelled ? (
            <button
              type="button"
              onClick={onCancelReservation}
              disabled={cancellingReservation}
              title="Cancelar reserva"
              className="col-start-1 row-start-5 h-[42px] w-full shrink-0 rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-700 disabled:opacity-50 md:col-start-3 md:row-start-2"
            >
              {cancellingReservation ? "Cancelando..." : "Cancelar reserva"}
            </button>
          ) : null}
        </div>

        {/* Resumen financiero: Total, Pagado, Deuda */}
        <div className="mt-10 pt-6 border-t border-gray-100 grid grid-cols-3 gap-4">
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
                    {...anchorPropsForHref(pdfHref)}
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

  const digits = String(reservation.phone_number || reservation.chat_id || chatId || "").replace(/\D/g, "");
  const phoneForSearch =
    digits.length >= 9 ? normalizePeruPhone(digits) : digits.length > 0 ? digits : chatId.replace(/\D/g, "");

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
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

function NotesTabContent({
  notes,
  loading,
  onAddNote,
  onEditNote,
  onDeleteNote,
}: {
  notes: Note[];
  loading: boolean;
  onAddNote: (content: string) => Promise<void>;
  onEditNote: (noteId: string, content: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}) {
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [notes]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-gray-50">
      {/* Botón de creación o Formulario */}
      <div className="sticky top-0 z-10 bg-gray-50 p-4 border-b border-gray-200 shadow-sm">
        {!isCreating ? (
          <button
            onClick={() => setIsCreating(true)}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white border-2 border-dashed border-blue-400 p-6 text-blue-600 hover:bg-blue-50 hover:border-blue-500 transition-all active:scale-[0.98]"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span className="text-lg font-black uppercase tracking-tight">Crear nuevo apunte</span>
          </button>
        ) : (
          <div className="rounded-2xl border-2 border-blue-500 bg-white p-5 shadow-xl animate-in fade-in zoom-in duration-200">
            <h4 className="mb-3 text-sm font-black uppercase tracking-widest text-blue-600">Nuevo apunte</h4>
            <textarea
              autoFocus
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Escribe aquí cualquier observación sobre el cliente..."
              className="w-full min-h-[120px] rounded-xl border-2 border-gray-100 bg-gray-50 p-4 text-base font-bold text-gray-800 focus:border-blue-500 focus:ring-0 resize-none transition-all placeholder:text-gray-400"
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  setIsCreating(false);
                  setNewNote("");
                }}
                className="flex-1 rounded-xl bg-gray-100 py-4 text-base font-bold text-gray-600 hover:bg-gray-200 active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!newNote.trim()) return;
                  setAdding(true);
                  await onAddNote(newNote);
                  setNewNote("");
                  setAdding(false);
                  setIsCreating(false);
                }}
                disabled={adding || !newNote.trim()}
                className="flex-[2] rounded-xl bg-blue-600 py-4 text-base font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-all"
              >
                {adding ? "Guardando..." : "Guardar Apunte"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lista de apuntes */}
      <div className="p-4 space-y-4">
        {loading && notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 animate-pulse">
            <div className="h-12 w-12 rounded-full bg-gray-200 mb-4" />
            <div className="h-4 w-32 bg-gray-200 rounded" />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-10 text-center text-gray-400">
            <div className="mb-4 rounded-full bg-gray-100 p-6">
              <svg className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-base font-bold text-gray-500">No hay apuntes anteriores</p>
            <p className="mt-1 text-sm text-gray-400 font-medium italic">Los apuntes ayudan a recordar detalles importantes de los clientes.</p>
          </div>
        ) : (
          sortedNotes.map((note) => {
            const isEditing = editingId === note.id;
            const isUpdating = updatingId === note.id;

            return (
              <div 
                key={note.id} 
                className={`group relative rounded-2xl border-2 transition-all ${
                  isEditing ? "border-blue-400 bg-white ring-4 ring-blue-50 shadow-xl" : "border-white bg-white shadow-sm hover:border-gray-200 hover:shadow-md"
                }`}
              >
                {!isEditing ? (
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                         <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                         </div>
                         <span className="text-xs font-black uppercase tracking-widest text-gray-400">
                            {new Date(note.created_at).toLocaleString("es-PE", {
                              day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
                            })}
                         </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setEditingId(note.id);
                            setEditContent(note.content);
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-gray-500 hover:bg-amber-100 hover:text-amber-700 transition-colors"
                          title="Editar apunte"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("¿Seguro que quieres borrar este apunte? No se puede deshacer.")) {
                              onDeleteNote(note.id);
                            }
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-gray-500 hover:bg-red-100 hover:text-red-700 transition-colors"
                          title="Eliminar apunte"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <p className="text-lg font-bold text-gray-700 whitespace-pre-wrap leading-tight">
                      {note.content}
                    </p>
                  </div>
                ) : (
                  <div className="p-5 animate-in fade-in slide-in-from-top-2">
                    <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-blue-600">Editando apunte</h4>
                    <textarea
                      autoFocus
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full min-h-[100px] rounded-xl border-2 border-gray-100 bg-gray-50 p-4 text-base font-bold text-gray-800 focus:border-blue-500 focus:ring-0 resize-none transition-all"
                    />
                    <div className="mt-4 flex gap-2">
                       <button
                        onClick={() => setEditingId(null)}
                        className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600 hover:bg-gray-200"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={async () => {
                          if (!editContent.trim() || isUpdating) return;
                          setUpdatingId(note.id);
                          await onEditNote(note.id, editContent);
                          setUpdatingId(null);
                          setEditingId(null);
                        }}
                        disabled={isUpdating || !editContent.trim()}
                        className="flex-[2] rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isUpdating ? "Guardando..." : "Guardar Cambios"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

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
  onToggleRecurrence,
  recurrenceConflict,
  setRecurrenceConflict,
  recurrenceUpdating = false,
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
  onSelectReservationFromList,
  pendingEmitFromAmountEdit = null,
  onClearPendingEmitFromAmountEdit,
  amountPaidDeltaPrompt = null,
  onResolveAmountPaidDeltaPrompt,
  notes = [],
  loadingNotes = false,
  onAddNote,
  onEditNote,
  onDeleteNote,
}: PaymentSidebarProps) {
  const toast = useToastContext();
  const [attendanceReminderLabel, setAttendanceReminderLabel] = useState<string | null>(null);
  const [attendanceReminderFetching, setAttendanceReminderFetching] = useState(false);
  const [attendanceReminderSending, setAttendanceReminderSending] = useState(false);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");

  const canSendAttendanceReminder = useMemo(() => {
    if (reservation.status === "cancelled") return false;
    const p = String(reservation.phone_number || "").replace(/\D/g, "");
    if (p.length >= 9) return true;
    const c = String(reservation.chat_id || "").replace(/\D/g, "");
    return c.length >= 9;
  }, [reservation.phone_number, reservation.chat_id, reservation.status]);

  const fetchAttendanceReminder = useCallback(async () => {
    setAttendanceReminderFetching(true);
    try {
      const res = await fetch(
        `/api/reservation-attendance-reminders?reservation_id=${encodeURIComponent(reservation.id)}`
      );
      const data = (await res.json().catch(() => ({}))) as { last?: { display_label?: string } };
      if (res.ok && typeof data?.last?.display_label === "string") {
        setAttendanceReminderLabel(data.last.display_label);
      } else {
        setAttendanceReminderLabel(null);
      }
    } catch {
      setAttendanceReminderLabel(null);
    } finally {
      setAttendanceReminderFetching(false);
    }
  }, [reservation.id]);

  const handleSendAttendanceReminder = useCallback(async (msg?: string) => {
    // Si viene de un modal (msg presente) o no
    const messageToSend = typeof msg === "string" ? msg.trim() : "";

    setAttendanceReminderSending(true);
    try {
      const res = await fetch("/api/reservation-attendance-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          reservation_id: reservation.id,
          message: messageToSend || undefined
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(typeof data?.error === "string" ? data.error : "No se pudo enviar el mensaje", "error");
        return;
      }
      toast("Mensaje enviado por WhatsApp", "success");
      setIsReminderModalOpen(false);
      await fetchAttendanceReminder();
    } catch {
      toast("No se pudo enviar el mensaje", "error");
    } finally {
      setAttendanceReminderSending(false);
    }
  }, [reservation.id, fetchAttendanceReminder, toast]);

  const handleOpenReminderModal = useCallback(() => {
    const suggested = buildAttendanceConfirmationMessage(reservation.date);
    setReminderMessage(suggested);
    setIsReminderModalOpen(true);
  }, [reservation.date]);

  /** DNI para boleta: reserva con 8 dígitos válidos, si no perfil usuario (last_dni). */
  const clientDniForEmit = useMemo(() => {
    const r = String(reservation.dni ?? "").replace(/\D/g, "").slice(0, 8);
    const p = String(clientLastDni ?? "").replace(/\D/g, "").slice(0, 8);
    if (r.length === 8) return r;
    if (p.length === 8) return p;
    return r || p || "";
  }, [reservation.dni, clientLastDni]);

  const [activeTab, setActiveTab] = useState<"detalles" | "cobros" | "apuntes">("detalles");
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [emitModalTransfer, setEmitModalTransfer] = useState<Transfer | null>(null);
  const [amountPaidEditCloseSignal, setAmountPaidEditCloseSignal] = useState(0);
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

  useEffect(() => {
    if (!pendingEmitFromAmountEdit?.id) return;
    setEmitModalTransfer(pendingEmitFromAmountEdit);
    setActiveTab("cobros");
    onClearPendingEmitFromAmountEdit?.();
  }, [pendingEmitFromAmountEdit, onClearPendingEmitFromAmountEdit]);

  useEffect(() => {
    if (activeTab !== "detalles") return;
    void fetchAttendanceReminder();
  }, [activeTab, fetchAttendanceReminder]);

  const hasMultipleReservations = allReservationsThisWeek.length > 1;
  const emitInitialDescripcion = useMemo(() => {
    const canchaLabel = reservation.field ? `cancha ${reservation.field}` : "reserva";
    const rango = formatReservationRangeCompact(reservation);
    const projectedRemaining = Math.max(
      0,
      registerPaymentRemaining - Math.max(0, Number(emitModalTransfer?.amount || 0))
    );
    const remainingLabel =
      projectedRemaining <= 0
        ? "cancelado"
        : `resta ${Number.isInteger(projectedRemaining) ? projectedRemaining : projectedRemaining.toFixed(2)}`;
    return `Alquiler ${canchaLabel} ${reservation.date} de ${rango} ${remainingLabel}`;
  }, [reservation, registerPaymentRemaining, emitModalTransfer?.amount]);

  return (
    <>
      {isReminderModalOpen && (
        <AttendanceReminderModal
          message={reminderMessage}
          onMessageChange={setReminderMessage}
          onSend={() => void handleSendAttendanceReminder(reminderMessage)}
          onClose={() => setIsReminderModalOpen(false)}
          sending={attendanceReminderSending}
        />
      )}
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
                {activeTab === "detalles" ? "Detalle de reserva" : activeTab === "cobros" ? "Gestionar cobros" : "Apuntes"}
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
              {activeTab !== "detalles" && (
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
          {/* Tabs */}
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
            <button
              type="button"
              onClick={() => setActiveTab("apuntes")}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === "apuntes" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Apuntes {notes.length > 0 && `(${notes.length})`}
            </button>
          </div>
        </div>

        {activeTab === "detalles" ? (
          <ReservationDetailContent
            reservation={reservation}
            courtConfigs={courtConfigs}
            amountPaidEditCloseSignal={amountPaidEditCloseSignal}
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
            onToggleRecurrence={onToggleRecurrence}
            recurrenceUpdating={recurrenceUpdating}
            loading={loading}
            onCancelReservation={onCancelReservation}
            reservationsForChips={hasMultipleReservations ? allReservationsThisWeek : undefined}
            onSelectReservationFromChips={hasMultipleReservations ? onSelectReservationFromList : undefined}
            attendanceReminderLabel={attendanceReminderLabel}
            attendanceReminderFetching={attendanceReminderFetching}
            attendanceReminderSending={attendanceReminderSending}
            canSendAttendanceReminder={canSendAttendanceReminder}
            onSendAttendanceReminder={handleOpenReminderModal}
          />
        ) : null}
        {activeTab === "cobros" && (
          <CobrosTabContent
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
        {activeTab === "apuntes" && (
          <NotesTabContent
            notes={notes}
            loading={loadingNotes}
            onAddNote={onAddNote || (async () => {})}
            onEditNote={onEditNote || (async () => {})}
            onDeleteNote={onDeleteNote || (async () => {})}
          />
        )}
      </div>

      {emitModalTransfer ? (
        <EmitInvoiceModal
          transfer={emitModalTransfer}
          clientDni={clientDniForEmit || undefined}
          clientRuc={clientRuc ?? undefined}
          initialDescripcion={emitInitialDescripcion}
          initialCliente={displayName ?? reservation.representative_name ?? ""}
          onClose={() => setEmitModalTransfer(null)}
          onEmitInvoice={onEmitInvoice}
          emitting={emittingInvoiceId === emitModalTransfer.id}
          attaching={attachingInvoiceId === emitModalTransfer.id}
        />
      ) : null}

      {amountPaidDeltaPrompt &&
      amountPaidDeltaPrompt.reservationId === reservation.id &&
      onResolveAmountPaidDeltaPrompt ? (
        <div
          className="fixed inset-0 z-[10065] flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="amount-paid-delta-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <h2 id="amount-paid-delta-title" className="text-lg font-bold text-gray-900">
              ¿Emitir comprobante ahora?
            </h2>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Puedes abrir el emisor ahora o continuar y emitir luego.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:justify-end sm:gap-3">
              <button
                type="button"
                disabled={paymentLoading}
                onClick={() => {
                  void (async () => {
                    const ok = await onResolveAmountPaidDeltaPrompt("emit");
                    if (ok) setAmountPaidEditCloseSignal((s) => s + 1);
                  })();
                }}
                className="rounded-xl bg-field-dark px-4 py-3 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50 sm:min-w-[140px]"
              >
                {paymentLoading ? "…" : "Abrir emisor de boleta"}
              </button>
              <button
                type="button"
                disabled={paymentLoading}
                onClick={() => {
                  void (async () => {
                    const ok = await onResolveAmountPaidDeltaPrompt("direct");
                    if (ok) setAmountPaidEditCloseSignal((s) => s + 1);
                  })();
                }}
                className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 sm:min-w-[140px]"
              >
                Emitir después
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewingImage && <ImageViewer src={viewingImage} onClose={() => setViewingImage(null)} />}

      {recurrenceConflict && (
        <RecurrenceConflictModal
          conflict={recurrenceConflict}
          loading={recurrenceUpdating}
          onClose={() => setRecurrenceConflict?.(null)}
          onForce={async () => {
            const ok = await onToggleRecurrence?.(true, true);
            if (ok) setRecurrenceConflict?.(null);
          }}
        />
      )}
    </>
  );
});

export default PaymentSidebar;
