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
import { EmitMiscInvoiceModal } from "./EmitMiscInvoiceModal";

function invoicePdfHref(fileUrl: string) {
  return `/api/proxy-file?url=${encodeURIComponent(fileUrl)}`;
}

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
    if (!inv.file_url) return;
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
        body: JSON.stringify({ chat_id: chatId, file_url: inv.file_url }),
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
        toast("Solo se anulan comprobantes emitidos por SUNAT desde el panel.", "error");
        return;
      }
      if (!inv.serie_correlativo?.trim()) {
        toast("Falta serie/correlativo SUNAT.", "error");
        return;
      }
      const label = inv.tipo_comprobante === "factura" ? "factura" : "boleta";
      if (!confirm(`¿Anular esta ${label} (${inv.serie_correlativo}) en SUNAT?`)) return;
      setVoidingInvoiceId(inv.id);
      try {
        const result = await voidSunatInvoice(inv.id);
        if (!result.success) {
          toast(result.error, "error");
          return;
        }
        toast(
          result.sunat_estado === "PENDIENTE" ? "Anulación enviada (pendiente SUNAT)" : "Anulado ante SUNAT",
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
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">Comprobantes electrónicos</h1>
          <p className="mt-1 text-sm text-gray-600">Boletas y facturas SUNAT, ordenados por fecha de emisión.</p>
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
        <EmitMiscInvoiceModal
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
          <table className="w-full min-w-[1060px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-4 py-3 font-bold text-gray-800">Nro. CPE</th>
                <th className="px-4 py-3 font-bold text-gray-800">Receptor</th>
                <th className="px-4 py-3 font-bold text-gray-800">Descripción</th>
                <th className="px-4 py-3 font-bold text-gray-800">WhatsApp</th>
                <th className="px-4 py-3 text-right font-bold text-gray-800">Importe total</th>
                <th className="px-4 py-3 text-center font-bold text-gray-800">Fecha de emisión</th>
                <th className="px-4 py-3 text-center font-bold text-gray-800">Acciones</th>
                <th className="px-4 py-3 text-center font-bold text-gray-800">Anular</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No hay comprobantes en esta vista.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    Cargando…
                  </td>
                </tr>
              ) : (
                rows.map((inv, idx) => {
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
                      <td className="border-t border-gray-100 px-4 py-3 font-mono text-gray-900">
                        {inv.serie_correlativo || "—"}
                        {isFactura ? (
                          <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">
                            Factura
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="border-t border-gray-100 px-4 py-3 text-gray-900"
                        title={
                          !invoiceReceptorOnly(inv)
                            ? "Sin nombre de cliente en base de datos (emisión antigua o incompleta)."
                            : undefined
                        }
                      >
                        {invoiceReceptorOnly(inv) || "—"}
                      </td>
                      <td className="max-w-[220px] break-words border-t border-gray-100 px-4 py-3 text-gray-700">
                        {invoiceDescripcionOnly(inv) || "—"}
                      </td>
                      <td className="border-t border-gray-100 px-4 py-3 font-mono tabular-nums text-gray-800">
                        {inv.phone_number?.trim() ? (
                          <a
                            href={wspLink(inv.phone_number)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-700 underline decoration-green-600/50 underline-offset-2 hover:text-green-900"
                            title="Abrir chat en WhatsApp"
                          >
                            {invoiceTelefonoDisplay(inv)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="border-t border-gray-100 px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                        S/ {(inv.amount ?? 0).toFixed(2)}
                      </td>
                      <td className="border-t border-gray-100 px-4 py-3 text-center text-gray-700">
                        {formatInvoiceEmissionDate(inv.created_at)}
                      </td>
                      <td className="border-t border-gray-100 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {inv.file_url ? (
                            <a
                              href={invoicePdfHref(inv.file_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100"
                            >
                              Ver
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">Sin PDF</span>
                          )}
                          {inv.file_url ? (
                            <button
                              type="button"
                              title={
                                !inv.phone_number?.trim()
                                  ? "Falta teléfono en el comprobante"
                                  : "Enviar PDF por WhatsApp"
                              }
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
                      <td className="border-t border-gray-100 px-3 py-3 text-center align-top">
                        {isVoidedRow ? (
                          <span className="inline-flex rounded-md bg-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-800">
                            Anulado
                          </span>
                        ) : canVoidRow ? (
                          <button
                            type="button"
                            disabled={voidingInvoiceId === inv.id}
                            onClick={() => void handleVoidRow(inv)}
                            title={
                              isFactura
                                ? "Comunicación de baja ante SUNAT"
                                : "Anular en resumen diario (SUNAT)"
                            }
                            className="w-full min-w-[7.5rem] rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-60 sm:w-auto"
                          >
                            {voidingInvoiceId === inv.id
                              ? "Anulando…"
                              : isFactura
                                ? "Anular factura"
                                : "Anular boleta"}
                          </button>
                        ) : (
                          <span
                            className="text-xs text-gray-400"
                            title="Solo comprobantes emitidos por el panel con serie SUNAT"
                          >
                            —
                          </span>
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

      <p className="mt-4 text-xs text-gray-500">
        <strong>Receptor</strong>: cliente SUNAT (y respaldo desde reserva si faltaba dato).{" "}
        <strong>WhatsApp</strong>: contacto para enviar el PDF. Fechas en huso Lima.
      </p>
    </div>
  );
}
