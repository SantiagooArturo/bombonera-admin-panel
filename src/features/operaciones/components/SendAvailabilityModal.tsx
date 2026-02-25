"use client";

import EditablePhoneSelect, { type PhoneOption } from "./EditablePhoneSelect";

type SendAvailabilityModalProps = {
  open: boolean;
  selectedDate: string;
  availabilityPhone: string;
  setAvailabilityPhone: (value: string) => void;
  phoneOptions: PhoneOption[];
  loading: boolean;
  onClose: () => void;
  onSubmit: () => void;
};

export default function SendAvailabilityModal({
  open,
  selectedDate,
  availabilityPhone,
  setAvailabilityPhone,
  phoneOptions,
  loading,
  onClose,
  onSubmit,
}: SendAvailabilityModalProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg space-y-5">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Enviar disponibilidad</h3>
          <p className="text-sm text-gray-500 mt-1">
            Fecha: {selectedDate}. Escribe el WhatsApp o selecciónalo de la lista.
          </p>
        </div>
        <EditablePhoneSelect
          label="WhatsApp"
          value={availabilityPhone}
          onChange={(v) => setAvailabilityPhone(v.replace(/\D/g, "").slice(0, 12))}
          options={phoneOptions}
          accent="emerald"
          placeholder="Escribe número o selecciona"
        />

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="flex-1 py-3 px-4 font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Enviar por WhatsApp"}
          </button>
        </div>
      </div>
    </>
  );
}
