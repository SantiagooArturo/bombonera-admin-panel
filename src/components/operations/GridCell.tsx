"use client";

import { useState, useEffect } from "react";
import type { Reservation } from "@/lib/types";
import { getPendingExpiryMinutes } from "@/lib/types";

/** Quita el prefijo "51" del número peruano si existe. */
function formatPhone(phone: string): string {
  return phone.startsWith("51") ? phone.slice(2) : phone;
}

/** Contenido visual de una celda ocupada por una reserva. */
export function OccupiedCellContent({
  reservation,
  isRecurrent,
}: {
  reservation: Reservation;
  isRecurrent?: boolean;
}) {
  const paid = reservation.amount_paid ?? 0;
  const total = reservation.total_price ?? 0;
  const remaining = total - paid;
  const arrived = reservation.arrived ?? false;
  const fullyPaid = remaining <= 0;
  const isPending = reservation.status === "pending";
  const bgByStatus = isPending ? "bg-yellow-100" : "bg-green-100";

  const [expiryMin, setExpiryMin] = useState(() => getPendingExpiryMinutes(reservation));
  useEffect(() => {
    if (!isPending) return;
    const tick = () => setExpiryMin(getPendingExpiryMinutes(reservation));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [isPending, reservation]);

  return (
    <div className={`relative h-full rounded-lg border-2 ${isPending ? "border-amber-400 border-dashed" : "border-blue-300"} ${bgByStatus} p-2 flex flex-col justify-center gap-0.5 ${isRecurrent ? "pb-5" : ""}`}>
      {/* Badge pendiente + countdown (solo cuando no está confirmada; manual_pending no muestra countdown) */}
      {isPending && (
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-200 text-amber-900 border border-amber-300">
            Pendiente
            {!reservation.manual_pending && expiryMin > 0 && (
              <span className="text-amber-700">· Libera en {expiryMin} min</span>
            )}
          </span>
        </div>
      )}

      {/* Nombre */}
      <p className="text-xs font-bold text-gray-800 truncate leading-tight">
        {reservation.representative_name || "Sin nombre"}
      </p>

      {/* Teléfono con icono WSP */}
      {reservation.phone_number && (
        <div className="flex items-center gap-1 truncate leading-tight">
          <svg
            className="w-3 h-3 shrink-0 text-green-600"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.122 1.527 5.855L.06 23.485a.5.5 0 00.607.606l5.632-1.468A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82c-1.998 0-3.87-.56-5.47-1.53l-.39-.234-3.347.872.89-3.262-.256-.406A9.8 9.8 0 012.18 12C2.18 6.58 6.58 2.18 12 2.18S21.82 6.58 21.82 12 17.42 21.82 12 21.82z" />
          </svg>
          <span className="text-[10px] text-gray-600 font-medium truncate">
            {formatPhone(reservation.phone_number)}
          </span>
        </div>
      )}

      {isRecurrent && (
        <span className="absolute bottom-1 right-1 inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold border bg-amber-100 text-amber-800 border-amber-200 shadow-sm">
          Recurrente
        </span>
      )}

      {/* Info de pago */}
      {fullyPaid ? (
        <span className="text-[10px] font-bold text-green-600 mt-0.5">
          Pagado completo
        </span>
      ) : (
        <div className="flex flex-col mt-0.5">
          <span className="text-[10px] text-gray-500">
            Total: S/{total}
          </span>
          <span className="text-[10px] font-bold text-red-500">
            Falta: S/{remaining}
          </span>
        </div>
      )}

      {/* Indicador de llegada */}
      {arrived && (
        <span className="text-[10px] text-green-600 font-semibold">
          ✓ Llegó
        </span>
      )}
    </div>
  );
}

/** Contenido visual de una celda vacía (disponible/libre). */
export function EmptyCellContent() {
  return <div className="h-full min-h-[52px] rounded" />;
}

/** Contenido visual de una celda bloqueada. */
export function BlockedCellContent({ reason }: { reason?: string }) {
  return (
    <div className="h-full min-h-[52px] rounded-lg border-2 border-red-300 bg-red-50 p-2 flex flex-col items-center justify-center gap-0.5">
      <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      <span className="text-[10px] font-bold text-red-500 truncate max-w-full">
        {reason || "Bloqueado"}
      </span>
    </div>
  );
}
