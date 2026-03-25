/** Rangos típicos de pictogramas (sin usar \p{…} para compatibilidad TS). */
function isEmojiCodePoint(cp: number): boolean {
  if (cp === 0x200d || cp === 0xfe0f) return true;
  return (
    (cp >= 0x2600 && cp <= 0x26ff) ||
    (cp >= 0x2700 && cp <= 0x27bf) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x1f600 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff)
  );
}

/** Quita pictogramas / emojis para listas y etiquetas de cliente (WhatsApp). */
export function stripEmojis(raw: string): string {
  if (!raw) return "";
  let result = "";
  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i)!;
    if (!isEmojiCodePoint(cp)) {
      result += String.fromCodePoint(cp);
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return result.replace(/\s+/g, " ").trim();
}
