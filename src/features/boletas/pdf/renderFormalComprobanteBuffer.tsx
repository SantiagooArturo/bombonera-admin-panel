import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { FormalComprobantePdfInput } from "./formalComprobanteTypes";
import { FormalComprobantePdfDocument } from "./FormalComprobantePdfDocument";

export async function renderFormalComprobanteBuffer(data: FormalComprobantePdfInput): Promise<Buffer> {
  return renderToBuffer(<FormalComprobantePdfDocument data={data} />);
}
