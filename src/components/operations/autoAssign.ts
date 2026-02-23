import { COURT_FIELDS, type Reservation, isReservationActive } from "@/lib/types";

/**
 * Auto-asigna campos visualmente a reservas que no tienen campo asignado.
 * Retorna un Map<reservationId, fieldNumber> con las asignaciones sugeridas.
 * No modifica las reservas originales ni persiste nada en el backend.
 *
 * Lógica: para cada reserva sin campo, asigna el primer campo disponible
 * de su tipo de cancha, verificando que esté libre en TODOS los time_slots
 * de la reserva (para evitar conflictos en reservas multi-horario).
 */
export function computeAutoAssignments(
  reservations: Reservation[]
): Map<string, number> {
  const assignments = new Map<string, number>();

  // Track "slot:field" ocupados por reservas ya asignadas
  const occupied = new Set<string>();

  for (const r of reservations) {
    if (r.field != null && isReservationActive(r)) {
      for (const slot of r.time_slots ?? []) {
        occupied.add(`${slot}:${r.field}`);
      }
    }
  }

  // Procesar reservas sin campo (orden determinista por created_at)
  const unassigned = reservations
    .filter((r) => r.field == null && isReservationActive(r))
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  for (const r of unassigned) {
    const possibleFields = COURT_FIELDS[r.court_type] ?? [];
    const slots = r.time_slots ?? [];

    for (const field of possibleFields) {
      const isFree = slots.every((slot) => !occupied.has(`${slot}:${field}`));
      if (isFree) {
        assignments.set(r.id, field);
        for (const slot of slots) {
          occupied.add(`${slot}:${field}`);
        }
        break;
      }
    }
  }

  return assignments;
}
