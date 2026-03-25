"use client";

import type { ReactNode } from "react";

type ActivateChatbotConfirmModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

/**
 * Modal de alerta antes de activar automatización por WhatsApp (chatbot).
 * Diseño muy visible para evitar activaciones accidentales.
 */
export default function ActivateChatbotConfirmModal({
  open,
  title,
  children,
  confirmLabel = "Sí, activar el chatbot",
  onConfirm,
  onCancel,
  loading = false,
}: ActivateChatbotConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="activate-chatbot-title"
      aria-describedby="activate-chatbot-desc"
    >
      <div
        className="w-full max-w-2xl rounded-2xl border-4 border-red-600 bg-red-50 shadow-2xl ring-4 ring-red-200/80 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-red-600 px-5 py-4 sm:px-8 sm:py-5">
          <div className="flex items-start gap-4">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-red-600 shadow-lg"
              aria-hidden
            >
              <svg className="h-9 w-9" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-red-100">Alerta — acción sensible</p>
              <h2
                id="activate-chatbot-title"
                className="mt-1 text-xl sm:text-2xl font-black text-white leading-tight uppercase"
              >
                {title}
              </h2>
            </div>
          </div>
        </div>

        <div id="activate-chatbot-desc" className="px-5 py-5 sm:px-8 sm:py-6 space-y-4 text-red-950">
          {children}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end px-5 pb-5 sm:px-8 sm:pb-8 pt-0 border-t-2 border-red-200 bg-white/80">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl text-base font-bold border-2 border-gray-400 text-gray-800 bg-white hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            No, cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl text-base font-black uppercase tracking-wide bg-red-600 text-white border-2 border-red-800 hover:bg-red-700 shadow-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
