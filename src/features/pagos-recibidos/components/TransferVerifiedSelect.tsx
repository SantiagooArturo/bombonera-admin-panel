"use client";

import { memo, useState } from "react";
import type { Transfer } from "@/lib/types";
import { patchTransferVerified } from "../services/patchTransferVerified";

type TransferVerifiedSelectProps = {
  transfer: Transfer;
  onUpdated: (id: string, verified: boolean) => void;
  onError: (message: string) => void;
};

export const TransferVerifiedSelect = memo(function TransferVerifiedSelect({
  transfer,
  onUpdated,
  onError,
}: TransferVerifiedSelectProps) {
  const [busy, setBusy] = useState(false);
  const v = transfer.verified === true;

  const selectTone = v
    ? "border-green-200 bg-green-50 text-green-900 focus:border-green-500 focus:ring-green-500/35"
    : "border-red-200 bg-red-50 text-red-900 focus:border-red-400 focus:ring-red-400/35";

  return (
    <select
      aria-label={`Verificación del pago ${transfer.id}`}
      className={`max-w-full rounded-lg border px-2 py-1.5 text-xs font-semibold shadow-sm focus:outline-none focus:ring-1 disabled:opacity-60 ${selectTone}`}
      value={v ? "1" : "0"}
      disabled={busy}
      onChange={async (e) => {
        const next = e.target.value === "1";
        if (next === v) return;
        setBusy(true);
        const ok = await patchTransferVerified(transfer.id, next);
        setBusy(false);
        if (ok) {
          onUpdated(transfer.id, next);
        } else {
          onError("No se pudo actualizar la verificación.");
        }
      }}
    >
      <option value="1">Verificado</option>
      <option value="0">No verificado</option>
    </select>
  );
});
