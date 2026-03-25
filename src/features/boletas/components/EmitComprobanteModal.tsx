"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmitComprobanteParams, Invoice, Transfer, User } from "@/lib/types";
import { useStore } from "@/lib/hooks";
import {
  getUserName,
  getUserPhone,
  isValidPeruPhone,
  normalizePeruPhone,
  sanitizeDirectoryClientLabel,
} from "@/features/operaciones/utils";
import { WHATSAPP_ICON_PATH } from "@/features/operaciones/whatsappIconPath";
import { invoicePlantillaPdfHref } from "@/features/boletas/utils/invoicePdfLinks";
import { invoiceComprobantePdfDownloadFilename } from "@/features/boletas/utils/comprobantePdfFilename";
import { EmitClienteDirectoryField } from "./EmitClienteDirectoryField";
import { stripEmojis } from "../utils/stripEmojis";
import {
  CONDICION_VENTA_DEPOSITO_CUENTA,
  CONDICION_VENTA_OPTIONS,
  FORMA_PAGO_EMISION_LABEL,
} from "../constants/condicionVenta";
import { BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES } from "../constants/sunat";
import { emitMiscInvoice } from "../services/emitMiscInvoice";
import { getLimaNowTimeHm, getLimaTodayYmd } from "../utils/limaEmissionDatetime";
import { PdfPreviewThumbnail } from "@/components/PdfPreviewThumbnail";
import { navigateToHref } from "@/lib/internal-href";

function canSendComprobanteWsp(inv: Invoice, transfer: Transfer): boolean {
  const pdfOk = Boolean(invoicePlantillaPdfHref(inv) || String(inv.file_url || "").trim());
  if (!pdfOk) return false;
  const raw = String(inv.phone_number || transfer.phone_number || "").trim();
  const digits = raw.replace(/\D/g, "");
  const chatId = digits.length >= 9 ? normalizePeruPhone(digits) : "";
  return Boolean(chatId && isValidPeruPhone(chatId));
}

