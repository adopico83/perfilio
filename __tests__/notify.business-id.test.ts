const UUID = '8784450e-08a4-420a-8c37-d30bff8f0d39';
const OBRA = '20000000-0000-4000-8000-000000000001';

type Call = { table: string; filters: Array<[string, unknown]>; inserted?: Record<string, unknown> };
const calls: Call[] = [];
let obraBusiness: string | null = UUID;
let duplicado = false;

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => (call.filters.push([c, v]), q);
      q.gte = () => q;
      q.limit = () => q;
      q.maybeSingle = async () =>
        table === 'obras'
          ? { data: obraBusiness ? { business_id: obraBusiness } : null, error: null }
          : { data: duplicado ? { id: 'n' } : null, error: null };
      q.insert = async (row: Record<string, unknown>) => ((call.inserted = row), { error: null });
      return q;
    },
  }),
}));

import { sendBichoNotification } from '../src/lib/notify';

const base = { message: 'hola', urgency: 'baja' as const, type: 't', slug: 's' };

beforeEach(() => {
  calls.length = 0;
  obraBusiness = UUID;
  duplicado = false;
  process.env.PUSHOVER_API_TOKEN = 'tok';
  process.env.PUSHOVER_USER_KEY = 'usr';
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ status: 1 }) }) as never;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('src/lib/notify: guarda siempre business_id', () => {
  it('con business_id explícito lo guarda y filtra los duplicados por negocio', async () => {
    expect(await sendBichoNotification({ ...base, business_id: UUID })).toBe(true);
    const lookup = calls.find((c) => c.table === 'bicho_notifications' && !c.inserted)!;
    expect(lookup.filters).toContainEqual(['business_id', UUID]);
    expect(calls.find((c) => c.inserted)?.inserted).toMatchObject({ business_id: UUID, slug: 's' });
  });
  it('sin business_id lo deduce de la obra', async () => {
    expect(await sendBichoNotification({ ...base, obra_id: OBRA })).toBe(true);
    expect(calls.find((c) => c.inserted)?.inserted).toMatchObject({ business_id: UUID });
  });
  it('sin negocio ni obra no envía nada', async () => {
    expect(await sendBichoNotification(base)).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(calls.some((c) => c.inserted)).toBe(false);
  });
  it('si la obra no tiene negocio tampoco envía', async () => {
    obraBusiness = null;
    expect(await sendBichoNotification({ ...base, obra_id: OBRA })).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('no repite un aviso del mismo negocio y slug', async () => {
    duplicado = true;
    expect(await sendBichoNotification({ ...base, business_id: UUID })).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
