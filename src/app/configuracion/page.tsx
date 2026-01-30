"use client";

import { useState, useEffect } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/lib/hooks";

export default function ConfiguracionPage() {
  const store = useStore();
  const toast = useToastContext();
  const numbers = store.getAutomatedNumbers();
  const loaded = store.isLoaded("automatedNumbers");

  const [toggleTarget, setToggleTarget] = useState<string | null>(null);
  const toggleNumber = numbers.find((n) => n.chat_id === toggleTarget);

  useEffect(() => {
    store.fetchAutomatedNumbers();
  }, [store]);

  async function handleToggle() {
    if (!toggleTarget) return;
    const number = numbers.find((n) => n.chat_id === toggleTarget);
    if (!number) return;

    const success = await store.toggleAutomation(toggleTarget);
    if (success) {
      toast(
        number.isAutomated
          ? `Bot DESACTIVADO para ${number.phone_number}`
          : `Bot ACTIVADO para ${number.phone_number}`,
        number.isAutomated ? "info" : "success"
      );
    } else {
      toast("Error al cambiar automatización", "error");
    }
    setToggleTarget(null);
  }

  const automatedCount = numbers.filter((n) => n.isAutomated).length;
  const manualCount = numbers.filter((n) => !n.isAutomated).length;

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

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-heading font-bold text-gray-900">Números Registrados</h2>
              </div>
              {numbers.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-body-lg text-gray-400">No hay números registrados</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {numbers.map((num) => (
                    <div
                      key={num.chat_id}
                      className="flex items-center justify-between p-6 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl ${
                            num.isAutomated ? "bg-green-600" : "bg-orange-500"
                          }`}
                        >
                          {(num.name || num.phone_number).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          {num.name && (
                            <p className="text-body-lg font-bold text-gray-900">{num.name}</p>
                          )}
                          <p className="text-body text-gray-500 font-medium">{num.phone_number}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => setToggleTarget(num.chat_id)}
                        className={`px-6 py-4 rounded-xl text-body font-bold min-h-[52px] min-w-[160px] text-center transition-colors ${
                          num.isAutomated
                            ? "bg-green-100 text-green-700 hover:bg-green-200 border-2 border-green-300"
                            : "bg-orange-100 text-orange-700 hover:bg-orange-200 border-2 border-orange-300"
                        }`}
                      >
                        {num.isAutomated ? "Bot Activo" : "Modo Manual"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={toggleTarget !== null}
        title={toggleNumber?.isAutomated ? "Desactivar Bot" : "Activar Bot"}
        message={
          toggleNumber?.isAutomated
            ? `¿Desactivar el bot para ${toggleNumber?.phone_number}? Deberá responder manualmente a este número.`
            : `¿Activar el bot para ${toggleNumber?.phone_number}? El bot responderá automáticamente.`
        }
        confirmLabel={toggleNumber?.isAutomated ? "Desactivar" : "Activar"}
        variant={toggleNumber?.isAutomated ? "danger" : "default"}
        onConfirm={handleToggle}
        onCancel={() => setToggleTarget(null)}
      />
    </ClientLayout>
  );
}
