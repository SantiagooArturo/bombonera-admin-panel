"use client";

import EditablePhoneSelect, { type PhoneOption } from "./EditablePhoneSelect";

type SendAvailabilityModalProps = {
  open: boolean;
  dayOptions: string[];
  selectedDates: string[];
  toggleDate: (date: string) => void;
  availabilityPhone: string;
  setAvailabilityPhone: (value: string) => void;
  phoneOptions: PhoneOption[];
  loading: boolean;
  onClose: () => void;
  onSubmit: () => void;
};

export default function SendAvailabilityModal({
  open,
  dayOptions,
  selectedDates,
  toggleDate,
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-5">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Enviar disponibilidad</h3>
            <p className="text-sm text-gray-500 mt-1">
              Selecciona uno o varios días y luego el WhatsApp destino.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Días a enviar</p>
            <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
              <div className="grid grid-cols-3 gap-2">
              {dayOptions.map((date) => {
                const checked = selectedDates.includes(date);
                return (
                  <label
                    key={date}
                    className={`flex items-center gap-1.5 min-h-[40px] px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-gray-200 bg-white hover:bg-gray-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDate(date)}
                      className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
                    />
                    <span className="text-[12px] font-medium text-gray-700 leading-tight">
                      {new Date(`${date}T12:00:00`).toLocaleDateString("es-PE", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                  </label>
                );
              })}
              </div>
            </div>
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
              disabled={loading || selectedDates.length === 0}
              className="flex-1 py-3 px-4 font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Enviando..." : "Enviar por WhatsApp"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
