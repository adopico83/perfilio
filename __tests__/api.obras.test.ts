import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(),
}));

function mockAuthAndBusiness() {
  (createClient as jest.Mock).mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: jest.fn((table: string) => {
      if (table === 'business_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'biz-1' }, error: null }),
        };
      }
      return {};
    }),
  });
}

describe('/api/obras', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let GET: (req: NextRequest) => Promise<Response>;
  let PATCH: (req: NextRequest) => Promise<Response>;
  type RouteContext = { params: Promise<{ id: string }> };

  beforeAll(async () => {
    const listMod = await import('@/app/api/obras/route');
    POST = listMod.POST;
    PATCH = listMod.PATCH;

    const fichaMod = await import('@/app/api/obras/[id]/route');
    GET = (req: NextRequest) =>
      fichaMod.GET(req, { params: Promise.resolve({ id: 'obra-1' }) } satisfies RouteContext);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
  });

  it('POST /api/obras crea obra correctamente', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table !== 'obras') return {};
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'obra-1',
              business_id: 'biz-1',
              cliente_id: null,
              nombre: 'Reforma Baño García',
              direccion: 'Calle Mayor 1',
              estado: 'abierta',
              fecha_inicio: null,
              descripcion: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            error: null,
          }),
        };
      }),
    });

    const req = new NextRequest('http://localhost/api/obras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: 'biz-1',
        nombre: 'Reforma Baño García',
        direccion: 'Calle Mayor 1',
        estado: 'abierta',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { obra: { id: string; nombre: string } };
    expect(json.obra.id).toBe('obra-1');
    expect(json.obra.nombre).toBe('Reforma Baño García');
  });

  it('GET /api/obras/[id] devuelve ficha completa', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'obras') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: 'obra-1',
                business_id: 'biz-1',
                cliente_id: 'cli-1',
                nombre: 'Reforma Baño García',
                direccion: 'Calle Mayor 1',
                estado: 'en_curso',
                fecha_inicio: '2026-01-10',
                descripcion: 'Reforma integral',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-02T00:00:00.000Z',
              },
              error: null,
            }),
          };
        }
        if (table === 'clientes') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'cli-1', business_id: 'biz-1', nombre: 'Cliente Test', direccion: null },
              error: null,
            }),
          };
        }
        const listChain = (data: unknown[]) => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data, error: null }),
        });
        if (table === 'presupuestos') return listChain([{ id: 'p1', obra_id: 'obra-1', estado: 'borrador', importe_total: 100, fecha: '2026-01-15' }]);
        if (table === 'facturas') return listChain([{ id: 'f1', obra_id: 'obra-1', estado: 'pendiente', total: 120, fecha: '2026-01-20' }]);
        if (table === 'albaranes') return listChain([{ id: 'a1', obra_id: 'obra-1', estado: 'pendiente', total: 80, fecha: '2026-01-18' }]);
        if (table === 'diario_obra') return listChain([{ id: 'd1', obra_id: 'obra-1', obra_nombre: 'Reforma Baño García', texto: 'Paso 1', fotos: [], videos: [], fecha: '2026-01-16' }]);
        if (table === 'gastos') return listChain([{ id: 'g1', obra_id: 'obra-1', proveedor: 'Proveedor', importe_total: 50, fecha: '2026-01-17' }]);
        if (table === 'registros_jornada') return listChain([]);

        return {};
      }),
    });

    const req = new NextRequest('http://localhost/api/obras/obra-1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      obra: { nombre: string };
      cliente: { nombre: string };
      presupuestos: unknown[];
      facturas: unknown[];
      albaranes: unknown[];
      entradas_diario_obra: unknown[];
      gastos: unknown[];
      registros_jornada: unknown[];
    };
    expect(json.obra.nombre).toBe('Reforma Baño García');
    expect(json.cliente.nombre).toBe('Cliente Test');
    expect(json.presupuestos).toHaveLength(1);
    expect(json.facturas).toHaveLength(1);
    expect(json.albaranes).toHaveLength(1);
    expect(json.entradas_diario_obra).toHaveLength(1);
    expect(json.gastos).toHaveLength(1);
    expect(json.registros_jornada).toEqual([]);
  });

  it("PATCH /api/obras cambia estado a 'cerrada'", async () => {
    const obraChain = {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValueOnce({
        data: {
          id: 'obra-1',
          business_id: 'biz-1',
        },
        error: null,
      }).mockResolvedValueOnce({
        data: {
          id: 'obra-1',
          business_id: 'biz-1',
          cliente_id: null,
          nombre: 'Reforma Baño García',
          direccion: 'Calle Mayor 1',
          estado: 'cerrada',
          fecha_inicio: null,
          descripcion: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-03T00:00:00.000Z',
        },
        error: null,
      }),
    };

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table !== 'obras') return {};
        return obraChain;
      }),
    });

    const req = new NextRequest('http://localhost/api/obras', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'obra-1', estado: 'cerrada' }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { obra: { estado: string } };
    expect(json.obra.estado).toBe('cerrada');
  });
});

