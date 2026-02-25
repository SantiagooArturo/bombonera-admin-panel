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

function getEndSlotOptions(startSlot: string): string[] {
  const startIdx = TIME_SLOTS.indexOf(startSlot);
  if (startIdx === -1) return [];
  return TIME_SLOTS.slice(startIdx + 1);
}

function getSlotsInRange(startSlot: string, endSlot: string): string[] {
  const startIdx = TIME_SLOTS.indexOf(startSlot);
  const endIdx = TIME_SLOTS.indexOf(endSlot);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return [];
  return TIME_SLOTS.slice(startIdx, endIdx);
}

const BLOCK_REASONS = [
  "Mantenimiento",
  "Evento privado",
  "Clima / lluvia",
  "Otro",
] as const;

const FIELD_TO_COURT_TYPE: Record<number, Reservation["court_type"]> = {
  1: "voley_6v6",
  2: "voley_6v6",
  3: "voley_6v6",
  4: "voley_basket_6v6",
  5: "voley_5v5",
  6: "voley_5v5",
  7: "voley_5v5",
  8: "voley_6v6",
  9: "voley_basket_5v5",
  10: "voley_6v6",
  11: "voley_6v6",
  12: "voley_6v6",
};

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

  // Slot action modal (bloqueo / reserva manual)
  const [slotActionTarget, setSlotActionTarget] = useState<{ field: number; startSlot: string } | null>(null);
  const [slotActionMode, setSlotActionMode] = useState<"block" | "manual">("manual");
  const [slotActionEndSlot, setSlotActionEndSlot] = useState<string>("9:00");
  const [blockReason, setBlockReason] = useState<(typeof BLOCK_REASONS)[number]>("Mantenimiento");
  const [customReason, setCustomReason] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualDni, setManualDni] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [slotActionLoading, setSlotActionLoading] = useState(false);
  const [extendingReservationId, setExtendingReservationId] = useState<string | null>(null);

  const sidebar = usePaymentSidebar({
    onReservationUpdated: (resId, patch) => {
      setReservations((prev) => prev.map((r) => (r.id === resId ? { ...r, ...patch } : r)));
    },
    onReservationDeleted: (resId) => {
      setReservations((prev) => prev.filter((r) => r.id !== resId));
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
  const endSlotOptions = useMemo(
    () => (slotActionTarget ? getEndSlotOptions(slotActionTarget.startSlot) : []),
    [slotActionTarget]
  );
  const selectedSlots = useMemo(
    () => (slotActionTarget ? getSlotsInRange(slotActionTarget.startSlot, slotActionEndSlot) : []),
    [slotActionTarget, slotActionEndSlot]
  );

  useEffect(() => {
    sidebar.close();
    setUnblockTarget(null);
    setSlotActionTarget(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset]);

  // ── Fetch reservas y bloqueos del día ─────────────────────────────────

  const loadData = useCallback(async (showBlockingLoader = false) => {
    if (showBlockingLoader) setLoading(true);
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
    } finally {
      if (showBlockingLoader) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => loadData(false), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (!slotActionTarget) return;
    const options = getEndSlotOptions(slotActionTarget.startSlot);
    if (options.length > 0) {
      setSlotActionEndSlot(options[0]);
    }
  }, [slotActionTarget]);

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

  function closeSlotActionModal() {
    setSlotActionTarget(null);
    setSlotActionMode("manual");
    setBlockReason("Mantenimiento");
    setCustomReason("");
    setManualName("");
    setManualDni("");
    setManualPhone("");
  }

  function hasConflicts(field: number, slots: string[]) {
    const hasBlocked = blockedSlots.some(
      (b) => b.field === field && b.date === selectedDate && slots.includes(b.time_slot)
    );
    const hasReservation = reservations.some(
      (r) =>
        isReservationActive(r) &&
        r.field === field &&
        r.date === selectedDate &&
        (r.time_slots || []).some((slot) => slots.includes(slot))
    );
    return hasBlocked || hasReservation;
  }

  function handleSelectEmptySlot(field: number, timeSlot: string) {
    const nowIdx = TIME_SLOTS.indexOf(currentSlot);
    const targetIdx = TIME_SLOTS.indexOf(timeSlot);
    if (isToday && nowIdx > targetIdx) {
      toast("Ese horario ya pasó. Elige una hora actual o futura.", "info");
      return;
    }
    setSlotActionTarget({ field, startSlot: timeSlot });
  }

  async function handleSubmitSlotAction() {
    if (!slotActionTarget || selectedSlots.length === 0) {
      toast("Selecciona un rango de horario válido.", "error");
      return;
    }

    const { field, startSlot } = slotActionTarget;
    const endSlot = slotActionEndSlot;
    if (hasConflicts(field, selectedSlots)) {
      toast("Ese rango ya tiene reservas o bloqueos.", "error");
      return;
    }

    setSlotActionLoading(true);
    try {
      if (slotActionMode === "block") {
        const reasonText =
          blockReason === "Otro" ? customReason.trim() || "Bloqueado manual" : blockReason;
        const ops = selectedSlots.map((slot) =>
          store.addBlockedSlot({
            court_type: FIELD_TO_COURT_TYPE[field],
            field,
            date: selectedDate,
            time_slot: slot,
            reason: reasonText,
          })
        );
        const results = await Promise.all(ops);
        const okCount = results.filter(Boolean).length;
        if (okCount !== selectedSlots.length) {
          toast("Algunos slots no se pudieron bloquear.", "error");
        } else {
          toast("Horario bloqueado correctamente", "success");
        }
      } else {
        const name = manualName.trim();
        const dni = manualDni.trim();
        const phone = manualPhone.trim().replace(/\D/g, "");
        if (name.length < 3 || phone.length < 9) {
          toast("Completa nombre y WhatsApp válidos.", "error");
          setSlotActionLoading(false);
          return;
        }
        if (dni && dni.length !== 8) {
          toast("Si ingresas DNI, debe tener 8 dígitos.", "error");
          setSlotActionLoading(false);
          return;
        }

        const chatId = phone.startsWith("51") ? phone : `51${phone}`;
        const payload = {
          chat_id: chatId,
          court_type: FIELD_TO_COURT_TYPE[field],
          field,
          date: selectedDate,
          time_slots: selectedSlots,
          representative_name: name,
          phone_number: chatId,
          dni,
        };
        const res = await fetch("/api/reservations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error("No se pudo crear la reserva manual");
        }
        toast(
          `Reserva manual creada: Cancha ${field}, ${formatHour12(startSlot)} - ${formatHour12(endSlot)}`,
          "success"
        );
      }

      await loadData();
      closeSlotActionModal();
    } catch (e) {
      console.error(e);
      toast("No se pudo completar la acción.", "error");
    } finally {
      setSlotActionLoading(false);
    }
  }

  async function handleExtendReservationOneHour(reservation: Reservation) {
    if (!reservation.field || !reservation.time_slots?.length) {
      toast("No se puede extender esta reserva.", "error");
      return;
    }
    const lastSlot = reservation.time_slots[reservation.time_slots.length - 1];
    const lastIdx = TIME_SLOTS.indexOf(lastSlot);
    const nextSlot = TIME_SLOTS[lastIdx + 1];
    if (!nextSlot) {
      toast("Ya está en el último horario disponible.", "info");
      return;
    }
    if (reservation.date !== selectedDate) {
      toast("Solo puedes extender reservas del día mostrado.", "info");
      return;
    }
    if (hasConflicts(reservation.field, [nextSlot])) {
      toast("No se puede extender: el siguiente horario está ocupado.", "error");
      return;
    }

    setExtendingReservationId(reservation.id);
    try {
      const newSlots = [...reservation.time_slots, nextSlot];
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reservation.id, time_slots: newSlots }),
      });
      if (!res.ok) {
        let apiError = "No se pudo extender la reserva.";
        try {
          const data = await res.json();
          if (typeof data?.error === "string") apiError = data.error;
        } catch {
          // no-op
        }
        if (res.status === 409) {
          toast(`No se puede extender: ${apiError}`, "error");
          return;
        }
        throw new Error(apiError);
      }

      setReservations((prev) =>
        prev.map((r) => (r.id === reservation.id ? { ...r, time_slots: newSlots } : r))
      );
      sidebar.setSelectedReservation((prev) =>
        prev?.id === reservation.id ? { ...prev, time_slots: newSlots } : prev
      );
      toast("Reserva extendida +1 hora", "success");
    } catch (e) {
      console.error(e);
      toast("No se pudo extender la reserva.", "error");
    } finally {
      setExtendingReservationId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="-mb-24 md:-mb-8 px-2 md:px-3 py-2 h-[calc(100dvh-12px)] flex flex-col">
        {/* Header */}
        <div className="mb-2 shrink-0">
          <div className="flex items-center gap-3">
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
        <div className={`flex-1 min-h-0 transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          <ScheduleGrid
            reservations={reservations}
            blockedSlots={blockedSlots}
            autoAssignments={autoAssignments}
            currentSlot={currentSlot}
            isToday={isToday}
            onSelectReservation={sidebar.open}
            onSelectBlocked={setUnblockTarget}
            onSelectEmpty={handleSelectEmptySlot}
            maxHeight="100%"
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
          onEmitInvoice={sidebar.handleEmitInvoice}
          onAttachInvoice={sidebar.handleAttachInvoice}
          onUpdateDni={sidebar.handleUpdateDni}
          onCancelReservation={sidebar.handleCancelReservation}
          cancellingReservation={sidebar.cancellingReservation}
          onRevokeManualPayment={sidebar.handleRevokeManualPayment}
          onRegisterPayment={sidebar.handleRegisterPayment}
          onClose={sidebar.close}
          onToggleArrived={handleToggleArrived}
          onExtendReservation={() => handleExtendReservationOneHour(sidebar.selectedReservation!)}
          extendingReservation={extendingReservationId === sidebar.selectedReservation.id}
        />
      )}

      {/* Slot Action Modal */}
      {slotActionTarget && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeSlotActionModal} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg space-y-5">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Acción rápida</h3>
              <p className="text-sm text-gray-500 mt-1">
                Cancha {slotActionTarget.field} · {selectedDate} · desde {formatHour12(slotActionTarget.startSlot)}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">¿Qué deseas hacer?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSlotActionMode("manual")}
                  className={`py-3 rounded-xl font-bold border-2 transition-colors ${
                    slotActionMode === "manual"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  Reserva manual
                </button>
                <button
                  type="button"
                  onClick={() => setSlotActionMode("block")}
                  className={`py-3 rounded-xl font-bold border-2 transition-colors ${
                    slotActionMode === "block"
                      ? "border-red-500 bg-red-50 text-red-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  Bloquear
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Rango de horario</label>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs text-gray-500">Desde</p>
                  <p className="font-bold text-gray-900">{formatHour12(slotActionTarget.startSlot)}</p>
                </div>
                <div>
                  <label className="sr-only" htmlFor="end-slot">Hasta</label>
                  <select
                    id="end-slot"
                    value={slotActionEndSlot}
                    onChange={(e) => setSlotActionEndSlot(e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-bold text-gray-900 focus:border-blue-500 focus:outline-none"
                  >
                    {endSlotOptions.map((slot) => (
                      <option key={slot} value={slot}>
                        {formatHour12(slot)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {selectedSlots.length} hora{selectedSlots.length !== 1 ? "s" : ""} seleccionada
                {selectedSlots.length !== 1 ? "s" : ""}
              </p>
            </div>

            {slotActionMode === "block" ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Motivo</label>
                  <select
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value as (typeof BLOCK_REASONS)[number])}
                    className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-red-500 focus:outline-none"
                  >
                    {BLOCK_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                {blockReason === "Otro" && (
                  <input
                    type="text"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Escribe el motivo"
                    className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-red-500 focus:outline-none"
                  />
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Nombre completo"
                    className="rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={manualDni}
                    onChange={(e) => setManualDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="DNI (opcional)"
                    className="rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <p className="text-xs text-gray-400 -mt-1">DNI opcional. Puedes completarlo luego para emitir boleta.</p>
                <input
                  type="text"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  placeholder="WhatsApp (ej: 987654321)"
                  className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={closeSlotActionModal}
                disabled={slotActionLoading}
                className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmitSlotAction}
                disabled={slotActionLoading}
                className={`flex-1 py-3 px-4 font-semibold rounded-xl text-white transition-colors text-sm disabled:opacity-50 ${
                  slotActionMode === "block" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {slotActionLoading
                  ? "Guardando..."
                  : slotActionMode === "block"
                    ? "Bloquear horario"
                    : "Crear reserva"}
              </button>
            </div>
          </div>
        </>
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
