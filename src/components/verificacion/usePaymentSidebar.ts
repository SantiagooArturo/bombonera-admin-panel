"use client";

import { useState, useCallback, useRef } from "react";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import type { Reservation, Transfer, Invoice, PaymentMethod, ClientType } from "@/lib/types";

interface UsePaymentSidebarOptions {
  onReservationUpdated?: (resId: string, patch: Partial<Reservation>) => void;
  onReservationDeleted?: (resId: string) => void;
}

export function usePaymentSidebar(options?: UsePaymentSidebarOptions) {
  const store = useStore();
  const toast = useToastContext();

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [allReservationsThisWeek, setAllReservationsThisWeek] = useState<Reservation[]>([]);
  const allReservationsChatIdRef = useRef<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [emittingInvoiceId, setEmittingInvoiceId] = useState<string | null>(null);
  const [attachingInvoiceId, setAttachingInvoiceId] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [cancellingReservation, setCancellingReservation] = useState(false);
  const [clientType, setClientType] = useState<ClientType>("casual");
  const [clientTypeLoading, setClientTypeLoading] = useState(false);
  const [clientTypeUpdating, setClientTypeUpdating] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [userNames, setUserNames] = useState<{
    custom_name?: string;
    contact_name?: string;
    push_name?: string;
  }>({});

  const isOpen = selectedReservation !== null;

  const open = useCallback(async (reservation: Reservation) => {
    const nextChatId = String(reservation.chat_id || reservation.phone_number || "").replace(/\D/g, "");
    if (allReservationsChatIdRef.current && allReservationsChatIdRef.current !== nextChatId) {
      setAllReservationsThisWeek([]);
      allReservationsChatIdRef.current = null;
    }
    setSelectedReservation(reservation);
    setLoadingData(true);
    setClientTypeLoading(true);
    try {
      await store.syncReservationPayments(reservation.id);

      const normalizedChatId = String(reservation.chat_id || "").replace(/\D/g, "");
      const chatIdForApi = reservation.chat_id || normalizedChatId || reservation.phone_number;
      const [transfersData, invoicesData, freshResReq, clientTypeRes, clientReservationsRes] = await Promise.all([
        store.fetchTransfers(reservation.id),
        store.fetchInvoices({ reservation_id: reservation.id }),
        fetch(`/api/reservations?id=${reservation.id}`),
        fetch(`/api/users/client-type?chat_id=${encodeURIComponent(normalizedChatId)}`, { cache: "no-store" }),
        chatIdForApi ? fetch(`/api/reservations?phone_number=${encodeURIComponent(String(chatIdForApi))}`) : Promise.resolve(new Response("[]")),
      ]);
      setTransfers(transfersData || []);
      setInvoices(invoicesData || []);

      let freshReservation = reservation;
      if (freshResReq.ok) {
        const parsed = await freshResReq.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          freshReservation = parsed[0];
        }
      }

      const total = (transfersData || []).reduce((sum: number, t: Transfer) => {
        if (t.status === "applied" || t.status === "partial") return sum + (t.amount || 0);
        return sum;
      }, 0);
      const amountPaid = (freshReservation as { amount_paid_manual?: boolean }).amount_paid_manual
        ? (freshReservation.amount_paid ?? 0)
        : total;
      setSelectedReservation({ ...freshReservation, amount_paid: amountPaid });

      if (clientTypeRes.ok) {
        const clientTypeData = await clientTypeRes.json();
        const nextType = clientTypeData?.client_type;
        const isValid =
          nextType === "casual" || nextType === "recurrente" || nextType === "sospechoso_fraude";
        setClientType(isValid ? nextType : "casual");
        setUserNames({
          custom_name: clientTypeData?.custom_name,
          contact_name: clientTypeData?.contact_name,
          push_name: clientTypeData?.push_name,
        });
      } else {
        setClientType("casual");
        setUserNames({});
      }

      if (clientReservationsRes?.ok) {
        const allClientRes = await clientReservationsRes.json();
        const resDate = new Date(reservation.date + "T12:00:00");
        const day = resDate.getDay();
        const diffToMon = day === 0 ? -6 : 1 - day;
        const mon = new Date(resDate);
        mon.setDate(mon.getDate() + diffToMon);
        const sun = new Date(mon);
        sun.setDate(sun.getDate() + 6);
        const weekStart = mon.toISOString().slice(0, 10);
        const weekEnd = sun.toISOString().slice(0, 10);
        const full = (Array.isArray(allClientRes) ? allClientRes : [])
          .filter((r: Reservation) => r.date >= weekStart && r.date <= weekEnd && r.status !== "cancelled" && r.status !== "expired")
          .sort((a: Reservation, b: Reservation) => {
            const cmp = (a.date || "").localeCompare(b.date || "");
            if (cmp !== 0) return cmp;
            const aStart = a.time_slots?.[0] || "";
            const bStart = b.time_slots?.[0] || "";
            return aStart.localeCompare(bStart);
          });
        setAllReservationsThisWeek(full);
        allReservationsChatIdRef.current = String(chatIdForApi || "").replace(/\D/g, "");
      } else {
        setAllReservationsThisWeek([]);
        allReservationsChatIdRef.current = null;
      }
    } catch (error) {
      console.error("Error loading sidebar data", error);
      toast("Error al cargar información", "error");
      setClientType("casual");
    } finally {
      setLoadingData(false);
      setClientTypeLoading(false);
    }
  }, [store, toast]);

  const close = useCallback(() => {
    setSelectedReservation(null);
    setAllReservationsThisWeek([]);
    allReservationsChatIdRef.current = null;
    setTransfers([]);
    setInvoices([]);
    setClientType("casual");
    setClientTypeLoading(false);
    setClientTypeUpdating(false);
    setUserNames({});
  }, []);

  const handleUpdateClientType = useCallback(async (nextType: ClientType) => {
    if (!selectedReservation) return false;
    const prevType = clientType;
    setClientType(nextType);
    setClientTypeUpdating(true);

    const normalizedChatId = String(selectedReservation.chat_id || "").replace(/\D/g, "");
    const ok = await store.updateUserClientType(normalizedChatId, nextType);

    setClientTypeUpdating(false);
    if (!ok) {
      setClientType(prevType);
      toast("No se pudo actualizar tipo de cliente", "error");
      return false;
    }
    toast("Tipo de cliente actualizado", "success");
    return true;
  }, [selectedReservation, clientType, store, toast]);

  const handleUpdateStatus = useCallback(async (nextStatus: "pending" | "confirmed") => {
    if (!selectedReservation) return false;
    const prevStatus = selectedReservation.status;
    if (nextStatus === prevStatus) return true;

    setStatusUpdating(true);
    const ok = await store.updateReservationStatus(selectedReservation.id, nextStatus);
    setStatusUpdating(false);

    if (!ok) {
      toast("No se pudo actualizar estado", "error");
      return false;
    }
    setSelectedReservation((r) =>
      r
        ? {
            ...r,
            status: nextStatus,
            confirmed: nextStatus === "confirmed",
            confirmed_at: nextStatus === "confirmed" ? new Date().toISOString() : undefined,
            manual_pending: nextStatus === "pending",
          }
        : null
    );
    options?.onReservationUpdated?.(selectedReservation.id, {
      status: nextStatus,
      confirmed: nextStatus === "confirmed",
      confirmed_at: nextStatus === "confirmed" ? new Date().toISOString() : undefined,
      manual_pending: nextStatus === "pending",
    });
    toast(nextStatus === "confirmed" ? "Reserva confirmada" : "Reserva en pendiente", "success");
    return true;
  }, [selectedReservation, store, toast, options]);

  const handleVerifyTransfer = useCallback(async (transferId: string, currentStatus: boolean) => {
    const success = await store.verifyTransfer(transferId, !currentStatus);
    if (success) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId ? { ...t, verified: !currentStatus, verified_at: new Date().toISOString() } : t
        )
      );
      toast(currentStatus ? "Verificación removida" : "Transferencia verificada", "success");
    } else {
      toast("Error al actualizar verificación", "error");
    }
  }, [store, toast]);

  const handleEmitInvoice = useCallback(async (
    transfer: Transfer,
    params: { tipo_comprobante: "boleta" | "factura"; doc_num: string }
  ) => {
    if (!selectedReservation) {
      toast("No hay reserva seleccionada", "error");
      return;
    }
    setEmittingInvoiceId(transfer.id);
    try {
      const result = await store.emitInvoice(
        selectedReservation,
        { id: transfer.id, amount: transfer.amount || 0 },
        params
      );
      if (result) {
        toast("Comprobante emitido correctamente", "success");
        const newInvoices = await store.fetchInvoices({ reservation_id: selectedReservation.id });
        setInvoices(newInvoices || []);
      } else {
        toast("Error al emitir comprobante", "error");
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Error inesperado al emitir comprobante";
      toast(msg, "error");
    } finally {
      setEmittingInvoiceId(null);
    }
  }, [store, toast, selectedReservation]);

  const handleUpdateName = useCallback(async (name: string) => {
    if (!selectedReservation) return false;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast("El nombre debe tener al menos 2 caracteres", "error");
      return false;
    }
    const normalizedChatId = String(selectedReservation.chat_id || "").replace(/\D/g, "");
    const [userOk, resOk] = await Promise.all([
      store.updateUserCustomName(normalizedChatId, trimmed),
      fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedReservation.id,
          representative_name: trimmed,
        }),
      }).then((r) => r.ok),
    ]);
    if (!userOk || !resOk) {
      toast("No se pudo actualizar el nombre", "error");
      return false;
    }
    setSelectedReservation((prev) =>
      prev ? { ...prev, representative_name: trimmed } : prev
    );
    setUserNames((prev) => ({ ...prev, custom_name: trimmed }));
    options?.onReservationUpdated?.(selectedReservation.id, { representative_name: trimmed });
    toast("Nombre personalizado actualizado", "success");
    return true;
  }, [selectedReservation, store, toast, options]);

  const handleUpdateDni = useCallback(async (dni: string) => {
    if (!selectedReservation) return false;
    const clean = dni.replace(/\D/g, "").slice(0, 8);
    if (clean && clean.length !== 8) {
      toast("El DNI debe tener 8 dígitos", "error");
      return false;
    }
    const ok = await store.updateReservationDni(selectedReservation.id, clean);
    if (ok) {
      setSelectedReservation((prev) => (prev ? { ...prev, dni: clean } : prev));
      toast("DNI actualizado", "success");
      return true;
    }
    toast("No se pudo actualizar el DNI", "error");
    return false;
  }, [selectedReservation, store, toast]);

  const handleCancelReservation = useCallback(async () => {
    if (!selectedReservation) return false;
    const confirmed = confirm("¿Eliminar esta reserva y todos sus pagos/boletas?");
    if (!confirmed) return false;
    setCancellingReservation(true);
    const ok = await store.deleteReservationHard(selectedReservation.id);
    setCancellingReservation(false);
    if (!ok) {
      toast("No se pudo eliminar la reserva", "error");
      return false;
    }
    options?.onReservationDeleted?.(selectedReservation.id);
    toast("Reserva eliminada", "success");
    close();
    return true;
  }, [selectedReservation, store, toast, close, options]);

  const handleAttachInvoice = useCallback(async (transfer: Transfer, file: File) => {
    if (!selectedReservation) return;

    if (file.type !== "application/pdf") {
      toast("Solo se permiten archivos PDF", "error");
      return;
    }

    setAttachingInvoiceId(transfer.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("reservation_id", selectedReservation.id);
      formData.append("user_id", selectedReservation.chat_id);
      formData.append("phone_number", selectedReservation.phone_number || "");
      formData.append("amount", String(transfer.amount || 0));
      formData.append("court_type", selectedReservation.court_type || "");
      formData.append("date", selectedReservation.date || "");
      formData.append("transfer_id", transfer.id);

      const res = await fetch("/api/invoices/attach", { method: "POST", body: formData });
      const data = await res.json();

      if (data.success) {
        toast("Boleta adjuntada correctamente", "success");
        const newInvoices = await store.fetchInvoices({ reservation_id: selectedReservation.id });
        setInvoices(newInvoices || []);
      } else {
        toast(data.error || "Error al adjuntar boleta", "error");
      }
    } catch (err) {
      console.error("Error attaching invoice:", err);
      toast("Error inesperado al adjuntar boleta", "error");
    } finally {
      setAttachingInvoiceId(null);
    }
  }, [store, toast, selectedReservation]);

  const handleDetachInvoice = useCallback(async (invoiceId: string) => {
    if (!selectedReservation) return false;
    try {
      const res = await fetch(`/api/invoices?id=${encodeURIComponent(invoiceId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error || "No se pudo desvincular la boleta", "error");
        return false;
      }
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId));
      toast("Boleta desvinculada", "success");
      return true;
    } catch (error) {
      console.error("Error detaching invoice:", error);
      toast("Error inesperado al desvincular boleta", "error");
      return false;
    }
  }, [selectedReservation, toast]);

  const handleRevokeManualPayment = useCallback(async (transferId: string) => {
    if (!selectedReservation) return;
    if (!confirm("¿Desvincular este pago de la reserva?\n\nEsta acción eliminará el pago y ajustará el monto pagado. Confirma solo si fue vinculado por error.")) return;

    const result = await store.revokeManualPayment(transferId, selectedReservation.id);
    if (result?.success) {
      toast("Pago desvinculado correctamente", "success");
      setTransfers((prev) => prev.filter((t) => t.id !== transferId));
      if (result.refunded) {
        const newPaid = Math.max(0, (selectedReservation.amount_paid || 0) - result.refunded);
        setSelectedReservation((prev) => prev ? { ...prev, amount_paid: newPaid } : null);
        options?.onReservationUpdated?.(selectedReservation.id, { amount_paid: newPaid });
      }
    } else {
      toast("Error al revocar pago", "error");
    }
  }, [store, toast, selectedReservation, options]);

  const handleUpdateAmountPaid = useCallback(async (amountPaid: number) => {
    if (!selectedReservation) return false;
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedReservation.id, amount_paid: amountPaid }),
      });
      if (!res.ok) {
        toast("No se pudo actualizar el monto pagado", "error");
        return false;
      }
      setSelectedReservation((prev) =>
        prev ? { ...prev, amount_paid: amountPaid } : prev
      );
      options?.onReservationUpdated?.(selectedReservation.id, { amount_paid: amountPaid });
      const newTransfers = await store.fetchTransfers(selectedReservation.id);
      setTransfers(newTransfers || []);
      toast("Monto pagado actualizado", "success");
      return true;
    } catch {
      toast("Error al actualizar monto pagado", "error");
      return false;
    }
  }, [selectedReservation, options, toast, store]);

  const handleUpdatePrice = useCallback(async (totalPrice: number) => {
    if (!selectedReservation) return false;
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedReservation.id, total_price: totalPrice }),
      });
      if (!res.ok) {
        toast("No se pudo actualizar el precio", "error");
        return false;
      }
      setSelectedReservation((prev) =>
        prev ? { ...prev, total_price: totalPrice } : prev
      );
      options?.onReservationUpdated?.(selectedReservation.id, { total_price: totalPrice });
      toast("Precio actualizado", "success");
      return true;
    } catch {
      toast("Error al actualizar precio", "error");
      return false;
    }
  }, [selectedReservation, options, toast]);

  const handleRegisterPayment = useCallback(async (amount: number, method: PaymentMethod, mediaUrl?: string) => {
    if (!selectedReservation) return;
    setPaymentLoading(true);
    try {
      const result = await store.processManualPayment(
        selectedReservation.id,
        amount,
        selectedReservation.phone_number,
        method,
        mediaUrl,
      );
      if (result?.success) {
        toast(`Cobro registrado: S/ ${amount.toFixed(2)}`, "success");
        const patch: Partial<Reservation> = {
          amount_paid: result.new_amount_paid,
          status: selectedReservation.status === "pending" ? "confirmed" : selectedReservation.status,
          confirmed: true,
        };
        setSelectedReservation((prev) => prev ? { ...prev, ...patch } : null);
        options?.onReservationUpdated?.(selectedReservation.id, patch);

        const newTransfers = await store.fetchTransfers(selectedReservation.id);
        setTransfers(newTransfers || []);
      } else {
        toast("Error al procesar el pago", "error");
      }
    } catch {
      toast("Error inesperado al registrar pago", "error");
    } finally {
      setPaymentLoading(false);
    }
  }, [store, toast, selectedReservation, options]);

  const displayName =
    userNames.custom_name ||
    userNames.contact_name ||
    userNames.push_name ||
    selectedReservation?.representative_name ||
    "";

  return {
    selectedReservation,
    setSelectedReservation,
    allReservationsThisWeek,
    transfers,
    invoices,
    userNames,
    displayName,
    loadingData,
    emittingInvoiceId,
    attachingInvoiceId,
    paymentLoading,
    cancellingReservation,
    clientType,
    clientTypeLoading,
    clientTypeUpdating,
    isOpen,
    open,
    close,
    handleVerifyTransfer,
    handleEmitInvoice,
    handleUpdateDni,
    handleUpdateName,
    handleCancelReservation,
    handleUpdateClientType,
    handleUpdateStatus,
    statusUpdating,
    handleAttachInvoice,
    handleDetachInvoice,
    handleRevokeManualPayment,
    handleRegisterPayment,
    handleUpdateAmountPaid,
    handleUpdatePrice,
  };
}
