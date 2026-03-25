export type FormalComprobantePdfInput = {
  /** Metadato del PDF (evita título genérico tipo “Template” en visores). */
  pdfDocumentTitle?: string;
  tipo: "boleta" | "factura";
  emisor: {
    razonSocial: string;
    nombreComercial?: string;
    ruc: string;
    direccion: string;
    ubigeoLine?: string;
  };
  serieCorrelativo: string;
  fechaEmisionYmd: string;
  /** Texto ya formateado para el PDF (12 h, es-PE). */
  fechaEmisionMostrada: string;
  condicionVenta: string;
  /** Depósito: banco de la empresa emisora (donde abona el cliente). */
  formaPagoBanco?: string;
  /** Depósito: cuenta o CCI de la empresa emisora. */
  formaPagoCuenta?: string;
  /** PNG data URL para QR CPE (mismo contenido que valida SUNAT). */
  qrImageDataUrl?: string | null;
  receptorNombre: string;
  receptorDocLabel?: string;
  /** Factura: dirección fiscal del receptor (líneas SUNAT en PDF). */
  direccionReceptor?: string;
  /** Factura: dirección del cliente (puede coincidir con la del receptor). */
  direccionCliente?: string;
  moneda: string;
  observacion?: string;
  /** Una línea de detalle (mismo modelo que apisunat: cantidad 1). */
  descripcion: string;
  cantidad: number;
  valorUnitarioSinIgv: number;
  descuento: number;
  importeLineaConIgv: number;
  opGravada: number;
  opExonerada: number;
  opInafecta: number;
  isc: number;
  igv: number;
  otrosCargos: number;
  otrosTributos: number;
  montoRedondeo: number;
  importeTotal: number;
};
