"use client";

import { useState, useEffect } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/lib/hooks";
import {
  COURT_LABELS,
  COURT_FIELDS,
  TIME_SLOTS,
  CourtType,
} from "@/lib/types";

type SlotStatus = "available" | "reserved" | "blocked";

export default function CanchasPage() {
  const store = useStore();
  const toast = useToastContext();
  const reservations = store.getReservations();
  const blockedSlots = store.getBlockedSlots();

  const [selectedCourt, setSelectedCourt] = useState<CourtType>("voley_maple");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [blockDialog, setBlockDialog] = useState<{
    field: number;
    timeSlot: string;
  } | null>(null);
  const [unblockId, setUnblockId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("Mantenimiento");

  useEffect(() => {
    store.fetchReservations();
    store.fetchBlockedSlots();
  }, []);

  // Re-fetch when date or court changes
  useEffect(() => {
    store.fetchBlockedSlots({ date: selectedDate, court_type: selectedCourt });
  }, [selectedDate, selectedCourt]);

  const fields = COURT_FIELDS[selectedCourt];

  function getSlotStatus(field: number, timeSlot: string): { status: SlotStatus; blockId?: string; resPhone?: string } {
    const blocked = blockedSlots.find(
      (b) =>
        b.court_type === selectedCourt &&
        b.field === field &&
        b.date === selectedDate &&
        b.time_slot === timeSlot
    );
    if (blocked) return { status: "blocked", blockId: blocked.id };

    const reserved = reservations.find(
      (r) =>
        r.court_type === selectedCourt &&
        (r.field === field || r.field === null) &&
        r.date === selectedDate &&
        r.time_slots?.includes(timeSlot) &&
        r.status !== "cancelled"
    );
    if (reserved) return { status: "reserved", resPhone: reserved.phone_number };

    return { status: "available" };
  }

  async function handleBlock() {
    if (!blockDialog) return;
    const result = await store.addBlockedSlot({
      court_type: selectedCourt,
      field: blockDialog.field,
      date: selectedDate,
      time_slot: blockDialog.timeSlot,
      reason: blockReason,
    });
    if (result) {
      toast(`Horario bloqueado: Campo ${blockDialog.field} a las ${blockDialog.timeSlot}`, "success");
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

  function handleSlotClick(field: number, timeSlot: string) {
    const { status, blockId } = getSlotStatus(field, timeSlot);
    if (status === "available") {
      setBlockDialog({ field, timeSlot });
    } else if (status === "blocked" && blockId) {
      setUnblockId(blockId);
    }
  }

  function formatDateLabel(dateStr: string) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Canchas</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Disponibilidad y bloqueo de horarios
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-body font-medium text-gray-600 mb-2">Tipo de Cancha</label>
              <select
                value={selectedCourt}
                onChange={(e) => setSelectedCourt(e.target.value as CourtType)}
                className="w-full px-5 py-4 text-body-lg font-semibold rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50"
              >
                {Object.entries(COURT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-body font-medium text-gray-600 mb-2">Fecha</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-5 py-4 text-body-lg rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-gray-50"
              />
            </div>
          </div>
          <p className="text-body text-gray-500 mt-3 font-medium">{formatDateLabel(selectedDate)}</p>
        </div>

        <div className="flex flex-wrap gap-6 mb-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-green-100 border-2 border-green-400" />
            <span className="text-body font-medium text-gray-600">Disponible (toque para bloquear)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-100 border-2 border-amber-400" />
            <span className="text-body font-medium text-gray-600">Reservado</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-red-100 border-2 border-red-400" />
            <span className="text-body font-medium text-gray-600">Bloqueado (toque para desbloquear)</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-field-dark text-white">
                <th className="px-5 py-4 text-left text-body font-bold sticky left-0 bg-field-dark z-10">Hora</th>
                {fields.map((field) => (
                  <th key={field} className="px-5 py-4 text-center text-body font-bold">Campo {field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIME_SLOTS.map((slot, i) => (
                <tr key={slot} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-5 py-3 text-body font-bold text-gray-700 sticky left-0 bg-inherit z-10 border-r border-gray-200">
                    {slot}
                  </td>
                  {fields.map((field) => {
                    const { status, resPhone } = getSlotStatus(field, slot);
                    return (
                      <td key={field} className="px-2 py-2 text-center">
                        <button
                          onClick={() => handleSlotClick(field, slot)}
                          disabled={status === "reserved"}
                          className={`w-full min-h-[52px] rounded-lg text-sm font-bold transition-all ${
                            status === "available"
                              ? "bg-green-50 border-2 border-green-300 text-green-700 hover:bg-green-100 hover:border-green-500 cursor-pointer"
                              : status === "reserved"
                              ? "bg-amber-50 border-2 border-amber-300 text-amber-700 cursor-default"
                              : "bg-red-50 border-2 border-red-300 text-red-700 hover:bg-red-100 hover:border-red-500 cursor-pointer"
                          }`}
                          title={
                            status === "reserved"
                              ? `Reservado - Tel: ${resPhone}`
                              : status === "blocked"
                              ? "Clic para desbloquear"
                              : "Clic para bloquear"
                          }
                        >
                          {status === "available"
                            ? "Libre"
                            : status === "reserved"
                            ? resPhone || "Reservado"
                            : "Bloqueado"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {blockDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <h3 className="text-heading font-bold text-gray-900 mb-2">Bloquear Horario</h3>
            <p className="text-body text-gray-600 mb-6">
              Campo {blockDialog.field} — {blockDialog.timeSlot} el {formatDateLabel(selectedDate)}
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
                onClick={() => { setBlockDialog(null); setBlockReason("Mantenimiento"); }}
                className="flex-1 px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleBlock}
                className="flex-1 px-6 py-4 text-body font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Bloquear
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={unblockId !== null}
        title="Desbloquear Horario"
        message="¿Quieres desbloquear este horario y dejarlo disponible?"
        confirmLabel="Sí, Desbloquear"
        onConfirm={handleUnblock}
        onCancel={() => setUnblockId(null)}
      />
    </ClientLayout>
  );
}
