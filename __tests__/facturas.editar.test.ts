import { NextRequest } from 'next/server';
import { actualizarFactura } from '@/lib/facturas/editar';
import { crearFakeDb, type Fila } from './helpers/fake-db';

const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const OTRO = '900ed462-7640-4893-9030-a41163219f7a';

const factura = (extra: Fila = {}): Fila => ({
  id: 'fac-1',
  business_id: BIZ,
  numero_factura: 7,
  estado: 'pendiente',
  cliente_nombre: 'Ana',
  base_imponible: 100,
  iva: 10,
  total: 110,
  lineas: [],
  descripcion_trabajos: 'antes',
  ...extra,
});

const lineas = [
  { descripcion: 'Alicatado', cantidad: 10, precio_unitario: 30.555, unidad: 'm2', capitulo: 'Baño' },
  { descripcion: 'Plato ducha', cantidad: 1, precio_unitario: 200 },
];

describe('actualizarFactura', () => {
  it('recalcula base, IVA y total en el servidor y guarda las líneas', async () => {
    const d = crearFakeDb({ facturas: [factura()] });
    const r = await actualizarFactura(d.client, BIZ, 'fac-1', {
      cliente_nombre: '  Ana López ',
      lineas,
      iva_porcentaje: 21,
      // lo que mande el cliente como importe se ignora
      total: 1,
      base_imponible: 1,
    });
    expect(r.ok).toBe(true);
    const f = d.tablas.facturas[0];
    expect(f.cliente_nombre).toBe('Ana López');
    expect(f.lineas).toEqual([
      { descripcion: 'Alicatado', cantidad: 10, unidad: 'm2', precio_unitario: 30.555, importe: 305.55, capitulo: 'Baño' },
      { descripcion: 'Plato ducha', cantidad: 1, unidad: null, precio_unitario: 200, importe: 200, capitulo: null },
    ]);
    expect(f.base_imponible).toBe(505.55);
    expect(f.iva).toBe(106.17);
    expect(f.total).toBe(611.72);
    expect(String(f.descripcion_trabajos)).toContain('Alicatado — 10 m2 × 30.555 € = 305.55 €');
    expect(String(f.descripcion_trabajos)).not.toContain('__PERFILIO');
  });

  it('con IVA 10% calcula el 10%', async () => {
    const d = crearFakeDb({ facturas: [factura()] });
    await actualizarFactura(d.client, BIZ, 'fac-1', {
      cliente_nombre: 'Ana',
      lineas: [{ descripcion: 'Obra', cantidad: 1, precio_unitario: 1000 }],
      iva_porcentaje: 10,
    });
    expect(d.tablas.facturas[0]).toMatchObject({ base_imponible: 1000, iva: 100, total: 1100 });
  });

  it('sin iva_porcentaje conserva el IVA que ya tenía la factura (10%)', async () => {
    const d = crearFakeDb({ facturas: [factura()] });
    await actualizarFactura(d.client, BIZ, 'fac-1', {
      cliente_nombre: 'Ana',
      lineas: [{ descripcion: 'Obra', cantidad: 2, precio_unitario: 500 }],
    });
    expect(d.tablas.facturas[0]).toMatchObject({ base_imponible: 1000, iva: 100, total: 1100 });
  });

  it('sin iva_porcentaje y sin base previa usa 21%', async () => {
    const d = crearFakeDb({ facturas: [factura({ base_imponible: 0, iva: 0 })] });
    await actualizarFactura(d.client, BIZ, 'fac-1', {
      cliente_nombre: 'Ana',
      lineas: [{ descripcion: 'Obra', cantidad: 1, precio_unitario: 100 }],
    });
    expect(d.tablas.facturas[0]).toMatchObject({ iva: 21, total: 121 });
  });

  it.each([
    ['cliente vacío', { cliente_nombre: ' ', lineas }],
    ['sin líneas', { cliente_nombre: 'Ana', lineas: [] }],
    ['descripción vacía', { cliente_nombre: 'Ana', lineas: [{ descripcion: ' ', cantidad: 1, precio_unitario: 1 }] }],
    ['cantidad 0', { cliente_nombre: 'Ana', lineas: [{ descripcion: 'x', cantidad: 0, precio_unitario: 1 }] }],
    ['precio negativo', { cliente_nombre: 'Ana', lineas: [{ descripcion: 'x', cantidad: 1, precio_unitario: -1 }] }],
    ['IVA no permitido', { cliente_nombre: 'Ana', lineas, iva_porcentaje: 18 }],
    ['más de 200 líneas', { cliente_nombre: 'Ana', lineas: Array.from({ length: 201 }, () => lineas[1]) }],
  ])('rechaza (%s) sin tocar la factura', async (_n, input) => {
    const d = crearFakeDb({ facturas: [factura()] });
    const r = await actualizarFactura(d.client, BIZ, 'fac-1', input);
    expect(r).toMatchObject({ ok: false, code: 'validacion' });
    expect(d.updates).toHaveLength(0);
  });

  it('no encuentra facturas de otro negocio', async () => {
    const d = crearFakeDb({ facturas: [factura({ business_id: OTRO })] });
    const r = await actualizarFactura(d.client, BIZ, 'fac-1', { cliente_nombre: 'Ana', lineas });
    expect(r).toMatchObject({ ok: false, code: 'no_encontrada' });
    expect(d.updates).toHaveLength(0);
  });

  it('no deja editar facturas pagadas o vencidas', async () => {
    for (const estado of ['pagada', 'vencida']) {
      const d = crearFakeDb({ facturas: [factura({ estado })] });
      const r = await actualizarFactura(d.client, BIZ, 'fac-1', { cliente_nombre: 'Ana', lineas });
      expect(r).toMatchObject({ ok: false, code: 'no_editable' });
      expect(d.updates).toHaveLength(0);
    }
  });

  it('la escritura filtra siempre por id y business_id', async () => {
    const d = crearFakeDb({ facturas: [factura()] });
    await actualizarFactura(d.client, BIZ, 'fac-1', { cliente_nombre: 'Ana', lineas });
    expect(d.updates[0].filtros).toEqual(
      expect.arrayContaining([
        ['id', 'fac-1'],
        ['business_id', BIZ],
      ])
    );
  });
});

