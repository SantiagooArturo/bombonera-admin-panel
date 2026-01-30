"use client";

import { useState, useEffect } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/lib/hooks";
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

  async function handleSendReminder(resId: string) {
    const reservation = reservations.find((r) => r.id === resId);
    if (!reservation) return;
    setSendingReminder(resId);
    const success = await store.sendPaymentReminder(reservation);
    if (success) toast("Recordatorio enviado por WhatsApp", "success");
    else toast("Error al enviar recordatorio", "error");
    setSendingReminder(null);
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
                <option value="voley_maple">Voley Maple PVC</option>
                <option value="voley_piso">Voley Piso / Basket</option>
                <option value="reducido">Campo Reducido</option>
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

            <div className="space-y-4">
              {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
                  <p className="text-body-lg text-gray-400">
                    No se encontraron reservas con los filtros seleccionados
                  </p>
                </div>
              ) : (
                filtered.map((res) => (
                  <div key={res.id} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0 ${
                            res.status === "paid"
                              ? "bg-blue-600"
                              : res.status === "pending"
                              ? "bg-amber-500"
                              : "bg-gray-400"
                          }`}
                        >
                          {res.field ? `#${res.field}` : "—"}
                        </div>
                        <div>
                          <p className="text-body-lg font-bold text-gray-900">
                            {COURT_LABELS[res.court_type] || res.court_type}
                            {res.field ? ` — Campo ${res.field}` : ""}
                          </p>
                          <p className="text-body text-gray-600 mt-1">
                            {formatDate(res.date)} · {res.time_slots?.[0] || "?"} -{" "}
                            {res.time_slots?.length > 0
                              ? parseInt(res.time_slots[res.time_slots.length - 1]) + 1
                              : "?"}
                            :00
                          </p>
                          <div className="flex items-center gap-4 mt-2">
                            {res.phone_number && (
                              <span className="text-body text-gray-500">
                                Tel: <span className="font-semibold text-gray-700">{res.phone_number}</span>
                              </span>
                            )}
                            <span className="text-body font-bold text-bombonera-700">
                              S/ {(res.total_price || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`px-5 py-3 rounded-xl text-body font-bold ${
                            res.status === "paid"
                              ? "bg-blue-100 text-blue-700"
                              : res.status === "pending"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {STATUS_LABELS[res.status] || res.status}
                        </span>

                        {res.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleSendReminder(res.id)}
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
                          </>
                        )}
                      </div>
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
    </ClientLayout>
  );
}
