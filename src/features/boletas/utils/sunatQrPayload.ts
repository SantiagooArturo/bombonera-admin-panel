function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cadena para QR de validación CPE (SUNAT Perú), campos separados por |.
 * Formato habitual: RUC|tipo|serie|número|total IGV|importe total|fecha|tipo doc cliente|nº doc|hash base64
 */
export function buildSunatCpeQrPayload(p: {
  rucEmisor: string;
  tipoComprobante: "boleta" | "factura";
  serie: string;
  numeroCorrelativo: number;
  totalIgv: number;
  importeTotal: number;
  /** Fecha emisión dd/mm/aaaa */
  fechaEmisionDdMmYyyy: string;
  tipoDocClienteSunat: string;
  numeroDocCliente: string;
  digestValueBase64: string;
}): string {
  const tipoCpe = p.tipoComprobante === "factura" ? "01" : "03";
  const igv = round2(p.totalIgv).toFixed(2);
  const total = round2(p.importeTotal).toFixed(2);
  const numDoc = String(p.numeroDocCliente || "").replace(/\D/g, "") || "0";
  const hash = String(p.digestValueBase64 || "").trim();
  return [
    p.rucEmisor,
    tipoCpe,
    p.serie,
    String(p.numeroCorrelativo),
    igv,
    total,
    p.fechaEmisionDdMmYyyy,
    p.tipoDocClienteSunat,
    numDoc,
    hash,
  ].join("|");
}
