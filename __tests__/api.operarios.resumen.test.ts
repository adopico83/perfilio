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

describe('/api/operarios/resumen', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/operarios/resumen/route');
    GET = mod.GET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
  });

  it('devuelve 400 sin business_id', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({ from: jest.fn() });

    const req = new NextRequest('http://localhost/api/operarios/resumen');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('devuelve resumen con operarios y totales', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'operarios') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [
                { id: 'op-1', nombre: 'Luis' },
                { id: 'op-2', nombre: 'Ana' },
              ],
              error: null,
            }),
          };
        }
        if (table === 'registros_jornada') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockResolvedValue({
              data: [
                {
                  operario_id: 'op-1',
                  obra_id: 'obra-1',
                  fecha: '2026-04-14',
                  horas_reales: 8,
                  horas_convenio: 8,
                  obras: { id: 'obra-1', nombre: 'Reforma Norte' },
                },
                {
                  operario_id: 'op-1',
                  obra_id: 'obra-2',
                  fecha: '2026-04-13',
                  horas_reales: 2,
                  horas_convenio: 2,
                  obras: { id: 'obra-2', nombre: 'Baño Sur' },
                },
              ],
              error: null,
            }),
          };
        }
        return {};
      }),
    });

    const req = new NextRequest(
      'http://localhost/api/operarios/resumen?business_id=biz-1&mes=2026-04'
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      mes: string;
      operarios: Array<{ id: string; nombre: string; horas_reales_mes: number; por_obra: unknown[] }>;
      totales: { horas_reales: number; horas_convenio: number };
    };
    expect(json.mes).toBe('2026-04');
    expect(json.operarios).toHaveLength(2);
    const luis = json.operarios.find((o) => o.id === 'op-1');
    expect(luis?.horas_reales_mes).toBe(10);
    expect(luis?.por_obra).toHaveLength(2);
    expect((luis?.por_obra?.[0] as { por_dia?: Array<{ fecha: string }> }).por_dia?.[0]?.fecha).toBe(
      '2026-04-13'
    );
    expect(json.totales.horas_reales).toBe(10);
    expect(json.totales.horas_convenio).toBe(10);
  });
});
