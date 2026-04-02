"use client";

import { useMemo, useState } from "react";
import { formatDisplayPhone, isValidPeruPhone, normalizePeruPhone } from "@/features/operaciones/utils";
import { stripEmojis } from "../utils/stripEmojis";

export type EmitClienteDirectoryOption = {
  phone: string;
  /** Nombre mostrado (sin emojis). */
  name: string;
  /** Texto para filtrar (incluye alias; sin emojis). */
  searchText: string;
  /** URL de la foto de perfil en Firebase Storage o Proxy. */
  picture?: string;
};

function hasLetters(s: string) {
  return /[a-záéíóúñA-ZÁÉÍÓÚÑ]/.test(s);
}

/** Solo dígitos, espacios y separadores típicos de teléfono. */
function looksLikePhoneOnlyInput(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^[\d\s\-()+.]+$/.test(t);
}

type EmitClienteDirectoryFieldProps = {
  label?: string;
  /** WhatsApp normalizado (51 + 9 dígitos) o vacío si no hay vínculo. */
  linkedPhoneNorm: string;
  onLinkedPhoneChange: (phone: string) => void;
  /** Texto libre del buscador (no se concatena con el número al editar). */
  inputText: string;
  onInputTextChange: (text: string) => void;
  options: EmitClienteDirectoryOption[];
  placeholder?: string;
};

/**
 * Buscador de contacto (WhatsApp) del directorio para emitir comprobante o registrar pago.
 * El teléfono vinculado solo cambia al elegir de la lista, al vaciar el campo o al escribir un número válido solo-números.
 * Editar el texto con letras no borra el vínculo previo.
 */
export function EmitClienteDirectoryField({
  label = "Contacto de WhatsApp",
  linkedPhoneNorm,
  onLinkedPhoneChange,
  inputText,
  onInputTextChange,
  options,
  placeholder = "Buscar o número",
}: EmitClienteDirectoryFieldProps) {
  const [open, setOpen] = useState(false);

  const filteredOptions = useMemo(() => {
    const qNorm = stripEmojis(inputText).trim().toLowerCase().replace(/\s+/g, " ");
    if (!qNorm) return options.slice(0, 12);
    const digits = qNorm.replace(/\D/g, "");
    const letters = hasLetters(qNorm);
    return options
      .filter((o) => {
        if (digits.length >= 2 && o.phone.includes(digits)) return true;
        if (letters && qNorm.length >= 2) {
          return o.searchText.toLowerCase().includes(qNorm);
        }
        return false;
      })
      .slice(0, 12);
  }, [inputText, options]);

  const inputClass =
    "w-full h-10 rounded-lg border border-gray-300 bg-white px-3 pr-9 text-sm text-gray-900 shadow-sm focus:outline-none focus:border-field-dark focus:ring-1 focus:ring-field-dark/30";
  const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500";

  function applyTypedPhoneIfAny(raw: string) {
    const t = raw.trim();
    if (!t) {
      onLinkedPhoneChange("");
      return;
    }
    if (!looksLikePhoneOnlyInput(t)) {
      return;
    }
    const n = normalizePeruPhone(t.replace(/\D/g, ""));
    if (isValidPeruPhone(n)) {
      onLinkedPhoneChange(n);
    }
  }

  return (
    <div className="relative">
      <label className={labelClass}>{label}</label>
      <div className="relative">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          value={inputText}
          onChange={(e) => {
            const v = e.target.value;
            onInputTextChange(v);
            if (!open) setOpen(true);
            if (!v.trim()) {
              onLinkedPhoneChange("");
              return;
            }
            applyTypedPhoneIfAny(v);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
          }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((x) => !x)}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-gray-500 hover:text-gray-700"
          aria-label="Mostrar opciones"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {linkedPhoneNorm ? (
        <p className="mt-1 font-mono text-xs tabular-nums text-gray-600">
          WhatsApp: {formatDisplayPhone(linkedPhoneNorm)}
        </p>
      ) : null}

      {open && filteredOptions.length > 0 ? (
        <div className="absolute z-[70] mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filteredOptions.map((o) => (
            <button
              key={`${o.phone}-${o.name}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const normalized = normalizePeruPhone(o.phone);
                onLinkedPhoneChange(normalized);
                onInputTextChange(o.name);
                setOpen(false);
              }}
              className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-blue-50 flex items-center gap-3"
            >
              <div className="h-8 w-8 rounded-full bg-gray-200 flex-shrink-0 overflow-hidden flex items-center justify-center border border-gray-100 shadow-sm">
                {o.picture ? (
                  <img
                    src={o.picture}
                    alt={o.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "";
                    }}
                  />
                ) : (
                  <svg className="h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-800">{o.name}</p>
                <p className="font-mono text-xs tabular-nums text-gray-500">{formatDisplayPhone(o.phone)}</p>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
