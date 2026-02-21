import type { Reservation, BlockedSlot, AutomatedNumber, User, Invoice, ClientType } from "./types";

// API-backed store that syncs with Firebase via Next.js API routes
type Listener = () => void;

class Store {
  private reservations: Reservation[] = [];
  private blockedSlots: BlockedSlot[] = [];
  private automatedNumbers: AutomatedNumber[] = [];
  private users: User[] = [];
  private invoices: Invoice[] = [];
  private listeners: Set<Listener> = new Set();
  private loaded = { reservations: false, blockedSlots: false, automatedNumbers: false, users: false, invoices: false };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    this.listeners.forEach((l) => l());
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
            ...(status === "paid"
              ? { amount_paid: r.total_price, confirmed: true, confirmed_at: new Date().toISOString() }
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

  // Users
  getUsers() {
    return this.users;
  }

  async fetchUsers() {
    try {
      const res = await fetch("/api/users");
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

  async resetUser(userId: string) {
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId }),
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
    reservationId: string,
    amount: number,
    phoneNumber: string,
    paymentMethod: "digital" | "efectivo",
    mediaUrl?: string,
  ) {
    try {
      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: reservationId,
          amount,
          phone_number: phoneNumber,
          payment_method: paymentMethod,
          media_url: mediaUrl,
        }),
      });
      if (!res.ok) throw new Error("Failed to process payment");
      return await res.json() as {
        success: boolean;
        transfer_id: string;
        new_amount_paid: number;
        fully_paid: boolean;
      };
    } catch (error) {
      console.error("Error processing manual payment:", error);
      return null;
    }
  }

  async revokeManualPayment(transferId: string, reservationId: string) {
    try {
      const res = await fetch(`/api/payments/manual?transfer_id=${transferId}&reservation_id=${reservationId}`, {
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

  async emitInvoice(reservation: Reservation, transfer?: { id: string; amount: number }) {
    try {
      const amountToBill = transfer?.amount || reservation.total_price;

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: reservation.id,
          user_id: reservation.chat_id,
          phone_number: reservation.phone_number,
          amount: amountToBill,
          court_type: reservation.court_type,
          date: reservation.date,
          time_slots: reservation.time_slots,
          representative_name: reservation.representative_name,
          transfer_id: transfer?.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to emit invoice");
      const result = await res.json() as {
        success: boolean;
        invoice_id: string;
        file_url: string;
      };

      // Add to local state so UI updates immediately
      const newInvoice: Invoice = {
        id: result.invoice_id,
        reservation_id: reservation.id,
        user_id: reservation.chat_id,
        phone_number: reservation.phone_number,
        file_url: result.file_url,
        amount: amountToBill,
        court_type: reservation.court_type,
        date: reservation.date,
        transfer_id: transfer?.id, // Ensure Invoice type has this optional field or cast it
        status: "emitted",
        created_at: new Date().toISOString(),
      } as Invoice; // Casting in case type definition is outdated

      this.invoices = [...this.invoices, newInvoice];
      this.notify();

      return result;
    } catch (error) {
      console.error("Error emitting invoice:", error);
      return null;
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
