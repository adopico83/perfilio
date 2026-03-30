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

describe('/api/clientes', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/clientes/route');
    POST = mod.POST;
    GET = mod.GET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
  });

  it('POST crea cliente correctamente', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'cli-1',
            business_id: 'biz-1',
            nombre: 'Acme SL',
            telefono: '600111222',
            email: 'a@x.es',
            direccion: 'Calle 1',
            nif: 'B123',
            notas: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          error: null,
        }),
      })),
    });

    const req = new NextRequest('http://localhost/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: 'biz-1',
        nombre: 'Acme SL',
        telefono: '600111222',
        email: 'a@x.es',
        direccion: 'Calle 1',
        nif: 'B123',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { cliente: { id: string; nombre: string } };
    expect(json.cliente.nombre).toBe('Acme SL');
    expect(json.cliente.id).toBe('cli-1');
  });

  it('GET devuelve lista con conteos', async () => {
    const clientesRows = {
      data: [
        {
          id: 'c1',
          nombre: 'Beta',
          telefono: null,
          email: null,
          direccion: null,
          nif: null,
          notas: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      error: null,
    };

    const emptyIds = { data: [], error: null };

    const fromMock = jest.fn((table: string) => {
      if (table === 'clientes') {
        const chain = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue(clientesRows),
        };
        return chain;
      }
      if (table === 'presupuestos') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ cliente_id: 'c1' }],
            error: null,
          }),
        };
      }
      if (table === 'facturas') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue(emptyIds),
        };
      }
      if (table === 'albaranes') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ cliente_id: 'c1' }, { cliente_id: 'c1' }],
            error: null,
          }),
        };
      }
      return {};
    });

    (createServiceClient as jest.Mock).mockReturnValue({ from: fromMock });

    const req = new NextRequest('http://localhost/api/clientes?business_id=biz-1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      clientes: Array<{
        id: string;
        num_presupuestos: number;
        num_facturas: number;
        num_albaranes: number;
      }>;
    };
    expect(json.clientes).toHaveLength(1);
    expect(json.clientes[0].num_presupuestos).toBe(1);
    expect(json.clientes[0].num_facturas).toBe(0);
    expect(json.clientes[0].num_albaranes).toBe(2);
  });
});
