import { getDb } from "@/lib/firebase-admin";
import { canRenderFormalPlantillaFromDoc } from "@/features/boletas/pdf/formalPlantillaEligibility";
import { renderFormalPlantillaPdfFromInvoiceDoc } from "@/features/boletas/pdf/formalPlantillaFromInvoiceDoc";

/**
 * Obtiene bytes del PDF del comprobante en el servidor (Firestore + plantilla o URL en doc).
 * Evita que WAHA/Railway tengan que hacer GET a URLs del panel (localhost / red).
 */
export async function getInvoicePdfBufferForSend(
  invoiceId: string,
  opts?: { selfOrigin?: string }
): Promise<Buffer | null> {
  const id = invoiceId.trim();
  if (!id) return null;

  const db = getDb();
  const snap = await db.collection("invoices").doc(id).get();
  if (!snap.exists) return null;

  const data = snap.data() as Record<string, unknown>;

  if (canRenderFormalPlantillaFromDoc(data)) {
    const raw = await renderFormalPlantillaPdfFromInvoiceDoc(data, id);
    return raw ? Buffer.from(raw) : null;
  }

  const fileUrl = typeof data.file_url === "string" ? data.file_url.trim() : "";
  if (!fileUrl) return null;

  const tryFetch = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 64) return null;
    return Buffer.from(ab);
  };

  let buf = await tryFetch(fileUrl);
  if (buf?.length) return buf;

  const origin = opts?.selfOrigin?.replace(/\/$/, "");
  if (origin) {
    buf = await tryFetch(`${origin}/api/proxy-file?url=${encodeURIComponent(fileUrl)}`);
  }

  return buf?.length ? buf : null;
}
