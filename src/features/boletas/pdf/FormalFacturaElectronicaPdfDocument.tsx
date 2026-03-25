import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { FormalComprobantePdfInput } from "./formalComprobanteTypes";
import { montoEnLetrasSoles } from "./montoEnLetrasSoles";

function fmtPeDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function fmtMoney(n: number, decimals = 2): string {
  return n.toLocaleString("es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function rucDisplayFromReceptorDoc(label: string | undefined): string {
  if (!label?.trim()) return "";
  const t = label.trim();
  return t.replace(/^RUC\s+/i, "").trim();
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 8,
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 32,
    color: "#000",
  },
  outerFrame: {
    borderWidth: 1,
    borderColor: "#000",
    padding: 14,
    flexGrow: 1,
  },
  headerRow: { flexDirection: "row", marginBottom: 10 },
  emisorCol: { flex: 1.15, paddingRight: 12 },
  emisorNombre: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  emisorLine: { fontSize: 8, lineHeight: 1.35, marginBottom: 2 },
  cpeBox: {
    width: 200,
    borderWidth: 1,
    borderColor: "#000",
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cpeTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 4 },
  cpeRuc: { fontSize: 8.5, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 2 },
  cpeNum: { fontSize: 9.5, fontFamily: "Helvetica-Bold", textAlign: "center" },
  hr: { borderBottomWidth: 1, borderColor: "#000", marginVertical: 8 },
  metaWrap: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  metaLeft: { flex: 1, paddingRight: 10 },
  metaRight: { width: 118, alignItems: "flex-end" },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 168, fontSize: 8 },
  metaValue: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold" },
  metaValueNormal: { flex: 1, fontSize: 8 },
  formaPagoLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  formaPagoValue: { fontSize: 8, textAlign: "right" },
  table: { marginTop: 6, borderWidth: 1, borderColor: "#000" },
  thRow: {
    flexDirection: "row",
    backgroundColor: "#eaeaea",
    borderBottomWidth: 1,
    borderColor: "#000",
  },
  thCell: {
    padding: 5,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    borderRightWidth: 1,
    borderColor: "#000",
    textAlign: "center",
  },
  trRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000", minHeight: 22 },
  tdCell: {
    padding: 5,
    fontSize: 8,
    borderRightWidth: 1,
    borderColor: "#000",
    justifyContent: "center",
  },
  tdRight: { textAlign: "right" },
  tdCenter: { textAlign: "center" },
  bottomSection: { flexDirection: "row", marginTop: 12, flexGrow: 1 },
  bottomLeft: { flex: 1.1, paddingRight: 10 },
  gratuitasBox: {
    borderWidth: 1,
    borderColor: "#000",
    padding: 6,
    marginBottom: 8,
    maxWidth: 220,
  },
  gratuitasRow: { flexDirection: "row", justifyContent: "space-between" },
  gratuitasLabel: { fontSize: 7.5, flex: 1, paddingRight: 6 },
  gratuitasValue: { fontSize: 7.5, fontFamily: "Helvetica-Bold" },
  sonText: { fontSize: 8.5, fontFamily: "Helvetica-Bold", lineHeight: 1.35 },
  bottomRight: { width: 228 },
  totalBoxRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#999",
    marginBottom: 2,
    minHeight: 16,
  },
  totalBoxLabel: {
    flex: 1,
    padding: 3,
    fontSize: 7.5,
    borderRightWidth: 1,
    borderColor: "#999",
    justifyContent: "center",
  },
  totalBoxValue: { width: 72, padding: 3, fontSize: 7.5, textAlign: "right", justifyContent: "center" },
  totalFinalRow: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: "#000",
    marginTop: 4,
    minHeight: 22,
  },
  totalFinalLabel: {
    flex: 1,
    padding: 5,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    justifyContent: "center",
  },
  totalFinalValue: {
    width: 78,
    padding: 5,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    justifyContent: "center",
  },
  footerBox: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#000",
    padding: 8,
  },
  footerText: { fontSize: 6.5, fontStyle: "italic", lineHeight: 1.45, textAlign: "justify" },
});

function CpeQrRaster({ dataUrl }: { dataUrl: string }) {
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image src={dataUrl} style={{ width: 72, height: 72, marginLeft: 8 }} />;
}

/**
 * Representación impresa tipo factura electrónica (SUNAT / formato comercial peruano).
 * Distinta de la boleta: metadatos, tabla 4 columnas, totales alineados al modelo impreso.
 */
