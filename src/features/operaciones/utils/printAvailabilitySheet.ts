import { TIME_SLOTS, type Reservation } from "@/lib/types";
import { formatDisplayPhone } from "@/features/operaciones/utils";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrintableDateEs(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  const raw = d.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function slotLabel(startSlot: string): string {
  const to12h = (hour24: number): string => {
    const suffix = hour24 >= 12 ? "pm" : "am";
    const hour12 = hour24 % 12 || 12;
    return `${hour12} ${suffix}`;
  };
  const h = Number.parseInt(startSlot.split(":")[0], 10);
  const next = (h + 1) % 24;
  const start = to12h(h);
  const end = to12h(next);
  return `${start} a ${end}`;
}

function normalizeName(value: string | undefined): string {
  const clean = String(value || "").trim();
  return clean.length > 0 ? clean : "Sin nombre";
}

function getCellText(reservations: Reservation[], field: number, slot: string): string {
  const match = reservations.find((r) => r.field === field && (r.time_slots || []).includes(slot));
  if (!match) return "";
  const name = normalizeName(match.representative_name);
  const phone = formatDisplayPhone(String(match.phone_number || ""));
  return phone ? `${name}\n${phone}` : name;
}

const FIELD_GROUPS: number[][] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
];

export function printAvailabilitySheet(params: {
  date: string;
  reservations: Reservation[];
}): boolean {
  const { date, reservations } = params;
  const safeDate = escapeHtml(formatPrintableDateEs(date));
  const pages = FIELD_GROUPS.map((group, pageIdx) => {
    const cols = group
      .map((field) => `<th>CAMPO ${field}</th>`)
      .join("");
    const rows = TIME_SLOTS.map((slot) => {
      const cells = group
        .map((field) => `<td>${escapeHtml(getCellText(reservations, field, slot)) || "&nbsp;"}</td>`)
        .join("");
      return `<tr><td class="slot">${escapeHtml(slotLabel(slot))}</td>${cells}</tr>`;
    }).join("");
    return `
      <section class="page ${pageIdx > 0 ? "page-break" : ""}">
        <header class="title-wrap">
          <h1>DISPONIBILIDAD VOLEY</h1>
          <div class="meta">${safeDate}</div>
        </header>
        <table>
          <thead>
            <tr>
              <th class="turno">TURNO</th>
              ${cols}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>
    `;
  }).join("");

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>La Bombonera</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        body {
          font-family: Arial, sans-serif;
          color: #1f2937;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page { width: 100%; }
        .page-break { page-break-before: always; }
        .title-wrap { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .title-wrap h1 { margin: 0; font-size: 17px; letter-spacing: .3px; color: #166534; }
        .meta { font-size: 20px; font-weight: 800; color: #14532d; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        thead th {
          background-color: #166534 !important;
          color: #ffffff !important;
          font-size: 16px;
          letter-spacing: .3px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        th, td { border: 1px solid #2f855a; padding: 6px 5px; vertical-align: middle; }
        td { height: 30px; font-size: 15px; line-height: 1.15; word-wrap: break-word; white-space: pre-line; }
        th.turno, td.slot { width: 18%; text-align: center; font-weight: 700; }
        td.slot {
          background-color: #f0fdf4 !important;
          color: #065f46;
          font-size: 15px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      </style>
    </head>
    <body>
      ${pages}
    </body>
  </html>`;

  const printWindow = window.open("about:blank", "bombonera-print-availability");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Algunos navegadores no disparan impresión al reusar about:blank.
  // Forzamos una llamada diferida para evitar el "no hace nada" silencioso.
  window.setTimeout(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      // no-op: el caller ya maneja bloqueos de popup
    }
  }, 120);
  return true;
}

