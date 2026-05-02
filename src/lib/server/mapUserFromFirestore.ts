import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { User, ClientType } from "@/lib/types";

export function mapQueryDocToUser(doc: QueryDocumentSnapshot<DocumentData>): User {
  const data = doc.data();
  const id = doc.id;
  const balance = data.balance;
  const reservationCount = data.reservation_count;
  const clientType = data.client_type;
  const isAutomated = data.is_automated;
  const needsHelp = data.needs_help;
  const helpReason = data.help_reason;

  return {
    id,
    chat_id: data.chat_id ?? id,
    phone_number: data.phone_number ?? undefined,
    contact_name: typeof data.contact_name === "string" ? data.contact_name : undefined,
    push_name: typeof data.push_name === "string" ? data.push_name : undefined,
    custom_name: typeof data.custom_name === "string" ? data.custom_name : undefined,
    last_representative_name:
      typeof data.last_representative_name === "string" ? data.last_representative_name : undefined,
    last_dni: typeof data.last_dni === "string" ? data.last_dni : undefined,
    last_ruc: typeof data.last_ruc === "string" ? data.last_ruc : undefined,
    last_factura_direccion:
      typeof data.last_factura_direccion === "string" ? data.last_factura_direccion : undefined,
    last_factura_razon_social:
      typeof data.last_factura_razon_social === "string" ? data.last_factura_razon_social : undefined,
    reservation_count: typeof reservationCount === "number" ? reservationCount : 0,
    balance: typeof balance === "number" ? balance : 0,
    client_type: (clientType === "casual" ||
    clientType === "frecuente" ||
    clientType === "academia" ||
    clientType === "sospechoso_fraude"
      ? clientType
      : "casual") as ClientType,
    is_automated: typeof isAutomated === "boolean" ? isAutomated : true,
    needs_help: typeof needsHelp === "boolean" ? needsHelp : false,
    help_reason: typeof helpReason === "string" ? helpReason : undefined,
    last_interaction_at: data.last_interaction_at?.toDate
      ? data.last_interaction_at.toDate().toISOString()
      : typeof data.last_interaction_at === "string"
        ? data.last_interaction_at
        : undefined,
    created_at: data.created_at?.toDate
      ? data.created_at.toDate().toISOString()
      : typeof data.created_at === "string"
        ? data.created_at
        : undefined,
    profile_picture: typeof data.profile_picture === "string" ? data.profile_picture : undefined,
    last_note: typeof data.last_note === "string" ? data.last_note : undefined,
  };
}
