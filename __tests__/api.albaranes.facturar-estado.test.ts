import { NextRequest } from 'next/server';
import { crearFakeDb, type Fila } from './helpers/fake-db';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceClient: jest.fn() }));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: jest.fn() }));

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';

const BIZ = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const ctx = { params: Promise.resolve({ id: 'alb-1' }) };
const alb = (extra: Fila = {}): Fila => ({
  id: 'alb-1', business_id: BIZ, numero_albaran: 13, estado: 'entregado', cliente_nombre: 'Ana', total: 121, lineas: null, ...extra,
});
const req = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

function preparar(o: { user?: boolean; owns?: boolean; tablas?: Record<string, Fila[]> } = {}) {
  const d = crearFakeDb(o.tablas ?? { albaranes: [alb()], facturas: [], presupuestos: [] });
  (createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: o.user === false ? null : { id: 'u1' } } }) },
  });
  (createServiceClient as jest.Mock).mockReturnValue(d.client);
  (assertUserOwnsBusiness as jest.Mock).mockResolvedValue(o.owns !== false);
  return d;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/albaranes/[id]/facturar', () => {
  let POST: (r: NextRequest, c: typeof ctx) => Promise<Response>;
  beforeAll(async () => { POST = (await import('@/app/api/albaranes/[id]/facturar/route')).POST; });

  it('401 sin sesión', async () => { preparar({ user: false }); expect((await POST(req({}), ctx)).status).toBe(401); });
  it('404 si no existe', async () => { preparar({ tablas: { albaranes: [] } }); expect((await POST(req({}), ctx)).status).toBe(404); });
  it('403 si es de otro negocio, sin escribir', async () => {
    const d = preparar({ owns: false });
    expect((await POST(req({ iva_porcentaje: 21 }), ctx)).status).toBe(403);
    expect(assertUserOwnsBusiness).toHaveBeenCalledWith(expect.anything(), 'u1', BIZ);
    expect(d.inserts).toHaveLength(0);
  });
  it('400 con IVA no permitido', async () => {
    const d = preparar();
    expect((await POST(req({ iva_porcentaje: 18 }), ctx)).status).toBe(400);
    expect(d.inserts).toHaveLength(0);
  });
  it('409 si figura facturado sin factura', async () => {
    preparar({ tablas: { albaranes: [alb({ estado: 'facturado' })], facturas: [], presupuestos: [] } });
    expect((await POST(req({ iva_porcentaje: 21 }), ctx)).status).toBe(409);
  });
  it('(d) devuelve el aviso cuando no se pudo marcar el albarán', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const d = preparar();
    d.erroresUpdate.albaranes = [{ message: 'permission denied' }];
    const res = await POST(req({ iva_porcentaje: 21 }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, numero_factura: 1, aviso: expect.stringMatching(/no se pudo marcar como facturado/) });
  });

  it('200 con número de factura y filtrando por business_id', async () => {
    const d = preparar();
    const res = await POST(req({ iva_porcentaje: 10 }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, numero_factura: 1, total: 121, ya_existia: false });
    expect(d.updates[0].filtros).toEqual(expect.arrayContaining([['business_id', BIZ]]));
    expect(d.consultas.filter((c) => c.tabla === 'presupuestos' || c.tabla === 'facturas').every((c) => c.filtros.some(([k, v]) => k === 'business_id' && v === BIZ))).toBe(true);
  });
});

