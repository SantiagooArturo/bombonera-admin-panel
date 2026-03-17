"use client";

import { useState } from "react";
import { formatDisplayPhone, isValidPeruPhone, normalizePeruPhone } from "@/features/operaciones/utils";
import { CLIENT_TYPE_LABELS, type ClientType } from "@/lib/types";

type AddUserModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; phone: string; dni: string; client_type: ClientType }) => Promise<boolean>;
};

export default function AddUserModal({ open, onClose, onSubmit }: AddUserModalProps) {
  const [name, setName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [dni, setDni] = useState("");
  const [clientType, setClientType] = useState<ClientType>("casual");
  const [loading, setLoading] = useState(false);

  const phoneNormalized = normalizePeruPhone(phoneInput);
  const phoneValid = isValidPeruPhone(phoneNormalized);
  const nameValid = name.trim().length >= 2;
  const dniValid = !dni.trim() || dni.replace(/\D/g, "").length === 8;
  const canSubmit = nameValid && phoneValid && dniValid && !loading;

  const displayPhone = (() => {
    const digits = phoneInput.replace(/\D/g, "");
    if (!digits) return phoneInput;
    return formatDisplayPhone(normalizePeruPhone(phoneInput));
  })();

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const success = await onSubmit({
        name: name.trim(),
        phone: phoneNormalized,
        dni: dni.replace(/\D/g, "").slice(0, 8),
        client_type: clientType,
      });
      if (success) {
        setName("");
        setPhoneInput("");
        setDni("");
        setClientType("casual");
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-5">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Añadir usuario</h3>
            <p className="text-sm text-gray-500 mt-1">
              Nombre, teléfono (9 dígitos) y tipo de cliente. El 51 se añade automáticamente.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-bombonera-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Teléfono (9 dígitos) *</label>
            <input
              type="text"
              inputMode="numeric"
              value={displayPhone}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, "").slice(0, 9);
                setPhoneInput(raw);
              }}
              placeholder="987654321"
              className={`w-full rounded-xl border-2 px-4 py-3 font-semibold text-gray-800 focus:outline-none ${
                phoneInput && !phoneValid
                  ? "border-red-300 bg-red-50"
                  : "border-gray-200 bg-gray-50 focus:border-bombonera-500"
              }`}
            />
            <p className="mt-1 text-xs text-gray-500">
              Solo 9 dígitos. El prefijo 51 se gestiona internamente.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">DNI (opcional)</label>
            <input
              type="text"
              inputMode="numeric"
              value={dni}
              onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="8 dígitos"
              className={`w-full rounded-xl border-2 px-4 py-3 font-semibold text-gray-800 focus:outline-none ${
                dni && !dniValid ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50 focus:border-bombonera-500"
              }`}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Tipo de cliente</label>
            <select
              value={clientType}
              onChange={(e) => setClientType(e.target.value as ClientType)}
              className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 font-semibold text-gray-800 focus:border-bombonera-500 focus:outline-none"
            >
              <option value="casual">{CLIENT_TYPE_LABELS.casual}</option>
              <option value="recurrente">{CLIENT_TYPE_LABELS.recurrente}</option>
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-3 px-4 font-semibold rounded-xl bg-bombonera-600 text-white hover:bg-bombonera-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
