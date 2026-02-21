"use client";

import { useState } from "react";
import Link from "next/link";
import type { Reservation } from "@/lib/types";

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReservationDetailPanelProps {
  reservation: Reservation;
  onClose: () => void;
  onToggleArrived: (resId: string, arrived: boolean) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHour12(hourStr: string) {
  const h = parseInt(hourStr.split(":")[0]);
  const isPm = h >= 12;
  const hour12 = h % 12 || 12;
  return `${hour12}:00 ${isPm ? "pm" : "am"}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReservationDetailPanel({
  reservation: res,
  onClose,
  onToggleArrived,
}: ReservationDetailPanelProps) {
  const [arrivedLoading, setArrivedLoading] = useState(false);

  const paid = res.amount_paid ?? 0;
  const total = res.total_price ?? 0;
  const remaining = total - paid;
  const payPercent = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
  const arrived = res.arrived ?? false;
  const isCancelled = res.status === "cancelled";
  const fullyPaid = remaining <= 0;

  // ── Time display ────────────────────────────────────────────────────────
  const slots = res.time_slots ?? [];
  const startSlot = slots[0] ?? "";
  const lastSlotHour = slots.length > 0 ? parseInt(slots[slots.length - 1]) + 1 : 0;
  const timeDisplay = startSlot
    ? `${formatHour12(startSlot)} - ${formatHour12(`${lastSlotHour}:00`)}`
    : "Sin horario";

  // ── Handlers ────────────────────────────────────────────────────────────
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
          <h2 className="text-lg font-bold text-gray-900">Detalle de reserva</h2>
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
              <a
                href={`https://wa.me/${res.phone_number.startsWith("51") ? res.phone_number : `51${res.phone_number}`}?text=.`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-1 hover:bg-green-50 px-2 py-1 rounded-lg transition-colors group"
                title="Abrir chat de WhatsApp"
              >
                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                </svg>
                <span className="text-gray-500 text-base font-mono group-hover:text-green-700 group-hover:underline">
                  {res.phone_number.startsWith("51") ? res.phone_number.slice(2) : res.phone_number}
                </span>
              </a>
            )}
          </div>

          {/* Info de cancha y horario */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">N° Cancha</span>
              <span className="font-semibold text-gray-800">
                {res.field ? `Cancha ${res.field}` : "Sin asignar"}
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

          {/* Sección de pagos */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Pagos
            </label>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Precio total</span>
                <span className="font-bold text-gray-900">S/ {total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Ya pagado</span>
                <span className="font-semibold text-blue-700">S/ {paid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-3">
                <span className="font-semibold text-gray-700">
                  {fullyPaid ? "Estado" : "Falta pagar"}
                </span>
                <span className={`font-bold ${fullyPaid ? "text-green-600" : "text-red-600"}`}>
                  {fullyPaid ? "Pagado completo" : `S/ ${remaining.toFixed(2)}`}
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

          </div>

          {/* Ver pagos en /verificacion */}
          <div>
            <Link
              href={`/verificacion?reservation_id=${res.id}`}
              target="_blank"
              className="w-full block text-center px-6 py-3.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm"
            >
              Ver pagos y boletas
            </Link>
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
                {arrivedLoading ? "..." : arrived ? "✓ Ya llegó" : "Marcar como llegado"}
              </button>
            </div>
          )}

          {/* Comunicado (desactivado por ahora) */}
          {/* {!isCancelled && res.chat_id && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Comunicado
              </label>
              <button
                onClick={() => setShowMessageModal(true)}
                className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-amber-500 text-white shadow-sm hover:bg-amber-600 transition-all"
              >
                Enviar mensaje por WhatsApp
              </button>
            </div>
          )} */}
        </div>
      </div>
    </>
  );
}
