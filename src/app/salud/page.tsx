"use client";

import ClientLayout from "@/components/ClientLayout";
import { BotHealthPanel } from "@/features/salud/components/BotHealthPanel";

export default function SaludPage() {
  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Salud</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Monitoreo técnico del bot y del keepalive de WAHA.
          </p>
        </div>
        <BotHealthPanel />
      </div>
    </ClientLayout>
  );
}
