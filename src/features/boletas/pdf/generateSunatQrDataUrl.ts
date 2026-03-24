import QRCode from "qrcode";

/** PNG en data URL para @react-pdf/renderer <Image src={...} /> */
export async function generateSunatQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 200,
    type: "image/png",
  });
}
