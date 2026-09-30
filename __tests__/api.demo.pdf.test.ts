/**
 * PDF de la demo: el render oficial recibe las cifras del mock, solo lo puede pedir el tenant demo
 * y la ruta nunca consulta datos en Supabase (solo la sesión).
 */
import type { NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { GET } from '@/app/api/demo/pdf/[tipo]/[id]/route';
import { DEMO_REFORMAS_EMAIL } from '@/lib/demo-tenant';

// @react-pdf/renderer es ESM: se sustituye por un stub y se inspecciona el documento que recibiría.
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Image: 'Image',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: jest.fn(),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a) },
    from: (...a: unknown[]) => mockFrom(...a),
  }),
  createServiceClient: () => {
    throw new Error('la ruta demo no debe usar el service client');
  },
}));

const renderMock = renderToBuffer as jest.MockedFunction<typeof renderToBuffer>;

type DocProps = Record<string, unknown> & {
  parsed?: { baseImponible: number; importeIva: number; total: number };
  factura?: { numero_factura: string; base_imponible: number; iva: number; total: number; cliente_nombre: string };
  empresa: { razonSocial: string; telefono: string; email: string };
};

function llamar(tipo: string, id: string) {
  return GET({} as NextRequest, { params: Promise.resolve({ tipo, id }) });
}

function docRenderizado(): { props: DocProps } {
  return renderMock.mock.calls[0][0] as unknown as { props: DocProps };
}

beforeEach(() => {
  jest.clearAllMocks();
  renderMock.mockResolvedValue(Buffer.from('%PDF-demo'));
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: DEMO_REFORMAS_EMAIL } } });
});

describe('GET /api/demo/pdf/[tipo]/[id]', () => {
  it('presupuesto P1: el render oficial recibe las cifras del mock y la empresa demo', async () => {
    const res = await llamar('presupuesto', 'demo-presupuesto-1');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="presupuesto-\d{4}-\d{2}-\d{2}\.pdf"$/);
    const { props } = docRenderizado();
    expect(props.parsed).toMatchObject({ baseImponible: 24850, importeIva: 5218.5, total: 30068.5 });
    expect(props.empresa.razonSocial).toBe('Orbegozo Dekorazio');
    expect(props.empresa.email).toBe('hola@orbegozo-dekorazio.example.com');
    expect(props.referencia).toBe('Reforma integral piso Algorta');
    expect(props.numeroPresupuesto).toBe('2');
  });

  it('factura F4: el render oficial recibe las cifras del mock', async () => {
    const res = await llamar('factura', 'demo-factura-4');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const { props } = docRenderizado();
    expect(props.factura).toMatchObject({
      base_imponible: 4970,
      iva: 1043.7,
      total: 6013.7,
      cliente_nombre: 'Nerea Urrutia',
    });
    expect(props.factura?.numero_factura).toMatch(/^F-\d{4}-\d{3}$/);
    expect(props.porcentajeIva).toBe(21);
    expect(props.empresa.razonSocial).toBe('Orbegozo Dekorazio');
  });

  it('con un usuario que no es la demo devuelve 403 y no renderiza nada', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u2', email: 'otro@cliente.com' } } });

    for (const [tipo, id] of [
      ['presupuesto', 'demo-presupuesto-1'],
      ['factura', 'demo-factura-4'],
    ]) {
      const res = await llamar(tipo, id);
      expect(res.status).toBe(403);
    }
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('sin sesión devuelve 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await llamar('presupuesto', 'demo-presupuesto-1');
    expect(res.status).toBe(401);
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('404 para ids o tipos desconocidos', async () => {
    expect((await llamar('presupuesto', 'no-existe')).status).toBe(404);
    expect((await llamar('factura', 'no-existe')).status).toBe(404);
    expect((await llamar('albaran', 'demo-albaran-1')).status).toBe(404);
  });

  it('nunca lee ni escribe datos en Supabase', async () => {
    await llamar('presupuesto', 'demo-presupuesto-1');
    await llamar('factura', 'demo-factura-1');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
