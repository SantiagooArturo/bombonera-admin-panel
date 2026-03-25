"use client";

import type { Transfer } from "@/lib/types";
import { PAYMENT_METHOD_LABELS, PAYMENT_SOURCE_LABELS } from "@/lib/types";
import { formatSolesAmountDisplay } from "@/features/boletas/utils/formatSolesAmountDisplay";
import { IconOpenInNewTab } from "@/features/boletas/components/boletasSharedUi";
import { formatDisplayPhone, wspLink } from "@/features/operaciones/utils";
import { anchorPropsForHref } from "@/lib/internal-href";
import { transferClientDisplayName } from "../utils/transferDisplay";
import { formatTransferPaymentDisplay } from "../utils/formatTransferPaymentDisplay";
import { TransferVerifiedSelect } from "./TransferVerifiedSelect";

type PagosRecibidosMobileListProps = {
  rows: Transfer[];
  searchActive: boolean;
  loading: boolean;
  onVerifiedUpdated: (id: string, verified: boolean) => void;
  onVerifiedError: (message: string) => void;
};

export function PagosRecibidosMobileList({
  rows,
  searchActive,
  loading,
  onVerifiedUpdated,
  onVerifiedError,
}: PagosRecibidosMobileListProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400 shadow-sm">
        Cargando…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500 shadow-sm">
        {searchActive ? "Ningún pago coincide con tu búsqueda." : "No hay pagos en esta vista."}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-busy={loading}>
      {rows.map((t) => {
        const name = transferClientDisplayName(t);
        const phone = t.phone_number?.trim();
        const mobileTransferWspHref = phone ? wspLink(phone) : null;
        const media = t.media_url?.trim();
        const proxy = media ? `/api/proxy-file?url=${encodeURIComponent(media)}` : null;
        const methodLabel =
          t.payment_method && PAYMENT_METHOD_LABELS[t.payment_method]
            ? PAYMENT_METHOD_LABELS[t.payment_method]
            : t.payment_method || "—";
        const sourceLabel =
          t.source && PAYMENT_SOURCE_LABELS[t.source] ? PAYMENT_SOURCE_LABELS[t.source] : t.source || "—";

        return (
          <li key={t.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 max-w-[65%] flex-1">
                <p className="truncate text-sm font-semibold text-gray-900" title={name !== "—" ? name : undefined}>
                  {name}
                </p>
                {t.client_last_dni ? (
                  <p className="mt-0.5 font-mono text-xs text-gray-600">DNI {t.client_last_dni}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold tabular-nums text-gray-900">
                  S/ {formatSolesAmountDisplay(t.amount ?? 0)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{formatTransferPaymentDisplay(t)}</p>
              </div>
            </div>

            {mobileTransferWspHref ? (
              <a
                href={mobileTransferWspHref}
                {...anchorPropsForHref(mobileTransferWspHref)}
                className="mt-2 inline-block font-mono text-sm text-green-700 underline decoration-green-600/50"
              >
                {formatDisplayPhone(phone)}
              </a>
            ) : (
              <p className="mt-2 text-sm text-gray-400">Sin teléfono</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-gray-100 px-2 py-1 font-medium text-gray-700">{methodLabel}</span>
              <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">{sourceLabel}</span>
            </div>

            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Verificación</p>
              <TransferVerifiedSelect transfer={t} onUpdated={onVerifiedUpdated} onError={onVerifiedError} />
            </div>

            {proxy ? (
              <a
                href={proxy}
                {...anchorPropsForHref(proxy)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
              >
                <IconOpenInNewTab className="h-3.5 w-3.5 shrink-0 opacity-90" />
                Ver comprobante
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
