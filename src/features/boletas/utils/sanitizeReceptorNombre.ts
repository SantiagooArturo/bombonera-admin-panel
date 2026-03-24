/**
 * Limpia nombres de receptor/reserva para panel y reportes:
 * quita la palabra vóley (variantes) y todos los dígitos, colapsa espacios.
 * No usar sobre un RUC/DNI; solo sobre nombre / razón social tipo reserva.
 */
export function sanitizeReceptorNombre(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/\bvoley\b/gi, "");
  s = s.replace(/\bvóley\b/gi, "");
  s = s.replace(/\bvolley\b/gi, "");
  s = s.replace(/\d+/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Sanea para mostrar o guardar; si el saneo deja vacío pero había texto, devuelve el original recortado.
 */
export function sanitizeReceptorNombreSafe(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const out = sanitizeReceptorNombre(t);
  return out.length > 0 ? out : t;
}

/**
 * Nombre en MAYÚSCULAS para SUNAT / `cliente_denominacion` (mín. 3 caracteres en entrada).
 * Si tras quitar voley/números no queda nombre razonable → "CLIENTE GENERAL".
 */
export function receptorNombreParaSunat(raw: string): string {
  const t = raw.trim();
  if (t.length < 3) return "";
  const n = sanitizeReceptorNombre(t);
  if (n.length >= 1) return n.toUpperCase();
  return "CLIENTE GENERAL";
}

/** Snapshot legible (sin forzar mayúsculas) para `representative_name_snapshot`. */
export function receptorNombreSnapshot(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const n = sanitizeReceptorNombre(t);
  return n.length > 0 ? n : t;
}
