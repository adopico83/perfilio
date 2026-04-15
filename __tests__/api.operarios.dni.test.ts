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

describe('/api/operarios/dni PATCH', () => {
  let PATCH: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/operarios/dni/route');
    PATCH = mod.PATCH;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthAndBusiness();
  });

  it('devuelve 400 si faltan campos obligatorios', async () => {
    (createServiceClient as jest.Mock).mockReturnValue({ from: jest.fn() });
    const req = new NextRequest('http://localhost/api/operarios/dni', {
      method: 'PATCH',
      body: JSON.stringify({ business_id: 'biz-1' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('actualiza dni del operario en su negocio', async () => {
    const from = jest.fn((table: string) => {
      if (table === 'operarios') {
        let mode: 'select' | 'update' = 'select';
        return {
          select: jest.fn(() => {
            mode = 'select';
            return {
              eq: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({
                data: { id: 'op-1', business_id: 'biz-1', nombre: 'Luis', dni: null },
                error: null,
              }),
            };
          }),
          update: jest.fn(() => {
            mode = 'update';
            return {
              eq: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({
                data:
                  mode === 'update'
                    ? { id: 'op-1', nombre: 'Luis', dni: '12345678A' }
                    : { id: 'op-1', nombre: 'Luis', dni: null },
                error: null,
              }),
            };
          }),
        };
      }
      return {};
    });
    (createServiceClient as jest.Mock).mockReturnValue({ from });

    const req = new NextRequest('http://localhost/api/operarios/dni', {
      method: 'PATCH',
      body: JSON.stringify({
        business_id: 'biz-1',
        operario_id: 'op-1',
        dni: '12345678A',
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { operario?: { id: string; dni: string | null } };
    expect(json.operario?.id).toBe('op-1');
    expect(json.operario?.dni).toBe('12345678A');
  });
});
