export type CourtType = "voley_6v6" | "voley_basket_6v6" | "voley_5v5" | "voley_basket_5v5";

export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "expired" | "paid";

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
  /**
   * Si true, `amount_paid` no se recalcula desde transferencias (sync / reglas automáticas).
   * Se activa al editar Pagado/Deuda desde el panel.
   */
  amount_paid_manual?: boolean;
  /** Si la reserva está confirmada (pagó al menos el mínimo). */
  confirmed?: boolean;
  /** Cuándo se confirmó la reserva. */
  confirmed_at?: string;
  /** Nombre del representante/responsable de la reserva. */
  representative_name?: string;
  /** DNI del representante (usado para reservas manuales y emisión de boletas). */
  dni?: string;
  /** Si el cliente ya llegó a la cancha. */
  arrived?: boolean;
  /** Si la reserva fue auto-confirmada (cliente recurrente). */
  auto_confirmed?: boolean;
  /** Si el admin marcó como pendiente manualmente. No expira automáticamente. */
  manual_pending?: boolean;
  /** Si la reserva es parte de una cadena recurrente (dueño del horario). */
  is_recurrent?: boolean;
}

export interface RecurrentSchedule {
  id: string; // Document ID: day_field_time (ej. 1_3_19:00)
  chat_id: string;
  representative_name: string;
  field: number;
  day_of_week: number;
  start_time: string;
  last_reservation_id: string;
  created_at: string;
}

export interface BlockedSlot {
  id: string;
  court_type: CourtType;
  field: number;
  date: string;
  time_slot: string;
  reason: string;
  rule_id?: string;
  created_at: string;
}

