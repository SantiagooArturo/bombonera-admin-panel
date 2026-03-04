"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import appIcon from "@/app/icon.png";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Inicio",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
        <path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" />
        <path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z" />
      </svg>
    ),
  },
  {
    href: "/operaciones",
    label: "En Vivo",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/usuarios",
    label: "Usuarios",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
        <path fillRule="evenodd" d="M8.25 6.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM15.75 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM2.25 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM6.31 15.117A6.745 6.745 0 0 1 12 12a6.745 6.745 0 0 1 6.709 3.998.75.75 0 0 1-.372 1.002A6.745 6.745 0 0 1 12 13.5a6.745 6.745 0 0 1-6.127-3.381.75.75 0 0 1-.372-1.002ZM2.25 18a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/bloqueos",
    label: "Bloqueos",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
        <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/verificacion",
    label: "Reservas",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z" clipRule="evenodd" />
        <path d="M10.5 7.5a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v3h3a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-3v3a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-3h-3a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 .75-.75h3v-3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    href: "/salud",
    label: "Salud",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 shrink-0">
        <path d="M11.25 3.75a.75.75 0 0 1 1.5 0v2.348a6.75 6.75 0 1 1-1.5 0V3.75Z" />
        <path d="M5.558 10.583a.75.75 0 0 1 1.06 0L9 12.964l1.19-2.38a.75.75 0 0 1 1.348.06l1.525 3.355 1.65-2.475a.75.75 0 0 1 .587-.334.75.75 0 0 1 .633.238l2.51 2.51a.75.75 0 0 1-1.06 1.061l-1.856-1.857-1.78 2.67a.75.75 0 0 1-1.337-.1l-1.478-3.252-.956 1.913a.75.75 0 0 1-1.187.21l-2.812-2.813a.75.75 0 0 1 0-1.06Z" />
      </svg>
    ),
  },
];

const COLLAPSED_W = 72;
const EXPANDED_W = 240;

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const width = collapsed ? COLLAPSED_W : EXPANDED_W;

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex fixed left-0 top-0 bottom-0 bg-field-dark flex-col z-40 transition-[width] duration-200 ease-in-out"
        style={{ width }}
      >
        <div className={`py-5 border-b border-white/10 ${collapsed ? "px-3" : "px-4"}`}>
          <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
            <div className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
                <Image
                  src={appIcon}
                  alt="Logo La Bombonera"
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                  priority
                />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <h1 className="text-white font-bold text-lg leading-tight truncate">La Bombonera</h1>
                  <p className="text-green-300/70 text-xs">Panel Admin</p>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={onToggle}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-green-300/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Colapsar menú"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-xl font-semibold transition-all ${
                  collapsed ? "justify-center px-2 py-3" : "px-4 py-3"
                } ${isActive
                    ? "bg-white/20 text-white shadow-lg"
                    : "text-green-200/80 hover:bg-white/10 hover:text-white"
                  }`}
              >
                {item.icon}
                {!collapsed && <span className="truncate text-sm">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {collapsed && (
          <button
            onClick={onToggle}
            className="mx-2 mb-4 flex items-center justify-center py-2.5 rounded-xl text-green-300/60 hover:text-white hover:bg-white/10 transition-colors"
            title="Expandir menú"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 rotate-180">
              <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-field-dark border-t border-white/10 z-40 px-2 pb-safe">
        <div className="flex justify-around">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 py-3 px-4 text-sm font-medium transition-colors ${isActive
                    ? "text-white"
                    : "text-green-300/60"
                  }`}
              >
                {item.icon}
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export { COLLAPSED_W, EXPANDED_W };
