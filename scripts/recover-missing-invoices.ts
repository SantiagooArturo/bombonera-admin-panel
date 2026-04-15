/**
 * Recuperar boletas/facturas emitidas en SUNAT pero ausentes en Firestore.
 *
 * 1. Lee todos los invoices de Firestore para la serie indicada (default B001).
 * 2. Detecta gaps en la secuencia de correlativos.
 * 3. Por cada gap consulta apisunat POST /api/v1/sunat/comprobante.
 * 4. Si existe en SUNAT, crea el documento en Firestore.
 *
 * Por defecto SOLO SIMULA. Para escribir:
 *   RECOVER_MISSING_APPLY=1 npx tsx scripts/recover-missing-invoices.ts
 *
 * Env opcionales:
 *   RECOVER_SERIE          → default B001
 *   RECOVER_MIN_CORRELATIVO → ignorar correlativos anteriores (default: el mínimo en Firestore)
 *   RECOVER_MAX_CORRELATIVO → ignorar correlativos posteriores (default: el máximo en Firestore)
 *   RECOVER_DELAY_MS        → delay entre requests a apisunat (default 200)
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { getDb } from "../src/lib/firebase-admin";
import { getEmisorSunatFromEnv } from "../src/features/boletas/pdf/emisorSunatEnv";
import { receptorNombreSnapshot } from "../src/features/boletas/utils/sanitizeReceptorNombre";

const APPLY =
  process.env.RECOVER_MISSING_APPLY === "1" ||
  process.env.RECOVER_MISSING_APPLY === "true";

const SERIE = process.env.RECOVER_SERIE?.trim() || "B001";
const DELAY_MS = Number(process.env.RECOVER_DELAY_MS) || 200;

// ── PDF text extraction (pdfjs-dist) ──

type PdfData = {
  importeTotal: number;
  fechaEmision: string;
  clienteNombre: string;
  clienteDoc: string;
  descripcion: string;
};

const DEBUG_PDF = process.env.DEBUG_PDF === "1";
let pdfDebugDone = false;

function reconstructTextFromPdfItems(
  items: Array<{ str?: string; transform?: number[] }>
): string {
  if (items.length === 0) return "";
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let lastY: number | null = null;

  for (const item of items) {
    const str = item.str ?? "";
    if (!str) continue;
    const y = item.transform?.[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [];
    }
    currentLine.push(str);
    lastY = y;
  }
  if (currentLine.length > 0) lines.push(currentLine);

  return lines.map((words) => words.join(" ")).join("\n");
}

async function extractDataFromPdf(
  pdfUrl: string,
  token: string
): Promise<PdfData | null> {
  try {
    const res = await fetch(pdfUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (DEBUG_PDF) console.warn(`    PDF fetch failed: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    let fullText = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageText = reconstructTextFromPdfItems(
        content.items as Array<{ str?: string; transform?: number[] }>
      );
      fullText += pageText + "\n";
    }

    if (DEBUG_PDF && !pdfDebugDone) {
      console.log("\n──── DEBUG PDF TEXT (primer PDF) ────");
      console.log(fullText.slice(0, 2000));
      console.log("──── FIN DEBUG ────\n");
      pdfDebugDone = true;
    }

    // "Total (S/):   50.00" or "Importe Total S/ 50.00"
    const importeMatch =
      fullText.match(/Total\s+\(S\/\)\s*:\s*([\d,]+(?:\.\d+)?)/i) ??
      fullText.match(/Importe\s+Total\s+S\/\s*([\d,]+(?:\.\d+)?)/i);
    const importe = importeMatch
      ? parseFloat(importeMatch[1]!.replace(/,/g, ""))
      : 0;

    // "Fecha:   23/03/2026 09:04 PM" or "Fecha de emisión: 23/03/2026"
    const fechaMatch =
      fullText.match(/Fecha\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i) ??
      fullText.match(/Fecha\s+de\s+emisi[oó]n\s*[:\s]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    let fechaYmd = "";
    if (fechaMatch) {
      const [dd, mm, yyyy] = fechaMatch[1]!.split("/");
      if (dd && mm && yyyy) fechaYmd = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }

    // "Cliente:   ALONSO SERQUEN" or "Nombres: ..."
    const clienteMatch =
      fullText.match(/Cliente\s*:\s*(.+)/i) ??
      fullText.match(/Nombres?\s*:\s*(.+)/i);
    const clienteNombre = clienteMatch
      ? clienteMatch[1]!.replace(/\s+/g, " ").trim()
      : "";

    const dniMatch = fullText.match(/(?:DNI|RUC)\s*:?\s*(\d+)/i);
    const clienteDoc = dniMatch ? dniMatch[1]! : "";

    // Description: lines between the table header and "Total Gravado"
    const descLines: string[] = [];
    const descMatch = fullText.match(
      /(?:Cant\s+U\.?M|Cantidad\s+UM)\s+.*?\n([\s\S]*?)(?:Total\s+Gravado|Consulta|Representaci)/i
    );
    if (descMatch) {
      const raw = descMatch[1]!.trim();
      const lines = raw.split("\n").filter((l) => {
        const trimmed = l.trim();
        if (!trimmed) return false;
        if (/^\d+\s+[A-Z]{1,3}\s+[\d,.]+\s+[\d,.]+$/.test(trimmed)) return false;
        return true;
      });
      if (lines.length > 0) {
        descLines.push(lines.map((l) => l.trim()).join(" | "));
      }
    }

    return {
      importeTotal: Number.isFinite(importe) ? importe : 0,
      fechaEmision: fechaYmd,
      clienteNombre,
      clienteDoc,
      descripcion: descLines.join(" | "),
    };
  } catch (e) {
    console.warn(`    PDF parse error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ── apisunat helpers ──

function v1BaseFromDocumentsUrl(documentsUrl: string): string {
  const u = new URL(documentsUrl.trim());
  return `${u.origin}/api/v1`;
}

function normalizeSunatEstado(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (s.includes("ACEPTA")) return "ACEPTADO";
  if (s.includes("RECHAZA")) return "RECHAZADO";
  if (s.includes("PENDIENTE")) return "PENDIENTE";
  if (s.includes("ANULA")) return "ANULADO";
  return s || "DESCONOCIDO";
}

// ── Respuesta POST /api/v3/status (registros internos apisunat) ──

type StatusResponse = {
  success: boolean;
  message?: string;
  payload?: {
    estado?: string;
    hash?: string;
    xml?: string;
    cdr?: string;
    pdf?: { ticket?: string };
  };
};

async function fetchStatus(params: {
  v3Base: string;
  token: string;
  documento: string;
  serie: string;
  numero: number;
}): Promise<StatusResponse | null> {
  const { v3Base, token, documento, serie, numero } = params;
  const url = `${v3Base}/status`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ documento, serie, numero }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as StatusResponse;
    } catch {
      console.warn(`  [${serie}-${numero}] /status respuesta no-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
      return null;
    }
  } catch (e) {
    console.error(`  [${serie}-${numero}] /status error de red:`, e);
    return null;
  }
}

// ── Respuesta POST /api/v1/sunat/comprobante (detalle completo desde SUNAT) ──

type ComprobanteResponse = {
  success: boolean;
  message?: string;
  payload?: {
    cliente?: { numero_documento?: string; nombre_cliente?: string; direccion?: string };
    detalle?: {
      fecha_emision?: string;
      forma_pago?: string;
      estado_comprobante?: string;
    };
    items?: Array<{ descripcion?: string }>;
    totales?: { monto_total_general?: string };
    url_descarga?: { pdf?: string; xml?: string };
  };
};

async function fetchComprobante(params: {
  v1Base: string;
  token: string;
  rucEmisor: string;
  tipoComprobante: string;
  serie: string;
  numero: number;
}): Promise<ComprobanteResponse | null> {
  const { v1Base, token, rucEmisor, tipoComprobante, serie, numero } = params;
  const url = `${v1Base}/sunat/comprobante`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tipo_comprobante: tipoComprobante,
        ruc_emisor: rucEmisor,
        serie,
        numero: String(numero),
      }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as ComprobanteResponse;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ── Construir documento Firestore combinando ambas fuentes ──

function buildFirestoreDoc(params: {
  serie: string;
  correlativo: number;
  statusPayload: NonNullable<StatusResponse["payload"]>;
  comprobantePayload?: ComprobanteResponse["payload"] | null;
  pdfData?: PdfData | null;
  tipoComprobante: "boleta" | "factura";
}): Record<string, unknown> {
  const { serie, correlativo, statusPayload, comprobantePayload, pdfData, tipoComprobante } = params;

  const estadoRaw = String(statusPayload.estado || "").trim();
  const sunatEstado = normalizeSunatEstado(estadoRaw);

  const cliente = comprobantePayload?.cliente || {};
  const detalle = comprobantePayload?.detalle || {};
  const totales = comprobantePayload?.totales || {};
  const items = comprobantePayload?.items || [];

  const clienteName = String(cliente.nombre_cliente || "").trim() || pdfData?.clienteNombre || "";
  const clienteDoc = String(cliente.numero_documento || "").trim() || pdfData?.clienteDoc || "";
  const fechaEmision = String(detalle.fecha_emision || "").trim() || pdfData?.fechaEmision || "";
  const amount = parseFloat(String(totales.monto_total_general || "0")) || pdfData?.importeTotal || 0;
  const descripcion = items.map((i) => String(i.descripcion || "")).filter(Boolean).join(" | ") || pdfData?.descripcion || "";
  const condicionVenta = String(detalle.forma_pago || "").trim() || "Contado";

  const clienteTipoDoc = tipoComprobante === "factura" ? "6" : "1";
  const repSnap = clienteName ? receptorNombreSnapshot(clienteName) : "";

  return {
    reservation_id: "manual",
    user_id: "",
    phone_number: "",
    cliente_denominacion: clienteName,
    cliente_numero_de_documento: clienteDoc,
    cliente_tipo_documento: clienteTipoDoc,
    representative_name_snapshot: repSnap,
    file_url: "",
    file_url_sunat: "",
    file_url_xml: "",
    condicion_venta: condicionVenta,
    amount,
    descripcion,
    court_type: "",
    field: null,
    date: fechaEmision,
    time_slots: [],
    transfer_id: null,
    serie,
    tipo_comprobante: tipoComprobante,
    correlativo,
    serie_correlativo: `${serie}-${correlativo}`,
    sunat_hash: String(statusPayload.hash || "") || null,
    sunat_estado: sunatEstado,
    sunat_xml: String(statusPayload.xml || "") || null,
    sunat_cdr: String(statusPayload.cdr || "") || null,
    sunat_pdf_ticket: String(statusPayload.pdf?.ticket || "") || null,
    status: sunatEstado === "ANULADO" ? "voided" : "emitted",
    ...(sunatEstado === "ANULADO"
      ? {
          voided_at: new Date().toISOString(),
          void_motivo: "ANULACIÓN DE OPERACIÓN (recuperación batch)",
        }
      : {}),
    created_at: fechaEmision
      ? new Date(new Date(`${fechaEmision}T17:00:00.000Z`).getTime() + (correlativo % 1000) * 1000).toISOString()
      : new Date().toISOString(),
    fecha_emision_ymd: fechaEmision,
    hora_emision_hms: "",
    ...(tipoComprobante === "factura" && cliente.direccion
      ? { cliente_direccion: cliente.direccion }
      : {}),
    recovery_source: "script_recover-missing-invoices-batch",
    recovery_note: `Recuperado automáticamente desde SUNAT el ${new Date().toISOString().slice(0, 10)}. Estado: ${estadoRaw || "sin dato"}.`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──

async function main() {
  console.log("\n=== recover-missing-invoices ===\n");
  console.log(`Modo: ${APPLY ? "APLICAR (escribe en Firestore)" : "SIMULACIÓN (solo muestra)"}`);
  console.log(`Serie: ${SERIE}\n`);

  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    console.error("Faltan APISUNAT_URL o APISUNAT_TOKEN en .env");
    process.exit(1);
  }

  const emisor = getEmisorSunatFromEnv();
  const rucEmisor = emisor.ruc.replace(/\D/g, "");
  const v3Base = APISUNAT_URL.trim().replace(/\/+$/, "").replace(/\/documents$/i, "");
  const v1Base = v1BaseFromDocumentsUrl(APISUNAT_URL);
  const isBoleta = SERIE.startsWith("B");
  const tipoComprobanteSunat = isBoleta ? "03" : "01";
  const documentoApisunat = isBoleta ? "boleta" : "factura";
  const tipoComprobante: "boleta" | "factura" = isBoleta ? "boleta" : "factura";

  console.log(`RUC emisor: ${rucEmisor}`);
  console.log(`Tipo SUNAT: ${tipoComprobanteSunat} (${tipoComprobante})`);
  console.log(`apisunat v3: ${v3Base}/status`);
  console.log(`apisunat v1: ${v1Base}/sunat/comprobante (detalle)\n`);

  // 1. Leer todos los correlativos existentes en Firestore para esta serie
  console.log("Leyendo invoices de Firestore...");
  const db = getDb();
  const snap = await db.collection("invoices").where("serie", "==", SERIE).get();

  const existingCorrelativos = new Set<number>();
  for (const doc of snap.docs) {
    const corr = doc.data().correlativo;
    if (typeof corr === "number" && Number.isFinite(corr) && corr > 0) {
      existingCorrelativos.add(corr);
    }
  }

  if (existingCorrelativos.size === 0) {
    console.log(`No se encontraron invoices con serie=${SERIE} en Firestore.`);
    process.exit(0);
  }

  const allCorrs = Array.from(existingCorrelativos).sort((a, b) => a - b);

  // Detectar inicio del cluster principal: buscar el gap más grande entre
  // correlativos consecutivos y empezar después de él (salta datos de prueba).
  let autoMin = allCorrs[0]!;
  if (allCorrs.length >= 2) {
    let biggestGap = 0;
    let biggestGapIdx = 0;
    for (let i = 1; i < allCorrs.length; i++) {
      const gap = allCorrs[i]! - allCorrs[i - 1]!;
      if (gap > biggestGap) {
        biggestGap = gap;
        biggestGapIdx = i;
      }
    }
    if (biggestGap > 100) {
      autoMin = allCorrs[biggestGapIdx]!;
      console.log(`  Salto detectado: ${allCorrs[biggestGapIdx - 1]} → ${autoMin} (gap de ${biggestGap}). Empezando desde ${autoMin}.`);
    }
  }

  const minCorr = Number(process.env.RECOVER_MIN_CORRELATIVO) || autoMin;
  const maxCorr = Number(process.env.RECOVER_MAX_CORRELATIVO) || allCorrs[allCorrs.length - 1]!;

  console.log(`  Invoices en Firestore: ${existingCorrelativos.size}`);
  console.log(`  Rango efectivo: ${SERIE}-${minCorr} → ${SERIE}-${maxCorr}`);

  // 2. Detectar gaps
  const gaps: number[] = [];
  for (let c = minCorr; c <= maxCorr; c++) {
    if (!existingCorrelativos.has(c)) gaps.push(c);
  }

  if (gaps.length === 0) {
    console.log("\n  Sin gaps: todos los correlativos están en Firestore.");
    process.exit(0);
  }

  console.log(`  Gaps detectados: ${gaps.length}`);
  console.log(`  Primeros 20: ${gaps.slice(0, 20).map((g) => `${SERIE}-${g}`).join(", ")}${gaps.length > 20 ? " ..." : ""}\n`);

  // 3. Consultar apisunat por cada gap
  //    Paso A: POST /api/v3/status (registros internos apisunat — más fiable para docs emitidos por nosotros)
  //    Paso B: POST /api/v1/sunat/comprobante (detalle completo: cliente, monto, items — puede fallar para boletas)
  const toCreate: Array<{ correlativo: number; doc: Record<string, unknown> }> = [];
  const notInSunat: number[] = [];
  const errors: Array<{ correlativo: number; reason: string }> = [];

  for (let i = 0; i < gaps.length; i++) {
    const corr = gaps[i]!;
    const progress = `[${i + 1}/${gaps.length}]`;

    // Paso A: /api/v3/status
    const statusResp = await fetchStatus({
      v3Base,
      token: APISUNAT_TOKEN,
      documento: documentoApisunat,
      serie: SERIE,
      numero: corr,
    });

    if (!statusResp) {
      console.log(`  ${progress} ${SERIE}-${corr}: ERROR de red/parse`);
      errors.push({ correlativo: corr, reason: "Error de red o parse" });
      if (i < gaps.length - 1) await sleep(DELAY_MS);
      continue;
    }

    if (!statusResp.success || !statusResp.payload) {
      console.log(`  ${progress} ${SERIE}-${corr}: No existe en apisunat (${statusResp.message || "sin mensaje"})`);
      notInSunat.push(corr);
      if (i < gaps.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const estado = String(statusResp.payload.estado || "?");

    // Paso B: intentar /api/v1/sunat/comprobante para datos del cliente
    await sleep(100);
    const compResp = await fetchComprobante({
      v1Base,
      token: APISUNAT_TOKEN,
      rucEmisor,
      tipoComprobante: tipoComprobanteSunat,
      serie: SERIE,
      numero: corr,
    });
    const compPayload = compResp?.success ? compResp.payload : null;

    // Paso C: si no hay detalle del comprobante, extraer datos del PDF ticket
    let pdfData: PdfData | null = null;
    if (!compPayload) {
      const pdfUrl = statusResp.payload.pdf?.ticket;
      if (pdfUrl) {
        await sleep(100);
        pdfData = await extractDataFromPdf(pdfUrl, APISUNAT_TOKEN);
      }
    }

    const monto = compPayload?.totales?.monto_total_general || (pdfData ? String(pdfData.importeTotal) : "?");
    const cliente = compPayload?.cliente?.nombre_cliente || pdfData?.clienteNombre || "(sin datos)";
    const fecha = compPayload?.detalle?.fecha_emision || pdfData?.fechaEmision || "?";
    const source = compPayload ? "api" : pdfData ? "pdf" : "solo-status";

    console.log(`  ${progress} ${SERIE}-${corr}: ENCONTRADA | ${estado} | S/${monto} | ${cliente} | ${fecha} [${source}]`);

    if (!compPayload && !pdfData) {
      console.warn(`    ⚠ Sin datos de monto/cliente. Se omite.`);
      errors.push({ correlativo: corr, reason: "Sin datos de monto (ni API ni PDF)" });
      if (i < gaps.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const firestoreDoc = buildFirestoreDoc({
      serie: SERIE,
      correlativo: corr,
      statusPayload: statusResp.payload,
      comprobantePayload: compPayload,
      pdfData,
      tipoComprobante,
    });
    toCreate.push({ correlativo: corr, doc: firestoreDoc });

    if (i < gaps.length - 1) await sleep(DELAY_MS);
  }

  // 4. Resumen
  console.log("\n--- Resumen ---");
  console.log(`  Gaps totales:           ${gaps.length}`);
  console.log(`  Encontradas en SUNAT:   ${toCreate.length}`);
  console.log(`  No existen en SUNAT:    ${notInSunat.length}`);
  console.log(`  Errores de consulta:    ${errors.length}`);

  if (notInSunat.length > 0) {
    console.log(`\n  Correlativos no existentes en SUNAT (skip genuino):`);
    console.log(`    ${notInSunat.map((c) => `${SERIE}-${c}`).join(", ")}`);
  }

  if (errors.length > 0) {
    console.log(`\n  Correlativos con error (reintentar luego):`);
    for (const e of errors) {
      console.log(`    ${SERIE}-${e.correlativo}: ${e.reason}`);
    }
  }

  if (toCreate.length === 0) {
    console.log("\nNada que crear en Firestore.");
    process.exit(0);
  }

  // 5. Escribir en Firestore (o simular)
  if (!APPLY) {
    console.log(`\nSimulación: se crearían ${toCreate.length} documentos. Primeros 5:`);
    for (const item of toCreate.slice(0, 5)) {
      console.log(`\n  ${SERIE}-${item.correlativo}:`);
      console.log(`    cliente: ${item.doc.cliente_denominacion}`);
      console.log(`    monto:   ${item.doc.amount}`);
      console.log(`    fecha:   ${item.doc.fecha_emision_ymd}`);
      console.log(`    estado:  ${item.doc.sunat_estado}`);
    }
    console.log(
      `\nPara aplicar: RECOVER_MISSING_APPLY=1 npx tsx scripts/recover-missing-invoices.ts\n`
    );
    process.exit(0);
  }

  console.log(`\nEscribiendo ${toCreate.length} documentos en Firestore...`);

  const BATCH_SIZE = 400;
  let written = 0;

  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const chunk = toCreate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      const existing = await db
        .collection("invoices")
        .where("serie_correlativo", "==", `${SERIE}-${item.correlativo}`)
        .limit(1)
        .get();

      if (!existing.empty) {
        console.log(`  ${SERIE}-${item.correlativo}: ya existe en Firestore, saltando.`);
        continue;
      }

      const ref = db.collection("invoices").doc();
      batch.set(ref, item.doc);
      written++;
    }

    await batch.commit();
    console.log(`  Commit batch ${Math.floor(i / BATCH_SIZE) + 1}: ${written} escritos hasta ahora.`);
  }

  console.log(`\n✅ ${written} invoices recuperados en Firestore.`);
  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} correlativos con error — reintentar el script.`);
  }
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
