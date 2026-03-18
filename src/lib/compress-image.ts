/**
 * Comprime una imagen en el cliente para evitar superar el límite de 4.5MB de Vercel.
 * Redimensiona manteniendo proporción (el lado más largo a max 1920px).
 */
const MAX_DIMENSION = 1920;
const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB para dejar margen al límite de Vercel
const JPEG_QUALITY = 0.85;

export async function compressImageForUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_SIZE_BYTES && file.type === "image/jpeg") {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      const maxSide = Math.max(width, height);
      if (maxSide > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / maxSide;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo crear contexto de canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      const tryQuality = (quality: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Error al comprimir imagen"));
              return;
            }
            if (blob.size > MAX_SIZE_BYTES && quality > 0.5) {
              tryQuality(quality - 0.1);
            } else {
              resolve(blob);
            }
          },
          "image/jpeg",
          quality
        );
      };

      tryQuality(JPEG_QUALITY);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen"));
    };

    img.src = url;
  });
}
