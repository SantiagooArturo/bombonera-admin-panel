import { Suspense } from "react";
import ClientLayout from "@/components/ClientLayout";
import { PagosRecibidosPage } from "@/features/pagos-recibidos/components/PagosRecibidosPage";

export default function PagosRecibidosRoutePage() {
  return (
    <ClientLayout>
      <Suspense fallback={<div className="px-6 py-10 text-sm text-gray-500">Cargando…</div>}>
        <PagosRecibidosPage />
      </Suspense>
    </ClientLayout>
  );
}
