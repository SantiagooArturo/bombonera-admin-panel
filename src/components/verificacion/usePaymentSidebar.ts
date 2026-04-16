"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import { type Reservation, type Transfer, type Invoice, type PaymentMethod, type ClientType, type EmitComprobanteParams, Note } from "@/lib/types";
import { voidSunatInvoice } from "@/features/boletas/services/voidSunatInvoice";
import { mergeInvoiceVoided } from "@/features/boletas/utils/mergeInvoiceVoided";
import { TRANSFER_ID_EMIT_THEN_REGISTER_PAYMENT } from "@/features/boletas/constants/emitThenRegisterPayment";
import { normalizePeruPhone } from "@/features/operaciones/utils";

interface UsePaymentSidebarOptions {
  onReservationUpdated?: (resId: string, patch: Partial<Reservation>) => void;
  onReservationDeleted?: (resId: string) => void;
}

/** Tras subir «Pagado»: el usuario elige solo PATCH o registrar cobro y abrir el emisor (sin emitir SUNAT hasta que confirme en el modal). */
export type AmountPaidDeltaPrompt = {
  reservationId: string;
  amountPaid: number;
  delta: number;
};

export function usePaymentSidebar(options?: UsePaymentSidebarOptions) {
  const store = useStore();
  const toast = useToastContext();

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [allReservationsThisWeek, setAllReservationsThisWeek] = useState<Reservation[]>([]);
  const allReservationsChatIdRef = useRef<string | null>(null);
  /** ID de la reserva que estamos abriendo; si close() se llama antes de que termine el fetch, no actualizamos al completar. */
  const openRequestIdRef = useRef<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [emittingInvoiceId, setEmittingInvoiceId] = useState<string | null>(null);
  /** Evita doble POST /api/invoices si el modal dispara onEmitInvoice dos veces antes del re-render. */
  const emitInvoiceInFlightRef = useRef(false);
  const [attachingInvoiceId, setAttachingInvoiceId] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  /** Tras registrar cobro desde edición de «Pagado», abrir emisor de comprobante en el sidebar. */
  const [pendingEmitFromAmountEdit, setPendingEmitFromAmountEdit] = useState<Transfer | null>(null);
  const [amountPaidDeltaPrompt, setAmountPaidDeltaPrompt] = useState<AmountPaidDeltaPrompt | null>(null);
  const amountPaidDeltaPromptRef = useRef<AmountPaidDeltaPrompt | null>(null);
  useEffect(() => {
    amountPaidDeltaPromptRef.current = amountPaidDeltaPrompt;
  }, [amountPaidDeltaPrompt]);
  const [cancellingReservation, setCancellingReservation] = useState(false);
  const [clientType, setClientType] = useState<ClientType>("casual");
  const [clientTypeLoading, setClientTypeLoading] = useState(false);
  const [clientTypeUpdating, setClientTypeUpdating] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [recurrenceUpdating, setRecurrenceUpdating] = useState(false);
  const [userNames, setUserNames] = useState<{
    custom_name?: string;
    contact_name?: string;
    push_name?: string;
    last_dni?: string;
    last_ruc?: string;
  }>({});
  const [recurrenceConflict, setRecurrenceConflict] = useState<{
    ownerName: string;
    ownerId: string;
    slotId: string;
  } | null>(null);

  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const isOpen = selectedReservation !== null;

  const open = useCallback(async (reservation: Reservation) => {
    openRequestIdRef.current = reservation.id;
    setLoadingNotes(true);
    setNotes([]);
    const nextChatId = String(reservation.chat_id || reservation.phone_number || "").replace(/\D/g, "");
    if (allReservationsChatIdRef.current && allReservationsChatIdRef.current !== nextChatId) {
      setAllReservationsThisWeek([]);
      allReservationsChatIdRef.current = null;
    }
    setSelectedReservation(reservation);
    setAmountPaidDeltaPrompt(null);
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
      if (openRequestIdRef.current !== reservation.id) return;

      const rawChatId = String(reservation.chat_id || reservation.phone_number || "").replace(/\D/g, "");
      const chatIdForApi = reservation.chat_id || rawChatId || reservation.phone_number;
      const userDocId = rawChatId.length >= 9 ? normalizePeruPhone(rawChatId) : rawChatId;
      const [transfersByClientRaw, freshResReq, clientTypeRes, clientReservationsRes, recurrentRes] = await Promise.all([
        store.fetchTransfersByChatId(chatIdForApi || ""),
        fetch(`/api/reservations?id=${reservation.id}`),
        fetch(`/api/users/client-type?chat_id=${encodeURIComponent(userDocId)}`, { cache: "no-store" }),
        chatIdForApi ? fetch(`/api/reservations?phone_number=${encodeURIComponent(String(chatIdForApi))}`) : Promise.resolve(new Response("[]")),
        fetch("/api/recurrent-schedules", { cache: "no-store" }),
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

      // ── Sincronizar recurrencia desde SSoT ─────────────────────────────────
      let isRecurrentActual = false;
      if (recurrentRes && recurrentRes.ok) {
        const allSchedules = await recurrentRes.json();
        if (Array.isArray(allSchedules)) {
          isRecurrentActual = allSchedules.some(s => {
            const dayOfRes = new Date(freshReservation.date + "T12:00:00").getDay();
            const startTimeRes = freshReservation.time_slots?.[0] || "";
            const norm = (id: string | number | undefined | null) => String(id || "").replace(/\D/g, "").slice(-9);
            
            return (
              s.day_of_week === dayOfRes &&
              s.field === freshReservation.field &&
              s.start_time === startTimeRes &&
              norm(s.chat_id) === norm(freshReservation.chat_id)
            );
          });
        }
      }

      setSelectedReservation({ ...freshReservation, is_recurrent: isRecurrentActual });

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
        setAllReservationsThisWeek(upcomingOnly);
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

    // Fetch notes separately to not block main data
    setLoadingNotes(true);
    try {
      const bRes = await fetch(`/api/notes?chat_id=${encodeURIComponent(reservation.chat_id)}`);
      if (bRes.ok) {
        const fetchedNotes = await bRes.json();
        setNotes(fetchedNotes);

        // Backstop: si el usuario tiene notas pero last_note no está en el store
        // (e.g. notas añadidas antes de que se implementara last_note), sincronizar.
        if (fetchedNotes.length > 0) {
          const normFn = (s: string | number | undefined | null) => String(s || "").replace(/\D/g, "").slice(-9);
          const resNorm = normFn(reservation.chat_id || reservation.phone_number || "");
          const matchedUser = store.getUsers().find(
            (u) => normFn(u.id) === resNorm || normFn(u.chat_id) === resNorm
          );
          if (!matchedUser?.last_note) {
            const latestContent = fetchedNotes[0].content || "";
            const preview = latestContent.length > 2000 ? latestContent.slice(0, 1997) + "..." : latestContent;
            if (preview) {
              store.updateUserDoc(reservation.chat_id, { last_note: preview });
            }
          }
        }
      }
    } catch (e) {
      console.error("Error fetching notes", e);
    } finally {
      setLoadingNotes(false);
    }
  }, [store, toast]);

  const close = useCallback(() => {
    openRequestIdRef.current = null;
    setSelectedReservation(null);
    setAllReservationsThisWeek([]);
    allReservationsChatIdRef.current = null;
    setTransfers([]);
    setInvoices([]);
    setClientType("casual");
    setClientTypeLoading(false);
    setClientTypeUpdating(false);
    setUserNames({});
    setPendingEmitFromAmountEdit(null);
    setAmountPaidDeltaPrompt(null);
    setNotes([]);
    setLoadingNotes(false);
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
  
  const handleToggleRecurrence = useCallback(async (isRecurrent: boolean, force = false) => {
    if (!selectedReservation || recurrenceUpdating) return false;
    
    setRecurrenceConflict(null);
    console.log("[usePaymentSidebar] Toggling recurrence for:", selectedReservation.id, "to:", isRecurrent, "force:", force);
    setRecurrenceUpdating(true);
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedReservation.id, is_recurrent: isRecurrent, force: force }),
      });
      console.log("[usePaymentSidebar] Response status:", res.status);
      const data = await res.json();
      if (!res.ok) {
        console.error("[usePaymentSidebar] Toggle error response:", data);
        
        // Parse error message for conflict info if 409
        if (res.status === 409 && data.error) {
          // Format: "Conflicto (Slot ID): Este horario ya pertenece de forma recurrente a NAME (ID). Tu ID: ..."
          const ownerMatch = data.error.match(/recurrente a ([^(]+) \(([^)]+)\)/);
          if (ownerMatch) {
            setRecurrenceConflict({
              ownerName: ownerMatch[1].trim(),
              ownerId: ownerMatch[2].trim(),
              slotId: "", // Removing internally used ID
            });
          }
        }
        
        toast(data.error || "No se pudo actualizar la recurrencia", "error");
        return false;
      }
      
      setSelectedReservation(prev => prev ? { ...prev, is_recurrent: isRecurrent } : prev);
      options?.onReservationUpdated?.(selectedReservation.id, { is_recurrent: isRecurrent });
      toast(isRecurrent ? "Horario marcado como recurrente" : "Recurrencia removida", "success");
      return true;
    } catch {
      toast("Error al conectar con el servidor", "error");
      return false;
    } finally {
      setRecurrenceUpdating(false);
    }
  }, [selectedReservation, recurrenceUpdating, options, toast]);

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

  const handleEmitInvoice = useCallback(
    async (transfer: Transfer, params: EmitComprobanteParams): Promise<Invoice | null> => {
      if (!selectedReservation) {
        toast("No hay reserva seleccionada", "error");
        return null;
      }
      if (emitInvoiceInFlightRef.current) {
        return null;
      }
      emitInvoiceInFlightRef.current = true;
      setEmittingInvoiceId(transfer.id);
      try {
        const invoice = await store.emitInvoice(
          selectedReservation,
          { id: transfer.id, amount: transfer.amount || 0 },
          { ...params, amount: typeof params.amount === "number" ? params.amount : undefined }
        );

        if (transfer.id === TRANSFER_ID_EMIT_THEN_REGISTER_PAYMENT) {
          const billed = invoice.amount;
          const phoneNumber = String(selectedReservation.phone_number || "").trim();
          if (phoneNumber) {
            const pay = await store.processManualPayment(
              selectedReservation.id,
              billed,
              phoneNumber,
              "digital"
            );
            if (pay?.success && pay.transfer_id) {
              await store.linkInvoiceToTransfer(invoice.id, pay.transfer_id);
              if (pay.new_amount_paid != null) {
                const patch: Partial<Reservation> = {
                  amount_paid: pay.new_amount_paid,
                  amount_paid_manual: true,
                  confirmed: true,
                };
                if (selectedReservation.status === "pending") {
                  patch.status = "confirmed";
                }
                const rid = selectedReservation.id;
                setAllReservationsThisWeek((prev) =>
                  prev.map((r) => (r.id === rid ? { ...r, ...patch } : r))
                );
                setSelectedReservation((prev) => (prev ? { ...prev, ...patch } : prev));
                options?.onReservationUpdated?.(rid, patch);
              }
            }
          }
        }

        const chatKey =
          String(
            selectedReservation.chat_id || selectedReservation.phone_number || ""
          ).replace(/\D/g, "") || selectedReservation.phone_number || "";
        const newTransfers = await store.fetchTransfersByChatId(
          chatKey || selectedReservation.phone_number || ""
        );
        setTransfers(newTransfers || []);
        const ids = (newTransfers || []).map((t) => t.id).filter(Boolean);
        const newInvoices = ids.length > 0 ? await store.fetchInvoicesByTransferIds(ids) : [];
        setInvoices(newInvoices || []);

        const docNum = String(params.doc_num || "").replace(/\D/g, "");
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
        return invoice;
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Error inesperado al emitir comprobante";
        toast(msg, "error");
        return null;
      } finally {
        emitInvoiceInFlightRef.current = false;
        setEmittingInvoiceId(null);
      }
    },
    [store, toast, selectedReservation, userNames.last_dni, userNames.last_ruc, options]
  );

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

  const handleVoidSunatInvoice = useCallback(
    async (invoiceId: string) => {
      const result = await voidSunatInvoice(invoiceId);
      if (!result.success) {
        toast(result.error, "error");
        return false;
      }
      toast(
        result.sunat_estado === "PENDIENTE"
          ? "Anulación enviada (en proceso)"
          : "Comprobante anulado",
        "success"
      );
      setInvoices((prev) =>
        prev.map((i) => (i.id === invoiceId ? mergeInvoiceVoided(i, result.sunat_estado) : i))
      );
      return true;
    },
    [toast]
  );

  const handleRevokeManualPayment = useCallback(async (transferId: string) => {
    const transfer = transfers.find((t) => t.id === transferId);
    if (!transfer) return;
    const rid = transfer.reservation_id;
    const reservationIdForApi = rid != null && rid !== "" ? rid : undefined;
    const msg = reservationIdForApi
      ? "¿Desvincular este pago de la reserva?\n\nEsta acción eliminará el pago y ajustará el monto pagado. Confirma solo si fue vinculado por error."
      : "¿Eliminar este pago registrado al cliente?\n\nNo está vinculado a una reserva; solo se borrará el registro de transferencia.";
    if (!confirm(msg)) return;

    const result = await store.revokeManualPayment(transferId, reservationIdForApi);
    if (result?.success) {
      toast("Pago desvinculado correctamente", "success");
      setTransfers((prev) => prev.filter((t) => t.id !== transferId));
      if (result.refunded && reservationIdForApi) {
        const affectedRes = allReservationsThisWeek.find((r) => r.id === reservationIdForApi);
        const prevPaid = affectedRes?.amount_paid ?? 0;
        const newPaid = Math.max(0, prevPaid - result.refunded);
        const patch = { amount_paid: newPaid };
        setSelectedReservation((prev) => (prev?.id === reservationIdForApi ? { ...prev, ...patch } : prev));
        setAllReservationsThisWeek((prev) =>
          prev.map((r) => (r.id === reservationIdForApi ? { ...r, ...patch } : r))
        );
        options?.onReservationUpdated?.(reservationIdForApi, patch);
      }
    } else {
      toast("Error al revocar pago", "error");
    }
  }, [store, toast, transfers, allReservationsThisWeek, options]);

  const clearPendingEmitFromAmountEdit = useCallback(() => {
    setPendingEmitFromAmountEdit(null);
  }, []);

  const persistDirectAmountPaid = useCallback(
    async (id: string, amountPaid: number): Promise<boolean> => {
      const prevReservations = allReservationsThisWeek;
      const prevSelected = selectedReservation;
      const patch: Partial<Reservation> = { amount_paid: amountPaid, amount_paid_manual: true };
      setAllReservationsThisWeek((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      setSelectedReservation((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
      options?.onReservationUpdated?.(id, patch);
      try {
        const res = await fetch("/api/reservations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, amount_paid: amountPaid, amount_paid_direct: true }),
        });
        if (!res.ok) {
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
        setSelectedReservation(prevSelected);
        toast("Error al actualizar monto pagado", "error");
        return false;
      }
    },
    [allReservationsThisWeek, selectedReservation, options, toast, store]
  );

  const resolveAmountPaidDeltaPrompt = useCallback(
    async (choice: "direct" | "emit"): Promise<boolean> => {
      const p = amountPaidDeltaPromptRef.current;
      if (!p) return false;

      const { reservationId: id, amountPaid, delta } = p;
      const resSnapshot =
        selectedReservation?.id === id
          ? selectedReservation
          : allReservationsThisWeek.find((r) => r.id === id) ?? selectedReservation;

      setPaymentLoading(true);
      let ok = false;
      try {
        if (choice === "direct") {
          ok = await persistDirectAmountPaid(id, amountPaid);
        } else {
          const phoneNumber = String(resSnapshot?.phone_number || selectedReservation?.phone_number || "").trim();
          setPendingEmitFromAmountEdit({
            id: TRANSFER_ID_EMIT_THEN_REGISTER_PAYMENT,
            amount: delta,
            phone_number: phoneNumber,
            recipient_name: null,
            transaction_date: null,
            operation_id: null,
            reservation_id: id,
            status: "partial",
            source: "manual",
            payment_method: "digital",
            created_at: new Date().toISOString(),
            chat_id: resSnapshot?.chat_id ?? resSnapshot?.phone_number ?? null,
          });
          ok = true;
        }
        return ok;
      } finally {
        setAmountPaidDeltaPrompt(null);
        setPaymentLoading(false);
      }
    },
    [selectedReservation, allReservationsThisWeek, persistDirectAmountPaid]
  );

  const handleUpdateAmountPaid = useCallback(
    async (amountPaid: number, reservationId?: string) => {
      const id = reservationId ?? selectedReservation?.id;
      if (!id) return false;

      const resSnapshot =
        selectedReservation?.id === id
          ? selectedReservation
          : allReservationsThisWeek.find((r) => r.id === id) ?? selectedReservation;
      const prevPaid = resSnapshot?.amount_paid ?? 0;
      const delta = amountPaid - prevPaid;

      if (delta > 0.005) {
        setAmountPaidDeltaPrompt({ reservationId: id, amountPaid, delta });
        return false;
      }

      return persistDirectAmountPaid(id, amountPaid);
    },
    [selectedReservation, allReservationsThisWeek, persistDirectAmountPaid]
  );

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
  
  const handleAddNote = useCallback(async (content: string) => {
    if (!selectedReservation || !content.trim()) return;
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: selectedReservation.chat_id, content }),
      });
      if (res.ok) {
        const newNote = await res.json();
        setNotes(prev => [newNote, ...prev]);
        toast("Apunte agregado", "success");
        
        // Instant sync with Grid
        const preview = content.trim().length > 2000 ? content.trim().slice(0, 1997) + "..." : content.trim();
        store.updateUserDoc(selectedReservation.chat_id, { last_note: preview });
      } else {
        toast("Error al agregar apunte", "error");
      }
    } catch {
      toast("Error al conectar con el servidor", "error");
    }
  }, [selectedReservation, store, toast]);

  const handleEditNote = useCallback(async (noteId: string, content: string) => {
    if (!selectedReservation || !content.trim()) return;
    try {
      const res = await fetch("/api/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: selectedReservation.chat_id, note_id: noteId, content }),
      });
      if (res.ok) {
        setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content, updated_at: new Date().toISOString() } : n));
        toast("Apunte actualizado", "success");
        
        // Instant sync with Grid
        const preview = content.trim().length > 2000 ? content.trim().slice(0, 1997) + "..." : content.trim();
        store.updateUserDoc(selectedReservation.chat_id, { last_note: preview });
      } else {
        toast("Error al actualizar apunte", "error");
      }
    } catch {
      toast("Error al conectar con el servidor", "error");
    }
  }, [selectedReservation, store, toast]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    if (!selectedReservation) return;
    try {
      const res = await fetch(`/api/notes?chat_id=${encodeURIComponent(selectedReservation.chat_id)}&note_id=${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId));
        toast("Apunte eliminado", "success");
        
        // Update Grid preview
        const latestContent = notes.find(n => n.id !== noteId)?.content;
        const preview = latestContent ? (latestContent.length > 2000 ? latestContent.slice(0, 1997) + "..." : latestContent) : null;
        store.updateUserDoc(selectedReservation.chat_id, { last_note: preview });
      } else {
        toast("Error al eliminar apunte", "error");
      }
    } catch {
      toast("Error al conectar con el servidor", "error");
    }
  }, [selectedReservation, store, toast, notes]);

  const handleRegisterPayment = useCallback(async (reservationId: string | null, amount: number, method: PaymentMethod, mediaUrl?: string) => {
    const targetRes =
      reservationId != null
        ? allReservationsThisWeek.find((r) => r.id === reservationId) ?? selectedReservation
        : selectedReservation;
    const phoneNumber =
      targetRes?.phone_number ||
      selectedReservation?.phone_number ||
      "";
    if (!phoneNumber) {
      toast("Falta teléfono del cliente para registrar el pago", "error");
      return;
    }
    const orphanChat =
      reservationId == null
        ? String(
            selectedReservation?.chat_id ||
              selectedReservation?.phone_number ||
              phoneNumber ||
              ""
          ).replace(/\D/g, "")
        : undefined;
    if (reservationId == null && (!orphanChat || orphanChat.length < 9)) {
      toast("Se necesita un chat/teléfono válido (mín. 9 dígitos) para cobro sin reserva", "error");
      return;
    }
    setPaymentLoading(true);
    try {
      const result = await store.processManualPayment(
        reservationId,
        amount,
        phoneNumber,
        method,
        mediaUrl,
        reservationId == null ? orphanChat : undefined,
      );
      if (result?.success) {
        toast(`Pago registrado: S/ ${amount.toFixed(2)}`, "success");
        const baseRes = targetRes ?? selectedReservation;
        if (reservationId != null && result.new_amount_paid != null && baseRes) {
          const patch: Partial<Reservation> = {
            amount_paid: result.new_amount_paid,
            status: baseRes.status === "pending" ? "confirmed" : baseRes.status,
            confirmed: true,
          };
          setSelectedReservation((prev) =>
            prev?.id === reservationId ? { ...prev, ...patch } : prev
          );
          options?.onReservationUpdated?.(reservationId, patch);
        }

        const chatId =
          String(
            targetRes?.chat_id ||
              targetRes?.phone_number ||
              selectedReservation?.chat_id ||
              selectedReservation?.phone_number ||
              phoneNumber ||
              orphanChat ||
              ""
          ).replace(/\D/g, "") || orphanChat;
        const newTransfers = await store.fetchTransfersByChatId(chatId || orphanChat || "");
        setTransfers(newTransfers || []);
      } else {
        toast("Error al procesar el pago", "error");
      }
    } catch {
      toast("Error inesperado al registrar pago", "error");
    } finally {
      setPaymentLoading(false);
    }
  }, [store, toast, selectedReservation, allReservationsThisWeek, options]);

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
    handleUpdateRuc,
    handleUpdateName,
    handleCancelReservation,
    handleUpdateClientType,
    handleUpdateStatus,
    statusUpdating,
    recurrenceUpdating,
    handleAttachInvoice,
    handleDetachInvoice,
    handleVoidSunatInvoice,
    handleRevokeManualPayment,
    handleRegisterPayment,
    handleUpdateAmountPaid,
    amountPaidDeltaPrompt,
    resolveAmountPaidDeltaPrompt,
    pendingEmitFromAmountEdit,
    clearPendingEmitFromAmountEdit,
    handleUpdatePrice,
    handleToggleApplied,
    handleToggleRecurrence,
    recurrenceConflict,
    setRecurrenceConflict,
    notes,
    loadingNotes,
    handleAddNote,
    handleEditNote,
    handleDeleteNote,
  };
}
