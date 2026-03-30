import { GET } from '@/app/api/gmail/urgentes/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(),
}));

describe('GET /api/gmail/urgentes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('devuelve urgentes, normales y total_urgentes', async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    const tokenChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { access_token: 'tok', refresh_token: null, expiry_date: null },
        error: null,
      }),
    };
    const presChain = {
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ cliente_nombre: 'Cliente A' }], error: null }),
    };
    const facChain = {
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'gmail_tokens') return tokenChain;
        if (table === 'presupuestos') return presChain;
        if (table === 'facturas') return facChain;
        return { select: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'm1' }, { id: 'm2' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          snippet: 'Necesito un presupuesto urgente',
          labelIds: ['UNREAD'],
          internalDate: `${Date.now() - 72 * 3600 * 1000}`,
          payload: {
            headers: [
              { name: 'From', value: 'Cliente A <a@a.com>' },
              { name: 'Subject', value: 'Urgente: presupuesto' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          snippet: 'Gracias por todo',
          labelIds: [],
          internalDate: `${Date.now()}`,
          payload: {
            headers: [
              { name: 'From', value: 'Otro <b@b.com>' },
              { name: 'Subject', value: 'Consulta' },
            ],
          },
        }),
      });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      urgentes: unknown[];
      normales: unknown[];
      total_urgentes: number;
    };
    expect(Array.isArray(json.urgentes)).toBe(true);
    expect(Array.isArray(json.normales)).toBe(true);
    expect(typeof json.total_urgentes).toBe('number');
    expect(json.urgentes.length).toBe(1);
    expect(json.normales.length).toBe(1);
    expect(json.total_urgentes).toBe(1);
  });
});
