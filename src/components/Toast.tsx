"use client";

import { Toast as ToastType } from "@/lib/hooks";

const ICONS: Record<ToastType["type"], string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

const COLORS: Record<ToastType["type"], string> = {
  success: "bg-green-700 border-green-500",
  error: "bg-red-700 border-red-500",
  info: "bg-blue-700 border-blue-500",
};

export default function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: ToastType[];
  onRemove: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-50 flex flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-enter flex items-center gap-3 px-6 py-4 rounded-xl text-white text-body font-medium shadow-2xl border-l-4 min-w-[320px] cursor-pointer ${COLORS[toast.type]}`}
          onClick={() => onRemove(toast.id)}
        >
          <span className="text-2xl font-bold">{ICONS[toast.type]}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
