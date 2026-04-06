/** Tamaño de cancha: 5 vs 5, 6 vs 6, u otro (especificar en court_size_other). */
export type CourtSize = "5 vs 5" | "6 vs 6" | "otro";

/** ID del documento en Firestore (court_config) para la cancha N. */
export function courtConfigDocId(courtNumber: number): string {
  return `court_${courtNumber}`;
}

/**
 * Configuración por campo (1-12).
 * Precios: día de semana, fin de semana, feriado × día/noche.
 */
export interface CourtFieldConfig {
  field: number;
  image_url?: string;
  /** Tamaño de cancha: 5 vs 5, 6 vs 6, u otro */
  court_size: CourtSize;
  /** Si court_size es "otro", texto libre (ej. "7 vs 7", "Fútbol") */
  court_size_other?: string;
  /** Precio por hora día (antes de 18:00) - día de semana */
  price_day_weekday: number;
  /** Precio por hora día - fin de semana */
  price_day_weekend: number;
  /** Precio por hora día - feriado */
  price_day_holiday: number;
  /** Precio por hora noche (18:00+) - día de semana */
  price_night_weekday: number;
  /** Precio por hora noche - fin de semana */
  price_night_weekend: number;
  /** Precio por hora noche - feriado */
  price_night_holiday: number;
  /** Descripción libre: tipo de cancha, si es por bloques, etc. */
  description: string;
  /** Si se reserva por bloques (ej. 2h mínimo) */
  block_booking: boolean;
}

export const DEFAULT_FIELD_CONFIG: Omit<CourtFieldConfig, "field"> = {
  image_url: "",
  court_size: "6 vs 6",
  court_size_other: "",
  price_day_weekday: 70,
  price_day_weekend: 80,
  price_day_holiday: 80,
  price_night_weekday: 100,
  price_night_weekend: 100,
  price_night_holiday: 100,
  description: "",
  block_booking: false,
};

/** Campo 9 tiene precios y tamaño distintos por defecto (legacy) */
export const FIELD_9_DEFAULTS: Partial<CourtFieldConfig> = {
  court_size: "5 vs 5",
  price_day_weekday: 40,
  price_day_weekend: 40,
  price_day_holiday: 40,
  price_night_weekday: 60,
  price_night_weekend: 60,
  price_night_holiday: 60,
};

/**
 * Obtiene la configuración completa para un campo, mezclando data de Firestore con defaults.
 */
export function getFullFieldConfig(field: number, data?: any): CourtFieldConfig {
  const overrides = field === 9 ? FIELD_9_DEFAULTS : {};
  const base = {
    ...DEFAULT_FIELD_CONFIG,
    ...overrides,
    field,
  };

  const getNum = (val: any, fallback: number) => {
    if (typeof val === "number") return val;
    if (typeof val === "string" && val.trim() !== "") {
      const p = parseFloat(val);
      return isNaN(p) ? fallback : p;
    }
    return fallback;
  };

  return {
    field,
    image_url: data?.image_url ?? base.image_url,
    court_size: data?.court_size ?? base.court_size,
    court_size_other: data?.court_size_other ?? base.court_size_other,
    price_day_weekday: getNum(data?.price_day_weekday, base.price_day_weekday),
    price_day_weekend: getNum(data?.price_day_weekend, base.price_day_weekend),
    price_day_holiday: getNum(data?.price_day_holiday, base.price_day_holiday),
    price_night_weekday: getNum(data?.price_night_weekday, base.price_night_weekday),
    price_night_weekend: getNum(data?.price_night_weekend, base.price_night_weekend),
    price_night_holiday: getNum(data?.price_night_holiday, base.price_night_holiday),
    description: data?.description ?? base.description,
    block_booking: data?.block_booking ?? base.block_booking,
  };
}

/** Obtiene la etiqueta de cabecera para un campo según su configuración. */
export function getCourtSizeLabel(cfg: CourtFieldConfig): string {
  if (cfg.court_size === "otro" && cfg.court_size_other?.trim()) {
    return cfg.court_size_other.trim();
  }
  return cfg.court_size;
}
