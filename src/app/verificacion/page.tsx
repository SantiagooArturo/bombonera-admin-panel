"use client";

import { useState, useEffect } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import {
    Reservation,
    COURT_LABELS,
    STATUS_LABELS,
    Transfer,
    Invoice,
} from "@/lib/types";

export default function VerificacionPage() {
    const store = useStore();
    const toast = useToastContext();
    const reservations = store.getReservations();
    const loaded = store.isLoaded("reservations");

    const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loadingData, setLoadingData] = useState(false);
    const [showModal, setShowModal] = useState(false);

    // Filter states
    const [filterText, setFilterText] = useState("");

    useEffect(() => {
        store.fetchReservations();
    }, [store]);

    // Sort by date (newest first)
    const sortedReservations = [...reservations].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const filteredReservations = sortedReservations.filter((r) => {
        if (filterText) {
            const search = filterText.toLowerCase();
            return (
                r.phone_number?.includes(search) ||
                r.representative_name?.toLowerCase().includes(search) ||
                COURT_LABELS[r.court_type].toLowerCase().includes(search) ||
                r.field?.toString().includes(search)
            );
        }
        return true;
    });

    const handleCloseModal = () => {
        setShowModal(false);
        setTransfers([]);
        setInvoices([]);
        setSelectedReservation(null);
    };

    const handleOpenVerification = async (reservation: Reservation) => {
        setSelectedReservation(reservation);
        setShowModal(true);
        setLoadingData(true);
        try {
            // 1. Sync payments first to ensure amounts are correct
            await store.syncReservationPayments(reservation.id);

            // 2. Fetch fresh data
            const [transfersData, invoicesData] = await Promise.all([
                store.fetchTransfers(reservation.id),
                store.fetchInvoices({ reservation_id: reservation.id })
            ]);

            // 3. Update local state
            setTransfers(transfersData || []);
            setInvoices(invoicesData || []);

            // 4. Recalcular amount_paid sumando todos los pagos aplicados/parciales
            const total = (transfersData || []).reduce((sum: number, t: Transfer) => {
                if (t.status === 'applied' || t.status === 'partial') return sum + (t.amount || 0);
                return sum;
            }, 0);

            setSelectedReservation(prev => prev ? { ...prev, amount_paid: total } : null);

        } catch (error) {
            console.error("Error loading data", error);
            toast("Error al cargar información", "error");
        } finally {
            setLoadingData(false);
        }
    };

    const handleVerifyTransfer = async (transferId: string, currentStatus: boolean) => {
        const success = await store.verifyTransfer(transferId, !currentStatus);
        if (success) {
            setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, verified: !currentStatus, verified_at: new Date().toISOString() } : t));
            toast(currentStatus ? "Verificación removida" : "Transferencia verificada", "success");
        } else {
            toast("Error al actualizar verificación", "error");
        }
    };



    const handleEmitTransferInvoice = async (transfer: Transfer) => {
        if (!selectedReservation) return;

        // Optimistic UI or Loading state could be added here
        const success = await store.emitInvoice(selectedReservation, { id: transfer.id, amount: transfer.amount || 0 });
        if (success) {
            toast("Boleta emitida correctamente", "success");
            const newInvoices = await store.fetchInvoices({ reservation_id: selectedReservation.id });
            setInvoices(newInvoices || []);
        } else {
            toast("Error al emitir boleta", "error");
        }
    };

    const handleRevokeManualPayment = async (transferId: string) => {
        if (!selectedReservation) return;
        if (!confirm("¿Estás seguro de revocar (eliminar) este pago manual? El monto se descontará de la reserva.")) return;

        const result = await store.revokeManualPayment(transferId, selectedReservation.id);
        if (result?.success) {
            toast("Pago manual revocado correctamente", "success");
            // Remove from list locally
            setTransfers(prev => prev.filter(t => t.id !== transferId));
            // Update local reservation amount if possible, or just close modal to force refresh?
            // Ideally we refresh reservation in parent, but for now let's just update the local view if needed.
            if (result.refunded) {
                setSelectedReservation(prev => prev ? {
                    ...prev,
                    amount_paid: Math.max(0, (prev.amount_paid || 0) - result.refunded)
                } : null);
            }
        } else {
            toast("Error al revocar pago", "error");
        }
    };


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
                <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 shadow-sm">
                    <input
                        type="text"
                        placeholder="Buscar por teléfono, nombre o cancha..."
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        className="w-full px-5 py-4 text-lg rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:outline-none bg-gray-50"
                    />
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
                                                {COURT_LABELS[res.court_type].split('(')[0]}
                                                {res.field ? ` #${res.field}` : ''}
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
                                                onClick={() => handleOpenVerification(res)}
                                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl text-base shadow-md transition-transform active:scale-95"
                                            >
                                                Ver Pagos
                                            </button>
                                        </td>
                                        <td className="p-6 text-center">
                                            <span
                                                className={`inline-block px-4 py-2 rounded-lg font-bold text-sm ${res.status === "paid"
                                                    ? "bg-green-100 text-green-700"
                                                    : res.status === "pending"
                                                        ? "bg-amber-100 text-amber-700"
                                                        : "bg-red-100 text-red-700"
                                                    }`}
                                            >
                                                {res.status === "pending" ? "Por Cobrar" : STATUS_LABELS[res.status]}
                                            </span>
                                            {res.confirmed && res.status !== "paid" && (
                                                <span className="ml-2 inline-block px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-bold">
                                                    Parcial
                                                </span>
                                            )}
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

            {/* MODAL DE VERIFICACIÓN */}
            {showModal && selectedReservation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                            <h3 className="text-2xl font-bold text-gray-900">Verificar Comprobantes</h3>
                            <button
                                onClick={handleCloseModal}
                                className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors"
                                aria-label="Cerrar modal"
                            >
                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 bg-gray-100">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* HEADER RESERVA (Full Width en Mobile/Desktop) */}
                                <div className="space-y-6 lg:col-span-2">
                                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                            <div>
                                                <p className="text-gray-500 text-sm">Cliente</p>
                                                <p className="font-bold text-gray-900 text-lg">{selectedReservation.representative_name || "Desconocido"}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500 text-sm">Teléfono</p>
                                                <div className="flex items-center gap-2">
                                                    <a
                                                        href={`https://wa.me/${selectedReservation.phone_number?.startsWith("51") ? selectedReservation.phone_number : `51${selectedReservation.phone_number}`}?text=.`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 hover:bg-green-50 px-2 py-1 rounded-lg transition-colors group"
                                                    >
                                                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
                                                        <span className="font-mono font-bold text-gray-900 text-lg group-hover:text-green-700 group-hover:underline">
                                                            {selectedReservation.phone_number?.startsWith("51")
                                                                ? selectedReservation.phone_number.substring(2)
                                                                : selectedReservation.phone_number}
                                                        </span>
                                                    </a>
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-gray-500 text-sm">Total Reserva</p>
                                                <p className="font-bold text-blue-600 text-xl">S/ {selectedReservation.total_price.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500 text-sm">Falta Pagar</p>
                                                <p className={`font-bold text-xl ${(selectedReservation.total_price - (selectedReservation.amount_paid || 0)) <= 0
                                                    ? "text-green-600"
                                                    : "text-amber-600"
                                                    }`}>
                                                    S/ {Math.max(0, selectedReservation.total_price - (selectedReservation.amount_paid || 0)).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    {/* ALERT: DESFASE CRÍTICO */}
                                    {(() => {
                                        if (loadingData) return null;
                                        const totalVerifiedAmount = transfers.reduce((acc, t) => acc + (t.amount || 0), 0);
                                        const isDiscrepancy = (selectedReservation.amount_paid || 0) > totalVerifiedAmount + 1; // +1 de margen por redondeo

                                        if (isDiscrepancy) {
                                            // Helper para formatear hora (19:00 -> 7 pm)
                                            const formatHour = (h: number) => {
                                                const isPm = (h % 24) >= 12;
                                                const hour12 = h % 12 || 12;
                                                return `${hour12} ${isPm ? 'pm' : 'am'}`;
                                            };

                                            // Calcular rango horario (ej: 7 pm a 8 pm)
                                            const startH = parseInt(selectedReservation.time_slots[0].split(':')[0]);
                                            const endH = parseInt(selectedReservation.time_slots[selectedReservation.time_slots.length - 1].split(':')[0]) + 1;
                                            const timeRange = `${formatHour(startH)} a ${formatHour(endH)}`;

                                            // Formatear cancha (quitar "Campo X")
                                            const courtName = COURT_LABELS[selectedReservation.court_type].split('(')[0].trim();

                                            // Formatear fecha amigable (ej: "el sábado 14 de mayo")
                                            const dateObj = new Date(selectedReservation.date + "T12:00:00");
                                            const dateFriendly = dateObj.toLocaleDateString("es-PE", { weekday: 'long', day: 'numeric', month: 'long' });

                                            const message = `Hola, estamos revisando los pagos de tu reserva del ${dateFriendly} de ${timeRange} en ${courtName} y nos falta verificar un comprobante. Por favor, ¿podrías reenviarnos la captura? Muchas gracias.`;

                                            return (
                                                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl mb-6 shadow-sm">
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex gap-3">
                                                            <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                            </svg>
                                                            <div>
                                                                <h4 className="font-bold text-red-800 text-lg">¡Desfase Crítico Detectado!</h4>
                                                                <p className="text-red-700 text-sm mt-1">
                                                                    La reserva figura como <span className="font-bold">pagada (S/ {selectedReservation.amount_paid})</span>, pero la suma de los pagos registrados es solo <span className="font-bold">S/ {totalVerifiedAmount.toFixed(2)}</span>.
                                                                </p>
                                                                <p className="text-red-600 text-xs mt-2">
                                                                    Esto puede ocurrir si se registró un pago manual sin crear la transferencia correspondiente, o si hubo un error en el chatbot.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        <a
                                                            href={`https://wa.me/${selectedReservation.phone_number?.startsWith("51") ? selectedReservation.phone_number : `51${selectedReservation.phone_number}`}?text=${encodeURIComponent(message)}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="px-4 py-2 bg-red-100 text-red-700 text-sm font-bold rounded-lg hover:bg-red-200 transition-colors flex items-center justify-center gap-2"
                                                        >
                                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
                                                            Contactar
                                                        </a>
                                                    </div>
                                                </div>

                                            );
                                        }
                                        return null;
                                    })()}

                                    <div className="space-y-6 lg:col-span-2">
                                        <div className="space-y-8">
                                            {/* SECTION 1: PAGOS RECIBIDOS */}
                                            <div>
                                                <h4 className="flex items-center justify-between mb-4">
                                                    <span className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                                        <span className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm">1</span>
                                                        Pagos Recibidos
                                                    </span>
                                                    {loadingData && <span className="text-sm text-gray-500 animate-pulse">Actualizando...</span>}
                                                </h4>

                                                {loadingData && transfers.length === 0 ? (
                                                    <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-xl">Cargando pagos...</div>
                                                ) : transfers.length > 0 ? (
                                                    <div className="space-y-4">
                                                        {transfers.map((transfer) => (
                                                            <div key={transfer.id} className={`flex flex-col md:flex-row gap-4 p-5 rounded-2xl border-2 transition-all ${transfer.verified ? 'border-green-500 bg-green-50/20' : 'border-gray-200 bg-white'
                                                                }`}>
                                                                {/* VOUCHER IMAGE / STATUS */}
                                                                <div className="w-full md:w-40 flex-shrink-0">
                                                                    {transfer.media_url ? (
                                                                        <div
                                                                            className="relative group cursor-pointer overflow-hidden rounded-xl border border-gray-200 aspect-[3/4] bg-gray-100"
                                                                            onClick={() => window.open(transfer.media_url!, '_blank')}
                                                                        >
                                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                            <img
                                                                                src={transfer.media_url}
                                                                                alt="Voucher"
                                                                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                                            />
                                                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-end p-2 transition-colors">
                                                                                <span className="text-xs font-bold text-white bg-black/60 px-2 py-1 rounded w-full text-center backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                    Ver Foto
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="h-full min-h-[140px] rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-4 text-center">
                                                                            {transfer.source === 'manual' ? (
                                                                                <>
                                                                                    <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                                                                                    </svg>
                                                                                    <span className="text-xs font-bold text-gray-500">Pago en Caja</span>
                                                                                    <span className="text-[10px] text-gray-400 leading-tight mt-1">(Sin voucher digital)</span>
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <svg className="w-8 h-8 text-amber-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                                                    </svg>
                                                                                    <span className="text-xs font-bold text-gray-500">Sin Imagen</span>
                                                                                    <span className="text-[10px] text-gray-400 leading-tight mt-1">El usuario no adjuntó captura</span>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* INFO & ACTIONS */}
                                                                <div className="flex-1 flex flex-col justify-between py-1">
                                                                    <div className="mb-4">
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <span className="text-2xl font-bold text-gray-900">
                                                                                S/ {transfer.amount?.toFixed(2)}
                                                                            </span>
                                                                            <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wide ${transfer.source === 'manual'
                                                                                ? 'bg-blue-100 text-blue-700'
                                                                                : transfer.verified
                                                                                    ? 'bg-green-100 text-green-700'
                                                                                    : 'bg-gray-100 text-gray-500'
                                                                                }`}>
                                                                                {transfer.source === 'manual'
                                                                                    ? 'Cobrado en Caja'
                                                                                    : transfer.verified
                                                                                        ? 'Transferencia Validada'
                                                                                        : 'Pendiente Revisión'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-sm text-gray-500 flex items-center gap-2">
                                                                            <span>{new Date(transfer.created_at).toLocaleString()}</span>
                                                                            <span>•</span>
                                                                            <span className="capitalize">{transfer.source === 'manual' ? 'Pago Presencial' : 'Transferencia Digital'}</span>
                                                                        </div>
                                                                        {transfer.verified && transfer.verified_at && transfer.source !== 'manual' && (
                                                                            <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
                                                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                                                Validado el {new Date(transfer.verified_at).toLocaleDateString()}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto lg:self-start">
                                                                        {transfer.source !== 'manual' ? (
                                                                            <button
                                                                                onClick={() => handleVerifyTransfer(transfer.id, !!transfer.verified)}
                                                                                className={`w-full py-3 px-4 rounded-xl font-bold text-sm shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${transfer.verified
                                                                                    ? 'bg-white border-2 border-gray-200 text-gray-600 hover:border-red-200 hover:text-red-500'
                                                                                    : 'bg-green-600 text-white hover:bg-green-700 hover:shadow-md'
                                                                                    }`}
                                                                            >
                                                                                {transfer.verified ? (
                                                                                    <>
                                                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                                        Deshacer Validación
                                                                                    </>
                                                                                ) : (
                                                                                    <>
                                                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                                                        Validar Este Pago
                                                                                    </>
                                                                                )}
                                                                            </button>
                                                                        ) : (
                                                                            <button
                                                                                onClick={() => handleRevokeManualPayment(transfer.id)}
                                                                                className="w-full py-3 px-4 rounded-xl font-bold text-sm shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 bg-white border-2 border-red-100 text-red-600 hover:bg-red-50 hover:border-red-200"
                                                                            >
                                                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                                </svg>
                                                                                Eliminar
                                                                            </button>
                                                                        )}

                                                                        {/* Invoice Button */}
                                                                        {(transfer.verified || transfer.source === 'manual') && (
                                                                            (() => {
                                                                                const invoice = invoices.find(inv => inv.transfer_id === transfer.id);
                                                                                return invoice ? (
                                                                                    <button
                                                                                        onClick={() => window.open(invoice.file_url, '_blank')}
                                                                                        className="w-full py-3 px-4 rounded-xl font-bold text-sm shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 bg-blue-50 border-2 border-blue-100 text-blue-700 hover:bg-blue-100"
                                                                                    >
                                                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                                                        Ver Boleta
                                                                                    </button>
                                                                                ) : (
                                                                                    <button
                                                                                        onClick={() => handleEmitTransferInvoice(transfer)}
                                                                                        className="w-full py-3 px-4 rounded-xl font-bold text-sm shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800"
                                                                                    >
                                                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                                                                        Emitir Boleta
                                                                                    </button>
                                                                                );
                                                                            })()
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="p-8 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
                                                        <p className="text-gray-500 font-medium">No hay pagos registrados para esta reserva.</p>
                                                        <p className="text-sm text-gray-400 mt-1">El cliente aún no ha enviado comprobantes.</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* SECTION 2: DOCUMENTOS EMITIDOS */}
                                            <div className="pt-6 border-t border-gray-200">
                                                <h4 className="flex items-center justify-between mb-4">
                                                    <span className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm">2</span>
                                                        Comprobantes Emitidos (Boletas)
                                                    </span>
                                                </h4>

                                                <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden shadow-sm">
                                                    {invoices.length > 0 ? (
                                                        invoices.map((inv) => (
                                                            <div key={inv.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                                                <div>
                                                                    <div className="font-bold text-gray-900 flex items-center gap-2">
                                                                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                                        Boleta de Venta
                                                                    </div>
                                                                    <div className="text-sm text-gray-500 mt-1">
                                                                        Emitida el {new Date(inv.created_at).toLocaleDateString()} por <span className="font-semibold text-gray-700">S/ {inv.amount.toFixed(2)}</span>
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    onClick={() => window.open(inv.file_url, '_blank')}
                                                                    className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold hover:bg-blue-100 flex items-center gap-2 transition-colors"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                                    Descargar PDF
                                                                </button>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="p-6 text-center text-gray-400 italic">
                                                            No se han generado boletas para esta reserva.
                                                        </div>
                                                    )}


                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }
        </ClientLayout >
    );
}
