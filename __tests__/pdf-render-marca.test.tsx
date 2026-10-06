/**
 * Render de presupuesto y factura con y sin marca.
 *
 * @react-pdf/renderer es solo ESM y Jest no puede cargarlo, así que se sustituye por un doble que
 * pinta el mismo árbol de componentes como HTML (con los estilos de cada elemento en `data-style`).
 * Así se comprueba que NUESTRO código de las plantillas no lanza con ninguna combinación de marca y
 * que los colores/fuentes/observaciones llegan al documento. El PDF real se verifica a mano
 * (ver «Cómo probarlo» en el PR).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@react-pdf/renderer', () => {
  const R = jest.requireActual('react') as typeof import('react');
  const { renderToStaticMarkup: toHtml } = jest.requireActual('react-dom/server') as typeof import('react-dom/server');
  const aplanar = (s: unknown): Record<string, unknown> =>
    Array.isArray(s) ? Object.assign({}, ...s.map(aplanar)) : ((s as Record<string, unknown>) ?? {});
  const caja =
    (tag: string) =>
    ({ style, children }: { style?: unknown; children?: React.ReactNode }) =>
      R.createElement(tag, { 'data-style': JSON.stringify(aplanar(style)) }, children);
  return {
    Document: caja('div'),
    Page: caja('section'),
    View: caja('div'),
    Text: caja('span'),
    Image: ({ src }: { src: string }) => R.createElement('img', { src, alt: '' }),
    StyleSheet: { create: (s: unknown) => s },
    renderToBuffer: async (el: React.ReactElement) => Buffer.from(toHtml(el)),
  };
});

import { renderPresupuestoPdfConEmisor } from '@/lib/pdf/presupuesto-render';
import { renderFacturaPdfConEmisor } from '@/lib/pdf/factura-render';
import { empresaDesdePerfil } from '@/lib/pdf/empresa';
import { presupuestoMuestra } from '@/lib/pdf/muestra';
import { MARCA_VACIA, OBSERVACIONES_PRESUPUESTO_DEFECTO, type MarcaPdf } from '@/lib/pdf/marca';
import { DEMO_EMPRESA_EMISOR, DEMO_MARCA } from '@/lib/demo-data';

void renderToStaticMarkup;

const empresa = empresaDesdePerfil({ razon_social: 'Estudio X S.L.', nif: 'B1', web: 'www.x.es' });
const MARCA_COMPLETA: MarcaPdf = {
  colorPrimario: '#7A7A1E',
  colorSecundario: '#F3F3DC',
  tipografia: 'Times-Roman',
  observacionesPresupuesto: 'Oferta válida 15 días.',
};

const factura = {
  id: 'f1',
  numero_factura: 7,
  fecha: '2026-10-06',
  cliente_nombre: 'Ana',
  cliente_nif: 'B2',
  cliente_direccion: 'Calle Mayor 1, Irún',
  lineas: [
    { descripcion: 'Alicatado', cantidad: 10, precio_unitario: 30, importe: 300, capitulo: 'Baño' },
    { descripcion: 'Pintura', cantidad: 2, precio_unitario: 50, importe: 100 },
  ],
  base_imponible: 400,
  iva: 84,
  total: 484,
};

async function presupuestoHtml(marca?: MarcaPdf) {
  const r = await renderPresupuestoPdfConEmisor({ empresa, logoUrl: null, marca }, presupuestoMuestra());
  if (!r.ok) throw new Error(r.error);
  return r.buffer.toString();
}
async function facturaHtml(marca?: MarcaPdf) {
  const r = await renderFacturaPdfConEmisor({ empresa, logoUrl: null, marca }, factura);
  if (!r.ok) throw new Error(r.error);
  return r.buffer.toString();
}

describe('presupuesto', () => {
  it.each([
    ['sin marca (campo ausente)', undefined],
    ['marca vacía', MARCA_VACIA],
    ['marca completa', MARCA_COMPLETA],
    ['solo color', { ...MARCA_VACIA, colorPrimario: '#112233' }],
    ['marca demo', DEMO_MARCA],
  ])('se renderiza (%s)', async (_n, marca) => {
    const html = await presupuestoHtml(marca as MarcaPdf | undefined);
    expect(html).toContain('Demolición de tabique');
    expect(html).toContain('2346,19');
  });

  it('sin marca lleva el texto de observaciones de siempre y la cabecera #1e3a8a', async () => {
    const html = await presupuestoHtml();
    expect(html).toContain(OBSERVACIONES_PRESUPUESTO_DEFECTO);
    expect(html).toContain('#1e3a8a');
    expect(html).toContain('Helvetica');
    expect(html).not.toContain('Times-Roman');
  });

  it('con marca usa sus colores, su fuente y sus observaciones', async () => {
    const html = await presupuestoHtml(MARCA_COMPLETA);
    expect(html).toContain('#7A7A1E');
    expect(html).toContain('#F3F3DC');
    expect(html).toContain('Times-Roman');
    expect(html).toContain('Oferta válida 15 días.');
    expect(html).not.toContain(OBSERVACIONES_PRESUPUESTO_DEFECTO);
    expect(html).not.toContain('#1e3a8a');
  });

  it('la demo enseña la marca del estudio', async () => {
    const r = await renderPresupuestoPdfConEmisor(
      { empresa: DEMO_EMPRESA_EMISOR, logoUrl: null, marca: DEMO_MARCA },
      presupuestoMuestra()
    );
    expect(r.ok && r.buffer.toString()).toContain(DEMO_MARCA.colorPrimario);
  });
});

describe('factura', () => {
  it.each([
    ['sin marca', undefined],
    ['marca vacía', MARCA_VACIA],
    ['marca completa', MARCA_COMPLETA],
  ])('se renderiza (%s)', async (_n, marca) => {
    const html = await facturaHtml(marca as MarcaPdf | undefined);
    expect(html).toContain('Alicatado');
  });

  it('sin marca conserva los colores de siempre', async () => {
    const html = await facturaHtml();
    expect(html).toContain('#1a365d');
    expect(html).toContain('#f5f5f5');
    expect(html).toContain('#fafafa');
  });

  it('con marca los aplica', async () => {
    const html = await facturaHtml(MARCA_COMPLETA);
    expect(html).toContain('#7A7A1E');
    expect(html).toContain('#F3F3DC');
    expect(html).not.toContain('#1a365d');
    expect(html).toContain('Times-Roman');
  });
});
