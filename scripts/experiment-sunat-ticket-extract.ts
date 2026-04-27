/**
 * Diagnóstico local: para un correlativo (por defecto B001-58505) llama apisunat `/status`
 * y compara extracción de datos desde:
 *   - XML UBL (`payload.xml`)
 *   - PDF ticket / A4 (pdfjs + mismas heurísticas que recuperación)
 *   - HTML: si la URL devuelve `text/html`, convierte a texto y aplica las mismas heurísticas
 *
 * No escribe Firestore. Solo consola.
 *
 *   npx tsx scripts/experiment-sunat-ticket-extract.ts
 *
 * Variables (opcionales):
 *   APISUNAT_URL, APISUNAT_TOKEN  (requeridos, como el resto de scripts)
 *   EXTRACT_SERIE=B001
 *   EXTRACT_NUMERO=58505
 *   EXTRACT_DOCUMENTO=boleta
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { apisunatApiBaseFromDocumentsUrl } from "../src/features/boletas/utils/apisunatBaseUrl";
import { extractRecoveryFromApisunatStatusXml } from "../src/features/boletas/services/extractRecoveryFromApisunatStatusXml";
import {
  extractDataFromPdf,
  normalizeApisunatStatusXmlField,
  parseApisunatTicketPlainText,
  resolveApisunatStatusXmlPayload,
  type PdfData,
} from "../src/features/boletas/services/sunatFirestoreRecovery";

async function pdfBufferToPlainText(buf: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib
    .getDocument({
      data: new Uint8Array(buf),
      disableFontFace: true,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    })
    .promise;
  let fullText = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string; transform?: number[] }>;
    const lines: string[][] = [];
    let cur: string[] = [];
    let lastY: number | null = null;
    for (const item of items) {
      const str = item.str ?? "";
      if (!str) continue;
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (cur.length) lines.push(cur);
        cur = [];
      }
      cur.push(str);
      lastY = y;
    }
    if (cur.length) lines.push(cur);
    fullText += lines.map((w) => w.join(" ")).join("\n") + "\n";
  }
  return fullText;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function usable(p: PdfData | null): boolean {
  if (!p) return false;
  return (
    Number.isFinite(p.importeTotal) &&
    p.importeTotal > 0 &&
    YMD.test(String(p.fechaEmision || "").trim()) &&
    p.clienteNombre.trim().length >= 2
  );
}

function labelOk(ok: boolean): string {
  return ok ? "SÍ (listo recuperación)" : "NO";
}

function summarize(label: string, p: PdfData | null, extra?: string): void {
  const u = usable(p);
  console.log(`\n--- ${label} ---`);
  console.log(`  usable: ${labelOk(u)}`);
  if (!p) {
    console.log("  (sin datos)");
    if (extra) console.log(`  nota: ${extra}`);
    return;
  }
  console.log(`  importeTotal: ${p.importeTotal}`);
  console.log(`  fechaEmision: ${p.fechaEmision || "(vacío)"}`);
  console.log(`  clienteNombre: ${p.clienteNombre || "(vacío)"}`);
  console.log(`  clienteDoc: ${p.clienteDoc || "(vacío)"}`);
  if (p.descripcion) console.log(`  descripcion: ${p.descripcion.slice(0, 120)}${p.descripcion.length > 120 ? "…" : ""}`);
  if (extra) console.log(`  nota: ${extra}`);
}

/** HTML típico de vista previa: quitar ruido y dejar texto para regex. */
function htmlToTicketPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|h[1-6]|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfMagic(buf: ArrayBuffer): boolean {
  const u = new Uint8Array(buf.slice(0, 5));
  return u.length >= 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46;
}

