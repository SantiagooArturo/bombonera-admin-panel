"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { TIME_SLOTS, type Reservation, type PaymentMethod } from "@/lib/types";
import ScheduleGrid from "@/components/operations/ScheduleGrid";
import ReservationDetailPanel from "@/components/operations/ReservationDetailPanel";
import PaymentModal from "@/components/PaymentModal";
import ReceiptPopup from "@/components/ReceiptPopup";
import { computeAutoAssignments } from "@/components/operations/autoAssign";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCurrentSlot(): string {
  const hour = new Date().getHours();
  const slot = `${hour}:00`;
  return TIME_SLOTS.includes(slot) ? slot : TIME_SLOTS[0];
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OperacionesPage() {
  const store = useStore();
  const toast = useToastContext();

  const [currentSlot, setCurrentSlot] = useState(getCurrentSlot);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail panel state
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);

  // Payment modal state
  const [payingRes, setPayingRes] = useState<Reservation | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  // Auto-avanzar la hora cada 30s
  useEffect(() => {
    const interval = setInterval(() => setCurrentSlot(getCurrentSlot()), 30000);
    return () => clearInterval(interval);
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // ── Fetch reservas del día ────────────────────────────────────────────

  const loadReservations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations?date=${today}`);
      if (res.ok) {
        const data: Reservation[] = await res.json();
        setReservations(data.filter((r) => r.status !== "cancelled" || r.field));
      }
    } catch (e) {
      console.error("Error fetching reservations:", e);
    }
    setLoading(false);
  }, [today]);

  useEffect(() => {
    loadReservations();
    const interval = setInterval(loadReservations, 30000);
    return () => clearInterval(interval);
  }, [loadReservations]);

  // ── Auto-assignments ──────────────────────────────────────────────────

  const autoAssignments = useMemo(
    () => computeAutoAssignments(reservations),
    [reservations]
  );

  // ── Stats del día ─────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const active = reservations.filter((r) => r.status !== "cancelled");
    const arrived = active.filter((r) => r.arrived).length;
    const withField = active.filter(
      (r) => r.field != null || autoAssignments.has(r.id)
    ).length;
    return { total: active.length, arrived, withField };
  }, [reservations, autoAssignments]);

  // ── Campo efectivo y campos usados (para dropdown del detail panel) ───

  const effectiveFieldForSelected = useMemo(() => {
    if (!selectedRes) return null;
    return selectedRes.field ?? autoAssignments.get(selectedRes.id) ?? null;
  }, [selectedRes, autoAssignments]);

  const usedFieldsForSelected = useMemo(() => {
    if (!selectedRes) return [];
    const slots = new Set(selectedRes.time_slots ?? []);

    const used: number[] = [];
    for (const r of reservations) {
      if (r.id === selectedRes.id || r.status === "cancelled") continue;
      if (r.court_type !== selectedRes.court_type) continue;
      const effectiveField = r.field ?? autoAssignments.get(r.id) ?? null;
      if (effectiveField == null) continue;

      const hasOverlap = (r.time_slots ?? []).some((s) => slots.has(s));
      if (hasOverlap) used.push(effectiveField);
    }
    return used;
  }, [selectedRes, reservations, autoAssignments]);

  // ── Handlers ──────────────────────────────────────────────────────────

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
        // Actualizar panel de detalle si está abierto para esta reserva
        if (selectedRes?.id === resId) {
          setSelectedRes((prev) =>
            prev ? { ...prev, field } : null
          );
        }
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
        if (selectedRes?.id === resId) {
          setSelectedRes((prev) =>
            prev ? { ...prev, arrived } : null
          );
        }
      }
    } catch {
      toast("Error al marcar asistencia", "error");
    }
  }

  async function handleConfirmPayment(amount: number, paymentMethod: PaymentMethod, mediaUrl?: string) {
    if (!payingRes) return;
    setPaymentLoading(true);
    const result = await store.processManualPayment(
      payingRes.id,
      amount,
      payingRes.chat_id,
      paymentMethod,
      mediaUrl,
    );
    setPaymentLoading(false);

    if (result?.success) {
      toast(`Cobro registrado: S/ ${amount.toFixed(2)}`, "success");
      const updatedRes = {
        ...payingRes,
        amount_paid: result.new_amount_paid,
        status: (result.fully_paid ? "paid" : payingRes.status) as Reservation["status"],
        confirmed: true,
      };
      setPayingRes(null);
      setReservations((prev) =>
        prev.map((r) => (r.id === updatedRes.id ? updatedRes : r))
      );
      // Actualizar panel de detalle si está abierto
      if (selectedRes?.id === updatedRes.id) {
        setSelectedRes(updatedRes);
      }
      setShowReceipt(true);
    } else {
      toast("Error al procesar el pago", "error");
    }
  }

  function handleSelectReservation(reservation: Reservation) {
    setSelectedRes(reservation);
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="p-6 md:p-10">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-heading-lg font-bold text-gray-900">En Vivo</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Hoy · Vista completa de canchas y disponibilidad
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 mb-6 bg-white rounded-xl border border-gray-200 px-6 py-4 shadow-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-500 font-medium">Reservas hoy</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{stats.arrived}</p>
            <p className="text-xs text-gray-500 font-medium">Llegaron</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-2xl font-bold text-bombonera-600">
              {stats.withField}
            </p>
            <p className="text-xs text-gray-500 font-medium">Con campo</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded border border-gray-200 bg-green-50/40" />
              Disponible
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded border border-gray-200 bg-green-50" />
              Llegó
            </span>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-body-lg text-gray-400 font-medium">
              Cargando...
            </p>
          </div>
        ) : (
          <ScheduleGrid
            reservations={reservations}
            autoAssignments={autoAssignments}
            currentSlot={currentSlot}
            onSelectReservation={handleSelectReservation}
          />
        )}
      </div>

      {/* Detail Panel */}
      {selectedRes && (
        <ReservationDetailPanel
          reservation={selectedRes}
          effectiveField={effectiveFieldForSelected}
          usedFields={usedFieldsForSelected}
          onClose={() => setSelectedRes(null)}
          onAssignField={handleAssignField}
          onToggleArrived={handleToggleArrived}
          onPay={setPayingRes}
        />
      )}

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
            toast(
              "Función de boleta aún no disponible. Podrás emitirla más tarde.",
              "info"
            );
            setShowReceipt(false);
          }}
          onNo={() => setShowReceipt(false)}
        />
      )}
    </ClientLayout>
  );
}
