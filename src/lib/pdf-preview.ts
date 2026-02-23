/* eslint-disable @typescript-eslint/no-explicit-any */

const PDF_JS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

let loadPromise: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }

    const script = document.createElement("script");
    script.src = PDF_JS_URL;
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        resolve(lib);
      } else {
        reject(new Error("pdfjsLib not available after script load"));
      }
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error(`Failed to load pdf.js from ${PDF_JS_URL}`));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Renderiza la primera página de un PDF (desde URL) a una data URL PNG.
 * Carga pdf.js v3 desde CDN (UMD build) para evitar conflictos con webpack.
 */
export async function renderPdfToDataUrl(source: string, scale = 2): Promise<string | null> {
  try {
    const pdfjsLib = await loadPdfJs();

    const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(source)}`;
    const response = await fetch(proxyUrl);
    const data = new Uint8Array(await response.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: canvas.getContext("2d")!,
      viewport,
    }).promise;

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("=== PDF PREVIEW ERROR ===");
    console.error(err);
    return null;
  }
}
