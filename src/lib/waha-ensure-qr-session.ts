import { getWahaApiKey, getWahaSession, getWahaUrl } from "@/lib/waha-server-config";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wahaJsonHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Api-Key": getWahaApiKey(),
  };
}

type WahaSessionMeta = { status?: string; name?: string };

/** GET /api/sessions/{name} */
export async function fetchWahaSessionMeta(): Promise<{ ok: true; data: WahaSessionMeta } | { ok: false; status: number; text: string }> {
  const res = await fetch(`${getWahaUrl()}/api/sessions/${encodeURIComponent(getWahaSession())}`, {
    headers: { Accept: "application/json", "X-Api-Key": getWahaApiKey() },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 500) };
  try {
    return { ok: true, data: text ? (JSON.parse(text) as WahaSessionMeta) : {} };
  } catch {
    return { ok: false, status: 502, text: "JSON inválido al leer sesión WAHA" };
  }
}

/**
 * El GET /api/{session}/auth/qr solo responde bien en estados como SCAN_QR_CODE.
 * Si está STOPPED/FAILED/STARTING, hay que arrancar o reiniciar la sesión primero (documentación WAHA).
 */
export async function ensureWahaSessionAllowsQr(): Promise<
  | { ready: true }
  | { ready: false; reason: "WORKING"; message: string }
  | { ready: false; reason: "ERROR"; message: string }
> {
  const metaRes = await fetchWahaSessionMeta();
  if (!metaRes.ok) {
    return {
      ready: false,
      reason: "ERROR",
      message: `No se pudo leer la sesión WAHA (${metaRes.status}). ${metaRes.text}`,
    };
  }

  const status = String(metaRes.data.status || "");

  if (status === "WORKING") {
    return {
      ready: false,
      reason: "WORKING",
      message: "La sesión ya está conectada (WORKING). No se puede pedir QR hasta cerrar sesión en WAHA si quieres re-vincular.",
    };
  }

  if (status === "SCAN_QR_CODE") {
    return { ready: true };
  }

  /**
   * WAHA (documentación): en FAILED → reiniciar; en STOPPED → start.
   * POST /api/sessions/{name}/restart — para y vuelve a arrancar (útil tras FAILED).
   * POST /api/sessions/{name}/start — idempotente si ya corre o arranca desde STOPPED.
   * Si restart no basta: POST .../logout y luego start (manual o dashboard).
   */
  const enc = encodeURIComponent(getWahaSession());
  const startUrl = `${getWahaUrl()}/api/sessions/${enc}/start`;
  const restartUrl = `${getWahaUrl()}/api/sessions/${enc}/restart`;

  let post: Response;
  if (status === "FAILED") {
    post = await fetch(restartUrl, {
      method: "POST",
      headers: wahaJsonHeaders(),
      body: "{}",
      cache: "no-store",
    });
    if (!post.ok) {
      post = await fetch(startUrl, {
        method: "POST",
        headers: wahaJsonHeaders(),
        body: "{}",
        cache: "no-store",
      });
    }
  } else {
    post = await fetch(startUrl, {
      method: "POST",
      headers: wahaJsonHeaders(),
      body: "{}",
      cache: "no-store",
    });
  }

  if (!post.ok) {
    const errText = await post.text().catch(() => "");
    return {
      ready: false,
      reason: "ERROR",
      message: `No se pudo iniciar/reiniciar la sesión WAHA (${post.status}). ${errText.slice(0, 300)}`,
    };
  }

  await delay(2000);
  return { ready: true };
}
