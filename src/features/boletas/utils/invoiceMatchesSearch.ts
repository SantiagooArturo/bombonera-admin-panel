import type { Invoice } from "@/lib/types";
import { formatSolesAmountDisplay } from "./formatSolesAmountDisplay";
import {
  invoiceDescripcionOnly,
  invoiceReceptorOnly,
  invoiceTelefonoDisplay,
} from "./invoiceTableColumns";

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Coincidencia genérica del buscador de comprobantes: CPE, receptor, DNI/RUC,
 * descripción (incl. texto de cancha si viene ahí), tipo de cancha, nº de cancha,
 * WhatsApp e importe.
 */
export function invoiceMatchesSearch(inv: Invoice, rawQuery: string): boolean {
  const q = norm(rawQuery);
  if (!q) return true;

  const qDigits = digitsOnly(q);
  const parts: string[] = [];

  const push = (v: unknown) => {
    if (v === undefined || v === null) return;
    const t = String(v).trim();
    if (t) parts.push(t.toLowerCase());
  };

  push(inv.serie_correlativo);
  if (inv.serie != null || inv.correlativo != null) {
    push(`${inv.serie ?? ""}-${inv.correlativo ?? ""}`.replace(/^-|-$/g, ""));
  }
  push(inv.correlativo);

  push(invoiceReceptorOnly(inv));
  push(inv.cliente_denominacion);
  push(inv.cliente_numero_de_documento);
  push(inv.representative_name_snapshot);
  push(invoiceDescripcionOnly(inv));
  push(inv.court_type);
  push(inv.field != null ? `cancha ${inv.field}` : "");
  push(inv.field);

  const rawPhone = inv.phone_number?.trim() ?? "";
  if (rawPhone) {
    push(rawPhone);
    push(digitsOnly(rawPhone));
    const disp = invoiceTelefonoDisplay(inv);
    if (disp) {
      push(disp);
      push(digitsOnly(disp));
    }
  }

  const amt = inv.amount ?? 0;
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
