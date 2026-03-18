import { NextRequest, NextResponse } from "next/server";
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";

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
      file_url: fileUrl,
      preview_url: previewUrl,
      amount,
      court_type: courtType,
      date,
      transfer_id: transferId || null,
      status: "attached",
      source: "manual",
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
