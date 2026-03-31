import { NextRequest } from 'next/server';

import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(),
}));

jest.mock('@/lib/albaranes-sin-facturar', () => ({
  listarAlbaranesSinFacturar: jest.fn(),
}));

import { listarAlbaranesSinFacturar } from '@/lib/albaranes-sin-facturar';

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

describe('GET /api/albaranes/sin-facturar', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/albaranes/sin-facturar/route');
    GET = mod.GET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
    (createServiceClient as jest.Mock).mockReturnValue({});
    (listarAlbaranesSinFacturar as jest.Mock).mockResolvedValue({
      albaranes: [
        {
          id: 'alb-1',
          numero_albaran: 'ALB-1',
          cliente_nombre: 'García',
          total: 1200,
          fecha: '2026-03-20',
          estado: 'entregado',
        },
      ],
      total: 1,
    });
  });

  it('devuelve shape correcta con albaranes y total', async () => {
    const req = new NextRequest(
      'http://localhost/api/albaranes/sin-facturar?business_id=biz-1'
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      albaranes: Array<{
        id: string;
        numero_albaran: string | null;
        cliente_nombre: string | null;
        total: number | null;
        fecha: string | null;
        estado: string | null;
      }>;
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.albaranes).toHaveLength(1);
    expect(json.albaranes[0]).toMatchObject({
      id: 'alb-1',
      numero_albaran: 'ALB-1',
      cliente_nombre: 'García',
      total: 1200,
      fecha: '2026-03-20',
      estado: 'entregado',
    });
    expect(listarAlbaranesSinFacturar).toHaveBeenCalledWith(
      expect.anything(),
      'biz-1'
    );
  });
});
