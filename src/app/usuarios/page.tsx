"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import {
  CLIENT_TYPE_LABELS,
  COURT_LABELS,
  type ClientType,
  type Reservation,
  type PaymentMethod,
} from "@/lib/types";
import PaymentModal from "@/components/PaymentModal";
import ReceiptPopup from "@/components/ReceiptPopup";

// ─── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "reservation_count" | "balance" | "client_type";
type SortDir = "asc" | "desc";

const CLIENT_TYPE_ORDER: (ClientType | "null")[] = [
  "recurrente",
  "indeciso",
  "sospechoso_fraude",
  "null",
];

function clientTypeSortValue(ct: ClientType): number {
  const idx = CLIENT_TYPE_ORDER.indexOf(ct ?? "null");
  return idx >= 0 ? idx : CLIENT_TYPE_ORDER.length;
}

function formatPhone(phone?: string, chatId?: string): string {
  const raw = (phone || chatId?.replace(/@.*$/, "") || "").replace(/\D/g, "");
  if (!raw) return "—";
  const without51 = raw.startsWith("51") && raw.length > 2 ? raw.slice(2) : raw;
  return without51 || "—";
}

function formatSaldo(balance: number): { text: string; variant: "negative" | "zero" | "positive" } {
  if (balance < 0) return { text: "Saldo negativo", variant: "negative" };
  if (balance > 0) return { text: "Saldo positivo", variant: "positive" };
  return { text: "0", variant: "zero" };
}

function clientTypeLabel(clientType: ClientType): string {
  if (!clientType) return "—";
  return CLIENT_TYPE_LABELS[clientType] ?? clientType;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });
}

// ─── Sort Header ────────────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className="px-6 py-4 text-body font-bold text-gray-700">
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600"
          title="Ordenar"
          aria-label={`Ordenar por ${label}`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </span>
    </th>
  );
}

// ─── User Reservations Row ──────────────────────────────────────────────────

