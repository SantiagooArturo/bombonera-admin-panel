/** Datos del emisor en el PDF formal (no firmado). Configurar en .env */
export type EmisorSunatConfig = {
  razonSocial: string;
  nombreComercial?: string;
  ruc: string;
  direccion: string;
  ubigeoLine?: string;
};

export function getEmisorSunatFromEnv(): EmisorSunatConfig {
  const razonSocial = process.env.SUNAT_EMISOR_RAZON_SOCIAL?.trim() || "EMPRESA EMISORA";
  const ruc = process.env.SUNAT_EMISOR_RUC?.trim() || "00000000000";
  const direccion = process.env.SUNAT_EMISOR_DIRECCION?.trim() || "DIRECCIÓN FISCAL — LIMA";
  const ubigeoLine = process.env.SUNAT_EMISOR_UBIGEO_LINE?.trim();
  const nombreComercial = process.env.SUNAT_EMISOR_NOMBRE_COMERCIAL?.trim();
  return { razonSocial, ruc, direccion, ubigeoLine, nombreComercial };
}
