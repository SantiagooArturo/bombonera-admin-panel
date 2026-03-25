"use client";

import { useCallback, useEffect, useState } from "react";

const LS_KEY = "devMode";

function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

type SeriePreview = { serie: string; next_correlativo: number };

/**
 * Panel solo si `localStorage.devMode === "true"`. El servidor solo acepta el POST en dev
 * o con ALLOW_DEV_INVOICE_COUNTER=1.
 */
export function BoletasDevCounterPanel() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [boleta, setBoleta] = useState<SeriePreview | null>(null);
  const [factura, setFactura] = useState<SeriePreview | null>(null);
  const [inputB, setInputB] = useState("");
  const [inputF, setInputF] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"boleta" | "factura" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [rb, rf] = await Promise.all([
        fetch("/api/invoices?next_correlativo=1&tipo=boleta").then((r) => r.json()),
        fetch("/api/invoices?next_correlativo=1&tipo=factura").then((r) => r.json()),
      ]);
      if (rb?.serie != null && rb?.next_correlativo != null) {
        setBoleta({ serie: String(rb.serie), next_correlativo: Number(rb.next_correlativo) });
        setInputB(String(rb.next_correlativo));
      }
      if (rf?.serie != null && rf?.next_correlativo != null) {
        setFactura({ serie: String(rf.serie), next_correlativo: Number(rf.next_correlativo) });
        setInputF(String(rf.next_correlativo));
      }
    } catch {
      setMsg("No se pudo leer el contador.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setEnabled(readDevMode());
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY || e.key === null) setEnabled(readDevMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (enabled && open) void refreshPreview();
  }, [enabled, open, refreshPreview]);

  if (!enabled) return null;

  async function apply(tipo: "boleta" | "factura") {
    const raw = tipo === "boleta" ? inputB.trim() : inputF.trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) {
      setMsg("Usá un entero ≥ 1.");
      return;
    }
    setSaving(tipo);
    setMsg(null);
    try {
      const res = await fetch("/api/invoices/dev-counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, next_correlativo: n }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(typeof data.error === "string" ? data.error : "Error al guardar");
        return;
      }
      setMsg(`OK: próximo ${tipo} = ${n}`);
      await refreshPreview();
    } catch {
      setMsg("Error de red");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-300/80 bg-amber-50/90 px-3 py-2 text-sm text-amber-950 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 font-bold text-amber-900"
      >
        <span>🔧 Dev: contador SUNAT (localStorage.devMode)</span>
        <span className="tabular-nums text-xs opacity-80">{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-amber-200/80 pt-3">
          <p className="text-xs text-amber-800/90">
            Ajusta el próximo correlativo en Firestore (<code className="rounded bg-amber-100/80 px-1">config/invoice_counter_*</code>
            ). En producción el POST solo funciona con{" "}
            <code className="rounded bg-amber-100/80 px-1">ALLOW_DEV_INVOICE_COUNTER=1</code>.
          </p>
          <button
            type="button"
            onClick={() => void refreshPreview()}
            disabled={loading}
            className="rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {loading ? "Leyendo…" : "Refrescar lectura"}
          </button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-200 bg-white/80 p-2">
              <p className="mb-1 text-xs font-semibold text-gray-700">
                Boleta {boleta ? `(${boleta.serie})` : ""}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="sr-only" htmlFor="dev-counter-b">
                  Próximo correlativo boleta
                </label>
                <input
                  id="dev-counter-b"
                  type="number"
                  min={1}
                  value={inputB}
                  onChange={(e) => setInputB(e.target.value)}
                  className="w-28 rounded border border-gray-300 px-2 py-1 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => void apply("boleta")}
                  disabled={saving !== null}
                  className="rounded-lg bg-amber-700 px-2 py-1 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {saving === "boleta" ? "…" : "Aplicar"}
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white/80 p-2">
              <p className="mb-1 text-xs font-semibold text-gray-700">
                Factura {factura ? `(${factura.serie})` : ""}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="sr-only" htmlFor="dev-counter-f">
                  Próximo correlativo factura
                </label>
                <input
                  id="dev-counter-f"
                  type="number"
                  min={1}
                  value={inputF}
                  onChange={(e) => setInputF(e.target.value)}
                  className="w-28 rounded border border-gray-300 px-2 py-1 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => void apply("factura")}
                  disabled={saving !== null}
                  className="rounded-lg bg-amber-700 px-2 py-1 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {saving === "factura" ? "…" : "Aplicar"}
                </button>
              </div>
            </div>
          </div>
          {msg ? <p className="text-xs font-medium text-amber-900">{msg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
