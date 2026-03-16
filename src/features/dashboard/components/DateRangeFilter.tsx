"use client";

import {
  type DateRange,
  type DateRangePreset,
  getDateRangeForPreset,
  getToday,
} from "../utils/dateRange";

const PRESETS: { id: DateRangePreset; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "7dias", label: "Últimos 7 días" },
  { id: "mes", label: "Este mes" },
];

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export default function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const handlePreset = (preset: DateRangePreset) => {
    const { start, end } = getDateRangeForPreset(preset);
    onChange({ start, end, preset });
  };

  const handleCustomStart = (e: React.ChangeEvent<HTMLInputElement>) => {
    const start = e.target.value;
    if (!start) return;
    const end = value.end < start ? start : value.end;
    onChange({ ...value, start, end, preset: "personalizado" });
  };

  const handleCustomEnd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const end = e.target.value;
    if (!end) return;
    const start = value.start > end ? end : value.start;
    onChange({ ...value, start, end, preset: "personalizado" });
  };

  const showCustom = value.preset === "personalizado";
  const today = getToday();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handlePreset(p.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              value.preset === p.id
                ? "bg-bombonera-500 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const { start, end } =
              value.preset === "personalizado"
                ? { start: value.start, end: value.end }
                : getDateRangeForPreset("7dias");
            onChange({ start, end, preset: "personalizado" });
          }}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            value.preset === "personalizado"
              ? "bg-bombonera-500 text-white shadow-sm"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Personalizado
        </button>
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span>Desde:</span>
            <input
              type="date"
              value={value.start}
              onChange={handleCustomStart}
              max={today}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-bombonera-500 focus:border-bombonera-500"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span>Hasta:</span>
            <input
              type="date"
              value={value.end}
              onChange={handleCustomEnd}
              max={today}
              min={value.start}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-bombonera-500 focus:border-bombonera-500"
            />
          </label>
        </div>
      )}
    </div>
  );
}

