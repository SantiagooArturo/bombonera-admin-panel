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
  reservation_price?: number;
  phone_number: string;
  /** Cuánto ha pagado el usuario hasta ahora. */
  amount_paid?: number;
  /** Si la reserva está confirmada (pagó al menos el mínimo). */
  confirmed?: boolean;
  /** Cuándo se confirmó la reserva. */
  confirmed_at?: string;
  /** Nombre del representante/responsable de la reserva. */
  representative_name?: string;
  /** Si el cliente ya llegó a la cancha. */
  arrived?: boolean;
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
  "8:00", "9:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
  "19:00", "20:00", "21:00", "22:00",
];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  cancelled: "Cancelado",
};

// Usuarios: colección users. Atributos denormalizados para evitar queries anidadas.
export type ClientType = "recurrente" | "indeciso" | "sospechoso_fraude" | null;

export interface User {
  id: string; // document id = chat_id normalizado (número WA)
  chat_id: string;
  phone_number?: string;
  /** Número de veces que ha reservado (denormalizado en users para query eficiente). */
  reservation_count: number;
  /** Saldo: negativo = debe dinero; positivo = canceló a tiempo (crédito). */
  balance: number;
  /** Tipo de cliente (lógica por implementar). */
  client_type: ClientType;
  /** Si el bot responde automáticamente (true) o un humano debe responder (false). Default: true */
  is_automated?: boolean;
  /** Si el usuario necesita atención humana (el bot solicitó ayuda). */
  needs_help?: boolean;
  /** Razón por la que se solicitó ayuda humana. */
  help_reason?: string;
}

export const CLIENT_TYPE_LABELS: Record<string, string> = {
  recurrente: "Recurrente",
  indeciso: "Indeciso",
  sospechoso_fraude: "Peligro de fraude",
};

// Boletas: colección invoices. Registro de boletas emitidas.
export interface Invoice {
  id: string;
  reservation_id: string;
  user_id: string;
  phone_number: string;
  file_url: string;
  amount: number;
  court_type: string;
  date: string;
  transfer_id?: string;
  status: string;
  created_at: string;
}

// Transferencias: colección transfers. Registro de todos los pagos procesados.
export type TransferStatus = "applied" | "rejected_duplicate" | "partial";

/** Origen del pago: chatbot (comprobante digital) o manual (cobro presencial). */
export type PaymentSource = "chatbot" | "manual";

/** Método de pago: digital (transferencia, Yape, depósito…) o efectivo. */
export type PaymentMethod = "digital" | "efectivo";

export interface Transfer {
  id: string;
  phone_number: string;
  recipient_name: string | null;
  amount: number | null;
  transaction_date: string | null;
  operation_id: string | null;
  reservation_id: string | null;
  status: TransferStatus;
  source: PaymentSource;
  payment_method: PaymentMethod;
  /** URL de la imagen del comprobante. Obligatoria en chatbot, opcional en manual-digital. */
  media_url?: string | null;
  verified?: boolean;
  verified_at?: string;
  created_at: string;
}

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  applied: "Aplicado",
  rejected_duplicate: "Duplicado rechazado",
  partial: "Pago parcial",
};
