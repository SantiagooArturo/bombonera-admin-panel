/**
 * Depuración local: GET a URLs de PDF apisunat (las del mensaje "omitidos en el escaneo")
 * con el mismo Bearer y el mismo pipeline que recuperación (pdfjs + parseApisunatTicketPlainText).
 *
 * Uso:
 *   npx tsx scripts/debug-apisunat-pdf-urls.ts "https://app.apisunat.pe/pdf/a4/..."
 *
 * Varias URLs (espacio o pipe):
 *   npx tsx scripts/debug-apisunat-pdf-urls.ts "URL_TICKET" "URL_A4"
 *
 * O variable:
 *   DEBUG_APISUNAT_PDF_URLS="url1|url2" npx tsx scripts/debug-apisunat-pdf-urls.ts
 *
 * Requiere APISUNAT_TOKEN en .env / .env.local (APISUNAT_URL no hace falta aquí).
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import {
  extractPlainTextFromPdfBytes,
  isApisunatPdfExtractUsableForRecovery,
  parseApisunatTicketPlainText,
  type PdfData,
} from "../src/features/boletas/services/sunatFirestoreRecovery";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function collectUrlsFromArgv(): string[] {
  const fromEnv = process.env.DEBUG_APISUNAT_PDF_URLS?.trim();
  const raw = fromEnv
    ? fromEnv.split(/[|\n]+/).map((s) => s.trim())
    : process.argv.slice(2).map((s) => s.trim());
  return raw.filter((u) => u.startsWith("http://") || u.startsWith("https://"));
}

function snippetAround(fullText: string, needle: string, radius = 140): string {
  const i = fullText.indexOf(needle);
  if (i < 0) return `(no aparece "${needle.slice(0, 40)}${needle.length > 40 ? "…" : ""}")`;
  const a = Math.max(0, i - radius);
  const b = Math.min(fullText.length, i + needle.length + radius);
  return JSON.stringify(fullText.slice(a, b).replace(/\s+/g, " "));
}

function explainUsable(p: PdfData): void {
  const amountOk = Number.isFinite(p.importeTotal) && p.importeTotal > 0;
  const fechaOk = YMD.test(String(p.fechaEmision || "").trim());
  const clienteOk = p.clienteNombre.trim().length >= 2;
  console.log(
    `  criterios recuperación: monto=${amountOk}  fechaYmd=${fechaOk}  clienteNombre(>=2)=${clienteOk}`
  );
}

async function main(): Promise<void> {
  const token = process.env.APISUNAT_TOKEN?.trim();
  if (!token) {
    console.error("Falta APISUNAT_TOKEN en .env / .env.local");
    process.exit(1);
  }

  const urls = collectUrlsFromArgv();
  if (urls.length === 0) {
    console.error(
      "Pasa al menos una URL https://… como argumento, o DEBUG_APISUNAT_PDF_URLS=url1|url2"
    );
    process.exit(1);
  }

  console.log("\n=== debug-apisunat-pdf-urls ===\n");

  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx]!;
    console.log(`\n--- [${idx + 1}/${urls.length}] ---\n${url}\n`);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/pdf,*/*",
        },
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      console.log(`fetch error: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const ct = (res.headers.get("content-type") || "").split(";")[0]!.trim();
    const buf = await res.arrayBuffer();
    console.log(`HTTP ${res.status}  content-type: ${ct || "(vacío)"}  bytes: ${buf.byteLength}`);

    if (!res.ok) {
      console.log("Cuerpo no procesado (HTTP no OK).");
      continue;
    }

    let fullText: string;
    try {
      fullText = await extractPlainTextFromPdfBytes(buf);
    } catch (e) {
      console.log(`pdfjs: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    console.log(`texto extraído: ${fullText.length} chars`);
    const parsed = parseApisunatTicketPlainText(fullText);
    const usable = isApisunatPdfExtractUsableForRecovery(parsed);
    console.log(`usable para recuperación: ${usable ? "SÍ" : "NO"}`);
    console.log(`  importeTotal: ${parsed.importeTotal}`);
    console.log(`  fechaEmision: ${parsed.fechaEmision || "(vacío)"}`);
    console.log(`  clienteNombre: ${JSON.stringify(parsed.clienteNombre)}`);
    console.log(`  clienteDoc: ${parsed.clienteDoc || "(vacío)"}`);
    explainUsable(parsed);

    for (const needle of ["Fecha de emisión", "Fecha de emision", "Importe Total", "Nombres", "TOTAL"]) {
      console.log(`  contexto ${needle}: ${snippetAround(fullText, needle)}`);
    }

    const collapsed = fullText.replace(/\s+/g, " ").trim();
    console.log(`\n  [texto colapsado, primeros 1200 chars]\n  ${collapsed.slice(0, 1200)}${collapsed.length > 1200 ? "…" : ""}\n`);
  }

  console.log("Fin.\n");
}

void main();
