"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Invoice } from "@/lib/types";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import { WHATSAPP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { formatInvoiceEmissionDate } from "../utils/formatInvoiceEmissionDate";
import { formatSolesAmountDisplay } from "../utils/formatSolesAmountDisplay";
import { wspLink } from "@/features/operaciones/utils";
import {
  invoiceDescripcionOnly,
  invoiceReceptorOnly,
  invoiceTelefonoDisplay,
} from "../utils/invoiceTableColumns";
import { fetchAllInvoices } from "../services/fetchInvoices";
import { voidSunatInvoice } from "../services/voidSunatInvoice";
import { EmitComprobanteModal } from "./EmitComprobanteModal";
import { invoicePlantillaPdfHref, invoiceXmlHref } from "../utils/invoicePdfLinks";
import { invoiceComprobantePdfDownloadFilename } from "../utils/comprobantePdfFilename";
import { invoiceMatchesSearch } from "../utils/invoiceMatchesSearch";
import { BoletasMobileList } from "./BoletasMobileList";
import { IconOpenInNewTab, SerieCorrelativoCell } from "./boletasSharedUi";

type ComprobanteTab = "todos" | "boletas" | "facturas";

export function BoletasPage() {
  const store = useStore();
  const toast = useToastContext();
  const [tab, setTab] = useState<ComprobanteTab>("todos");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wspStatus, setWspStatus] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});
  const [wspError, setWspError] = useState<Record<string, string>>({});
  const [voidingInvoiceId, setVoidingInvoiceId] = useState<string | null>(null);
  const [miscModalOpen, setMiscModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** Evita depender de `didStart` tras setState (Strict Mode / batching puede dejar la petición sin ejecutar). */
  const wspSendInFlightRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllInvoices();
      setInvoices(data);
    } catch (e) {
      setInvoices([]);
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const searchedInvoices = useMemo(
    () => invoices.filter((inv) => invoiceMatchesSearch(inv, searchQuery)),
    [invoices, searchQuery]
  );

  const rows = useMemo(() => {
    if (tab === "todos") return searchedInvoices;
    if (tab === "facturas") return searchedInvoices.filter((i) => i.tipo_comprobante === "factura");
    return searchedInvoices.filter((i) => i.tipo_comprobante !== "factura");
  }, [searchedInvoices, tab]);

  const counts = useMemo(() => {
    const facturas = searchedInvoices.filter((i) => i.tipo_comprobante === "factura").length;
    const boletas = searchedInvoices.length - facturas;
    return { todos: searchedInvoices.length, boletas, facturas };
  }, [searchedInvoices]);

  const sendWsp = useCallback(async (inv: Invoice) => {
    const id = inv.id;
    const hasPdf = Boolean(invoicePlantillaPdfHref(inv) || inv.file_url?.trim());
    if (!hasPdf) {
      setWspStatus((s) => ({ ...s, [id]: "error" }));
      setWspError((e) => ({
        ...e,
        [id]: "Este comprobante no tiene PDF para enviar.",
      }));
      return;
    }
    const chatId = String(inv.phone_number || "").trim();
    if (!chatId) {
      setWspStatus((s) => ({ ...s, [id]: "error" }));
      setWspError((e) => ({ ...e, [id]: "Este comprobante no tiene teléfono para WhatsApp." }));
      return;
    }

    if (wspSendInFlightRef.current.has(id)) return;
    wspSendInFlightRef.current.add(id);

    setWspStatus((s) => ({ ...s, [id]: "sending" }));
    setWspError((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });

    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          invoice_id: id,
          filename: invoiceComprobantePdfDownloadFilename(inv),
        }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo enviar.");
      }
      setWspStatus((s) => ({ ...s, [id]: "sent" }));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === "TimeoutError" || err.message.includes("aborted")
            ? "Tiempo de espera agotado al enviar."
            : err.message
          : "No se pudo enviar.";
      setWspStatus((s) => ({ ...s, [id]: "error" }));
      setWspError((e) => ({ ...e, [id]: msg }));
    } finally {
      wspSendInFlightRef.current.delete(id);
    }
  }, []);

  const handleVoidRow = useCallback(
    async (inv: Invoice) => {
      const st = String(inv.status || "");
      const emittedLike =
        st === "emitted" || (st === "" && Boolean(String(inv.serie_correlativo || "").trim()));
      if (st === "voided" || st === "attached" || !emittedLike) {
        toast("Solo se pueden anular comprobantes emitidos desde el panel.", "error");
        return;
      }
      if (!inv.serie_correlativo?.trim()) {
        toast("Falta número de comprobante.", "error");
        return;
      }
      const label = inv.tipo_comprobante === "factura" ? "factura" : "boleta";
      if (!confirm(`¿Anular esta ${label} (${inv.serie_correlativo})?`)) return;
      setVoidingInvoiceId(inv.id);
      try {
        const result = await voidSunatInvoice(inv.id);
        if (!result.success) {
          toast(result.error, "error");
          return;
        }
        toast(
          result.sunat_estado === "PENDIENTE" ? "Anulación enviada (en proceso)" : "Comprobante anulado",
          "success"
        );
        await load();
      } finally {
        setVoidingInvoiceId(null);
      }
    },
    [toast, load]
  );

  const tabBtn = (id: ComprobanteTab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex-1 rounded-md px-2 py-3 text-sm font-bold transition-colors sm:px-3 ${
        tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {label}
      <span className="pl-4 tabular-nums text-xs font-semibold opacity-70">({count})</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[min(100%,120rem)] px-3 py-8 sm:px-4 md:px-5 lg:px-6 xl:px-8 2xl:px-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Comprobantes</h1>
          <p className="mt-1 text-sm text-gray-600">Boletas y facturas, por fecha.</p>
        </div>
        <button
          type="button"
          onClick={() => setMiscModalOpen(true)}
          className="shrink-0 rounded-xl bg-field-dark px-5 py-3 text-sm font-bold text-white shadow-sm hover:opacity-95"
        >
          Emitir boleta / factura
        </button>
      </div>

      {miscModalOpen ? (
        <EmitComprobanteModal
          mode="misc"
          onClose={() => setMiscModalOpen(false)}
          onSuccess={() => {
            void load();
            void store.fetchUsers();
          }}
        />
      ) : null}

      <div className="mb-6">
        <label htmlFor="boletas-search" className="sr-only">
          Buscar comprobantes
        </label>
        <input
          id="boletas-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por código, receptor, DNI, cancha, WhatsApp o importe…"
          autoComplete="off"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-field-dark focus:outline-none focus:ring-2 focus:ring-field-dark/25"
        />
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-100 p-1 shadow-sm">
        <div className="flex gap-1" role="tablist" aria-label="Tipo de comprobante">
          {tabBtn("todos", "Todos", counts.todos)}
          {tabBtn("boletas", "Boletas", counts.boletas)}
          {tabBtn("facturas", "Facturas", counts.facturas)}
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="lg:hidden">
        <BoletasMobileList
          rows={rows}
          searchActive={Boolean(searchQuery.trim())}
          loading={loading}
          wspStatus={wspStatus}
          wspError={wspError}
          voidingInvoiceId={voidingInvoiceId}
          onSendWsp={(inv) => void sendWsp(inv)}
          onVoid={(inv) => void handleVoidRow(inv)}
        />
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[min(100%,64rem)] table-fixed border-collapse text-sm lg:min-w-0">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col />
              <col style={{ width: "5.75rem" }} />
              <col style={{ width: "5.25rem" }} />
              <col className="w-[10%]" />
              <col style={{ width: "6.75rem" }} />
              <col className="w-[10%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-5 text-left text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3 xl:px-3.5">
                  Nro. CPE
                </th>
                <th className="px-2 py-5 text-left text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3 xl:px-3.5">
                  Receptor
                </th>
                <th className="max-w-[28rem] px-2 py-5 text-left text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3 xl:px-3.5">
                  Descripción
                </th>
                <th className="w-[5.75rem] max-w-[5.75rem] px-1.5 py-5 text-left text-xs font-bold uppercase tracking-wide text-gray-600 xl:px-2">
                  WhatsApp
                </th>
                <th className="w-[5.25rem] max-w-[5.25rem] px-1.5 py-5 text-right text-xs font-bold uppercase tracking-wide text-gray-600 xl:px-2">
                  Importe
                </th>
                <th className="px-2 py-5 text-center text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3 xl:px-3.5">
                  Emisión
                </th>
                <th className="w-[6.75rem] max-w-[6.75rem] px-1.5 py-5 text-center text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-2">
                  Comprobante
                </th>
                <th className="px-2 py-5 text-center text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3 xl:px-3.5">
                  Enviar
                </th>
                <th className="align-middle px-2 py-5 text-center text-xs font-bold uppercase tracking-wide text-gray-600 lg:px-3 xl:px-3.5">
                  Anular
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-500">
                    {searchQuery.trim()
                      ? "Ningún comprobante coincide con tu búsqueda en esta pestaña."
                      : "No hay comprobantes en esta vista."}
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                    Cargando…
                  </td>
                </tr>
              ) : (
                rows.map((inv, idx) => {
                  const plantillaHref = invoicePlantillaPdfHref(inv);
                  const xmlHref = invoiceXmlHref(inv);
                  const st = wspStatus[inv.id] ?? "idle";
                  const wErr = wspError[inv.id];
                  const isFactura = inv.tipo_comprobante === "factura";
                  const invSt = String(inv.status || "");
                  const emittedLike =
                    invSt === "emitted" ||
                    (invSt === "" && Boolean(String(inv.serie_correlativo || "").trim()));
                  const canVoidRow = emittedLike && Boolean(String(inv.serie_correlativo || "").trim());
                  const isVoidedRow = invSt === "voided";
                  const recText = invoiceReceptorOnly(inv) || "—";
                  const descText = invoiceDescripcionOnly(inv) || "—";
                  return (
                    <tr key={inv.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="border-t border-gray-100 px-2 py-5 align-top font-mono text-xs text-gray-900 lg:px-3 xl:px-3.5 xl:text-sm">
                        <div className="flex flex-col gap-0.5">
                          <SerieCorrelativoCell value={inv.serie_correlativo} />
                          {isFactura ? (
                            <span className="w-fit rounded bg-violet-100 px-2 py-1 text-[10px] font-semibold leading-none text-violet-800 xl:text-xs">
                              Factura
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="min-w-0 max-w-[14rem] border-t border-gray-100 px-2 py-4 align-top lg:px-3 xl:px-3.5">
                        <p
                          className="line-clamp-2 break-words text-xs text-gray-900 xl:text-sm"
                          title={recText !== "—" ? recText : undefined}
                        >
                          {recText}
                        </p>
                      </td>
                      <td className="min-w-0 max-w-[28rem] border-t border-gray-100 px-2 py-5 align-top lg:px-3 xl:px-3.5">
                        <p
                          className="line-clamp-2 break-words text-xs leading-snug text-gray-700 xl:text-sm"
                          title={descText !== "—" ? descText : undefined}
                        >
                          {descText}
                        </p>
                      </td>
                      <td className="w-[5.75rem] max-w-[5.75rem] border-t border-gray-100 px-1.5 py-5 align-middle font-mono text-xs tabular-nums text-gray-800 xl:px-2 xl:text-sm">
                        {inv.phone_number?.trim() ? (
                          <a
                            href={wspLink(inv.phone_number)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-green-700 underline decoration-green-600/50 underline-offset-2 hover:text-green-900"
                            title={invoiceTelefonoDisplay(inv)}
                          >
                            {invoiceTelefonoDisplay(inv)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="w-[5.25rem] max-w-[5.25rem] border-t border-gray-100 px-1.5 py-5 text-right align-middle text-xs font-semibold tabular-nums text-gray-900 xl:px-2 xl:text-sm">
                        <span className="block whitespace-nowrap">
                          S/ {formatSolesAmountDisplay(inv.amount ?? 0)}
                        </span>
                      </td>
                      <td className="border-t border-gray-100 px-2 py-5 text-center align-middle text-xs text-gray-700 lg:px-3 xl:px-3.5 xl:text-sm">
                        {formatInvoiceEmissionDate(inv.created_at)}
                      </td>
                      <td className="w-[6.75rem] max-w-[6.75rem] border-t border-gray-100 px-1.5 py-5 align-middle lg:px-2">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {plantillaHref ? (
                            <a
                              href={plantillaHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Ver comprobante (se abre en una pestaña nueva)"
                              aria-label="Ver comprobante en una pestaña nueva"
                              className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
                            >
                              <IconOpenInNewTab className="h-3.5 w-3.5 shrink-0 opacity-90" />
                              Ver
                            </a>
                          ) : (
                            <span className="shrink-0 text-xs text-gray-400">—</span>
                          )}
                          {xmlHref ? (
                            <a
                              href={xmlHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Descargar o ver XML SUNAT"
                              className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-[10px] font-bold text-violet-800 hover:bg-violet-100 xl:text-xs"
                            >
                              XML
                            </a>
                          ) : null}
                          {/*
                            PDF oficial apisunat (revivir):
                            import { invoiceSunatPdfHref } from "../utils/invoicePdfLinks";
                            {invoiceSunatPdfHref(inv) ? (
                              <a
                                href={invoiceSunatPdfHref(inv)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 … border-slate-300 bg-slate-50 …"
                              >
                                PDF SUNAT
                              </a>
                            ) : (
                              <span className="shrink-0 text-xs text-gray-400">Sin SUNAT</span>
                            )}
                          */}
                        </div>
                      </td>
                      <td className="border-t border-gray-100 px-2 py-5 align-middle lg:px-3 xl:px-3.5">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {invoicePlantillaPdfHref(inv) || inv.file_url?.trim() ? (
                            <button
                              type="button"
                              title={!inv.phone_number?.trim() ? "Falta teléfono" : "Enviar por WhatsApp"}
                              disabled={!inv.phone_number?.trim() || st === "sending" || st === "sent"}
                              onClick={() => void sendWsp(inv)}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                                st === "sent"
                                  ? "border-green-200 bg-green-50 text-green-800"
                                  : st === "error"
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : "border-green-600 bg-green-600 text-white hover:bg-green-700"
                              } disabled:opacity-70`}
                            >
                              {st === "sending" ? (
                                "…"
                              ) : st === "sent" ? (
                                "OK"
                              ) : st === "error" ? (
                                <>
                                  <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                                    <path d={WHATSAPP_ICON_PATH} />
                                  </svg>
                                  Reintentar
                                </>
                              ) : (
                                <>
                                  <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                                    <path d={WHATSAPP_ICON_PATH} />
                                  </svg>
                                  Enviar
                                </>
                              )}
                            </button>
                          ) : null}
                        </div>
                        {wErr ? <p className="mt-0.5 text-center text-[10px] leading-tight text-red-600 xl:text-xs">{wErr}</p> : null}
                      </td>
                      <td className="border-t border-gray-100 px-2 py-5 align-middle lg:px-3 xl:px-3.5">
                        <div className="flex items-center justify-center text-center">
                          {isVoidedRow ? (
                            <span className="inline-flex rounded-lg bg-gray-200 px-3 py-2 text-xs font-semibold text-gray-800">
                              Anulado
                            </span>
                          ) : canVoidRow ? (
                            <button
                              type="button"
                              disabled={voidingInvoiceId === inv.id}
                              onClick={() => void handleVoidRow(inv)}
                              title="Anular comprobante"
                              className="max-w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold leading-tight text-red-800 hover:bg-red-100 disabled:opacity-60"
                            >
                              {voidingInvoiceId === inv.id ? "…" : "Anular"}
                            </button>
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
      </div>

    </div>
  );
}
