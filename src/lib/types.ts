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
  "6:00", "7:00", "8:00", "9:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
  "19:00", "20:00", "21:00", "22:00",
];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  cancelled: "Cancelado",
};

// Usuarios: colección users. Atributos denormalizados para evitar queries anidadas.
export type ClientType = "indeciso" | "buen_cliente" | "cliente_problematico" | "sospechoso_fraude" | null;

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

export const CLIENT_TYPE_LABELS: Record<NonNullable<ClientType>, string> = {
  indeciso: "Indeciso",
  buen_cliente: "Buen cliente",
  cliente_problematico: "Cliente problemático",
  sospechoso_fraude: "Sospechoso de fraude",
};

// Transferencias: colección transfers. Registro de todos los pagos procesados.
export type TransferStatus = "applied" | "rejected_duplicate" | "partial";

/** Origen del pago: chatbot (comprobante digital) o manual (cobro presencial). */
export type PaymentSource = "chatbot" | "manual";

export interface Transfer {
  id: string;
  /** Número de WhatsApp del usuario que hizo la transferencia. */
  phone_number: string;
  /** Nombre del destinatario extraído del comprobante. */
  recipient_name: string | null;
  /** Monto transferido. */
  amount: number | null;
  /** Fecha de la transacción extraída del comprobante (YYYY-MM-DD). */
  transaction_date: string | null;
  /** Número de operación único del comprobante. */
  operation_id: string | null;
  /** ID de la reserva a la que se aplicó el pago. */
  reservation_id: string | null;
  /** Estado: applied (aplicado), rejected_duplicate (duplicado), partial (pago parcial). */
  status: TransferStatus;
  /** Origen: "chatbot" (pago digital con comprobante) o "manual" (cobro presencial en la bombonera). */
  source: PaymentSource;
  /** Fecha de creación del registro. */
  created_at: string;
}

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  applied: "Aplicado",
  rejected_duplicate: "Duplicado rechazado",
  partial: "Pago parcial",
};
