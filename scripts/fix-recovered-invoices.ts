/**
 * Corrige boletas recuperadas por recover-missing-invoices.ts:
 *
 * 1. ANULADAS: cambia status "emitted" → "voided", agrega voided_at y void_motivo.
 * 2. created_at: reemplaza el timestamp de recuperación con una estimación
 *    basada en los created_at de boletas vecinas (por correlativo), para que
 *    el orden en la UI sea correcto.
 *
 * Por defecto SOLO SIMULA. Para aplicar:
 *   FIX_RECOVERED_APPLY=1 npx tsx scripts/fix-recovered-invoices.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { getDb } from "../src/lib/firebase-admin";

const APPLY =
  process.env.FIX_RECOVERED_APPLY === "1" ||
  process.env.FIX_RECOVERED_APPLY === "true";

const SERIE = process.env.FIX_SERIE?.trim() || "B001";

function limaMiddayIso(ymd: string): string {
  return `${ymd}T17:00:00.000Z`;
}

async function main() {
  console.log("\n=== fix-recovered-invoices ===\n");
  console.log(`Modo: ${APPLY ? "APLICAR" : "SIMULACIÓN"}\n`);

  const db = getDb();

  // 1. Leer TODAS las invoices de la serie para poder interpolar created_at
  const allSnap = await db.collection("invoices").where("serie", "==", SERIE).get();
  console.log(`Total invoices serie ${SERIE}: ${allSnap.size}`);

  type InvoiceRow = {
    docId: string;
    correlativo: number;
    createdAt: string;
    fechaEmisionYmd: string;
    isRecovered: boolean;
    status: string;
    sunatEstado: string;
    cliente: string;
    amount: number;
  };

  const all: InvoiceRow[] = [];
  for (const doc of allSnap.docs) {
    const d = doc.data();
    const corr = Number(d.correlativo || 0);
    if (corr <= 0) continue;
    all.push({
      docId: doc.id,
      correlativo: corr,
      createdAt: String(d.created_at || ""),
      fechaEmisionYmd: String(d.fecha_emision_ymd || ""),
      isRecovered: d.recovery_source === "script_recover-missing-invoices-batch",
      status: String(d.status || ""),
      sunatEstado: String(d.sunat_estado || "").toUpperCase(),
      cliente: String(d.cliente_denominacion || ""),
      amount: Number(d.amount || 0),
    });
  }

  all.sort((a, b) => a.correlativo - b.correlativo);

  const recovered = all.filter((r) => r.isRecovered);
  if (recovered.length === 0) {
    console.log("No se encontraron boletas recuperadas.");
    process.exit(0);
  }

  console.log(`Boletas recuperadas: ${recovered.length}\n`);

  // 2. Interpolar created_at usando vecinos no-recuperados
  //    Para cada boleta recuperada, buscar la boleta anterior y posterior (no-recuperada)
  //    e interpolar linealmente el timestamp.
  const corrToIdx = new Map<number, number>();
  all.forEach((r, i) => corrToIdx.set(r.correlativo, i));

  function findNeighborCreatedAt(
    idx: number,
    direction: -1 | 1
  ): { correlativo: number; createdAtMs: number } | null {
    let i = idx + direction;
    while (i >= 0 && i < all.length) {
      const r = all[i]!;
      if (!r.isRecovered && r.createdAt) {
        const ms = new Date(r.createdAt).getTime();
        if (Number.isFinite(ms)) {
          return { correlativo: r.correlativo, createdAtMs: ms };
        }
      }
      i += direction;
    }
    return null;
  }

  type FixItem = {
    docId: string;
    correlativo: number;
    updates: Record<string, unknown>;
    reason: string[];
  };

  const fixes: FixItem[] = [];

  for (const rec of recovered) {
    const idx = corrToIdx.get(rec.correlativo)!;
    const updates: Record<string, unknown> = {};
    const reasons: string[] = [];

    // Fix A: status ANULADO
    if (rec.sunatEstado === "ANULADO" && rec.status !== "voided") {
      updates.status = "voided";
      updates.voided_at = new Date().toISOString();
      updates.void_motivo = "ANULACIÓN DE OPERACIÓN (recuperación batch)";
      reasons.push("status → voided");
    }

    // Fix B: created_at — interpolar entre vecinos
    const prev = findNeighborCreatedAt(idx, -1);
    const next = findNeighborCreatedAt(idx, 1);

    let estimatedCreatedAt: string;

    if (prev && next && prev.correlativo < next.correlativo) {
      const range = next.correlativo - prev.correlativo;
      const pos = rec.correlativo - prev.correlativo;
      const fraction = pos / range;
      const estimatedMs = prev.createdAtMs + fraction * (next.createdAtMs - prev.createdAtMs);
      estimatedCreatedAt = new Date(estimatedMs).toISOString();
    } else if (prev) {
      // Boleta después de la última conocida: sumar 1 minuto por cada correlativo de distancia
      const offsetMs = (rec.correlativo - prev.correlativo) * 60_000;
      estimatedCreatedAt = new Date(prev.createdAtMs + offsetMs).toISOString();
    } else if (next) {
      const offsetMs = (next.correlativo - rec.correlativo) * 60_000;
      estimatedCreatedAt = new Date(next.createdAtMs - offsetMs).toISOString();
    } else {
      estimatedCreatedAt = limaMiddayIso(rec.fechaEmisionYmd || "2026-03-23");
    }

    const currentMs = new Date(rec.createdAt).getTime();
    const estimatedMs = new Date(estimatedCreatedAt).getTime();
    const diffHours = Math.abs(currentMs - estimatedMs) / 3_600_000;

    if (diffHours > 1) {
      updates.created_at = estimatedCreatedAt;
      const oldDate = rec.createdAt.slice(0, 16);
      const newDate = estimatedCreatedAt.slice(0, 16);
      reasons.push(`created_at: ${oldDate} → ${newDate}`);
    }

    if (Object.keys(updates).length > 0) {
      fixes.push({ docId: rec.docId, correlativo: rec.correlativo, updates, reason: reasons });
    }
  }

  if (fixes.length === 0) {
    console.log("✅ No hay correcciones pendientes.");
    process.exit(0);
  }

  console.log(`── Correcciones necesarias: ${fixes.length} ──\n`);
  for (const f of fixes) {
    console.log(`  ${SERIE}-${f.correlativo}: ${f.reason.join(" | ")}`);
  }

  if (!APPLY) {
    console.log(
      `\nSimulación: se corregirían ${fixes.length} documentos.` +
        `\nPara aplicar: FIX_RECOVERED_APPLY=1 npx tsx scripts/fix-recovered-invoices.ts\n`
    );
    process.exit(0);
  }

  console.log(`\nAplicando ${fixes.length} correcciones...`);

  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < fixes.length; i += BATCH_SIZE) {
    const chunk = fixes.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const f of chunk) {
      batch.update(db.collection("invoices").doc(f.docId), f.updates);
      written++;
    }
    await batch.commit();
  }

  console.log(`\n✅ ${written} boletas corregidas en Firestore.\n`);
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
