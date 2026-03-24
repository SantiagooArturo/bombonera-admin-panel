import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { parseSerieCorrelativoSunat } from "@/features/boletas/utils/parseSerieCorrelativoSunat";
import { apisunatApiBaseFromDocumentsUrl } from "@/features/boletas/utils/apisunatBaseUrl";

const DEFAULT_MOTIVO = "ANULACIÓN DE OPERACIÓN";

type ApisunatVoidResponse = {
  success?: boolean;
  message?: string;
  payload?: { estado?: string; hash?: string; xml?: string; cdr?: string | null };
};

/**
 * Anula comprobante ante SUNAT vía apisunat.pe:
 * - Boleta: POST .../api/v3/daily-summary (resumen diario)
 * - Factura: POST .../api/v3/voided (comunicación de baja)
 *
 * Docs: https://docs.apisunat.pe/integracion/facturacion-electronica/anular-comprobante/
 */
export async function POST(request: NextRequest) {
  try {
    const APISUNAT_URL_VAL = process.env.APISUNAT_URL;
    const APISUNAT_TOKEN_VAL = process.env.APISUNAT_TOKEN;
    if (!APISUNAT_URL_VAL || !APISUNAT_TOKEN_VAL) {
      return NextResponse.json(
        { error: "Falta APISUNAT_URL o APISUNAT_TOKEN en el servidor" },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      invoice_id?: string;
      motivo?: string;
    };
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
    if (!invoiceId) {
      return NextResponse.json({ error: "Se requiere invoice_id" }, { status: 400 });
    }

    const motivo =
      typeof body.motivo === "string" && body.motivo.trim().length >= 3
        ? body.motivo.trim()
        : DEFAULT_MOTIVO;

    const db = getDb();
    const ref = db.collection("invoices").doc(invoiceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
    }

    const inv = snap.data() || {};
    const status = String(inv.status || "");
    const serieCorrelativo =
      typeof inv.serie_correlativo === "string" ? inv.serie_correlativo.trim() : "";
    const emittedLike =
      status === "emitted" || (status === "" && serieCorrelativo.length > 0);
    if (status === "voided") {
      return NextResponse.json({ error: "Este comprobante ya consta como anulado" }, { status: 400 });
    }
    if (!emittedLike) {
      return NextResponse.json(
        {
          error:
            "Solo se pueden anular comprobantes emitidos por SUNAT desde el panel (no adjuntos manuales).",
        },
        { status: 400 }
      );
    }
    const parsed = parseSerieCorrelativoSunat(serieCorrelativo || undefined);
    if (!parsed) {
      return NextResponse.json(
        { error: "Falta serie y correlativo SUNAT (serie_correlativo) en este comprobante." },
        { status: 400 }
      );
    }

    const tipoComprobante: "boleta" | "factura" =
      inv.tipo_comprobante === "factura" ? "factura" : "boleta";

    const base = apisunatApiBaseFromDocumentsUrl(APISUNAT_URL_VAL);
    const auth = { Authorization: `Bearer ${APISUNAT_TOKEN_VAL}`, "Content-Type": "application/json" };

    let emitRes: Response;
    if (tipoComprobante === "factura") {
      emitRes = await fetch(`${base}/voided`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          documento: "comunicacion_baja",
          motivo,
          documento_afectado: {
            documento: "factura",
            serie: parsed.serie,
            numero: parsed.numero,
          },
        }),
      });
    } else {
      emitRes = await fetch(`${base}/daily-summary`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          documento: "resumen_diario",
          documentos_afectados: [
            {
              accion_resumen: "anular",
              documento: "boleta",
              serie: parsed.serie,
              numero: parsed.numero,
            },
          ],
        }),
      });
    }

    const data = (await emitRes.json().catch(() => ({}))) as ApisunatVoidResponse;

    if (!emitRes.ok) {
      const msg =
        typeof data.message === "string" && data.message.trim()
          ? data.message.trim()
          : `Error al contactar SUNAT (${emitRes.status})`;
      return NextResponse.json({ error: msg }, { status: emitRes.status >= 400 ? emitRes.status : 502 });
    }

    if (!data.success) {
      const msg =
        typeof data.message === "string" && data.message.trim()
          ? data.message.trim()
          : "SUNAT rechazó la anulación";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const estado = typeof data.payload?.estado === "string" ? data.payload.estado : null;

    await ref.update({
      status: "voided",
      voided_at: new Date().toISOString(),
      void_motivo: motivo,
      sunat_estado: estado,
    });

    return NextResponse.json({
      success: true,
      message: typeof data.message === "string" ? data.message : undefined,
      sunat_estado: estado,
    });
  } catch (e) {
    console.error("void invoice:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al anular comprobante" },
      { status: 500 }
    );
  }
}
