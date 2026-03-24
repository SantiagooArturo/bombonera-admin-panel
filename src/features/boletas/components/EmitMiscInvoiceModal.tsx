"use client";

import { useEffect, useState, memo } from "react";
import { BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES } from "../constants/sunat";
import { emitMiscInvoice } from "../services/emitMiscInvoice";
import { getLimaNowTimeHm, getLimaTodayYmd } from "../utils/limaEmissionDatetime";

type EmitMiscInvoiceModalProps = {
  onClose: () => void;
  onSuccess: () => void;
};

export const EmitMiscInvoiceModal = memo(function EmitMiscInvoiceModal({
  onClose,
  onSuccess,
}: EmitMiscInvoiceModalProps) {
  const [docType, setDocType] = useState<"boleta" | "factura">("boleta");
  const [receptor, setReceptor] = useState("VENTAS DEL DIA");
  const [descripcion, setDescripcion] = useState("VENTAS DEL DIA");
  const [ruc, setRuc] = useState("");
  const [dniBoleta, setDniBoleta] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [fechaEmision, setFechaEmision] = useState(getLimaTodayYmd);
  const [horaEmision, setHoraEmision] = useState(getLimaNowTimeHm);
  const [serieNum, setSerieNum] = useState<{ serie: string; next_correlativo: number } | null>(null);
  const [fetchingSerie, setFetchingSerie] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amountStr.replace(",", "."));
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const rucDigits = ruc.replace(/\D/g, "");
  const rucValid = rucDigits.length === 11;
  const boletaDigits = dniBoleta.replace(/\D/g, "");
  const boletaDocIncomplete = docType === "boleta" && boletaDigits.length > 0 && boletaDigits.length < 8;
  const boletaDocOk =
    docType === "boleta" &&
    !boletaDocIncomplete &&
    (boletaDigits.length === 0 || boletaDigits.length === 8);
  const boletaOverLimitNeedsDni =
    docType === "boleta" && amountValid && parsedAmount > BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES;
  const boletaMontoOk =
    docType === "boleta" &&
    amountValid &&
    (!boletaOverLimitNeedsDni ? boletaDocOk : boletaDigits.length === 8);

  const receptorValid = receptor.trim().length >= 3;
  const descripcionValid = descripcion.trim().length >= 1;
  const fechaHoraOk = Boolean(fechaEmision.trim()) && Boolean(horaEmision.trim());

  const canSubmit =
    receptorValid &&
    descripcionValid &&
    amountValid &&
    fechaHoraOk &&
    !boletaDocIncomplete &&
    (docType === "boleta" ? boletaMontoOk : rucValid) &&
    !emitting;

  useEffect(() => {
    let cancelled = false;
    setFetchingSerie(true);
    fetch(`/api/invoices?next_correlativo=1&tipo=${docType}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.serie != null && data?.next_correlativo != null) {
          setSerieNum({ serie: String(data.serie), next_correlativo: Number(data.next_correlativo) });
        }
      })
      .catch(() => {
        if (!cancelled) setSerieNum(null);
      })
      .finally(() => {
        if (!cancelled) setFetchingSerie(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docType]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setEmitting(true);
    try {
      const result = await emitMiscInvoice({
        tipo_comprobante: docType,
        cliente_denominacion: receptor.trim(),
        descripcion: descripcion.trim(),
        amount: parsedAmount,
        doc_num: docType === "factura" ? rucDigits : boletaDigits.length === 8 ? boletaDigits : undefined,
        fecha_de_emision: fechaEmision.trim(),
        hora_de_emision: horaEmision.trim(),
      });
      if (!result.success) {
        setError(result.error ?? "Error al emitir");
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setEmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emit-misc-title"
    >
      <div className="max-h-[min(90vh,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))] shrink-0 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="emit-misc-title" className="text-xl font-bold text-gray-900">
              Emitir boleta o factura
            </h2>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Ventas del día u otros conceptos <strong>sin reserva</strong> en el sistema. Puede cambiar la fecha y la
              hora que saldrán en el comprobante (hora de <strong>Lima</strong>).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 rounded-xl border-2 border-blue-100 bg-blue-50/80 p-4 space-y-3">
          <p className="text-sm font-bold text-gray-900">¿Cuándo sale en el comprobante?</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            Por defecto: <strong>hoy</strong> y la <strong>hora actual en Lima</strong>. Si el papel corresponde a otro
            momento, cámbielo aquí (no puede ser una fecha u hora futura).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="misc-fecha" className="block text-sm font-bold text-gray-800 mb-1">
                Fecha de emisión
              </label>
              <input
                id="misc-fecha"
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-base font-semibold text-gray-900"
              />
            </div>
            <div>
              <label htmlFor="misc-hora" className="block text-sm font-bold text-gray-800 mb-1">
                Hora (24 horas)
              </label>
              <input
                id="misc-hora"
                type="time"
                value={horaEmision}
                onChange={(e) => setHoraEmision(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-base font-semibold text-gray-900"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setDocType("boleta")}
            className={`flex-1 rounded-md py-3 text-sm font-bold transition-colors ${
              docType === "boleta" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
            }`}
          >
            Boleta
          </button>
          <button
            type="button"
            onClick={() => setDocType("factura")}
            className={`flex-1 rounded-md py-3 text-sm font-bold transition-colors ${
              docType === "factura" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
            }`}
          >
            Factura (RUC)
          </button>
        </div>

        <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
          <div>
            <label className="text-xs font-semibold text-gray-600">Serie / correlativo próximo</label>
            <p className="mt-1 font-mono text-base font-bold text-gray-900">
              {fetchingSerie
                ? "Cargando…"
                : serieNum
                  ? `${serieNum.serie}-${String(serieNum.next_correlativo).padStart(5, "0")}`
                  : "—"}
            </p>
          </div>

          <div>
            <label htmlFor="misc-receptor" className="text-xs font-semibold text-gray-600">
              Receptor (texto en comprobante)
            </label>
            <input
              id="misc-receptor"
              value={receptor}
              onChange={(e) => setReceptor(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-lg border-2 border-gray-300 px-3 py-2 text-base font-medium text-gray-900"
              placeholder="Ej: VENTAS DEL DIA"
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="misc-descripcion" className="text-xs font-semibold text-gray-600">
              Descripción del ítem
            </label>
            <input
              id="misc-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-lg border-2 border-gray-300 px-3 py-2 text-base font-medium text-gray-900"
              placeholder="Aparece en el PDF SUNAT"
              autoComplete="off"
            />
          </div>

          {docType === "factura" ? (
            <div>
              <label htmlFor="misc-ruc" className="text-xs font-semibold text-gray-600">
                RUC (11 dígitos, obligatorio)
              </label>
              <input
                id="misc-ruc"
                value={ruc}
                onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                className="mt-1 w-full min-h-[44px] rounded-lg border-2 border-gray-300 px-3 py-2 font-mono text-base"
                placeholder="20123456789"
                inputMode="numeric"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="misc-dni" className="text-xs font-semibold text-gray-600">
                DNI del cliente (opcional)
              </label>
              <input
                id="misc-dni"
                value={dniBoleta}
                onChange={(e) => setDniBoleta(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className="mt-1 w-full min-h-[44px] rounded-lg border-2 border-gray-300 px-3 py-2 font-mono text-lg font-bold text-gray-900"
                placeholder="Vacío si no lo tiene a mano"
                inputMode="numeric"
              />
              <p className="mt-2 text-xs text-gray-700 leading-relaxed">
                Si el total es <strong>hasta S/ {BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}</strong>, puede dejar el DNI
                vacío. Si el total es <strong>más</strong> que eso, debe escribir los <strong>8 dígitos</strong> del DNI
                o cambiar arriba a <strong>Factura</strong> y poner el RUC.
              </p>
              {boletaDocIncomplete ? (
                <p className="mt-1 text-xs text-red-600">El DNI debe tener 8 dígitos o déjelo vacío.</p>
              ) : null}
            </div>
          )}

          <div>
            <label htmlFor="misc-monto" className="text-xs font-semibold text-gray-600">
              Importe total (IGV incluido)
            </label>
            <input
              id="misc-monto"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ""))}
              className="mt-1 w-full rounded-lg border-2 border-gray-300 px-3 py-2 font-mono text-lg font-bold text-gray-900"
              placeholder="0.00"
              inputMode="decimal"
            />
            {docType === "boleta" && boletaOverLimitNeedsDni && boletaDigits.length !== 8 && amountValid ? (
              <p className="mt-1 text-xs text-amber-800 font-medium">
                Este monto supera S/ {BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}: indique el DNI (8 dígitos) o use Factura
                con RUC.
              </p>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        ) : null}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border-2 border-gray-300 py-3 text-base font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-field-dark py-3 text-base font-bold text-white hover:opacity-95 disabled:opacity-50"
          >
            {emitting ? "Emitiendo…" : "Emitir comprobante"}
          </button>
        </div>
      </div>
    </div>
  );
});
