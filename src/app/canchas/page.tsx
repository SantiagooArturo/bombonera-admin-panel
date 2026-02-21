"use client";

import { useState, useEffect, useMemo } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/lib/hooks";
import {
  COURT_FIELDS,
  TIME_SLOTS,
  CourtType,
  type Reservation,
} from "@/lib/types";

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_FIELDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DAY_NAMES = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

const PENDING_EXPIRY_MS = 30 * 60 * 1000;

// Mapeo campo → tipo de cancha (inverso de COURT_FIELDS)
const FIELD_TO_COURT_TYPE: Record<number, CourtType> = {};
for (const [courtType, fields] of Object.entries(COURT_FIELDS)) {
  for (const field of fields) {
    FIELD_TO_COURT_TYPE[field] = courtType as CourtType;
  }
}

// Mapeo de CourtType del admin → court_type que el agente guarda en Firebase
// El agente solo usa "court_6v6" y "court_5v5", el admin usa "voley_6v6", etc.
const ADMIN_TO_AGENT_COURT_TYPE: Record<CourtType, string> = {
  voley_6v6: "court_6v6",
  voley_basket_6v6: "court_6v6",
  voley_5v5: "court_5v5",
  voley_basket_5v5: "court_5v5",
};

// Etiquetas cortas para el selector de cancha
const FIELD_TYPE_SHORT: Record<number, string> = {
  1: "6v6",
  2: "6v6",
  3: "6v6",
  4: "6v6B",
  5: "5v5",
  6: "5v5",
  7: "5v5",
  8: "6v6",
  9: "5v5B",
  10: "6v6",
  11: "6v6",
  12: "6v6",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateToISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDaysForWeek(weekOffset: number) {
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

function isReservationActive(r: Reservation): boolean {
  if (r.status === "paid") return true;
  if (r.status !== "pending") return false;
  const created = new Date(r.created_at).getTime();
  return Date.now() - created < PENDING_EXPIRY_MS;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CanchasPage() {
  const store = useStore();
  const toast = useToastContext();
  const reservations = store.getReservations();
  const blockedSlots = store.getBlockedSlots();

  const [selectedField, setSelectedField] = useState(1);
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [blockDialog, setBlockDialog] = useState<{
    fullDate: string;
    dayId: string;
    timeSlot: string;
  } | null>(null);
  const [unblockId, setUnblockId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("Mantenimiento");
  const [detailReservation, setDetailReservation] = useState<Reservation | null>(null);

  const courtType = FIELD_TO_COURT_TYPE[selectedField];
  const days = useMemo(() => getDaysForWeek(weekOffset), [weekOffset]);

  // Fetch reservas y bloqueos del tipo de cancha correspondiente al campo seleccionado
  // Reservas: usar el court_type del agente ("court_6v6") porque así se guardan en Firebase
  // Bloqueos: usar el court_type del admin ("voley_6v6") porque se crean desde el admin panel
  const agentCourtType = ADMIN_TO_AGENT_COURT_TYPE[courtType];

  useEffect(() => {
    setLoading(true);
    Promise.all([
      store.fetchReservations({ court_type: agentCourtType }),
      store.fetchBlockedSlots({ court_type: courtType }),
    ]).finally(() => setLoading(false));
  }, [agentCourtType, courtType, store]);

  // ── Datos de cada celda ───────────────────────────────────────────────

  function getCellData(
    fullDate: string,
    dayId: string,
    timeSlot: string,
    isWeekend: boolean
  ) {
    const hour = parseInt(timeSlot.split(":")[0], 10);
    const isNight = hour >= 18;
    const useNightBlock = isNight && !isWeekend;

    // En noches L-V, agrupar 19+20 y 21+22. En fines de semana, cada slot individual.
    const slotsToCheck = useNightBlock
      ? timeSlot === "19:00" || timeSlot === "20:00"
        ? ["19:00", "20:00"]
        : timeSlot === "21:00" || timeSlot === "22:00"
          ? ["21:00", "22:00"]
          : [timeSlot]
      : [timeSlot];

    // Buscar bloqueo en este campo específico
    const blocked = blockedSlots.find(
      (b) =>
        b.field === selectedField &&
        b.date === fullDate &&
        slotsToCheck.includes(b.time_slot)
    );
    if (blocked) {
      return { status: "bloqueada" as const, blockedSlot: blocked };
    }

    // Buscar reserva en este campo específico
    const slotKeys = slotsToCheck.map((s) => `${dayId}-${s}`);
    const reservation = reservations.find(
      (r) =>
        r.field === selectedField &&
        r.date === fullDate &&
        isReservationActive(r) &&
        slotKeys.some((sk) => r.slot_keys?.includes(sk))
    );
    if (reservation) {
      return { status: "reservada" as const, reservation };
    }

    return { status: "libre" as const };
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleBlock() {
    if (!blockDialog) return;
    const result = await store.addBlockedSlot({
      court_type: courtType,
      field: selectedField,
      date: blockDialog.fullDate,
      time_slot: blockDialog.timeSlot,
      reason: blockReason,
    });
    if (result) {
      toast(
        `Cancha ${selectedField} bloqueada: ${formatTime12h(blockDialog.timeSlot)} el ${blockDialog.fullDate}`,
        "success"
      );
    } else {
      toast("Error al bloquear", "error");
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

  function handleCellClick(
    day: (typeof days)[0],
    timeSlot: string,
    isWeekend: boolean
  ) {
    const cell = getCellData(day.fullDate, day.id, timeSlot, isWeekend);
    if (cell.status === "libre") {
      setBlockDialog({ fullDate: day.fullDate, dayId: day.id, timeSlot });
    } else if (cell.status === "bloqueada" && cell.blockedSlot) {
      setUnblockId(cell.blockedSlot.id);
    }
    // Reservada = no hacer nada (no es clickeable)
  }

  function getWeekLabel() {
    if (days.length === 0) return "Semana";
    const s = days[0];
    const e = days[6];
    if (weekOffset === 0)
      return `Esta semana (${s.date}/${s.month} - ${e.date}/${e.month})`;
    return `Semana del ${s.date}/${s.month} al ${e.date}/${e.month}`;
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Canchas</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Selecciona una cancha para ver su disponibilidad semanal
          </p>
        </div>

        {/* Selector de cancha */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 shadow-sm">
          <label className="block text-body font-medium text-gray-600 mb-3">
            Selecciona una cancha
          </label>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
            {ALL_FIELDS.map((field) => (
              <button
                key={field}
                onClick={() => setSelectedField(field)}
                className={`flex flex-col items-center py-3 px-2 rounded-xl text-sm font-bold transition-all border-2 ${
                  selectedField === field
                    ? "border-bombonera-500 bg-bombonera-50 text-bombonera-800 shadow-sm"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span>C{field}</span>
                <span
                  className={`text-[10px] font-medium mt-0.5 ${
                    selectedField === field
                      ? "text-bombonera-600"
                      : "text-gray-400"
                  }`}
                >
                  {FIELD_TYPE_SHORT[field]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Navegación de semana */}
        <div className="flex items-center justify-between gap-3 bg-gray-100 rounded-xl p-3 mb-4">
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o - 1)}
            className="p-2 rounded-lg hover:bg-gray-200"
          >
            <span className="sr-only">Anterior</span>←
          </button>
          <p className="text-sm font-semibold text-gray-800">{getWeekLabel()}</p>
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-lg hover:bg-gray-200"
          >
            <span className="sr-only">Siguiente</span>→
          </button>
        </div>

        {/* Grilla semanal */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 rounded-2xl">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-bombonera-500" />
            </div>
          )}
          <div
            className="grid min-w-[640px]"
            style={{
              gridTemplateColumns: "minmax(0, 4.5rem) repeat(7, 1fr)",
            }}
          >
            {/* Headers de días */}
            <div className="h-12" />
            {days.map((day) => (
              <div
                key={`head-${day.id}`}
                className={`h-12 flex flex-col items-center justify-center border-b-2 border-gray-200 ${
                  day.isWeekend ? "bg-amber-50" : ""
                }`}
              >
                <span className="text-xs font-bold text-gray-700 uppercase">
                  {day.name.slice(0, 3)}
                </span>
                <span className="text-sm font-semibold text-gray-500">
                  {day.date}
                </span>
              </div>
            ))}

            {/* Filas de horarios */}
            {TIME_SLOTS.map((slot, slotIndex) => {
              const hour = parseInt(slot.split(":")[0], 10);
              const isNight = hour >= 18;
              const isBlockStart = slot === "19:00" || slot === "21:00";
              const isBlockSecond = slot === "20:00" || slot === "22:00";

              return (
                <div key={`row-${slot}`} className="contents">
                  {/* Etiqueta de hora */}
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

                  {/* Celdas por día */}
                  {days.map((day) => {
                    const isWeekdayNight = isNight && !day.isWeekend;

                    // En noches L-V, saltar el segundo slot del bloque
                    if (isWeekdayNight && isBlockSecond) return null;

                    const rowSpan =
                      isWeekdayNight && isBlockStart ? 2 : 1;
                    const cellHeight = 40 * rowSpan;

                    const cell = getCellData(
                      day.fullDate,
                      day.id,
                      slot,
                      day.isWeekend
                    );

                    // Determinar label y colores según estado
                    let label: string;
                    let colorClasses: string;

                    if (cell.status === "reservada") {
                      const r = cell.reservation!;
                      const name = r.representative_name;
                      const isPaid = r.status === "paid";
                      label = name
                        ? name.length > 10
                          ? name.slice(0, 10) + "…"
                          : name
                        : isPaid
                          ? "Pagado"
                          : "Pendiente";
                      colorClasses = isPaid
                        ? "bg-green-50 border-green-300 text-green-800 hover:bg-green-100 cursor-pointer"
                        : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer";
                    } else if (cell.status === "bloqueada") {
                      label = "Bloqueado";
                      colorClasses =
                        "bg-red-50 border-red-300 text-red-700 hover:bg-red-100 cursor-pointer";
                    } else {
                      label = "Libre";
                      colorClasses =
                        "bg-white border-gray-200 text-gray-400 hover:bg-green-50 hover:text-green-600 cursor-pointer";
                    }

                    return (
                      <button
                        key={`${day.id}-${slot}`}
                        type="button"
                        onClick={() =>
                          cell.status === "reservada"
                            ? setDetailReservation(cell.reservation!)
                            : handleCellClick(day, slot, day.isWeekend)
                        }
                        style={{
                          gridRow:
                            rowSpan > 1 ? `span ${rowSpan}` : undefined,
                          height: cellHeight,
                          marginTop: slotIndex === 0 ? 0 : -1,
                        }}
                        className={`border-t border-l m-0.5 rounded-lg text-xs font-medium flex items-center justify-center transition-all disabled:cursor-default ${colorClasses}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* Fila final para etiqueta 22:50 */}
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

      {/* Modal detalle reserva */}
      {detailReservation && (() => {
        const res = detailReservation;
        const total = res.total_price || 0;
        const paid = res.amount_paid ?? 0;
        const remaining = Math.max(total - paid, 0);
        const pct = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
        const fullyPaid = paid >= total;
        const isPartial = res.status === "paid" && paid > 0 && paid < total;
        const courtLabel: Record<string, string> = {
          court_6v6: "Voley 6v6",
          court_5v5: "Voley 5v5",
          voley_6v6: "Voley 6v6",
          voley_basket_6v6: "Multiusos 6v6",
          voley_5v5: "Voley 5v5",
          voley_basket_5v5: "Multiusos 5v5",
        };
        const statusLabel = isPartial ? "Pago Parcial" : res.status === "paid" ? "Pagado" : res.status === "pending" ? "Pendiente" : "Cancelado";
        const statusColors = isPartial
          ? "bg-amber-100 text-amber-700"
          : res.status === "paid"
          ? "bg-green-100 text-green-700"
          : res.status === "pending"
          ? "bg-amber-100 text-amber-700"
          : "bg-red-100 text-red-700";
        const timeStart = res.time_slots?.[0] || "?";
        const timeEnd = res.time_slots?.length > 0 ? `${parseInt(res.time_slots[res.time_slots.length - 1]) + 1}:00` : "?";

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailReservation(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="bg-bombonera-700 px-6 py-5 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">Detalle de Reserva</h3>
                  <p className="text-bombonera-200 text-sm mt-0.5">Campo {res.field || selectedField}</p>
                </div>
                <button onClick={() => setDetailReservation(null)} className="text-white/70 hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Info principal */}
                <div className="space-y-3">
                  {res.representative_name && (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-bombonera-100 text-bombonera-700 flex items-center justify-center font-bold text-sm shrink-0">
                        {res.representative_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{res.representative_name}</p>
                        {res.phone_number && (
                          <p className="text-sm text-gray-500">{res.phone_number}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 rounded-xl px-4 py-3">
                      <span className="text-xs text-gray-400 uppercase tracking-wide block">Cancha</span>
                      <span className="font-semibold text-gray-800">{courtLabel[res.court_type] || res.court_type}</span>
                    </div>
                    <div className="bg-gray-50 rounded-xl px-4 py-3">
                      <span className="text-xs text-gray-400 uppercase tracking-wide block">Horario</span>
                      <span className="font-semibold text-gray-800">{timeStart} - {timeEnd}</span>
                    </div>
                    <div className="bg-gray-50 rounded-xl px-4 py-3 col-span-2">
                      <span className="text-xs text-gray-400 uppercase tracking-wide block">Fecha</span>
                      <span className="font-semibold text-gray-800">{res.date}</span>
                    </div>
                  </div>
                </div>

                {/* Pagos */}
                <div className="border-t border-gray-100 pt-5">
                  <div className="flex items-center gap-5">
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-400 uppercase tracking-wide">Total</span>
                      <span className="text-lg font-bold text-bombonera-700">S/ {total.toFixed(2)}</span>
                    </div>
                    {paid > 0 && (
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase tracking-wide">Pagado</span>
                        <span className="text-lg font-semibold text-green-700">S/ {paid.toFixed(2)}</span>
                      </div>
                    )}
                    {paid > 0 && !fullyPaid && (
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase tracking-wide">Debe</span>
                        <span className="text-lg font-semibold text-red-600">S/ {remaining.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  {paid > 0 && !fullyPaid && (
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 font-medium">{Math.round(pct)}%</span>
                    </div>
                  )}
                </div>

                {/* Estado */}
                <div className="flex items-center justify-between pt-2">
                  <span className={`px-4 py-2 rounded-xl text-sm font-bold ${statusColors}`}>
                    {statusLabel}
                  </span>
                  {res.confirmed && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-green-600 text-white">
                      ✓ Confirmado
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal bloquear */}
      {blockDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <h3 className="text-heading font-bold text-gray-900 mb-2">
              Bloquear cancha {selectedField}
            </h3>
            <p className="text-body text-gray-600 mb-6">
              {formatTime12h(blockDialog.timeSlot)} — {blockDialog.fullDate}
            </p>
            <label className="block text-body font-medium text-gray-600 mb-2">
              Motivo
            </label>
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
                onClick={() => {
                  setBlockDialog(null);
                  setBlockReason("Mantenimiento");
                }}
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

      {/* Modal desbloquear */}
      <ConfirmDialog
        open={unblockId !== null}
        title="Desbloquear horario"
        message={`¿Desbloquear este horario de la cancha ${selectedField}?`}
        confirmLabel="Sí, desbloquear"
        onConfirm={handleUnblock}
        onCancel={() => setUnblockId(null)}
      />
    </ClientLayout>
  );
}
