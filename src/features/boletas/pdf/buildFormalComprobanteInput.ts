import type { EmisorSunatConfig } from "./emisorSunatEnv";
import type { FormalComprobantePdfInput } from "./formalComprobanteTypes";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildFormalComprobanteInput(params: {
  tipo: "boleta" | "factura";
  emisor: EmisorSunatConfig;
  serieCorrelativo: string;
  fechaEmisionYmd: string;
  fechaEmisionMostrada: string;
  condicionVenta: string;
  qrImageDataUrl?: string | null;
  receptorNombre: string;
  clienteTipoDocumento?: string;
  clienteNumeroDocumento?: string;
  descripcion: string;
  totalConIgv: number;
  observacion?: string;
  /** Factura: enviada a SUNAT y al PDF formal. */
  clienteDireccion?: string;
}): FormalComprobantePdfInput {
  const t = round2(params.totalConIgv);
  const opGravada = round2(t / 1.18);
  const igv = round2(t - opGravada);

  const num = (params.clienteNumeroDocumento || "").replace(/\D/g, "");
  const tipo = params.clienteTipoDocumento || "";
  let receptorDocLabel: string | undefined;
  if (num && num !== "0") {
    if (tipo === "6") receptorDocLabel = `RUC ${num}`;
    else if (tipo === "1") receptorDocLabel = `DNI ${num}`;
    else receptorDocLabel = num;
  }

  const dirFactura = (params.clienteDireccion || "").trim();
  const direccionSunatPdf =
    params.tipo === "factura" && dirFactura ? dirFactura : undefined;

  return {
    tipo: params.tipo,
    emisor: {
      razonSocial: params.emisor.razonSocial,
      nombreComercial: params.emisor.nombreComercial,
      ruc: params.emisor.ruc,
      direccion: params.emisor.direccion,
      ubigeoLine: params.emisor.ubigeoLine,
    },
    serieCorrelativo: params.serieCorrelativo,
    fechaEmisionYmd: params.fechaEmisionYmd,
    fechaEmisionMostrada: params.fechaEmisionMostrada,
    condicionVenta: params.condicionVenta,
    qrImageDataUrl: params.qrImageDataUrl ?? null,
    receptorNombre: params.receptorNombre,
    receptorDocLabel,
    direccionReceptor: direccionSunatPdf,
    direccionCliente: direccionSunatPdf,
    moneda: "SOLES",
    observacion: params.observacion,
    descripcion: params.descripcion,
    cantidad: 1,
    valorUnitarioSinIgv: opGravada,
    descuento: 0,
    importeLineaConIgv: t,
    opGravada,
    opExonerada: 0,
    opInafecta: 0,
    isc: 0,
    igv,
    otrosCargos: 0,
    otrosTributos: 0,
    montoRedondeo: 0,
    importeTotal: t,
  };
}
