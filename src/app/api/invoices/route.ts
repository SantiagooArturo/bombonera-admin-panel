import { NextRequest, NextResponse } from "next/server";
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";
import { getCourtLabelForReservation } from "@/lib/court-config-server";
import {
  BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES,
  SUNAT_BOLETA_SIN_DNI_CLIENTE_NUM_PLACEHOLDER,
} from "@/features/boletas/constants/sunat";
import {
  normalizeCondicionVentaInput,
  normalizeFormaPagoDepositoFields,
} from "@/features/boletas/constants/condicionVenta";
import { buildFormalComprobanteInput } from "@/features/boletas/pdf/buildFormalComprobanteInput";
import { generateSunatQrDataUrl } from "@/features/boletas/pdf/generateSunatQrDataUrl";
import { getEmisorSunatFromEnv } from "@/features/boletas/pdf/emisorSunatEnv";
import { fechaYmdToDdMmYyyy, formatEmision12hPe } from "@/features/boletas/utils/fechaEmisionMostrada12h";
import { validateEmissionDateTimeForApi } from "@/features/boletas/utils/limaEmissionDatetime";
import { receptorNombreSnapshot } from "@/features/boletas/utils/sanitizeReceptorNombre";
import { buildSunatCpeQrPayload } from "@/features/boletas/utils/sunatQrPayload";
import { isValidPeruPhone, normalizePeruPhone } from "@/features/operaciones/utils";

// ── Configuración apisunat.pe (Lucode) ──
// Docs: https://docs.apisunat.pe/integracion/facturacion-electronica/configuracion-api
// Sandbox:    https://sandbox.apisunat.pe/api/v3/documents
// Producción: https://app.apisunat.pe/api/v3/documents
const APISUNAT_SERIE_BOLETA = process.env.APISUNAT_SERIE_BOLETA || "B001";
const APISUNAT_SERIE_FACTURA = process.env.APISUNAT_SERIE_FACTURA || "F001";

// Máximo de reintentos si apisunat reporta correlativo duplicado.
// Esto auto-sincroniza el contador local si alguien emitió desde el panel de apisunat
// o si el contador quedó desincronizado por cualquier razón.
const MAX_EMISSION_RETRIES = 5;

const APISUNAT_FETCH_TIMEOUT_MS = 45_000;

const MISC_PANEL_USER_ID = "misc_panel";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Incrementa atómicamente el correlativo para una serie dada.
 * Colección: config, documento: invoice_counter_{serie}
 * Se crea automáticamente si no existe (empieza en 0 → devuelve 1).
 */
async function getNextCorrelativo(
  db: FirebaseFirestore.Firestore,
  serie: string
): Promise<number> {
  const counterRef = db.collection("config").doc(`invoice_counter_${serie}`);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data()?.last_correlativo || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { last_correlativo: next }, { merge: true });
    return next;
  });
}

/** Formato 12h para la descripción (ej: 10am, 6pm). */
function formatHour12(hourStr: string): string {
  const parts = hourStr.split(":");
  const h = parseInt(parts[0] || "0");
  const m = parseInt(parts[1] || "0");
  if (h === 0) return m === 0 ? "12 am" : `12:${String(m).padStart(2, "0")} am`;
  if (h < 12) return m === 0 ? `${h} am` : `${h}:${String(m).padStart(2, "0")} am`;
  if (h === 12) return m === 0 ? "12 pm" : `12:${String(m).padStart(2, "0")} pm`;
  if (h === 23 && m === 0) return "10:50 pm";
  return m === 0 ? `${h - 12} pm` : `${h - 12}:${String(m).padStart(2, "0")} pm`;
}

/**
 * Detecta si el error de apisunat es por documento duplicado.
 * Mensaje típico: "ERROR: Documento B001-1 fue emitido anteriormente"
 */
function isDuplicateError(message?: string): boolean {
  return !!message?.toLowerCase().includes("fue emitido anteriormente");
}

/** Estado del CPE en respuesta apisunat: ACEPTADO | PENDIENTE | RECHAZADO. */
function normalizeSunatEstadoFromPayload(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t.toUpperCase() : null;
}

/** Lee el siguiente correlativo sin consumirlo (solo lectura). */
async function peekNextCorrelativo(
  db: FirebaseFirestore.Firestore,
  serie: string
): Promise<number> {
  const counterRef = db.collection("config").doc(`invoice_counter_${serie}`);
  const doc = await counterRef.get();
  const current = doc.exists ? (doc.data()?.last_correlativo || 0) : 0;
  return current + 1;
}

