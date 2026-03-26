import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
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

    // Regla negocio: al anular, eliminar el pago vinculado solo si no tiene imagen de comprobante.
    // (efectivo o digital sin evidencia subida)
    let removedTransfer = false;
    const transferId =
      typeof inv.transfer_id === "string" ? inv.transfer_id.trim() : "";
    if (transferId) {
      try {
        const transferRef = db.collection("transfers").doc(transferId);
        const transferSnap = await transferRef.get();
        if (transferSnap.exists) {
          const transferData = transferSnap.data() || {};
          const mediaUrl = String(transferData.media_url || "").trim();
          if (!mediaUrl) {
            const amountToRefund = Number(transferData.amount || 0);
            const reservationId =
              transferData.reservation_id != null && String(transferData.reservation_id).trim()
                ? String(transferData.reservation_id).trim()
                : null;

            await transferRef.delete();
            removedTransfer = true;

            if (reservationId && amountToRefund > 0) {
              const resRef = db.collection("reservations").doc(reservationId);
              await db.runTransaction(async (t) => {
                const resDoc = await t.get(resRef);
                if (!resDoc.exists) return;
                const resData = resDoc.data() || {};
                const currentAmountPaid = Number(resData.amount_paid || 0);
                const newAmountPaid = Math.max(0, currentAmountPaid - amountToRefund);
                const patch: Record<string, unknown> = { amount_paid: newAmountPaid };
                if (resData.status === "pending" && newAmountPaid > 0) {
                  patch.status = "confirmed";
                }
                if (newAmountPaid === 0) {
                  patch.confirmed = resData.status === "confirmed";
                  if (resData.status !== "confirmed") {
                    patch.confirmed_at = FieldValue.delete();
                  }
                }
                t.update(resRef, patch);
              });
            }
          }
        }
      } catch (cleanupError) {
        console.warn("void invoice: no se pudo limpiar pago vinculado", cleanupError);
      }
    }

    return NextResponse.json({
      success: true,
      message: typeof data.message === "string" ? data.message : undefined,
      sunat_estado: estado,
      removed_transfer: removedTransfer,
    });
  } catch (e) {
    console.error("void invoice:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al anular comprobante" },
      { status: 500 }
    );
  }
}
