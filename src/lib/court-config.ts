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

/** Obtiene la etiqueta de cabecera para un campo según su configuración. */
export function getCourtSizeLabel(cfg: CourtFieldConfig): string {
  if (cfg.court_size === "otro" && cfg.court_size_other?.trim()) {
    return cfg.court_size_other.trim();
  }
  return cfg.court_size;
}
