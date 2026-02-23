"use client";

import { useState, useCallback } from "react";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import type { Reservation, Transfer, Invoice, PaymentMethod } from "@/lib/types";

interface UsePaymentSidebarOptions {
  onReservationUpdated?: (resId: string, patch: Partial<Reservation>) => void;
}

export function usePaymentSidebar(options?: UsePaymentSidebarOptions) {
  const store = useStore();
  const toast = useToastContext();

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [emittingInvoiceId, setEmittingInvoiceId] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  const isOpen = selectedReservation !== null;

  const open = useCallback(async (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setLoadingData(true);
    try {
      await store.syncReservationPayments(reservation.id);

      const [transfersData, invoicesData] = await Promise.all([
        store.fetchTransfers(reservation.id),
        store.fetchInvoices({ reservation_id: reservation.id }),
      ]);
      setTransfers(transfersData || []);
      setInvoices(invoicesData || []);

      const total = (transfersData || []).reduce((sum: number, t: Transfer) => {
        if (t.status === "applied" || t.status === "partial") return sum + (t.amount || 0);
        return sum;
      }, 0);
      setSelectedReservation((prev) => (prev ? { ...prev, amount_paid: total } : null));
    } catch (error) {
      console.error("Error loading sidebar data", error);
      toast("Error al cargar información", "error");
    } finally {
      setLoadingData(false);
    }
  }, [store, toast]);

  const close = useCallback(() => {
    setSelectedReservation(null);
    setTransfers([]);
    setInvoices([]);
  }, []);

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

  const handleEmitInvoice = useCallback(async (transfer: Transfer) => {
    if (!selectedReservation) {
      toast("No hay reserva seleccionada", "error");
      return;
    }
    setEmittingInvoiceId(transfer.id);
    try {
      const result = await store.emitInvoice(selectedReservation, { id: transfer.id, amount: transfer.amount || 0 });
      if (result) {
        toast("Boleta emitida correctamente", "success");
        const newInvoices = await store.fetchInvoices({ reservation_id: selectedReservation.id });
        setInvoices(newInvoices || []);
      } else {
        toast("Error al emitir boleta", "error");
      }
    } catch {
      toast("Error inesperado al emitir boleta", "error");
    } finally {
      setEmittingInvoiceId(null);
    }
  }, [store, toast, selectedReservation]);

  const handleAttachInvoice = useCallback(async (transfer: Transfer, file: File) => {
    if (!selectedReservation) return;

    if (file.type !== "application/pdf") {
      toast("Solo se permiten archivos PDF", "error");
      return;
    }

    setEmittingInvoiceId(transfer.id);
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
      setEmittingInvoiceId(null);
    }
  }, [store, toast, selectedReservation]);

  const handleRevokeManualPayment = useCallback(async (transferId: string) => {
    if (!selectedReservation) return;
    if (!confirm("¿Estás seguro de revocar (eliminar) este pago manual?")) return;

    const result = await store.revokeManualPayment(transferId, selectedReservation.id);
    if (result?.success) {
      toast("Pago manual revocado", "success");
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
          status: result.fully_paid ? "paid" : selectedReservation.status,
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

  return {
    selectedReservation,
    setSelectedReservation,
    transfers,
    invoices,
    loadingData,
    emittingInvoiceId,
    paymentLoading,
    isOpen,
    open,
    close,
    handleVerifyTransfer,
    handleEmitInvoice,
    handleAttachInvoice,
    handleRevokeManualPayment,
    handleRegisterPayment,
  };
}
