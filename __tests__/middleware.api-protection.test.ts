import { NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

jest.mock('@/lib/supabase/middleware', () => ({
  updateSession: jest.fn(),
}));

const updateSessionMock = updateSession as jest.MockedFunction<typeof updateSession>;

describe('middleware - protección de /api/*', () => {
  it('devuelve 401 con JSON { error: "No autorizado" } cuando no hay sesión en /api/*', async () => {
    const { middleware } = await import('@/middleware');

    updateSessionMock.mockResolvedValue({
      supabaseResponse: NextResponse.next(),
      user: null,
    });

    const paths = [
      'http://localhost/api/agente',
      'http://localhost/api/presupuestos',
      'http://localhost/api/facturas',
      'http://localhost/api/albaranes',
      'http://localhost/api/metrics/economicas',
    ];

    for (const url of paths) {
      const req = new NextRequest(url);
      const res = await middleware(req);
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'No autorizado' });
    }
  });
});

