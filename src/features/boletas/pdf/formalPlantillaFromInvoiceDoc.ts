import { normalizeCondicionVentaInput } from "@/features/boletas/constants/condicionVenta";
import { buildComprobantePdfFilenameFromFirestoreDoc } from "@/features/boletas/utils/comprobantePdfFilename";
import { fechaYmdToDdMmYyyy, formatEmision12hPe } from "@/features/boletas/utils/fechaEmisionMostrada12h";
import { buildSunatCpeQrPayload } from "@/features/boletas/utils/sunatQrPayload";
import { buildFormalComprobanteInput } from "./buildFormalComprobanteInput";
import { parseSerieCorrelativoFromDoc } from "./formalPlantillaEligibility";
import { getEmisorSunatFromEnv } from "./emisorSunatEnv";
import { generateSunatQrDataUrl } from "./generateSunatQrDataUrl";
import { renderFormalComprobanteBuffer } from "./renderFormalComprobanteBuffer";

function emissionYmdHmsFromDoc(doc: Record<string, unknown>): { ymd: string; hms: string } {
  const ymd = typeof doc.fecha_emision_ymd === "string" ? doc.fecha_emision_ymd.trim() : "";
  const hmsRaw = typeof doc.hora_emision_hms === "string" ? doc.hora_emision_hms.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    if (/^\d{2}:\d{2}:\d{2}$/.test(hmsRaw)) {
      return { ymd, hms: hmsRaw };
    }
    if (/^\d{2}:\d{2}$/.test(hmsRaw)) {
      return { ymd, hms: `${hmsRaw}:00` };
    }
  }

  const created = typeof doc.created_at === "string" ? doc.created_at : "";
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    const fallbackYmd = now.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    return { ymd: fallbackYmd, hms: "12:00:00" };
  }
  const ymdLima = d.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = p.find((x) => x.type === "hour")?.value ?? "12";
  const mm = p.find((x) => x.type === "minute")?.value ?? "00";
  const ss = p.find((x) => x.type === "second")?.value ?? "00";
  return {
    ymd: ymdLima,
    hms: `${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:${ss.padStart(2, "0")}`,
  };
}

export async function renderFormalPlantillaPdfFromInvoiceDoc(
  doc: Record<string, unknown>,
  invoiceId: string
): Promise<Buffer | null> {
  const parsed = parseSerieCorrelativoFromDoc(doc);
  if (!parsed) return null;
  const status = String(doc.status || "");
  if (status === "attached") return null;
  const amount = typeof doc.amount === "number" ? doc.amount : Number(doc.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const tipoRaw = doc.tipo_comprobante === "factura" ? "factura" : "boleta";
  const descripcion =
    typeof doc.descripcion === "string" && doc.descripcion.trim()
      ? doc.descripcion.trim()
      : "Servicio";
  const clienteName =
    typeof doc.cliente_denominacion === "string" && doc.cliente_denominacion.trim().length >= 1
      ? doc.cliente_denominacion.trim().toUpperCase()
      : "CLIENTE GENERAL";
  const tipoDoc = String(doc.cliente_tipo_documento ?? "0").replace(/\D/g, "") || "0";
  const persistNum = String(doc.cliente_numero_de_documento || "").replace(/\D/g, "");
  const cleanDocForQr = tipoDoc === "0" ? "0" : persistNum || "0";

  const { ymd, hms } = emissionYmdHmsFromDoc(doc);
  const condicionVenta = normalizeCondicionVentaInput(doc.condicion_venta);
  const clienteDirRaw = typeof doc.cliente_direccion === "string" ? doc.cliente_direccion.trim() : "";

  const emisorCfg = getEmisorSunatFromEnv();
  const hashStr = String(doc.sunat_hash || "").trim();
  const opGravadaQr = Math.round((amount / 1.18) * 100) / 100;
  const igvQr = Math.round((amount - opGravadaQr) * 100) / 100;
  let qrDataUrl: string | null = null;
  if (hashStr) {
    try {
      const qrPayload = buildSunatCpeQrPayload({
        rucEmisor: emisorCfg.ruc,
        tipoComprobante: tipoRaw,
        serie: parsed.serie,
        numeroCorrelativo: parsed.correlativo,
        totalIgv: igvQr,
        importeTotal: amount,
        fechaEmisionDdMmYyyy: fechaYmdToDdMmYyyy(ymd),
        tipoDocClienteSunat: tipoDoc,
        numeroDocCliente: cleanDocForQr,
        digestValueBase64: hashStr,
      });
      qrDataUrl = await generateSunatQrDataUrl(qrPayload);
    } catch {
      qrDataUrl = null;
    }
  }

  const serieCorrelativo =
    typeof doc.serie_correlativo === "string" && doc.serie_correlativo.trim()
      ? doc.serie_correlativo.trim()
      : `${parsed.serie}-${String(parsed.correlativo).padStart(5, "0")}`;

  const fechaEmisionMostrada = formatEmision12hPe(ymd, hms);

  const formalInput = buildFormalComprobanteInput({
    tipo: tipoRaw,
    emisor: emisorCfg,
    serieCorrelativo,
    fechaEmisionYmd: ymd,
    fechaEmisionMostrada,
    condicionVenta,
    qrImageDataUrl: qrDataUrl,
    receptorNombre: clienteName,
    clienteTipoDocumento: tipoDoc,
    clienteNumeroDocumento: tipoRaw === "boleta" && tipoDoc === "0" ? undefined : persistNum || undefined,
    descripcion,
    totalConIgv: amount,
    clienteDireccion: tipoRaw === "factura" && clienteDirRaw ? clienteDirRaw : undefined,
  });

  const suggestedFile = buildComprobantePdfFilenameFromFirestoreDoc(invoiceId.trim(), doc);
  const pdfDocumentTitle = suggestedFile.replace(/\.pdf$/i, "");

  return renderFormalComprobanteBuffer({ ...formalInput, pdfDocumentTitle });
}
