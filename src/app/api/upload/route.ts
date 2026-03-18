import { NextRequest, NextResponse } from "next/server";
import { getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";
import { convertToWebP } from "@/lib/image-convert";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_TYPES_WITH_HEIC = [...IMAGE_TYPES, "image/heic", "image/heif"];

/**
 * POST /api/upload
 * Sube una imagen a Firebase Storage y devuelve la URL pública.
 * Body: FormData con campo "file" (imagen).
 * Si folder=court-images: acepta HEIC y convierte todo a WebP.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No se envió archivo" }, { status: 400 });
    }

    const folder = (formData.get("folder") as string) || "payments";
    const isCourtImages = folder === "court-images";
    const allowedTypes = isCourtImages ? IMAGE_TYPES_WITH_HEIC : IMAGE_TYPES;

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error: isCourtImages
            ? "Formato no permitido. Solo JPEG, PNG, WebP o HEIC."
            : "Formato no permitido. Solo JPEG, PNG o WebP.",
        },
        { status: 400 }
      );
    }

    const bucket = getStorageBucket();
    let buffer = Buffer.from(await file.arrayBuffer());
    let ext: string;
    let contentType: string;

    if (isCourtImages) {
      buffer = await convertToWebP(buffer, file.type);
      ext = "webp";
      contentType = "image/webp";
    } else {
      ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
      contentType = file.type;
    }

    const storagePath = `${folder}/${randomUUID()}.${ext}`;
    const bucketFile = bucket.file(storagePath);

    await bucketFile.save(buffer, {
      metadata: {
        contentType,
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
