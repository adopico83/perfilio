import React from 'react';
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import { formatEuro } from './parser';

export interface FacturaPdfProps {
  factura: {
    id: string;
    numero_factura: number;
    fecha: string;
    fecha_operacion?: string | null;
    cliente_nombre: string;
    cliente_nif?: string;
    cliente_direccion?: string;
    lineas: Array<{
      descripcion: string;
      cantidad: number;
      precio_unitario: number;
      importe: number;
      capitulo?: string;
    }>;
    base_imponible: number;
    iva: number;
    total: number;
    observaciones?: string;
  };
  logoUrl?: string | null;
  empresa: {
    nombre: string;
    nif: string;
    direccion: string;
    telefono?: string;
    email?: string;
  };
  /** Porcentaje IVA aplicado al documento (p. ej. 21). */
  porcentajeIva: number;
}

/** Datos emisor Pino (TicketBAI); hardcoded según especificación. */
const PINO_EMISOR = {
  nif: 'B-75207308',
  nombre: 'AL&CA Pino Gutiérrez Albañilería en General S.L.',
  direccion: 'C/ Bartolomé de Urdinso Nº 15 Local 1 Bis',
  cpCiudad: '20301 Irún (Guipúzcoa)',
  telefono: '943 57 49 19',
  email: 'info@pinoalbanileria.com',
} as const;

const NAVY = '#1a365d';
const GRIS_FONDO = '#f5f5f5';
const GRIS_FILA = '#fafafa';

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 24,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  /** Sección 1 */
  seccion1: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  s1LogoWrap: { width: '22%' },
  logo: {
    width: 92,
    maxHeight: 52,
    objectFit: 'contain',
  },
  logoPlaceholder: {
    width: 92,
    height: 44,
  },
  s1TituloWrap: {
    width: '36%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 4,
  },
  s1Titulo: {
    fontSize: 14,
    fontWeight: 'bold',
    color: NAVY,
    textAlign: 'center',
  },
  s1MetaWrap: {
    width: '42%',
    paddingLeft: 6,
    fontSize: 8.5,
    lineHeight: 1.35,
  },
  s1MetaLine: {
    marginBottom: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  s1MetaLabel: { fontWeight: 'bold' },
  /** Sección 2 */
  seccion2: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  cajaGris: {
    flex: 1,
    backgroundColor: GRIS_FONDO,
    borderWidth: 1,
    borderColor: '#c4c4c4',
    borderStyle: 'solid',
    padding: 8,
    fontSize: 9,
    lineHeight: 1.35,
  },
  cajaGrisCliente: {
    flex: 1,
    marginLeft: 10,
    backgroundColor: GRIS_FONDO,
    borderWidth: 1,
    borderColor: '#c4c4c4',
    borderStyle: 'solid',
    padding: 8,
    fontSize: 9,
    lineHeight: 1.35,
  },
  tituloCliente: {
    fontSize: 9,
    fontWeight: 'bold',
    color: NAVY,
    marginBottom: 6,
  },
  emisorNifNombre: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  emisorNif: {
    fontWeight: 'bold',
    marginRight: 10,
  },
  emisorNombre: {
    fontWeight: 'bold',
    flex: 1,
  },
  telEmailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  telBlock: { marginRight: 14 },
  /** Tabla líneas */
  thLineas: {
    flexDirection: 'row',
    backgroundColor: NAVY,
    color: '#fff',
    paddingVertical: 4,
    paddingHorizontal: 3,
    fontWeight: 'bold',
    fontSize: 7.5,
    marginTop: 4,
  },
  thCell: { textAlign: 'center' },
  thCellLeft: { textAlign: 'left' },
  thCellRight: { textAlign: 'right' },
  rowLinea: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
    borderBottomStyle: 'solid',
    fontSize: 8.5,
  },
  rowLineaAlt: {
    backgroundColor: GRIS_FILA,
  },
  tdCell: { textAlign: 'center' },
  tdCellLeft: { textAlign: 'left', paddingRight: 2 },
  tdCellRight: { textAlign: 'right' },
  /** Anchos 8 cols ≈ 100% */
  wDesc: { width: '26%' },
  wCant: { width: '8%' },
  wPrecio: { width: '10%' },
  wDto: { width: '6%' },
  wBase: { width: '13%' },
  wIva: { width: '9%' },
  wRe: { width: '6%' },
  wTot: { width: '14%' },
  /** Sección 4 totales */
  totalesTabla: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#999',
    borderStyle: 'solid',
  },
  totalesTh: {
    flexDirection: 'row',
    backgroundColor: NAVY,
    color: '#fff',
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontWeight: 'bold',
    fontSize: 7.5,
  },
  totalesTd: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontSize: 8.5,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    borderTopStyle: 'solid',
  },
  totCol1: { width: '22%', textAlign: 'left' },
  totCol2: { width: '38%', textAlign: 'center' },
  totCol3: { width: '20%', textAlign: 'center' },
  totCol4: { width: '20%', textAlign: 'right', fontWeight: 'bold' },
  resumenDcha: {
    marginTop: 8,
    alignSelf: 'flex-end',
    width: '48%',
    fontSize: 8.5,
  },
  resumenLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  resumenLineBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#000',
    borderTopStyle: 'solid',
    fontSize: 10,
    fontWeight: 'bold',
  },
  bancos: {
    marginTop: 14,
    fontSize: 8.5,
    lineHeight: 1.4,
  },
  bancosTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
    fontSize: 10,
  },
  obs: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 1.3,
    textAlign: 'justify',
  },
  pie: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: 8.5,
    fontWeight: 'bold',
  },
  pieSoft: {
    marginTop: 3,
    textAlign: 'center',
    fontSize: 8.5,
    color: '#444',
  },
});

