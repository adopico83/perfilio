async function getBusinessId(supabase: any): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  if (!userId) return null;

  const { data } = await supabase
    .from('business_users')
    .select('business_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  return data?.business_id ?? null;
}

export async function getBusinessIdClient(supabase: any): Promise<string | null> {
  return getBusinessId(supabase);
}

export async function getBusinessIdServer(supabase: any): Promise<string | null> {
  return getBusinessId(supabase);
}
