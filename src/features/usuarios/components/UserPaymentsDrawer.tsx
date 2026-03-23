"use client";

import { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import type { User, Transfer, Invoice, Reservation } from "@/lib/types";
import { normalizePeruPhone, userWhatsAppPhone } from "@/features/operaciones/utils";
import { EmitInvoiceModal } from "@/components/verificacion/EmitInvoiceModal";
import { RegisterPaymentFormCobros } from "@/components/verificacion/RegisterPaymentFormCobros";
import { UserDrawerClientInfo } from "./UserDrawerClientInfo";

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
      const invs = tIds.length > 0 ? await store.fetchInvoicesByTransferIds(tIds) : [];
      setInvoices(invs || []);
    } finally {
      setLoading(false);
    }
  }, [store, localUser.id, queryChatId]);

  const reservationsWithDebt = reservations.filter(
    (r) => (r.total_price ?? 0) - (r.amount_paid ?? 0) > 0 && r.status !== "cancelled" && r.status !== "expired"
  );
  const reservationsForPayment = reservations.filter(
    (r) => r.status !== "cancelled" && r.status !== "expired"
  );
  const totalRemaining = reservations.reduce(
    (sum, r) => sum + Math.max(0, (r.total_price ?? 0) - (r.amount_paid ?? 0)),
    0
  );

  const handleRegisterPayment = useCallback(
    async (reservationId: string, amount: number, method: "digital" | "efectivo", mediaUrl?: string) => {
      const targetRes = reservations.find((r) => r.id === reservationId);
      const phone =
        targetRes?.phone_number || targetRes?.chat_id || userWhatsAppPhone(localUser) || "";
      if (!phone) return;
      setPaymentLoading(true);
      try {
        const result = await store.processManualPayment(reservationId, amount, phone, method, mediaUrl);
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
    [store, toast, reservations, localUser, loadData]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    async (
      transfer: Transfer & { id: string },
      params: {
        tipo_comprobante: "boleta" | "factura";
        doc_num: string;
        cliente_denominacion?: string;
        descripcion?: string;
        amount?: number;
      }
    ) => {
      if (transfer.id === "manual") {
        setEmittingId("manual");
        try {
          await store.emitInvoiceManual(localUser, {
            tipo_comprobante: params.tipo_comprobante,
            doc_num: params.doc_num,
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
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col">
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
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => { setManualPrefill(null); setShowManualModal(true); }}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Emitir boleta manual
              </button>
              <p className="text-xs text-gray-500">
                Monto y concepto libres. Para pagos que no figuren abajo o cuando necesites emitir por cualquier motivo.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-gray-800">Transferencias registradas</h3>
              <RegisterPaymentFormCobros
                reservationsForPayment={reservationsForPayment}
                reservationsLoading={loading}
                totalRemaining={totalRemaining}
                loading={paymentLoading}
                onSubmit={handleRegisterPayment}
                buttonLabel="Registrar pago manual"
              />
              {loading ? (
                <div className="py-12 text-center text-gray-400">Cargando...</div>
              ) : transfers.length === 0 ? (
                <div className="py-12 text-center text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                  No hay pagos registrados para este usuario.
                </div>
              ) : (
                <div className="space-y-3">
                {transfers.map((t) => {
                  const inv = invoices.find((i) => i.transfer_id === t.id);
                  const isManual = t.source === "manual" || t.source === "manual_adjustment";
                  const verified = t.verified ?? isManual;

                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border-2 p-4 ${verified ? "border-green-300 bg-green-50/50" : "border-gray-200 bg-white"}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900">S/ {(t.amount ?? 0).toFixed(2)}</p>
                          <p className="text-sm text-gray-500">
                            {formatDate(t.created_at)} {formatTime(t.created_at) ? `· ${formatTime(t.created_at)}` : ""}
                          </p>
                          <p className={`text-xs font-semibold mt-1 ${verified ? "text-green-600" : "text-amber-600"}`}>
                            {verified ? "Validado" : "Pendiente validación"}
                          </p>
                          {inv && (
                            <div className="mt-1 space-y-1">
                              <a
                                href={inv.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline block"
                              >
                                Ver {inv.tipo_comprobante === "factura" ? "factura" : "boleta"} emitida →
                              </a>
                              <button
                                type="button"
                                onClick={() => alert("Esta funcionalidad aún está en desarrollo")}
                                className="text-xs text-gray-500 underline hover:text-gray-700"
                              >
                                {inv.tipo_comprobante === "factura" ? "Anular factura" : "Anular boleta"}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          {t.media_url && (
                            <button
                              type="button"
                              onClick={() => setViewingImage(t.media_url!)}
                              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
                              title="Ver imagen"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                              </svg>
                            </button>
                          )}
                          {!isManual && (
                            <button
                              type="button"
                              onClick={() => handleVerify(t.id, !!verified)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                verified
                                  ? "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600"
                                  : "bg-green-600 text-white hover:bg-green-700"
                              }`}
                            >
                              {verified ? "Deshacer" : "Validar"}
                            </button>
                          )}
                          {!inv && (
                            <button
                              type="button"
                              onClick={() => setEmitTransferTarget(t)}
                              disabled={emittingId === t.id}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                            >
                              {emittingId === t.id ? "..." : "Emitir boleta"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
