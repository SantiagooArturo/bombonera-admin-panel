import { TIME_SLOTS, type Reservation } from "@/lib/types";

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
  let clean = String(value || "").trim();
  if (clean.length === 0) return "Sin nombre";

  // 1. Quitar todo lo que siga a palabras clave (insensible a mayúsculas/acentos)
  clean = clean.split(/voley|volley|vóley|Número Personal/i)[0];

  // 2. Quitar todos los números
  clean = clean.replace(/\d+/g, "");

  // 3. Limpieza final de espacios
  clean = clean.trim();

  return clean.length > 0 ? clean : "Sin nombre";
}

function getCellData(reservations: Reservation[], field: number, slot: string) {
  const match = reservations.find((r) => r.field === field && (r.time_slots || []).includes(slot));
  if (!match) return null;

  const name = escapeHtml(normalizeName(match.representative_name));
  const total = match.total_price || 0;
  const paid = match.amount_paid || 0;
  const rest = Math.max(0, total - paid);

  const html = `
    <div class="client-name">${name}</div>
    <div class="payment-info">
      <div>Total: S/ ${total}</div>
      <div>Resta: S/ ${rest}</div>
    </div>
  `;

  return {
    id: match.id,
    html,
  };
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
    const cols = group.map((field) => `<th>CAMPO ${field}</th>`).join("");

    const fieldSpanTrack: Record<number, { id: string; remaining: number }> = {};

    const rows = TIME_SLOTS.map((slot, slotIdx) => {
      const cells = group
        .map((field) => {
          if (fieldSpanTrack[field] && fieldSpanTrack[field].remaining > 0) {
            fieldSpanTrack[field].remaining--;
            return "";
          }

          const data = getCellData(reservations, field, slot);
          if (!data) {
            return "<td>&nbsp;</td>";
          }

          let rowspan = 1;
          for (let i = slotIdx + 1; i < TIME_SLOTS.length; i++) {
            const nextData = getCellData(reservations, field, TIME_SLOTS[i]);
            if (nextData && nextData.id === data.id) {
              rowspan++;
            } else {
              break;
            }
          }

          if (rowspan > 1) {
            fieldSpanTrack[field] = { id: data.id, remaining: rowspan - 1 };
          }

          const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : "";
          return `<td${rowspanAttr}>${data.html}</td>`;
        })
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
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .page { 
          width: 100%; 
          height: 275mm; 
          display: flex; 
          flex-direction: column;
          box-sizing: border-box;
        }
        .page-break { page-break-before: always; }
        .title-wrap { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 10px;
          flex-shrink: 0;
        }
        .title-wrap h1 { margin: 0; font-size: 18px; letter-spacing: .5px; color: #166534; }
        .meta { font-size: 22px; font-weight: 800; color: #14532d; }
        
        table { 
          width: 100%; 
          flex-grow: 1;
          border-collapse: collapse; 
          table-layout: fixed; 
        }
        thead th {
          background-color: #166534 !important;
          color: #ffffff !important;
          font-size: 14px;
          padding: 8px 4px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        th, td { border: 1.5px solid #166534; padding: 4px; vertical-align: middle; }
        
        /* Forzar que las filas se estiren para llenar el alto de la tabla */
        tbody tr { height: 1%; } /* Hack para que crezcan equitativamente */
        td { height: auto; word-wrap: break-word; }

        th.turno, td.slot { width: 14%; text-align: center; font-weight: 700; }
        td.slot {
          background-color: #f0fdf4 !important;
          color: #065f46;
          font-size: 15px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .client-name {
          font-weight: 500;
          font-size: 16px;
          text-align: center;
          color: #000000;
          margin-bottom: 10px;
          padding-bottom: 0;
        }
        .payment-info {
          font-size: 13.5px;
          text-align: left;
          color: #000000;
          padding: 0 4px;
          line-height: 1.3;
        }
      </style>
    </head>
    <body onload="window.focus();">
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


