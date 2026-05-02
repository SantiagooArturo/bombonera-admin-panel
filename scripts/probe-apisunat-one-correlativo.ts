/**
 * Consulta **un solo** correlativo en apisunat (sin Firestore ni heurística de huecos).
 *
 *   PROBE_NUMERO=57560 npx tsx scripts/probe-apisunat-one-correlativo.ts
 *
 * Opcionales:
 *   PROBE_SERIE=B001          (default B001)
 *   PROBE_DOCUMENTO=boleta    (default boleta | factura)
 *
 * Requiere en .env / .env.local:
 *   APISUNAT_URL   (ej. https://app.apisunat.pe/api/v3/documents)
 *   APISUNAT_TOKEN
 *
 * También llama a `/sunat/comprobante` usando el mismo RUC que el panel (`getEmisorSunatFromEnv`).
 */
import { config } from "dotenv";
import { resolve } from "path";
import { getEmisorSunatFromEnv } from "../src/features/boletas/pdf/emisorSunatEnv";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

type StatusJson = {
  success?: boolean;
  message?: string;
  payload?: Record<string, unknown>;
};

type ComprobanteJson = {
  success?: boolean;
  message?: string;
  payload?: Record<string, unknown>;
};

function v3BaseFromDocumentsUrl(documentsUrl: string): string {
  return documentsUrl.trim().replace(/\/+$/, "").replace(/\/documents$/i, "");
}

function v1BaseFromDocumentsUrl(documentsUrl: string): string {
  const u = new URL(documentsUrl.trim());
  return `${u.origin}/api/v1`;
}

function summarizeXmlField(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if (t.length <= 400) return t;
  return { length: t.length, preview: `${t.slice(0, 200)}…` };
}

function redactPayloadForPrint(p: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!p || typeof p !== "object") return p;
  const out: Record<string, unknown> = { ...p };
  if ("xml" in out) out.xml = summarizeXmlField(out.xml);
  return out;
}

async function postJson(
  url: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ http: number; text: string; json: unknown | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let json: unknown | null = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { http: res.status, text, json };
}

async function main(): Promise<void> {
  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  const serie = (process.env.PROBE_SERIE?.trim() || "B001").toUpperCase();
  const numeroRaw = process.env.PROBE_NUMERO?.trim() || process.env.PROBE_CORRELATIVO?.trim() || "";
  const documento = (process.env.PROBE_DOCUMENTO?.trim() || "boleta").toLowerCase();

  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    console.error("Faltan APISUNAT_URL o APISUNAT_TOKEN en .env / .env.local");
    process.exit(1);
  }
  const numero = parseInt(numeroRaw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(numero) || numero < 1) {
    console.error("Definí PROBE_NUMERO o PROBE_CORRELATIVO (entero >= 1), ej: PROBE_NUMERO=57560");
    process.exit(1);
  }

  const v3Base = v3BaseFromDocumentsUrl(APISUNAT_URL);
  const v1Base = v1BaseFromDocumentsUrl(APISUNAT_URL);
  const tipoComprobanteSunat = documento === "factura" ? "01" : "03";
  const rucEmisor = getEmisorSunatFromEnv().ruc.replace(/\D/g, "");

  console.log("\n=== probe-apisunat-one-correlativo ===\n");
  console.log(`Serie-correlativo: ${serie}-${numero}`);
  console.log(`documento apisunat: ${documento}`);
  console.log(`tipo_comprobante SUNAT (detalle): ${tipoComprobanteSunat}`);
  console.log(`v3 base: ${v3Base}`);
  console.log(`v1 base: ${v1Base}`);
  console.log(`RUC emisor (panel): ${rucEmisor}\n`);

  const statusUrl = `${v3Base}/status`;
  console.log(`--- POST ${statusUrl} ---`);
  const st = await postJson(statusUrl, APISUNAT_TOKEN, { documento, serie, numero });
  console.log(`HTTP ${st.http}`);
  if (st.json != null) {
    const j = st.json as StatusJson;
    const payload = j.payload && typeof j.payload === "object" ? (j.payload as Record<string, unknown>) : undefined;
    console.log(
      JSON.stringify(
        {
          success: j.success,
          message: j.message,
          payload: redactPayloadForPrint(payload),
        },
        null,
        2
      )
    );
  } else {
    console.log("Cuerpo no JSON (primeros 800 chars):");
    console.log(st.text.slice(0, 800));
  }

  const compUrl = `${v1Base}/sunat/comprobante`;
  console.log(`\n--- POST ${compUrl} ---`);
  const cp = await postJson(compUrl, APISUNAT_TOKEN, {
    tipo_comprobante: tipoComprobanteSunat,
    ruc_emisor: rucEmisor,
    serie,
    numero: String(numero),
  });
  console.log(`HTTP ${cp.http}`);
  if (cp.json != null) {
    console.log(JSON.stringify(cp.json as ComprobanteJson, null, 2));
  } else {
    console.log("Cuerpo no JSON (primeros 800 chars):");
    console.log(cp.text.slice(0, 800));
  }

  console.log("\nFin.\n");
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
