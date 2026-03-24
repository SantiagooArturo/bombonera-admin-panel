import { NextRequest, NextResponse } from "next/server";
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";
import { getCourtLabelForReservation } from "@/lib/court-config-server";
import { BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES } from "@/features/boletas/constants/sunat";
import { buildFormalComprobanteInput } from "@/features/boletas/pdf/buildFormalComprobanteInput";
import { getEmisorSunatFromEnv } from "@/features/boletas/pdf/emisorSunatEnv";
import { validateEmissionDateTimeForApi } from "@/features/boletas/utils/limaEmissionDatetime";
import { receptorNombreSnapshot } from "@/features/boletas/utils/sanitizeReceptorNombre";

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
  if (h === 0) return m === 0 ? "12am" : `12:${String(m).padStart(2, "0")}am`;
  if (h < 12) return m === 0 ? `${h}am` : `${h}:${String(m).padStart(2, "0")}am`;
  if (h === 12) return m === 0 ? "12pm" : `12:${String(m).padStart(2, "0")}pm`;
  return m === 0 ? `${h - 12}pm` : `${h - 12}:${String(m).padStart(2, "0")}pm`;
}

/**
 * Detecta si el error de apisunat es por documento duplicado.
 * Mensaje típico: "ERROR: Documento B001-1 fue emitido anteriormente"
 */
