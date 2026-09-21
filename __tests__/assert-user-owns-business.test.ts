import { assertUserOwnsBusiness } from '@/lib/supabase/assert-user-owns-business';

type Row = Record<string, string> | null;

function chain(result: { data: Row; error?: unknown }) {
  const c: {
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  c.select.mockReturnValue(c);
  c.eq.mockReturnValue(c);
  return c;
}

function client(tables: Record<string, { data: Row; error?: unknown } | 'missing'>) {
  return {
    from: jest.fn((table: string) => {
      const spec = tables[table];
      if (spec === 'missing' || spec === undefined) return {};
      return chain(spec);
    }),
  };
}

describe('assertUserOwnsBusiness', () => {
  it('true si hay fila en business_users (no hace falta perfil)', async () => {
    const supabase = client({
      business_users: { data: { business_id: 'biz-1' } },
      business_profiles: { data: null },
    });
    await expect(assertUserOwnsBusiness(supabase, 'user-1', 'biz-1')).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('business_users');
    expect(supabase.from).not.toHaveBeenCalledWith('business_profiles');
  });

  it('cae a business_profiles si business_users existe pero no hay membership (bug prod demo)', async () => {
    const supabase = client({
      business_users: { data: null },
      business_profiles: { data: { id: 'biz-1' } },
    });
    await expect(assertUserOwnsBusiness(supabase, 'user-1', 'biz-1')).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('business_users');
    expect(supabase.from).toHaveBeenCalledWith('business_profiles');
  });

  it('cae a business_profiles si business_users devuelve error', async () => {
    const supabase = client({
      business_users: { data: null, error: { message: 'relation does not exist' } },
      business_profiles: { data: { id: 'biz-1' } },
    });
    await expect(assertUserOwnsBusiness(supabase, 'user-1', 'biz-1')).resolves.toBe(true);
  });

  it('cae a business_profiles si el mock no expone select (tests legacy)', async () => {
    const supabase = client({
      business_users: 'missing',
      business_profiles: { data: { id: 'biz-1' } },
    });
    await expect(assertUserOwnsBusiness(supabase, 'user-1', 'biz-1')).resolves.toBe(true);
  });

  it('false si no hay membership ni perfil', async () => {
    const supabase = client({
      business_users: { data: null },
      business_profiles: { data: null },
    });
    await expect(assertUserOwnsBusiness(supabase, 'user-1', 'biz-1')).resolves.toBe(false);
  });

  it('false si userId o businessId van vacíos', async () => {
    const supabase = client({});
    await expect(assertUserOwnsBusiness(supabase, '', 'biz-1')).resolves.toBe(false);
    await expect(assertUserOwnsBusiness(supabase, 'user-1', '')).resolves.toBe(false);
  });
});
