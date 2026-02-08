"use client";

import { useState } from "react";
import { COURT_FIELDS, type Reservation, type CourtType } from "@/lib/types";

interface ReservationCardProps {
  reservation: Reservation;
  /** Campos ya asignados a otras reservas en este time slot + court type */
  usedFields: number[];
  onAssignField: (resId: string, field: number | null) => void;
  onToggleArrived: (resId: string, arrived: boolean) => void;
  onPay: (reservation: Reservation) => void;
}

/** Etiqueta corta del tipo de cancha */
function courtShortLabel(ct: CourtType): string {
  const map: Record<CourtType, string> = {
    voley_6v6: "Voley 6v6",
    voley_basket_6v6: "Multiusos 6v6",
    voley_5v5: "Voley 5v5",
    voley_basket_5v5: "Multiusos 5v5",
  };
  return map[ct] ?? ct;
}

export default function ReservationCard({
  reservation: res,
  usedFields,
  onAssignField,
  onToggleArrived,
  onPay,
}: ReservationCardProps) {
  const [fieldLoading, setFieldLoading] = useState(false);
  const [arrivedLoading, setArrivedLoading] = useState(false);

  const paid = res.amount_paid ?? 0;
  const total = res.total_price ?? 0;
  const remaining = total - paid;
  const canCharge = res.status !== "cancelled" && remaining > 0;
  const payPercent = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
  const arrived = res.arrived ?? false;

  // Campos disponibles para este tipo de cancha
  const allFields = COURT_FIELDS[res.court_type] ?? [];
  const availableFields = allFields.filter(
    (f) => !usedFields.includes(f) || f === res.field
  );

  async function handleFieldChange(value: string) {
    setFieldLoading(true);
    const newField = value === "" ? null : parseInt(value);
    await onAssignField(res.id, newField);
    setFieldLoading(false);
  }

  async function handleArrivedToggle() {
    setArrivedLoading(true);
    await onToggleArrived(res.id, !arrived);
    setArrivedLoading(false);
  }

  return (
    <div
      className={`rounded-2xl border-2 p-4 transition-all ${
        res.status === "cancelled"
          ? "border-gray-200 bg-gray-50 opacity-60"
          : arrived
          ? "border-green-300 bg-green-50"
          : "border-gray-200 bg-white"
      }`}
    >
      {/* Header: Nombre + Llegó */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-gray-900 truncate">
            {res.representative_name || "Sin nombre"}
          </p>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>{courtShortLabel(res.court_type)}</span>
            {res.phone_number && (
              <>
                <span className="text-gray-300">·</span>
                <span>{res.phone_number}</span>
              </>
            )}
          </div>
        </div>

        {res.status !== "cancelled" && (
          <button
            onClick={handleArrivedToggle}
            disabled={arrivedLoading}
            className={`shrink-0 ml-3 w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold transition-all ${
              arrived
                ? "bg-green-500 text-white shadow-md"
                : "bg-gray-100 text-gray-300 hover:bg-gray-200"
            } disabled:opacity-50`}
            title={arrived ? "Llegó" : "No ha llegado"}
          >
            {arrivedLoading ? "..." : arrived ? "✓" : "?"}
          </button>
        )}
      </div>

      {/* Campo asignado */}
      {res.status !== "cancelled" && (
        <div className="mb-3">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Campo</label>
          <select
            value={res.field ?? ""}
            onChange={(e) => handleFieldChange(e.target.value)}
            disabled={fieldLoading}
            className={`w-full px-3 py-2 rounded-lg border-2 text-sm font-bold transition-colors ${
              res.field
                ? "border-bombonera-300 bg-bombonera-50 text-bombonera-800"
                : "border-gray-200 bg-gray-50 text-gray-500"
            } disabled:opacity-50`}
          >
            <option value="">Sin asignar</option>
            {availableFields.map((f) => (
              <option key={f} value={f}>
                Campo {f}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Barra de pago */}
      <div className="mb-2">
        <div className="flex justify-between text-xs font-semibold mb-1">
          <span className="text-gray-500">
            S/ {paid.toFixed(0)} / {total.toFixed(0)}
          </span>
          {remaining > 0 && (
            <span className="text-red-500">Falta S/ {remaining.toFixed(0)}</span>
          )}
          {remaining <= 0 && (
            <span className="text-green-600">Pagado ✓</span>
          )}
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              payPercent >= 100 ? "bg-green-500" : payPercent > 0 ? "bg-blue-500" : "bg-gray-300"
            }`}
            style={{ width: `${payPercent}%` }}
          />
        </div>
      </div>

      {/* Botón Cobrar */}
      {canCharge && (
        <button
          onClick={() => onPay(res)}
          className="w-full mt-2 px-4 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-colors"
        >
          Cobrar S/ {remaining.toFixed(0)}
        </button>
      )}

      {/* Cancelado */}
      {res.status === "cancelled" && (
        <p className="text-center text-sm font-bold text-red-400 mt-2">Cancelada</p>
      )}
    </div>
  );
}
