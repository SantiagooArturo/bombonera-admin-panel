"use client";

import { useEffect, useRef } from "react";
import { TIME_SLOTS } from "@/lib/types";

interface TimeSlotNavProps {
  selectedSlot: string;
  currentSlot: string;
  counts: Record<string, number>;
}

/** Obtiene la hora actual redondeada al slot más cercano. */
export function getCurrentSlot(): string {
  const now = new Date();
  const hour = now.getHours();
  const slot = `${hour}:00`;
  return TIME_SLOTS.includes(slot) ? slot : TIME_SLOTS[0];
}

export default function TimeSlotNav({ selectedSlot, currentSlot, counts }: TimeSlotNavProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al slot activo
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedSlot]);

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {TIME_SLOTS.map((slot) => {
        const isCurrent = slot === currentSlot;
        const isActive = slot === selectedSlot;
        const count = counts[slot] ?? 0;
        const hour = parseInt(slot);
        const label = hour <= 12 ? `${hour}am` : `${hour - 12}pm`;

        return (
          <div
            key={slot}
            ref={isActive ? activeRef : undefined}
            className={`relative flex flex-col items-center min-w-[56px] px-3 py-2 rounded-xl font-bold text-sm transition-all shrink-0 ${
              isActive
                ? "bg-bombonera-600 text-white shadow-lg scale-105"
                : count > 0
                ? "bg-white border-2 border-bombonera-200 text-bombonera-700"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {isCurrent && (
              <span className={`absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${
                isActive ? "bg-white" : "bg-red-500"
              } animate-pulse`} />
            )}
            <span className="text-base">{label}</span>
            {count > 0 && (
              <span className={`text-xs font-bold mt-0.5 ${isActive ? "text-white/80" : "text-bombonera-500"}`}>
                {count}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
