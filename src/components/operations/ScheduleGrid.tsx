"use client";

import { useMemo, useEffect, useRef } from "react";
import { TIME_SLOTS, type Reservation, type BlockedSlot, isReservationActive } from "@/lib/types";
import type { CourtFieldConfig } from "@/lib/court-config";
import { getCourtSizeLabel } from "@/lib/court-config";
import { OccupiedCellContent, EmptyCellContent, BlockedCellContent } from "./GridCell";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatHour12(slot: string): string {
  const h = parseInt(slot.split(":")[0]);
  if (h === 0) return "12 am";
  if (h < 12) return `${h} am`;
  if (h === 12) return "12 pm";
  return `${h - 12} pm`;
}

// ─── Column definitions ─────────────────────────────────────────────────────

interface ColumnGroup {
  label: string;
  fields: number[];
}

/** Campos ordenados estrictamente de 1 a 12. */
const ALL_FIELDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Fallback cuando no hay config. */
const FALLBACK_LABEL: Record<number, string> = {
  1: "6 vs 6",
  2: "6 vs 6",
  3: "6 vs 6",
  4: "6 vs 6",
  5: "6 vs 6",
  6: "6 vs 6",
  7: "6 vs 6",
  8: "6 vs 6",
  9: "5 vs 5",
  10: "6 vs 6",
  11: "6 vs 6",
  12: "6 vs 6",
};

function buildColumnGroups(configs: CourtFieldConfig[] | null): ColumnGroup[] {
  const configMap = configs?.length ? new Map(configs.map((c) => [c.field, c])) : null;
  return ALL_FIELDS.reduce<ColumnGroup[]>((acc, field) => {
    const cfg = configMap?.get(field);
    const label = cfg ? getCourtSizeLabel(cfg) : FALLBACK_LABEL[field];
    const last = acc[acc.length - 1];
    if (last && last.label === label) {
      last.fields.push(field);
      return acc;
    }
    acc.push({ label, fields: [field] });
    return acc;
  }, []);
}

// ─── Grid cell types ────────────────────────────────────────────────────────

