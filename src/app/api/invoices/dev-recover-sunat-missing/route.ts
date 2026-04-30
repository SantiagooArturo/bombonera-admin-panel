import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { getEmisorSunatFromEnv } from "@/features/boletas/pdf/emisorSunatEnv";
import {
  INVOICE_RECOVERY_DEV_MODE_HEADER,
  INVOICE_RECOVERY_DEV_MODE_VALUE,
} from "@/features/boletas/constants/devInvoiceRecovery";
import {
  scanMissingSunatInvoicesForFirestore,
  commitRecoveredInvoiceDocs,
} from "@/features/boletas/services/sunatFirestoreRecovery";

/** pdfjs-dist debe ejecutarse en Node (misma pila que `tsx` local). */
export const runtime = "nodejs";

const APISUNAT_SERIE_BOLETA = process.env.APISUNAT_SERIE_BOLETA || "B001";

/**
 * POST { apply?: boolean }
 * Busca boletas (serie B*) en apisunat/SUNAT que no están en Firestore (huecos + cola) y opcionalmente las crea.
 * Requiere cabecera {@link INVOICE_RECOVERY_DEV_MODE_HEADER} (la envía solo el panel visible con `devMode`).
 */
export async function POST(request: Request) {
  const devAck = request.headers.get(INVOICE_RECOVERY_DEV_MODE_HEADER);
  if (devAck !== INVOICE_RECOVERY_DEV_MODE_VALUE) {
    return NextResponse.json(
      {
        error:
          "Esta acción solo está disponible con modo dev en el panel (localStorage.devMode === \"true\").",
      },
      { status: 403 }
    );
  }

  const APISUNAT_URL = process.env.APISUNAT_URL?.trim();
  const APISUNAT_TOKEN = process.env.APISUNAT_TOKEN?.trim();
  if (!APISUNAT_URL || !APISUNAT_TOKEN) {
    return NextResponse.json(
      { error: "Falta APISUNAT_URL o APISUNAT_TOKEN en el servidor." },
      { status: 500 }
    );
  }

  let body: { apply?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const apply = body.apply === true || body.apply === "true" || body.apply === 1;

  const serie = APISUNAT_SERIE_BOLETA.trim().toUpperCase();
  if (!serie.startsWith("B")) {
    return NextResponse.json({ error: "Solo series de boleta (B*)" }, { status: 400 });
  }

  const emisor = getEmisorSunatFromEnv();
  const db = getDb();

  try {
    const scan = await scanMissingSunatInvoicesForFirestore(db, {
      serie,
      apisunatUrl: APISUNAT_URL,
      apisunatToken: APISUNAT_TOKEN,
      rucEmisor: emisor.ruc.replace(/\D/g, ""),
      recoverySourceForDocs: "api_dev_recover_sunat_missing",
    });

    if (scan.skippedNoFirestoreCluster) {
      return NextResponse.json({
        skippedNoFirestoreCluster: true,
        message:
          "No hay boletas en Firestore para esa serie; el escaneo de huecos no aplica. Emití al menos una boleta o usá el script con RECOVER_MIN/MAX.",
        serie: scan.serie,
      });
    }

    if (!apply) {
      return NextResponse.json({
        apply: false,
        serie: scan.serie,
        gapsScanned: scan.gapsScanned,
        recoverableCount: scan.toCreate.length,
        notInSunatCount: scan.notInSunat.length,
        notInSunatSample: scan.notInSunat.slice(0, 30),
        errors: scan.errors,
        previewRows: scan.previewRows,
      });
    }

    if (scan.toCreate.length === 0) {
      return NextResponse.json({
        apply: true,
        written: 0,
        skipped: 0,
        message: "Nada que escribir (lista vacía tras el escaneo).",
        errors: scan.errors,
      });
    }

    const { written, skipped } = await commitRecoveredInvoiceDocs(db, serie, scan.toCreate);

    return NextResponse.json({
      apply: true,
      written,
      skipped,
      serie,
      errors: scan.errors,
    });
  } catch (e) {
    console.error("dev-recover-sunat-missing:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al ejecutar recuperación" },
      { status: 500 }
    );
  }
}
