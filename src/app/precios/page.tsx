"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ClientLayout, { useToastContext } from "@/components/ClientLayout";
import { compressImageForUpload } from "@/lib/compress-image";
import type { CourtFieldConfig, CourtSize } from "@/lib/court-config";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function isImageFile(file: File): boolean {
  return IMAGE_TYPES.includes(file.type);
}

export default function PreciosPage() {
  const toast = useToastContext();
  const [configs, setConfigs] = useState<CourtFieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [selectedField, setSelectedField] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/court-config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setConfigs(data);
      })
      .catch(() => toast("Error al cargar configuración", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  const current = configs.find((c) => c.field === selectedField);

  const [editForm, setEditForm] = useState<Partial<CourtFieldConfig> | null>(null);
  useEffect(() => {
    if (current) setEditForm({ ...current });
  }, [current]);

  const formValues = editForm ?? current ?? {};
  const imageUrl = formValues.image_url ?? current?.image_url ?? "";

  useEffect(() => {
    if (imageUrl) setImageLoading(true);
    else setImageLoading(false);
  }, [selectedField, imageUrl]);

  const hasChanges = useMemo(() => {
    if (!current || !editForm) return false;
    const keys: (keyof CourtFieldConfig)[] = [
      "court_size", "court_size_other", "image_url",
      "price_day_weekday", "price_day_weekend", "price_day_holiday",
      "price_night_weekday", "price_night_weekend", "price_night_holiday",
      "description",
    ];
    return keys.some((k) => {
      const a = editForm[k];
      const b = current[k];
      if (typeof a === "boolean" || typeof b === "boolean") return (a ?? false) !== (b ?? false);
      return String(a ?? "") !== String(b ?? "");
    });
  }, [current, editForm]);

  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/court-config/seed", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al cargar datos");
      toast(data?.message || "Datos iniciales cargados", "success");
      const refetch = await fetch("/api/court-config");
      const fresh = await refetch.json();
      if (Array.isArray(fresh)) setConfigs(fresh);
    } catch {
      toast("No se pudieron cargar los datos iniciales", "error");
    } finally {
      setSeeding(false);
    }
  }

  async function handleSaveAll() {
    const data = editForm ?? current;
    if (!current || !data) return;

    const priceKeys = [
      "price_day_weekday", "price_day_weekend", "price_day_holiday",
      "price_night_weekday", "price_night_weekend", "price_night_holiday",
    ] as const;
    const invalid = priceKeys.find((k) => {
      const v = data[k] as unknown;
      return v === "" || v == null || typeof v !== "number" || v < 0;
    });
    if (invalid) {
      toast("Completá todos los precios con números válidos (≥ 0) antes de guardar", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/court-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: selectedField, ...data }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      setConfigs((prev) =>
        prev.map((c) => (c.field === selectedField ? { ...c, ...data } : c))
      );
      toast("Cambios guardados", "success");
    } catch {
      toast("No se pudieron guardar los cambios", "error");
    } finally {
      setSaving(false);
    }
  }

  const uploadImage = useCallback(async (file: File) => {
    if (!isImageFile(file)) {
      toast("Solo puedes subir JPEG, PNG o WebP", "error");
      return;
    }
    if (!configs.some((c) => c.field === selectedField)) return;
    setUploadingImage(true);
    try {
      const blob = await compressImageForUpload(file);
      const form = new FormData();
      form.append("file", blob, "image.jpg");
      form.append("folder", "court-images");
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al subir");
      if (data?.url) {
        setEditForm((prev) => (prev ? { ...prev, image_url: data.url } : null));
        toast("Imagen cargada. Hacé clic en Guardar para aplicar.", "success");
      }
    } catch {
      toast("No se pudo subir la imagen", "error");
    } finally {
      setUploadingImage(false);
    }
  }, [selectedField, configs, toast]);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.getAttribute("contenteditable"))) return;
      const f = e.clipboardData?.files?.[0];
      if (f && isImageFile(f)) {
        e.preventDefault();
        uploadImage(f);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [uploadImage]);

  if (loading) {
    return (
      <ClientLayout>
        <div className="p-8 flex items-center justify-center min-h-[40vh]">
          <p className="text-gray-500 font-medium">Cargando...</p>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Información y precios de canchas
          </h1>
          <p className="mt-2 text-gray-600 text-base">
            Configura cada campo del 1 al 12. Los precios son por hora.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Edita los campos y haz clic en Guardar para aplicar los cambios.
          </p>
        </div>

        {/* Selector de campo */}
        <div className="mb-8">
          <p className="text-sm font-semibold text-gray-700 mb-3">Selecciona el campo</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((f) => (
              <button
                key={f}
                onClick={() => setSelectedField(f)}
                className={`w-12 h-12 rounded-xl font-bold text-lg transition-colors ${
                  selectedField === f
                    ? "bg-emerald-600 text-white shadow-lg"
                    : "bg-white border-2 border-gray-200 text-gray-700 hover:border-emerald-300"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {current && (
          <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-sm overflow-hidden">
            <div className="p-6 md:p-8 space-y-8">
              {/* Tamaño de cancha */}
              <section>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Tamaño de cancha
                </label>
                <div className="flex flex-col gap-3">
                  <select
                    value={formValues.court_size ?? "6 vs 6"}
                    onChange={(e) => {
                      const v = e.target.value as CourtSize;
                      setEditForm((prev) => prev ? { ...prev, court_size: v, court_size_other: v === "otro" ? prev.court_size_other : "" } : null);
                    }}
                    className="w-full max-w-xs rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 font-medium focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="5 vs 5">5 vs 5</option>
                    <option value="6 vs 6">6 vs 6</option>
                    <option value="otro">Otro</option>
                  </select>
                  {(formValues.court_size === "otro") && (
                    <input
                      type="text"
                      placeholder="Especificar (ej. 7 vs 7, Fútbol)"
                      value={formValues.court_size_other ?? ""}
                      onChange={(e) => setEditForm((prev) => prev ? { ...prev, court_size_other: e.target.value } : null)}
                      className="w-full max-w-md rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-emerald-500 focus:outline-none"
                    />
                  )}
                </div>
              </section>

              {/* Imagen */}
              <section>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Imagen de la cancha
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage(f);
                    e.target.value = "";
                  }}
                />
                <div
                  tabIndex={0}
                  role="button"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("ring-2", "ring-emerald-400"); }}
                  onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove("ring-2", "ring-emerald-400"); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("ring-2", "ring-emerald-400");
                    const f = e.dataTransfer.files?.[0];
                    if (f) uploadImage(f);
                  }}
                  onPaste={(e) => {
                    const f = e.clipboardData?.files?.[0];
                    if (f) uploadImage(f);
                  }}
                  className={`flex gap-4 items-center p-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors min-h-[120px] focus:outline-none focus:ring-2 focus:ring-emerald-400 ${uploadingImage ? "opacity-60 pointer-events-none" : ""}`}
                >
                  {imageUrl ? (
                    <div className="relative w-28 h-20 rounded-lg border border-gray-200 shrink-0 overflow-hidden bg-gray-100">
                      {imageLoading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <svg className="w-8 h-8 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        </div>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={`Campo ${current.field}`}
                        className={`w-full h-full object-cover transition-opacity ${imageLoading ? "opacity-0" : "opacity-100"}`}
                        onLoad={() => setImageLoading(false)}
                        onError={() => setImageLoading(false)}
                      />
                    </div>
                  ) : (
                    <div className="w-28 h-20 rounded-lg bg-gray-200 flex items-center justify-center shrink-0">
                      <span className="text-gray-400 text-xs">Sin imagen</span>
                    </div>
                  )}
                  <div className="text-sm text-gray-600">
                    {uploadingImage ? (
                      <span className="font-medium text-emerald-600">Subiendo...</span>
                    ) : (
                      <>
                        <p className="font-medium text-gray-700">Arrastra una imagen aquí</p>
                        <p className="text-gray-500 mt-0.5">o haz clic para seleccionar · Ctrl+V para pegar</p>
                      </>
                    )}
                  </div>
                </div>
              </section>

              {/* Precios */}
              <section>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Precios por hora (S/)</h3>
                <div className="grid grid-cols-2 gap-6">
                  {[
                    {
                      keys: ["price_day_weekday"],
                      label: "Precio de día · Entre semana",
                    },
                    {
                      keys: ["price_day_weekend", "price_day_holiday"],
                      label: "Precio de día · Fin de semana y feriados",
                    },
                    {
                      keys: ["price_night_weekday"],
                      label: "Precio de noche · Entre semana",
                    },
                    {
                      keys: ["price_night_weekend", "price_night_holiday"],
                      label: "Precio de noche · Fin de semana y feriados",
                    },
                  ].map(({ keys, label }) => {
                    const rawVal = formValues[keys[0] as keyof CourtFieldConfig];
                    const displayVal = rawVal === "" ? "" : String(rawVal ?? current?.[keys[0] as keyof CourtFieldConfig] ?? "");
                    return (
                      <div key={keys.join("-")}>
                        <label className="block text-sm font-medium text-gray-600 mb-1.5">
                          {label}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={5}
                          value={displayVal}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              const updates = Object.fromEntries(keys.map((k) => [k, ""]));
                              setEditForm((prev) => prev ? { ...prev, ...updates } : null);
                            } else {
                              const v = parseFloat(raw);
                              if (!isNaN(v) && v >= 0) {
                                const updates = Object.fromEntries(keys.map((k) => [k, v]));
                                setEditForm((prev) => prev ? { ...prev, ...updates } : null);
                              }
                            }
                          }}
                          className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 font-semibold text-gray-800 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  Día: antes de las 6pm. Noche: desde las 6pm.
                </p>
              </section>

              {/* Descripción */}
              <section>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Descripción
                </label>
                <textarea
                  rows={4}
                  placeholder="Ej: Alquiler en turnos de 7pm a 9pm o 9pm a 11pm. No se alquila por una hora de noche, solo feriado, sábado o domingo. (A partir de 6pm es considerado noche)"
                  value={formValues.description ?? ""}
                  onChange={(e) => setEditForm((prev) => prev ? { ...prev, description: e.target.value } : null)}
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-emerald-500 focus:outline-none resize-none"
                />
              </section>

              {/* Botón Guardar */}
              <div className="pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={saving || !hasChanges}
                  className={`w-full md:w-auto px-8 py-4 rounded-xl font-bold text-lg transition-colors shadow-lg ${
                    hasChanges
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  } ${saving ? "opacity-60 cursor-wait" : ""}`}
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}
