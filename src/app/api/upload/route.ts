import { NextRequest, NextResponse } from "next/server";
import { getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";

/**
 * POST /api/upload
 * Sube una imagen a Firebase Storage y devuelve la URL pública.
 * Body: FormData con campo "file" (imagen).
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No se envió archivo" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Formato no permitido. Solo JPEG, PNG o WebP." },
        { status: 400 }
      );
    }

    const bucket = getStorageBucket();
    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const storagePath = `manual-payments/${randomUUID()}.${ext}`;
    const bucketFile = bucket.file(storagePath);

    const buffer = Buffer.from(await file.arrayBuffer());

    await bucketFile.save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: { firebaseStorageDownloadTokens: randomUUID() },
      },
    });

    const [metadata] = await bucketFile.getMetadata();
    const token = metadata.metadata?.firebaseStorageDownloadTokens as string;
    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 });
  }
}
