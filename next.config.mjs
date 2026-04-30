/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Evita empaquetar pdfjs dentro del bundle del servidor; en Vercel el bundle
   * a veces rompe la carga dinámica de `pdfjs-dist` y la recuperación SUNAT
   * devuelve “no extrajimos… del PDF” aunque el mismo código en tsx local funcione.
   */
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
