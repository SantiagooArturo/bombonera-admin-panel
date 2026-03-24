"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import ReactDOM from "react-dom";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import type { User, Transfer, Invoice, Reservation, EmitComprobanteParams } from "@/lib/types";
import { normalizePeruPhone, userWhatsAppPhone } from "@/features/operaciones/utils";
import { WHATSAPP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { EmitInvoiceModal } from "@/components/verificacion/EmitInvoiceModal";
import { RegisterPaymentFormCobros } from "@/components/verificacion/RegisterPaymentFormCobros";
import { UserDrawerClientInfo } from "./UserDrawerClientInfo";
import { collectInvoiceUserKeys } from "@/features/usuarios/utils/collectInvoiceUserKeys";
import { invoiceConceptSummary } from "@/features/usuarios/utils/invoiceConceptSummary";
import { voidSunatInvoice } from "@/features/boletas/services/voidSunatInvoice";
import { mergeInvoiceVoided } from "@/features/boletas/utils/mergeInvoiceVoided";

function invoicePdfHref(fileUrl: string) {
  return `/api/proxy-file?url=${encodeURIComponent(fileUrl)}`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const [datePart] = d.split("T");
  if (!datePart) return "—";
  const [y, m, day] = datePart.split("-");
  return `${day}/${m}/${y}`;
}

function formatTime(d: string | null): string {
  if (!d) return "";
  const t = d.split("T")[1];
  if (!t) return "";
  const [h, min] = t.split(":");
  return `${h}:${min}`;
}

type UserPaymentsDrawerProps = {
  user: User;
  onClose: () => void;
  /** Sincroniza la fila de la tabla cuando se edita el usuario en el drawer. */
  onUserUpdated?: (u: User) => void;
};

export default function UserPaymentsDrawer({ user, onClose, onUserUpdated }: UserPaymentsDrawerProps) {
  const store = useStore();
  const toast = useToastContext();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [emittingId, setEmittingId] = useState<string | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [emitTransferTarget, setEmitTransferTarget] = useState<Transfer | null>(null);
  const [manualPrefill, setManualPrefill] = useState<{ amount: number; descripcion?: string } | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [localUser, setLocalUser] = useState(user);
  /** Pagos = dinero ingresado. Comprobantes = boletas/facturas SUNAT (una sola lista, sin duplicar en cada pago). */
  const [drawerTab, setDrawerTab] = useState<"pagos" | "comprobantes">("pagos");
  /** Estado envío WSP por comprobante (mismo flujo que PaymentSidebar /api/invoices/send). */
  const [invoiceWspStatus, setInvoiceWspStatus] = useState<
    Record<string, "idle" | "sending" | "sent" | "error">
  >({});
  const [invoiceWspError, setInvoiceWspError] = useState<Record<string, string>>({});
  const [voidingInvoiceId, setVoidingInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    setLocalUser(user);
  }, [user]);

  const mergeUser = useCallback(
    (next: User) => {
      setLocalUser(next);
      onUserUpdated?.(next);
    },
    [onUserUpdated]
  );

  const chatIdRaw = String(localUser.id || localUser.chat_id || "").replace(/\D/g, "");
  const userDocId = chatIdRaw.length >= 9 ? normalizePeruPhone(chatIdRaw) : chatIdRaw;
  const waResolved = userWhatsAppPhone(localUser);
  /** Consultas API: número peruano válido guardado, o fallback al id del doc si parece teléfono. */
  const queryChatId = waResolved || userDocId || localUser.id;

  const displayName =
    localUser.custom_name || localUser.contact_name || localUser.last_representative_name || "Cliente";

  /** Mismo criterio que el drawer de reserva: chat_id / teléfono para el bot de WSP. */
  const chatIdForWspSend = useMemo(
    () =>
      String(
        waResolved ||
          String(localUser.chat_id ?? "").trim() ||
          String(localUser.phone_number ?? "").trim() ||
          localUser.id ||
          ""
      ).trim(),
    [waResolved, localUser.chat_id, localUser.phone_number, localUser.id]
  );

  const sendInvoiceViaWhatsapp = useCallback(async (invoiceId: string, fileUrl: string) => {
    if (!chatIdForWspSend) {
      setInvoiceWspError((e) => ({ ...e, [invoiceId]: "Falta número de WhatsApp del cliente." }));
      setInvoiceWspStatus((s) => ({ ...s, [invoiceId]: "error" }));
      return;
    }
    let didStartSend = false;
    setInvoiceWspStatus((s) => {
      const cur = s[invoiceId] ?? "idle";
      if (cur === "sending" || cur === "sent") return s;
      didStartSend = true;
      return { ...s, [invoiceId]: "sending" };
    });
    if (!didStartSend) return;
    setInvoiceWspError((e) => {
      const next = { ...e };
      delete next[invoiceId];
      return next;
    });
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatIdForWspSend, file_url: fileUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo enviar la boleta.");
      }
      setInvoiceWspStatus((s) => ({ ...s, [invoiceId]: "sent" }));
    } catch (err) {
      setInvoiceWspStatus((s) => ({ ...s, [invoiceId]: "error" }));
      setInvoiceWspError((e) => ({
        ...e,
        [invoiceId]: err instanceof Error ? err.message : "No se pudo enviar la boleta.",
      }));
    }
  }, [chatIdForWspSend]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tfrs, resvs] = await Promise.all([
        store.fetchTransfersByChatId(String(queryChatId).replace(/\D/g, "") || localUser.id),
        store.fetchUserReservations(queryChatId),
      ]);
      setTransfers(tfrs || []);
      setReservations(resvs || []);
      const tIds = (tfrs || []).map((t) => t.id).filter(Boolean);
      const userKeys = collectInvoiceUserKeys(localUser, String(queryChatId), waResolved, userDocId);
      const [invFromTransfers, invFromUser] = await Promise.all([
        tIds.length > 0 ? store.fetchInvoicesByTransferIdsAll(tIds) : Promise.resolve([] as Invoice[]),
        store.fetchInvoicesByUserIds(userKeys),
      ]);
      const merged = new Map<string, Invoice>();
      for (const inv of [...invFromTransfers, ...invFromUser]) {
        merged.set(inv.id, inv);
      }
      const sorted = Array.from(merged.values()).sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      setInvoices(sorted);
    } finally {
      setLoading(false);
    }
  }, [store, localUser, queryChatId, waResolved, userDocId]);

  const reservationsForPayment = reservations.filter(
    (r) => r.status !== "cancelled" && r.status !== "expired"
  );
  const totalRemaining = reservations.reduce(
    (sum, r) => sum + Math.max(0, (r.total_price ?? 0) - (r.amount_paid ?? 0)),
    0
  );

  const handleRegisterPayment = useCallback(
    async (reservationId: string | null, amount: number, method: "digital" | "efectivo", mediaUrl?: string) => {
      const targetRes = reservationId ? reservations.find((r) => r.id === reservationId) : undefined;
      const phone =
        targetRes?.phone_number ||
        targetRes?.chat_id ||
        userWhatsAppPhone(localUser) ||
        localUser.phone_number ||
        localUser.chat_id ||
        localUser.id ||
        "";
      if (!phone) {
        toast("Falta teléfono o identificador del cliente", "error");
        return;
      }
      let chatIdForOrphan: string | undefined;
      if (reservationId == null) {
        chatIdForOrphan =
          String(queryChatId).replace(/\D/g, "") || String(localUser.id).replace(/\D/g, "");
        if (chatIdForOrphan.length < 9) {
          toast("Se necesita un teléfono válido (mín. 9 dígitos) para registrar sin reserva", "error");
          return;
        }
      }
      setPaymentLoading(true);
      try {
        const result = await store.processManualPayment(
          reservationId,
          amount,
          phone,
          method,
          mediaUrl,
          chatIdForOrphan
        );
        if (result?.success) {
          toast(`Pago registrado: S/ ${amount.toFixed(2)}`, "success");
          loadData();
        } else {
          toast("Error al procesar el pago", "error");
        }
      } catch {
        toast("Error inesperado al registrar pago", "error");
      } finally {
        setPaymentLoading(false);
      }
    },
    [store, toast, reservations, localUser, loadData, queryChatId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleVoidSunatFromDrawer = useCallback(
    async (inv: Invoice) => {
      const st = String(inv.status || "");
      const emittedLike =
        st === "emitted" || (st === "" && Boolean(String(inv.serie_correlativo || "").trim()));
      if (st === "voided") return;
      if (st === "attached" || !emittedLike) {
        toast("Solo se anulan comprobantes emitidos por SUNAT desde el panel.", "error");
        return;
      }
      if (!String(inv.serie_correlativo || "").trim()) {
        toast("Falta serie/correlativo SUNAT en este comprobante.", "error");
        return;
      }
      const label = inv.tipo_comprobante === "factura" ? "factura" : "boleta";
      if (
        !confirm(
          `¿Anular esta ${label} (${inv.serie_correlativo}) en SUNAT?\n\nNo se puede deshacer desde el panel.`
        )
      ) {
        return;
      }
      setVoidingInvoiceId(inv.id);
      try {
        const result = await voidSunatInvoice(inv.id);
        if (!result.success) {
          toast(result.error, "error");
          return;
        }
        toast(
          result.sunat_estado === "PENDIENTE"
            ? "Anulación enviada a SUNAT (pendiente)"
            : "Comprobante anulado ante SUNAT",
          "success"
        );
        setInvoices((prev) =>
          prev.map((i) => (i.id === inv.id ? mergeInvoiceVoided(i, result.sunat_estado) : i))
        );
      } finally {
        setVoidingInvoiceId(null);
      }
    },
    [toast]
  );

  const handleVerify = useCallback(async (transferId: string, currentVerified: boolean) => {
    const ok = await store.verifyTransfer(transferId, !currentVerified);
    if (ok) {
      toast(currentVerified ? "Validación quitada" : "Pago validado", "success");
      loadData();
    } else {
      toast("Error al validar", "error");
    }
  }, [store, toast, loadData]);

  const handleEmitInvoice = useCallback(
    async (transfer: Transfer & { id: string }, params: EmitComprobanteParams) => {
      if (transfer.id === "manual") {
        setEmittingId("manual");
        try {
          await store.emitInvoiceManual(localUser, {
            ...params,
            amount: params.amount ?? 0,
            descripcion: (params.descripcion || "").trim() || "Servicios diversos",
            cliente_denominacion: (params.cliente_denominacion || "").trim() || "CLIENTE GENERAL",
          });
          toast("Boleta emitida", "success");
          setShowManualModal(false);
          loadData();
        } catch (e) {
          toast(e instanceof Error ? e.message : "Error al emitir", "error");
        } finally {
          setEmittingId(null);
        }
        return;
      }

      const resId = transfer.reservation_id;
      if (!resId) {
        setEmitTransferTarget(null);
        setManualPrefill({ amount: params.amount ?? transfer.amount ?? 0, descripcion: params.descripcion });
        setShowManualModal(true);
        toast("Este pago no tiene reserva. Emite como boleta manual.", "info");
        return;
      }

      setEmittingId(transfer.id);
      try {
        const synthRes: Reservation = {
          id: resId,
          chat_id: localUser.id,
          phone_number: localUser.phone_number || localUser.id,
          court_type: "voley_6v6",
          field: null,
          date: "",
          time_slots: [],
          time_ranges: [],
          slot_keys: [],
          created_at: new Date().toISOString(),
          status: "confirmed",
          total_price: params.amount ?? transfer.amount ?? 0,
          representative_name: params.cliente_denominacion || displayName,
        };
        const result = await store.emitInvoice(
          synthRes,
          { id: transfer.id, amount: params.amount ?? transfer.amount ?? 0 },
          params
        );
        if (result) {
          toast("Comprobante emitido", "success");
          setEmitTransferTarget(null);
          loadData();
        } else {
          toast("Error al emitir", "error");
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error al emitir", "error");
      } finally {
        setEmittingId(null);
      }
    },
    [store, toast, localUser, displayName, loadData]
  );

  if (typeof document === "undefined") return null;

  return (
    <>
      {ReactDOM.createPortal(
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-4xl bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="shrink-0 px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <h2 className="text-xl font-bold text-gray-900 min-w-0">Pagos de &ldquo;{displayName}&rdquo;</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-200 hover:text-gray-700 shrink-0"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <UserDrawerClientInfo user={localUser} onUserUpdated={mergeUser} />

          {/* Content */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 pt-2 sm:px-6">
              <div
                className="flex gap-1 rounded-lg bg-gray-100 p-1"
                role="tablist"
                aria-label="Secciones de pagos y comprobantes"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === "pagos"}
                  onClick={() => setDrawerTab("pagos")}
                  className={`flex-1 rounded-md py-2.5 text-sm font-bold transition-colors ${
                    drawerTab === "pagos"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Pagos recibidos
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === "comprobantes"}
                  onClick={() => setDrawerTab("comprobantes")}
                  className={`flex-1 rounded-md py-2.5 text-sm font-bold transition-colors ${
                    drawerTab === "comprobantes"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Boletas y facturas
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {drawerTab === "pagos" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h3 className="text-lg font-bold text-gray-900">Pagos</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Solo dinero que ingresó (Yape, efectivo, etc.). Las boletas y facturas SUNAT están en la otra pestaña:
                      así no se repite la misma información dos veces.
                    </p>
                    <div className="mt-4">
                      <RegisterPaymentFormCobros
                        reservationsForPayment={reservationsForPayment}
                        reservationsLoading={loading}
                        totalRemaining={totalRemaining}
                        loading={paymentLoading}
                        onSubmit={handleRegisterPayment}
                        buttonLabel="Registrar pago"
                      />
                    </div>
                    {loading ? (
                      <div className="mt-6 py-10 text-center text-sm text-gray-400">Cargando pagos…</div>
                    ) : transfers.length === 0 ? (
                      <div className="mt-6 rounded-lg border border-dashed border-gray-200 bg-gray-50 py-10 text-center text-sm text-gray-600">
                        No hay pagos registrados para este cliente.
                      </div>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {transfers.map((t) => {
                          const inv = invoices.find((i) => i.transfer_id === t.id);
                          const isManual = t.source === "manual" || t.source === "manual_adjustment";
                          const verified = t.verified ?? isManual;

                          return (
                            <li
                              key={t.id}
                              className={`overflow-hidden rounded-xl border ${
                                verified ? "border-green-300 bg-white" : "border-amber-200 bg-amber-50/30"
                              }`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3 bg-white px-4 py-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-gray-500">Pago</p>
                                  <p className="text-xl font-bold tabular-nums text-gray-900">
                                    S/ {(t.amount ?? 0).toFixed(2)}
                                  </p>
                                  <p className="mt-0.5 text-sm text-gray-600">
                                    {formatDate(t.created_at)}
                                    {formatTime(t.created_at) ? ` · ${formatTime(t.created_at)}` : ""}
                                    {isManual ? <span className="text-gray-500"> · Registro manual</span> : null}
                                  </p>
                                  <p
                                    className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                      verified ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"
                                    }`}
                                  >
                                    {verified ? "Validado" : "Pendiente de validar"}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                  {t.media_url ? (
                                    <button
                                      type="button"
                                      onClick={() => setViewingImage(t.media_url!)}
                                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                      title="Ver foto o captura del pago (Yape, transferencia, etc.)"
                                    >
                                      Ver comprobante del pago
                                    </button>
                                  ) : null}
                                  {!isManual ? (
                                    <button
                                      type="button"
                                      onClick={() => handleVerify(t.id, !!verified)}
                                      className={`rounded-lg px-3 py-2 text-sm font-bold ${
                                        verified
                                          ? "border border-gray-300 bg-white text-gray-700 hover:bg-red-50 hover:text-red-800"
                                          : "bg-green-600 text-white hover:bg-green-700"
                                      }`}
                                    >
                                      {verified ? "Quitar validación" : "Marcar como validado"}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                                {inv ? (
                                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                    <p className="text-sm text-gray-700">
                                      <span className="font-semibold text-emerald-800">Ya tiene comprobante SUNAT</span>
                                      <span className="text-gray-500"> — monto y número en la pestaña </span>
                                      <span className="font-semibold text-gray-800">Boletas y facturas</span>.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setDrawerTab("comprobantes")}
                                        className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50"
                                      >
                                        Ir a boletas y facturas
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-sm text-gray-700">
                                      <span className="font-semibold text-gray-900">Sin comprobante SUNAT</span> para este
                                      pago todavía.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setEmitTransferTarget(t)}
                                      disabled={emittingId === t.id}
                                      className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                                    >
                                      {emittingId === t.id ? "Emitiendo…" : "Emitir boleta o factura"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h3 className="text-lg font-bold text-gray-900">Boletas y facturas SUNAT</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Aquí está todo lo emitido a nombre de este cliente: ligado a un pago o manual. Una sola lista.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualPrefill(null);
                        setShowManualModal(true);
                      }}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 px-4 text-sm font-bold text-white hover:bg-green-700"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Emitir boleta o factura manual
                    </button>
                    <p className="mt-2 text-xs text-gray-500">
                      Monto y concepto libres cuando no corresponde a un pago de la otra pestaña.
                    </p>
                    {loading ? (
                      <div className="mt-8 py-10 text-center text-sm text-gray-400">Cargando comprobantes…</div>
                    ) : invoices.length === 0 ? (
                      <div className="mt-8 rounded-lg border border-dashed border-gray-200 bg-gray-50 py-10 text-center text-sm text-gray-600">
                        Aún no hay boletas ni facturas registradas.
                      </div>
                    ) : (
                      <ul className="mt-6 max-h-[min(32rem,52vh)] space-y-3 overflow-y-auto overflow-x-hidden pr-0.5">
                        {invoices.map((inv) => {
                          const linked =
                            inv.transfer_id != null &&
                            inv.transfer_id !== "" &&
                            transfers.some((tr) => tr.id === inv.transfer_id);
                          const isManualDoc = inv.reservation_id === "manual";
                          const isFactura = inv.tipo_comprobante === "factura";
                          const wspStatus = invoiceWspStatus[inv.id] ?? "idle";
                          const wspErr = invoiceWspError[inv.id];
                          const invSt = String(inv.status || "");
                          const invEmittedLike =
                            invSt === "emitted" ||
                            (invSt === "" && Boolean(String(inv.serie_correlativo || "").trim()));
                          const invVoided = invSt === "voided";
                          const canVoidDrawer =
                            invEmittedLike && Boolean(String(inv.serie_correlativo || "").trim());

                          return (
                            <li
                              key={inv.id}
                              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                            >
                              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                  <span
                                    className={`mt-0.5 shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                                      isFactura
                                        ? "border-violet-200 bg-violet-50 text-violet-900"
                                        : "border-slate-200 bg-slate-100 text-slate-800"
                                    }`}
                                  >
                                    {isFactura ? "Factura" : "Boleta"}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm text-gray-500">Comprobante electrónico SUNAT</p>
                                    <p className="text-xl font-bold tabular-nums text-gray-900">
                                      S/ {(inv.amount ?? 0).toFixed(2)}
                                      {inv.serie_correlativo ? (
                                        <span className="ml-2 font-mono text-base font-semibold text-indigo-900">
                                          {inv.serie_correlativo}
                                        </span>
                                      ) : null}
                                    </p>
                                    <p className="mt-1 text-sm leading-snug text-gray-800 break-words">
                                      {invoiceConceptSummary(inv)}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-600">
                                      {formatDate(inv.created_at)}
                                      {formatTime(inv.created_at) ? ` · ${formatTime(inv.created_at)}` : ""}
                                      {linked ? (
                                        <span className="ml-1.5 font-medium text-emerald-800">· Ligado a un pago</span>
                                      ) : (
                                        <span className="ml-1.5 font-medium text-amber-800">· Sin pago vinculado</span>
                                      )}
                                      {isManualDoc ? <span className="ml-1.5 text-gray-500">· Manual</span> : null}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex min-w-0 shrink-0 flex-col gap-2 sm:w-[min(100%,20rem)]">
                                  {inv.file_url ? (
                                    <>
                                      <div className="flex gap-2">
                                        <a
                                          href={invoicePdfHref(inv.file_url)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Se abre en una pestaña nueva para imprimir o guardar"
                                          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-blue-100 bg-blue-50 py-2.5 px-3 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-100"
                                        >
                                          <svg
                                            className="h-4 w-4 shrink-0"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            aria-hidden
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                            />
                                          </svg>
                                          {isFactura ? "Ver factura" : "Ver boleta"}
                                        </a>
                                        <button
                                          type="button"
                                          title={
                                            !chatIdForWspSend
                                              ? "Falta número de WhatsApp del cliente (edítalo arriba)"
                                              : undefined
                                          }
                                          disabled={
                                            !chatIdForWspSend || wspStatus === "sending" || wspStatus === "sent"
                                          }
                                          onClick={() => void sendInvoiceViaWhatsapp(inv.id, inv.file_url!)}
                                          className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-2.5 px-3 text-sm font-bold transition-all ${
                                            wspStatus === "sent"
                                              ? "border-green-200 bg-green-50 text-green-700"
                                              : wspStatus === "error"
                                                ? "border-red-200 bg-red-50 text-red-700"
                                                : "border-green-600 bg-green-600 text-white hover:border-green-700 hover:bg-green-700"
                                          } disabled:opacity-80`}
                                        >
                                          {wspStatus === "sending" ? (
                                            <>
                                              <svg
                                                className="h-4 w-4 animate-spin"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                aria-hidden
                                              >
                                                <circle
                                                  className="opacity-25"
                                                  cx="12"
                                                  cy="12"
                                                  r="10"
                                                  stroke="currentColor"
                                                  strokeWidth="4"
                                                />
                                                <path
                                                  className="opacity-75"
                                                  fill="currentColor"
                                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                                />
                                              </svg>
                                              Enviando
                                            </>
                                          ) : wspStatus === "sent" ? (
                                            <>
                                              <svg
                                                className="h-4 w-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                aria-hidden
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M5 13l4 4L19 7"
                                                />
                                              </svg>
                                              Enviado
                                            </>
                                          ) : wspStatus === "error" ? (
                                            <>
                                              <svg
                                                className="h-4 w-4"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                aria-hidden
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M12 4v4m0 8v4m8-8h-4M8 12H4"
                                                />
                                              </svg>
                                              Reintentar envío
                                            </>
                                          ) : (
                                            <>
                                              <svg
                                                className="h-4 w-4 shrink-0"
                                                fill="currentColor"
                                                viewBox="0 0 24 24"
                                                aria-hidden
                                              >
                                                <path d={WHATSAPP_ICON_PATH} />
                                              </svg>
                                              Enviar
                                            </>
                                          )}
                                        </button>
                                      </div>
                                      {wspErr ? (
                                        <p className="text-xs font-medium text-red-600">{wspErr}</p>
                                      ) : null}
                                    </>
                                  ) : null}
                                  {invVoided ? (
                                    <p className="rounded-xl border-2 border-gray-200 bg-gray-100 py-2.5 px-3 text-center text-sm font-bold text-gray-600">
                                      Anulado ante SUNAT
                                    </p>
                                  ) : canVoidDrawer ? (
                                    <button
                                      type="button"
                                      disabled={voidingInvoiceId === inv.id}
                                      onClick={() => void handleVoidSunatFromDrawer(inv)}
                                      className="w-full rounded-xl border-2 border-red-300 bg-red-50 py-2.5 px-4 text-sm font-bold text-red-800 transition-colors hover:bg-red-100 disabled:opacity-60"
                                    >
                                      {voidingInvoiceId === inv.id
                                        ? "Anulando…"
                                        : isFactura
                                          ? "Anular factura"
                                          : "Anular boleta"}
                                    </button>
                                  ) : invEmittedLike && !inv.serie_correlativo ? (
                                    <p className="text-xs text-amber-800">
                                      No se puede anular: falta serie/correlativo en el registro.
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Backdrop */}
      {ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />,
        document.body
      )}

      {emitTransferTarget &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <EmitInvoiceModal
            transfer={emitTransferTarget}
            clientDni={localUser.last_dni}
            clientRuc={localUser.last_ruc}
            initialDescripcion=""
            initialCliente={displayName}
            onClose={() => setEmitTransferTarget(null)}
            onEmitInvoice={handleEmitInvoice}
            emitting={emittingId === emitTransferTarget.id}
            attaching={false}
          />,
          document.body
        )}

      {showManualModal &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <EmitInvoiceModal
            transfer={{ id: "manual", amount: manualPrefill?.amount ?? 0 } as Transfer & { id: string }}
            clientDni={localUser.last_dni}
            clientRuc={localUser.last_ruc}
            initialDescripcion={manualPrefill?.descripcion ?? ""}
            initialCliente={displayName}
            onClose={() => { setShowManualModal(false); setManualPrefill(null); }}
            onEmitInvoice={handleEmitInvoice}
            emitting={emittingId === "manual"}
            attaching={false}
          />,
          document.body
        )}

      {viewingImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewingImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewingImage}
            alt="Comprobante"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
