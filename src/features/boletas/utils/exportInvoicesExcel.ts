import type { Invoice } from "@/lib/types";
import { getInvoiceUiStatus, invoiceIsVigenteForExport } from "./invoiceUiStatus";
import { sanitizeReceptorNombre } from "./sanitizeReceptorNombre";

export type ExportInvoiceKind = "boleta" | "factura";
export type ExportInvoicePeriod =
  | { mode: "historico" }
  | { mode: "mes"; month: string } // YYYY-MM
  | { mode: "rango"; desde: string; hasta: string }; // YYYY-MM-DD inclusive

/** No se exportan comprobantes con fecha de emisión anterior a este día (inclusive desde aquí). */
export const EXPORT_INCLUSIVE_MIN_YMD = "2026-03-23" as const;

type ExportRow = {
  Fecha: string;
  "Prefijo/Serie": string;
  Codigo: number | "";
  "DNI/RUC cliente": string;
  "Nombre cliente": string;
  Monto: number;
};

/** Caracteres de control ilegales en XML/OOXML (provocan reparación o error al abrir en algunos Excel). */
function sanitizeOoxmlCellText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function toPublicRow(row: ExportRow & { _date: Date | null }): ExportRow {
  return {
    Fecha: sanitizeOoxmlCellText(row.Fecha),
    "Prefijo/Serie": sanitizeOoxmlCellText(row["Prefijo/Serie"]),
    Codigo: row.Codigo,
    "DNI/RUC cliente": sanitizeOoxmlCellText(row["DNI/RUC cliente"]),
    "Nombre cliente": sanitizeOoxmlCellText(row["Nombre cliente"]),
    Monto: row.Monto,
  };
}

const EXCEL_SHEET_NAME_INVALID = /[\\/:*?\[\]]/g;

function sanitizeExcelSheetName(raw: string): string {
  let s = raw.replace(EXCEL_SHEET_NAME_INVALID, "-").replace(/\s+/g, " ").trim();
  if (!s) s = "Hoja";
  while (s.startsWith("'")) s = s.slice(1).trim();
  while (s.endsWith("'")) s = s.slice(0, -1).trim();
  if (!s) s = "Hoja";
  return s.slice(0, 31);
}

function appendSheetWithUniqueName(
  XLSX: typeof import("xlsx"),
  wb: import("xlsx").WorkBook,
  ws: import("xlsx").WorkSheet,
  desiredName: string,
  usedNames: Set<string>
): void {
  const base = sanitizeExcelSheetName(desiredName);
  let name = base;
  let n = 2;
  while (usedNames.has(name)) {
    const suffix = ` ${n}`;
    name = (base.slice(0, Math.max(1, 31 - suffix.length)) + suffix).slice(0, 31);
    n += 1;
  }
  usedNames.add(name);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

const WEEKDAY_NAME_ES: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miercoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sabado",
};

/** Mes corto en español (índice 0 = enero). Excel no admite "/" en nombres de hoja. */
const MONTH_ABBREV_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function sheetNameForCalendarDay(d: Date, includeYear: boolean): string {
  const wd = WEEKDAY_NAME_ES[d.getDay()] ?? "Dia";
  const day = d.getDate();
  const mon = MONTH_ABBREV_ES[d.getMonth()] ?? "";
  const y = d.getFullYear();
  return includeYear ? `${wd} ${day} ${mon} ${y}` : `${wd} ${day} ${mon}`;
}

