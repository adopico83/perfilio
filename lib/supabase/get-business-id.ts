import type { SupabaseClient } from '@supabase/supabase-js';

async function getBusinessIdByUserId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  if (!userId) return null;

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn('Timeout recuperando businessId');
      resolve(null);
    }, 5000)
  );

  const queryPromise = supabase
    .from('business_profiles')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  const result = await Promise.race([queryPromise, timeoutPromise]);
  return result?.data?.id ?? null;
}

export async function getBusinessIdClient(supabase: SupabaseClient, userId?: string): Promise<string | null> {
  const resolvedUserId =
    userId ??
    (await supabase.auth.getSession())?.data?.session?.user?.id ??
    null;
  if (!resolvedUserId) return null;
  return getBusinessIdByUserId(supabase, resolvedUserId);
}

export async function getBusinessIdServer(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  if (!userId) return null;
  return getBusinessIdByUserId(supabase, userId);
}
