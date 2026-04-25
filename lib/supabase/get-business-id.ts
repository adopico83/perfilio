type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: { id?: string | null } | null } }>;
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => {
          maybeSingle: () => Promise<{
            data: { business_id?: string | null } | null;
            error: unknown;
          }>;
        };
      };
    };
  };
};

async function getBusinessId(supabase: SupabaseLike): Promise<string | null> {
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

export async function getBusinessIdClient(supabase: SupabaseLike): Promise<string | null> {
  return getBusinessId(supabase);
}

export async function getBusinessIdServer(supabase: SupabaseLike): Promise<string | null> {
  return getBusinessId(supabase);
}
