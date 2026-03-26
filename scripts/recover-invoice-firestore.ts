/**
 * Paso 2 — Recuperar boleta emitida en SUNAT pero ausente en Firestore.
 *
 * Caso activo en DEFAULTS: B001-57052 (Noelia Coico). Ajusta DEFAULTS o usa RECOVER_*.
 * Histórico: B001-57135 (Humberto) — recuperado antes; vuelve a definir env si repites.
 *
 * Por defecto SOLO SIMULA: muestra el documento que se escribiría y sale.
 * Para escribir de verdad:
 *   RECOVER_INVOICE_APPLY=1 npx tsx scripts/recover-invoice-firestore.ts
 *
 * Requiere las mismas credenciales Firebase Admin que el resto de scripts.
 *
 * Opcional (.env): sobreescribir cualquier valor con prefijo RECOVER_
 *   RECOVER_SERIE_CORRELATIVO  RECOVER_USER_ID  RECOVER_AMOUNT  etc.
 *   RECOVER_TIME_SLOTS         → JSON, ej. ["21:00","22:00"]
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { getDb } from "../src/lib/firebase-admin";
import { receptorNombreSnapshot } from "../src/features/boletas/utils/sanitizeReceptorNombre";

const APPLY =
  process.env.RECOVER_INVOICE_APPLY === "1" || process.env.RECOVER_INVOICE_APPLY === "true";

/** PDF cliente + /api/v3/status apisunat (URLs rotan por tenant/sesión). */
const DEFAULTS = {
  serie_correlativo: "B001-57052",
  serie: "B001",
  correlativo: 57052,
  sunat_hash: "ZKtNCuGyJKjEL2kVKfn1Y+h5D9f02NYYmogwWTpOARA=",
  sunat_estado: "ACEPTADO",
  sunat_pdf_ticket:
    "https://app.apisunat.pe/pdf/ticket/204337/Z88RcHwkFe/20511046255-03-B001-57052",
  sunat_xml: "https://app.apisunat.pe/xml/204337/Z88RcHwkFe/20511046255-03-B001-57052",
  sunat_cdr: "https://app.apisunat.pe/xml/204337/Z88RcHwkFe/R-20511046255-03-B001-57052",
  amount: 100,
  cliente_denominacion: "NOELIA COICO",
  /** SUNAT DNI */
  cliente_tipo_documento: "1",
  cliente_numero_de_documento: "10143173",
  descripcion:
    "Alquiler cancha 6 vs 6 - 24/03/2026 9pm-10.50pm CANCELADO CAMPO",
  condicion_venta: "Contado",
  fecha_emision_ymd: "2026-03-23",
  hora_emision_hms: "18:55:00",
  user_id: "51977786246",
  phone_number: "51977786246",
  reservation_id: "manual",
  /** Formato 6 vs 6; número de campo no aclarado en el concepto. */
  court_type: "voley_6v6",
  field: null as number | null,
  date: "2026-03-24",
  time_slots: ["21:00", "22:00"] as string[],
};

