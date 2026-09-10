/**
 * Acceso a un negocio: `business_users` (membership) y, si no hay fila,
 * `business_profiles` (dueño vía user_id).
 *
 * Las copias locales en las API routes cortaban en el primer SELECT: si el
 * cliente de Supabase exponía `business_users.select` (siempre en prod),
 * nunca miraban el perfil. El seed demo solo insertaba `business_profiles`,
 * así que el header (getBusinessId*) iba bien y clientes/obras devolvían 403.
 *
 * Misma lógica que tenía el agente (`assertUserCanAccessBusiness`): hit → true;
 * miss/error → perfiles.
 */

type MembershipRow = { business_id?: string | null };
type ProfileRow = { id?: string | null };

type FilterChain = {
  select: (columns: string) => FilterChain;
  eq: (column: string, value: string) => FilterChain;
  maybeSingle: () => Promise<{ data: MembershipRow | ProfileRow | null; error?: unknown }>;
};

export type BusinessAccessClient = {
  from: (table: string) => unknown;
};

function asChain(query: unknown): Partial<FilterChain> {
  return query && typeof query === 'object' ? (query as Partial<FilterChain>) : {};
}

export async function assertUserOwnsBusiness(
  supabase: BusinessAccessClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  if (!userId || !businessId) return false;

  try {
    const businessUsersQuery = asChain(supabase.from('business_users'));
    if (typeof businessUsersQuery.select === 'function') {
      const { data } = await businessUsersQuery
        .select('business_id')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .maybeSingle();
      if (data && 'business_id' in data && data.business_id) return true;
    }
  } catch {
    // Mocks sin cadena PostgREST, o error de red/schema: caer a perfiles.
  }

  try {
    const profilesQuery = asChain(supabase.from('business_profiles'));
    if (typeof profilesQuery.select !== 'function') return false;
    const { data } = await profilesQuery
      .select('id')
      .eq('id', businessId)
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data && 'id' in data && data.id);
  } catch {
    return false;
  }
}