function isDuplicateError(message?: string): boolean {
  return !!message?.toLowerCase().includes("fue emitido anteriormente");
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
    } = body;

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
          if (totalAmountEarly > BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES) {
            return NextResponse.json(
              {
                error: `Si el total supera S/ ${BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES} debe indicar DNI (8 dígitos) o emitir factura con RUC.`,
              },
              { status: 400 }
            );
          }
          cleanDoc = "0";
          clienteTipoDocSunat = "0";
        } else {
          return NextResponse.json(
            {
              error: "DNI: 8 dígitos o déjelo vacío si el total no supera S/ 700 (norma SUNAT).",
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
          if (totalAmountEarly > BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES) {
            return NextResponse.json(
              {
                error: `Para boletas sobre S/ ${BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES} debe indicar DNI (8 dígitos) o emitir factura.`,
              },
              { status: 400 }
            );
          }
          cleanDoc = "0";
          clienteTipoDocSunat = "0";
        } else {
          return NextResponse.json(
            {
              error: "DNI: 8 dígitos o vacío si el total es como máximo S/ 700.",
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
    const descripcion =
      typeof descripcionOverride === "string" && descripcionOverride.trim().length > 0
        ? descripcionOverride.trim()
        : isManual
        ? "Servicios diversos"
        : (() => {
            const courtLabel = getCourtLabelForReservation(field, court_type);
            let d = `Alquiler cancha ${courtLabel}`;
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
      cliente_direccion: "LIMA",
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

      const emitRes = await fetch(APISUNAT_URL_VAL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${APISUNAT_TOKEN_VAL}`,
        },
        body: JSON.stringify({ ...apisunatBaseBody, numero: correlativo }),
      });

      emitStatus = emitRes.status;
      emitData = (await emitRes.json()) as Record<string, unknown>;

      if (emitData.success) break;

      // Si NO es error de duplicado, es un error real → no reintentar
      if (!isDuplicateError(emitData.message as string)) {
        console.error("apisunat emission error:", emitData);
        return NextResponse.json(
          { error: `Error de SUNAT: ${(emitData.message as string) || "Error desconocido"}` },
          { status: emitStatus === 401 ? 401 : 400 }
        );
      }

      // Duplicado: el counter ya se incrementó, el siguiente loop obtendrá el próximo número
      console.warn(
        `Correlativo ${serieSunat}-${correlativo} duplicado en apisunat (intento ${attempt + 1}/${MAX_EMISSION_RETRIES}), reintentando...`
      );
    }

    // Si agotamos los reintentos sin éxito
    if (!emitData?.success) {
      console.error("apisunat: se agotaron reintentos por duplicados", emitData);
      return NextResponse.json(
        { error: `Error de SUNAT: no se pudo asignar un correlativo válido tras ${MAX_EMISSION_RETRIES} intentos` },
        { status: 400 }
      );
    }

    const payload = (emitData.payload || {}) as Record<string, unknown>;
    const pdfPayload = (payload.pdf || {}) as Record<string, string>;

    const serieCorrelativo = `${serieSunat}-${correlativo}`;
    /** En panel no guardamos "0" cuando SUNAT va sin documento del cliente (boleta ≤ S/ 700). */
    const persistClienteNum =
      tipoComprobante === "boleta" && clienteTipoDocSunat === "0" ? "" : cleanDoc;

    // 7. PDF para descarga: plantilla formal tipo SUNAT (no es el XML firmado). Fallback: ticket apisunat.
    const pdfTicketUrl: string | null = pdfPayload.ticket || null;
    let fileUrl = pdfTicketUrl;
    const storagePath = `invoices/${serieCorrelativo}.pdf`;
    const storageFile = bucket.file(storagePath);
    const downloadToken = randomUUID();
    const bucketName = bucket.name;
    const encodedPath = encodeURIComponent(storagePath);
    const firebaseFileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    let formalPdfSaved = false;
    try {
      const formalInput = buildFormalComprobanteInput({
        tipo: tipoComprobante,
        emisor: getEmisorSunatFromEnv(),
        serieCorrelativo,
        fechaEmisionYmd: fechaEmision,
        horaEmision,
        receptorNombre: clienteName,
        clienteTipoDocumento: clienteTipoDocSunat,
        clienteNumeroDocumento: persistClienteNum || undefined,
        descripcion,
        totalConIgv: totalAmount,
      });
      const { renderFormalComprobanteBuffer } = await import(
        "@/features/boletas/pdf/renderFormalComprobanteBuffer"
      );
      const formalBuffer = await renderFormalComprobanteBuffer(formalInput);
      await storageFile.save(formalBuffer, {
        metadata: {
          contentType: "application/pdf",
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      fileUrl = firebaseFileUrl;
      formalPdfSaved = true;
    } catch (formalErr) {
      console.warn("PDF formal (plantilla panel): no generado, se intentará PDF apisunat", formalErr);
    }

    if (!formalPdfSaved && pdfTicketUrl) {
      try {
        const pdfRes = await fetch(pdfTicketUrl, {
          headers: { Authorization: `Bearer ${APISUNAT_TOKEN_VAL}` },
        });

        if (pdfRes.ok) {
          const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
          await storageFile.save(pdfBuffer, {
            metadata: {
              contentType: "application/pdf",
              metadata: { firebaseStorageDownloadTokens: downloadToken },
            },
          });
          fileUrl = firebaseFileUrl;
        } else {
          console.warn("No se pudo descargar PDF de apisunat, usando URL externa");
        }
      } catch (pdfErr) {
        console.warn("Error descargando PDF de apisunat:", pdfErr);
      }
    }

    // 8. Guardar metadata en Firestore (todo lo útil para reportes / panel)
    const repSnapRaw = String(representative_name || "").trim() || clienteName;
    const repSnap = receptorNombreSnapshot(repSnapRaw);
    const invoiceData = {
      reservation_id: isManual ? "manual" : reservation_id,
      user_id: effectiveUserId,
      phone_number: effectivePhone || "",
      cliente_denominacion: clienteName,
      cliente_numero_de_documento: persistClienteNum,
      cliente_tipo_documento: clienteTipoDocSunat,
      representative_name_snapshot: repSnap,
      file_url: fileUrl || "",
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
      sunat_estado: (payload.estado as string) || null,
      // URLs originales de apisunat por si necesitamos re-descargar
      sunat_xml: (payload.xml as string) || null,
      sunat_cdr: (payload.cdr as string) || null,
      sunat_pdf_ticket: pdfTicketUrl,
      status: "emitted",
      created_at: new Date().toISOString(),
    };

    const docRef = await db.collection("invoices").add(invoiceData);

    return NextResponse.json({
      success: true,
      invoice_id: docRef.id,
      file_url: fileUrl,
      serie_correlativo: serieCorrelativo,
      sunat_estado: payload.estado,
      cliente_denominacion: clienteName,
      cliente_numero_de_documento: persistClienteNum,
      cliente_tipo_documento: invoiceData.cliente_tipo_documento,
      representative_name_snapshot: repSnap,
      descripcion,
      phone_number: effectivePhone || "",
      amount: totalAmount,
      tipo_comprobante: tipoComprobante,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : String(error);
    console.error("Error creating invoice:", error);
    return NextResponse.json(
      { error: `Error al crear boleta: ${msg}` },
      { status: 500 }
    );
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
