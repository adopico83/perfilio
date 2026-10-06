import { NextRequest } from 'next/server';

const mockUser = jest.fn();
const mockOwns = jest.fn();
const mockRender = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockUser() } }),
  createServiceClient: () => ({ from: () => ({}) }),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: (...a: unknown[]) => mockOwns(...a) }));
jest.mock('@/lib/supabase/get-business-id', () => ({ getBusinessIdServer: async () => 'biz-1' }));
jest.mock('@/lib/pdf/presupuesto-render', () => ({ renderPresupuestoPdf: (...a: unknown[]) => mockRender(...a) }));

import { GET } from '@/app/api/pdf/muestra/route';

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockOwns.mockResolvedValue(true);
  mockRender.mockResolvedValue({ ok: true, buffer: Buffer.from('%PDF-x'), fecha: '2026-10-06' });
});
const llamar = (q = '') => GET(new NextRequest(`http://x/api/pdf/muestra${q}`));

describe('GET /api/pdf/muestra', () => {
  it('devuelve un PDF generado con la marca del negocio del usuario y un presupuesto inventado', async () => {
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(mockRender.mock.calls[0][1]).toBe('biz-1');
    const fila = mockRender.mock.calls[0][2];
    expect(fila).toMatchObject({ id: 'muestra', cliente_nombre: 'Cliente de ejemplo' });
  });
  it('401 sin sesión y no renderiza', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await llamar()).status).toBe(401);
    expect(mockRender).not.toHaveBeenCalled();
  });
  it('403 si pide el negocio de otro', async () => {
    mockOwns.mockResolvedValue(false);
    expect((await llamar('?business_id=ajeno')).status).toBe(403);
    expect(mockRender).not.toHaveBeenCalled();
  });
  it('500 si el render falla', async () => {
    mockRender.mockResolvedValue({ ok: false, error: 'boom' });
    expect((await llamar()).status).toBe(500);
  });
});
