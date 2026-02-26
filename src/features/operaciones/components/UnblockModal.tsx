"use client";

import type { BlockedSlot } from "@/lib/types";

type UnblockModalProps = {
  target: BlockedSlot | null;
  unblocking: boolean;
  formatHour12: (slot: string) => string;
  onClose: () => void;
  onConfirm: () => void;
};

export default function UnblockModal({
  target,
  unblocking,
  formatHour12,
  onClose,
  onConfirm,
}: UnblockModalProps) {
  if (!target) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Horario Bloqueado</h3>
              <p className="text-sm text-gray-500">{target.reason}</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Cancha</span>
              <span className="font-bold text-gray-800">Cancha {target.field}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Horario</span>
              <span className="font-bold text-gray-800">{formatHour12(target.time_slot)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Fecha</span>
              <span className="font-bold text-gray-800">
                {new Date(target.date + "T12:00:00").toLocaleDateString("es-PE", {
                  weekday: "long", day: "numeric", month: "long",
                })}
              </span>
            </div>
          </div>

          <p className="text-sm text-gray-500">
            Solo se desbloqueará este día específico. Si el bloqueo es recurrente, los demás días seguirán bloqueados.
          </p>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={unblocking}
              className="flex-1 py-3 px-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={unblocking}
              className="flex-1 py-3 px-4 font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {unblocking ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Desbloqueando...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                  Desbloquear
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