// ---------- Ruta PATCH /api/facturas/[id] ----------
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({
  assertUserOwnsBusiness: jest.fn(),
}));

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';

describe('PATCH /api/facturas/[id]', () => {
  let PATCH: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  beforeAll(async () => {
    PATCH = (await import('@/app/api/facturas/[id]/route')).PATCH;
  });

  const peticion = (body: unknown) =>
    new NextRequest('http://localhost/api/facturas/fac-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  const ctx = { params: Promise.resolve({ id: 'fac-1' }) };
  const cuerpo = { cliente_nombre: 'Ana', lineas: [{ descripcion: 'Obra', cantidad: 1, precio_unitario: 100 }], iva_porcentaje: 21 };

  function preparar(opts: { user?: boolean; owns?: boolean; tablas?: Record<string, Fila[]> }) {
    const d = crearFakeDb(opts.tablas ?? { facturas: [factura()] });
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: opts.user === false ? null : { id: 'u1' } } }) },
    });
    (createServiceClient as jest.Mock).mockReturnValue(d.client);
    (assertUserOwnsBusiness as jest.Mock).mockResolvedValue(opts.owns !== false);
    return d;
  }

  beforeEach(() => jest.clearAllMocks());

  it('401 sin sesión', async () => {
    preparar({ user: false });
    expect((await PATCH(peticion(cuerpo), ctx)).status).toBe(401);
  });

  it('404 si la factura no existe', async () => {
    preparar({ tablas: { facturas: [] } });
    expect((await PATCH(peticion(cuerpo), ctx)).status).toBe(404);
  });

  it('403 si la factura es de un negocio que no es del usuario, sin escribir', async () => {
    const d = preparar({ owns: false });
    expect((await PATCH(peticion(cuerpo), ctx)).status).toBe(403);
    expect(assertUserOwnsBusiness).toHaveBeenCalledWith(expect.anything(), 'u1', BIZ);
    expect(d.updates).toHaveLength(0);
  });

  it('400 con el detalle en español si el cuerpo no es válido', async () => {
    const d = preparar({});
    const res = await PATCH(peticion({ cliente_nombre: 'Ana', lineas: [] }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/al menos una línea/);
    expect(d.updates).toHaveLength(0);
  });

  it('409 si la factura ya no está pendiente', async () => {
    preparar({ tablas: { facturas: [factura({ estado: 'pagada' })] } });
    expect((await PATCH(peticion(cuerpo), ctx)).status).toBe(409);
  });

  it('200 con la factura recalculada y filtrando por business_id', async () => {
    const d = preparar({});
    const res = await PATCH(peticion({ ...cuerpo, total: 1 }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.factura).toMatchObject({ base_imponible: 100, iva: 21, total: 121 });
    expect(d.updates[0].filtros).toEqual(expect.arrayContaining([['business_id', BIZ]]));
  });
});
