"use client";

import { useCallback, useState } from "react";
import ClientLayout from "@/components/ClientLayout";
import { BotHealthPanel } from "@/features/salud/components/BotHealthPanel";
import { SaludWahaQrPanel } from "@/features/salud/components/SaludWahaQrPanel";

export default function SaludPage() {
  const [botHealthy, setBotHealthy] = useState<boolean | null>(null);

  const onHealthResolved = useCallback((healthy: boolean) => {
    setBotHealthy(healthy);
  }, []);

  const showWahaColumn = botHealthy === false;

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Salud</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Monitoreo técnico del bot y del keepalive de WAHA.
          </p>
        </div>

        <div
          className={`grid gap-6 items-start ${showWahaColumn ? "lg:grid-cols-2" : "grid-cols-1"}`}
        >
          <BotHealthPanel onHealthResolved={onHealthResolved} />
          {showWahaColumn && <SaludWahaQrPanel />}
        </div>
      </div>
    </ClientLayout>
  );
}
