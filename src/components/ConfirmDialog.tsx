"use client";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <h3 className="text-heading font-bold text-gray-900 mb-3">{title}</h3>
        <p className="text-body text-gray-600 mb-8">{message}</p>
        <div className="flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-6 py-4 text-body font-semibold rounded-xl text-white transition-colors ${
              variant === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-bombonera-600 hover:bg-bombonera-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
