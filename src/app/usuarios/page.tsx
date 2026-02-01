"use client";

import { useEffect, useState, useMemo } from "react";
import ClientLayout from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { CLIENT_TYPE_LABELS, type ClientType } from "@/lib/types";

type SortKey = "reservation_count" | "balance" | "client_type";
type SortDir = "asc" | "desc";

const CLIENT_TYPE_ORDER: (ClientType | "null")[] = ["buen_cliente", "indeciso", "cliente_problematico", "null"];
function clientTypeSortValue(ct: ClientType): number {
  const idx = CLIENT_TYPE_ORDER.indexOf(ct ?? "null");
  return idx >= 0 ? idx : CLIENT_TYPE_ORDER.length;
}

function formatPhone(phone?: string, chatId?: string): string {
  const raw = (phone || chatId?.replace(/@.*$/, "") || "").replace(/\D/g, "");
  if (!raw) return "—";
  // Quitar prefijo Perú (51) si está al inicio
  const without51 = raw.startsWith("51") && raw.length > 2 ? raw.slice(2) : raw;
  return without51 || "—";
}

function formatSaldo(balance: number): { text: string; variant: "negative" | "zero" | "positive" } {
  if (balance < 0) return { text: "Saldo negativo", variant: "negative" };
  if (balance > 0) return { text: "Saldo positivo", variant: "positive" };
  return { text: "0", variant: "zero" };
}

function clientTypeLabel(clientType: ClientType): string {
  if (!clientType) return "—";
  return CLIENT_TYPE_LABELS[clientType] ?? clientType;
}

function SortHeader({
  label,
  sortKey,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className="px-6 py-4 text-body font-bold text-gray-700">
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600"
          title="Ordenar"
          aria-label={`Ordenar por ${label}`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </span>
    </th>
  );
}

export default function UsuariosPage() {
  const store = useStore();
  const users = store.getUsers();
  const loaded = store.isLoaded("users");
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    store.fetchUsers();
  }, [store]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const sortedUsers = useMemo(() => {
    if (!sortBy) return users;
    const list = [...users];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "reservation_count") {
        cmp = a.reservation_count - b.reservation_count;
      } else if (sortBy === "balance") {
        cmp = a.balance - b.balance;
      } else {
        cmp = clientTypeSortValue(a.client_type) - clientTypeSortValue(b.client_type);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [users, sortBy, sortDir]);

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Usuarios</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Listado de usuarios por WhatsApp: reservas, saldo y tipo de cliente
          </p>
        </div>

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">Cargando usuarios...</div>
          </div>
        ) : (
          <>
            <p className="text-body text-gray-500 mb-4 font-medium">
              {users.length} usuario{users.length !== 1 ? "s" : ""} encontrado{users.length !== 1 ? "s" : ""}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80">
                    <th className="px-6 py-4 text-body font-bold text-gray-700">WhatsApp</th>
                    <SortHeader label="Reservas" sortKey="reservation_count" onSort={handleSort} />
                    <SortHeader label="Saldo" sortKey="balance" onSort={handleSort} />
                    <SortHeader label="Tipo de cliente" sortKey="client_type" onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-body-lg text-gray-400">
                        No hay usuarios en la colección
                      </td>
                    </tr>
                  ) : (
                    sortedUsers.map((user) => {
                      const saldo = formatSaldo(user.balance);
                      return (
                        <tr key={user.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center gap-2 text-body font-semibold text-gray-900">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#25D366]" aria-hidden>
                                <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="currentColor">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                </svg>
                              </span>
                              {formatPhone(user.phone_number, user.chat_id)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-body text-gray-700">{user.reservation_count}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex px-4 py-2.5 rounded-xl text-body font-bold ${
                                saldo.variant === "negative"
                                  ? "bg-red-500 text-white"
                                  : saldo.variant === "positive"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {saldo.text}
                              {user.balance !== 0 && (
                                <span className={saldo.variant === "negative" ? "ml-1 opacity-95" : "ml-1"}>
                                  (S/ {Math.abs(user.balance).toFixed(2)})
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-body text-gray-700">
                              {clientTypeLabel(user.client_type)}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </ClientLayout>
  );
}
