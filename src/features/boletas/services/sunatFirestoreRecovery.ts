/**
 * Lógica compartida: boletas/facturas en apisunat/SUNAT ausentes en Firestore (huecos + sonda de cola).
 * Usa el script `scripts/recover-missing-invoices.ts` y la API dev de recuperación.
 */
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";
import { receptorNombreSnapshot } from "@/features/boletas/utils/sanitizeReceptorNombre";

export function allowSunatMissingRecoveryFromApi(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ALLOW_DEV_SUNAT_INVOICE_RECOVERY === "1"
  );
}

// ── PDF ─────────────────────────────────────────────────────────────────────

export type PdfData = {
  importeTotal: number;
  fechaEmision: string;
  clienteNombre: string;
  clienteDoc: string;
  descripcion: string;
};

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

async function extractDataFromPdf(pdfUrl: string, token: string): Promise<PdfData | null> {
  try {
    const res = await fetch(pdfUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
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

    const importeMatch =
      fullText.match(/Total\s+\(S\/\)\s*:\s*([\d,]+(?:\.\d+)?)/i) ??
      fullText.match(/Importe\s+Total\s+S\/\s*([\d,]+(?:\.\d+)?)/i);
    const importe = importeMatch ? parseFloat(importeMatch[1]!.replace(/,/g, "")) : 0;

    const fechaMatch =
      fullText.match(/Fecha\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i) ??
      fullText.match(/Fecha\s+de\s+emisi[oó]n\s*[:\s]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    let fechaYmd = "";
    if (fechaMatch) {
      const [dd, mm, yyyy] = fechaMatch[1]!.split("/");
      if (dd && mm && yyyy) fechaYmd = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }

    const clienteMatch =
      fullText.match(/Cliente\s*:\s*(.+)/i) ?? fullText.match(/Nombres?\s*:\s*(.+)/i);
    const clienteNombre = clienteMatch ? clienteMatch[1]!.replace(/\s+/g, " ").trim() : "";

    const dniMatch = fullText.match(/(?:DNI|RUC)\s*:?\s*(\d+)/i);
    const clienteDoc = dniMatch ? dniMatch[1]! : "";

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
  } catch {
    return null;
  }
}

// ── apisunat ─────────────────────────────────────────────────────────────────

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
      return null;
    }
  } catch {
    return null;
  }
}

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

