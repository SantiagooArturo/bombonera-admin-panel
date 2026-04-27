import type {
  Reservation,
  BlockedSlot,
  BlockRule,
  AutomatedNumber,
  User,
  Invoice,
  ClientType,
  EmitComprobanteParams,
} from "./types";
import { TRANSFER_ID_EMIT_THEN_REGISTER_PAYMENT } from "@/features/boletas/constants/emitThenRegisterPayment";
import { normalizePeruPhone, isValidPeruPhone, normalizePhoneKey } from "@/features/operaciones/utils";

// API-backed store that syncs with Firebase via Next.js API routes
type Listener = () => void;

class Store {
  private reservations: Reservation[] = [];
  private blockedSlots: BlockedSlot[] = [];
  private blockRules: BlockRule[] = [];
  private automatedNumbers: AutomatedNumber[] = [];
  private users: User[] = [];
  private invoices: Invoice[] = [];
  private listeners: Set<Listener> = new Set();
  private loaded = { reservations: false, blockedSlots: false, blockRules: false, automatedNumbers: false, users: false, invoices: false };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notifyScheduled = false;
  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.listeners.forEach((l) => l());
    });
  }

  // Reservations
  getReservations() {
    return this.reservations;
  }

  isLoaded(key: keyof typeof this.loaded) {
    return this.loaded[key];
  }

  async fetchReservations(filters?: { date?: string; court_type?: string; status?: string }) {
    try {
      const params = new URLSearchParams();
      if (filters?.date) params.set("date", filters.date);
      if (filters?.court_type) params.set("court_type", filters.court_type);
      if (filters?.status) params.set("status", filters.status);

      const res = await fetch(`/api/reservations?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      this.reservations = await res.json();
      this.loaded.reservations = true;
      this.notify();
    } catch (error) {
      console.error("Error fetching reservations:", error);
    }
  }

  async updateReservationStatus(id: string, status: Reservation["status"]) {
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("Failed to update");

      this.reservations = this.reservations.map((r) =>
        r.id === id
          ? {
            ...r,
            status,
            ...(status === "confirmed"
              ? { confirmed: true, confirmed_at: new Date().toISOString() }
              : {}),
          }
          : r
      );
      this.notify();
      return true;
    } catch (error) {
      console.error("Error updating reservation:", error);
      return false;
    }
  }

  async cancelReservation(id: string) {
    return this.updateReservationStatus(id, "cancelled");
  }

  async sendPaymentReminder(reservation: Reservation, amountToCharge: number) {
    try {
      const res = await fetch("/api/send-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: reservation.chat_id,
          court_type: reservation.court_type,
          field: reservation.field,
          date: reservation.date,
          time_slots: reservation.time_slots,
          total_price: reservation.total_price,
          amount_paid: reservation.amount_paid || 0,
          amount_to_charge: amountToCharge,
        }),
      });
      if (!res.ok) throw new Error("Failed to send reminder");
      return true;
    } catch (error) {
      console.error("Error sending reminder:", error);
      return false;
    }
  }

  // Blocked Slots
  getBlockedSlots() {
    return this.blockedSlots;
  }

  async fetchBlockedSlots(filters?: { date?: string; court_type?: string }) {
    try {
      const params = new URLSearchParams();
      if (filters?.date) params.set("date", filters.date);
      if (filters?.court_type) params.set("court_type", filters.court_type);

      const res = await fetch(`/api/blocked-slots?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      this.blockedSlots = await res.json();
      this.loaded.blockedSlots = true;
      this.notify();
    } catch (error) {
      console.error("Error fetching blocked slots:", error);
    }
  }

  async addBlockedSlot(slot: Omit<BlockedSlot, "id" | "created_at">) {
    try {
      const res = await fetch("/api/blocked-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slot),
      });
      if (!res.ok) throw new Error("Failed to create");
      const { id } = await res.json();

      const newSlot: BlockedSlot = {
        ...slot,
        id,
        created_at: new Date().toISOString(),
      };
      this.blockedSlots = [...this.blockedSlots, newSlot];
      this.notify();
      return newSlot;
    } catch (error) {
      console.error("Error blocking slot:", error);
      return null;
    }
  }

  async removeBlockedSlot(id: string) {
    try {
      const res = await fetch(`/api/blocked-slots?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");

      this.blockedSlots = this.blockedSlots.filter((s) => s.id !== id);
      this.notify();
      return true;
    } catch (error) {
      console.error("Error removing blocked slot:", error);
      return false;
    }
  }

  // Block Rules
  getBlockRules() {
    return this.blockRules;
  }

  async fetchBlockRules() {
    try {
      const cleanup = !this.loaded.blockRules ? "1" : "0";
      const res = await fetch(`/api/block-rules?cleanup=${cleanup}`);
      if (!res.ok) throw new Error("Failed to fetch");
      this.blockRules = await res.json();
      this.loaded.blockRules = true;
      this.notify();
    } catch (error) {
      console.error("Error fetching block rules:", error);
    }
  }

  async addBlockRule(rule: { fields: number[]; time_from: string; time_to: string; mode: string; dates: string[]; reason: string; contact_phone?: string; contact_name?: string; contact_dni?: string }) {
    try {
      const res = await fetch("/api/block-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (!res.ok) throw new Error("Failed to create");
      const data = await res.json();
      await this.fetchBlockRules();
      await this.fetchBlockedSlots();
      return data;
    } catch (error) {
      console.error("Error creating block rule:", error);
      return null;
    }
  }

  async removeBlockRule(id: string) {
    try {
      const res = await fetch(`/api/block-rules?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      this.blockRules = this.blockRules.filter((r) => r.id !== id);
      this.blockedSlots = this.blockedSlots.filter((s) => s.rule_id !== id);
      this.notify();
      return true;
    } catch (error) {
      console.error("Error removing block rule:", error);
      return false;
    }
  }

  // Users
  getUsers() {
    return this.users;
  }

  async fetchUsers() {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      this.users = await res.json();
      this.loaded.users = true;
      this.notify();
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  }

  async toggleUserAutomation(userId: string) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return false;

    const newValue = !(user.is_automated ?? true);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, is_automated: newValue }),
      });
      if (!res.ok) throw new Error("Failed to update");

      // Si se activa el bot, también limpiamos needs_help en el estado local
      this.users = this.users.map((u) =>
        u.id === userId
          ? {
            ...u,
            is_automated: newValue,
            ...(newValue ? { needs_help: false, help_reason: undefined } : {}),
          }
          : u
      );
      this.notify();
      return true;
    } catch (error) {
      console.error("Error toggling user automation:", error);
      return false;
    }
  }

  /** Desactiva el bot para todos los usuarios con automation activa (POST bulk + refetch). */
  async deactivateAutomationForAllUsers(): Promise<{ ok: boolean; updated?: number; error?: string }> {
    try {
      const res = await fetch("/api/users/deactivate-automation-bulk", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; updated?: number; error?: string };
      if (!res.ok) {
        return { ok: false, error: typeof data.error === "string" ? data.error : "Error al actualizar" };
      }
      await this.fetchUsers();
      return { ok: true, updated: typeof data.updated === "number" ? data.updated : 0 };
    } catch (error) {
      console.error("Error deactivateAutomationForAllUsers:", error);
      return { ok: false, error: "Error de red" };
    }
  }

  async resetUser(userId: string) {
    try {
      const res = await fetch(`/api/users?id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete user");

      this.users = this.users.filter((u) => u.id !== userId);
      this.notify();
      return true;
    } catch (error) {
      console.error("Error deleting user:", error);
      return false;
    }
  }

  async updateUserCustomName(userId: string, customName: string) {
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, custom_name: customName || null }),
      });
      if (!res.ok) throw new Error("Failed to update");

      this.users = this.users.map((u) =>
        u.id === userId ? { ...u, custom_name: customName || undefined } : u
      );
      this.notify();
      return true;
    } catch (error) {
      console.error("Error updating custom name:", error);
      return false;
    }
  }

  async createUser(data: { name: string; phone: string; dni: string; client_type: ClientType }) {
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          phone: data.phone,
          dni: data.dni || undefined,
          client_type: data.client_type,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err?.error === "string" ? err.error : "Error al crear usuario");
      }
      await this.fetchUsers();
      return true;
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    }
  }

  async updateUserClientType(userId: string, clientType: ClientType) {
    try {
      const isFraud = clientType === "sospechoso_fraude";
      const body: Record<string, unknown> = { id: userId, client_type: clientType };
      if (isFraud) body.is_automated = false;

      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");

      this.users = this.users.map((u) =>
        u.id === userId
          ? { ...u, client_type: clientType, ...(isFraud ? { is_automated: false } : {}) }
          : u
      );
      this.notify();
      return true;
    } catch (error) {
      console.error("Error updating client type:", error);
      return false;
    }
  }

  async updateUserPhoneNumber(userId: string, phone: string): Promise<boolean> {
    try {
      const normalized = normalizePeruPhone(phone.replace(/\D/g, ""));
      if (!isValidPeruPhone(normalized)) return false;
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, phone_number: normalized }),
      });
      if (!res.ok) return false;
      this.users = this.users.map((u) =>
        u.id === userId ? { ...u, phone_number: normalized } : u
      );
      this.notify();
      return true;
    } catch (error) {
      console.error("Error updating user phone:", error);
      return false;
    }
  }

  async updateUserDoc(
    userId: string,
    doc: {
      last_dni?: string;
      last_ruc?: string;
      last_factura_direccion?: string;
      last_factura_razon_social?: string;
      last_note?: string | null;
    }
  ): Promise<boolean> {
    // Actualización optimista local
    const targetNorm = normalizePhoneKey(userId);

    const prevUsers = [...this.users];
    let found = false;
    let foundId: string | null = null;
    this.users = this.users.map((u) => {
      const uPhoneNorm = normalizePhoneKey(u.phone_number || u.id);
      const uChatNorm = normalizePhoneKey(u.chat_id);
      const isMatch = (targetNorm && (uPhoneNorm === targetNorm || uChatNorm === targetNorm)) || u.id === userId;
      if (isMatch) {
        found = true;
        if (!foundId) foundId = u.id;
      }
      return isMatch ? { ...u, ...doc } : u;
    });

    if (!found && doc.last_note) {
      // Si no existe en la lista local, lo agregamos para que la cuadrilla lo vea al instante
      this.users = [
        ...this.users,
        {
          id: userId,
          chat_id: userId,
          ...doc,
        } as User,
      ];
    }
    this.notify();

    // Usar el ID real del documento en Firestore (no el userId raw que puede tener formato @c.us)
    const apiId = foundId || userId;
    try {
      const body: Record<string, unknown> = { id: apiId, ...doc };
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Revertimos si falla
        this.users = prevUsers;
        this.notify();
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error updating user doc:", error);
      this.users = prevUsers;
      this.notify();
      return false;
    }
  }

  // User Reservations (para la vista expandida de un usuario)
  async fetchUserReservations(phoneNumber: string): Promise<Reservation[]> {
    try {
      const res = await fetch(`/api/reservations?phone_number=${encodeURIComponent(phoneNumber)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return await res.json();
    } catch (error) {
      console.error("Error fetching user reservations:", error);
      return [];
    }
  }

  async processManualPayment(
    reservationId: string | null,
    amount: number,
    phoneNumber: string,
    paymentMethod: "digital" | "efectivo",
    mediaUrl?: string,
    chatIdForOrphan?: string,
  ) {
    try {
      const body: Record<string, unknown> = {
        amount,
        phone_number: phoneNumber,
        payment_method: paymentMethod,
      };
      if (mediaUrl) body.media_url = mediaUrl;
      if (reservationId) {
        body.reservation_id = reservationId;
      } else if (chatIdForOrphan) {
        body.chat_id = chatIdForOrphan;
      }
      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to process payment");
      return await res.json() as {
        success: boolean;
        transfer_id: string;
        new_amount_paid?: number;
        fully_paid?: boolean;
        orphan?: boolean;
      };
    } catch (error) {
      console.error("Error processing manual payment:", error);
      return null;
    }
  }

  async revokeManualPayment(transferId: string, reservationId?: string | null) {
    try {
      const params = new URLSearchParams({ transfer_id: transferId });
      if (reservationId) {
        params.set("reservation_id", reservationId);
      }
      const res = await fetch(`/api/payments/manual?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke payment");
      return await res.json();
    } catch (error) {
      console.error("Error revoking manual payment:", error);
      return null;
    }
  }

  async syncReservationPayments(reservationId: string) {
    try {
      const res = await fetch("/api/reservations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservation_id: reservationId }),
      });
      if (!res.ok) throw new Error("Failed to sync payments");
      const result = await res.json();

      this.fetchReservations(); // Refresh reservations to update UI
      return result;
    } catch (error) {
      console.error("Error syncing payments:", error);
      return null;
    }
  }

  async fetchTransfers(reservationId: string) {
    try {
      const res = await fetch(`/api/transfers?reservation_id=${reservationId}`);
      if (!res.ok) throw new Error("Failed to fetch transfers");
      return await res.json() as import("./types").Transfer[];
    } catch (error) {
      console.error("Error fetching transfers:", error);
      return [];
    }
  }

  async fetchTransfersByChatId(chatId: string) {
    try {
      const normalized = String(chatId).replace(/\D/g, "");
      const res = await fetch(`/api/transfers?chat_id=${encodeURIComponent(normalized)}`);
      if (!res.ok) throw new Error("Failed to fetch transfers");
      return await res.json() as import("./types").Transfer[];
    } catch (error) {
      console.error("Error fetching transfers by chat_id:", error);
      return [];
    }
  }

  async fetchInvoicesByTransferIds(transferIds: string[]) {
    if (transferIds.length === 0) return [];
    try {
      const ids = transferIds.slice(0, 30).join(",");
      const res = await fetch(`/api/invoices?transfer_ids=${encodeURIComponent(ids)}`);
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return await res.json() as import("./types").Invoice[];
    } catch (error) {
      console.error("Error fetching invoices by transfer_ids:", error);
      return [];
    }
  }

  /** Todas las boletas vinculadas a transferencias del cliente (varios batches de 30). */
  async fetchInvoicesByTransferIdsAll(transferIds: string[]) {
    const unique = Array.from(new Set(transferIds.filter(Boolean)));
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) {
      chunks.push(unique.slice(i, i + 30));
    }
    if (chunks.length === 0) return [];
    try {
      const batches = await Promise.all(chunks.map((c) => this.fetchInvoicesByTransferIds(c)));
      const byId = new Map<string, import("./types").Invoice>();
      for (const arr of batches) {
        for (const inv of arr) {
          byId.set(inv.id, inv);
        }
      }
      return Array.from(byId.values());
    } catch (error) {
      console.error("Error fetching invoices by transfer_ids (all):", error);
      return [];
    }
  }

  /** Boletas/facturas donde `user_id` coincide con el cliente (incluye manuales sin transfer). */
  async fetchInvoicesByUserIds(userIds: string[]) {
    const unique = Array.from(
      new Set(userIds.map((x) => String(x).trim()).filter(Boolean))
    ).slice(0, 30);
    if (unique.length === 0) return [];
    try {
      const res = await fetch(
        `/api/invoices?user_id_in=${encodeURIComponent(unique.join(","))}`
      );
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return await res.json() as import("./types").Invoice[];
    } catch (error) {
      console.error("Error fetching invoices by user_id_in:", error);
      return [];
    }
  }

  async verifyTransfer(transferId: string, verified: boolean) {
    try {
      const res = await fetch("/api/transfers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: transferId, verified }),
      });
      return res.ok;
    } catch (error) {
      console.error("Error verifying transfer:", error);
      return false;
    }
  }

  async updateTransferApplied(transferId: string, applied: boolean) {
    try {
      const res = await fetch("/api/transfers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: transferId, applied }),
      });
      return res.ok;
    } catch (error) {
      console.error("Error updating transfer applied:", error);
      return false;
    }
  }

  // Automated Numbers
  getAutomatedNumbers() {
    return this.automatedNumbers;
  }

  async fetchAutomatedNumbers() {
    try {
      const res = await fetch("/api/automated-numbers");
      if (!res.ok) throw new Error("Failed to fetch");
      this.automatedNumbers = await res.json();
      this.loaded.automatedNumbers = true;
      this.notify();
    } catch (error) {
      console.error("Error fetching automated numbers:", error);
    }
  }

  async toggleAutomation(chatId: string) {
    const number = this.automatedNumbers.find((n) => n.chat_id === chatId);
    if (!number) return false;

    const newValue = !number.isAutomated;
    try {
      const res = await fetch("/api/automated-numbers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, isAutomated: newValue }),
      });
      if (!res.ok) throw new Error("Failed to update");

      this.automatedNumbers = this.automatedNumbers.map((n) =>
        n.chat_id === chatId ? { ...n, isAutomated: newValue } : n
      );
      this.notify();
      return true;
    } catch (error) {
      console.error("Error toggling automation:", error);
      return false;
    }
  }

  // Invoices
  getInvoices() {
    return this.invoices;
  }

  async fetchInvoices(filters?: { reservation_id?: string }) {
    try {
      const params = new URLSearchParams();
      if (filters?.reservation_id) params.set("reservation_id", filters.reservation_id);

      const res = await fetch(`/api/invoices?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      if (!filters) {
        this.invoices = data;
        this.loaded.invoices = true;
        this.notify();
      }
      return data as Invoice[];
    } catch (error) {
      console.error("Error fetching invoices:", error);
      return [];
    }
  }

  async emitInvoice(
    reservation: Reservation,
    transfer: { id: string; amount: number } | undefined,
    params: EmitComprobanteParams
  ): Promise<Invoice> {
    try {
      const amountToBill = typeof params.amount === "number" && params.amount > 0
        ? params.amount
        : (transfer?.amount || reservation.total_price);

      const transferIdForApi =
        transfer?.id && transfer.id !== TRANSFER_ID_EMIT_THEN_REGISTER_PAYMENT ? transfer.id : undefined;

      const body: Record<string, unknown> = {
        reservation_id: reservation.id,
        user_id: reservation.chat_id,
        phone_number: reservation.phone_number,
        amount: amountToBill,
        court_type: reservation.court_type,
        field: reservation.field,
        date: reservation.date,
        time_slots: reservation.time_slots,
        representative_name: reservation.representative_name,
        tipo_comprobante: params.tipo_comprobante,
        doc_num: params.doc_num,
      };
      if (transferIdForApi) body.transfer_id = transferIdForApi;
      if (params.cliente_denominacion?.trim()) body.cliente_denominacion = params.cliente_denominacion.trim();
      if (params.descripcion?.trim()) body.descripcion = params.descripcion.trim();
      if (params.fecha_de_emision?.trim()) body.fecha_de_emision = params.fecha_de_emision.trim();
      if (params.hora_de_emision?.trim()) body.hora_de_emision = params.hora_de_emision.trim();
      if (params.condicion_venta?.trim()) body.condicion_venta = params.condicion_venta.trim();
      if (params.cliente_direccion?.trim()) body.cliente_direccion = params.cliente_direccion.trim();
      if (params.forma_pago_banco?.trim()) body.forma_pago_banco = params.forma_pago_banco.trim();
      if (params.forma_pago_cuenta?.trim()) body.forma_pago_cuenta = params.forma_pago_cuenta.trim();

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      const result = await res.json();
      if (!res.ok) {
        const msg = result?.error || "Error desconocido al emitir boleta";
        throw new Error(msg);
      }

      // Add to local state so UI updates immediately (mismos campos que guarda Firestore)
      const newInvoice: Invoice = {
        id: result.invoice_id,
        reservation_id: reservation.id,
        user_id: reservation.chat_id,
        phone_number: reservation.phone_number,
        file_url: result.file_url,
        file_url_sunat:
          typeof result.file_url_sunat === "string" && result.file_url_sunat.trim()
            ? result.file_url_sunat.trim()
            : undefined,
        file_url_xml:
          typeof result.file_url_xml === "string" && result.file_url_xml.trim()
            ? result.file_url_xml.trim()
            : undefined,
        amount: amountToBill,
        court_type: reservation.court_type,
        field: reservation.field ?? null,
        date: reservation.date,
        time_slots: reservation.time_slots,
        transfer_id: transferIdForApi ?? null,
        status: "emitted",
        created_at: new Date().toISOString(),
        descripcion: typeof result.descripcion === "string" ? result.descripcion : undefined,
        cliente_denominacion:
          typeof result.cliente_denominacion === "string" ? result.cliente_denominacion : undefined,
        cliente_numero_de_documento:
          typeof result.cliente_numero_de_documento === "string" ? result.cliente_numero_de_documento : undefined,
        cliente_tipo_documento:
          typeof result.cliente_tipo_documento === "string" ? result.cliente_tipo_documento : undefined,
        representative_name_snapshot:
          typeof result.representative_name_snapshot === "string" ? result.representative_name_snapshot : undefined,
        tipo_comprobante:
          result.tipo_comprobante === "factura" || params.tipo_comprobante === "factura"
            ? "factura"
            : "boleta",
        serie_correlativo:
          typeof result.serie_correlativo === "string" ? result.serie_correlativo : undefined,
        sunat_estado:
          typeof result.sunat_estado === "string" && result.sunat_estado.trim()
            ? result.sunat_estado.trim()
            : undefined,
        condicion_venta:
          typeof result.condicion_venta === "string" ? result.condicion_venta : params.condicion_venta?.trim(),
        forma_pago_banco:
          typeof result.forma_pago_banco === "string" && result.forma_pago_banco.trim()
            ? result.forma_pago_banco.trim()
            : params.forma_pago_banco?.trim(),
        forma_pago_cuenta:
          typeof result.forma_pago_cuenta === "string" && result.forma_pago_cuenta.trim()
            ? result.forma_pago_cuenta.trim()
            : params.forma_pago_cuenta?.trim(),
        cliente_direccion:
          typeof result.cliente_direccion === "string" && result.cliente_direccion.trim()
            ? result.cliente_direccion.trim()
            : params.cliente_direccion?.trim(),
      };

      this.invoices = [...this.invoices, newInvoice];
      this.notify();

      return newInvoice;
    } catch (error) {
      console.error("Error emitting invoice:", error);
      throw error;
    }
  }

  async linkInvoiceToTransfer(invoiceId: string, transferId: string): Promise<boolean> {
    try {
      const res = await fetch("/api/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, transfer_id: transferId }),
      });
      if (!res.ok) return false;
      this.invoices = this.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, transfer_id: transferId } : inv
      );
      this.notify();
      return true;
    } catch (e) {
      console.error("Error linking invoice to transfer:", e);
      return false;
    }
  }

  async emitInvoiceManual(
    user: { id: string; phone_number?: string; custom_name?: string; contact_name?: string; last_representative_name?: string },
    params: EmitComprobanteParams & { amount: number }
  ) {
    try {
      const body: Record<string, unknown> = {
        manual: true,
        reservation_id: "manual",
        user_id: user.id,
        phone_number: user.phone_number || user.id,
        amount: params.amount,
        court_type: "",
        field: null,
        date: "",
        time_slots: [],
        representative_name: params.cliente_denominacion || user.custom_name || user.contact_name || user.last_representative_name || "CLIENTE GENERAL",
        transfer_id: null,
        tipo_comprobante: params.tipo_comprobante,
        doc_num: params.doc_num,
      };
      if (params.cliente_denominacion?.trim()) body.cliente_denominacion = params.cliente_denominacion.trim();
      if (params.descripcion?.trim()) body.descripcion = params.descripcion.trim();
      if (params.fecha_de_emision?.trim()) body.fecha_de_emision = params.fecha_de_emision.trim();
      if (params.hora_de_emision?.trim()) body.hora_de_emision = params.hora_de_emision.trim();
      if (params.condicion_venta?.trim()) body.condicion_venta = params.condicion_venta.trim();
      if (params.cliente_direccion?.trim()) body.cliente_direccion = params.cliente_direccion.trim();
      if (params.forma_pago_banco?.trim()) body.forma_pago_banco = params.forma_pago_banco.trim();
      if (params.forma_pago_cuenta?.trim()) body.forma_pago_cuenta = params.forma_pago_cuenta.trim();

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result?.error || "Error al emitir boleta");
      }
      return result;
    } catch (error) {
      console.error("Error emitting manual invoice:", error);
      throw error;
    }
  }

  async updateReservationDni(id: string, dni: string) {
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dni }),
      });
      if (!res.ok) throw new Error("Failed to update DNI");
      this.reservations = this.reservations.map((r) => (r.id === id ? { ...r, dni } : r));
      this.notify();
      return true;
    } catch (error) {
      console.error("Error updating reservation DNI:", error);
      return false;
    }
  }

  async deleteReservationHard(id: string) {
    try {
      const res = await fetch(`/api/reservations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete reservation");
      this.reservations = this.reservations.filter((r) => r.id !== id);
      this.notify();
      return true;
    } catch (error) {
      console.error("Error deleting reservation:", error);
      return false;
    }
  }

  async sendInvoiceWhatsApp(chatId: string, fileUrl: string) {
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, file_url: fileUrl }),
      });
      if (!res.ok) throw new Error("Failed to send invoice");
      return true;
    } catch (error) {
      console.error("Error sending invoice via WhatsApp:", error);
      return false;
    }
  }
}

export const store = new Store();
