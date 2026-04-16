"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";

import { TIME_SLOTS, type Reservation, type BlockedSlot, isReservationActive, type RecurrentSchedule } from "@/lib/types";
import type { CourtFieldConfig } from "@/lib/court-config";
import ScheduleGrid from "@/components/operations/ScheduleGrid";
import PaymentSidebar from "@/components/verificacion/PaymentSidebar";
import { usePaymentSidebar } from "@/components/verificacion/usePaymentSidebar";
import { computeAutoAssignments } from "@/components/operations/autoAssign";
import OperationsHeader from "@/features/operaciones/components/OperationsHeader";
import SlotActionModal from "@/features/operaciones/components/SlotActionModal";
import UnblockModal from "@/features/operaciones/components/UnblockModal";
import SendAvailabilityModal from "@/features/operaciones/components/SendAvailabilityModal";
import { printAvailabilitySheet } from "@/features/operaciones/utils/printAvailabilitySheet";
import {
  BLOCK_REASONS,
  FIELD_TO_COURT_TYPE,
  MAX_DAY_OFFSET,
  formatDateISO,
  formatHour12,
  getCurrentSlot,
  getDateWithOffset,
  getEndSlotOptions,
  getSlotsInRange,
  getUserName,
  getUserPhone,
  isValidPeruPhone,
  normalizePeruPhone,
} from "@/features/operaciones/utils";

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OperacionesPage() {
  const toast = useToastContext();
  const store = useStore();
  const MIN_OPERATIONS_DATE = "2026-03-01";

  const [dayOffset, setDayOffset] = useState(0);
  const [currentSlot, setCurrentSlot] = useState(getCurrentSlot);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [courtConfigs, setCourtConfigs] = useState<CourtFieldConfig[] | null>(null);
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
  const [sendAvailabilityOpen, setSendAvailabilityOpen] = useState(false);
  const [sendAvailabilityLoading, setSendAvailabilityLoading] = useState(false);
  const [availabilityPhone, setAvailabilityPhone] = useState("");
  const [availabilityDates, setAvailabilityDates] = useState<string[]>([]);

  const preserveSidebarOnDayChangeRef = useRef(false);
  const skipBlockingLoaderRef = useRef(false);
  const ignoreListClickRef = useRef(false);

  const sidebar = usePaymentSidebar({
    onReservationUpdated: (resId, patch) => {
      setReservations((prev) => prev.map((r) => (r.id === resId ? { ...r, ...patch } : r)));
      // SI detectamos un cambio en la recurrencia, refrescamos los badges inmediatamente
      if ("is_recurrent" in patch) {
        setTimeout(() => {
          loadRecurrentSchedules();
        }, 800);
      }
    },
    onReservationDeleted: (resId) => {
      setReservations((prev) => prev.filter((r) => r.id !== resId));
    },
  });

  useEffect(() => {
    const interval = setInterval(() => setCurrentSlot(getCurrentSlot()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch("/api/court-config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCourtConfigs(data);
      })
      .catch(() => setCourtConfigs(null));
  }, []);

  useEffect(() => {
    if (!store.isLoaded("users")) {
      store.fetchUsers();
    }
  }, [store]);

  /** Usuarios ordenados; se actualiza cuando el store cambia (p. ej. al editar tipo de cliente). */
  const users = [...store.getUsers()].sort((a, b) => {
    const timeA = (a.last_interaction_at || a.created_at) ? new Date(a.last_interaction_at || a.created_at!).getTime() || 0 : 0;
    const timeB = (b.last_interaction_at || b.created_at) ? new Date(b.last_interaction_at || b.created_at!).getTime() || 0 : 0;
    if (timeA !== timeB) return timeB - timeA;
    // Fallback: Si no hay tiempos, preferir que los "vacíos" o "." vayan al final si no tienen nombre real
    const nameA = getUserName(a);
    const nameB = getUserName(b);
    return nameA.localeCompare(nameB, "es");
  });


  const selectedDate = useMemo(() => formatDateISO(getDateWithOffset(dayOffset)), [dayOffset]);
  const todayDate = useMemo(() => formatDateISO(new Date()), []);
  const minDayOffset = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(`${MIN_OPERATIONS_DATE}T12:00:00`);
    minDate.setHours(0, 0, 0, 0);
    const diffMs = minDate.getTime() - today.getTime();
    return Math.round(diffMs / (24 * 60 * 60 * 1000));
  }, [MIN_OPERATIONS_DATE]);
  const availabilityDayOptions = useMemo(
    () => Array.from({ length: MAX_DAY_OFFSET + 1 }, (_, idx) => formatDateISO(getDateWithOffset(idx))),
    []
  );

  const selectedDateLabel = useMemo(() => {
    const date = getDateWithOffset(dayOffset);
    if (dayOffset === 0) return "Hoy";
    if (dayOffset === 1) return "Mañana";
    if (dayOffset === -1) return "Ayer";
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
  const phoneDirectory = useMemo(
    () =>
      users
        .map((u) => {
          const raw = getUserPhone(u);
          const names = [u.custom_name, u.contact_name, u.push_name].filter(Boolean) as string[];
          return {
            phone: normalizePeruPhone(raw) || raw,
            name: getUserName(u),
            searchText: names.length > 0 ? names.join(" ") : undefined,
            dni: (u.last_dni || "").replace(/\D/g, "").slice(0, 8),
            picture: u.profile_picture || `/api/chats/picture?chat_id=${u.chat_id}`,
          };
        })
        .filter((u) => u.phone.length >= 9),
    [users]
  );

  const [recurrentSchedules, setRecurrentSchedules] = useState<RecurrentSchedule[]>([]);

  const loadRecurrentSchedules = useCallback(() => {
    fetch("/api/recurrent-schedules", { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRecurrentSchedules(data);
      })
      .catch(err => console.error("Error loading recurrent schedules:", err));
  }, []);

  useEffect(() => {
    loadRecurrentSchedules();
  }, [loadRecurrentSchedules]);


  useEffect(() => {
    if (preserveSidebarOnDayChangeRef.current) {
      preserveSidebarOnDayChangeRef.current = false;
    } else {
      sidebar.close();
    }
    setUnblockTarget(null);
    setSlotActionTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (document.activeElement) {
        const tag = document.activeElement.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        // ignorar también en caso de tener elementos editables por contenido
        if (document.activeElement.getAttribute('contenteditable') === 'true') return;
      }

      if (e.key === "ArrowLeft") {
        setDayOffset((prev) => Math.max(minDayOffset, prev - 1));
      } else if (e.key === "ArrowRight") {
        setDayOffset((prev) => prev + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [minDayOffset]);

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

  const prevCountsRef = useRef({ reservations: -1, blocks: -1 });

  useEffect(() => {
    // Cuando cambiamos de dia reiniciamos la memoria anterior
    prevCountsRef.current = { reservations: -1, blocks: -1 };
    const skipBlockingLoader = preserveSidebarOnDayChangeRef.current;
    loadData(!skipBlockingLoader);

    const checkCount = async () => {
      try {
        const res = await fetch(`/api/reservations/count?date=${selectedDate}`);
        if (res.ok) {
          const data = await res.json();
          const p = prevCountsRef.current;
          if (p.reservations !== -1 && (p.reservations !== data.reservations || p.blocks !== data.blocks)) {
            loadData(false);
          }
          prevCountsRef.current = data;
        }
      } catch {
        // fail silently for background polling
      }
    };

    const interval = setInterval(checkCount, 5000);
    return () => clearInterval(interval);
  }, [loadData, selectedDate]);

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

  const userNotesMap = new Map<string, string>();
  const normKey = (s: string | number | undefined | null) => String(s || "").replace(/\D/g, "").slice(-9);
  for (const u of users) {
    if (u.last_note) {
      // Registrar ambas claves (id y chat_id) porque algunos usuarios de WhatsApp
      // tienen chat_id en formato @lid (Linked Device ID) distinto al número de teléfono.
      const keyById = normKey(u.id);
      const keyByChatId = normKey(u.chat_id);
      if (keyById) userNotesMap.set(keyById, u.last_note);
      if (keyByChatId && keyByChatId !== keyById) userNotesMap.set(keyByChatId, u.last_note);
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

  function closeSendAvailabilityModal() {
    setSendAvailabilityOpen(false);
    setSendAvailabilityLoading(false);
    setAvailabilityPhone("");
    setAvailabilityDates([]);
  }

  function toggleAvailabilityDate(date: string) {
    setAvailabilityDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]
    );
  }

  function isDateAvailabilitySendable(date: string): boolean {
    if (date < todayDate) return false;
    if (date === todayDate) return new Date().getHours() < 22;
    return true;
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

  async function handleSendAvailability() {
    if (!isValidPeruPhone(availabilityPhone)) {
      toast("Selecciona un contacto o escribe un número de 9 dígitos.", "error");
      return;
    }
    if (availabilityDates.length === 0) {
      toast("Selecciona al menos un día para enviar.", "error");
      return;
    }
    const invalidDates = availabilityDates.filter((d) => !isDateAvailabilitySendable(d));
    if (invalidDates.length > 0) {
      toast("Incluiste días no permitidos (pasados o hoy después de las 10pm).", "error");
      return;
    }

    setSendAvailabilityLoading(true);
    try {
      const chatId = normalizePeruPhone(availabilityPhone);
      let successCount = 0;
      for (const date of availabilityDates) {
        const res = await fetch("/api/send-availability", {
          method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            date,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            typeof data?.error === "string"
              ? `${date}: ${data.error}`
              : `${date}: No se pudo enviar`
          );
        }
        successCount++;
      }
      toast(
        successCount === 1
          ? "Disponibilidad enviada por WhatsApp"
          : `Disponibilidad enviada (${successCount} días)`,
        "success"
      );
      closeSendAvailabilityModal();
    } catch (error) {
      console.error(error);
      toast(error instanceof Error ? error.message : "No se pudo enviar disponibilidad.", "error");
    } finally {
      setSendAvailabilityLoading(false);
    }
  }

  function handlePrintAvailability() {
    const ok = printAvailabilitySheet({
      date: selectedDate,
      reservations,
    });
    if (!ok) {
      toast("No se pudo abrir la vista de impresión. Revisa si tu navegador bloqueó la ventana emergente.", "error");
    }
  }

  function openSendAvailabilityModal() {
    setAvailabilityPhone("");
    // Usar por defecto la fecha actualmente seleccionada en la vista de operaciones,
    // en lugar de forzar siempre "hoy".
    setAvailabilityDates([selectedDate]);
    setSendAvailabilityOpen(true);
  }

  function handleManualPhoneChange(rawValue: string) {
    const cleanPhone = normalizePeruPhone(rawValue) || rawValue.replace(/\D/g, "").slice(0, 12);
    setManualPhone(cleanPhone);
    const match = phoneDirectory.find((u) => normalizePeruPhone(u.phone) === cleanPhone || u.phone === cleanPhone);
    if (match) {
      setManualName(match.name);
      if (!manualDni && match.dni) setManualDni(match.dni);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="fixed top-3 right-3 md:top-4 md:right-4 z-30 flex items-center gap-2">
        <button
          onClick={handlePrintAvailability}
          disabled={loading}
          className="px-3 md:px-4 py-2 rounded-xl bg-white border border-gray-300 text-gray-800 font-semibold text-sm hover:bg-gray-50 shadow-lg transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Imprimir disponibilidad
        </button>
        <button
          onClick={openSendAvailabilityModal}
          disabled={loading}
          className="px-3 md:px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-lg transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Enviar disponibilidad
        </button>
      </div>
      <div className="-mb-24 md:-mb-8 px-2 md:px-3 py-2 h-[calc(100dvh-12px)] flex flex-col">
        <OperationsHeader
          dayOffset={dayOffset}
          selectedDateISO={selectedDate}
          selectedDateLabel={selectedDateLabel}
          isToday={isToday}
          minDayOffset={minDayOffset}
          minSelectableDateISO={MIN_OPERATIONS_DATE}
          onPrevDay={() => setDayOffset((prev) => Math.max(minDayOffset, prev - 1))}
          onNextDay={() => setDayOffset((prev) => prev + 1)}
          onGoToday={() => setDayOffset(0)}
          onPickDate={(dateISO) => {
            if (!dateISO) return;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const picked = new Date(`${dateISO}T12:00:00`);
            if (Number.isNaN(picked.getTime())) return;
            picked.setHours(0, 0, 0, 0);
            const diffMs = picked.getTime() - today.getTime();
            const offset = Math.round(diffMs / (24 * 60 * 60 * 1000));
            const clamped = Math.max(minDayOffset, offset);
            setDayOffset(clamped);
          }}
          onOpenSendAvailability={openSendAvailabilityModal}
          showSendButton={false}
        />

        {/* Grid */}
        <div className={`flex-1 min-h-0 transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          <ScheduleGrid
            reservations={reservations}
            blockedSlots={blockedSlots}
            autoAssignments={autoAssignments}
            courtConfigs={courtConfigs}
            recurrentSchedules={recurrentSchedules}
            currentSlot={currentSlot}
            isToday={isToday}
            onSelectReservation={sidebar.open}
            onSelectBlocked={setUnblockTarget}
            onSelectEmpty={handleSelectEmptySlot}
            userNotesMap={userNotesMap}
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
          attachingInvoiceId={sidebar.attachingInvoiceId}
          paymentLoading={sidebar.paymentLoading}
          onVerifyTransfer={sidebar.handleVerifyTransfer}
          onEmitInvoice={sidebar.handleEmitInvoice}
          onAttachInvoice={sidebar.handleAttachInvoice}
          onDetachInvoice={sidebar.handleDetachInvoice}
          onVoidSunatInvoice={sidebar.handleVoidSunatInvoice}
          onUpdateDni={sidebar.handleUpdateDni}
          onUpdateRuc={sidebar.handleUpdateRuc}
          onUpdateName={sidebar.handleUpdateName}
          onToggleRecurrence={sidebar.handleToggleRecurrence}
          recurrenceConflict={sidebar.recurrenceConflict}
          setRecurrenceConflict={sidebar.setRecurrenceConflict}
          recurrenceUpdating={sidebar.recurrenceUpdating}
          clientRuc={sidebar.userNames?.last_ruc}
          clientLastDni={sidebar.userNames?.last_dni}
          displayName={sidebar.displayName}
          userCustomName={sidebar.userNames?.custom_name}
          onCancelReservation={sidebar.handleCancelReservation}
          cancellingReservation={sidebar.cancellingReservation}
          onRevokeManualPayment={sidebar.handleRevokeManualPayment}
          onRegisterPayment={sidebar.handleRegisterPayment}
          onToggleApplied={sidebar.handleToggleApplied}
          onUpdatePrice={sidebar.handleUpdatePrice}
          onUpdateAmountPaid={sidebar.handleUpdateAmountPaid}
          amountPaidDeltaPrompt={sidebar.amountPaidDeltaPrompt}
          onResolveAmountPaidDeltaPrompt={sidebar.resolveAmountPaidDeltaPrompt}
          pendingEmitFromAmountEdit={sidebar.pendingEmitFromAmountEdit}
          onClearPendingEmitFromAmountEdit={sidebar.clearPendingEmitFromAmountEdit}
          clientType={sidebar.clientType}
          clientTypeLoading={sidebar.clientTypeLoading}
          clientTypeUpdating={sidebar.clientTypeUpdating}
          onUpdateClientType={async (type) => {
            ignoreListClickRef.current = true;
            const ok = await sidebar.handleUpdateClientType(type);
            setTimeout(() => { ignoreListClickRef.current = false; }, 300);
            return ok;
          }}
          onUpdateStatus={sidebar.handleUpdateStatus}
          statusUpdating={sidebar.statusUpdating}
          onClose={sidebar.close}
          courtConfigs={courtConfigs}
          allReservationsThisWeek={sidebar.allReservationsThisWeek}
          notes={sidebar.notes}
          loadingNotes={sidebar.loadingNotes}
          onAddNote={sidebar.handleAddNote}
          onDeleteNote={sidebar.handleDeleteNote}
          onSelectReservationFromList={(r) => {
            if (ignoreListClickRef.current) return;
            preserveSidebarOnDayChangeRef.current = true;
            skipBlockingLoaderRef.current = true;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const resDate = new Date(r.date + "T12:00:00");
            resDate.setHours(0, 0, 0, 0);
            const diffMs = resDate.getTime() - today.getTime();
            const offset = Math.round(diffMs / (24 * 60 * 60 * 1000));
            const clamped = Math.max(minDayOffset, Math.min(MAX_DAY_OFFSET, offset));
            setDayOffset(clamped);
            sidebar.open(r);
          }}
        />
      )}

      <SlotActionModal
        open={Boolean(slotActionTarget)}
        field={slotActionTarget?.field ?? 0}
        selectedDate={selectedDate}
        startSlot={slotActionTarget?.startSlot ?? TIME_SLOTS[0]}
        endSlotOptions={endSlotOptions}
        selectedSlotsCount={selectedSlots.length}
        slotActionEndSlot={slotActionEndSlot}
        setSlotActionEndSlot={setSlotActionEndSlot}
        slotActionMode={slotActionMode}
        setSlotActionMode={setSlotActionMode}
        blockReasons={BLOCK_REASONS}
        blockReason={blockReason}
        setBlockReason={(value) => setBlockReason(value as (typeof BLOCK_REASONS)[number])}
        customReason={customReason}
        setCustomReason={setCustomReason}
        manualPhone={manualPhone}
        manualPhoneValid={isValidPeruPhone(manualPhone)}
        onManualPhoneChange={handleManualPhoneChange}
        phoneOptions={phoneDirectory}
        manualName={manualName}
        setManualName={setManualName}
        manualDni={manualDni}
        setManualDni={setManualDni}
        slotActionLoading={slotActionLoading}
        formatHour12={formatHour12}
        onClose={closeSlotActionModal}
        onSubmit={handleSubmitSlotAction}
      />

      <UnblockModal
        target={unblockTarget}
        unblocking={unblocking}
        formatHour12={formatHour12}
        onClose={() => setUnblockTarget(null)}
        onConfirm={handleUnblock}
      />

      <SendAvailabilityModal
        open={sendAvailabilityOpen}
        dayOptions={availabilityDayOptions}
        selectedDates={availabilityDates}
        toggleDate={toggleAvailabilityDate}
        availabilityPhone={availabilityPhone}
        availabilityPhoneValid={isValidPeruPhone(availabilityPhone)}
        setAvailabilityPhone={setAvailabilityPhone}
        phoneOptions={phoneDirectory}
        loading={sendAvailabilityLoading}
        onClose={closeSendAvailabilityModal}
        onSubmit={handleSendAvailability}
      />
    </ClientLayout>
  );
}
