"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Invoice } from "@/lib/types";
import { useToastContext } from "@/components/ClientLayout";
import { WHATSAPP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { formatInvoiceEmissionDate } from "../utils/formatInvoiceEmissionDate";
import { wspLink } from "@/features/operaciones/utils";
import {
  invoiceDescripcionOnly,
  invoiceReceptorOnly,
  invoiceTelefonoDisplay,
} from "../utils/invoiceTableColumns";
import { fetchAllInvoices } from "../services/fetchInvoices";
import { voidSunatInvoice } from "../services/voidSunatInvoice";
import { EmitComprobanteModal } from "./EmitComprobanteModal";
import {
  invoicePersonalizedPdfAbsoluteUrlForSend,
  invoicePlantillaPdfHref,
} from "../utils/invoicePdfLinks";
import { invoiceComprobantePdfDownloadFilename } from "../utils/comprobantePdfFilename";

type ComprobanteTab = "todos" | "boletas" | "facturas";

export function BoletasPage() {
  const toast = useToastContext();
  const [tab, setTab] = useState<ComprobanteTab>("todos");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wspStatus, setWspStatus] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});
  const [wspError, setWspError] = useState<Record<string, string>>({});
  const [voidingInvoiceId, setVoidingInvoiceId] = useState<string | null>(null);
  const [miscModalOpen, setMiscModalOpen] = useState(false);

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

  const rows = useMemo(() => {
    if (tab === "todos") return invoices;
    if (tab === "facturas") return invoices.filter((i) => i.tipo_comprobante === "factura");
    return invoices.filter((i) => i.tipo_comprobante !== "factura");
  }, [invoices, tab]);

  const counts = useMemo(() => {
    const facturas = invoices.filter((i) => i.tipo_comprobante === "factura").length;
    const boletas = invoices.length - facturas;
    return { todos: invoices.length, boletas, facturas };
  }, [invoices]);

  const sendWsp = useCallback(async (inv: Invoice) => {
    const fileUrlForBot =
      invoicePersonalizedPdfAbsoluteUrlForSend(inv) ?? inv.file_url?.trim() ?? "";
    if (!fileUrlForBot) return;
    const chatId = String(inv.phone_number || "").trim();
    if (!chatId) {
      setWspStatus((s) => ({ ...s, [inv.id]: "error" }));
      setWspError((e) => ({ ...e, [inv.id]: "Este comprobante no tiene teléfono para WhatsApp." }));
      return;
    }
    let didStart = false;
    setWspStatus((s) => {
      const cur = s[inv.id] ?? "idle";
      if (cur === "sending" || cur === "sent") return s;
      didStart = true;
      return { ...s, [inv.id]: "sending" };
    });
    if (!didStart) return;
    setWspError((e) => {
      const next = { ...e };
      delete next[inv.id];
      return next;
    });
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          file_url: fileUrlForBot,
          filename: invoiceComprobantePdfDownloadFilename(inv),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo enviar.");
      }
      setWspStatus((s) => ({ ...s, [inv.id]: "sent" }));
    } catch (err) {
      setWspStatus((s) => ({ ...s, [inv.id]: "error" }));
      setWspError((e) => ({
        ...e,
        [inv.id]: err instanceof Error ? err.message : "No se pudo enviar.",
      }));
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
      className={`flex-1 rounded-md py-2.5 text-sm font-bold transition-colors ${
        tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {label}
      <span className="pl-4 tabular-nums text-xs font-semibold opacity-70">({count})</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[min(100%,100rem)] px-5 py-8 sm:px-8 lg:px-12 xl:px-14">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Comprobantes</h1>
          <p className="mt-1 text-sm text-gray-600">Boletas y facturas, por fecha.</p>
        </div>
        <button
          type="button"
          onClick={() => setMiscModalOpen(true)}
          className="shrink-0 rounded-xl bg-field-dark px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-95"
        >
          Emitir boleta / factura
        </button>
      </div>

      {miscModalOpen ? (
        <EmitComprobanteModal
          mode="misc"
          onClose={() => setMiscModalOpen(false)}
          onSuccess={() => void load()}
        />
      ) : null}

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

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="whitespace-nowrap px-6 py-4 text-base font-bold text-gray-800">Nro. CPE</th>
                <th className="min-w-[11rem] px-6 py-4 text-base font-bold text-gray-800">Receptor</th>
                <th className="min-w-[18rem] px-6 py-4 text-base font-bold text-gray-800 lg:min-w-[22rem]">
                  Descripción
                </th>
                <th className="whitespace-nowrap px-6 py-4 text-base font-bold text-gray-800">WhatsApp</th>
                <th className="whitespace-nowrap px-6 py-4 text-right text-base font-bold text-gray-800">
                  Importe total
                </th>
                <th className="whitespace-nowrap px-6 py-4 text-center text-base font-bold text-gray-800">
                  Fecha de emisión
                </th>
                <th className="min-w-[9.5rem] whitespace-nowrap px-6 py-4 text-center text-base font-bold text-gray-800">
                  Comprobante
                </th>
                <th className="px-6 py-4 text-center text-base font-bold text-gray-800">Acciones</th>
                <th className="whitespace-nowrap px-6 py-4 text-center text-base font-bold text-gray-800">Anular</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                    No hay comprobantes en esta vista.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                    Cargando…
                  </td>
                </tr>
              ) : (
                rows.map((inv, idx) => {
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
                  return (
                    <tr key={inv.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="border-t border-gray-100 px-6 py-4 font-mono text-base text-gray-900">
                        {inv.serie_correlativo || "—"}
                        {isFactura ? (
                          <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">
                            Factura
                          </span>
                        ) : null}
                      </td>
                      <td className="border-t border-gray-100 px-6 py-4 text-base text-gray-900">
                        {invoiceReceptorOnly(inv) || "—"}
                      </td>
                      <td className="max-w-xl break-words border-t border-gray-100 px-6 py-4 text-base leading-relaxed text-gray-700">
                        {invoiceDescripcionOnly(inv) || "—"}
                      </td>
                      <td className="border-t border-gray-100 px-6 py-4 font-mono text-base tabular-nums text-gray-800">
                        {inv.phone_number?.trim() ? (
                          <a
                            href={wspLink(inv.phone_number)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-700 underline decoration-green-600/50 underline-offset-2 hover:text-green-900"
                            title="WhatsApp"
                          >
                            {invoiceTelefonoDisplay(inv)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="border-t border-gray-100 px-6 py-4 text-right text-base font-semibold tabular-nums text-gray-900">
                        S/ {(inv.amount ?? 0).toFixed(2)}
                      </td>
                      <td className="border-t border-gray-100 px-6 py-4 text-center text-base text-gray-700">
                        {formatInvoiceEmissionDate(inv.created_at)}
                      </td>
                      <td className="border-t border-gray-100 px-6 py-4 align-middle">
                        <div className="flex flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
                          {plantillaHref ? (
                            <a
                              href={plantillaHref}
                              download={invoiceComprobantePdfDownloadFilename(inv)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={isFactura ? "Abrir factura" : "Abrir boleta"}
                              className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100"
                            >
                              {isFactura ? "Ver factura" : "Ver boleta"}
                            </a>
                          ) : (
                            <span className="shrink-0 text-xs text-gray-400">—</span>
                          )}
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
                      <td className="border-t border-gray-100 px-6 py-4">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {invoicePersonalizedPdfAbsoluteUrlForSend(inv) || inv.file_url?.trim() ? (
                            <button
                              type="button"
                              title={!inv.phone_number?.trim() ? "Falta teléfono" : "Enviar por WhatsApp"}
                              disabled={!inv.phone_number?.trim() || st === "sending" || st === "sent"}
                              onClick={() => void sendWsp(inv)}
                              className={`inline-flex items-center gap-1 rounded-lg border-2 px-2.5 py-1.5 text-xs font-bold transition-colors ${
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
                                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                                    <path d={WHATSAPP_ICON_PATH} />
                                  </svg>
                                  Reintentar
                                </>
                              ) : (
                                <>
                                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                                    <path d={WHATSAPP_ICON_PATH} />
                                  </svg>
                                  Enviar
                                </>
                              )}
                            </button>
                          ) : null}
                        </div>
                        {wErr ? <p className="mt-1 text-center text-xs text-red-600">{wErr}</p> : null}
                      </td>
                      <td className="border-t border-gray-100 px-6 py-4 text-center align-top">
                        {isVoidedRow ? (
                          <span className="inline-flex rounded-md bg-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-800">
                            Anulado
                          </span>
                        ) : canVoidRow ? (
                          <button
                            type="button"
                            disabled={voidingInvoiceId === inv.id}
                            onClick={() => void handleVoidRow(inv)}
                            title={isFactura ? "Anular factura" : "Anular boleta"}
                            className="w-full min-w-[7.5rem] rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-60 sm:w-auto"
                          >
                            {voidingInvoiceId === inv.id
                              ? "Anulando…"
                              : isFactura
                                ? "Anular factura"
                                : "Anular boleta"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
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
