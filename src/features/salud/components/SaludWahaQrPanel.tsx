"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WahaQrImage, WahaSession } from "@/lib/types";

/** Mismo intervalo para sesión y QR: el QR de WhatsApp rota ~cada ~60s sin fase conocida; pedir cada pocos s asegura imagen vigente. */
const WAHA_POLL_MS = 3_000;

function parseSession(json: unknown): WahaSession | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.status !== "string") return null;
  const meRaw = o.me;
  let me: WahaSession["me"] = null;
  if (meRaw && typeof meRaw === "object") {
    const m = meRaw as Record<string, unknown>;
    if (typeof m.id === "string") {
      me = { id: m.id, pushName: typeof m.pushName === "string" ? m.pushName : null };
    }
  }
  return { name: o.name, status: o.status, me };
}

/**
 * Segunda columna en /salud: vincular WhatsApp vía WAHA cuando el keepalive está en rojo.
 * Solo se monta cuando el padre ya determinó salud mala; usa /api/waha/qr y /api/waha/session.
 */
export function SaludWahaQrPanel() {
  const [session, setSession] = useState<WahaSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const offRef = useRef(false);

  const wahaConnected =
    session?.status === "WORKING" && session.me && typeof session.me.id === "string";

  const loadQr = useCallback(async () => {
    try {
      const res = await fetch("/api/waha/qr", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Partial<WahaQrImage> & { error?: string };
      if (!res.ok) {
        setQrError(data.error || `Error HTTP ${res.status}`);
        setQrDataUrl(null);
        return;
      }
      if (typeof data.data === "string" && typeof data.mimetype === "string") {
        setQrDataUrl(`data:${data.mimetype};base64,${data.data}`);
        setQrError(null);
      } else {
        setQrError("Respuesta del servidor sin imagen QR válida.");
        setQrDataUrl(null);
      }
    } catch (e) {
      setQrError(e instanceof Error ? e.message : "Error de red");
      setQrDataUrl(null);
    }
  }, []);

  useEffect(() => {
    offRef.current = false;
    if (wahaConnected) return;

    const pollSession = async () => {
      try {
        const res = await fetch("/api/waha/session", { cache: "no-store" });
        const json: unknown = await res.json().catch(() => ({}));
        if (offRef.current) return;
        if (!res.ok) {
          const err =
            json && typeof json === "object" && "error" in json
              ? String((json as { error: unknown }).error)
              : `HTTP ${res.status}`;
          setSessionErr(err);
          setSession(null);
          return;
        }
        setSessionErr(null);
        setSession(parseSession(json));
      } catch (e) {
        if (!offRef.current) {
          setSessionErr(e instanceof Error ? e.message : "Error al consultar sesión");
          setSession(null);
        }
      }
    };

    pollSession();
    const sid = setInterval(pollSession, WAHA_POLL_MS);
    return () => {
      offRef.current = true;
      clearInterval(sid);
    };
  }, [wahaConnected]);

  useEffect(() => {
    if (wahaConnected) return;
    loadQr();
    const qid = setInterval(loadQr, WAHA_POLL_MS);
    return () => clearInterval(qid);
  }, [wahaConnected, loadQr]);

  if (wahaConnected && session?.me) {
    const label = session.me.pushName?.trim() || session.me.id.replace(/@c\.us$/i, "");
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-full">
        <h2 className="text-xl font-bold text-gray-900">WhatsApp (WAHA)</h2>
        <p className="text-sm text-gray-500 mt-1">Sesión activa en el servidor.</p>
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-800">Conectado</p>
          <p className="text-base font-bold text-emerald-900 mt-2 break-all" title={session.me.id}>
            {label}
          </p>
          <p className="text-xs text-emerald-700/80 mt-2 font-mono break-all">{session.me.id}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-full">
      <h2 className="text-xl font-bold text-gray-900">Vincular WhatsApp</h2>
      <p className="text-sm text-gray-500 mt-1">
        El keepalive marcó un problema. Escanea el código con WhatsApp en tu teléfono para reconectar la sesión WAHA. WhatsApp
        renueva el QR a menudo; este panel vuelve a pedirlo cada pocos segundos para mostrar siempre uno vigente.
      </p>

      <div className="mt-6 flex flex-col items-center">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- QR dinámico base64 desde WAHA
          <img
            src={qrDataUrl}
            alt="Código QR para vincular WhatsApp"
            className="w-[220px] h-[220px] rounded-xl border border-gray-200 bg-white p-2 shadow-inner"
          />
        ) : (
          <div className="w-[220px] h-[220px] rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center p-4 text-center">
            <p className="text-sm text-gray-600">{qrError || "Generando código…"}</p>
          </div>
        )}

        <div className="mt-4 w-full max-w-sm text-center space-y-1">
          {sessionErr ? (
            <p className="text-xs text-red-600">{sessionErr}</p>
          ) : session ? (
            <p className="text-xs text-gray-500">
              Estado sesión: <span className="font-semibold text-gray-700">{session.status}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
