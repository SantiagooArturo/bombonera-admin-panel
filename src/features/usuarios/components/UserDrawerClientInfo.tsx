"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/hooks";
import { useToastContext } from "@/components/ClientLayout";
import type { User, ClientType } from "@/lib/types";
import { CLIENT_TYPE_LABELS } from "@/lib/types";
import { formatDisplayPhone, wspLink, userWhatsAppPhone, normalizePeruPhone } from "@/features/operaciones/utils";
import { anchorPropsForHref } from "@/lib/internal-href";
import { WHATSAPP_ICON_PATH as WSP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";

type UserDrawerClientInfoProps = {
  user: User;
  onUserUpdated: (next: User) => void;
};

function effectiveDisplayName(u: User): string {
  return (u.custom_name || u.contact_name || u.last_representative_name || "Sin nombre").trim();
}

export function UserDrawerClientInfo({ user, onUserUpdated }: UserDrawerClientInfoProps) {
  const store = useStore();
  const toast = useToastContext();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingDni, setEditingDni] = useState(false);
  const [dniValue, setDniValue] = useState(user.last_dni || "");
  const [editingRuc, setEditingRuc] = useState(false);
  const [rucValue, setRucValue] = useState(user.last_ruc || "");
  const [clientTypeUpdating, setClientTypeUpdating] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");

  const resolvedWa = userWhatsAppPhone(user);
  const drawerClientWspHref = resolvedWa ? wspLink(resolvedWa) : null;
  const initialNameForEdit = user.custom_name ?? (user.contact_name || user.last_representative_name || "");

  useEffect(() => {
    setDniValue(user.last_dni || "");
    setRucValue(user.last_ruc || "");
  }, [user.id, user.last_dni, user.last_ruc]);

  const handleSaveName = useCallback(async () => {
    const ok = await store.updateUserCustomName(user.id, nameValue.trim());
    if (ok) {
      toast("Nombre actualizado", "success");
      onUserUpdated({ ...user, custom_name: nameValue.trim() || undefined });
      setEditingName(false);
    } else {
      toast("Error al guardar nombre", "error");
    }
  }, [store, toast, user, nameValue, onUserUpdated]);

  const handleSavePhone = useCallback(async () => {
    const ok = await store.updateUserPhoneNumber(user.id, phoneInput);
    if (ok) {
      const normalized = normalizePeruPhone(phoneInput.replace(/\D/g, ""));
      toast("WhatsApp actualizado", "success");
      onUserUpdated({ ...user, phone_number: normalized });
      setEditingPhone(false);
    } else {
      toast("Teléfono inválido (9 dígitos, Perú)", "error");
    }
  }, [store, toast, user, phoneInput, onUserUpdated]);

  const handleSaveDni = useCallback(async () => {
    const ok = await store.updateUserDoc(user.id, { last_dni: dniValue });
    if (ok) {
      toast("DNI actualizado", "success");
      const clean = dniValue.replace(/\D/g, "").slice(0, 8);
      onUserUpdated({ ...user, last_dni: clean.length === 8 ? clean : undefined });
      setEditingDni(false);
    } else {
      toast("Error al guardar DNI", "error");
    }
  }, [store, toast, user, dniValue, onUserUpdated]);

  const handleSaveRuc = useCallback(async () => {
    const ok = await store.updateUserDoc(user.id, { last_ruc: rucValue });
    if (ok) {
      toast("RUC actualizado", "success");
      const clean = rucValue.replace(/\D/g, "").slice(0, 11);
      onUserUpdated({ ...user, last_ruc: clean.length === 11 ? clean : undefined });
      setEditingRuc(false);
    } else {
      toast("Error al guardar RUC", "error");
    }
  }, [store, toast, user, rucValue, onUserUpdated]);

  const handleClientType = useCallback(
    async (next: ClientType) => {
      if (next === user.client_type) return;
      setClientTypeUpdating(true);
      const ok = await store.updateUserClientType(user.id, next);
      setClientTypeUpdating(false);
      if (ok) {
        toast("Tipo de cliente actualizado", "success");
        const patch: Partial<User> = { client_type: next };
        if (next === "sospechoso_fraude") patch.is_automated = false;
        onUserUpdated({ ...user, ...patch });
      } else {
        toast("Error al actualizar tipo", "error");
      }
    },
    [store, toast, user, onUserUpdated]
  );

  return (
    <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0 space-y-4">
      <div className="flex flex-col space-y-1">
        {editingName ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder="Nombre personalizado"
                className="flex-1 min-w-0 rounded-lg border-2 border-blue-500 px-2 py-1.5 text-lg font-bold text-gray-900 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleSaveName()}
                className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingName(false);
                  setNameValue(initialNameForEdit);
                }}
                className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700"
                title="Cancelar"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <p className="text-lg font-bold text-gray-900">{effectiveDisplayName(user)}</p>
            <button
              type="button"
              onClick={() => {
                setNameValue(initialNameForEdit);
                setEditingName(true);
              }}
              className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
              title="Editar nombre"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 shrink-0">WhatsApp:</span>
          {editingPhone ? (
            <>
              <input
                type="text"
                inputMode="numeric"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="Ej: 987654321"
                className="w-40 rounded-lg border border-gray-200 px-2 py-1 text-sm font-mono font-semibold text-gray-800 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleSavePhone()}
                className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingPhone(false);
                  setPhoneInput(resolvedWa ? formatDisplayPhone(resolvedWa) : "");
                }}
                className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700"
                title="Cancelar"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          ) : (
            <>
              {drawerClientWspHref ? (
                <a
                  href={drawerClientWspHref}
                  {...anchorPropsForHref(drawerClientWspHref)}
                  className="inline-flex items-center gap-2 hover:bg-green-50 px-2 py-1 rounded-lg transition-colors group"
                  title="Abrir chat de WhatsApp"
                >
                  <svg className="w-5 h-5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d={WSP_ICON_PATH} />
                  </svg>
                  <span className="text-gray-500 text-base font-mono group-hover:text-green-700 group-hover:underline">
                    {formatDisplayPhone(resolvedWa!)}
                  </span>
                </a>
              ) : (
                <span className="text-sm text-gray-400">Sin número válido — corrige el número</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setPhoneInput(resolvedWa ? formatDisplayPhone(resolvedWa) : "");
                  setEditingPhone(true);
                }}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                title="Editar número de WhatsApp"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">DNI:</span>
          {editingDni ? (
            <>
              <input
                type="text"
                value={dniValue}
                onChange={(e) => setDniValue(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="(opcional)"
                className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-700 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => void handleSaveDni()}
                className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Guardar
              </button>
            </>
          ) : (
            <>
              <span className={`text-sm font-semibold ${user.last_dni ? "text-gray-800" : "text-gray-400"}`}>
                {user.last_dni || "(vacío)"}
              </span>
              <button
                type="button"
                onClick={() => setEditingDni(true)}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                title="Editar DNI"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">RUC:</span>
          {editingRuc ? (
            <>
              <input
                type="text"
                value={rucValue}
                onChange={(e) => setRucValue(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="(opcional)"
                className="w-36 rounded-lg border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-700 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => void handleSaveRuc()}
                className="text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Guardar
              </button>
            </>
          ) : (
            <>
              <span className={`text-sm font-semibold ${user.last_ruc ? "text-gray-800" : "text-gray-400"}`}>
                {user.last_ruc || "(vacío)"}
              </span>
              <button
                type="button"
                onClick={() => setEditingRuc(true)}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                title="Editar RUC"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-gray-100">
        <div className="min-w-[140px] flex-1">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tipo de cliente</label>
          {clientTypeUpdating ? (
            <div className="h-[42px] w-full rounded-xl border-2 border-gray-200 bg-gray-100 animate-pulse" />
          ) : (
            <select
              value={user.client_type}
              disabled={clientTypeUpdating}
              onChange={(e) => void handleClientType(e.target.value as ClientType)}
              className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-60"
            >
              <option value="casual">{CLIENT_TYPE_LABELS.casual}</option>
              <option value="frecuente">{CLIENT_TYPE_LABELS.frecuente}</option>
              <option value="academia">{CLIENT_TYPE_LABELS.academia}</option>
              <option value="sospechoso_fraude">{CLIENT_TYPE_LABELS.sospechoso_fraude}</option>
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
