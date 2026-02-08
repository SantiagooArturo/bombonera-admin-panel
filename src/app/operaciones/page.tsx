"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { COURT_FIELDS, type Reservation, type CourtType } from "@/lib/types";
import TimeSlotNav, { getCurrentSlot } from "@/components/operations/TimeSlotNav";
import ReservationCard from "@/components/operations/ReservationCard";

// ─── Payment Modal (reutilizado de usuarios) ───────────────────────────────

function PaymentModal({
  reservation,
  onConfirm,
  onCancel,
  loading,
}: {
  reservation: Reservation;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const remaining = (reservation.total_price || 0) - (reservation.amount_paid || 0);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const parsedAmount = parseFloat(amount);
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining + 0.01;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <h3 className="text-heading font-bold text-gray-900 mb-2">Cobrar pago</h3>
        <p className="text-body text-gray-500 mb-6">
          {reservation.representative_name || "Sin nombre"}
        </p>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-body">
            <span className="text-gray-500">Total</span>
            <span className="font-bold">S/ {(reservation.total_price || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-body">
            <span className="text-gray-500">Ya pagado</span>
            <span className="font-semibold text-blue-700">S/ {(reservation.amount_paid || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-body border-t pt-3">
            <span className="font-semibold">Restante</span>
            <span className="font-bold text-red-600">S/ {remaining.toFixed(2)}</span>
          </div>
        </div>

        <label className="block text-body font-medium text-gray-700 mb-2">Monto (S/)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={remaining}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-5 py-4 text-body-lg font-bold rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50 mb-6"
        />

        <div className="flex gap-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => isValid && onConfirm(parsedAmount)}
            disabled={!isValid || loading}
            className="flex-1 px-6 py-4 text-body font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Procesando..." : "Cobrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Receipt Popup ──────────────────────────────────────────────────────────

function ReceiptPopup({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <h3 className="text-heading font-bold text-gray-900 mb-3">¿Emitir boleta?</h3>
        <p className="text-body text-gray-600 mb-2">
          Se enviará por WhatsApp al cliente.
        </p>
        <p className="text-body text-gray-400 mb-8">Podrás hacerlo más tarde si prefieres.</p>
        <div className="flex gap-4">
          <button onClick={onNo} className="flex-1 px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100">
            No, después
          </button>
          <button onClick={onYes} className="flex-1 px-6 py-4 text-body font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700">
            Sí, emitir
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OperacionesPage() {
  const store = useStore();
  const toast = useToastContext();

  const [currentSlot, setCurrentSlot] = useState(getCurrentSlot);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  // Auto-avanzar la hora cada 30s
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlot(getCurrentSlot());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // El slot seleccionado siempre sigue al actual
  const selectedSlot = currentSlot;

  // Payment modal
  const [payingRes, setPayingRes] = useState<Reservation | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Fetch reservas del día
  const loadReservations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations?date=${today}`);
      if (res.ok) {
        const data: Reservation[] = await res.json();
        // Filtrar canceladas que no tienen campo asignado (ruido)
        setReservations(data.filter((r) => r.status !== "cancelled" || r.field));
      }
    } catch (e) {
      console.error("Error fetching reservations:", e);
    }
    setLoading(false);
  }, [today]);

  useEffect(() => {
    loadReservations();
    // Auto-refresh cada 30s
    const interval = setInterval(loadReservations, 30000);
    return () => clearInterval(interval);
  }, [loadReservations]);

  // Reservas del slot seleccionado
  const slotReservations = useMemo(
    () => reservations.filter((r) => r.time_slots?.includes(selectedSlot)),
    [reservations, selectedSlot]
  );

  // Conteos por slot (para el nav)
  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      for (const s of r.time_slots ?? []) {
        counts[s] = (counts[s] ?? 0) + 1;
      }
    }
    return counts;
  }, [reservations]);

  // Campos ya asignados en el slot seleccionado, agrupados por court_type
  const usedFieldsByCourtType = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const r of slotReservations) {
      if (r.field && r.status !== "cancelled") {
        const key = r.court_type;
        if (!map[key]) map[key] = [];
        map[key].push(r.field);
      }
    }
    return map;
  }, [slotReservations]);

  // Stats del slot
  const stats = useMemo(() => {
    const active = slotReservations.filter((r) => r.status !== "cancelled");
    const arrivedCount = active.filter((r) => r.arrived).length;
    const withField = active.filter((r) => r.field).length;
    return { total: active.length, arrived: arrivedCount, withField };
  }, [slotReservations]);

  // Handlers
  async function handleAssignField(resId: string, field: number | null) {
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resId, field }),
      });
      if (res.ok) {
        setReservations((prev) =>
          prev.map((r) => (r.id === resId ? { ...r, field } : r))
        );
      }
    } catch {
      toast("Error al asignar campo", "error");
    }
  }

  async function handleToggleArrived(resId: string, arrived: boolean) {
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resId, arrived }),
      });
      if (res.ok) {
        setReservations((prev) =>
          prev.map((r) => (r.id === resId ? { ...r, arrived } : r))
        );
      }
    } catch {
      toast("Error al marcar asistencia", "error");
    }
  }

  async function handleConfirmPayment(amount: number) {
    if (!payingRes) return;
    setPaymentLoading(true);
    const result = await store.processManualPayment(payingRes.id, amount, payingRes.chat_id);
    setPaymentLoading(false);

    if (result?.success) {
      toast(`Cobro registrado: S/ ${amount.toFixed(2)}`, "success");
      setPayingRes(null);
      // Actualizar localmente
      setReservations((prev) =>
        prev.map((r) =>
          r.id === payingRes.id
            ? {
                ...r,
                amount_paid: result.new_amount_paid,
                status: result.fully_paid ? "paid" : r.status,
                confirmed: true,
              }
            : r
        )
      );
      setShowReceipt(true);
    } else {
      toast("Error al procesar el pago", "error");
    }
  }

  // Agrupar reservas por court_type para mostrar separadas
  const groupedReservations = useMemo(() => {
    const groups: Record<string, Reservation[]> = {};
    for (const r of slotReservations) {
      if (!groups[r.court_type]) groups[r.court_type] = [];
      groups[r.court_type].push(r);
    }
    // Ordenar: no llegados primero, luego por nombre
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => {
        if (a.arrived !== b.arrived) return a.arrived ? 1 : -1;
        return (a.representative_name ?? "").localeCompare(b.representative_name ?? "");
      });
    }
    return groups;
  }, [slotReservations]);

  const courtTypeLabels: Record<string, string> = {
    voley_6v6: "Voley 6v6",
    voley_basket_6v6: "Multiusos 6v6",
    voley_5v5: "Voley 5v5",
    voley_basket_5v5: "Multiusos 5v5",
  };

  const hour = parseInt(selectedSlot);
  const slotLabel = hour <= 12 ? `${hour}:00 am` : `${hour - 12}:00 pm`;

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-heading-lg font-bold text-gray-900">En Vivo</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Hoy · Asigna campos, marca asistencia y cobra pagos
          </p>
        </div>

        {/* Time Slot Nav (solo indicador visual, avanza solo) */}
        <div className="mb-6">
          <TimeSlotNav
            selectedSlot={selectedSlot}
            currentSlot={currentSlot}
            counts={slotCounts}
          />
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 mb-6 bg-white rounded-xl border border-gray-200 px-6 py-4 shadow-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-500 font-medium">Reservas</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{stats.arrived}</p>
            <p className="text-xs text-gray-500 font-medium">Llegaron</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-2xl font-bold text-bombonera-600">{stats.withField}</p>
            <p className="text-xs text-gray-500 font-medium">Con campo</p>
          </div>
          <div className="flex-1" />
          <p className="text-lg font-bold text-gray-700">{slotLabel}</p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-body-lg text-gray-400 font-medium">Cargando...</p>
          </div>
        ) : slotReservations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center shadow-sm">
            <p className="text-5xl mb-4">🏐</p>
            <p className="text-body-lg text-gray-400 font-medium">
              No hay reservas a las {slotLabel}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedReservations).map(([courtType, reservas]) => (
              <div key={courtType}>
                <h3 className="text-body font-bold text-gray-600 mb-3 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-bombonera-400" />
                  {courtTypeLabels[courtType] ?? courtType}
                  <span className="text-gray-400 font-normal">
                    ({reservas.length} / {COURT_FIELDS[courtType as CourtType]?.length ?? "?"} campos)
                  </span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {reservas.map((res) => (
                    <ReservationCard
                      key={res.id}
                      reservation={res}
                      usedFields={usedFieldsByCourtType[courtType] ?? []}
                      onAssignField={handleAssignField}
                      onToggleArrived={handleToggleArrived}
                      onPay={setPayingRes}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {payingRes && (
        <PaymentModal
          reservation={payingRes}
          onConfirm={handleConfirmPayment}
          onCancel={() => setPayingRes(null)}
          loading={paymentLoading}
        />
      )}

      {/* Receipt Popup */}
      {showReceipt && (
        <ReceiptPopup
          onYes={() => {
            toast("Función de boleta aún no disponible. Podrás emitirla más tarde.", "info");
            setShowReceipt(false);
          }}
          onNo={() => setShowReceipt(false)}
        />
      )}
    </ClientLayout>
  );
}
