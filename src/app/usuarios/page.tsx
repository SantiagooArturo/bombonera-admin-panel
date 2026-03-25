"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import {
  CLIENT_TYPE_LABELS,
  type ClientType,
  type User,
} from "@/lib/types";
import AddUserModal from "@/features/usuarios/components/AddUserModal";
import ActivateChatbotConfirmModal from "@/features/usuarios/components/ActivateChatbotConfirmModal";
import { formatDisplayPhone, userWhatsAppPhone, wspLink } from "@/features/operaciones/utils";
import { anchorPropsForHref } from "@/lib/internal-href";

// ─── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "reservation_count" | "client_type" | "bot";
type SortDir = "asc" | "desc";

function userBotActivated(u: User): boolean {
  return u.is_automated ?? true;
}

const CLIENT_TYPE_ORDER: ClientType[] = [
  "casual",
  "recurrente",
  "sospechoso_fraude",
];

function clientTypeSortValue(ct: ClientType): number {
  const idx = CLIENT_TYPE_ORDER.indexOf(ct);
  return idx >= 0 ? idx : CLIENT_TYPE_ORDER.length;
}

/** Buscador de /pagos-recibidos y /boletas (coincide con WhatsApp del usuario). */
function usuarioPagosBoletasSearchParam(wa: string): string {
  return encodeURIComponent(formatDisplayPhone(wa));
}

/** Mínimo entre navegaciones consecutivas al mismo destino (anti ráfaga si el navegador tarda). */
const NEW_TAB_CLICK_COOLDOWN_MS = 2500;

function CooldownNewTabLink({
  href,
  className,
  children,
  cooldownMs = NEW_TAB_CLICK_COOLDOWN_MS,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  cooldownMs?: number;
}) {
  const lastOpenAtRef = useRef(0);
  return (
    <Link
      href={href}
      {...anchorPropsForHref(href)}
      className={className}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        const now = Date.now();
        if (now - lastOpenAtRef.current < cooldownMs) {
          e.preventDefault();
          return;
        }
        lastOpenAtRef.current = now;
      }}
    >
      {children}
    </Link>
  );
}

function needsAttention(user: User): boolean {
  return !!(user.needs_help || user.client_type === "sospechoso_fraude");
}

function getDisplayName(user: User): { name: string; source: "custom" | "contact" | "reservation" | "none" } {
  if (user.custom_name) return { name: user.custom_name, source: "custom" };
  if (user.contact_name) return { name: user.contact_name, source: "contact" };
  if (user.last_representative_name) return { name: user.last_representative_name, source: "reservation" };
  return { name: "Sin nombre", source: "none" };
}

