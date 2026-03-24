/**
 * Texto tipo SUNAT: "SEISCIENTOS NOVENTA Y CINCO Y 00/100 SOLES"
 * (entero en palabras + centavos + SOLES).
 */
export function montoEnLetrasSoles(total: number): string {
  const fixed = Math.round(total * 100) / 100;
  const entero = Math.floor(fixed);
  const cents = Math.round((fixed - entero) * 100);
  const words = enteroALetras(entero).toUpperCase();
  const cStr = String(cents).padStart(2, "0");
  return `${words} Y ${cStr}/100 SOLES`;
}

function enteroALetras(n: number): string {
  if (n < 0) return `menos ${enteroALetras(-n)}`;
  if (n === 0) return "cero";

  const unidades = [
    "",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
  ];
  const decenas = [
    "",
    "diez",
    "veinte",
    "treinta",
    "cuarenta",
    "cincuenta",
    "sesenta",
    "setenta",
    "ochenta",
    "noventa",
  ];
  const centenas = [
    "",
    "ciento",
    "doscientos",
    "trescientos",
    "cuatrocientos",
    "quinientos",
    "seiscientos",
    "setecientos",
    "ochocientos",
    "novecientos",
  ];

  function under100(num: number): string {
    if (num < 10) return unidades[num];
    if (num === 10) return "diez";
    if (num === 11) return "once";
    if (num === 12) return "doce";
    if (num === 13) return "trece";
    if (num === 14) return "catorce";
    if (num === 15) return "quince";
    if (num < 20) return `dieci${unidades[num - 10]}`;
    if (num === 20) return "veinte";
    if (num < 30) return `veinti${unidades[num - 20]}`;
    const d = Math.floor(num / 10);
    const u = num % 10;
    return u ? `${decenas[d]} y ${unidades[u]}` : decenas[d];
  }

  function under1000(num: number): string {
    if (num === 100) return "cien";
    if (num < 100) return under100(num);
    const c = Math.floor(num / 100);
    const rest = num % 100;
    const head = centenas[c];
    if (!rest) return head === "ciento" ? "cien" : head;
    if (head === "ciento") return `ciento ${under100(rest)}`;
    return `${head} ${under100(rest)}`;
  }

  let rest = n;
  const parts: string[] = [];

  if (rest >= 1_000_000) {
    const m = Math.floor(rest / 1_000_000);
    rest %= 1_000_000;
    parts.push(m === 1 ? "un millón" : `${under1000(m)} millones`);
  }
  if (rest >= 1000) {
    const t = Math.floor(rest / 1000);
    rest %= 1000;
    parts.push(t === 1 ? "mil" : `${under1000(t)} mil`);
  }
  if (rest > 0) {
    parts.push(under1000(rest));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
