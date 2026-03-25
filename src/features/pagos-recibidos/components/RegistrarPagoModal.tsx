"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compressImageForUpload } from "@/lib/compress-image";
import { useStore } from "@/lib/hooks";
import { EmitClienteDirectoryField } from "@/features/boletas/components/EmitClienteDirectoryField";
import { stripEmojis } from "@/features/boletas/utils/stripEmojis";
import { getLimaNowTimeHm, getLimaTodayYmd } from "@/features/boletas/utils/limaEmissionDatetime";
import {
  getUserName,
  getUserPhone,
  isValidPeruPhone,
  normalizePeruPhone,
} from "@/features/operaciones/utils";

type RegistrarPagoModalProps = {
  onClose: () => void;
  onSuccess: () => void;
};

export const RegistrarPagoModal = memo(function RegistrarPagoModal({ onClose, onSuccess }: RegistrarPagoModalProps) {
  const store = useStore();
  const [phoneNorm, setPhoneNorm] = useState("");
  const [clienteDirectoryInput, setClienteDirectoryInput] = useState("");
  const [clientName, setClientName] = useState("");
  const [dni, setDni] = useState("");
  const [amount, setAmount] = useState("");
  const [fecha, setFecha] = useState(getLimaTodayYmd);
  const [hora, setHora] = useState(getLimaNowTimeHm);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevLinkedPhoneRef = useRef("");

  useEffect(() => {
    if (!store.isLoaded("users")) {
      void store.fetchUsers();
    }
  }, [store]);

  const emitClienteDirectoryOptions = useMemo(
    () =>
      store
        .getUsers()
        .map((u) => {
          const raw = getUserPhone(u);
          const names = [u.custom_name, u.contact_name, u.push_name].filter(Boolean) as string[];
          const normalized = normalizePeruPhone(raw) || raw;
          const rawLabel = (names.length > 0 ? names.join(" ") : getUserName(u)).trim();
          const name = stripEmojis(rawLabel).replace(/\s+/g, " ").trim() || "Cliente";
          const searchText = name.toLowerCase();
          return { phone: normalized, name, searchText };
        })
        .filter((o) => o.phone.replace(/\D/g, "").length >= 9),
    [store]
  );

  useEffect(() => {
    const prev = prevLinkedPhoneRef.current;
    if (phoneNorm !== prev) {
      prevLinkedPhoneRef.current = phoneNorm;
      if (!phoneNorm || !isValidPeruPhone(phoneNorm)) {
        if (prev && !phoneNorm) {
          setClientName("");
          setDni("");
        }
        return;
      }
      const u = store.getUsers().find(
        (x) => normalizePeruPhone(getUserPhone(x) || x.chat_id || "") === phoneNorm
      );
      if (u) {
        setClientName(getUserName(u));
        setDni((u.last_dni || "").replace(/\D/g, "").slice(0, 8));
      }
    }
  }, [phoneNorm, store]);

  const clearFile = useCallback(() => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  const controlH = "h-10";
  const inputClass = `w-full ${controlH} rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/30`;
  const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500";

  const parsed = parseFloat(amount.replace(",", "."));
  const amountOk = !Number.isNaN(parsed) && parsed > 0;
  const phoneOk = isValidPeruPhone(phoneNorm);
  const dniDigits = dni.replace(/\D/g, "").slice(0, 8);
  const dniOk = dniDigits.length === 0 || dniDigits.length === 8;
  const canSubmit = phoneOk && amountOk && !!file && dniOk && !busy;

  async function handleSubmit() {
    if (!canSubmit || !file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await compressImageForUpload(file);
      const form = new FormData();
      form.append("file", blob, "comprobante.jpg");
      const up = await fetch("/api/upload", { method: "POST", body: form });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) {
        throw new Error(typeof upData?.error === "string" ? upData.error : "No se pudo subir la captura.");
      }
      const mediaUrl = typeof upData?.url === "string" ? upData.url : "";
      if (!mediaUrl) throw new Error("No se obtuvo URL del archivo.");

      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: null,
          amount: parsed,
          phone_number: phoneNorm,
          payment_method: "digital",
          media_url: mediaUrl,
          chat_id: phoneNorm.replace(/\D/g, ""),
          recipient_name: clientName.trim() || undefined,
          transaction_date: fecha.trim() || undefined,
          transaction_time: hora.trim() || undefined,
          client_dni: dniDigits.length === 8 ? dniDigits : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo registrar el pago.");
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10060] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-6 sm:px-6 sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registrar-pago-title"
    >
      <div className="mb-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <h2 id="registrar-pago-title" className="text-base font-bold text-gray-900">
            Registrar pago
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <EmitClienteDirectoryField
            linkedPhoneNorm={phoneNorm}
            onLinkedPhoneChange={setPhoneNorm}
            inputText={clienteDirectoryInput}
            onInputTextChange={setClienteDirectoryInput}
            options={emitClienteDirectoryOptions}
            placeholder="Buscar o número"
          />

          <div>
            <label htmlFor="reg-pago-name" className={labelClass}>
              Nombre (opcional)
            </label>
            <input
              id="reg-pago-name"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="reg-pago-dni" className={labelClass}>
              DNI (opcional)
            </label>
            <input
              id="reg-pago-dni"
              type="text"
              inputMode="numeric"
              placeholder="8 dígitos si lo tiene"
              value={dni}
              onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className={inputClass}
            />
            {!dniOk ? <p className="mt-1 text-xs text-red-600">Si escribe DNI, deben ser 8 dígitos.</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="reg-pago-fecha" className={labelClass}>
                Fecha
              </label>
              <input
                id="reg-pago-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="reg-pago-hora" className={labelClass}>
                Hora
              </label>
              <input
                id="reg-pago-hora"
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-pago-amount" className={labelClass}>
              Monto (S/)
            </label>
            <input
              id="reg-pago-amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <span className={labelClass}>Foto del comprobante</span>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onFileChange}
                className="text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-field-dark file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              {preview ? (
                <button type="button" onClick={clearFile} className="text-xs font-semibold text-red-600 hover:underline">
                  Quitar foto
                </button>
              ) : null}
            </div>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="mt-2 max-h-36 rounded-lg border border-gray-200 object-contain" />
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
        ) : null}

        <div className="mt-5 flex gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`flex ${controlH} flex-1 items-center justify-center rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className={`flex ${controlH} flex-1 items-center justify-center rounded-lg border border-field-dark bg-field-dark text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50`}
          >
            {busy ? "Guardando…" : "Registrar pago"}
          </button>
        </div>
      </div>
    </div>
  );
});
