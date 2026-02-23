"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";

import { TIME_SLOTS, type Reservation, type BlockedSlot, isReservationActive } from "@/lib/types";
import ScheduleGrid from "@/components/operations/ScheduleGrid";
import PaymentSidebar from "@/components/verificacion/PaymentSidebar";
import { usePaymentSidebar } from "@/components/verificacion/usePaymentSidebar";
import { computeAutoAssignments } from "@/components/operations/autoAssign";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCurrentSlot(): string {
  const hour = new Date().getHours();
  const slot = `${hour}:00`;
  return TIME_SLOTS.includes(slot) ? slot : TIME_SLOTS[0];
}

const MAX_DAY_OFFSET = 7;

function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateWithOffset(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function formatHour12(slot: string) {
  const h = parseInt(slot.split(":")[0]);
  if (h === 0) return "12 am";
  if (h < 12) return `${h} am`;
  if (h === 12) return "12 pm";
  return `${h - 12} pm`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OperacionesPage() {
  const toast = useToastContext();
  const store = useStore();

  const [dayOffset, setDayOffset] = useState(0);
  const [currentSlot, setCurrentSlot] = useState(getCurrentSlot);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Unblock dialog
  const [unblockTarget, setUnblockTarget] = useState<BlockedSlot | null>(null);
  const [unblocking, setUnblocking] = useState(false);

  const sidebar = usePaymentSidebar({
    onReservationUpdated: (resId, patch) => {
      setReservations((prev) => prev.map((r) => (r.id === resId ? { ...r, ...patch } : r)));
    },
  });

  useEffect(() => {
    const interval = setInterval(() => setCurrentSlot(getCurrentSlot()), 30000);
    return () => clearInterval(interval);
  }, []);

  const selectedDate = useMemo(() => formatDateISO(getDateWithOffset(dayOffset)), [dayOffset]);

  const selectedDateLabel = useMemo(() => {
    const date = getDateWithOffset(dayOffset);
    if (dayOffset === 0) return "Hoy";
    if (dayOffset === 1) return "Mañana";
    return date.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" });
  }, [dayOffset]);

  const isToday = dayOffset === 0;

  useEffect(() => {
    sidebar.close();
    setUnblockTarget(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset]);

  // ── Fetch reservas y bloqueos del día ─────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [resResponse, blockedResponse] = await Promise.all([
        fetch(`/api/reservations?date=${selectedDate}`),
        fetch(`/api/blocked-slots?date=${selectedDate}`),
      ]);
      if (resResponse.ok) {
        const data: Reservation[] = await resResponse.json();
        setReservations(data.filter(isReservationActive));
      }
      if (blockedResponse.ok) {
        setBlockedSlots(await blockedResponse.json());
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    }
    setLoading(false);
  }, [selectedDate]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const autoAssignments = useMemo(
    () => computeAutoAssignments(reservations),
    [reservations]
  );

  // ── Asistencia ────────────────────────────────────────────────────────

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
        sidebar.setSelectedReservation((prev) =>
          prev?.id === resId ? { ...prev, arrived } : prev
        );
      }
    } catch {
      toast("Error al marcar asistencia", "error");
    }
  }

  // ── Desbloqueo ────────────────────────────────────────────────────────

  async function handleUnblock() {
    if (!unblockTarget) return;
    setUnblocking(true);
    const ok = await store.removeBlockedSlot(unblockTarget.id);
    if (ok) {
      toast("Horario desbloqueado", "success");
      setBlockedSlots((prev) => prev.filter((b) => b.id !== unblockTarget.id));
      setUnblockTarget(null);
    } else {
      toast("Error al desbloquear", "error");
    }
    setUnblocking(false);
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="p-6 md:p-10">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-heading-lg font-bold text-gray-900">
            {isToday ? "En Vivo" : "Reservas"}
          </h1>
          <div className="flex items-center gap-4 mt-2">
            <button
              onClick={() => setDayOffset((prev) => Math.max(0, prev - 1))}
              disabled={dayOffset === 0}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Día anterior"
            >
              <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-body-lg text-gray-700 font-semibold capitalize w-[280px] text-center">
              {selectedDateLabel}
            </span>
            <button
              onClick={() => setDayOffset((prev) => Math.min(MAX_DAY_OFFSET, prev + 1))}
              disabled={dayOffset >= MAX_DAY_OFFSET}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Día siguiente"
            >
              <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {!isToday && (
              <button
                onClick={() => setDayOffset(0)}
                className="ml-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Ir a Hoy
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          <ScheduleGrid
            reservations={reservations}
            blockedSlots={blockedSlots}
            autoAssignments={autoAssignments}
            currentSlot={currentSlot}
            isToday={isToday}
            onSelectReservation={sidebar.open}
            onSelectBlocked={setUnblockTarget}
          />
        </div>
      </div>

      {/* Detail Sidebar */}
      {sidebar.isOpen && sidebar.selectedReservation && (
        <PaymentSidebar
          reservation={sidebar.selectedReservation}
          transfers={sidebar.transfers}
          invoices={sidebar.invoices}
          loading={sidebar.loadingData}
          emittingInvoiceId={sidebar.emittingInvoiceId}
          paymentLoading={sidebar.paymentLoading}
          onVerifyTransfer={sidebar.handleVerifyTransfer}
          onAttachInvoice={sidebar.handleAttachInvoice}
          onRevokeManualPayment={sidebar.handleRevokeManualPayment}
          onRegisterPayment={sidebar.handleRegisterPayment}
          onClose={sidebar.close}
          onToggleArrived={handleToggleArrived}
        />
      )}

      {/* Unblock Dialog */}
      {unblockTarget && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setUnblockTarget(null)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Horario Bloqueado</h3>
                <p className="text-sm text-gray-500">{unblockTarget.reason}</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cancha</span>
                <span className="font-bold text-gray-800">Cancha {unblockTarget.field}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Horario</span>
                <span className="font-bold text-gray-800">{formatHour12(unblockTarget.time_slot)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Fecha</span>
                <span className="font-bold text-gray-800">
                  {new Date(unblockTarget.date + "T12:00:00").toLocaleDateString("es-PE", {
                    weekday: "long", day: "numeric", month: "long",
                  })}
                </span>
              </div>
            </div>

            <p className="text-sm text-gray-500">
              Solo se desbloqueará este día específico. Si el bloqueo es recurrente, los demás días seguirán bloqueados.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setUnblockTarget(null)}
                disabled={unblocking}
                className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleUnblock}
                disabled={unblocking}
                className="flex-1 py-3 px-4 font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {unblocking ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Desbloqueando...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    Desbloquear
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </ClientLayout>
  );
}