// ── GET: Listar boletas por reserva | Obtener siguiente correlativo ───────────

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const nextCorrelativoParam = request.nextUrl.searchParams.get("next_correlativo");
    const tipo = request.nextUrl.searchParams.get("tipo");

    if (nextCorrelativoParam === "1" && tipo) {
      const tipoComprobante = tipo === "factura" ? "factura" : "boleta";
      const serie = tipoComprobante === "factura" ? APISUNAT_SERIE_FACTURA : APISUNAT_SERIE_BOLETA;
      const next = await peekNextCorrelativo(db, serie);
      return NextResponse.json({ serie, next_correlativo: next });
    }

    const userIdInParam = request.nextUrl.searchParams.get("user_id_in");
    const reservationId = request.nextUrl.searchParams.get("reservation_id");
    const transferIdsParam = request.nextUrl.searchParams.get("transfer_ids");
    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");
    const listAllParam = request.nextUrl.searchParams.get("list") === "all";

    let query: FirebaseFirestore.Query = db.collection("invoices");
    /** Listado completo del panel /boletas (orden por emisión). */
    if (listAllParam) {
      query = query.orderBy("created_at", "desc");
    } else if (fromParam && toParam) {
      const fromStart = new Date(`${fromParam.trim()}T00:00:00-05:00`);
      const toEnd = new Date(`${toParam.trim()}T23:59:59.999-05:00`);
      if (!Number.isNaN(fromStart.getTime()) && !Number.isNaN(toEnd.getTime()) && fromStart <= toEnd) {
        const fromIso = fromStart.toISOString();
        const toIso = toEnd.toISOString();
        query = query
          .where("created_at", ">=", fromIso)
          .where("created_at", "<=", toIso)
          .orderBy("created_at", "desc");
      }
    } else if (userIdInParam) {
      const ids = Array.from(
        new Set(
          userIdInParam
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        )
      ).slice(0, 30);
      if (ids.length === 0) {
        return NextResponse.json([]);
      }
      if (ids.length === 1) {
        query = query.where("user_id", "==", ids[0]);
      } else {
        query = query.where("user_id", "in", ids);
      }
    } else if (reservationId) {
      query = query.where("reservation_id", "==", reservationId);
    } else if (transferIdsParam) {
      const ids = transferIdsParam.split(",").filter(Boolean).slice(0, 30);
      if (ids.length > 0) {
        query = query.where("transfer_id", "in", ids);
      }
    }

    const snapshot = await query.get();
    const invoices = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      created_at:
        doc.data().created_at?.toDate?.()?.toISOString() ??
        doc.data().created_at ??
        null,
    }));
    return NextResponse.json(invoices);
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return NextResponse.json(
      { error: "Error al obtener boletas" },
      { status: 500 }
    );
  }
}

