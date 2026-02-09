"use client";

import { useState, useEffect, useMemo } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";

function formatPhone(phone?: string, chatId?: string): string {
  const raw = (phone || chatId?.replace(/@.*$/, "") || "").replace(/\D/g, "");
  if (!raw) return "—";
  const without51 = raw.startsWith("51") && raw.length > 2 ? raw.slice(2) : raw;
  return without51 || "—";
}

export default function ConfiguracionPage() {
  const store = useStore();
  const toast = useToastContext();
  const users = store.getUsers();
  const loaded = store.isLoaded("users");

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    store.fetchUsers();
  }, [store]);

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const term = search.replace(/\D/g, "");
    if (!term) return users;
    return users.filter((u) => {
      const phone = (u.phone_number || u.chat_id || "").replace(/\D/g, "");
      return phone.includes(term);
    });
  }, [users, search]);

  const automatedCount = users.filter((u) => u.is_automated ?? true).length;
  const manualCount = users.filter((u) => !(u.is_automated ?? true)).length;

  async function handleToggle(userId: string, currentValue: boolean) {
    setTogglingId(userId);
    const success = await store.toggleUserAutomation(userId);
    if (success) {
      toast(
        currentValue ? "Bot desactivado para este número" : "Bot activado para este número",
        currentValue ? "info" : "success"
      );
    } else {
      toast("Error al cambiar automatización", "error");
    }
    setTogglingId(null);
  }

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-heading-lg font-bold text-gray-900">Configuración</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Control de automatización del bot de WhatsApp
          </p>
        </div>

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">Cargando configuración...</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 mb-8">
              <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6">
                <p className="text-display font-bold text-green-700">{automatedCount}</p>
                <p className="text-body font-medium text-green-600 mt-1">Bot Activo</p>
              </div>
              <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-6">
                <p className="text-display font-bold text-orange-700">{manualCount}</p>
                <p className="text-body font-medium text-orange-600 mt-1">Modo Manual</p>
              </div>
            </div>

            <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 mb-8">
              <p className="text-body-lg text-blue-800 font-medium">
                <strong>Bot Activo:</strong> El bot de WhatsApp responde automáticamente al cliente.
              </p>
              <p className="text-body-lg text-blue-800 font-medium mt-2">
                <strong>Modo Manual:</strong> El bot NO responde. Usted debe responder manualmente al cliente.
              </p>
            </div>

            {/* Buscador */}
            <div className="mb-6">
              <div className="relative max-w-md">
                <svg
                  className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Buscar por número..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-12 pr-5 py-4 text-body rounded-xl border-2 border-gray-200 focus:border-bombonera-500 focus:outline-none bg-white shadow-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80">
                    <th className="px-6 py-4 text-body font-bold text-gray-700">WhatsApp</th>
                    <th className="px-6 py-4 text-body font-bold text-gray-700">Estado</th>
                    <th className="px-6 py-4 text-body font-bold text-gray-700 text-right">Bot</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-body-lg text-gray-400">
                        {search ? "No se encontraron usuarios con ese número" : "No hay usuarios registrados"}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isAutomated = user.is_automated ?? true;
                      const isToggling = togglingId === user.id;

                      return (
                        <tr
                          key={user.id}
                          className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors"
                        >
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
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex px-3 py-1.5 rounded-lg text-body font-semibold ${
                                isAutomated
                                  ? "bg-green-100 text-green-700"
                                  : "bg-orange-100 text-orange-700"
                              }`}
                            >
                              {isAutomated ? "Bot Activo" : "Modo Manual"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleToggle(user.id, isAutomated)}
                              disabled={isToggling}
                              className="relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50"
                              style={{ backgroundColor: isAutomated ? "#16a34a" : "#d1d5db" }}
                              role="switch"
                              aria-checked={isAutomated}
                            >
                              <span
                                className="pointer-events-none inline-block h-7 w-7 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out"
                                style={{ transform: isAutomated ? "translateX(1.5rem)" : "translateX(0)" }}
                              />
                            </button>
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
