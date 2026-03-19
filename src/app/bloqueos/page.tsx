"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { TIME_SLOTS, COURT_FIELDS } from "@/lib/types";
import { isValidPeruPhone } from "@/features/operaciones/utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALL_FIELDS = Object.values(COURT_FIELDS).flat().sort((a, b) => a - b);

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
  const endIdx = to === "23:00" ? TIME_SLOTS.length : TIME_SLOTS.indexOf(to);
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
  const [contactPhone, setContactPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactDni, setContactDni] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Existing rules
  const blockRules = store.getBlockRules();
  const rulesLoaded = store.isLoaded("blockRules");
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  useEffect(() => {
    store.fetchBlockRules();
  }, [store]);

  // ── Computed preview ──────────────────────────────────────────────────

  const datesToBlock = useMemo(() => {
    if (mode === "single") return [singleDate];
    return getDatesInRange(recurringFrom, recurringTo, recurringWeekdays);
  }, [mode, singleDate, recurringFrom, recurringTo, recurringWeekdays]);

  const slotsToBlock = useMemo(() => getTimeSlotsInRange(timeFrom, timeTo), [timeFrom, timeTo]);

  const totalBlocks = selectedFields.length * datesToBlock.length * slotsToBlock.length;
  const needsContact = reason === "Reservado internamente" || reason === "Evento privado";
  const contactValid = !needsContact || (contactPhone.trim() && isValidPeruPhone(contactPhone));
  const canSubmit = selectedFields.length > 0 && slotsToBlock.length > 0 && datesToBlock.length > 0 && contactValid && !submitting;

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

    const result = await store.addBlockRule({
      fields: selectedFields,
      time_from: timeFrom,
      time_to: timeTo,
      mode,
      dates: datesToBlock,
      reason,
      contact_phone: contactPhone.trim() || undefined,
      contact_name: contactName.trim() || undefined,
      contact_dni: contactDni.trim() || undefined,
    });

    setSubmitting(false);

    if (result?.success) {
      toast("Bloqueo creado correctamente", "success");
      setSelectedFields([]);
      setRecurringWeekdays([]);
    } else {
      toast("Error al crear bloqueo", "error");
    }
  }

  // ── Delete rule ──────────────────────────────────────────────────────

  const handleDeleteRule = useCallback(async (ruleId: string) => {
    if (!confirm("¿Eliminar este bloqueo y todos sus horarios?")) return;
    setDeletingRuleId(ruleId);
    const ok = await store.removeBlockRule(ruleId);
    if (ok) toast("Bloqueo eliminado", "success");
    else toast("Error al eliminar", "error");
    setDeletingRuleId(null);
  }, [store, toast]);

  // ── Sorted rules for display ──────────────────────────────────────────

  const sortedRules = useMemo(
    () => [...blockRules].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [blockRules]
  );

  // ── Time options for "hasta" (only after "desde") ─────────────────────

  const timeToOptions = useMemo(() => {
    const fromIdx = TIME_SLOTS.indexOf(timeFrom);
    if (fromIdx === -1) return [];
    return [...TIME_SLOTS.filter((_, i) => i > fromIdx), "23:00"];
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

          {/* 5. Contacto (obligatorio para Reservado internamente / Evento privado) */}
          {(reason === "Reservado internamente" || reason === "Evento privado") && (
            <div className="space-y-4">
              <label className="block text-lg font-bold text-gray-800 mb-3">
                Datos de contacto
              </label>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">WhatsApp (9 dígitos)</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="Ej: 987654321"
                  className={`w-full max-w-sm rounded-xl border-2 px-4 py-3 font-semibold focus:outline-none ${
                    contactPhone && !isValidPeruPhone(contactPhone)
                      ? "border-red-300 bg-red-50 focus:border-red-500"
                      : "border-gray-200 bg-gray-50 focus:border-blue-500"
                  }`}
                />
                {contactPhone && !isValidPeruPhone(contactPhone) && (
                  <p className="text-sm text-red-600 mt-1">Número inválido (9 dígitos)</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Nombre completo"
                  className="w-full max-w-sm rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">DNI (opcional)</label>
                <input
                  type="text"
                  value={contactDni}
                  onChange={(e) => setContactDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="Ej: 12345678"
                  className="w-full max-w-sm rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* 6. Resumen y botón */}
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

          {!rulesLoaded ? (
            <div className="text-center py-12 text-gray-400 text-lg">Cargando...</div>
          ) : sortedRules.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
              <p className="text-gray-400 text-lg font-medium">No hay bloqueos programados</p>
              <p className="text-gray-300 text-sm mt-1">Usa el formulario de arriba para bloquear horarios.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedRules.map((rule) => {
                const isDeleting = deletingRuleId === rule.id;
                const datesSorted = [...rule.dates].sort();
                const dateLabel = rule.mode === "recurring" && datesSorted.length > 1
                  ? `${formatDateDisplay(datesSorted[0])} → ${formatDateDisplay(datesSorted[datesSorted.length - 1])} (${datesSorted.length} días)`
                  : formatDateDisplay(datesSorted[0] || "");

                return (
                  <div key={rule.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between px-6 py-4 gap-4">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900">
                        Cancha{rule.fields.length > 1 ? "s" : ""} {rule.fields.sort((a, b) => a - b).join(", ")}
                        <span className="text-gray-300 mx-1.5">·</span>
                        <span className="font-semibold text-gray-700">
                          {formatHour12(rule.time_from)} – {formatHour12(rule.time_to)}
                        </span>
                      </p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {dateLabel}
                        <span className="text-gray-300 mx-1.5">·</span>
                        <span className="text-gray-400">{rule.reason}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={isDeleting}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 border border-red-200 hover:border-red-300 transition-colors disabled:opacity-40 shrink-0"
                    >
                      {isDeleting ? "Eliminando..." : "Eliminar"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ClientLayout>
  );
}