// ── POST: Emitir boleta/factura ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const APISUNAT_URL_VAL = process.env.APISUNAT_URL;
  const APISUNAT_TOKEN_VAL = process.env.APISUNAT_TOKEN;
  if (!APISUNAT_URL_VAL || !APISUNAT_TOKEN_VAL) {
    return NextResponse.json(
      {
        error:
          "Configuración incompleta: faltan APISUNAT_URL o APISUNAT_TOKEN en variables de entorno",
      },
      { status: 500 }
    );
  }

  try {
    const db = getDb();
    const bucket = getStorageBucket();
    const body = await request.json();
    const {
      reservation_id,
      user_id,
      phone_number,
      amount,
      court_type,
      field,
      date,
      time_slots,
      representative_name,
      transfer_id,
      tipo_comprobante,
      doc_num,
      cliente_denominacion: clienteOverride,
      descripcion: descripcionOverride,
      manual: manualEmission,
      misc_emission: miscEmissionRaw,
      fecha_de_emision: fechaEmisionClient,
      hora_de_emision: horaEmisionClient,
      condicion_venta: condicionVentaRaw,
      panel_link_user_id: panelLinkUserIdRaw,
      panel_link_phone: panelLinkPhoneRaw,
      cliente_direccion: clienteDireccionRaw,
      forma_pago_banco: formaPagoBancoRaw,
      forma_pago_cuenta: formaPagoCuentaRaw,
    } = body;

    const condicionVenta = normalizeCondicionVentaInput(condicionVentaRaw);
    const { banco: formaPagoBancoPersist, cuenta: formaPagoCuentaPersist } = normalizeFormaPagoDepositoFields(
      condicionVenta,
      formaPagoBancoRaw,
      formaPagoCuentaRaw
    );
    const clienteDireccionCliente =
      typeof clienteDireccionRaw === "string" ? clienteDireccionRaw.trim() : "";

    const miscEmission = miscEmissionRaw === true;
    const isManual = manualEmission === true;

    if (miscEmission && !isManual) {
      return NextResponse.json(
        { error: "Emisión miscelánea requiere manual: true" },
        { status: 400 }
      );
    }

    let effectiveUserId = user_id;
    let effectivePhone = phone_number;
    if (miscEmission) {
      effectiveUserId = MISC_PANEL_USER_ID;
      effectivePhone = "";
      const linkUid =
        typeof panelLinkUserIdRaw === "string" ? panelLinkUserIdRaw.trim() : "";
      const linkPhoneNorm = normalizePeruPhone(
        String(panelLinkPhoneRaw ?? "").replace(/\D/g, "")
      );
      if (linkUid && isValidPeruPhone(linkPhoneNorm)) {
        const uSnap = await db.collection("users").doc(linkUid).get();
        if (uSnap.exists) {
          const ud = uSnap.data() || {};
          const profilePhone = normalizePeruPhone(
            String(ud.phone_number || ud.chat_id || uSnap.id || "").replace(/\D/g, "")
          );
          if (profilePhone === linkPhoneNorm) {
            effectiveUserId = uSnap.id;
            effectivePhone = linkPhoneNorm;
          }
        }
      }
    }

    if (!isManual && (!reservation_id || !user_id)) {
      return NextResponse.json(
        { error: "Faltan reservation_id o user_id" },
        { status: 400 }
      );
    }
    if (isManual && !miscEmission && (!user_id || !phone_number)) {
      return NextResponse.json(
        { error: "En emisión manual faltan user_id o phone_number" },
        { status: 400 }
      );
    }

    // ── Validación de documento de identidad ──
    const tipoComprobante: "boleta" | "factura" =
      tipo_comprobante === "factura" ? "factura" : "boleta";

    const clienteDireccionSunat =
      tipoComprobante === "factura" ? clienteDireccionCliente || "LIMA" : "LIMA";

    const totalAmountEarly =
      typeof amount === "number" && amount > 0 ? amount : Number(amount) > 0 ? Number(amount) : 0;

    if (isManual && totalAmountEarly <= 0) {
      return NextResponse.json(
        { error: "En emisión manual el monto debe ser mayor a 0" },
        { status: 400 }
      );
    }

    let cleanDoc = String(doc_num || "").replace(/\D/g, "");
    /** Código catálogo SUNAT 06 enviado a apisunat. */
    let clienteTipoDocSunat: string;
    /** Boleta sin DNI informado (monto menor a S/700): placeholder solo en el POST a apisunat. */
    let boletaUsesPlaceholderDni = false;

    if (miscEmission) {
      const denom = typeof clienteOverride === "string" ? clienteOverride.trim() : "";
      if (denom.length < 3) {
        return NextResponse.json(
          { error: "Indique nombre o razón social del receptor (mín. 3 caracteres)." },
          { status: 400 }
        );
      }
      if (tipoComprobante === "factura") {
        if (cleanDoc.length !== 11) {
          return NextResponse.json({ error: "RUC inválido para factura (11 dígitos)." }, { status: 400 });
        }
        clienteTipoDocSunat = "6";
      } else {
        if (cleanDoc.length === 8) {
          clienteTipoDocSunat = "1";
        } else if (cleanDoc.length === 0) {
          if (totalAmountEarly >= BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES) {
            return NextResponse.json(
              {
                error: `Si el total es S/ ${BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES} o más debe indicar DNI (8 dígitos) o emitir factura con RUC.`,
              },
              { status: 400 }
            );
          }
          cleanDoc = SUNAT_BOLETA_SIN_DNI_CLIENTE_NUM_PLACEHOLDER;
          clienteTipoDocSunat = "1";
          boletaUsesPlaceholderDni = true;
        } else {
          return NextResponse.json(
            {
              error: `DNI: 8 dígitos, o vacío solo si el total es menor a S/ ${BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}.`,
            },
            { status: 400 }
          );
        }
      }
    } else {
      if (tipoComprobante === "factura") {
        if (cleanDoc.length !== 11) {
          return NextResponse.json({ error: "RUC inválido para factura" }, { status: 400 });
        }
        clienteTipoDocSunat = "6";
      } else {
        if (cleanDoc.length === 8) {
          clienteTipoDocSunat = "1";
        } else if (cleanDoc.length === 0) {
          if (totalAmountEarly >= BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES) {
            return NextResponse.json(
              {
                error: `Para boletas de S/ ${BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES} o más debe indicar DNI (8 dígitos) o emitir factura.`,
              },
              { status: 400 }
            );
          }
          cleanDoc = SUNAT_BOLETA_SIN_DNI_CLIENTE_NUM_PLACEHOLDER;
          clienteTipoDocSunat = "1";
          boletaUsesPlaceholderDni = true;
        } else {
          return NextResponse.json(
            {
              error: `DNI: 8 dígitos, o vacío solo si el total es menor a S/ ${BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}.`,
            },
            { status: 400 }
          );
        }
      }
    }

    if (transfer_id && !isManual) {
      const transferDoc = await db.collection("transfers").doc(transfer_id).get();
      const transferAmount = transferDoc.exists ? (transferDoc.data()?.amount ?? 0) : 0;
      const amountOverride = typeof amount === "number" && amount > 0;
      if (!amountOverride && transferAmount <= 0) {
        return NextResponse.json(
          { error: "No se puede emitir boleta para un ajuste con monto cero o negativo" },
          { status: 400 }
        );
      }
    }

    const serieSunat =
      tipoComprobante === "factura" ? APISUNAT_SERIE_FACTURA : APISUNAT_SERIE_BOLETA;

    // 1. Calcular valor unitario sin IGV (apisunat calcula IGV internamente)
    //    El monto recibido INCLUYE IGV → valor_unitario = monto / 1.18
    const totalAmount = totalAmountEarly;
    const valorUnitario = (totalAmount / 1.18).toFixed(6);

    // 2. Descripción del servicio (aparece en la boleta impresa)
    // Negocio: mostrar número de cancha (ej. 9), no el tipo (ej. 6 vs 6).
    const descripcion =
      typeof descripcionOverride === "string" && descripcionOverride.trim().length > 0
        ? descripcionOverride.trim()
        : isManual
        ? "Servicios diversos"
        : await (async () => {
            const fieldNum =
              typeof field === "number" && Number.isFinite(field)
                ? field
                : field != null && String(field).trim() !== ""
                  ? parseInt(String(field), 10)
                  : NaN;
            const courtPart =
              Number.isFinite(fieldNum) && fieldNum >= 1 && fieldNum <= 12
                ? String(fieldNum)
                : await getCourtLabelForReservation(
                    Number.isFinite(fieldNum) ? fieldNum : null,
                    typeof court_type === "string" ? court_type : undefined
                  );
            let d = `Alquiler cancha ${courtPart}`;
            if (date) {
              const dateObj = new Date(date + "T12:00:00");
              d += ` - ${dateObj.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
            }
            if (time_slots?.length > 0) {
              const startH = time_slots[0];
              const lastH = parseInt(time_slots[time_slots.length - 1].split(":")[0]) + 1;
              d += ` ${formatHour12(startH)}-${formatHour12(`${lastH}:00`)}`;
            }
            return d;
          })();

    // 3. Fecha y hora de emisión (Lima); el panel puede enviar fecha_de_emision / hora_de_emision
    const emissionParsed = validateEmissionDateTimeForApi(
      typeof fechaEmisionClient === "string" ? fechaEmisionClient : undefined,
      typeof horaEmisionClient === "string" ? horaEmisionClient : undefined
    );
    if ("error" in emissionParsed) {
      return NextResponse.json({ error: emissionParsed.error }, { status: 400 });
    }
    const { fechaEmision, horaEmision } = emissionParsed;

    // 4. Nombre del cliente
    const clienteName =
      typeof clienteOverride === "string" && clienteOverride.trim().length >= 3
        ? clienteOverride.trim().toUpperCase()
        : (() => {
            const rawName = String(representative_name || "").trim();
            return rawName.length >= 3 ? rawName.toUpperCase() : "CLIENTE GENERAL";
          })();

    // 5. Request body base para apisunat.pe (Lucode) — sin "numero", se asigna en el loop
    //    Docs: https://docs.apisunat.pe/integracion/facturacion-electronica/boleta/boleta-simple
    //    - "documento": "boleta" | "factura"
    //    - "valor_unitario": precio SIN IGV (la API calcula el IGV)
    //    - "total": monto final CON IGV
    //    - "codigo_tipo_afectacion_igv": "10" = Gravado - Operación Onerosa
    //    - "unidad_de_medida": "ZZ" = Servicio
    //    - No requiere empresa_Ruc en el body (va asociado al token)
    const apisunatBaseBody = {
      documento: tipoComprobante,
      serie: serieSunat,
      fecha_de_emision: fechaEmision,
      hora_de_emision: horaEmision,
      moneda: "PEN",
      tipo_operacion: "0101",
      cliente_tipo_de_documento: clienteTipoDocSunat,
      cliente_numero_de_documento: cleanDoc,
      cliente_denominacion: clienteName,
      cliente_direccion: clienteDireccionSunat,
      items: [
        {
          unidad_de_medida: "ZZ",
          descripcion,
          cantidad: "1",
          valor_unitario: valorUnitario,
          porcentaje_igv: "18",
          codigo_tipo_afectacion_igv: "10",
          nombre_tributo: "IGV",
        },
      ],
      total: String(totalAmount),
    };

    // 6. Emitir comprobante con auto-recuperación ante correlativos duplicados.
    //    Si apisunat responde "fue emitido anteriormente", incrementamos el contador
    //    y reintentamos. Esto auto-sincroniza el contador local con apisunat
    //    (ej: si alguien emitió manualmente desde el panel, o por la prueba inicial).
    //    Respuesta exitosa: { success, message, payload: { estado, hash, xml, cdr, pdf: { ticket } } }
    //    Estados posibles: ACEPTADO | PENDIENTE (cdr: null) | RECHAZADO
    let correlativo = 0;
    let emitData: Record<string, unknown> | null = null;
    let emitStatus = 0;

    for (let attempt = 0; attempt < MAX_EMISSION_RETRIES; attempt++) {
      correlativo = await getNextCorrelativo(db, serieSunat);
      const intentoLabel = `${serieSunat}-${correlativo}`;

      try {
      const emitRes = await fetch(APISUNAT_URL_VAL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          Authorization: `Bearer ${APISUNAT_TOKEN_VAL}`,
      },
        body: JSON.stringify({ ...apisunatBaseBody, numero: correlativo }),
        signal: AbortSignal.timeout(APISUNAT_FETCH_TIMEOUT_MS),
    });

      emitStatus = emitRes.status;
      emitData = (await emitRes.json()) as Record<string, unknown>;
      } catch (fetchErr) {
        console.warn(
          `[invoice] fetch/parse error para ${serieSunat}-${correlativo} (intento ${attempt + 1}/${MAX_EMISSION_RETRIES}), reintentando...`,
          fetchErr
        );
        emitData = null;
        continue;
      }

      if (emitData.success) {
        console.log(`[invoice] SUNAT OK ${intentoLabel} (intento ${attempt + 1})`);
        break;
      }

      // Si NO es error de duplicado, es un error real → no reintentar
      if (!isDuplicateError(emitData.message as string)) {
        console.error(`[invoice] SUNAT rechazó ${intentoLabel}:`, emitData);
      return NextResponse.json(
          { error: `Error de SUNAT: ${(emitData.message as string) || "Error desconocido"}` },
          { status: emitStatus === 401 ? 401 : 400 }
        );
      }

      // Duplicado: el counter ya se incrementó, el siguiente loop obtendrá el próximo número
      console.warn(
        `[invoice] ${intentoLabel} duplicado en apisunat (intento ${attempt + 1}/${MAX_EMISSION_RETRIES}), reintentando...`
      );
    }

    // Si agotamos los reintentos sin éxito
    if (!emitData?.success) {
      console.error(`[invoice] apisunat: se agotaron reintentos (${MAX_EMISSION_RETRIES})`, emitData);
      return NextResponse.json(
        { error: `Error de SUNAT: no se pudo asignar un correlativo válido tras ${MAX_EMISSION_RETRIES} intentos` },
        { status: 400 }
      );
    }

    const payload = (emitData.payload || {}) as Record<string, unknown>;
    const pdfPayload = (payload.pdf || {}) as Record<string, string>;
    const sunatEstadoNorm = normalizeSunatEstadoFromPayload(payload.estado);

    const serieCorrelativo = `${serieSunat}-${correlativo}`;
    const persistClienteNum =
      tipoComprobante === "boleta" && boletaUsesPlaceholderDni ? "" : cleanDoc;
    const persistClienteTipoDoc =
      tipoComprobante === "boleta" && boletaUsesPlaceholderDni ? "0" : clienteTipoDocSunat;

    const pdfTicketUrl: string | null = pdfPayload.ticket || null;

    // 7a. Firestore inmediato tras SUNAT OK (evita CPE huérfano si falla Storage/PDF después).
    const repSnapRaw = String(representative_name || "").trim() || clienteName;
    const repSnap = receptorNombreSnapshot(repSnapRaw);
    const invoiceDataPhase1: Record<string, unknown> = {
      reservation_id: isManual ? "manual" : reservation_id,
      user_id: effectiveUserId,
      phone_number: effectivePhone || "",
      cliente_denominacion: clienteName,
      cliente_numero_de_documento: persistClienteNum,
      cliente_tipo_documento: persistClienteTipoDoc,
      representative_name_snapshot: repSnap,
      file_url: "",
      file_url_sunat: "",
      file_url_xml: "",
      condicion_venta: condicionVenta,
      ...(formaPagoBancoPersist ? { forma_pago_banco: formaPagoBancoPersist } : {}),
      ...(formaPagoCuentaPersist ? { forma_pago_cuenta: formaPagoCuentaPersist } : {}),
      amount: totalAmount,
      descripcion,
      court_type: court_type || "",
      field: field ?? null,
      date: date || "",
      time_slots: Array.isArray(time_slots) ? time_slots : [],
      transfer_id: transfer_id || null,
      serie: serieSunat,
      tipo_comprobante: tipoComprobante,
      correlativo,
      serie_correlativo: serieCorrelativo,
      sunat_hash: (payload.hash as string) || null,
      sunat_estado: sunatEstadoNorm,
      sunat_xml: (payload.xml as string) || null,
      sunat_cdr: (payload.cdr as string) || null,
      sunat_pdf_ticket: pdfTicketUrl,
      status: "emitted",
      created_at: new Date().toISOString(),
      fecha_emision_ymd: fechaEmision,
      hora_emision_hms: horaEmision,
    };
    if (tipoComprobante === "factura") {
      invoiceDataPhase1.cliente_direccion = clienteDireccionSunat;
    }
    let docRef!: FirebaseFirestore.DocumentReference;
    for (let firestoreAttempt = 0; firestoreAttempt < 3; firestoreAttempt++) {
      try {
        docRef = await db.collection("invoices").add(invoiceDataPhase1);
        console.log(`[invoice] Firestore OK ${serieCorrelativo} (doc ${docRef.id})`);
        break;
      } catch (fsErr) {
        if (firestoreAttempt === 2) {
          console.error(`[invoice] Firestore FAIL definitivo para ${serieCorrelativo} tras 3 intentos:`, fsErr);
          throw fsErr;
        }
        console.warn(
          `[invoice] Firestore add falló (intento ${firestoreAttempt + 1}/3) para ${serieCorrelativo}, reintentando...`,
          fsErr
        );
        await new Promise((r) => setTimeout(r, 600 * (firestoreAttempt + 1)));
      }
    }

    // 7b. PDFs: plantilla del panel (formal + QR) y ticket oficial apisunat, cada uno en Storage.
    const pathFormal = `invoices/${serieCorrelativo}-formal.pdf`;
    const pathSunat = `invoices/${serieCorrelativo}-sunat.pdf`;
    const pathXml = `invoices/${serieCorrelativo}.xml`;
    const tokenFormal = randomUUID();
    const tokenSunat = randomUUID();
    const tokenXml = randomUUID();
    const bucketName = bucket.name;

    const firebaseMediaUrl = (path: string, token: string): string => {
      const encodedPath = encodeURIComponent(path);
      return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
    };

    let sunatBuffer: Buffer | null = null;
    if (pdfTicketUrl) {
      try {
        const pdfRes = await fetch(pdfTicketUrl, {
          headers: { Authorization: `Bearer ${APISUNAT_TOKEN_VAL}` },
        });
        if (pdfRes.ok) {
          sunatBuffer = Buffer.from(await pdfRes.arrayBuffer());
        } else {
          console.warn("No se pudo descargar PDF ticket apisunat:", pdfRes.status);
        }
      } catch (pdfErr) {
        console.warn("Error descargando PDF de apisunat:", pdfErr);
      }
    }

    const hashStr = String(payload.hash || "").trim();
    const emisorCfg = getEmisorSunatFromEnv();
    const opGravadaQr = Math.round((totalAmount / 1.18) * 100) / 100;
    const igvQr = Math.round((totalAmount - opGravadaQr) * 100) / 100;
    let qrDataUrl: string | null = null;
    if (hashStr) {
      try {
        const qrPayload = buildSunatCpeQrPayload({
          rucEmisor: emisorCfg.ruc,
          tipoComprobante: tipoComprobante,
          serie: serieSunat,
          numeroCorrelativo: correlativo,
          totalIgv: igvQr,
          importeTotal: totalAmount,
          fechaEmisionDdMmYyyy: fechaYmdToDdMmYyyy(fechaEmision),
          tipoDocClienteSunat: clienteTipoDocSunat,
          numeroDocCliente: cleanDoc,
          digestValueBase64: hashStr,
        });
        qrDataUrl = await generateSunatQrDataUrl(qrPayload);
      } catch (qrErr) {
        console.warn("QR CPE (PDF formal): no generado", qrErr);
      }
    }

    const fechaEmisionMostrada = formatEmision12hPe(fechaEmision, horaEmision);

    let fileUrlFormal: string | null = null;
    try {
      const formalInput = buildFormalComprobanteInput({
        tipo: tipoComprobante,
        emisor: emisorCfg,
        serieCorrelativo,
        fechaEmisionYmd: fechaEmision,
        fechaEmisionMostrada,
        condicionVenta,
        formaPagoBanco: formaPagoBancoPersist || undefined,
        formaPagoCuenta: formaPagoCuentaPersist || undefined,
        qrImageDataUrl: qrDataUrl,
        receptorNombre: clienteName,
        clienteTipoDocumento: persistClienteTipoDoc,
        clienteNumeroDocumento: persistClienteNum || undefined,
        descripcion,
        totalConIgv: totalAmount,
        clienteDireccion: tipoComprobante === "factura" ? clienteDireccionSunat : undefined,
      });
      const { renderFormalComprobanteBuffer } = await import(
        "@/features/boletas/pdf/renderFormalComprobanteBuffer"
      );
      const formalBuffer = await renderFormalComprobanteBuffer(formalInput);
      await bucket.file(pathFormal).save(formalBuffer, {
        metadata: {
          contentType: "application/pdf",
          metadata: { firebaseStorageDownloadTokens: tokenFormal },
        },
      });
      fileUrlFormal = firebaseMediaUrl(pathFormal, tokenFormal);
    } catch (formalErr) {
      console.warn("PDF formal (plantilla panel): no generado", formalErr);
    }

    let fileUrlSunatStored: string | null = null;
    if (sunatBuffer) {
      try {
        await bucket.file(pathSunat).save(sunatBuffer, {
          metadata: {
            contentType: "application/pdf",
            metadata: { firebaseStorageDownloadTokens: tokenSunat },
          },
        });
        fileUrlSunatStored = firebaseMediaUrl(pathSunat, tokenSunat);
      } catch (sunatSaveErr) {
        console.warn("No se pudo guardar PDF apisunat en Storage", sunatSaveErr);
      }
    }

    const fileUrl =
      fileUrlFormal ||
      fileUrlSunatStored ||
      pdfTicketUrl ||
      "";
    const fileUrlSunat = fileUrlSunatStored || "";

    let fileUrlXmlStored: string | null = null;
    const xmlStr = typeof payload.xml === "string" ? payload.xml.trim() : "";
    if (xmlStr.length > 0) {
      try {
        await bucket.file(pathXml).save(Buffer.from(xmlStr, "utf8"), {
          metadata: {
            contentType: "application/xml",
            metadata: { firebaseStorageDownloadTokens: tokenXml },
          },
        });
        fileUrlXmlStored = firebaseMediaUrl(pathXml, tokenXml);
      } catch (xmlErr) {
        console.warn("No se pudo guardar XML SUNAT en Storage", xmlErr);
      }
    }

    // 8. Completar URLs de archivos en el documento ya creado (plantilla / apisunat / XML en Storage).
    try {
      await docRef.update({
        file_url: fileUrl || "",
        file_url_sunat: fileUrlSunat,
        file_url_xml: fileUrlXmlStored || "",
      });
    } catch (updateErr) {
      console.error(
        "Emisión SUNAT OK y doc Firestore creado, pero falló update de file_url:",
        docRef.id,
        updateErr
      );
    }

    if (miscEmission && effectiveUserId !== MISC_PANEL_USER_ID) {
      const userPatch: Record<string, unknown> = {
        last_interaction_at: new Date().toISOString(),
      };
      if (tipoComprobante === "boleta") {
        const d = String(persistClienteNum || "").replace(/\D/g, "");
        if (d.length === 8) userPatch.last_dni = d;
      }
      if (tipoComprobante === "factura") {
        const r = String(persistClienteNum || "").replace(/\D/g, "");
        if (r.length === 11) {
          userPatch.last_ruc = r;
          userPatch.last_factura_razon_social = clienteName.slice(0, 400);
          userPatch.last_factura_direccion = clienteDireccionSunat.slice(0, 500);
        }
      }
      if (Object.keys(userPatch).length > 0) {
        try {
          await db.collection("users").doc(effectiveUserId).set(userPatch, { merge: true });
        } catch (userSyncErr) {
          console.warn("Emisión OK pero no se actualizó perfil de usuario vinculado:", userSyncErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      invoice_id: docRef.id,
      file_url: fileUrl,
      file_url_sunat: fileUrlSunat,
      file_url_xml: fileUrlXmlStored || "",
      serie_correlativo: serieCorrelativo,
      sunat_estado: sunatEstadoNorm,
      cliente_denominacion: clienteName,
      cliente_numero_de_documento: persistClienteNum,
      cliente_tipo_documento: persistClienteTipoDoc,
      representative_name_snapshot: repSnap,
      descripcion,
      phone_number: effectivePhone || "",
      amount: totalAmount,
      tipo_comprobante: tipoComprobante,
      condicion_venta: condicionVenta,
      forma_pago_banco: formaPagoBancoPersist || undefined,
      forma_pago_cuenta: formaPagoCuentaPersist || undefined,
      cliente_direccion: tipoComprobante === "factura" ? clienteDireccionSunat : undefined,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : String(error);
    console.error("[invoice] Error interno en POST:", error);
    return NextResponse.json(
      { error: `Error al crear boleta: ${msg}` },
      { status: 500 }
    );
  }
}

// ── PATCH: Vincular comprobante ya emitido a un pago manual (p. ej. emitir primero, registrar cobro después) ──

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id.trim() : "";
    const transferId = typeof body.transfer_id === "string" ? body.transfer_id.trim() : "";
    if (!invoiceId || !transferId) {
      return NextResponse.json({ error: "Se requiere invoice_id y transfer_id" }, { status: 400 });
    }

    const invRef = db.collection("invoices").doc(invoiceId);
    const trRef = db.collection("transfers").doc(transferId);
    const [invSnap, trSnap] = await Promise.all([invRef.get(), trRef.get()]);

    if (!invSnap.exists) {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
    }
    if (!trSnap.exists) {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    }

    const inv = invSnap.data() || {};
    const tr = trSnap.data() || {};
    const existing = inv.transfer_id;
    if (existing != null && String(existing).trim() !== "") {
      if (String(existing) === transferId) {
        return NextResponse.json({ success: true, idempotent: true });
      }
      return NextResponse.json({ error: "El comprobante ya tiene otro pago vinculado" }, { status: 409 });
    }

    const resId = String(inv.reservation_id || "");
    const trResId = tr.reservation_id != null && tr.reservation_id !== "" ? String(tr.reservation_id) : "";
    if (resId && resId !== "manual" && trResId && trResId !== resId) {
      return NextResponse.json(
        { error: "La reserva del comprobante no coincide con la del pago" },
        { status: 400 }
      );
    }

    await invRef.update({ transfer_id: transferId });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH invoice:", error);
    return NextResponse.json({ error: "Error al vincular comprobante" }, { status: 500 });
  }
}

// ── DELETE: Desvincular boleta adjuntada manualmente ─────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Se requiere id" }, { status: 400 });
    }

    const ref = db.collection("invoices").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Boleta no encontrada" }, { status: 404 });
    }

    const data = doc.data() || {};
    const status = String(data.status || "");
    const source = String(data.source || "");
    const isAttached = status === "attached" || source === "manual";
    if (!isAttached) {
      return NextResponse.json(
        { error: "Solo se pueden desvincular boletas adjuntadas manualmente" },
        { status: 400 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting invoice:", error);
    return NextResponse.json({ error: "Error al desvincular boleta" }, { status: 500 });
  }
}
