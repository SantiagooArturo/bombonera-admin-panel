"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ClientLayout from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { COURT_LABELS, STATUS_LABELS } from "@/lib/types";
import PaymentSidebar from "@/components/verificacion/PaymentSidebar";
import { usePaymentSidebar } from "@/components/verificacion/usePaymentSidebar";

export default function VerificacionPage() {
    return (
        <Suspense>
            <VerificacionContent />
        </Suspense>
    );
}

function VerificacionContent() {
    const store = useStore();
    const searchParams = useSearchParams();
    const reservations = store.getReservations();
    const loaded = store.isLoaded("reservations");

    const sidebar = usePaymentSidebar();

    const [filterText, setFilterText] = useState(searchParams.get("search") ?? "");
    type FilterStatus = "all" | "receivable" | "unverified" | "cancelled";
    const searchStatus = searchParams.get("status");
    const initialStatus: FilterStatus =
        searchStatus === "pending" || searchStatus === "receivable"
            ? "receivable"
            : searchStatus === "unverified" || searchStatus === "cancelled"
                ? (searchStatus as FilterStatus)
                : "all";
    const [filterStatus, setFilterStatus] = useState<FilterStatus>(initialStatus);
    const [unverifiedResIds, setUnverifiedResIds] = useState<Set<string>>(new Set());
    const [autoOpenHandled, setAutoOpenHandled] = useState(false);

    useEffect(() => {
        store.fetchReservations();
        fetch("/api/dashboard")
            .then((r) => r.json())
            .then((data) => setUnverifiedResIds(new Set(data.unverifiedReservationIds || [])))
            .catch(() => {});
    }, [store]);

    useEffect(() => {
        if (autoOpenHandled || !loaded) return;
        const resId = searchParams.get("reservation_id");
        if (resId) {
            const target = reservations.find((r) => r.id === resId);
            if (target) {
                sidebar.open(target);
                setAutoOpenHandled(true);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, reservations, autoOpenHandled, searchParams]);

    const sortedReservations = [...reservations].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const filteredReservations = sortedReservations.filter((r) => {
        const hasDebt = (r.amount_paid ?? 0) < (r.total_price || 0);
        if (filterStatus === "receivable") {
            if (!hasDebt) return false;
            if (r.status === "cancelled" || r.status === "expired") return false;
        } else if (filterStatus === "unverified") {
            if (!unverifiedResIds.has(r.id)) return false;
        } else if (filterStatus !== "all" && r.status !== filterStatus) {
            return false;
        }
        if (filterText) {
            const search = filterText.toLowerCase();
            return (
                r.phone_number?.includes(search) ||
                r.representative_name?.toLowerCase().includes(search) ||
                (COURT_LABELS[r.court_type as keyof typeof COURT_LABELS] ?? r.court_type).toLowerCase().includes(search) ||
                r.field?.toString().includes(search)
            );
        }
        return true;
    });

    return (
        <ClientLayout>
            <div className="p-6 md:p-10 max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">
                        Verificación de Pagos
                    </h1>
                    <p className="text-lg text-gray-500 mt-2">
                        Revisa los comprobantes y valida las reservas para evitar fraudes.
                    </p>
                </div>

                {/* Search / Filter */}
                <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 shadow-sm space-y-4">
                    <input
                        type="text"
                        placeholder="Buscar por teléfono, nombre o cancha..."
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        className="w-full px-5 py-4 text-lg rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none bg-gray-50"
                    />
                    <div className="flex gap-2 flex-wrap">
                        {([
                            { value: "all" as const, label: "Todos" },
                            { value: "receivable" as const, label: "Por Cobrar" },
                            { value: "unverified" as const, label: "Por Validar" },
                            { value: "cancelled" as const, label: "Cancelado" },
                        ]).map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setFilterStatus(opt.value)}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                                    filterStatus === opt.value
                                        ? opt.value === "unverified"
                                            ? "bg-purple-100 text-purple-700 border-2 border-purple-300"
                                            : opt.value === "receivable"
                                                ? "bg-amber-100 text-amber-700 border-2 border-amber-300"
                                                : opt.value === "cancelled"
                                                    ? "bg-red-100 text-red-700 border-2 border-red-300"
                                                    : "bg-blue-100 text-blue-700 border-2 border-blue-300"
                                        : "bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200"
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {!loaded ? (
                    <div className="text-center py-20 text-gray-400 text-xl">Cargando...</div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="p-6 text-gray-600 font-bold text-lg">Reserva</th>
                                    <th className="p-6 text-gray-600 font-bold text-lg">Cliente</th>
                                    <th className="p-6 text-gray-600 font-bold text-lg">Pagos</th>
                                    <th className="p-6 text-gray-600 font-bold text-lg text-center">Comprobante</th>
                                    <th className="p-6 text-gray-600 font-bold text-lg text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredReservations.map((res) => (
                                    <tr key={res.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                        <td className="p-6">
                                            <div className="font-bold text-xl text-gray-900">
                                                {res.field ? `Cancha ${res.field}` : (COURT_LABELS[res.court_type as keyof typeof COURT_LABELS] ?? res.court_type).split('(')[0].trim()}
                                            </div>
                                            <div className="text-gray-500 mt-1 text-base">
                                                {new Date(res.date + "T12:00:00").toLocaleDateString("es-PE", {
                                                    weekday: "short", day: "numeric", month: "long"
                                                })}
                                            </div>
                                            <div className="text-gray-500 font-medium">
                                                {(() => {
                                                    const startH = parseInt(res.time_slots[0].split(':')[0]);
                                                    const endH = parseInt(res.time_slots[res.time_slots.length - 1].split(':')[0]) + 1;
                                                    const formatHour = (h: number) => {
                                                        const isPm = (h % 24) >= 12;
                                                        const hour12 = h % 12 || 12;
                                                        return `${hour12} ${isPm ? 'pm' : 'am'}`;
                                                    };
                                                    return `${formatHour(startH)} - ${formatHour(endH)}`;
                                                })()}
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="font-semibold text-lg text-gray-800">
                                                {res.representative_name || "Sin nombre"}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <a
                                                    href={`https://wa.me/${res.phone_number?.startsWith("51") ? res.phone_number : `51${res.phone_number}`}?text=.`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 hover:bg-green-50 px-2 py-1 rounded-lg transition-colors group"
                                                    title="Abrir chat de WhatsApp"
                                                >
                                                    <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                                                    </svg>
                                                    <span className="text-gray-500 text-base font-mono group-hover:text-green-700 group-hover:underline">
                                                        {res.phone_number?.startsWith("51") ? res.phone_number.substring(2) : res.phone_number}
                                                    </span>
                                                </a>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-gray-500">Total: <span className="font-bold text-gray-900">S/ {res.total_price}</span></span>
                                                <span className={`${(res.amount_paid || 0) >= res.total_price ? 'text-green-600' : 'text-amber-600'} font-semibold`}>
                                                    Pagado: S/ {res.amount_paid || 0}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-6 text-center">
                                            <button
                                                onClick={() => sidebar.open(res)}
                                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl text-base shadow-md transition-transform active:scale-95"
                                            >
                                                Ver Pagos
                                            </button>
                                        </td>
                                        <td className="p-6 text-center">
                                            <span
                                                className={`inline-block px-4 py-2 rounded-lg font-bold text-sm ${res.status === "confirmed"
                                                    ? "bg-green-100 text-green-700"
                                                    : res.status === "pending"
                                                        ? "bg-amber-100 text-amber-700"
                                                        : "bg-red-100 text-red-700"
                                                    }`}
                                            >
                                                {STATUS_LABELS[res.status]}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filteredReservations.length === 0 && (
                            <div className="p-12 text-center text-gray-400 text-lg">
                                No se encontraron reservas.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {sidebar.isOpen && sidebar.selectedReservation && (
                <PaymentSidebar
                    reservation={sidebar.selectedReservation}
                    transfers={sidebar.transfers}
                    invoices={sidebar.invoices}
                    loading={sidebar.loadingData}
                    emittingInvoiceId={sidebar.emittingInvoiceId}
                    paymentLoading={sidebar.paymentLoading}
                    onVerifyTransfer={sidebar.handleVerifyTransfer}
                    onEmitInvoice={sidebar.handleEmitInvoice}
                    onAttachInvoice={sidebar.handleAttachInvoice}
                    onDetachInvoice={sidebar.handleDetachInvoice}
                    onUpdateDni={sidebar.handleUpdateDni}
                    onCancelReservation={sidebar.handleCancelReservation}
                    cancellingReservation={sidebar.cancellingReservation}
                    onRevokeManualPayment={sidebar.handleRevokeManualPayment}
                    onRegisterPayment={sidebar.handleRegisterPayment}
                    onClose={sidebar.close}
                />
            )}
        </ClientLayout>
    );
}
