/**
 * Feriados Perú - Calendario para cálculo de precios.
 *
 * Fuente: Calendario oficial Perú (ej. 2020):
 * - Año Nuevo: 1 enero
 * - Jueves Santo, Viernes Santo (variable por Pascua)
 * - Día del Trabajo: 1 mayo
 * - Batalla de Arica y Día de la Bandera: 7 junio
 * - San Pedro y San Pablo: 29 junio
 * - Día de la Fuerza Aérea: 23 julio
 * - Independencia: 28 julio
 * - Fiestas Patrias: 29 julio
 * - Batalla de Junín: 6 agosto
 * - Santa Rosa de Lima: 30 agosto
 * - Combate de Angamos: 8 octubre
 * - Día de Todos los Santos: 1 noviembre
 * - Inmaculada Concepción: 8 diciembre
 * - Batalla de Ayacucho: 9 diciembre
 * - Navidad: 25 diciembre
 */

/** Feriados de fecha fija: [mes (1-12), día] */
const FERIADOS_FIJOS: [number, number][] = [
  [1, 1],   // Año Nuevo
  [5, 1],   // Día del Trabajo
  [6, 7],   // Batalla de Arica y Día de la Bandera
  [6, 29],  // San Pedro y San Pablo
  [7, 23],  // Día de la Fuerza Aérea del Perú
  [7, 28],  // Independencia del Perú
  [7, 29],  // Celebración de Fiestas Patrias
  [8, 6],   // Batalla de Junín
  [8, 30],  // Santa Rosa de Lima
  [10, 8],  // Combate de Angamos
  [11, 1],  // Día de Todos los Santos
  [12, 8],  // Inmaculada Concepción
  [12, 9],  // Batalla de Ayacucho
  [12, 25], // Navidad
];

/** Calcula el domingo de Pascua (algoritmo de Meeus). */
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Jueves Santo = 3 días antes de Pascua. Viernes Santo = 2 días antes. */
function getSemanaSanta(year: number): { jueves: Date; viernes: Date } {
  const pascua = getEasterSunday(year);
  const jueves = new Date(pascua);
  jueves.setDate(pascua.getDate() - 3);
  const viernes = new Date(pascua);
  viernes.setDate(pascua.getDate() - 2);
  return { jueves, viernes };
}

/**
 * Indica si una fecha YYYY-MM-DD es feriado en Perú.
 */
export function isHoliday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return false;

  const date = new Date(y, m - 1, d);

  for (const [month, day] of FERIADOS_FIJOS) {
    if (date.getMonth() + 1 === month && date.getDate() === day) return true;
  }

  const { jueves, viernes } = getSemanaSanta(y);
  if (
    (date.getMonth() === jueves.getMonth() && date.getDate() === jueves.getDate()) ||
    (date.getMonth() === viernes.getMonth() && date.getDate() === viernes.getDate())
  ) {
    return true;
  }

  return false;
}
