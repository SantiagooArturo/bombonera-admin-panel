export type CourtType = "voley_6v6" | "voley_basket_6v6" | "voley_5v5" | "voley_basket_5v5";

export type ReservationStatus = "pending" | "paid" | "cancelled";

export interface Reservation {
  id: string;
  chat_id: string;
  court_type: CourtType;
  field: number | null;
  date: string; // YYYY-MM-DD
  time_slots: string[]; // ["7:00", "8:00"]
  time_ranges: { start: string; end: string; slot: string }[];
  slot_keys: string[];
  created_at: string;
  status: ReservationStatus;
  total_price: number;
  phone_number: string;
}

export interface BlockedSlot {
  id: string;
  court_type: CourtType;
  field: number;
  date: string;
  time_slot: string;
  reason: string;
  created_at: string;
}

export interface AutomatedNumber {
  chat_id: string;
  phone_number: string;
  isAutomated: boolean;
  name?: string;
}

export const COURT_LABELS: Record<CourtType, string> = {
  voley_6v6: "Campo 6 vs 6 voley (campos 1, 2, 3, 8, 10, 11, 12)",
  voley_basket_6v6: "Campo 6 vs 6 voley-basket (campo 4)",
  voley_5v5: "Campo 5 vs 5 voley maple (campos 5, 6, 7)",
  voley_basket_5v5: "Campo 5 vs 5 voley-basket (campo 9)",
};

export const COURT_FIELDS: Record<CourtType, number[]> = {
  voley_6v6: [1, 2, 3, 8, 10, 11, 12],
  voley_basket_6v6: [4],
  voley_5v5: [5, 6, 7],
  voley_basket_5v5: [9],
};

export const TIME_SLOTS = [
  "6:00", "7:00", "8:00", "9:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
  "19:00", "20:00", "21:00", "22:00",
];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  cancelled: "Cancelado",
};
