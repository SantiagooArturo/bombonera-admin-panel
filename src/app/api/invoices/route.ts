import { NextRequest, NextResponse } from "next/server";
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection("invoices").get();
    const invoices = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json(invoices);
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return NextResponse.json(
      { error: "Error al obtener boletas" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const bucket = getStorageBucket();
    const body = await request.json();
    const { reservation_id, user_id, phone_number, amount, court_type, date } = body;

    if (!reservation_id || !user_id) {
      return NextResponse.json(
        { error: "Faltan reservation_id o user_id" },
        { status: 400 }
      );
    }

    // Obtener URL del PDF de prueba en Storage
    const filePath = "invoices/test_invoice.pdf";
    const file = bucket.file(filePath);

    // Verificar que el archivo existe
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json(
        { error: "Archivo de boleta no encontrado en Storage" },
        { status: 404 }
      );
    }

    // Setear token de descarga si no tiene uno
    const [metadata] = await file.getMetadata();
    let downloadToken = metadata.metadata?.firebaseStorageDownloadTokens;
    if (!downloadToken) {
      downloadToken = randomUUID();
      await file.setMetadata({
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      });
    }

    // Construir URL de descarga de Firebase Storage
    const bucketName = bucket.name;
    const encodedPath = encodeURIComponent(filePath);
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    // Crear documento en la colección invoices
    const invoiceData = {
      reservation_id,
      user_id,
      phone_number: phone_number || "",
      file_url: fileUrl,
      amount: amount || 0,
      court_type: court_type || "",
      date: date || "",
      status: "emitted",
      created_at: new Date().toISOString(),
    };

    const docRef = await db.collection("invoices").add(invoiceData);

    return NextResponse.json({
      success: true,
      invoice_id: docRef.id,
      file_url: fileUrl,
    });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return NextResponse.json(
      { error: "Error al crear boleta" },
      { status: 500 }
    );
  }
}
