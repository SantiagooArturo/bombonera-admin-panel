import {
  type Transfer,
  PAYMENT_METHOD_LABELS,
  PAYMENT_SOURCE_LABELS,
  TRANSFER_STATUS_LABELS,
} from "@/lib/types";
import { formatSolesAmountDisplay } from "@/features/boletas/utils/formatSolesAmountDisplay";
import { formatDisplayPhone } from "@/features/operaciones/utils";

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Búsqueda: usuario, DNI, WhatsApp, monto, IDs, estado, método, origen, etc. */
export function transferMatchesSearch(t: Transfer, rawQuery: string): boolean {
  const q = norm(rawQuery);
  if (!q) return true;

  const qDigits = digitsOnly(q);
  const parts: string[] = [];

  const push = (v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (s) parts.push(s.toLowerCase());
  };

  push(t.id);
  push(t.reservation_id);
  push(t.operation_id);
  push(t.recipient_name);
  push(t.client_display_name);
  push(t.client_last_dni);
  push(t.chat_id);
  push(t.transaction_date);
  push(t.transaction_time);

  const rawPhone = t.phone_number?.trim() ?? "";
  if (rawPhone) {
    push(rawPhone);
    push(digitsOnly(rawPhone));
    push(formatDisplayPhone(rawPhone));
    push(digitsOnly(formatDisplayPhone(rawPhone)));
  }

  const st = t.status;
  if (st && TRANSFER_STATUS_LABELS[st]) push(TRANSFER_STATUS_LABELS[st]);
  push(st);

  const pm = t.payment_method;
  if (pm && PAYMENT_METHOD_LABELS[pm]) push(PAYMENT_METHOD_LABELS[pm]);
  push(pm);

  const src = t.source;
  if (src && PAYMENT_SOURCE_LABELS[src]) push(PAYMENT_SOURCE_LABELS[src]);
  push(src);

  push(t.verified === true ? "verificado validado sí" : "");
  push(t.verified === false ? "pendiente no" : "");

  const amt = t.amount ?? 0;
  if (Number.isFinite(amt)) {
    push(String(amt));
    push(amt.toFixed(2));
    push(String(Math.round(amt)));
    push(formatSolesAmountDisplay(amt));
    push(`s/ ${formatSolesAmountDisplay(amt)}`);
  }

  const hay = parts.join(" ");
  if (hay.includes(q)) return true;

  if (qDigits.length >= 3) {
    const hayDigits = digitsOnly(hay);
    if (hayDigits.includes(qDigits)) return true;
  }

  return false;
}