// ─── Sort Header ────────────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  /** ej. text-center para columna Bot */
  className?: string;
}) {
  return (
    <th className={`p-6 text-gray-600 font-bold text-lg ${className}`}>
      <span className="inline-flex items-center justify-center gap-1">
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

// ─── Page ───────────────────────────────────────────────────────────────────

export default function UsuariosPage() {
  return <Suspense><UsuariosContent /></Suspense>;
}

function UsuariosContent() {
  const store = useStore();
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const users = store.getUsers();
  const loaded = store.isLoaded("users");
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [updatingClientType, setUpdatingClientType] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [resetConfirmId, setResetConfirmId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [filterNeedsHelp, setFilterNeedsHelp] = useState(searchParams.get("help") === "true");
  const [filterClientType] = useState<ClientType | "all">(
    (searchParams.get("type") as ClientType | null) || "all"
  );
  const [recurrentReminderEnabled, setRecurrentReminderEnabled] = useState<boolean | null>(null);
  const [recurrentReminderLoading, setRecurrentReminderLoading] = useState(false);
  const [bulkBotDeactivating, setBulkBotDeactivating] = useState(false);
  /** Confirmación antes de activar el chatbot (evita clics accidentales). */
  const [activateBotPending, setActivateBotPending] = useState<{
    userId: string;
    label: string;
  } | null>(null);
  useEffect(() => {
    store.fetchUsers();
  }, [store]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.recurrent_reminder_enabled === "boolean") {
          setRecurrentReminderEnabled(data.recurrent_reminder_enabled);
        } else {
          setRecurrentReminderEnabled(false);
        }
      })
      .catch(() => setRecurrentReminderEnabled(false));
  }, []);

  async function handleToggleRecurrentReminder() {
    if (recurrentReminderEnabled === null) return;
    setRecurrentReminderLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurrent_reminder_enabled: !recurrentReminderEnabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecurrentReminderEnabled(data.recurrent_reminder_enabled ?? !recurrentReminderEnabled);
        toast(
          data.recurrent_reminder_enabled ? "Recordatorio a recurrentes activado" : "Recordatorio a recurrentes desactivado",
          "success"
        );
      } else {
        toast(data.error || "Error al actualizar", "error");
      }
    } catch {
      toast("Error al actualizar configuración", "error");
    } finally {
      setRecurrentReminderLoading(false);
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      /** Bot: primer clic = activados primero (desc). */
      setSortDir(key === "bot" ? "desc" : "asc");
    }
  };

  async function handleToggleAutomation(userId: string, currentValue: boolean) {
    setTogglingId(userId);
    const success = await store.toggleUserAutomation(userId);
    if (success) {
      toast(
        currentValue ? "Bot desactivado" : "Bot activado",
        currentValue ? "info" : "success"
      );
    } else {
      toast("Error al cambiar estado", "error");
    }
    setTogglingId(null);
    setActivateBotPending(null);
  }

  async function handleDeactivateAllBots() {
    if (
      !window.confirm(
        "¿Desactivar el bot para todos los usuarios que lo tienen activo? Solo actualiza el interruptor en la base de datos; no borra usuarios ni historial."
      )
    ) {
      return;
    }
    setBulkBotDeactivating(true);
    const r = await store.deactivateAutomationForAllUsers();
    setBulkBotDeactivating(false);
    if (r.ok) {
      toast(`Bot desactivado en ${r.updated ?? 0} usuario(s).`, "success");
    } else {
      toast(r.error ?? "Error al desactivar", "error");
    }
  }

  async function handleResetUser() {
    if (!resetConfirmId) return;
    setResetting(true);
    const success = await store.resetUser(resetConfirmId);
    if (success) {
      toast("Usuario eliminado correctamente", "success");
    } else {
      toast("Error al eliminar usuario", "error");
    }
    setResetting(false);
    setResetConfirmId(null);
  }

  async function handleSaveCustomName(userId: string) {
    const success = await store.updateUserCustomName(userId, editingNameValue);
    if (success) {
      toast("Nombre actualizado", "success");
    } else {
      toast("Error al actualizar nombre", "error");
    }
    setEditingNameId(null);
    setEditingNameValue("");
  }

  async function handleClientTypeChange(userId: string, newType: ClientType) {
    setUpdatingClientType(userId);
    const success = await store.updateUserClientType(userId, newType);
    if (success) {
      toast(`Tipo actualizado: ${CLIENT_TYPE_LABELS[newType]}`, "success");
    } else {
      toast("Error al actualizar tipo de cliente", "error");
    }
    setUpdatingClientType(null);
  }

  const filteredUsers = useMemo(() => {
    const raw = search.trim();
    if (!raw) return users;
    const lower = raw.toLowerCase();
    const digits = raw.replace(/\D/g, "");

    return users.filter((u) => {
      const wa = userWhatsAppPhone(u);
      const phone = (wa || u.phone_number || u.chat_id?.replace(/@.*$/, "") || u.id || "").replace(/\D/g, "");
      if (digits && phone.includes(digits)) return true;
      if (digits && u.last_dni?.includes(digits)) return true;
      const names = [u.custom_name, u.contact_name, u.last_representative_name]
        .concat(u.push_name)
        .filter(Boolean)
        .map((n) => n!.toLowerCase());
      return names.some((n) => n.includes(lower));
    });
  }, [users, search]);

  const needsHelpCount = useMemo(() => users.filter(needsAttention).length, [users]);

  const sortedUsers = useMemo(() => {
    let list = filteredUsers;
    if (filterNeedsHelp) list = list.filter(needsAttention);
    if (filterClientType !== "all") list = list.filter((u) => u.client_type === filterClientType);

    list = [...list].sort((a, b) => {
      const ha = needsAttention(a) ? 0 : 1;
      const hb = needsAttention(b) ? 0 : 1;
      if (ha !== hb) return ha - hb;

      if (!sortBy) return 0;
      let cmp = 0;
      if (sortBy === "reservation_count") {
        cmp = a.reservation_count - b.reservation_count;
      } else if (sortBy === "client_type") {
        cmp = clientTypeSortValue(a.client_type) - clientTypeSortValue(b.client_type);
      } else {
        const sa = userBotActivated(a) ? 1 : 0;
        const sb = userBotActivated(b) ? 1 : 0;
        cmp = sa - sb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredUsers, sortBy, sortDir, filterNeedsHelp, filterClientType]);

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-fit">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
          <h1 className="text-heading-lg font-bold text-gray-900">Usuarios</h1>
          <p className="text-body-lg text-gray-500 mt-1">
            Gestiona usuarios, reservas y cobros
          </p>
        </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDeactivateAllBots()}
              disabled={bulkBotDeactivating || !loaded}
              className="inline-flex items-center gap-2 px-4 py-3 font-semibold rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkBotDeactivating ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              )}
              Desactivar para todos
            </button>
            <button
              type="button"
              onClick={() => setAddUserOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-3 font-semibold rounded-xl bg-bombonera-600 text-white hover:bg-bombonera-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Añadir usuario
            </button>
          </div>
        </div>

        {/* Switch recordatorio recurrentes */}
        <div className="mb-6 flex items-center justify-between gap-4 p-4 rounded-xl border-2 border-gray-200 bg-white">
          <div>
            <p className="font-semibold text-gray-900">Recordatorio a clientes recurrentes</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Si está desactivado, no se envían recordatorios a clientes recurrentes (solo a quienes tienen bot activado).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={recurrentReminderEnabled ?? false}
            disabled={recurrentReminderLoading || recurrentReminderEnabled === null}
            onClick={handleToggleRecurrentReminder}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-bombonera-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              recurrentReminderEnabled === null
                ? "bg-gray-300"
                : recurrentReminderEnabled
                  ? "bg-bombonera-600"
                  : "bg-gray-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${
                recurrentReminderEnabled === null
                  ? "translate-x-3 opacity-70"
                  : recurrentReminderEnabled
                    ? "translate-x-5"
                    : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <AddUserModal
          open={addUserOpen}
          onClose={() => setAddUserOpen(false)}
          onSubmit={async (data) => {
            try {
              await store.createUser(data);
              toast("Usuario creado correctamente", "success");
              return true;
            } catch (e) {
              toast(e instanceof Error ? e.message : "Error al crear usuario", "error");
              return false;
            }
          }}
        />

        {/* Banner de alerta si hay usuarios que necesitan ayuda */}
        {needsHelpCount > 0 && !filterNeedsHelp && (
          <button
            onClick={() => setFilterNeedsHelp(true)}
            className="w-full mb-6 flex items-center gap-3 px-5 py-4 bg-red-50 border-2 border-red-200 rounded-xl text-left hover:bg-red-100 transition-colors"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white font-bold text-body">
              {needsHelpCount}
            </span>
            <div>
              <p className="text-body font-bold text-red-800">
                {needsHelpCount === 1
                  ? "1 usuario necesita atención"
                  : `${needsHelpCount} usuarios necesitan atención`}
              </p>
              <p className="text-sm text-red-600">
                Usuarios con peligro de fraude o que requieren intervención humana. Click para revisar.
              </p>
            </div>
            <svg className="h-5 w-5 text-red-400 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Buscador + filtro */}
        <div className="mb-6 space-y-3">
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
              placeholder="Buscar por nombre, DNI o número..."
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

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 mr-1">Mostrar:</span>
            <button
              onClick={() => setFilterNeedsHelp(false)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                !filterNeedsHelp
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterNeedsHelp(true)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border inline-flex items-center gap-1.5 ${
                filterNeedsHelp
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-red-600 border-red-200 hover:border-red-400"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Requieren atención
              {needsHelpCount > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold leading-none ${
                  filterNeedsHelp ? "bg-white/25" : "bg-red-500 text-white"
                }`}>
                  {needsHelpCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">Cargando usuarios...</div>
          </div>
        ) : (
          <>
            <p className="text-body text-gray-500 mb-4 font-medium">
              {sortedUsers.length} usuario{sortedUsers.length !== 1 ? "s" : ""}{" "}
              {search ? "encontrado" : ""}{sortedUsers.length !== 1 && search ? "s" : ""}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="p-6 text-gray-600 font-bold text-lg">Cliente</th>
                    <SortHeader label="Reservas" sortKey="reservation_count" onSort={handleSort} />
                    <SortHeader label="Tipo de cliente" sortKey="client_type" onSort={handleSort} />
                    <SortHeader label="Bot" sortKey="bot" onSort={handleSort} className="text-center" />
                    <th className="p-6 text-gray-600 font-bold text-lg text-center whitespace-nowrap">Pagos</th>
                    <th className="p-6 text-gray-600 font-bold text-lg text-center whitespace-nowrap">
                      Boletas / Facturas
                    </th>
                    <th className="p-6 text-gray-600 font-bold text-lg text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-lg text-gray-400">
                        {search ? "No se encontraron usuarios" : "No hay usuarios en la colección"}
                      </td>
                    </tr>
                  ) : (
                    sortedUsers.map((user) => {
                      const attention = needsAttention(user);
                      const wa = userWhatsAppPhone(user);
                      const phoneDisplay = wa ? formatDisplayPhone(wa) : "—";
                      const userWaHref = wa ? wspLink(wa) : null;
                      return (
                          <tr
                            key={user.id}
                          className={`border-b border-gray-100 last:border-0 transition-colors ${
                              attention
                                ? "bg-red-50 hover:bg-red-100/60"
                                : "hover:bg-gray-50/50"
                            }`}
                          >
                          <td className="p-6">
                              <div className="flex flex-col gap-1">
                              {/* Nombre (editable) */}
                              {editingNameId === user.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={editingNameValue}
                                    onChange={(e) => setEditingNameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleSaveCustomName(user.id);
                                      if (e.key === "Escape") { setEditingNameId(null); setEditingNameValue(""); }
                                    }}
                                    autoFocus
                                    className="w-36 px-2 py-1 text-lg border-2 border-bombonera-400 rounded-lg focus:outline-none"
                                    placeholder="Nombre..."
                                  />
                                  <button onClick={() => handleSaveCustomName(user.id)} className="text-green-600 hover:text-green-700" title="Guardar">
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                  </button>
                                  <button onClick={() => { setEditingNameId(null); setEditingNameValue(""); }} className="text-gray-400 hover:text-gray-600" title="Cancelar">
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              ) : (() => {
                                const display = getDisplayName(user);
                                return (
                                  <div className="flex items-center gap-1.5">
                                    <span className={`font-semibold text-lg ${display.source === "none" ? "text-gray-400 italic" : "text-gray-800"}`}>
                                      {display.name}
                                    </span>
                                    <button
                                      onClick={() => { setEditingNameId(user.id); setEditingNameValue(user.custom_name || ""); }}
                                      className="text-gray-300 hover:text-bombonera-500 transition-colors"
                                      title="Editar nombre"
                                    >
                                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                  </div>
                                );
                              })()}

                              {/* WhatsApp: solo si hay móvil peruano válido */}
                              {userWaHref ? (
                                <a
                                  href={userWaHref}
                                  {...anchorPropsForHref(userWaHref)}
                                  className="flex items-center gap-2 hover:bg-green-50 px-2 py-1 rounded-lg transition-colors group w-fit"
                                  title="Abrir chat de WhatsApp"
                                >
                                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                                  </svg>
                                  <span className="text-gray-500 text-base font-mono group-hover:text-green-700 group-hover:underline">
                                    {phoneDisplay}
                                  </span>
                                </a>
                              ) : (
                                <span className="text-sm text-gray-400 font-mono px-2 py-1" title="Sin número válido — edítalo en Pagos / drawer">
                                  —
                                  </span>
                                )}

                              {/* Alerta si necesita atención */}
                              {user.needs_help && (
                                <div className="flex flex-col gap-1 mt-1">
                                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-red-500 px-2.5 py-1 rounded-md animate-pulse w-fit">
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    Requiere atención
                                  </span>
                                  {user.help_reason && (
                                    <span
                                      className="text-xs text-red-700 pl-1 pr-1 max-w-[340px] whitespace-normal break-words leading-snug"
                                      title={user.help_reason}
                                    >
                                      {user.help_reason}
                              </span>
                                  )}
                                </div>
                              )}
                            </div>
                            </td>
                          <td className="p-6 text-base text-gray-700">{user.reservation_count}</td>
                          <td className="p-6">
                              <select
                              value={user.client_type}
                                onChange={(e) => {
                                handleClientTypeChange(user.id, e.target.value as ClientType);
                                }}
                                disabled={updatingClientType === user.id}
                              className={`px-3 py-1.5 rounded-lg text-base font-medium border-2 cursor-pointer transition-colors ${
                                  user.client_type === "sospechoso_fraude"
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : user.client_type === "recurrente"
                                    ? "bg-green-50 text-green-700 border-green-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                                } disabled:opacity-50`}
                              >
                              <option value="casual">Casual</option>
                                <option value="recurrente">Recurrente</option>
                                <option value="sospechoso_fraude">Peligro de fraude</option>
                              </select>
                            </td>
                          <td className="p-6 text-center">
                              <button
                              onClick={() => {
                                  const botOn = user.is_automated ?? true;
                                  if (botOn) {
                                    void handleToggleAutomation(user.id, true);
                                    return;
                                  }
                                  if (user.client_type === "sospechoso_fraude") {
                                    toast("Cambia el tipo de cliente antes de activar el bot", "error");
                                    return;
                                  }
                                  const display = getDisplayName(user);
                                  const waPhone = userWhatsAppPhone(user);
                                  setActivateBotPending({
                                    userId: user.id,
                                    label:
                                      display.name !== "Sin nombre"
                                        ? display.name
                                        : waPhone
                                          ? formatDisplayPhone(waPhone)
                                          : user.id,
                                  });
                                }}
                                disabled={togglingId === user.id}
                              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                                (user.is_automated ?? true) ? "bg-green-500" : "bg-gray-300"
                              }`}
                              role="switch"
                              aria-checked={user.is_automated ?? true}
                            >
                              <span
                                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                  (user.is_automated ?? true) ? "translate-x-5" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </td>
                          <td className="p-6 text-center align-middle">
                            {wa ? (
                              <CooldownNewTabLink
                                href={`/pagos-recibidos?search=${usuarioPagosBoletasSearchParam(wa)}`}
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                                Ver pagos
                              </CooldownNewTabLink>
                            ) : (
                              <span
                                className="inline-flex items-center justify-center px-3 py-2 text-sm font-semibold text-gray-300 bg-gray-50 rounded-lg cursor-not-allowed"
                                title="Sin WhatsApp válido"
                              >
                                Ver pagos
                              </span>
                            )}
                          </td>
                          <td className="p-6 text-center align-middle">
                            {wa ? (
                              <CooldownNewTabLink
                                href={`/boletas?search=${usuarioPagosBoletasSearchParam(wa)}`}
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-violet-700 bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors"
                              >
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                                Ver boletas / facturas
                              </CooldownNewTabLink>
                            ) : (
                              <span
                                className="inline-flex items-center justify-center px-3 py-2 text-sm font-semibold text-gray-300 bg-gray-50 rounded-lg cursor-not-allowed"
                                title="Sin WhatsApp válido"
                              >
                                Ver boletas / facturas
                              </span>
                            )}
                          </td>
                          <td className="p-6 text-center">
                            <div className="flex items-center justify-center gap-2 flex-wrap">
                              {wa ? (
                                <CooldownNewTabLink
                                  href={`/verificacion?search=${encodeURIComponent(phoneDisplay)}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  Ver reservas
                                </CooldownNewTabLink>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-300 bg-gray-50 rounded-lg cursor-not-allowed"
                                  title="Sin número válido para buscar"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  Ver reservas
                                </span>
                              )}
                                  <button
                                    onClick={() => setResetConfirmId(user.id)}
                                className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Eliminar usuario"
                                  >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                            </div>
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

      <ActivateChatbotConfirmModal
        open={!!activateBotPending}
        title="¿Estás seguro de activar el chatbot?"
        onCancel={() => setActivateBotPending(null)}
        onConfirm={() => {
          if (!activateBotPending) return;
          void handleToggleAutomation(activateBotPending.userId, false);
        }}
        loading={togglingId === activateBotPending?.userId}
      >
        <p className="text-lg sm:text-xl font-bold text-red-900 leading-snug">
          Vas a permitir que el <span className="underline decoration-red-600 decoration-4">bot responda automáticamente</span> por WhatsApp a este cliente.
        </p>
        <ul className="list-disc pl-5 space-y-2 text-base font-semibold text-red-900">
          <li>Un clic por error puede generar respuestas automáticas y confusión para el cliente.</li>
          <li>Solo confirma si es <strong>deliberado</strong>.</li>
        </ul>
        {activateBotPending && (
          <p className="rounded-xl border-2 border-red-300 bg-white px-4 py-3 text-base font-bold text-red-950">
            Cliente: <span className="font-mono">{activateBotPending.label}</span>
          </p>
        )}
      </ActivateChatbotConfirmModal>

      {/* Modal de confirmación: eliminar usuario */}
      {resetConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </span>
              <h3 className="text-body-lg font-bold text-gray-900">Eliminar usuario</h3>
            </div>
            <p className="text-body text-gray-600 mb-2">
              Esta acción es irreversible. Se eliminará por completo:
            </p>
            <ul className="text-body text-gray-600 mb-6 space-y-1 pl-4">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                Todo el historial de conversación
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                Todas las reservas (pendientes y pasadas)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                El registro del usuario en el sistema
              </li>
            </ul>
            <p className="text-sm text-gray-500 mb-6">
              Si el usuario vuelve a escribir, se creará automáticamente como &quot;Nuevo&quot;.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setResetConfirmId(null)}
                disabled={resetting}
                className="px-4 py-2.5 rounded-xl text-body font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleResetUser}
                disabled={resetting}
                className="px-4 py-2.5 rounded-xl text-body font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {resetting ? "Eliminando..." : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ClientLayout>
  );
}
