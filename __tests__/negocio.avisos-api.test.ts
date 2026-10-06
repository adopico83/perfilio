import { NextRequest } from 'next/server';

const mockUser = jest.fn();
const mockOwns = jest.fn();
const mockBusinessIdServer = jest.fn();
const fetchMock = jest.fn();
const upserts: Array<Record<string, unknown>> = [];
const profileUpdates: Array<{ valores: Record<string, unknown>; id: unknown }> = [];
const CLAVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234'; // 30 caracteres
let avisoFila: Record<string, unknown> | null = { pushover_user_key: CLAVE };

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: () => mockUser() } }),
  createServiceClient: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tabla === 'business_profiles' ? { resumen_push: true } : avisoFila, error: null }),
        }),
      }),
      upsert: async (fila: Record<string, unknown>) => (upserts.push(fila), { error: null }),
      update: (valores: Record<string, unknown>) => ({
        eq: async (_c: string, id: unknown) => (profileUpdates.push({ valores, id }), { error: null }),
      }),
    }),
  }),
}));
jest.mock('@/lib/supabase/assert-user-owns-business', () => ({ assertUserOwnsBusiness: (...a: unknown[]) => mockOwns(...a) }));
jest.mock('@/lib/supabase/get-business-id', () => ({ getBusinessIdServer: () => mockBusinessIdServer() }));

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  upserts.length = 0;
  profileUpdates.length = 0;
  avisoFila = { pushover_user_key: CLAVE };
  mockUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockOwns.mockResolvedValue(true);
  mockBusinessIdServer.mockResolvedValue('biz-1');
  process.env = { ...ENV, PUSHOVER_API_TOKEN: 'tok' };
  delete process.env.PUSHOVER_USER_KEY;
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ json: async () => ({ status: 1 }) });
});
afterAll(() => { process.env = ENV; });

const get = async () => (await import('@/app/api/negocio/avisos/route')).GET(new NextRequest('http://x/api/negocio/avisos'));
const patch = async (body: unknown) =>
  (await import('@/app/api/negocio/avisos/route')).PATCH(new NextRequest('http://x/api/negocio/avisos', { method: 'PATCH', body: JSON.stringify(body) }));

describe('GET /api/negocio/avisos', () => {
  it('401 sin sesión y 403 si el negocio no es suyo', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
    mockUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockOwns.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
  });
  it('nunca devuelve la clave completa, solo las 4 últimas', async () => {
    const res = await get();
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain(CLAVE);
    expect(JSON.parse(texto)).toMatchObject({ resumen_push: true, pushover_configurado: true, pushover_clave_final: '…1234', usa_clave_global: false });
  });
  it('sin clave propia ni dueño de la global → no configurado', async () => {
    avisoFila = null;
    expect(await (await get()).json()).toMatchObject({ pushover_configurado: false, pushover_clave_final: null });
  });
});

describe('PATCH /api/negocio/avisos', () => {
  it('401 / 403 / 400', async () => {
    mockUser.mockResolvedValue({ data: { user: null } });
    expect((await patch({ resumen_push: true })).status).toBe(401);
    mockUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockOwns.mockResolvedValue(false);
    expect((await patch({ resumen_push: true })).status).toBe(403);
    mockOwns.mockResolvedValue(true);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ pushover_user_key: 'corta' })).status).toBe(400);
    expect(upserts).toHaveLength(0);
  });
  it('guarda la clave y el interruptor filtrando por el negocio resuelto, ignorando campos de más', async () => {
    const res = await patch({ resumen_push: true, pushover_user_key: CLAVE, business_id_extra: 'x', nombre: 'hack' });
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ business_id: 'biz-1', pushover_user_key: CLAVE, updated_by: 'u1' });
    expect(profileUpdates).toEqual([{ valores: { resumen_push: true }, id: 'biz-1' }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('users/validate.json');
  });
  it('clave rechazada por Pushover → 400 y no guarda', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: 0 }) });
    expect((await patch({ pushover_user_key: CLAVE })).status).toBe(400);
    expect(upserts).toHaveLength(0);
  });
  it('si Pushover no responde, guarda igualmente y avisa', async () => {
    fetchMock.mockRejectedValue(new Error('red'));
    const res = await patch({ pushover_user_key: CLAVE });
    expect(res.status).toBe(200);
    expect((await res.json()).aviso).toMatch(/no se pudo comprobar/i);
    expect(upserts).toHaveLength(1);
  });
  it('null o cadena vacía quitan la clave sin llamar a Pushover', async () => {
    for (const v of [null, '']) {
      expect((await patch({ pushover_user_key: v })).status).toBe(200);
    }
    expect(upserts.map((u) => u.pushover_user_key)).toEqual([null, null]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
