"use client";

interface ReceiptPopupProps {
  onYes: () => void;
  onNo: () => void;
}

export default function ReceiptPopup({ onYes, onNo }: ReceiptPopupProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-3">¿Emitir boleta?</h3>
        <p className="text-base text-gray-600 mb-2">
          El comprobante se enviará automáticamente por WhatsApp al cliente.
        </p>
        <p className="text-base text-gray-400 mb-8">
          Si prefieres no emitirla ahora, podrás hacerlo más tarde.
        </p>
        <div className="flex gap-4">
          <button
            onClick={onNo}
            className="flex-1 px-6 py-4 font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            No, después
          </button>
          <button
            onClick={onYes}
            className="flex-1 px-6 py-4 font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            Sí, emitir
          </button>
        </div>
      </div>
    </div>
  );
}
