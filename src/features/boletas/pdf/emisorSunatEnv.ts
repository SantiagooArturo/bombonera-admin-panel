/** Datos del emisor en el PDF formal (no firmado). Configurar en .env */
export type EmisorSunatConfig = {
  razonSocial: string;
  nombreComercial?: string;
  ruc: string;
  direccion: string;
  ubigeoLine?: string;
};

/** Valores por defecto Bombonera / ALIFAD (sobrescribibles con SUNAT_EMISOR_* en .env). */
const EMISOR_DEFAULT: EmisorSunatConfig = {
  razonSocial: "ALIFAD E.I.R.L.",
  ruc: "20511046255",
  direccion: [
    "AV. ANGAMOS ESTE 1551 URB. CASA HUERTA CENTRO COMERCIAL",
    "PLAZA HOGAR 3ER NIVEL",
    "SURQUILLO - LIMA - LIMA",
  ].join("\n"),
};

export function getEmisorSunatFromEnv(): EmisorSunatConfig {
  const razonSocial = process.env.SUNAT_EMISOR_RAZON_SOCIAL?.trim() || EMISOR_DEFAULT.razonSocial;
  const ruc = process.env.SUNAT_EMISOR_RUC?.trim() || EMISOR_DEFAULT.ruc;
  const direccion = process.env.SUNAT_EMISOR_DIRECCION?.trim() || EMISOR_DEFAULT.direccion;
  const ubigeoLine = process.env.SUNAT_EMISOR_UBIGEO_LINE?.trim();
  const nombreComercial = process.env.SUNAT_EMISOR_NOMBRE_COMERCIAL?.trim();
  return { razonSocial, ruc, direccion, ubigeoLine, nombreComercial };
}
