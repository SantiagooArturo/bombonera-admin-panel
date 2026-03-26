/**
 * Verifica en apisunat el estado de comprobantes con `sunat_estado = "PENDIENTE"` en Firestore.
 * Solo lectura: no actualiza Firestore.
 *
 * Ejecutar:
 *   npx tsx scripts/verify-pending-invoices-status.ts
 *
 * Requiere:
 *   APISUNAT_URL
 *   APISUNAT_TOKEN
 *   credenciales de Firebase Admin (igual que otros scripts)
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { getDb } from "../src/lib/firebase-admin";
import { apisunatApiBaseFromDocumentsUrl } from "../src/features/boletas/utils/apisunatBaseUrl";

type StatusResult = {
  success?: boolean;
  message?: string;
  payload?: { estado?: string };
};

function parseSerieCorrelativo(value: string): { serie: string; numero: number } | null {
  const m = value.trim().match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!m) return null;
  const numero = Number.parseInt(m[2], 10);
  if (!Number.isFinite(numero) || numero < 1) return null;
  return { serie: m[1].toUpperCase(), numero };
}

async function main() {
  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    console.error("Faltan APISUNAT_URL o APISUNAT_TOKEN.");
    process.exit(1);
  }

  const db = getDb();
  const snapshot = await db.collection("invoices").where("sunat_estado", "==", "PENDIENTE").get();
  const docs = snapshot.docs;
  console.log(`[verify-pending] total_pendientes_firestore=${docs.length}`);
  if (docs.length === 0) return;

  const statusUrl = `${apisunatApiBaseFromDocumentsUrl(APISUNAT_URL)}/status`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${APISUNAT_TOKEN}`,
  };

  const totals = {
    confirmadoSunat: 0,
    noEncontrado: 0,
    siguenPendiente: 0,
    otros: 0,
    errorHttp: 0,
    sinSerieValida: 0,
  };

  for (const d of docs) {
    const inv = d.data() || {};
    const tipo = inv.tipo_comprobante === "factura" ? "factura" : "boleta";
    const serieCorrelativo = String(inv.serie_correlativo || "").trim();
    const parsed = parseSerieCorrelativo(serieCorrelativo);
    if (!parsed) {
      totals.sinSerieValida += 1;
      console.log(`[verify-pending] id=${d.id} serie_correlativo inválido="${serieCorrelativo}"`);
      continue;
    }

    try {
      const res = await fetch(statusUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          documento: tipo,
          serie: parsed.serie,
          numero: parsed.numero,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as StatusResult;
      const msg = String(data.message || "").toLowerCase();
      const estado = String(data.payload?.estado || "").toUpperCase();

      if (!res.ok) {
        totals.errorHttp += 1;
        if (msg.includes("no se encuentra registrado")) totals.noEncontrado += 1;
        console.log(
          `[verify-pending] id=${d.id} ${tipo} ${parsed.serie}-${parsed.numero} HTTP=${res.status} msg="${data.message || ""}"`
        );
        continue;
      }

      if (data.success === true) {
        if (estado === "PENDIENTE") {
          totals.siguenPendiente += 1;
        } else {
          totals.confirmadoSunat += 1;
        }
      } else if (msg.includes("no se encuentra registrado")) {
        totals.noEncontrado += 1;
      } else {
        totals.otros += 1;
      }

      console.log(
        `[verify-pending] id=${d.id} ${tipo} ${parsed.serie}-${parsed.numero} success=${Boolean(
          data.success
        )} estado="${estado || "-"}" msg="${data.message || ""}"`
      );
    } catch (e) {
      totals.errorHttp += 1;
      console.log(
        `[verify-pending] id=${d.id} ${tipo} ${parsed.serie}-${parsed.numero} error_red="${
          e instanceof Error ? e.message : String(e)
        }"`
      );
    }
  }

  console.log("\n[verify-pending] resumen");
  console.log(JSON.stringify(totals, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

