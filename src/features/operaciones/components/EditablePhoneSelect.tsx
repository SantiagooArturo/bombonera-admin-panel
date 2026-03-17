"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDisplayPhone, normalizePeruPhone } from "../utils";

export type PhoneOption = {
  phone: string;
  name: string;
  /** Texto para buscar (ej: custom_name + contact_name + push_name). Si no se pasa, se usa name. */
  searchText?: string;
};

function isOnlyDigits(s: string) {
  return /^\d*$/.test(s.replace(/\s/g, ""));
}

function hasLetters(s: string) {
  return /[a-záéíóúñA-ZÁÉÍÓÚÑ]/.test(s);
}

type EditablePhoneSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PhoneOption[];
  placeholder?: string;
  accent?: "blue" | "emerald";
};

export default function EditablePhoneSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Busca por nombre o escribe número (9 dígitos)",
  accent = "blue",
}: EditablePhoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (value) {
      const opt = options.find((o) => normalizePeruPhone(o.phone) === normalizePeruPhone(value));
      setInputValue(opt ? `${opt.name} (${formatDisplayPhone(opt.phone)})` : formatDisplayPhone(value));
    } else {
      setInputValue("");
    }
  }, [value, options]);

  const filteredOptions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return options.slice(0, 10);
    const digits = q.replace(/\D/g, "");
    const hasLettersInQ = hasLetters(q);
    return options
      .filter((o) => {
        if (digits && o.phone.includes(digits)) return true;
        if (hasLettersInQ && q.length >= 2) {
          const toSearch = (o.searchText ?? o.name).toLowerCase();
          return toSearch.includes(q);
        }
        return false;
      })
      .slice(0, 10);
  }, [inputValue, options]);

  const borderFocus = accent === "emerald" ? "focus:border-emerald-500" : "focus:border-blue-500";
  const optionActive = accent === "emerald" ? "hover:bg-emerald-50" : "hover:bg-blue-50";

  const displayValue = (() => {
    if (!inputValue) return "";
    if (isOnlyDigits(inputValue)) {
      return formatDisplayPhone(normalizePeruPhone(inputValue));
    }
    return inputValue;
  })();

  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-gray-700 mb-2">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={displayValue}
          onChange={(e) => {
            const raw = e.target.value;
            setInputValue(raw);
            if (!open) setOpen(true);
            const digits = raw.replace(/\D/g, "");
            if (digits.length >= 9) {
              onChange(normalizePeruPhone(raw));
            } else {
              onChange("");
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
          }}
          placeholder={placeholder}
          className={`w-full rounded-xl border-2 px-4 py-3 pr-10 font-semibold text-gray-800 ${borderFocus} focus:outline-none border-gray-200 bg-gray-50`}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
          aria-label="Mostrar opciones"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && filteredOptions.length > 0 && (
        <div className="absolute z-[70] mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg max-h-56 overflow-auto">
          {filteredOptions.map((o) => (
            <button
              key={`${o.phone}-${o.name}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const normalized = normalizePeruPhone(o.phone);
                setInputValue(`${o.name} (${formatDisplayPhone(o.phone)})`);
                onChange(normalized);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 border-b border-gray-100 last:border-b-0 ${optionActive}`}
            >
              <p className="text-sm font-semibold text-gray-800 truncate">{o.name}</p>
              <p className="text-xs text-gray-500">{formatDisplayPhone(o.phone)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
