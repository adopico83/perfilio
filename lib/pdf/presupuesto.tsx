import React from 'react';
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import type { PresupuestoPdfProps } from './types';
import { formatEuro } from './parser';

export { formatEuro };

const OBSERVACIONES_TEXTO =
  'La presente oferta sólo incluye los trabajos en ella expresamente indicados... Todo trabajo fuera de presupuesto tendrá un importe de 30€/hora más el material empleado.';

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 36,
    paddingHorizontal: 32,
    fontSize: 8,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  logo: {
    width: 120,
    maxHeight: 64,
    objectFit: 'contain',
  },
  logoPlaceholder: {
    width: 120,
    height: 48,
  },
  empresaBox: {
    flex: 1,
    marginLeft: 12,
    borderWidth: 1,
    borderColor: '#000',
    borderStyle: 'solid',
    padding: 8,
    fontSize: 7.5,
    lineHeight: 1.35,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    fontSize: 9,
  },
  metaLabel: {
    fontWeight: 'bold',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e3a8a',
    color: '#fff',
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginTop: 10,
    fontWeight: 'bold',
    fontStyle: 'italic',
    fontSize: 8,
  },
  thConcepto: { width: '46%' },
  thCant: { width: '12%', textAlign: 'center' },
  thPrecio: { width: '21%', textAlign: 'right' },
  thImporte: { width: '21%', textAlign: 'right' },
  tituloGeneral: {
    marginTop: 8,
    marginBottom: 6,
    fontWeight: 'bold',
    fontSize: 9,
  },
  capTitulo: {
    marginTop: 10,
    marginBottom: 4,
    fontWeight: 'bold',
    fontSize: 9,
  },
  rowPartida: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ccc',
    borderBottomStyle: 'solid',
  },
  tdConcepto: { width: '46%', paddingRight: 6 },
  tdCant: { width: '12%', textAlign: 'center' },
  tdPrecio: { width: '21%', textAlign: 'right' },
  tdImporte: { width: '21%', textAlign: 'right' },
  totalCap: {
    marginTop: 4,
    marginBottom: 8,
    fontWeight: 'bold',
    fontSize: 8.5,
  },
  sepCap: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 6,
  },
  pieTotales: {
    marginTop: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#000',
    borderStyle: 'solid',
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8.5,
    fontWeight: 'bold',
  },
  pieCol: { width: '22%' },
  obs: {
    marginTop: 12,
    fontSize: 7.5,
    lineHeight: 1.35,
    textAlign: 'justify',
  },
  firmas: {
    marginTop: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 24,
  },
  firmaCol: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: '#000',
    borderTopStyle: 'solid',
    paddingTop: 6,
    minHeight: 48,
  },
  firmaLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  web: {
    marginTop: 18,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: 'bold',
  },
  fallback: {
    marginTop: 10,
    fontSize: 8,
    lineHeight: 1.35,
    fontFamily: 'Courier',
  },
});

function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function esCapituloGenerico(nombre: string): boolean {
  const n = nombre.trim().toLowerCase();
  // Coincidencia exacta únicamente — evitar falsos positivos con nombres reales de obra
  const exactos = [
    'general',
    'obra',
    'libertad',
    'varios',
    'otros',
    'sin título',
    'sin titulo',
    'capítulo 1',
    'capitulo 1',
    'capítulo general',
    'capitulo general',
  ];
  return exactos.includes(n);
}

