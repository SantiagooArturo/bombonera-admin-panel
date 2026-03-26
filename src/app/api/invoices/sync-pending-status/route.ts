import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { apisunatApiBaseFromDocumentsUrl } from "@/features/boletas/utils/apisunatBaseUrl";

type ApisunatStatusResponse = {
  success?: boolean;
  message?: string;
  payload?: { estado?: string };
};

function parseSerieCorrelativo(raw: string): { serie: string; numero: number } | null {
  const m = raw.trim().match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!m) return null;
  const numero = Number.parseInt(m[2], 10);
  if (!Number.isFinite(numero) || numero < 1) return null;
  return { serie: m[1].toUpperCase(), numero };
}

export async function POST() {
  const APISUNAT_URL_VAL = process.env.APISUNAT_URL;
  const APISUNAT_TOKEN_VAL = process.env.APISUNAT_TOKEN;
  if (!APISUNAT_URL_VAL || !APISUNAT_TOKEN_VAL) {
    return NextResponse.json({ error: "Falta configuración APISUNAT en servidor" }, { status: 500 });
  }

  try {
    const db = getDb();
    const statusUrl = `${apisunatApiBaseFromDocumentsUrl(APISUNAT_URL_VAL)}/status`;
    const pendingSnap = await db.collection("invoices").where("sunat_estado", "==", "PENDIENTE").get();

    let checked = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of pendingSnap.docs) {
      const inv = doc.data() || {};
      const tipo = inv.tipo_comprobante === "factura" ? "factura" : "boleta";
      const parsed = parseSerieCorrelativo(String(inv.serie_correlativo || ""));
      if (!parsed) {
        skipped += 1;
        continue;
      }

      checked += 1;
      try {
        const res = await fetch(statusUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${APISUNAT_TOKEN_VAL}`,
          },
          body: JSON.stringify({
            documento: tipo,
            serie: parsed.serie,
            numero: parsed.numero,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as ApisunatStatusResponse;
        if (!res.ok) {
          failed += 1;
          continue;
        }
        const nextEstado = String(data.payload?.estado || "").trim().toUpperCase();
        if (!nextEstado || nextEstado === "PENDIENTE") {
          continue;
        }

        await doc.ref.update({ sunat_estado: nextEstado });
        updated += 1;
      } catch {
        failed += 1;
      }
    }

    return NextResponse.json({
      success: true,
      total_pending: pendingSnap.size,
      checked,
      updated,
      skipped,
      failed,
    });
  } catch (error) {
    console.error("sync pending invoice status:", error);
    return NextResponse.json({ error: "Error sincronizando estados pendientes" }, { status: 500 });
  }
}

