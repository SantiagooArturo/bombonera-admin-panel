"use client";

import { useEffect } from "react";
import ClientLayout from "@/components/ClientLayout";
import { useStore } from "@/lib/hooks";
import { COURT_LABELS, STATUS_LABELS } from "@/lib/types";

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function DashboardPage() {
  const store = useStore();
  const reservations = store.getReservations();
  const today = new Date().toISOString().split("T")[0];
  const loaded = store.isLoaded("reservations");

  useEffect(() => {
    store.fetchReservations();
  }, [store]);

  const todayReservations = reservations.filter(
    (r) => r.date === today && r.status !== "cancelled"
  );
  const pendingCount = todayReservations.filter(
    (r) => r.status === "pending"
  ).length;
  const paidCount = todayReservations.filter(
    (r) => r.status === "paid"
  ).length;
  const todayRevenue = todayReservations
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.total_price, 0);
  const pendingRevenue = todayReservations
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + r.total_price, 0);

  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const dayReservations = reservations.filter(
      (r) => r.date === dateStr && r.status !== "cancelled"
    );
    return {
      date: dateStr,
      dayName: d.toLocaleDateString("es-PE", { weekday: "short" }),
      dayNumber: d.getDate(),
      isToday: i === 0,
      count: dayReservations.length,
    };
  });

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="mb-10">
          <h1 className="text-heading-lg font-bold text-gray-900">
            Bienvenido
          </h1>
          <p className="text-body-lg text-gray-500 mt-1">
            {formatDate(today)} — Resumen del día
          </p>
        </div>

        {!loaded ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-body-lg text-gray-400 font-medium">
              Cargando datos...
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
              <StatCard
                label="Reservas Hoy"
                value={todayReservations.length}
                color="bg-bombonera-600"
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                    <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                    <path fillRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clipRule="evenodd" />
                  </svg>
                }
              />
              <StatCard
                label="Pendientes"
                value={pendingCount}
                subtitle={`S/ ${pendingRevenue.toFixed(2)}`}
                color="bg-amber-500"
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z" clipRule="evenodd" />
                  </svg>
                }
              />
              <StatCard
                label="Pagados"
                value={paidCount}
                color="bg-blue-600"
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                  </svg>
                }
              />
              <StatCard
                label="Ingreso Hoy"
                value={`S/ ${todayRevenue.toFixed(0)}`}
                color="bg-emerald-600"
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                    <path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" />
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clipRule="evenodd" />
                  </svg>
                }
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-10 shadow-sm">
              <h2 className="text-heading font-bold text-gray-900 mb-5">
                Próximos 7 días
              </h2>
              <div className="grid grid-cols-7 gap-3">
                {next7Days.map((day) => (
                  <div
                    key={day.date}
                    className={`flex flex-col items-center p-4 rounded-xl transition-colors ${
                      day.isToday
                        ? "bg-bombonera-600 text-white"
                        : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <span className={`text-sm font-medium uppercase ${day.isToday ? "text-green-200" : "text-gray-400"}`}>
                      {day.dayName}
                    </span>
                    <span className="text-heading font-bold mt-1">
                      {day.dayNumber}
                    </span>
                    {day.count > 0 && (
                      <span
                        className={`mt-2 text-sm font-bold px-3 py-1 rounded-full ${
                          day.isToday
                            ? "bg-white/20 text-white"
                            : "bg-bombonera-100 text-bombonera-700"
                        }`}
                      >
                        {day.count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-heading font-bold text-gray-900 mb-5">
                Reservas de Hoy
              </h2>
              {todayReservations.length === 0 ? (
                <p className="text-body-lg text-gray-400 py-8 text-center">
                  No hay reservas para hoy
                </p>
              ) : (
                <div className="space-y-4">
                  {todayReservations
                    .sort((a, b) => (a.time_slots[0] || "").localeCompare(b.time_slots[0] || ""))
                    .map((res) => (
                      <div
                        key={res.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-xl bg-gray-50 border border-gray-100"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 rounded-xl bg-bombonera-100 flex items-center justify-center text-bombonera-700 font-bold text-xl shrink-0">
                            {res.time_slots?.[0] || "—"}
                          </div>
                          <div>
                            <p className="text-body-lg font-semibold text-gray-900">
                              {COURT_LABELS[res.court_type]} — Campo {res.field || "?"}
                            </p>
                            <p className="text-body text-gray-500">
                              {res.time_slots?.[0]} - {res.time_slots?.length > 0 ? parseInt(res.time_slots[res.time_slots.length - 1]) + 1 : "?"}:00
                              {res.phone_number ? ` · Tel: ${res.phone_number}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 sm:gap-4">
                          <span className="text-body-lg font-bold text-gray-900">
                            S/ {(res.total_price || 0).toFixed(2)}
                          </span>
                          <span
                            className={`px-4 py-2 rounded-full text-sm font-bold ${
                              res.status === "paid"
                                ? "bg-blue-100 text-blue-700"
                                : res.status === "pending"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {STATUS_LABELS[res.status] || res.status}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ClientLayout>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-14 h-14 rounded-xl ${color} text-white flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <p className="text-display font-bold text-gray-900 leading-none">{value}</p>
      <p className="text-body text-gray-500 mt-2 font-medium">{label}</p>
      {subtitle && (
        <p className="text-body text-amber-600 font-semibold mt-1">{subtitle}</p>
      )}
    </div>
  );
}
