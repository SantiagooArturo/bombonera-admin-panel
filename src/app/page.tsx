"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ClientLayout from "@/components/ClientLayout";
import DateRangeFilter from "@/features/dashboard/components/DateRangeFilter";
import {
  type DateRange,
  getDateRangeForPreset,
  getToday,
  isDateInRange,
  isTodayRange,
} from "@/features/dashboard/utils/dateRange";
import { useStore } from "@/lib/hooks";
import type { User } from "@/lib/types";

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function getUserName(u: User) {
  return u.custom_name || u.contact_name || u.last_representative_name || "Sin nombre";
}

function getUserPhone(u: User) {
  return u.phone_number || u.chat_id || "";
}

const initialDateRange = (): DateRange => {
  const { start, end } = getDateRangeForPreset("hoy");
  return { start, end, preset: "hoy" };
};

export default function DashboardPage() {
  const store = useStore();
  const reservations = store.getReservations();
  const users = store.getUsers();
  const today = getToday();
  const loadedRes = store.isLoaded("reservations");
  const loadedUsers = store.isLoaded("users");
  const loaded = loadedRes && loadedUsers;

  const [dateRange, setDateRange] = useState<DateRange>(initialDateRange);
  const [dashStats, setDashStats] = useState({ unverifiedTransfers: 0, pendingInvoices: 0 });

  useEffect(() => {
    store.fetchReservations();
    store.fetchUsers();
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setDashStats)
      .catch(() => {});
  }, [store]);

  const filteredReservations = useMemo(
    () =>
      reservations.filter(
        (r) =>
          r.status !== "cancelled" &&
          isDateInRange(r.date, dateRange.start, dateRange.end)
      ),
    [reservations, dateRange.start, dateRange.end]
  );

  const confirmedCount = filteredReservations.filter((r) => r.status === "confirmed").length;
  const collected = filteredReservations.reduce((sum, r) => sum + (r.amount_paid ?? 0), 0);
  const outstanding = filteredReservations.reduce(
    (sum, r) => sum + Math.max((r.total_price || 0) - (r.amount_paid ?? 0), 0),
    0
  );
  const arrivedCount = filteredReservations.filter((r) => r.arrived).length;
  const showPendientes = isTodayRange(dateRange.start, dateRange.end);

  const usersNeedingHelp = useMemo(() => users.filter((u) => u.needs_help), [users]);

  const tasks = useMemo(() => {
    const list: { label: string; count: number; href: string; dotColor: string }[] = [];

    const unpaid = reservations.filter(
      (r) => r.status !== "cancelled" && (r.amount_paid ?? 0) < (r.total_price || 0)
    ).length;
    if (unpaid > 0) {
      list.push({
        label: "Reservas por cobrar",
        count: unpaid,
        href: "/verificacion?status=pending",
        dotColor: "bg-amber-500",
      });
    }

    if (dashStats.unverifiedTransfers > 0) {
      list.push({
        label: "Transferencias por validar",
        count: dashStats.unverifiedTransfers,
        href: "/verificacion?status=unverified",
        dotColor: "bg-purple-500",
      });
    }

    if (dashStats.pendingInvoices > 0) {
      list.push({
        label: "Boletas por emitir",
        count: dashStats.pendingInvoices,
        href: "/verificacion",
        dotColor: "bg-blue-500",
      });
    }

    const suspicious = users.filter((u) => u.client_type === "sospechoso_fraude").length;
    if (suspicious > 0) {
      list.push({
        label: "Usuarios sospechosos de fraude",
        count: suspicious,
        href: "/usuarios?type=sospechoso_fraude",
        dotColor: "bg-red-500",
      });
    }

    return list;
  }, [reservations, users, dashStats]);

  const hasPendingWork = usersNeedingHelp.length > 0 || tasks.length > 0;

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-5xl">
        <div className="mb-10">
          <h1 className="text-heading-lg font-bold text-gray-900">Bienvenido</h1>
          <p className="text-body-lg text-gray-500 mt-1 capitalize">{formatDate(today)}</p>
        </div>

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">Cargando datos...</div>
          </div>
        ) : (
          <>
            {/* Filtro de rango de fechas */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-6">
              <p className="text-sm font-medium text-gray-600 mb-2">Ver estadísticas del período:</p>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </div>

            {/* Stats */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-8">
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100">
                <Stat
                  label={showPendientes ? "Reservas hoy" : "Reservas"}
                  value={filteredReservations.length}
                  iconColor="text-bombonera-500"
                  icon={
                    <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                    </svg>
                  }
                />
                <Stat
                  label="Confirmadas"
                  value={confirmedCount}
                  iconColor="text-emerald-500"
                  icon={
                    <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  }
                />
                <Stat
                  label="Cobrado"
                  value={`S/ ${collected.toFixed(0)}`}
                  iconColor="text-emerald-500"
                  icon={
                    <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
                    </svg>
                  }
                />
                <Stat
                  label="Por cobrar"
                  value={`S/ ${outstanding.toFixed(0)}`}
                  iconColor="text-amber-500"
                  icon={
                    <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  }
                />
              </div>
              <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between text-sm text-gray-500">
                <span>
                  Asistencia: <strong className="text-gray-900">{arrivedCount}</strong> de {filteredReservations.length}
                </span>
                {showPendientes && (
                  <Link href="/operaciones" className="text-bombonera-600 font-semibold hover:underline">
                    Ver en vivo →
                  </Link>
                )}
              </div>
            </div>

            {/* Pendientes - solo cuando el rango es hoy */}
            {showPendientes && hasPendingWork && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-base font-bold text-gray-900">Pendientes</h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {usersNeedingHelp.map((u) => {
                    const phone = getUserPhone(u);
                    return (
                      <Link
                        key={u.id}
                        href={`/usuarios?search=${encodeURIComponent(phone)}`}
                        className="flex items-center gap-3 px-6 py-4 hover:bg-gray-50 transition-colors group"
                      >
                        <PulseDot color="bg-orange-500" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900">
                            {getUserName(u)}
                            <span className="font-normal text-gray-400 ml-2">{phone}</span>
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {u.help_reason || "El bot solicitó ayuda humana"}
                          </p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    );
                  })}
                  {tasks.map((task) => (
                    <Link
                      key={task.label}
                      href={task.href}
                      className="flex items-center gap-3 px-6 py-4 hover:bg-gray-50 transition-colors group"
                    >
                      <PulseDot color={task.dotColor} />
                      <span className="text-sm font-semibold text-gray-900 flex-1">{task.label}</span>
                      <span className="text-sm font-bold text-gray-400 tabular-nums">{task.count}</span>
                      <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {showPendientes && !hasPendingWork && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-10 text-center">
                <p className="text-gray-400 font-medium">Sin tareas pendientes</p>
              </div>
            )}
          </>
        )}
      </div>
    </ClientLayout>
  );
}

function Stat({
  label,
  value,
  iconColor,
  icon,
}: {
  label: string;
  value: string | number;
  iconColor?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="px-5 py-5 flex items-center gap-4">
      <div className={`shrink-0 ${iconColor || "text-gray-400"}`}>{icon}</div>
      <div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="text-2xl font-bold leading-none text-gray-900 mt-1">{value}</p>
      </div>
    </div>
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}
