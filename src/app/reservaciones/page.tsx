"use client";

import { useState, useEffect } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/lib/hooks";
import type { Reservation } from "@/lib/types";
import {
  COURT_LABELS,
  STATUS_LABELS,
  CourtType,
  ReservationStatus,
} from "@/lib/types";

export default function ReservacionesPage() {
  const store = useStore();
  const toast = useToastContext();
  const reservations = store.getReservations();
  const loaded = store.isLoaded("reservations");

  const [filterDate, setFilterDate] = useState("");
  const [filterCourt, setFilterCourt] = useState<CourtType | "">("");
  const [filterStatus, setFilterStatus] = useState<ReservationStatus | "">("");
  const [confirmAction, setConfirmAction] = useState<{
    type: "pay" | "cancel";
    id: string;
  } | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [reminderModal, setReminderModal] = useState<{ reservation: Reservation } | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    store.fetchReservations();
  }, [store]);

  const filtered = reservations
    .filter((r) => {
      if (filterDate && r.date !== filterDate) return false;
      if (filterCourt && r.court_type !== filterCourt) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  async function handleConfirm() {
    if (!confirmAction) return;
    let success: boolean;
    if (confirmAction.type === "pay") {
      success = await store.updateReservationStatus(confirmAction.id, "paid");
      if (success) toast("Reserva marcada como pagada", "success");
      else toast("Error al actualizar", "error");
    } else {
      success = await store.cancelReservation(confirmAction.id);
      if (success) toast("Reserva cancelada", "info");
      else toast("Error al cancelar", "error");
    }
    setConfirmAction(null);
  }

  async function handleSendReminder(reservation: Reservation, amountToCharge: number) {
    setSendingReminder(reservation.id);
    setReminderModal(null);
    const success = await store.sendPaymentReminder(reservation, amountToCharge);
    if (success) toast("Recordatorio enviado por WhatsApp", "success");
    else toast("Error al enviar recordatorio", "error");
    setSendingReminder(null);
    setCustomAmount("");
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("es-PE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">
            Reservaciones
          </h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Gestiona todas las reservas
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 shadow-sm">
          <h3 className="text-body-lg font-bold text-gray-700 mb-4">Filtros</h3>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-body font-medium text-gray-600 mb-2">Fecha</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-5 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-body font-medium text-gray-600 mb-2">Tipo de Cancha</label>
              <select
                value={filterCourt}
                onChange={(e) => setFilterCourt(e.target.value as CourtType | "")}
                className="w-full px-5 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50"
              >
                <option value="">Todas</option>
                {Object.entries(COURT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-body font-medium text-gray-600 mb-2">Estado</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as ReservationStatus | "")}
                className="w-full px-5 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50"
              >
                <option value="">Todos</option>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
            {(filterDate || filterCourt || filterStatus) && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFilterDate("");
                    setFilterCourt("");
                    setFilterStatus("");
                  }}
                  className="px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Limpiar
                </button>
              </div>
            )}
          </div>
        </div>

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">Cargando reservas...</div>
          </div>
        ) : (
          <>
            <p className="text-body text-gray-500 mb-4 font-medium">
              {filtered.length} reserva{filtered.length !== 1 ? "s" : ""} encontrada{filtered.length !== 1 ? "s" : ""}
            </p>

            <div className="space-y-5">
              {filtered.length === 0 ? (
                <div className="bg-white rounded-3xl border border-gray-200 p-14 text-center shadow-sm">
                  <p className="text-body-lg text-gray-400">
                    No se encontraron reservas con los filtros seleccionados
                  </p>
                </div>
              ) : (
                filtered.map((res) => (
                  <div key={res.id} className="bg-white rounded-3xl border border-gray-200 p-7 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col gap-5">
                      {/* Header: campo badge + info + status badge */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-5">
                          <div
                            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-base shrink-0 shadow-sm ${
                              res.status === "paid" && res.auto_confirmed && (res.amount_paid ?? 0) < (res.total_price || 0)
                                ? "bg-blue-400"
                                : res.status === "paid"
                                ? "bg-blue-600"
                                : res.status === "pending"
                                ? "bg-amber-500"
                                : "bg-gray-400"
                            }`}
                          >
                            {res.field ? `#${res.field}` : "—"}
                          </div>
                          <div className="min-w-0">
                            <p className="text-body-lg font-bold text-gray-900 leading-tight">
                              {COURT_LABELS[res.court_type] || res.court_type}
                              {res.field ? ` — Campo ${res.field}` : ""}
                            </p>
                            <p className="text-body text-gray-500 mt-1.5">
                              {formatDate(res.date)} · {res.time_slots?.[0] || "?"} -{" "}
                              {res.time_slots?.length > 0
                                ? parseInt(res.time_slots[res.time_slots.length - 1]) + 1
                                : "?"}
                              :00
                            </p>
                            {res.phone_number && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-body text-gray-500">
                                  Tel: <span className="font-semibold text-gray-700">{res.phone_number}</span>
                                </span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  res.auto_confirmed
                                    ? "bg-purple-100 text-purple-700"
                                    : "bg-gray-100 text-gray-600"
                                }`}>
                                  {res.auto_confirmed ? "Recurrente" : "Nuevo"}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Status badge alineado a la derecha */}
                        {(() => {
                          const paid = res.amount_paid ?? 0;
                          const total = res.total_price || 0;
                          const isAutoConfirmed = res.status === "paid" && res.auto_confirmed && paid < total;
                          const isPartial = res.status === "paid" && paid > 0 && paid < total && !res.auto_confirmed;
                          const label = isAutoConfirmed
                            ? "Confirmado - Por cobrar"
                            : isPartial ? "Pago Parcial" : (STATUS_LABELS[res.status] || res.status);
                          const colors = isAutoConfirmed
                            ? "bg-blue-100 text-blue-700"
                            : isPartial
                            ? "bg-amber-100 text-amber-700"
                            : res.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : res.status === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700";
                          return (
                            <span className={`px-4 py-2 rounded-xl text-sm font-bold shrink-0 ${colors}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Sección de pago */}
                      {(() => {
                        const total = res.total_price || 0;
                        const paid = res.amount_paid ?? 0;
                        const remaining = Math.max(total - paid, 0);
                        const pct = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
                        const fullyPaid = paid >= total;
                        const showDebt = !fullyPaid && (paid > 0 || res.auto_confirmed);
                        return (
                          <div className="bg-gray-50 rounded-2xl px-5 py-4 space-y-3">
                            <div className="flex items-center gap-6">
                              <div className="flex flex-col">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Total</span>
                                <span className="text-body font-bold text-bombonera-700">S/ {total.toFixed(2)}</span>
                              </div>
                              {paid > 0 && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-400 uppercase tracking-wide">Pagado</span>
                                  <span className="text-body font-semibold text-green-700">S/ {paid.toFixed(2)}</span>
                                </div>
                              )}
                              {showDebt && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-400 uppercase tracking-wide">Debe</span>
                                  <span className="text-body font-semibold text-red-600">S/ {remaining.toFixed(2)}</span>
                                </div>
                              )}
                              {res.confirmed && (
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-green-600 text-white ml-auto">
                                  ✓ Confirmado
                                </span>
                              )}
                            </div>
                            {showDebt && (
                              <div className="flex items-center gap-2">
                                <div className="w-40 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-green-500 transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500 font-medium">{Math.round(pct)}%</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Botones de acción */}
                      {(res.status === "pending" || (res.status === "paid" && res.auto_confirmed && (res.amount_paid ?? 0) < (res.total_price || 0))) && (
                        <div className="flex items-center gap-3 pt-1">
                          <button
                            onClick={() => setReminderModal({ reservation: res })}
                            disabled={sendingReminder === res.id}
                            className="px-5 py-3 text-body font-bold rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:bg-green-400 transition-colors min-h-[48px]"
                          >
                            {sendingReminder === res.id ? "Enviando..." : "Recordar Pago"}
                          </button>
                          <button
                            onClick={() => setConfirmAction({ type: "pay", id: res.id })}
                            className="px-5 py-3 text-body font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors min-h-[48px]"
                          >
                            Marcar Pagado
                          </button>
                          <button
                            onClick={() => setConfirmAction({ type: "cancel", id: res.id })}
                            className="px-5 py-3 text-body font-bold rounded-xl bg-red-100 text-red-700 hover:bg-red-200 transition-colors min-h-[48px]"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmAction?.type === "pay"}
        title="Confirmar Pago"
        message="¿Marcar esta reserva como pagada?"
        confirmLabel="Sí, Pagado"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction?.type === "cancel"}
        title="Cancelar Reserva"
        message="¿Estás seguro de que quieres cancelar esta reserva? Esta acción no se puede deshacer."
        confirmLabel="Sí, Cancelar"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Modal de Recordatorio de Pago */}
      {reminderModal && (() => {
        const r = reminderModal.reservation;
        const totalPrice = r.total_price || 0;
        const amountPaid = r.amount_paid || 0;
        const pendiente = totalPrice - amountPaid;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
              <h3 className="text-heading font-bold text-gray-900 mb-3">Recordatorio de Pago</h3>

              <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2">
                <div className="flex justify-between text-body">
                  <span className="text-gray-600">Total</span>
                  <span className="font-bold text-gray-900">S/ {totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-body">
                  <span className="text-gray-600">Pagado</span>
                  <span className="font-bold text-green-700">S/ {amountPaid.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-body border-t border-gray-200 pt-2">
                  <span className="text-gray-600 font-semibold">Pendiente</span>
                  <span className="font-bold text-amber-700">S/ {pendiente.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <button
                  onClick={() => handleSendReminder(r, pendiente)}
                  className="w-full px-6 py-4 text-body font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  Cobrar pendiente (S/ {pendiente.toFixed(2)})
                </button>

                <div className="flex gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="Monto"
                    className="flex-1 px-4 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50"
                  />
                  <button
                    onClick={() => {
                      const amount = parseFloat(customAmount);
                      if (amount > 0) handleSendReminder(r, amount);
                    }}
                    disabled={!customAmount || parseFloat(customAmount) <= 0}
                    className="px-6 py-4 text-body font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 transition-colors whitespace-nowrap"
                  >
                    Cobrar monto
                  </button>
                </div>
              </div>

              <button
                onClick={() => { setReminderModal(null); setCustomAmount(""); }}
                className="w-full px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}
    </ClientLayout>
  );
}
