"use client";

import { useEffect, useMemo, useState } from "react";

export type PhoneOption = {
  phone: string;
  name: string;
};

function formatDisplayPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("51") && digits.length > 9) return digits.slice(2);
  return digits;
}

function normalizePeruPhone(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.startsWith("51")) return digits;
  return `51${digits}`.slice(0, 11);
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
  placeholder = "Escribe número o selecciona",
  accent = "blue",
}: EditablePhoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const filteredOptions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options
      .filter((o) => o.phone.includes(q) || o.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [inputValue, options]);

  const borderFocus = accent === "emerald" ? "focus:border-emerald-500" : "focus:border-blue-500";
  const optionActive = accent === "emerald" ? "hover:bg-emerald-50" : "hover:bg-blue-50";

  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-gray-700 mb-2">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={formatDisplayPhone(inputValue)}
          onChange={(e) => {
            const raw = e.target.value;
            const normalized = normalizePeruPhone(raw);
            setInputValue(normalized);
            onChange(normalized);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay to allow click on options before closing.
            setTimeout(() => setOpen(false), 120);
          }}
          placeholder={placeholder}
          className={`w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 pr-10 font-semibold text-gray-800 ${borderFocus} focus:outline-none`}
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
                setInputValue(normalized);
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
