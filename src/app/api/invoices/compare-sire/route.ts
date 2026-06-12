import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

const APISUNAT_SERIE_BOLETA = process.env.APISUNAT_SERIE_BOLETA || "B001";

type SireRow = {
  serie: string;
  codigo: number;
  cliente: string;
  total: number;
  estado: number;
  fechaEmision: string;
};

type CompareRow = {
  codigo: number;
  fecha: string;
  serie: string;
  clienteSire: string;
  clientePlataforma: string;
  valorSire: number | null;
  valorPlataforma: number | null;
  diferencia: number | null;
  estado: string;
};

type CompareSummary = {
  periodo: string;
  totalSire: number;
  totalPlataforma: number;
  coinciden: number;
  soloSire: number;
  soloPlataforma: number;
  diferencias: number;
  corregidas: number;
  sumSire: number;
  sumPlataforma: number;
  sumDiferencia: number;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function excelSerialToYmd(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 10000 || serial > 100000) return null;
  const jsDate = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (Number.isNaN(jsDate.getTime())) return null;
  const y = jsDate.getFullYear();
  const m = String(jsDate.getMonth() + 1).padStart(2, "0");
  const d = String(jsDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ymdToMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  const d = new Date(`${ym}-01T12:00:00`);
  return `${d.toLocaleDateString("es-PE", { month: "long" })} ${y}`;
}

function buildPeriodLabel(desde: string, hasta: string): string {
  const mDesde = desde.slice(0, 7);
  const mHasta = hasta.slice(0, 7);
  if (mDesde === mHasta) return ymdToMonthLabel(desde);
  return `${ymdToMonthLabel(desde)} — ${ymdToMonthLabel(hasta)}`;
}

/**
 * Cuando el nombre del cliente ocupa múltiples columnas en el Excel,
 * todas las columnas siguientes se desplazan a la derecha.
 * Esto hace que "Total CP" quede en 0 y el monto real aparezca
 * en una columna posterior (Moneda, Tipo Cambio, etc.).
 *
 * Detectamos el shift buscando:
 *  1. Total CP == 0
 *  2. Alguna columna después del Total tiene un número > 0 que
 *     coincide con el monto esperado (ej. de la plataforma).
 * Si no tenemos referencia de plataforma, usamos heurística:
 *  — Un número > 10 en una columna que normalmente no tiene números
 *    grandes (Moneda normalmente es "PEN").
 */
function extractRealTotal(row: unknown[], colTotal: number, colMoneda: number): number {
  const raw = Number(row[colTotal] ?? 0) || 0;
  if (raw > 0) return raw; // no shift

  // Buscar el monto real en columnas posteriores.
  // Recorremos desde colTotal+1 hasta colTotal+5 (cubre shifts de hasta 5 cols).
  for (let offset = 1; offset <= 5; offset++) {
    const idx = colTotal + offset;
    if (idx >= row.length) break;
    const val = Number(row[idx]);
    // Si encontramos un número > 10 que NO sea "1" (Tipo Cambio = 1 es normal),
    // es probablemente el monto real. PEN/USD serían strings, no numbers.
    // También aceptamos números más chicos porque hay boletas de S/10 o menos.
    if (Number.isFinite(val) && val > 0) {
      // Verificar que la columna de Moneda+offset tenga "PEN"
      const shiftedMoneda = String(row[colMoneda + offset] ?? "").trim();
      if (shiftedMoneda === "PEN" || shiftedMoneda === "USD") {
        return val;
      }
      // Si el número es grande (> 10), probablemente es el total aunque no encontremos PEN
      if (val > 10) return val;
    }
  }

  return 0;
}

function parseSireRows(rawData: unknown[][], header: string[]): SireRow[] {
  const colSerie = header.indexOf("Serie del CDP");
  const colNro = header.indexOf("Nro CP o Doc. Nro Inicial (Rango)");
  const colFecha = header.indexOf("Fecha de emisión");
  const colCliente = header.indexOf("Apellidos Nombres/ Razón Social");
  const colTotal = header.indexOf("Total CP");
  const colEstado = header.indexOf("Est. Comp");
  const colMoneda = header.indexOf("Moneda");

  if (colSerie < 0 || colNro < 0 || colTotal < 0) return [];

  const result: SireRow[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] as unknown[];
    const serie = String(row[colSerie] ?? "").trim();
    if (serie !== APISUNAT_SERIE_BOLETA) continue;

    const codigoRaw = Number(row[colNro]);
    if (!Number.isFinite(codigoRaw) || codigoRaw < 1) continue;

    const total = extractRealTotal(row, colTotal, colMoneda);
    const estadoRaw = Number(row[colEstado] ?? 1) || 1;
    // Si la fila está corrida, el estado también se desplaza
    const estadoOffset = total > 0 && Number(row[colTotal] ?? 0) === 0 ? 1 : 0;
    const estado = estadoOffset > 0
      ? (Number(row[colEstado + 1] ?? 1) || 1)
      : estadoRaw;

    const fechaSerial = Number(row[colFecha]);
    const fechaEmision = excelSerialToYmd(fechaSerial) || "";

    result.push({
      serie,
      codigo: codigoRaw,
      cliente: String(row[colCliente] ?? "").trim(),
      total,
      estado,
      fechaEmision,
    });
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const download = formData.get("download") === "1";

    if (!file) {
      return NextResponse.json({ error: "Archivo no proporcionado" }, { status: 400 });
    }

    const XLSX = await import("xlsx");
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;

    const rawAoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    const header = rawAoa[0] as string[];
    if (!header || header.length < 10) {
      return NextResponse.json(
        { error: "El archivo no tiene el formato esperado del SIRE" },
        { status: 400 }
      );
    }

    const sireRows = parseSireRows(rawAoa, header);

    const sireVigentes = sireRows
      .filter((r) => r.estado !== 2)
      .sort((a, b) => a.codigo - b.codigo);

    // ── Rango de correlativos del SIRE ──
    const sireMin = sireVigentes[0]?.codigo ?? 0;
    const sireMax = sireVigentes[sireVigentes.length - 1]?.codigo ?? 0;

    // ── Periodo ──
    const sireFechas = sireVigentes
      .map((r) => r.fechaEmision)
      .filter((f): f is string => YMD_RE.test(f))
      .sort();
    const fechaDesde = sireFechas[0] || "";
    const fechaHasta = sireFechas[sireFechas.length - 1] || "";
    const fechaPartes = fechaHasta ? fechaHasta.split("-") : [];
    const periodoLabel =
      fechaPartes.length >= 2
        ? ymdToMonthLabel(`${fechaPartes[0]}-${fechaPartes[1]}`)
        : `B001 ${sireMin} — ${sireMax}`;

    // ── Fetch plataforma ── filtrar por rango de correlativos ──
    const db = getDb();
    const invoicesSnap = await db
      .collection("invoices")
      .where("serie", "==", APISUNAT_SERIE_BOLETA)
      .get();

    const platformByCodigo = new Map<
      number,
      { amount: number; cliente: string; fecha: string; status: string }
    >();

    for (const doc of invoicesSnap.docs) {
      const d = doc.data();
      const corr = Number(d.correlativo);
      if (!Number.isFinite(corr) || corr < 1) continue;
      if (String(d.status || "").trim().toLowerCase() === "voided") continue;

      // Solo incluir si está dentro del rango de correlativos del SIRE
      if (sireMin > 0 && sireMax > 0 && (corr < sireMin || corr > sireMax)) continue;

      platformByCodigo.set(corr, {
        amount: Number(d.amount || 0),
        cliente: String(d.cliente_denominacion || "").trim(),
        fecha: String(d.fecha_emision_ymd || "").trim(),
        status: String(d.status || "").trim().toLowerCase(),
      });
    }

    // ── Comparar ──
    const rows: CompareRow[] = [];
    const allCodigos = new Set<number>();
    for (const s of sireVigentes) allCodigos.add(s.codigo);
    for (const cod of Array.from(platformByCodigo.keys())) allCodigos.add(cod);

    const sorted = Array.from(allCodigos).sort((a, b) => a - b);
    let sumSire = 0;
    let sumPlataforma = 0;
    let sumDiferencia = 0;
    let corregidasCount = 0;

    for (const cod of sorted) {
      const sire = sireVigentes.find((r) => r.codigo === cod);
      const plat = platformByCodigo.get(cod);

      const valorSire = sire ? sire.total : null;
      const valorPlat = plat ? plat.amount : null;
      const diff =
        valorSire != null && valorPlat != null
          ? Math.round((valorPlat - valorSire) * 100) / 100
          : null;

      let estado = "✅ OK";
      if (!sire && plat) estado = "⚠️ Solo plataforma";
      else if (sire && !plat) estado = "📋 Solo SIRE";
      else if (diff != null && Math.abs(diff) > 0.01) estado = "❌ Diferencia";

      // Detectar si esta boleta fue corregida (shifted)
      if (sire && sire.total > 0 && Number.isFinite(sire.total)) {
        const rawTotalCol = header.indexOf("Total CP");
        // Si el Total CP original era 0 pero extractRealTotal encontró el monto, fue corregida
        // No podemos saberlo directamente del SireRow, así que lo inferimos:
        // Si el monto match con plataforma y el SIRE lo tenía en una columna corrida
        if (estado === "✅ OK" && sire.total > 0) {
          // Asumimos que si está OK, pudo haber sido corregida
        }
      }

      if (valorSire != null) sumSire += valorSire;
      if (valorPlat != null) sumPlataforma += valorPlat;
      if (diff != null) sumDiferencia += diff;

      rows.push({
        codigo: cod,
        fecha: plat?.fecha || sire?.fechaEmision || "",
        serie: APISUNAT_SERIE_BOLETA,
        clienteSire: sire?.cliente || "",
        clientePlataforma: plat?.cliente || "",
        valorSire,
        valorPlataforma: valorPlat,
        diferencia: diff,
        estado,
      });
    }

    // Contar corregidas: boletas donde el raw Total CP era 0 pero extractRealTotal encontró monto
    for (let i = 1; i < rawAoa.length; i++) {
      const row = rawAoa[i] as unknown[];
      const serie = String(row[header.indexOf("Serie del CDP")] ?? "").trim();
      if (serie !== APISUNAT_SERIE_BOLETA) continue;
      const codigo = Number(row[header.indexOf("Nro CP o Doc. Nro Inicial (Rango)")]);
      if (!Number.isFinite(codigo)) continue;
      const colTotal = header.indexOf("Total CP");
      const rawTotal = Number(row[colTotal] ?? 0) || 0;
      if (rawTotal === 0) {
        const plat = platformByCodigo.get(codigo);
        const foundTotal = extractRealTotal(row, colTotal, header.indexOf("Moneda"));
        if (foundTotal > 0 && plat && Math.abs(foundTotal - plat.amount) < 0.01) {
          corregidasCount++;
        }
      }
    }

    // ── Summary ──
    const summary: CompareSummary = {
      periodo: periodoLabel,
      totalSire: sireVigentes.length,
      totalPlataforma: platformByCodigo.size,
      coinciden: rows.filter((r) => r.estado === "✅ OK").length,
      soloSire: rows.filter((r) => r.estado === "📋 Solo SIRE").length,
      soloPlataforma: rows.filter((r) => r.estado === "⚠️ Solo plataforma").length,
      diferencias: rows.filter((r) => r.estado === "❌ Diferencia").length,
      corregidas: corregidasCount,
      sumSire: Math.round(sumSire * 100) / 100,
      sumPlataforma: Math.round(sumPlataforma * 100) / 100,
      sumDiferencia: Math.round((sumPlataforma - sumSire) * 100) / 100,
    };

    if (download) {
      const wsData = rows.map((r) => ({
        Código: r.codigo,
        Fecha: r.fecha,
        Serie: r.serie,
        "Cliente SIRE": r.clienteSire,
        "Cliente Plataforma": r.clientePlataforma,
        "Valor SIRE": r.valorSire != null ? r.valorSire : "",
        "Valor Plataforma": r.valorPlataforma != null ? r.valorPlataforma : "",
        Diferencia: r.diferencia != null ? r.diferencia : "",
        Estado: r.estado,
      }));

      wsData.push({
        Código: "" as unknown as number,
        Fecha: "",
        Serie: "",
        "Cliente SIRE": "SUMAS TOTALES",
        "Cliente Plataforma": summary.periodo,
        "Valor SIRE": summary.sumSire,
        "Valor Plataforma": summary.sumPlataforma,
        Diferencia: summary.sumDiferencia,
        Estado: "",
      });

      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Comparación");
      ws["!cols"] = [
        { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 30 }, { wch: 30 },
        { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 22 },
      ];

      const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(xlsx, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${summary.periodo.toLowerCase().replace(/\s+/g, "-")}-sire-vs-plataforma.xlsx"`,
        },
      });
    }

    return NextResponse.json({ success: true, summary, rows });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[compare-sire] Error:", msg);
    return NextResponse.json({ error: `Error al procesar: ${msg}` }, { status: 500 });
  }
}
