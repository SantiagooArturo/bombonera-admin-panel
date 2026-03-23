import type { User } from "@/lib/types";
import { normalizePeruPhone } from "@/features/operaciones/utils";

/** Claves posibles de `user_id` en Firestore invoices (doc usuario, chat, teléfono en distintos formatos). Máx. 30 para query `in`. */
export function collectInvoiceUserKeys(
  user: User,
  queryChatId: string,
  waResolved: string | null,
  userDocId: string
): string[] {
  const s = new Set<string>();
  const add = (v: string | undefined | null) => {
    const t = String(v ?? "").trim();
    if (t) s.add(t);
  };

  add(user.id);
  add(user.chat_id);
  add(userDocId);
  add(waResolved);

  const digits = String(queryChatId).replace(/\D/g, "");
  add(digits);
  if (digits.length >= 9) {
    add(normalizePeruPhone(digits.slice(-9)));
  }

  const phoneDigits = String(user.phone_number ?? "").replace(/\D/g, "");
  add(phoneDigits);
  if (phoneDigits.length >= 9) {
    add(normalizePeruPhone(phoneDigits.slice(-9)));
  }

  return [...s].filter(Boolean).slice(0, 30);
}
