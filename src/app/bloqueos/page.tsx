"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { TIME_SLOTS, COURT_FIELDS, type CourtType, type BlockedSlot } from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALL_FIELDS = Object.values(COURT_FIELDS).flat().sort((a, b) => a - b);

const FIELD_COURT_TYPE: Record<number, CourtType> = {};
for (const [ct, fields] of Object.entries(COURT_FIELDS)) {
  for (const f of fields) FIELD_COURT_TYPE[f] = ct as CourtType;
}

const WEEKDAY_LABELS = [
  { id: 0, short: "Dom", long: "Domingo" },
  { id: 1, short: "Lun", long: "Lunes" },
  { id: 2, short: "Mar", long: "Martes" },
  { id: 3, short: "Mié", long: "Miércoles" },
  { id: 4, short: "Jue", long: "Jueves" },
  { id: 5, short: "Vie", long: "Viernes" },
  { id: 6, short: "Sáb", long: "Sábado" },
];

const REASONS = [
  "Mantenimiento",
  "Evento privado",
  "Reservado internamente",
  "Clima / lluvia",
  "Otro",
];

function formatHour12(slot: string) {
  const h = parseInt(slot.split(":")[0]);
  if (h === 0) return "12 am";
  if (h < 12) return `${h} am`;
  if (h === 12) return "12 pm";
  return `${h - 12} pm`;
}

function formatDateISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateDisplay(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });
}

