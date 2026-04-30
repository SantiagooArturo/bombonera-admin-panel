/** Núcleo de `pdf-parse` (sin `index.js`, que en `!module.parent` intenta leer PDFs de test y rompe `next build`). */
declare module "pdf-parse/lib/pdf-parse.js" {
  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>
  ): Promise<{ text: string; numpages: number }>;
  export = pdfParse;
}