export function FormalFacturaElectronicaPdfDocument({ data }: { data: FormalComprobantePdfInput }) {
  const son = montoEnLetrasSoles(data.importeTotal);
  const fechaStr = fmtPeDate(data.fechaEmisionYmd);
  const rucCliente = rucDisplayFromReceptorDoc(data.receptorDocLabel);
  const dirRec = (data.direccionReceptor || "LIMA").trim();
  const dirCli = (data.direccionCliente || dirRec).trim();
  const obs = data.observacion?.trim() ? data.observacion.trim() : "";

  const subTotalVentas = data.opGravada;
  const valorVenta = data.opGravada;

  const documentMetadataTitle =
    data.pdfDocumentTitle?.trim() || `Factura ${data.serieCorrelativo}`.trim();

  return (
    <Document title={documentMetadataTitle}>
      <Page size="A4" style={styles.page}>
        <View style={styles.outerFrame}>
          <View style={styles.headerRow}>
            <View style={styles.emisorCol}>
              <Text style={styles.emisorNombre}>{data.emisor.razonSocial}</Text>
              {data.emisor.nombreComercial ? (
                <Text style={styles.emisorLine}>{data.emisor.nombreComercial}</Text>
              ) : null}
              {data.emisor.direccion
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, i) => (
                  <Text key={`dir-${i}`} style={styles.emisorLine}>
                    {line}
                  </Text>
                ))}
              {data.emisor.ubigeoLine ? (
                <Text style={styles.emisorLine}>{data.emisor.ubigeoLine}</Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={styles.cpeBox}>
                <Text style={styles.cpeTitle}>FACTURA ELECTRONICA</Text>
                <Text style={styles.cpeRuc}>RUC: {data.emisor.ruc}</Text>
                <Text style={styles.cpeNum}>{data.serieCorrelativo}</Text>
              </View>
              {data.qrImageDataUrl ? <CpeQrRaster dataUrl={data.qrImageDataUrl} /> : null}
            </View>
          </View>

          <View style={styles.hr} />

          <View style={styles.metaWrap}>
            <View style={styles.metaLeft}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Fecha de Emisión :</Text>
                <Text style={styles.metaValue}>{fechaStr}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Señor(es) :</Text>
                <Text style={styles.metaValue}>{data.receptorNombre}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>RUC :</Text>
                <Text style={styles.metaValue}>{rucCliente || "—"}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Dirección del Receptor de la factura :</Text>
                <Text style={styles.metaValueNormal}>{dirRec}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Dirección del Cliente :</Text>
                <Text style={styles.metaValueNormal}>{dirCli}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Tipo de Moneda :</Text>
                <Text style={styles.metaValue}>{data.moneda}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Observación :</Text>
                <Text style={styles.metaValueNormal}>{obs || " "}</Text>
              </View>
            </View>
            <View style={styles.metaRight}>
              <Text style={styles.formaPagoLabel}>Forma de pago</Text>
              <Text style={styles.formaPagoValue}>{data.condicionVenta}</Text>
            </View>
          </View>

          <View style={styles.table}>
            <View style={styles.thRow}>
              <Text style={[styles.thCell, { width: "12%" }]}>Cantidad</Text>
              <Text style={[styles.thCell, { width: "16%" }]}>Unidad Medida</Text>
              <Text style={[styles.thCell, { width: "48%" }]}>Descripción</Text>
              <Text style={[styles.thCell, { width: "24%", borderRightWidth: 0 }]}>Valor Unitario</Text>
            </View>
            <View style={styles.trRow}>
              <Text style={[styles.tdCell, styles.tdCenter, { width: "12%" }]}>
                {fmtMoney(data.cantidad, 2)}
              </Text>
              <Text style={[styles.tdCell, styles.tdCenter, { width: "16%" }]}>UNIDAD</Text>
              <Text style={[styles.tdCell, { width: "48%" }]}>{data.descripcion}</Text>
              <Text style={[styles.tdCell, styles.tdRight, { width: "24%", borderRightWidth: 0 }]}>
                {fmtMoney(data.valorUnitarioSinIgv, 2)}
              </Text>
            </View>
          </View>

          <View style={styles.bottomSection}>
            <View style={styles.bottomLeft}>
              <View style={styles.gratuitasBox}>
                <View style={styles.gratuitasRow}>
                  <Text style={styles.gratuitasLabel}>Valor de Venta de Operaciones Gratuitas</Text>
                  <Text style={styles.gratuitasValue}>S/ {fmtMoney(0, 2)}</Text>
                </View>
              </View>
              <Text style={styles.sonText}>SON: {son}</Text>
            </View>
            <View style={styles.bottomRight}>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Sub Total Ventas</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(subTotalVentas, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Anticipos</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(0, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Descuentos</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(0, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Valor Venta</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(valorVenta, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>ISC</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.isc, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>IGV</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.igv, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Otros Cargos</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.otrosCargos, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Otros Tributos</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.otrosTributos, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Monto de redondeo</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.montoRedondeo, 2)}</Text>
              </View>
              <View style={styles.totalFinalRow}>
                <Text style={styles.totalFinalLabel}>Importe Total</Text>
                <Text style={styles.totalFinalValue}>S/ {fmtMoney(data.importeTotal, 2)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.footerBox}>
            <Text style={styles.footerText}>
              Esta es una representación impresa de la factura electrónica, generada en el Sistema de SUNAT. Puede
              verificarla utilizando su clave SOL.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
