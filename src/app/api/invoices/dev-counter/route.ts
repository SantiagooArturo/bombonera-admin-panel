import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

const APISUNAT_SERIE_BOLETA = process.env.APISUNAT_SERIE_BOLETA || "B001";
const APISUNAT_SERIE_FACTURA = process.env.APISUNAT_SERIE_FACTURA || "F001";

/**
 * Permite mutar el contador solo en desarrollo o si se define ALLOW_DEV_INVOICE_COUNTER=1
 * (p. ej. preview en Vercel). No confiar solo en localStorage del cliente.
 */
function allowDevCounterWrite(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.ALLOW_DEV_INVOICE_COUNTER === "1"
  );
}

/**
 * POST { tipo: "boleta" | "factura", next_correlativo: number }
 * Ajusta `config/invoice_counter_{serie}` para que el próximo emitido sea `next_correlativo`.
 */
export async function POST(request: NextRequest) {
  if (!allowDevCounterWrite()) {
    return NextResponse.json(
      { error: "Contador de desarrollo deshabilitado en este entorno." },
      { status: 403 }
    );
  }

  let body: { tipo?: string; next_correlativo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tipo = body.tipo === "factura" ? "factura" : body.tipo === "boleta" ? "boleta" : null;
  if (!tipo) {
    return NextResponse.json({ error: 'tipo debe ser "boleta" o "factura"' }, { status: 400 });
  }

  const n = Number(body.next_correlativo);
  if (!Number.isInteger(n) || n < 1) {
    return NextResponse.json({ error: "next_correlativo debe ser un entero ≥ 1" }, { status: 400 });
  }

  const serie = tipo === "factura" ? APISUNAT_SERIE_FACTURA : APISUNAT_SERIE_BOLETA;
  const lastCorrelativo = n - 1;

  try {
    const db = getDb();
    await db.collection("config").doc(`invoice_counter_${serie}`).set(
      { last_correlativo: lastCorrelativo },
      { merge: true }
    );
    return NextResponse.json({
      success: true,
      serie,
      next_correlativo: n,
      last_correlativo_stored: lastCorrelativo,
    });
  } catch (e) {
    console.error("dev-counter POST:", e);
    return NextResponse.json({ error: "No se pudo actualizar Firestore" }, { status: 500 });
  }
}
