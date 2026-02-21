"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";

import { TIME_SLOTS, type Reservation } from "@/lib/types";
import ScheduleGrid from "@/components/operations/ScheduleGrid";
import ReservationDetailPanel from "@/components/operations/ReservationDetailPanel";
import { computeAutoAssignments } from "@/components/operations/autoAssign";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCurrentSlot(): string {
  const hour = new Date().getHours();
  const slot = `${hour}:00`;
  return TIME_SLOTS.includes(slot) ? slot : TIME_SLOTS[0];
}

// ─── Page ───────────────────────────────────────────────────────────────────

const MAX_DAY_OFFSET = 7;

function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateWithOffset(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

export default function OperacionesPage() {
  const toast = useToastContext();

  const [dayOffset, setDayOffset] = useState(0);
  const [currentSlot, setCurrentSlot] = useState(getCurrentSlot);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail panel state
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);

  // Auto-avanzar la hora cada 30s
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
    setSelectedRes(null);
  }, [dayOffset]);

  // ── Fetch reservas del día ────────────────────────────────────────────

  const loadReservations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations?date=${selectedDate}`);
      if (res.ok) {
        const data: Reservation[] = await res.json();
        setReservations(data.filter((r) => r.status !== "cancelled" || r.field));
      }
    } catch (e) {
      console.error("Error fetching reservations:", e);
    }
    setLoading(false);
  }, [selectedDate]);

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

  // ── Handlers ──────────────────────────────────────────────────────────

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

  function handleSelectReservation(reservation: Reservation) {
    setSelectedRes(reservation);
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
            autoAssignments={autoAssignments}
            currentSlot={currentSlot}
            isToday={isToday}
            onSelectReservation={handleSelectReservation}
          />
        </div>
      </div>

      {/* Detail Panel */}
      {selectedRes && (
        <ReservationDetailPanel
          reservation={selectedRes}
          onClose={() => setSelectedRes(null)}
          onToggleArrived={handleToggleArrived}
        />
      )}

    </ClientLayout>
  );
}
