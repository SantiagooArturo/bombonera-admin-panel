/** Misma forma que `PdfData` en `sunatFirestoreRecovery` (evita import circular). */
export type RecoveryBillingFields = {
  importeTotal: number;
  fechaEmision: string;
  clienteNombre: string;
  clienteDoc: string;
  descripcion: string;
};

/**
 * Intenta obtener monto, fecha y receptor desde el XML UBL que apisunat suele
 * devolver en `/status` (`payload.xml`). Evita depender de pdfjs en serverless.
 */
export function extractRecoveryFromApisunatStatusXml(xmlRaw: string): RecoveryBillingFields | null {
  const xml = xmlRaw.trim();
  if (!xml.length || xml.length < 80 || !xml.includes("<")) return null;

  const decodeXmlEntities = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  const issueDateM =
    xml.match(/<(?:[^:>\s]+:)?IssueDate[^>]*>(\d{4}-\d{2}-\d{2})</i) ??
    xml.match(/<(?:[^:>\s]+:)?IssueDate[^>]*>(\d{1,2}\/\d{1,2}\/\d{4})</i);
  let fechaEmision = "";
  if (issueDateM) {
    const v = issueDateM[1]!.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) fechaEmision = v;
    else {
      const m2 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m2) {
        const dd = m2[1]!.padStart(2, "0");
        const mm = m2[2]!.padStart(2, "0");
        const yyyy = m2[3]!;
        fechaEmision = `${yyyy}-${mm}-${dd}`;
      }
    }
  }

  const parseMoney = (raw: string) => {
    const t = raw.replace(/,/g, "").trim();
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : 0;
  };

  const penAmounts: number[] = [];
  const penRe =
    /<(?:[^:>\s]+:)?(?:TaxInclusiveAmount|PayableAmount)[^>]*currencyID="PEN"[^>]*>([^<]+)/gi;
  let penMatch: RegExpExecArray | null;
  while ((penMatch = penRe.exec(xml)) !== null) {
    const n = parseMoney(penMatch[1] ?? "");
    if (n > 0) penAmounts.push(n);
  }
  let importeTotal = penAmounts.length > 0 ? Math.max(...penAmounts) : 0;

  if (importeTotal <= 0) {
    const lmt = xml.match(
      /<(?:[^:>\s]+:)?LegalMonetaryTotal[^>]*>([\s\S]*?)<\/(?:[^:>\s]+:)?LegalMonetaryTotal>/i
    );
    if (lmt) {
      const inner = lmt[1] ?? "";
      const innerRe = /<(?:[^:>\s]+:)?(?:PayableAmount|TaxInclusiveAmount)[^>]*>([^<]+)/gi;
      let im: RegExpExecArray | null;
      while ((im = innerRe.exec(inner)) !== null) {
        const n = parseMoney(im[1] ?? "");
        if (n > 0) penAmounts.push(n);
      }
      if (penAmounts.length) importeTotal = Math.max(...penAmounts);
    }
  }

  let clienteNombre = "";
  let clienteDoc = "";
  const custBlock = xml.match(
    /<(?:[^:>\s]+:)?AccountingCustomerParty[^>]*>([\s\S]*?)<\/(?:[^:>\s]+:)?AccountingCustomerParty>/i
  );
  if (custBlock) {
    const block = custBlock[1] ?? "";
    const regName = block.match(
      /<(?:[^:>\s]+:)?RegistrationName[^>]*>([^<]+)<\/(?:[^:>\s]+:)?RegistrationName>/i
    );
    if (regName) clienteNombre = decodeXmlEntities(regName[1]!.replace(/\s+/g, " ").trim());

    const idTagged = block.match(
      /<(?:[^:>\s]+:)?ID[^>]*scheme(?:Name|ID)?="[^"]*"[^>]*>([^<]+)<\/(?:[^:>\s]+:)?ID>/i
    );
    if (idTagged) clienteDoc = idTagged[1]!.replace(/\D/g, "");

    if (!clienteDoc) {
      const idLoose = block.match(/<(?:[^:>\s]+:)?ID[^>]*>(\d{8,12})</i);
      if (idLoose) clienteDoc = idLoose[1]!;
    }
  }

  if (!clienteNombre) {
    const anyName = xml.match(
      /<(?:[^:>\s]+:)?AccountingCustomerParty[\s\S]*?<(?:[^:>\s]+:)?RegistrationName[^>]*>([^<]+)</i
    );
    if (anyName) clienteNombre = decodeXmlEntities(anyName[1]!.replace(/\s+/g, " ").trim());
  }

  if (!clienteNombre.trim()) {
    if (/\bPUBLICO\s+EN\s+GENERAL\b/i.test(xml)) clienteNombre = "PUBLICO EN GENERAL";
    else if (/\bCLIENTES?\s+VARIOS\b/i.test(xml)) clienteNombre = "CLIENTES VARIOS";
    else if (/\bVARIOS\b/i.test(xml)) clienteNombre = "VARIOS";
  }

  const descripcion = "";

  if (!fechaEmision || importeTotal <= 0 || clienteNombre.trim().length < 2) return null;

  return {
    importeTotal,
    fechaEmision,
    clienteNombre: clienteNombre.trim(),
    clienteDoc: clienteDoc.trim(),
    descripcion,
  };
}
