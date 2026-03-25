import type { Transfer } from "@/lib/types";

export function transferClientDisplayName(t: Transfer): string {
  const n = t.client_display_name?.trim() || t.recipient_name?.trim();
  return n || "—";
}
