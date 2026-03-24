import { NextRequest, NextResponse } from "next/server";
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";
import {
  receptorNombreParaSunat,
  receptorNombreSnapshot,
} from "@/features/boletas/utils/sanitizeReceptorNombre";

async function uploadToStorage(bucket: ReturnType<typeof getStorageBucket>, buffer: Buffer, filename: string, contentType: string) {
  const file = bucket.file(filename);
  const token = randomUUID();
  await file.save(buffer, {
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
  });
  const encoded = encodeURIComponent(filename);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
}

/**
 * POST /api/invoices/attach
 * Adjunta una boleta PDF a una transferencia.
 * Recibe FormData: file (PDF), preview (PNG), y metadatos.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const preview = formData.get("preview") as File | null;
    const reservationId = formData.get("reservation_id") as string;
    const userId = formData.get("user_id") as string;
    const phoneNumber = formData.get("phone_number") as string || "";
    const amount = parseFloat(formData.get("amount") as string) || 0;
    const courtType = formData.get("court_type") as string || "";
    const date = formData.get("date") as string || "";
    const transferId = formData.get("transfer_id") as string || "";

    if (!file || !reservationId || !userId) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const db = getDb();

    let clienteDenominacion = "";
    let clienteNumero = "";
    let representativeSnapshot = "";
    let resField: number | null = null;
    try {
      const resDoc = await db.collection("reservations").doc(reservationId).get();
      if (resDoc.exists) {
        const rd = resDoc.data() || {};
        const rawRep = String(rd.representative_name || "").trim();
        if (rawRep) {
          representativeSnapshot = receptorNombreSnapshot(rawRep);
          clienteDenominacion =
            rawRep.length >= 3
              ? receptorNombreParaSunat(rawRep) || "CLIENTE GENERAL"
              : rawRep.toUpperCase();
        }
        const dni = String(rd.dni || "").replace(/\D/g, "");
        const okDni =
          (dni.length === 8 || dni.length === 11) && !/^0+$/.test(dni);
        if (okDni) {
          clienteNumero = dni;
        }
        if (typeof rd.field === "number") resField = rd.field;
      }
    } catch (e) {
      console.warn("attach invoice: no se pudo leer reserva para receptor", e);
    }

    if (transferId) {
      const transferDoc = await db.collection("transfers").doc(transferId).get();
      const transferAmount = transferDoc.exists ? (transferDoc.data()?.amount ?? 0) : 0;
      if (transferAmount <= 0) {
        return NextResponse.json(
          { error: "No se puede adjuntar boleta a un ajuste con monto cero o negativo" },
          { status: 400 }
        );
      }
    }
    const bucket = getStorageBucket();
    const ts = Date.now();

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const fileUrl = await uploadToStorage(
      bucket, pdfBuffer,
      `invoices/manual_${reservationId}_${ts}.pdf`,
      "application/pdf"
    );

    let previewUrl = "";
    if (preview) {
      const previewBuffer = Buffer.from(await preview.arrayBuffer());
      previewUrl = await uploadToStorage(
        bucket, previewBuffer,
        `invoices/manual_${reservationId}_${ts}_preview.png`,
        "image/png"
      );
    }

    const invoiceData = {
      reservation_id: reservationId,
      user_id: userId,
      phone_number: phoneNumber,
      cliente_denominacion: clienteDenominacion || "",
      cliente_numero_de_documento: clienteNumero || "",
      cliente_tipo_documento:
        clienteNumero.length === 11 ? "6" : clienteNumero.length === 8 ? "1" : "",
      representative_name_snapshot: representativeSnapshot || "",
      file_url: fileUrl,
      preview_url: previewUrl,
      amount,
      court_type: courtType,
      field: resField,
      date,
      descripcion: "Boleta PDF adjuntada manualmente al pago",
      transfer_id: transferId || null,
      status: "attached",
      source: "manual",
      tipo_comprobante: "boleta" as const,
      created_at: new Date().toISOString(),
    };

    const docRef = await db.collection("invoices").add(invoiceData);

    return NextResponse.json({
      success: true,
      invoice_id: docRef.id,
      file_url: fileUrl,
      preview_url: previewUrl,
    });
  } catch (error) {
    console.error("Error attaching invoice:", error);
    return NextResponse.json({ error: "Error al adjuntar boleta" }, { status: 500 });
  }
}
