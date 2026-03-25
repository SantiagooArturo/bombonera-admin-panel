import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { FormalComprobantePdfInput } from "./formalComprobanteTypes";
import { FormalComprobantePdfDocument } from "./FormalComprobantePdfDocument";
import { FormalFacturaElectronicaPdfDocument } from "./FormalFacturaElectronicaPdfDocument";

export async function renderFormalComprobanteBuffer(data: FormalComprobantePdfInput): Promise<Buffer> {
  const Doc = data.tipo === "factura" ? FormalFacturaElectronicaPdfDocument : FormalComprobantePdfDocument;
  return renderToBuffer(<Doc data={data} />);
}
