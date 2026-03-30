/**
 * IGV incl. Boleta sin DNI solo si el total es estrictamente menor a este monto.
 * Desde S/ 700 inclusive el DNI es obligatorio (alineado con validación del API).
 */
export const BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES = 700;

/**
 * Si no hay DNI del cliente y el monto es menor a {@link BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES},
 * apisunat exige número; se envía este DNI (tipo catálogo 1) solo en el POST a SUNAT.
 * En Firestore el panel sigue guardando documento vacío y tipo 0.
 */
export const SUNAT_BOLETA_SIN_DNI_CLIENTE_NUM_PLACEHOLDER = "00000000";
