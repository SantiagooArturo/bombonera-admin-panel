/** SUNAT / apisunat: ACEPTADO | PENDIENTE | RECHAZADO (mayúsculas en API). */
export function isSunatEstadoRechazado(estado: string | null | undefined): boolean {
  return String(estado ?? "").trim().toUpperCase() === "RECHAZADO";
}