describe('PATCH /api/albaranes/[id]/estado', () => {
  let PATCH: (r: NextRequest, c: typeof ctx) => Promise<Response>;
  beforeAll(async () => { PATCH = (await import('@/app/api/albaranes/[id]/estado/route')).PATCH; });
  const patch = (body: unknown) => new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) });

  it('401 / 404 / 403', async () => {
    preparar({ user: false });
    expect((await PATCH(patch({ estado: 'entregado' }), ctx)).status).toBe(401);
    preparar({ tablas: { albaranes: [] } });
    expect((await PATCH(patch({ estado: 'entregado' }), ctx)).status).toBe(404);
    const d = preparar({ owns: false });
    expect((await PATCH(patch({ estado: 'entregado' }), ctx)).status).toBe(403);
    expect(d.updates).toHaveLength(0);
  });
  it('400 con estado desconocido y con «facturado» (explica por qué)', async () => {
    preparar();
    expect((await PATCH(patch({ estado: 'x' }), ctx)).status).toBe(400);
    const res = await PATCH(patch({ estado: 'facturado' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/factura/);
  });
  it('409 si ya está facturado', async () => {
    preparar({ tablas: { albaranes: [alb({ estado: 'facturado' })] } });
    expect((await PATCH(patch({ estado: 'pendiente' }), ctx)).status).toBe(409);
  });
  it('200 y actualiza solo ese negocio', async () => {
    const d = preparar({ tablas: { albaranes: [alb({ estado: 'pendiente' })] } });
    const res = await PATCH(patch({ estado: 'entregado' }), ctx);
    expect(res.status).toBe(200);
    expect(d.tablas.albaranes[0].estado).toBe('entregado');
    expect(d.updates[0].filtros).toEqual(expect.arrayContaining([['id', 'alb-1'], ['business_id', BIZ]]));
  });

  it('el UPDATE lleva la condición «no facturado» (o estado NULL) además de id y business_id', async () => {
    const d = preparar({ tablas: { albaranes: [alb({ estado: 'pendiente' })] } });
    await PATCH(patch({ estado: 'entregado' }), ctx);
    expect(d.updates[0].filtros).toEqual(expect.arrayContaining([['id', 'alb-1'], ['business_id', BIZ]]));
    // la condición or se aplicó de verdad: un albarán facturado no se toca
    const f = preparar({ tablas: { albaranes: [alb({ estado: 'facturado' })] } });
    await PATCH(patch({ estado: 'entregado' }), ctx);
    expect(f.tablas.albaranes[0].estado).toBe('facturado');
  });

  it('«Facturado» con mayúscula también bloquea el UPDATE (409, la fila no cambia)', async () => {
    const d = preparar({ tablas: { albaranes: [alb({ estado: 'Facturado' })] } });
    // la lectura previa ya compara en minúsculas → 409; y el UPDATE protege aunque la lectura no lo viera
    expect((await PATCH(patch({ estado: 'entregado' }), ctx)).status).toBe(409);
    expect(d.tablas.albaranes[0].estado).toBe('Facturado');
    expect(d.updates).toHaveLength(0);
  });

  it('un albarán con estado NULL sí se actualiza (NULL <> facturado no es verdadero en SQL)', async () => {
    const d = preparar({ tablas: { albaranes: [alb({ estado: null })] } });
    const res = await PATCH(patch({ estado: 'entregado' }), ctx);
    expect(res.status).toBe(200);
    expect(d.tablas.albaranes[0].estado).toBe('entregado');
  });

  it('carrera: pendiente al leer, facturado antes de escribir → 409 y la fila no cambia', async () => {
    const d = preparar({ tablas: { albaranes: [alb({ estado: 'pendiente' })] } });
    const fila = d.tablas.albaranes[0];
    const from = (d.client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    (createServiceClient as jest.Mock).mockReturnValue({
      ...(d.client as object),
      from: (t: string) => {
        const q = from(t) as { update: (v: Record<string, unknown>) => unknown };
        const upd = q.update.bind(q);
        // justo antes de aplicar el UPDATE, otra petición factura el albarán
        q.update = (v: Record<string, unknown>) => ((fila.estado = 'facturado'), upd(v));
        return q;
      },
    });
    const res = await PATCH(patch({ estado: 'entregado' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/facturado mientras tanto/);
    expect(fila.estado).toBe('facturado');
  });

  it('0 filas y el albarán ya no existe → 404', async () => {
    const d = preparar({ tablas: { albaranes: [alb({ estado: 'pendiente' })] } });
    const fila = d.tablas.albaranes[0];
    const from = (d.client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    (createServiceClient as jest.Mock).mockReturnValue({
      ...(d.client as object),
      from: (t: string) => {
        const q = from(t) as { update: (v: Record<string, unknown>) => unknown };
        const upd = q.update.bind(q);
        q.update = (v: Record<string, unknown>) => {
          d.tablas.albaranes.length = 0; // desaparece
          fila.estado = 'x';
          return upd(v);
        };
        return q;
      },
    });
    expect((await PATCH(patch({ estado: 'entregado' }), ctx)).status).toBe(404);
  });
});