async function fetchResource(url: string, token: string): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  buf: ArrayBuffer;
}> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/pdf,text/html,application/xhtml+xml,*/*",
    },
    signal: AbortSignal.timeout(90_000),
  });
  const ct = (res.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const buf = await res.arrayBuffer();
  return { ok: res.ok, status: res.status, contentType: ct, buf };
}

async function probeUrl(kind: string, url: string, token: string): Promise<void> {
  console.log(`\n########## URL ${kind} ##########`);
  console.log(url.slice(0, 120) + (url.length > 120 ? "…" : ""));

  let got: Awaited<ReturnType<typeof fetchResource>>;
  try {
    got = await fetchResource(url, token);
  } catch (e) {
    console.log(`  ERROR fetch: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  console.log(`  HTTP ${got.status}  content-type: ${got.contentType || "(sin header)"}`);
  console.log(`  bytes: ${got.buf.byteLength}`);

  if (!got.ok) {
    console.log("  (no se analiza cuerpo por HTTP no OK)");
    return;
  }

  const pdfMagic = isPdfMagic(got.buf);
  const looksHtml =
    got.contentType.includes("html") ||
    got.contentType.includes("xhtml") ||
    (!pdfMagic && got.buf.byteLength > 0 && new TextDecoder("utf-8", { fatal: false }).decode(got.buf.slice(0, 200)).toLowerCase().includes("<html"));

  if (pdfMagic || got.contentType.includes("pdf")) {
    let fullText = "";
    try {
      fullText = await pdfBufferToPlainText(got.buf);
    } catch (e) {
      console.log(`  pdfjs error: ${e instanceof Error ? e.message : String(e)}`);
      summarize(`PDF (pdfjs) — ${kind}`, null, "falló pdfjs sobre el buffer");
      return;
    }
    const parsed = parseApisunatTicketPlainText(fullText);
    summarize(`PDF (pdfjs) — ${kind}`, parsed, "mismo parse que extractDataFromPdf");
    const preview = fullText.replace(/\s+/g, " ").trim().slice(0, 900);
    console.log(`  [texto pdfjs, primeros ~900 chars]\n  ${preview}${fullText.length > 900 ? "…" : ""}`);
    return;
  }

  if (looksHtml) {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(got.buf);
    const plain = htmlToTicketPlainText(html);
    const parsed = parseApisunatTicketPlainText(plain);
    summarize(`HTML → texto → heurísticas — ${kind}`, parsed, "Content-Type o cuerpo sugiere HTML");
    const preview = plain.slice(0, 900);
    console.log(`  [texto tras strip HTML, primeros ~900 chars]\n  ${preview}${plain.length > 900 ? "…" : ""}`);
    return;
  }

  console.log("  No clasificado como PDF ni HTML; primeros 120 bytes (utf-8 aprox):");
  console.log(
    "  ",
    new TextDecoder("utf-8", { fatal: false }).decode(got.buf.slice(0, 120)).replace(/\r?\n/g, "\\n")
  );
}

async function main(): Promise<void> {
  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    console.error("Faltan APISUNAT_URL o APISUNAT_TOKEN en .env / .env.local");
    process.exit(1);
  }

  const serie = process.env.EXTRACT_SERIE?.trim().toUpperCase() || "B001";
  const numero = parseInt(process.env.EXTRACT_NUMERO?.trim() || "58505", 10);
  const documento = (process.env.EXTRACT_DOCUMENTO?.trim() || "boleta").toLowerCase();

  if (!Number.isFinite(numero) || numero < 1) {
    console.error("EXTRACT_NUMERO inválido");
    process.exit(1);
  }

  const v3Base = apisunatApiBaseFromDocumentsUrl(APISUNAT_URL);
  const statusUrl = `${v3Base}/status`;

  console.log("\n=== experiment-sunat-ticket-extract ===\n");
  console.log(`Serie-correlativo: ${serie}-${numero}  documento: ${documento}`);
  console.log(`POST ${statusUrl}`);

  const statusRes = await fetch(statusUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APISUNAT_TOKEN}`,
    },
    body: JSON.stringify({ documento, serie, numero }),
  });
  const statusText = await statusRes.text();
  let statusJson: { success?: boolean; message?: string; payload?: Record<string, unknown> };
  try {
    statusJson = JSON.parse(statusText) as typeof statusJson;
  } catch {
    console.error("Respuesta /status no es JSON. Primeros 500 chars:\n", statusText.slice(0, 500));
    process.exit(1);
  }

  console.log(`HTTP ${statusRes.status}  success: ${String(statusJson.success)}`);
  const pl = statusJson.payload;
  if (!pl || typeof pl !== "object") {
    console.log("Sin payload. JSON completo:", JSON.stringify(statusJson, null, 2).slice(0, 3000));
    process.exit(0);
  }

  const keys = Object.keys(pl);
  console.log(`\nClaves en payload: ${keys.join(", ")}`);

  const xmlRaw = pl.xml;
  const xmlLen = typeof xmlRaw === "string" ? xmlRaw.length : 0;
  console.log(`\nxml: tipo=${typeof xmlRaw}  length=${xmlLen}`);
  if (typeof xmlRaw === "string" && xmlRaw.length > 0 && xmlRaw.length <= 240) {
    console.log(`  xml raw (diagnóstico): ${JSON.stringify(xmlRaw)}`);
  }
  if (typeof xmlRaw === "string" && xmlRaw.length > 0) {
    const normOnly = normalizeApisunatStatusXmlField(xmlRaw);
    console.log(`  normalize (solo inline/base64) → length=${normOnly?.length ?? 0}`);
    const norm = await resolveApisunatStatusXmlPayload(xmlRaw, APISUNAT_TOKEN);
    console.log(`  resolveApisunatStatusXmlPayload (incl. URL) → length=${norm?.length ?? 0}`);
    if (norm) console.log(`  inicio XML: ${norm.slice(0, 160).replace(/\s+/g, " ")}…`);
    const xmlParsed = extractRecoveryFromApisunatStatusXml(norm ?? "");
    summarize("XML UBL (extractRecoveryFromApisunatStatusXml)", xmlParsed);
  } else {
    summarize("XML UBL", null, "payload.xml ausente o no string");
  }

  const pdf = pl.pdf as { ticket?: string; a4?: string } | undefined;
  if (pdf?.ticket) await probeUrl("ticket", pdf.ticket, APISUNAT_TOKEN);
  else console.log("\n(sin pdf.ticket en payload)");

  if (pdf?.a4) await probeUrl("a4", pdf.a4, APISUNAT_TOKEN);
  else console.log("\n(sin pdf.a4 en payload)");

  console.log("\n=== Resumen rápido ===");
  const rows: Array<{ método: string; usable: string }> = [];
  if (typeof xmlRaw === "string" && xmlRaw.length) {
    const norm = await resolveApisunatStatusXmlPayload(xmlRaw, APISUNAT_TOKEN);
    const x = norm ? extractRecoveryFromApisunatStatusXml(norm) : null;
    rows.push({ método: "XML UBL (resolve + parse)", usable: labelOk(usable(x)) });
  } else rows.push({ método: "XML UBL", usable: "NO (sin xml)" });

  for (const [kind, url] of [
    ["ticket", pdf?.ticket],
    ["a4", pdf?.a4],
  ] as const) {
    if (!url || !url.startsWith("http")) continue;
    try {
      const got = await fetchResource(url, APISUNAT_TOKEN);
      if (!got.ok) {
        rows.push({ método: `GET ${kind} HTTP`, usable: `NO (${got.status})` });
        continue;
      }
      if (isPdfMagic(got.buf) || got.contentType.includes("pdf")) {
        const p = await extractDataFromPdf(url, APISUNAT_TOKEN);
        rows.push({ método: `PDF ${kind} (pdfjs)`, usable: labelOk(usable(p)) });
      } else if (got.contentType.includes("html") || got.contentType.includes("xhtml")) {
        const plain = htmlToTicketPlainText(new TextDecoder("utf-8", { fatal: false }).decode(got.buf));
        rows.push({ método: `HTML ${kind} → heurísticas`, usable: labelOk(usable(parseApisunatTicketPlainText(plain))) });
      } else {
        rows.push({ método: `GET ${kind} (${got.contentType || "?"})`, usable: "?" });
      }
    } catch {
      rows.push({ método: `GET ${kind}`, usable: "NO (error red)" });
    }
  }

  console.table(rows);
  console.log("\nFin.\n");
}

void main();
