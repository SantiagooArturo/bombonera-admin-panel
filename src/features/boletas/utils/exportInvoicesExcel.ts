import type { Invoice } from "@/lib/types";
import { sanitizeReceptorNombre } from "./sanitizeReceptorNombre";

export type ExportInvoiceKind = "boleta" | "factura";
export type ExportInvoicePeriod =
  | { mode: "historico" }
  | { mode: "mes"; month: string }; // YYYY-MM

type ExportRow = {
  Fecha: string;
  "Prefijo/Serie": string;
  Codigo: number | "";
  "DNI/RUC cliente": string;
  "Nombre cliente": string;
  Monto: number;
  Estado: "Anulado" | "Vigente";
};

const WEEKDAY_SHEETS: Array<{ name: string; jsDay: number }> = [
  { name: "Lunes", jsDay: 1 },
  { name: "Martes", jsDay: 2 },
  { name: "Miercoles", jsDay: 3 },
  { name: "Jueves", jsDay: 4 },
  { name: "Viernes", jsDay: 5 },
  { name: "Sabado", jsDay: 6 },
  { name: "Domingo", jsDay: 0 },
];

function toYmdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseInvoiceDate(inv: Invoice): Date | null {
  const ymd = String(inv.fecha_emision_ymd || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const d = new Date(`${ymd}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const created = String(inv.created_at || "").trim();
  if (!created) return null;
  const d = new Date(created);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isUniformDigits(rawDoc: string): boolean {
  if (!rawDoc) return false;
  return /^(\d)\1+$/.test(rawDoc);
}

function getClientDoc(inv: Invoice): string {
  const doc = String(inv.cliente_numero_de_documento || "").replace(/\D/g, "");
  if (!doc) return "";
  if (isUniformDigits(doc)) return "";
  return doc;
}

function getClientName(inv: Invoice): string {
  const fromSunat = String(inv.cliente_denominacion || "").trim();
  if (fromSunat) {
    const clean = sanitizeReceptorNombre(fromSunat);
    return clean || fromSunat;
  }
  const fromSnapshot = String(inv.representative_name_snapshot || "").trim();
  if (fromSnapshot) {
    const clean = sanitizeReceptorNombre(fromSnapshot);
    return clean || fromSnapshot;
  }
  return "";
}

function getSerieAndCode(inv: Invoice): { serie: string; code: number | "" } {
  const serieCorrelativo = String(inv.serie_correlativo || "").trim();
  if (serieCorrelativo.includes("-")) {
    const [serieRaw, codeRaw] = serieCorrelativo.split("-");
    const n = Number.parseInt(String(codeRaw || "").replace(/\D/g, ""), 10);
    return {
      serie: String(serieRaw || "").trim(),
      code: Number.isFinite(n) ? n : "",
    };
  }
  const serie = String(inv.serie || "").trim();
  const n = Number(inv.correlativo);
  return {
    serie,
    code: Number.isFinite(n) && n > 0 ? n : "",
  };
}

function buildRows(invoices: Invoice[]): Array<ExportRow & { _date: Date | null }> {
  return invoices.map((inv) => {
    const d = parseInvoiceDate(inv);
    const { serie, code } = getSerieAndCode(inv);
    return {
      Fecha: d ? toYmdFromDate(d) : "",
      "Prefijo/Serie": serie,
      Codigo: code,
      "DNI/RUC cliente": getClientDoc(inv),
      "Nombre cliente": getClientName(inv),
      Monto: Number(inv.amount || 0),
      Estado: String(inv.status || "").trim() === "voided" ? "Anulado" : "Vigente",
      _date: d,
    };
  });
}

function filterByKind(invoices: Invoice[], kind: ExportInvoiceKind): Invoice[] {
  return invoices.filter((inv) =>
    kind === "factura" ? inv.tipo_comprobante === "factura" : inv.tipo_comprobante !== "factura"
  );
}

function filterByPeriod(invoices: Invoice[], period: ExportInvoicePeriod): Invoice[] {
  if (period.mode === "historico") return invoices;
  return invoices.filter((inv) => {
    const d = parseInvoiceDate(inv);
    if (!d) return false;
    return toYmdFromDate(d).startsWith(period.month);
  });
}

export async function exportInvoicesExcel(params: {
  invoices: Invoice[];
  kind: ExportInvoiceKind;
  period: ExportInvoicePeriod;
}): Promise<{ count: number; fileName: string }> {
  const { invoices, kind, period } = params;
  const filtered = filterByPeriod(filterByKind(invoices, kind), period);
  const rows = buildRows(filtered).sort((a, b) => (a.Fecha < b.Fecha ? -1 : a.Fecha > b.Fecha ? 1 : 0));

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const publicRows = rows.map((row) => {
    const copy = { ...row };
    delete copy._date;
    return copy;
  });
  const wsAll = XLSX.utils.json_to_sheet(publicRows);
  XLSX.utils.book_append_sheet(wb, wsAll, "Todos");

  for (const wd of WEEKDAY_SHEETS) {
    const dayRows = rows
      .filter((r) => r._date && r._date.getDay() === wd.jsDay)
      .map((row) => {
        const copy = { ...row };
        delete copy._date;
        return copy;
      });
    const wsDay = XLSX.utils.json_to_sheet(dayRows);
    XLSX.utils.book_append_sheet(wb, wsDay, wd.name);
  }

  const periodLabel = period.mode === "historico" ? "historico" : period.month;
  const fileName = `${kind}s_${periodLabel}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return { count: publicRows.length, fileName };
}

