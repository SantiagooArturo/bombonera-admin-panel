import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * Descarga el PDF ticket oficial apisunat (URL externa con Bearer) o reexpone el de Storage.
 * Uso: enlaces “SUNAT” en comprobantes antiguos sin file_url_sunat.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id?.trim()) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }

  const APISUNAT_TOKEN_VAL = process.env.APISUNAT_TOKEN;
  try {
    const db = getDb();
    const snap = await db.collection("invoices").doc(id.trim()).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const row = snap.data() || {};
    const stored = typeof row.file_url_sunat === "string" ? row.file_url_sunat.trim() : "";
    const ticket = typeof row.sunat_pdf_ticket === "string" ? row.sunat_pdf_ticket.trim() : "";
    const url = stored || ticket;
    if (!url) {
      return NextResponse.json({ error: "Sin PDF SUNAT" }, { status: 404 });
    }

    const isFirebase = url.includes("firebasestorage.googleapis.com");
    const headers: HeadersInit = {};
    if (!isFirebase) {
      if (!APISUNAT_TOKEN_VAL) {
        return NextResponse.json({ error: "APISUNAT_TOKEN no configurado" }, { status: 500 });
      }
      headers.Authorization = `Bearer ${APISUNAT_TOKEN_VAL}`;
    }

    const r = await fetch(url, { headers });
    if (!r.ok) {
      return NextResponse.json({ error: "No se pudo descargar el PDF" }, { status: 502 });
    }
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="sunat-${id}.pdf"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("sunat-pdf:", e);
    return NextResponse.json({ error: "Error al obtener PDF" }, { status: 500 });
  }
}
