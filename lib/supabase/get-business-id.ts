const BUSINESS_ID_QUERY_TIMEOUT_MS = 5000;

async function getBusinessId(supabase: any): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  if (!userId) return null;

  const queryPromise = supabase
    .from('business_profiles')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), BUSINESS_ID_QUERY_TIMEOUT_MS);
  });

  const raced = await Promise.race([
    queryPromise.then((res: { data: { id?: string } | null }) => ({ kind: 'query' as const, res })),
    timeoutPromise.then(() => ({ kind: 'timeout' as const })),
  ]);

  if (raced.kind === 'timeout') {
    console.warn('Timeout recuperando businessId');
    return null;
  }

  const { data } = raced.res;
  return data?.id ?? null;
}

export async function getBusinessIdClient(supabase: any): Promise<string | null> {
  return getBusinessId(supabase);
}

export async function getBusinessIdServer(supabase: any): Promise<string | null> {
  return getBusinessId(supabase);
}