export interface BlockRule {
  id: string;
  fields: number[];
  time_from: string;
  time_to: string;
  mode: "single" | "recurring";
  /** Fechas concretas que cubre esta regla. */
  dates: string[];
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

/** Fallback para mostrar tamaño cuando no hay court config (por court_type). */
export const COURT_TYPE_TO_SIZE: Record<CourtType, string> = {
  voley_6v6: "6 vs 6",
  voley_basket_6v6: "6 vs 6",
  voley_5v5: "5 vs 5",
  voley_basket_5v5: "5 vs 5",
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
  confirmed: "Confirmada",
  cancelled: "Cancelado",
  expired: "Expirado",
  paid: "Pagado",
};

export const PENDING_EXPIRY_MS = 30 * 60 * 1000;

/** Reserva activa = confirmed (o paid legacy), o pending con menos de 30 min (o manual_pending) */
export function isReservationActive(r: Reservation): boolean {
  if (r.status === "confirmed" || r.status === "paid") return true;
  if (r.status !== "pending") return false;
  if (r.manual_pending) return true;
  const created = new Date(r.created_at).getTime();
  return Date.now() - created < PENDING_EXPIRY_MS;
}

/** Minutos restantes hasta que una reserva pending expire (cron cleanup). 0 si manual_pending, ya expiró o no es pending. */
export function getPendingExpiryMinutes(r: Reservation): number {
  if (r.status !== "pending" || r.manual_pending) return 0;
  const created = new Date(r.created_at).getTime();
  const elapsed = Date.now() - created;
  if (elapsed >= PENDING_EXPIRY_MS) return 0;
  return Math.max(1, Math.ceil((PENDING_EXPIRY_MS - elapsed) / 60000));
}

/** Hora límite (ej. "5:30 pm") hasta la cual el cliente puede confirmar. null si manual_pending, no es pending o ya expiró. */
export function getPendingExpiryTimeFormatted(r: Reservation): string | null {
  if (r.status !== "pending" || r.manual_pending) return null;
  const created = new Date(r.created_at).getTime();
  const expiryMs = created + PENDING_EXPIRY_MS;
  if (Date.now() >= expiryMs) return null;
  const d = new Date(expiryMs);
  const h = d.getHours();
  const m = d.getMinutes();
  const isPm = h >= 12;
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${isPm ? "pm" : "am"}`;
}

// Usuarios: colección users. Atributos denormalizados para evitar queries anidadas.
export type ClientType = "casual" | "frecuente" | "academia" | "sospechoso_fraude";

export interface User {
  id: string; // document id = chat_id normalizado (número WA)
  chat_id: string;
  phone_number?: string;
  /** Nombre del contacto en WhatsApp (pushName). */
  contact_name?: string;
  /** Alias explícito del nombre recibido desde WhatsApp (pushName). */
  push_name?: string;
  /** Nombre personalizado asignado desde el panel admin. */
  custom_name?: string;
  /** Último nombre usado al crear reserva. */
  last_representative_name?: string;
  /** Último DNI usado al crear reserva o emitir boleta. */
  last_dni?: string;
  /** Timestamp de la última interacción (mensaje enviado/recibido o reserva). Usado para ordenar la lista de contactos. */
  last_interaction_at?: string;
  /** Último RUC usado al emitir factura. */
  last_ruc?: string;
  /** Última dirección fiscal usada en factura (panel / SUNAT), para autocompletar. */
  last_factura_direccion?: string;
  /** Última razón social SUNAT guardada junto al RUC, para autocompletar. */
  last_factura_razon_social?: string;
  /** Número de veces que ha reservado (denormalizado en users para query eficiente). */
  reservation_count: number;
  /** Saldo: negativo = debe dinero; positivo = canceló a tiempo (crédito). */
  balance: number;
  client_type: ClientType;
  /** Si el bot responde automáticamente (true) o un humano debe responder (false). Default: true */
  is_automated?: boolean;
  /** Si el usuario necesita atención humana (el bot solicitó ayuda). */
  needs_help?: boolean;
  /** Razón por la que se solicitó ayuda humana. */
  help_reason?: string;
  /** Fecha de registro inicial en el sistema. */
  created_at?: string;
  /** URL de la foto de perfil en Firebase Storage. */
  profile_picture?: string;
  /** El contenido del último apunte (nota) registrado para este cliente. */
  last_note?: string;
}

export interface Note {
  id: string;
  content: string;
  created_at: string;
}

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  casual: "Casual",
  frecuente: "Frecuente / Casero",
  academia: "Academia / Negocio",
  sospechoso_fraude: "Peligro de fraude",
};

// Boletas: colección invoices. Registro de boletas emitidas.
export interface Invoice {
  id: string;
  reservation_id: string;
  user_id: string;
  phone_number: string;
  file_url: string;
  /** PDF ticket oficial apisunat en Storage (misma emisión que file_url plantilla). */
  file_url_sunat?: string | null;
  /** XML UBL firmado en Storage (emisión SUNAT). */
  file_url_xml?: string | null;
  /** URL temporal apisunat (p. ej. comprobantes antiguos). */
  sunat_pdf_ticket?: string | null;
  /** Condición de venta mostrada en el PDF del panel. */
  condicion_venta?: string;
  /** Depósito: banco donde la empresa emisora recibe el pago (PDF formal). */
  forma_pago_banco?: string;
  /** Depósito: cuenta o CCI de la empresa emisora (PDF formal). */
  forma_pago_cuenta?: string;
  /** Fecha de emisión del CPE (AAAA-MM-DD), misma que SUNAT. */
  fecha_emision_ymd?: string;
  /** Hora de emisión del CPE (HH:mm:ss), misma que SUNAT. */
  hora_emision_hms?: string;
  /** Hash del comprobante (QR / validación). */
  sunat_hash?: string | null;
  /** Serie SUNAT (ej. B001). */
  serie?: string;
  correlativo?: number;
  preview_url?: string;
  amount: number;
  court_type: string;
  /** Cancha (copiado al emitir). */
  field?: number | null;
  date: string;
  /** Franjas (copiadas al emitir). */
  time_slots?: string[];
  transfer_id?: string | null;
  status: string;
  created_at: string;
  /** Si no viene en docs antiguos, se asume boleta. */
  tipo_comprobante?: "boleta" | "factura";
  /** Ej. B001-123 desde SUNAT. */
  serie_correlativo?: string;
  /** Si se guarda en Firestore (emisión futura o migración). */
  descripcion?: string;
  /** Razón social / nombre en el comprobante SUNAT (emisión reciente). */
  cliente_denominacion?: string;
  /** DNI (8) o RUC (11) del receptor en SUNAT. */
  cliente_numero_de_documento?: string;
  /** "1" boleta (DNI), "6" factura (RUC). */
  cliente_tipo_documento?: string;
  /** Dirección fiscal del receptor (factura). */
  cliente_direccion?: string;
  /**
   * Nombre del representante en la reserva al emitir (no confundir con WhatsApp).
   * Útil si faltaba cliente_denominacion en datos viejos o para auditoría.
   */
  representative_name_snapshot?: string;
  /** SUNAT / apisunat tras emisión o anulación: ACEPTADO | PENDIENTE | RECHAZADO (mayúsculas al guardar desde API). */
  sunat_estado?: string | null;
  /** ISO si se anuló vía apisunat (comunicación de baja / resumen diario). */
  voided_at?: string;
  void_motivo?: string;
}

/** Formulario emitir boleta/factura → cuerpo hacia POST /api/invoices */
export type EmitComprobanteParams = {
  tipo_comprobante: "boleta" | "factura";
  doc_num: string;
  cliente_denominacion?: string;
  descripcion?: string;
  amount?: number;
  /** AAAA-MM-DD (Lima) */
  fecha_de_emision?: string;
  /** HH:mm o HH:mm:ss (Lima) */
  hora_de_emision?: string;
  /** Texto en el PDF formal (Cond. Venta); apisunat puede seguir mostrando “Contado” si no expone el campo. */
  condicion_venta?: string;
  /** Factura: dirección del receptor en SUNAT y en el PDF formal. */
  cliente_direccion?: string;
  /** Depósito: banco emisor (cuenta de cobro de la empresa, no del cliente). */
  forma_pago_banco?: string;
  /** Depósito: cuenta o CCI emisor. */
  forma_pago_cuenta?: string;
};

// Transferencias: colección transfers. Registro de todos los pagos procesados.
export type TransferStatus = "applied" | "rejected_duplicate" | "partial";

/** Origen del pago: chatbot (comprobante digital), manual (cobro presencial) o manual_adjustment (ajuste de monto). */
export type PaymentSource = "chatbot" | "manual" | "manual_adjustment";

/** Método de pago: digital (transferencia, Yape, depósito…) o efectivo. */
export type PaymentMethod = "digital" | "efectivo";

export interface Transfer {
  id: string;
  phone_number: string;
  recipient_name: string | null;
  amount: number | null;
  transaction_date: string | null;
  /** Hora declarada del abono (HH:mm), si la cargó el admin al registrar. */
  transaction_time?: string | null;
  operation_id: string | null;
  reservation_id: string | null;
  /** chat_id del cliente (de la reserva). Para consultar transfers por cliente. */
  chat_id?: string | null;
  status: TransferStatus;
  source: PaymentSource;
  payment_method: PaymentMethod;
  /** URL de la imagen del comprobante. Obligatoria en chatbot, opcional en manual-digital. */
  media_url?: string | null;
  verified?: boolean;
  verified_at?: string;
  /** Marca manual: "ya usado para marcar una reserva" (evitar usarlo dos veces). */
  applied?: boolean;
  created_at: string;
  /**
   * Solo en respuestas de `GET /api/transfers?list=all`: enriquecimiento desde `users`
   * para listados (búsqueda por nombre / DNI). No se persiste en Firestore.
   */
  client_display_name?: string;
  client_last_dni?: string;
}

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  applied: "Íntegro (cierra el saldo de la reserva)",
  rejected_duplicate: "Rechazado: comprobante duplicado",
  partial: "Parcial (aún hay saldo en la reserva)",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  digital: "Digital",
  efectivo: "Efectivo",
};

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  chatbot: "Comprobante (chat)",
  manual: "Caja",
  manual_adjustment: "Ajuste manual",
};

export type BotHealthIndicator = "green" | "red";

export interface BotHealthStatus {
  indicator: BotHealthIndicator;
  status: "ok" | "error" | "unknown";
  title: string;
  detail: string;
  is_stale: boolean;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  cron_schedule: string;
}

/** Respuesta de GET /api/{sesión}/auth/qr en WAHA (proxy: /api/waha/qr). */
export interface WahaQrImage {
  mimetype: string;
  data: string;
}

/** Cuenta vinculada cuando la sesión WAHA está activa. */
export interface WahaSessionUser {
  id: string;
  pushName?: string | null;
}

/** Estado de sesión WAHA (proxy: /api/waha/session). */
export interface WahaSession {
  name: string;
  status: string;
  me: WahaSessionUser | null;
}

/** Registro de dueño de un horario recurrente/fijo. */
export interface RecurrentSchedule {
  day_of_week: number;
  field: number;
  start_time: string;
  chat_id: string;
  representative_name: string;
}