function getDatesInRange(from: string, to: string, weekdays: number[]): string[] {
  const dates: string[] = [];
  const start = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  const current = new Date(start);
  while (current <= end) {
    if (weekdays.includes(current.getDay())) {
      dates.push(formatDateISO(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getTimeSlotsInRange(from: string, to: string): string[] {
  const startIdx = TIME_SLOTS.indexOf(from);
  const endIdx = TIME_SLOTS.indexOf(to);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return [];
  return TIME_SLOTS.slice(startIdx, endIdx);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function BloqueosPage() {
  const store = useStore();
  const toast = useToastContext();

  // Form state
  const [selectedFields, setSelectedFields] = useState<number[]>([]);
  const [timeFrom, setTimeFrom] = useState(TIME_SLOTS[0]);
  const [timeTo, setTimeTo] = useState(TIME_SLOTS[2]);
  const [mode, setMode] = useState<"single" | "recurring">("single");
  const [singleDate, setSingleDate] = useState(formatDateISO(new Date()));
  const [recurringWeekdays, setRecurringWeekdays] = useState<number[]>([]);
  const [recurringFrom, setRecurringFrom] = useState(formatDateISO(new Date()));
  const [recurringTo, setRecurringTo] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return formatDateISO(d);
  });
  const [reason, setReason] = useState(REASONS[0]);
  const [submitting, setSubmitting] = useState(false);

  // Existing blocks state
  const blockedSlots = store.getBlockedSlots();
  const blockedLoaded = store.isLoaded("blockedSlots");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    store.fetchBlockedSlots();
  }, [store]);

  // ── Computed preview ──────────────────────────────────────────────────

  const datesToBlock = useMemo(() => {
    if (mode === "single") return [singleDate];
    return getDatesInRange(recurringFrom, recurringTo, recurringWeekdays);
  }, [mode, singleDate, recurringFrom, recurringTo, recurringWeekdays]);

  const slotsToBlock = useMemo(() => getTimeSlotsInRange(timeFrom, timeTo), [timeFrom, timeTo]);

  const totalBlocks = selectedFields.length * datesToBlock.length * slotsToBlock.length;
  const canSubmit = selectedFields.length > 0 && slotsToBlock.length > 0 && datesToBlock.length > 0 && !submitting;

  // ── Field selection ───────────────────────────────────────────────────

  function toggleField(field: number) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  function selectAllFields() {
    setSelectedFields((prev) => (prev.length === ALL_FIELDS.length ? [] : [...ALL_FIELDS]));
  }

  // ── Weekday toggles ───────────────────────────────────────────────────

  function toggleWeekday(day: number) {
    setRecurringWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  // ── Submit ────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);

    let created = 0;
    let failed = 0;

    for (const date of datesToBlock) {
      for (const field of selectedFields) {
        for (const slot of slotsToBlock) {
          const result = await store.addBlockedSlot({
            court_type: FIELD_COURT_TYPE[field],
            field,
            date,
            time_slot: slot,
            reason,
          });
          if (result) created++;
          else failed++;
        }
      }
    }

    setSubmitting(false);

    if (created > 0) {
      toast(`${created} horario${created > 1 ? "s" : ""} bloqueado${created > 1 ? "s" : ""}`, "success");
      setSelectedFields([]);
      setRecurringWeekdays([]);
    }
    if (failed > 0) {
      toast(`${failed} bloqueo${failed > 1 ? "s" : ""} fallaron`, "error");
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    const ok = await store.removeBlockedSlot(id);
    if (ok) toast("Bloqueo eliminado", "success");
    else toast("Error al eliminar", "error");
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [store, toast]);

  // ── Grouped blocks for display ────────────────────────────────────────

  const upcomingBlocks = useMemo(() => {
    const today = formatDateISO(new Date());
    return [...blockedSlots]
      .filter((b) => b.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time_slot.localeCompare(b.time_slot) || a.field - b.field);
  }, [blockedSlots]);

  const groupedBlocks = useMemo(() => {
    const groups: Record<string, BlockedSlot[]> = {};
    for (const b of upcomingBlocks) {
      if (!groups[b.date]) groups[b.date] = [];
      groups[b.date].push(b);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [upcomingBlocks]);

  // ── Time options for "hasta" (only after "desde") ─────────────────────

  const timeToOptions = useMemo(() => {
    const fromIdx = TIME_SLOTS.indexOf(timeFrom);
    return TIME_SLOTS.filter((_, i) => i > fromIdx);
  }, [timeFrom]);

  useEffect(() => {
    if (!timeToOptions.includes(timeTo)) {
      setTimeTo(timeToOptions[0] || TIME_SLOTS[TIME_SLOTS.length - 1]);
    }
  }, [timeToOptions, timeTo]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Bloquear Horarios</h1>
          <p className="text-lg text-gray-500 mt-2">
            Bloquea canchas para mantenimiento, eventos u otros motivos.
          </p>
        </div>

        {/* ── FORMULARIO ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8 space-y-8 mb-10">

          {/* 1. Canchas */}
          <div>
            <label className="block text-lg font-bold text-gray-800 mb-3">
              ¿Qué canchas bloquear?
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFields}
                className={`px-5 py-3 rounded-xl font-bold text-sm border-2 transition-all ${
                  selectedFields.length === ALL_FIELDS.length
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                Todas
              </button>
              {ALL_FIELDS.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => toggleField(field)}
                  className={`px-5 py-3 rounded-xl font-bold text-sm border-2 transition-all min-w-[64px] ${
                    selectedFields.includes(field)
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {field}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Horario */}
          <div>
            <label className="block text-lg font-bold text-gray-800 mb-3">
              ¿Qué horario?
            </label>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-medium">Desde</span>
                <select
                  value={timeFrom}
                  onChange={(e) => setTimeFrom(e.target.value)}
                  className="px-4 py-3 rounded-xl border-2 border-gray-200 font-bold text-lg bg-gray-50 focus:border-blue-500 focus:outline-none"
                >
                  {TIME_SLOTS.slice(0, -1).map((slot) => (
                    <option key={slot} value={slot}>{formatHour12(slot)}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-medium">Hasta</span>
                <select
                  value={timeTo}
                  onChange={(e) => setTimeTo(e.target.value)}
                  className="px-4 py-3 rounded-xl border-2 border-gray-200 font-bold text-lg bg-gray-50 focus:border-blue-500 focus:outline-none"
                >
                  {timeToOptions.map((slot) => (
                    <option key={slot} value={slot}>{formatHour12(slot)}</option>
                  ))}
                </select>
              </div>
              <span className="text-gray-400 text-sm">
                ({slotsToBlock.length} hora{slotsToBlock.length !== 1 ? "s" : ""})
              </span>
            </div>
          </div>

          {/* 3. Cuándo */}
          <div>
            <label className="block text-lg font-bold text-gray-800 mb-3">
              ¿Cuándo?
            </label>
            <div className="flex gap-3 mb-4">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={`px-5 py-3 rounded-xl font-bold text-sm border-2 transition-all ${
                  mode === "single"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                Un día específico
              </button>
              <button
                type="button"
                onClick={() => setMode("recurring")}
                className={`px-5 py-3 rounded-xl font-bold text-sm border-2 transition-all ${
                  mode === "recurring"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                Repetir cada semana
              </button>
            </div>

            {mode === "single" ? (
              <input
                type="date"
                value={singleDate}
                onChange={(e) => setSingleDate(e.target.value)}
                className="px-4 py-3 rounded-xl border-2 border-gray-200 font-bold text-lg bg-gray-50 focus:border-blue-500 focus:outline-none"
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-gray-600 font-medium mb-2">Selecciona los días:</p>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_LABELS.map((day) => (
                      <button
                        key={day.id}
                        type="button"
                        onClick={() => toggleWeekday(day.id)}
                        className={`px-5 py-3 rounded-xl font-bold text-sm border-2 transition-all min-w-[72px] ${
                          recurringWeekdays.includes(day.id)
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        {day.short}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 font-medium">Desde</span>
                    <input
                      type="date"
                      value={recurringFrom}
                      onChange={(e) => setRecurringFrom(e.target.value)}
                      className="px-4 py-3 rounded-xl border-2 border-gray-200 font-bold text-base bg-gray-50 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 font-medium">Hasta</span>
                    <input
                      type="date"
                      value={recurringTo}
                      onChange={(e) => setRecurringTo(e.target.value)}
                      className="px-4 py-3 rounded-xl border-2 border-gray-200 font-bold text-base bg-gray-50 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                {recurringWeekdays.length > 0 && datesToBlock.length > 0 && (
                  <p className="text-sm text-gray-400">
                    {datesToBlock.length} día{datesToBlock.length !== 1 ? "s" : ""} encontrado{datesToBlock.length !== 1 ? "s" : ""}
                    {" "}({recurringWeekdays.map((d) => WEEKDAY_LABELS[d].long).join(", ")})
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 4. Motivo */}
          <div>
            <label className="block text-lg font-bold text-gray-800 mb-3">
              Motivo
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="px-4 py-3 rounded-xl border-2 border-gray-200 font-bold text-lg bg-gray-50 focus:border-blue-500 focus:outline-none w-full max-w-sm"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* 5. Resumen y botón */}
          <div className="border-t border-gray-200 pt-6">
            {canSubmit && (
              <p className="text-gray-600 mb-4 text-base">
                Se bloquearán <span className="font-bold text-gray-900">{totalBlocks}</span> horario{totalBlocks !== 1 ? "s" : ""}
                {" "}en <span className="font-bold">{selectedFields.length}</span> cancha{selectedFields.length !== 1 ? "s" : ""}
                {" "}durante <span className="font-bold">{datesToBlock.length}</span> día{datesToBlock.length !== 1 ? "s" : ""}.
              </p>
            )}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full md:w-auto px-8 py-4 rounded-xl font-bold text-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-3"
            >
              {submitting ? (
                <>
                  <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Bloqueando...
                </>
              ) : (
                <>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Bloquear
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── BLOQUEOS ACTIVOS ── */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Bloqueos Activos</h2>

          {!blockedLoaded ? (
            <div className="text-center py-12 text-gray-400 text-lg">Cargando...</div>
          ) : upcomingBlocks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
              <p className="text-gray-400 text-lg font-medium">No hay bloqueos programados</p>
              <p className="text-gray-300 text-sm mt-1">Usa el formulario de arriba para bloquear horarios.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedBlocks.map(([date, blocks]) => (
                <DateBlockGroup key={date} date={date} blocks={blocks} deletingIds={deletingIds} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </div>
    </ClientLayout>
  );
}

// ─── Date Block Group ───────────────────────────────────────────────────────

function DateBlockGroup({
  date,
  blocks,
  deletingIds,
  onDelete,
}: {
  date: string;
  blocks: BlockedSlot[];
  deletingIds: Set<string>;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-gray-900 capitalize">{formatDateDisplay(date)}</span>
          <span className="text-sm font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-lg">
            {blocks.length} bloqueo{blocks.length !== 1 ? "s" : ""}
          </span>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {blocks.map((block) => (
            <div key={block.id} className="flex items-center justify-between px-6 py-3 hover:bg-gray-50">
              <div className="flex items-center gap-4">
                <span className="font-bold text-gray-700 min-w-[80px]">Cancha {block.field}</span>
                <span className="text-gray-500">{formatHour12(block.time_slot)}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{block.reason}</span>
              </div>
              <button
                onClick={() => onDelete(block.id)}
                disabled={deletingIds.has(block.id)}
                className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors disabled:opacity-30"
                title="Eliminar bloqueo"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
