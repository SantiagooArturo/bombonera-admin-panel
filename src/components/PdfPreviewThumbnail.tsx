"use client";

import { memo, useEffect, useState } from "react";
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
        className={`relative group cursor-pointer overflow-hidden ${frame} bg-gray-50 flex flex-col items-center justify-center`}
        onClick={() => window.open(url, "_blank")}
      >
        <svg className="w-10 h-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-sm font-semibold text-gray-400">Sin vista previa</span>
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
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center transition-colors">
        <span
          className={`text-sm font-bold text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-lg ${
            variant === "compact" ? "bg-emerald-700/90" : "bg-black/60 backdrop-blur-sm"
          }`}
        >
          {variant === "compact" ? "Ampliar" : "Ver boleta"}
        </span>
      </div>
    </div>
  );
});