export function PresupuestoPdfDocument(props: PresupuestoPdfProps) {
  const { logoUrl, numeroPresupuesto, referencia, fecha, parsed, textoPlanoFallback } = props;
  const showTabla = parsed.capitulos.length > 0;
  const showPie =
    parsed.baseImponible > 0 || parsed.importeIva > 0 || parsed.total > 0;
  const modoPlano =
    parsed.capitulos.length === 1 ||
    (parsed.capitulos.length > 0 && parsed.capitulos.every((c) => esCapituloGenerico(c.nombre)));

  return (
    <Document title={`Presupuesto ${numeroPresupuesto}`} language="es">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerRow}>
          {logoUrl ? (
            <Image style={styles.logo} src={logoUrl} />
          ) : (
            <View style={styles.logoPlaceholder} />
          )}
          <View style={styles.empresaBox}>
            <Text>AL&CA Pino Gutiérrez Albañilería en General S.L.</Text>
            <Text>C/ Bartolomé de Urdinso Nº 15 Local 1 Bis</Text>
            <Text>C.P. 20.301 Irún (Guipúzcoa)</Text>
            <Text>NIF: B-75207308  R.E.A. 15/20/0014364</Text>
            <Text>Oficina: 943 57 49 19  E-mail: info@pinoalbanileria.com</Text>
            <Text>Instagram: @pinoalbanileria</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text>
            <Text style={styles.metaLabel}>Nº PRESUPUESTO: </Text>
            {numeroPresupuesto}
          </Text>
          <Text style={{ maxWidth: '58%' }}>
            <Text style={styles.metaLabel}>REFERENCIA: </Text>
            {referencia}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text>
            <Text style={styles.metaLabel}>FECHA: </Text>
            {fecha}
          </Text>
          <Text> </Text>
        </View>

        {showTabla ? (
          <>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={styles.thConcepto}>CONCEPTO</Text>
              <Text style={styles.thCant}>CANTIDAD</Text>
              <Text style={styles.thPrecio}>PRECIO</Text>
              <Text style={styles.thImporte}>IMPORTE</Text>
            </View>

            {parsed.tituloGeneral ? (
              <Text style={styles.tituloGeneral}>{parsed.tituloGeneral}</Text>
            ) : null}

            {parsed.capitulos.map((cap, idx) => (
              <View key={`${cap.nombre}-${idx}`}>
                {!modoPlano ? (
                  <Text style={styles.capTitulo}>.-{cap.nombre.toUpperCase()}</Text>
                ) : null}
                {cap.partidas.map((p, j) => (
                  <View key={`${idx}-${j}`} style={styles.rowPartida} wrap={false}>
                    <Text style={styles.tdConcepto}>{p.concepto}</Text>
                    <Text style={styles.tdCant}>{fmtNum(p.cantidad)}</Text>
                    <Text style={styles.tdPrecio}>{formatEuro(p.precio)}</Text>
                    <Text style={styles.tdImporte}>{formatEuro(p.importe)}</Text>
                  </View>
                ))}
                {!modoPlano ? (
                  <Text style={styles.totalCap}>
                    TOTAL {cap.nombre.toUpperCase()} — {formatEuro(cap.total)}
                  </Text>
                ) : null}
                {!modoPlano && idx < parsed.capitulos.length - 1 ? (
                  <View style={styles.sepCap} />
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.fallback}>{textoPlanoFallback}</Text>
        )}

        {showPie ? (
          <View style={styles.pieTotales} wrap={false}>
            <Text style={styles.pieCol}>BASE IMPONIBLE{'\n'}{formatEuro(parsed.baseImponible)}</Text>
            <Text style={styles.pieCol}>
              % IVA{'\n'}
              {parsed.porcentajeIva}%
            </Text>
            <Text style={styles.pieCol}>IMPORTE IVA{'\n'}{formatEuro(parsed.importeIva)}</Text>
            <Text style={styles.pieCol}>TOTAL PRESUPUESTO{'\n'}{formatEuro(parsed.total)}</Text>
          </View>
        ) : null}

        <Text style={styles.obs}>
          <Text style={{ fontWeight: 'bold' }}>OBSERVACIONES: </Text>
          {OBSERVACIONES_TEXTO}
        </Text>

        <View style={styles.firmas}>
          <View style={styles.firmaCol}>
            <Text style={styles.firmaLabel}>CONFORME CLIENTE</Text>
          </View>
          <View style={styles.firmaCol}>
            <Text style={styles.firmaLabel}>CONFORME EMPRESA</Text>
          </View>
        </View>

        <Text style={styles.web}>www.pinoalbanileria.net</Text>
      </Page>
    </Document>
  );
}
