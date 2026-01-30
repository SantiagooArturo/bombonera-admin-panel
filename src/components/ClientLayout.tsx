"use client";

import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ToastContainer from "./Toast";
import { useToast } from "@/lib/hooks";
import { createContext, useContext } from "react";

type ToastFn = (message: string, type?: "success" | "error" | "info") => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToastContext = () => useContext(ToastContext);

export default function ClientLayout({ children }: { children: ReactNode }) {
  const { toasts, addToast, removeToast } = useToast();

  return (
    <ToastContext.Provider value={addToast}>
      <div className="min-h-screen bg-[#f8faf8]">
        <Sidebar />
        <main className="md:ml-[240px] pb-24 md:pb-8">
          {children}
        </main>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </ToastContext.Provider>
  );
}
