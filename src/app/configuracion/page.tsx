"use client";

import { useState, useEffect, useMemo } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { COURT_LABELS, type Reservation, type Invoice } from "@/lib/types";

function formatPhone(phone?: string, chatId?: string): string {
  const raw = (phone || chatId?.replace(/@.*$/, "") || "").replace(/\D/g, "");
  if (!raw) return "—";
  const without51 = raw.startsWith("51") && raw.length > 2 ? raw.slice(2) : raw;
  return without51 || "—";
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-PE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function ConfiguracionPage() {
  const store = useStore();
  const toast = useToastContext();

  // Tab state
  const [activeTab, setActiveTab] = useState<"automatizacion" | "facturacion">("automatizacion");

  // Automation state
  const users = store.getUsers();
  const loaded = store.isLoaded("users");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Billing state
  const reservations = store.getReservations();
  const reservationsLoaded = store.isLoaded("reservations");

  // Invoice data
  const invoices = store.getInvoices();

  // Build lookup: reservation_id → Invoice
  const invoicesMap = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const inv of invoices) {
      map.set(inv.reservation_id, inv);
    }
    return map;
  }, [invoices]);

  useEffect(() => {
    store.fetchUsers();
    store.fetchReservations();
    store.fetchInvoices();
  }, [store]);

  // Automation derived data
  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const term = search.replace(/\D/g, "");
    if (!term) return users;
    return users.filter((u) => {
      const phone = (u.phone_number || u.chat_id || "").replace(/\D/g, "");
      return phone.includes(term);
    });
  }, [users, search]);

  const automatedCount = users.filter((u) => u.is_automated ?? true).length;
  const manualCount = users.filter((u) => !(u.is_automated ?? true)).length;

  // Billing derived data
  const paidReservations = useMemo(() => {
    return reservations
      .filter((r) => r.status === "paid" || (r.amount_paid ?? 0) >= r.total_price)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [reservations]);

  // Invoice modal state
  const [invoiceModal, setInvoiceModal] = useState<{
    step: "loading" | "preview";
    reservation: Reservation;
    fileUrl?: string;
    invoiceId?: string;
  } | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState(false);

  async function handleEmitInvoice(reservation: Reservation) {
    setInvoiceModal({ step: "loading", reservation });
    const result = await store.emitInvoice(reservation);
    if (result) {
      setInvoiceModal({
        step: "preview",
        reservation,
        fileUrl: result.file_url,
        invoiceId: result.invoice_id,
      });
    } else {
      toast("Error al generar la boleta", "error");
      setInvoiceModal(null);
    }
  }

  function handleViewInvoice(reservation: Reservation, invoice: Invoice) {
    setInvoiceModal({
      step: "preview",
      reservation,
      fileUrl: invoice.file_url,
      invoiceId: invoice.id,
    });
  }

  async function handleCopyLink(fileUrl: string) {
    try {
      await navigator.clipboard.writeText(fileUrl);
      toast("Enlace copiado al portapapeles", "success");
    } catch {
      toast("Error al copiar enlace", "error");
    }
  }

  async function handleSendInvoiceWhatsApp() {
    if (!invoiceModal?.fileUrl || !invoiceModal.reservation.chat_id) return;
    setSendingInvoice(true);
    const success = await store.sendInvoiceWhatsApp(
      invoiceModal.reservation.chat_id,
      invoiceModal.fileUrl
    );
    if (success) {
      toast("Boleta enviada por WhatsApp", "success");
      setInvoiceModal(null);
    } else {
      toast("Error al enviar boleta por WhatsApp", "error");
    }
    setSendingInvoice(false);
  }

  async function handleToggle(userId: string, currentValue: boolean) {
    setTogglingId(userId);
    const success = await store.toggleUserAutomation(userId);
    if (success) {
      toast(
        currentValue ? "Bot desactivado para este número" : "Bot activado para este número",
        currentValue ? "info" : "success"
      );
    } else {
      toast("Error al cambiar automatización", "error");
    }
    setTogglingId(null);
  }

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Configuración</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Automatización del bot y facturación de reservas
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b-2 border-gray-200 mb-8">
          <button
            onClick={() => setActiveTab("automatizacion")}
            className={`px-6 py-4 text-body-lg font-bold transition-colors -mb-[2px] ${
              activeTab === "automatizacion"
                ? "text-bombonera-700 border-b-[3px] border-bombonera-500"
                : "text-gray-400 border-b-[3px] border-transparent hover:text-gray-600"
            }`}
          >
            Automatización
          </button>
          <button
            onClick={() => setActiveTab("facturacion")}
            className={`px-6 py-4 text-body-lg font-bold transition-colors -mb-[2px] ${
              activeTab === "facturacion"
                ? "text-bombonera-700 border-b-[3px] border-bombonera-500"
                : "text-gray-400 border-b-[3px] border-transparent hover:text-gray-600"
            }`}
          >
            Facturación
          </button>
        </div>

        {/* ═══ Tab: Automatización ═══ */}
        {activeTab === "automatizacion" && (
          <>
            {!loaded ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-body-lg text-gray-400 font-medium">Cargando configuración...</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-5 mb-8">
                  <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6">
                    <p className="text-display font-bold text-green-700">{automatedCount}</p>
                    <p className="text-body font-medium text-green-600 mt-1">Bot Activo</p>
                  </div>
                  <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-6">
                    <p className="text-display font-bold text-orange-700">{manualCount}</p>
                    <p className="text-body font-medium text-orange-600 mt-1">Modo Manual</p>
                  </div>
                </div>

                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 mb-8">
                  <p className="text-body-lg text-blue-800 font-medium">
                    <strong>Bot Activo:</strong> El bot de WhatsApp responde automáticamente al cliente.
                  </p>
                  <p className="text-body-lg text-blue-800 font-medium mt-2">
                    <strong>Modo Manual:</strong> El bot NO responde. Usted debe responder manualmente al cliente.
                  </p>
                </div>

                {/* Buscador */}
                <div className="mb-6">
                  <div className="relative max-w-md">
                    <svg
                      className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Buscar por número..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-12 pr-5 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-white shadow-sm"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm text-left">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/80">
                        <th className="px-6 py-4 text-body font-bold text-gray-700">WhatsApp</th>
                        <th className="px-6 py-4 text-body font-bold text-gray-700">Estado</th>
                        <th className="px-6 py-4 text-body font-bold text-gray-700 text-right">Bot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-body-lg text-gray-400">
                            {search ? "No se encontraron usuarios con ese número" : "No hay usuarios registrados"}
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const isAutomated = user.is_automated ?? true;
                          const isToggling = togglingId === user.id;

                          return (
                            <tr
                              key={user.id}
                              className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors"
                            >
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center gap-2 text-body font-semibold text-gray-900">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#25D366]" aria-hidden>
                                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="currentColor">
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                    </svg>
                                  </span>
                                  {formatPhone(user.phone_number, user.chat_id)}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex px-3 py-1.5 rounded-lg text-body font-semibold ${
                                    isAutomated
                                      ? "bg-green-100 text-green-700"
                                      : "bg-orange-100 text-orange-700"
                                  }`}
                                >
                                  {isAutomated ? "Bot Activo" : "Modo Manual"}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={() => handleToggle(user.id, isAutomated)}
                                  disabled={isToggling}
                                  className="relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50"
                                  style={{ backgroundColor: isAutomated ? "#16a34a" : "#d1d5db" }}
                                  role="switch"
                                  aria-checked={isAutomated}
                                >
                                  <span
                                    className="pointer-events-none inline-block h-7 w-7 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                                    style={{ transform: isAutomated ? "translateX(1.5rem)" : "translateX(0)" }}
                                  />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ Tab: Facturación ═══ */}
        {activeTab === "facturacion" && (
          <>
            {!reservationsLoaded ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-body-lg text-gray-400 font-medium">Cargando reservas...</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-5 mb-8">
                  <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6">
                    <p className="text-display font-bold text-green-700">{paidReservations.length}</p>
                    <p className="text-body font-medium text-green-600 mt-1">Reservas Pagadas</p>
                  </div>
                  <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6">
                    <p className="text-display font-bold text-blue-700">
                      S/ {paidReservations.reduce((sum, r) => sum + r.total_price, 0).toFixed(2)}
                    </p>
                    <p className="text-body font-medium text-blue-600 mt-1">Total Facturado</p>
                  </div>
                </div>

                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 mb-8">
                  <p className="text-body-lg text-blue-800 font-medium">
                    <strong>Facturación:</strong> Reservas pagadas al 100%. Desde aquí podrás emitir boletas cuando la integración esté disponible.
                  </p>
                </div>

                <p className="text-body text-gray-500 mb-4 font-medium">
                  {paidReservations.length} reserva{paidReservations.length !== 1 ? "s" : ""} pagada{paidReservations.length !== 1 ? "s" : ""}
                </p>

                <div className="space-y-4">
                  {paidReservations.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
                      <p className="text-body-lg text-gray-400">
                        No hay reservas completamente pagadas
                      </p>
                    </div>
                  ) : (
                    paidReservations.map((res) => (
                      <div key={res.id} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                          <div className="flex items-start gap-4">
                            <div className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0 bg-blue-600">
                              {res.field ? `#${res.field}` : "—"}
                            </div>
                            <div>
                              <p className="text-body-lg font-bold text-gray-900">
                                {COURT_LABELS[res.court_type] || res.court_type}
                                {res.field ? ` — Campo ${res.field}` : ""}
                              </p>
                              <p className="text-body text-gray-600 mt-1">
                                {formatDate(res.date)} · {res.time_slots?.[0] || "?"} -{" "}
                                {res.time_slots?.length > 0
                                  ? parseInt(res.time_slots[res.time_slots.length - 1]) + 1
                                  : "?"}
                                :00
                              </p>
                              <div className="flex items-center gap-4 mt-2 flex-wrap">
                                {res.phone_number && (
                                  <span className="text-body text-gray-500">
                                    Tel: <span className="font-semibold text-gray-700">{res.phone_number}</span>
                                  </span>
                                )}
                                {res.representative_name && (
                                  <span className="text-body text-gray-500">
                                    Resp: <span className="font-semibold text-gray-700">{res.representative_name}</span>
                                  </span>
                                )}
                                <span className="text-body font-bold text-bombonera-700">
                                  S/ {(res.total_price || 0).toFixed(2)}
                                </span>
                                <span className="text-body font-semibold px-2 py-0.5 rounded bg-green-100 text-green-700">
                                  Pagado: S/ {(res.amount_paid ?? 0).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="px-5 py-3 rounded-xl text-body font-bold bg-green-100 text-green-700">
                              Pagado
                            </span>
                            {invoicesMap.has(res.id) ? (
                              <>
                                <button
                                  onClick={() => handleViewInvoice(res, invoicesMap.get(res.id)!)}
                                  className="px-5 py-3 text-body font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors min-h-[48px]"
                                >
                                  Ver Boleta
                                </button>
                                <button
                                  onClick={() => handleCopyLink(invoicesMap.get(res.id)!.file_url)}
                                  className="px-5 py-3 text-body font-bold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors min-h-[48px]"
                                  title="Copiar enlace PDF"
                                >
                                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => {
                                    setInvoiceModal({
                                      step: "preview",
                                      reservation: res,
                                      fileUrl: invoicesMap.get(res.id)!.file_url,
                                      invoiceId: invoicesMap.get(res.id)!.id,
                                    });
                                  }}
                                  className="px-5 py-3 text-body font-bold rounded-xl bg-[#25D366] text-white hover:bg-[#1da851] transition-colors min-h-[48px] flex items-center gap-2"
                                  title="Enviar por WhatsApp"
                                >
                                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleEmitInvoice(res)}
                                className="px-5 py-3 text-body font-bold rounded-xl bg-bombonera-600 text-white hover:bg-bombonera-700 transition-colors min-h-[48px]"
                              >
                                Emitir Boleta
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Modal de Boleta */}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            {invoiceModal.step === "loading" ? (
              <div className="flex flex-col items-center justify-center py-20 px-8">
                <div className="w-12 h-12 border-4 border-gray-200 border-t-bombonera-500 rounded-full animate-spin mb-6" />
                <p className="text-heading font-bold text-gray-900">Generando boleta...</p>
                <p className="text-body text-gray-500 mt-2">Esto puede tomar unos segundos</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                  <div>
                    <h3 className="text-heading font-bold text-gray-900">Boleta de Pago</h3>
                    <p className="text-body text-gray-500 mt-1">
                      {COURT_LABELS[invoiceModal.reservation.court_type] || invoiceModal.reservation.court_type}
                      {" — "}
                      {formatDate(invoiceModal.reservation.date)}
                      {" — "}
                      S/ {(invoiceModal.reservation.total_price || 0).toFixed(2)}
                    </p>
                  </div>
                  <button
                    onClick={() => setInvoiceModal(null)}
                    className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex-1 min-h-0 p-6">
                  <iframe
                    src={invoiceModal.fileUrl}
                    className="w-full h-[50vh] rounded-xl border border-gray-200"
                    title="Boleta PDF"
                  />
                </div>

                <div className="flex gap-4 p-6 border-t border-gray-200">
                  <button
                    onClick={() => setInvoiceModal(null)}
                    className="px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={() => invoiceModal.fileUrl && handleCopyLink(invoiceModal.fileUrl)}
                    className="px-6 py-4 text-body font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Copiar enlace
                  </button>
                  <button
                    onClick={handleSendInvoiceWhatsApp}
                    disabled={sendingInvoice}
                    className="flex-1 px-6 py-4 text-body font-semibold rounded-xl bg-[#25D366] text-white hover:bg-[#1da851] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {sendingInvoice ? (
                      "Enviando..."
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        Enviar Boleta por WhatsApp
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </ClientLayout>
  );
}
