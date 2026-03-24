import { NextResponse } from "next/server";
import { ensureWahaSessionAllowsQr } from "@/lib/waha-ensure-qr-session";
import {
  WAHA_ENV_MISSING,
  getWahaApiKey,
  getWahaSession,
  getWahaUrl,
  isWahaConfigured,
} from "@/lib/waha-server-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseWahaErrorJson(raw: string): { message?: string; error?: string } {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      message: typeof o.message === "string" ? o.message : undefined,
      error: typeof o.error === "string" ? o.error : undefined,
    };
  } catch {
    return {};
  }
}

/** Proxy: GET {WAHA_URL}/api/{sesión}/auth/qr + Accept: application/json → { mimetype, data } */
export async function GET() {
  try {
    if (!isWahaConfigured()) {
      return NextResponse.json(
        { error: WAHA_ENV_MISSING },
        { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const prepared = await ensureWahaSessionAllowsQr();
    if (!prepared.ready) {
      if (prepared.reason === "WORKING") {
        return NextResponse.json(
          { error: prepared.message, code: "SESSION_WORKING" },
          { status: 409, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
      return NextResponse.json(
        { error: prepared.message },
        { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Api-Key": getWahaApiKey(),
    };

    const qrUrl = `${getWahaUrl()}/api/${encodeURIComponent(getWahaSession())}/auth/qr`;
    let lastStatus = 500;
    let lastBody: unknown = { error: "Error obteniendo QR" };

    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(qrUrl, { headers, cache: "no-store" });
      const raw = await res.text();
      lastStatus = res.status;

      if (res.ok) {
        try {
          const body = raw ? JSON.parse(raw) : {};
          return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
        } catch {
          lastBody = { error: raw.slice(0, 200) };
          break;
        }
      }

      const parsed = parseWahaErrorJson(raw);
      lastBody = {
        error: parsed.message || parsed.error || raw.slice(0, 300) || "Error obteniendo QR",
      };

      const msg = String((lastBody as { error?: string }).error || "").toLowerCase();
      const retryable =
        msg.includes("not as expected") ||
        msg.includes("try again") ||
        res.status === 425 ||
        res.status === 503;

      if (retryable && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }

      return NextResponse.json(
        typeof lastBody === "object" && lastBody !== null ? lastBody : { error: "Error obteniendo QR" },
        { status: lastStatus, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      typeof lastBody === "object" && lastBody !== null ? lastBody : { error: "Error obteniendo QR" },
      { status: lastStatus, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    console.error("waha/qr:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error interno" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
