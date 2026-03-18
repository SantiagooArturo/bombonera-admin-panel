/**
 * Convierte imágenes a WebP para almacenamiento consistente y liviano.
 * Soporta JPEG, PNG, WebP y HEIC.
 */
import sharp from "sharp";
import convert from "heic-convert";

const COURT_IMAGE_MAX_WIDTH = 1920;
const WEBP_QUALITY = 85;

const HEIC_TYPES = ["image/heic", "image/heif"];

export async function convertToWebP(
  buffer: Buffer,
  mimeType: string
): Promise<Buffer> {
  let inputBuffer = buffer;

  if (HEIC_TYPES.includes(mimeType)) {
    const jpegResult = await convert({
      buffer,
      format: "JPEG",
      quality: 1,
    });
    inputBuffer = Buffer.from(new Uint8Array(jpegResult));
  }

  const result = await sharp(inputBuffer)
    .resize(COURT_IMAGE_MAX_WIDTH, undefined, { withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return Buffer.from(result);
}
