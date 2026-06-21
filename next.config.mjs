/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // resvg-js es un módulo nativo (.node): que se requiera en runtime, no que webpack lo empaquete.
    serverComponentsExternalPackages: ["@resvg/resvg-js"],
    // Asegura que la tipografía de la imagen de horarios se incluya en el bundle serverless (Vercel).
    outputFileTracingIncludes: {
      "/api/**": ["./src/lib/agent/assets/**"],
    },
  },
};

export default nextConfig;
