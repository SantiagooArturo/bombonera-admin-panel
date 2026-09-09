"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Transfer } from "@/lib/types";
import { PAYMENT_METHOD_LABELS, PAYMENT_SOURCE_LABELS } from "@/lib/types";
import { useToastContext } from "@/components/ClientLayout";
import { formatSolesAmountDisplay } from "@/features/boletas/utils/formatSolesAmountDisplay";
import { IconOpenInNewTab } from "@/features/boletas/components/boletasSharedUi";
import { formatDisplayPhone, wspLink } from "@/features/operaciones/utils";
import { anchorPropsForHref } from "@/lib/internal-href";
import { fetchAllTransfers } from "../services/fetchAllTransfers";
import { transferMatchesSearch } from "../utils/transferMatchesSearch";
import { transferClientDisplayName } from "../utils/transferDisplay";
import { formatTransferPaymentDisplay } from "../utils/formatTransferPaymentDisplay";
import { PagosRecibidosMobileList } from "./PagosRecibidosMobileList";
import { RegistrarPagoModal } from "./RegistrarPagoModal";
import { TransferVerifiedSelect } from "./TransferVerifiedSelect";

const POLL_MS = 30_000;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

export function PagosRecibidosPage() {
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const urlSearch = searchParams.get("search")?.trim() ?? "";
  const [searchInput, setSearchInput] = useState(() => urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(() => urlSearch);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [registerOpen, setRegisterOpen] = useState(false);

  useEffect(() => {
    setSearchInput(urlSearch);
    setDebouncedSearch(urlSearch);
  }, [urlSearch]);

  // Debounce search input to keep typing instantaneous on low-end CPUs
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCurrentPage(1);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (!silent) {
        setError(null);
        setInitialLoading(true);
      }
      try {
        const data = await fetchAllTransfers();
        setTransfers(data);
        if (!silent) setError(null);
      } catch (e) {
        setTransfers([]);
        if (!silent) {
          setError(e instanceof Error ? e.message : "Error al cargar");
        }
      } finally {
        if (!silent) setInitialLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const rows = useMemo(
    () => transfers.filter((t) => transferMatchesSearch(t, debouncedSearch)),
    [transfers, debouncedSearch]
  );

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

  const handleVerifiedUpdated = useCallback((id: string, verified: boolean) => {
    setTransfers((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              verified,
              verified_at: verified ? new Date().toISOString() : undefined,
            }
          : t
      )
    );
  }, []);

  const handleVerifiedError = useCallback(
    (message: string) => {
      toast(message, "error");
    },
    [toast]
  );

  const handleRegisterSuccess = useCallback(() => {
    toast("Pago registrado", "success");
    void load({ silent: true });
  }, [toast, load]);

  const renderPagination = () => {
    if (totalItems === 0) return null;
    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-3 px-2 text-xs sm:text-sm text-gray-600 border-t border-gray-100 bg-gray-50/50">
        <div className="text-gray-600">
          Mostrando <strong className="text-gray-900 font-semibold">{startItem}–{endItem}</strong> de{" "}
          <strong className="text-gray-900 font-semibold">{totalItems}</strong>{" "}
          {debouncedSearch.trim() ? "pagos filtrados" : "pagos"}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>Mostrar:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-sm focus:border-field-dark focus:outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(1)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
              title="Primera página"
            >
              «
            </button>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
            >
              Anterior
            </button>
            <span className="px-2 text-xs font-semibold text-gray-800">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
            >
              Siguiente
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
              title="Última página"
            >
              »
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,120rem)] px-3 py-8 sm:px-4 md:px-5 lg:px-6 xl:px-8 2xl:px-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Pagos recibidos</h1>
          <p className="mt-1 text-sm text-gray-600">
            Transferencias y cobros (sin ajustes manuales). La lista se actualiza sola cada {POLL_MS / 1000} s.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="shrink-0 rounded-xl bg-field-dark px-5 py-3 text-sm font-bold text-white shadow-sm hover:opacity-95"
        >
          Registrar pago
        </button>
      </div>

      {registerOpen ? (
        <RegistrarPagoModal
          onClose={() => setRegisterOpen(false)}
          onSuccess={handleRegisterSuccess}
        />
      ) : null}

      <div className="mb-6 relative">
        <label htmlFor="pagos-recibidos-search" className="sr-only">
          Buscar pagos
        </label>
        <input
          id="pagos-recibidos-search"
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setDebouncedSearch(searchInput);
              setCurrentPage(1);
            }
          }}
          placeholder="Buscar por nombre, DNI, WhatsApp, operación, monto…"
          autoComplete="off"
          className="w-full rounded-xl border border-gray-200 bg-white pl-4 pr-10 py-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-field-dark focus:outline-none focus:ring-2 focus:ring-field-dark/25"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setDebouncedSearch("");
              setCurrentPage(1);
            }}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="lg:hidden">
        <PagosRecibidosMobileList
          rows={paginatedRows}
          searchActive={Boolean(debouncedSearch.trim())}
          loading={initialLoading}
          onVerifiedUpdated={handleVerifiedUpdated}
          onVerifiedError={handleVerifiedError}
        />
        {renderPagination()}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:block">
        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse text-sm">
            <colgroup>
              <col style={{ width: "9.5rem" }} />
              <col style={{ width: "9.5rem" }} />
              <col style={{ width: "4.5rem" }} />
              <col style={{ width: "5.5rem" }} />
              <col style={{ width: "4.75rem" }} />
              <col style={{ width: "4.25rem" }} />
              <col style={{ width: "6.5rem" }} />
              <col style={{ width: "7.5rem" }} />
              <col style={{ width: "5rem" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3">
                  Fecha y hora
                </th>
                <th className="px-2 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3">
                  Cliente
                </th>
                <th className="px-1.5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                  DNI
                </th>
                <th className="px-1.5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                  WhatsApp
                </th>
                <th className="px-1.5 py-4 text-right text-xs font-bold uppercase tracking-wide text-gray-600">
                  Importe
                </th>
                <th className="px-1.5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                  Método
                </th>
                <th className="px-1.5 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                  Origen
                </th>
                <th className="px-1.5 py-4 text-center text-xs font-bold uppercase tracking-wide text-gray-600">
                  Verificación
                </th>
                <th className="px-1.5 py-4 text-center text-xs font-bold uppercase tracking-wide text-gray-600">
                  Comprobante
                </th>
              </tr>
            </thead>
            <tbody>
              {!initialLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-500">
                    {debouncedSearch.trim()
                      ? "Ningún pago coincide con tu búsqueda."
                      : "No hay pagos en esta vista."}
                  </td>
                </tr>
              ) : null}
              {initialLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                    Cargando…
                  </td>
                </tr>
              ) : (
                paginatedRows.map((t, idx) => {
                  const name = transferClientDisplayName(t);
                  const phone = t.phone_number?.trim();
                  const transferWspHref = phone ? wspLink(phone) : null;
                  const media = t.media_url?.trim();
                  const proxy = media ? `/api/proxy-file?url=${encodeURIComponent(media)}` : null;
                  const methodLabel =
                    t.payment_method && PAYMENT_METHOD_LABELS[t.payment_method]
                      ? PAYMENT_METHOD_LABELS[t.payment_method]
                      : t.payment_method || "—";
                  const sourceLabel =
                    t.source && PAYMENT_SOURCE_LABELS[t.source] ? PAYMENT_SOURCE_LABELS[t.source] : t.source || "—";

                  return (
                    <tr key={t.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="border-t border-gray-100 px-2 py-3 align-top text-xs leading-snug text-gray-700 lg:px-3 xl:text-sm">
                        {formatTransferPaymentDisplay(t)}
                      </td>
                      <td className="max-w-[9.5rem] border-t border-gray-100 px-2 py-3 align-top lg:px-3">
                        <p
                          className="truncate text-xs text-gray-900 xl:text-sm"
                          title={name !== "—" ? name : undefined}
                        >
                          {name}
                        </p>
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 align-top font-mono text-xs text-gray-800 xl:text-sm">
                        {t.client_last_dni?.trim() || "—"}
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 align-middle font-mono text-xs tabular-nums text-gray-800">
                        {transferWspHref ? (
                          <a
                            href={transferWspHref}
                            {...anchorPropsForHref(transferWspHref)}
                            className="block truncate text-green-700 underline decoration-green-600/50 underline-offset-2 hover:text-green-900"
                            title={formatDisplayPhone(phone)}
                          >
                            {formatDisplayPhone(phone)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 text-right align-middle text-xs font-semibold tabular-nums text-gray-900">
                        S/ {formatSolesAmountDisplay(t.amount ?? 0)}
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 align-middle text-xs text-gray-800">
                        {methodLabel}
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 align-middle text-xs text-gray-800">
                        {sourceLabel}
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 align-middle">
                        <div className="flex justify-center">
                          <TransferVerifiedSelect
                            transfer={t}
                            onUpdated={handleVerifiedUpdated}
                            onError={handleVerifiedError}
                          />
                        </div>
                      </td>
                      <td className="border-t border-gray-100 px-1.5 py-3 align-middle">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {proxy ? (
                            <a
                              href={proxy}
                              {...anchorPropsForHref(proxy)}
                              title="Ver imagen del comprobante"
                              aria-label="Ver comprobante"
                              className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
                            >
                              <IconOpenInNewTab className="h-3.5 w-3.5 shrink-0 opacity-90" />
                              Ver
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </div>
    </div>
  );
}