function daysInCalendarMonth(ym: string): number {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

function enumerateYmdInMonth(ym: string): string[] {
  const n = daysInCalendarMonth(ym);
  const out: string[] = [];
  for (let day = 1; day <= n; day++) {
    const dd = String(day).padStart(2, "0");
    const ymd = `${ym}-${dd}`;
    if (ymd >= EXPORT_INCLUSIVE_MIN_YMD) out.push(ymd);
  }
  return out;
}

function enumerateYmdInRange(desdeYmd: string, hastaYmd: string): string[] {
  if (hastaYmd < desdeYmd) return [];
  const start = new Date(`${desdeYmd}T12:00:00`);
  const end = new Date(`${hastaYmd}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out: string[] = [];
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    out.push(toYmdFromDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function exportMinDateAllowsCalendarMonth(ym: string): boolean {
  const n = daysInCalendarMonth(ym);
  const lastYmd = `${ym}-${String(n).padStart(2, "0")}`;
  return lastYmd >= EXPORT_INCLUSIVE_MIN_YMD;
}

function uniqueSortedYmdFromRows(rows: Array<ExportRow & { _date: Date | null }>): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r._date) set.add(toYmdFromDate(r._date));
  }
  return Array.from(set).sort();
}

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
    if (!Number.isNaN(d.getTime())) return d;
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
    const isAnulado = getInvoiceUiStatus(inv) === "anulado";
    return {
      Fecha: d ? toYmdFromDate(d) : "",
      "Prefijo/Serie": serie,
      Codigo: code,
      "DNI/RUC cliente": getClientDoc(inv),
      "Nombre cliente": getClientName(inv),
      Monto: isAnulado ? 0 : Number(inv.amount || 0),
      _date: d,
    };
  });
}

function filterByKind(invoices: Invoice[], kind: ExportInvoiceKind): Invoice[] {
  return invoices.filter((inv) =>
    kind === "factura" ? inv.tipo_comprobante === "factura" : inv.tipo_comprobante !== "factura"
  );
}

function filterVigenteForExport(invoices: Invoice[]): Invoice[] {
  return invoices.filter(invoiceIsVigenteForExport);
}

function filterByPeriod(invoices: Invoice[], period: ExportInvoicePeriod): Invoice[] {
  if (period.mode === "historico") {
    return invoices.filter((inv) => {
      const d = parseInvoiceDate(inv);
      if (!d) return false;
      return toYmdFromDate(d) >= EXPORT_INCLUSIVE_MIN_YMD;
    });
  }
  if (period.mode === "mes") {
    return invoices.filter((inv) => {
      const d = parseInvoiceDate(inv);
      if (!d) return false;
      const ymd = toYmdFromDate(d);
      return ymd.startsWith(period.month) && ymd >= EXPORT_INCLUSIVE_MIN_YMD;
    });
  }
  const desde =
    period.desde < EXPORT_INCLUSIVE_MIN_YMD ? EXPORT_INCLUSIVE_MIN_YMD : period.desde;
  const hasta = period.hasta;
  if (hasta < desde) return [];
  return invoices.filter((inv) => {
    const d = parseInvoiceDate(inv);
    if (!d) return false;
    const ymd = toYmdFromDate(d);
    return ymd >= desde && ymd <= hasta;
  });
}

export async function exportInvoicesExcel(params: {
  invoices: Invoice[];
  kind: ExportInvoiceKind;
  period: ExportInvoicePeriod;
}): Promise<{ count: number; fileName: string }> {
  const { invoices, kind, period } = params;
  const filtered = filterByPeriod(filterByKind(filterVigenteForExport(invoices), kind), period);
  const rows = buildRows(filtered).sort((a, b) => {
    if (a.Fecha !== b.Fecha) return a.Fecha < b.Fecha ? -1 : 1;
    if (a["Prefijo/Serie"] !== b["Prefijo/Serie"])
      return a["Prefijo/Serie"] < b["Prefijo/Serie"] ? -1 : 1;
    return (Number(a.Codigo) || 0) - (Number(b.Codigo) || 0);
  });

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();
  const publicRows = rows.map(toPublicRow);
  const wsAll = XLSX.utils.json_to_sheet(publicRows);
  appendSheetWithUniqueName(XLSX, wb, wsAll, "Todos", usedSheetNames);

  const headerRow: (keyof ExportRow)[] = [
    "Fecha",
    "Prefijo/Serie",
    "Codigo",
    "DNI/RUC cliente",
    "Nombre cliente",
    "Monto",
  ];

  let ymdList: string[];
  let includeYearInSheetName: boolean;
  let periodLabel: string;

  if (period.mode === "mes") {
    ymdList = enumerateYmdInMonth(period.month);
    includeYearInSheetName = false;
    periodLabel = period.month;
  } else if (period.mode === "historico") {
    ymdList = uniqueSortedYmdFromRows(rows);
    includeYearInSheetName = true;
    periodLabel = "historico";
  } else {
    const desdeEff =
      period.desde < EXPORT_INCLUSIVE_MIN_YMD ? EXPORT_INCLUSIVE_MIN_YMD : period.desde;
    const hastaEff = period.hasta;
    if (hastaEff < desdeEff) {
      ymdList = [];
    } else {
      ymdList = enumerateYmdInRange(desdeEff, hastaEff);
    }
    includeYearInSheetName = desdeEff.slice(0, 7) !== hastaEff.slice(0, 7);
    periodLabel = `${desdeEff}_a_${hastaEff}`;
  }

  for (const ymd of ymdList) {
    const d = new Date(`${ymd}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const dayRows = rows
      .filter((r) => r._date && toYmdFromDate(r._date) === ymd)
      .map(toPublicRow);
    const wsDay =
      dayRows.length > 0
        ? XLSX.utils.json_to_sheet(dayRows)
        : XLSX.utils.aoa_to_sheet([headerRow]);
    const rawName = sheetNameForCalendarDay(d, includeYearInSheetName);
    appendSheetWithUniqueName(XLSX, wb, wsDay, rawName, usedSheetNames);
  }

  const fileName = `${kind}s_${periodLabel}.xlsx`;
  XLSX.writeFileXLSX(wb, fileName, {
    bookType: "xlsx",
    bookSST: false,
    compression: true,
    ignoreEC: false,
  });
  return { count: publicRows.length, fileName };
}

