"use client";

import { memo, useEffect, useState } from "react";
import { navigateToHref } from "@/lib/internal-href";
import { renderPdfToDataUrl } from "@/lib/pdf-preview";

type PdfPreviewThumbnailProps = {
  url: string;
  onClickPreview: (dataUrl: string) => void;
  /** compact = altura limitada (drawer usuarios); full = aspecto carta como sidebar reservas */
  variant?: "full" | "compact";
};

/**
 * Miniatura clickeable de la primera página del PDF (sidebar de pagos / drawer usuarios).
 */
export const PdfPreviewThumbnail = memo(function PdfPreviewThumbnail({
  url,
  onClickPreview,
  variant = "full",
}: PdfPreviewThumbnailProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const frame =
    variant === "compact"
      ? "rounded-xl border-2 border-green-200/80 max-h-52 aspect-[3/4] w-full max-w-[200px] mx-auto"
      : "rounded-xl border border-gray-200 aspect-[3/4]";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    renderPdfToDataUrl(url).then((dataUrl) => {
      if (!cancelled) {
        setImgSrc(dataUrl);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <div className={`${frame} bg-gray-100 animate-pulse flex items-center justify-center`}>
        <svg className="w-8 h-8 text-gray-300 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!imgSrc) {
    return (
      <div
        className={`relative group cursor-pointer overflow-hidden ${frame} flex flex-col items-center justify-center bg-gray-50`}
        onClick={() => navigateToHref(url)}
      >
        <svg className="mb-2 h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-sm font-semibold text-gray-400">Sin vista previa</span>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/45">
          <span className="mx-2 rounded-lg bg-black/75 px-2.5 py-1.5 text-center text-xs font-bold text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
            Clic para abrir el PDF
          </span>
        </div>
      </div>
    );
  }

  const imgClass =
    variant === "compact"
      ? "w-full h-full max-h-52 object-cover object-top transition-transform group-hover:scale-[1.02]"
      : "w-full h-full object-cover transition-transform group-hover:scale-105";

  return (
    <div
      className={`relative group cursor-pointer overflow-hidden ${variant === "compact" ? `${frame} bg-gray-100 shadow-sm` : `${frame} bg-gray-100`}`}
      onClick={() => onClickPreview(imgSrc)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imgSrc} alt="Vista previa del comprobante" className={imgClass} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/0 transition-colors duration-200 group-hover:bg-black/50">
        <span className="mx-2 max-w-[92%] rounded-lg bg-black/75 px-3 py-2 text-center text-xs font-bold leading-snug text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 sm:text-sm">
          Clic para ampliar la boleta
        </span>
      </div>
    </div>
  );
});
