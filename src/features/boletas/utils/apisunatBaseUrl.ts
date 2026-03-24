/**
 * APISUNAT_URL suele ser .../api/v3/documents → base .../api/v3 para voided / daily-summary.
 */
export function apisunatApiBaseFromDocumentsUrl(documentsUrl: string): string {
  const t = documentsUrl.trim().replace(/\/+$/, "");
  if (t.toLowerCase().endsWith("/documents")) return t.slice(0, -"/documents".length);
  return t;
}
