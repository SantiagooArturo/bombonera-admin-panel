"use client";

import { useState, useEffect, useMemo } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/lib/hooks";
import {
  COURT_LABELS,
  COURT_FIELDS,
  TIME_SLOTS,
  CourtType,
  type Reservation,
} from "@/lib/types";

const DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const NIGHT_BLOCK_STARTS = ["19:00", "21:00"];
const NIGHT_BLOCK_SECONDS = ["20:00", "22:00"];

const PENDING_EXPIRY_MS = 30 * 60 * 1000; // 30 min como en el bot

function formatDateToISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDaysForWeek(weekOffset: number): { id: string; name: string; date: number; month: number; fullDate: string; isWeekend: boolean; dayIndex: number }[] {
  const today = new Date();
  const startDate = new Date(today);
  const currentDay = today.getDay();
  const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  startDate.setDate(today.getDate() + daysToMonday + weekOffset * 7);

  const result = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    result.push({
      id: DAYS[i],
      name: DAY_NAMES[i],
      date: date.getDate(),
      month: date.getMonth() + 1,
      fullDate: formatDateToISO(date),
      isWeekend: i >= 5,
      dayIndex: i,
    });
  }
  return result;
}

function formatTime12h(time24h: string): string {
  const [h, m] = time24h.split(":");
  const hour = parseInt(h, 10);
  const min = m || "00";
  if (hour === 0) return `12:${min} am`;
  if (hour < 12) return `${hour}:${min} am`;
  if (hour === 12) return `12:${min} pm`;
  return `${hour - 12}:${min} pm`;
}

function getNightBlock(slot: string): { start: string; end: string; slots: string[] } | null {
  if (slot === "19:00" || slot === "20:00") return { start: "19:00", end: "21:00", slots: ["19:00", "20:00"] };
  if (slot === "21:00" || slot === "22:00") return { start: "21:00", end: "22:50", slots: ["21:00", "22:00"] };
  return null;
}

function isBlockStartSlot(slot: string): boolean {
  return NIGHT_BLOCK_STARTS.includes(slot);
}

function isBlockSecondSlot(slot: string): boolean {
  return NIGHT_BLOCK_SECONDS.includes(slot);
}

function getBlockRowSpan(slot: string): number {
  if (slot === "19:00" || slot === "21:00") return 2;
  return 1;
}

function isReservationActive(r: Reservation): boolean {
  if (r.status === "paid") return true;
  if (r.status !== "pending") return false;
  const created = new Date(r.created_at).getTime();
  return Date.now() - created < PENDING_EXPIRY_MS;
}

type CellAvailability = { reserved: number; blocked: number; available: number };

