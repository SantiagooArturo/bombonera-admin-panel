import JSZip from "jszip";
import type { Invoice } from "@/lib/types";
import { getInvoiceUiStatus } from "./invoiceUiStatus";
import { sanitizeReceptorNombre } from "./sanitizeReceptorNombre";

export const RUC_EMPRESA = "20511046255";
export const RAZON_SOCIAL_EMPRESA = "ALIFAD E.I.R.L.";

export function parseInvoiceDateYmd(inv: Invoice): string {
  const ymd = String(inv.fecha_emision_ymd || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const created = String(inv.created_at || "").trim();
  if (!created) return "";
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatYmdToDmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function getSerieAndCorrelativo(inv: Invoice): { serie: string; correlativo: number; tipoCp: string } {
  const sc = String(inv.serie_correlativo || "").trim();
  let serie = String(inv.serie || "").trim();
  let correlativo = Number(inv.correlativo);

  if (sc.includes("-")) {
    const [s, c] = sc.split("-");
    serie = (s || serie).trim();
    const num = Number.parseInt(String(c || "").replace(/\D/g, ""), 10);
    if (Number.isFinite(num)) correlativo = num;
  }

  const isFactura = inv.tipo_comprobante === "factura" || serie.toUpperCase().startsWith("F");
  const tipoCp = isFactura ? "01" : "03";
  if (!serie) {
    serie = isFactura ? "F001" : "B001";
  }

  return {
    serie: serie.toUpperCase(),
    correlativo: Number.isFinite(correlativo) && correlativo > 0 ? correlativo : 0,
    tipoCp,
  };
}

export interface RvieZipResult {
  blob: Blob;
  fileName: string;
  totalCount: number;
  activeCount: number;
  voidedCount: number;
  sumTotal: number;
}

export async function exportRvieZipFromInvoices(invoices: Invoice[], ym: string): Promise<RvieZipResult> {
  const periodoClean = ym.replace(/\D/g, "").slice(0, 6);
  if (periodoClean.length !== 6) {
    throw new Error("El periodo debe tener formato AAAA-MM (ej. 2026-08)");
  }

  // Filtrar comprobantes del mes seleccionado
  const monthInvoices = invoices.filter((inv) => {
    const ymd = parseInvoiceDateYmd(inv);
    return ymd.startsWith(ym);
  });

  // Ordenar por serie y correlativo ascendente
  monthInvoices.sort((a, b) => {
    const infoA = getSerieAndCorrelativo(a);
    const infoB = getSerieAndCorrelativo(b);
    if (infoA.serie !== infoB.serie) return infoA.serie.localeCompare(infoB.serie);
    return infoA.correlativo - infoB.correlativo;
  });

  let activeCount = 0;
  let voidedCount = 0;
  let sumTotal = 0;

  const txtLines: string[] = [];

  for (const inv of monthInvoices) {
    const ymd = parseInvoiceDateYmd(inv);
    const fechaDmy = formatYmdToDmy(ymd);
    const { serie, correlativo, tipoCp } = getSerieAndCorrelativo(inv);

    const isVoided = inv.status === "voided" || getInvoiceUiStatus(inv) === "anulado";
    if (isVoided) {
      voidedCount++;
    } else {
      activeCount++;
      sumTotal += Number(inv.amount || 0);
    }

    // CAR SUNAT: RUC (11) + TipoCP (2) + Serie (4) + Correlativo (10 dígitos)
    const carSunat = `${RUC_EMPRESA}${tipoCp}${serie.padEnd(4, " ").slice(0, 4)}${String(correlativo).padStart(10, "0")}`;

    // Tipo doc identidad y número receptor
    let tipoDoc = tipoCp === "01" ? "6" : "1";
    let nroDoc = String(inv.cliente_numero_de_documento || "").trim();

    if (inv.cliente_tipo_documento) {
      tipoDoc = String(inv.cliente_tipo_documento).trim();
    } else if (nroDoc) {
      const digits = nroDoc.replace(/\D/g, "");
      if (digits.length === 11) tipoDoc = "6";
      else if (digits.length === 8) tipoDoc = "1";
      else tipoDoc = "0";
    }

    if (!nroDoc || /^(\d)\1+$/.test(nroDoc.replace(/\D/g, ""))) {
      if (tipoCp === "03") {
        tipoDoc = "1";
        nroDoc = "00000000";
      }
    }

    // Nombre receptor
    let clienteName = "";
    if (inv.cliente_denominacion) {
      clienteName = sanitizeReceptorNombre(inv.cliente_denominacion);
    }
    if (!clienteName && inv.representative_name_snapshot) {
      clienteName = sanitizeReceptorNombre(inv.representative_name_snapshot);
    }
    if (!clienteName) {
      clienteName = isVoided ? "(ANULADA)" : "CLIENTES VARIOS";
    } else if (isVoided) {
      clienteName = `${clienteName} (ANULADA)`;
    }

    // Importes
    const totalNum = Number(inv.amount || 0);
    const biNum = Math.round((totalNum / 1.18) * 100) / 100;
    const igvNum = Math.round((totalNum - biNum) * 100) / 100;

    const biStr = isVoided ? "0.00" : biNum.toFixed(2);
    const igvStr = isVoided ? "0.00" : igvNum.toFixed(2);
    const totalStr = isVoided ? "0.00" : totalNum.toFixed(2);
    const estadoComp = isVoided ? "2" : "1";

    // 40 columnas Anexo 3 RVIE
    const cols: string[] = [
      RUC_EMPRESA,                   // 1: Ruc
      RAZON_SOCIAL_EMPRESA,          // 2: Razon Social
      periodoClean,                  // 3: Periodo
      carSunat,                      // 4: CAR SUNAT
      fechaDmy,                      // 5: Fecha de emisión
      "",                            // 6: Fecha Vcto/Pago
      tipoCp,                        // 7: Tipo CP/Doc.
      serie,                         // 8: Serie del CDP
      String(correlativo || ""),     // 9: Nro CP inicial
      "",                            // 10: Nro Final
      tipoDoc,                       // 11: Tipo Doc Identidad
      nroDoc,                        // 12: Nro Doc Identidad
      clienteName,                   // 13: Apellidos Nombres/ Razon Social
      "0.00",                        // 14: Valor Facturado Exportación
      biStr,                         // 15: BI Gravada
      "0.00",                        // 16: Dscto BI
      igvStr,                        // 17: IGV / IPM
      "0.00",                        // 18: Dscto IGV / IPM
      "0.00",                        // 19: Mto Exonerado
      "0.00",                        // 20: Mto Inafecto
      "0.00",                        // 21: ISC
      "0.00",                        // 22: BI Grav IVAP
      "0.00",                        // 23: IVAP
      "0.00",                        // 24: ICBPER
      "0.00",                        // 25: Otros Tributos
      totalStr,                      // 26: Total CP
      "PEN",                         // 27: Moneda
      "1.000",                       // 28: Tipo Cambio
      "",                            // 29: Fecha Emisión Doc Modificado
      "",                            // 30: Tipo CP Modificado
      "",                            // 31: Serie CP Modificado
      "",                            // 32: Nro CP Modificado
      "",                            // 33: ID Proyecto Operadores Atribución
      "",                            // 34: Tipo de Nota
      estadoComp,                    // 35: Est. Comp (1=Activo, 2=Anulado)
      "0.00",                        // 36: Valor FOB Embarcado
      "0.00",                        // 37: Valor OP Gratuitas
      "0101",                        // 38: Tipo Operación
      "",                            // 39: DAM / CP
      "",                            // 40: CLU
    ];

    txtLines.push(cols.join("|") + "|");
  }

  const txtName = `LE${RUC_EMPRESA}${periodoClean}00140400021112.txt`;
  const zipName = `LE${RUC_EMPRESA}${periodoClean}00140400021112.zip`;

  const zip = new JSZip();
  zip.file(txtName, txtLines.join("\r\n") + (txtLines.length > 0 ? "\r\n" : ""));
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

  return {
    blob: zipBlob,
    fileName: zipName,
    totalCount: monthInvoices.length,
    activeCount,
    voidedCount,
    sumTotal: Math.round(sumTotal * 100) / 100,
  };
}