function envOr<T extends string | number>(key: string, fallback: T): T {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  if (typeof fallback === "number") {
    const n = Number(v);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  return v as T;
}

/** Campo numérico o null (RECOVER_FIELD vacío → null). */
function envOrField(key: string, fallback: number | null): number | null {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function timeSlotsFromEnv(fallback: string[]): string[] {
  const raw = process.env.RECOVER_TIME_SLOTS?.trim();
  if (!raw) return fallback;
  try {
    const p = JSON.parse(raw) as unknown;
    if (Array.isArray(p) && p.every((x) => typeof x === "string")) return p;
  } catch {
    /* ignore */
  }
  return fallback;
}

async function main() {
  console.log("\n=== recover-invoice-firestore ===\n");
  console.log(`Modo: ${APPLY ? "APLICAR (escribe en Firestore)" : "SIMULACIÓN (solo muestra)"}\n`);

  const serieCorrelativo = envOr("RECOVER_SERIE_CORRELATIVO", DEFAULTS.serie_correlativo);
  const serie = envOr("RECOVER_SERIE", DEFAULTS.serie);
  const correlativo = envOr("RECOVER_CORRELATIVO", DEFAULTS.correlativo);

  const db = getDb();

  const dup = await db
    .collection("invoices")
    .where("serie_correlativo", "==", serieCorrelativo)
    .limit(5)
    .get();

  if (!dup.empty) {
    console.error("Ya existe al menos un invoice con este serie_correlativo:");
    dup.docs.forEach((d) => console.error(`  - id=${d.id}`, d.data()));
    console.error("\nNo se crea duplicado. Abortar.");
    process.exit(1);
  }

  const clienteName = envOr("RECOVER_CLIENTE_DENOMINACION", DEFAULTS.cliente_denominacion);
  const repSnap = receptorNombreSnapshot(clienteName);

  const invoiceData: Record<string, unknown> = {
    reservation_id: envOr("RECOVER_RESERVATION_ID", DEFAULTS.reservation_id),
    user_id: envOr("RECOVER_USER_ID", DEFAULTS.user_id),
    phone_number: envOr("RECOVER_PHONE_NUMBER", DEFAULTS.phone_number),
    cliente_denominacion: clienteName,
    cliente_numero_de_documento: envOr(
      "RECOVER_CLIENTE_NUM_DOC",
      DEFAULTS.cliente_numero_de_documento
    ),
    cliente_tipo_documento: envOr("RECOVER_CLIENTE_TIPO_DOC", DEFAULTS.cliente_tipo_documento),
    representative_name_snapshot: repSnap,
    /** Plantilla formal: se regenera desde estos campos (canRenderFormalPlantillaFromDoc). */
    file_url: "",
    file_url_sunat: "",
    file_url_xml: "",
    condicion_venta: envOr("RECOVER_CONDICION_VENTA", DEFAULTS.condicion_venta),
    amount: envOr("RECOVER_AMOUNT", DEFAULTS.amount),
    descripcion: envOr("RECOVER_DESCRIPCION", DEFAULTS.descripcion),
    court_type: envOr("RECOVER_COURT_TYPE", DEFAULTS.court_type),
    field: envOrField("RECOVER_FIELD", DEFAULTS.field),
    date: envOr("RECOVER_DATE", DEFAULTS.date),
    time_slots: timeSlotsFromEnv(DEFAULTS.time_slots),
    transfer_id: null,
    serie,
    tipo_comprobante: "boleta",
    correlativo,
    serie_correlativo: serieCorrelativo,
    sunat_hash: envOr("RECOVER_SUNAT_HASH", DEFAULTS.sunat_hash),
    sunat_estado: envOr("RECOVER_SUNAT_ESTADO", DEFAULTS.sunat_estado),
    sunat_xml: envOr("RECOVER_SUNAT_XML_URL", DEFAULTS.sunat_xml),
    sunat_cdr: envOr("RECOVER_SUNAT_CDR_URL", DEFAULTS.sunat_cdr),
    sunat_pdf_ticket: envOr("RECOVER_SUNAT_PDF_TICKET", DEFAULTS.sunat_pdf_ticket),
    status: "emitted",
    created_at: new Date().toISOString(),
    fecha_emision_ymd: envOr("RECOVER_FECHA_EMISION_YMD", DEFAULTS.fecha_emision_ymd),
    hora_emision_hms: envOr("RECOVER_HORA_EMISION_HMS", DEFAULTS.hora_emision_hms),
    /** Auditoría: recuperación manual; no lo usa el panel pero ayuda en soporte. */
    recovery_source: "script_recover-invoice-firestore",
    recovery_note: "SUNAT OK; Firestore faltante. PDF + status apisunat.",
  };

  console.log("Documento a crear en `invoices`:\n");
  console.log(JSON.stringify(invoiceData, null, 2));
  console.log("");

  if (!APPLY) {
    console.log(
      "Simulación terminada. Si todo cuadra, ejecuta:\n  RECOVER_INVOICE_APPLY=1 npx tsx scripts/recover-invoice-firestore.ts\n"
    );
    return;
  }

  const ref = await db.collection("invoices").add(invoiceData);
  console.log(`✓ Creado invoice id: ${ref.id}`);
  console.log(
    "\nComprueba en el panel (Boletas) y prueba vista previa / Enviar WSP con cuidado.\n"
  );
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
