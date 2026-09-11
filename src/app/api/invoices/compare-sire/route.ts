import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { getEmisorSunatFromEnv } from "@/features/boletas/pdf/emisorSunatEnv";
import {
  scanMissingSunatInvoicesForFirestore,
  commitRecoveredInvoiceDocs,
} from "@/features/boletas/services/sunatFirestoreRecovery";

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
  anuladasPlataforma: number;
  sumAnuladasPlataforma: number;
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

function parseFechaToYmd(val: unknown): string | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") {
    return excelSerialToYmd(val);
  }
  const str = String(val).trim();
  if (YMD_RE.test(str)) return str;
  // Formato peruano DD/MM/YYYY
  const m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function ymdToMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const idx = parseInt(m, 10) - 1;
  const name = monthNames[idx] || m;
  return `${name} ${y}`;
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

function parseSireRows(rawData: unknown[][], header: string[]): { rows: SireRow[]; detectedPeriodo?: string } {
  const colSerie = header.findIndex((h) => /serie/i.test(String(h || "")));
  const colNro = header.findIndex((h) => /nro\s*cp|inicial/i.test(String(h || "")));
  const colFecha = header.findIndex((h) => /fecha.*emisi/i.test(String(h || "")));
  const colCliente = header.findIndex((h) => /apellidos|raz[oó]n\s*social/i.test(String(h || "")));
  const colTotal = header.findIndex((h) => /total\s*cp/i.test(String(h || "")));
  const colEstado = header.findIndex((h) => /est.*comp/i.test(String(h || "")));
  const colMoneda = header.findIndex((h) => /moneda/i.test(String(h || "")));
  const colPeriodo = header.findIndex((h) => /periodo/i.test(String(h || "")));

  let detectedPeriodo: string | undefined = undefined;
  if (colPeriodo >= 0) {
    for (let i = 1; i < rawData.length; i++) {
      const rawP = String((rawData[i] as unknown[])?.[colPeriodo] ?? "").trim();
      const pMatch = rawP.match(/^(\d{4})(\d{2})$/);
      if (pMatch) {
        detectedPeriodo = `${pMatch[1]}-${pMatch[2]}`;
        break;
      }
    }
  }

  if (colSerie < 0 || colNro < 0 || colTotal < 0) return { rows: [] };

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
  return { rows: result, detectedPeriodo };
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

    const { rows: sireRows, detectedPeriodo } = parseSireRows(rawAoa, header);

    const sireVigentes = sireRows
      .filter((r) => r.estado !== 2)
      .sort((a, b) => a.codigo - b.codigo);

    // ── Rango de correlativos del SIRE ──
    const sireMin = sireVigentes[0]?.codigo ?? 0;
    const sireMax = sireVigentes[sireVigentes.length - 1]?.codigo ?? 0;

        // ── Periodo ──
    let periodoLabel = "";
    if (detectedPeriodo) {
      periodoLabel = ymdToMonthLabel(detectedPeriodo);
    } else {
      const sireFechas = sireVigentes
        .map((r) => r.fechaEmision)
        .filter((f): f is string => YMD_RE.test(f))
        .sort();
      const fechaHasta = sireFechas[sireFechas.length - 1] || "";
      const fechaPartes = fechaHasta ? fechaHasta.split("-") : [];
      periodoLabel =
        fechaPartes.length >= 2
          ? ymdToMonthLabel(`${fechaPartes[0]}-${fechaPartes[1]}`)
          : `B001 ${sireMin} – ${sireMax}`;
    }

    // ── Fetch plataforma ── filtrar por rango de correlativos ──
    const db = getDb();

    // Recuperación automática de boletas SUNAT ausentes en segundo plano
    const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
    const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
    if (APISUNAT_URL && APISUNAT_TOKEN) {
      try {
        const emisor = getEmisorSunatFromEnv();
        const scan = await scanMissingSunatInvoicesForFirestore(db, {
          serie: APISUNAT_SERIE_BOLETA,
          apisunatUrl: APISUNAT_URL,
          apisunatToken: APISUNAT_TOKEN,
          rucEmisor: emisor.ruc.replace(/\D/g, ""),
          recoverySourceForDocs: "api_compare_sire_auto_recover",
        });
        if (scan.toCreate && scan.toCreate.length > 0) {
          await commitRecoveredInvoiceDocs(db, APISUNAT_SERIE_BOLETA, scan.toCreate);
        }
      } catch (err) {
        console.error("Error al recuperar boletas perdidas en compare-sire:", err);
      }
    }

    const invoicesSnap = await db
      .collection("invoices")
      .where("serie", "==", APISUNAT_SERIE_BOLETA)
      .get();

    const platformByCodigo = new Map<
      number,
      { amount: number; cliente: string; fecha: string; status: "active" | "voided" }
    >();

    for (const doc of invoicesSnap.docs) {
      const d = doc.data();
      const corr = Number(d.correlativo);
      if (!Number.isFinite(corr) || corr < 1) continue;

      // Solo incluir si está dentro del rango de correlativos del SIRE
      if (sireMin > 0 && sireMax > 0 && (corr < sireMin || corr > sireMax)) continue;

      const isVoided = String(d.status || "").trim().toLowerCase() === "voided";

      platformByCodigo.set(corr, {
        amount: Number(d.amount || 0),
        cliente: String(d.cliente_denominacion || "").trim(),
        fecha: String(d.fecha_emision_ymd || "").trim(),
        status: isVoided ? "voided" : "active",
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
    let sumAnuladasPlataforma = 0;
    let corregidasCount = 0;

    for (const cod of sorted) {
      const sire = sireVigentes.find((r) => r.codigo === cod);
      const plat = platformByCodigo.get(cod);

      const valorSire = sire ? sire.total : null;
      const valorPlat = plat ? plat.amount : null;
      let diff =
        valorSire != null && valorPlat != null
          ? Math.round((valorPlat - valorSire) * 100) / 100
          : null;

      let estado = "✅ OK";
      if (sire && plat && plat.status === "voided") {
        estado = "🚫 Anulada en plataforma";
        diff = valorSire != null ? -valorSire : null;
        sumAnuladasPlataforma += valorSire || plat.amount || 0;
      } else if (!sire && plat) {
        if (plat.status === "voided") {
          continue;
        }
        estado = "⚠️ Solo plataforma";
      } else if (sire && !plat) {
        estado = "📋 Solo SIRE";
      } else if (diff != null && Math.abs(diff) > 0.01) {
        estado = "❌ Diferencia";
      }

      if (valorSire != null) sumSire += valorSire;
      if (valorPlat != null && plat?.status !== "voided") sumPlataforma += valorPlat;

      const clientePlatDisplay = plat
        ? plat.status === "voided"
          ? (plat.cliente ? `${plat.cliente} (Anulada)` : "(Anulada)")
          : plat.cliente || ""
        : "";

      rows.push({
        codigo: cod,
        fecha: plat?.fecha || sire?.fechaEmision || "",
        serie: APISUNAT_SERIE_BOLETA,
        clienteSire: sire?.cliente || "",
        clientePlataforma: clientePlatDisplay,
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
    const anuladasCount = rows.filter((r) => r.estado === "🚫 Anulada en plataforma").length;
    const summary: CompareSummary = {
      periodo: periodoLabel,
      totalSire: sireVigentes.length,
      totalPlataforma: Array.from(platformByCodigo.values()).filter((p) => p.status === "active").length,
      coinciden: rows.filter((r) => r.estado === "✅ OK").length,
      soloSire: rows.filter((r) => r.estado === "📋 Solo SIRE").length,
      soloPlataforma: rows.filter((r) => r.estado === "⚠️ Solo plataforma").length,
      diferencias: rows.filter((r) => r.estado === "❌ Diferencia").length,
      anuladasPlataforma: anuladasCount,
      sumAnuladasPlataforma: Math.round(sumAnuladasPlataforma * 100) / 100,
      corregidas: corregidasCount,
      sumSire: Math.round(sumSire * 100) / 100,
      sumPlataforma: Math.round(sumPlataforma * 100) / 100,
      sumDiferencia: Math.round((sumPlataforma - sumSire) * 100) / 100,
    };

        const downloadRvieZip = formData.get("download_rvie_zip") === "1";

    if (downloadRvieZip) {
      const colRuc = header.findIndex((h) => /^ruc$/i.test(String(h || "").trim()));
      const colPeriodo = header.findIndex((h) => /periodo/i.test(String(h || "")));
      const colNro = header.findIndex((h) => /nro\s*cp|inicial/i.test(String(h || "")));
      const colFecha = header.findIndex((h) => /fecha.*emisi/i.test(String(h || "")));
      const colTipoCp = header.findIndex((h) => /tipo\s*cp/i.test(String(h || "")));
      const colTipoOp = header.findIndex((h) => /tipo\s*operaci/i.test(String(h || "")));
      const colBi = header.findIndex((h) => /bi\s*gravada/i.test(String(h || "")));
      const colIgv = header.findIndex((h) => /igv/i.test(String(h || "")));
      const colTotal = header.findIndex((h) => /total\s*cp/i.test(String(h || "")));
      const colEstado = header.findIndex((h) => /est.*comp/i.test(String(h || "")));

      const ruc = String(rawAoa[1]?.[colRuc] || "20511046255").trim();
      const rawP = String(rawAoa[1]?.[colPeriodo] || detectedPeriodo || "202608").trim();
      const periodoClean = rawP.replace(/\D/g, "").slice(0, 6);

      const txtName = `LE${ruc}${periodoClean}00140400021112.txt`;
      const zipName = `LE${ruc}${periodoClean}00140400021112.zip`;

      const txtLines: string[] = [];
      for (let i = 1; i < rawAoa.length; i++) {
        const row = [...(rawAoa[i] as unknown[])];
        const corr = Number(row[colNro]);
        const plat = platformByCodigo.get(corr);
        const isVoided = plat?.status === "voided";

        // Formato de fecha DD/MM/YYYY
        if (plat?.fecha) {
          const [y, m, d] = plat.fecha.split("-");
          if (y && m && d) row[colFecha] = `${d}/${m}/${y}`;
        } else if (row[colFecha] != null) {
          const ymd = parseFechaToYmd(row[colFecha]);
          if (ymd) {
            const [y, m, d] = ymd.split("-");
            if (y && m && d) row[colFecha] = `${d}/${m}/${y}`;
          }
        }

        // Tipo CP a 2 dígitos (03, 01, 07)
        if (row[colTipoCp] !== undefined && row[colTipoCp] !== "") {
          row[colTipoCp] = String(row[colTipoCp]).trim().padStart(2, "0");
        }

        // Tipo Operación a 4 dígitos (0101)
        if (row[colTipoOp] !== undefined && row[colTipoOp] !== "") {
          row[colTipoOp] = String(row[colTipoOp]).trim().padStart(4, "0");
        }

        // Si está anulada en plataforma, ajustar montos a 0 y estado a 2
        if (isVoided) {
          if (colBi >= 0) row[colBi] = "0.00";
          if (colIgv >= 0) row[colIgv] = "0.00";
          if (colTotal >= 0) row[colTotal] = "0.00";
          if (colEstado >= 0) row[colEstado] = "2";
        }

        while (row.length < 40) row.push("");
        const line = row.slice(0, 40).map((c) => String(c ?? "").trim()).join("|") + "|";
        txtLines.push(line);
      }

      const zip = new JSZip();
      zip.file(txtName, txtLines.join("\r\n") + "\r\n");
      const zipBuffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}"`,
        },
      });
    }

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
      return new NextResponse(xlsx as unknown as BodyInit, {
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
