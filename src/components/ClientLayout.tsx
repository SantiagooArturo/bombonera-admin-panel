"use client";

import { ReactNode, useState, useCallback } from "react";
import Sidebar, { COLLAPSED_W, EXPANDED_W } from "./Sidebar";
import ToastContainer from "./Toast";
import { useToast } from "@/lib/hooks";
import { createContext, useContext } from "react";

type ToastFn = (message: string, type?: "success" | "error" | "info") => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToastContext = () => useContext(ToastContext);

export default function ClientLayout({ children }: { children: ReactNode }) {
  const { toasts, addToast, removeToast } = useToast();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((p) => !p), []);

  const marginLeft = sidebarCollapsed ? COLLAPSED_W : EXPANDED_W;

  return (
    <ToastContext.Provider value={addToast}>
      <div className="min-h-screen bg-[#f8faf8]">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <style>{`@media(min-width:768px){.app-main{margin-left:${marginLeft}px;transition:margin-left .2s ease}}`}</style>
        <main className="app-main pb-24 md:pb-8">
          {children}
        </main>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </ToastContext.Provider>
  );
}
