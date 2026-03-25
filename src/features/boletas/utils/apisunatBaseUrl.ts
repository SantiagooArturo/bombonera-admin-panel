/**
 * APISUNAT_URL suele ser .../api/v3/documents → base .../api/v3 para voided / daily-summary.
 */
export function apisunatApiBaseFromDocumentsUrl(documentsUrl: string): string {
  const t = documentsUrl.trim().replace(/\/+$/, "");
  if (t.toLowerCase().endsWith("/documents")) return t.slice(0, -"/documents".length);
  return t;
}

/**
 * Consulta contribuyente por RUC (mismo origen que documentos).
 * Docs: https://docs.apisunat.pe/consulta/sunat-ruc
 */
export function apisunatConsultaRucUrlFromDocumentsUrl(documentsUrl: string, ruc: string): string {
  const clean = ruc.replace(/\D/g, "");
  const u = new URL(documentsUrl.trim());
  u.pathname = `/api/v1/business/ruc/${clean}`;
  u.search = "";
  u.hash = "";
  return u.toString();
}