export default function CanchasPage() {
  const store = useStore();
  const toast = useToastContext();
  const reservations = store.getReservations();
  const blockedSlots = store.getBlockedSlots();

  const [selectedCourt, setSelectedCourt] = useState<CourtType>("voley_maple");
  const [weekOffset, setWeekOffset] = useState(0);
  const [loadingCourt, setLoadingCourt] = useState(false);
  const [blockDialog, setBlockDialog] = useState<{ fullDate: string; dayId: string; timeSlot: string } | null>(null);
  const [unblockId, setUnblockId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("Mantenimiento");

  const days = useMemo(() => getDaysForWeek(weekOffset), [weekOffset]);

  useEffect(() => {
    setLoadingCourt(true);
    Promise.all([
      store.fetchReservations({ court_type: selectedCourt }),
      store.fetchBlockedSlots({ court_type: selectedCourt }),
    ]).finally(() => setLoadingCourt(false));
  }, [selectedCourt, store]);

  const totalFields = COURT_FIELDS[selectedCourt].length;

  function getCellAvailability(fullDate: string, dayId: string, timeSlot: string): CellAvailability {
    const slotKey = `${dayId}-${timeSlot}`;
    const block = getNightBlock(timeSlot);
    const slotKeysToCount = block ? block.slots.map((s) => `${dayId}-${s}`) : [slotKey];

    let reserved = 0;
    const seenReservationIds = new Set<string>();
    for (const r of reservations) {
      if (r.court_type !== selectedCourt || r.date !== fullDate || !isReservationActive(r)) continue;
      const hasAny = slotKeysToCount.some((sk) => r.slot_keys?.includes(sk));
      if (hasAny && !seenReservationIds.has(r.id)) {
        seenReservationIds.add(r.id);
        reserved += 1;
      }
    }

    const blocked = block
      ? blockedSlots.filter(
          (b) => b.court_type === selectedCourt && b.date === fullDate && block.slots.includes(b.time_slot)
        ).length
      : blockedSlots.filter(
          (b) => b.court_type === selectedCourt && b.date === fullDate && b.time_slot === timeSlot
        ).length;

    const available = Math.max(0, totalFields - reserved - blocked);
    return { reserved, blocked, available };
  }

  function getFirstBlockIdForCell(fullDate: string, timeSlot: string): string | null {
    const block = getNightBlock(timeSlot);
    const slots = block ? block.slots : [timeSlot];
    const b = blockedSlots.find(
      (x) => x.court_type === selectedCourt && x.date === fullDate && slots.includes(x.time_slot)
    );
    return b?.id ?? null;
  }

  function getFieldAndTimeSlotToBlock(fullDate: string, timeSlot: string): { field: number; time_slot: string } {
    const block = getNightBlock(timeSlot);
    const fields = COURT_FIELDS[selectedCourt];

    if (block) {
      for (const s of block.slots) {
        const used = new Set(
          blockedSlots
            .filter((x) => x.court_type === selectedCourt && x.date === fullDate && x.time_slot === s)
            .map((x) => x.field)
        );
        const field = fields.find((f) => !used.has(f));
        if (field !== undefined) return { field, time_slot: s };
      }
      return { field: fields[0], time_slot: block.slots[0] };
    }

    const used = new Set(
      blockedSlots
        .filter((x) => x.court_type === selectedCourt && x.date === fullDate && x.time_slot === timeSlot)
        .map((x) => x.field)
    );
    const field = fields.find((f) => !used.has(f)) ?? fields[0];
    return { field, time_slot: timeSlot };
  }

  async function handleBlock() {
    if (!blockDialog) return;
    const { field, time_slot } = getFieldAndTimeSlotToBlock(blockDialog.fullDate, blockDialog.timeSlot);
    const result = await store.addBlockedSlot({
      court_type: selectedCourt,
      field,
      date: blockDialog.fullDate,
      time_slot,
      reason: blockReason,
    });
    if (result) {
      toast(`Horario bloqueado: ${blockDialog.timeSlot} el ${blockDialog.fullDate}`, "success");
    } else {
      toast("Error al bloquear horario", "error");
    }
    setBlockDialog(null);
    setBlockReason("Mantenimiento");
  }

  async function handleUnblock() {
    if (!unblockId) return;
    const success = await store.removeBlockedSlot(unblockId);
    if (success) toast("Bloqueo eliminado", "info");
    else toast("Error al desbloquear", "error");
    setUnblockId(null);
  }

  function handleCellClick(day: { fullDate: string; id: string }, timeSlot: string) {
    const { available, blocked } = getCellAvailability(day.fullDate, day.id, timeSlot);
    if (available > 0) {
      setBlockDialog({ fullDate: day.fullDate, dayId: day.id, timeSlot });
    } else if (blocked > 0) {
      const id = getFirstBlockIdForCell(day.fullDate, timeSlot);
      if (id) setUnblockId(id);
    }
  }

  function getWeekLabel() {
    if (days.length === 0) return "Semana";
    const s = days[0];
    const e = days[6];
    if (weekOffset === 0) return `Esta semana (${s.date}/${s.month} - ${e.date}/${e.month})`;
    return `Semana del ${s.date}/${s.month} al ${e.date}/${e.month}`;
  }

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Canchas</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Disponibilidad por tipo de cancha (como en el bot). Sin elegir campo concreto.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1 w-full sm:max-w-xs">
              <label className="block text-body font-medium text-gray-600 mb-2">Tipo de Cancha</label>
              <select
                value={selectedCourt}
                onChange={(e) => setSelectedCourt(e.target.value as CourtType)}
                disabled={loadingCourt}
                className="w-full px-5 py-4 text-body-lg font-semibold rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50 disabled:opacity-70"
              >
                {Object.entries(COURT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            {loadingCourt && (
              <div className="flex items-center gap-2 text-gray-600" aria-hidden>
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-bombonera-500" />
                <span className="text-body font-medium">Cargando…</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 bg-gray-100 rounded-xl p-3 mb-4">
          <button
            type="button"
            onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
            disabled={weekOffset === 0}
            className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="sr-only">Anterior</span>
            ←
          </button>
          <p className="text-sm font-semibold text-gray-800">{getWeekLabel()}</p>
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-lg hover:bg-gray-200"
          >
            <span className="sr-only">Siguiente</span>
            →
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto relative">
          {loadingCourt && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 rounded-2xl">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-bombonera-500" />
            </div>
          )}
          <div
            className="grid min-w-[640px]"
            style={{ gridTemplateColumns: "minmax(0, 4.5rem) repeat(7, 1fr)" }}
          >
            <div className="h-12" />
            {days.map((day) => (
              <div
                key={`head-${day.id}`}
                className={`h-12 flex flex-col items-center justify-center border-b-2 border-gray-200 ${
                  day.isWeekend ? "bg-amber-50" : ""
                }`}
              >
                <span className="text-xs font-bold text-gray-700 uppercase">{day.name.slice(0, 3)}</span>
                <span className="text-sm font-semibold text-gray-500">{day.date}</span>
              </div>
            ))}

            {TIME_SLOTS.map((slot, slotIndex) => {
              const isNight = parseInt(slot.split(":")[0], 10) >= 18;
              const isBlockStart = isBlockStartSlot(slot);
              const isBlockSecond = isBlockSecondSlot(slot);

              return (
                <div key={`row-${slot}`} className="contents">
                  <div
                    className="flex items-start justify-end text-xs font-semibold text-gray-600 pr-1.5 pt-0.5"
                    style={{ height: 40 }}
                  >
                    <span
                      className="block -translate-y-1/2 whitespace-nowrap"
                      style={{ lineHeight: 1 }}
                    >
                      {formatTime12h(slot)}
                    </span>
                  </div>

                  {days.map((day) => {
                    const isWeekend = day.isWeekend;
                    const isWeekdayNight = isNight && !isWeekend;
                    if (isWeekdayNight && isBlockSecond) return null;

                    const { blocked, available } = getCellAvailability(day.fullDate, day.id, slot);
                    const rowSpan = isWeekdayNight && isBlockStart ? getBlockRowSpan(slot) : 1;
                    const cellHeight = 40 * rowSpan;

                    let label: string;
                    if (available >= totalFields) label = `${totalFields} libres`;
                    else if (available > 0) label = `${available} libre${available > 1 ? "s" : ""}`;
                    else if (blocked > 0) label = "Bloqueado";
                    else label = "Completo";

                    const canBlock = available > 0;
                    const canUnblock = blocked > 0;

                    const block = getNightBlock(slot);
                    const blockTitle =
                      isWeekdayNight && isBlockStart && block
                        ? `${formatTime12h(block.start)}-${formatTime12h(block.end)}`
                        : undefined;

                    return (
                      <button
                        key={`${day.id}-${slot}`}
                        type="button"
                        onClick={() => handleCellClick(day, slot)}
                        disabled={!canBlock && !canUnblock}
                        title={blockTitle}
                        style={{
                          gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined,
                          height: cellHeight,
                          marginTop: slotIndex === 0 ? 0 : -1,
                        }}
                        className={`
                          border-t border-l border-gray-200 m-0.5 rounded-lg text-xs font-medium flex items-center justify-center transition-all
                          ${day.isWeekend ? "bg-amber-50/50" : ""}
                          ${available >= totalFields ? "bg-green-50 border-green-300 text-green-800 hover:bg-green-100 cursor-pointer" : ""}
                          ${available > 0 && available < totalFields ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer" : ""}
                          ${available === 0 && blocked > 0 ? "bg-red-50 border-red-300 text-red-800 hover:bg-red-100 cursor-pointer" : ""}
                          ${available === 0 && blocked === 0 ? "bg-gray-100 border-gray-200 text-gray-600 cursor-default" : ""}
                          ${!canBlock && !canUnblock ? "cursor-default opacity-80" : ""}
                        `}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            <div
              className="flex items-start justify-end text-xs font-semibold text-gray-600 pr-1.5 pt-0.5"
              style={{ height: 40 }}
            >
              <span
                className="block -translate-y-1/2 whitespace-nowrap"
                style={{ lineHeight: 1 }}
              >
                {formatTime12h("22:50")}
              </span>
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={`foot-${i}`} />
            ))}
          </div>
        </div>
      </div>

      {blockDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <h3 className="text-heading font-bold text-gray-900 mb-2">Bloquear 1 horario</h3>
            <p className="text-body text-gray-600 mb-6">
              {blockDialog.timeSlot} — {blockDialog.fullDate} ({COURT_LABELS[selectedCourt]})
            </p>
            <label className="block text-body font-medium text-gray-600 mb-2">Motivo</label>
            <select
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              className="w-full px-5 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50 mb-6"
            >
              <option value="Mantenimiento">Mantenimiento</option>
              <option value="Evento privado">Evento privado</option>
              <option value="Reservado manual">Reservado manual</option>
              <option value="Otro">Otro</option>
            </select>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => { setBlockDialog(null); setBlockReason("Mantenimiento"); }}
                className="flex-1 px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleBlock}
                className="flex-1 px-6 py-4 text-body font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700"
              >
                Bloquear
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={unblockId !== null}
        title="Desbloquear horario"
        message="¿Quieres desbloquear este horario y dejarlo disponible?"
        confirmLabel="Sí, desbloquear"
        onConfirm={handleUnblock}
        onCancel={() => setUnblockId(null)}
      />
    </ClientLayout>
  );
}
