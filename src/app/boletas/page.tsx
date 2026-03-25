"use client";

import { Suspense } from "react";
import ClientLayout from "@/components/ClientLayout";
import { BoletasPage } from "@/features/boletas/components/BoletasPage";

export default function BoletasRoutePage() {
  return (
    <ClientLayout>
      <Suspense fallback={<div className="px-6 py-10 text-sm text-gray-500">Cargando…</div>}>
        <BoletasPage />
      </Suspense>
    </ClientLayout>
  );
}
