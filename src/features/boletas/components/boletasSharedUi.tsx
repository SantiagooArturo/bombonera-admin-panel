/** Iconos y celdas compartidos entre vista escritorio y móvil de comprobantes. */

export function IconOpenInNewTab({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/** Salto de línea preferente justo después del guion (ej. B001-123456). */
export function SerieCorrelativoCell({ value }: { value: string | null | undefined }) {
  const s = String(value ?? "").trim();
  if (!s) return <>—</>;
  const i = s.indexOf("-");
  if (i < 0) {
    return <span className="break-all leading-tight">{s}</span>;
  }
  return (
    <span className="leading-tight">
      <span className="whitespace-nowrap">{s.slice(0, i + 1)}</span>
      <wbr />
      <span className="break-all">{s.slice(i + 1)}</span>
    </span>
  );
}
