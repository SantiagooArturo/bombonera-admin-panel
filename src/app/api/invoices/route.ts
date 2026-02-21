import { NextRequest, NextResponse } from "next/server";
import { getDb, getStorageBucket } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";

const FACTILIZA_BASE_URL = process.env.FACTILIZA_BASE_URL!;
const FACTILIZA_TOKEN = process.env.FACTILIZA_TOKEN!;
const FACTILIZA_RUC = process.env.FACTILIZA_RUC!;
const FACTILIZA_SERIE = process.env.FACTILIZA_SERIE || "B098";

const COURT_DESCRIPTIONS: Record<string, string> = {
  voley_6v6: "Alquiler cancha voley 6v6",
  voley_basket_6v6: "Alquiler cancha voley-basket 6v6",
  voley_5v5: "Alquiler cancha voley 5v5",
  voley_basket_5v5: "Alquiler cancha voley-basket 5v5",
};

export async function GET(request: NextRequest) {
  try {
    const reservationId = request.nextUrl.searchParams.get("reservation_id");
    const db = getDb();

    let query: FirebaseFirestore.Query = db.collection("invoices");
    if (reservationId) {
      query = query.where("reservation_id", "==", reservationId);
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

export async function POST(request: NextRequest) {
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
      date,
      time_slots,
      representative_name,
      transfer_id,
    } = body;

    if (!reservation_id || !user_id) {
      return NextResponse.json(
        { error: "Faltan reservation_id o user_id" },
        { status: 400 }
      );
    }

    // 1. Obtener siguiente correlativo (atómico con transacción)
    const counterRef = db.collection("config").doc("invoice_counter");
    const correlativo = await db.runTransaction(async (tx) => {
      const doc = await tx.get(counterRef);
      const current = doc.exists ? (doc.data()?.last_correlativo || 1) : 1;
      // Ya usamos B098-1 en la prueba, empezar desde 2
      const next = doc.exists ? current + 1 : 2;
      tx.set(counterRef, { last_correlativo: next }, { merge: true });
      return next;
    });

    // 2. Calcular montos (precios INCLUYEN IGV)
    const totalAmount = amount || 0;
    const baseImponible = Math.round((totalAmount / 1.18) * 100) / 100;
    const igv = Math.round((totalAmount - baseImponible) * 100) / 100;

    // 3. Construir descripción del servicio
    const courtDesc = COURT_DESCRIPTIONS[court_type] || `Alquiler cancha ${court_type}`;
    let descripcion = courtDesc;
    if (date) {
      const dateObj = new Date(date + "T12:00:00");
      const dateStr = dateObj.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
      descripcion += ` - ${dateStr}`;
    }
    if (time_slots?.length > 0) {
      const startH = time_slots[0];
      const lastH = parseInt(time_slots[time_slots.length - 1].split(":")[0]) + 1;
      descripcion += ` ${startH}-${lastH}:00`;
    }

    // 4. Fecha de emisión en formato ISO con timezone Lima
    const now = new Date();
    const fechaEmision = now.toISOString().split("T")[0] + "T00:00:00-05:00";

    // 5. Nombre del cliente
    const clienteName = (representative_name || "CLIENTE GENERAL").toUpperCase();

    // 6. Armar request para Factiliza
    const factilizaBody = {
      tipo_Operacion: "0101",
      tipo_Doc: "03", // Boleta
      serie: FACTILIZA_SERIE,
      correlativo: String(correlativo),
      tipo_Moneda: "PEN",
      fecha_Emision: fechaEmision,
      empresa_Ruc: FACTILIZA_RUC,
      cliente_Tipo_Doc: "0", // 0 = Sin documento (boleta simplificada)
      cliente_Num_Doc: "00000000",
      cliente_Razon_Social: clienteName,
      cliente_Direccion: "LIMA",
      monto_Oper_Gravadas: baseImponible,
      monto_Igv: igv,
      total_Impuestos: igv,
      valor_Venta: baseImponible,
      sub_Total: totalAmount,
      monto_Imp_Venta: totalAmount,
      monto_Oper_Exoneradas: 0,
      estado_Documento: "0",
      manual: false,
      id_Base_Dato: "15265",
      detalle: [
        {
          unidad: "ZZ", // Servicio
          cantidad: 1,
          cod_Producto: court_type || "CANCHA",
          descripcion,
          monto_Valor_Unitario: baseImponible,
          monto_Base_Igv: baseImponible,
          porcentaje_Igv: 18.0,
          igv,
          tip_Afe_Igv: "10", // Gravado
          total_Impuestos: igv,
          monto_Precio_Unitario: totalAmount,
          monto_Valor_Venta: baseImponible,
          factor_Icbper: 0,
        },
      ],
      forma_pago: [
        {
          tipo: "Contado",
          monto: totalAmount,
          cuota: 0,
          fecha_Pago: fechaEmision,
        },
      ],
      legend: [
        {
          legend_Code: "1000",
          legend_Value: numberToWords(totalAmount),
        },
      ],
    };

    // 7. Emitir boleta en Factiliza (SUNAT)
    const emitRes = await fetch(`${FACTILIZA_BASE_URL}/api/v1/invoice/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FACTILIZA_TOKEN}`,
      },
      body: JSON.stringify(factilizaBody),
    });

    const emitData = await emitRes.json();

    if (!emitData.success) {
      console.error("Factiliza emission error:", emitData);
      return NextResponse.json(
        { error: `Error de SUNAT: ${emitData.message || "Error desconocido"}` },
        { status: 400 }
      );
    }

    // 8. Descargar PDF de Factiliza
    const pdfRes = await fetch(`${FACTILIZA_BASE_URL}/api/v1/invoice/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FACTILIZA_TOKEN}`,
      },
      body: JSON.stringify({
        empresa_Ruc: FACTILIZA_RUC,
        tipo_Doc: "03",
        serie: FACTILIZA_SERIE,
        correlativo: String(correlativo),
      }),
    });

    if (!pdfRes.ok) {
      console.error("Error downloading PDF from Factiliza");
      return NextResponse.json(
        { error: "Boleta emitida pero error al descargar PDF" },
        { status: 500 }
      );
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    // 9. Subir PDF a Firebase Storage
    const serieCorrelativo = `${FACTILIZA_SERIE}-${correlativo}`;
    const storagePath = `invoices/${serieCorrelativo}.pdf`;
    const file = bucket.file(storagePath);
    const downloadToken = randomUUID();

    await file.save(pdfBuffer, {
      metadata: {
        contentType: "application/pdf",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

    const bucketName = bucket.name;
    const encodedPath = encodeURIComponent(storagePath);
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    // 10. Guardar en Firestore
    const invoiceData = {
      reservation_id,
      user_id,
      phone_number: phone_number || "",
      file_url: fileUrl,
      amount: totalAmount,
      court_type: court_type || "",
      date: date || "",
      transfer_id: transfer_id || null,
      serie: FACTILIZA_SERIE,
      correlativo,
      serie_correlativo: serieCorrelativo,
      factiliza_hash: emitData.data?.hash || null,
      status: "emitted",
      created_at: new Date().toISOString(),
    };

    const docRef = await db.collection("invoices").add(invoiceData);

    return NextResponse.json({
      success: true,
      invoice_id: docRef.id,
      file_url: fileUrl,
      serie_correlativo: serieCorrelativo,
    });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return NextResponse.json(
      { error: "Error al crear boleta" },
      { status: 500 }
    );
  }
}

// ── Número a letras (español) para la leyenda SUNAT ──

function numberToWords(num: number): string {
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);

  const units = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const teens = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const tens = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const hundreds = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

  function convertGroup(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "CIEN";

    let result = "";

    if (n >= 100) {
      result += hundreds[Math.floor(n / 100)] + " ";
      n %= 100;
    }

    if (n >= 10 && n <= 19) {
      result += teens[n - 10];
      return result.trim();
    }

    if (n >= 20 && n <= 29 && n !== 20) {
      result += "VEINTI" + units[n - 20];
      return result.trim();
    }

    if (n >= 10) {
      result += tens[Math.floor(n / 10)];
      n %= 10;
      if (n > 0) result += " Y ";
    }

    if (n > 0) {
      result += units[n];
    }

    return result.trim();
  }

  let words = "";

  if (intPart === 0) {
    words = "CERO";
  } else if (intPart >= 1000000) {
    const millions = Math.floor(intPart / 1000000);
    const remainder = intPart % 1000000;
    words = (millions === 1 ? "UN MILLON" : convertGroup(millions) + " MILLONES");
    if (remainder > 0) words += " " + convertBelow1M(remainder);
  } else {
    words = convertBelow1M(intPart);
  }

  function convertBelow1M(n: number): string {
    if (n >= 1000) {
      const thousands = Math.floor(n / 1000);
      const remainder = n % 1000;
      let result = thousands === 1 ? "MIL" : convertGroup(thousands) + " MIL";
      if (remainder > 0) result += " " + convertGroup(remainder);
      return result;
    }
    return convertGroup(n);
  }

  const decStr = decPart.toString().padStart(2, "0");
  return `SON ${words} CON ${decStr}/100 SOLES`;
}
