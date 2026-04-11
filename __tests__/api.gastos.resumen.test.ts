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

describe('/api/gastos/resumen', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/gastos/resumen/route');
    GET = mod.GET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
  });

  it('devuelve 400 sin business_id', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({ from: jest.fn() });

    const req = new NextRequest('http://localhost/api/gastos/resumen');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('devuelve resumen agrupado por obra y totales', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'gastos') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'g1',
                  fecha: '2026-04-05',
                  proveedor: 'Iturria',
                  descripcion: 'Ladrillos',
                  categoria: 'material',
                  importe: 100,
                  iva: 21,
                  importe_total: 121,
                  obra_id: 'obra-1',
                  obras: { nombre: 'Reforma Norte' },
                },
                {
                  id: 'g2',
                  fecha: '2026-04-06',
                  proveedor: 'Contenedores SL',
                  descripcion: 'Alquiler',
                  categoria: 'vertido',
                  importe: 50,
                  iva: 10.5,
                  importe_total: 60.5,
                  obra_id: null,
                  obras: null,
                },
              ],
              error: null,
            }),
          };
        }
        return {};
      }),
    });

    const req = new NextRequest('http://localhost/api/gastos/resumen?business_id=biz-1&mes=2026-04');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      mes: string;
      total_mes: number;
      por_categoria: Array<{ categoria: string; total: number }>;
      por_obra: Array<{ obra_nombre: string; subtotal: number; gastos: unknown[] }>;
    };
    expect(json.mes).toBe('2026-04');
    expect(json.total_mes).toBeCloseTo(181.5, 5);
    expect(json.por_obra.length).toBe(2);
    const sinObra = json.por_obra.find((g) => g.obra_nombre === 'Sin obra asignada');
    expect(sinObra?.subtotal).toBeCloseTo(60.5, 5);
    const mat = json.por_categoria.find((c) => c.categoria === 'material');
    expect(mat?.total).toBeCloseTo(121, 5);
  });
});