function UserReservationsRow({
  userId,
  onPay,
}: {
  userId: string;
  onPay: (reservation: Reservation) => void;
}) {
  const store = useStore();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    store.fetchUserReservations(userId).then((res) => {
      if (!cancelled) {
        // Ordenar: pendientes primero, luego por fecha desc
        const sorted = [...res].sort((a, b) => {
          const statusOrder = { pending: 0, paid: 1, cancelled: 2 };
          const sa = statusOrder[a.status] ?? 9;
          const sb = statusOrder[b.status] ?? 9;
          if (sa !== sb) return sa - sb;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        });
        setReservations(sorted);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [store, userId]);

  if (loading) {
    return (
      <tr>
        <td colSpan={5} className="px-10 py-6 bg-gray-50 text-body text-gray-400">
          Cargando reservas...
        </td>
      </tr>
    );
  }

  if (reservations.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="px-10 py-6 bg-gray-50 text-body text-gray-400">
          Este usuario no tiene reservas
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={5} className="p-0">
        <div className="bg-gray-50 border-t border-gray-200 px-8 py-4">
          <p className="text-body font-bold text-gray-700 mb-3">
            Reservas ({reservations.length})
          </p>
          <div className="space-y-3">
            {reservations.map((res) => {
              const paid = res.amount_paid ?? 0;
              const total = res.total_price ?? 0;
              const remaining = total - paid;
              const canCharge = res.status !== "cancelled" && remaining > 0;

              return (
                <div
                  key={res.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0 ${
                        res.status === "paid"
                          ? "bg-blue-600"
                          : res.status === "pending"
                          ? "bg-amber-500"
                          : "bg-gray-400"
                      }`}
                    >
                      {res.field ? `#${res.field}` : "—"}
                    </div>
                    <div>
                      <p className="text-body font-semibold text-gray-900">
                        {COURT_LABELS[res.court_type] || res.court_type}
                      </p>
                      <p className="text-sm text-gray-500">
                        {formatDate(res.date)} · {res.time_slots?.[0] || "?"} - {
                          res.time_slots?.length > 0
                            ? parseInt(res.time_slots[res.time_slots.length - 1]) + 1
                            : "?"
                        }:00
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-right">
                      <p className="text-body font-bold text-gray-900">S/ {total.toFixed(2)}</p>
                      {paid > 0 && (
                        <p className="text-sm text-blue-600 font-semibold">
                          Pagado: S/ {paid.toFixed(2)}
                        </p>
                      )}
                      {canCharge && (
                        <p className="text-sm text-red-600 font-semibold">
                          Falta: S/ {remaining.toFixed(2)}
                        </p>
                      )}
                    </div>

                    <span
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                        res.status === "paid"
                          ? "bg-blue-100 text-blue-700"
                          : res.status === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {res.status === "paid" ? "Pagado" : res.status === "pending" ? "Pendiente" : "Cancelado"}
                    </span>

                    {canCharge && (
                      <button
                        onClick={() => onPay(res)}
                        className="px-4 py-2 text-body font-bold rounded-xl bg-green-600 text-white hover:bg-green-700 transition-colors"
                      >
                        Cobrar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function UsuariosPage() {
  const store = useStore();
  const toast = useToastContext();
  const users = store.getUsers();
  const loaded = store.isLoaded("users");
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [updatingClientType, setUpdatingClientType] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Modal de pago
  const [payingReservation, setPayingReservation] = useState<Reservation | null>(null);
  const [payingPhoneNumber, setPayingPhoneNumber] = useState<string>("");
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Popup de boleta
  const [showReceiptPopup, setShowReceiptPopup] = useState(false);

  useEffect(() => {
    store.fetchUsers();
  }, [store]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  async function handleToggleAutomation(userId: string, currentValue: boolean, hadNeedsHelp?: boolean) {
    setTogglingId(userId);
    const success = await store.toggleUserAutomation(userId);
    if (success) {
      if (hadNeedsHelp && !currentValue) {
        toast("Problema resuelto", "success");
      } else {
        toast(
          currentValue ? "Bot desactivado" : "Bot activado",
          currentValue ? "info" : "success"
        );
      }
    } else {
      toast("Error al cambiar estado", "error");
    }
    setTogglingId(null);
  }

  async function handleClientTypeChange(userId: string, newType: ClientType) {
    setUpdatingClientType(userId);
    const success = await store.updateUserClientType(userId, newType);
    if (success) {
      const label = newType ? CLIENT_TYPE_LABELS[newType] ?? newType : "Nuevo";
      toast(`Tipo actualizado: ${label}`, "success");
    } else {
      toast("Error al actualizar tipo de cliente", "error");
    }
    setUpdatingClientType(null);
  }

  function handleStartPayment(reservation: Reservation, phoneNumber: string) {
    setPayingReservation(reservation);
    setPayingPhoneNumber(phoneNumber);
  }

  async function handleConfirmPayment(amount: number, paymentMethod: PaymentMethod, mediaUrl?: string) {
    if (!payingReservation) return;
    setPaymentLoading(true);
    const result = await store.processManualPayment(
      payingReservation.id,
      amount,
      payingPhoneNumber,
      paymentMethod,
      mediaUrl,
    );
    setPaymentLoading(false);

    if (result?.success) {
      toast(
        result.fully_paid
          ? `Pago completo registrado (S/ ${amount.toFixed(2)})`
          : `Pago parcial registrado (S/ ${amount.toFixed(2)})`,
        "success"
      );
      setPayingReservation(null);
      // Refrescar las reservas del usuario expandido
      setExpandedUserId((prev) => {
        const id = prev;
        // Forzar re-render cerrando y abriendo
        setTimeout(() => setExpandedUserId(id), 50);
        return null;
      });
      // Mostrar popup de boleta
      setShowReceiptPopup(true);
    } else {
      toast("Error al procesar el pago", "error");
    }
  }

  const handleReceiptYes = useCallback(() => {
    // TODO: integrar con la función de emitir boleta cuando esté lista
    toast("Función de boleta aún no disponible. Podrás emitirla más tarde.", "info");
    setShowReceiptPopup(false);
  }, [toast]);

  const handleReceiptNo = useCallback(() => {
    setShowReceiptPopup(false);
  }, []);

  // Filtrado por búsqueda
  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const term = search.replace(/\D/g, "");
    if (!term) return users;
    return users.filter((u) => {
      const phone = (u.phone_number || u.chat_id || "").replace(/\D/g, "");
      return phone.includes(term);
    });
  }, [users, search]);

  const sortedUsers = useMemo(() => {
    if (!sortBy) return filteredUsers;
    const list = [...filteredUsers];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "reservation_count") {
        cmp = a.reservation_count - b.reservation_count;
      } else if (sortBy === "balance") {
        cmp = a.balance - b.balance;
      } else {
        cmp = clientTypeSortValue(a.client_type) - clientTypeSortValue(b.client_type);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredUsers, sortBy, sortDir]);

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Usuarios</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Busca un usuario por número de WhatsApp para ver sus reservas y cobrar pagos
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
              placeholder="Buscar por número de WhatsApp..."
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

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">Cargando usuarios...</div>
          </div>
        ) : (
          <>
            <p className="text-body text-gray-500 mb-4 font-medium">
              {sortedUsers.length} usuario{sortedUsers.length !== 1 ? "s" : ""}{" "}
              {search ? "encontrado" : ""}{sortedUsers.length !== 1 && search ? "s" : ""}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80">
                    <th className="px-6 py-4 text-body font-bold text-gray-700">WhatsApp</th>
                    <SortHeader label="Reservas" sortKey="reservation_count" onSort={handleSort} />
                    <SortHeader label="Saldo" sortKey="balance" onSort={handleSort} />
                    <SortHeader label="Tipo de cliente" sortKey="client_type" onSort={handleSort} />
                    <th className="px-6 py-4 text-body font-bold text-gray-700">Bot</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-body-lg text-gray-400">
                        {search ? "No se encontraron usuarios con ese número" : "No hay usuarios en la colección"}
                      </td>
                    </tr>
                  ) : (
                    sortedUsers.map((user) => {
                      const saldo = formatSaldo(user.balance);
                      const needsHelp = user.needs_help ?? false;
                      const isExpanded = expandedUserId === user.id;
                      return (
                        <>
                          <tr
                            key={user.id}
                            onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                            className={`border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${
                              needsHelp
                                ? "bg-red-50 hover:bg-red-100/60"
                                : isExpanded
                                ? "bg-bombonera-50"
                                : "hover:bg-gray-50/50"
                            }`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-2 text-body font-semibold text-gray-900">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#25D366]" aria-hidden>
                                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="currentColor">
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                    </svg>
                                  </span>
                                  {formatPhone(user.phone_number, user.chat_id)}
                                  <svg
                                    className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </span>
                                {needsHelp && (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-1 rounded-md"
                                    title={user.help_reason || "Requiere atención"}
                                  >
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    Necesita ayuda
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-body text-gray-700">{user.reservation_count}</td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex px-4 py-2.5 rounded-xl text-body font-bold ${
                                  saldo.variant === "negative"
                                    ? "bg-red-500 text-white"
                                    : saldo.variant === "positive"
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {saldo.text}
                                {user.balance !== 0 && (
                                  <span className={saldo.variant === "negative" ? "ml-1 opacity-95" : "ml-1"}>
                                    (S/ {Math.abs(user.balance).toFixed(2)})
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <select
                                value={user.client_type ?? ""}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const val = e.target.value || null;
                                  handleClientTypeChange(user.id, val as ClientType);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                disabled={updatingClientType === user.id}
                                className={`px-3 py-1.5 rounded-lg text-body font-medium border-2 cursor-pointer transition-colors ${
                                  user.client_type === "sospechoso_fraude"
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : user.client_type === "recurrente"
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : user.client_type === "indeciso"
                                    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                    : "bg-gray-50 text-gray-600 border-gray-200"
                                } disabled:opacity-50`}
                              >
                                <option value="">Nuevo</option>
                                <option value="recurrente">Recurrente</option>
                                <option value="indeciso">Indeciso</option>
                                <option value="sospechoso_fraude">Peligro de fraude</option>
                              </select>
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleAutomation(user.id, user.is_automated ?? true, needsHelp);
                                }}
                                disabled={togglingId === user.id}
                                className={`px-4 py-2 rounded-lg text-body font-semibold transition-colors ${
                                  needsHelp
                                    ? "bg-red-600 text-white hover:bg-red-700"
                                    : (user.is_automated ?? true)
                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                } disabled:opacity-50`}
                              >
                                {togglingId === user.id
                                  ? "..."
                                  : needsHelp
                                  ? "Resolver"
                                  : (user.is_automated ?? true)
                                  ? "Activado"
                                  : "Desactivado"}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <UserReservationsRow
                              key={`reservations-${user.id}`}
                              userId={user.id}
                              onPay={(res) => handleStartPayment(res, user.id)}
                            />
                          )}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal de pago */}
      {payingReservation && (
        <PaymentModal
          reservation={payingReservation}
          onConfirm={handleConfirmPayment}
          onCancel={() => setPayingReservation(null)}
          loading={paymentLoading}
        />
      )}

      {/* Popup de boleta */}
      {showReceiptPopup && (
        <ReceiptPopup
          onYes={handleReceiptYes}
          onNo={handleReceiptNo}
        />
      )}
    </ClientLayout>
  );
}
