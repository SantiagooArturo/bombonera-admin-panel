/**
 * Paso 1 — Solo verificación (0 escrituras, 0 Firestore)
 *
 * Consulta apisunat/Lucode para comprobar si el CPE existe en SUNAT y muestra
 * la respuesta en consola. Cuando revises el output y des el OK, en un segundo
 * paso podremos armar la escritura a Firestore (otro script o el mismo con flag).
 *
 * Ejecutar:
 *   npx tsx scripts/verify-sunat-comprobante-readonly.ts
 *
 * Requiere en .env / .env.local (mismas claves que el panel):
 *   APISUNAT_URL   → ej. https://app.apisunat.pe/api/v3/documents
 *   APISUNAT_TOKEN
 *
 * Opcional:
 *   SUNAT_EMISOR_RUC  → si no está, se usa el mismo default que emisorSunatEnv (20511046255)
 *
 * Este archivo usa por defecto el caso que acordamos (puedes sobreescribir con env):
 *   VERIFY_SERIE_CORRELATIVO=B001-57135
 *   VERIFY_DOCUMENTO=boleta
 *   VERIFY_CLIENTE_WHATSAPP=934962505   → solo informativo en log (no se envía a apisunat)
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { apisunatApiBaseFromDocumentsUrl } from "../src/features/boletas/utils/apisunatBaseUrl";
import { normalizePeruPhone } from "../src/features/operaciones/utils";
import { getEmisorSunatFromEnv } from "../src/features/boletas/pdf/emisorSunatEnv";

function maskToken(t: string): string {
  if (t.length <= 8) return "***";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function v1SunatBaseFromDocumentsUrl(documentsUrl: string): string {
  const u = new URL(documentsUrl.trim());
  return `${u.origin}/api/v1`;
}

async function main() {
  console.log("\n=== verify-sunat-comprobante-readonly (solo lectura) ===\n");

  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    console.error("Faltan APISUNAT_URL o APISUNAT_TOKEN en el entorno (.env.local).");
    process.exit(1);
  }

  const serieCorrelativo =
    process.env.VERIFY_SERIE_CORRELATIVO?.trim() || "B001-57135";
  const documento = (process.env.VERIFY_DOCUMENTO?.trim() || "boleta").toLowerCase();
  const clienteWsp = process.env.VERIFY_CLIENTE_WHATSAPP?.trim() || "934962505";

  const match = serieCorrelativo.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!match) {
    console.error(`VERIFY_SERIE_CORRELATIVO inválido: "${serieCorrelativo}" (esperado ej. B001-57135)`);
    process.exit(1);
  }
  const serie = match[1].toUpperCase();
  const numero = parseInt(match[2], 10);
  if (!Number.isFinite(numero) || numero < 1) {
    console.error("Correlativo numérico inválido.");
    process.exit(1);
  }

  const emisor = getEmisorSunatFromEnv();
  const rucEmisor = emisor.ruc.replace(/\D/g, "");

  console.log("Config (sin secretos completos):");
  console.log(`  APISUNAT_URL:     ${APISUNAT_URL}`);
  console.log(`  APISUNAT_TOKEN:   ${maskToken(APISUNAT_TOKEN)}`);
  console.log(`  RUC emisor (env): ${rucEmisor}`);
  console.log(`  Consulta:         ${documento} ${serie}-${String(numero)}`);
  console.log(`  WhatsApp cliente: ${clienteWsp} (solo referencia para el paso 2; no va a apisunat)`);
  const digitsWsp = clienteWsp.replace(/\D/g, "");
  const suggestedUserId =
    digitsWsp.length >= 9 ? normalizePeruPhone(digitsWsp) || digitsWsp : digitsWsp;
  console.log(`  user_id sugerido: ${suggestedUserId || "(no se pudo normalizar)"}`);
  console.log("");

  const v3Base = apisunatApiBaseFromDocumentsUrl(APISUNAT_URL);
  const statusUrl = `${v3Base}/status`;
  const v1Base = v1SunatBaseFromDocumentsUrl(APISUNAT_URL);
  const comprobanteUrl = `${v1Base}/sunat/comprobante`;

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${APISUNAT_TOKEN}`,
  };

  // --- 1) POST /api/v3/status (catálogo facturación — consultar estado) ---
  console.log("--- 1) POST /api/v3/status ---\n");
  const statusBody = { documento, serie, numero };
  console.log("Request body:", JSON.stringify(statusBody, null, 2));
  try {
    const res = await fetch(statusUrl, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(statusBody),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
    console.log(`HTTP ${res.status}`);
    console.log("Response:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("Error de red en /status:", e);
  }

  console.log("\n--- 2) POST /api/v1/sunat/comprobante (consulta detalle) ---\n");
  /** Catálogo SUNAT: 01 factura, 03 boleta electrónica (típico). */
  const tipoSunat = documento === "factura" ? "01" : "03";
  const comprobanteBody = {
    tipo_comprobante: tipoSunat,
    ruc_emisor: rucEmisor,
    serie,
    numero: String(numero),
  };
  console.log("Request body:", JSON.stringify(comprobanteBody, null, 2));
  try {
    const res = await fetch(comprobanteUrl, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(comprobanteBody),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
    console.log(`HTTP ${res.status}`);
    console.log("Response:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("Error de red en /sunat/comprobante:", e);
  }

  console.log(
    "\n=== Fin verificación ===\nSi la respuesta es coherente, confirma y seguimos con Firestore.\n"
  );
}

void main();
