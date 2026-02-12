"use client";

import { useState, useEffect, useCallback } from "react";
import {
  COURT_FIELDS,
  TRANSFER_STATUS_LABELS,
  type Reservation,
  type CourtType,
  type Transfer,
} from "@/lib/types";

// ─── Constants ──────────────────────────────────────────────────────────────

const COURT_TYPE_LABELS: Record<CourtType, string> = {
  voley_6v6: "Voley 6v6",
  voley_basket_6v6: "Multiusos 6v6",
  voley_5v5: "Voley 5v5",
  voley_basket_5v5: "Multiusos 5v5",
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReservationDetailPanelProps {
  reservation: Reservation;
  /** Campo efectivo (real o auto-asignado). */
  effectiveField: number | null;
  /** Campos ya ocupados en los time_slots de esta reserva para su court_type. */
  usedFields: number[];
  onClose: () => void;
  onAssignField: (resId: string, field: number | null) => void;
  onToggleArrived: (resId: string, arrived: boolean) => void;
  onPay: (reservation: Reservation) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReservationDetailPanel({
  reservation: res,
  effectiveField,
  usedFields,
  onClose,
  onAssignField,
  onToggleArrived,
  onPay,
}: ReservationDetailPanelProps) {
  const [fieldLoading, setFieldLoading] = useState(false);
  const [arrivedLoading, setArrivedLoading] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const paid = res.amount_paid ?? 0;
  const total = res.total_price ?? 0;
  const remaining = total - paid;
  const payPercent = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
  const arrived = res.arrived ?? false;
  const canCharge = res.status !== "cancelled" && remaining > 0;
  const isCancelled = res.status === "cancelled";
  const fullyPaid = remaining <= 0;

  const allFields = COURT_FIELDS[res.court_type] ?? [];
  const availableFields = allFields.filter(
    (f) => !usedFields.includes(f) || f === effectiveField
  );

  // ── Fetch transfers ───────────────────────────────────────────────────

  const loadTransfers = useCallback(async () => {
    setTransfersLoading(true);
    try {
      const resp = await fetch(`/api/transfers?reservation_id=${res.id}`);
      if (resp.ok) {
        setTransfers(await resp.json());
      }
    } catch {
      console.error("Error fetching transfers");
    }
    setTransfersLoading(false);
  }, [res.id]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  // ── Time display ────────────────────────────────────────────────────────

  const slots = res.time_slots ?? [];
  const startSlot = slots[0] ?? "";
  const lastSlotHour =
    slots.length > 0 ? parseInt(slots[slots.length - 1]) + 1 : 0;
  const timeDisplay = startSlot
    ? `${startSlot} - ${lastSlotHour}:00`
    : "Sin horario";

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleFieldChange(value: string) {
    setFieldLoading(true);
    const newField = value === "" ? null : parseInt(value);
    await onAssignField(res.id, newField);
    setFieldLoading(false);
  }

  async function handleArrivedToggle() {
    setArrivedLoading(true);
    await onToggleArrived(res.id, !arrived);
    setArrivedLoading(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            Detalle de reserva
          </h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Nombre y teléfono */}
          <div>
            <h3 className="text-xl font-bold text-gray-900">
              {res.representative_name || "Sin nombre"}
            </h3>
            {res.phone_number && (
              <p className="text-sm text-gray-500 mt-1">
                WhatsApp:{" "}
                {res.phone_number.startsWith("51")
                  ? res.phone_number.slice(2)
                  : res.phone_number}
              </p>
            )}
          </div>

          {/* Info de cancha y horario */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tipo de cancha</span>
              <span className="font-semibold text-gray-800">
                {COURT_TYPE_LABELS[res.court_type] ?? res.court_type}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Horario</span>
              <span className="font-semibold text-gray-800">{timeDisplay}</span>
            </div>
            {isCancelled && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Reserva</span>
                <span className="font-semibold text-red-500">Cancelada</span>
              </div>
            )}
          </div>

          {/* Asignación de campo */}
          {!isCancelled && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Campo asignado
              </label>
              <select
                value={effectiveField ?? ""}
                onChange={(e) => handleFieldChange(e.target.value)}
                disabled={fieldLoading}
                className={`w-full px-4 py-3 rounded-xl border-2 text-sm font-bold transition-colors ${
                  effectiveField
                    ? "border-bombonera-300 bg-bombonera-50 text-bombonera-800"
                    : "border-gray-200 bg-gray-50 text-gray-500"
                } disabled:opacity-50`}
              >
                <option value="">Sin asignar</option>
                {availableFields.map((f) => (
                  <option key={f} value={f}>
                    Campo {f}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sección de pagos */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Pagos
            </label>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Precio total</span>
                <span className="font-bold text-gray-900">
                  S/ {total.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Ya pagado</span>
                <span className="font-semibold text-blue-700">
                  S/ {paid.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t pt-3">
                <span className="font-semibold text-gray-700">
                  {fullyPaid ? "Estado" : "Falta pagar"}
                </span>
                <span
                  className={`font-bold ${fullyPaid ? "text-green-600" : "text-red-600"}`}
                >
                  {fullyPaid
                    ? "Pagado completo"
                    : `S/ ${remaining.toFixed(2)}`}
                </span>
              </div>

              {/* Barra de progreso */}
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    payPercent >= 100
                      ? "bg-green-500"
                      : payPercent > 0
                        ? "bg-blue-500"
                        : "bg-gray-300"
                  }`}
                  style={{ width: `${payPercent}%` }}
                />
              </div>
            </div>

            {/* Botón registrar pago */}
            {canCharge && (
              <button
                onClick={() => onPay(res)}
                className="w-full mt-4 px-6 py-3.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-colors shadow-sm"
              >
                Registrar pago en efectivo — S/ {remaining.toFixed(2)}
              </button>
            )}
          </div>

          {/* Historial de transferencias */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Comprobantes de pago
            </label>
            {transfersLoading ? (
              <p className="text-xs text-gray-400">Cargando...</p>
            ) : transfers.length === 0 ? (
              <p className="text-xs text-gray-400">
                No hay comprobantes registrados
              </p>
            ) : (
              <div className="space-y-2">
                {transfers.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-800">
                          S/ {(t.amount ?? 0).toFixed(2)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            t.source === "manual"
                              ? "bg-gray-200 text-gray-600"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {t.source === "manual" ? "Efectivo" : "Transferencia"}
                        </span>
                        <span
                          className={`text-[10px] font-medium ${
                            t.status === "applied"
                              ? "text-green-600"
                              : t.status === "partial"
                                ? "text-amber-600"
                                : "text-red-500"
                          }`}
                        >
                          {TRANSFER_STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </div>
                      {t.operation_id && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Op: {t.operation_id}
                        </p>
                      )}
                    </div>

                    {/* Botón ver comprobante */}
                    {t.media_url && (
                      <button
                        onClick={() => setPreviewUrl(t.media_url!)}
                        className="shrink-0 w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center hover:bg-blue-200 transition-colors"
                        title="Ver comprobante"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Asistencia */}
          {!isCancelled && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Asistencia
              </label>
              <button
                onClick={handleArrivedToggle}
                disabled={arrivedLoading}
                className={`w-full px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                  arrived
                    ? "bg-green-500 text-white shadow-md hover:bg-green-600"
                    : "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                } disabled:opacity-50`}
              >
                {arrivedLoading
                  ? "..."
                  : arrived
                    ? "✓ Ya llegó"
                    : "Marcar como llegado"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal preview de comprobante */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative max-w-lg w-full max-h-[80vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center text-sm hover:bg-black/70 z-10"
            >
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Comprobante de pago"
              className="w-full h-auto max-h-[80vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
