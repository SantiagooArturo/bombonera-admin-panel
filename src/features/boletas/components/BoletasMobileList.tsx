"use client";

import type { Invoice } from "@/lib/types";
import { WHATSAPP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { wspLink } from "@/features/operaciones/utils";
import { anchorPropsForHref } from "@/lib/internal-href";
import { invoiceEmissionDateDisplay } from "../utils/formatInvoiceEmissionDate";
import { formatSolesAmountDisplay } from "../utils/formatSolesAmountDisplay";
import {
  invoiceDescripcionOnly,
  invoiceReceptorOnly,
  invoiceTelefonoDisplay,
} from "../utils/invoiceTableColumns";
import { invoicePlantillaPdfHref } from "../utils/invoicePdfLinks";
import { IconOpenInNewTab, SerieCorrelativoCell } from "./boletasSharedUi";
import { isSunatEstadoRechazado } from "../utils/sunatEstadoUi";

type BoletasMobileListProps = {
  rows: Invoice[];
  /** Si hay texto en el buscador y no hay filas. */
  searchActive: boolean;
  loading: boolean;
  wspStatus: Record<string, "idle" | "sending" | "sent" | "error">;
  wspError: Record<string, string>;
  voidingInvoiceId: string | null;
  onSendWsp: (inv: Invoice) => void;
  onVoid: (inv: Invoice) => void;
};

function canchaSummary(inv: Invoice): string | null {
  const bits: string[] = [];
  const ct = inv.court_type?.trim();
  if (ct) bits.push(ct);
  if (inv.field != null) bits.push(`Cancha ${inv.field}`);
  return bits.length ? bits.join(" · ") : null;
}

export function BoletasMobileList({
  rows,
  searchActive,
  loading,
  wspStatus,
  wspError,
  voidingInvoiceId,
  onSendWsp,
  onVoid,
}: BoletasMobileListProps) {
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
        {searchActive
          ? "Ningún comprobante coincide con tu búsqueda en esta pestaña."
          : "No hay comprobantes en esta vista."}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-busy={loading}>
      {rows.map((inv) => {
        const plantillaHref = invoicePlantillaPdfHref(inv);
        const st = wspStatus[inv.id] ?? "idle";
        const wErr = wspError[inv.id];
        const isFactura = inv.tipo_comprobante === "factura";
        const invSt = String(inv.status || "");
        const emittedLike =
          invSt === "emitted" ||
          (invSt === "" && Boolean(String(inv.serie_correlativo || "").trim()));
        const canVoidRow = emittedLike && Boolean(String(inv.serie_correlativo || "").trim());
        const isVoidedRow = invSt === "voided";
        const sunatRechazado = isSunatEstadoRechazado(inv.sunat_estado);
        const recText = invoiceReceptorOnly(inv) || "—";
        const descText = invoiceDescripcionOnly(inv) || "—";
        const canSend = Boolean(invoicePlantillaPdfHref(inv) || inv.file_url?.trim());
        const hasPhone = Boolean(inv.phone_number?.trim());
        const mobInvWspHref = hasPhone ? wspLink(inv.phone_number!) : null;
        const cancha = canchaSummary(inv);

        return (
          <li
            key={inv.id}
            className={`rounded-xl border p-4 shadow-sm ${
              sunatRechazado ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 font-mono text-sm font-semibold text-gray-900">
                <SerieCorrelativoCell value={inv.serie_correlativo} />
                {sunatRechazado ? (
                  <span className="mt-1 inline-block rounded-md bg-red-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-900">
                    Rechazado SUNAT
                  </span>
                ) : null}
                {isFactura ? (
                  <span className="mt-1 inline-block rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
                    Factura
                  </span>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold tabular-nums text-gray-900">
                  S/ {formatSolesAmountDisplay(inv.amount ?? 0)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{invoiceEmissionDateDisplay(inv)}</p>
              </div>
            </div>

            <p className="mt-2 text-sm text-gray-900" title={recText !== "—" ? recText : undefined}>
              {recText}
            </p>
            {descText !== "—" ? (
              <p
                className="mt-1 line-clamp-2 text-xs leading-snug text-gray-600"
                title={descText}
              >
                {descText}
              </p>
            ) : null}
            {cancha ? (
              <p className="mt-1 text-xs text-gray-500">{cancha}</p>
            ) : null}

            {mobInvWspHref ? (
              <a
                href={mobInvWspHref}
                {...anchorPropsForHref(mobInvWspHref)}
                className="mt-2 inline-flex text-sm font-medium text-green-700 underline decoration-green-600/40 underline-offset-2"
              >
                WhatsApp: {invoiceTelefonoDisplay(inv) || inv.phone_number}
              </a>
            ) : (
              <p className="mt-2 text-xs text-gray-400">Sin teléfono para WhatsApp</p>
            )}

            {canSend ? (
              <button
                type="button"
                title={!hasPhone ? "Falta teléfono" : "Enviar por WhatsApp"}
                disabled={!hasPhone || st === "sending" || st === "sent"}
                onClick={() => onSendWsp(inv)}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-bold transition-colors ${
                  st === "sent"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : st === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-green-600 bg-green-600 text-white hover:bg-green-700"
                } disabled:opacity-70`}
              >
                {st === "sending" ? (
                  "Enviando…"
                ) : st === "sent" ? (
                  "Enviado"
                ) : st === "error" ? (
                  <>
                    <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path d={WHATSAPP_ICON_PATH} />
                    </svg>
                    Reintentar envío
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path d={WHATSAPP_ICON_PATH} />
                    </svg>
                    Enviar por WhatsApp
                  </>
                )}
              </button>
            ) : null}

            {wErr ? <p className="mt-2 text-center text-xs text-red-600">{wErr}</p> : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {plantillaHref ? (
                <a
                  href={plantillaHref}
                  {...anchorPropsForHref(plantillaHref)}
                  title="Ver comprobante"
                  aria-label="Ver comprobante"
                  className="inline-flex flex-1 min-w-[8rem] items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800 hover:bg-blue-100"
                >
                  <IconOpenInNewTab className="h-4 w-4 shrink-0 opacity-90" />
                  Ver
                </a>
              ) : null}
              {isVoidedRow ? (
                <span className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-xl bg-gray-200 px-4 py-3 text-sm font-semibold text-gray-800">
                  Anulado
                </span>
              ) : canVoidRow ? (
                <button
                  type="button"
                  disabled={voidingInvoiceId === inv.id}
                  onClick={() => onVoid(inv)}
                  title="Anular comprobante"
                  className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 hover:bg-red-100 disabled:opacity-60"
                >
                  {voidingInvoiceId === inv.id ? "…" : "Anular"}
                </button>
              ) : null}
            </div>

            <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none font-medium text-gray-700">
                Detalles del comprobante
              </summary>
              <dl className="mt-2 space-y-1.5 pb-1 text-xs text-gray-600">
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Código</dt>
                  <dd className="max-w-[65%] text-right font-mono text-gray-800">
                    {inv.serie_correlativo?.trim() || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Documento receptor</dt>
                  <dd className="text-right text-gray-800">{inv.cliente_numero_de_documento?.trim() || "—"}</dd>
                </div>
                {inv.reservation_id ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Reserva</dt>
                    <dd className="truncate text-right font-mono text-gray-800" title={inv.reservation_id}>
                      {inv.reservation_id}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