function cleanClienteInitial(value: string): string {
  return value
    .replace(/\d+/g, "")
    .replace(/\bVoley\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mensajeErrorConsultaRuc(msg: string): string {
  const m = msg.trim().toLowerCase();
  if (!m) return "No se pudo completar el nombre.";
  if (m.includes("no existe")) return "No encontramos ese RUC.";
  if (m.includes("token") || m.includes("autenticación")) return "No se pudo consultar. Intente más tarde.";
  return "No se pudo completar el nombre.";
}

export type EmitComprobanteModalTransferProps = {
  mode?: "transfer";
  transfer: Transfer;
  clientDni?: string | null;
  clientRuc?: string | null;
  initialDescripcion?: string;
  initialCliente?: string;
  onClose: () => void;
  onEmitInvoice: (t: Transfer, p: EmitComprobanteParams) => Promise<Invoice | null>;
  emitting?: boolean;
  attaching?: boolean;
};

/** Flujo por pasos solo en /boletas (misc): pregunta destinatario antes del resto del formulario. */
export type EmitComprobanteEmisorContext = "ventas_dia" | "cliente_reservado" | "otro";

export type EmitComprobanteModalMiscProps = {
  mode: "misc";
  onClose: () => void;
  onSuccess: () => void;
  /** Si true, UX guiada: primero “¿para quién?”; si “cliente reservado”, solo cliente y luego el resto. */
  emitUxFromBoletas?: boolean;
};

export type EmitComprobanteModalProps = EmitComprobanteModalTransferProps | EmitComprobanteModalMiscProps;

function isMiscProps(p: EmitComprobanteModalProps): p is EmitComprobanteModalMiscProps {
  return p.mode === "misc";
}

export const EmitComprobanteModal = memo(function EmitComprobanteModal(props: EmitComprobanteModalProps) {
  const misc = isMiscProps(props);
  const steppedBoletaUx = misc && Boolean(props.emitUxFromBoletas);
  const store = useStore();
  const clientDni = !misc ? props.clientDni : undefined;
  const clientRuc = !misc ? props.clientRuc : undefined;

  /** Vincular factura/boleta misc en Firestore a un usuario del panel (opcional). */
  const [panelLinkPhoneNorm, setPanelLinkPhoneNorm] = useState("");
  /** Texto del buscador de cliente (independiente del número vinculado). */
  const [clienteDirectoryInput, setClienteDirectoryInput] = useState("");

  const [docType, setDocType] = useState<"boleta" | "factura">("boleta");
  /** Modo transferencia: un solo campo sincronizado con perfil al cambiar tipo. */
  const [docNumberTransfer, setDocNumberTransfer] = useState("");
  /** Modo misc: conserva DNI y RUC al alternar pestañas. */
  const [dniMisc, setDniMisc] = useState("");
  const [rucMisc, setRucMisc] = useState("");

  const [clienteEdit, setClienteEdit] = useState(() =>
    misc ? "VENTAS DEL DIA" : cleanClienteInitial(props.initialCliente ?? "")
  );
  const [descripcionEdit, setDescripcionEdit] = useState(() =>
    misc ? "VENTAS DEL DIA" : props.initialDescripcion ?? ""
  );
  const [serieNum, setSerieNum] = useState<{ serie: string; next_correlativo: number } | null>(null);
  const [fetchingSerie, setFetchingSerie] = useState(false);
  const [amountEdit, setAmountEdit] = useState(() =>
    misc ? "" : String(props.transfer.amount ?? 0)
  );
  const [fechaEmision, setFechaEmision] = useState(getLimaTodayYmd);
  const [horaEmision, setHoraEmision] = useState(getLimaNowTimeHm);
  const [condicionVenta, setCondicionVenta] = useState<string>("Transferencia");
  const [formaPagoBanco, setFormaPagoBanco] = useState("");
  const [formaPagoCuenta, setFormaPagoCuenta] = useState("");
  const [miscEmitting, setMiscEmitting] = useState(false);
  const [miscError, setMiscError] = useState<string | null>(null);

  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferSuccessInvoice, setTransferSuccessInvoice] = useState<Invoice | null>(null);
  const [wspSendStatus, setWspSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [wspSendError, setWspSendError] = useState<string | null>(null);
  const wspSendInFlightRef = useRef(false);

  const [emisorContext, setEmisorContext] = useState<"" | EmitComprobanteEmisorContext>("");

  /** Si el usuario editó el nombre en el CPE, no lo pisan autocompletados (perfil / SUNAT). */
  const nombreComprobanteTouchedRef = useRef(false);
  const prevCompleteRucRef = useRef("");
  const [rucLookup, setRucLookup] = useState<"idle" | "loading" | "error">("idle");
  const [rucLookupMsg, setRucLookupMsg] = useState<string | null>(null);
  /** Factura: dirección fiscal (PDF / apisunat); se puede autocompletar con consulta RUC. */
  const [facturaDireccion, setFacturaDireccion] = useState("");

  const handleNombreComprobanteChange = useCallback((value: string) => {
    nombreComprobanteTouchedRef.current = true;
    setClienteEdit(value);
  }, []);

  useEffect(() => {
    if (misc) return;
    setDocNumberTransfer(docType === "boleta" ? (clientDni || "") : (clientRuc || ""));
  }, [misc, docType, clientDni, clientRuc]);

  const transferIdForReset = misc ? null : props.transfer.id;
  useEffect(() => {
    if (transferIdForReset == null) return;
    setTransferSuccessInvoice(null);
    setTransferSubmitting(false);
    setWspSendStatus("idle");
    setWspSendError(null);
  }, [transferIdForReset]);

  useEffect(() => {
    if (!misc) return;
    if (!store.isLoaded("users")) void store.fetchUsers();
  }, [misc, store]);

  const emitClienteDirectoryOptions = useMemo(() => {
    if (!misc) return [];
    return store
      .getUsers()
      .map((u) => {
        const raw = getUserPhone(u);
        const names = [u.custom_name, u.contact_name, u.push_name].filter(Boolean) as string[];
        const normalized = normalizePeruPhone(raw) || raw;
        const rawLabel = (names.length > 0 ? names.join(" ") : getUserName(u)).trim();
        const name = stripEmojis(rawLabel).replace(/\s+/g, " ").trim() || "Cliente";
        const searchText = name.toLowerCase();
        return { phone: normalized, name, searchText };
      })
      .filter((o) => o.phone.replace(/\D/g, "").length >= 9);
  }, [misc, store]);

  const clienteReservadoLinkedUser = useMemo(() => {
    if (!misc || !panelLinkPhoneNorm || !isValidPeruPhone(panelLinkPhoneNorm)) return undefined;
    return store
      .getUsers()
      .find((u) => normalizePeruPhone(getUserPhone(u) || u.chat_id || "") === panelLinkPhoneNorm);
  }, [misc, panelLinkPhoneNorm, store]);

  const clienteReservadoReady = Boolean(clienteReservadoLinkedUser);

  const showClienteSolo =
    steppedBoletaUx && emisorContext === "cliente_reservado" && !clienteReservadoReady;
  const showFullEmitForm =
    !steppedBoletaUx ||
    emisorContext === "ventas_dia" ||
    emisorContext === "otro" ||
    (emisorContext === "cliente_reservado" && clienteReservadoReady);

  const showMiscDirectory =
    misc && (!steppedBoletaUx || emisorContext === "cliente_reservado");

  const applyEmisorContext = useCallback((next: EmitComprobanteEmisorContext) => {
    setEmisorContext(next);
    nombreComprobanteTouchedRef.current = false;
    setPanelLinkPhoneNorm("");
    setClienteDirectoryInput("");
    setDniMisc("");
    setRucMisc("");
    setFacturaDireccion("");
    prevCompleteRucRef.current = "";
    if (next === "ventas_dia") {
      setClienteEdit("VENTAS DEL DIA");
      setDescripcionEdit("VENTAS DEL DIA");
    } else {
      setClienteEdit("");
      setDescripcionEdit("");
    }
  }, []);

  const prevPanelLinkPhoneRef = useRef("");
  useEffect(() => {
    if (!misc) return;
    if (panelLinkPhoneNorm !== prevPanelLinkPhoneRef.current) {
      prevPanelLinkPhoneRef.current = panelLinkPhoneNorm;
      nombreComprobanteTouchedRef.current = false;
    }
  }, [misc, panelLinkPhoneNorm]);

  useEffect(() => {
    if (!misc) return;
    if (!panelLinkPhoneNorm || !isValidPeruPhone(panelLinkPhoneNorm)) return;
    const u = store.getUsers().find(
      (x) => normalizePeruPhone(getUserPhone(x) || x.chat_id || "") === panelLinkPhoneNorm
    );
    if (!u) return;
    if (docType === "boleta") {
      if (!nombreComprobanteTouchedRef.current) {
        setClienteEdit(sanitizeDirectoryClientLabel(getUserName(u)));
      }
      const ld = (u.last_dni || "").replace(/\D/g, "").slice(0, 8);
      if (ld.length === 8) setDniMisc(ld);
    } else {
      const uProf = u as User;
      const lr = (u.last_ruc || "").replace(/\D/g, "").slice(0, 11);
      if (lr.length === 11) {
        setRucMisc(lr);
        prevCompleteRucRef.current = "";
      }
      const savedDir = (uProf.last_factura_direccion || "").trim();
      if (savedDir) setFacturaDireccion(savedDir);
      const rs = (uProf.last_factura_razon_social || "").trim();
      if (!nombreComprobanteTouchedRef.current) {
        if (rs) setClienteEdit(rs);
        else setClienteEdit(sanitizeDirectoryClientLabel(getUserName(u)));
      }
    }
  }, [misc, panelLinkPhoneNorm, docType, store]);

  const transferInitialCliente = !isMiscProps(props) ? props.initialCliente : undefined;
  const transferInitialDescripcion = !isMiscProps(props) ? props.initialDescripcion : undefined;
  const transferId = !isMiscProps(props) ? props.transfer.id : undefined;
  const transferAmount = !isMiscProps(props) ? props.transfer.amount : undefined;

  useEffect(() => {
    if (misc) return;
    setClienteEdit(cleanClienteInitial(transferInitialCliente ?? ""));
    setDescripcionEdit(transferInitialDescripcion ?? "");
  }, [misc, transferInitialCliente, transferInitialDescripcion]);

  useEffect(() => {
    if (misc) return;
    setAmountEdit(String(transferAmount ?? 0));
  }, [misc, transferId, transferAmount]);

  const digitsDoc = misc
    ? (docType === "factura" ? rucMisc : dniMisc).replace(/\D/g, "")
    : docNumberTransfer.replace(/\D/g, "");

  useEffect(() => {
    prevCompleteRucRef.current = "";
    if (docType === "boleta") setFacturaDireccion("");
  }, [docType]);

  useEffect(() => {
    if (condicionVenta !== CONDICION_VENTA_DEPOSITO_CUENTA) {
      setFormaPagoBanco("");
      setFormaPagoCuenta("");
    }
  }, [condicionVenta]);

  useEffect(() => {
    if (docType !== "factura") return;
    const r = digitsDoc.replace(/\D/g, "");
    if (r.length === 11 && r !== prevCompleteRucRef.current) {
      prevCompleteRucRef.current = r;
    }
  }, [docType, digitsDoc]);

  useEffect(() => {
    if (docType !== "factura") return;
    if (digitsDoc.replace(/\D/g, "").length !== 11) setFacturaDireccion("");
  }, [docType, digitsDoc]);

  const parsedAmount = parseFloat(amountEdit.replace(",", "."));
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0;

  const docValidFactura = digitsDoc.length === 11;
  const boletaRequiereDniPorMonto =
    docType === "boleta" && amountValid && parsedAmount >= BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES;
  const boletaSinDocOk =
    docType === "boleta" &&
    digitsDoc.length === 0 &&
    amountValid &&
    parsedAmount < BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES;
  const boletaConDniOk = docType === "boleta" && digitsDoc.length === 8;
  const docValidBoleta = boletaSinDocOk || boletaConDniOk;
  const docValid = docType === "factura" ? docValidFactura : docValidBoleta;
  const boletaDocIncomplete =
    docType === "boleta" && digitsDoc.length > 0 && digitsDoc.length < 8;

  /** Boleta: el DNI solo aplica desde S/ 700; por debajo no se muestra el campo. */
  const showDocNumberInput =
    docType === "factura" ||
    (docType === "boleta" && amountValid && parsedAmount >= BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES);

  useEffect(() => {
    if (docType !== "factura") {
      setRucLookup("idle");
      setRucLookupMsg(null);
      return;
    }
    const ruc = digitsDoc.replace(/\D/g, "");
    if (ruc.length !== 11) {
      setRucLookup("idle");
      setRucLookupMsg(null);
      return;
    }

    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setRucLookup("loading");
        setRucLookupMsg(null);
        try {
          const res = await fetch(`/api/invoices/consulta-ruc?ruc=${encodeURIComponent(ruc)}`, {
            signal: ac.signal,
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            razon_social?: string;
            direccion_fiscal?: string;
          };
          if (ac.signal.aborted) return;
          if (!res.ok) {
            setRucLookup("error");
            setRucLookupMsg(typeof data.error === "string" ? data.error : "No se pudo consultar el RUC");
            return;
          }
          const nombre = typeof data.razon_social === "string" ? data.razon_social.trim() : "";
          if (nombre && !nombreComprobanteTouchedRef.current) {
            setClienteEdit(nombre);
          }
          const dirF = typeof data.direccion_fiscal === "string" ? data.direccion_fiscal.trim() : "";
          if (dirF) setFacturaDireccion(dirF);
          setRucLookup("idle");
          setRucLookupMsg(null);
        } catch {
          if (ac.signal.aborted) return;
          setRucLookup("error");
          setRucLookupMsg("No se pudo consultar el RUC");
        }
      })();
    }, 450);

    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [docType, digitsDoc]);

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

  const receptorOk = misc ? clienteEdit.trim().length >= 3 : true;
  const descripcionOk = misc ? descripcionEdit.trim().length >= 1 : true;
  const fechaHoraOk = Boolean(fechaEmision.trim()) && Boolean(horaEmision.trim());

  const emitting = misc ? miscEmitting : !!props.emitting;
  const attaching = misc ? false : !!props.attaching;

  const showTransferSuccess = !misc && transferSuccessInvoice !== null;
  const showEmittingOverlay = !misc && !showTransferSuccess && (transferSubmitting || emitting);

  const transferForWsp = !misc ? props.transfer : null;
  const showWspOnSuccess =
    showTransferSuccess &&
    transferSuccessInvoice &&
    transferForWsp &&
    canSendComprobanteWsp(transferSuccessInvoice, transferForWsp);

  const successPdfHref = transferSuccessInvoice ? invoicePlantillaPdfHref(transferSuccessInvoice) : null;

  const sendSuccessInvoiceWsp = useCallback(async () => {
    const inv = transferSuccessInvoice;
    const t = transferForWsp;
    if (!inv || !t || wspSendInFlightRef.current || !canSendComprobanteWsp(inv, t)) return;
    const raw = String(inv.phone_number || t.phone_number || "").trim();
    const digits = raw.replace(/\D/g, "");
    const chatId = digits.length >= 9 ? normalizePeruPhone(digits) : "";
    if (!chatId) return;
    wspSendInFlightRef.current = true;
    setWspSendStatus("sending");
    setWspSendError(null);
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          invoice_id: inv.id,
          filename: invoiceComprobantePdfDownloadFilename(inv),
        }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === "string" ? data.error : "No se pudo enviar.");
      }
      setWspSendStatus("sent");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === "TimeoutError" || err.message.includes("aborted")
            ? "Tiempo de espera agotado al enviar."
            : err.message
          : "No se pudo enviar.";
      setWspSendStatus("error");
      setWspSendError(msg);
    } finally {
      wspSendInFlightRef.current = false;
    }
  }, [transferSuccessInvoice, transferForWsp]);

  const depositBancoTrim = formaPagoBanco.trim();
  const depositCuentaTrim = formaPagoCuenta.trim();
  const depositDetalleOk =
    condicionVenta !== CONDICION_VENTA_DEPOSITO_CUENTA ||
    (depositBancoTrim.length > 0 && depositCuentaTrim.length > 0) ||
    (depositBancoTrim.length === 0 && depositCuentaTrim.length === 0);

  const canSubmit =
    receptorOk &&
    descripcionOk &&
    amountValid &&
    fechaHoraOk &&
    !boletaDocIncomplete &&
    docValid &&
    depositDetalleOk &&
    !emitting &&
    !transferSubmitting;

  const depositFieldsForApi =
    condicionVenta === CONDICION_VENTA_DEPOSITO_CUENTA && depositBancoTrim && depositCuentaTrim
      ? { forma_pago_banco: depositBancoTrim, forma_pago_cuenta: depositCuentaTrim }
      : {};

  async function handleMiscSubmit() {
    if (!misc || !canSubmit) return;
    setMiscError(null);
    setMiscEmitting(true);
    try {
      const linkedUser = store.getUsers().find(
        (u) => normalizePeruPhone(getUserPhone(u) || u.chat_id || "") === panelLinkPhoneNorm
      );
      const hasPanelLink =
        Boolean(linkedUser) && isValidPeruPhone(panelLinkPhoneNorm);
      const result = await emitMiscInvoice({
        tipo_comprobante: docType,
        cliente_denominacion: clienteEdit.trim(),
        descripcion: descripcionEdit.trim(),
        amount: parsedAmount,
        doc_num:
          docType === "factura" ? digitsDoc : digitsDoc.length === 8 ? digitsDoc : undefined,
        fecha_de_emision: fechaEmision.trim(),
        hora_de_emision: horaEmision.trim(),
        condicion_venta: condicionVenta,
        panel_link_user_id: hasPanelLink ? linkedUser!.id : undefined,
        panel_link_phone: hasPanelLink ? panelLinkPhoneNorm : undefined,
        cliente_direccion: docType === "factura" ? facturaDireccion.trim() || undefined : undefined,
        ...depositFieldsForApi,
      });
      if (!result.success) {
        setMiscError(result.error ?? "Error al emitir");
        return;
      }
      props.onSuccess();
      props.onClose();
    } finally {
      setMiscEmitting(false);
    }
  }

  async function handleTransferSubmit() {
    if (misc || !canSubmit) return;
    setTransferSubmitting(true);
    try {
      const inv = await props.onEmitInvoice(props.transfer, {
        tipo_comprobante: docType,
        doc_num: digitsDoc,
        cliente_denominacion: clienteEdit.trim() || undefined,
        descripcion: descripcionEdit.trim() || undefined,
        amount: parsedAmount,
        fecha_de_emision: fechaEmision.trim() || undefined,
        hora_de_emision: horaEmision.trim() || undefined,
        condicion_venta: condicionVenta,
        cliente_direccion: docType === "factura" ? facturaDireccion.trim() || undefined : undefined,
        ...depositFieldsForApi,
      });
      if (inv) setTransferSuccessInvoice(inv);
    } finally {
      setTransferSubmitting(false);
    }
  }

  const onPrimaryClick = misc ? () => void handleMiscSubmit() : () => void handleTransferSubmit();

  const serieLabel =
    fetchingSerie ? "…" : serieNum ? `${serieNum.serie}-${String(serieNum.next_correlativo).padStart(5, "0")}` : "—";

  const showEmitPrimary = !steppedBoletaUx || showFullEmitForm;

  const controlH = "h-10";
  const inputClass = `w-full ${controlH} rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/30`;
  const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500";

  function onDocInputChange(raw: string) {
    const onlyDigits = raw.replace(/\D/g, "");
    if (misc) {
      if (docType === "factura") setRucMisc(onlyDigits.slice(0, 11));
      else setDniMisc(onlyDigits.slice(0, 8));
    } else {
      setDocNumberTransfer(docType === "factura" ? onlyDigits.slice(0, 11) : onlyDigits.slice(0, 8));
    }
  }

  const docInputValue = misc
    ? docType === "factura"
      ? rucMisc
      : dniMisc
    : docNumberTransfer;

  return (
    <div
      className="fixed inset-0 z-[10060] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-6 sm:px-6 sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emit-comprobante-title"
    >
      <div className="relative mb-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        {showEmittingOverlay ? (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/85 px-6 backdrop-blur-[2px]"
            aria-live="polite"
            aria-busy="true"
          >
            <div
              className="h-11 w-11 animate-spin rounded-full border-[3px] border-field-dark border-t-transparent"
              aria-hidden
            />
            <p className="text-center text-sm font-semibold text-gray-800">Emitiendo comprobante…</p>
          </div>
        ) : null}

        {!showTransferSuccess ? (
          <>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <h2 id="emit-comprobante-title" className="text-base font-bold text-gray-900">
            Emitir comprobante
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            disabled={!misc && transferSubmitting}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setDocType("boleta")}
              className={`flex h-10 flex-1 items-center justify-center rounded-md text-sm font-semibold transition-colors ${
                docType === "boleta" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              Boleta
            </button>
            <button
              type="button"
              onClick={() => setDocType("factura")}
              className={`flex h-10 flex-1 items-center justify-center rounded-md text-sm font-semibold transition-colors ${
                docType === "factura" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              Factura
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Próximo número</span>
            <span className="font-mono text-sm font-semibold text-gray-900">{serieLabel}</span>
          </div>

          {steppedBoletaUx ? (
            <div>
              <label htmlFor="emit-para-quien" className={labelClass}>
                ¿Para quién emites esta {docType === "boleta" ? "Boleta" : "Factura"}?
              </label>
              <select
                id="emit-para-quien"
                value={emisorContext}
                onChange={(e) => {
                  const v = e.target.value as "" | EmitComprobanteEmisorContext;
                  if (v === "") {
                    setEmisorContext("");
                    setPanelLinkPhoneNorm("");
                    setClienteDirectoryInput("");
                    return;
                  }
                  applyEmisorContext(v);
                }}
                className={inputClass}
              >
                <option value="">Selecciona una opción</option>
                <option value="ventas_dia">Ventas del día</option>
                <option value="cliente_reservado">Cliente que ha reservado</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          ) : null}

          {showClienteSolo ? (
            <EmitClienteDirectoryField
              linkedPhoneNorm={panelLinkPhoneNorm}
              onLinkedPhoneChange={setPanelLinkPhoneNorm}
              inputText={clienteDirectoryInput}
              onInputTextChange={setClienteDirectoryInput}
              options={emitClienteDirectoryOptions}
            />
          ) : null}

          {showFullEmitForm ? (
            <>
              {showMiscDirectory ? (
                <EmitClienteDirectoryField
                  linkedPhoneNorm={panelLinkPhoneNorm}
                  onLinkedPhoneChange={setPanelLinkPhoneNorm}
                  inputText={clienteDirectoryInput}
                  onInputTextChange={setClienteDirectoryInput}
                  options={emitClienteDirectoryOptions}
                />
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="emit-fecha" className={labelClass}>
                Fecha
              </label>
              <input
                id="emit-fecha"
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="emit-hora" className={labelClass}>
                Hora
              </label>
              <input
                id="emit-hora"
                type="time"
                value={horaEmision}
                onChange={(e) => setHoraEmision(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div
            className={`grid grid-cols-1 gap-3 sm:items-start ${showDocNumberInput ? "sm:grid-cols-2" : ""}`}
          >
            <div className={!showDocNumberInput && docType === "boleta" ? "sm:col-span-2" : undefined}>
              <label htmlFor="emit-cond-venta" className={labelClass}>
                {FORMA_PAGO_EMISION_LABEL}
              </label>
              <select
                id="emit-cond-venta"
                value={condicionVenta}
                onChange={(e) => setCondicionVenta(e.target.value)}
                className={inputClass}
              >
                {CONDICION_VENTA_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            {showDocNumberInput ? (
              <div>
                <label htmlFor="emit-doc" className={labelClass}>
                  {docType === "factura" ? "RUC" : "DNI"}
                </label>
                <input
                  id="emit-doc"
                  type="text"
                  inputMode="numeric"
                  value={docInputValue}
                  onChange={(e) => onDocInputChange(e.target.value)}
                  placeholder={docType === "factura" ? "11 dígitos" : "Opcional"}
                  className={`${inputClass} font-mono`}
                />
                {docType === "boleta" && boletaRequiereDniPorMonto && digitsDoc.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-800">
                    DNI obligatorio para montos desde S/ {BOLETA_SIN_DOCUMENTO_CLIENTE_MAX_SOLES}.
                  </p>
                ) : null}
                {docType === "factura" && rucLookup === "loading" ? (
                  <p className="mt-1 text-xs text-gray-500">Buscando razón social…</p>
                ) : null}
                {docType === "factura" && rucLookup === "error" && rucLookupMsg ? (
                  <p className="mt-1 text-xs text-amber-800">{mensajeErrorConsultaRuc(rucLookupMsg)}</p>
                ) : null}
                {boletaDocIncomplete ? (
                  <p className="mt-1 text-xs text-red-600">El DNI debe tener 8 dígitos.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {condicionVenta === CONDICION_VENTA_DEPOSITO_CUENTA ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <p className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                Cuenta de la <span className="font-semibold">empresa emisora</span> del comprobante (donde el cliente
                abona). No es el banco ni la cuenta del cliente.
              </p>
              <div>
                <label htmlFor="emit-forma-pago-banco" className={labelClass}>
                  Banco emisor
                </label>
                <input
                  id="emit-forma-pago-banco"
                  type="text"
                  value={formaPagoBanco}
                  onChange={(e) => setFormaPagoBanco(e.target.value)}
                  placeholder="Entidad donde la empresa recibe el depósito"
                  className={inputClass}
                  autoComplete="off"
                  maxLength={120}
                />
              </div>
              <div>
                <label htmlFor="emit-forma-pago-cuenta" className={labelClass}>
                  Cuenta o CCI emisor
                </label>
                <input
                  id="emit-forma-pago-cuenta"
                  type="text"
                  value={formaPagoCuenta}
                  onChange={(e) => setFormaPagoCuenta(e.target.value)}
                  placeholder="Nº de cuenta o CCI de la empresa emisora"
                  className={`${inputClass} font-mono`}
                  autoComplete="off"
                  maxLength={100}
                />
              </div>
              {!depositDetalleOk ? (
                <p className="sm:col-span-2 text-xs text-amber-800">
                  Completa banco emisor y cuenta emisor, o déjalos vacíos si no van en el PDF.
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <label htmlFor="emit-nombre-cpe" className={labelClass}>
              Nombre en el comprobante
            </label>
            <input
              id="emit-nombre-cpe"
              type="text"
              value={clienteEdit}
              onChange={(e) => handleNombreComprobanteChange(e.target.value)}
              placeholder={
                misc
                  ? docType === "factura"
                    ? "Razón social en el CPE"
                    : "Ej. VENTAS DEL DIA"
                  : "Opcional"
              }
              className={inputClass}
              autoComplete="off"
            />
          </div>

          {docType === "factura" ? (
            <div>
              <label htmlFor="emit-dir-factura" className={labelClass}>
                Dirección fiscal (receptor)
              </label>
              <textarea
                id="emit-dir-factura"
                value={facturaDireccion}
                onChange={(e) => setFacturaDireccion(e.target.value)}
                rows={3}
                placeholder="Se completa al validar el RUC si SUNAT la devuelve; puedes editarla."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-field-dark focus:outline-none focus:ring-1 focus:ring-field-dark/30"
              />
              <p className="mt-1 text-xs text-gray-500">
                En SUNAT y en el PDF formal. Si la dejas vacía se usará «LIMA».
              </p>
            </div>
          ) : null}

          <div>
            <label htmlFor="emit-concepto" className={labelClass}>
              Concepto
            </label>
            <input
              id="emit-concepto"
              type="text"
              value={descripcionEdit}
              onChange={(e) => setDescripcionEdit(e.target.value)}
              placeholder={misc ? "Ej: Venta del día" : "Ej: Alquiler cancha 9"}
              className={inputClass}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="emit-total" className={labelClass}>
              Total (incl. IGV)
            </label>
            <input
              id="emit-total"
              type="text"
              inputMode="decimal"
              value={amountEdit}
              onChange={(e) => setAmountEdit(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0.00"
              className={`${inputClass} font-mono`}
            />
            {!amountValid && amountEdit !== "" ? (
              <p className="mt-1 text-xs text-red-600">Monto inválido.</p>
            ) : null}
          </div>
            </>
          ) : null}
        </div>

        {misc && miscError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {miscError}
          </div>
        ) : null}

        <div className="mt-5 flex gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={props.onClose}
            className={`flex ${controlH} items-center justify-center rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 ${
              showEmitPrimary ? "flex-1" : "w-full"
            }`}
          >
            Cancelar
          </button>
          {showEmitPrimary && (
            <button
              type="button"
              onClick={onPrimaryClick}
              disabled={
                attaching ||
                emitting ||
                transferSubmitting ||
                !docValid ||
                !amountValid ||
                boletaDocIncomplete ||
                !fechaHoraOk ||
                !receptorOk ||
                !descripcionOk ||
                !depositDetalleOk
              }
              className={`flex ${controlH} flex-1 items-center justify-center rounded-lg border border-field-dark bg-field-dark text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50`}
            >
              {emitting || transferSubmitting ? "Emitiendo…" : "Emitir comprobante"}
            </button>
          )}
        </div>
          </>
        ) : (
          <div className="space-y-5 pt-1">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <h2 id="emit-comprobante-title" className="text-base font-bold text-gray-900">
                ¡Emitido con éxito!
              </h2>
              <button
                type="button"
                onClick={props.onClose}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Cerrar"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {successPdfHref ? (
              <div className="mx-auto w-full max-w-[240px]">
                <PdfPreviewThumbnail
                  url={successPdfHref}
                  onClickPreview={() => navigateToHref(successPdfHref)}
                  variant="full"
                />
              </div>
            ) : null}
            {transferSuccessInvoice?.serie_correlativo ? (
              <p className="text-center font-mono text-xs font-semibold text-gray-500">
                {transferSuccessInvoice.serie_correlativo}
              </p>
            ) : null}
            {!successPdfHref && !transferSuccessInvoice?.serie_correlativo ? (
              <p className="text-center text-sm text-gray-600">Comprobante registrado.</p>
            ) : null}
            {showWspOnSuccess ? (
              <button
                type="button"
                onClick={() => void sendSuccessInvoiceWsp()}
                disabled={wspSendStatus === "sending" || wspSendStatus === "sent"}
                className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors ${
                  wspSendStatus === "sent"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : wspSendStatus === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-green-600 bg-green-600 text-white hover:bg-green-700"
                } disabled:opacity-70`}
              >
                {wspSendStatus === "sending" ? (
                  "Enviando…"
                ) : wspSendStatus === "sent" ? (
                  "Enviado por WhatsApp"
                ) : wspSendStatus === "error" ? (
                  <>
                    <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path d={WHATSAPP_ICON_PATH} />
                    </svg>
                    Reintentar envío
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path d={WHATSAPP_ICON_PATH} />
                    </svg>
                    Enviar por WhatsApp
                  </>
                )}
              </button>
            ) : null}
            {wspSendError ? (
              <p className="text-center text-xs leading-snug text-red-600">{wspSendError}</p>
            ) : null}
            <button
              type="button"
              onClick={props.onClose}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-gray-300 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
