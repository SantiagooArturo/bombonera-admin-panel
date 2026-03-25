"use client";

import EditablePhoneSelect, { type PhoneOption } from "./EditablePhoneSelect";

type SlotActionModalProps = {
  open: boolean;
  field: number;
  selectedDate: string;
  startSlot: string;
  endSlotOptions: string[];
  selectedSlotsCount: number;
  slotActionEndSlot: string;
  setSlotActionEndSlot: (value: string) => void;
  slotActionMode: "block" | "manual";
  setSlotActionMode: (value: "block" | "manual") => void;
  blockReasons: readonly string[];
  blockReason: string;
  setBlockReason: (value: string) => void;
  customReason: string;
  setCustomReason: (value: string) => void;
  manualPhone: string;
  manualPhoneValid: boolean;
  onManualPhoneChange: (value: string) => void;
  phoneOptions: PhoneOption[];
  manualName: string;
  setManualName: (value: string) => void;
  manualDni: string;
  setManualDni: (value: string) => void;
  slotActionLoading: boolean;
  formatHour12: (slot: string) => string;
  onClose: () => void;
  onSubmit: () => void;
};

export default function SlotActionModal({
  open,
  field,
  selectedDate,
  startSlot,
  endSlotOptions,
  selectedSlotsCount,
  slotActionEndSlot,
  setSlotActionEndSlot,
  slotActionMode,
  setSlotActionMode,
  blockReasons,
  blockReason,
  setBlockReason,
  customReason,
  setCustomReason,
  manualPhone,
  manualPhoneValid,
  onManualPhoneChange,
  phoneOptions,
  manualName,
  setManualName,
  manualDni,
  setManualDni,
  slotActionLoading,
  formatHour12,
  onClose,
  onSubmit,
}: SlotActionModalProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full space-y-5" style={{ maxWidth: '700px' }}>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Acción rápida</h3>
            <p className="text-sm text-gray-500 mt-1">
              Cancha {field} · {selectedDate} · desde {formatHour12(startSlot)}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">¿Qué deseas hacer?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSlotActionMode("manual")}
                className={`py-3 rounded-xl font-bold border-2 transition-colors ${slotActionMode === "manual"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
              >
                Reserva manual
              </button>
              <button
                type="button"
                onClick={() => setSlotActionMode("block")}
                className={`py-3 rounded-xl font-bold border-2 transition-colors ${slotActionMode === "block"
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
                <p className="font-bold text-gray-900">{formatHour12(startSlot)}</p>
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
              {selectedSlotsCount} hora{selectedSlotsCount !== 1 ? "s" : ""} seleccionada
              {selectedSlotsCount !== 1 ? "s" : ""}
            </p>
          </div>

          {slotActionMode === "block" ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Motivo</label>
                <select
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-red-500 focus:outline-none"
                >
                  {blockReasons.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
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
              <EditablePhoneSelect
                label="WhatsApp"
                value={manualPhone}
                onChange={onManualPhoneChange}
                options={phoneOptions}
                accent="blue"
              />
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre</label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Nombre completo"
                  className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">DNI (opcional)</label>
                <input
                  type="text"
                  value={manualDni}
                  onChange={(e) => setManualDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="Ej: 12345678"
                  className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={slotActionLoading}
              className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={onSubmit}
              disabled={slotActionLoading || (slotActionMode === "manual" && !manualPhoneValid)}
              className={`flex-1 py-3 px-4 font-semibold rounded-xl text-white transition-colors text-sm disabled:opacity-50 ${slotActionMode === "block" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
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
      </div>
    </>
  );
}