type CellInfo =
  | { type: "skip" }
  | { type: "empty" }
  | { type: "blocked"; blockedSlot: BlockedSlot }
  | { type: "reservation"; reservation: Reservation; span: number };

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ScheduleGridProps {
  reservations: Reservation[];
  blockedSlots: BlockedSlot[];
  autoAssignments: Map<string, number>;
  /** Config de canchas para encabezados dinámicos (5 vs 5, 6 vs 6, otro). */
  courtConfigs?: CourtFieldConfig[] | null;
  /** IDs normalizados (últimos 9 dígitos) de usuarios con client_type === "recurrente". */
  recurrentClientIds?: Set<string>;
  currentSlot: string;
  isToday: boolean;
  onSelectReservation: (reservation: Reservation) => void;
  onSelectBlocked: (blockedSlot: BlockedSlot) => void;
  onSelectEmpty: (field: number, timeSlot: string) => void;
  maxHeight?: string;
  /** Registro de dueños de horarios recurrentes (colección recurrent_schedules). */
  recurrentSchedules?: any[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ScheduleGrid({
  reservations,
  blockedSlots,
  autoAssignments,
  courtConfigs,
  recurrentClientIds,
  currentSlot,
  isToday,
  onSelectReservation,
  onSelectBlocked,
  onSelectEmpty,
  maxHeight = "calc(100vh - 220px)",
  recurrentSchedules = [],
}: ScheduleGridProps) {
  const currentRowRef = useRef<HTMLTableRowElement>(null);
  const columnGroups = useMemo(() => buildColumnGroups(courtConfigs ?? null), [courtConfigs]);

  // Auto-scroll a la fila del horario actual al montar
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentSlot]);

  // ── Build 2D grid ───────────────────────────────────────────────────────

  const grid = useMemo(() => {
    // field → slot → reservation
    const fieldSlotMap = new Map<number, Map<string, Reservation>>();
    for (const r of reservations) {
      if (!isReservationActive(r)) continue;
      const effectiveField = r.field ?? autoAssignments.get(r.id) ?? null;
      if (effectiveField == null) continue;
      if (!fieldSlotMap.has(effectiveField))
        fieldSlotMap.set(effectiveField, new Map());
      const slotMap = fieldSlotMap.get(effectiveField)!;
      for (const slot of r.time_slots ?? []) {
        slotMap.set(slot, r);
      }
    }

    // field → slot → BlockedSlot
    const blockedMap = new Map<number, Map<string, BlockedSlot>>();
    for (const b of blockedSlots) {
      if (!blockedMap.has(b.field)) blockedMap.set(b.field, new Map());
      blockedMap.get(b.field)!.set(b.time_slot, b);
    }

    const cells: CellInfo[][] = [];
    const skipSet = new Set<string>();

    for (let si = 0; si < TIME_SLOTS.length; si++) {
      const row: CellInfo[] = [];
      const slot = TIME_SLOTS[si];

      for (let fi = 0; fi < ALL_FIELDS.length; fi++) {
        const field = ALL_FIELDS[fi];

        if (skipSet.has(`${si}:${fi}`)) {
          row.push({ type: "skip" });
          continue;
        }

        const slotMap = fieldSlotMap.get(field);
        const reservation = slotMap?.get(slot);

        if (reservation) {
          let span = 1;
          for (let next = si + 1; next < TIME_SLOTS.length; next++) {
            const nextRes = slotMap?.get(TIME_SLOTS[next]);
            if (nextRes && nextRes.id === reservation.id) {
              span++;
              skipSet.add(`${next}:${fi}`);
            } else {
              break;
            }
          }
          row.push({ type: "reservation", reservation, span });
          continue;
        }

        const blocked = blockedMap.get(field)?.get(slot);
        if (blocked) {
          row.push({ type: "blocked", blockedSlot: blocked });
          continue;
        }

        row.push({ type: "empty" });
      }

      cells.push(row);
    }

    return cells;
  }, [reservations, blockedSlots, autoAssignments]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm"
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          {/* Fila 1: Headers de grupo (tipo de cancha) — altura fija 40px */}
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 top-0 z-30 h-20 bg-gray-50 border-b border-r border-gray-300 px-3 py-0 text-sm font-bold text-gray-500 min-w-[64px] text-center shadow-[0_1px_0_0_#d1d5db] align-middle"
            >
              Hora
            </th>
            {columnGroups.map((group) => (
              <th
                key={`${group.label}-${group.fields[0]}`}
                colSpan={group.fields.length}
                className="sticky top-0 z-20 h-10 bg-gray-50 border-b border-l border-gray-300 px-2 py-0 text-sm font-bold text-gray-600 text-center whitespace-nowrap shadow-[0_1px_0_0_#d1d5db] align-middle"
              >
                {group.label}
              </th>
            ))}
          </tr>

          {/* Fila 2: Números de campo — altura fija 40px, top-10 - 1px para solapar y eliminar hueco */}
          <tr>
            {ALL_FIELDS.map((field) => (
              <th
                key={field}
                className="sticky top-[39px] z-20 h-10 bg-gray-50 border-b border-l border-gray-300 px-2 py-0 text-sm font-bold text-gray-500 text-center min-w-[80px] shadow-[inset_0_1px_0_0_#d1d5db] align-middle"
              >
                Campo {field}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {TIME_SLOTS.map((slot, si) => {
            const isCurrent = isToday && slot === currentSlot;
            const isFirst = si === 0;
            const label = formatHour12(slot);

            return (
              <tr
                key={slot}
                ref={isCurrent ? currentRowRef : undefined}
                className={isCurrent ? "bg-bombonera-50/50" : ""}
              >
                {/* Columna de hora (sticky left) — hora en la intersección */}
                <td
                  className={`sticky left-0 z-10 border-r border-gray-300 text-sm font-bold whitespace-nowrap overflow-visible text-center ${
                    isCurrent
                      ? "bg-bombonera-100 text-bombonera-700"
                      : "bg-gray-50 text-gray-500"
                  }`}
                  style={{ verticalAlign: "top", height: 52 }}
                >
                  <div
                    className={`flex items-center justify-center gap-1.5 ${isFirst ? "" : "-translate-y-1/2"}`}
                    style={{ lineHeight: 1 }}
                  >
                    {isCurrent && (
                      <span className="w-2 h-2 rounded-full bg-bombonera-500 animate-pulse" />
                    )}
                    {label}
                  </div>
                </td>

                {/* Celdas de campos */}
                {grid[si]?.map((cell, fi) => {
                  if (cell.type === "skip") return null;

                  const field = ALL_FIELDS[fi];

                  if (cell.type === "empty") {
                    return (
                      <td
                        key={field}
                        onClick={() => onSelectEmpty(field, slot)}
                        className="border-b border-l border-gray-300 p-1 h-[52px] cursor-pointer bg-red-50 hover:bg-red-100 transition-colors"
                      >
                        <EmptyCellContent />
                      </td>
                    );
                  }

                  if (cell.type === "blocked") {
                    return (
                      <td
                        key={field}
                        onClick={() => onSelectBlocked(cell.blockedSlot)}
                        className="border-b border-l border-gray-300 p-1 h-[52px] cursor-pointer hover:brightness-95 transition-colors"
                      >
                        <BlockedCellContent reason={cell.blockedSlot.reason} />
                      </td>
                    );
                  }

                  const { reservation, span } = cell;
                  const isPending = reservation.status === "pending";
                  const bgByStatus = isPending ? "bg-yellow-100" : "bg-green-100";

                  return (
                    <td
                      key={field}
                      rowSpan={span}
                      onClick={() => onSelectReservation(reservation)}
                      className={`border-b border-l border-gray-300 p-1 cursor-pointer transition-colors hover:brightness-95 ${bgByStatus}`}
                      style={{ height: `${span * 52}px` }}
                    >
                      <OccupiedCellContent
                        reservation={reservation}
                        isRecurrent={
                          (() => {
                            // Fuente Única de Verdad: Registro de Dueños (recurrent_schedules)
                            const dayOfWeek = new Date(reservation.date + "T12:00:00").getDay();
                            const startTime = reservation.time_slots?.[0] || "";
                            const owner = recurrentSchedules.find(s => 
                              s.day_of_week === dayOfWeek && 
                              s.field === field && 
                              s.start_time === startTime
                            );
                            // Es recurrente si el dueño coincide con el chat_id de esta reserva
                            return !!(owner && owner.chat_id === reservation.chat_id);
                          })()
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* Fila final: etiqueta de cierre */}
          <tr>
            <td
              className="sticky left-0 z-10 border-r border-gray-300 text-sm font-bold whitespace-nowrap bg-gray-50 text-gray-500 overflow-visible text-center"
              style={{ verticalAlign: "top", height: 8 }}
            >
              <div className="-translate-y-1/2 flex justify-center" style={{ lineHeight: 1 }}>
                {formatHour12(`${parseInt(TIME_SLOTS[TIME_SLOTS.length - 1]) + 1}:00`)}
              </div>
            </td>
            {ALL_FIELDS.map((field) => (
              <td key={`end-${field}`} style={{ height: 8 }} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
