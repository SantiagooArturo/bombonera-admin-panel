"use client";

type OperationsHeaderProps = {
  dayOffset: number;
  selectedDateLabel: string;
  isToday: boolean;
  maxDayOffset: number;
  onPrevDay: () => void;
  onNextDay: () => void;
  onGoToday: () => void;
  onOpenSendAvailability: () => void;
};

export default function OperationsHeader({
  dayOffset,
  selectedDateLabel,
  isToday,
  maxDayOffset,
  onPrevDay,
  onNextDay,
  onGoToday,
  onOpenSendAvailability,
}: OperationsHeaderProps) {
  return (
    <div className="mb-2 shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onPrevDay}
            disabled={dayOffset === 0}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Día anterior"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-body-lg text-gray-700 font-semibold capitalize w-[280px] text-center">
            {selectedDateLabel}
          </span>
          <button
            onClick={onNextDay}
            disabled={dayOffset >= maxDayOffset}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Día siguiente"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {!isToday && (
            <button
              onClick={onGoToday}
              className="ml-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              Ir a Hoy
            </button>
          )}
        </div>
        <button
          onClick={onOpenSendAvailability}
          className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors whitespace-nowrap"
        >
          Enviar disponibilidad
        </button>
      </div>
    </div>
  );
}