function fmtCant(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(n);
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtCeroEuro(): string {
  return formatEuro(0);
}

function splitDirCiudad(full: string | undefined): { dir: string; ciudad: string } {
  const s = (full ?? '').trim();
  if (!s) return { dir: '—', ciudad: '—' };
  const lastComma = s.lastIndexOf(',');
  if (lastComma <= 0) return { dir: s, ciudad: '—' };
  return { dir: s.slice(0, lastComma).trim(), ciudad: s.slice(lastComma + 1).trim() };
}

export function FacturaPdfDocument(props: FacturaPdfProps) {
  const { factura, logoUrl, porcentajeIva, empresa: _empresa } = props;
  void _empresa;
  const pct = Number.isFinite(porcentajeIva) ? porcentajeIva : 21;
  const fechaOp = factura.fecha_operacion?.trim() ? factura.fecha_operacion : '—';
  const { dir: clienteDir, ciudad: clienteCiudad } = splitDirCiudad(factura.cliente_direccion);

  return (
    <Document title={`Factura ${factura.numero_factura}`} language="es">
      <Page size="A4" style={styles.page} wrap>
        {/* Sección 1 — header */}
        <View style={styles.seccion1}>
          <View style={styles.s1LogoWrap}>
            {logoUrl ? (
              <Image style={styles.logo} src={logoUrl} />
            ) : (
              <View style={styles.logoPlaceholder} />
            )}
          </View>
          <View style={styles.s1TituloWrap}>
            <Text style={styles.s1Titulo}>FAKTURA / FACTURA</Text>
          </View>
          <View style={styles.s1MetaWrap}>
            <View style={styles.s1MetaLine} wrap={false}>
              <Text>
                <Text style={styles.s1MetaLabel}>Zenbakia / Número : </Text>
                {factura.numero_factura}
              </Text>
            </View>
            <View style={styles.s1MetaLine} wrap={false}>
              <Text>
                <Text style={styles.s1MetaLabel}>Jaulkipena / Emisión : </Text>
                {factura.fecha}
              </Text>
            </View>
            <View style={styles.s1MetaLine} wrap={false}>
              <Text>
                <Text style={styles.s1MetaLabel}>Eragiketa / Operación : </Text>
                {fechaOp}
              </Text>
            </View>
            <View style={styles.s1MetaLine} wrap={false}>
              <Text>
                <Text style={styles.s1MetaLabel}>Mota / Tipo : </Text>
                Osoa / Completa
              </Text>
            </View>
            <View style={styles.s1MetaLine} wrap={false}>
              <Text>
                <Text style={styles.s1MetaLabel}>Deskribapena / Descripción : </Text>
                Factura por trabajos realizados
              </Text>
            </View>
          </View>
        </View>

        {/* Sección 2 — emisor + cliente */}
        <View style={styles.seccion2}>
          <View style={styles.cajaGris}>
            <View style={styles.emisorNifNombre} wrap={false}>
              <Text style={styles.emisorNif}>{PINO_EMISOR.nif}</Text>
              <Text style={styles.emisorNombre}>{PINO_EMISOR.nombre}</Text>
            </View>
            <Text>{PINO_EMISOR.direccion}</Text>
            <Text>{PINO_EMISOR.cpCiudad}</Text>
            <View style={styles.telEmailRow} wrap={false}>
              <Text style={styles.telBlock}>
                <Text style={{ fontWeight: 'bold' }}>Tel.: </Text>
                {PINO_EMISOR.telefono}
              </Text>
              <Text>
                <Text style={{ fontWeight: 'bold' }}>Email: </Text>
                {PINO_EMISOR.email}
              </Text>
            </View>
          </View>
          <View style={styles.cajaGrisCliente}>
            <Text style={styles.tituloCliente}>BEZEROA / CLIENTE</Text>
            <Text>
              <Text style={{ fontWeight: 'bold' }}>NIF: </Text>
              {factura.cliente_nif?.trim() || '—'}
            </Text>
            <Text>
              <Text style={{ fontWeight: 'bold' }}>Nombre: </Text>
              {factura.cliente_nombre || '—'}
            </Text>
            <Text>
              <Text style={{ fontWeight: 'bold' }}>Dirección: </Text>
              {clienteDir}
            </Text>
            <Text>
              <Text style={{ fontWeight: 'bold' }}>Ciudad: </Text>
              {clienteCiudad}
            </Text>
          </View>
        </View>

        {/* Sección 3 — líneas */}
        <View style={styles.thLineas} wrap={false}>
          <Text style={[styles.wDesc, styles.thCellLeft]}>
            Deskribapena{'\n'}/ Concepto
          </Text>
          <Text style={[styles.wCant, styles.thCell]}>
            Kopurua{'\n'}/ Cantidad
          </Text>
          <Text style={[styles.wPrecio, styles.thCellRight]}>
            Prezioa{'\n'}/ Precio
          </Text>
          <Text style={[styles.wDto, styles.thCell]}>
            Dtu.%{'\n'}/ % Dto
          </Text>
          <Text style={[styles.wBase, styles.thCellRight]}>
            Oinarria{'\n'}/ Base
          </Text>
          <Text style={[styles.wIva, styles.thCell]}>
            BEZ%{'\n'}/ % IVA
          </Text>
          <Text style={[styles.wRe, styles.thCell]}>
            B.E.%{'\n'}/ % RE
          </Text>
          <Text style={[styles.wTot, styles.thCellRight]}>
            Guztira{'\n'}/ Total
          </Text>
        </View>

        {factura.lineas.map((linea, idx) => {
          const baseLinea = Number(linea.importe) || 0;
          const totalLinea = r2(baseLinea * (1 + pct / 100));
          const rowStyle = idx % 2 === 1 ? [styles.rowLinea, styles.rowLineaAlt] : styles.rowLinea;
          return (
            <View key={`line-${idx}`} style={rowStyle} wrap={false}>
              <Text style={[styles.wDesc, styles.tdCellLeft]}>{linea.descripcion}</Text>
              <Text style={[styles.wCant, styles.tdCell]}>{fmtCant(Number(linea.cantidad) || 0)}</Text>
              <Text style={[styles.wPrecio, styles.tdCellRight]}>
                {formatEuro(Number(linea.precio_unitario) || 0)}
              </Text>
              <Text style={[styles.wDto, styles.tdCell]}>—</Text>
              <Text style={[styles.wBase, styles.tdCellRight]}>{formatEuro(baseLinea)}</Text>
              <Text style={[styles.wIva, styles.tdCell]}>{pct}%</Text>
              <Text style={[styles.wRe, styles.tdCell]}>—</Text>
              <Text style={[styles.wTot, styles.tdCellRight]}>{formatEuro(totalLinea)}</Text>
            </View>
          );
        })}

        {/* Sección 4 — tabla totales + resumen */}
        <View style={styles.totalesTabla} wrap={false}>
          <View style={styles.totalesTh}>
            <Text style={styles.totCol1}>
              Oinarria{'\n'}/ Base
            </Text>
            <Text style={styles.totCol2}>
              BEZa beste zergak{'\n'}/ IVA otros impuestos
            </Text>
            <Text style={styles.totCol3}>
              Errekargua{'\n'}/ Recargo
            </Text>
            <Text style={styles.totCol4}>Guztira{'\n'}/ Total</Text>
          </View>
          <View style={styles.totalesTd}>
            <Text style={styles.totCol1}>
              {formatEuro(factura.base_imponible)}
            </Text>
            <Text style={styles.totCol2}>
              {pct}% — {formatEuro(factura.iva)}
            </Text>
            <Text style={styles.totCol3}>
              0%{'\n'}
              {fmtCeroEuro()}
            </Text>
            <Text style={styles.totCol4}>{formatEuro(factura.total)}</Text>
          </View>
        </View>

        <View style={styles.resumenDcha}>
          <View style={styles.resumenLine} wrap={false}>
            <Text>Zerga oinarria / Base imponible:</Text>
            <Text>{formatEuro(factura.base_imponible)}</Text>
          </View>
          <View style={styles.resumenLine} wrap={false}>
            <Text>BEZ Kuota / Cuota IVA:</Text>
            <Text>{formatEuro(factura.iva)}</Text>
          </View>
          <View style={styles.resumenLineBold} wrap={false}>
            <Text>Zenbateko osoa / Importe total:</Text>
            <Text>{formatEuro(factura.total)}</Text>
          </View>
        </View>

        {factura.observaciones?.trim() ? (
          <Text style={styles.obs}>
            <Text style={{ fontWeight: 'bold' }}>Observaciones: </Text>
            {factura.observaciones.trim()}
          </Text>
        ) : null}

        {/* Sección 5 */}
        <View style={styles.bancos}>
          <Text style={styles.bancosTitle}>Cuentas bancarias</Text>
          <Text>KUTXABANK: ES63 2095 5086 1091 2060 8015</Text>
          <Text>BANCO SABADELL: ES40 0081 4332 4000 0111 1021</Text>
        </View>

        <Text style={styles.pie}>www.pinoalbanileria.net</Text>
        <Text style={styles.pieSoft}>Software: Perfilio</Text>
      </Page>
    </Document>
  );
}