function buildFirestoreDoc(params: {
  serie: string;
  correlativo: number;
  statusPayload: NonNullable<StatusResponse["payload"]>;
  comprobantePayload?: ComprobanteResponse["payload"] | null;
  pdfData?: PdfData | null;
  tipoComprobante: "boleta" | "factura";
  recoverySource: string;
}): Record<string, unknown> {
  const {
    serie,
    correlativo,
    statusPayload,
    comprobantePayload,
    pdfData,
    tipoComprobante,
    recoverySource,
  } = params;

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
  const descripcion =
    items.map((i) => String(i.descripcion || "")).filter(Boolean).join(" | ") ||
    pdfData?.descripcion ||
    "";
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
    recovery_source: recoverySource,
    recovery_note: `Recuperado automáticamente desde SUNAT el ${new Date().toISOString().slice(0, 10)}. Estado: ${estadoRaw || "sin dato"}.`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveIntOrU(v: number | undefined): number | undefined {
  if (v == null || !Number.isFinite(v) || v < 1) return undefined;
  return Math.floor(v);
}

export type SunatRecoveryScanOptions = {
  serie: string;
  apisunatUrl: string;
  apisunatToken: string;
  rucEmisor: string;
  delayMs?: number;
  /** Si no se define, se usa el mínimo del cluster en Firestore (misma heurística que el script). */
  minCorrelativo?: number;
  /** Si no se define, se usa el máximo correlativo presente en Firestore. */
  maxCorrelativo?: number;
  /** default true */
  tailProbe?: boolean;
  tailConsecutiveMiss?: number;
  tailMaxSteps?: number;
  recoverySourceForDocs?: string;
};

export type SunatRecoveryPreviewRow = {
  correlativo: number;
  serie_correlativo: string;
  cliente_denominacion: string;
  amount: number;
  fecha_emision_ymd: string;
  sunat_estado: string;
  dataSource: "api" | "pdf";
};

export type SunatRecoveryScanResult = {
  serie: string;
  toCreate: Array<{ correlativo: number; doc: Record<string, unknown> }>;
  previewRows: SunatRecoveryPreviewRow[];
  notInSunat: number[];
  errors: Array<{ correlativo: number; reason: string }>;
  /** Correlativos únicos revisados (huecos + cola). */
  gapsScanned: number;
  skippedNoFirestoreCluster: boolean;
};

/**
 * Detecta correlativos ausentes en Firestore con documento en apisunat y arma los docs a crear.
 */
export async function scanMissingSunatInvoicesForFirestore(
  db: AdminFirestore,
  opts: SunatRecoveryScanOptions
): Promise<SunatRecoveryScanResult> {
  const SERIE = opts.serie.trim();
  const APISUNAT_URL = opts.apisunatUrl.trim();
  const APISUNAT_TOKEN = opts.apisunatToken.trim();
  const DELAY_MS = opts.delayMs ?? 200;
  const tailProbeEnabled = opts.tailProbe !== false;
  const TAIL_MISS = Math.max(1, opts.tailConsecutiveMiss ?? 20);
  const TAIL_CAP = Math.max(1, opts.tailMaxSteps ?? 500);
  const recoverySource = opts.recoverySourceForDocs ?? "sunatFirestoreRecovery";

  const snap = await db.collection("invoices").where("serie", "==", SERIE).get();
  const existingCorrelativos = new Set<number>();
  for (const doc of snap.docs) {
    const corr = doc.data().correlativo;
    if (typeof corr === "number" && Number.isFinite(corr) && corr > 0) {
      existingCorrelativos.add(corr);
    }
  }

  if (existingCorrelativos.size === 0) {
    return {
      serie: SERIE,
      toCreate: [],
      previewRows: [],
      notInSunat: [],
      errors: [],
      gapsScanned: 0,
      skippedNoFirestoreCluster: true,
    };
  }

  const allCorrs = Array.from(existingCorrelativos).sort((a, b) => a - b);

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
    }
  }

  const minCorr = positiveIntOrU(opts.minCorrelativo) ?? autoMin;
  const maxCorr = positiveIntOrU(opts.maxCorrelativo) ?? allCorrs[allCorrs.length - 1]!;

  let gaps: number[] = [];
  for (let c = minCorr; c <= maxCorr; c++) {
    if (!existingCorrelativos.has(c)) gaps.push(c);
  }

  const v3Base = APISUNAT_URL.replace(/\/+$/, "").replace(/\/documents$/i, "");
  const v1Base = v1BaseFromDocumentsUrl(APISUNAT_URL);
  const isBoleta = SERIE.startsWith("B");
  const tipoComprobanteSunat = isBoleta ? "03" : "01";
  const documentoApisunat = isBoleta ? "boleta" : "factura";
  const tipoComprobante: "boleta" | "factura" = isBoleta ? "boleta" : "factura";

  if (tailProbeEnabled) {
    let consecutiveMiss = 0;
    let c = maxCorr + 1;
    let steps = 0;
    while (steps < TAIL_CAP && consecutiveMiss < TAIL_MISS) {
      if (existingCorrelativos.has(c)) {
        consecutiveMiss = 0;
        c++;
        continue;
      }
      const statusResp = await fetchStatus({
        v3Base,
        token: APISUNAT_TOKEN,
        documento: documentoApisunat,
        serie: SERIE,
        numero: c,
      });
      steps++;
      if (statusResp?.success && statusResp.payload) {
        gaps.push(c);
        consecutiveMiss = 0;
      } else {
        consecutiveMiss++;
      }
      c++;
      if (steps < TAIL_CAP && consecutiveMiss < TAIL_MISS) await sleep(DELAY_MS);
    }
  }

  gaps = Array.from(new Set(gaps)).sort((a, b) => a - b);
  const gapsScanned = gaps.length;

  const toCreate: Array<{ correlativo: number; doc: Record<string, unknown> }> = [];
  const previewRows: SunatRecoveryPreviewRow[] = [];
  const notInSunat: number[] = [];
  const errors: Array<{ correlativo: number; reason: string }> = [];

  for (let i = 0; i < gaps.length; i++) {
    const corr = gaps[i]!;

    const statusResp = await fetchStatus({
      v3Base,
      token: APISUNAT_TOKEN,
      documento: documentoApisunat,
      serie: SERIE,
      numero: corr,
    });

    if (!statusResp) {
      errors.push({ correlativo: corr, reason: "Error de red o parse (/status)" });
      if (i < gaps.length - 1) await sleep(DELAY_MS);
      continue;
    }

    if (!statusResp.success || !statusResp.payload) {
      notInSunat.push(corr);
      if (i < gaps.length - 1) await sleep(DELAY_MS);
      continue;
    }

    await sleep(100);
    const compResp = await fetchComprobante({
      v1Base,
      token: APISUNAT_TOKEN,
      rucEmisor: opts.rucEmisor.replace(/\D/g, ""),
      tipoComprobante: tipoComprobanteSunat,
      serie: SERIE,
      numero: corr,
    });
    const compPayload = compResp?.success ? compResp.payload : null;

    let pdfData: PdfData | null = null;
    if (!compPayload) {
      const pdfUrl = statusResp.payload.pdf?.ticket;
      if (pdfUrl) {
        await sleep(100);
        pdfData = await extractDataFromPdf(pdfUrl, APISUNAT_TOKEN);
      }
    }

    if (!compPayload && !pdfData) {
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
      recoverySource,
    });
    toCreate.push({ correlativo: corr, doc: firestoreDoc });
    const dataSource: "api" | "pdf" = compPayload ? "api" : "pdf";
    previewRows.push({
      correlativo: corr,
      serie_correlativo: `${SERIE}-${corr}`,
      cliente_denominacion: String(firestoreDoc.cliente_denominacion ?? ""),
      amount: Number(firestoreDoc.amount) || 0,
      fecha_emision_ymd: String(firestoreDoc.fecha_emision_ymd ?? ""),
      sunat_estado: String(firestoreDoc.sunat_estado ?? ""),
      dataSource,
    });

    if (i < gaps.length - 1) await sleep(DELAY_MS);
  }

  return {
    serie: SERIE,
    toCreate,
    previewRows,
    notInSunat,
    errors,
    gapsScanned,
    skippedNoFirestoreCluster: false,
  };
}

export async function commitRecoveredInvoiceDocs(
  db: AdminFirestore,
  serie: string,
  items: Array<{ correlativo: number; doc: Record<string, unknown> }>
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  const BATCH_SIZE = 400;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    let opsInBatch = 0;

    for (const item of chunk) {
      const existing = await db
        .collection("invoices")
        .where("serie_correlativo", "==", `${serie}-${item.correlativo}`)
        .limit(1)
        .get();

      if (!existing.empty) {
        skipped++;
        continue;
      }

      const ref = db.collection("invoices").doc();
      batch.set(ref, item.doc);
      opsInBatch++;
      written++;
    }

    if (opsInBatch > 0) {
      await batch.commit();
    }
  }

  return { written, skipped };
}
