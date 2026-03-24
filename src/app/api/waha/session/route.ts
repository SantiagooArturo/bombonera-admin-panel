import { NextResponse } from "next/server";
import {
  WAHA_API_KEY,
  WAHA_ENV_MISSING,
  WAHA_SESSION,
  WAHA_URL,
  isWahaConfigured,
} from "@/lib/waha-server-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Proxy: estado de la sesión WAHA (polling desde el panel). */
export async function GET() {
  try {
    if (!isWahaConfigured()) {
      return NextResponse.json(
        { error: WAHA_ENV_MISSING },
        { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    headers["X-Api-Key"] = WAHA_API_KEY;

    const res = await fetch(`${WAHA_URL}/api/sessions/${encodeURIComponent(WAHA_SESSION)}`, {
      headers,
      cache: "no-store",
    });

    const raw = await res.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = { error: raw.slice(0, 200) };
    }

    if (!res.ok) {
      return NextResponse.json(
        typeof body === "object" && body !== null ? body : { error: "Error consultando sesión" },
        { status: res.status, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (e) {
    console.error("waha/session:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error interno" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
