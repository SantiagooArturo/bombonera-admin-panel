"use client";

import { useState, useCallback, useRef } from "react";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import type { Reservation, Transfer, Invoice, PaymentMethod, ClientType } from "@/lib/types";
import { normalizePeruPhone } from "@/features/operaciones/utils";

interface UsePaymentSidebarOptions {
  onReservationUpdated?: (resId: string, patch: Partial<Reservation>) => void;
  onReservationDeleted?: (resId: string) => void;
}

export function usePaymentSidebar(options?: UsePaymentSidebarOptions) {
  const store = useStore();
  const toast = useToastContext();

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [allReservationsThisWeek, setAllReservationsThisWeek] = useState<Reservation[]>([]);
  const [allClientReservations, setAllClientReservations] = useState<Reservation[]>([]);
  const allReservationsChatIdRef = useRef<string | null>(null);
  /** ID de la reserva que estamos abriendo; si close() se llama antes de que termine el fetch, no actualizamos al completar. */
  const openRequestIdRef = useRef<string | null>(null);
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
    last_dni?: string;
    last_ruc?: string;
  }>({});

  const isOpen = selectedReservation !== null;

  const open = useCallback(async (reservation: Reservation) => {
    openRequestIdRef.current = reservation.id;
    const nextChatId = String(reservation.chat_id || reservation.phone_number || "").replace(/\D/g, "");
    if (allReservationsChatIdRef.current && allReservationsChatIdRef.current !== nextChatId) {
      setAllReservationsThisWeek([]);
      setAllClientReservations([]);
      allReservationsChatIdRef.current = null;
    }
    setSelectedReservation(reservation);
    setLoadingData(true);
    setClientTypeLoading(true);

    // Usar client_type de la cache (users) si está disponible → mostrar al instante
    const cachedUsers = store.getUsers();
    const norm = (s: string) => s.replace(/\D/g, "").slice(-9);
    const resNorm = norm(reservation.phone_number || reservation.chat_id || "");
    const cachedUser = cachedUsers.find(
      (u) =>
        resNorm && resNorm.length >= 9 && (
          norm(u.id || "") === resNorm ||
          norm(u.chat_id || "") === resNorm ||
          (u.phone_number && norm(u.phone_number) === resNorm)
        )
    );
    const validType = (t: string): t is ClientType =>
      t === "casual" || t === "recurrente" || t === "sospechoso_fraude";
    if (cachedUser && validType(cachedUser.client_type)) {
      setClientType(cachedUser.client_type);
      setClientTypeLoading(false);
      setUserNames({
        custom_name: cachedUser.custom_name,
        contact_name: cachedUser.contact_name,
        push_name: cachedUser.push_name,
        last_dni: cachedUser.last_dni,
        last_ruc: (cachedUser as { last_ruc?: string }).last_ruc,
      });
    }

    try {
      await store.syncReservationPayments(reservation.id);
      if (openRequestIdRef.current !== reservation.id) return;

      const rawChatId = String(reservation.chat_id || reservation.phone_number || "").replace(/\D/g, "");
      const chatIdForApi = reservation.chat_id || rawChatId || reservation.phone_number;
      const userDocId = rawChatId.length >= 9 ? normalizePeruPhone(rawChatId) : rawChatId;
      const [transfersByClientRaw, freshResReq, clientTypeRes, clientReservationsRes] = await Promise.all([
        store.fetchTransfersByChatId(chatIdForApi || ""),
        fetch(`/api/reservations?id=${reservation.id}`),
        fetch(`/api/users/client-type?chat_id=${encodeURIComponent(userDocId)}`, { cache: "no-store" }),
        chatIdForApi ? fetch(`/api/reservations?phone_number=${encodeURIComponent(String(chatIdForApi))}`) : Promise.resolve(new Response("[]")),
      ]);

      let transfersByClient = transfersByClientRaw;
      if ((!transfersByClient || transfersByClient.length === 0) && reservation.id) {
        transfersByClient = await store.fetchTransfers(reservation.id);
      }
      const transferIds = (transfersByClient || []).map((t) => t.id).filter(Boolean);
      const invoicesData = transferIds.length > 0 ? await store.fetchInvoicesByTransferIds(transferIds) : [];

      if (openRequestIdRef.current !== reservation.id) return;

      setTransfers(transfersByClient || []);
      setInvoices(invoicesData || []);

      let freshReservation = reservation;
      if (freshResReq.ok) {
        const parsed = await freshResReq.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          freshReservation = parsed[0];
        }
      }

      const transfersForRes = (transfersByClient || []).filter((t) => t.reservation_id === reservation.id);
      const total = transfersForRes.reduce((sum: number, t: Transfer) => {
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
          last_dni: typeof clientTypeData?.last_dni === "string" ? clientTypeData.last_dni : undefined,
          last_ruc: typeof clientTypeData?.last_ruc === "string" ? clientTypeData.last_ruc : undefined,
        });
      } else {
        setClientType("casual");
        setUserNames({});
      }

      if (clientReservationsRes?.ok) {
        const allClientRes = await clientReservationsRes.json();
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const sortFn = (a: Reservation, b: Reservation) => {
          const cmp = (a.date || "").localeCompare(b.date || "");
          if (cmp !== 0) return cmp;
          const aStart = a.time_slots?.[0] || "";
          const bStart = b.time_slots?.[0] || "";
          return aStart.localeCompare(bStart);
        };
        const allFiltered = (Array.isArray(allClientRes) ? allClientRes : [])
          .filter((r: Reservation) => r.status !== "cancelled" && r.status !== "expired")
          .sort(sortFn);
        const upcomingOnly = allFiltered.filter((r: Reservation) => (r.date || "") >= todayStr);
        setAllClientReservations(allFiltered);
        setAllReservationsThisWeek(upcomingOnly);
        allReservationsChatIdRef.current = String(chatIdForApi || "").replace(/\D/g, "");
      } else {
        setAllClientReservations([]);
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
    openRequestIdRef.current = null;
    setSelectedReservation(null);
    setAllReservationsThisWeek([]);
    setAllClientReservations([]);
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

    const raw = String(selectedReservation.chat_id || selectedReservation.phone_number || "").replace(/\D/g, "");
    const normalizedChatId = raw.length >= 9 ? normalizePeruPhone(raw) : raw;
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

  const handleToggleApplied = useCallback(async (transferId: string, applied: boolean) => {
    const success = await store.updateTransferApplied(transferId, applied);
    if (success) {
      setTransfers((prev) =>
        prev.map((t) => (t.id === transferId ? { ...t, applied } : t))
      );
      toast(applied ? "Pago marcado como aplicado" : "Marca de aplicado removida", "success");
    } else {
      toast("Error al actualizar", "error");
    }
  }, [store, toast]);

  const handleEmitInvoice = useCallback(async (
    transfer: Transfer,
    params: {
      tipo_comprobante: "boleta" | "factura";
      doc_num: string;
      cliente_denominacion?: string;
      descripcion?: string;
      amount?: number;
    }
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
        { ...params, amount: typeof params.amount === "number" ? params.amount : undefined }
      );
      if (result) {
        toast("Comprobante emitido correctamente", "success");
        const ids = transfers.map((t) => t.id).filter(Boolean);
        const newInvoices = ids.length > 0 ? await store.fetchInvoicesByTransferIds(ids) : [];
        setInvoices(newInvoices || []);

        const docNum = params.doc_num.replace(/\D/g, "");
        const chatId = String(selectedReservation.chat_id || selectedReservation.phone_number || "").replace(/\D/g, "");
        const userDocId = chatId.length >= 9 ? normalizePeruPhone(chatId) : chatId;
        if (params.tipo_comprobante === "boleta" && docNum.length === 8) {
          if (!selectedReservation.dni) {
            await store.updateReservationDni(selectedReservation.id, docNum);
            setSelectedReservation((prev) => (prev ? { ...prev, dni: docNum } : prev));
          }
          if (!userNames.last_dni && userDocId) {
            await store.updateUserDoc(userDocId, { last_dni: docNum });
            setUserNames((prev) => ({ ...prev, last_dni: docNum }));
          }
        } else if (params.tipo_comprobante === "factura" && docNum.length === 11 && !userNames.last_ruc && userDocId) {
          await store.updateUserDoc(userDocId, { last_ruc: docNum });
          setUserNames((prev) => ({ ...prev, last_ruc: docNum }));
        }
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
  }, [store, toast, selectedReservation, transfers, userNames.last_dni, userNames.last_ruc]);

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
      setUserNames((prev) => ({ ...prev, last_dni: clean || undefined }));
      toast("DNI actualizado", "success");
      return true;
    }
    toast("No se pudo actualizar el DNI", "error");
    return false;
  }, [selectedReservation, store, toast]);

  const handleUpdateRuc = useCallback(async (ruc: string) => {
    if (!selectedReservation) return false;
    const clean = ruc.replace(/\D/g, "").slice(0, 11);
    if (clean && clean.length !== 11) {
      toast("El RUC debe tener 11 dígitos", "error");
      return false;
    }
    const chatId = String(selectedReservation.chat_id || selectedReservation.phone_number || "").replace(/\D/g, "");
    const userDocId = chatId.length >= 9 ? normalizePeruPhone(chatId) : chatId;
    if (!userDocId) {
      toast("No se pudo identificar al cliente", "error");
      return false;
    }
    const ok = await store.updateUserDoc(userDocId, { last_ruc: clean || undefined });
    if (ok) {
      setUserNames((prev) => ({ ...prev, last_ruc: clean || undefined }));
      toast("RUC actualizado", "success");
      return true;
    }
    toast("No se pudo actualizar el RUC", "error");
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
        const ids = transfers.map((t) => t.id).filter(Boolean);
        const newInvoices = ids.length > 0 ? await store.fetchInvoicesByTransferIds(ids) : [];
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
  }, [store, toast, selectedReservation, transfers]);

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
    const transfer = transfers.find((t) => t.id === transferId);
    const reservationId = transfer?.reservation_id ?? selectedReservation?.id;
    if (!reservationId) return;
    if (!confirm("¿Desvincular este pago de la reserva?\n\nEsta acción eliminará el pago y ajustará el monto pagado. Confirma solo si fue vinculado por error.")) return;

    const result = await store.revokeManualPayment(transferId, reservationId);
    if (result?.success) {
      toast("Pago desvinculado correctamente", "success");
      setTransfers((prev) => prev.filter((t) => t.id !== transferId));
      if (result.refunded) {
        const affectedRes = allClientReservations.find((r) => r.id === reservationId);
        const prevPaid = affectedRes?.amount_paid ?? 0;
        const newPaid = Math.max(0, prevPaid - result.refunded);
        const patch = { amount_paid: newPaid };
        setSelectedReservation((prev) => (prev?.id === reservationId ? { ...prev, ...patch } : prev));
        setAllClientReservations((prev) =>
          prev.map((r) => (r.id === reservationId ? { ...r, ...patch } : r))
        );
        setAllReservationsThisWeek((prev) =>
          prev.map((r) => (r.id === reservationId ? { ...r, ...patch } : r))
        );
        options?.onReservationUpdated?.(reservationId, patch);
      }
    } else {
      toast("Error al revocar pago", "error");
    }
  }, [store, toast, selectedReservation, transfers, allClientReservations, options]);

  const handleUpdateAmountPaid = useCallback(async (amountPaid: number, reservationId?: string) => {
    const id = reservationId ?? selectedReservation?.id;
    if (!id) return false;
    const prevReservations = allClientReservations;
    const prevSelected = selectedReservation;
    const patch = { amount_paid: amountPaid };
    setAllClientReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    setAllReservationsThisWeek((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    setSelectedReservation((prev) =>
      prev?.id === id ? { ...prev, ...patch } : prev
    );
    options?.onReservationUpdated?.(id, patch);
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, amount_paid: amountPaid }),
      });
      if (!res.ok) {
        setAllClientReservations(prevReservations);
        setSelectedReservation(prevSelected);
        toast("No se pudo actualizar el monto pagado", "error");
        return false;
      }
      const resForChat = prevReservations.find((r) => r.id === id) ?? prevSelected;
      const chatId = resForChat?.chat_id || resForChat?.phone_number || "";
      if (chatId) {
        store.fetchTransfersByChatId(chatId).then((newTransfers) => {
          setTransfers(newTransfers || []);
        });
      }
      toast("Monto pagado actualizado", "success");
      return true;
    } catch {
      setAllClientReservations(prevReservations);
      setSelectedReservation(prevSelected);
      toast("Error al actualizar monto pagado", "error");
      return false;
    }
  }, [selectedReservation, allClientReservations, options, toast, store]);

  const handleUpdatePrice = useCallback(async (totalPrice: number, reservationId?: string) => {
    const id = reservationId ?? selectedReservation?.id;
    if (!id) return false;
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, total_price: totalPrice }),
      });
      if (!res.ok) {
        toast("No se pudo actualizar el precio", "error");
        return false;
      }
      const patch = { total_price: totalPrice };
      setAllClientReservations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
      setAllReservationsThisWeek((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
      setSelectedReservation((prev) =>
        prev?.id === id ? { ...prev, ...patch } : prev
      );
      options?.onReservationUpdated?.(id, patch);
      toast("Precio actualizado", "success");
      return true;
    } catch {
      toast("Error al actualizar precio", "error");
      return false;
    }
  }, [selectedReservation, options, toast]);

  const handleRegisterPayment = useCallback(async (reservationId: string, amount: number, method: PaymentMethod, mediaUrl?: string) => {
    const targetRes = allClientReservations.find((r) => r.id === reservationId) ?? selectedReservation;
    if (!targetRes) return;
    const phoneNumber = targetRes.phone_number || selectedReservation?.phone_number || "";
    if (!phoneNumber) return;
    setPaymentLoading(true);
    try {
      const result = await store.processManualPayment(
        reservationId,
        amount,
        phoneNumber,
        method,
        mediaUrl,
      );
      if (result?.success) {
        toast(`Pago registrado: S/ ${amount.toFixed(2)}`, "success");
        const patch: Partial<Reservation> = {
          amount_paid: result.new_amount_paid,
          status: targetRes.status === "pending" ? "confirmed" : targetRes.status,
          confirmed: true,
        };
        setAllClientReservations((prev) =>
          prev.map((r) => (r.id === reservationId ? { ...r, ...patch } : r))
        );
        setSelectedReservation((prev) =>
          prev?.id === reservationId ? { ...prev, ...patch } : prev
        );
        options?.onReservationUpdated?.(reservationId, patch);

        const chatId = targetRes.chat_id || targetRes.phone_number || selectedReservation?.chat_id || "";
        const newTransfers = await store.fetchTransfersByChatId(chatId);
        setTransfers(newTransfers || []);
      } else {
        toast("Error al procesar el pago", "error");
      }
    } catch {
      toast("Error inesperado al registrar pago", "error");
    } finally {
      setPaymentLoading(false);
    }
  }, [store, toast, selectedReservation, allClientReservations, options]);

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
    allClientReservations,
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
    handleUpdateRuc,
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
    handleToggleApplied,
  };
}
