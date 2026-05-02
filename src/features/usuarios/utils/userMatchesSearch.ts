import { userWhatsAppPhone } from "@/features/operaciones/utils";
import type { User } from "@/lib/types";

/** Misma lógica que el buscador de /usuarios (nombre, DNI, teléfono). */
export function userMatchesSearch(u: User, raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  const digits = t.replace(/\D/g, "");
  const wa = userWhatsAppPhone(u);
  const phone = (wa || u.phone_number || u.chat_id?.replace(/@.*$/, "") || u.id || "").replace(/\D/g, "");
  if (digits && phone.includes(digits)) return true;
  if (digits && u.last_dni?.includes(digits)) return true;
  const names = [u.custom_name, u.contact_name, u.last_representative_name, u.push_name]
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .map((n) => n.toLowerCase());
  return names.some((n) => n.includes(lower));
}
