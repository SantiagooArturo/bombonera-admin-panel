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
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 118, fontSize: 8 },
  metaValue: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold" },
  metaValueNormal: { flex: 1, fontSize: 8 },
  table: { marginTop: 8, borderWidth: 1, borderColor: "#000" },
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
  subTableNote: { marginTop: 4, alignItems: "flex-end" },
  subLine: { fontSize: 7.5, marginBottom: 1 },
  bottomSection: { flexDirection: "row", marginTop: 12, flexGrow: 1 },
  bottomLeft: { flex: 1.1, paddingRight: 10 },
  bottomRight: { width: 220 },
  asteriskNote: { fontSize: 7, marginBottom: 2, lineHeight: 1.3 },
  sonText: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginTop: 8, lineHeight: 1.35 },
  totalBoxRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#999",
    marginBottom: 3,
    minHeight: 18,
  },
  totalBoxLabel: {
    flex: 1,
    padding: 4,
    fontSize: 7.5,
    borderRightWidth: 1,
    borderColor: "#999",
    justifyContent: "center",
  },
  totalBoxValue: { width: 72, padding: 4, fontSize: 7.5, textAlign: "right", justifyContent: "center" },
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
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#000",
    padding: 8,
  },
  footerText: { fontSize: 6.5, fontStyle: "italic", lineHeight: 1.4, textAlign: "justify" },
});

function docTitle(tipo: "boleta" | "factura"): string {
  return tipo === "factura" ? "FACTURA ELECTRÓNICA" : "BOLETA DE VENTA ELECTRÓNICA";
}

/** Imagen QR en PDF (@react-pdf Image no equivale a img con alt en el DOM). */
function CpeQrRaster({ dataUrl }: { dataUrl: string }) {
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image src={dataUrl} style={{ width: 72, height: 72, marginLeft: 8 }} />;
}

export function FormalComprobantePdfDocument({ data }: { data: FormalComprobantePdfInput }) {
  const son = montoEnLetrasSoles(data.importeTotal);
  const fechaStr = fmtPeDate(data.fechaEmisionYmd);

  const documentMetadataTitle =
    data.pdfDocumentTitle?.trim() ||
    `${data.tipo === "factura" ? "Factura" : "Boleta"} ${data.serieCorrelativo}`.trim();

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
                <Text style={styles.cpeTitle}>{docTitle(data.tipo)}</Text>
                <Text style={styles.cpeRuc}>RUC: {data.emisor.ruc}</Text>
                <Text style={styles.cpeNum}>{data.serieCorrelativo}</Text>
              </View>
              {data.qrImageDataUrl ? <CpeQrRaster dataUrl={data.qrImageDataUrl} /> : null}
            </View>
          </View>

          <View style={styles.hr} />

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Fecha de Vencimiento :</Text>
            <Text style={styles.metaValueNormal}>{fechaStr}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Fecha de Emisión :</Text>
            <Text style={styles.metaValue}>{data.fechaEmisionMostrada}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Cond. Venta :</Text>
            <Text style={styles.metaValue}>{data.condicionVenta}</Text>
          </View>
          {data.formaPagoBanco?.trim() ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Banco emisor :</Text>
              <Text style={styles.metaValueNormal}>{data.formaPagoBanco.trim()}</Text>
            </View>
          ) : null}
          {data.formaPagoCuenta?.trim() ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Cuenta / CCI emisor :</Text>
              <Text style={styles.metaValueNormal}>{data.formaPagoCuenta.trim()}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Señor(es) :</Text>
            <Text style={styles.metaValue}>{data.receptorNombre}</Text>
          </View>
          {data.receptorDocLabel ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Doc. identidad :</Text>
              <Text style={styles.metaValue}>{data.receptorDocLabel}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Tipo de Moneda :</Text>
            <Text style={styles.metaValue}>{data.moneda}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Observación :</Text>
            <Text style={styles.metaValueNormal}>{data.observacion ?? "—"}</Text>
          </View>

          <View style={styles.table}>
            <View style={styles.thRow}>
              <Text style={[styles.thCell, { width: "9%" }]}>Cantidad</Text>
              <Text style={[styles.thCell, { width: "12%" }]}>Unidad{"\n"}Medida</Text>
              <Text style={[styles.thCell, { width: "32%", borderRightWidth: 0 }]}>Descripción</Text>
              <Text style={[styles.thCell, { width: "15%" }]}>Valor{"\n"}Unitario(*)</Text>
              <Text style={[styles.thCell, { width: "12%" }]}>Descuento(*)</Text>
              <Text style={[styles.thCell, { width: "20%", borderRightWidth: 0 }]}>
                Importe de{"\n"}Venta(**)
              </Text>
            </View>
            <View style={styles.trRow}>
              <Text style={[styles.tdCell, styles.tdCenter, { width: "9%" }]}>
                {fmtMoney(data.cantidad, 2)}
              </Text>
              <Text style={[styles.tdCell, styles.tdCenter, { width: "12%" }]}>UNIDAD</Text>
              <Text style={[styles.tdCell, { width: "32%", borderRightWidth: 0 }]}>{data.descripcion}</Text>
              <Text style={[styles.tdCell, styles.tdRight, { width: "15%" }]}>
                {fmtMoney(data.valorUnitarioSinIgv, 2)}
              </Text>
              <Text style={[styles.tdCell, styles.tdRight, { width: "12%" }]}>
                {fmtMoney(data.descuento, 2)}
              </Text>
              <Text style={[styles.tdCell, styles.tdRight, { width: "20%", borderRightWidth: 0 }]}>
                {fmtMoney(data.importeLineaConIgv, 2)}
              </Text>
            </View>
          </View>

          <View style={styles.subTableNote}>
            <Text style={styles.subLine}>Otros Cargos S/ {fmtMoney(data.otrosCargos, 2)}</Text>
            <Text style={styles.subLine}>Otros Tributos S/ {fmtMoney(data.otrosTributos, 2)}</Text>
            <Text style={styles.subLine}>Importe Total S/ {fmtMoney(data.importeTotal, 2)}</Text>
          </View>

          <View style={styles.bottomSection}>
            <View style={styles.bottomLeft}>
              <Text style={styles.asteriskNote}>(*) Sin impuestos.</Text>
              <Text style={styles.asteriskNote}>
                (**) Incluye impuestos que corresponden según ley vigente.
              </Text>
              <Text style={styles.sonText}>SON: {son}</Text>
            </View>
            <View style={styles.bottomRight}>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Op. Gravada</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.opGravada, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Op. Exonerada</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.opExonerada, 2)}</Text>
              </View>
              <View style={styles.totalBoxRow}>
                <Text style={styles.totalBoxLabel}>Op. Inafecta</Text>
                <Text style={styles.totalBoxValue}>S/ {fmtMoney(data.opInafecta, 2)}</Text>
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
                <Text style={styles.totalBoxLabel}>Monto de Redondeo</Text>
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
              Representación impresa de la {docTitle(data.tipo)} generada desde un sistema autorizado por SUNAT.
              Consulte y valide en{" "}
              <Text style={{ fontFamily: "Helvetica-Bold", fontStyle: "normal" }}>www.sunat.gob.pe</Text> o mediante el
              código QR / CDR electrónico cuando corresponda. Este documento no sustituye la representación XML firmada
              ante SUNAT.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
