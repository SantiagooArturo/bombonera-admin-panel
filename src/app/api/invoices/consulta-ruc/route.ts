import { NextRequest, NextResponse } from "next/server";
import { apisunatConsultaRucUrlFromDocumentsUrl } from "@/features/boletas/utils/apisunatBaseUrl";

type ApisunatConsultaRucResponse = {
  success?: boolean;
  message?: string;
  payload?: {
    ruc?: string;
    razon_social?: string;
    nombre_comercial?: string;
    estado?: string;
    condicion?: string;
    direccion_fiscal?: string;
  };
};

/**
 * Proxy consulta RUC → apisunat.pe (SUNAT), mismo token que emisión.
 * GET ?ruc=11dígitos
 */
export async function GET(request: NextRequest) {
  const APISUNAT_URL_VAL = process.env.APISUNAT_URL;
  const APISUNAT_TOKEN_VAL = process.env.APISUNAT_TOKEN;
  if (!APISUNAT_URL_VAL || !APISUNAT_TOKEN_VAL) {
    return NextResponse.json(
      { error: "Falta APISUNAT_URL o APISUNAT_TOKEN en el servidor" },
      { status: 500 }
    );
  }

  const rucParam = request.nextUrl.searchParams.get("ruc")?.trim() ?? "";
  const ruc = rucParam.replace(/\D/g, "");
  if (ruc.length !== 11) {
    return NextResponse.json({ error: "RUC debe tener 11 dígitos" }, { status: 400 });
  }

  let consultaUrl: string;
  try {
    consultaUrl = apisunatConsultaRucUrlFromDocumentsUrl(APISUNAT_URL_VAL, ruc);
  } catch {
    return NextResponse.json({ error: "APISUNAT_URL inválida" }, { status: 500 });
  }

  try {
    const res = await fetch(consultaUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APISUNAT_TOKEN_VAL}`,
      },
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as ApisunatConsultaRucResponse;

    if (!res.ok || data.success === false) {
      const msg =
        typeof data.message === "string" && data.message.trim()
          ? data.message.trim()
          : "No se pudo consultar el RUC";
      return NextResponse.json({ error: msg }, { status: res.status === 401 ? 401 : 400 });
    }

    const razon = typeof data.payload?.razon_social === "string" ? data.payload.razon_social.trim() : "";
    if (!razon) {
      return NextResponse.json({ error: "SUNAT no devolvió razón social" }, { status: 502 });
    }

    return NextResponse.json({
      razon_social: razon,
      estado: data.payload?.estado,
      condicion: data.payload?.condicion,
      direccion_fiscal: data.payload?.direccion_fiscal,
    });
  } catch (e) {
    console.error("consulta-ruc:", e);
    return NextResponse.json({ error: "Error al consultar RUC" }, { status: 502 });
  }
}
