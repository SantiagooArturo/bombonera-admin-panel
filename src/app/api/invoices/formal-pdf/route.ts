import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { canRenderFormalPlantillaFromDoc } from "@/features/boletas/pdf/formalPlantillaEligibility";
import { renderFormalPlantillaPdfFromInvoiceDoc } from "@/features/boletas/pdf/formalPlantillaFromInvoiceDoc";

/**
 * Genera el PDF “plantilla” del panel en tiempo real desde Firestore.
 * Requiere datos de emisión SUNAT (serie/correlativo, monto, etc.); no aplica a comprobantes solo adjuntos.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id?.trim()) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("invoices").doc(id.trim()).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const data = snap.data() as Record<string, unknown>;
    if (!canRenderFormalPlantillaFromDoc(data)) {
      return NextResponse.json(
        { error: "Este comprobante no admite plantilla regenerada (p. ej. PDF adjunto manual)." },
        { status: 400 }
      );
    }

    const buf = await renderFormalPlantillaPdfFromInvoiceDoc(data);
    if (!buf) {
      return NextResponse.json({ error: "No se pudo generar el PDF" }, { status: 500 });
    }

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="plantilla-${id.trim()}.pdf"`,
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (e) {
    console.error("formal-pdf:", e);
    return NextResponse.json({ error: "Error al generar PDF" }, { status: 500 });
  }
}
