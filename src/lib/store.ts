import type { Reservation, BlockedSlot, AutomatedNumber, User } from "./types";

// API-backed store that syncs with Firebase via Next.js API routes
type Listener = () => void;

class Store {
  private reservations: Reservation[] = [];
  private blockedSlots: BlockedSlot[] = [];
  private automatedNumbers: AutomatedNumber[] = [];
  private users: User[] = [];
  private listeners: Set<Listener> = new Set();
  private loaded = { reservations: false, blockedSlots: false, automatedNumbers: false, users: false };

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
        r.id === id ? { ...r, status } : r
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

  async sendPaymentReminder(reservation: Reservation) {
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

  async processManualPayment(reservationId: string, amount: number, phoneNumber: string) {
    try {
      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: reservationId,
          amount,
          phone_number: phoneNumber,
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
}

export const store = new Store();
